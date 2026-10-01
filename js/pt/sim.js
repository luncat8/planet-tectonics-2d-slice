// pt/sim.js — 0.3.0 P1/P2: the frame pipeline (plan §5) and the page bootstrap. Slot G0 runs
// inline (clocks and the slider); the rest sit in slots so the later milestones can fill
// them without touching this file:
//   G1 markers -> grid      G2 buoyancy + Stokes      G3 conduction + advection
//   G4 solid   G5 phase change   G6 eruptions   G7 surface   G8 diagnostics   (P2..P5)
// G4 is P2.1's crust law: age, strength, plate clusters and the rigid projection (solid.js).
// Every kernel no-ops at dtGeo = 0: a paused frame reports, it does not change the state.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.PTS;
var F = (typeof module !== 'undefined' && module.exports) ? require('./fluid.js') : window.PTF;
var SC = (typeof module !== 'undefined' && module.exports) ? require('./solid.js') : window.PTSC;

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
		P.partCap = P.mpc * P.mesh.nx * (P.mesh.ny - 1) + 256;
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

	step: function () {
		this.k0();
		if (!(this.dt > 0)) { this.sub = 0; this.subDt = 0; return; }
		// The clock controls how much geology one *rendered* frame represents, not the
		// transport CFL. A 500 kyr display frame is ten validated 50 kyr fluid updates, so its
		// result matches ten ordinary frames instead of skipping across the narrow top rows.
		var n = Math.ceil(this.dt / P.dtFluidMax);
		if (n < 1) n = 1;
		var ds = this.dt / n, t0 = this.t - this.dt, s, i, f;
		this.sub = n; this.subDt = ds;
		for (s = 0; s < n; s++) {
			for (i = 1; i < 8; i++) {
				f = this.k[i];
				if (f) f(this.M, S, ds, t0 + (s + 1) * ds);
			}
			F.wall(this.M, S);
			S.wall += S.d.wallRate * ds;
		}
		f = this.k[8];
		if (f) f(this.M, S, this.dt, this.t);
	},

	// n frames with no rendering (fixtures); the diagnostics are part of a frame
	run: function (n) {
		for (var i = 0; i < n; i++) this.step();
		return S.hash();
	}
};

// the P1 kernels (plan §5) and P2.1's G4 (solid.js). G2 needs the buoyancy coefficient: RaK
// is Ra * kappa / depth^3 (params.js), so a mesh change does not change the physics.
SIM.k[1] = function (M, S) { F.transfer(M, S); };
SIM.k[2] = function (M, S) { F.flow(M, S, P.RaK); };
SIM.k[3] = function (M, S, dt) { F.move(M, S, dt, P.kappa, P.flip); };
SIM.k[4] = function (M, S, dt) { if (P.solid) SC.crust(M, S, dt); };
// G7 runs after G4 because it reads the welded strength and damage the crust pass leaves
// behind (plan §5)
SIM.k[7] = function (M, S, dt) { F.surface(M, S, dt); };
SIM.k[8] = function (M, S) { F.diag(M, S); };

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;

// the page bootstrap: the engine is built first, then the view and the panel, then the loop.
// sim.js is loaded last in particles.html so both are defined by the time this runs.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	SIM.init();
	SIM.reset();
	PTRNDR.init(document.getElementById('c'), SIM.M);      // the tables PTUI's preset rewrites
	PTUI.init(SIM);
	PTUI.updateHud(SIM);
	function tick(now) {
		var a = performance.now();
		if (!PTUI.paused || PTUI.stepOnce) { PTUI.stepOnce = false; SIM.step(); }
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
