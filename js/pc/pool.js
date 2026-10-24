// pc/pool.js — 0.5.0 M1: the parcel pool's transactions, on the new engines' layouts
// (0.5.0-plan.md §3.2). The discipline is 0.3's (js/pt/pool.js is the authority and its
// comment block carries the reasoning); what changes is the ownership: this module does not
// carry a global field list, it is *made* for a caller's SoA descriptor, so HY and SP each
// own their own arrays and the helper only knows the names they gave it.
//
//   admit    take the next slot, zero every declared field, give it a fresh id and a phase
//   move     carry every declared field from one slot to another
//   remove   close a slot by compacting the last active parcel into it
//   split    move a proper fraction of one parcel's mass into a new parcel of another phase
//   separate the equilibrium melt split: host stays exactly solid, child exactly molten
//   carry    move d km2 of material between parcels (or into a fresh one), mixing the rest
//   merge    combine two compatible parcels, keeping the older id
//
// Two rules are non-negotiable because the ledgers depend on them. A removal compacts the
// final active slot into the hole and the moved parcel keeps its id and every field, which
// is why the field list has one owner per engine (config.carry) and why the pool fixture
// fails if a state grows an array the list does not know. And a full pool **defers** a
// transaction and counts it — S.tx.refuse — it never drops a parcel.
//
// Mass is the book and enthalpy is m * H (H is specific, as in 0.3): split divides mass and
// leaves specific state alone, merge mass-weights specific state, carry mixes it into a
// receiver. Each of those is exact in mass and in total enthalpy by construction, which is
// what the fixture checks rather than trusting.
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : root.PCP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : root.PCPHASE;

	// Neumaier compensated accumulation, two doubles per total (running sum, compensation).
	// The pool's stocks mix 1e4 km2 deep parcels with 1e1 km2 surface ones, where a running
	// sum loses the small terms; the closure gates read the compensated reading.
	var ACC = new Float64Array(10 + 4 * PCP.PH_N);
	var A_M = 0, A_H = 2, A_F = 4, A_W = 6, A_L = 8, A_PH = 10;

	function cadd(o, v) {
		var s = ACC[o] + v;
		ACC[o + 1] += Math.abs(ACC[o]) >= Math.abs(v) ? v - (s - ACC[o]) : ACC[o] - (s - v);
		ACC[o] = s;
	}

	function fin(o) { return ACC[o] + ACC[o + 1]; }

	// The default field lists of a 0.5 parcel. An engine passes its own, extending them with
	// whatever its solver carries (SP's warped-plane metric, HY's skin thickness).
	var DEFAULT = {
		// every per-parcel field: the list remove() permutes
		carry: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
			'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph'],
		// intensive state a split shares with its child (mass divides, state does not)
		share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt'],
		// bond state is not shared: the child has no bonds and no age, it changed phase
		bond: ['age', 'mu', 'dmg', 'pLoad', 'pCnt'],
		// 0/1 certificates that combine as a conjunction on merge (0.3's shallow-quench flag)
		all: ['depQ']
	};

	function config(cfg) {
		var out = {}, k, key;
		cfg = cfg || {};
		for (key in DEFAULT) out[key] = DEFAULT[key];
		for (key in cfg) out[key] = cfg[key];
		// a field that is not carried cannot be shared, weighted or combined
		for (k = 0; k < 3; k++) {
			key = k === 0 ? 'share' : (k === 1 ? 'bond' : 'all');
			out[key] = only(out[key], out.carry);
		}
		return out;
	}

	function only(list, carry) {
		var out = [], i;
		for (i = 0; i < list.length; i++) if (carry.indexOf(list[i]) >= 0) out.push(list[i]);
		return out;
	}

	function has(S, name) { return name in S; }

	var POOL = {
		DEFAULT: DEFAULT,

		// Build a pool for one engine's layout. The returned object is the only thing the
		// engine calls; it caches the resolved arrays against S.x so a name is not looked up
		// per parcel in the frame loop.
		make: function (cfg) {
			var C = config(cfg);

			var pool = {
				config: C,
				invN: new Float64Array(PCP.PH_N),
				invM: new Float64Array(PCP.PH_N),
				invH: new Float64Array(PCP.PH_N),
				// mass, enthalpy, felsic, water and melt stock; the compensated totals
				inv: { m: 0, h: 0, f: 0, w: 0, l: 0, err: 0 },

				// one-time bookkeeping an engine calls from its init/reset; returns the state
				// so the call reads as `S = pool.attach(S)` in a fixture
				attach: function (S) {
					if (!S.tx) S.tx = { admit: 0, move: 0, split: 0, separate: 0,
						carry: 0, merge: 0, refuse: 0 };
					S.nextId = S.nextId === undefined ? 1 : S.nextId;
					return S;
				},

				_fld: null, _gen: null,
				fields: function (S) {
					var k, f;
					if (this._gen === S.x) return this._fld;
					f = new Array(C.carry.length);
					for (k = 0; k < C.carry.length; k++) {
						if (!has(S, C.carry[k])) throw new Error('pool field missing: ' + C.carry[k]);
						f[k] = S[C.carry[k]];
					}
					this._fld = f; this._gen = S.x;
					return f;
				},

				room: function (S) { return S.cap - S.n; },

				// the next free slot, or -1 when the pool is full. The slot is zeroed field by
				// field so an admitted parcel never inherits its predecessor's state, and its
				// id is fresh: ids are never reused, which makes a merge's surviving id a
				// history rather than a coincidence.
				admit: function (S, ph) {
					if (S.n >= S.cap) { S.tx.refuse++; return -1; }
					var p = S.n, f = this.fields(S), k;
					for (k = 0; k < f.length; k++) f[k][p] = 0;
					S.id[p] = S.nextId++;
					S.ph[p] = ph;
					S.n = p + 1;
					S.tx.admit++;
					return p;
				},

				move: function (S, dst, src) {
					var f = this.fields(S), k;
					for (k = 0; k < f.length; k++) f[k][dst] = f[k][src];
				},

				// close slot p: the last active parcel takes its place and the prefix stays
				// dense. The vacated slot is zeroed, so nothing lives past S.n and a stale
				// tail cannot be mistaken for material by a pass that got its bound wrong.
				remove: function (S, p) {
					var last = S.n - 1, f = this.fields(S), k;
					S.n = last;
					if (p !== last) {
						for (k = 0; k < f.length; k++) f[k][p] = f[k][last];
						S.tx.move++;
					}
					for (k = 0; k < f.length; k++) f[k][last] = 0;
				},

				// split a proper fraction of p into a new parcel of phase ph. Intensive state is
				// shared, extensive state (mass, so momentum and total enthalpy) divides, and
				// the host keeps its id: the child is material that left the host, not a rename
				// of it. A full pool defers the split and counts it; the mass stays in the host.
				split: function (S, p, frac, ph) {
					if (!(frac > 0) || !(frac < 1)) { S.tx.refuse++; return -1; }
					var q = this.admit(S, ph), mq, i, name;
					if (q < 0) return -1;
					mq = S.m[p] * frac;
					S.m[p] -= mq; S.m[q] = mq;
					for (i = 0; i < C.share.length; i++) {
						name = C.share[i];
						if (name !== 'm') S[name][q] = S[name][p];
					}
					S.tx.split++;
					return q;
				},

				// The equilibrium melt split (0.3 P3.2): host keeps its unmelted mass exactly at
				// its solidus and the child takes the melt mass at the liquidus, carrying the
				// enthalpy that makes m * H close. Both children land on the equilibrium
				// manifold, so the next phase pass reads them back unchanged and books nothing:
				// a split moves material, it does not melt it. A full pool defers.
				separate: function (S, p, load) {
					var xi = S.melt[p], q, m, ts;
					if (!(xi > 0) || !(xi < 1)) return -1;
					q = this.admit(S, PCP.PH.melt);
					if (q < 0) return -1;
					m = S.m[p];
					ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p], load);
					S.m[q] = m * xi;
					S.m[p] = m - S.m[q];
					S.x[q] = S.x[p]; S.y[q] = S.y[p]; S.e[q] = S.e[p];
					if (has(S, 'vx')) { S.vx[q] = S.vx[p]; S.vy[q] = S.vy[p]; }
					S.cF[q] = S.cF[p]; S.cW[q] = S.cW[p];
					S.T[p] = ts; S.H[p] = ts; S.melt[p] = 0;
					S.H[q] = ts + PCP.meltGap + PCP.meltLat;
					PHASE.byH(S.H[q], S.y[q], S.cF[q], S.cW[q], load);
					S.T[q] = PHASE.out.t; S.melt[q] = PHASE.out.melt;
					S.tx.separate++;
					return q;
				},

				// A transport transaction: d km2 of src's material — mass, enthalpy, melt and
				// composition together — moves into dst, or into a fresh parcel of phase ph
				// when dst < 0 (the caller places it). Either way the pair's totals are
				// unchanged, so the inventory cannot see the transfer. A whole parcel is not a
				// transfer (the donor keeps a floor). A full pool defers; nothing is dropped.
				carry: function (S, src, dst, d, ph) {
					var m = S.m[src], f, q;
					if (!(d > 0) || !(d < m)) return -1;
					if (dst >= 0) {
						f = d / (S.m[dst] + d);
						S.H[dst] += f * (S.H[src] - S.H[dst]);
						S.cF[dst] += f * (S.cF[src] - S.cF[dst]);
						S.cW[dst] += f * (S.cW[src] - S.cW[dst]);
						if (has(S, 'melt')) S.melt[dst] += f * (S.melt[src] - S.melt[dst]);
						S.m[dst] += d;
						if (has(S, 'depQ') && S.ph[dst] === PCP.PH.dep) {
							S.depQ[dst] = S.depQ[dst] && S.depQ[src] ? 1 : 0;
						}
					} else {
						q = this.admit(S, ph);
						if (q < 0) return -1;
						S.T[q] = S.T[src]; S.H[q] = S.H[src]; S.melt[q] = S.melt[src];
						S.cF[q] = S.cF[src]; S.cW[q] = S.cW[src];
						if (has(S, 'depQ') && ph === PCP.PH.dep) S.depQ[q] = S.depQ[src];
						S.m[q] = d;
						dst = q;
					}
					S.m[src] = m - d;
					S.tx.carry++;
					return dst;
				},

				// A merge is a material operation, so a matching phase is not enough: unlike
				// compositions stay separate parcels. The tolerances are settings because the
				// landed batches need a reproducible compatibility rule.
				compatible: function (S, a, b) {
					return a !== b && S.ph[a] === S.ph[b]
						&& Math.abs(S.cF[a] - S.cF[b]) <= PCP.mergeCompF
						&& Math.abs(S.cW[a] - S.cW[b]) <= PCP.mergeCompW;
				},

				// combine a and b into a, then close b's slot: mass and momentum sum, intensive
				// state is mass weighted, the survivor keeps the older id. x is weighted through
				// the periodic delta folded into [-wrap/2, wrap/2), so a pair straddling the seam
				// stays one body. Pair-load scratch is reset: the next pass rebuilds it.
				merge: function (S, a, b) {
					var ma, mb, mt, w, dx, out = a, last, i, name, wrap = S.wrap;
					if (!this.compatible(S, a, b)) { S.tx.refuse++; return -1; }
					ma = S.m[a]; mb = S.m[b]; mt = ma + mb;
					if (!(mt > 0)) { S.tx.refuse++; return -1; }
					w = mb / mt;
					dx = S.x[b] - S.x[a];
					dx -= Math.floor(dx / wrap + 0.5) * wrap;
					for (i = 0; i < C.share.length; i++) {
						name = C.share[i];
						if (name === 'x') continue;
						S[name][a] += w * (S[name][b] - S[name][a]);
					}
					for (i = 0; i < C.bond.length; i++) {
						name = C.bond[i];
						S[name][a] += w * (S[name][b] - S[name][a]);
					}
					for (i = 0; i < C.all.length; i++) {
						name = C.all[i];
						S[name][a] = S[name][a] && S[name][b] ? 1 : 0;
					}
					S.x[a] += w * dx;
					if (S.x[a] < 0) S.x[a] += wrap; else if (S.x[a] >= wrap) S.x[a] -= wrap;
					S.m[a] = mt;
					if (has(S, 'pLoad')) { S.pLoad[a] = 0; S.pCnt[a] = 0; }
					if (S.id[b] < S.id[a]) S.id[a] = S.id[b];
					// if a occupied the tail, remove(b) compacts that survivor into b: return
					// its actual slot so a caller never receives the cleared tail index
					last = S.n - 1;
					this.remove(S, b);
					if (a === last) out = b;
					S.tx.merge++;
					return out;
				},

				// The stock side of the ledger, compensated, one pass: per-phase counts, mass
				// and total enthalpy, plus mass, enthalpy, felsic, water and melt stock. inv.err
				// is what a naive running sum would have lost, so a red ledger is not mistaken
				// for a red sum.
				inventory: function (S) {
					var n = S.n, p, ph, m, h, tm = 0, i;
					var inv = this.inv, invM = this.invM, invH = this.invH, invN = this.invN;
					ACC.fill(0);
					for (i = 0; i < PCP.PH_N; i++) { invN[i] = 0; invM[i] = 0; invH[i] = 0; }
					for (p = 0; p < n; p++) {
						ph = S.ph[p]; m = S.m[p]; h = m * S.H[p];
						invN[ph]++; invM[ph] += m; invH[ph] += h;
						cadd(A_PH + 2 * ph, m);
						cadd(A_PH + 2 * PCP.PH_N + 2 * ph, h);
						cadd(A_M, m); cadd(A_H, h);
						cadd(A_F, m * S.cF[p]); cadd(A_W, m * S.cW[p]); cadd(A_L, m * S.melt[p]);
						tm += m;
					}
					for (i = 0; i < PCP.PH_N; i++) {
						invM[i] = fin(A_PH + 2 * i);
						invH[i] = fin(A_PH + 2 * PCP.PH_N + 2 * i);
					}
					inv.m = fin(A_M); inv.h = fin(A_H);
					inv.f = fin(A_F); inv.w = fin(A_W); inv.l = fin(A_L);
					inv.err = tm > 0 ? Math.abs(tm - inv.m) / tm : 0;
					return inv;
				}
			};

			return pool;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = POOL;
	else root.PCPOOL = POOL;
}(typeof window !== 'undefined' ? window : this));
