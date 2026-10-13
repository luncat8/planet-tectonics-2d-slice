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
//   recycle  P4.1's transfer out of the plate population: a slab parcel that reached the deep
//            inventory's boundary credits a deep record and closes its slot
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
	// the phase law: the equilibrium split puts its two children exactly on the law's own
	// solidus/liquidus, so it needs the curve the law owns (phase.js loads first)
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;

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

	// one reservoir record's stock (a chamber or a vent), compensated, into the totals
	function stock(m, h, f, w, l) {
		cadd(A_M, m); cadd(A_H, h); cadd(A_F, f); cadd(A_W, w); cadd(A_L, l);
	}

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
			'csR2', 'csS', 'csP', 'csRef', 'csCnt',
			// P4.0's own (contact.js): the brake's demanded correction and the count it is a mean
			// over, and the bending band's target velocity and flag
			'csBX', 'csBN', 'hinge', 'hvx', 'hvy',
			// P4.3's donor bucket (erode.js): parcel slots per column, rebuilt every frame
			'erList'],

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

		// P3.2's equilibrium melt split (0.3.0-p3-plan.md §4 P3.2): a mushy parcel separates
		// into the two pure phases its own law already names. The host keeps its unmelted
		// mass at its solidus, exactly solid; the child takes the melt mass at the liquidus,
		// exactly molten, and carries the enthalpy that makes m*H close. This is the unique
		// separation that leaves both children on the equilibrium manifold -- the next phase
		// pass reads them back with zero change and books nothing into the sensible ledger,
		// which is the identity P3.1 gated across a split: a split moves material, it does
		// not melt it. The child's T and melt are snapped to the law's own reading of its H
		// so the snap is bitwise-quiet under the next equilibrium pass. A full pool defers
		// and counts; the phase fraction stays in its source parcel and tries again.
		separate: function (S, p) {
			var xi = S.melt[p], q, m, ts;
			if (!(xi > 0) || !(xi < 1)) return -1;      // pure phase: nothing to separate
			// admit counts a capacity refusal itself; this is one event, not two
			q = this.admit(S, P.PH.melt);
			if (q < 0) return -1;
			m = S.m[p];
			ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p]);
			S.m[q] = m * xi;
			S.m[p] = m - S.m[q];
			S.x[q] = S.x[p]; S.y[q] = S.y[p]; S.e[q] = S.e[p];
			S.vx[q] = S.vx[p]; S.vy[q] = S.vy[p];
			S.cF[q] = S.cF[p]; S.cW[q] = S.cW[p];
			S.T[p] = ts; S.H[p] = ts; S.melt[p] = 0;
			S.H[q] = ts + P.meltGap + P.meltLat;
			PHASE.byH(S.H[q], S.y[q], S.cF[q], S.cW[q]);
			S.T[q] = PHASE.out.t; S.melt[q] = PHASE.out.melt;
			S.tx.split++;
			S.thr.seg += S.m[q];
			return q;
		},

		// P3.2's intrusion (0.3.0-p3-plan.md §4 P3.2): a melt parcel reaching the chamber
		// depth transfers its whole stock into a chamber record -- mass, enthalpy, melt and
		// composition move and the parcel slot closes, so the transfer is internal to the
		// inventory either way. Two intrusions within chJoin of each other share one record
		// (a chamber is one body of emplaced melt, not one parcel's worth) and the record's
		// position is the mass-weighted mean of what it has eaten. A full record set defers
		// the transfer and counts it: the melt stays in the pool, nothing is dropped.
		intrude: function (M, S, p) {
			var x = S.x[p], best = -1, bd = P.chJoin, k, dx, w, m = S.m[p];
			for (k = 0; k < S.chN; k++) {
				dx = S.chX[k] - x;
				dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
				if (Math.abs(dx) < bd) { bd = Math.abs(dx); best = k; }
			}
			if (best < 0) {
				if (S.chN >= P.chCap) { S.tx.refuse++; return -1; }
				best = S.chN++;
				S.chX[best] = x; S.chY[best] = S.y[p];
			} else {
				w = m / (S.chM[best] + m);
				dx = x - S.chX[best];
				dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
				S.chX[best] += w * dx;
				if (S.chX[best] < 0) S.chX[best] += M.wrap; else if (S.chX[best] >= M.wrap) S.chX[best] -= M.wrap;
				S.chY[best] += w * (S.y[p] - S.chY[best]);
			}
			S.chM[best] += m;
			S.chH[best] += m * S.H[p];
			S.chL[best] += m * S.melt[p];
			S.chF[best] += m * S.cF[p];
			S.chW[best] += m * S.cW[p];
			this.remove(S, p);
			S.tx.intrude++;
			S.thr.intrDr += m; S.thr.intrCr += m;
			return best;
		},

		// P4.1's deep recycling (0.3.0-p4-plan.md §3 P4.1): a slab parcel that reached
		// P.yDeep transfers its whole stock into a deep record -- mass, enthalpy, melt and
		// composition move and the parcel slot closes, so the transfer is internal to the
		// inventory either way and the ledger cannot see it as a leak. It is intrude's rule at
		// the bottom of the mantle: two arrivals within deepJoin of each other share one
		// record (a record is one pile of recycled material, not one parcel's worth) and its
		// position is the mass-weighted mean of what it has eaten. A full record set defers the
		// transfer and counts the deferral: the slab waits at the boundary, nothing is dropped.
		recycle: function (M, S, p) {
			var x = S.x[p], best = -1, bd = P.deepJoin, k, dx, w, m = S.m[p];
			for (k = 0; k < S.dpN; k++) {
				dx = S.dpX[k] - x;
				dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
				if (Math.abs(dx) < bd) { bd = Math.abs(dx); best = k; }
			}
			if (best < 0) {
				if (S.dpN >= P.deepCap) { S.tx.refuse++; return -1; }
				best = S.dpN++;
				S.dpX[best] = x; S.dpY[best] = S.y[p];
			} else {
				w = m / (S.dpM[best] + m);
				dx = x - S.dpX[best];
				dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
				S.dpX[best] += w * dx;
				if (S.dpX[best] < 0) S.dpX[best] += M.wrap; else if (S.dpX[best] >= M.wrap) S.dpX[best] -= M.wrap;
				S.dpY[best] += w * (S.y[p] - S.dpY[best]);
			}
			S.dpM[best] += m;
			S.dpH[best] += m * S.H[p];
			S.dpL[best] += m * S.melt[p];
			S.dpF[best] += m * S.cF[p];
			S.dpW[best] += m * S.cW[p];
			// the phase has to be read before remove(): the removal compacts the pool's
			// tail into this slot, and the slot then names a different parcel
			var dep = S.ph[p] === P.PH.dep;
			this.remove(S, p);
			S.tx.recycle++;
			S.thr.deepDr += m; S.thr.deepCr += m;
			// the debit side of a recycling is mantle unless the parcel was sediment: the
			// slab pass drives any detached cold lithosphere below yDeep, and subducted
			// sediment is exactly that. Counting the phase apart is what keeps the deposit
			// inventory's identity exact at the integrated scale (P4.4's 300 Myr leg found
			// the gap):
			//   invM[dep] = thr.landCr + thr.eroCr - thr.eroDep - thr.deepDep
			if (dep) S.thr.deepDep += m;
			return best;
		},

		// P4.3's transport transaction (erode.js): `d` km2 of src's material -- mass, enthalpy,
		// melt and composition together -- moves into dst, or into a freshly admitted parcel of
		// phase `ph` when dst < 0 (the caller places it). Either way the pair's totals are
		// unchanged, so the inventory cannot see the transfer, and thr.eroDr/eroCr book both
		// sides. It is split's and merge's rule at a different granularity: a whole parcel is
		// not a transfer (the donor keeps a floor), and the arithmetic is the mass-weighted
		// mixing merge already uses. A fresh parcel is bond-free like landed material -- it is
		// a deposit that has just settled, not a parcel that was carried. A full pool defers
		// the transaction and counts the refusal: the material stays in src, nothing is dropped.
		carry: function (S, src, dst, d, ph) {
			var m = S.m[src], f, q;
			if (!(d > 0) || !(d < m)) return -1;
			if (dst >= 0) {
				f = d / (S.m[dst] + d);
				S.H[dst] += f * (S.H[src] - S.H[dst]);
				S.cF[dst] += f * (S.cF[src] - S.cF[dst]);
				S.cW[dst] += f * (S.cW[src] - S.cW[dst]);
				S.m[dst] += d;
			} else {
				q = this.admit(S, ph);
				if (q < 0) return -1;
				S.T[q] = S.T[src]; S.H[q] = S.H[src]; S.melt[q] = S.melt[src];
				S.cF[q] = S.cF[src]; S.cW[q] = S.cW[src];
				S.m[q] = d;
				dst = q;
			}
			S.m[src] = m - d;
			S.tx.ero++; S.thr.eroDr += d; S.thr.eroCr += d;
			// the credit side of every erode transfer is a deposit parcel; the debit side is
			// rock unless the donor was itself sediment. Counting that apart is what lets the
			// deposit inventory's identity stay exact with the surface law running (recycle()
			// books the phase's third debit the same way):
			//   invM[dep] = thr.landCr + thr.eroCr - thr.eroDep - thr.deepDep
			if (S.ph[src] === P.PH.dep) S.thr.eroDep += d;
			return dst;
		},

		// A merge is a material operation, so matching a transport phase is not enough: unlike
		// compositions remain separate parcels. The tolerances are settings because P3.4's
		// landed batches need a reproducible, captureable compatibility rule.
		compatible: function (S, a, b) {
			return a !== b && S.ph[a] === S.ph[b]
				&& Math.abs(S.cF[a] - S.cF[b]) <= P.mergeCompF
				&& Math.abs(S.cW[a] - S.cW[b]) <= P.mergeCompW;
		},

		// combine a and b into a, then close b's slot. Mass, momentum and enthalpy sum;
		// composition, melt fraction, bond state and position are mass weighted; the survivor
		// keeps the older id. x is weighted through the periodic delta folded into
		// [-wrap/2, wrap/2), so a pair straddling the seam remains one body. y and e are
		// weighted separately because both are carried state. Pair-load scratch is reset: the
		// next crust pass rebuilds it from the merged parcel's actual neighbours.
		merge: function (M, S, a, b) {
			var ma, mb, mt, w, dx, out = a, last;
			if (!this.compatible(S, a, b)) { S.tx.refuse++; return -1; }
			ma = S.m[a]; mb = S.m[b]; mt = ma + mb;
			if (!(mt > 0)) { S.tx.refuse++; return -1; }
			w = mb / mt;
			dx = S.x[b] - S.x[a];
			dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
			S.vx[a] += w * (S.vx[b] - S.vx[a]);
			S.vy[a] += w * (S.vy[b] - S.vy[a]);
			S.H[a] += w * (S.H[b] - S.H[a]);
			S.T[a] += w * (S.T[b] - S.T[a]);
			S.cF[a] += w * (S.cF[b] - S.cF[a]);
			S.cW[a] += w * (S.cW[b] - S.cW[a]);
			S.melt[a] += w * (S.melt[b] - S.melt[a]);
			S.age[a] += w * (S.age[b] - S.age[a]);
			S.mu[a] += w * (S.mu[b] - S.mu[a]);
			S.dmg[a] += w * (S.dmg[b] - S.dmg[a]);
			S.x[a] += w * dx;
			if (S.x[a] < 0) S.x[a] += M.wrap; else if (S.x[a] >= M.wrap) S.x[a] -= M.wrap;
			S.y[a] += w * (S.y[b] - S.y[a]);
			S.e[a] += w * (S.e[b] - S.e[a]);
			S.m[a] = mt; S.pLoad[a] = 0; S.pCnt[a] = 0;
			if (S.id[b] < S.id[a]) S.id[a] = S.id[b];
			// If a occupied the tail, remove(b) compacts that survivor into b. Return its
			// actual slot so callers never receive the cleared tail index.
			last = S.n - 1;
			this.remove(S, b);
			if (a === last) out = b;
			S.tx.merge++;
			return out;
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
			// the chambers are stock too (P3 plan §1.2): reservoir mass sums into the same
			// totals exactly once, or an intrusion would read as a leak
			// a record's stock is its chamber's and its vent's: both are reservoirs, both count once
			var cm = 0, cl = 0, cw = 0, vm = 0, vl = 0, vw = 0, dm = 0, dl = 0, dw = 0;
			for (p = 0; p < S.chN; p++) {
				cm += S.chM[p]; cl += S.chL[p]; cw += S.chW[p];
				vm += S.vM[p]; vl += S.vL[p]; vw += S.vW[p];
				tm += S.chM[p] + S.vM[p]; th += S.chH[p] + S.vH[p];
				tf += S.chF[p] + S.vF[p]; tw += S.chW[p] + S.vW[p]; tl += S.chL[p] + S.vL[p];
			}
			// the deep inventory (P4.1): recycled slab material is still in the world, so it
			// is stock exactly once, the same rule the chambers and the vent schedules have
			for (p = 0; p < S.dpN; p++) {
				dm += S.dpM[p]; dl += S.dpL[p]; dw += S.dpW[p];
				tm += S.dpM[p]; th += S.dpH[p];
				tf += S.dpF[p]; tw += S.dpW[p]; tl += S.dpL[p];
			}
			S.invChM = cm; S.invChL = cl; S.invChW = cw;
			S.invVM = vm; S.invVL = vl; S.invVW = vw;
			S.invDpM = dm; S.invDpL = dl; S.invDpW = dw;
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
			S.invChM = 0; S.invChL = 0; S.invChW = 0;
			S.invVM = 0; S.invVL = 0; S.invVW = 0;
			S.invDpM = 0; S.invDpL = 0; S.invDpW = 0;
			for (p = 0; p < S.chN; p++) {
				stock(S.chM[p], S.chH[p], S.chF[p], S.chW[p], S.chL[p]);
				stock(S.vM[p], S.vH[p], S.vF[p], S.vW[p], S.vL[p]);
				tm += S.chM[p] + S.vM[p]; th += S.chH[p] + S.vH[p];
				S.invChM += S.chM[p]; S.invChL += S.chL[p]; S.invChW += S.chW[p];
				S.invVM += S.vM[p]; S.invVL += S.vL[p]; S.invVW += S.vW[p];
			}
			for (p = 0; p < S.dpN; p++) {
				stock(S.dpM[p], S.dpH[p], S.dpF[p], S.dpW[p], S.dpL[p]);
				tm += S.dpM[p]; th += S.dpH[p];
				S.invDpM += S.dpM[p]; S.invDpL += S.dpL[p]; S.invDpW += S.dpW[p];
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
