(function (root) {
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
	gridGapY: 26,                // min px between altitude scale lines (one label tall)
	gridGapX: 110,               // min px between distance scale lines (one label wide)
	// enums
	LITH: { sed: 0, fel: 1, maf: 2, tephra: 3, lava: 4, sill: 5, n: 6 },
	// Stratigraphic rank of a lithology, densest/intrusive at the bottom. A stack is
	// ordered when this never *increases* upward, and it is the one table the layer
	// primitive (COL.insertVol) and the audit both order by, so the gate and the
	// mechanism cannot disagree about what an inversion is. Sill is an intrusion
	// (basement), tephra and lava are surface products, sediment is the youngest.
	LITH_RANK: [4, 2, 1, 3, 3, 0],
	OCLS: { vms: 0, maf: 1, arc: 2, oro: 3, bas: 4, pla: 5, n: 6 },
	// intr: the bed was placed inside a stack, not on its surface — an injection cuts both
	// its faces. It is what lets a reader keep one stratigraphic law: bed ages are formation
	// times on the section's clock, non-decreasing upward across every contact whose two
	// beds are not intr (0.4.1-plan.md §4.3.2).
	FLAG: { wet: 1, ore: 2, unconf: 4, intr: 8 },
	// boundary state of a column with its right neighbour (design §4.2); none = same plate
	EDGE: { none: 0, neutral: 1, open: 2, subduct: 3, collide: 4 },
	// toy eruptive (design §1.5, §5)
	ventBoxW: 48,
	ventBoxH: 32,
	maxVents: 16,
	partCap: 512,
	repose: 34 * Math.PI / 180,  // angle of repose, rad
	Tsol: 0.6,                   // solidify threshold, toy T units
	gasBlast: 0.4,               // explosive gas fraction
	Vch: 5,                      // chamber capacity, km3
	Vbirth: 4,                   // vent birth threshold, km3
	                             // 0.2.4, landed from the cadence table
	                             // (experiments/vent-contact-sweep.js, Vbirth 1/4/8/16/32 x
	                             // tauVent 0.25/0.5/2 on the four strict contact legs):
	                             // 4 is the best duty/repose the arc cone survives. It banks
	                             // one chamberful per episode (batches 125-305 cells2, births
	                             // -20-40%, repose medGap 2.05-5.00 Myr against the base's
	                             // 0.90-2.80, duty 82.0% mean against 88.7%, visDuty 64.5%
	                             // inside 0.2.1's 57-69%) and keeps the 0.2.3 arc cone in the
	                             // design band (27.00 x 8.42 px against 27.00 x 8.24). The
	                             // rows above it lose the cone: at Vbirth >= 8 a life batches
	                             // several chamberfuls, tephra waits for death and slumps past
	                             // the band (21 x 5.4 at 16), and tauVent <= 0.5 flattens every
	                             // candidate's pile while only buying 4-6 duty points. Vbirth
	                             // stays under Vch so the birth fills the vent chamber in one
	                             // transfer (vent-bench M1.1's ladder).
	Vdie: 0.1,                   // vent death threshold, km3
	tauVent: 2,                  // Myr of empty chamber before a vent dies
	                             // Measured flat-to-costly in the 0.2.4 table: the design
	                             // absolute (2 Myr) is where the cone holds; 0.25/0.5 fire the
	                             // death rule sooner and buy section duty (up to 69.4% mean at
	                             // 32/0.5, which nicks R1) but every one of them flattens the
	                             // arc cone below the watchable height.
	// The design's chamber km3 convert to the engine's section m2 at the magma.js
	// boundary (1 km3 := venKm3M2 m2). Calibrated so Vbirth/Vch/Vdie all sit inside the
	// measured supply range (plume-column chambers plateau near 5e5 m2 in 500 Myr);
	// M5 re-tunes the three chamber figures against erupt-bench and the section look.
	venKm3M2: 1e5,
	blastP: 1.3,                 // explosive needs P > 1.3 P0 (design §5.2)
	tDrain: 7200,                // eruptive s for a gas-free full chamber to empty under the sqrt law
	venGas0: [0.45, 0.1, 0.15, 0.5], // gas fraction fixed at birth, by style (strato, shield, fissure, arc)
	// toy box time and ballistics (0.2.0 M0): a frame is cut into toy ticks of at most
	// toyTickSec, at most toyMaxTicks per call; the ballistic peak is ~12 cells at the defaults
	toyTickSec: 10,              // eruptive s per toy tick
	toyMaxTicks: 256,
	toyG: 0.5,                   // cells/s^2
	toyVx: 0.5,                  // lateral ejection speed, cells/s; 1 spreads a 150-cell^2 ash fan to 6 x 33 cells
	toyVy: 3.5,                  // vertical ejection speed, cells/s
	toyPackets: 8,               // ballistic packets per tick of an explosive feed
	toyCoolSec: 1800,            // eruptive s, independent of secular tauCool (Myr)
	toyPasses: 2,                // slump passes per tick (design §5.1)
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
	sedCap: 4000,                // m, the sediment a basin holds before it spills
	sedLandMax: 600,
	lithCold: 0.55,              // fan T anomaly at the surface under full lithosphere
	// profile: a spline through the column tops plus noise scaled by the local relief,
	// so plains stay smooth and mountain fronts get jagged (design §7 body pass)
	reliefBase: 40,              // m of undulation everywhere
	reliefK: 0.08,               // x the elevation difference of the two neighbours
	// plates (design §4.2)
	plates0: 8,                  // initial plates: a hot start has many (design §4.8)
	plateJitter: 16,             // columns of seeded boundary jitter; 512/8 - 2*16 >= minPlateCells
	rGap: 0.75,
	rContact: 0.6,
	gFloor: 0.12,                 // separation floor for ordinary inter-plate contacts
	crushGap: 0.05,               // C-C conveyor floor: 3.91 km, above 30 mm/yr at 100 kyr/frame
	floorPass: 64,                 // bound on COL.floor's settle passes; it stops early when settled
	                             // (measured: 22% of calls settle in one pass, 38% in two, and
	                             // the worst of 11 024 calls took 22, so the cap costs nothing
	                             // and 16 truncated the 0.24% that a squeezed plate ring needs)
	floorTol: 0.01,                // x gFloor a ring of contacts may leave uncorrected (see COL.floor)
	K: 3,                        // rift donors
	minPlateCells: 24,
	evAge: 2,                    // Myr a boundary must hold one state before it may change
	                            // the number of columns (the classifier's own entry terms)
	sutureAge: 20,               // Myr a C-C contact must stay slower than vSuture before
	                            // its two plates suture into one (COL.events)
	epsHi: 2e3,                  // m/Myr (2 mm/yr) boundary hysteresis
	epsLo: 1e3,                  // m/Myr (1 mm/yr)
	vRef: 5e4,                   // m/Myr (5 cm/yr)
	vMax: 2e5,                   // m/Myr (20 cm/yr)
	vSuture: 3e3,                // m/Myr (3 mm/yr)
	// crust (design §4.3, §4.4)
	hRiftBreakup: 15e3,
	hOceanic: 8e3,
	hOro: 45e3,                  // m, felsic crust above this is the thick-continental host class
	hCollapse: 50e3,
	hMafNewBase: 7e3,            // hMafNew = base * (1 + hMafNewTm * max(0, Tm - 1))
	hMafNewTm: 1.5,
	// forces (design §4.1, §4.2). U0 and Lm are calibrated together, because a plate's
	// drive is the *mean* of the flow under it: at Lm 2000 km the modes (n = 6, 10, 13, 16)
	// are shorter than a plate, the mean cancels 81% of the flow, and the plates crawled
	// at 2.7 mm/yr against the design's 5 cm/yr scale. Cells of 4000-13000 km are also the
	// honest scale for whole-mantle convection, and they leave the plates 35-60% of the
	// flow, so the drive is the real thing rather than a residual of it.
	U0: 8e4,                     // m/Myr (8 cm/yr) mantle surface speed scale
	Lm: 4e6,                     // m, psi wavelength scale (modes k = 2..5 -> n = 3,5,6,8)
	Ea: 3,
	coolDrag: 24,                // extra Arrhenius stiffening below the adiabat unit T
	vSlab: 1e6,                  // m/Myr
	slabPullK: 0.05,             // fraction of vSlab a metre of slab delivers as pull:
	                             // F = vSlab*slabPullK*s(age)*Lslab (m2/Myr), a line
	                             // force on the plate, divided by its width in the solve
	kRidge: 5e6,
	vColl: 2e5,                  // m/Myr of equivalent velocity per unit belt width
	kArc: 8e3,
	zTrench: 3e3,                // m
	// surface (design §4.4, §4.6)
	tauDyn: 10,                  // Myr, zDyn relaxation
	kFlex: 0.05,                 // /Myr
	kCollapse: 0.02,             // /Myr
	tauSliver: 4,                 // Myr, a drained sliver's drawn ground follows the line between
	                               // its margins over this time rather than in one frame
	kBelt: 0.12,                 // 1/Myr of the excess (m), bulk orogenic flow out of a collision
	                             // pair: a 5.4 km excess moves ~650 m/Myr, scaled by the
	                             // closing rate; stiff re-calibration is gated by 0.1.7 M0
	kBeltGradient: 12,           // 1/Myr, local yield-limited felsic flow smooths belt shoulders.
	                             // 0.2.0 M5 sweep (experiments/belt-tune-sweep.js, nine candidates
	                             // x the four strict legs): 12 is the only rate whose worst
	                             // single-frame needle stays inside the historical 1.5 on every
	                             // leg (1.31/1.40/1.28/1.25); 8 reads 2.03 on 5000/5/100 and every
	                             // other candidate 1.61-2.11, i.e. needs the standing-needle
	                             // allowance, and 16 also loses R1 on 3000/1/50 (ratio 1.30).
	beltYield: 3000,              // m, the root a collision can hold up without flowing sideways
	faceGapMin: 0.5,             // x w0: floor on the face gap of both column stencils
	kEro: 0.05,                  // /Myr
	zKnee: 9e3,
	slopeRef: 0.01,
	delta: 20,                   // m, one-hop routing threshold
	kPlacer: 0.2,
	// damage (design §4.2, §4.3) and lithosphere strength (design §4.4, reference §6.5):
	// strength = clamp(sBase + sFelK*ss(hFel; sFelLo..sFelHi) + sAgeK*ss(age; sAgeLo..sAgeHi),
	//                  sBase, sMax) / Tm
	kDam: 0.05,                  // /Myr
	kDamT: 0.02,                 // /Myr (reserved: no transverse velocity in 1D)
	kHeal: 0.005,                // /Myr
	extRef: 5e-1,                // 1/Myr, calibrated to this flow's own surface divergence
	                            // (p50 0.018, p99 0.058 /Myr at U0 8e4 / Lm 4e6): damage
	                            // settles at kDam*(ext/extRef)/kHeal = 10*ext/extRef, so
	                            // 5e-1 leaves the median column at 0.36 and saturates the
	                            // top percent. The reference's 1e-8 /yr is a real intraplate
	                            // strain rate; a flow of cm/yr over 5000 km cells is 30x
	                            // that, and at extRef 1e-2 every column on the planet sat
	                            // at damage 1 and the split rule was decided by geometry
	                            // alone (measured: 58 rifts in 50 Myr).
	splitDamage: 0.8,
	strBase: 0.3,
	strFelK: 0.7,
	strFelLo: 10e3,
	strFelHi: 35e3,
	strAgeK: 0.3,
	strAgeLo: 20,                // Myr
	strAgeHi: 200,               // Myr
	strMax: 1.3,
	// thermal (design §4.5, §4.8)
	Tm0: 1.6,
	tauCool: 2500,               // Myr
	Tfloor: 0.35,
	kDehy: 0.02,                 // /Myr, slab water release between 50 and 200 km
	kMelt: 20,                    // melt per released water, × the wedge temperature factor
	                             // (yield 0.63 melt/water, 0.2.1 §3's petrological decade).
	                             // 0.2.3, landed from the contact table and not the toy:
	                             // experiments/melt-contact-sweep.js ran the four strict
	                             // contact legs at 2e-3 / 6 / 10 / 20 with 0.2.2's
	                             // tephra-only rule; all four pass at 20 with the base's
	                             // margins (worst R2 width 92.7% against 92.5%, R3 80.4 km
	                             // against 80.1, ceiling + influx 81.8). Only 20 builds a
	                             // visible arc cone (27.00 × 8.24 px, 113.7 cells2): 6 and
	                             // 10 reach 1.43 and 4.03 px. 0.2.2's "not landed" was
	                             // measured with lava delayed too (2438/2724 and 81.9 km
	                             // reproduce under that variant, not under this rule).
	Tc: 0.2,                     // anomaly threshold above the wedge reference
	wedgeT0: 0.7,                // adiabat reference at the wedge (Tf stores the anomaly)
	chamberCap: 2e7,              // m2 per unit depth before a sill / underplate spill
	slabWaterSed: 0.06,          // bound water fraction of a sediment layer
	slabWaterMaf: 0.008,         // bound water fraction of a mafic layer
	slabSurfaceDepth: 5e3,        // trench anchor depth, m
	slabSinkFrac: 0.02,           // P.vSlab is a force scale; this is its 1D descent fraction
	slabDip0: 45 * Math.PI / 180,
	slabDipMax: 60 * Math.PI / 180,
	slabDissolve: 660e3,
	slabNodeGap: 25e3,
	kPlumeMelt: 2e6,              // m2/Myr at a normalized plume head (20 km3/Myr at the
	                             // committed venKm3M2, still ~1e3x below a modest real head).
	                             // 0.2.1 melt sweep (experiments/melt-tune-sweep.js, two live
	                             // legs at 150/300 Myr): 2e4 fed one column 2.7e5-1.4e6 m2,
	                             // 0.5-2.5 toy cells2, so no live vent built anything (one cell
	                             // is toyCellM2 5.8e5 m2). This rate is erupt-bench's reference
	                             // cone, a touch smaller: pile 7.8/10.9 px tall by 21/29 px wide
	                             // against the prescribed 10.06 x 27, edifice stock 5.2e7/1.54e8
	                             // m2, at 0.155/0.277% of all mafic production. Half of it builds
	                             // 17/13 px and 6x it builds 39/45 px at 13-20% of the box, so
	                             // this is the design's 10-30 px band, not a round number.
	plumeStart: -2e6,
	plumeRise: 5e4,               // m/Myr at Tm0 (about 5 cm/yr)
	plumeLifeMin: 50,
	plumeLifeMax: 150,
	plumeRadius: 180e3,
	plumeHeat: 0.55,
	kLIP: 1.5e3,                  // mafic stack growth, m/Myr at unit plume strength
	tauT: 100,                    // Myr, fan T anomaly relaxation toward the adiabat
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
	// ores (design §4.7): saturating, fertility-scaled factories on the geological clock.
	// The finite live resources below are a game delineation in a one-metre-deep slice,
	// not the 3D catalogue / grade-tonnage priors in port/deposit-models.js.
	kV: 0.3,
	kM: 0.2,
	kM2: 0.15,
	kA: 0.02,
	kRec: 3,
	kO: 0.02,
	kB: 2e-4,                    // /m
	kB2: 0.002,                  // /Myr
	kDecay: 1 / 500,             // 1/Myr (1 / 500 Myr)
	placerPotPerM: 0.005,        // /m of deposited placer-bearing load
	oreThreshold: [0.15, 0.2, 0.2, 0.2, 0.15, 0.1], // OCLS order, after the one-cell blur
	oreShare: [0.04, 0.03, 0.02, 0.01, 0.1, 0.02], // maximum share of the host bed delineated
	oreThMax: [50, 250, 300, 80, 200, 10], // m, upper bound on each resource envelope
	oreArcMin: 3000, oreArcMax: 8000, // m below the solid surface at emplacement
	oreListPerClass: 6,          // rows per class in the on-demand ranked list
	// 0.1.5 contact contract (0.1.5-plan.md §1): thresholds of the measurement, not
	// physics. contact-audit.js --strict gates on exactly these, so the gate, the plan
	// and the tuning cannot quote different numbers
	layerCap: 96,                 // beds a stack may hold before it consolidates
	bedMin: 250,                // m, a bed thinner than this is absorbed into its neighbour
	capStay: 3,                  // frames a column may sit at layerCap before it has consolidated
	beltCols: 4,                  // columns a collision belt must thicken, of the 6 around the pair
	beltMaxCols: 16,              // columns the belt walk (COL.beltAt) follows out from the pair
	beltFeed: 2,                  // columns each side the orogenic flow reaches; the flanks sit just beyond
	beltRise: 2000,               // m, the thickening that makes a column part of a belt
	beltRoot: 4000,               // m, the root a collision must stand above its flanks to count as built
	beltPeak: 1.5,                // local pair peak / higher adjacent shoulder limit (R2 needle test)
	crustMax: 80e3,               // m, the ceiling on one column's crust
	evDzK: 1.25,                  // an event frame may move the surface this much more
	evRate: 2,                    // topology events per 1000 frames
	kDelam: 45,                   // 1/Myr, foundering: the column over crustMax relaxes
	                             // to it with tau = 1/kDelam (22 kyr), backward Euler
	sliverMax: 0.02,              // fraction of the crust a draining record may hold
	evGap: 40,                    // frames a site must stay quiet before its topology may change again
	// live state (not part of §9: sliders, seed, view)
	seed: 1,
	sl: { geo: 50e3, erupt: 1800 },   // current slider rates, yr/frame and s/frame
	view: null
};

// derived, never hardcoded elsewhere: the nominal column width follows from the wrap
// and the count (2*pi*6371 km / 512 = 78.184 km) so it cannot drift from R
P.w0 = P.wrap / P.nCols;
P.crushFloor = P.crushGap * P.w0;
// vent chamber thresholds in the engine's m2, and the toy jacobian: one toy cell is one
// default-window pixel (design §1.5: 2.34 km x 0.25 km at the surface band), so its world
// area is winW/cw by the display map's slope at 0 m. The schedule's chamber drain and the
// M2 write-back share this one conversion, so toy mass and world mass cannot drift apart.
P.VchM2 = P.Vch * P.venKm3M2;
P.VbirthM2 = P.Vbirth * P.venKm3M2;
P.VdieM2 = P.Vdie * P.venKm3M2;
P.toyCellX = P.winW / P.cw;
P.toyCellY = P.yLin *
	(Math.asinh(P.winTop / P.yLin) - Math.asinh(P.winBot / P.yLin)) / P.ch;
P.toyCellM2 = P.toyCellX * P.toyCellY;
// design §5.2 rate law dV/dt = -kErupt * sqrt(V/Vbirth): this k empties a gas-free full
// chamber in tDrain seconds of eruptive time (integrate 2*sqrt(Vch*Vbirth)/tDrain)
P.kErupt = 2 * Math.sqrt(P.VchM2 * P.VbirthM2) / P.tDrain;
// A trench sliver is retired when the territory it holds is worth nothing to the
// picture. Its width is half the sum of its two gaps and the floor keeps each of them at
// gFloor, so wMin = gFloor puts the retirement exactly where both gaps are on the floor,
// and hands each neighbour back a hundredth of a column: a few per cent of its width.
P.wMin = P.gFloor * P.w0;

// the window in display space: x centre (m), horizontal m/px, and the vertical span
// in u (asinh) — zoom/pan are exact in u-space because the display map is non-linear
P.view = {
	cx: 0,
	kx: P.winW / P.cw,
	uT: Math.asinh(P.winTop / P.yLin),
	uB: Math.asinh(P.winBot / P.yLin)
};

if (typeof module !== 'undefined' && module.exports) module.exports = P;
else root.COLP = P;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
