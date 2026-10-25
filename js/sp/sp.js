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
			this.opts.commit();
			// the phase law reads its pressure source off the shared PCP word, so the
			// engine's own option has to be written there before anything equilibrates
			PCP.solidusOf = this.opts.get('solidusOf');
			var nx = this.defaults.nx, rows = this.defaults.rows;
			var scale = this.defaults.scale, S = this.alloc(this.defaults.cap);
			var etaBot = Math.asinh(PCP.depth / PCP.yLin);
			var height = etaBot * scale, dx = PCP.wrap / nx, dw = height / rows;
			var wave = new Float64Array(nx), i, j, p = 0, x, w, eta, y, T, f, m;
			PCP.icDraw(this.seed);
			for (i = 0; i < nx; i++) wave[i] = PCP.icWave((i + 0.5) * dx);
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
					T = 1 - Math.exp(-y / PCP.skin) + PCP.icAmp * Math.sin(Math.PI * f) * wave[i];
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
			var k;
			this.opts.set('clock', preset.clock);
			if (preset.options) {
				for (k in preset.options) {
					try { this.opts.set(k, preset.options[k], true); } catch (e) {}
				}
			}
			if (preset.camera) this.camera = preset.camera;
			this.tool = preset.tool || null;
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

		_drawOrder: null,
		// The skeleton's view: dense hydrogel pebbles. Every parcel is a translucent disc whose
		// warped diameter is what makes it round by construction (M0's display milestone). The
		// basin is *filled* — the warped lattice already packs ~6.7k discs with uniform
		// occupancy at every depth, so the eye sees a flower-pot of translucent gel beads,
		// not a few dots swimming in lava. Pebbles push, overlap and catch light; bonds (M5)
		// will later hold the crust together visibly.
		draw: function (ctx, w, h) {
			var S = this.S, p, px, py, r, t, x, y, eta;
			var pad = 0.05;
			// deep basin background — slightly lighter than hybrid's void, suggests container
			ctx.fillStyle = '#070b18';
			ctx.fillRect(0, 0, w, h);
			// subtle inner glow for basin volume
			if (ctx.createLinearGradient) {
				var bg = ctx.createLinearGradient(0, h * pad, 0, h * (1 - pad));
				if (bg && bg.addColorStop) {
					bg.addColorStop(0, 'rgba(18,30,68,0.55)');
					bg.addColorStop(0.18, 'rgba(18,30,68,0)');
					bg.addColorStop(0.82, 'rgba(80,40,30,0.10)');
					bg.addColorStop(1, 'rgba(40,16,12,0.45)');
					ctx.fillStyle = bg;
					ctx.fillRect(0, h * pad, w, h * (1 - 2 * pad));
				}
			}
			if (!S || !S.n) return;
			var hh = h * (1 - 2 * pad), ww = w;
			var etaBot = S.etaBot, scale = S.scale;
			var topRows = this.camera === 'lid' ? S.rows / 3 : S.rows;
			var etaMax = etaBot * (topRows / S.rows);
			var showCrust = this.opts.get('crust');
			var shrink = this.opts.get('sizeByHeat') || 0;
			var pxPerKm = ww / PCP.wrap;
			var dxPx = S.dx * pxPerKm;

			// sort deep→shallow for translucent painter's order (reuse buffer)
			var order = this._drawOrder;
			if (!order || order.length !== S.cap) order = this._drawOrder = new Int32Array(S.cap);
			for (p = 0; p < S.n; p++) order[p] = p;
			var slice = Array.prototype.slice.call(order.subarray(0, S.n));
			slice.sort(function (a, b) { return S.w[b] - S.w[a]; });
			for (p = 0; p < S.n; p++) order[p] = slice[p];

			for (var oi = 0; oi < S.n; oi++) {
				p = order[oi];
				eta = S.w[p] / scale;
				if (eta > etaMax) continue;
				x = S.x[p];
				px = x * ww / PCP.wrap;
				py = h * pad + (eta / etaMax) * hh;
				t = S.T[p];
				var melt = S.melt[p] || 0;
				var ph = S.ph[p];
				var rScale = 1;
				// future material sizing: deposit seeds finer
				if (S.rScale && S.rScale[p]) rScale = S.rScale[p];
				else if (ph === PCP.PH.dep) rScale = 0.62;
				var baseR = dxPx * 0.58 * rScale * (1 - 0.32 * shrink * t);
				if (baseR < 1.8) baseR = 1.8;
				if (baseR > dxPx * 1.02) baseR = dxPx * 1.02;
				r = baseR;

				var fill;
				if (ph === PCP.PH.air) {
					fill = 'rgba(255,232,120,0.92)';
				} else if (ph === PCP.PH.dep) {
					fill = 'rgba(210,132,78,0.88)';
				} else if (showCrust) {
					// crust-as-rock vs heat: blend blue-grey to warm with T, melt adds gold
					var rr = Math.round(58 + 150 * t + 58 * melt);
					var gg = Math.round(72 + 96 * (1 - Math.abs(t - 0.5) * 1.6) + 22 * melt);
					var bb = Math.round(148 - 86 * t + 12 * melt);
					fill = 'rgba(' + rr + ',' + gg + ',' + bb + ',0.84)';
				} else {
					fill = 'rgba(' + Math.round(255 * t) + ',' + Math.round(120 * t) + ',40,0.88)';
				}

				ctx.beginPath();
				ctx.arc(px, py, r, 0, Math.PI * 2);
				ctx.fillStyle = fill;
				ctx.fill();
				// pebble rim — defines packed contacts like gel beads in a pot
				ctx.strokeStyle = 'rgba(255,255,255,0.16)';
				ctx.lineWidth = 0.75;
				ctx.stroke();
				// specular highlight
				ctx.beginPath();
				ctx.arc(px - r * 0.30, py - r * 0.32, r * 0.36, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(255,255,255,' + (0.14 + 0.12 * (1 - t)).toFixed(3) + ')';
				ctx.fill();
				// soft inner shadow for volume
				ctx.beginPath();
				ctx.arc(px + r * 0.16, py + r * 0.16, r * 0.70, 0, Math.PI * 2);
				ctx.strokeStyle = 'rgba(0,10,28,0.11)';
				ctx.lineWidth = 0.6;
				ctx.stroke();
			}

			// future: bond web when crust links exist (M5) — keep placeholder so soup never
			// regresses to “swimming dots”: bonds are already drawn in hybrid, same here.
			if (S.n > 0 && this.opts.get('bonds') && this.opts.get('links') && S.counts) {
				var counts = S.counts, slot = S.slot, sOrder = S.order;
				var rangeX = 0.72 * S.dx, rangeY = S.dw * 1.15;
				ctx.save();
				ctx.lineCap = 'round';
				for (var ci = 0; ci < S.nx; ci++) {
					var b0 = slot[ci] - counts[ci];
					var ip = ci + 1 < S.nx ? ci + 1 : 0;
					var b1 = slot[ip] - counts[ip];
					for (var kk = 0; kk < counts[ci]; kk++) {
						var pp = sOrder[b0 + kk];
						if (S.w[pp] / scale > etaMax) continue;
						var muP = S.mu ? S.mu[pp] * (1 - (S.dmg ? S.dmg[pp] : 0)) : 1;
						if (muP < 0.18) continue;
						for (var c = kk + 1; c < Math.min(counts[ci], kk + 8); c++) {
							var qq = sOrder[b0 + c];
							if (S.w[qq] / scale > etaMax) continue;
							var muQ = S.mu ? S.mu[qq] * (1 - (S.dmg ? S.dmg[qq] : 0)) : 1;
							if (muQ < 0.18) continue;
							var dxp = S.x[qq] - S.x[pp];
							if (dxp < -rangeX || dxp > rangeX) continue;
							var dwp = S.w[qq] - S.w[pp];
							if (dwp < -rangeY || dwp > rangeY) continue;
							var mu = muP < muQ ? muP : muQ;
							ctx.strokeStyle = 'rgba(180,225,255,' + (0.09 + 0.32 * mu).toFixed(3) + ')';
							ctx.lineWidth = 0.8 + mu * 0.7;
							ctx.beginPath();
							ctx.moveTo(S.x[pp] * ww / PCP.wrap, h * pad + (S.w[pp] / scale / etaMax) * hh);
							ctx.lineTo(S.x[qq] * ww / PCP.wrap, h * pad + (S.w[qq] / scale / etaMax) * hh);
							ctx.stroke();
						}
						for (var c2 = 0; c2 < Math.min(counts[ip], 8); c2++) {
							var qq2 = sOrder[b1 + c2];
							if (S.w[qq2] / scale > etaMax) continue;
							var muQ2 = S.mu ? S.mu[qq2] * (1 - (S.dmg ? S.dmg[qq2] : 0)) : 1;
							if (muQ2 < 0.18) continue;
							var dxp2 = S.x[qq2] - S.x[pp];
							if (dxp2 > 0.5 * PCP.wrap) dxp2 -= PCP.wrap;
							else if (dxp2 < -0.5 * PCP.wrap) dxp2 += PCP.wrap;
							if (dxp2 < -rangeX || dxp2 > rangeX) continue;
							var dwp2 = S.w[qq2] - S.w[pp];
							if (dwp2 < -rangeY || dwp2 > rangeY) continue;
							var mu2 = muP < muQ2 ? muP : muQ2;
							ctx.strokeStyle = 'rgba(180,225,255,' + (0.09 + 0.32 * mu2).toFixed(3) + ')';
							ctx.lineWidth = 0.8 + mu2 * 0.7;
							ctx.beginPath();
							ctx.moveTo(S.x[pp] * ww / PCP.wrap, h * pad + (S.w[pp] / scale / etaMax) * hh);
							ctx.lineTo(S.x[qq2] * ww / PCP.wrap, h * pad + (S.w[qq2] / scale / etaMax) * hh);
							ctx.stroke();
						}
					}
				}
				ctx.restore();
			}
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = SP;
	else root.SP = SP;
}(typeof window !== 'undefined' ? window : this));
