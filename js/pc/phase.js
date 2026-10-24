// pc/phase.js — 0.5.0 M1: the phase law, transplanted from 0.3 (0.5.0-plan.md §3.1).
//
// The law is unchanged from js/pt/phase.js, which is the authority and whose comment block
// carries the derivation:
//
//   u(y)   = 1 / (1 + y * meltInvLam)        y > 0; u = 1 above the surface
//   Ts(y)  = 1 + meltDeep - meltDrop * u * u - meltWF * cF - meltWW * cW
//   Tl(y)  = Ts(y) + meltGap
//   T <= Ts          xi = 0                    H = T
//   Ts < T < Tl      xi = (T - Ts) / meltGap   H = T + meltLat * xi
//   T >= Tl          xi = 1                    H = T + meltLat
//
// One amendment (plan §3.1): the solidus evaluates against **pressure**, and the pressure
// has two sources. `solidusOf: 'depth'` passes the parcel's own depth, bitwise 0.3's law;
// `solidusOf: 'load'` (the default) passes the engine's emergent lithostatic load in km of
// equivalent depth. Both sources reach the same curve through pressure(), so a rift that
// removes the column over a parcel drops its solidus and the melt that follows is the
// equilibrium answer to a real unloading, not an overlay (S4).
//
// The load argument is optional at every entry point. A caller that has no load column (the
// airborne pass, a fixture, and every depth-mode call) omits it and the depth branch is used,
// which is exactly why the 'depth' comparison is bitwise: the amendment sits in one place.
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : root.PCP;

	// The two mappings return a pair; this is the module's own scratch, so no allocation in
	// the frame loop. A caller that must hold two states at once keeps its own copy.
	var OUT = { t: 0, h: 0, melt: 0, p: 0 };

	// the depth decay of the solidus. Above the surface a parcel has no pressure column over
	// it, so the curve is flat there: an edifice's material is never *more* fusible than the
	// surface's own.
	function decay(y) { return y > 0 ? 1 / (1 + y * PCP.meltInvLam) : 1; }

	// The solidus at a pressure and composition. `p` is a depth-equivalent in km; the
	// arithmetic is 0.3's, term for term, because the depth branch must be bitwise the
	// transplanted curve (experiments/pc-phase.js).
	function solidusAt(p, cF, cW) {
		var u = decay(p);
		return 1 + PCP.meltDeep - PCP.meltDrop * u * u - PCP.meltWF * cF - PCP.meltWW * cW;
	}

	// The one place the two pressure sources meet. 'depth' ignores the load argument
	// entirely (so a caller that passes one gets 0.3's answer, which is what makes the
	// S4 negative control meaningful); 'load' uses the engine's column when it has one and
	// falls back to depth when it does not.
	function pressure(y, load) {
		if (PCP.solidusOf === 'load' && load >= 0) return load;
		return y;
	}

	var PHASE = {
		out: OUT,

		pressure: pressure,
		solidusAt: solidusAt,

		solidus: function (y, cF, cW, load) { return solidusAt(pressure(y, load), cF, cW); },
		liquidus: function (y, cF, cW, load) { return solidusAt(pressure(y, load), cF, cW) + PCP.meltGap; },

		// T -> (melt, H): the equilibrium state at a temperature. Used by a reset that seeds
		// H from an initial temperature, and by a partial delivery in a conduction pass.
		byT: function (T, y, cF, cW, load) {
			var p = pressure(y, load), ts = solidusAt(p, cF, cW), xi;
			OUT.p = p;
			OUT.t = T;
			if (T <= ts) { OUT.melt = 0; OUT.h = T; return OUT; }
			xi = (T - ts) / PCP.meltGap;
			if (xi >= 1) { OUT.melt = 1; OUT.h = T + PCP.meltLat; return OUT; }
			OUT.melt = xi; OUT.h = T + PCP.meltLat * xi;
			return OUT;
		},

		// H -> (T, melt): the kernel's equilibrium mapping. Below the solidus H *is* T
		// (cp = 1 in the normalized unit), which is why a run that never melts reads H == T
		// bitwise. OUT.h echoes the input so both directions return the same triple.
		byH: function (H, y, cF, cW, load) {
			var p = pressure(y, load), ts = solidusAt(p, cF, cW);
			var xi = (H - ts) / (PCP.meltGap + PCP.meltLat);
			OUT.p = p;
			OUT.h = H;
			if (xi <= 0) { OUT.t = H; OUT.melt = 0; return OUT; }
			if (xi >= 1) { OUT.t = H - PCP.meltLat; OUT.melt = 1; return OUT; }
			OUT.melt = xi; OUT.t = H - PCP.meltLat * xi;
			return OUT;
		},

		// The equilibrium pass over a parcel pool: every parcel is mapped, including airborne
		// and landed material, so "T is the equilibrium reading of H" holds for the whole
		// pool. The sensible ledger S.ledger is summed over every parcel whose T changes;
		// hLedger - ledger = L * (melt-mass change) is the identity 0.3's fixtures read.
		// `yLoad` is optional: the per-parcel pressure column in km, when the engine has one.
		equil: function (S, yLoad) {
			var byH = PHASE.byH;
			var n = S.n, p, m, H = S.H, T = S.T, ml = S.melt;
			var cF = S.cF, cW = S.cW, y = S.y, t0, tot = 0, load;
			for (p = 0; p < n; p++) {
				m = S.m[p];
				load = yLoad ? yLoad[p] : -1;
				byH(H[p], y[p], cF[p], cW[p], load);
				t0 = T[p];
				T[p] = OUT.t; ml[p] = OUT.melt;
				if (OUT.t !== t0) tot += m * (OUT.t - t0);
			}
			S.ledger = (S.ledger || 0) + tot;
			return tot;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = PHASE;
	else root.PCPHASE = PHASE;
}(typeof window !== 'undefined' ? window : this));
