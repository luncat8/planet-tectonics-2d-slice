// pc/params.js — 0.5.0 M1: the shared constants of the two FFT-free engines
// (0.5.0-plan.md §0, §3). One unit system, inherited from the 0.3 engine: length km, time
// Myr, velocity km/Myr, temperature normalised 0 at the surface and 1 at the CMB, enthalpy
// H with one latent-heat unit. Nothing about the solver change redefines the physics units.
//
// The phase-law and bond-law numbers below are 0.3's frozen ones (js/pt/params.js). They
// are repeated here rather than read from that file because js/pt/* is the precision line's
// own single source of truth and a page loads one line or the other; the drift guard is a
// harness, not a shared module: experiments/pc-phase.js gates the transplanted law bitwise
// against js/pt/phase.js, and experiments/pc-opt.js gates every constant below against its
// 0.3 original. A number that moves here without moving there fails both.
'use strict';

(function (root) {
	var PCP = {
		// world (0.3-plan §3.3): a 2D slice, periodic in x, from the surface to the CMB.
		// The width is 5.5 depths, which fits the four-to-five-cell regime both engines'
		// S1 scenario is written against.
		wrap: 16000,                 // km, periodic width
		depth: 2900,                 // km, surface to CMB
		yLin: 40,                    // km, the asinh linear core: eta = asinh(y / yLin)

		// clock (plan §3.4). The geological clock is the 0.3 one because it was derived
		// from the Ra reference, not from the solver; the wall clock exists only for the
		// airborne pass.
		kyr0: 50,                    // kyr/frame, default
		kyrMin: 5, kyrMax: 500,      // kyr/frame, slider range
		flightDtMax: 0.05,           // Myr, the airborne pass's own clamp (0.3 flight rule)

		// phase law (0.3-plan §3, P3.1): the solidus is anchored at the surface, at the deep
		// margin and at the onset depth. js/pt/params.js derives the rest; so does this file,
		// with the same expressions in the same order, which is what makes the transplant
		// bitwise rather than merely close.
		meltSurf: 0.77,              // Ts(0)
		meltSup: 0.02,               // the deep solidus's margin over the CMB temperature
		meltOnset: 700,              // km: where material at the CMB temperature meets Ts
		meltGap: 0.15,               // liquidus - solidus
		meltLat: 0.25,               // L, one latent-heat unit in the same scale as T
		meltWF: 0.2,                 // solidus depression per unit felsic mass fraction
		meltWW: 20,                  // and per unit water mass fraction

		// bond law (0.3-plan §4.2, P2.1/P2.2): 0.3's measured starting constants. Each
		// engine recalibrates against its own load distribution in its own fixture, so these
		// are a transplant and never a promise (plan §3.3).
		TLock: 0.35,                 // age accumulates at or below this T
		TSoft: 0.45,                 // age and damage reset at or above this T
		tauWeld: 20,                 // Myr to weld a seam
		muLo: 0.35, muHi: 0.85,      // the strength window: heat = smoothstep(muLo, muHi, T)
		clusterMin: 0.25,            // below this a parcel is fluid; at it, it is plate
		yieldRate: 0.06,             // 1/Myr a full-strength bond carries elastically
		kDamage: 90,                 // 1/Myr per unit mean excess strain rate above yield
		tauHeal: 40,                 // Myr of quiet annealing to clear one unit of damage
		yWeldMax: 300,               // km, deepest rock that can age and weld
		eps0: 0.05,                  // elastic strain bound of a bond (the solver's yield,
		                             // not the rate law's; M3/M5 own its use)

		// merge compatibility (0.3 P3.4): landed batches coalesce only when they are the same
		// phase and within these composition tolerances; unlike compositions stay separate
		// parcels, because a merge is a material operation and not a bookkeeping convenience.
		mergeCompF: 0.02,            // maximum felsic mass-fraction difference
		mergeCompW: 0.002,           // maximum water mass-fraction difference

		// which pressure the solidus reads (plan §3.1). 'load' is the default because it is
		// what makes the request's "unpressurize" a physical event; 'depth' is the 0.3
		// comparison. The load is supplied by the engine as an equivalent depth in km
		// (uniform density: lithostatic pressure p / (rho g) is just the column height), so
		// one expression serves both sources.
		solidusOf: 'load',

		// phases. The parcel phases are shared by both engines; HY's liquid lives in cells,
		// so it never admits a 'melt' parcel (plan §4.4), while SP's melt is a phase (§5.6).
		PH: { crust: 0, air: 1, dep: 2, melt: 3 },

		// display geometry (0.3's canvas)
		cw: 1280, ch: 560,

		// live slider state, so a harness can read what the page is running
		sl: { kyr: 50 }
	};

	// derived, never hardcoded elsewhere. Same expressions, same order, as js/pt/params.js:
	//   meltDrop = 1 + meltSup - Ts(0)
	//   meltInvLam = (sqrt(meltDrop / meltSup) - 1) / meltOnset      puts Ts(meltOnset) at 1
	//   meltU0 = 1 / (1 + meltOnset * meltInvLam)
	//   meltDeep = meltDrop * meltU0^2
	PCP.meltDrop = 1 + PCP.meltSup - PCP.meltSurf;
	PCP.meltInvLam = (Math.sqrt(PCP.meltDrop / PCP.meltSup) - 1) / PCP.meltOnset;
	PCP.meltU0 = 1 / (1 + PCP.meltOnset * PCP.meltInvLam);
	PCP.meltDeep = PCP.meltDrop * PCP.meltU0 * PCP.meltU0;

	// the same routing masks the 0.3 pool uses (0.3.0-p3-plan.md §1.3), built from the enum
	// so a renamed phase cannot silently land in the wrong column:
	//   PH_SOLID  a parcel can carry bonds (crust and landed deposits)
	//   PH_FLY    airborne: no bonds, no grid coupling, wall clock only
	// HY's grid coupling is per-cell, not per-parcel, so the grid mask lives in each engine.
	(function () {
		var ph = PCP.PH, n = 0, k;
		for (k in ph) if (ph[k] > n) n = ph[k];
		PCP.PH_N = n + 1;
		PCP.PH_NAME = new Array(PCP.PH_N);
		PCP.PH_SOLID = new Uint8Array(PCP.PH_N);
		PCP.PH_FLY = new Uint8Array(PCP.PH_N);
		for (k in ph) PCP.PH_NAME[ph[k]] = k;
		PCP.PH_SOLID[ph.crust] = 1; PCP.PH_SOLID[ph.dep] = 1;
		PCP.PH_FLY[ph.air] = 1;
	}());

	// 1 cm/yr in km/Myr, the one place the two velocity units meet (the HUD reads cm/yr).
	PCP.cmYr = 0.1;

	if (typeof module !== 'undefined' && module.exports) module.exports = PCP;
	else root.PCP = PCP;
}(typeof window !== 'undefined' ? window : this));
