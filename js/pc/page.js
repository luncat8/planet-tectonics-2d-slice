// pc/page.js — 0.5.0 M1: the shell both new pages boot through (0.5.0-plan.md §7, M1).
//
// One frame loop, one bar binding, one HUD. The engines never start themselves: each page's
// engine file is a module that only exposes its object, and this file is started explicitly at
// the end of the engine file's page with PCPAGE.start(ENGINE) — the 0.9.0 host-contract lesson
// applied before it can bite (no self-start, no page-name reads, one loop per page).
//
// What this file owns: the canvas and its chrome (asinh depth ruler, sky and CMB edges), the
// registry bar (pc/opt.js), the scenario preset buttons, the keys (space/./r/n/1-4), the
// ms/frame smoothing, and the 2 Hz HUD pulse. What the engine owns: step, draw, read, hud.
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : root.PCP;
	var PCOPT = (typeof module !== 'undefined' && module.exports) ? require('./opt.js') : root.PCOPT;
	var PCSCEN = (typeof module !== 'undefined' && module.exports) ? require('./scenario.js') : root.PCSCEN;
	var PERF = (typeof module !== 'undefined' && module.exports) ? require('../../js/perf.js') : root.COLPERF;

	// depth lines of the ruler: coarse, and dense at the surface where the asinh map spends
	// its pixels. The same list in both engines keeps their views comparable.
	var RULER = [0, 50, 100, 200, 400, 800, 1200, 1800, 2400, 2900];
	var PAD = 0.05;    // fraction of the canvas height used as sky above and below

	var PCPAGE = {
		engine: null, opts: null, ctx: null, canvas: null, hudEl: null,
		paused: false, stepOnce: false, seed: 1, ms: 0, sync: null,

		start: function (engine) {
			if (this.engine) return this;              // one loop per page, by construction
			if (typeof document === 'undefined') return this;
			if (engine.init) engine.init();
			this.engine = engine;
			this.canvas = document.getElementById('c');
			this.hudEl = document.getElementById('hud');
			this.ctx = this.canvas.getContext('2d');
			this.opts = engine.opts;

			engine.reset(this.seed);
			this.sync = PCOPT.bind(document.getElementById('bar'), this.opts,
				function (id, v) { engine.setOption(id, v); });
			this.bindButtons();
			this.bindKeys();
			this.hud();
			var self = this, lastNow = 0;
			function now() {
				return (typeof performance !== 'undefined' && performance.now)
					? performance.now() : Date.now();
			}
			function tick(stamp) {
				var a = now(), wallDt = lastNow ? (stamp - lastNow) / 1000 : 0;
				lastNow = stamp;
				if (!self.paused || self.stepOnce) { self.stepOnce = false; engine.step(wallDt); }
				var b = now();
				engine.draw(self.ctx, self.canvas.width, self.canvas.height);
				self.chrome(self.ctx, self.canvas.width, self.canvas.height);
				var c = now();
				self.ms = PERF.f(self.ms, c - a);
				engine.ms = self.ms;
				if (PERF.tick(stamp)) self.hud();
				root.requestAnimationFrame(tick);
			}
			root.requestAnimationFrame(tick);
			return this;
		},

		bindButtons: function () {
			var self = this, engine = this.engine;
			function on(id, fn) {
				var el = document.getElementById(id);
				if (el) el.addEventListener('click', fn);
			}
			on('bPause', function () { self.paused = !self.paused; self.markPause(); });
			on('bStep', function () { self.stepOnce = true; });
			on('bReset', function () { self.planet(self.seed); });
			on('bNew', function () { self.planet(self.seed + 1); });
			var els = document.querySelectorAll('[data-pc-scenario]'), i;
			for (i = 0; i < els.length; i++) {
				(function (el) {
					el.addEventListener('click', function () { self.preset(el.getAttribute('data-pc-scenario')); });
				}(els[i]));
			}
			this.markPause();
		},

		markPause: function () {
			var el = typeof document !== 'undefined' ? document.getElementById('bPause') : null;
			if (el) el.setAttribute('aria-pressed', this.paused ? 'true' : 'false');
		},

		bindKeys: function () {
			var self = this;
			if (typeof root.addEventListener !== 'function') return;
			root.addEventListener('keydown', function (ev) {
				var k = ev.key;
				if (k === ' ') { self.paused = !self.paused; self.markPause(); }
				else if (k === '.') self.stepOnce = true;
				else if (k === 'r') self.planet(self.seed);
				else if (k === 'n') self.planet(self.seed + 1);
				else if (k >= '1' && k <= '4') self.preset('S' + k);
			});
		},

		// the scenario presets are the page's half of pc/scenario.js: clock, camera, options
		preset: function (id) {
			PCSCEN.apply(id, this.opts, this.engine);
			if (this.sync) this.sync();
			this.hud();
		},

		// a fresh planet: staged reset-scope options are committed first, because the whole
		// point of a reset option is that the state it configures is rebuilt
		planet: function (seed) {
			this.seed = seed;
			this.opts.commit();
			this.engine.reset(seed);
			if (this.sync) this.sync();
			this.hud();
		},

		hud: function () {
			if (this.hudEl) this.hudEl.textContent = this.engine.hud();
		},

		// the shared chrome: sky/CMB edges and the asinh ruler with its kilometre labels.
		// Both engines plot eta linearly, so one ruler serves both and the depth labels mean
		// the same thing on both pages.
		chrome: function (ctx, w, h) {
			var etaBot = Math.asinh(PCP.depth / PCP.yLin), hh = h * (1 - 2 * PAD);
			var i, y, py;
			ctx.strokeStyle = 'rgba(120,150,200,0.18)';
			ctx.fillStyle = 'rgba(154,167,189,0.75)';
			ctx.font = '10px monospace';
			ctx.lineWidth = 1;
			for (i = 0; i < RULER.length; i++) {
				y = RULER[i];
				py = Math.round(h * PAD + (Math.asinh(y / PCP.yLin) / etaBot) * hh) + 0.5;
				ctx.beginPath();
				ctx.moveTo(0, py);
				ctx.lineTo(w, py);
				ctx.stroke();
				ctx.fillText(y + ' km', 4, py - 3);
			}
			// the surface and the CMB are the two edges
			ctx.strokeStyle = 'rgba(159,214,184,0.35)';
			ctx.beginPath();
			ctx.moveTo(0, Math.round(h * PAD) + 0.5);
			ctx.lineTo(w, Math.round(h * PAD) + 0.5);
			ctx.moveTo(0, Math.round(h * (1 - PAD)) + 0.5);
			ctx.lineTo(w, Math.round(h * (1 - PAD)) + 0.5);
			ctx.stroke();
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = PCPAGE;
	else root.PCPAGE = PCPAGE;
}(typeof window !== 'undefined' ? window : this));
