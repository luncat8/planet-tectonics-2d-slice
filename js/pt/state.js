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
	age: null,                      // Myr since the marker last froze (plan §3.1): the
	                                // welding clock of the crust law (solid.js)
	mu: null,                       // strength 0..1 from T and age (plan §4.2); >=
	                                // clusterMin means the marker is plate, not fluid
	dmg: null,                      // accumulated bond damage (plan §4.2): 1 = bonds gone
	pLoad: null, pCnt: null,        // this frame's load integral per marker: the sum of the
	                                // pair excess and the number of pairs it was measured
	                                // over, so the damage rate is per *mean* excess and does
	                                // not scale with local marker density (solid.js pair)
	Tg: null,                       // node temperature field (ny+1) * nx
	mug: null,                      // node mean strength, the raster's crust overlay
	Mg: null, MgS: null,            // pressure-release melt indicator and its transport scratch
	rowT: null,                     // horizontally averaged T at each node row, reused by melt
	u: null, v: null,               // staggered velocity fields
	empty: 0, clamp: 0,             // diagnostics of the last frame: nodes with no marker, and
	                                // markers that had to be kept inside the box
	ledger: 0,                      // km2 * T, the heat the markers received from the walls since reset
	wall: 0,                        // the same heat read from the operator's side (sim.js k[8])
	moved: 0, redeals: 0,           // markers the last repair moved; lattice re-deals since reset
	order: null,                    // marker indices, bucketed by node (grid.js reseed)
	// cluster scratch for the crust pass (solid.js), sized with the marker set. Clusters are
	// recomputed every frame from the strong markers' adjacency, so this is workspace, not
	// state: par is the union-find, cl the cluster of each marker, and the cs* arrays are the
	// per-cluster accumulators (mass, centroid, velocity fit)
	par: null, cl: null, csOf: null,
	csM: null, csX: null, csY: null, csVX: null, csVY: null, csW: null, csR2: null,
	csS: null, csP: null, csCnt: null,
	csRef: null, csN: 0,            // csN: clusters of the last crust pass (plate markers only)
	// the surface elevation profile (G7): zh is the drawn horizon, zRaw its target, and the
	// per-column buffers hold filtered crust samples and the shallow plate boundary state
	zh: null, zRaw: null, zSmooth: null,
	hLid: null, hRaw: null, rft: null, colM: null,
	surfaceY: null, surfaceV: null, surfaceCl: null, jIso: 1,
	bandA: null, bandP: null,       // the initial perturbation's seeded band (icT)
	// per-frame diagnostics, mutated in place: the HUD formats them at 2 Hz
	d: {
		nu: 0, uMax: 0, vMax: 0, wells: 0, heat: 0, mHeat: 0, tMin: 0, tMax: 0,
		fluxTop: 0, fluxBot: 0, wallRate: 0, drift: 0, melt: 0, meltY: 0,
		lid: 0, plates: 0, plV: 0, zMin: 0, zMax: 0
	},

	// allocate for a mesh (idempotent: the quality switch can change the mesh size)
	init: function (M, phase) {
		var cap = P.partCap;
		if (!this.x || this.x.length < cap) {
			this.x = new Float64Array(cap); this.y = new Float64Array(cap); this.e = new Float64Array(cap);
			this.T = new Float64Array(cap); this.m = new Float64Array(cap);
			this.vx = new Float64Array(cap); this.vy = new Float64Array(cap);
			this.age = new Float64Array(cap); this.mu = new Float64Array(cap);
			this.dmg = new Float64Array(cap);
			this.pLoad = new Float64Array(cap); this.pCnt = new Int32Array(cap);
			this.par = new Int32Array(cap); this.cl = new Int32Array(cap); this.csOf = new Int32Array(cap);
			this.csM = new Float64Array(cap); this.csX = new Float64Array(cap);
			this.csY = new Float64Array(cap); this.csVX = new Float64Array(cap);
			this.csVY = new Float64Array(cap); this.csW = new Float64Array(cap);
			this.csR2 = new Float64Array(cap); this.csRef = new Float64Array(cap);
			this.csS = new Float64Array(cap); this.csP = new Float64Array(cap);
			this.csCnt = new Int32Array(cap);
			this.order = new Int32Array(cap);
		}
		if (!this.Tg || this.Tg.length !== M.n) {
			this.Tg = new Float64Array(M.n);
			this.mug = new Float64Array(M.n);
			this.Mg = new Float64Array(M.n); this.MgS = new Float64Array(M.n);
			this.rowT = new Float64Array(M.ny + 1);
			this.u = new Float64Array(M.ny * M.nx);
			this.v = new Float64Array((M.ny + 1) * M.nx);
		}
		if (!this.zh || this.zh.length !== M.nx) {
			this.zh = new Float64Array(M.nx); this.zRaw = new Float64Array(M.nx);
			this.zSmooth = new Float64Array(M.nx);
			this.hLid = new Float64Array(M.nx); this.hRaw = new Float64Array(M.nx);
			this.rft = new Float64Array(M.nx); this.colM = new Float64Array(M.nx);
			this.surfaceY = new Float64Array(M.nx); this.surfaceV = new Float64Array(M.nx);
			this.surfaceCl = new Int32Array(M.nx);
		}
		// the compensation depth as a node row: the last row at or above P.yIso (the top
		// row, the surface boundary, is never included -- it carries no markers)
		this.jIso = 1;
		for (var jj = 1; jj < M.ny; jj++) if (M.yN[jj] <= P.yIso) this.jIso = jj;
		this.reset(M, phase || 0);
	},

	// one marker per interior node, mass = the node measure dEta * jN * dx: the same weight
	// the conduction operator conserves (grid.js, the lap identity), so the two heats agree
	// to round-off. The cell measure jC is *not* it -- mixing the two puts the marker heat
	// 2.6% above the field's and puts a constant offset under every ledger reading.
	// The initial temperature
	// profile is the plan's §8 P1 state: 'rb' is pt-conv.js's own conduction profile plus one
	// cosine perturbation (the fixture compares against it), 'cool' is a hot planet with a
	// cold skin, 'hot' is the P2 cooling start (nearly uniform hot, the lid has to grow from
	// the wall), 'blob' is one plume head under a conduction profile.
	reset: function (M, phase) {
		var nx = M.nx, ny = M.ny, i, j, k, p = 0, m, T, rnd = 12345, e;
		var mpc = P.mpc, node = M.dEta * M.jN[0] * M.dx;
		this.band(phase);
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
		this.moved = 0; this.redeals = 0; this.csN = 0;
		this.Tg.fill(0); this.mug.fill(0); this.Mg.fill(0); this.MgS.fill(0); this.rowT.fill(0);
		this.age.fill(0); this.mu.fill(0); this.dmg.fill(0);
		this.pLoad.fill(0); this.pCnt.fill(0);
		this.u.fill(0); this.v.fill(0);
		// a fresh planet is flat: the horizon relaxes up from the reference sea level as the
		// upper column's buoyancy, convergence and welded lid develop
		this.zh.fill(0); this.zRaw.fill(0); this.zSmooth.fill(0);
		this.hLid.fill(0); this.hRaw.fill(0); this.rft.fill(0); this.colM.fill(0);
		this.surfaceY.fill(0); this.surfaceV.fill(0); this.surfaceCl.fill(-1);
		for (i = 0; i < nx; i++) this.Tg[ny * nx + i] = 1;
		this.d.nu = 0; this.d.uMax = 0; this.d.vMax = 0; this.d.wells = 0;
		this.d.heat = 0; this.d.tMin = 0; this.d.tMax = 0; this.d.fluxTop = 0; this.d.fluxBot = 0;
		this.d.melt = 0; this.d.meltY = 0;
		this.d.lid = 0; this.d.plates = 0; this.d.plV = 0;
		this.d.zMin = 0; this.d.zMax = 0;
	},

	// the initial temperature of the node at (i, j)
	// the broadband part of the initial perturbation (params.js icBand): per-mode amplitude
	// and phase drawn from the seed, normalised so the band carries icBand of the energy
	band: function (phase) {
		var K = P.icBandMax, k, a, sum = 0, rnd = (P.seed * 7919 + 1) & 0x7fffffff;
		if (!this.bandA || this.bandA.length !== K + 1) {
			this.bandA = new Float64Array(K + 1); this.bandP = new Float64Array(K + 1);
		}
		for (k = 1; k <= K; k++) {
			rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
			a = 0.25 + rnd / 0x7fffffff;
			rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
			this.bandA[k] = a;
			this.bandP[k] = phase + 6.283185307179586 * rnd / 0x7fffffff;
			sum += a * a;
		}
		a = Math.sqrt(P.icBand / sum);
		for (k = 1; k <= K; k++) this.bandA[k] *= a;
	},

	icT: function (M, i, j, phase) {
		var y = M.yN[j], f = y / M.depth, x = i * M.dx;
		var base;
		if (P.ic === 'cool') base = 1 - Math.exp(-y / P.skin);
		else if (P.ic === 'hot') base = 1;
		else base = f;
		var pert = Math.sin(Math.PI * f);
		var ph = phase;
		var k, wave = Math.sqrt(1 - P.icBand) * Math.cos(2 * Math.PI * P.icMode * x / M.wrap + ph);
		for (k = 1; P.icBand > 0 && k <= P.icBandMax; k++) wave += this.bandA[k] * Math.cos(2 * Math.PI * k * x / M.wrap + this.bandP[k]);
		var T = base + P.icAmp * pert * wave;
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
