// geom.js — the scales of design §1 as pure math + the display LUTs.
// Rows: h_i = h0*q^i, edge depth y_i = h0*(q^i - 1)/(q - 1) (closed form).
// Display: u(y) = asinh(y/yLin); screen rows are uniform in u (§1.4).
// LUTs: lutX/lutY/lutRow* rebuild on view change only; lutCol/lutFrac rebuild every
// frame by one pointer walk (the columns move, the view LUTs do not).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;

var GEO = {
	N: 0, q: 0,
	hTop: null,      // Float64Array(N+1): ground row i top edge depth (m, positive down)
	rowH: null,      // Float64Array(N): row thickness, m
	rowCy: null,     // Float64Array(N): row centre depth, m
	skyN: 0,         // rows mirrored upward to +skyTop (reference only: no cells, no state)
	fanN: null,      // Int32Array(N): cells in ground row i
	fanOff: null,    // Int32Array(N+1): prefix cell index, fanOff[N] = total
	bandOf: null,    // Int32Array(N): band index of each row
	bandRow: null,   // Int32Array(bands): first row of each band
	bandBot: null,   // Int32Array(bands): first row after each band
	bands: 0,
	// fan neighbour stencil (design §1.3): 6 slots per cell, symmetric by construction
	// slots 0..5 = left, right, down0, down1, up0, up1; -1 / 0 = unused
	nbr: null, nbrFace: null, nbrDist: null,
	// the current window, rebuilt on view change (never per frame)
	dirty: true,
	x0: 0, kx: 0, uT: 0, uB: 0, duPx: 0,
	kx0: 0, du0: 0, kxMin: 0, kxMax: 0, duMin: 0, duMax: 0,
	lutX: null, lutY: null,
	lutRow: null, lutRowBase: null, lutRowCnt: null, lutRowInvP: null,
	lutCol: null, lutFrac: null,
	grid: null,      // {s, t}[] depth grid lines, labels prebuilt on view change
	PRESETS: null
};

function solveQ(h0, n, span) {
	// bisection on the geometric sum (same method as scale-check.js)
	var lo = 1.0000001, hi = 2, k, q;
	for (k = 0; k < 200; k++) {
		q = (lo + hi) / 2;
		if (h0 * (Math.pow(q, n) - 1) / (q - 1) < span) lo = q; else hi = q;
	}
	return (lo + hi) / 2;
}

GEO.init = function () {
	var n = P.nRows, i, k, C, off, bi, tot;
	this.N = n;
	this.q = solveQ(P.h0, n, P.R);
	this.hTop = new Float64Array(n + 1);
	for (i = 0; i <= n; i++) this.hTop[i] = P.h0 * (Math.pow(this.q, i) - 1) / (this.q - 1);
	this.hTop[n] = P.R; // snap the closure to the exact radius (bisection leaves ~1e-9)
	this.rowH = new Float64Array(n);
	this.rowCy = new Float64Array(n);
	for (i = 0; i < n; i++) {
		this.rowH[i] = this.hTop[i + 1] - this.hTop[i];
		this.rowCy[i] = (this.hTop[i] + this.hTop[i + 1]) * 0.5;
	}
	this.skyN = 0;
	while (this.hTop[this.skyN] < P.skyTop) this.skyN++;
	// fan: the pitch doubles at 9 merge rows spread evenly over the schedule — row
	// round(k*(N-1)/9), k = 1..9 — so the last merge lands on the last row and the
	// bottom row is exactly one cell spanning the wrap (design §1.1 "single at center").
	// With round(k*N/9) the ninth merge falls past the last row and the center keeps
	// 2 cells: measured and rejected (7186 vs 7155 cells).
	this.fanN = new Int32Array(n);
	this.fanOff = new Int32Array(n + 1);
	C = P.nCols; off = 0;
	for (i = 0; i < n; i++) {
		this.fanN[i] = C;
		this.fanOff[i] = off;
		off += C;
		for (k = 1; k <= 9; k++) {
			if (i + 1 === Math.round(k * (n - 1) / 9) && C > 1) { C >>= 1; break; }
		}
	}
	this.fanOff[n] = off;
	tot = off;
	this.bands = 0;
	for (i = 0; i < n; i++) if (i === 0 || this.fanN[i] !== this.fanN[i - 1]) this.bands++;
	this.bandOf = new Int32Array(n);
	this.bandRow = new Int32Array(this.bands);
	this.bandBot = new Int32Array(this.bands);
	bi = -1;
	for (i = 0; i < n; i++) if (i === 0 || this.fanN[i] !== this.fanN[i - 1]) this.bandRow[++bi] = i;
	for (bi = 0; bi < this.bands; bi++) {
		this.bandBot[bi] = (bi + 1 < this.bands) ? this.bandRow[bi + 1] : n;
		for (i = this.bandRow[bi]; i < this.bandBot[bi]; i++) this.bandOf[i] = bi;
	}
	this.nbr = new Int32Array(tot * 6).fill(-1);
	this.nbrFace = new Float32Array(tot * 6);
	this.nbrDist = new Float32Array(tot * 6);
	this.buildNeighbours();
	// LUT buffers: lutX is per screen column (cw), the rest per screen row (ch)
	this.lutX = new Float64Array(P.cw);
	this.lutY = new Float64Array(P.ch);
	this.lutRow = new Int32Array(P.ch);
	this.lutRowBase = new Int32Array(P.ch);
	this.lutRowCnt = new Int32Array(P.ch);
	this.lutRowInvP = new Float64Array(P.ch);
	this.lutCol = new Int32Array(P.cw);
	this.lutFrac = new Float32Array(P.cw);
	// base scales come from the calibration window alone, so a canvas of another size
	// shows more world at zoom 1 — it never changes what zoom 1 means
	this.kx0 = P.winW / P.cw;
	this.du0 = (this.u(P.winTop) - this.u(P.winBot)) / P.ch;
	this.kxMin = this.kx0 / P.zoomMax; this.kxMax = this.kx0 / P.zoomMin;
	this.duMin = this.du0 / P.zoomMax; this.duMax = this.du0 / P.zoomMin;
	// flat preset table (design §1.4): [uniform zoom divisor, u centre]. The divisor is
	// applied to BOTH axes, so a cone stays square and the design's bed-pixel table
	// (a 50 m bed = 2.0 px at x10) holds in the preset itself. 'ovw' is the one
	// anisotropic preset — default width x full depth — and is handled separately.
	this.PRESETS = {
		def: [1, (this.u(P.winTop) + this.u(P.winBot)) / 2],
		cru: [10, this.u(-10e3)],
		bas: [40, this.u(-3e3)]
	};
};

// one link of the stencil: slot, face width and centre distance
function link(G, cell, slot, other, face, dist) {
	var o = cell * 6 + slot;
	G.nbr[o] = other;
	G.nbrFace[o] = face;
	G.nbrDist[o] = dist;
}

// 6-slot stencil over the graded fan. Coarse-fine faces carry the *fine* cell's width
// on both sides, and the centre distance is the true centre-to-centre distance, so
// i in nbr(j) <=> j in nbr(i) with the same face and the same dist (geom-check asserts
// it). A diffusion stencil then needs no special case at a coarse-fine interface.
GEO.buildNeighbours = function () {
	var n = this.N, wrap = P.wrap, i, j, cell, Cn, pn, pi, jj, dx, dy, face, k;
	for (i = 0; i < n; i++) {
		pi = wrap / this.fanN[i];
		for (j = 0; j < this.fanN[i]; j++) {
			cell = this.fanOff[i] + j;
			// the single-cell bottom row spans the whole wrap: its horizontal
			// neighbours are itself, i.e. zero flux — leave the slots empty
			if (this.fanN[i] > 1) {
				link(this, cell, 0, this.fanOff[i] + (j - 1 + this.fanN[i]) % this.fanN[i], this.rowH[i], pi);
				link(this, cell, 1, this.fanOff[i] + (j + 1) % this.fanN[i], this.rowH[i], pi);
			}
			for (k = 0; k < 2; k++) {
				var r = k ? i - 1 : i + 1;
				if (r < 0 || r >= n) continue;
				Cn = this.fanN[r];
				pn = wrap / Cn;
				face = pn < pi ? pn : pi;
				dy = this.rowCy[r] - this.rowCy[i];
				var base = 2 + k * 2;
				if (Cn <= this.fanN[i]) {
					jj = Math.floor((j + 0.5) * pi / pn) % Cn;
					dx = (jj + 0.5) * pn - (j + 0.5) * pi;
					link(this, cell, base, this.fanOff[r] + jj, face, Math.sqrt(dx * dx + dy * dy));
				} else {
					for (var m = 0; m < 2; m++) {
						jj = j * 2 + m;
						dx = (jj + 0.5) * pn - (j + 0.5) * pi;
						link(this, cell, base + m, this.fanOff[r] + jj, face, Math.sqrt(dx * dx + dy * dy));
					}
				}
			}
		}
	}
};

// row index holding altitude y (m, positive up); sky (y > 0) returns -1
GEO.rowOf = function (y) {
	var d = -y, lo = 0, hi = this.N - 1, m;
	// y = 0 belongs to row 0 (the 0 m band spans depth [0, h0)); only y > 0 is sky
	if (y > 0 || d >= this.hTop[this.N]) return -1;
	while (lo < hi) {
		m = (lo + hi) >> 1;
		if (this.hTop[m + 1] <= d) lo = m + 1; else hi = m;
	}
	return lo;
};

// mirrored sky row holding altitude y > 0 (reference only: no fan cells, no state)
GEO.skyRowOf = function (y) {
	var lo = 0, hi = this.skyN - 1, m;
	while (lo < hi) {
		m = (lo + hi) >> 1;
		if (this.hTop[m + 1] <= y) lo = m + 1; else hi = m;
	}
	return lo;
};

// fan cell owning world x in ground row i
GEO.cellOf = function (i, x) {
	var C = this.fanN[i], j = Math.floor(x / (P.wrap / C));
	return this.fanOff[i] + ((j % C) + C) % C;
};

// the display map and its inverse (§1.4)
GEO.u = function (y) { return Math.asinh(y / P.yLin); };
GEO.y = function (u) { return P.yLin * Math.sinh(u); };
GEO.sy = function (wy) { return (this.u(wy) - this.uB) / this.duPx; };
GEO.sx = function (wx) { return (wx - this.x0) / this.kx; };
GEO.xAt = function (sx) { return this.x0 + sx * this.kx; };
GEO.yAt = function (sy) { return P.yLin * Math.sinh(this.uT - sy * this.duPx); };
GEO.wrapX = function (x) { return x - Math.floor(x / P.wrap) * P.wrap; };

// --- camera: the only way to move the window, so the LUTs cannot go stale ---------
// (Assigning P.view directly leaves lutX/lutY from the previous window — a stale-LUT
// class of bug that reads as a wrong owner search, not as a crash.)

GEO.invalidate = function () { this.dirty = true; };

GEO.lookAt = function (cx, uT, uB) {
	var v = P.view;
	v.cx = cx;
	if (uT !== undefined) { v.uT = uT; v.uB = uB; }
	this.dirty = true;
};

GEO.setPreset = function (name) {
	var v = P.view;
	v.cx = 0;
	if (name === 'ovw') {
		// anisotropic on purpose: keep the default 2.34 km/px horizontal so the cone
		// stays 17.1 px wide, and fit the full depth on the vertical axis (§1.4)
		v.kx = this.kx0;
		v.uT = this.u(P.skyTop);
		v.uB = this.u(-P.R);
		this.dirty = true;
		return;
	}
	var q = this.PRESETS[name];
	if (!q) return;
	var half = this.du0 * P.ch / q[0] / 2;
	v.kx = this.kx0 / q[0];
	v.uT = q[1] + half;
	v.uB = q[1] - half;
	this.dirty = true;
};

GEO.panBy = function (dxPx, dyPx) {
	var v = P.view, dU = dyPx * this.duPx;
	v.cx -= dxPx * this.kx;
	v.uT += dU;
	v.uB += dU;
	this.dirty = true;
};

// zoom by f about a canvas point; both axes share the factor (uniform zoom is what
// keeps a cone square), each clamped to its own range
GEO.zoomAt = function (f, sx, sy) {
	var v = P.view;
	var kx = Math.min(this.kxMax, Math.max(this.kxMin, v.kx / f));
	var du = Math.min(this.duMax, Math.max(this.duMin, this.duPx / f));
	var uc = this.uT - sy * this.duPx;
	var wx = this.x0 + sx * this.kx;
	v.cx = wx + (P.cw / 2 - sx) * kx;
	v.uT = uc + sy * du;
	v.uB = v.uT - P.ch * du;
	v.kx = kx;
	this.dirty = true;
};

// rebuild the per-pixel LUTs and the depth grid for the window in P.view
// (display-space; the clamped span is written back so later events stay exact).
// The axes are independent: the overview preset keeps the horizontal scale while
// fitting the full depth (§1.4 zoom note).
GEO.rebuild = function (v) {
	var uMax = this.u(P.skyTop), uMin = this.u(-P.R);
	var spanU = v.uT - v.uB;
	if (spanU >= uMax - uMin) { v.uT = uMax; v.uB = uMin; }
	else {
		if (v.uT > uMax) { v.uT = uMax; v.uB = uMax - spanU; }
		if (v.uB < uMin) { v.uB = uMin; v.uT = uMin + spanU; }
	}
	this.uT = v.uT;
	this.uB = v.uB;
	this.duPx = (this.uT - this.uB) / P.ch;
	this.kx = v.kx;
	// v.cx stays continuous (unwrapped): the world is periodic, so raw coordinates
	// keep the pan/zoom anchor math exact; the readout wraps for display only
	this.x0 = v.cx - P.cw * this.kx / 2;
	// screen row 0 is the top of the window (uT); u decreases going down the screen.
	// lutX is wrapped into [0, wrap): the body pass then turns it into a fan cell with
	// one multiply and no modulo (the world is periodic, nothing needs it continuous)
	var lx = this.lutX, ly = this.lutY, c;
	for (c = 0; c < P.cw; c++) lx[c] = this.wrapX(this.x0 + (c + 0.5) * this.kx);
	for (c = 0; c < P.ch; c++) {
		var y = P.yLin * Math.sinh(this.uT - (c + 0.5) * this.duPx);
		var r = this.rowOf(y);
		ly[c] = y;
		this.lutRow[c] = r;
		this.lutRowBase[c] = r < 0 ? 0 : this.fanOff[r];
		this.lutRowCnt[c] = r < 0 ? 1 : this.fanN[r];
		this.lutRowInvP[c] = r < 0 ? 0 : this.fanN[r] / P.wrap;
	}
	this.buildGrid(P.yLin * Math.sinh(this.uT), P.yLin * Math.sinh(this.uB));
	this.dirty = false;
};

GEO.sync = function () { if (this.dirty) this.rebuild(P.view); };

// per frame: which crust column owns each screen pixel column, and where inside it.
// One pointer walk over the x-sorted columns — O(pixels), no search per pixel.
GEO.buildColLUT = function (S) {
	var n = S.nCol, w = P.cw, lc = this.lutCol, lf = this.lutFrac;
	if (n === 0) { lc.fill(-1); lf.fill(0); return; }
	var x0 = this.x0, tx, c, cx, nx, px;
	var xm = this.wrapX(x0);
	// last column whose x <= xm (the owner of the left edge, wrapping to n-1)
	var lo = 0, hi = n - 1;
	c = n - 1;
	while (lo <= hi) {
		var m = (lo + hi) >> 1;
		if (S.colX[m] <= xm) { c = m; lo = m + 1; } else hi = m - 1;
	}
	cx = S.colX[c] + P.wrap * Math.floor((x0 - S.colX[c]) / P.wrap);
	nx = this.nextColX(S, c, cx);
	for (px = 0; px < w; px++) {
		tx = x0 + (px + 0.5) * this.kx;
		while (nx <= tx) {
			c = c + 1 < n ? c + 1 : 0;
			cx = nx;
			nx = this.nextColX(S, c, cx);
		}
		lc[px] = c;
		lf[px] = (tx - cx) / (nx - cx);
	}
};

// right edge of column c, in the same wrap image as cx
GEO.nextColX = function (S, c, cx) {
	var n = S.nCol;
	if (n === 1) return cx + P.wrap;
	var cn = c + 1 < n ? c + 1 : 0;
	return S.colX[cn] + P.wrap * Math.ceil((cx - S.colX[cn]) / P.wrap);
};

// adaptive nice-step depth grid; the label strings are built here (on view change),
// never in the frame loop
GEO.buildGrid = function (yT, yB) {
	var steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
	var step = steps[steps.length - 1], i, d, g = [], y;
	for (i = 0; i < steps.length; i++) {
		d = (this.u(0) - this.u(-steps[i] * 1e3)) / this.duPx;
		if (d >= 30) { step = steps[i]; break; }
	}
	for (y = -step * 1e3; y > yB; y -= step * 1e3)
		g.push({ s: this.sy(y), t: (y / 1e3 | 0) + ' km' });
	for (y = step * 1e3; y < yT; y += step * 1e3)
		g.push({ s: this.sy(y), t: '+' + (y / 1e3 | 0) + ' km' });
	g.sort(function (a, b) { return a.s - b.s; });
	this.grid = g;
};

GEO.init();

if (typeof module !== 'undefined' && module.exports) module.exports = GEO;
