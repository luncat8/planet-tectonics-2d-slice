// pt/fluid.js — 0.3.0 P1: the fluid kernels of the frame pipeline (plan §5, G1..G3 and G8).
// Each one no-ops at zero population; the clock is the caller's business (sim.js).
//
// The order inside one frame is the plan's: the markers make the grid, the grid makes the
// flow, conduction happens on the grid, the increment goes back to the markers, and then
// the markers are carried by the flow. Nothing is projected: the flow is exactly
// divergence-free by construction (grid.js), so the marker field is not squeezed by a
// residual it would have to absorb.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;

var F = {
	// markers -> node temperature (G1)
	transfer: function (M, S) {
		if (!S.n) return;
		G.scatterT(M, S, S.Tg);
	},

	// buoyancy and the Stokes solve (G2): the velocity field the whole frame rides on
	flow: function (M, S, RaK) {
		G.stokes(M, S.Tg, S.u, S.v, RaK);
	},

	// conduction on the grid, the increment back to the markers, the markers move (G3), and the
	// coverage is repaired if the flow has crowded the cloud off some nodes (grid.js reseed:
	// the cheap local repair, and the lattice re-deal only if the repair cannot do the job --
	// a standing re-deal cadence is not used, measured: re-dealing every 16 frames held a
	// convecting box at Nu = 1.00, and every 64 frames was no better).
	move: function (M, S, dt, kappa, flip) {
		if (!(dt > 0)) return;
		G.diffuse(M, S.Tg, dt, kappa, M.inc);
		G.gatherDT(M, S, M.inc, S.Tg, flip);
		G.gatherVel(M, S, M.pr, dt);
		if (S.empty) G.reseed(M, S, false);
	},

	// G8: the numbers the HUD prints and the fixtures gate on. Cheap enough to run every
	// frame (two passes over the markers), and averaged over the HUD's 2 Hz pulse so the
	// reported extremes are not a single frame's noise.
	diag: function (M, S) {
		var nx = M.nx, ny = M.ny, i, j, T = S.Tg, u = S.u, v = S.v, d = S.d;
		// The boundary gradients are one-sided across the *cell* next to the wall, on the cell
		// midpoint metric jC -- the same coefficient the conduction operator's row balance
		// uses (grid.js, the col[j-1]/jC[j-1] ladder), so these two numbers are the flux the
		// operator actually applied and dField closes against them. Reading the wall node's
		// own metric jN[ny] instead puts the bottom distance 2.6% too long, which is exactly
		// the bias the conduction-only check shows as a phantom wall flux.
		var top = 0, bot = 0, um = 0, vm = 0, wells = 0, prev = 0, first = 0, col;
		for (i = 0; i < nx; i++) {
			top += (T[nx + i] - T[i]) / (M.dEta * M.jC[0]);
			bot += (T[ny * nx + i] - T[(ny - 1) * nx + i]) / (M.dEta * M.jC[ny - 1]);
		}
		d.fluxTop = top / nx * M.depth;
		d.fluxBot = bot / nx * M.depth;
		for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
			var a = Math.abs(u[j * nx + i]);
			if (a > um) um = a;
		}
		for (j = 0; j <= ny; j++) for (i = 0; i < nx; i++) {
			var b = Math.abs(v[j * nx + i]);
			if (b > vm) vm = b;
		}
		// upwellings: sign changes of the depth-averaged vertical velocity (plan §2.2)
		first = 0;
		for (i = 0; i < nx; i++) {
			col = 0;
			for (j = 0; j <= ny; j++) col += v[j * nx + i];
			var cur = col > 0;
			if (!first) { prev = cur; first = 1; continue; }
			if (cur !== prev) { wells++; prev = cur; }
		}
		d.nu = d.fluxTop;
		d.wallRate = (d.fluxBot - d.fluxTop) * P.kappa * M.wrap / M.depth;   // heat per Myr
		d.uMax = um * P.cmYr;              // km/Myr -> cm/yr
		d.vMax = vm * P.cmYr;
		d.wells = wells >> 1;
		// d.heat is the field's heat in the mesh measure -- the integral the conduction
		// operator conserves exactly. d.mHeat is the same heat carried on the markers: the
		// two differ by the transfer's quadrature error, and the fixture watches the gap.
		var heat = 0;
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) heat += M.dEta * M.jN[j] * M.dx * T[j * nx + i];
		var mheat = 0, tmin = 9e9, tmax = -9e9, p, tp;
		for (p = 0; p < S.n; p++) {
			tp = S.T[p];
			mheat += S.m[p] * tp;
			if (tp < tmin) tmin = tp;
			if (tp > tmax) tmax = tp;
		}
		d.heat = heat; d.mHeat = mheat;
		d.tMin = tmin; d.tMax = tmax;
	},

	// The ledger is accumulated where the heat changes hands, in gatherDT: it is the marker
	// field's own book, and the marker heat closes against it to round-off *by construction*.
	// That is the point -- it is the number the HUD can be trusted to print. The walls' flux
	// is the same heat read from the operator's side ((fluxBot - fluxTop) * kappa * wrap /
	// depth, accumulated in sim.js as S.wall) and the two agree only up to how well the
	// markers sample the conduction intake; that gap is the physics error, and it is what
	// pt-check gates.
};

if (typeof module !== 'undefined' && module.exports) module.exports = F; else window.PTF = F;
