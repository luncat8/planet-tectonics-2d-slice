// pt/arc.js — 0.3.0 P4.2: arc melt from the slab (0.3.0-p4-plan.md §3 P4.2).
//
// P4.1's slab pass drives cold detached lithosphere below yCrust toward the deep boundary, and
// a slab that starts in the hydrated surface skin carries bound water (cW) down with it. Inside
// the slab itself that water does nothing: at P.slabW (0.005) the solidus drops by 0.10, which
// leaves a cold slab (T <= P.slabT = 0.45) well below its own solidus at every depth, so a wet
// slab is still solid rock. Above the slab, the mantle wedge (P.yCham..P.yArcMin) is warm
// enough to sit near its dry solidus, and what it lacks is the water.
//
// This pass sits at the head of G5 (sim.js, ahead of melt.js's detach and transit) and moves a
// fraction of each slab parcel's water into the warm wedge above it while the slab is in the
// dehydration window (P.yArcMin..P.yArcMax):
//
//   wedge    collects the wet slab parcels in the window into S.order, marks the columns within
//            P.arcSpan of them, and fills S.arcP/arcG for those columns with up to P.arcTop warm
//            mantle wedge parcels ordered from smallest solidus gap (Ts - T). Only parcels below
//            P.meltHold are listed: once a wedge parcel reaches the mobile threshold, the very
//            next step in G5 (melt.js detach) separates its melt, so further water from the
//            same column moves on to the next candidate instead of super-saturating one parcel.
//   release  walks the collected slab parcels and transfers min(kArc * dt, arcFrac) of each
//            parcel's water mass into the most fusible wedge candidate within P.arcSpan columns
//            of it. If no warm wedge candidate sits above that column, the water stays in the
//            slab; whatever survives past yArcMax rides the slab down to P.yDeep, where P4.1's
//            recycle() books it into S.dpW.
//
// Conservation. The transfer debits m_p * dcW_p from the slab parcel and credits the same dW to
// the wedge parcel, so total water (S.invWTot) is invariant to round-off and thr.arcDr/arcCr
// book both sides. Neither parcel's enthalpy H changes; re-reading (T, melt) from H through
// phase.js's byH depresses the wedge's solidus by meltWW * dcW, converts sensible heat into
// latent heat on the equilibrium manifold, and books m * dT in S.ledger so the P3.1 identity
// hLedger - ledger = meltLat * (invLTot - invL0) holds across the release. P3.2's segregation,
// P3.3's conduits and P3.4's flight then run unchanged on the melt the depression produced.
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTARC.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;
	var SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.PTSLAB;

	var ARC = {
		nSlab: 0,

		// G5's head, ahead of melt.js. No-op at dt = 0 like every geological kernel; when P.arc
		// is off, the per-frame diagnostics are cleared so a step never reports a stale count.
		run: function (M, S, dt) {
			if (!(dt > 0) || !S.n) return;
			if (!P.arc || !this.wedge(M, S)) {
				S.d.arc = 0; S.d.arcW = 0; S.d.arcM = 0;
				return;
			}
			this.release(M, S, dt);
		},

		// Per-column table of warm, unsegregated mantle wedge parcels in (P.yCham, P.yArcMin],
		// built only for the columns within P.arcSpan of a wet slab parcel in the window
		// (arcN[i] = -1 marks an unreached column, >= 0 its candidate count). Column binning
		// uses Math.round(x / dx) folded into [0, nx), the same integer-cell map grid.js and
		// contact.js use, so a whole-cell shift of the periodic domain permutes columns without
		// changing a single candidate or gap.
		wedge: function (M, S) {
			var nx = M.nx, ny = M.ny, invDx = 1 / M.dx, invDE = 1 / M.dEta;
			var K = P.arcTop, hold = P.meltHold, sol = P.PH_SOLID, plate = P.plateMin;
			var yCham = P.yCham, yMin = P.yArcMin, yMax = P.yArcMax;
			var slabT = P.slabT, slabdT = P.slabdT, mPh = P.PH.mantle;
			var r = Math.round(P.arcSpan * invDx); if (r < 1) r = 1;
			var ph = S.ph, x = S.x, y = S.y, e = S.e, T = S.T, ml = S.melt, cF = S.cF, cW = S.cW;
			var cl = S.cl, csCnt = S.csCnt, Trow = S.Trow, order = S.order;
			var arcP = S.arcP, arcG = S.arcG, arcN = S.arcN, arcC = S.arcC;
			var p, q, i, ii, di, j, c, k, nSlot, base, gap, nSlab = 0, bg = false;
			for (p = 0; p < S.n; p++) {
				if (!(cW[p] > 0) || y[p] <= yMin || y[p] > yMax || T[p] > slabT || !sol[ph[p]]) continue;
				c = cl[p];
				if (c >= 0 && csCnt[c] >= plate) continue;
				if (!bg) { SLAB.background(M, S); arcN.fill(-1); bg = true; }
				j = Math.round(e[p] * invDE);
				if (j > ny) j = ny; else if (j < 1) j = 1;
				if (Trow[j] - T[p] < slabdT) continue;
				order[nSlab++] = p;
				i = Math.round(x[p] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				for (di = -r; di <= r; di++) {
					ii = i + di; if (ii < 0) ii += nx; else if (ii >= nx) ii -= nx;
					if (arcN[ii] < 0) { arcN[ii] = 0; arcC[ii] = 0; }
				}
			}
			this.nSlab = nSlab;
			if (!nSlab) return 0;
			for (q = 0; q < S.n; q++) {
				if (y[q] <= yCham || y[q] > yMin || T[q] <= slabT || ml[q] >= hold || ph[q] !== mPh) continue;
				i = Math.round(x[q] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				nSlot = arcN[i];
				if (nSlot < 0) continue;
				gap = PHASE.solidus(y[q], cF[q], cW[q]) - T[q];
				base = i * K;
				if (nSlot === K && gap >= arcG[base + K - 1]) continue;
				if (nSlot < K) arcN[i] = ++nSlot;
				for (k = nSlot - 1; k > 0 && gap < arcG[base + k - 1]; k--) {
					arcG[base + k] = arcG[base + k - 1];
					arcP[base + k] = arcP[base + k - 1];
				}
				arcG[base + k] = gap; arcP[base + k] = q;
			}
			return nSlab;
		},

		// Dehydration of the slab parcels wedge() collected. Every wedge candidate sits at
		// y <= P.yArcMin, strictly shallower than every slab parcel in S.order, so the transfer
		// is always upward into the overlying wedge.
		release: function (M, S, dt) {
			var nx = M.nx, invDx = 1 / M.dx, K = P.arcTop, grid = P.PH_GRID, hold = P.meltHold;
			var r = Math.round(P.arcSpan * invDx); if (r < 1) r = 1;
			var f = P.kArc * dt; if (f > P.arcFrac) f = P.arcFrac;
			var ph = S.ph, x = S.x, y = S.y, m = S.m, H = S.H, T = S.T, ml = S.melt;
			var cF = S.cF, cW = S.cW, order = S.order, nSlab = this.nSlab;
			var arcP = S.arcP, arcG = S.arcG, arcN = S.arcN, arcC = S.arcC;
			var s, p, i, ii, di, slot, gap, best, bestCol, bestGap, dW, t0, m0;
			var n = 0, wSum = 0, meltSum = 0, dLed = 0;
			for (s = 0; s < nSlab; s++) {
				p = order[s];
				i = Math.round(x[p] * invDx);
				if (i >= nx) i -= nx; else if (i < 0) i += nx;
				best = -1; bestCol = -1; bestGap = 1e9;
				for (di = -r; di <= r; di++) {
					ii = i + di; if (ii < 0) ii += nx; else if (ii >= nx) ii -= nx;
					if (arcC[ii] >= arcN[ii]) continue;
					slot = ii * K + arcC[ii];
					gap = arcG[slot];
					if (gap < bestGap) { bestGap = gap; best = arcP[slot]; bestCol = ii; }
				}
				if (best < 0) continue;
				dW = f * m[p] * cW[p];
				if (!(dW > 0)) continue;
				cW[p] -= dW / m[p];
				cW[best] += dW / m[best];
				t0 = T[p];
				PHASE.byH(H[p], y[p], cF[p], cW[p]);
				T[p] = PHASE.out.t; ml[p] = PHASE.out.melt;
				if (grid[ph[p]] && T[p] !== t0) dLed += m[p] * (T[p] - t0);
				t0 = T[best]; m0 = ml[best];
				PHASE.byH(H[best], y[best], cF[best], cW[best]);
				T[best] = PHASE.out.t; ml[best] = PHASE.out.melt;
				if (grid[ph[best]] && T[best] !== t0) dLed += m[best] * (T[best] - t0);
				if (ml[best] > m0) meltSum += m[best] * (ml[best] - m0);
				if (ml[best] >= hold) arcC[bestCol]++;
				else arcG[bestCol * K + arcC[bestCol]] = PHASE.solidus(y[best], cF[best], cW[best]) - T[best];
				n++; wSum += dW;
			}
			S.ledger += dLed;
			S.tx.arc += n;
			S.thr.arcDr += wSum; S.thr.arcCr += wSum; S.thr.arcMelt += meltSum;
			S.d.arc = n; S.d.arcW = wSum; S.d.arcM = meltSum;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = ARC; else window.PTARC = ARC;
}());
