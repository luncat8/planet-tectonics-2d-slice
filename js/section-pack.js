// section-pack.js — 0.4.1: the cut, this side. One entry point for every transport: a pasted
// blob, a loaded .json file and a bundled ?pack= id all run through the same normalize →
// quantise → validate → verify path on the shared port/slice-format.js (0.4.1-plan.md §4.1),
// so none of them can be a second format and a pasted pack and a file pack of the same bytes
// cannot behave differently. A verified pack is then laid on the section's own columns by
// js/section-seed.js (M2), which is what turns a cut into a cross-section.
//
// This file owns the page's section mode (?start=section): the Slice panel, the raw strip —
// what the paste says, before the seeding — the reconstructed view's raw overlay and the model
// hatch, and the HUD. Both run modes start stopped (plan §4.4): the strip because a cut is
// first looked at, and a window forever, because the engine has no end boundary conditions.
'use strict';
var SectionPack = (function () {
	var SP = (typeof module !== 'undefined' && module.exports) ? require('../port/slice-format.js') : window.SlicePack;
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
	var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
	var SEED = (typeof module !== 'undefined' && module.exports) ? require('./section-seed.js') : window.SEED;
	var CP = (typeof module !== 'undefined' && module.exports) ? require('./checkpoint.js') : window.Checkpoint;

	// sim.js is the last script on the page, so the page globals (UI, RNDR, GEO, SIM) are reached
	// at call time through this and never captured at load — which is also what lets the module
	// require cleanly under node, where they do not exist.
	function page() { return typeof document === 'undefined' || typeof window === 'undefined' ? null : window; }

	// raw-strip layout (the canvas is fixed size, so these are constants, not state)
	var ML = 48, MR = 10, LEG = 16, POT0 = LEG + 4, POT_H = 6, POT_G = 1, POTN = 6;
	var TOP = POT0 + POTN * (POT_H + POT_G) + 4, BAND_H = 16, RULER_H = 34, MGAP = 6;

	// lith colours: the section's stack order, top-down (sediment on felsic on mafic), the
	// same families RNDR.LITH_RGB draws for the engine (sed / fel / maf).
	var LITHE = ['#cbb591', '#dca58c', '#464b52'];
	// boundary tick colours: the map's legend (open yellow, subduct red, transform white,
	// collide purple) so a cut reads the same on both pages.
	var BND_RGB = { 2: '#e8c84a', 3: '#e05555', 4: '#b06ae0', 1: '#c8c8c8' };
	// twelve hues for the plate band; a plate id only needs a stable colour, not its own.
	var PLATE_RGB = [];
	for (var _i = 0; _i < 12; _i++) PLATE_RGB.push('hsl(' + Math.round(_i * 30 + 8) + ',46%,44%)');
	var POT_NAM = ['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'];
	var KM = 1000;
	var LL = [0, 0];

	// 40030 -> '40 030': groups of three from the right, thin space as the separator
	function fmtKm(v) {
		var s = String(Math.round(v)), out = '', i;
		for (i = s.length; i > 0; i--) {
			var sep = (s.length - i > 0 && (s.length - i) % 3 === 0) ? ' ' : '';
			out = s.charAt(i - 1) + sep + out;
		}
		return out;
	}
	function fmtLatLon(ll) {
		var lat = ll[0], lon = ll[1];
		return (lat >= 0 ? lat.toFixed(1) + '°N' : (-lat).toFixed(1) + '°S') + ' ' +
			(lon >= 0 ? lon.toFixed(1) + '°E' : (-lon).toFixed(1) + '°W');
	}
	// potential heat: dark slate at 0, amber mid, red at 1
	function potRGB(v) {
		var t = Math.max(0, Math.min(1, v));
		if (t < 0.5) {
			var a = t / 0.5;
			return 'rgb(' + Math.round(38 + 178 * a) + ',' + Math.round(44 + 136 * a) + ',' + Math.round(58 - 18 * a) + ')';
		}
		var b = (t - 0.5) / 0.5;
		return 'rgb(' + Math.round(216 + 8 * b) + ',' + Math.round(180 - 100 * b) + ',' + Math.round(40 - 20 * b) + ')';
	}

	var SectionPack = {
		mode: false,            // the page is showing a cut, not a planet the engine built
		pack: null,             // the loaded pack, decoded and verified
		origin: '',             // 'paste' | 'file' | the bundled pack id
		start: null,            // the ?start=section URL params
		msg: '', bad: false,    // the panel line; bad = a refusal
		world: false,           // M2 laid a section from the pack: the canvas is the engine's view
		raw: false,             // the strip instead of the engine view, whatever else is loaded
		overlay: true,
		spin: null,         // the frame-0 crust and mean z, so the HUD can report the spin-up
		running: false,         // mode G only, and only after the user detaches (plan §4.4)
		t0: 0,                  // the cut's world time: the label says how far the section ran
		cvs: null, ctx: null, hudEl: null, sliceEl: null, msgEl: null,
		textEl: null, fileEl: null, pickEl: null, rawBtn: null, ovlBtn: null, runBtn: null,
		saveBtn: null, loadEl: null,
		view: false, cache: null,

		// ---------------------------------------------------------------- the URL
		sectionStart: function () {
			if (typeof location === 'undefined' || !location || !location.search) return false;
			return /[?&]start=section\b/.test(location.search);
		},
		urlParams: function () {
			var q = {}, s = (typeof location !== 'undefined' && location && location.search)
				? location.search.replace(/^\?/, '') : '';
			if (!s) return q;
			var pairs = s.split('&'), i, kv, k, v;
			for (i = 0; i < pairs.length; i++) {
				kv = pairs[i].split('=');
				if (!kv[0]) continue;
				k = kv[0];
				v = kv[1] === undefined ? '' : kv[1].replace(/\+/g, '%20');
				try { q[decodeURIComponent(k)] = decodeURIComponent(v); }
				catch (e) { q[k] = v; }
			}
			return q;
		},
		// a URL number is text: only a finite one in range is a rate, the rest is the default
		urlNum: function (name, lo, hi, dflt) {
			var v = this.start && this.start[name];
			if (v === undefined || v === '') return dflt;
			v = +v;
			return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
		},

		// bundled packs: M4's generated js/data/section-*.js set window.SECTION_PACKS; until
		// then the resolver is there and finds nothing, which is the honest answer.
		bundled: function (id) {
			return (typeof SECTION_PACKS !== 'undefined' && SECTION_PACKS && SECTION_PACKS[id]) || null;
		},

		// ---------------------------------------------------------------- loading
		// The one verify path (plan §4.1): a rejected pack is an error with the reason, the
		// currently shown cut is not touched, and there is no partial load.
		loadPack: function (pack, origin) {
			if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
				var typeError = 'a slice pack must be a JSON object';
				this.refuse(typeError);
				throw new Error(typeError);
			}
			try {
				SP.normalize(pack);
				SP.quantize(pack);
			} catch (e) {
				this.refuse('invalid slice pack: ' + e.message);
				throw e;
			}
			var bad = SP.validate(pack) || SP.verify(pack);
			if (bad) { this.refuse(bad); throw new Error(bad); }
			bad = SEED.measure(pack);
			SEED.refused = bad;
			if (bad) {
				if (!this.pack) {
					this.pack = pack;
					this.origin = origin || 'text';
					this.cache = null;
					this.world = false;
					this.running = false;
					this.raw = true;
					this.spin = null;
				}
				this.refuse(bad);
				this.syncButtons();
				this.hud();
				throw new Error(bad);
			}
			this.pack = pack;
			this.origin = origin || 'text';
			this.cache = null;
			this.msg = 'loaded ' + this.describe(pack);
			this.bad = false;
			this.paintMsg();
			this.reconstruct();
			return pack;
		},
		load: function (text, origin) {
			var obj;
			try { obj = JSON.parse(String(text)); }
			catch (e) { this.refuse('not JSON: ' + e.message); throw e; }
			return this.loadPack(obj, origin);
		},
		// the page shows the reason in one line; the load itself threw
		refuse: function (reason) {
			this.msg = reason;
			this.bad = true;
			this.paintMsg();
		},

		// M2: the cut becomes a section. A cut the section cannot lay (a window longer than the
		// wrap) keeps the pack and stays the strip, with the reason in the panel: the reader's
		// answer is always the bytes, the reconstruction's is a state the page may show or refuse.
		reconstruct: function () {
			var p = this.pack;
			if (!p) return;
			var g = page(), t0 = p.source.tMyr;
			var Tm = g ? P.Tfloor + (P.Tm0 - P.Tfloor) * Math.exp(-t0 / P.tauCool) : P.Tm0;
			var bad = SEED.layout(p, { seed: P.seed, t: t0, Tm: Tm });
			if (bad) { this.refuse(bad); return bad; }
			if (g) {
				g.SIM.t = t0;
				g.SIM.cool();
				g.SIM.tErupt = 0; g.SIM.frame = 0; g.SIM.evT = 0; g.SIM.event = 0;
				g.SIM.setGeo(0);                       // both modes start stopped (§4.4)
			}
			this.t0 = t0;
			this.running = false;
			this.spin = this.baseline();
			this.world = true;
			this.raw = false;
			this.enterView();
			this.syncButtons();
			this.hud();
			return '';
		},

		// the panel readout and the HUD share it (plan §4.2): both resolutions, because a feature
		// narrower than the source's cells must never be read as real, and the mode.
		describe: function (pack) {
			var p = pack.path, s = pack.source, n = SEED.pack === pack ? SEED.nCut : P.nCols;
			return 'source L' + s.level + ' · ' + p.cellKm.toFixed(0) + ' km cells → ' + n +
				' columns · ' + (P.w0 / KM).toFixed(0) + ' km · ' +
				fmtKm(p.arcKm) + ' km ' + (p.closes ? 'circle' : 'window') +
				' · t ' + s.tMyr + ' Myr' + (s.pack ? ' · ' + s.pack : '') +
				' · seed ' + P.seed + ' · mapping ' + SEED.MAP + ' · checksum ' + pack.checksum;
		},

		// ---------------------------------------------------------------- section mode
		init: function () {
			this.mode = true;
			var body = document.body;
			if (body && body.classList) body.classList.add('section-mode');
			this.cvs = document.getElementById('c');
			this.ctx = this.cvs.getContext('2d');
			this.hudEl = document.getElementById('hud');
			this.sliceEl = document.getElementById('slice');
			this.msgEl = document.getElementById('sMsg');
			this.textEl = document.getElementById('sText');
			this.fileEl = document.getElementById('sFile');
			this.pickEl = document.getElementById('sPick');
			this.rawBtn = document.getElementById('bRaw');
			this.ovlBtn = document.getElementById('bOvl');
			this.runBtn = document.getElementById('bRun');
			this.saveBtn = document.getElementById('sSave');
			this.loadEl = document.getElementById('sLoad');
			var self = this;
			// the section's own knobs: ?seed= is the plume/flow/noise seed, ?geo= and ?erupt= the
			// two clocks the section may run after it detaches (plan §4.2)
			this.start = this.urlParams();
			var seed = this.start.seed === undefined ? undefined : this.urlNum('seed', 0, 1e9, P.seed);
			if (seed !== undefined) P.seed = seed | 0;
			P.sl.geo = this.urlNum('geo', 0, P.geoMax, P.sl.geo);
			P.sl.erupt = this.urlNum('erupt', 0, P.eruptMax, P.sl.erupt);
			// the bundled ids: whatever exists when the page boots (M4 generates them)
			if (typeof SECTION_PACKS !== 'undefined' && SECTION_PACKS) {
				for (var id in SECTION_PACKS) {
					var o = document.createElement('option');
					o.value = id; o.textContent = id;
					this.pickEl.appendChild(o);
				}
			}
			// a load that refuses throws to its caller (an experiment wants that); a DOM handler
			// has nobody to catch it, so it says the reason and carries on
			this.textEl.addEventListener('paste', function (e) {
				var t = e.clipboardData ? e.clipboardData.getData('text') : this.value;
				if (t) self.caught(function () {
					try {
						var msgObj = JSON.parse(t.trim());
						if (msgObj && msgObj.format === 'pgt-coupling') {
							if (typeof COUP !== 'undefined' && COUP.apply) {
								var res = COUP.apply(window.S || {}, msgObj, { nCut: SEED ? SEED.nCut : 0, cellKm: (self.pack ? self.pack.path.cellKm : 78) });
								self.msg = 'coupling message applied: ' + (res || 'ok');
								if (res) self.refuse(res); else { self.bad = false; self.paintMsg(); self.hud(); }
							} else { self.refuse('COUP.apply not available'); }
						} else { self.load(t, 'paste'); }
					} catch (e2) { self.load(t, 'paste'); }
				});
			});
			this.textEl.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' && this.value) self.caught(function () { self.load(self.textEl.value, 'paste'); });
			});
			document.getElementById('sPaste').addEventListener('click', function () {
				if (self.textEl.value) self.caught(function () {
					// Try the message format first (M5 coupling envelope), then fall back to pack
					try {
						var msgText = self.textEl.value.trim();
						var msgObj = JSON.parse(msgText);
						if (msgObj && msgObj.format === 'pgt-coupling') {
							if (typeof COUP !== 'undefined' && COUP.apply) {
								var res = COUP.apply(window.S || {}, msgObj, { nCut: SEED ? SEED.nCut : 0, cellKm: (self.pack ? self.pack.path.cellKm : 78) });
								self.msg = 'coupling message applied: ' + (res || 'ok');
								if (res) self.refuse(res); else { self.bad = false; self.paintMsg(); self.hud(); }
							} else {
								self.refuse('COUP.apply not available');
							}
						} else {
							self.load(msgText, 'paste');
						}
					} catch (e) { self.load(msgText, 'paste'); }
				});
			});
			// a loaded file goes through the same bytes: read the text, run load()
			this.fileEl.addEventListener('change', function () {
				var f = this.files && this.files[0];
				if (!f) return;
				var r = new FileReader();
				r.onload = function () { self.caught(function () { self.load(r.result, 'file'); }); };
				r.readAsText(f);
			});
			this.pickEl.addEventListener('change', function () {
				var v = this.value, p = v ? self.bundled(v) : null;
				if (p) self.caught(function () { self.loadPack(p, v); });
				// the empty option is the panel's way of dropping a cut: the page is a view
				// again, and an id that is not in the bundle is a message rather than a no-op
				else if (!v) self.clear();
				else self.refuse("no bundled pack '" + v + "' (the bake lands in M4) — paste a cut");
			});
			if (this.rawBtn) this.rawBtn.addEventListener('click', function () { self.caught(function () { self.toggleRaw(); }); });
			if (this.ovlBtn) this.ovlBtn.addEventListener('click', function () { self.toggleOverlay(); });
			if (this.runBtn) this.runBtn.addEventListener('click', function () { self.caught(function () { self.detach(); }); });
			if (this.saveBtn) {
				this.saveBtn.addEventListener('click', function () {
					self.caught(function () {
						var s = CP.saveSession();
						var json = JSON.stringify(s, null, 1);
						if (typeof document !== 'undefined' && document.createElement) {
							var blob = new Blob([json], { type: 'application/json' });
							var a = document.createElement('a');
							a.href = URL.createObjectURL(blob);
							a.download = 'session-' + (self.pack ? self.pack.checksum : 'planet') + '-t' + Math.round(self.t0) + '.json';
							a.click();
						}
						self.msg = 'saved session (' + (json.length / 1024).toFixed(1) + ' KB)';
						self.bad = false;
						self.paintMsg();
					});
				});
			}
			if (this.loadEl) {
				this.loadEl.addEventListener('change', function () {
					var f = this.files && this.files[0];
					if (!f) return;
					var r = new FileReader();
					r.onload = function () {
						self.caught(function () {
							CP.loadSession(r.result);
						});
					};
					r.readAsText(f);
				});
			}
			// r and o are the section's two view keys, on the same binding ui.js uses (window),
			// and the same rule: a field being typed into keeps its keys
			window.addEventListener('keydown', function (e) { self.key(e); });
			// ?pack=<id>: a bundled cut from the URL; an id with no bundle is a message, not a guess
			if (this.start.pack) {
				var bp = this.bundled(this.start.pack);
				if (bp) this.caught(function () { self.loadPack(bp, self.start.pack); });
				else this.refuse("no bundled pack '" + this.start.pack + "' (the bake lands in M4) — paste a cut");
			}
			this.msg = this.msg || 'paste a cut, load a .json, or open ?start=section&pack=<id>';
			this.paintMsg();
			this.syncButtons();
			this.hud();
		},

		key: function (e) {
			var t = e.target, tag = t && t.tagName;
			if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
			if (e.key === 'r') this.toggleRaw();
			else if (e.key === 'o') this.toggleOverlay();
		},

		caught: function (run) {
			try { run(); }
			catch (e) { /* the panel already carries the reason: refuse() ran before the throw */ }
		},

		// the three switches, read back from the state they switch rather than tracked beside it
		// (the same rule ui.js follows for the engine bar, so a button cannot disagree with the page)
		syncButtons: function () {
			var g = page();
			if (!g) return;
			g.UI.setPressed('bRaw', this.raw && this.world);
			g.UI.setPressed('bOvl', this.overlay);
			g.UI.setPressed('bRun', this.running);
			if (this.runBtn) this.runBtn.disabled = !this.world || SEED.window;
			if (this.rawBtn) this.rawBtn.disabled = !this.world;
		},

		toggleRaw: function () {
			if (!this.world) return;
			this.raw = !this.raw;
			this.syncButtons();
		},
		toggleOverlay: function () {
			this.overlay = !this.overlay;
			this.syncButtons();
		},
		// "detach and run" (plan §4.4): the section stops being a view of the cut and becomes its
		// own planet on the globe's kinematics. A window may not: it has no end boundary conditions.
		detach: function () {
			if (!this.world || SEED.window) return;
			var g = page();
			this.running = !this.running;
			if (g) g.SIM.setGeo(this.running ? P.sl.geo : 0);
			this.syncButtons();
			this.hud();
		},

		paintMsg: function () {
			if (this.msgEl) {
				this.msgEl.textContent = this.msg;
				if (this.msgEl.classList) {
					this.msgEl.classList.remove('bad');
					if (this.bad) this.msgEl.classList.add('bad');
				}
			}
		},

		clear: function () {
			this.pack = null;
			this.origin = '';
			this.cache = null;
			this.spin = null;
			this.world = false;
			this.running = false;
			this.raw = false;
			this.overlay = true;
			SEED.pack = null;
			var g = page();
			if (g) g.SIM.setGeo(0);
			this.msg = 'cut cleared';
			this.bad = false;
			this.paintMsg();
			this.syncButtons();
			this.hud();
		},

		// The imported state is not a fixed point of the engine's dynamics, so the page measures
		// what the model makes of it (plan §4.3.4) instead of leaving a viewer to wonder whether a
		// first-frame move was the mapping or the physics. Over the section's columns, which are
		// the whole state at frame 0.
		baseline: function () {
			var j, m = 0, z = 0, n = S.nCol;
			for (j = 0; j < n; j++) { m += S.hTot[j] * S.colW[j]; z += S.z[j]; }
			return { m: m, z: n > 0 ? z / n : 0, n: n };
		},

		// the engine's own view: the camera, the raster, the probe and the mesh all stay RNDR's,
		// so a seeded cut *is* the section page rather than a second renderer (plan §4.3.4)
		enterView: function () {
			var g = page();
			if (!g) return;
			if (!this.view) { g.UI.init(); g.RNDR.init(this.cvs); this.view = true; }
			g.GEO.setPreset('def');
			g.GEO.lookAt(SEED.window ? SEED.nCut * P.w0 * 0.5 : 0);
			g.UI.afterView();
		},

		// the frame the page asks for: nothing runs while the strip is up, and a window's clock
		// may never run at all. The guard lives here rather than in the buttons because every
		// writer of the rate (the slider, the space key, the URL) has to be covered the same way.
		frame: function () {
			var g = page();
			if (!g || !this.world || this.raw) return;
			if (SEED.window) g.SIM.dG = 0;
			g.SIM.step();
		},

		draw: function () {
			var g = page();
			if (!g || !this.world || this.raw) { this.strip(); return; }
			g.RNDR.redraw();
			if (this.overlay) this.paint();
		},

		// ---------------------------------------------------------------- the HUD
		// what the cut is, what the section made of it, and what it invented (plan §4.2, §4.3.3):
		// both resolutions, the arc scale whenever it is not 1, the out-of-plane fraction and the
		// assumption record, above the engine's own lines
		lines: function () {
			var p = this.pack;
			if (!p) return ['section mode · cut · plate clock off', this.msg];
			if (!this.world) return ['cut · not reconstructed · ' + this.origin, this.describe(p),
				'mapping refused: ' + this.msg];
			var s = p.source, r = S.recon, st = SEED, g = page(), vpMax = 0, i, L = [];
			for (i = 0; i < p.n; i++) if (p.vp[i] > vpMax) vpMax = p.vp[i];
			var clock = !this.world ? 'plate clock off · not yet a section'
				: this.running ? 'running +' + (g ? (g.SIM.t - this.t0) : 0).toFixed(1) + ' Myr'
				: 'plate clock off · the cut as it stands';
			L.push((this.world ? 'cut at t ' + s.tMyr + ' Myr · ' : 'cut · ') + clock + '   ' + this.origin);
			L.push(this.describe(p));
			L.push('arc scale ' + st.scale.toFixed(2) + (st.window
				? '   window · plate clock off (no end conditions)'
				: '   ring · ' + st.nCut + ' of ' + P.nCols + ' columns') +
				'   out-of-plane ' + (vpMax / 1e4).toFixed(2) + ' cm/yr   seed ' + s.simSeed);
			L.push('start: 3 layers from the cut, their beds aged from the cut; the section dates its' +
			' own beds from t ' + s.tMyr + ' Myr   gap-thinned ' + r.gapColumns +
				(st.window ? ' · outside ' + r.outsideCut : '') +
				'   plate runs ' + st.runs + ' -> ' + S.nPl + ' (merged ' + r.shortPlateMerge + ')');
			L.push('assumed: sediment age ' + r.sedimentAge + ' · sub-Moho T ' + r.subMohoThermal +
				' · plumes ' + r.plumeDefault + ' · no mobile load ' + r.mobileAbsent +
				' · lid cap ' + r.lithosphereDepth + ' · vp>vt ' + r.discardedNormalVelocity +
				' · sea datum ' + r.seaDatumDisplay);
			L.push('ledger: map-equivalent ' + st.mapEquiv.toFixed(6) + '   crust ' +
			Math.round(st.seedMass) + ' of ' + Math.round(st.cutMass) + ' m3/m' +
				'   over-collapse ' + r.overCollapse + ' cols / ' + Math.round(r.overCollapseVol) + ' m3' +
				'   crossings ' + r.bndCollapsed + ' collapsed, ' + r.bndLost + ' unplaceable, ' +
				r.edgeFallback + ' neutral' +
				(st.window ? ', tail ' + r.tailArcKm.toFixed(0) + ' km / ' + Math.round(r.tailVol) + ' m3' : '') +
				'   clamped ' + r.clampedSpan + '   map v' + st.MAP);
			if (this.spin) {
				// §4.3.4: the imported state is not a fixed point, so what the model makes of it
				// in the first frames is printed rather than left for a viewer to explain away
				var mc = 0, zc = 0, nc = S.nCol;
				for (i = 0; i < nc; i++) { mc += S.hTot[i] * S.colW[i]; zc += S.z[i]; }
				L.push('spin-up since the cut: crust ' + (mc - this.spin.m >= 0 ? '+' : '') +
					Math.round(mc - this.spin.m) + ' m3/m · mean z ' +
					(nc > 0 ? zc / nc - this.spin.z : 0).toFixed(1) + ' m · ' + (g ? g.SIM.frame : 0) +
					' frames · ' + nc + ' records of ' + this.spin.n);
			}
			return L;
		},

		hud: function () {
			if (!this.hudEl) return;
			var L = this.lines(), g = page(), i, s = '';
			for (i = 0; i < L.length; i++) s += (i ? '\n' : '') + L[i];
			if (this.world && g) s += '\n' + g.UI.hudText();
			this.hudEl.textContent = s;
		},

		exportWorld: function (opts) {
			return SEED.exportSection(opts);
		},

		// ---------------------------------------------------------------- the engine view's overlay
		// The raw half of §4.3.4: the pack's own zM as a step line, and below the base of the
		// crust a hatch that says the cut stops there and the section's model starts. The cost is
		// one segment per sample and one tick every 24 px, which is what the engine's own overlay
		// already spends per screen column, and both go away when the switch is off.
		paint: function () {
			var g = page(), p = this.pack, c = this.ctx, GEO = g.GEO;
			var w = this.cvs.width, h = this.cvs.height, n = p.n, i, x, x0, x1, y, px, col, hy;
			var sc = SEED.scale * KM, prev = -1e9, first = true;
			c.strokeStyle = 'rgba(150,215,235,0.5)';
			c.lineWidth = 1;
			c.beginPath();
			for (i = 0; i < n; i++) {
				x0 = GEO.wrapX((i === 0 ? 0 : p.sKm[i] * sc) - GEO.x0) / GEO.kx;
				x1 = GEO.wrapX((i + 1 < n ? p.sKm[i + 1] * sc : SEED.nCut * P.w0) - GEO.x0) / GEO.kx;
				y = GEO.sy(p.zM[i]);
				if (x1 < x0) x1 = w + 1;                 // the span runs off the right edge: clip, do not double back
				// a step line: across the sample at its own zM, then a vertical to the next one.
				// Where the wrap put the seam on screen the two are not adjacent, and connecting
				// them would draw a diagonal across the whole view, so that is a fresh subpath.
				if (first || x0 - prev > 4 || prev - x0 > 4) { c.moveTo(x0, y); first = false; }
				else c.lineTo(x0, y);
				c.lineTo(x1, y);
				prev = x1;
			}
			c.stroke();
			c.fillStyle = 'rgba(150,170,200,0.28)';
			for (px = 0; px < w; px += 24) {
				col = GEO.lutCol[px];
				if (col < 0) continue;
				hy = GEO.sy(S.z[col] - S.hDraw[col]);
				if (hy > h || hy < 0) continue;
				c.fillRect(px, hy + 2, 10, 1);
				c.fillRect(px + 5, hy + 7, 10, 1);
			}
			c.fillStyle = 'rgba(160,180,210,0.6)';
			c.font = '10px monospace';
			c.fillText("the cut's own zM  \u00b7  below the crust: the section's model", ML, h - 6);
		},

		// ---------------------------------------------------------------- the raw strip
		// What the paste says, before any seeding: zM as a step line (nothing is interpolated
		// between cells — the section shows a gap where the cut crossed one), the three
		// thicknesses as a stacked fill, plates as a colour band, bnd ticks, the six potentials
		// as heat strips, and the lat/lon ruler from the pack's own path block.
		geom: function (w, h) {
			if (this.cache && this.cache.w === w && this.cache.h === h && this.cache.pack === this.pack) return;
			var p = this.pack, n = p.n, i;
			var xs = new Float64Array(n + 1), ys = new Float64Array(n), ySed = new Float64Array(n),
				yFel = new Float64Array(n), yMoho = new Float64Array(n);
			for (i = 0; i < n; i++) xs[i] = p.sKm[i];
			xs[n] = p.path.arcKm;
			var zMax = p.sea.levelM, zMin = 0;
			for (i = 0; i < n; i++) {
				var tot = p.hSedM[i] + p.hFelM[i] + p.hMafM[i];
				if (p.zM[i] > zMax) zMax = p.zM[i];
				var bot = p.zM[i] - tot;
				if (bot < zMin) zMin = bot;
			}
			zMax += 700; zMin -= 700;
			var plotH = h - TOP - MGAP - BAND_H - MGAP - RULER_H;
			var yOf = function (z) { return TOP + (zMax - z) / (zMax - zMin) * plotH; };
			var plotW = w - ML - MR;
			var arc = p.path.arcKm;
			var xOf = function (s) { return ML + s / arc * plotW; };
			var plateC = new Uint8Array(n);
			for (i = 0; i < n; i++) {
				ys[i] = yOf(p.zM[i]);
				ySed[i] = yOf(p.zM[i] - p.hSedM[i]);
				yFel[i] = yOf(p.zM[i] - p.hSedM[i] - p.hFelM[i]);
				yMoho[i] = yOf(p.zM[i] - p.hSedM[i] - p.hFelM[i] - p.hMafM[i]);
				plateC[i] = p.plate[i] % PLATE_RGB.length;
			}
			// ruler: eleven ticks, the lat/lon labels come from the shared path block
			var ticks = [], j;
			for (j = 0; j <= 10; j++) {
				var s = j * arc / 10;
				SP.latLonAt(p, s, LL);
				ticks.push({ x: xOf(s), km: fmtKm(s), ll: fmtLatLon(LL) });
			}
			this.cache = {
				w: w, h: h, pack: p, xs: xs, ys: ys, ySed: ySed, yFel: yFel, yMoho: yMoho,
				plateC: plateC, seaY: yOf(p.sea.levelM), zTop: zMax, zBot: zMin, plotH: plotH,
				plotW: plotW, ticks: ticks, bandY: h - RULER_H - MGAP - BAND_H,
				rulerY: h - RULER_H, legend: 'raw cut · zM m · hSed/hFel/hMaf m · plates · bnd · potentials',
				describe: this.describe(p),
				seaLabel: 'sea ' + (p.sea.levelM / 1000).toFixed(1) + ' km'
			};
		},

		strip: function () {
			var ctx = this.ctx, w = this.cvs.width, h = this.cvs.height;
			if (!ctx) return;
			ctx.fillStyle = '#05070c';
			ctx.fillRect(0, 0, w, h);
			if (!this.pack) {
				ctx.fillStyle = '#9aa7bd';
				ctx.font = '12px monospace';
				ctx.fillText('section mode · paste a cut in the Slice panel, or open ?start=section&pack=<id>', ML, h / 2);
				ctx.fillStyle = this.bad ? '#e08585' : '#55637d';
				ctx.fillText(this.msg, ML, h / 2 + 20);
				return;
			}
			this.geom(w, h);
			var c = this.cache, p = this.pack, n = p.n, i, k;
			// legend and the pack's own readout, right-aligned on the same line
			ctx.font = '10px monospace';
			ctx.fillStyle = '#55637d';
			ctx.fillText(c.legend, ML, 11);
			var dw = ctx.measureText ? (ctx.measureText(c.describe).width || 0) : 0;
			ctx.fillStyle = '#7f8ea8';
			ctx.fillText(c.describe, w - MR - dw, 11);
			// the six potentials, one strip each; runs of equal 1/32 colour merged so the
			// strip cost is the number of colour changes, not the number of cells
			ctx.font = '9px monospace';
			for (k = 0; k < POTN; k++) {
				var y = POT0 + k * (POT_H + POT_G);
				ctx.fillStyle = '#55637d';
				ctx.fillText(POT_NAM[k], 2, y + POT_H - 1);
				var last = -1, runStart = ML;
				for (i = 0; i <= n; i++) {
					var bin = i < n ? Math.min(31, Math.max(0, Math.round(p.pot[i * 6 + k] * 31))) : -1;
					if (bin === last) continue;
					if (i > 0) {
						var xe = c.xs[i];
						ctx.fillStyle = last < 0 ? '#0a0f18' : potRGB(last / 31);
						ctx.fillRect(runStart, y, xe - runStart, POT_H);
						runStart = xe;
					}
					last = bin;
				}
			}
			// water between sea level and the surface, per sample (the cut's own wet flag); a
			// sample whose ground stands over the sea paints nothing, not a slab of it
			ctx.fillStyle = 'rgba(34,86,130,0.35)';
			for (i = 0; i < n; i++) {
				if (!p.wet[i]) continue;
				var wx = c.xs[i], we2 = i + 1 < n ? c.xs[i + 1] : w - MR;
				var wh = c.ys[i] - c.seaY;
				if (wh > 0) ctx.fillRect(wx, c.seaY, we2 - wx, wh);
			}
			// the crust: three stacked fills per sample, top-down sediment / felsic / mafic.
			// A gap sample (alive = 0) owns no mass and the strip shows the hole.
			for (i = 0; i < n; i++) {
				if (!p.alive[i]) continue;
				var xa = c.xs[i], xb = i + 1 < n ? c.xs[i + 1] : w - MR;
				if (p.hSedM[i] > 0) { ctx.fillStyle = LITHE[0]; ctx.fillRect(xa, c.ys[i], xb - xa, c.ySed[i] - c.ys[i]); }
				if (p.hFelM[i] > 0) { ctx.fillStyle = LITHE[1]; ctx.fillRect(xa, c.ySed[i], xb - xa, c.yFel[i] - c.ySed[i]); }
				if (p.hMafM[i] > 0) { ctx.fillStyle = LITHE[2]; ctx.fillRect(xa, c.yFel[i], xb - xa, c.yMoho[i] - c.yFel[i]); }
			}
			// the surface as a step line: horizontal at each sample's zM, vertical at the
			// crossing — the data's own shape, nothing interpolated between cells
			ctx.strokeStyle = '#dfe7f5';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (i = 0; i < n; i++) {
				var x2 = i + 1 < n ? c.xs[i + 1] : w - MR;
				if (i === 0) ctx.moveTo(c.xs[0], c.ys[0]);
				ctx.lineTo(x2, c.ys[i]);
				if (i + 1 < n && c.ys[i + 1] !== c.ys[i]) ctx.lineTo(x2, c.ys[i + 1]);
			}
			ctx.stroke();
			ctx.lineWidth = 1;
			// the sea level the cut's wet flag was solved against
			if (c.seaY > TOP && c.seaY < TOP + c.plotH) {
				ctx.strokeStyle = '#3f7f9f';
				ctx.setLineDash([4, 4]);
				ctx.beginPath();
				ctx.moveTo(ML, c.seaY);
				ctx.lineTo(w - MR, c.seaY);
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = '#3f7f9f';
				ctx.fillText(c.seaLabel, w - MR - 70, c.seaY - 3);
			}
			// the plate band and the boundary ticks: the bnd of sample i is the crossing to
			// sample i+1, so it is drawn at the end of i's span (a closed cut wraps at the edge)
			for (i = 0; i < n; i++) {
				var px = c.xs[i], pe = i + 1 < n ? c.xs[i + 1] : w - MR;
				ctx.fillStyle = p.alive[i] ? PLATE_RGB[c.plateC[i]] : '#10141c';
				ctx.fillRect(px, c.bandY, pe - px, BAND_H);
			}
			for (i = 0; i < n; i++) {
				if (p.bnd[i] === 0) continue;
				var bx = i + 1 < n ? c.xs[i + 1] : w - MR;
				ctx.fillStyle = BND_RGB[p.bnd[i]] || BND_RGB[1];
				ctx.fillRect(bx - 1, c.bandY, 2, BAND_H);
			}
			// the elevation axis, right-aligned in the left margin
			ctx.fillStyle = '#55637d';
			ctx.textAlign = 'right';
			for (k = 0; k <= 4; k++) {
				var z = c.zTop - (c.zTop - c.zBot) * k / 4;
				var zy = TOP + (c.zTop - z) / (c.zTop - c.zBot) * c.plotH;
				ctx.fillRect(ML - 4, zy, 4, 1);
				ctx.fillText((z / 1000).toFixed(1) + ' km', ML - 6, zy + 3);
			}
			ctx.textAlign = 'left';
			// the ruler: arc distance and the lat/lon the path block gives for it
			ctx.strokeStyle = '#2a3550';
			for (i = 0; i < c.ticks.length; i++) {
				var t = c.ticks[i];
				ctx.fillStyle = '#2a3550';
				ctx.fillRect(t.x, c.rulerY, 1, 5);
				ctx.fillStyle = '#7f8ea8';
				ctx.fillText(t.km + ' km', t.x + 3, c.rulerY + 8);
				ctx.fillStyle = '#55637d';
				ctx.fillText(t.ll, t.x + 3, c.rulerY + 20);
			}
		}
	};
	return SectionPack;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SectionPack;
