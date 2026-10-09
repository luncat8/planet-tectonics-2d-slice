(function (root) {
// render.js — the section view (design §7). Hybrid: a per-pixel body raster written
// into an ImageData word buffer, plus a canvas 2D overlay.
// Headless core: body(S, px, w, h) writes into a caller-supplied buffer and touches no
// DOM — that is what lets experiments/raster-bench.js time the real raster under node.
// Only init(), present() and the overlay touch the canvas. No per-frame allocation or
// string building: labels come from view-change or mousemove time.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COLCOLUMNS;
var node = typeof module !== 'undefined' && module.exports;
var ORE = node ? require('./ore.js') : root.COLORE;

function ui() { return node ? require('./ui.js') : root.COLUI; }

var RNDR = {
	ctx: null, img: null, px: null, w: 0, h: 0,
	mohoY: null,
	profY: null,          // profile altitude per screen column, rebuilt by body()
	mesh: false,          // the M0 measuring-tool overlay, toggled from the UI
	showDeposits: false, selectedDepId: 0,
	showScale: true,      // the altitude / distance scale lines, toggled from the UI
	probe: '',            // geology under the cursor, rebuilt on mousemove only
	probeLines: [],       // the same text split once, so the overlay never allocates
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
		// hDraw, not hTot: a draining trench sliver owns no mass but its span is in
		// the picture, and the drawn Moho must pass straight through it (state.js)
		this.mohoY[px] = profY[px] - (S.hDraw[c0] + (S.hDraw[c1] - S.hDraw[c0]) * f);
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
	var c, s, off, pY, mohoY, nLay, b, layIdx, layBot, y, lith, wd, ad, wx;
	var j, j2, cnt, row, base, fx, t0, tb, ringPrev, pal;

	for (var pxc = 0; pxc < w; pxc++) {
		c = lutCol[pxc];
		if (c < 0) continue;
		pY = profY[pxc];
		nLay = S.colNL[c];
		b = c * LC;
		mohoY = this.mohoY[pxc];
		// Display-only stretch: stored beds and mass are never resampled.
		var stretch = S.hDraw[c] > 0 ? (pY - mohoY) / S.hDraw[c] : 1;
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

		// The fan is a radial mesh, so one ring owns a contiguous run of screen rows and
		// its colour at this x does not change across the run: sample and shade the ring
		// once, then stamp the run. That pays for the bilinear x sampling below — a ring
		// pitch is hundreds of screen pixels and the field carries node-to-node jumps of
		// ~3 colour bins, so nearest-node sampling stripes the mantle a thousand pixels
		// wide. Cell centres: the +cnt keeps the half-cell shift positive so |0 floors.
		ringPrev = -2;
		while (s < h) {
			row = lutRow[s];
			if (row !== ringPrev) {
				ringPrev = row;
				cnt = lutCnt[s];
				fx = wx * lutInvP[s] + cnt - 0.5;
				j = fx | 0;
				fx -= j;
				j -= cnt;
				if (j < 0) j += cnt;
				j2 = j + 1 < cnt ? j + 1 : 0;
				base = lutBase[s];
				t0 = Tf[base + j];
				tb = ((t0 + (Tf[base + j2] - t0) * fx + 0.6) * 6.6666667) | 0;
				pal = ((row < 0 ? 0 : row) << 3) | (tb < 0 ? 0 : (tb > 7 ? 7 : tb));
			}
			px[off] = palMantle[pal];
			s++; off += w;
		}
	}
};

RNDR.present = function () { this.ctx.putImageData(this.img, 0, 0); };

// --- overlay --------------------------------------------------------------------

RNDR.overlay = function () {
	this.overlayProfile();
	this.overlayVents();
	this.overlayPlates();
	this.overlayM4();
	if (this.mesh) this.overlayMesh();
	this.overlayGrid();
	if (this.showDeposits) this.overlayDeposits();
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
	var open = false;
	for (px = 0; px < this.w; px++) {
		col = GEO.lutCol[px];
		if (col < 0) { open = false; continue; }
		s = GEO.sy(this.mohoY[px]);
		if (open) c.lineTo(px + 0.5, s); else c.moveTo(px + 0.5, s);
		open = true;
	}
	c.strokeStyle = 'rgba(255,230,140,0.5)';
	c.stroke();
};

RNDR.overlayM4 = function () {
	var c = this.ctx, r, k, n, b, x, y, sx, sy, lastX, dx, p, q, i;
	if (S.nRib > 0) {
		c.lineCap = 'round';
		for (r = 0; r < S.nRib; r++) {
			b = r * P.ribNodeCap;
			n = S.ribN[r];
			c.beginPath();
			for (k = 0; k < n; k++) {
				sx = this.screenX(S.ribX[b + k]);
				sy = GEO.sy(S.ribY[b + k]);
				if (k === 0) { c.moveTo(sx, sy); lastX = sx; }
				else {
					dx = sx - lastX;
					if (dx > this.w * 0.5) sx -= this.w;
					else if (dx < -this.w * 0.5) sx += this.w;
					c.lineTo(sx, sy); lastX = sx;
				}
			}
			c.strokeStyle = 'rgba(80,150,220,0.24)';
			c.lineWidth = 8;
			c.stroke();
			c.beginPath();
			for (k = 0; k < n; k++) {
				sx = this.screenX(S.ribX[b + k]);
				sy = GEO.sy(S.ribY[b + k]);
				if (k === 0) c.moveTo(sx, sy); else c.lineTo(sx, sy);
			}
			c.strokeStyle = 'rgba(115,190,235,0.95)';
			c.lineWidth = 2;
			c.stroke();
			for (k = 1; k < n; k += 2) {
				sx = this.screenX(S.ribX[b + k]);
				sy = GEO.sy(S.ribY[b + k]);
				c.beginPath();
				c.moveTo(sx - 4, sy - 3); c.lineTo(sx + 4, sy + 3);
				c.strokeStyle = (k & 2) ? 'rgba(226,170,125,0.9)' : 'rgba(90,95,110,0.9)';
				c.lineWidth = 1;
				c.stroke();
			}
		}
	}
	if (S.nPlm > 0) {
		for (p = 0; p < S.nPlm; p++) {
			b = p * P.conduitCap;
			n = S.plmNCon[p];
			c.beginPath();
			for (q = 0; q < n; q++) {
				sx = this.screenX(S.plmConX[b + q]);
				sy = GEO.sy(S.plmConY[b + q]);
				if (q === 0) c.moveTo(sx, sy); else c.lineTo(sx, sy);
			}
			c.strokeStyle = 'rgba(245,135,70,0.42)';
			c.lineWidth = 3;
			c.stroke();
			sx = this.screenX(S.plmX[p]);
			sy = GEO.sy(S.plmY[p]);
			c.beginPath();
			c.arc(sx, sy, Math.max(3, S.plmR[p] / GEO.kx), 0, 6.283185307179586);
			c.strokeStyle = S.plmArrive[p] ? 'rgba(255,195,80,0.95)' : 'rgba(245,135,70,0.75)';
			c.lineWidth = S.plmArrive[p] ? 2 : 1;
			c.stroke();
		}
	}
	// Supplied arc columns without a vent still get a warm supply marker.
	for (i = 0; i < S.nCol; i++) {
		if (!(S.colMeltArc[i] > 0) || S.volc[i] >= 0) continue;
		x = this.screenX(S.colX[i]);
		y = GEO.sy(S.z[i]);
		c.beginPath(); c.arc(x, y, 3, 0, 6.283185307179586);
		c.fillStyle = 'rgba(255,150,65,0.9)'; c.fill();
	}
};

// --- eruptive geometry: the box is the only shape source -------------------------
RNDR.VENT_FILL = ['rgba(160,145,126,0.98)', 'rgba(137,65,49,0.98)'];
RNDR.VENT_STYLE = ['strato', 'shield', 'fissure', 'arc'];

RNDR.profileAt = function (sx) {
	var x = Math.max(0, Math.min(this.profY.length - 1, sx - 0.5)), i = x | 0;
	var next = i + 1 < this.profY.length ? i + 1 : i;
	return this.profY[i] + (this.profY[next] - this.profY[i]) * (x - i);
};

RNDR.pileAt = function (v, x) {
	var W = P.ventBoxW, b = v * W, i, f;
	if (x <= -0.5 || x >= W - 0.5) return 0;
	if (x < 0) return S.toyH[b] * (x + 0.5) * 2;
	if (x > W - 1) return S.toyH[b + W - 1] * (W - 0.5 - x) * 2;
	i = x | 0; f = x - i;
	return S.toyH[b + i] + (S.toyH[b + Math.min(W - 1, i + 1)] - S.toyH[b + i]) * f;
};

// A cell's two half-faces interpolate the same height map as pileAt(). Batching
// all faces of one lithology avoids a draw call per cell and a second cone model.
RNDR.ventFace = function (v, x, sx, glow) {
	var c = this.ctx, W = P.ventBoxW, b = v * W, k = b + x;
	var scale = P.toyCellX / GEO.kx, mid = sx + (x - (W >> 1)) * scale;
	var left = mid - scale * 0.5, right = mid + scale * 0.5;
	var h = S.toyH[k], hl = x > 0 ? (S.toyH[k - 1] + h) * 0.5 : 0;
	var hr = x + 1 < W ? (h + S.toyH[k + 1]) * 0.5 : 0;
	var fl = glow && x > 0 ? (S.toyFz[k - 1] + S.toyFz[k]) * 0.5 : 0;
	var fr = glow && x + 1 < W ? (S.toyFz[k] + S.toyFz[k + 1]) * 0.5 : 0;
	var zl = this.profileAt(left), zm = this.profileAt(mid), zr = this.profileAt(right);
	c.moveTo(left, GEO.sy(zl + hl * P.toyCellY));
	c.lineTo(mid, GEO.sy(zm + h * P.toyCellY));
	c.lineTo(right, GEO.sy(zr + hr * P.toyCellY));
	c.lineTo(right, GEO.sy(zr + fr * P.toyCellY));
	c.lineTo(mid, GEO.sy(zm + (glow ? S.toyFz[k] : 0) * P.toyCellY));
	c.lineTo(left, GEO.sy(zl + fl * P.toyCellY));
	c.closePath();
};

RNDR.ventPile = function (v, sx) {
	var c = this.ctx, b = v * P.ventBoxW, x, li, lith, any;
	for (li = 0; li < 2; li++) {
		lith = li === 0 ? P.LITH.tephra : P.LITH.lava;
		c.beginPath(); any = false;
		for (x = 0; x < P.ventBoxW; x++) {
			if (!(S.toyH[b + x] > 0) || S.toyLi[b + x] !== lith) continue;
			this.ventFace(v, x, sx, false); any = true;
		}
		if (any) { c.fillStyle = this.VENT_FILL[li]; c.fill(); }
	}
	c.beginPath(); any = false;
	for (x = 0; x < P.ventBoxW; x++) {
		if (!(S.toyH[b + x] > S.toyFz[b + x]) || S.toyT[b + x] < P.Tsol) continue;
		this.ventFace(v, x, sx, true); any = true;
	}
	if (any) { c.fillStyle = 'rgba(255,135,45,0.7)'; c.fill(); }
};

RNDR.ventPackets = function (v, sx) {
	var c = this.ctx, b = v * P.partCap, base = this.profileAt(sx);
	var scale = P.toyCellX / GEO.kx, conduit = (P.ventBoxW >> 1) + 0.5;
	var i, k, t, prev, x, y;
	if (S.prN[v] === 0) return;
	c.beginPath();
	for (i = 0; i < S.prN[v]; i++) {
		k = b + i; t = S.prT[k]; prev = Math.max(0, t - 2);
		x = sx + (S.prX[k] + S.prVX[k] * prev - conduit) * scale;
		y = S.prY[k] + S.prVY[k] * prev - 0.5 * P.toyG * prev * prev;
		c.moveTo(x, GEO.sy(base + y * P.toyCellY));
		x = sx + (S.prX[k] + S.prVX[k] * t - conduit) * scale;
		y = S.prY[k] + S.prVY[k] * t - 0.5 * P.toyG * t * t;
		c.lineTo(x, GEO.sy(base + y * P.toyCellY));
	}
	c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,190,100,0.95)'; c.stroke();
	// Ash halos use those same packet positions, not a separately animated plume.
	c.beginPath();
	for (i = 0; i < S.prN[v]; i++) {
		k = b + i; t = S.prT[k];
		x = sx + (S.prX[k] + S.prVX[k] * t - conduit) * scale;
		y = S.prY[k] + S.prVY[k] * t - 0.5 * P.toyG * t * t;
		y = GEO.sy(base + y * P.toyCellY);
		c.moveTo(x + 3, y); c.arc(x, y, 3, 0, 6.283185307179586);
	}
	c.fillStyle = 'rgba(195,180,160,0.1)'; c.fill();
};

RNDR.overlayVents = function () {
	if (S.nVen === 0 || S.nCol === 0) return;
	var c = this.ctx, v, px, sx, centre, col;
	var lap = P.wrap / GEO.kx, half = P.ventBoxW * P.toyCellX / GEO.kx * 0.5;
	c.save(); c.beginPath();
	c.moveTo(0, 0); c.lineTo(this.w, 0);
	for (px = this.w - 1; px >= 0; px--) c.lineTo(px + 0.5, GEO.sy(this.profY[px]));
	c.lineTo(0, GEO.sy(this.profY[0])); c.closePath(); c.clip();
	for (v = 0; v < S.nVen; v++) {
		col = S.venEdCol[v];
		if (col < 0 || S.colGhost[col]) continue;
		centre = this.screenX(S.venX[v]);
		for (sx = centre - lap; sx - half < this.w; sx += lap) {
			if (sx + half <= 0) continue;
			this.ventPile(v, sx); this.ventPackets(v, sx);
		}
	}
	c.restore();
};

// The cone may reach left of its owning column's LUT interval. Probe its actual
// owner and ordinary volcanic bed rather than calling this visible solid "air".
RNDR.probeVent = function (wx, y, top) {
	var v, c, dx, x, h, best = -1, high = 0;
	if (y <= top) return -1;
	for (v = 0; v < S.nVen; v++) {
		c = S.venEdCol[v];
		if (c < 0 || S.colGhost[c]) continue;
		dx = GEO.wrapX(wx - S.venX[v] + P.wrap * 0.5) - P.wrap * 0.5;
		x = dx / P.toyCellX + (P.ventBoxW >> 1); h = this.pileAt(v, x) * P.toyCellY;
		if (y > top + h || h <= high) continue;
		best = v; high = h;
	}
	return best;
};

// Plate boundaries (design §7): one glyph per classified edge on the profile — ridge
// or rift opening, trench with its slab dipping under the overriding side, collision
// chevrons, neutral tick — and a motion arrow over each plate. Batched into one path
// per style; positions only, no strings.
RNDR.EDGE_STYLE = [null, 'rgba(180,180,190,0.7)', 'rgba(110,235,170,0.95)', 'rgba(255,95,75,0.95)', 'rgba(255,175,60,0.95)'];

RNDR.screenX = function (x) { return GEO.wrapX(x - GEO.x0) / GEO.kx; };

RNDR.overlayPlates = function () {
	var c = this.ctx, n = S.nCol, e, i, j, sx;
	if (n < 2 || S.nPl < 2) return;
	c.lineWidth = 1.5;
	for (e = P.EDGE.neutral; e <= P.EDGE.collide; e++) {
		c.beginPath();
		for (i = 0; i < n; i++) {
			if (S.edge[i] !== e) continue;
			j = i + 1 < n ? i + 1 : 0;
			sx = this.screenX(S.colX[j]);
			if (sx < 0 || sx >= this.w) continue;
			this.glyph(c, e, S.edgePol[i], sx, GEO.sy(this.profY[sx | 0]));
		}
		c.strokeStyle = this.EDGE_STYLE[e];
		c.stroke();
	}
	c.beginPath();
	for (i = 0; i < n; i++) {
		if (S.colPlate[i] !== S.colPlate[i > 0 ? i - 1 : n - 1]) this.plateArrow(c, i);
	}
	c.strokeStyle = 'rgba(230,235,245,0.8)';
	c.stroke();
};

RNDR.glyph = function (c, e, pol, x, y) {
	var E = P.EDGE, d;
	if (e === E.neutral) { c.moveTo(x, y - 3); c.lineTo(x, y - 10); return; }
	if (e === E.open) {
		c.moveTo(x - 5, y - 11); c.lineTo(x, y - 3); c.lineTo(x + 5, y - 11);
		return;
	}
	if (e === E.subduct) {
		d = pol < 0 ? 1 : -1;       // the slab dives under the overriding side
		c.moveTo(x, y - 10); c.lineTo(x, y);
		c.lineTo(x + 12 * d, y + 12);
		return;
	}
	c.moveTo(x - 9, y - 12); c.lineTo(x - 3, y - 7); c.lineTo(x - 9, y - 2);
	c.moveTo(x + 9, y - 12); c.lineTo(x + 3, y - 7); c.lineTo(x + 9, y - 2);
};

// arrow over the visible middle of the plate run starting at column b, length ∝ u
RNDR.plateArrow = function (c, b) {
	var n = S.nCol, p = S.colPlate[b], wRun = 0, i = b, k, a, lo, hi, x, len;
	do { wRun += S.colW[i]; i = i + 1 < n ? i + 1 : 0; } while (S.colPlate[i] === p && i !== b);
	len = S.plU[p] / P.vRef * 30;
	if (len > 45) len = 45; else if (len < -45) len = -45;
	for (k = 0; k < 2; k++) {
		a = this.screenX(S.colX[b]) - k * P.wrap / GEO.kx;
		lo = a > 0 ? a : 0;
		hi = a + wRun / GEO.kx < this.w ? a + wRun / GEO.kx : this.w;
		if (hi - lo < 70) continue;
		x = (lo + hi) * 0.5 - len * 0.5;
		c.moveTo(x, 20); c.lineTo(x + len, 20);
		if (len > 1 || len < -1) {
			c.moveTo(x + len - (len > 0 ? 5 : -5), 16); c.lineTo(x + len, 20);
			c.lineTo(x + len - (len > 0 ? 5 : -5), 24);
		}
	}
};

// Symbols use the same profile and layer stretch as the body raster, including at
// the periodic seam. The overlay reads live records; it never evolves or ranks them.
RNDR.depositGlyph = function (c, cls, x, y) {
	if (cls === P.OCLS.vms) {
		c.moveTo(x - 3, y - 3); c.lineTo(x + 3, y - 3); c.lineTo(x + 3, y + 3);
		c.lineTo(x - 3, y + 3); c.closePath(); return;
	}
	if (cls === P.OCLS.maf) {
		c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y); c.closePath(); return;
	}
	if (cls === P.OCLS.arc) {
		c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); return;
	}
	if (cls === P.OCLS.oro) {
		c.moveTo(x, y - 4); c.lineTo(x + 4, y + 3); c.lineTo(x - 4, y + 3); c.closePath(); return;
	}
	if (cls === P.OCLS.bas) { c.moveTo(x + 3, y); c.arc(x, y, 3, 0, 6.283185307179586); return; }
	c.moveTo(x - 4, y - 2); c.lineTo(x + 4, y - 2); c.moveTo(x - 4, y + 2); c.lineTo(x + 4, y + 2);
};

RNDR.overlayDeposits = function () {
	var c = this.ctx, cls, d, col, next, gap, centre, sx, px, depth, stretch, sy;
	var lap = P.wrap / GEO.kx;
	c.lineWidth = 1.5;
	for (cls = 0; cls < P.OCLS.n; cls++) {
		c.beginPath();
		for (d = 0; d < S.nDep; d++) {
			if (S.depCls[d] !== cls || !ORE.valid(S, d)) continue;
			col = S.depCol[d]; next = (col + 1) % S.nCol;
			gap = next === col ? P.wrap : GEO.wrapX(S.colX[next] - S.colX[col]);
			centre = this.screenX(GEO.wrapX(S.colX[col] + gap * 0.5));
			depth = ORE.depth(S, d);
			for (sx = centre - lap; sx < this.w + 4; sx += lap) {
				if (sx < 0 || sx >= this.w) continue;
				px = sx | 0;
				stretch = S.hDraw[col] > 0 ? (this.profY[px] - this.mohoY[px]) / S.hDraw[col] : 1;
				sy = GEO.sy(this.profY[px] - depth * stretch);
				if (sy < -4 || sy > this.h + 4) continue;
				this.depositGlyph(c, cls, sx, sy);
				if (S.depId[d] === this.selectedDepId) { c.moveTo(sx + 7, sy); c.arc(sx, sy, 7, 0, 6.283185307179586); }
			}
		}
		c.strokeStyle = ORE.COLOUR[cls]; c.stroke();
	}
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

// The two rulers: altitude lines with their labels down the left edge, distance lines
// with theirs along the bottom. GEO already spaced both by the gap params, so every
// line that is on screen gets a label. Sea level is a datum, not a ruler: always drawn.
RNDR.overlayGrid = function () {
	var c = this.ctx, i, s;
	c.lineWidth = 1;
	c.font = '10px monospace';
	if (this.showScale) {
		c.beginPath();
		for (i = 0; i < GEO.vgN; i++) { s = (GEO.vgS[i] | 0) + 0.5; c.moveTo(0, s); c.lineTo(P.cw, s); }
		for (i = 0; i < GEO.hgN; i++) { s = (GEO.hgS[i] | 0) + 0.5; c.moveTo(s, 0); c.lineTo(s, P.ch); }
		c.strokeStyle = 'rgba(130,140,165,0.3)';
		c.stroke();
		c.fillStyle = 'rgba(165,175,200,0.8)';
		for (i = 0; i < GEO.vgN; i++) {
			s = GEO.vgS[i];
			if (s < 10 || s > P.ch - 6) continue;
			c.fillText(GEO.vgT[i], 4, s - 2);
		}
		for (i = 0; i < GEO.hgN; i++) {
			s = GEO.hgS[i];
			if (s < 2 || s > P.cw - 64) continue;
			c.fillText(GEO.hgT[i], s + 3, P.ch - 4);
		}
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
	if (ui().mx < 0 || ui().my < 0 || ui().mx >= P.cw || ui().my >= P.ch) return;
	var c = this.ctx;
	c.beginPath();
	c.moveTo(ui().mx, 0); c.lineTo(ui().mx, P.ch);
	c.moveTo(0, ui().my); c.lineTo(P.cw, ui().my);
	c.lineWidth = 1;
	c.strokeStyle = 'rgba(255,255,255,0.22)';
	c.stroke();
	c.font = '10px monospace';
	if (ui().cursor) {
		c.fillStyle = 'rgba(255,255,255,0.85)';
		var tx = ui().mx + 8;
		if (tx > P.cw - 230) tx = ui().mx - 230;
		c.fillText(ui().cursor, tx, Math.max(10, ui().my - 8));
	}
	var lines = this.probeLines, nl = lines.length, i;
	if (!nl) return;
	c.fillStyle = 'rgba(10,14,22,0.82)';
	c.fillRect(P.cw - 256, P.ch - 14 - nl * 13, 250, nl * 13 + 8);
	c.fillStyle = 'rgba(159,214,184,0.95)';
	for (i = 0; i < nl; i++) c.fillText(lines[i], P.cw - 250, P.ch - 16 - (nl - 1 - i) * 13);
};

// the geology under the cursor; rebuilt on mousemove only, never per frame
RNDR.updateProbe = function (mx, my) {
	if (mx < 0 || my < 0 || mx >= P.cw || my >= P.ch) { this.setProbe(''); return; }
	var c = GEO.lutCol[mx | 0];
	if (c < 0 || S.nCol === 0) { this.setProbe(''); return; }
	var y = GEO.lutY[my | 0];
	var next = c + 1 < S.nCol ? c + 1 : 0, f = GEO.lutFrac[mx | 0];
	var top = S.z[c] + (S.z[next] - S.z[c]) * f;
	var relief = P.reliefBase + P.reliefK * Math.abs(S.z[next] - S.z[c]);
	top += relief * (S.noise[c] + (S.noise[next] - S.noise[c]) * f);
	var height = S.hDraw[c] + (S.hDraw[next] - S.hDraw[c]) * f;
	var stretch = S.hDraw[c] > 0 ? height / S.hDraw[c] : 1;
	var vent = this.probeVent(GEO.lutX[mx | 0], y, top), vk = -1, vi, vb, dx, vx, lith;
	if (vent >= 0) {
		c = S.venEdCol[vent]; vb = c * P.layerCap;
		dx = GEO.wrapX(GEO.lutX[mx | 0] - S.venX[vent] + P.wrap * 0.5) - P.wrap * 0.5;
		vx = Math.max(0, Math.min(P.ventBoxW - 1, Math.round(dx / P.toyCellX + (P.ventBoxW >> 1))));
		lith = S.toyLi[vent * P.ventBoxW + vx];
		for (vi = S.colNL[c] - 1; vi >= 0; vi--) {
			if (S.layLi[vb + vi] === lith) { vk = vi; break; }
		}
	}
	var s = 'col ' + c + '  plate ' + S.colPlate[c] + '  age ' + S.colAge[c].toFixed(1) + ' Myr';
	s += '\nu ' + (S.colU[c] / 1e4).toFixed(2) + ' cm/yr  ext ' + S.ext[c].toFixed(3) + '/Myr' + this.edgeText(c);
	s += '\nz ' + (top / 1e3).toFixed(2) + ' km  hTot ' + (S.hTot[c] / 1e3).toFixed(1) + ' km';
	s += '\nfel ' + (S.hFel[c] / 1e3).toFixed(1) + '  maf ' + (S.hMaf[c] / 1e3).toFixed(1) +
		'  sed ' + (S.hSed[c] / 1e3).toFixed(1) + ' km';
	s += '\nload ' + S.colLoad[c].toFixed(1) + ' m  pla ' + S.colPla[c].toFixed(1) + ' m  oPla ' + S.oPla[c].toFixed(3);
	s += '  oBas ' + S.oBas[c].toFixed(3) + (S.colBevel[c] ? '  [beveled]' : '');
	s += '\nchamber ' + S.colChamber[c].toFixed(0) + ' m2  recycle ' + S.colRecycle[c].toFixed(0) + ' m2';
	if (vent >= 0) {
		s += '\nedifice ' + this.VENT_STYLE[S.venStyle[vent]] + (S.venCol[vent] < 0 ? ' dormant' : '') +
			'  ' + S.venEdV[vent].toFixed(0) +
			' m2  last ' + S.venLast[vent].toFixed(2) + ' Myr';
		if (vk < 0) { this.setProbe(s + '\n' + this.LITH_NAME[lith] + ' in transit'); return; }
	}
	if (vent < 0 && y > top) {
		s += '\n' + (y > 0 ? 'air' : 'water') + '  ' + ((y - top) | 0) + ' m above surface';
		this.setProbe(s);
		return;
	}
	var k = vent >= 0 ? vk : COL.layerAt(c, (top - y) / stretch);
	if (k < 0) {
		var r = GEO.rowOf(y);
		var cell = r < 0 ? 0 : GEO.cellOf(r, GEO.lutX[mx | 0]);
		s += '\nmantle  ' + (-y / 1e3).toFixed(0) + ' km  dT ' + S.Tf[cell].toFixed(2);
		this.setProbe(s);
		return;
	}
	var b = c * P.layerCap, d = 0, i;
	for (i = S.colNL[c] - 1; i > k; i--) d += S.layTh[b + i];
	s += '\nlayer ' + k + '/' + S.colNL[c] + '  ' + this.LITH_NAME[S.layLi[b + k]];
	s += '\n' + S.layTh[b + k].toFixed(0) + ' m  formed ' + S.layAg[b + k].toFixed(0) + ' Myr  ' +
		this.flagText(S.layFl[b + k]);
	s += '\n' + (d / 1e3).toFixed(2) + ' km below surface';
	var found = 0;
	for (i = 0; i < S.nDep; i++) {
		if (S.depCol[i] !== c || S.depLay[i] !== k || !ORE.valid(S, i)) continue;
		if (found++ >= 3) continue;
		s += '\n' + ORE.NAME[S.depCls[i]] + ' #' + S.depId[i] + ' · ' +
			(ORE.tonnes(S, i) / 1e6).toFixed(2) + ' Mt/m · grade ' + S.depGr[i].toFixed(3);
	}
	if (found > 3) s += '\n+' + (found - 3) + ' other resources in this bed';
	this.setProbe(s);
};

RNDR.setProbe = function (s) {
	this.probe = s;
	this.probeLines = s ? s.split('\n') : [];
};

RNDR.EDGE_NAME = ['', 'neutral', 'opening', 'trench', 'collision'];

// the boundary with the right neighbour, if this column sits on one
RNDR.edgeText = function (c) {
	var e = S.edge[c];
	if (e === P.EDGE.none) return '';
	if (e === P.EDGE.open) return '\nright edge: ' + (S.hFel[c] >= P.hOceanic ? 'rift' : 'ridge');
	if (e === P.EDGE.subduct) return '\nright edge: trench, ' + (S.edgePol[c] < 0 ? 'this col' : 'right col') + ' subducts';
	return '\nright edge: ' + this.EDGE_NAME[e];
};

RNDR.flagText = function (f) {
	var F = P.FLAG, t = '';
	if (f & F.wet) t += '[wet]';
	if (f & F.ore) t += '[ore]';
	if (f & F.unconf) t += '[unconf]';
	if (f & F.intr) t += '[intr]';
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
else root.COLRENDER = RNDR;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
