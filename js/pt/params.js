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
	// The phase law (0.3.0-p3-plan.md §4 P3.1). P1's pressure-release overlay is gone with its
	// source constants: `melt` is now the equilibrium melt fraction of a parcel's own mass,
	// from a depth- and composition-dependent solidus plus one normalized latent heat, and T is
	// the reading of H through it. The solidus is written against the model's own anchor, the
	// CMB temperature (T = 1, where the wall is held):
	//
	//   u(y)  = 1 / (1 + y * meltInvLam)          y > 0; u = 1 above the surface
	//   Ts(y) = 1 + meltDeep - meltDrop * u * u - meltWF * cF - meltWW * cW
	//   Tl(y) = Ts(y) + meltGap
	//   H     = T + meltLat * xi                  xi = (T - Ts) / meltGap in the mush
	//
	// so the curve is fixed by three anchors -- the surface solidus of pure rock, the margin
	// the deep solidus keeps over the CMB wall, and the depth at which material at the CMB
	// temperature meets its own solidus:
	//
	//   meltDrop   = 1 + meltSup - Ts(0)      (1 + meltSup + meltWF*cF + meltWW*cW - meltSurf)
	//   meltInvLam = (sqrt(meltDrop / meltSup) - 1) / meltOnset, i.e. Ts(meltOnset) = 1
	//
	// (the derived block below owns those two; phase.js only evaluates the curve, reading the
	// asymptote as the derived meltDeep = meltDrop * u(meltOnset)^2, which is what makes the
	// third anchor bitwise). Ts is
	// monotone in depth, so a parcel melts in exactly one window: above the depth where its own
	// solidus crosses the parcel's own H. Melt is a material state, not a place -- a parcel that
	// rises at nearly constant H melts as the pressure falls, and one a drip drags down carries
	// its melt until the deeper solidus catches it (measured: the deepest mushy parcel of a
	// 300 Myr run is a carried one, experiments/logs/0.3.0-p3.1-melt-trajectory.txt). u^2 is a
	// rational decay rather than the exponential this was first written as: an exp costs a
	// transcendental per parcel per substep, and the rational form puts the three anchors in
	// the same place. Felsic material and water depress the solidus (water far more per unit
	// mass); the liquidus and the solidus move together, so the mushy interval stays meltGap
	// wide. Every number here is checked by experiments/pt-p3-enthalpy.js against the anchors
// above, and the four calibration rounds that chose them are recorded in
// archive/0.3.0-p3.1-worklog.md.
	meltSurf: 0.77,              // Ts(0): the surface solidus, 0.23 below the CMB temperature
	meltSup: 0.02,               // the deep solidus's margin over the CMB temperature
	meltOnset: 700,              // km: where material at the CMB temperature meets Ts
	meltGap: 0.15,               // liquidus - solidus, in T units: the width of the mushy interval
	meltLat: 0.25,               // L, the latent heat of fusion in the same normalized unit as T
	meltWF: 0.2,                 // solidus depression per unit felsic mass fraction
	meltWW: 20,                  // and per unit water mass fraction: the potent flux
	// P3.2, segregation and intrusive storage (0.3.0-p3-plan.md §4 P3.2). One threshold
	// moves a mush's melt both ways: PH_SOLID source rock sheds its melt at the equilibrium
	// split once the fraction reaches meltHold (the residue stays at its solidus, the melt
	// leaves at its liquidus -- the split conserves m and H and leaves the pool in
	// equilibrium), and a melt parcel in transit freezes back to the mantle below the same
	// threshold. Below it the melt is trapped in the grain boundaries and stays with its
	// host, so the two rules meet at one fixed point instead of fighting each other.
	// experiments/pt-p3-melt.js measures the threshold, the rise speed and the chamber
	// radius against the pool reserve; those numbers freeze with P3.5, not before.
	meltHold: 0.1,               // melt fraction that is mobile: source rock sheds it, transit melt dies below it
	vMelt: 60,                   // km/Myr (6 cm/yr), the melt's own buoyant rise on top of the flow map
	yCham: 40,                   // km, lower-crustal storage depth; the 8-37 km top mesh rows resolve it
	chJoin: 250,                 // km, coarse volcanic-system catchment; nearby intrusions share one record
	chCap: 64,                   // chamber records, allocated once; a full chamber set defers the transfer
	// P3.3, conduits and eruption scheduling (0.3.0-p3-plan.md §4 P3.3). Pressures are km of
	// rock head: density is uniform (P1), so a melt column of thickness h pushes with h, and the
	// lithostatic load at depth y is y. A chamber's column is its stock over its footprint,
	// chM / chSpan; its roof is at chY. A conduit opens when that head exceeds the roof's
	// lithostatic load plus its tensile strength, and drains at a rate set by the excess. The
	// schedule meters melt the chamber already holds; nothing here creates it.
	chSpan: 230,                 // km, effective 2D footprint of a regional lower-crustal reservoir
	tensile: 0.3,                // km of rock head at full strength: ~10 MPa at rho g ~ 33 MPa/km
	kVent: 0.5,                  // 1/Myr, effusive drain: flux = kVent * excess * chSpan (km2/Myr)
	kBlast: 2,                   // 1/Myr, explosive drain at the same excess
	wBlast: 0.01,                // water mass fraction above which a new conduit is explosive
	vCap: 4000,                  // km2, conserved vent stock waiting for a flight slot
	// P3.4, flight, landing and welding. Supply and cooling use geological time; only the
	// ballistic path uses seconds of wall time. One emitted parcel is a conserved batch of
	// ejecta, not one literal bomb, so its mass may be much larger than its display mark.
	emitEff: 1000,               // km2/Myr, maximum vent-to-flight transfer per effusive outlet
	emitBlast: 4000,             // km2/Myr, explosive transfer at the same geological clock
	flightFrame: 1 / 60,         // s, deterministic headless frame when no wall interval is supplied
	flightDtMax: 0.05,           // s, suspended tabs advance at most this far on their return frame
	flightG: 40,                 // km/s2 in presentation space (the trajectory is deliberately dilated)
	flightVyEff: 18,             // km/s upward: about 0.9 s and 4 km high
	flightVyBlast: 27,           // km/s upward: about 1.4 s and 9 km high. 30 with the +-10%
	                             // launch jitter of flight.js put the longest explosive arc at
	                             // 1.65 s, outside §2.4's 0.5-1.5 s band; 27 bounds it at 1.49 s.
	flightVxEff: 30,             // km/s maximum lateral presentation speed
	flightVxBlast: 80,
	flightLift: 0.05,            // km above the local terrain horizon at launch
	flightPx: 2,                 // half-resolution raster pixels used by an airborne mark
	depositCoolT: 0,             // normalized surface boundary temperature (the model's ambient)
	depositCoolTau: 0.1,         // Myr; a coarse-step quench over a few demonstration frames
	depositCoolDepth: 30,        // km, only shallow landed material exchanges with the surface wall
	depositMerge: 40,            // km, compatible landed batches inside this radius may coalesce
	mergeCompF: 0.02,            // maximum felsic-fraction difference for a material merge
	mergeCompW: 0.002,           // maximum water-fraction difference for a material merge
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
	// surface relief (plan §4.5, §8 P2.3). The Stokes domain keeps its flat coordinate top
	// eta = 0 -- the FFT + Thomas solve needs it -- and the visible horizon is this separate
	// periodic 1D profile S.zh[i]: km above the reference sea level y = 0, zero horizontal
	// mean. Its target combines upper-column thermal isostasy, shallow dynamic stress, a
	// low-pass welded-lid/rift proxy and compression at converging plate-cluster boundaries.
	// The particle samples are linearly splatted in x; every target term is flexurally filtered
	// before the horizon relaxes toward it, so narrow marker-bin spikes do not become peaks.
	// A conservative slope-dependent diffusion then transports relief from steep crests into
	// adjacent lows. Collision uplift is a kinematic proxy, not a contact solve: the present
	// solid model has no continental/oceanic crust distinction or inter-plate collision force.
	kIso: 0.09,                  // km of relief per (normalised T * km) over the compensation
	yIso: 150,                   // km, thermal compensation depth of the profile
	kDyn: 0.3,                   // measured so the dynamic trench term stays in the model's
	                             // target relief band without overwhelming thermal isostasy
	kLid: 0.05,                  // km of relief per km of the lid proxy; a 12-column band rises ~0.4 km
	kRift: 2.0,                  // km of graben at unit smoothed shallow damage
	yCrust: 250,                 // km, depth of the column sample the crust terms read
	yOrogen: 80,                 // km, upper layer sampled for surface plate motion
	kOrogen: 45,                 // km Myr; a 12 km/Myr collision fixture makes a 1.77 km crest
	collisionYield: 0.03,        // 1/Myr: ignore small within-plate velocity gradients
	zOrogenMax: 8,               // km, cap per convergent plate boundary before smoothing
	kPush: 3000,                 // km/Myr of ridge push per unit surface slope (-dzh/dx):
	                             // the measured swell slope is 0.002-0.005, so a full plate's
	                             // push lands in the 1 cm/yr band, next to the slab pull
	vPushMax: 15,                // km/Myr (1.5 cm/yr), ridge-push velocity cap
	tauSurf: 1.5,                // Myr, relaxation of zh toward the filtered target
	lFlex: 4,                    // passes of the periodic [1,2,1]/4 flexural filter
	kProfileDiff: 20,           // km2/Myr; profile-only diffusivity, calibrated by pt-surface.js
	slopeProfileDiff: 0.025,    // slope scale for profile diffusion; this does not move particles
	                             // P4 material erosion/deposition needs a separate mass transfer
	// P4.0, inter-plate contact (0.3.0-p4-plan.md §3 P4.0). The contact pass reads the same lid
	// band the crust relief terms read (yCrust) and answers a closing contact in one of two
	// regimes. The material model has one density, so temperature is the only density proxy the
	// buoyancy law itself uses: the colder side of a contact is the denser one, and it is the
	// contrast across the contact -- not a label the model does not carry -- that decides
	// whether that side can sink. With contrast, the colder plate subducts: it keeps its
	// velocity, its leading band bends down along contactDip beneath the override, and the
	// override's approach is held. Without contrast the response is arrest: both clusters take
	// a mass-weighted share of the correction that cancels the closing, and the belt the
	// kinematic orogen term raises is fed by the convergence this pass arrested (S.ctConv),
	// because a locked boundary that keeps converging is a boundary that keeps thickening.
	// The position guard is the discrete statement of the plan's gate: inter-cluster crust
	// markers closer than contactHard of a cell are pushed apart along their separation, and
	// the pushes are counted so the report can say how often the velocity-level response left
	// work for it. Every constant here is a P4.4 freeze candidate measured by
	// experiments/pt-p4-contact.js, not a claim.
	contact: true,
	contactYield: 0.03,         // 1/Myr: the closing rate below which a contact is not a
	                            // collision, the same yardstick as collisionYield's
	contactdT: 0.08,            // the temperature contrast across a contact that makes the
	                            // colder side dense enough to sink; below it, arrest
	contactDip: 35,             // degrees, the slab's descent beneath the override
	contactBand: 300,           // km, the bending zone's reach into the subducting plate
	contactHard: 0.55,          // cells, the no-penetration radius of the position guard
	ctTop: 4,                   // clusters per column in the contact table: the shallowest
	                            // crust marker of each, so a plate boundary is read where it
	                            // reaches the surface
	ctHinge: 16,                // bending bands per frame
	// the view warps by kRelief * zh, damped with depth; zVisMax clips outlier relief before
	// exaggeration so a deep rift cannot fill the lid camera with ocean.
	yTaper: 120,                 // km, e-folding depth of the view's terrain warp
	kRelief: 2,                  // visual exaggeration of zh in the view: the lid camera's own
	                             // asinh metric puts the top rows at ~0.5 km per raster row, so
	                             // 2x makes the deepest basin a tenth of that view legible
	                             // rather than a third (3x flooded the frame with ocean)
	zVisMax: 8,                  // km, the profile the view draws is clipped to +-this
	// particles (plan §3.1): the base population is mpc markers per interior node, each
	// carrying its node's measure. A moving marker keeps its mass, so the parcel heat is
	// exactly what the walls put in (the ledger) and the marker field's area is material.
	// P3.0 made the population a *prefix* of a pool rather than a fixed count: detached melt,
	// airborne clasts and landed deposits are admitted above the base (pool.js), so the
	// capacity carries a reserve and reaching it defers a transaction instead of dropping mass
	// (0.3.0-p3-plan.md §1.3).
	mpc: 4,                      // markers per node. One per node is the thinnest possible
	                             // sample of a stretched mesh: a single fold then empties a
	                             // node and the field has to be patched. Four is the usual
	                             // PIC compromise -- the scatter's weight per node sums to its
	                             // own measure (cw ~ 1), so the conduction intake is delivered
	                             // where the operator charged it, and a fold has to remove four
	                             // markers from a node before it becomes a hole.
	// The reserve, as fractions of the base population. pool.js enforces only their sum, one
	// shared cap above the base: a phase may take the whole reserve. The three fractions are the
	// per-phase budget, frozen by P3.5 against the slider matrix `experiments/pt-p3-check.js` §6
	// measures: worst peaks over the matrix are melt 5.9% of the base (the initial condition's
	// own mushy band), air 1.4%, deposits 0.03%, so each line sits above its own measurement and
	// the sum stays the 0.20 the frame budget was proven at (P3.0's candidate 0.05 sat *below*
	// the initial condition's melt population). sim.js turns the sum into partCap (a save records
	// partCap and a load refuses a different one rather than reinterpreting a pool, §6 of the plan).
	resMelt: 0.08,               // mobile melt waiting to rise, to intrude or to be erupted
	resAir: 0.03,                // clasts in flight: a fountain is presentation, but it is mass
	resDep: 0.09,                // landed deposits before they merge and weld into the crust
	partBase: 0,                 // derived at init: mpc * nx * (ny - 1), the marker population
	partCap: 32768,              // derived at init, never set by hand: base * (1 + resFrac)
	// P3.0 phase routing (0.3.0-p3-plan.md §1.3). The phase is a transport/material state,
	// not a plate id, and the three masks below are that table's columns -- read once per
	// parcel per pass, so a routing change is a table edit and not a kernel edit. The enum
	// values are implementation detail; the masks are not. Airborne material is in none of
	// the three: it advances on wall time only (§2 of the P3 plan) and is excluded from grid
	// repair, conduction, clustering and every crust diagnostic.
	PH: { mantle: 0, melt: 1, air: 2, dep: 3 },
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
// The derived solidus of the phase law above; phase.js reads these rather than re-deriving
// them, so the curve has one owner. meltDrop is the drop from the deep asymptote to the
// surface, and meltInvLam is the decay that puts the third anchor exactly where it belongs:
// u(meltOnset)^2 = meltDeep / meltDrop, i.e. Ts(meltOnset) = 1.
PTP.meltDrop = 1 + PTP.meltSup - PTP.meltSurf;
PTP.meltInvLam = (Math.sqrt(PTP.meltDrop / PTP.meltSup) - 1) / PTP.meltOnset;
PTP.meltU0 = 1 / (1 + PTP.meltOnset * PTP.meltInvLam);
PTP.meltDeep = PTP.meltDrop * PTP.meltU0 * PTP.meltU0;
// the pool's reserve as one fraction: sim.js multiplies the base population by it
PTP.resFrac = PTP.resMelt + PTP.resAir + PTP.resDep;
// the contact pass's slab direction, in radians, from the one dip angle above
PTP.contactCos = Math.cos(PTP.contactDip * Math.PI / 180);
PTP.contactSin = Math.sin(PTP.contactDip * Math.PI / 180);

// The routing masks of §1.3 of the P3 plan, indexed by PH and built from the enum so a
// renamed phase cannot silently land in the wrong column:
//   PH_GRID   the parcel is deposited to the node field and receives the conduction
//             increment -- the adjoint pair of grid.js, which is why one mask owns both
//   PH_ADV    the parcel rides the geological flow map. Mobile melt is *not* in it: it gets
//             its own buoyant rise rule (P3.2) rather than the mantle's advection
//   PH_SOLID  the parcel is eligible for the crust pass's bonds, clusters and rigid fit
// Airborne material is in none of the three, and a parcel that is not solid carries no bond
// state at all (solid.js strength zeroes its age, damage and mu).
(function () {
	var ph = PTP.PH, n = 0, k;
	for (k in ph) if (ph[k] > n) n = ph[k];
	PTP.PH_N = n + 1;
	PTP.PH_NAME = new Array(PTP.PH_N);
	PTP.PH_GRID = new Uint8Array(PTP.PH_N);
	PTP.PH_ADV = new Uint8Array(PTP.PH_N);
	PTP.PH_SOLID = new Uint8Array(PTP.PH_N);
	for (k in ph) PTP.PH_NAME[ph[k]] = k;
	PTP.PH_GRID[ph.mantle] = 1; PTP.PH_ADV[ph.mantle] = 1; PTP.PH_SOLID[ph.mantle] = 1;
	PTP.PH_GRID[ph.melt] = 1;
	PTP.PH_GRID[ph.dep] = 1; PTP.PH_ADV[ph.dep] = 1; PTP.PH_SOLID[ph.dep] = 1;
}());

// the window in display space: eta is the asinh depth coordinate, so zoom and pan are
// exact in eta; kx is km per pixel horizontally
PTP.view = {
	cx: PTP.wrap / 2,
	kx: PTP.winW / PTP.cw,
	eT: -Math.asinh(PTP.winTop / PTP.yLin),      // the sky: eta < 0 above the surface
	eB: Math.asinh(PTP.winBot / PTP.yLin)
};

if (typeof module !== 'undefined' && module.exports) module.exports = PTP; else window.PTP = PTP;
