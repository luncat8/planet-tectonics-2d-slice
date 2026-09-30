// ui.js — the only DOM file besides render.present(): the two log time sliders, the two
// axis scale sliders flanking the canvas, the scale-lines toggle, cursor-anchored pan/zoom,
// presets, the geology probe and the 2 Hz HUD. The camera is moved only through GEO
// (lookAt/panBy/zoomAt/setZoomX/setZoomY/setPreset) so the LUTs cannot go stale, and every
// move funnels through afterView() so the sliders cannot drift from the camera.
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
	sVZoom: null, sHZoom: null, vZoom: null, cScale: null,
	bMesh: null, presets: null, presetName: 'def',

	// log-feel slider maps (slider at 0 = pause)
	sToGeo: function (s) { return s <= 0 ? 0 : P.geoMin * Math.pow(P.geoMax / P.geoMin, s); },
	gToS: function (d) { return d <= 0 ? 0 : Math.log(d / P.geoMin) / Math.log(P.geoMax / P.geoMin); },
	sToErupt: function (s) { return s <= 0 ? 0 : P.eruptMin * Math.pow(P.eruptMax / P.eruptMin, s); },
	eToS: function (d) { return d <= 0 ? 0 : Math.log(d / P.eruptMin) / Math.log(P.eruptMax / P.eruptMin); },

	// the two scale sliders are log over [axis minimum, zoomMax] — the same feel as the
	// wheel, where a constant drag is a constant magnification factor
	sToZ: function (s, zMin) { return zMin * Math.pow(P.zoomMax / zMin, s); },
	zToS: function (z, zMin) { return Math.log(z / zMin) / Math.log(P.zoomMax / zMin); },

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
		this.sVZoom = document.getElementById('sVZoom');
		this.sHZoom = document.getElementById('sHZoom');
		this.vZoom = document.getElementById('vZoom');
		this.cScale = document.getElementById('cScale');
		this.sVZoom.addEventListener('input', function () {
			GEO.setZoomY(self.sToZ(this.value / 1000, GEO.zoomYMin));
			self.unsetPreset();
			self.afterView();
		});
		this.sHZoom.addEventListener('input', function () {
			GEO.setZoomX(self.sToZ(this.value / 1000, P.zoomMin));
			self.unsetPreset();
			self.afterView();
		});
		RNDR.showScale = this.cScale.checked;
		this.cScale.addEventListener('change', function () { RNDR.showScale = this.checked; self.syncToggles(); });
		var pres = document.querySelectorAll('#presets button');
		for (var i = 0; i < pres.length; i++) (function (b) {
			b.addEventListener('click', function () { self.preset(b.getAttribute('data-v')); });
		})(pres[i]);
		this.presets = pres;
		this.bMesh = document.getElementById('bMesh');
		if (this.bMesh) this.bMesh.addEventListener('click', function () { RNDR.mesh = !RNDR.mesh; self.syncToggles(); });
		this.cvs.addEventListener('mousedown', function (e) { self.down(e); });
		this.cvs.addEventListener('mousemove', function (e) { self.move(e); });
		window.addEventListener('mouseup', function () { self.dragging = false; });
		this.cvs.addEventListener('wheel', function (e) { self.wheel(e); }, { passive: false });
		window.addEventListener('keydown', function (e) { self.key(e); });
	},

	preset: function (name) {
		GEO.setPreset(name);
		this.presetName = name;
		this.afterView();
	},

	// the camera left the preset it was on (a wheel, a drag, one axis slider): the four
	// preset buttons go out together, because none of them describes the view any more
	unsetPreset: function () {
		if (!this.presetName) return;
		this.presetName = '';
		this.syncToggles();
	},

	// the lit state of the switches, read back from the renderer and the camera rather than
	// tracked beside them: one writer, so a button cannot disagree with what is drawn
	syncToggles: function () {
		var i;
		this.setPressed('bMesh', RNDR.mesh);
		this.cScale.checked = RNDR.showScale;
		if (!this.presets) return;
		for (i = 0; i < this.presets.length; i++) {
			this.setPressed(this.presets[i], this.presetName === this.presets[i].getAttribute('data-v'));
		}
	},

	setPressed: function (el, on) {
		var s = on ? 'true' : 'false';
		if (typeof el === 'string') el = document.getElementById(el);
		if (el && el.getAttribute('aria-pressed') !== s) el.setAttribute('aria-pressed', s);
	},

	// every camera move ends here: sync the LUTs, read the two axis scales back into
	// their sliders (the wheel and the presets move both) and refresh the readouts
	afterView: function () {
		GEO.sync();
		this.sVZoom.value = Math.round(1000 * this.zToS(GEO.zoomY(), GEO.zoomYMin));
		this.sHZoom.value = Math.round(1000 * this.zToS(GEO.zoomX(), P.zoomMin));
		this.vZoom.textContent = this.fmtScale();
		this.syncToggles();
		this.updateCursor();
	},

	// metres per pixel on each axis; the vertical one is quoted at sea level, where the
	// asinh map is at its most detailed
	fmtScale: function () {
		var mpx = P.yLin * GEO.duPx;
		return 'scale  x ' + (GEO.kx / 1e3).toFixed(2) + ' km/px   y ' +
			(mpx < 1000 ? Math.round(mpx) + ' m/px' : (mpx / 1e3).toFixed(2) + ' km/px') + ' at 0 m';
	},

	// Canvas events include the CSS border; camera coordinates are content-box pixels.
	pos: function (e) {
		var r = this.cvs.getBoundingClientRect();
		var bx = this.cvs.clientLeft || 0, by = this.cvs.clientTop || 0;
		var w = this.cvs.clientWidth || (r.width - bx * 2);
		var h = this.cvs.clientHeight || (r.height - by * 2);
		return {
			x: (e.clientX - r.left - bx) * (P.cw / w),
			y: (e.clientY - r.top - by) * (P.ch / h)
		};
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
			this.unsetPreset();
		}
		this.afterView();
	},

	// the world point under the cursor stays under the cursor; exact because the window
	// lives in u-space and GEO clamps the two axes independently
	wheel: function (e) {
		e.preventDefault();
		var p = this.pos(e);
		GEO.zoomAt(Math.pow(1.0015, -e.deltaY), p.x, p.y);
		this.unsetPreset();
		this.afterView();
	},

	key: function (e) {
		var k = e.key, names = { '1': 'def', '2': 'ovw', '3': 'cru', '4': 'bas' };
		if (k === ' ') { this.togglePause(); e.preventDefault(); return; }
		if (k === 'm') { RNDR.mesh = !RNDR.mesh; this.syncToggles(); return; }
		if (k === 'g') { RNDR.showScale = !RNDR.showScale; this.syncToggles(); return; }
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

	// boundary census and the fastest plate (2 Hz, from the HUD only)
	tectonics: function () {
		var E = P.EDGE, open = 0, sub = 0, col = 0, i, uMax = 0;
		for (i = 0; i < S.nCol; i++) {
			if (S.edge[i] === E.open) open++;
			else if (S.edge[i] === E.subduct) sub++;
			else if (S.edge[i] === E.collide) col++;
		}
		for (i = 0; i < S.nPl; i++) uMax = Math.max(uMax, Math.abs(S.plU[i]));
		return 'fastest plate ' + (uMax / 1e4).toFixed(2) + ' cm/yr   opening ' + open +
			'   trenches ' + sub + '   collisions ' + col;
	},

	// 2 Hz: the only place HUD strings are built
	updateHud: function () {
		var s = 't ' + SIM.t.toFixed(3) + ' Myr   Tm ' + SIM.Tm.toFixed(3) + '   frame ' + SIM.frame;
		s += '\nplates ' + this.fmtGeo(P.sl.geo) + '   lava ' + this.fmtErupt(P.sl.erupt);
		s += '\nfps ' + PERF.fps.toFixed(1) + '   ms ' + (PERF.msSim + PERF.msDraw).toFixed(2) +
			' (sim ' + PERF.msSim.toFixed(2) + ' + draw ' + PERF.msDraw.toFixed(2) + ')';
		s += '\ncols ' + S.nCol + '/' + P.colCap + '   plates ' + S.nPl + '   vents ' + S.nVen +
			'   ribbons ' + S.nRib + '   plumes ' + S.nPlm + '   deposits ' + S.nDep + '   seed ' + P.seed;
		s += '\n' + this.tectonics();
		s += '   arc melt ' + Math.round(S.meltArc) + ' m2   plume melt ' + Math.round(S.meltPlume) + ' m2';
		this.hud.textContent = s;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
