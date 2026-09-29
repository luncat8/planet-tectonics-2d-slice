// pt/render.js — 0.3.0 P1: the section view. A per-pixel raster of the node temperature
// field into a caller-supplied Uint32 word buffer, the markers as a stipple on top, and the
// depth ruler as a canvas 2D overlay. The raster is the headless core: it touches no DOM, so
// experiments/ can time the real thing under node.
//
// No per-frame allocation: the palette, the two resampling tables and the ruler labels are
// built at init or at view-change time. The camera lives here because the tables do: the
// screen is linear in eta vertically -- the asinh grid's own coordinate, so a 2 km lid row
// and a 146 km bottom row both get a few pixels, which is the log depth scale the plan asks
// for -- and linear in x horizontally.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;

// the palette stops: [t, r, g, b], dark blue lid to pale yellow CMB
var STOPS = [
	[0.00, 8, 12, 28], [0.30, 42, 30, 96], [0.50, 116, 38, 108],
	[0.72, 186, 62, 74], [0.88, 240, 140, 40], [1.00, 255, 244, 176]
];

var PTR = {
	ctx: null, img: null, px: null, w: 0, h: 0,
	off: null, octx: null, ow: 0, oh: 0,                // the raster runs at half resolution
	jOf: null, fyOf: null, iOf: null, fxOf: null,      // screen -> mesh resampling tables
	sx: 1,                                              // km per raster column
	pal: null, meltPal: null, meltLevel: null,          // packed thermal and melt-overlay LUTs
	ticks: null, labels: null, barPx: 0,                // the ruler
	markers: true, ruler: true, melt: true,

	SKY: 0xff1c1014, CMB: 0xff2e1a10, MARK: 0x404040,

	// The canvas is 5x the mesh in x and 6x in y, so the raster runs at half resolution and
	// is scaled up: 4x fewer pixels and the stipple's scattered writes stay in cache, which
	// is the difference between 11 ms a frame and 3 (the plan's §7 budget, measured).
	init: function (canvas, M) {
		this.ctx = canvas.getContext('2d');
		this.w = canvas.width; this.h = canvas.height;
		this.ow = this.w >> 1; this.oh = this.h >> 1;
		this.off = document.createElement('canvas');
		this.off.width = this.ow; this.off.height = this.oh;
		this.octx = this.off.getContext('2d');
		this.img = this.octx.createImageData(this.ow, this.oh);
		this.px = new Uint32Array(this.img.data.buffer);
		this.jOf = new Int32Array(this.oh); this.fyOf = new Float32Array(this.oh);
		this.iOf = new Int32Array(this.ow); this.fxOf = new Float32Array(this.ow);
		this.ticks = new Float64Array(4);
		this.labels = ['surface', '700 km', '1400 km', '2900 km'];
		this.build(M);
	},

	// the view changed (zoom, pan, mesh): rebuild the tables and the ruler's screen rows
	build: function (M) {
		var w = this.ow, h = this.oh, x, y, e, xk, i, j;
		var v = P.view, sx = v.kx * this.w / this.ow;
		this.sx = sx;
		for (y = 0; y < h; y++) {
			e = v.eT + (y + 0.5) / h * (v.eB - v.eT);
			j = Math.floor(e / M.dEta);
			if (j < 0) { this.jOf[y] = -1; this.fyOf[y] = 0; continue; }
			if (j >= M.ny) { this.jOf[y] = M.ny; this.fyOf[y] = 1; continue; }
			this.jOf[y] = j;
			this.fyOf[y] = e / M.dEta - j;
		}
		for (x = 0; x < w; x++) {
			xk = v.cx + (x + 0.5 - w * 0.5) * sx;
			xk -= Math.floor(xk / M.wrap) * M.wrap;
			i = Math.floor(xk / M.dx);
			this.iOf[x] = i; this.fxOf[x] = xk / M.dx - i;
		}
		for (i = 0; i < 4; i++) this.ticks[i] = (Math.asinh(RULER[i] / M.yLin) - v.eT) / (v.eB - v.eT) * h;
		this.barPx = Math.round((RULER[4] / v.kx) / 50) * 50;      // the bar snaps to 50 px
	},

	// The field: T bilinear from the two node rows each screen row spans. The optional gold
	// overlay is the pressure-release melt indicator, not a replacement for the cold/hot
	// mantle colour: one-phase P1 still shows physically valid cold downwellings.
	raster: function (M, S, px, w, h) {
		var nx = M.nx, ny = M.ny, Tg = S.Tg, Mg = S.Mg, pal = this.pal, meltPal = this.meltPal;
		var jOf = this.jOf, fyOf = this.fyOf, iOf = this.iOf, fxOf = this.fxOf, meltLevel = this.meltLevel;
		var x, y, q, j, fy, base, base2, i, i1, fx, t0, t1, t, m0, m1, m, k, mk;
		for (y = 0; y < h; y++) {
			j = jOf[y]; fy = fyOf[y]; q = y * w;
			if (j < 0) { for (x = 0; x < w; x++) px[q + x] = this.SKY; continue; }
			if (j >= ny) { for (x = 0; x < w; x++) px[q + x] = this.CMB; continue; }
			base = j * nx; base2 = base + nx;
			for (x = 0; x < w; x++) {
				i = iOf[x]; fx = fxOf[x]; i1 = i + 1 === nx ? 0 : i + 1;
				t0 = Tg[base + i] + (Tg[base + i1] - Tg[base + i]) * fx;
				t1 = Tg[base2 + i] + (Tg[base2 + i1] - Tg[base2 + i]) * fx;
				t = t0 + (t1 - t0) * fy;
				k = (t * 255 + 0.5) | 0;
				if (k < 0) k = 0; else if (k > 255) k = 255;
				if (!this.melt) { px[q + x] = pal[k]; continue; }
				m0 = Mg[base + i] + (Mg[base + i1] - Mg[base + i]) * fx;
				m1 = Mg[base2 + i] + (Mg[base2 + i1] - Mg[base2 + i]) * fx;
				m = m0 + (m1 - m0) * fy;
				mk = meltLevel[(m * 255 + 0.5) | 0];
				px[q + x] = mk ? meltPal[mk * 256 + k] : pal[k];
			}
		}
	},

	// the marker stipple: one dot per parcel at its own carried position, lifted out of the
	// field it sits in, so crowding and drift are visible in the live view
	stipple: function (M, S, px, w, h) {
		var v = P.view, inv = (h - 1) / (v.eB - v.eT), p, x, xf, y, q, m = this.MARK;
		for (p = 0; p < S.n; p++) {
			xf = (S.x[p] - v.cx) / this.sx + w * 0.5;
			if (xf < 0 || xf >= w) continue;
			y = (S.e[p] - v.eT) * inv;
			if (y < 0 || y >= h) continue;
			x = xf | 0;
			q = (y | 0) * w + x;
			px[q] |= m;
		}
	},

	redraw: function (M, S) {
		this.raster(M, S, this.px, this.ow, this.oh);
		if (this.markers) this.stipple(M, S, this.px, this.ow, this.oh);
		this.octx.putImageData(this.img, 0, 0);
		this.ctx.drawImage(this.off, 0, 0, this.w, this.h);
		this.overlay();
	},

	// the ruler: depth lines with their labels plus the distance bar, canvas 2D only
	overlay: function () {
		if (!this.ruler) return;
		var ctx = this.ctx, w = this.w, h = this.h, t = this.ticks, i, yy;
		ctx.font = '11px monospace';
		ctx.strokeStyle = 'rgba(120,150,200,0.30)';
		ctx.fillStyle = 'rgba(150,170,210,0.60)';
		ctx.beginPath();
		for (i = 0; i < 4; i++) {
			yy = t[i];
			if (yy < 14 || yy > h - 4) continue;
			ctx.moveTo(0, yy + 0.5); ctx.lineTo(w, yy + 0.5);
		}
		ctx.stroke();
		for (i = 0; i < 4; i++) {
			yy = t[i];
			if (yy < 14 || yy > h - 4) continue;
			ctx.fillText(this.labels[i], 6, yy - 4);
		}
		yy = h - 10;
		ctx.beginPath();
		ctx.moveTo(6, yy + 0.5); ctx.lineTo(6 + this.barPx, yy + 0.5);
		ctx.moveTo(6, yy - 3); ctx.lineTo(6, yy + 3);
		ctx.moveTo(6 + this.barPx, yy - 3); ctx.lineTo(6 + this.barPx, yy + 3);
		ctx.stroke();
		ctx.fillText(barLabel(this.barPx * P.view.kx), 6 + this.barPx + 6, yy + 4);
	},

	// the camera: wheel zoom about a cursor, drag pan, presets (called from ui.js only)
	zoomAt: function (mx, my, f, M) {
		var v = P.view, xk = v.cx + (mx - this.w * 0.5) * v.kx;
		var ek = v.eT + my / this.h * (v.eB - v.eT);
		v.kx *= f;
		if (v.kx < 0.02) v.kx = 0.02; else if (v.kx > 40) v.kx = 40;
		v.cx = xk - (mx - this.w * 0.5) * v.kx;
		var span = (v.eB - v.eT) * f;
		if (span < 0.02) span = 0.02; else if (span > 5.2) span = 5.2;
		v.eT = ek - my / this.h * span; v.eB = v.eT + span;
		this.build(M);
	},

	panBy: function (dxPx, dyPx, M) {
		var v = P.view, de = dyPx / this.h * (v.eB - v.eT);
		v.cx -= dxPx * v.kx;
		v.eT -= de; v.eB -= de;
		this.build(M);
	},

	preset: function (name, M) {
		var v = P.view;
		v.cx = P.wrap / 2; v.kx = P.winW / this.w;
		if (name === 'lid') { v.eT = -Math.asinh(P.skyTop / M.yLin); v.eB = Math.asinh(600 / M.yLin); }
		else if (name === 'deep') { v.eT = Math.asinh(2100 / M.yLin); v.eB = Math.asinh((P.depth + P.skyTop) / M.yLin); }
		else { v.eT = -Math.asinh(P.skyTop / M.yLin); v.eB = Math.asinh(P.depth / M.yLin); }
		this.build(M);
	}
};

var RULER = [0, 700, 1400, 2900, 1000];    // km: four depth lines and the distance bar

PTR.pal = buildPal();                       // at load: the headless raster needs no init
PTR.meltPal = buildMeltPal(PTR.pal);
PTR.meltLevel = buildMeltLevel();

function buildPal() {
	var pal = new Uint32Array(256), i, s, t, q, a, b2, r, g, bl;
	for (i = 0; i < 256; i++) {
		t = i / 255;
		s = t < 0.30 ? 0 : t < 0.50 ? 1 : t < 0.72 ? 2 : t < 0.88 ? 3 : 4;
		a = STOPS[s]; b2 = STOPS[s + 1];
		q = (t - a[0]) / (b2[0] - a[0]);
		r = a[1] + (b2[1] - a[1]) * q; g = a[2] + (b2[2] - a[2]) * q; bl = a[3] + (b2[3] - a[3]) * q;
		pal[i] = 0xff000000 | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0);
	}
	return pal;
}

// Sixteen preblended gold overlays avoid per-pixel colour math in the raster pass. The level
// curve ignores trace values and then rises quickly, so it isolates concentrated extraction
// pathways instead of tinting the whole shallow mantle.
function buildMeltPal(pal) {
	var out = new Uint32Array(16 * 256), level, i, a, c, r, g, b;
	for (level = 0; level < 16; level++) {
		a = level / 15 * 0.82;
		for (i = 0; i < 256; i++) {
			c = pal[i]; r = c & 255; g = (c >>> 8) & 255; b = (c >>> 16) & 255;
			r += (255 - r) * a; g += (188 - g) * a; b += (48 - b) * a;
			out[level * 256 + i] = 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
		}
	}
	return out;
}

function buildMeltLevel() {
	var out = new Uint8Array(256), i, t;
	for (i = 0; i < 256; i++) {
		t = (i / 255 - 0.08) / 0.10;
		if (t < 0) t = 0; else if (t > 1) t = 1;
		out[i] = Math.sqrt(t) * 15 + 0.5;
	}
	return out;
}

// the bar's label, from its true length in km (built on view change, not per frame)
function barLabel(km) {
	if (km >= 2000) return (km / 1000).toFixed(1) + ' Mm';
	return Math.round(km / 10) * 10 + ' km';
}

if (typeof module !== 'undefined' && module.exports) module.exports = PTR; else window.PTRNDR = PTR;
