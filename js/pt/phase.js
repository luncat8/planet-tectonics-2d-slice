// pt/phase.js — 0.3.0 P3.1: the phase law and the pool pass that reads it (0.3.0-p3-plan.md
// §4 P3.1). H is the conserved quantity; T and `melt` are the equilibrium state it maps to.
//
// The law is the one documented in params.js:
//
//   u(y)   = 1 / (1 + y * meltInvLam)        y > 0; u = 1 above the surface
//   Ts(y)  = 1 + meltDeep - meltDrop * u * u - meltWF * cF - meltWW * cW
//   Tl(y)  = Ts(y) + meltGap
//
// and the specific enthalpy of a parcel at temperature T is H = T + meltLat * xi, with the
// melt fraction xi linear in T across the mushy interval:
//
//   T <= Ts          xi = 0                    H = T
//   Ts < T < Tl      xi = (T - Ts)/meltGap     H = T + meltLat * xi
//   T >= Tl          xi = 1                    H = T + meltLat
//
// Both directions are exact inverses of each other (byT then byH returns the same H, and byH
// then byT the same T and xi), which is what lets the reset seed H from an initial
// temperature and the kernel read T back out of it every substep. The breakpoints are
// continuous in H: at H = Ts the parcel is exactly solid, at H = Ts + meltGap + meltLat
// exactly molten. The two breakpoints are the same condition expressed in the two variables,
// so a parcel can cross a transition without its H jumping: the phase change repartitions H
// into latent heat, it never creates or destroys it (0.3.0-p3-plan.md §1.1).
//
// The pass below is G4's first half. G3 hands the conduction increment to H and leaves T
// alone; this is where the parcel's temperature and melt fraction are brought back into
// equilibrium with the enthalpy it now carries. The sensible part of that change is booked in
// S.ledger, which is why the gap between it and the enthalpy book (gatherDT books the intake
// in S.hLedger) is exactly the latent heat the run has stored -- a diagnostic, not a leak:
// the enthalpy book is the one that closes against the wall flux (experiments/
// pt-p3-enthalpy.js).
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTPHASE.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;

	// The two mappings return a pair, and this is the module's own scratch: no allocation, and
	// the caller reads the fields it needs before the next call. A fixture that wants to hold
	// two states at once keeps its own copy.
	var OUT = { t: 0, h: 0, melt: 0 };

	// the depth decay of the solidus. Above the surface a parcel has no pressure column over
	// it, so the curve is flat there: an edifice's material is never *more* fusible than the
	// surface's own.
	function decay(y) { return y > 0 ? 1 / (1 + y * P.meltInvLam) : 1; }

	// the solidus at a depth and composition: the temperature at which the parcel is exactly
	// solid. Exposed so a fixture can measure the curve itself, not just the pool.
	function solidus(y, cF, cW) {
		var u = decay(y);
		return 1 + P.meltDeep - P.meltDrop * u * u - P.meltWF * cF - P.meltWW * cW;
	}

	var PHASE = {
		out: OUT,

		solidus: solidus,
		liquidus: function (y, cF, cW) { return solidus(y, cF, cW) + P.meltGap; },

		// T -> (melt, H): the equilibrium state at a temperature. Used by the reset, which
		// seeds H from the initial condition's temperature, and by a flip < 1 delivery in
		// gatherDT.
		byT: function (T, y, cF, cW) {
			var ts = solidus(y, cF, cW), xi;
			OUT.t = T;
			if (T <= ts) { OUT.melt = 0; OUT.h = T; return OUT; }
			xi = (T - ts) / P.meltGap;
			if (xi >= 1) { OUT.melt = 1; OUT.h = T + P.meltLat; return OUT; }
			OUT.melt = xi; OUT.h = T + P.meltLat * xi;
			return OUT;
		},

		// H -> (T, melt): the kernel's equilibrium mapping. Below the solidus H *is* T (cp = 1
		// in the normalized unit), which is why every fixture that never melts still reads
		// H == T bitwise. OUT.h echoes the input so both directions return the same triple.
		byH: function (H, y, cF, cW) {
			var ts = solidus(y, cF, cW), xi = (H - ts) / (P.meltGap + P.meltLat);
			OUT.h = H;
			if (xi <= 0) { OUT.t = H; OUT.melt = 0; return OUT; }
			if (xi >= 1) { OUT.t = H - P.meltLat; OUT.melt = 1; return OUT; }
			OUT.melt = xi; OUT.t = H - P.meltLat * xi;
			return OUT;
		},

		// G4's first half, one pass over the whole pool. Every parcel is mapped, including
		// airborne and landed material, so "T is the equilibrium reading of H" holds for the
		// whole pool and not only for the coupled set. The sensible ledger S.ledger is summed
		// over *every* parcel whose T changes, including airborne material, so hLedger - ledger
		// = L * (invLTot - invL0) holds for the whole pool (parcels + reservoirs) rather than
		// breaking on adiabatic decompression/cooling snaps of unbooked phases. Grid-coupled
		// parcels received -- and booked to hLedger -- their conduction increment in gatherDT;
		// air parcels received no wall intake but may have changed y (and thus solidus) since
		// the last equil, which is an internal repartition of their own enthalpy between
		// sensible and latent, and is booked the same way so invLTot's corresponding delta
		// does not register as a leak. The wall ledger S.wall is never touched here.
		equil: function (M, S) {
			var byH = PHASE.byH;
			var n = S.n, p, m, ph = S.ph, H = S.H, T = S.T, ml = S.melt;
			var cF = S.cF, cW = S.cW, y = S.y, t0, tot = 0;
			for (p = 0; p < n; p++) {
				m = S.m[p];
				byH(H[p], y[p], cF[p], cW[p]);
				t0 = T[p];
				T[p] = OUT.t; ml[p] = OUT.melt;
				if (OUT.t !== t0) tot += m * (OUT.t - t0);
			}
			S.ledger += tot;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = PHASE; else window.PTPHASE = PHASE;
}());
