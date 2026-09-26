// render.js — the section view (design §7). Hybrid: a per-pixel body raster written
// into an ImageData word buffer, plus a canvas 2D overlay.
// Headless core: body(S, px, w, h) writes into a caller-supplied buffer and touches no
// DOM — that is what lets experiments/raster-bench.js time the real raster under node.
// Only init(), present() and the overlay touch the canvas. No per-frame allocation or
// string building: labels come from view-change or mousemove time.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;

var RNDR = {
	ctx: null, img: null, px: null, w: 0, h: 0,
	mohoY: null,
	profY: null,          // profile altitude per screen column, rebuilt by body()
	mesh: false,          // the M0 measuring-tool overlay, toggled from the UI
	probe: '',            // geology under the cursor, rebuilt on mousemove only
	palLith: null, palMantle: null, palWater: null, palAir: null
};

// lith base colours [r, g, b]
RNDR.LITH_RGB = [
	[205, 185, 145], // sed: tan sandstone
	[220, 165, 140], // fel: granite buff
	[70, 75, 82],    // maf: basalt dark grey
	[165, 150, 130], // tephra: ash grey-brown
	[140, 60, 45],   // lava: volcanic brown-red
	[195, 85, 60]    // sill: intrusive orange
];
RNDR.LITH_NAME = ['sed', 'felsic', 'mafic', 'tephra', 'lava', 'sill'];

RNDR.RGBA = function (r, g, b) {
	var c = function (v) { return v < 0 ? 0 : (v > 255 ? 255 : v) & 255; };
	return ((255 << 24) | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
};

// little-endian ABGR words over the ImageData bytes
RNDR.init = function (canvas) {
	this.ctx = canvas.getContext('2d', { alpha: false });
	this.w = canvas.width;
	this.h = canvas.height;
	this.img = this.ctx.createImageData(this.w, this.h);
	this.px = new Uint32Array(this.img.data.buffer);
	this.ctx.font = '10px monospace';
};

// Palettes are prebuilt tables indexed by integers, so the body pass is multiply-add
// and never computes a colour. Allocates its own tables: the headless bench runs
// without init().
RNDR.buildPalette = function () {
	var i, k, n = P.LITH.n, base, f;
	this.palLith = new Uint32Array(n * 16);
	for (i = 0; i < n; i++) {
		base = this.LITH_RGB[i];
		for (k = 0; k < 16; k++) {
			// ±15% value by layer index: crisp bedding stripes at any zoom
			f = 0.82 + 0.04 * (k % 5) + (k >= 8 ? 0.03 : 0);
			this.palLith[i * 16 + k] = this.RGBA(base[0] * f, base[1] * f, base[2] * f);
		}
	}
	// mantle indexed by row (depth) and thermal anomaly bin (-0.6..0.6 -> 0..7)
	this.palMantle = new Uint32Array(P.nRows * 8);
	for (i = 0; i < P.nRows; i++) {
		var rf = i / (P.nRows - 1);
		var mr = 50 + 130 * Math.pow(rf, 0.75), mg = 36 + 40 * Math.pow(rf, 0.9), mb = 22 + 20 * rf;
		for (k = 0; k < 8; k++) {
			var tf = (k - 3.5) / 3.5;
			this.palMantle[i * 8 + k] = this.RGBA(
				mr + (tf > 0 ? 55 * tf : 20 * tf),
				mg + (tf > 0 ? 25 * tf : 15 * tf),
				mb + (tf > 0 ? -10 * tf : 50 * -tf));
		}
	}
	this.palWater = new Uint32Array(64);
	this.palAir = new Uint32Array(64);
	for (i = 0; i < 64; i++) {
		var wf = i / 63, af = i / 63;
		this.palWater[i] = this.RGBA(18 - 14 * wf, 58 - 36 * wf, 110 - 55 * wf);
		this.palAir[i] = this.RGBA(7 + 10 * (1 - af), 10 + 15 * (1 - af), 16 + 25 * (1 - af));
	}
};

// --- body pass (headless) -------------------------------------------------------

// 1. profile altitude per screen column: the column tops interpolated by the column
//    LUT, plus relief noise scaled by the local relief, so plains stay smooth and
//    mountain fronts get jagged (design §7).
RNDR.buildProfile = function (w) {
	var lutCol = GEO.lutCol, lutFrac = GEO.lutFrac, profY = this.profY;
	var n = S.nCol, px, c0, c1, f, z, relief, n0, n1;
	for (px = 0; px < w; px++) {
		c0 = lutCol[px];
		if (c0 < 0) { profY[px] = 0; continue; }
		c1 = c0 + 1 < n ? c0 + 1 : 0;
		f = lutFrac[px];
		z = S.z[c0] + (S.z[c1] - S.z[c0]) * f;
		relief = P.reliefBase + P.reliefK * Math.abs(S.z[c1] - S.z[c0]);
		n0 = S.noise[c0]; n1 = S.noise[c1];
		profY[px] = z + relief * (n0 + (n1 - n0) * f);
		this.mohoY[px] = profY[px] - (S.hTot[c0] + (S.hTot[c1] - S.hTot[c0]) * f);
	}
};

// 2. the raster. Three pointer walks per screen column — air/water above the profile,
//    the layer stack down to the Moho, the fan below it. O(pixels + layers).
RNDR.body = function (px, w, h) {
	if (!this.palLith) this.buildPalette();
	// no columns yet: the whole window is sky (lutCol is all -1, nothing would paint)
	if (S.nCol === 0) { px.fill(this.palAir[63]); return; }
	if (!this.profY || this.profY.length < w) {
		this.profY = new Float64Array(w);
		this.mohoY = new Float64Array(w);
	}
	this.buildProfile(w);
	var lutCol = GEO.lutCol, lutY = GEO.lutY, lutX = GEO.lutX;
	var lutRow = GEO.lutRow, lutBase = GEO.lutRowBase, lutCnt = GEO.lutRowCnt, lutInvP = GEO.lutRowInvP;
	var palLith = this.palLith, palMantle = this.palMantle, palWater = this.palWater, palAir = this.palAir;
	var profY = this.profY, Tf = S.Tf, LC = P.layerCap, n = S.nCol;
	var c, s, off, pY, mohoY, nLay, b, layIdx, layBot, y, lith, wd, ad, j, cnt, row, tb, wx, invP;

	for (var pxc = 0; pxc < w; pxc++) {
		c = lutCol[pxc];
		if (c < 0) continue;
		pY = profY[pxc];
		nLay = S.colNL[c];
		b = c * LC;
		mohoY = this.mohoY[pxc];
		// Display-only stretch: stored beds and mass are never resampled.
		var stretch = S.hTot[c] > 0 ? (pY - mohoY) / S.hTot[c] : 1;
		wx = lutX[pxc];
		layIdx = nLay - 1;
		layBot = layIdx >= 0 ? pY - S.layTh[b + layIdx] * stretch : -Infinity;
		s = 0;
		off = pxc;

		while (s < h && lutY[s] > pY) {
			y = lutY[s];
			if (y <= 0) {
				wd = (-y * 0.01) | 0;
				px[off] = palWater[wd < 63 ? wd : 63];
			} else {
				ad = (y * 0.002) | 0;
				px[off] = palAir[ad < 63 ? ad : 63];
			}
			s++; off += w;
		}

		while (s < h && lutY[s] > mohoY) {
			y = lutY[s];
			while (layIdx > 0 && y < layBot) {
				layIdx--;
				layBot -= S.layTh[b + layIdx] * stretch;
			}
			lith = layIdx >= 0 ? S.layLi[b + layIdx] : P.LITH.fel;
			px[off] = palLith[(lith << 4) | (layIdx & 15)];
			s++; off += w;
		}

		while (s < h) {
			row = lutRow[s];
			if (row < 0) row = 0;
			cnt = lutCnt[s];
			j = (wx * lutInvP[s]) | 0;
			if (j >= cnt) j = cnt - 1;
			tb = ((Tf[lutBase[s] + j] + 0.6) * 6.6666667) | 0;
			px[off] = palMantle[(row << 3) | (tb < 0 ? 0 : (tb > 7 ? 7 : tb))];
			s++; off += w;
		}
	}
};

RNDR.present = function () { this.ctx.putImageData(this.img, 0, 0); };

// --- overlay --------------------------------------------------------------------

RNDR.overlay = function () {
	this.overlayProfile();
	if (this.mesh) this.overlayMesh();
	this.overlayGrid();
	this.overlayCursor();
};

// the topographic profile and the Moho, from the same buffers the body pass used
RNDR.overlayProfile = function () {
	var c = this.ctx, px, s, col, n = S.nCol;
	if (n === 0) return;
	c.lineWidth = 1;
	c.beginPath();
	for (px = 0; px < this.w; px++) {
		s = GEO.sy(this.profY[px]);
		if (px === 0) c.moveTo(px + 0.5, s); else c.lineTo(px + 0.5, s);
	}
	c.strokeStyle = 'rgba(235,225,200,0.75)';
	c.stroke();
	c.beginPath();
	for (px = 0; px < this.w; px++) {
		col = GEO.lutCol[px];
		if (col < 0) continue;
		s = GEO.sy(this.mohoY[px]);
		if (px === 0) c.moveTo(px + 0.5, s); else c.lineTo(px + 0.5, s);
	}
	c.strokeStyle = 'rgba(255,230,140,0.5)';
	c.stroke();
};

// the M0 measuring tool: graded rows, fan cell walls, column ticks, plate boundaries
RNDR.overlayMesh = function () {
	var c = this.ctx, i, b, s, px, n = S.nCol;
	c.beginPath();
	for (i = 1; i <= GEO.N; i++) {
		s = GEO.sy(-GEO.hTop[i]);
		if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
	}
	for (i = 1; i <= GEO.skyN; i++) {
		s = GEO.sy(GEO.hTop[i]);
		if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
	}
	c.lineWidth = 1;
	c.strokeStyle = 'rgba(130,120,100,0.28)';
	c.stroke();
	c.beginPath();
	for (b = 0; b < GEO.bands; b++) {
		var sT = GEO.sy(-GEO.hTop[GEO.bandRow[b]]);
		var sB = GEO.sy(-GEO.hTop[GEO.bandBot[b]]);
		if (sB < 0 || sT > P.ch) continue;
		if (sT < 0) sT = 0;
		if (sB > P.ch) sB = P.ch;
		c.moveTo(0, sT); c.lineTo(P.cw, sT);
		var Cn = GEO.fanN[GEO.bandRow[b]];
		var pitch = P.wrap / Cn;
		var x1 = GEO.x0 + P.cw * GEO.kx;
		// strided: never draw cell walls closer than 3 px
		var st = Math.max(1, Math.ceil(3 * Cn * GEO.kx / P.wrap));
		for (i = Math.ceil(GEO.x0 / pitch); i * pitch <= x1; i += st) {
			s = GEO.sx(i * pitch);
			c.moveTo(s, sT); c.lineTo(s, sB);
		}
	}
	c.strokeStyle = 'rgba(170,150,110,0.4)';
	c.stroke();
	// real column ticks + plate boundary lines
	c.beginPath();
	for (i = 0; i < n; i++) {
		s = GEO.sx(S.colX[i]);
		if (s >= 0 && s <= P.cw) { c.moveTo(s, 0); c.lineTo(s, 6); }
	}
	c.strokeStyle = 'rgba(140,170,220,0.5)';
	c.stroke();
	c.beginPath();
	for (i = 0; i < n; i++) {
		var j = i + 1 < n ? i + 1 : 0;
		if (S.colPlate[i] === S.colPlate[j]) continue;
		s = GEO.sx(S.colX[j]);
		if (s >= 0 && s <= P.cw) { c.moveTo(s, 0); c.lineTo(s, P.ch); }
	}
	c.strokeStyle = 'rgba(255,120,90,0.55)';
	c.stroke();
};

// World-ordered grid; reverse label traversal keeps the screen-space gap check monotone.
// Sea level gets its own stronger line and label.
RNDR.overlayGrid = function () {
	var c = this.ctx, g = GEO.grid, i, s, lastL = -1e9;
	c.beginPath();
	for (i = 0; i < g.length; i++) {
		s = g[i].s;
		if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
	}
	c.lineWidth = 1;
	c.strokeStyle = 'rgba(130,140,165,0.3)';
	c.stroke();
	c.font = '10px monospace';
	c.fillStyle = 'rgba(165,175,200,0.8)';
	for (i = g.length - 1; i >= 0; i--) {
		s = g[i].s;
		if (s < 10 || s > P.ch - 6 || s - lastL < 16) continue;
		c.fillText(g[i].t, 4, s - 2);
		lastL = s;
	}
	var sy0 = GEO.sy(0);
	if (sy0 > -2 && sy0 < P.ch + 2) {
		c.beginPath();
		c.moveTo(0, sy0); c.lineTo(P.cw, sy0);
		c.strokeStyle = 'rgba(90,170,230,0.8)';
		c.stroke();
		c.fillStyle = 'rgba(90,170,230,0.95)';
		c.fillText('0 m sea level', 4, sy0 - 3);
	}
};

RNDR.overlayCursor = function () {
	if (UI.mx < 0 || UI.my < 0 || UI.my >= P.ch) return;
	var c = this.ctx;
	c.beginPath();
	c.moveTo(UI.mx, 0); c.lineTo(UI.mx, P.ch);
	c.moveTo(0, UI.my); c.lineTo(P.cw, UI.my);
	c.lineWidth = 1;
	c.strokeStyle = 'rgba(255,255,255,0.22)';
	c.stroke();
	c.font = '10px monospace';
	if (UI.cursor) {
		c.fillStyle = 'rgba(255,255,255,0.85)';
		var tx = UI.mx + 8;
		if (tx > P.cw - 230) tx = UI.mx - 230;
		c.fillText(UI.cursor, tx, Math.max(10, UI.my - 8));
	}
	if (this.probe) {
		c.fillStyle = 'rgba(10,14,22,0.82)';
		c.fillRect(P.cw - 236, P.ch - 92, 230, 86);
		c.fillStyle = 'rgba(159,214,184,0.95)';
		var lines = this.probe.split('\n');
		for (var i = 0; i < lines.length; i++) c.fillText(lines[i], P.cw - 230, P.ch - 78 + i * 13);
	}
};

// the geology under the cursor; rebuilt on mousemove only, never per frame
RNDR.updateProbe = function (mx, my) {
	if (mx < 0 || my < 0 || mx >= P.cw || my >= P.ch) { this.probe = ''; return; }
	var c = GEO.lutCol[mx | 0];
	if (c < 0 || S.nCol === 0) { this.probe = ''; return; }
	var y = GEO.lutY[my | 0];
	var next = c + 1 < S.nCol ? c + 1 : 0, f = GEO.lutFrac[mx | 0];
	var top = S.z[c] + (S.z[next] - S.z[c]) * f;
	var relief = P.reliefBase + P.reliefK * Math.abs(S.z[next] - S.z[c]);
	top += relief * (S.noise[c] + (S.noise[next] - S.noise[c]) * f);
	var height = S.hTot[c] + (S.hTot[next] - S.hTot[c]) * f;
	var stretch = S.hTot[c] > 0 ? height / S.hTot[c] : 1;
	var s = 'col ' + c + '  plate ' + S.colPlate[c] + '  age ' + S.colAge[c].toFixed(1) + ' Myr';
	s += '\nz ' + (top / 1e3).toFixed(2) + ' km  hTot ' + (S.hTot[c] / 1e3).toFixed(1) + ' km';
	s += '\nfel ' + (S.hFel[c] / 1e3).toFixed(1) + '  maf ' + (S.hMaf[c] / 1e3).toFixed(1) +
		'  sed ' + (S.hSed[c] / 1e3).toFixed(1) + ' km';
	if (y > top) {
		s += '\n' + (y > 0 ? 'air' : 'water') + '  ' + ((y - top) | 0) + ' m above surface';
		this.probe = s;
		return;
	}
	var k = COL.layerAt(c, (top - y) / stretch);
	if (k < 0) {
		var r = GEO.rowOf(y);
		var cell = r < 0 ? 0 : GEO.cellOf(r, GEO.lutX[mx | 0]);
		s += '\nmantle  ' + (-y / 1e3).toFixed(0) + ' km  dT ' + S.Tf[cell].toFixed(2);
		this.probe = s;
		return;
	}
	var b = c * P.layerCap, d = 0, i;
	for (i = S.colNL[c] - 1; i > k; i--) d += S.layTh[b + i];
	s += '\nlayer ' + k + '/' + S.colNL[c] + '  ' + this.LITH_NAME[S.layLi[b + k]];
	s += '\n' + S.layTh[b + k].toFixed(0) + ' m  ' + S.layAg[b + k].toFixed(0) + ' Myr  ' +
		this.flagText(S.layFl[b + k]);
	s += '\n' + (d / 1e3).toFixed(2) + ' km below surface';
	this.probe = s;
};

RNDR.flagText = function (f) {
	var F = P.FLAG, t = '';
	if (f & F.wet) t += '[wet]';
	if (f & F.ore) t += '[ore]';
	if (f & F.unconf) t += '[unconf]';
	return t.length ? t : '-';
};

// one frame: sync the view, walk the columns, raster, present, overlay
RNDR.redraw = function () {
	GEO.sync();
	GEO.buildColLUT(S);
	this.body(this.px, this.w, this.h);
	this.present();
	this.overlay();
};

RNDR.buildPalette();

if (typeof module !== 'undefined' && module.exports) module.exports = RNDR;
