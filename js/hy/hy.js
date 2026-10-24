// hy/hy.js — 0.5.0 M1: the hybrid page's engine skeleton (0.5.0-plan.md §4, milestone M1).
//
// The hybrid owns its liquid in *cells* and its solid in *parcels*. M1 builds the cell half's
// shell and nothing else: the 0.3 (x, eta) asinh mesh at 256 x 24, the conserved fields
// (H, cF, cW), the equilibrium readings (T, melt) the phase law gives them, the parcel pool
// attached and empty, the clock, the readings the scenario harness asks for, and a raster
// view of the temperature field. There is no projection, no advection and no crust: `features`
// is empty, so every S1-S4 gate reads pending. M2 fills the liquid, M3 the skin.
//
// One deliberate change from 0.3 that this file already honours: nx is *not* required to be a
// power of two, because there is no global transform to size. It stays 256 only so the two
// lines stay comparable rung for rung.
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('../pc/params.js') : root.PCP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('../pc/phase.js') : root.PCPHASE;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('../pc/pool.js') : root.PCPOOL;
	var PCOPT = (typeof module !== 'undefined' && module.exports) ? require('../pc/opt.js') : root.PCOPT;

	var TAU = Math.PI * 2;

	var HY = {
		id: 'hy',
		name: 'hybrid',
		complete: false,                  // M1: a skeleton, and the harness reads this
		features: {},                     // no liquid, no skin, no melt, no vents yet
		defaults: { nx: 256, ny: 24, cap: 4096 },

		FIELDS: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
			'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph'],
		poolCfg: {
			carry: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
				'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph'],
			share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt'],
			bond: ['age', 'mu', 'dmg', 'pLoad', 'pCnt'],
			all: ['depQ']
		},

		M: null, S: null, pool: null, opts: null,
		seed: 1, camera: 'mantle', tool: null,

		init: function () {
			if (this.pool) return this;
			this.pool = POOL.make(this.poolCfg);
			this.opts = PCOPT.make('hy', function (id, v) {
				if (id === 'clock') PCP.sl.kyr = v;
			});
			return this;
		},

		// The mesh and its fields. Cells are the mantle: eta 0 is the surface, eta etaBot the
		// CMB, and the 20 km of sky the display shows above the surface is not part of the
		// fluid (0.3-plan §3.3). Cell mass is the physical area it stands for, so the CMB
		// row's cells are far heavier than the surface row's — that is the mesh's own
		// statement and not a display accident.
		mesh: function (nx, ny) {
			var etaBot = Math.asinh(PCP.depth / PCP.yLin);
			var n = nx * ny, i, j, eta, y, dy, dx = PCP.wrap / nx, deta = etaBot / ny;
			var M = this.M = {
				nx: nx, ny: ny, n: n, dx: dx, deta: deta, etaBot: etaBot,
				wrap: PCP.wrap, depth: PCP.depth, yLin: PCP.yLin,
				H: new Float64Array(n), T: new Float64Array(n), melt: new Float64Array(n),
				cF: new Float64Array(n), cW: new Float64Array(n),
				m: new Float64Array(n), y: new Float64Array(n), eta: new Float64Array(n),
				cx: new Float64Array(nx)
			};
			for (i = 0; i < nx; i++) M.cx[i] = (i + 0.5) * dx;
			for (j = 0; j < ny; j++) {
				eta = (j + 0.5) * deta;
				y = PCP.yLin * Math.sinh(eta);
				dy = PCP.yLin * Math.cosh(eta) * deta;
				for (i = 0; i < nx; i++) {
					M.eta[j * nx + i] = eta;
					M.y[j * nx + i] = y;
					M.m[j * nx + i] = dx * dy;
				}
			}
			return M;
		},

		reset: function (seed) {
			this.init();
			this.seed = seed === undefined ? this.seed : seed;
			var nx = this.defaults.nx, ny = this.defaults.ny;
			var M = this.mesh(nx, ny), phase = TAU * (this.seed * 0.6180339887498949 % 1);
			var i, j, k, x, eta, y, T, f;
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				x = M.cx[i]; eta = M.eta[k]; y = M.y[k];
				f = y / PCP.depth;
				T = 1 - Math.exp(-y / 80) + 0.02 * Math.sin(Math.PI * f) *
					Math.cos(4 * TAU * x / PCP.wrap + phase);
				T = T < 0 ? 0 : (T > 1 ? 1 : T);
				PHASE.byT(T, y, 0, 0);
				M.T[k] = PHASE.out.t; M.H[k] = PHASE.out.h; M.melt[k] = PHASE.out.melt;
				M.cF[k] = 0; M.cW[k] = 0;
			}
			// the parcel pool exists and is empty: the skin is M3's, and an empty pool is a
			// reading the harness can hold the skeleton to
			this.S = { cap: this.defaults.cap, n: 0, wrap: PCP.wrap };
			this.pool.attach(this.S);
			return this;
		},

		clock: function () { return this.opts.get('clock'); },

		step: function () {
			var M = this.M, dt = this.opts.get('clock') / 1000;
			if (!M) return this;
			M.time = (M.time || 0) + dt;
			M.frame = (M.frame || 0) + 1;
			return this;
		},

		read: function (key) {
			var M = this.M, p, mass = 0, melt = 0;
			if (!M) return undefined;
			if (key === 'time') return M.time || 0;
			if (key === 'frame') return M.frame || 0;
			if (key === 'kyr') return this.clock();
			if (key === 'cells') return M.n;
			if (key === 'population') return this.S ? this.S.n : 0;
			if (key === 'mass' || key === 'meltMass' || key === 'enthalpy') {
				for (p = 0; p < M.n; p++) {
					mass += M.m[p];
					melt += M.m[p] * M.melt[p];
				}
				if (key === 'mass') return mass;
				if (key === 'meltMass') return melt;
				return mass;   // M1: H is not yet a conserved book on the page
			}
			return undefined;
		},

		applyPreset: function (preset) {
			this.opts.set('clock', preset.clock);
			return this;
		},
		setOption: function (id, v) { this.opts.set(id, v, true); return this; },
		setCamera: function (c) { this.camera = c; return this; },
		setTool: function (t) { this.tool = t; return this; },

		hud: function () {
			var M = this.M, ms = this.ms || 0;
			return [
				'HY hybrid — M1 skeleton (no solver)',
				'Myr ' + (M.time || 0).toFixed(2) + '   ' + this.clock() + ' kyr/frame   k 0',
				'cells ' + M.nx + 'x' + M.ny + ' = ' + M.n + '   parcels ' + this.S.n,
				'ms/frame ' + ms.toFixed(2) + '   sweeps ' + this.opts.get('projIters') +
					'   solidus ' + this.opts.get('solidusOf')
			].join('\n');
		},

		// The view: the temperature field as a raster, one pixel per cell, scaled to the
		// canvas with smoothing off so the mesh stays visible as a mesh. No horizon, ocean or
		// pile top exists yet — those arrive with the skin and the surface (M3).
		_field: null,
		draw: function (ctx, w, h) {
			var M = this.M, pad = 0.05, hh = h * (1 - 2 * pad), img, small, k, t, i;
			ctx.fillStyle = '#05070c';
			ctx.fillRect(0, 0, w, h);
			if (!M) return;
			if (!this._field) {
				small = typeof document !== 'undefined' ? document.createElement('canvas') : null;
				this._field = small ? small : { width: 0, height: 0 };
			}
			small = this._field;
			if (small.width !== M.nx || small.height !== M.ny) {
				small.width = M.nx; small.height = M.ny;
				this._img = null;
			}
			if (!this._img && small.getContext) {
				this._sctx = small.getContext('2d');
				this._img = this._sctx.createImageData(M.nx, M.ny);
			}
			img = this._img;
			if (!img) return;
			for (k = 0; k < M.n; k++) {
				t = M.T[k];
				i = 4 * k;
				img.data[i] = Math.round(30 + 225 * t);
				img.data[i + 1] = Math.round(20 + 90 * t);
				img.data[i + 2] = Math.round(150 - 110 * t);
				img.data[i + 3] = 255;
			}
			this._sctx.putImageData(img, 0, 0);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(small, 0, h * pad, w, hh);
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = HY;
	else root.HY = HY;
}(typeof window !== 'undefined' ? window : this));
