// pt/pool.js — 0.3.0 P3.0: the particle pool's transactions and its inventory
// (0.3.0-p3-plan.md §1.2, §1.3). The pool is state.js's structure of arrays and its dense
// active prefix `0..S.n`; what lives here is every operation that changes *which* parcels
// exist, so that none of them can lose material or disagree about a parcel's identity:
//
//   admit    take the next slot, zero it, give it a fresh id and a phase
//   split    move a proper fraction of one parcel's mass into a new parcel of another phase
//   merge    combine two same-phase parcels into one, keeping the older id
//   remove   close a slot by compacting the last active parcel into it
//   move     carry *every* per-parcel field from one slot to another (what remove rides on)
//
// The two rules the plan makes non-negotiable are the reasons this is one file. A removal
// compacts the final active slot into the hole and the moved parcel keeps its id and every
// field (§1.3), which is only safe if the field list has one owner -- FIELDS below is that
// owner, and pt-p3-pool.js fails if state.js grows a per-parcel array FIELDS does not know.
// And a full pool defers the transaction and counts the deferral; it never drops a parcel,
// so `S.tx.refuse` is the number that says the reserve was too small.
//
// The inventory is the ledger's stock side: what exists now, by phase, in compensated
// summation when a fixture asks for the exact one. Throughput counters (gross melting,
// intrusion, eruption -- P3.2 and P3.3) are *not* inventory and are never added to it.
//
// One global per new file (0.3.0-p3-plan.md §6): this file is an IIFE whose only global is
// the PTPOOL it exports, and every consumer aliases it under that same name.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;

	// Neumaier compensated accumulators, two doubles each (running sum, compensation), laid
	// out in one array so the pass allocates nothing: five totals, then per-phase mass and
	// enthalpy. The plan's 1e-9 closure mixes 1e4 km2 deep parcels with 1e1 km2 surface ones,
	// where a running sum loses the small terms.
	var ACC = new Float64Array(10 + 4 * P.PH_N);
	var A_M = 0, A_H = 2, A_F = 4, A_W = 6, A_L = 8, A_PH = 10;

	function cadd(o, v) {
		var s = ACC[o] + v;
		ACC[o + 1] += Math.abs(ACC[o]) >= Math.abs(v) ? v - (s - ACC[o]) : ACC[o] - (s - v);
		ACC[o] = s;
	}

	function fin(o) { return ACC[o] + ACC[o + 1]; }

	var POOL = {
		// every per-parcel field, in one order: the list remove() permutes and the list
		// pt-p3-pool.js holds state.js against. Workspace arrays that are *sized* with the
		// pool but are rebuilt every frame are excluded on purpose -- permuting them would be
		// wrong (they are indexed by slot, not carried by the parcel) and moving them would be
		// dead work. `cl` is the crust pass's own output and is rewritten for all of 0..S.n
		// every frame, so it is workspace too, fingerprint included.
		FIELDS: ['x', 'y', 'e', 'T', 'm', 'vx', 'vy', 'age', 'mu', 'dmg', 'pLoad', 'pCnt',
			'id', 'ph', 'H', 'cF', 'cW', 'melt'],
		WORK: ['order', 'par', 'cl', 'csOf', 'csM', 'csX', 'csY', 'csVX', 'csVY', 'csW',
			'csR2', 'csS', 'csP', 'csRef', 'csCnt'],

		// the field arrays, resolved once per allocation generation. state.js reallocates all
		// of them together when the capacity grows, so the identity of S.x is the generation
		// marker; the check keeps a mesh switch from leaving this pointing at freed arrays
		// without paying a name lookup per moved field.
		_fld: null, _gen: null,
		fields: function (S) {
			var k, f;
			if (this._gen === S.x) return this._fld;
			f = new Array(this.FIELDS.length);
			for (k = 0; k < this.FIELDS.length; k++) f[k] = S[this.FIELDS[k]];
			this._fld = f; this._gen = S.x;
			return f;
		},

		room: function (S) { return P.partCap - S.n; },

		// the next free slot, or -1 when the pool is full. The slot is zeroed field by field
		// so an admitted parcel never inherits its predecessor's state, and its id is fresh:
		// ids are never reused, which is what makes a merge's surviving id a history and not
		// a coincidence.
		admit: function (S, ph) {
			if (S.n >= P.partCap) { S.tx.refuse++; return -1; }
			var p = S.n, f = this.fields(S), k;
			for (k = 0; k < f.length; k++) f[k][p] = 0;
			S.id[p] = S.nextId++;
			S.ph[p] = ph;
			S.n = p + 1;
			S.tx.admit++;
			return p;
		},

		// carry every per-parcel field from slot `src` to slot `dst`
		move: function (S, dst, src) {
			var f = this.fields(S), k;
			for (k = 0; k < f.length; k++) f[k][dst] = f[k][src];
		},

		// close slot p: the last active parcel takes its place and the prefix stays dense.
		// The vacated slot is zeroed, so nothing lives past S.n and a stale tail cannot be
		// mistaken for material by a pass that got its bound wrong.
		remove: function (S, p) {
			var last = S.n - 1, f = this.fields(S), k;
			S.n = last;
			if (p !== last) {
				for (k = 0; k < f.length; k++) f[k][p] = f[k][last];
				S.tx.move++;
			}
			for (k = 0; k < f.length; k++) f[k][last] = 0;
		},

		// split a proper fraction of parcel p into a new parcel of phase `ph`. Intensive state
		// (specific enthalpy, temperature, composition, melt fraction, position, velocity) is
		// shared, extensive state (mass, so momentum and total enthalpy) is divided, and the
		// host keeps its id: the child is material that left the host, not a rename of it.
		// Bond state is not shared -- the child has no bonds and no age, it just changed
		// phase. A full pool defers the split and counts it; the mass stays in the host.
		split: function (S, p, frac, ph) {
			// a whole parcel is a phase change (P3.1), not a split
			if (!(frac > 0) || !(frac < 1)) { S.tx.refuse++; return -1; }
			var q = this.admit(S, ph), mq;
			if (q < 0) return -1;
			mq = S.m[p] * frac;
			S.m[p] -= mq; S.m[q] = mq;
			S.x[q] = S.x[p]; S.y[q] = S.y[p]; S.e[q] = S.e[p];
			S.vx[q] = S.vx[p]; S.vy[q] = S.vy[p];
			S.T[q] = S.T[p]; S.H[q] = S.H[p];
			S.cF[q] = S.cF[p]; S.cW[q] = S.cW[p]; S.melt[q] = S.melt[p];
			S.tx.split++;
			return q;
		},

		// combine a and b into a, then close b's slot. Mass, momentum and enthalpy sum;
		// composition, melt fraction, age and position are mass weighted; the survivor keeps
		// the *older* id, so the result does not depend on the order the pair was found in.
		// x is weighted through the periodic delta folded into [-wrap/2, wrap/2), so a pair
		// straddling the seam merges into one body instead of one at each end of the map.
		// y and e are weighted separately rather than one derived from the other: each is
		// carried by its own kernel (advect steps e through the metric), and a merge only ever
		// meets adjacent parcels, where the two conventions already agree.
		// Same phase only -- a merge across phases would move material between ledger lines
		// with no transfer counter for it. The composition/melt tolerance is P3.4's.
		merge: function (M, S, a, b) {
			var ma, mb, mt, w, dx;
			if (a === b || S.ph[a] !== S.ph[b]) { S.tx.refuse++; return -1; }
			ma = S.m[a]; mb = S.m[b]; mt = ma + mb;
			if (!(mt > 0)) { S.tx.refuse++; return -1; }
			w = mb / mt;
			dx = S.x[b] - S.x[a];
			dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
			S.vx[a] = (ma * S.vx[a] + mb * S.vx[b]) / mt;
			S.vy[a] = (ma * S.vy[a] + mb * S.vy[b]) / mt;
			S.H[a] += w * (S.H[b] - S.H[a]);
			S.T[a] += w * (S.T[b] - S.T[a]);
			S.cF[a] += w * (S.cF[b] - S.cF[a]);
			S.cW[a] += w * (S.cW[b] - S.cW[a]);
			S.melt[a] += w * (S.melt[b] - S.melt[a]);
			S.age[a] += w * (S.age[b] - S.age[a]);
			S.x[a] += w * dx;
			if (S.x[a] < 0) S.x[a] += M.wrap; else if (S.x[a] >= M.wrap) S.x[a] -= M.wrap;
			S.y[a] += w * (S.y[b] - S.y[a]);
			S.e[a] += w * (S.e[b] - S.e[a]);
			S.m[a] = mt;
			if (S.id[b] < S.id[a]) S.id[a] = S.id[b];
			this.remove(S, b);
			S.tx.merge++;
			return a;
		},

		// the stock side of the ledger, one naive pass: counts, per-phase mass and enthalpy,
		// and the totals of mass, enthalpy, felsic, water and melt. This is the frame
		// diagnostic (G8 calls it once per rendered frame, eight flops a parcel); a fixture
		// that gates closure to 1e-9 calls inventoryComp instead. invErr is what the naive
		// pass lost against the compensated one, so a red ledger is not mistaken for a red sum.
		inventory: function (S) {
			var n = S.n, p, ph, m, invN = S.invN, invM = S.invM, invH = S.invH;
			var tm = 0, th = 0, tf = 0, tw = 0, tl = 0;
			invN.fill(0); invM.fill(0); invH.fill(0);
			for (p = 0; p < n; p++) {
				ph = S.ph[p]; m = S.m[p];
				invN[ph]++; invM[ph] += m; invH[ph] += m * S.H[p];
				tm += m; th += m * S.H[p];
				tf += m * S.cF[p]; tw += m * S.cW[p]; tl += m * S.melt[p];
			}
			S.invMTot = tm; S.invHTot = th;
			S.invFTot = tf; S.invWTot = tw; S.invLTot = tl;
		},

		// the same inventory in compensated summation, for the closure gates. Two loops over
		// the same fields is a duplication the pool fixture polices: it asserts the two agree
		// to 1e-12 relative on a live state, so they cannot drift apart silently.
		inventoryComp: function (S) {
			var n = S.n, p, ph, m, o, invN = S.invN, invM = S.invM, invH = S.invH;
			var tm = 0, th = 0;
			invN.fill(0); invM.fill(0); invH.fill(0);
			ACC.fill(0);
			for (p = 0; p < n; p++) {
				ph = S.ph[p]; m = S.m[p];
				o = A_PH + 2 * ph;
				invN[ph]++;
				cadd(o, m); cadd(o + 2 * P.PH_N, m * S.H[p]);
				cadd(A_M, m); cadd(A_H, m * S.H[p]);
				cadd(A_F, m * S.cF[p]); cadd(A_W, m * S.cW[p]); cadd(A_L, m * S.melt[p]);
				tm += m; th += m * S.H[p];
			}
			for (ph = 0; ph < P.PH_N; ph++) {
				invM[ph] = fin(A_PH + 2 * ph);
				invH[ph] = fin(A_PH + 2 * ph + 2 * P.PH_N);
			}
			S.invMTot = fin(A_M); S.invHTot = fin(A_H);
			S.invFTot = fin(A_F); S.invWTot = fin(A_W); S.invLTot = fin(A_L);
			S.invErr = tm > 0 ? Math.abs(tm - S.invMTot) / tm : 0;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = POOL; else window.PTPOOL = POOL;
}());
