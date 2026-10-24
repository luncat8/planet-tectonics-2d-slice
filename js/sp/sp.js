// sp/sp.js — 0.5.0 M1: the soup page's engine skeleton (0.5.0-plan.md §5, milestone M1).
//
// What exists here is deliberately only the *shell* of the soup engine: the state layout, the
// M0-selected default rung (6,656 parcels on a 128 x 52 warped lattice), the phase law read
// into every parcel's H, the pool attached to that layout, the clock, and the readings the
// scenario harness asks for. No solver runs: there is no pair walk, no buoyancy, no heat
// exchange and no crust, so `features` is empty and every scenario gate reads pending. M4
// fills the walk and S1; M5 fills bonds, melt, eruption and unloading.
//
// The lattice is the one M0 measured (experiments/sp-prototype.js) and the quantities here
// are its own: x is periodic over the 16,000 km wrap, w = eta * scale is the warped vertical
// coordinate the pairwise mechanics will run in, and mass is the *physical* area of a parcel
// — m = dx * dy, with dy = yLin * cosh(eta) * dw / scale. That is why a bottom parcel carries
// 72.5x the mass of a surface one while every parcel draws the same size: size is spacing,
// mass is the book (plan §6).
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('../pc/params.js') : root.PCP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('../pc/phase.js') : root.PCPHASE;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('../pc/pool.js') : root.PCPOOL;
	var PCOPT = (typeof module !== 'undefined' && module.exports) ? require('../pc/opt.js') : root.PCOPT;

	var TAU = Math.PI * 2;

	// The default rung is M0's selected population. `scale` is the warped-plane aspect that
	// makes the 128 x 52 lattice nearly square (dx 125 km, dw 124 km), which is what makes
	// screen-space parcels round on a 1280-px canvas (M0's display milestone).
	var SP = {
		id: 'sp',
		name: 'soup',
		complete: false,                  // M1: a skeleton, and the harness reads this
		features: {},                     // no flow, no melt, no bonds, no vents yet
		defaults: { nx: 128, rows: 52, scale: 1300, cap: 8192 },

		FIELDS: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
			'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph', 'w', 'col'],
		poolCfg: {
			carry: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
				'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph', 'w', 'col'],
			share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt', 'w', 'col'],
			bond: ['age', 'mu', 'dmg', 'pLoad', 'pCnt'],
			all: ['depQ']
		},

		S: null,
		pool: null,
		opts: null,
		seed: 1,
		camera: 'mantle',
		tool: null,

		init: function () {
			if (this.pool) return this;
			this.pool = POOL.make(this.poolCfg);
			this.opts = PCOPT.make('sp', function (id, v) {
				if (id === 'clock') PCP.sl.kyr = v;
			});
			return this;
		},

		// The state: one dense prefix of a fixed capacity, structure of arrays, allocated
		// once. A page never grows the pool inside a frame; a reset rebuilds it in place.
		alloc: function (cap) {
			var K = this.FIELDS, S = this.S, k, name;
			if (!S || S.cap !== cap) {
				S = this.S = { cap: cap, n: 0 };
				for (k = 0; k < K.length; k++) {
					name = K[k];
					S[name] = name === 'id' ? new Uint32Array(cap)
						: (name === 'ph' ? new Uint8Array(cap)
						: (name === 'col' ? new Int32Array(cap) : new Float64Array(cap)));
				}
			}
			S.n = 0; S.ledger = 0; S.hLedger = 0; S.wall = 0;
			S.time = 0; S.frame = 0;
			S.space = this.opts.get('space');
			S.wrap = PCP.wrap; S.depth = PCP.depth; S.yLin = PCP.yLin;
			this.pool.attach(S);
			return S;
		},

		// A fresh planet: the cool initial condition of 0.3's family, read through the phase
		// law so every parcel starts on the equilibrium manifold (H = T below the solidus).
		reset: function (seed) {
			this.init();
			this.seed = seed === undefined ? this.seed : seed;
			var nx = this.defaults.nx, rows = this.defaults.rows;
			var scale = this.defaults.scale, S = this.alloc(this.defaults.cap);
			var etaBot = Math.asinh(PCP.depth / PCP.yLin);
			var height = etaBot * scale, dx = PCP.wrap / nx, dw = height / rows;
			var phase = TAU * (this.seed * 0.6180339887498949 % 1);
			var i, j, p = 0, x, w, eta, y, T, f, m;
			S.etaBot = etaBot; S.scale = scale; S.height = height;
			S.dx = dx; S.dw = dw; S.nx = nx; S.rows = rows;
			S.space = this.opts.get('space');
			for (j = 0; j < rows; j++) {
				w = (j + 0.5) * dw;
				eta = w / scale;
				y = PCP.yLin * Math.sinh(eta);
				// mass is the physical area this parcel stands for: dx * dy
				m = dx * PCP.yLin * Math.cosh(eta) * dw / scale;
				f = y / PCP.depth;
				for (i = 0; i < nx; i++) {
					x = (i + 0.5) * dx;
					p = this.pool.admit(S, PCP.PH.crust);
					if (p < 0) break;
					T = 1 - Math.exp(-y / 80) + 0.02 * Math.sin(Math.PI * f) *
						Math.cos(4 * TAU * x / PCP.wrap + phase);
					T = T < 0 ? 0 : (T > 1 ? 1 : T);
					S.x[p] = x; S.w[p] = w; S.y[p] = y; S.col[p] = i;
					S.m[p] = m;
					PHASE.byT(T, y, 0, 0);
					S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt; S.H[p] = PHASE.out.h;
					S.age[p] = 0; S.mu[p] = 0; S.dmg[p] = 0;
				}
			}
			S.time = 0; S.frame = 0;
			return this;
		},

		clock: function () { return this.opts.get('clock'); },

		// One rendered frame. M1 has no solver, so this advances the clock and nothing else;
		// the substep count is reported as 0 rather than as a plausible-looking 1.
		step: function () {
			var S = this.S, dt = this.opts.get('clock') / 1000;
			if (!S) return this;
			S.time += dt;
			S.frame++;
			return this;
		},

		read: function (key) {
			var S = this.S, inv;
			if (!S) return undefined;
			if (key === 'time') return S.time;
			if (key === 'frame') return S.frame;
			if (key === 'kyr') return this.clock();
			if (key === 'population') return S.n;
			if (key === 'cells') return 0;
			inv = this.pool.inventory(S);
			if (key === 'mass') return inv.m;
			if (key === 'meltMass') return inv.l;
			if (key === 'enthalpy') return inv.h;
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
			var S = this.S, inv = this.pool.inventory(S), ms = this.ms || 0;
			var lines = [
				'SP soup — M1 skeleton (no solver)',
				'Myr ' + S.time.toFixed(2) + '   ' + this.clock() + ' kyr/frame   k 0',
				'parcels ' + S.n + ' / ' + S.cap + '   ' + S.nx + 'x' + S.rows + ' rung',
				'mass ' + inv.m.toExponential(4) + '   melt ' + inv.l.toExponential(2),
				'ms/frame ' + ms.toFixed(2) + '   space ' + this.opts.get('space') +
					'   magma ' + this.opts.get('magmaMode')
			];
			return lines.join('\n');
		},

		// The skeleton's view: the parcels as round splats coloured by temperature. The
		// warped diameter is what makes them round by construction (M0's display gate); the
		// palette is a placeholder until the 0.3 LUT carries over in M4.
		draw: function (ctx, w, h) {
			var S = this.S, p, px, py, r, t, x, y, eta;
			var pad = 0.05;
			ctx.fillStyle = '#05070c';
			ctx.fillRect(0, 0, w, h);
			if (!S || !S.n) return;
			var hh = h * (1 - 2 * pad), ww = w;
			r = Math.max(1, 0.5 * S.dx * ww / PCP.wrap);
			for (p = 0; p < S.n; p++) {
				x = S.x[p];
				eta = S.w[p] / S.scale;
				y = PCP.yLin * Math.sinh(eta);
				px = x * ww / PCP.wrap;
				py = h * pad + (eta / S.etaBot) * hh;
				t = S.T[p];
				if (this.opts.get('crust')) {
					ctx.fillStyle = 'rgb(' + Math.round(40 + 180 * t) + ',' +
						Math.round(60 + 120 * (1 - Math.abs(t - 0.5) * 2)) + ',' +
						Math.round(150 - 120 * t) + ')';
				} else {
					ctx.fillStyle = 'rgb(' + Math.round(255 * t) + ',' + Math.round(120 * t) + ',40)';
				}
				ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
			}
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = SP;
	else root.SP = SP;
}(typeof window !== 'undefined' ? window : this));
