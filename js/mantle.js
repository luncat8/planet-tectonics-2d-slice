// mantle.js — K1 (design §4.1, §2.4): the seeded periodic streamfunction flow, its
// surface speed at the columns, and the fan T step (semi-Lagrangian advection, relaxation
// toward the adiabat, the lithospheric lid re-imposed from the columns). Plumes are M4.
// Headless and allocation-free: the flow sampler writes into MNT.vx / MNT.vy.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.RNG;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;

var MNT = {
	nMode: 4,                        // k = 2..5
	n: new Int32Array(4),            // integer harmonic of the wrap
	kap: new Float64Array(4),        // 2*pi*n/wrap, 1/m
	c: new Float64Array(4),          // obliquity of the wave fronts in (x, y)
	om: new Float64Array(4),         // precession, rad/Myr
	ph: new Float64Array(4),
	amp: 0,                          // U0/4, m/Myr
	t: 0, s: 0,                      // flow time (Myr) and Tm^2.5 of the current frame
	vx: 0, vy: 0,                    // flow() output, m/Myr
	uCol: new Float64Array(P.colCap), // surface mantle speed at each column this frame
	cRe: new Float64Array(4), cIm: new Float64Array(4), sRe: new Float64Array(4), sIm: new Float64Array(4)
};

// Modes come from the hashed world noise of the seed, not the run-order stream: the
// initial planet's draws stay where they were and the flow is a pure function of seed.
MNT.init = function (seed) {
	var s = (seed ^ 0x5bd1e995) | 0, m, k;
	this.amp = P.U0 / 4;
	for (m = 0; m < this.nMode; m++) {
		k = m + 2;
		this.n[m] = Math.round(k * P.wrap / (2 * Math.PI * P.Lm));
		this.kap[m] = 2 * Math.PI * this.n[m] / P.wrap;
		this.c[m] = 0.2 + 0.2 * RNG.hash2(m, 1, s);
		this.om[m] = 2 * Math.PI / (200 + 300 * RNG.hash2(m, 2, s));
		this.ph[m] = 2 * Math.PI * RNG.hash2(m, 3, s);
	}
};

MNT.setTime = function (t, Tm) {
	this.t = t;
	this.s = Math.pow(Tm, 2.5);
};

// u_x(x, 0, t): the surface drive under the plates
MNT.uSurf = function (x) {
	var u = 0, m;
	for (m = 0; m < this.nMode; m++) u += Math.cos(this.kap[m] * x + this.om[m] * this.t + this.ph[m]);
	return this.s * this.amp * u;
};

// (u_x, u_y) = s*(dpsi/dy, -dpsi/dx) with psi = sum amp/(kap*c) * sin(theta),
// theta = kap*(x + c*y) + om*t + ph: divergence-free by construction
MNT.flow = function (x, y) {
	var vx = 0, vy = 0, m, cs;
	for (m = 0; m < this.nMode; m++) {
		cs = Math.cos(this.kap[m] * (x + this.c[m] * y) + this.om[m] * this.t + this.ph[m]);
		vx += cs;
		vy -= cs / this.c[m];
	}
	this.vx = this.s * this.amp * vx;
	this.vy = this.s * this.amp * vy;
};

MNT.columns = function (S) {
	for (var i = 0; i < S.nCol; i++) this.uCol[i] = this.uSurf(S.colX[i]);
};

// T in fan row r at world x: linear between the row's cell centres, periodic in x
MNT.rowT = function (T, r, x) {
	var C = GEO.fanN[r], off = GEO.fanOff[r];
	if (C === 1) return T[off];
	var sx = x * C / P.wrap - 0.5, j0 = Math.floor(sx), f = sx - j0, j1;
	j0 = ((j0 % C) + C) % C;
	j1 = j0 + 1 < C ? j0 + 1 : 0;
	return T[off + j0] + (T[off + j1] - T[off + j0]) * f;
};

// bilinear over the graded rows (a convex combination: bounds are preserved, and a
// constant field is reproduced exactly); clamped to the top and bottom row centres
MNT.sampleT = function (T, x, y) {
	var cy = GEO.rowCy, N = GEO.N, d = -y, lo = 0, hi = N - 1, m;
	if (d <= cy[0]) return this.rowT(T, 0, x);
	if (d >= cy[N - 1]) return this.rowT(T, N - 1, x);
	while (hi - lo > 1) {
		m = (lo + hi) >> 1;
		if (cy[m] <= d) lo = m; else hi = m;
	}
	var a = this.rowT(T, lo, x), b = this.rowT(T, hi, x);
	return a + (b - a) * (d - cy[lo]) / (cy[hi] - cy[lo]);
};

// Semi-Lagrangian, one back-trace step from each cell centre into the scratch field
// (the flow varies over thousands of km, a frame moves < 200 km: a midpoint trace
// doubles the cost for no visible gain). Along a row the centre phases step by
// kap*pitch, so the cosines come from a rotation recurrence instead of Math.cos.
// The symmetric neighbour stencil is reserved for diffusion; advection samples.
MNT.stepT = function (S, dt) {
	var T = S.Tf, TS = S.TfS, N = GEO.N, M = this.nMode, cr = this.cRe, ci = this.cIm;
	var sr = this.sRe, si = this.sIm, r, j, m, C, pitch, off, y, vx, vy, re;
	var relax = Math.exp(-dt / P.tauT), yMin = -P.R, a = this.s * this.amp, yd, ang;
	for (r = 0; r < N; r++) {
		C = GEO.fanN[r];
		off = GEO.fanOff[r];
		pitch = P.wrap / C;
		y = -GEO.rowCy[r];
		for (m = 0; m < M; m++) {
			ang = this.kap[m] * (0.5 * pitch + this.c[m] * y) + this.om[m] * this.t + this.ph[m];
			cr[m] = Math.cos(ang); ci[m] = Math.sin(ang);
			sr[m] = Math.cos(this.kap[m] * pitch); si[m] = Math.sin(this.kap[m] * pitch);
		}
		for (j = 0; j < C; j++) {
			vx = 0; vy = 0;
			for (m = 0; m < M; m++) {
				vx += cr[m];
				vy -= cr[m] / this.c[m];
				re = cr[m] * sr[m] - ci[m] * si[m];
				ci[m] = cr[m] * si[m] + ci[m] * sr[m];
				cr[m] = re;
			}
			yd = y - dt * a * vy;
			TS[off + j] = relax * this.sampleT(T, (j + 0.5) * pitch - dt * a * vx, yd > 0 ? 0 : (yd < yMin ? yMin : yd));
		}
	}
	T.set(TS);
	COL.lidFan();
};

MNT.k1 = function (S, dt, t, Tm) {
	if (!(dt > 0)) return;
	MNT.setTime(t, Tm);
	MNT.columns(S);
	MNT.stepT(S, dt);
};

if (typeof module !== 'undefined' && module.exports) module.exports = MNT;
