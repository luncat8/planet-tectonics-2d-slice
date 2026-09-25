// ui.js — the two log sliders, cursor-anchored pan/zoom + per-axis presets, the cursor
// readout and the 2 Hz HUD. Probe (M1) and save/load (M6) land here later.
'use strict';

var UI = {
	mx: -1, my: -1,        // last cursor position, canvas px
	cursor: '',            // cursor world readout; rebuilt on mousemove only
	dragX: 0, dragY: 0, dragging: false,
	cvs: null, hud: null, sGeo: null, sErupt: null, vGeo: null, vErupt: null,
	presets: null,

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
		this.cvs = document.getElementById('c');
		this.hud = document.getElementById('hud');
		this.sGeo = document.getElementById('sGeo');
		this.sErupt = document.getElementById('sErupt');
		this.vGeo = document.getElementById('vGeo');
		this.vErupt = document.getElementById('vErupt');
		// the window is display-space {cx, kx, uT, uB}; zoom/pan are exact in u-space.
		// Presets set the axes separately: the overview keeps the default horizontal
		// scale while fitting the full depth (design §1.4 zoom note)
		this.kx0 = P.winW / P.cw;
		this.du0 = (GEO.u(P.winTop) - GEO.u(P.winBot)) / P.ch;
		this.kxMin = this.kx0 / P.zoomMax; this.kxMax = this.kx0 / P.zoomMin;
		this.duMin = this.du0 / P.zoomMax; this.duMax = this.du0 / P.zoomMin;
		this.presets = {
			def: { kx: this.kx0, uT: GEO.u(P.winTop), uB: GEO.u(P.winBot) },
			ovw: { kx: this.kx0, uT: GEO.u(P.skyTop), uB: GEO.u(-P.R) },
			cru: { kx: this.kx0 / 10, uT: GEO.u(-17.5e3 + (P.winTop - P.winBot) / 20), uB: GEO.u(-17.5e3 - (P.winTop - P.winBot) / 20) },
			bas: { kx: this.kx0 / 40, uT: GEO.u(-5e3 + (P.winTop - P.winBot) / 80), uB: GEO.u(-5e3 - (P.winTop - P.winBot) / 80) }
		};
		this.sGeo.value = Math.round(1000 * this.gToS(P.sl.geo));
		this.sErupt.value = Math.round(1000 * this.eToS(P.sl.erupt));
		this.vGeo.textContent = this.fmtGeo(P.sl.geo);
		this.vErupt.textContent = this.fmtErupt(P.sl.erupt);
		var self = this;
		this.sGeo.addEventListener('input', function () {
			P.sl.geo = self.sToGeo(this.value / 1000);
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
		this.cvs.addEventListener('mousedown', function (e) { self.down(e); });
		this.cvs.addEventListener('mousemove', function (e) { self.move(e); });
		window.addEventListener('mouseup', function () { self.dragging = false; });
		this.cvs.addEventListener('wheel', function (e) { self.wheel(e); }, { passive: false });
		this.preset('def');
	},

	preset: function (name) {
		var p = this.presets[name];
		if (!p) return;
		P.view.cx = 0;
		P.view.kx = p.kx;
		P.view.uT = p.uT;
		P.view.uB = p.uB;
		GEO.rebuild(P.view);
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
			var v = P.view;
			var dU = (p.y - this.dragY) * GEO.duPx;
			v.cx -= (p.x - this.dragX) * GEO.kx;
			v.uT += dU;                           // the window follows the cursor
			v.uB += dU;
			this.dragX = p.x;
			this.dragY = p.y;
			GEO.rebuild(v);
		}
		this.updateCursor();
	},

	// the world point under the cursor stays under the cursor; exact because the
	// window lives in u-space (the axes are clamped independently)
	wheel: function (e) {
		e.preventDefault();
		var p = this.pos(e);
		var v = P.view;
		var f = Math.pow(1.0015, -e.deltaY);
		var kx = Math.min(this.kxMax, Math.max(this.kxMin, v.kx / f));
		var du = Math.min(this.duMax, Math.max(this.duMin, GEO.duPx / f));
		var uc = GEO.uT - p.y * GEO.duPx;         // world u under the cursor
		var wx = GEO.x0 + p.x * GEO.kx;
		v.cx = wx + (P.cw / 2 - p.x) * kx;
		v.uT = uc + p.y * du;
		v.uB = v.uT - P.ch * du;
		v.kx = kx;
		GEO.rebuild(v);
		this.updateCursor();
	},

	// event-driven (mousemove), never per frame
	updateCursor: function () {
		if (this.mx < 0 || this.my < 0 || this.mx >= P.cw || this.my >= P.ch) { this.cursor = ''; return; }
		var wy = GEO.lutY[this.my | 0];
		var wx = GEO.x0 + this.mx * GEO.kx;
		var mpx = Math.sqrt(P.yLin * P.yLin + wy * wy) * GEO.duPx;
		var xw = ((wx % P.wrap) + P.wrap) % P.wrap;
		var s = (xw / 1e3).toFixed(1) + ' km  ' + (wy / 1e3).toFixed(wy > -1e5 && wy < 1e5 ? 2 : 0) + ' km | ';
		s += (GEO.kx / 1e3).toFixed(2) + ' km/px  ';
		s += mpx < 1000 ? Math.round(mpx) + ' m/px' : (mpx / 1e3).toFixed(2) + ' km/px';
		this.cursor = s;
	},

	// 2 Hz: the only place HUD strings are built
	updateHud: function () {
		var s = 't ' + (SIM.t / 1e6).toFixed(3) + ' Myr   Tm ' + SIM.Tm.toFixed(3) + '   frame ' + SIM.frame;
		s += '\nplates ' + this.fmtGeo(P.sl.geo) + '   lava ' + this.fmtErupt(P.sl.erupt);
		s += '\nfps ' + PERF.fps.toFixed(1) + '   ms ' + (PERF.msSim + PERF.msDraw).toFixed(2) +
			' (sim ' + PERF.msSim.toFixed(2) + ' + draw ' + PERF.msDraw.toFixed(2) + ')';
		s += '\ncols ' + S.nCol + '/' + P.colCap + '   plates ' + S.nPl + '   vents ' + S.nVen +
			'   ribbons ' + S.nRib + '   plumes ' + S.nPlm + '   deposits ' + S.nDep + '   seed ' + P.seed;
		this.hud.textContent = s;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
