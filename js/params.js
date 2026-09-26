// params.js — every tunable constant (design §9), the enums, the seed and the live
// slider state. Single source of truth: other files read P, never re-derive numbers.
//
// One unit system (design §9): length m, geologic time Myr, velocity m/Myr
// (1 cm/yr = 1e4, 1 mm/yr = 1e3), rate 1/Myr. The eruptive clock and the two slider
// ranges are the only seconds/yr quantities, and they are converted at the boundary
// (sim.js turns yr/frame into Myr/frame). Mixing time units in one table is a silent
// 1e6 bug — the reference design quotes a few rates per year and they are converted here.
'use strict';

var P = {
	// world
	R: 6371e3,                   // planet radius, m
	wrap: 2 * Math.PI * 6371e3,  // wrap length, m
	// rows: the vertical sim mesh (design §1.2)
	nRows: 64,                   // in [48, 128]; fixed at load
	h0: 20,                      // 0 m band thickness, m
	skyTop: 33e3,                // sky band top, m
	// fan: the one Eulerian temperature grid (design §1.3)
	nCols: 512,
	// columns: the Lagrangian crust (design §2.2)
	colCap: 768,
	layerCap: 96,
	// capacities of the other entities (design §2.1, §2.3)
	plateCap: 32,
	ribCap: 8,
	ribNodeCap: 48,
	plumeCap: 6,
	conduitCap: 24,
	depCap: 4096,
	// display (design §1.4)
	yLin: 40e3,                  // asinh linear-core half-width, m
	winW: 3000e3,                // default window width, m
	winTop: 33e3,                // default window top, m
	winBot: -300e3,              // default window bottom, m
	cw: 1280,
	ch: 560,
	zoomMin: 0.02,               // per axis (the overview preset needs 0.052)
	zoomMax: 200,
	// enums
	LITH: { sed: 0, fel: 1, maf: 2, tephra: 3, lava: 4, sill: 5, n: 6 },
	OCLS: { vms: 0, maf: 1, arc: 2, oro: 3, bas: 4, pla: 5, n: 6 },
	FLAG: { wet: 1, ore: 2, unconf: 4 },
	// toy eruptive (design §1.5, §5)
	ventBoxW: 48,
	ventBoxH: 32,
	maxVents: 16,
	partCap: 512,
	repose: 34 * Math.PI / 180,  // angle of repose, rad
	Tsol: 0.6,                   // solidify threshold, toy T units
	gasBlast: 0.4,               // explosive gas fraction
	Vch: 5,                      // chamber capacity, km3
	Vbirth: 1,                   // vent birth threshold, km3
	Vdie: 0.1,                   // vent death threshold, km3
	tauVent: 2,                  // Myr of empty chamber before a vent dies
	// time (design §1.6)
	tauOmega: 0.5,               // Myr, plate velocity relaxation
	eventCadence: 1,             // Myr, split / suture / compaction cadence
	geoMin: 1e3, geoMax: 200e3,  // plates&plumes slider range, yr/frame
	eruptMin: 30, eruptMax: 14400, // lava&eruptions slider range, s/frame
	// initial planet (design §4.3, §4.6, §4.8) — the mask is sampled on a circle in
	// noise space so it is seamless across the x wrap
	maskScale: 1.6,
	landFrac: 0.4,               // quantile threshold: continental fraction, seed free
	marginCols: 3,              // landward passive-margin taper, columns
	proxRange: 8,                // columns searched for the sediment-source proximity
	hFelLand0: 35e3,             // 35 km felsic is the +400 m isostasy calibration point
	hFelLandK: 32e3,             // mask cores reach 67 km: plateaus above hCollapse
	hFelLandPow: 1.2,            // > 1 concentrates the thick crust in the mask cores
	cratonAge0: 300,             // Myr
	cratonAgeK: 1200,
	vSpread: 3e4,                // m/Myr half-spreading rate of the initial age ramp
	oceanAgeMax: 120,
	pillowH: 1800,
	oozeAgeMin: 15,
	oozeRate: 12,                // m/Myr pelagic ooze
	oozeMax: 1200,
	sedBasinK: 0.45,
	sedBasinMax: 3000,
	sedLandMax: 600,
	lithCold: 0.55,              // fan T anomaly at the surface under full lithosphere
	// profile: a spline through the column tops plus noise scaled by the local relief,
	// so plains stay smooth and mountain fronts get jagged (design §7 body pass)
	reliefBase: 40,              // m of undulation everywhere
	reliefK: 0.08,               // x the elevation difference of the two neighbours
	// plates (design §4.2)
	rGap: 0.75,
	rContact: 0.6,
	K: 3,                        // rift donors
	minPlateCells: 24,
	epsHi: 2e3,                  // m/Myr (2 mm/yr) boundary hysteresis
	epsLo: 1e3,                  // m/Myr (1 mm/yr)
	vRef: 5e4,                   // m/Myr (5 cm/yr)
	vMax: 2e5,                   // m/Myr (20 cm/yr)
	vSuture: 3e3,                // m/Myr (3 mm/yr)
	// crust (design §4.3, §4.4)
	hRiftBreakup: 15e3,
	hOceanic: 8e3,
	hCollapse: 50e3,
	hMafNewBase: 7e3,            // hMafNew = base * (1 + hMafNewTm * max(0, Tm - 1))
	hMafNewTm: 1.5,
	// forces (design §4.1, §4.2)
	U0: 5e4,                     // m/Myr mantle speed scale
	Lm: 2e6,                     // m, psi wavelength scale (modes k = 2..5)
	Ea: 3,
	vSlab: 1e6,                  // m/Myr
	kRidge: 5e6,
	vColl: 2e5,
	kArc: 8e3,
	zTrench: 3e3,                // m
	// surface (design §4.6)
	tauDyn: 10,                  // Myr, zDyn relaxation
	kFlex: 0.05,                 // /Myr
	kCollapse: 0.02,             // /Myr
	kEro: 0.05,                  // /Myr
	zKnee: 9e3,
	slopeRef: 0.01,
	delta: 20,                   // m, one-hop routing threshold
	kPlacer: 0.2,
	// damage (design §4.2, §4.3)
	kDam: 0.05,                  // /Myr
	kDamT: 0.02,                 // /Myr
	kHeal: 0.005,                // /Myr
	extRef: 1e-2,                // 1/Myr (= 1e-8 /yr)
	splitDamage: 0.8,
	// thermal (design §4.5, §4.8)
	Tm0: 1.6,
	tauCool: 2500,               // Myr
	Tfloor: 0.35,
	kDehy: 0.02,                 // /Myr
	kMelt: 1e-4,
	Tc: 0.2,
	// isostasy (design §4.6, reference §7.1)
	rhoM: 3300,
	rhoFel: 2750,
	rhoMaf: 2950,
	rhoSed: 2400,
	zRef: -3342,
	zRoot: 2091,
	thermK: 350,                 // m / sqrt(Myr) thermal-lithosphere term
	thermAgeCap: 80,
	ciLo: 5e3,                   // continental-interpolation band of hFel, m
	ciHi: 20e3,
	// ores (design §4.7)
	kV: 0.3,
	kM: 0.2,
	kM2: 0.15,
	kA: 0.02,
	kRec: 3,
	kO: 0.02,
	kB: 2e-4,                    // /m
	kB2: 0.002,                  // /Myr
	kDecay: 1 / 500,             // 1/Myr (1 / 500 Myr)
	// live state (not part of §9: sliders, seed, view)
	seed: 1,
	sl: { geo: 50e3, erupt: 1800 },   // current slider rates, yr/frame and s/frame
	view: null
};

// derived, never hardcoded elsewhere: the nominal column width follows from the wrap
// and the count (2*pi*6371 km / 512 = 78.184 km) so it cannot drift from R
P.w0 = P.wrap / P.nCols;

// the window in display space: x centre (m), horizontal m/px, and the vertical span
// in u (asinh) — zoom/pan are exact in u-space because the display map is non-linear
P.view = {
	cx: 0,
	kx: P.winW / P.cw,
	uT: Math.asinh(P.winTop / P.yLin),
	uB: Math.asinh(P.winBot / P.yLin)
};

if (typeof module !== 'undefined' && module.exports) module.exports = P;
