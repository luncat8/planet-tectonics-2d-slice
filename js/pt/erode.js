// pt/erode.js — 0.3.0 P4.3: particle weathering, erosion and sedimentation
// (0.3.0-p4-plan.md §3 P4.3).
//
// P2.3's profile diffusion moves the drawn horizon `zh` and nothing else: it conserves the
// profile's mean, it moves no marker and it creates no sediment (0.3.0-plan.md §4.5). This
// pass is the material law that stands beside it. Solid parcels in the weathering band
// (`y <= P.eroBand`) are eroded, carried down the drainage the profile's own slope field
// defines, and credited as deposit-phase parcels at the first reach where the water slows down
// or at the basin the path ends in. Every leg is a pool transaction (pool.js `carry`): mass,
// enthalpy, melt and composition move together, so S.invMTot / invHTot / invFTot / invWTot /
// invLTot are invariant to round-off and the pair's books (thr.eroDr/eroCr) are throughput,
// never stock. The sediment is the P3 deposit phase -- the same material phase flight.js lands
// ejecta into -- so the inventory counts it once and the renderer already draws it. Every credit
// lands in a deposit parcel by construction, and thr.eroDep counts what the pass took back *out*
// of one (a deposit with a slope under it is loose material, not rock), which is what keeps the
// deposit phase's identity exact with the surface law running:
//   invM[dep] = thr.landCr + thr.eroCr - thr.eroDep.
//
// The law is the runoff/stream-power rule P4.3 chose by comparison
// (experiments/pt-p4-transport-sweep.js):
//
//   E_i = kStream * sqrt(A_i) * |slope_i|        km/Myr, capped at eroMax
//
// where A_i is the drainage area accumulated into column i along the steepest-descent receiver
// map and slope_i is the profile's own gradient there. Erosion therefore concentrates where
// the drainage accumulates, and the trunk of a catchment carries a catchment's worth of
// material instead of a neighbour's. One frame's demand is E_i * dt * dx km2 (km of column
// width, unit out-of-plane depth). The hillslope alternative -- a face flux proportional to
// the gradient, one column per hop -- is the sweep's other candidate; it is not shipped, and
// the sweep's own file keeps both laws' measurements side by side.
//
// Order inside the frame: G7, after `F.surface`, so the terrain a frame erodes is the profile
// that frame just relaxed (0.3.0-p4-plan.md §2). Three steps:
//
//   route   per-column face slope and steepest-descent receiver (a strict drop, so the map
//           cannot cycle), the drainage area that map accumulates (a topological peel, no
//           allocation), each column's deposition site (the first reach on its path whose
//           gradient is below `eroSlopeDep`, or the sink the path ends in), the donor buckets
//           (every solid parcel above the band, grouped by column) and the site's own deposit
//           parcel when it has one.
//   law     the shipped demand table: one column's mass this frame. A sink gets none -- a lake
//           floor is where material arrives, not where it leaves.
//   move    the transfers: from each column with a demand, take `min(demand, eroTake * m,
//           m - eroMinM)` from its shallowest donor that is not the parcel the material is
//           about to land in, and credit the site. Each credit re-reads PHASE.byH at the
//           receiving parcel's own depth and books the sensible change in S.ledger, so the
//           P3.1 latent identity holds across the pass.
//
// Determinism. Every step is a function of the pool order and the column index: the demand
// table is recomputed from scratch, the receiver map is strictly downhill so a path cannot
// cycle, the depot book is rebuilt from the pool before the transfers start (a deposit this
// frame admitted cannot be eroded by it), and the donor scan is a total order on (depth, slot)
// with the spent donors marked in the bucket. The only carried state is the counters
// (tx.ero, thr.eroDr/eroCr/eroDep, S.eroShort), and they are in the fingerprint.
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTERODE.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;

	// the receiving parcel's seat: the site column's own node (the same column map the bucket,
	// the depot book and the donor scan use -- a half-cell offset would round into the next
	// column and the site would lose the parcel it just admitted), on the drawn horizon (the
	// same datum flight.js lands on), bond-free like landed material -- admit() already zeroed
	// the age, strength and damage a fresh parcel carries.
	function place(M, S, q, site) {
		var y = -S.zh[site];
		S.x[q] = site * M.dx;
		S.y[q] = y; S.e[q] = Math.asinh(y / M.yLin);
		S.vx[q] = 0; S.vy[q] = 0;
	}

	var ERODE = {
		// G7's tail. No-op at dt = 0 like every geological kernel; when the pass is disabled the
		// per-frame diagnostics are cleared so a step never reports the previous frame's census.
		run: function (M, S, dt) {
			if (!(dt > 0) || !S.n) return;
			if (!P.ero) {
				S.d.ero = 0; S.d.eroM = 0; S.d.eroWant = 0; S.d.eroNew = 0;
				return;
			}
			this.route(M, S);
			this.law(M, S, dt);
			this.move(M, S);
		},

		// the terrain the law reads and the population it erodes, both rebuilt from scratch
		route: function (M, S) {
			var nx = M.nx, dx = M.dx, invDx = 1 / M.dx;
			var zh = S.zh, erS = S.erS, erR = S.erR, erA = S.erA, erD = S.erD;
			var erSite = S.erSite, erDep = S.erDep, erIn = S.erIn, erStack = S.erStack;
			var erTop = S.erTop, erList = S.erList;
			var ph = S.ph, y = S.y, sol = P.PH_SOLID, dep = P.PH.dep, band = P.eroBand;
			var i, p, q, ip, im, dr, dl, top, site;
			// face slope to the right and the steepest-descent receiver. The right neighbour
			// wins an exact tie, a relative rule that survives a whole-cell shift of the
			// initial condition the way pt-wrap's equivariance gate reads it.
			for (i = 0; i < nx; i++) {
				ip = i + 1 === nx ? 0 : i + 1;
				im = i === 0 ? nx - 1 : i - 1;
				erS[i] = (zh[ip] - zh[i]) * invDx;
				erR[i] = -1; erSite[i] = -1; erD[i] = 0; erDep[i] = -1;
				dr = zh[i] - zh[ip]; dl = zh[i] - zh[im];
				if (dr > 0 && dr >= dl) erR[i] = ip; else if (dl > 0) erR[i] = im;
			}
			// drainage area: every column is its own source, accumulated downstream in
			// topological order. A column flows into exactly one receiver and strictly downhill,
			// so peeling the columns with no inflow visits every path from its source down.
			for (i = 0; i < nx; i++) { erA[i] = dx; erIn[i] = 0; }
			for (i = 0; i < nx; i++) if (erR[i] >= 0) erIn[erR[i]]++;
			top = 0;
			for (i = 0; i < nx; i++) if (erR[i] >= 0 && erIn[i] === 0) erStack[top++] = i;
			while (top > 0) {
				i = erStack[--top];
				q = erR[i];
				erA[q] += erA[i];
				if (--erIn[q] === 0) erStack[top++] = q;
			}
			// the deposition site of a column: the first reach its path crosses whose own
			// gradient has fallen below eroSlopeDep -- the water slows, the sediment settles --
			// or the sink the path ends in. Sinks are sites, never sources (law below).
			for (i = 0; i < nx; i++) {
				site = i;
				for (;;) {
					if (Math.abs(erS[site]) < P.eroSlopeDep) break;
					q = erR[site];
					if (q < 0) break;
					site = q;
				}
				erSite[i] = site;
			}
			// the donor buckets: solid parcels in the weathering band, grouped by column. A
			// counting sort -- counts, then offsets, then one placement pass -- costs two walks
			// over the pool and no comparison, and the transfers pick the shallowest donor of a
			// column themselves, so no per-column sort is paid for here.
			for (i = 0; i <= nx; i++) erTop[i] = 0;
			for (p = 0; p < S.n; p++) {
				if (!sol[ph[p]] || y[p] > band) continue;
				i = Math.round(S.x[p] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				erTop[i + 1]++;
			}
			for (i = 0; i < nx; i++) erTop[i + 1] += erTop[i];
			for (i = 0; i < nx; i++) erIn[i] = erTop[i];
			for (p = 0; p < S.n; p++) {
				// the two walks must agree on the column map or a bucket would overrun another
				if (!sol[ph[p]] || y[p] > band) continue;
				i = Math.round(S.x[p] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				erList[erIn[i]++] = p;
			}
			// the site's own deposit parcel, when it has one: the seat a frame's sediment is
			// credited into before a fresh parcel is admitted. Lowest slot wins, so the choice
			// is a function of the pool's order and not of the walk's luck.
			for (p = 0; p < S.n; p++) {
				if (ph[p] !== dep) continue;
				i = Math.round(S.x[p] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				if (erDep[i] < 0) erDep[i] = p;
			}
		},

		// the shipped law: one column's mass this frame, km2. A sink is a lake floor -- the
		// drainage ends there, so it is a site and not a source -- and a flat reach erodes
		// nothing, which is what makes the profile's own basins depositional.
		law: function (M, S, dt) {
			var nx = M.nx, dx = M.dx, k = P.kStream, cap = P.eroMax;
			var erA = S.erA, erS = S.erS, erR = S.erR, erD = S.erD;
			var i, e, s;
			for (i = 0; i < nx; i++) {
				if (erR[i] < 0) { erD[i] = 0; continue; }
				s = erS[i] < 0 ? -erS[i] : erS[i];
				if (!(s > 0)) { erD[i] = 0; continue; }
				e = k * Math.sqrt(erA[i]) * s;
				if (e > cap) e = cap;
				erD[i] = e * dt * dx;
			}
		},

		// the transfers. One walk of the demand table; the pool's order decides the donors, so
		// the pass is deterministic without a sort, and a spent donor is marked in the bucket
		// it came from -- one take per parcel per frame, which is what eroTake says.
		move: function (M, S) {
			var nx = M.nx;
			var erD = S.erD, erSite = S.erSite, erDep = S.erDep, erTop = S.erTop, erList = S.erList;
			var ph = S.ph, y = S.y, m = S.m, T = S.T, H = S.H, cF = S.cF, cW = S.cW, ml = S.melt;
			var takeF = P.eroTake, floor = P.eroMinM, dep = P.PH.dep;
			var i, k, lo, hi, p, src, recv, site, q, want, take, yBest, pBest, kBest;
			var found, n = 0, moved = 0, want0 = 0, fresh = 0, led = 0, m0, t0, t1;
			for (i = 0; i < nx; i++) {
				want = erD[i];
				if (!(want > 0)) continue;
				site = erSite[i];
				recv = erDep[site];
				lo = erTop[i]; hi = erTop[i + 1];
				if (lo >= hi) { want0 += want; continue; }        // the band is spent already
				while (want > 0) {
					// the shallowest donor left in this column that is not the parcel the
					// material is about to land in. The comparison is a total order on
					// (depth, slot), so the walk is deterministic whatever the pool's order.
					found = 0; yBest = 0; pBest = -1; kBest = -1;
					for (k = lo; k < hi; k++) {
						p = erList[k];
						if (p < 0 || p === recv) continue;
						if (!found || y[p] < yBest || (y[p] === yBest && p < pBest)) {
							found = 1; yBest = y[p]; pBest = p; kBest = k;
						}
					}
					if (!found) { want0 += want; break; }
					src = pBest;
					take = want;
					if (take > takeF * m[src]) take = takeF * m[src];
					if (take > m[src] - floor) take = m[src] - floor;
					erList[kBest] = -1;                           // one take per donor per frame
					if (!(take > 0)) continue;                    // at the floor: the next donor
					m0 = recv >= 0 ? m[recv] : 0; t0 = recv >= 0 ? T[recv] : 0;
					t1 = T[src];
					q = POOL.carry(S, src, recv, take, dep);
					if (q < 0) { want0 += want; break; }          // a full pool defers the rest
					if (recv < 0) { place(M, S, q, site); recv = q; erDep[site] = q; fresh++; }
					// the manifold reading at the receiving parcel's own depth and composition,
					// and the sensible change the two parcels booked between them: the donor
					// lost `take` at its own temperature, the receiver's total went from
					// m0*T0 to m'*T'. That sum is exactly -meltLat * d(invLTot), which is what
					// keeps the P3.1 latent identity true across the pass.
					PHASE.byH(H[q], y[q], cF[q], cW[q]);
					T[q] = PHASE.out.t; ml[q] = PHASE.out.melt;
					led += m[q] * T[q] - m0 * t0 - take * t1;
					want -= take; n++; moved += take;
				}
			}
			S.ledger += led;
			S.d.ero = n; S.d.eroM = moved; S.d.eroWant = want0; S.d.eroNew = fresh;
			S.eroShort += want0;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = ERODE; else window.PTERODE = ERODE;
}());
