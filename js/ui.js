(function (root) {
// ui.js — the only DOM file besides render.present(): the two log time sliders, the two
// axis scale sliders flanking the canvas, the scale-lines toggle, cursor-anchored pan/zoom,
// presets, the geology probe and the 2 Hz HUD. The camera is moved only through GEO
// (lookAt/panBy/zoomAt/setZoomX/setZoomY/setPreset) so the LUTs cannot go stale, and every
// move funnels through afterView() so the sliders cannot drift from the camera.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var node = typeof module !== 'undefined' && module.exports;
var ORE = node ? require('./ore.js') : root.COLORE;

function sim() { return node ? require('./sim.js') : root.COLSIM; }
function renderer() { return node ? require('./render.js') : root.COLRENDER; }
function perf() { return node ? require('./perf.js') : root.COLPERF; }
function section() { return node ? require('./section-pack.js') : root.COLSECTION; }
function element(host, id) {
	if (!host) return null;
	if (host.getElementById) return host.getElementById(id);
	return host.querySelector ? host.querySelector('#' + id) : null;
}
function listen(target, type, fn, opts) {
	if (!target || !target.addEventListener) return;
	target.addEventListener(type, fn, opts);
	UI._listeners.push([target, type, fn, opts]);
}

var UI = {
	_listeners: [],
	host: null, doc: null, win: null,
	mx: -1, my: -1,        // last cursor position, canvas px
	cursor: '',            // cursor world readout; rebuilt on mousemove only
	dragX: 0, dragY: 0, dragging: false,
	paused: false,
	cvs: null, hud: null, sGeo: null, sErupt: null, vGeo: null, vErupt: null,
	sVZoom: null, sHZoom: null, vZoom: null, cScale: null,
	bMesh: null, presets: null, presetName: 'def',
	bDeposits: null, orePanel: null, orePick: null, oreInfo: null, oreStatus: null,
	oreMine: null, oreMineAll: null, selectedDepId: 0, oreCounts: new Uint8Array(P.OCLS.n),

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

	init: function (host) {
		this.stop();
		this.host = host || root.document;
		this.doc = this.host && this.host.nodeType === 9 ? this.host : this.host && this.host.ownerDocument;
		this.win = this.doc && this.doc.defaultView ? this.doc.defaultView : root;
		var self = this;
		this.cvs = element(this.host, 'c');
		this.hud = element(this.host, 'hud');
		this.sGeo = element(this.host, 'sGeo');
		this.sErupt = element(this.host, 'sErupt');
		this.vGeo = element(this.host, 'vGeo');
		this.vErupt = element(this.host, 'vErupt');
		this.sGeo.value = Math.round(1000 * this.gToS(P.sl.geo));
		this.sErupt.value = Math.round(1000 * this.eToS(P.sl.erupt));
		this.vGeo.textContent = this.fmtGeo(P.sl.geo);
		this.vErupt.textContent = this.fmtErupt(P.sl.erupt);
		listen(this.sGeo, 'input', function () {
			P.sl.geo = self.sToGeo(this.value / 1000);
			sim().setGeo(P.sl.geo);
			self.vGeo.textContent = self.fmtGeo(P.sl.geo);
		});
		listen(this.sErupt, 'input', function () {
			P.sl.erupt = self.sToErupt(this.value / 1000);
			self.vErupt.textContent = self.fmtErupt(P.sl.erupt);
		});
		this.sVZoom = element(this.host, 'sVZoom');
		this.sHZoom = element(this.host, 'sHZoom');
		this.vZoom = element(this.host, 'vZoom');
		this.cScale = element(this.host, 'cScale');
		listen(this.sVZoom, 'input', function () {
			GEO.setZoomY(self.sToZ(this.value / 1000, GEO.zoomYMin));
			self.unsetPreset();
			self.afterView();
		});
		listen(this.sHZoom, 'input', function () {
			GEO.setZoomX(self.sToZ(this.value / 1000, P.zoomMin));
			self.unsetPreset();
			self.afterView();
		});
		renderer().showScale = this.cScale.checked;
		listen(this.cScale, 'change', function () { renderer().showScale = this.checked; self.syncToggles(); });
		var pres = this.host.querySelectorAll('#presets button');
		for (var i = 0; i < pres.length; i++) (function (b) {
			listen(b, 'click', function () { self.preset(b.getAttribute('data-v')); });
		})(pres[i]);
		this.presets = pres;
		this.bMesh = element(this.host, 'bMesh');
		if (this.bMesh) listen(this.bMesh, 'click', function () { renderer().mesh = !renderer().mesh; self.syncToggles(); });
		this.bDeposits = element(this.host, 'bDeposits');
		if (this.bDeposits) this.bDeposits.disabled = !this.oreAvailable();
		this.orePanel = element(this.host, 'orePanel');
		this.orePick = element(this.host, 'orePick');
		this.oreInfo = element(this.host, 'oreInfo');
		this.oreStatus = element(this.host, 'oreStatus');
		this.oreMine = element(this.host, 'oreMine');
		this.oreMineAll = element(this.host, 'oreMineAll');
		this.clearOre();
		listen(this.bDeposits, 'click', function () { self.toggleDeposits(); });
		listen(this.orePick, 'change', function () {
			self.selectedDepId = Number(this.value); self.updateOre();
		});
		listen(this.oreMine, 'click', function () { self.mineOre(0.1); });
		listen(this.oreMineAll, 'click', function () { self.mineOre(1); });
		var legend = element(this.host, 'oreLegend');
		if (legend) {
			legend.textContent = '';
			for (i = 0; i < P.OCLS.n; i++) {
				var label = this.doc.createElement('span');
				label.textContent = ORE.NAME[i];
				label.setAttribute('style', 'color:' + ORE.COLOUR[i]);
				legend.appendChild(label);
			}
		}
		this.syncToggles();
		listen(this.cvs, 'mousedown', function (e) { self.down(e); });
		listen(this.cvs, 'mousemove', function (e) { self.move(e); });
		listen(this.win, 'mouseup', function () { self.dragging = false; });
		listen(this.cvs, 'wheel', function (e) { self.wheel(e); }, { passive: false });
		listen(this.win, 'keydown', function (e) { self.key(e); });
	},

	stop: function () {
		var i, e;
		for (i = 0; i < this._listeners.length; i++) {
			e = this._listeners[i];
			if (e[0].removeEventListener) e[0].removeEventListener(e[1], e[2], e[3]);
		}
		this._listeners.length = 0;
		this.dragging = false;
		this.host = null; this.doc = null; this.win = null;
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
		this.setPressed('bMesh', renderer().mesh);
		this.setPressed('bDeposits', renderer().showDeposits);
		if (this.orePanel) this.orePanel.hidden = !renderer().showDeposits;
		this.cScale.checked = renderer().showScale;
		if (!this.presets) return;
		for (i = 0; i < this.presets.length; i++) {
			this.setPressed(this.presets[i], this.presetName === this.presets[i].getAttribute('data-v'));
		}
	},

	setPressed: function (el, on) {
		var s = on ? 'true' : 'false';
		if (typeof el === 'string') el = element(this.host, el);
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
		// keys are for the page, not for whatever is being typed into: the section's paste box
		// (columns.html, 0.4.1 M1) is a textarea, and 'm' inside it must not move the mesh
		var t = e.target, tag = t && t.tagName;
		if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
		if (k === ' ') { this.togglePause(); e.preventDefault(); return; }
		if (k === 'd' || k === 'D') { if (!e.repeat) this.toggleDeposits(); return; }
		if (k === 'm') { renderer().mesh = !renderer().mesh; this.syncToggles(); return; }
		if (k === 'g') { renderer().showScale = !renderer().showScale; this.syncToggles(); return; }
		if (names[k]) this.preset(names[k]);
	},

	togglePause: function () {
		this.paused = !this.paused;
		if (this.paused) { this.geoSave = P.sl.geo; P.sl.geo = 0; sim().setGeo(0); }
		else { P.sl.geo = this.geoSave || P.sl.geo; sim().setGeo(P.sl.geo); }
		this.sGeo.value = Math.round(1000 * this.gToS(P.sl.geo));
		this.vGeo.textContent = this.fmtGeo(P.sl.geo);
	},

	clearOre: function () {
		this.selectedDepId = 0; renderer().selectedDepId = 0;
		if (this.orePick) { this.orePick.textContent = ''; this.orePick.value = ''; }
		if (this.oreMine) this.oreMine.disabled = true;
		if (this.oreMineAll) this.oreMineAll.disabled = true;
	},

	toggleDeposits: function () {
		renderer().showDeposits = !renderer().showDeposits;
		this.syncToggles();
		this.updateOre();
	},

	oreAvailable: function () {
		var sec = section();
		return !sec.mode || (sec.world && !sec.raw);
	},

	// Rebuilt on user actions and the existing 2 Hz HUD cadence, never in the raster.
	updateOre: function () {
		if (!this.orePick || !renderer().showDeposits) return;
		var available = this.oreAvailable(), selected = this.selectedDepId;
		var order = ORE.ranked(S), counts = this.oreCounts, i, d, cls, option;
		counts.fill(0);
		this.orePick.textContent = '';
		if (available) for (i = 0; i < order.length; i++) {
			d = order[i]; cls = S.depCls[d];
			if (counts[cls] >= P.oreListPerClass && S.depId[d] !== selected) continue;
			counts[cls]++;
			option = this.doc.createElement('option');
			option.value = String(S.depId[d]);
			option.textContent = ORE.NAME[cls] + ' #' + S.depId[d] + ' · ' +
				(ORE.tonnes(S, d) / 1e6).toFixed(2) + ' Mt/m · col ' + S.depCol[d];
			this.orePick.appendChild(option);
		}
		d = available ? ORE.byId(S, selected) : -1;
		if (d < 0) this.selectedDepId = 0;
		renderer().selectedDepId = this.selectedDepId;
		this.orePick.value = this.selectedDepId ? String(this.selectedDepId) : '';
		this.orePick.disabled = !available;
		this.oreMine.disabled = d < 0; this.oreMineAll.disabled = d < 0;
		if (!available) { this.oreInfo.textContent = 'Live resources are available in the reconstructed view, not the raw cut.'; return; }
		if (d < 0) {
			this.oreInfo.textContent = order.length + ' live deposits · up to ' + P.oreListPerClass +
				' per class, ranked by remaining tonnage.\nSelect a deposit; extraction removes its real host rock.\n' +
				S.depBlocked + ' capacity deferrals · grade is a frozen 0–1 index.';
			return;
		}
		var c = S.depCol[d], k = S.depLay[d], b = c * P.layerCap + k;
		this.oreInfo.textContent = ORE.NAME[S.depCls[d]] + ' #' + S.depId[d] + ' · col ' + c + ' / layer ' + k +
			' · ' + renderer().LITH_NAME[S.layLi[b]] + '\n' +
			(ORE.depth(S, d) / 1000).toFixed(2) + ' km deep · host formed ' + S.layAg[b].toFixed(2) +
			' Myr · mineralized ' + S.depAg[d].toFixed(2) + ' Myr\n' +
			(ORE.tonnes(S, d) / 1e6).toFixed(3) + ' Mt/m remaining · grade index ' + S.depGr[d].toFixed(3);
	},

	mineOre: function (fraction) {
		if (!this.oreAvailable()) return;
		var d = ORE.byId(S, this.selectedDepId);
		if (d < 0) { this.clearOre(); this.updateOre(); return; }
		var id = S.depId[d], volume = ORE.extract(S, id, S.depVol[d] * fraction);
		if (this.oreStatus) this.oreStatus.textContent = 'Extracted ' + Math.round(volume) +
			' m2 from deposit #' + id + ' · booked as consumed host rock in ledCons; no automatic refill.';
		this.updateOre(); this.updateCursor();
	},

	// event-driven (mousemove / view change / extraction), never per frame
	updateCursor: function () {
		if (this.mx < 0 || this.my < 0 || this.mx >= P.cw || this.my >= P.ch) {
			this.cursor = '';
			renderer().probe = '';
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
		renderer().updateProbe(this.mx, this.my);
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

	// 2 Hz: the only place HUD strings are built. The text is a function of its own so the
	// section page (js/section-pack.js) can put its lines above the engine's without owning a
	// second HUD.
	hudText: function () {
		var s = 't ' + sim().t.toFixed(3) + ' Myr   Tm ' + sim().Tm.toFixed(3) + '   frame ' + sim().frame;
		var vents = 0, vi;
		for (vi = 0; vi < S.nVen; vi++) if (S.venCol[vi] >= 0) vents++;
		s += '\nplates ' + this.fmtGeo(P.sl.geo) + '   lava ' + this.fmtErupt(P.sl.erupt);
		s += '\nfps ' + perf().fps.toFixed(1) + '   ms ' + (perf().msSim + perf().msDraw).toFixed(2) +
			' (sim ' + perf().msSim.toFixed(2) + ' + draw ' + perf().msDraw.toFixed(2) + ')';
		s += '\ncols ' + S.nCol + '/' + P.colCap + '   plates ' + S.nPl + '   vents ' + vents +
			'   ribbons ' + S.nRib + '   plumes ' + S.nPlm + '   deposits ' + S.nDep + '   seed ' + P.seed;
		s += '\n' + this.tectonics();
		s += '   arc melt ' + Math.round(S.meltArc) + ' m2   plume melt ' + Math.round(S.meltPlume) + ' m2';
		if (renderer().showDeposits) this.updateOre();
		return s;
	},

	updateHud: function () { this.hud.textContent = this.hudText(); }
};

if (typeof module !== 'undefined' && module.exports) module.exports = UI;
else root.COLUI = UI;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
