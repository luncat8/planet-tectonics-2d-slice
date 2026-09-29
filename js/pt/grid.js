// pt/grid.js — 0.3.0 P1: the mesh, its operators, the Stokes solve and the grid<->marker
// transfer. This is the file every number in the plan's §3.3 and §7 comes from.
//
// Staggering (plan §3.3, revised in P1). Node-centred: T, omega and psi live at the
// eta-faces ("node rows" j = 0..ny) and at the x-nodes i = 0..nx-1, so the surface and the
// CMB are node rows and the Dirichlet conditions (T, psi, omega = 0 at the top; T = 1 at
// the base) sit on unknowns the solver never steps. Velocities are staggered:
//
//     u[j][i]  at (x_i, etaC[j])   = (psi[j+1][i] - psi[j][i]) / (dEta * Jc[j])
//     v[j][i]  at (xC[i], eta_j)   = -(psi[j][i+1] - psi[j][i]) / dx
//
// which makes the discrete divergence of the pair cancel *identically* — the x difference
// of u and the eta difference of v telescope into the same four-point mixed difference with
// opposite signs (see divRel, and pt-check's exactness check). Nothing here is projected,
// so the incompressibility the markers ride is exact, not approximate.
//
// The Stokes solve is the plan's §4.1 physics (infinite-Prandtl Boussinesq, the formulation
// pt-conv.js measures the clock with), on the stretched mesh:
//
//     lap(omega) = -RaK dT/dx        (omega = lap psi,  u = -dpsi/dy, v = +dpsi/dx)
//
// with lap = d2/dx2 + (1/J) d/deta((1/J) d/deta) written on the node mesh. The x operator
// is diagonalised by one FFT per row, which leaves one tridiagonal system per wavenumber,
// solved exactly by Thomas; both solves stay in the spectral domain, so a step costs one
// forward and one inverse transform, not two of each.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;

var G = {};

// ---------------------------------------------------------------- FFT (radix-2, tables)
// The inverse kernel must be the conjugate of the forward one; a forward transform
// rescaled by 1/n is the time-reversed signal, and cosine-only tests cannot see it.
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
		sin[k] = -Math.sin(2 * Math.PI * k / n);
	}
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

// ---------------------------------------------------------------- mesh and metric

// Rows are uniform in eta = asinh(y / yLin), y = depth in km, from the surface (eta 0) to
// the CMB (eta etaBot). The metric is J(eta) = yLin cosh(eta), so J = sqrt(yLin^2 + y^2):
// one square root per marker per frame, no transcendentals in the hot path.
G.mesh = function (nx, ny, wrap, depth, yLin) {
	var etaBot = Math.asinh(depth / yLin), dEta = etaBot / ny;
	var M = {
		nx: nx, ny: ny, wrap: wrap, depth: depth, yLin: yLin,
		dx: wrap / nx, dEta: dEta, etaBot: etaBot, n: (ny + 1) * nx,
		jN: new Float64Array(ny + 1), yN: new Float64Array(ny + 1),
		jC: new Float64Array(ny), vol: new Float64Array(ny),
		lam: new Float64Array((nx >> 1) + 1), plan: fftPlan(nx)
	};
	var j, m;
	for (j = 0; j <= ny; j++) {
		M.jN[j] = yLin * Math.cosh(j * dEta);
		M.yN[j] = yLin * Math.sinh(j * dEta);
	}
	for (j = 0; j < ny; j++) {
		M.jC[j] = yLin * Math.cosh((j + 0.5) * dEta);
		M.vol[j] = M.dx * dEta * M.jC[j];           // cell area per unit out-of-plane depth
	}
	M.cw = new Float64Array((ny + 1) * nx);     // mu_k / W_k, the conservative scatter's factor
	M.eMin = 0.5 * dEta; M.eMax = etaBot - 0.5 * dEta;
	M.yMin = yLin * Math.sinh(M.eMin); M.yMax = yLin * Math.sinh(M.eMax);
	for (m = 0; m <= (nx >> 1); m++) M.lam[m] = (2 - 2 * Math.cos(2 * Math.PI * m / nx)) / (M.dx * M.dx);
	return M;
};

// scratch fields, allocated once per mesh (plan §0: no allocation in the frame loop)
G.alloc = function (M) {
	var n = M.n;
	M.re = new Float64Array(n); M.im = new Float64Array(n);     // spectra
	M.pr = new Float64Array(n); M.pi = new Float64Array(n);     // psi spectrum, then psi
	M.lx = new Float64Array(n);                                 // explicit x laplacian
	M.inc = new Float64Array(n);                                // conduction increment
	M.sum = new Float64Array(n); M.w = new Float64Array(n);      // scatter accumulators
	M.counts = new Int32Array(n); M.slot = new Int32Array(n);    // marker occupancy, then slots
	M.rr = new Float64Array(M.ny + 1); M.ri = new Float64Array(M.ny + 1);
	M.xr = new Float64Array(M.ny + 1); M.xi = new Float64Array(M.ny + 1);
	M.or = new Float64Array(M.ny + 1); M.oi = new Float64Array(M.ny + 1);
	M.cp = new Float64Array(M.ny + 1); M.dp = new Float64Array(M.ny + 1);
	M.cs = new Float64Array(M.ny + 1); M.ds = new Float64Array(M.ny + 1);
	return M;
};

// interior-row coefficient pair of the eta part of the Laplacian at node row j:
//   a = 1/(dEta^2 Jc[j-1] Jn[j])   is the weight of the row above
//   c = 1/(dEta^2 Jc[j]   Jn[j])   is the weight of the row below
// (these are the two positive numbers the tridiagonal is assembled from; the sign of the
// matrix entries is the caller's business)
function etaCoeff(M, j, out) {
	var e2 = M.dEta * M.dEta * M.jN[j];
	out[0] = 1 / (e2 * M.jC[j - 1]);
	out[1] = 1 / (e2 * M.jC[j]);
}

// solve (lam + etaOp) x = rhs on the interior rows with x = 0 at both walls.
// (lam + etaOp) has diagonal -(lam + a + c), sub +a, super +c.
function solveMode(M, lam, rr, ri, xr, xi) {
	var ny = M.ny, j, t, ac = M._ac || (M._ac = new Float64Array(2));
	var sub = M._sub || (M._sub = new Float64Array(ny + 1));
	var dia = M._dia || (M._dia = new Float64Array(ny + 1));
	var sup = M._sup || (M._sup = new Float64Array(ny + 1));
	for (j = 1; j < ny; j++) {
		etaCoeff(M, j, ac);
		sub[j] = ac[0]; sup[j] = ac[1];
		dia[j] = -(lam + ac[0] + ac[1]);
	}
	// forward sweep (row 1 has no eliminated row above it, and both walls are known zeros)
	for (j = 2; j < ny; j++) {
		t = sub[j] / dia[j - 1];
		dia[j] -= t * sup[j - 1];
		rr[j] -= t * rr[j - 1];
		ri[j] -= t * ri[j - 1];
	}
	// back substitution
	xr[ny - 1] = rr[ny - 1] / dia[ny - 1];
	xi[ny - 1] = ri[ny - 1] / dia[ny - 1];
	for (j = ny - 2; j >= 1; j--) {
		xr[j] = (rr[j] - sup[j] * xr[j + 1]) / dia[j];
		xi[j] = (ri[j] - sup[j] * xi[j + 1]) / dia[j];
	}
}

G.solveMode = solveMode;

// ---------------------------------------------------------------- the Stokes step

// One steady Stokes solve: T at the nodes in, u (cell rows) and v (node rows) out. The
// forcing is the buoyancy only, so the result is exactly linear in RaK and exactly still
// for any T with no x-variation (the RHS is a pure x-derivative).
G.stokes = function (M, T, u, v, RaK) {
	var nx = M.nx, ny = M.ny, half = nx >> 1, i, j, m, base, b;
	var re = M.re, im = M.im, pr = M.pr, pi = M.pi;
	for (j = 0; j <= ny; j++) {
		base = j * nx;
		for (i = 0; i < nx; i++) { re[base + i] = T[base + i]; im[base + i] = 0; }
		fft(M.plan, re, im, base, false);
	}
	// walls: psi = 0 on both node rows, and the spectrum is rebuilt below
	for (i = 0; i < nx; i++) { pr[i] = 0; pi[i] = 0; pr[ny * nx + i] = 0; pi[ny * nx + i] = 0; }
	for (m = 0; m <= half; m++) {
		// spectrum of the central difference (T[i+1] - T[i-1])/(2dx) is i*s*That, s = sin(k dx)/dx
		var s = Math.sin(2 * Math.PI * m / nx) / M.dx;
		for (j = 1; j < ny; j++) {
			b = j * nx + m;
			M.rr[j] = RaK * s * im[b];       // RHS_omega = -RaK * dT/dx
			M.ri[j] = -RaK * s * re[b];
		}
		solveMode(M, M.lam[m], M.rr, M.ri, M.or, M.oi);   // lap(omega) = RHS
		solveMode(M, M.lam[m], M.or, M.oi, M.xr, M.xi);   // lap(psi) = omega
		for (j = 1; j < ny; j++) { b = j * nx + m; pr[b] = M.xr[j]; pi[b] = M.xi[j]; }
	}
	// Hermitian mirror, then back to physical space (one transform for the whole field)
	for (m = 1; m < half; m++) for (j = 1; j < ny; j++) {
		b = j * nx + m;
		pr[j * nx + nx - m] = pr[b];
		pi[j * nx + nx - m] = -pi[b];
	}
	for (j = 0; j <= ny; j++) fft(M.plan, pr, pi, j * nx, true);
	// staggered velocities: the telescoping pair (see the header)
	for (j = 0; j < ny; j++) {
		base = j * nx;
		var d = M.dEta * M.jC[j];
		for (i = 0; i < nx; i++) u[base + i] = (pr[base + nx + i] - pr[base + i]) / d;
	}
	for (j = 0; j <= ny; j++) {
		base = j * nx;
		for (i = 0; i < nx; i++) v[base + i] = -(pr[base + (i + 1 === nx ? 0 : i + 1)] - pr[base + i]) / M.dx;
	}
};

// ---------------------------------------------------------------- the discrete divergence
// The discrete divergence of the cell (i,j): u is read on the two x faces of *that* cell
// (i and i+1) and v on its two eta faces, which is the pairing the construction makes cancel
// exactly. Reading u at i and i-1 with v at i (a half-cell off) measures a different, first
// order quantity and hides the property this helper exists to assert.
G.divMax = function (M, u, v) {
	var nx = M.nx, ny = M.ny, i, j, ip, d, mx = 0, sc = 0, s, e2;
	for (j = 0; j < ny; j++) {
		e2 = M.dEta * M.jC[j];
		for (i = 0; i < nx; i++) {
			ip = i + 1 === nx ? 0 : i + 1;
			d = (u[j * nx + ip] - u[j * nx + i]) + (v[(j + 1) * nx + i] - v[j * nx + i]) * M.dx / e2;
			s = (Math.abs(u[j * nx + ip]) + Math.abs(u[j * nx + i])) + (Math.abs(v[(j + 1) * nx + i]) + Math.abs(v[j * nx + i])) * M.dx / e2;
			if (Math.abs(d) > mx) mx = Math.abs(d);
			if (s > sc) sc = s;
		}
	}
	return sc > 0 ? mx / sc : 0;
};

// ---------------------------------------------------------------- conduction
// Implicit in eta, explicit in x. The near-surface rows are 2 km thick, where an explicit
// eta step would cap the frame at ~38 kyr (plan §2.3's slider goes to 500); the eta
// operator is a tridiagonal with x-independent coefficients, so it is factorised once per
// frame and applies to every column at the cost of one Thomas sweep. The x part needs no
// such care (dx = 31 km gives a 7.7 Myr limit against a 0.5 Myr slider).

G.lapXX = function (M, f, out) {
	var nx = M.nx, ny = M.ny, i, j, ip, im, base, inv = 1 / (M.dx * M.dx);
	for (j = 1; j < ny; j++) {
		base = j * nx;
		for (i = 0; i < nx; i++) {
			ip = i + 1 === nx ? 0 : i + 1;
			im = i === 0 ? nx - 1 : i - 1;
			out[base + i] = (f[base + ip] - 2 * f[base + i] + f[base + im]) * inv;
		}
	}
};

// in-place diffusion of the node field T over dt (dt * kappa of it); inc receives the
// per-node increment, which is what the markers get handed back (FLIP)
G.diffuse = function (M, T, dt, kappa, inc) {
	var ny = M.ny, nx = M.nx, j, i, rw = M.rr, ac = M._ac || (M._ac = new Float64Array(2));
	var dtk = dt * kappa;
	if (!(dtk > 0)) return;
	G.lapXX(M, T, M.lx);
	// factor (I - dtk * etaOp) once: the coefficients depend on eta only, so every one of
	// the nx columns shares the same Thomas multipliers. The sweep's rhs update uses the
	// *same* multiplier as the diagonal one (sub[j] / dp[j - 1]) — using the raw sub[j]
	// there is an explicit-looking scheme with the implicit matrix, and it grows.
	var sub = M.ds, sup = M.cs, mul = M.cp, dp = M.dp;
	for (j = 1; j < ny; j++) {
		etaCoeff(M, j, ac);
		sub[j] = -dtk * ac[0];
		sup[j] = -dtk * ac[1];
		var d = 1 + dtk * (ac[0] + ac[1]);
		if (j === 1) { dp[j] = d; mul[j] = 0; }
		else { mul[j] = sub[j] / dp[j - 1]; dp[j] = d - mul[j] * sup[j - 1]; }
	}
	for (i = 0; i < nx; i++) {
		// a wall that is not zero has to carry its value into the right-hand side: the
		// surface is fixed at 0 so its term vanishes, the base is fixed at 1 and dropping
		// its term drains the whole column into an ice-cold bottom (the base is where the
		// heat comes from). Measured before the fix: the interior lost 30x the wall flux.
		rw[1] = T[nx + i] + dtk * M.lx[nx + i] - sub[1] * T[i];
		for (j = 2; j < ny; j++) rw[j] = T[j * nx + i] + dtk * M.lx[j * nx + i] - mul[j] * rw[j - 1];
		rw[ny - 1] -= sup[ny - 1] * T[ny * nx + i];
		rw[ny - 1] /= dp[ny - 1];
		for (j = ny - 2; j >= 1; j--) rw[j] = (rw[j] - sup[j] * rw[j + 1]) / dp[j];
		for (j = 1; j < ny; j++) {
			var q = j * nx + i;
			inc[q] = rw[j] - T[q];
			T[q] = rw[j];
		}
	}
	// the walls are held: the surface is 0, the base is the mantle's own drop
	for (i = 0; i < nx; i++) { T[i] = 0; T[ny * nx + i] = 1; }
};

// ---------------------------------------------------------------- grid <-> markers
// Cloud-in-cell weights in (x, eta). One helper fills module-level scratch: no allocation,
// and each of the three staggers (nodes, u faces, v faces) is the same code with a
// half-cell offset.
var _i0 = 0, _j0 = 0, _fx = 0, _fy = 0, _i1 = 0, _j1 = 0;

function cellOf(M, x, eta, xoff, eoff, jlo, jhi) {
	var xd = x / M.dx - xoff, ed = eta / M.dEta - eoff;
	var i0 = Math.floor(xd), j0 = Math.floor(ed);
	_i0 = i0 - Math.floor(i0 / M.nx) * M.nx;
	_fx = xd - i0;
	_j0 = j0 < jlo ? jlo : (j0 > jhi ? jhi : j0);
	_fy = ed - _j0;
	if (_fy < 0) _fy = 0;
	if (_fy > 1) _fy = 1;
	_i1 = _i0 + 1 === M.nx ? 0 : _i0 + 1;
	_j1 = _j0 + 1;
}

G.cellOf = cellOf;

// markers -> node temperature, with the quadratic B-spline kernel (3x3 nodes), weighted by
// the marker masses. The node value has to be the material's mean temperature, because that
// is what the heat bookkeeping and the conduction's own measure are about.
//
// The wide kernel is not cosmetic. CIC hands a node the markers of its own cell, so a flow
// that squeezes the cloud into plumes -- measured at Ra 1e6: half the nodes left holding one
// or two markers, a quarter holding six or more -- leaves the rest of the field to be
// patched from stale values, and that is what drives the grid-scale instability. The
// quadratic kernel reaches 1.5 cells, so a node is fed by every marker near it and coverage
// survives the clumping; it is also what makes the deposit smooth enough for the spectral
// solver. A node no marker reaches at all keeps the value it was carried at, and the count
// is reported (S.empty).
//
// The deposit also leaves cw[k] = mu_k / W_k behind, W_k being the weight that arrived at the
// node, and gatherDT interpolates with the renormalized weights a_pk = W_pk * cw[k]. That
// pairing is the adjoint of the deposit -- sum_p m_p a_pk = mu_k for every node, whatever the
// stencil and however the cloud has drifted -- so the weight that claims a node's measure is
// exactly its measure, and the domain's whole intake is the operator's own integral to
// round-off. With plain weights it is not, and the increments' x-structure amplifies the gap
// brutally: a 4% occupancy hole read as 360x the wall flux.
G.scatterT = function (M, S, Tg) {
	var nx = M.nx, ny = M.ny, n = M.n, sum = M.sum, w = M.w, cw = M.cw;
	var p, q, i, j, base, ic, jc, ii, jj, di, dj, px, pe, wx, we, ww, tm, mm, e = 0, mu;
	for (i = 0; i < n; i++) { sum[i] = 0; w[i] = 0; }
	for (p = 0; p < S.n; p++) {
		px = S.x[p] / M.dx; ic = Math.round(px); px -= ic;
		pe = S.e[p] / M.dEta; jc = Math.round(pe); pe -= jc;
		tm = S.m[p] * S.T[p]; mm = S.m[p];
		var wxm = spl(-1 - px), wx0 = spl(-px), wxp = spl(1 - px);
		var wem = spl(-1 - pe), we0 = spl(-pe), wep = spl(1 - pe);
		for (dj = -1; dj <= 1; dj++) {
			jj = jc + dj;
			if (jj < 1 || jj > ny - 1) continue;               // the walls are boundary values
			we = dj === -1 ? wem : dj === 0 ? we0 : wep;
			base = jj * nx;
			for (di = -1; di <= 1; di++) {
				ii = ic + di; ii -= Math.floor(ii / nx) * nx;
				wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
				ww = wx * we;
				q = base + ii;
				sum[q] += ww * tm; w[q] += ww * mm;
			}
		}
	}
	for (j = 1; j < ny; j++) {
		mu = M.dEta * M.jN[j] * M.dx;
		base = j * nx;
		for (i = 0; i < nx; i++) {
			q = base + i;
			if (w[q] > 0.0625 * mu) { Tg[q] = sum[q] / w[q]; cw[q] = mu / w[q]; }
			else { e++; cw[q] = 0; }                           // under a sixteenth: not a sample
		}
	}
	if (e) fillHoles(M, S, Tg);
	// the walls are boundary conditions, not marker averages
	for (i = 0; i < nx; i++) { Tg[i] = 0; Tg[ny * nx + i] = 1; cw[i] = 0; cw[ny * nx + i] = 0; }
	S.empty = e;
};

// the grid increment back to the markers: flip = 1 is pure FLIP (the marker keeps its own
// temperature and receives only what the grid did to it), flip < 1 relaxes toward the grid.
// The marker's weight is the parcel area it was created with (state.js init, the local node
// volume) and does not change: area is a material property, and the run's heat bookkeeping
// and, later, the erupting mass both ride on it. The heat handed out here is the marker
// field's only source, so it is summed as it is applied into S.ledger: the marker heat then closes against the ledger to round-off by
// construction, and the *accuracy* of the delivery (the quadrature of the conduction intake
// against the operator's own wall flux) is a separate measured number, pt-check's job.
G.gatherDT = function (M, S, inc, Tg, flip) {
	var nx = M.nx, p, q, di, dj, jj, ii, ic, jc, px, pe, tot = 0, d, cw = M.cw, wsum;
	for (p = 0; p < S.n; p++) {
		px = S.x[p] / M.dx; ic = Math.round(px); px -= ic;
		pe = S.e[p] / M.dEta; jc = Math.round(pe); pe -= jc;
		var wxm = spl(-1 - px), wx0 = spl(-px), wxp = spl(1 - px);
		var wem = spl(-1 - pe), we0 = spl(-pe), wep = spl(1 - pe);
		var di_ = 0, tg = 0;
		for (dj = -1; dj <= 1; dj++) {
			jj = jc + dj;
			if (jj < 1 || jj > M.ny - 1) continue;
			var we = dj === -1 ? wem : dj === 0 ? we0 : wep;
			var base = jj * nx;
			for (di = -1; di <= 1; di++) {
				ii = ic + di; ii -= Math.floor(ii / nx) * nx;
				var wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
				wsum = wx * we * cw[base + ii];
				q = base + ii;
				di_ += wsum * inc[q];
				if (flip < 1) tg += wsum * Tg[q];
			}
		}
		if (flip < 1) {
			d = flip * (S.T[p] + di_) + (1 - flip) * tg - S.T[p];
			S.T[p] += d;
		} else {
			d = di_;
			S.T[p] += di_;
		}
		tot += S.m[p] * d;
	}
	S.ledger += tot;
};

// the flow at the markers, from the streamfunction rather than from the staggered arrays:
// u = (1/J) dpsi/deta and v = -dpsi/dx, bilinear in the cell the marker is in. The two
// components come from one interpolant, so they cannot disagree about a cell's circulation
// the way two separately interpolated CIC fields can, and the marker map's divergence is the
// interpolation error alone (measured 2% of the local velocity gradient, against a CIC pair
// that folded the cloud onto one row and one column within 10 Myr -- grid.js divMax asserts
// the underlying field's divergence is zero to round-off).
//
// The walls clamp eta half a row inside the boundary row: v is exactly zero at the boundary,
// so a marker held there could never be swept back in.
G.gatherVel = function (M, S, psi, dt) {
	var nx = M.nx, ny = M.ny, p, base, w0, w1, w2, w3, i, j0, j1, i0, i1, fx, fy, a, b, c, d;
	for (p = 0; p < S.n; p++) {
		cellOf(M, S.x[p], S.e[p], 0, 0, 0, ny - 1);
		base = _j0 * nx; i0 = _i0; i1 = _i1; fx = _fx; fy = _fy; j0 = _j0; j1 = _j1;
		w0 = (1 - fx) * (1 - fy); w1 = fx * (1 - fy); w2 = (1 - fx) * fy; w3 = fx * fy;
		a = psi[base + i0]; b = psi[base + i1];
		c = psi[base + nx + i0]; d = psi[base + nx + i1];
		var y = S.y[p];
		S.vx[p] = ((1 - fx) * (c - a) + fx * (d - b)) / M.dEta / Math.sqrt(M.yLin * M.yLin + y * y);
		S.vy[p] = -((1 - fy) * (b - a) + fy * (d - c)) / M.dx;
		if (dt > 0) {
			S.x[p] += S.vx[p] * dt;
			// eta steps through the metric: with y halfway through the frame, J = yLin*cosh(eta)
			// = sqrt(yLin^2 + y^2), so dEta = dy / J. The walls reflect the normal step, half a
			// row inside the boundary node: at the node itself v is exactly zero, so a marker
			// pinned there would never come back. Reflection is what an impermeable wall does to
			// material -- it redirects it, it does not collect it -- and it is measure
			// preserving, so the parcel areas the heat bookkeeping rides on survive the
			// encounter. Clamping instead measured as a sink: one convection cell swept the
			// cloud onto the wall rows and left 60% of the nodes empty, and the stale patches
			// that leaves behind are what drives the grid-scale instability.
			var y2 = S.y[p] + S.vy[p] * dt;
			var ym = S.y[p] + 0.5 * S.vy[p] * dt;
			var e = S.e[p] + S.vy[p] * dt / Math.sqrt(M.yLin * M.yLin + ym * ym);
			if (e < M.eMin) {
				e = 2 * M.eMin - e; y2 = 2 * M.yMin - y2; S.vy[p] = -S.vy[p]; S.clamp++;
			} else if (e > M.eMax) {
				e = 2 * M.eMax - e; y2 = 2 * M.yMax - y2; S.vy[p] = -S.vy[p]; S.clamp++;
			}
			S.e[p] = e; S.y[p] = y2;
			if (S.x[p] < 0) S.x[p] += M.wrap; else if (S.x[p] >= M.wrap) S.x[p] -= M.wrap;
		}
	}
};


// ---------------------------------------------------------------- marker repair
// A Lagrangian sample of a turbulent flow stretches into folds. The nodes it leaves behind
// keep a stale grid value, and the crowded ones hand their neighbours a mean that is not the
// local one -- both are coverage errors, and coverage is exactly what the heat bookkeeping
// rides on: gatherDT's weights claim a node's measure only if some marker reaches it.
//
// The cheap repair is: every empty node takes one marker from the nearest node that has two.
// A repaired marker keeps its T, m and v exactly -- its *position* was wrong and correcting
// that is the whole repair -- so the common case creates, diffuses and interpolates nothing.
// When a fold outruns the search (more than a row's worth of nodes left empty) the global
// re-deal below runs instead: it always restores coverage, at the price of resampling the
// field, which measured as several kappa of numerical diffusion when it ran every frame.
// force = the periodic global re-deal the caller's cadence asks for; without it this is the
// cheap coverage repair first, and the re-deal only if the repair cannot do the job.
G.reseed = function (M, S, force) {
	var nx = M.nx, ny = M.ny, counts = M.counts, slot = M.slot, order = S.order;
	var p, q, i, j, c = 0, n = 0, L, total = 0;
	counts.fill(0);
	for (p = 0; p < S.n; p++) counts[nodeOf(M, S, p)]++;
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) { q = j * nx + i; slot[q] = c; c += counts[q]; }
	for (p = 0; p < S.n; p++) { q = nodeOf(M, S, p); order[slot[q]++] = p; }
	if (force) { G.redeal(M, S, slot, order, counts); S.moved = 0; return; }
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) if (!counts[j * nx + i]) total++;
	for (L = 0; L < LEVELS.length; L++) {
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) {
			if (counts[j * nx + i]) continue;
			if (pull(M, S, counts, slot, order, j, i, LEVELS[L])) n++;
		}
		if (n >= total) break;                            // every node covered: stop
	}
	if (n > nx) G.redeal(M, S, slot, order, counts);      // a whole row's worth left: re-deal
	S.moved = n;
};
// the repair's search radii: the near ring first (a folded marker one or two cells off its
// node is the common case), then wider before the global re-deal earns its diffusion
var LEVELS = [2, 8, 32];

// The global fallback: deal the markers back onto the lattice by rank, sorted by node
// (row-major). It is a permutation of the same parcel temperatures, so nothing is created,
// and because the sort is by position a marker moves by how far its neighbourhood's crowding
// has pushed it, not across the domain. It does resample the field a little -- the marker
// that lands on node k is not the one that was nearest to it -- which is why it is the
// fallback and not the rule: measured, re-dealing every frame adds enough numerical diffusion
// to hold a convecting run at Nu = 1.00. Ranks run to nx * (ny-1) = S.n in P1; markers
// beyond the lattice (P2's eruptions) are left where they are.
G.redeal = function (M, S, slot, order, counts) {
	var nx = M.nx, ny = M.ny, k = 0, c, q, i, j, base, p, stop = nx * (ny - 1);
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) {
		q = j * nx + i;
		base = slot[q] - counts[q];               // slot[] holds each bucket's end
		for (c = 0; c < counts[q]; c++) {
			if (k >= stop) continue;
			p = order[base + c];
			S.x[p] = (k % nx) * M.dx;
			S.e[p] = (((k / nx) | 0) + 1) * M.dEta;
			S.y[p] = M.yN[((k / nx) | 0) + 1];
			k++;
		}
	}
	S.redeals++;
};


// A node no marker reaches would keep its last frame's value, and a stale patch is a buoyancy
// source that does not exist: measured, leaving holes stale drove a run at Ra 1e6 into a
// grid-scale instability (T to -0.8, Nu to 300). So the holes are smoothed from their
// neighbours -- three Gauss-Seidel sweeps, in place, over the holes only, with the wall rows
// read-only. This is field repair, not marker repair: the cloud stays Lagrangian.
function fillHoles(M, S, Tg) {
	var nx = M.nx, ny = M.ny, cw = M.cw, s, j, i, q, qn, qs, qw, qe, v, nb;
	for (s = 0; s < 3; s++) for (j = 1; j < ny; j++) {
		qn = (j - 1) * nx; qs = (j + 1) * nx;
		for (i = 0; i < nx; i++) {
			q = j * nx + i;
			if (cw[q]) continue;
			qw = i - 1 < 0 ? nx - 1 : i - 1; qe = i + 1 === nx ? 0 : i + 1;
			v = 0; nb = 0;
			if (cw[qn + i] || j === 1) { v += Tg[qn + i]; nb++; }
			if (cw[qs + i] || j === ny - 1) { v += Tg[qs + i]; nb++; }
			if (cw[j * nx + qw]) { v += Tg[j * nx + qw]; nb++; }
			if (cw[j * nx + qe]) { v += Tg[j * nx + qe]; nb++; }
			if (nb) Tg[q] = v / nb;
		}
	}
}

// the quadratic B-spline: the kernel of the marker<->grid transfer, applied separably. It is
// C1, normalized, and reaches 1.5 cells -- wide enough that a clumped cloud still feeds every
// node near it, and smooth enough for the spectral solver to read.
function spl(d) {
	var a = d < 0 ? -d : d;
	return a <= 0.5 ? 0.75 - d * d : a < 1.5 ? 0.5 * (1.5 - a) * (1.5 - a) : 0;
}

// the donor search for one empty node: square rings of increasing radius around it, periodic
// in x and clamped in eta. Each radius scans its own shell only -- the interior was tried at
// the previous radius -- so a level costs the ring's perimeter, not its area.
function pull(M, S, counts, slot, order, j, i, rmax) {
	var ny = M.ny, rad, dj, dk, jj;
	for (rad = 1; rad <= rmax; rad++) for (dj = -rad; dj <= rad; dj++) {
		jj = j + dj;
		if (jj < 1 || jj >= ny) continue;
		if (dj === -rad || dj === rad) {
			for (dk = -rad; dk <= rad; dk++) if (donor(M, S, counts, slot, order, j, i, jj, i + dk)) return 1;
		} else {
			if (donor(M, S, counts, slot, order, j, i, jj, i - rad)) return 1;
			if (donor(M, S, counts, slot, order, j, i, jj, i + rad)) return 1;
		}
	}
	return 0;
}

// move one marker from (jj, ii) -- if it has a spare -- to the empty node (j, i)
function donor(M, S, counts, slot, order, j, i, jj, ii) {
	var nx = M.nx, q2, p;
	ii -= Math.floor(ii / nx) * nx;
	q2 = jj * nx + ii;
	if (counts[q2] < 2) return 0;
	p = order[slot[q2] - 1];
	slot[q2]--; counts[q2]--; counts[j * nx + i] = 1;
	S.x[p] = i * M.dx;
	S.e[p] = j * M.dEta;
	S.y[p] = M.yN[j];
	return 1;
}

function nodeOf(M, S, p) {
	var j = Math.round(S.e[p] / M.dEta);
	if (j < 1) j = 1; else if (j > M.ny - 1) j = M.ny - 1;
	var i = Math.round(S.x[p] / M.dx);
	i -= Math.floor(i / M.nx) * M.nx;
	return j * M.nx + i;
}

if (typeof module !== 'undefined' && module.exports) module.exports = G; else window.PTG = G;
