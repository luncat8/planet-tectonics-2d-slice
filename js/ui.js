// ui.js — the only DOM file besides render.present(): two log sliders, cursor-anchored
// pan/zoom, presets, the scale readout, the geology probe and the 2 Hz HUD. The camera
// is moved only through GEO (lookAt/panBy/zoomAt/setPreset) so the LUTs cannot go stale.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;

var UI = {
	mx: -1, my: -1,        // last cursor position, canvas px
	cursor: '',            // cursor world readout; rebuilt on mousemove only
	dragX: 0, dragY: 0, dragging: false,
	paused: false,
	cvs: null, hud: null, sGeo: null, sErupt: null, vGeo: null, vErupt: null,

	// log-feel slider maps (slider at 0 = pause)
	sToGeo: function (s) { return s <= 0 ? 0 : P.geoMin * Math.pow(P.geoMax / P.geoMin, s); },
	gToS: function (d) { return d <= 0 ? 0 : Math.log(d / P.geoMin) / Math.log(P.geoMax / P.geoMin); },
	sToErupt: function (s) { return s <= 0 ? 0 : P.eruptMin * Math.pow(P.eruptMax / P.eruptMin, s); },
	eToS: function (d) { return d <= 0 ? 0 : Math.log(d / P.eruptMin) / Math.log(P.eruptMax / P.eruptMin); },

	fmtGeo: function (d) {
		if (d <= 0) return 'pause';
		return d < 1e6 ? (d / 1e3).toFixed(d < 1e4 ? 1 : 0) + ' kyr/f' : (d / 1e6).toFixed(2) + ' Myr/f';
	},
	fmtErupt: function (d) {
		if (d <= 0) return 'pause';
		return d < 3600 ? (d / 60).toFixed(1) + ' min/f' : (d / 3600).toFixed(2) + ' h/f';
	},

	init: function () {
		var self = this;
		this.cvs = document.getElementById('c');
		this.hud = document.getElementById('hud');
		this.sGeo = document.getElementById('sGeo');
		this.sErupt = document.getElementById('sErupt');
		this.vGeo = document.getElementById('vGeo');
		this.vErupt = document.getElementById('vErupt');
		this.sGeo.value = Math.round(1000 * this.gToS(P.sl.geo));
		this.sErupt.value = Math.round(1000 * this.eToS(P.sl.erupt));
		this.vGeo.textContent = this.fmtGeo(P.sl.geo);
		this.vErupt.textContent = this.fmtErupt(P.sl.erupt);
		this.sGeo.addEventListener('input', function () {
			P.sl.geo = self.sToGeo(this.value / 1000);
			SIM.setGeo(P.sl.geo);
			self.vGeo.textContent = self.fmtGeo(P.sl.geo);
		});
		this.sErupt.addEventListener('input', function () {
			P.sl.erupt = self.sToErupt(this.value / 1000);
			self.vErupt.textContent = self.fmtErupt(P.sl.erupt);
		});
		var pres = document.querySelectorAll('#presets button');
		for (var i = 0; i < pres.length; i++) (function (b) {
			b.addEventListener('click', function () { self.preset(b.getAttribute('data-v')); });
		})(pres[i]);
		var bm = document.getElementById('bMesh');
		if (bm) bm.addEventListener('click', function () { RNDR.mesh = !RNDR.mesh; });
		this.cvs.addEventListener('mousedown', function (e) { self.down(e); });
		this.cvs.addEventListener('mousemove', function (e) { self.move(e); });
		window.addEventListener('mouseup', function () { self.dragging = false; });
		this.cvs.addEventListener('wheel', function (e) { self.wheel(e); }, { passive: false });
		window.addEventListener('keydown', function (e) { self.key(e); });
	},

	preset: function (name) {
		GEO.setPreset(name);
		GEO.sync();
		this.updateCursor();
	},

	// canvas-space position, scale-correct if the page CSS-scales the canvas
	pos: function (e) {
		var r = this.cvs.getBoundingClientRect();
		return { x: (e.clientX - r.left) * (P.cw / r.width), y: (e.clientY - r.top) * (P.ch / r.height) };
	},

	down: function (e) {
		var p = this.pos(e);
		this.dragging = true;
		this.dragX = p.x;
		this.dragY = p.y;
	},

	move: function (e) {
		var p = this.pos(e);
		this.mx = p.x;
		this.my = p.y;
		if (this.dragging) {
			GEO.panBy(p.x - this.dragX, p.y - this.dragY);
			this.dragX = p.x;
			this.dragY = p.y;
		}
		GEO.sync();
		this.updateCursor();
	},

	// the world point under the cursor stays under the cursor; exact because the window
	// lives in u-space and GEO clamps the two axes independently
	wheel: function (e) {
		e.preventDefault();
		var p = this.pos(e);
		GEO.zoomAt(Math.pow(1.0015, -e.deltaY), p.x, p.y);
		GEO.sync();
		this.updateCursor();
	},

	key: function (e) {
		var k = e.key;
		if (k === ' ') { this.togglePause(); e.preventDefault(); return; }
		if (k === 'm') { RNDR.mesh = !RNDR.mesh; return; }
		var names = { '1': 'def', '2': 'ovw', '3': 'cru', '4': 'bas' };
		if (names[k]) this.preset(names[k]);
	},

	togglePause: function () {
		this.paused = !this.paused;
		if (this.paused) { this.geoSave = P.sl.geo; P.sl.geo = 0; SIM.setGeo(0); }
		else { P.sl.geo = this.geoSave || P.sl.geo; SIM.setGeo(P.sl.geo); }
		this.sGeo.value = Math.round(1000 * this.gToS(P.sl.geo));
		this.vGeo.textContent = this.fmtGeo(P.sl.geo);
	},

	// event-driven (mousemove / view change), never per frame
	updateCursor: function () {
		if (this.mx < 0 || this.my < 0 || this.mx >= P.cw || this.my >= P.ch) {
			this.cursor = '';
			RNDR.probe = '';
			return;
		}
		GEO.buildColLUT(S);
		var wy = GEO.lutY[this.my | 0];
		var wx = GEO.x0 + this.mx * GEO.kx;
		var mpx = Math.sqrt(P.yLin * P.yLin + wy * wy) * GEO.duPx;
		var xw = GEO.wrapX(wx);
		var s = (xw / 1e3).toFixed(1) + ' km  ' + (wy / 1e3).toFixed(wy > -1e5 && wy < 1e5 ? 2 : 0) + ' km | ';
		s += (GEO.kx / 1e3).toFixed(2) + ' km/px  ';
		s += mpx < 1000 ? Math.round(mpx) + ' m/px' : (mpx / 1e3).toFixed(2) + ' km/px';
		this.cursor = s;
		RNDR.updateProbe(this.mx, this.my);
	},

	// 2 Hz: the only place HUD strings are built
	updateHud: function () {
		var s = 't ' + SIM.t.toFixed(3) + ' Myr   Tm ' + SIM.Tm.toFixed(3) + '   frame ' + SIM.frame;
		s += '\nplates ' + this.fmtGeo(P.sl.geo) + '   lava ' + this.fmtErupt(P.sl.erupt);
		s += '\nfps ' + PERF.fps.toFixed(1) + '   ms ' + (PERF.msSim + PERF.msDraw).toFixed(2) +
			' (sim ' + PERF.msSim.toFixed(2) + ' + draw ' + PERF.msDraw.toFixed(2) + ')';
		s += '\ncols ' + S.nCol + '/' + P.colCap + '   plates ' + S.nPl + '   vents ' + S.nVen +
			'   ribbons ' + S.nRib + '   plumes ' + S.nPlm + '   deposits ' + S.nDep + '   seed ' + P.seed;
		this.hud.textContent = s;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
