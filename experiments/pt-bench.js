// pt-bench.js — 0.3.0 P0: what the particle engine's kernels cost, before any of it exists.
//
// Two claims decide the whole design and both are measured here:
//
//  1. The flow solve is DIRECT, not iterative. The domain is a slab, periodic in x, whose
//     vertical mesh is the display's asinh mesh: the metric J(eta) = zLin cosh(eta) depends
//     on ONE coordinate. Written in flux variables U = J u (x faces) and V = v (eta faces)
//     the discrete divergence is the plain uniform-grid one, and the pressure operator is
//     separable: an FFT along x leaves one tridiagonal system per wavenumber along eta,
//     solved exactly by Thomas. No multigrid, no V-cycle count, no convergence gate.
//  2. The particle passes (grid<->particle transfer, a 6-bond constraint walk, per-cluster
//     shape matching, additive splat) fit a per-frame budget at the counts the design wants.
//
// Run: node experiments/pt-bench.js
'use strict';

var tmin = function (fn, reps) {
	var i, t0, dt, best = Infinity;
	for (i = 0; i < reps; i++) {
		t0 = process.hrtime.bigint();
		fn();
		dt = Number(process.hrtime.bigint() - t0) / 1e6;
		if (dt < best) best = dt;
	}
	return best;
};

var check = { fails: 0, total: 0 };
function ok(name, cond, info) {
	check.total++;
	if (!cond) check.fails++;
	console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
}

// ---------------------------------------------------------------- FFT (complex, tables)

function fftPlan(n) {
	var rev = new Int32Array(n), cos = new Float64Array(n), sin = new Float64Array(n);
	var i, j, bits = 0, k, half = n >> 1;
	while ((1 << bits) < n) bits++;
	for (i = 0; i < n; i++) {
		rev[i] = 0;
		for (j = 0; j < bits; j++) rev[i] |= ((i >> j) & 1) << (bits - 1 - j);
	}
	for (k = 0; k < half; k++) {
		cos[k] = Math.cos(2 * Math.PI * k / n);
		sin[k] = -Math.sin(2 * Math.PI * k / n);   // forward kernel exp(-i theta)
	}
	// the inverse needs exp(+i theta): a forward transform rescaled by 1/n is NOT the
	// inverse, it is the time-reversed signal, and an even (cosine) test cannot see it.
	return { n: n, half: half, rev: rev, cos: cos, sin: sin, sinP: sin.map(function (v) { return -v; }) };
}

function fft(plan, re, im, off, inv) {
	var n = plan.n, rev = plan.rev, tc = plan.cos, ts = inv ? plan.sinP : plan.sin;
	var i, j, len, k, step, c, s, ur, ui, vr, vi, tr, ti, re1, im1;
	for (i = 0; i < n; i++) {
		j = rev[i];
		if (j > i) {
			tr = re[off + i]; re[off + i] = re[off + j]; re[off + j] = tr;
			ti = im[off + i]; im[off + i] = im[off + j]; im[off + j] = ti;
		}
	}
	for (len = 2; len <= n; len <<= 1) {
		step = (n / len) | 0;
		for (i = 0; i < n; i += len) {
			for (k = 0; k < (len >> 1); k++) {
				c = tc[k * step]; s = ts[k * step];
				re1 = re[off + i + k]; im1 = im[off + i + k];
				vr = re[off + i + k + (len >> 1)]; vi = im[off + i + k + (len >> 1)];
				tr = vr * c - vi * s; ti = vr * s + vi * c;
				re[off + i + k] = re1 + tr; im[off + i + k] = im1 + ti;
				re[off + i + k + (len >> 1)] = re1 - tr; im[off + i + k + (len >> 1)] = im1 - ti;
			}
		}
	}
	if (inv) for (i = 0; i < n; i++) { re[off + i] /= n; im[off + i] /= n; }
}

// ---------------------------------------------------------------- the slab mesh

// Rows are uniform in eta = asinh(y / zLin) over [0, etaBot]; the metric is
// J(eta) = zLin cosh(eta) (m of depth per unit eta). Cell j spans eta in [j, j+1] * dEta,
// faces sit at j * dEta. Volume of a cell (per unit depth) is dx * dEta * J(centre).
function slabMesh(nx, ny, wrap, zLin, depth, skyTop) {
	var etaBot = Math.asinh(depth / zLin);
	var etaSky = Math.asinh(skyTop / zLin);
	var dEta = (etaBot + etaSky) / ny;
	var m = {
		nx: nx, ny: ny, wrap: wrap, dx: wrap / nx, zLin: zLin, dEta: dEta,
		etaBot: etaBot, etaSky: etaSky, eta0: -etaSky,
		etaC: new Float64Array(ny), jC: new Float64Array(ny),
		jF: new Float64Array(ny + 1), yC: new Float64Array(ny + 1),
		vol: new Float64Array(ny)
	};
	var j, e;
	for (j = 0; j < ny; j++) {
		e = m.eta0 + (j + 0.5) * dEta;
		m.etaC[j] = e;
		m.jC[j] = zLin * Math.cosh(e);
		m.vol[j] = m.dx * dEta * m.jC[j];
	}
	for (j = 0; j <= ny; j++) {
		e = m.eta0 + j * dEta;
		m.jF[j] = zLin * Math.cosh(e);
		m.yC[j] = zLin * Math.sinh(e);   // depth of face j (negative under the surface)
	}
	return m;
}

// pressure operator: per wavenumber k with eigenvalue lam, one tridiagonal system in eta.
//   div( grad p ) =  J_j (p_{i+1} - 2p_i + p_{i-1})/dx^2
//                  + [(p_{j+1}-p_j)/J_{j+1/2} - (p_j-p_{j-1})/J_{j-1/2}]/dEta^2
// The x part is diagonalised by the FFT, so the matrix depends on lam only.
function makeSolver(m) {
	var nx = m.nx, ny = m.ny, nk = (nx >> 1) + 1;
	var plan = fftPlan(nx);
	var re = new Float64Array(ny * nx), im = new Float64Array(ny * nx);
	var lam = new Float64Array(nk), sub = new Float64Array(ny), dia = new Float64Array(ny), sup = new Float64Array(ny);
	var cr = new Float64Array(ny), ci = new Float64Array(ny), gr = new Float64Array(ny), gi = new Float64Array(ny);
	var k, j;
	for (k = 0; k < nk; k++) {
		var th = 2 * Math.PI * k / nx;
		lam[k] = (2 - 2 * Math.cos(th)) / (m.dx * m.dx);
	}
	var s = { m: m, plan: plan, re: re, im: im, lam: lam, sub: sub, dia: dia, sup: sup, k: 0 };

	// solve div grad p = d  (d = the flux divergence, summed over the k<0 mirror), and
	// return p. The caller's d is destroyed.
	s.solve = function (d, p) {
		var i, jx, kk, half = nx >> 1, c, e2 = m.dEta * m.dEta, hr, hi;
		for (jx = 0; jx < ny; jx++) {
			var base = jx * nx, e = base + nx;
			for (i = base; i < e; i++) { re[i] = d[i]; im[i] = 0; }
			fft(plan, re, im, base, false);
		}
		for (kk = 0; kk <= half; kk++) {
			for (jx = 0; jx < ny; jx++) {
				c = 1 / (e2 * m.jF[jx]);
				sub[jx] = c;
				sup[jx] = 1 / (e2 * m.jF[jx + 1]);
				dia[jx] = -m.jC[jx] * lam[kk] - (sub[jx] + sup[jx]);
				cr[jx] = re[jx * nx + kk]; ci[jx] = im[jx * nx + kk];
			}
			// free slip top and bottom: dp/deta = 0 -> the flux on the outer face
			// vanishes, so the diagonal GAINS the eliminated coefficient.
			dia[0] += sub[0]; sub[0] = 0;
			dia[ny - 1] += sup[ny - 1]; sup[ny - 1] = 0;
			for (j = 1; j < ny; j++) {
				c = sub[j] / dia[j - 1];
				dia[j] -= c * sup[j - 1];
				cr[j] -= c * cr[j - 1];
				ci[j] -= c * ci[j - 1];
			}
			// k = 0 has the constants in its null space (all-Neumann). The rhs is
			// compatible (sum of the flux divergence is zero), so dropping the last
			// equation and pinning p there selects the constant: every other row is
			// satisfied exactly. The pin goes AFTER the sweep or the sweep undoes it.
			if (kk === 0) { dia[ny - 1] = 1; cr[ny - 1] = 0; ci[ny - 1] = 0; }
			hr = cr[ny - 1] / dia[ny - 1]; hi = ci[ny - 1] / dia[ny - 1];
			cr[ny - 1] = hr; ci[ny - 1] = hi;
			for (j = ny - 2; j >= 0; j--) {
				hr = (cr[j] - sup[j] * hr) / dia[j];
				hi = (ci[j] - sup[j] * hi) / dia[j];
				cr[j] = hr; ci[j] = hi;
			}
			for (j = 0; j < ny; j++) { re[j * nx + kk] = cr[j]; im[j * nx + kk] = ci[j]; }
		}
		for (j = 1; j < half; j++) for (jx = 0; jx < ny; jx++) {
			re[jx * nx + nx - j] = re[jx * nx + j];
			im[jx * nx + nx - j] = -im[jx * nx + j];
		}
		for (jx = 0; jx < ny; jx++) fft(plan, re, im, jx * nx, true);
		for (jx = 0; jx < ny * nx; jx++) p[jx] = re[jx];
	};
	return s;
}

// ---------------------------------------------------------------- time the solve

function main() {
	console.log('\n0.3.0 P0 — particle engine kernel bench  (best of N; this box has 2 cores)\n');

	// Two independent references. A solver checked against the operator it was built from
// proves nothing, so:
//   A. the FFT is compared with a naive DFT and a round trip (the inverse kernel sign bug
//      that a cosine test cannot see is exactly the bug this caught);
//   B. the per-wavenumber tridiagonal is compared with a dense Gaussian solve of the same
//      matrix, assembled from the written formula rather than from the solver's code.
function fftRefCheck() {
	var nx = 16, ny = 1, m = slabMesh(nx, ny, 10000e3, 40e3, 1000e3, 20e3);
	var s = makeSolver(m), plan = s.plan;
	var n = nx, i, k, seed = 11;
	var a = new Float64Array(n), b = new Float64Array(n), ar = new Float64Array(n), ai = new Float64Array(n);
	for (i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; a[i] = (seed % 2000) / 1000 - 1; ar[i] = a[i]; }
	fft(plan, ar, ai, 0, false);
	var err = 0, sr, si, th;
	for (k = 0; k < n; k++) {
		sr = 0; si = 0;
		for (i = 0; i < n; i++) { th = -2 * Math.PI * k * i / n; sr += a[i] * Math.cos(th); si += a[i] * Math.sin(th); }
		err = Math.max(err, Math.abs(ar[k] - sr), Math.abs(ai[k] - si));
	}
	fft(plan, ar, ai, 0, true);
	var rt = 0;
	for (i = 0; i < n; i++) rt = Math.max(rt, Math.abs(ar[i] - a[i]));
	return [err, rt];
}

// dense reference for one wavenumber: the same tridiagonal, built from the formula
function denseMode(nx, ny, k, pin) {
	var m = slabMesh(nx, ny, 10000e3, 40e3, 1000e3, 20e3);
	var s = makeSolver(m);
	var lam = (2 - 2 * Math.cos(2 * Math.PI * k / nx)) / (m.dx * m.dx);
	var e2 = m.dEta * m.dEta, j, r, c;
	var A = [], rhs = new Float64Array(ny);
	for (j = 0; j < ny; j++) {
		A.push(new Float64Array(ny));
		A[j][j] = -m.jC[j] * lam;
		if (j > 0) { c = 1 / (e2 * m.jF[j]); A[j][j - 1] += c; A[j][j] -= c; }
		if (j < ny - 1) { c = 1 / (e2 * m.jF[j + 1]); A[j][j + 1] += c; A[j][j] -= c; }
		rhs[j] = (j === 2) ? 1 : 0;
	}
	var b = Float64Array.from(rhs);
	if (pin) { for (c = 0; c < ny; c++) A[ny - 1][c] = 0; A[ny - 1][ny - 1] = 1; b[ny - 1] = 0; }
	for (c = 0; c < ny; c++) {
		var piv = c;
		for (r = c + 1; r < ny; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
		var t = A[c]; A[c] = A[piv]; A[piv] = t;
		var tb = b[c]; b[c] = b[piv]; b[piv] = tb;
		for (r = c + 1; r < ny; r++) {
			var f = A[r][c] / A[c][c];
			if (!f) continue;
			for (var q = c; q < ny; q++) A[r][q] -= f * A[c][q];
			b[r] -= f * b[c];
		}
	}
	var x = new Float64Array(ny);
	for (j = ny - 1; j >= 0; j--) { var sum = b[j]; for (c = j + 1; c < ny; c++) sum -= A[j][c] * x[c]; x[j] = sum / A[j][j]; }
	// solver's spectrum for the same rhs
	var d = new Float64Array(nx * ny), p = new Float64Array(nx * ny);
	var i;
	for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) d[j * nx + i] = (j === 2 ? 1 : 0) * Math.cos(2 * Math.PI * k * i / nx);
	s.solve(d, p);
	var coef = new Float64Array(ny), err = 0, scale = 0;
	var fac = (k === 0 || k === nx / 2) ? 1 / nx : 2 / nx;
	for (j = 0; j < ny; j++) {
		sum = 0;
		for (i = 0; i < nx; i++) sum += p[j * nx + i] * Math.cos(2 * Math.PI * k * i / nx);
		coef[j] = fac * sum;
		err = Math.max(err, Math.abs(coef[j] - x[j]));
		scale = Math.max(scale, Math.abs(x[j]));
	}
	return [err / scale, Math.abs(x[2])];
}

var f1 = fftRefCheck();
ok('FFT matches a naive DFT', f1[0] < 1e-12, 'max abs diff ' + f1[0].toExponential(2));
ok('FFT round trip is the identity', f1[1] < 1e-12, 'max abs diff ' + f1[1].toExponential(2));
var d1 = denseMode(8, 6, 1, false);
ok('mode 1 tridiagonal matches a dense solve', d1[0] < 1e-12, 'rel ' + d1[0].toExponential(2) + ' vs |p| ' + d1[1].toExponential(2));
var d0 = denseMode(8, 6, 0, true);
ok('mode 0 (pinned) tridiagonal matches a dense solve', d0[0] < 1e-12, 'rel ' + d0[0].toExponential(2) + ' vs |p| ' + d0[1].toExponential(2));

// projection exactness: after removing div(U*) the discrete flux divergence must vanish
	function divCheck(nx, ny, wrap) {
		var m = slabMesh(nx, ny, wrap, 40e3, 1000e3, 20e3);
		var s = makeSolver(m);
		var d = new Float64Array(nx * ny), p = new Float64Array(nx * ny), pt = new Float64Array(nx * ny);
		var i, j, seed = 3;
		for (i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed % 2000) / 1000 - 1; }
		// make the rhs compatible: subtract the mean of each k=0 column sum
		var sum = 0;
		for (j = 0; j < ny; j++) { sum = 0; for (i = 0; i < nx; i++) sum += d[j * nx + i]; sum /= nx; for (i = 0; i < nx; i++) d[j * nx + i] -= sum; }
		s.solve(d, pt);
		// apply the same divergence operator to grad(p) and subtract: must cancel d
		var e2 = m.dEta * m.dEta, maxd = 0, maxr = 0;
		for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
			var im1 = (i + nx - 1) % nx, ip1 = (i + 1) % nx;
			var lap = m.jC[j] * (pt[j * nx + ip1] - 2 * pt[j * nx + i] + pt[j * nx + im1]) / (m.dx * m.dx);
			var dn = (j > 0) ? (pt[j * nx + i] - pt[(j - 1) * nx + i]) / m.jF[j] : 0;
			var up = (j < ny - 1) ? (pt[(j + 1) * nx + i] - pt[j * nx + i]) / m.jF[j + 1] : 0;
			lap += (up - dn) / e2;
			maxr = Math.max(maxr, Math.abs(d[j * nx + i] - lap));
			maxd = Math.max(maxd, Math.abs(d[j * nx + i]));
		}
		return maxr / maxd;
	}
	var r1 = divCheck(128, 96, 10000e3), r2 = divCheck(256, 96, 10000e3);
	ok('projection cancels the divergence (128x96)', r1 < 1e-11, 'rel residual ' + r1.toExponential(2));
	ok('projection cancels the divergence (256x96)', r2 < 1e-12, 'rel residual ' + r2.toExponential(2));

	function benchSolve(nx, ny, wrap, reps) {
		var m = slabMesh(nx, ny, wrap, 40e3, 1000e3, 20e3);
		var s = makeSolver(m);
		var d = new Float64Array(nx * ny), p = new Float64Array(nx * ny);
		var i;
		for (i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.37) * 0.001;
		var t = tmin(function () { s.solve(d, p); }, reps || 12);
		console.log('  ' + nx + 'x' + ny + ' solve   ' + t.toFixed(3) + ' ms');
		return t;
	}

	console.log('');
	var t128 = benchSolve(128, 96, 10000e3);
	var t256 = benchSolve(256, 96, 10000e3);
	var t512 = benchSolve(512, 96, 10000e3);
	console.log('  (x3 penalised solid iterations: ' + (t128 * 3).toFixed(2) + ' / ' + (t256 * 3).toFixed(2) + ' / ' + (t512 * 3).toFixed(2) + ' ms)');
	console.log('  (real-input FFT packing halves every number above)');

	// ---------------------------------------------------------------- particle passes

	function benchParticles(n, label) {
		var px = new Float64Array(n), py = new Float64Array(n);
		var vx = new Float64Array(n), vy = new Float64Array(n);
		var T = new Float64Array(n), m = new Float64Array(n), st = new Float64Array(n);
		var bo = new Int32Array(n * 6), br = new Float64Array(n * 6);
		var i, k, seed = 12345;
		for (i = 0; i < n; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			px[i] = (seed % 100000) / 100000 * 10000e3;
			py[i] = (seed % 977) / 977 * 1000e3;
			st[i] = (seed % 100) / 100;
			m[i] = 1 + (seed % 7) * 0.1;
			for (k = 0; k < 6; k++) bo[i * 6 + k] = (i + 1 + k * 37) % n;
			for (k = 0; k < 6; k++) br[i * 6 + k] = 2000 + k * 100;
		}
		var nx = 256, ny = 96, gw = 10000e3 / nx, gh = 1000e3 / ny;

		var transfer = function () {
			var i, fx, fy, w, ii, jj, c, c1, c2, c3, x, y;
			for (i = 0; i < n; i++) {
				x = px[i] / gw; y = py[i] / gh;
				ii = x | 0; jj = y | 0;
				if (jj > ny - 2) jj = ny - 2;
				fx = x - ii; fy = y - jj;
				if (ii >= nx) ii -= nx;
				c1 = (ii + 1 === nx) ? 0 : ii + 1;
				c = jj * nx + ii;
				var q = (jj + 1) * nx;
				c2 = q + ii; c3 = q + c1;
				w = (1 - fx) * (1 - fy); vx[c] += w * m[i]; vy[c] += w * T[i]; st[c] += w;
				w = fx * (1 - fy); vx[c1] += w * m[i]; vy[c1] += w * T[i]; st[c1] += w;
				w = (1 - fx) * fy; vx[c2] += w * m[i]; vy[c2] += w * T[i]; st[c2] += w;
				w = fx * fy; vx[c3] += w * m[i]; vy[c3] += w * T[i]; st[c3] += w;
			}
		};

		var gather = function () {
			var i, fx, fy, w, ii, jj, c, c1, c2, c3, x, y;
			for (i = 0; i < n; i++) {
				x = px[i] / gw; y = py[i] / gh;
				ii = x | 0; jj = y | 0;
				if (jj > ny - 2) jj = ny - 2;
				fx = x - ii; fy = y - jj;
				if (ii >= nx) ii -= nx;
				c1 = (ii + 1 === nx) ? 0 : ii + 1;
				c = jj * nx + ii;
				var q = (jj + 1) * nx;
				c2 = q + ii; c3 = q + c1;
				w = (1 - fx) * (1 - fy); vx[i] = w * px[c]; vy[i] = w * py[c];
				w = fx * (1 - fy); vx[i] += w * px[c1]; vy[i] += w * py[c1];
				w = (1 - fx) * fy; vx[i] += w * px[c2]; vy[i] += w * py[c2];
				w = fx * fy; vx[i] += w * px[c3]; vy[i] += w * py[c3];
			}
		};

		var integrate = function () {
			var i;
			for (i = 0; i < n; i++) {
				px[i] += vx[i]; py[i] += vy[i];
				if (px[i] < 0) px[i] += 10000e3; else if (px[i] >= 10000e3) px[i] -= 10000e3;
				vy[i] = vy[i] * 0.999 - 1e-5;
				T[i] += 1e-9 * (0.5 - T[i]);
			}
		};

		// one XPBD distance iteration over 6 bonds: the hot path of the solid
		var bonds = function () {
			var i, k, b, dx, dy, d, err, s;
			for (i = 0; i < n; i++) {
				for (k = 0; k < 6; k++) {
					b = bo[i * 6 + k];
					dx = px[b] - px[i]; dy = py[b] - py[i];
					if (dx > 5000e3) dx -= 10000e3; else if (dx < -5000e3) dx += 10000e3;
					d = Math.sqrt(dx * dx + dy * dy);
					if (d < 1) continue;
					err = (d - br[i * 6 + k]) / d;
					s = 0.05 * err;
					px[i] += s * dx; py[i] += s * dy;
				}
			}
		};

		var shape = function () {
			var i, mx = 0, my = 0, mt = 0, qr = 0, qi = 0, dr, di, th, ct, sx, gx, gy;
			for (i = 0; i < n; i++) { mx += px[i] * m[i]; my += py[i] * m[i]; mt += m[i]; }
			mx /= mt; my /= mt;
			for (i = 0; i < n; i++) {
				dr = px[i] - mx; di = py[i] - my;
				qr += dr * vx[i] + di * vy[i];
				qi += dr * vy[i] - di * vx[i];
			}
			th = Math.atan2(qi, qr); ct = Math.cos(th); sx = Math.sin(th);
			for (i = 0; i < n; i++) {
				gx = mx + ct * vx[i] - sx * vy[i];
				gy = my + sx * vx[i] + ct * vy[i];
				px[i] += 0.3 * (gx - px[i]);
				py[i] += 0.3 * (gy - py[i]);
			}
		};

		var t = {};
		t.transfer = tmin(transfer, 8);
		t.gather = tmin(gather, 8);
		t.integrate = tmin(integrate, 8);
		t.bonds = tmin(bonds, 8);
		t.shape = tmin(shape, 8);
		t.total = t.transfer + t.gather + t.integrate + t.bonds + t.shape;
		console.log('  ' + label + ' (' + n + ' particles):  '
			+ 'transfer ' + t.transfer.toFixed(2) + '  gather ' + t.gather.toFixed(2)
			+ '  integrate ' + t.integrate.toFixed(2) + '  bonds ' + t.bonds.toFixed(2)
			+ '  shape ' + t.shape.toFixed(2) + '  | total ' + t.total.toFixed(2) + ' ms');
		return t.total;
	}

	console.log('');
	benchParticles(20000, 'small ');
	benchParticles(40000, 'target');
	benchParticles(80000, 'large ');

	// a bond pass without the sqrt (the projected distance is only needed for the update)
	function benchBondNoSqrt(n) {
		var px = new Float64Array(n), py = new Float64Array(n);
		var bo = new Int32Array(n * 6), br = new Float64Array(n * 6);
		var i, k, seed = 5;
		for (i = 0; i < n; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			px[i] = (seed % 100000) / 100000 * 10000e3;
			py[i] = (seed % 977) / 977 * 1000e3;
			for (k = 0; k < 6; k++) bo[i * 6 + k] = (i + 1 + k * 37) % n;
			for (k = 0; k < 6; k++) br[i * 6 + k] = 2000 + k * 100;
		}
		var pass = function () {
			var i, k, b, dx, dy, d2, inv, err;
			for (i = 0; i < n; i++) {
				for (k = 0; k < 6; k++) {
					b = bo[i * 6 + k];
					dx = px[b] - px[i]; dy = py[b] - py[i];
					d2 = dx * dx + dy * dy;
					inv = 1 / Math.sqrt(d2 + 1e-6);
					err = (d2 - br[i * 6 + k] * br[i * 6 + k]) * inv;
					if (!(err > -1e9)) continue;
					var s = 0.05 * err * inv;
					px[i] += s * dx; py[i] += s * dy;
				}
			}
		};
		var t = tmin(pass, 8);
		console.log('  bond pass, one rsqrt per bond, ' + n + ' particles:  ' + t.toFixed(2) + ' ms');
	}
	benchBondNoSqrt(40000);

	// ---------------------------------------------------------------- splat

	function benchSplat(n, r) {
		var w = 1280, h = 560, buf = new Uint32Array(w * h);
		var px = new Float64Array(n), py = new Float64Array(n), col = new Uint32Array(n);
		var i, seed = 7, side = 2 * r + 1;
		for (i = 0; i < n; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			px[i] = (seed % 1000) / 1000 * w;
			py[i] = (seed % 613) / 613 * h;
			col[i] = 0xff203040;
		}
		var pass = function () {
			var i, a, b, x, y, xx, yy, v, q;
			for (i = 0; i < n; i++) {
				x = px[i] | 0; y = py[i] | 0;
				if (x < r || x >= w - r || y < r || y >= h - r) continue;
				for (b = -r; b <= r; b++) {
					q = (y + b) * w + x;
					for (a = -r; a <= r; a++) {
						xx = q + a;
						v = buf[xx];
						buf[xx] = (v + col[i]) >>> 0;
					}
				}
			}
		};
		var t = tmin(pass, 8);
		console.log('  splat ' + n + ' particles, ' + side + 'x' + side + ' kernel:  ' + t.toFixed(2) + ' ms');
		return t;
	}

	console.log('');
	benchSplat(20000, 2);
	benchSplat(40000, 2);
	benchSplat(40000, 1);

	console.log('\n' + (check.fails === 0 ? 'ALL PASS' : check.fails + ' FAILURES') + ' (' + check.total + ' checks)');
	console.log('\n' + (check.fails === 0 ? 'ALL PASS' : check.fails + ' FAILURES') + ' (' + check.total + ' checks)');
	process.exitCode = check.fails === 0 ? 0 : 1;
}

if (require.main === module) main();

module.exports = { fftPlan: fftPlan, fft: fft, slabMesh: slabMesh, makeSolver: makeSolver, check: check, ok: ok, tmin: tmin, main: main };
