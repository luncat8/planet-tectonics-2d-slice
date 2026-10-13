// pt/sim.js — 0.3.0 P1/P2: the frame pipeline (plan §5) and the page bootstrap. Slot G0 runs
// inline (clocks and the slider); the rest sit in slots so the later milestones can fill
// them without touching this file:
//   G1 markers -> grid      G2 buoyancy + Stokes      G3 conduction + advection
//   G4 equilibrium + solid + slab   G5 segregation   G6 eruptions   G7 surface   G8 diag
// G4 is P3.1's equilibrium mapping (phase.js) followed by P2.1's crust law: age, strength,
// plate clusters, P4.0's contact response and the rigid projection (solid.js), and then P4.1's
// slab pass, which takes over the material the contact pass bent below its own scope (slab.js).
// G5 is P4.2's slab dehydration into the wedge (arc.js) followed by P3.2's segregation
// (melt.js); G6 is P3.3's conduits and metered eruption supply (vent.js), followed by P3.4's
// conserved vent-to-air transfer, wall-clock flight, landing and surface cooling (flight.js).
// Geological kernels no-op at dtGeo = 0; only an explicitly supplied wall interval may move
// airborne material while geology is paused.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.PTS;
var F = (typeof module !== 'undefined' && module.exports) ? require('./fluid.js') : window.PTF;
var SC = (typeof module !== 'undefined' && module.exports) ? require('./solid.js') : window.PTSC;
var SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.PTSLAB;
var ARC = (typeof module !== 'undefined' && module.exports) ? require('./arc.js') : window.PTARC;
var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;
var MT = (typeof module !== 'undefined' && module.exports) ? require('./melt.js') : window.PTMELT;
var VENT = (typeof module !== 'undefined' && module.exports) ? require('./vent.js') : window.PTVENT;
var FLIGHT = (typeof module !== 'undefined' && module.exports) ? require('./flight.js') : window.PTFLIGHT;
var PTPOOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;
var PERF = (typeof module !== 'undefined' && module.exports) ? require('../perf.js') : window.COLPERF;

var SIM = {
	M: null, S: S,
	t: 0,              // Myr since reset
	frame: 0,
	dt: 0,             // Myr per rendered frame, from the clock slider
	sub: 0, subDt: 0,  // fluid solves in the rendered frame and their Myr step
	phase: 0,          // the initial condition's phase, fixed per reset so a run replays
	k: [null, null, null, null, null, null, null, null, null],   // G1..G8

	// build the mesh and the state (plan §3.3). The mesh size is a runtime switch: the
	// plan's §7 levers trade resolution for the frame budget.
	init: function () {
		// The pool's capacity (0.3.0-p3-plan.md §3.1): the base population is mpc markers per
		// interior node, and the reserve above it is what detached melt, airborne clasts and
		// landed deposits may add. partCap is the parameter a capture records and a load
		// refuses to reinterpret (§6 of that plan); experiments/pt-p3-budget.js measured the
		// reserve fractions at every quality rung before they became the default.
		P.partBase = P.mpc * P.mesh.nx * (P.mesh.ny - 1);
		P.partCap = P.partBase + Math.ceil(P.partBase * P.resFrac);
		this.M = G.mesh(P.mesh.nx, P.mesh.ny, P.wrap, P.depth, P.yLin);
		G.alloc(this.M);
		S.init(this.M, this.phase);
		this.dt = P.sl.kyr / 1000;
		this.sub = 0; this.subDt = 0;
	},

	// a fresh planet at the current seed, keeping the solver and the buffers
	reset: function () {
		this.phase = 6.283185307179586 * (P.seed * 0.6180339887498949 % 1);
		this.t = 0; this.frame = 0;
		S.reset(this.M, this.phase);
		G.scatterT(this.M, S, S.Tg, S.mug);   // a paused page at t = 0 already shows the planet
		F.diag(this.M, S);
	},

	mesh: function (nx, ny) {
		P.mesh.nx = nx; P.mesh.ny = ny;
		this.init();
		this.reset();
	},

	// G0: the clock. Nothing else here yet: P2 adds the solid's own cadence.
	k0: function () {
		this.t += this.dt;
		this.frame++;
	},

	step: function (wallDt) {
		if (wallDt === undefined) wallDt = P.flightFrame;
		this.k0();
		var f, n = 0, ds = 0, t0 = this.t - this.dt, s, i;
		if (this.dt > 0) {
			// The clock controls how much geology one *rendered* frame represents, not the
			// transport CFL. A 500 kyr display frame is ten validated 50 kyr fluid updates, so
			// its result matches ten ordinary frames instead of skipping the narrow top rows.
			n = Math.ceil(this.dt / P.dtFluidMax);
			if (n < 1) n = 1;
			ds = this.dt / n;
			for (s = 0; s < n; s++) {
				for (i = 1; i < 8; i++) {
					f = this.k[i];
					if (f) f(this.M, S, ds, t0 + (s + 1) * ds);
				}
				F.wall(this.M, S);
				S.wall += S.d.wallRate * ds;
			}
		}
		this.sub = n; this.subDt = ds;
		// Supply is one conserved batch per vent per rendered geological frame; its mass is
		// proportional to the whole geological interval. The trajectory then advances on the
		// independent wall interval, including when dtGeo is zero.
		FLIGHT.run(this.M, S, this.dt, wallDt);
		f = this.k[8];
		if (f) f(this.M, S, this.dt, this.t);
	},

	// A UI pause stops geology, not a clast already in flight. Inventory is refreshed because
	// a wall-only landing changes phase counts even though it changes no total stock.
	wall: function (wallDt) {
		if (wallDt === undefined) wallDt = P.flightFrame;
		FLIGHT.run(this.M, S, 0, wallDt);
		PTPOOL.inventory(S);
	},

	// n frames with no rendering (fixtures); the diagnostics are part of a frame. Passing an
	// explicit wall interval fixes the presentation sequence; omitted means a 60 Hz sequence.
	run: function (n, wallDt) {
		for (var i = 0; i < n; i++) this.step(wallDt);
		return S.hash();
	}
};

// the P1 kernels (plan §5) and P2.1's G4 (solid.js). G2 needs the buoyancy coefficient: RaK
// is Ra * kappa / depth^3 (params.js), so a mesh change does not change the physics.
SIM.k[1] = function (M, S) { F.transfer(M, S); };
SIM.k[2] = function (M, S) { F.flow(M, S, P.RaK); };
SIM.k[3] = function (M, S, dt) { F.move(M, S, dt, P.kappa, P.flip); };
// G4: phase equilibrium first, then the crust pass. The equilibrium maps the enthalpy the
// substep's conduction delivered back to temperature and melt fraction, which is what the
// strength law, the clusters and the rigid projection then read (0.3.0-p3-plan.md §3). Both
// halves no-op at dt = 0: a paused frame reports, it does not melt or weld.
// G4's tail is P4.1's slab pass: it needs the contact result the crust pass just produced
// (the bending band is what puts material below yCrust, the line the contact pass owns) and
// it has to run before G5, so a parcel that left for the deep inventory cannot also shed melt
// this frame (0.3.0-p4-plan.md §2).
SIM.k[4] = function (M, S, dt) {
	if (!(dt > 0) || !S.n) return;
	PHASE.equil(M, S);
	if (P.solid) SC.crust(M, S, dt);
	SLAB.run(M, S, dt);
};
// G5: P4.2's water release from the slab into the wedge (arc.js, 0.3.0-p4-plan.md §2, §3
// P4.2), then melt segregation and intrusive storage (melt.js, 0.3.0-p3-plan.md §3). The
// dehydration runs first so the solidus depression it produces in the wedge is immediately
// separated and risen by the P3.2 path in the same substep.
SIM.k[5] = function (M, S, dt) {
	ARC.run(M, S, dt);
	MT.run(M, S, dt);
};
// G6: conduits meter the chamber into vent schedules, while previously landed ejecta cools
// against the surface wall on geological time. Vent stock becomes one airborne batch after
// all fluid substeps, in step(), so a rendered frame cannot create ten overlapping clasts just
// because its geological clock required ten transport solves.
SIM.k[6] = function (M, S, dt) { VENT.run(M, S, dt); FLIGHT.cool(M, S, dt); };
// G7 runs after G4 because it reads the welded strength and damage the crust pass leaves
// behind (plan §5)
SIM.k[7] = function (M, S, dt) { F.surface(M, S, dt); };
SIM.k[8] = function (M, S) { F.diag(M, S); };

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;

// the page bootstrap: the engine is built first, then the view and the panel, then the loop.
// sim.js is loaded last in both pages so PTRNDR and PTUI exist when bootstrap runs.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	SIM.init();
	SIM.reset();
	PTRNDR.init(document.getElementById('c'), SIM.M);      // the tables PTUI's preset rewrites
	PTUI.init(SIM);
	PTUI.updateHud(SIM);
	var lastNow = 0;
	function tick(now) {
		var a = performance.now(), wallDt = lastNow ? (now - lastNow) / 1000 : 0;
		lastNow = now;
		if (!PTUI.paused || PTUI.stepOnce) { PTUI.stepOnce = false; SIM.step(wallDt); }
		else SIM.wall(wallDt);
		var b = performance.now();
		PTRNDR.redraw(SIM.M, S);
		var c = performance.now();
		PERF.msSim = PERF.f(PERF.msSim, b - a);
		PERF.msDraw = PERF.f(PERF.msDraw, c - b);
		if (PERF.tick(now)) PTUI.updateHud(SIM);
		window.requestAnimationFrame(tick);
	}
	window.requestAnimationFrame(tick);
}
