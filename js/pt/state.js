// pt/state.js — 0.3.0 P1: all fixed-capacity state (plan §3). Structure of arrays, allocated
// once, mutated in place: nothing here allocates in the frame loop.
//
// The markers are the mantle and the grid is its view of them. Each marker carries its
// temperature; the grid field Tg is rebuilt from them every frame (grid.js scatterT) and the
// conduction increment is handed back to them (gatherDT), so heat moves between the two
// representations but is not created by either. In P1 the marker set is fixed: one marker
// per interior node, each carrying the node's own measure, so the marker heat equals the
// field's heat exactly and the ledger (plan §3.4) has nothing to balance but the walls.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;

var PTS = {
	n: 0,
	x: null, y: null, e: null,      // km, km (depth), asinh(y/yLin) — e is carried, not derived
	T: null,                        // 0 at the surface, 1 at the CMB
	m: null,                        // mass per unit out-of-plane depth, km2 (fixed in P1)
	vx: null, vy: null,             // km/Myr, the interpolated grid velocity
	Tg: null,                        // node temperature field (ny+1) * nx
	Mg: null, MgS: null,            // pressure-release melt indicator and its transport scratch
	rowT: null,                     // horizontally averaged T at each node row, reused by melt
	u: null, v: null,               // staggered velocity fields
	empty: 0, clamp: 0,             // diagnostics of the last frame: nodes with no marker, and
	                                // markers that had to be kept inside the box
	ledger: 0,                      // km2 * T, the heat the markers received from the walls since reset
	wall: 0,                        // the same heat read from the operator's side (sim.js k[8])
	moved: 0, redeals: 0,           // markers the last repair moved; lattice re-deals since reset
	order: null,                    // marker indices, bucketed by node (grid.js reseed)
	// per-frame diagnostics, mutated in place: the HUD formats them at 2 Hz
	d: {
		nu: 0, uMax: 0, vMax: 0, wells: 0, heat: 0, mHeat: 0, tMin: 0, tMax: 0,
		fluxTop: 0, fluxBot: 0, wallRate: 0, drift: 0, melt: 0, meltY: 0
	},

	// allocate for a mesh (idempotent: the quality switch can change the mesh size)
	init: function (M, phase) {
		var cap = P.partCap;
		if (!this.x || this.x.length < cap) {
			this.x = new Float64Array(cap); this.y = new Float64Array(cap); this.e = new Float64Array(cap);
			this.T = new Float64Array(cap); this.m = new Float64Array(cap);
			this.vx = new Float64Array(cap); this.vy = new Float64Array(cap);
			this.order = new Int32Array(cap);
		}
		if (!this.Tg || this.Tg.length !== M.n) {
			this.Tg = new Float64Array(M.n);
			this.Mg = new Float64Array(M.n); this.MgS = new Float64Array(M.n);
			this.rowT = new Float64Array(M.ny + 1);
			this.u = new Float64Array(M.ny * M.nx);
			this.v = new Float64Array((M.ny + 1) * M.nx);
		}
		this.reset(M, phase || 0);
	},

	// one marker per interior node, mass = the node measure dEta * jN * dx: the same weight
	// the conduction operator conserves (grid.js, the lap identity), so the two heats agree
	// to round-off. The cell measure jC is *not* it -- mixing the two puts the marker heat
	// 2.6% above the field's and puts a constant offset under every ledger reading.
	// The initial temperature
	// profile is the plan's §8 P1 state: 'rb' is pt-conv.js's own conduction profile plus one
	// cosine perturbation (the fixture compares against it), 'cool' is a hot planet with a
	// cold skin, 'blob' is one plume head under a conduction profile.
	reset: function (M, phase) {
		var nx = M.nx, ny = M.ny, i, j, k, p = 0, m, T, rnd = 12345, e;
		var mpc = P.mpc, node = M.dEta * M.jN[0] * M.dx;
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) {
			m = M.dEta * M.jN[j] * M.dx / mpc;
			T = this.icT(M, i, j, phase);
			for (k = 0; k < mpc; k++) {
				// a deterministic sub-node offset: markers on a perfect lattice make the
				// transfer's quadrature resonate with the grid, and the offsets are the cure
				// (the seed is fixed, so a run still replays exactly)
				rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
				this.x[p] = (i + (rnd / 0x7fffffff - 0.5)) * M.dx;
				rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
				e = (j + (rnd / 0x7fffffff - 0.5)) * M.dEta;
				if (e < M.eMin) e = M.eMin; else if (e > M.eMax) e = M.eMax;
				this.e[p] = e;
				this.y[p] = M.yLin * Math.sinh(e);
				this.T[p] = T;
				this.m[p] = m;
				this.vx[p] = 0; this.vy[p] = 0;
				p++;
			}
		}
		this.n = p;
		this.empty = 0; this.clamp = 0; this.ledger = 0; this.wall = 0;
		this.moved = 0; this.redeals = 0;
		this.Tg.fill(0); this.Mg.fill(0); this.MgS.fill(0); this.rowT.fill(0);
		this.u.fill(0); this.v.fill(0);
		for (i = 0; i < nx; i++) this.Tg[ny * nx + i] = 1;
		this.d.nu = 0; this.d.uMax = 0; this.d.vMax = 0; this.d.wells = 0;
		this.d.heat = 0; this.d.tMin = 0; this.d.tMax = 0; this.d.fluxTop = 0; this.d.fluxBot = 0;
		this.d.melt = 0; this.d.meltY = 0;
	},

	// the initial temperature of the node at (i, j)
	icT: function (M, i, j, phase) {
		var y = M.yN[j], f = y / M.depth, x = i * M.dx;
		var base;
		if (P.ic === 'cool') base = 1 - Math.exp(-y / P.skin);
		else base = f;
		var pert = Math.sin(Math.PI * f);
		var ph = phase;
		var T = base + P.icAmp * pert * Math.cos(2 * Math.PI * P.icMode * x / M.wrap + ph);
		if (P.ic === 'blob') {
			var dc = (x - 0.5 * M.wrap) / (0.08 * M.wrap), dz = (f - 0.72) / 0.12;
			T += 0.25 * Math.exp(-dc * dc - dz * dz);
		}
		return T < 0 ? 0 : (T > 1 ? 1 : T);
	},

	// the marker count per node, worst node first: a marker field that has drifted into
	// holes and piles is the thing to look at when the picture gets noisy
	counts: function (M, out) {
		var nx = M.nx, p, q;
		out.fill(0);
		for (p = 0; p < this.n; p++) {
			q = (Math.round(this.e[p] / M.dEta)) * nx + Math.round(this.x[p] / M.dx);
			q -= Math.floor(q / nx) * nx;
			if (q >= 0 && q < out.length) out[q]++;
		}
	},

	// a fingerprint of the state, for "did this frame change anything" checks
	hash: function () {
		var s = 0, i;
		for (i = 0; i < this.n; i += 7) s += this.x[i] * 1.7 + this.y[i] * 0.3 + this.T[i] * 31.1;
		return (s % 1e9) + this.n;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = PTS; else window.PTS = PTS;
