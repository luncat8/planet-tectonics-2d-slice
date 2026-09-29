// pt-conv.js — 0.3.0 P0: does mantle convection at the planned grid give plate-sized
// velocities at the planned demonstration clock? The clock is not free to choose: the
// pixel speed of the flow is v_phys * dt / (km per pixel), so the physics has to deliver a
// real mantle velocity (cm/yr) for the picture to move at 50-200 kyr/frame.
//
// This bench is deliberately NOT the engine's mesh: it is a plain uniform Rayleigh-Benard
// box (aspect 4:1, free slip, periodic in x) so what it measures is physics, not the asinh
// metric. The solve is the same one the engine uses: an FFT along x leaves one tridiagonal
// system per wavenumber along the vertical.
//
// Non-dimensionalisation: length D, temperature dT, time D^2/kappa, velocity kappa/D.
// At D = 1000 km, kappa = 1e-6 m^2/s, one velocity unit is 3.16e-3 cm/yr.
//
// Run: node experiments/pt-conv.js [steps per Ra]
'use strict';

var B = require('./pt-bench.js');
var fftPlan = B.fftPlan, fft = B.fft;

var KAPPA = 1e-6, DEPTH = 1e6;
var CM_YR_PER_ND = (KAPPA / DEPTH) * 3.156e7 * 100;   // 3.16e-3 cm/yr per nondimensional unit

function box(nx, ny, aspect) {
	var m = {
		nx: nx, ny: ny, aspect: aspect, dx: aspect / nx, dy: 1 / ny,
		plan: fftPlan(nx),
		Tr: new Float64Array(nx * ny), Ti: new Float64Array(nx * ny),
		wr: new Float64Array(nx * ny), wi: new Float64Array(nx * ny),
		or: new Float64Array(nx * ny), oi: new Float64Array(nx * ny),
		pr: new Float64Array(nx * ny), pi: new Float64Array(nx * ny),
		vr: new Float64Array(nx * ny), vi: new Float64Array(nx * ny),
		u: new Float64Array(nx * ny), v: new Float64Array(nx * ny),
		Tn: new Float64Array(nx * ny),
		hdiag: new Float64Array(ny), hup: new Float64Array(ny), hlo: new Float64Array(ny),
		hcr: new Float64Array(ny), hci: new Float64Array(ny),
		hwr: new Float64Array(ny), hwi: new Float64Array(ny),
		owr: new Float64Array(ny), owi: new Float64Array(ny),
		psr: new Float64Array(ny), psi: new Float64Array(ny),
		lam: new Float64Array((nx >> 1) + 1)
	};
	var k;
	for (k = 0; k <= (nx >> 1); k++) {
		var th = 2 * Math.PI * k / nx;
		m.lam[k] = (2 - 2 * Math.cos(th)) / (m.dx * m.dx);
	}
	return m;
}

// (d2/dy2 - lam) x = f, x = 0 on both walls. Cell-centred unknowns with the wall condition
// applied by odd reflection (x_-1 = -x_0 is exactly x = 0 halfway between the two), so the
// end rows get -3/dy2 instead of -2/dy2. Scratch arrays live in the box: no allocation here.
function helmholtz(m, lam, fr, fi, xr, xi) {
	var ny = m.ny, e = 1 / (m.dy * m.dy), j, c, hr, hi;
	var diag = m.hdiag, up = m.hup, lo = m.hlo, cr = m.hcr, ci = m.hci;
	for (j = 0; j < ny; j++) { diag[j] = -2 * e - lam; up[j] = e; lo[j] = e; }
	// odd reflection removes the ghost unknown: the end-row stencil becomes
	// (x1 - 3 x0)/dy2, so the diagonal LOSES the eliminated coefficient. Adding it
	// instead leaves the end rows nearly singular and the solver NaNs downstream.
	diag[0] -= e; diag[ny - 1] -= e;
	for (j = 0; j < ny; j++) { cr[j] = fr[j]; ci[j] = fi[j]; }
	for (j = 1; j < ny; j++) {
		c = lo[j] / diag[j - 1];
		diag[j] -= c * up[j - 1];
		cr[j] -= c * cr[j - 1];
		ci[j] -= c * ci[j - 1];
	}
	hr = cr[ny - 1] / diag[ny - 1]; hi = ci[ny - 1] / diag[ny - 1];
	xr[ny - 1] = hr; xi[ny - 1] = hi;
	for (j = ny - 2; j >= 0; j--) {
		hr = (cr[j] - up[j] * hr) / diag[j];
		hi = (ci[j] - up[j] * hi) / diag[j];
		xr[j] = hr; xi[j] = hi;
	}
}

// steady Stokes, the standard stream-function formulation:
//   laplacian(omega) = -Ra dT/dx,   laplacian(psi) = -omega,   u = dpsi/dy, v = -dpsi/dx
// Every x derivative is exact (spectral), so the buoyancy and the velocity stay smooth
// even where a finite difference in y is coarse. Two inverse transforms per step: psi
// (for u) and v. Nothing here allocates.
function stokes(m, Ra, T, u, v) {
	var nx = m.nx, ny = m.ny, half = nx >> 1, k, j, i, base, e;
	var plan = m.plan, tr = m.Tr, ti = m.Ti, or = m.or, oi = m.oi;
	var pr = m.pr, pi = m.pi, vr = m.vr, vi = m.vi;
	for (j = 0; j < ny; j++) {
		base = j * nx; e = base + nx;
		for (i = base; i < e; i++) { tr[i] = T[i]; ti[i] = 0; }
		fft(plan, tr, ti, base, false);
	}

	for (k = 0; k <= half; k++) {
		var kx = 2 * Math.PI * k / (nx * m.dx);        // physical wavenumber, 1/length
		var hr = m.hwr, hi = m.hwi, wr = m.owr, wi = m.owi, sr = m.psr, si = m.psi;
		for (j = 0; j < ny; j++) {                     // omega rhs = -Ra * dT/dx
			hr[j] = Ra * kx * ti[j * nx + k];
			hi[j] = -Ra * kx * tr[j * nx + k];
		}
		helmholtz(m, m.lam[k], hr, hi, wr, wi);        // omega

		for (j = 0; j < ny; j++) { hr[j] = -wr[j]; hi[j] = -wi[j]; }
		helmholtz(m, m.lam[k], hr, hi, sr, si);        // psi
		// velocities from the SAME mode profiles psi_hat(y): v = -i kx psi_hat and
		// u = dpsi_hat/dy by the same central difference in y. Taking both derivatives of
		// one discrete stream function is what makes the discrete divergence vanish
		// identically -- mixing a spectral x derivative with a difference in y leaves a
		// commutator residual of a few per cent.
		for (j = 0; j < ny; j++) {
			var jm = j > 0 ? j - 1 : 0, jp = j < ny - 1 ? j + 1 : ny - 1;
			var den = (j > 0 ? 1 : 0) + (j < ny - 1 ? 1 : 0);
			pr[j * nx + k] = (sr[jp] - sr[jm]) / (den * m.dy);
			pi[j * nx + k] = (si[jp] - si[jm]) / (den * m.dy);
			vr[j * nx + k] = kx * si[j];
			vi[j * nx + k] = -kx * sr[j];
		}
	}
	for (k = 1; k < half; k++) for (j = 0; j < ny; j++) {
		pr[j * nx + nx - k] = pr[j * nx + k];
		pi[j * nx + nx - k] = -pi[j * nx + k];
		vr[j * nx + nx - k] = vr[j * nx + k];
		vi[j * nx + nx - k] = -vi[j * nx + k];
	}
	for (j = 0; j < ny; j++) { pi[j * nx + half] = 0; vi[j * nx + half] = 0; }
	for (j = 0; j < ny; j++) {
		base = j * nx;
		fft(plan, pr, pi, base, true);
		fft(plan, vr, vi, base, true);
	}
	for (i = 0; i < nx * ny; i++) { u[i] = pr[i]; v[i] = vr[i]; }
}

// semi-Lagrangian advection (stable at any dt, which is what makes a long run affordable)
// plus explicit diffusion at the diffusion CFL
function advance(m, T, u, v, dt) {
	var nx = m.nx, ny = m.ny, i, j, Tn = m.Tn, ex = m.dx * m.dx, ey = m.dy * m.dy;
	for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
		var c = j * nx + i;
		var xs = i - u[c] * dt / m.dx;
		var ys = j - v[c] * dt / m.dy;
		var i0 = Math.floor(xs), f = xs - i0;
		i0 = ((i0 % nx) + nx) % nx;
		var i1 = (i0 + 1) % nx;
		var j0 = Math.floor(ys), g = ys - j0;
		if (j0 < 0) { j0 = 0; g = 0; }
		if (j0 > ny - 1) { j0 = ny - 1; g = 0; }
		var j1 = j0 + 1 < ny ? j0 + 1 : ny - 1;
		var a = T[j0 * nx + i0] * (1 - f) + T[j0 * nx + i1] * f;
		var b = T[j1 * nx + i0] * (1 - f) + T[j1 * nx + i1] * f;
		var adv = a * (1 - g) + b * g;
		var iL = j * nx + ((i + nx - 1) % nx), iR = j * nx + ((i + 1) % nx);
		var jD = (j > 0 ? j - 1 : 0) * nx + i, jU = (j < ny - 1 ? j + 1 : ny - 1) * nx + i;
		var lap = (T[iL] - 2 * T[c] + T[iR]) / ex + (T[jD] - 2 * T[c] + T[jU]) / ey;
		Tn[c] = adv + dt * lap;
	}
	for (i = 0; i < nx; i++) { Tn[i] = 1 - 0.5 * m.dy; Tn[(ny - 1) * nx + i] = 0.5 * m.dy; }
	T.set(Tn);
}

function stats(m, T, u, v) {
	var nx = m.nx, ny = m.ny, i, j, mu = 0, mv = 0, bot = 0, upn = 0, prev = false, first = false;
	for (i = 0; i < nx * ny; i++) { mu = Math.max(mu, Math.abs(u[i])); mv = Math.max(mv, Math.abs(v[i])); }
	for (i = 0; i < nx; i++) bot += (T[i] - T[nx + i]) / m.dy;
	// upwellings: sign changes of the depth-averaged vertical velocity
	var col = new Float64Array(nx);
	for (i = 0; i < nx; i++) { var s = 0; for (j = 0; j < ny; j++) s += v[j * nx + i]; col[i] = s / ny; }
	for (i = 0; i < nx; i++) {
		var cur = col[i] > 0;
		if (!first) { prev = cur; first = true; continue; }
		if (cur !== prev) { upn++; prev = cur; }
	}
	return { mu: mu, mv: mv, nu: bot / nx, wells: upn >> 1 };
}

// The run loop, exported so pt-eng-conv.js can drive the reference itself instead of
// re-implementing it: the box's own conduction profile plus one smooth perturbation of the
// box's scale, semi-Lagrangian advection (mantle codes run it at Courant 10-100) with the
// diffusion step capped at 0.2 dy^2.
function convect(Ra, tEnd, nx, ny, aspect, report) {
	var m = box(nx, ny, aspect), Tk = new Float64Array(nx * ny), i, j;
	var uk = m.u, vk = m.v;
	for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) {
		Tk[j * nx + i] = 1 - (j + 0.5) * m.dy
			+ 0.02 * Math.sin(Math.PI * (j + 0.5) * m.dy) * Math.cos(2 * Math.PI * i / nx);
	}
	var t = 0, st = null, t0 = Date.now(), dtDiff = 0.2 * m.dy * m.dy, n = 0, mx = 0, dt = dtDiff;
	var nextReport = 0;
	while (t < tEnd && n < 400000) {
		stokes(m, Ra, Tk, uk, vk);
		mx = 0;
		for (i = 0; i < nx * ny; i++) mx = Math.max(mx, Math.abs(uk[i]), Math.abs(vk[i]));
		dt = Math.min(dtDiff, 8 * m.dx / (mx + 1e-30));
		advance(m, Tk, uk, vk, dt);
		t += dt;
		n++;
		if (report && t >= nextReport) {
			st = stats(m, Tk, uk, vk);
			console.log('    t ' + t.toFixed(3) + '  Nu ' + st.nu.toFixed(2) + '  max|u| ' + st.mu.toFixed(0)
				+ '  max|v| ' + st.mv.toFixed(0) + '  upwellings ' + st.wells + '  CFL ' + (st.mu * dt / m.dx).toFixed(1));
			nextReport = t + tEnd / 4;
		}
	}
	st = stats(m, Tk, uk, vk);
	st.t = t; st.steps = n; st.cfl = mx * dt / m.dx; st.ms = Date.now() - t0;
	return st;
}

function main() {
	// ---------------------------------------------------------------- checks

	var chk = { fails: 0, total: 0 };
	function ok(name, cond, info) {
		chk.total++;
		if (!cond) chk.fails++;
		console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
	}

	console.log('\n0.3.0 P0 — mantle convection clock bench (uniform Rayleigh-Benard box, free slip)\n');

	var nx = 128, ny = 48, aspect = 4;
	var m = box(nx, ny, aspect);
	var T = new Float64Array(nx * ny), u = new Float64Array(nx * ny), v = new Float64Array(nx * ny);
	var i, j;
	for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) T[j * nx + i] = 1 - (j + 0.5) * m.dy;

	stokes(m, 1e6, T, u, v);
	var s0 = stats(m, T, u, v);
	ok('conduction state has no flow', s0.mu < 1e-9, 'max|u| = ' + s0.mu.toExponential(2));

	// the y-solver against a manufactured solution: phi = sin(pi y) cos(kx x), for which the
// continuous operator gives exactly f = -(pi^2 + kx^2) sin(pi y)
(function () {
	var kk = 1, lam = 1.5707963267948966 * 1.5707963267948966, err = 0, sc = 0;
	var kx = Math.PI / 2, fr = new Float64Array(ny), fi = new Float64Array(ny);
	var xr = new Float64Array(ny), xi = new Float64Array(ny), want = new Float64Array(ny);
	for (var jj = 0; jj < ny; jj++) {
		var y = (jj + 0.5) * m.dy;
		want[jj] = Math.sin(Math.PI * y);
		fr[jj] = -(Math.PI * Math.PI + kx * kx) * want[jj];
	}
	helmholtz(m, lam, fr, fi, xr, xi);
	for (var j2 = 0; j2 < ny; j2++) { err = Math.max(err, Math.abs(xr[j2] - want[j2])); sc = Math.max(sc, Math.abs(want[j2])); }
	// the discretisation is second order: with dy = 1/48 the expected error is O(1e-3)
	ok('y-solver reproduces a manufactured sin(pi y)', err / sc < 5e-3, 'rel ' + (err / sc).toExponential(2));

	// and the Stokes chain must be divergence free
	var Td = new Float64Array(nx * ny), ud = new Float64Array(nx * ny), vd = new Float64Array(nx * ny);
	for (var i2 = 0; i2 < nx; i2++) for (var j3 = 0; j3 < ny; j3++) {
		var yy = (j3 + 0.5) * ny / 1;
		Td[j3 * nx + i2] = 1 - (j3 + 0.5) * m.dy + 0.3 * Math.sin(Math.PI * (j3 + 0.5) * m.dy) * Math.cos(2 * Math.PI * i2 / nx);
	}
	stokes(m, 1e6, Td, ud, vd);
	var divmax = 0, umax = 0, base = 0, scale;
	for (var j4 = 0; j4 < ny; j4++) for (var i3 = 0; i3 < nx; i3++) {
		base = j4 * nx + i3;
		var iL = j4 * nx + ((i3 + nx - 1) % nx), iR = j4 * nx + ((i3 + 1) % nx);
		var jD = (j4 > 0 ? j4 - 1 : 0) * nx + i3, jU = (j4 < ny - 1 ? j4 + 1 : ny - 1) * nx + i3;
		scale = (j4 > 0 ? 1 : 0) + (j4 < ny - 1 ? 1 : 0);
		var div = (ud[iR] - ud[iL]) / (2 * m.dx) + (vd[jU] - vd[jD]) / (scale * m.dy);
		divmax = Math.max(divmax, Math.abs(div));
		umax = Math.max(umax, Math.abs(ud[base]));
	}
	ok('Stokes velocity is (discretely) divergence free', divmax * m.dx / (umax + 1e-30) < 0.05,
		'max|div| * dx / |u| = ' + (divmax * m.dx / umax).toExponential(2));
})();

var Tb = Float64Array.from(T);
	for (i = 0; i < nx; i++) Tb[i] += 0.2 * Math.exp(-Math.pow((i - nx / 2) / (nx / 12), 2));
	stokes(m, 1e6, Tb, u, v);
	ok('a hot blob under a conduction profile rises', v[3 * nx + (nx >> 1)] > 0,
		'v above the blob = ' + v[3 * nx + (nx >> 1)].toExponential(2));

	var Tc = Float64Array.from(T);
	for (i = 0; i < nx; i++) Tc[(ny - 1) * nx + i] -= 0.2 * Math.exp(-Math.pow((i - nx / 2) / (nx / 12), 2));
	stokes(m, 1e6, Tc, u, v);
	ok('a cold blob at the top sinks', v[(ny - 4) * nx + (nx >> 1)] < 0,
		'v below the blob = ' + v[(ny - 4) * nx + (nx >> 1)].toExponential(2));

	// ---------------------------------------------------------------- runs

	function run(Ra, tEnd, report) { return convect(Ra, tEnd, nx, ny, aspect, report); }

	var tEnd = Number(process.argv[2] || 0.5);
	console.log('  runs: ' + nx + 'x' + ny + ', aspect 4, to t = ' + tEnd + ' diffusion times, dt = 0.2 dy^2\n');
	var rows = [];
	[1e5, 3e5, 1e6, 3e6].forEach(function (Ra) {
		var st = run(Ra, tEnd, true);
		rows.push([Ra, st]);
		console.log('  Ra ' + Ra.toExponential(0) + ':  Nu ' + st.nu.toFixed(2) + '  max|u| ' + st.mu.toFixed(0)
			+ '  max|v| ' + st.mv.toFixed(0) + '  upwellings ' + st.wells + '  CFL ' + st.cfl.toFixed(1)
			+ '   (' + st.steps + ' steps, ' + (st.ms / 1000).toFixed(1) + ' s)\n');
	});

	console.log('  calibration: 1 nondimensional velocity unit = ' + CM_YR_PER_ND.toFixed(4) + ' cm/yr');
	console.log('  (kappa 1e-6 m2/s, depth 1000 km; 1 cm/yr = 10 km/Myr)\n');
	console.log('  Ra        max|u| cm/yr   plume cm/yr   px/frame @100 kyr/f, 2.34 km/px   3000 km in');
	rows.forEach(function (r) {
		var Ra = r[0], st = r[1];
		var ucm = st.mu * CM_YR_PER_ND, vcm = st.mv * CM_YR_PER_ND;
		var kmframe = vcm * 10 * 100 / 1000;
		console.log('  ' + Ra.toExponential(0) + '      ' + ucm.toFixed(2) + '          ' + vcm.toFixed(2)
			+ '          ' + (kmframe / 2.34).toFixed(2) + '                    ' + (3000 / kmframe).toFixed(0) + ' frames');
	});
	console.log('\n' + (chk.fails === 0 ? 'ALL PASS' : chk.fails + ' FAILURES') + ' (' + chk.total + ' checks)');
	process.exitCode = chk.fails === 0 ? 0 : 1;
}

if (require.main === module) main();

module.exports = { box: box, helmholtz: helmholtz, stokes: stokes, advance: advance, stats: stats, convect: convect, main: main, CM_YR_PER_ND: CM_YR_PER_ND };
