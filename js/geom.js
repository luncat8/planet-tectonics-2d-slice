// geom.js — the scales of design §1 as pure math + the display LUTs.
// Rows: h_i = h0*q^i, edge depth y_i = h0*(q^i - 1)/(q - 1) (closed form).
// Display: u(y) = asinh(y/yLin); screen rows are uniform in u (§1.4).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;

var GEO = {
	N: 0, q: 0,
	hTop: null,      // Float64Array(N+1): ground row i top edge depth (m, positive down)
	skyN: 0,         // rows mirrored upward to +skyTop
	fanN: null,      // Int32Array(N): cells in ground row i
	fanOff: null,    // Int32Array(N+1): prefix cell index, fanOff[N] = total
	bandRow: null,   // Int32Array(bands): first row of each band
	bandBot: null,   // Int32Array(bands): first row after each band
	bands: 0,
	// the current window, rebuilt on view change (never per frame)
	x0: 0, kx: 0, uT: 0, uB: 0, duPx: 0,
	lutX: null, lutY: null,
	grid: null       // {s, t}[] depth grid lines, labels prebuilt on view change
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
	var n = P.nRows, i, k, C, off, bi;
	this.N = n;
	this.q = solveQ(P.h0, n, P.R);
	this.hTop = new Float64Array(n + 1);
	for (i = 0; i <= n; i++) this.hTop[i] = P.h0 * (Math.pow(this.q, i) - 1) / (this.q - 1);
	this.hTop[n] = P.R; // snap the closure to the exact radius (bisection leaves ~1e-9)
	this.skyN = 0;
	while (this.hTop[this.skyN] < P.skyTop) this.skyN++;
	// fan: pitch doubles at merge rows round(k*N/9), k = 1..9. k = 9 is always exactly
	// N (the bottom edge), so the bottom row ends up 2 cells (half the wrap each).
	this.fanN = new Int32Array(n);
	this.fanOff = new Int32Array(n + 1);
	C = P.nCols; off = 0;
	for (i = 0; i < n; i++) {
		this.fanN[i] = C;
		this.fanOff[i] = off;
		off += C;
		for (k = 1; k <= 9; k++) {
			if (i + 1 === Math.round(k * n / 9) && C > 1) { C = (C / 2) | 0; break; }
		}
	}
	this.fanOff[n] = off;
	this.bands = 0;
	for (i = 0; i < n; i++) if (i === 0 || this.fanN[i] !== this.fanN[i - 1]) this.bands++;
	this.bandRow = new Int32Array(this.bands);
	this.bandBot = new Int32Array(this.bands);
	bi = -1;
	for (i = 0; i < n; i++) if (i === 0 || this.fanN[i] !== this.fanN[i - 1]) this.bandRow[++bi] = i;
	for (bi = 0; bi < this.bands; bi++)
		this.bandBot[bi] = (bi + 1 < this.bands) ? this.bandRow[bi + 1] : n;
	this.lutX = new Float64Array(P.cw);
	this.lutY = new Float64Array(P.ch);
};

// the display map and its inverse (§1.4)
GEO.u = function (y) { return Math.asinh(y / P.yLin); };
GEO.y = function (u) { return P.yLin * Math.sinh(u); };
GEO.sy = function (wy) { return (this.u(wy) - this.uB) / this.duPx; };
GEO.sx = function (wx) { return (wx - this.x0) / this.kx; };

// rebuild the per-pixel LUTs and the depth grid for a view {cx, kx, uT, uB}
// (display-space window; the clamped span is written back so later events stay exact).
// The axes are independent: the overview preset keeps the horizontal scale while fitting
// the full depth (§1.4 zoom note).
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
	// screen row 0 is the top of the window (uT); u decreases going down the screen
	var lx = this.lutX, ly = this.lutY;
	for (var r = 0; r < P.ch; r++) {
		ly[r] = P.yLin * Math.sinh(this.uT - (r + 0.5) * this.duPx);
		lx[r] = this.x0 + (r + 0.5) * this.kx;
	}
	this.buildGrid(P.yLin * Math.sinh(this.uT), P.yLin * Math.sinh(this.uB));
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
