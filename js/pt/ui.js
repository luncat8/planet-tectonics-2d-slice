// pt/ui.js — 0.3.0 P1: the only DOM file in the particle engine. The clock slider, the
// pause/step/reset transport, the quality switch, the camera (wheel zoom, drag pan, presets),
// the cursor probe, and the 2 Hz HUD. Every camera move funnels through PTRNDR so the
// resampling tables are never stale, and every state change funnels through SIM.
//
// The HUD is the demo's instrument panel: the plan's §10 acceptance asks for the geologic
// clock, the speed in px per frame, the particle counts and the heat ledger. It also prints
// the ledger's *other* side -- the wall flux the conduction operator sees -- because the gap
// between them is the marker-to-grid sampling error (grid.js scatterT), and hiding it would
// be the one dishonest readout in the panel.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.PTS;
var PERF = (typeof module !== 'undefined' && module.exports) ? require('../perf.js') : window.COLPERF;

var PTUI = {
	paused: false, stepOnce: false, quality: 0,
	cvs: null, hud: null, sClock: null, vClock: null,
	mx: -1, my: -1, dragging: false, dragX: 0, dragY: 0,
	probe: '', probeOn: false, presetName: 'mantle',

	// the bar's switches, flat tables: every toggle button lights itself from the renderer's
	// own flag (never a second copy of the state) and every preset button is a radio
	TOGGLES: [['bMark', 'markers'], ['bMelt', 'melt'], ['bCrust', 'crust'], ['bRelief', 'relief'], ['bRuler', 'ruler']],
	PRESETS: [['bLid', 'lid'], ['bDeep', 'deep'], ['bFull', 'mantle']],
	KEY_TOGGLE: { m: 'markers', v: 'melt', c: 'crust', w: 'relief', g: 'ruler' },
	KEY_PRESET: { l: 'lid', d: 'deep', f: 'mantle' },

	QUALITY: [[256, 24], [512, 48], [1024, 96]],
	mpc: [4, 2, 2],              // markers per node per quality level: the marker count is the
	                             // frame's real cost (plan §7), and finer meshes carry fewer
	                             // markers per node to keep it in the same decade

	init: function (SIM) {
		this.cvs = document.getElementById('c');
		this.hud = document.getElementById('hud');
		this.sClock = document.getElementById('sClock');
		this.vClock = document.getElementById('vClock');
		this.sClock.value = this.kyrToS(P.sl.kyr);       // the slider starts where the clock is
		this.wire(SIM);
		this.preset('mantle', SIM);
		this.clockLabel();
		this.updateHud(SIM);
	},

	// the slider is log over [dtMin, dtMax] with a hard zero at the bottom: a slider parked at
	// 0 is a pause, which is how a viewer scrubs a frame at a time
	sToKyr: function (s) {
		if (s <= 0) return 0;
		return P.dtMin * Math.pow(P.dtMax / P.dtMin, s / 500);
	},
	kyrToS: function (d) {
		if (d <= P.dtMin) return 0;
		return 500 * Math.log(d / P.dtMin) / Math.log(P.dtMax / P.dtMin);
	},

	clockLabel: function () {
		var d = P.sl.kyr;
		this.vClock.textContent = d <= 0 ? 'pause' : (d < 100 ? d.toFixed(1) : d.toFixed(0)) + ' kyr/f';
	},

	wire: function (SIM) {
		var self = this, cvs = this.cvs, i;
		this.sClock.addEventListener('input', function () {
			P.sl.kyr = self.sToKyr(+self.sClock.value);
			SIM.dt = P.sl.kyr / 1000;
			self.clockLabel();
		});
		document.getElementById('bPause').addEventListener('click', function () { self.setPaused(!self.paused); });
		document.getElementById('bStep').addEventListener('click', function () { self.setPaused(true); self.stepOnce = true; });
		document.getElementById('bReset').addEventListener('click', function () { SIM.reset(); self.updateHud(SIM); });
		document.getElementById('bNew').addEventListener('click', function () { self.newPlanet(SIM); });
		for (i = 0; i < this.TOGGLES.length; i++) this.onClick(this.TOGGLES[i][0], this.toggle, this.TOGGLES[i][1], SIM);
		for (i = 0; i < this.PRESETS.length; i++) this.onClick(this.PRESETS[i][0], this.preset, this.PRESETS[i][1], SIM);
		document.getElementById('bMesh').addEventListener('click', function () { self.nextQuality(SIM); });
		window.addEventListener('keydown', function (ev) { self.key(ev, SIM); });
		cvs.addEventListener('wheel', function (ev) {
			ev.preventDefault();
			var r = cvs.getBoundingClientRect();
			PTRNDR.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY > 0 ? 1.15 : 1 / 1.15, SIM.M);
			self.unsetPreset();
		}, { passive: false });
		cvs.addEventListener('mousedown', function (ev) { self.dragging = true; self.dragX = ev.clientX; self.dragY = ev.clientY; });
		window.addEventListener('mouseup', function () { self.dragging = false; });
		window.addEventListener('mousemove', function (ev) {
			var r = cvs.getBoundingClientRect();
			if (self.dragging) {
				PTRNDR.panBy(ev.clientX - self.dragX, ev.clientY - self.dragY, SIM.M);
				self.dragX = ev.clientX; self.dragY = ev.clientY;
				self.unsetPreset();
			}
			self.mx = ev.clientX - r.left; self.my = ev.clientY - r.top;
			self.probeAt(SIM.M);
		});
		this.syncToggles();
	},

	// the click binds its own arguments: a loop variable read inside the listener would be
	// shared by every button in the table
	onClick: function (id, fn, arg, SIM) {
		var self = this;
		document.getElementById(id).addEventListener('click', function () { fn.call(self, arg, SIM); });
	},

	// one attribute per switch: the CSS lights it, the screen reader announces it, and there
	// is no second copy of the state to drift (see the comment on TOGGLES)
	syncToggles: function () {
		var i, t;
		for (i = 0; i < this.TOGGLES.length; i++) {
			t = this.TOGGLES[i];
			this.press(t[0], !!PTRNDR[t[1]]);
		}
		for (i = 0; i < this.PRESETS.length; i++) {
			t = this.PRESETS[i];
			this.press(t[0], this.presetName === t[1]);
		}
		this.press('bPause', this.paused);
		this.press('bMesh', this.quality > 0);        // lit when the mesh is above the light one
		document.getElementById('bMesh').textContent = 'quality ' + (this.quality + 1) + '/' + this.QUALITY.length;
	},

	press: function (id, on) {
		var el = document.getElementById(id), s = on ? 'true' : 'false';
		if (el && el.getAttribute('aria-pressed') !== s) el.setAttribute('aria-pressed', s);
	},

	toggle: function (flag) {
		PTRNDR[flag] = !PTRNDR[flag];
		this.syncToggles();
	},

	// the three camera presets are a radio group: the clicked one lights, and any manual pan
	// or zoom puts the group out because the camera no longer is a preset
	preset: function (name, SIM) {
		PTRNDR.preset(name, SIM.M);
		this.presetName = name;
		this.syncToggles();
		this.updateHud(SIM);
	},

	unsetPreset: function () {
		if (!this.presetName) return;
		this.presetName = '';
		this.syncToggles();
	},

	key: function (ev, SIM) {
		var k = ev.key, t = this.KEY_TOGGLE[k] || this.KEY_PRESET[k];
		if (t) { if (this.KEY_TOGGLE[k]) this.toggle(t); else this.preset(t, SIM); return; }
		if (k === ' ') { this.setPaused(!this.paused); ev.preventDefault(); return; }
		if (k === '.') { this.setPaused(true); this.stepOnce = true; return; }
		if (k === 'r') { SIM.reset(); this.updateHud(SIM); return; }
		if (k === 'n') { this.newPlanet(SIM); return; }
		if (k >= '1' && k <= '3') { this.quality = +k - 1; this.cycleMesh(SIM); }
	},

	// the next seed: a different draw of the initial perturbation's band (params.js icBand)
	newPlanet: function (SIM) {
		P.seed++;
		SIM.reset();
		this.updateHud(SIM);
	},

	setPaused: function (on) {
		this.paused = on;
		document.getElementById('bPause').textContent = on ? 'play' : 'pause';
		this.syncToggles();
	},

	// the button walks the three levels; the number keys pick one directly
	nextQuality: function (SIM) {
		this.quality = (this.quality + 1) % this.QUALITY.length;
		this.cycleMesh(SIM);
	},

	// quality: one marker per interior node, so the cap has to follow the mesh before it is
	// rebuilt; the marker count is the frame's real cost (plan §7)
	cycleMesh: function (SIM) {
		var q = this.QUALITY[this.quality];
		P.mpc = this.mpc[this.quality];
		SIM.mesh(q[0], q[1]);
		this.preset('mantle', SIM);
	},

	// the cursor probe: world x, depth and the field's temperature there (mousemove only)
	probeAt: function (M) {
		var v = P.view, w = this.cvs.width, h = this.cvs.height;
		if (this.mx < 0 || this.my < 0 || this.mx > w || this.my > h) { this.probeOn = false; return; }
		var xk = v.cx + (this.mx - w * 0.5) * v.kx;
		xk -= Math.floor(xk / M.wrap) * M.wrap;
		var e = v.eT + this.my / h * (v.eB - v.eT);
		var y = e < 0 ? 0 : M.yLin * Math.sinh(e);
		this.probe = 'x ' + xk.toFixed(0) + ' km   y ' + y.toFixed(0) + ' km   eta ' + e.toFixed(3) + '   T ' + this.sample(M, xk, e).toFixed(3);
		this.probeOn = true;
	},

	sample: function (M, xk, e) {
		var i = Math.floor(xk / M.dx), j = Math.floor(e / M.dEta);
		if (j < 0 || j >= M.ny) return 0;
		var fx = xk / M.dx - i, fy = e / M.dEta - j;
		var i1 = i + 1 === M.nx ? 0 : i + 1, b = j * M.nx, t = S.Tg;
		var a = t[b + i] + (t[b + i1] - t[b + i]) * fx;
		var c = t[b + M.nx + i] + (t[b + M.nx + i1] - t[b + M.nx + i]) * fx;
		return a + (c - a) * fy;
	},

	// 2 Hz. Strings are built here and only here in the engine.
	updateHud: function (SIM) {
		var M = SIM.M, d = S.d, out;
		var px = d.uMax * (P.sl.kyr / 1000) / P.view.kx;      // the fastest marker, px per frame
		out = clock(SIM.t) + '   seed ' + P.seed + '   ' + (P.sl.kyr > 0 ? P.sl.kyr.toFixed(0) + ' kyr/f  ' + (P.sl.kyr * PERF.fps / 1000).toFixed(2) + ' Myr/s  fluid ' + SIM.sub + 'x' : 'paused')
			+ '\nNu ' + d.nu.toFixed(2) + '   max|u| ' + d.uMax.toFixed(1) + ' cm/yr   ' + px.toFixed(1) + ' px/f   wells ' + d.wells
			+ '\nmarkers ' + S.n + '/' + P.partCap + '  ' + P.mpc + '/node   empty ' + S.empty
			+ '   moved ' + S.moved + '  redeals ' + S.redeals + '   nodes ' + M.nx + 'x' + M.ny
			+ '\ncrust ' + (d.lid * 100).toFixed(0) + '% of markers strong   plates ' + d.plates
			+ '   plate drift ' + d.plV.toFixed(1) + ' cm/yr'
			+ '\nsurface ' + d.zMin.toFixed(1) + '..' + d.zMax.toFixed(1) + ' km   (zero mean, drawn x' + P.kRelief + ')'
			+ '\nledger ' + fmt(S.ledger) + '   walls ' + fmt(S.wall) + '   gap ' + (S.wall ? (S.ledger / S.wall).toFixed(1) + 'x' : '--')
			+ '\nT ' + d.tMin.toFixed(3) + '..' + d.tMax.toFixed(3) + '   heat ' + fmt(d.heat)
			+ '\nmelt* ' + d.melt.toFixed(2) + '   source depth ' + d.meltY.toFixed(0) + ' km'
			+ '\nsim ' + PERF.msSim.toFixed(1) + ' ms   draw ' + PERF.msDraw.toFixed(1) + ' ms   fps ' + PERF.fps.toFixed(0);
		if (this.probeOn) out += '\n' + this.probe;
		this.hud.textContent = out;
	}
};

function clock(t) {
	if (t < 1000) return 't ' + t.toFixed(1) + ' Myr';
	return 't ' + (t / 1000).toFixed(3) + ' Gyr';
}
function fmt(v) {
	var a = v < 0 ? -v : v;
	if (a < 1e4) return v.toFixed(0);
	return v.toExponential(2);
}

if (typeof module !== 'undefined' && module.exports) module.exports = PTUI; else window.PTUI = PTUI;
