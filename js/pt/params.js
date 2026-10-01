// pt/params.js — 0.3.0 P1: every tunable of the particle engine (plan §0, §3), the enums,
// the seed and the live slider state. Single source of truth: other files read P, never
// re-derive numbers.
//
// One unit system, deliberately different from the column engine's (plan §0): length km,
// time Myr, velocity km/Myr, temperature normalised 0 at the surface and 1 at the CMB.
// 1 cm/yr = 10 km/Myr, so the HUD's cm/yr is a factor 0.1 on every velocity here; the
// conversion happens in one place (fluid.js diag) rather than at every rate.
'use strict';

var PTP = {
	// world (plan §3.3): a 2D slice, periodic in x, from the surface to the CMB. The width
	// is 5.5 depths, which fits four to five convection cells of the ~1.3-depth wavelength
	// pt-conv.js measures at Ra 1e6; the 2.76-depth box of P1 carried only one or two.
	wrap: 16000,                 // km, periodic width
	depth: 2900,                 // km, surface to CMB
	yLin: 40,                    // km, the asinh linear core: eta = asinh(y / yLin)
	// mesh: nodes in x (periodic) and cells in eta (ny + 1 node rows). The fluid grid is the
	// mantle only: eta 0 is the surface, eta etaBot the CMB. The 20 km of sky the display
	// shows above the surface is not part of the fluid (plan §3.3, corrected in P1).
	// 256x24 is P2's shape: the same 6144 cells as P1's 128x48 at the same 62.5 km x-node
	// spacing, so the frame budget survives the wider map; the eta rows are twice as tall
	// (8.3 km at the surface, 601 km at the base) which is still five rows through the lid.
	mesh: { nx: 256, ny: 24 },   // nx must be a power of two: the solver's FFT is radix-2
	// physics (plan §4.1)
	kappa: 31.56,                // km2/Myr, thermal diffusivity (1e-6 m2/s)
	Ra: 1e6,				// Rayleigh number of the demonstration run. Above ~3e6 the
							 // grid-scale content outruns what 128x48 resolves.
	upwellBuoyancyBoost: 0.1,	// hot-anomaly buoyancy proxy for lower-viscosity plumes
	downwellMix: 500,			// km2/Myr, conservative lateral mixing of cold fingers
	flip: 1,                     // marker temperature transfer: 1 = pure FLIP (exactly
	                             // conservative), < 1 blends toward the grid (smoothing)
	// clock (plan §2.3): the slider is kyr/frame; 50 kyr/frame is 3 Myr of geology per
	// second of wall clock at 60 fps, which is the demonstration scale. A rendered frame may
	// contain several fluid solves: transport never receives more than dtFluidMax, so the
	// 500 kyr/f end of the control follows the same trajectory instead of leaping over cells.
	dt0: 50,                     // kyr/frame, default
	dtMin: 5, dtMax: 500,        // kyr/frame, slider range
	dtFluidMax: 0.05,            // Myr; 50 kyr is the validated maximum fluid substep
	// initial condition (plan §8 P1): 'rb' is the Rayleigh-Benard state the fixture
	// compares against pt-conv.js; 'cool' is a hot planet with a cold skin; 'hot' is the P2
	// cooling start -- the lid grows from the wall; 'blob' is a single plume head
	ic: 'cool',
	skin: 80,                    // km, e-folding depth of the cold skin in 'cool'
	icAmp: 0.02,                 // perturbation amplitude, fraction of the drop
	icMode: 4,                   // x wavenumber of the perturbation: one per ~4000 km, the
	                             // cell wavelength the box wants, so the cells arrive early
	// The map is periodic, so a single-mode perturbation makes a planet that is icMode exact
	// copies of one 4000 km box: the only thing that breaks the symmetry is the markers'
	// sub-node jitter, and it takes ~300 Myr to show (experiments/pt-wrap.js measures it).
	// icBand spreads that fraction of icAmp's energy over wavenumbers 1..icBandMax with
	// seeded amplitudes and phases, so cells differ in size, plates are not mirror images
	// and a new seed is a new planet rather than the same one rotated around the axis.
	icBand: 0.6,                 // 0 = the pure single mode (the fixtures' validated draw)
	icBandMax: 12,
	seed: 1,
	// pressure-release melt indicator. P1 does not yet turn markers into conserved melt
	// particles (that is P3), but a separate diagnostic makes hot upward mantle visibly
	// generate and segregate melt instead of asking the one-phase thermal field to stand in
	// for magma. It never feeds back into the P1 Stokes solve.
	meltProxy: true,
	meltDepth: 550,              // km: decompression melting begins above this depth
	meltTop: 80,				// km: shallow extraction cap; melt indicator is removed above it
	meltExcess: 0.008,           // T above the row mean before a source is active
	meltRange: 0.04,             // T excess that reaches unit source strength
	meltUpRef: 12,               // km/Myr of upward mantle flow for unit source strength
	meltRise: 400,               // km/Myr of buoyant segregation through the mantle
	meltBuild: 1.2,              // 1/Myr, source to visible melt-potential conversion
	meltDecay: 6,                // Myr, extraction/cooling time of the indicator
	// crust (plan §4.2, reduced to the kinematic core for P2.1): a marker's strength is
	//   heat(T)  = smoothstep(muLo, muHi, T)          hot rock is soft
	//   mu(T,a)  = (0.05 + 0.95 * (1 - heat)) * (1 - exp(-age / tauWeld))
	// where `age` is "Myr since the particle last froze" (plan §3.1): it accumulates below
	// TLock, resets above TSoft and holds between, so cold rock welds with time and warm
	// rock never does. Markers with mu >= clusterMin form clusters (connected components of
	// adjacency among strong markers), and a cluster rides the flow as one rigid body --
	// the emergent plate. Clusters are recomputed every frame; nothing is stored.
	solid: true,
	TLock: 0.35,                 // age accumulates at or below this T
	TSoft: 0.45,                 // age resets at or above this T (hysteresis between)
	tauWeld: 20,                 // Myr to weld a seam; mu reaches 0.63 at one tau
	muLo: 0.35, muHi: 0.85,      // the strength window: heat = smoothstep(muLo, muHi, T)
	clusterMin: 0.25,            // below this a marker is fluid; at it, it is plate
	// failure (plan §4.2's damage, in rate form): a loaded bond is elastic below its own
	// yield strain rate, yieldRate * mu, and accumulates damage above it at kDamage per unit
	// of *mean* excess per Myr -- the mean over the pairs that contact the marker, not the
	// sum (P2.2: damage charged per pair scales with local marker density, and a lid marker's
	// partner count runs from ~10 to ~50 across the box; the sum made a crowded marker fail
	// about as much faster as it had more partners, which is a property of the sample, not of
	// the rock). Damage reaches 1 and the marker's bonds are gone; a soft marker re-melts its
	// damage to zero, and a cold quiet one anneals it away over tauHeal. This is what turns
	// one planet-wide lid into plates that rift, drift and suture. Both numbers come from
	// experiments/pt-load-check.js, which measures the engine's own load distribution on an
	// intact lid: a healthy lid's pairs read 0.003-0.02 /Myr of flow strain rate and the
	// hard-worked tail at the downwelling sheets reads 0.03-0.5, so yieldRate 0.06 carries the
	// body of a plate elastically and fails the tail in tens of Myr. kDamage is the rescale of
	// P2.1's per-pair 3 by the measured ratio of the two laws' aggregate rates (24.6x at
	// 50 Myr, 24.9x at 100, 33.9x at 200): 90 is inside that band, and the emergence gate
	// (pt-crust) is what pins where inside it.
	yieldRate: 0.06,             // 1/Myr a full-strength bond carries elastically
	kDamage: 90,                 // 1/Myr per unit mean excess strain rate above yield
	tauHeal: 40,                 // Myr of quiet annealing to clear one unit of damage
	yWeldMax: 300,               // km, maximum depth at which rock can age and weld: below the
	                             // upper-mantle slab regime pressure and adiabatic heating put
	                             // cold downwellings into ductile creep, so the CMB cold pool
	                             // of 'rb' stays fluid instead of welding into a bottom plate
	// slab pull (plan §4.2, §8 P2.2): a plate's net mantle traction largely cancels across
	// the cell it spans (experiments/pt-drift.js), so drift comes from the negative buoyancy
	// of the cold root hanging below the cluster's centroid depth at its trench end, redirected
	// along the plate by the trench hinge and capped at the convective velocity scale so a
	// plate cannot outrun the flow that feeds it. A closed planet-wide ring (csR2/csM >=
	// ringMax * wrap^2) has no free trench end and gets no pull until it rifts.
	kSlab: 18,                   // 1/Myr of horizontal plate drive per km of root depth excess
	vSlabMax: 45,                // km/Myr (4.5 cm/yr), maximum slab-pull velocity contribution
	ringMax: 0.04,               // Second-moment cap (fraction of wrap^2) below which a cluster
	                             // is a broken plate with free ends rather than a closed ring
	// particles (plan §3.1): one marker per interior node, each carrying its node's measure.
	// The count is fixed in P1 -- no merging, no eruption, no absorb -- and a moving marker
	// keeps its mass, so the parcel heat is exactly what the walls put in (the ledger) and
	// the marker field's area is material
	mpc: 4,                      // markers per node. One per node is the thinnest possible
	                             // sample of a stretched mesh: a single fold then empties a
	                             // node and the field has to be patched. Four is the usual
	                             // PIC compromise -- the scatter's weight per node sums to its
	                             // own measure (cw ~ 1), so the conduction intake is delivered
	                             // where the operator charged it, and a fold has to remove four
	                             // markers from a node before it becomes a hole.
	partCap: 32768,
	// display (plan §6)
	cw: 1280, ch: 560,
	winW: 16000,                 // km across the canvas at zoom 1: the whole periodic map at
	                             // 12.5 km/px, so the default view shows every convection
	                             // cell at once (the lid preset is the detail view)
	winTop: 20, winBot: 2900,    // km, default window (a little sky, the whole mantle)
	skyTop: 20,                  // km of sky drawn above the surface
	zoomMin: 0.05, zoomMax: 200,
	gridGapY: 30,                // px between depth lines (one label tall)
	gridGapX: 120,               // px between distance lines
	// live state (sliders and the camera)
	sl: { kyr: 50 },
	view: null
};

// derived, never hardcoded elsewhere: the buoyancy coefficient of the vorticity equation
//   lap(omega) = -RaK * dT/dx,  RaK = Ra * kappa / depth^3   [1 / (km Myr)]
// (plan §4.1: the same nondimensionalisation pt-conv.js measures the clock with)
PTP.RaK = PTP.Ra * PTP.kappa / (PTP.depth * PTP.depth * PTP.depth);
// 1 cm/yr in km/Myr, the one place the two velocity units meet
PTP.cmYr = 0.1;

// the window in display space: eta is the asinh depth coordinate, so zoom and pan are
// exact in eta; kx is km per pixel horizontally
PTP.view = {
	cx: PTP.wrap / 2,
	kx: PTP.winW / PTP.cw,
	eT: -Math.asinh(PTP.winTop / PTP.yLin),      // the sky: eta < 0 above the surface
	eB: Math.asinh(PTP.winBot / PTP.yLin)
};

if (typeof module !== 'undefined' && module.exports) module.exports = PTP; else window.PTP = PTP;
