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

var PTUI = {
	paused: false, stepOnce: false, quality: 1,
	cvs: null, hud: null, sClock: null, vClock: null,
	mx: -1, my: -1, dragging: false, dragX: 0, dragY: 0,
	probe: '', probeOn: false,

	QUALITY: [[128, 48], [256, 96], [512, 192]],
	mpc: [8, 4, 2],              // markers per node per quality level: the marker count is the
	                             // frame's real cost, and it is the same at every level

	init: function (SIM) {
		this.cvs = document.getElementById('c');
		this.hud = document.getElementById('hud');
		this.sClock = document.getElementById('sClock');
		this.vClock = document.getElementById('vClock');
		this.sClock.value = this.kyrToS(P.sl.kyr);       // the slider starts where the clock is
		this.wire(SIM);
		PTRNDR.preset('mantle', SIM.M);
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
		var self = this, cvs = this.cvs;
		this.sClock.addEventListener('input', function () {
			P.sl.kyr = self.sToKyr(+self.sClock.value);
			SIM.dt = P.sl.kyr / 1000;
			self.clockLabel();
		});
		document.getElementById('bPause').addEventListener('click', function () { self.setPaused(!self.paused); });
		document.getElementById('bStep').addEventListener('click', function () { self.paused = true; self.stepOnce = true; });
		document.getElementById('bReset').addEventListener('click', function () { SIM.reset(); self.updateHud(SIM); });
		document.getElementById('bMark').addEventListener('click', function () { PTRNDR.markers = !PTRNDR.markers; });
		document.getElementById('bMelt').addEventListener('click', function () { PTRNDR.melt = !PTRNDR.melt; });
		document.getElementById('bRuler').addEventListener('click', function () { PTRNDR.ruler = !PTRNDR.ruler; });
		document.getElementById('bMesh').addEventListener('click', function () { self.cycleMesh(SIM); });
		document.getElementById('bLid').addEventListener('click', function () { PTRNDR.preset('lid', SIM.M); self.updateHud(SIM); });
		document.getElementById('bDeep').addEventListener('click', function () { PTRNDR.preset('deep', SIM.M); self.updateHud(SIM); });
		document.getElementById('bFull').addEventListener('click', function () { PTRNDR.preset('mantle', SIM.M); self.updateHud(SIM); });
		window.addEventListener('keydown', function (ev) { self.key(ev, SIM); });
		cvs.addEventListener('wheel', function (ev) {
			ev.preventDefault();
			var r = cvs.getBoundingClientRect();
			PTRNDR.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY > 0 ? 1.15 : 1 / 1.15, SIM.M);
		}, { passive: false });
		cvs.addEventListener('mousedown', function (ev) { self.dragging = true; self.dragX = ev.clientX; self.dragY = ev.clientY; });
		window.addEventListener('mouseup', function () { self.dragging = false; });
		window.addEventListener('mousemove', function (ev) {
			var r = cvs.getBoundingClientRect();
			if (self.dragging) {
				PTRNDR.panBy(ev.clientX - self.dragX, ev.clientY - self.dragY, SIM.M);
				self.dragX = ev.clientX; self.dragY = ev.clientY;
			}
			self.mx = ev.clientX - r.left; self.my = ev.clientY - r.top;
			self.probeAt(SIM.M);
		});
	},

	key: function (ev, SIM) {
		if (ev.key === ' ') { this.setPaused(!this.paused); ev.preventDefault(); }
		else if (ev.key === '.') { this.paused = true; this.stepOnce = true; }
		else if (ev.key === 'r') SIM.reset();
		else if (ev.key === 'm') PTRNDR.markers = !PTRNDR.markers;
		else if (ev.key === 'v') PTRNDR.melt = !PTRNDR.melt;
		else if (ev.key === 'g') PTRNDR.ruler = !PTRNDR.ruler;
		else if (ev.key === '1') this.quality = 0;
		else if (ev.key === '2') this.quality = 1;
		else if (ev.key === '3') this.quality = 2;
		else if (ev.key === 'l') PTRNDR.preset('lid', SIM.M);
		else if (ev.key === 'd') PTRNDR.preset('deep', SIM.M);
		else if (ev.key === 'f') PTRNDR.preset('mantle', SIM.M);
		else return;
		if (ev.key >= '1' && ev.key <= '3') this.cycleMesh(SIM);
	},

	setPaused: function (on) {
		this.paused = on;
		document.getElementById('bPause').textContent = on ? 'play' : 'pause';
	},

	// quality: one marker per interior node, so the cap has to follow the mesh before it is
	// rebuilt; the marker count is the frame's real cost (plan §7)
	cycleMesh: function (SIM) {
		var q = this.QUALITY[this.quality];
		P.mpc = this.mpc[this.quality];
		SIM.mesh(q[0], q[1]);
		PTRNDR.preset('mantle', SIM.M);
		this.updateHud(SIM);
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
		out = clock(SIM.t) + '   ' + (P.sl.kyr > 0 ? P.sl.kyr.toFixed(0) + ' kyr/f  ' + (P.sl.kyr * PERF.fps / 1000).toFixed(2) + ' Myr/s  fluid ' + SIM.sub + 'x' : 'paused')
			+ '\nNu ' + d.nu.toFixed(2) + '   max|u| ' + d.uMax.toFixed(1) + ' cm/yr   ' + px.toFixed(1) + ' px/f   wells ' + d.wells
			+ '\nmarkers ' + S.n + '/' + P.partCap + '  ' + P.mpc + '/node   empty ' + S.empty
			+ '   moved ' + S.moved + '  redeals ' + S.redeals + '   nodes ' + M.nx + 'x' + M.ny
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
