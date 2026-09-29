// pt-metric.js — 0.3.0 P0: the fluid skeleton on the engine's own mesh.
//
// pt-bench.js verified the solver (an FFT in x, a tridiagonal in eta, a dense reference).
// What it did not verify is the operator PAIR the engine has to use with it: on a stretched
// mesh, the projection only cancels the divergence exactly if the gradient and the divergence
// are built from the same face coefficients as the Laplacian:
//
//     G p at the x face:       Gx = (p[i+1] - p[i]) / dx
//     G p at the eta face:     Ge = (p[j+1] - p[j]) / (dEta * Jf)
//     D (u,v) at the cell:     D  = Jc * (u[i+1/2] - u[i-1/2]) / dx
//                                  + (v[j+1/2] - v[j-1/2]) / dEta
//
// which is exactly the finite-volume form of the solver's row:
//     L p = Jc * (p[i+1] - 2 p[i] + p[i-1]) / dx^2
//           + [ (p[j+1]-p[j]) / Jf[j+1] - (p[j]-p[j-1]) / Jf[j] ] / dEta^2
// so that D(G p) == L p identically and the projection D(U* - G p) = 0 is exact rather than
// approximate. This script checks the identity, then the projection, then that the resulting
// flow does the physics a mantle must do, then times it.
//
// Run: node experiments/pt-metric.js
'use strict';

var B = require('./pt-bench.js');
var slabMesh = B.slabMesh, makeSolver = B.makeSolver;

var WRAP = 8000e3, ZLIN = 40e3, DEPTH = 2900e3, SKY = 20e3;

function field(m) { return new Float64Array(m.nx * m.ny); }
function ux(m) { return new Float64Array(m.nx * m.ny); }   // x-face fluxes, index i+1/2
function ve(m) { return new Float64Array(m.nx * m.ny); }   // eta-face fluxes, index j+1/2

// D(G p) = L p, with the same coefficients the solver uses
function gradApply(m, p, gu, gv) {
	var i, j, b;
	for (j = 0; j < m.ny; j++) {
		b = j * m.nx;
		for (i = 0; i < m.nx; i++) gu[b + i] = (p[b + (i + 1) % m.nx] - p[b + i]) / m.dx;
	}
	for (j = 0; j < m.ny; j++) {
		b = j * m.nx;
		if (j < m.ny - 1) for (i = 0; i < m.nx; i++) gv[b + i] = (p[b + m.nx + i] - p[b + i]) / (m.dEta * m.jF[j + 1]);
		else for (i = 0; i < m.nx; i++) gv[b + i] = 0;
	}
}

function divApply(m, u, v, d) {
	var i, j, b, im;
	for (j = 0; j < m.ny; j++) {
		b = j * m.nx;
		for (i = 0; i < m.nx; i++) {
			im = (i + m.nx - 1) % m.nx;
			d[b + i] = m.jC[j] * (u[b + i] - u[b + im]) / m.dx;
			// the face below the bottom cell is the impermeable boundary: its flux is zero,
			// it is not a missing term
			d[b + i] += (v[b + i] - (j > 0 ? v[b - m.nx + i] : 0)) / m.dEta;
		}
	}
}

// one Stokes projection: U* in (u, v), returns p and subtracts G p from U
function project(m, s, u, v, p) {
	var d = m.scratchD || (m.scratchD = field(m));
	divApply(m, u, v, d);
	s.solve(d, p);
	var gu = m.scratchU || (m.scratchU = ux(m));
	var gv = m.scratchV || (m.scratchV = ve(m));
	gradApply(m, p, gu, gv);
	var i, n = m.nx * m.ny;
	for (i = 0; i < n; i++) { u[i] -= gu[i]; v[i] -= gv[i]; }
}

// physical buoyancy: hot rock rises. In (x, eta), up is -eta; the force reaches the face as
// the mean of the two cells it separates, and the outer face is the boundary (zero flux).
function buoyancy(m, T, u, v, amp) {
	var i, j, b;
	for (i = 0; i < m.nx * m.ny; i++) u[i] = 0;
	for (j = 0; j < m.ny; j++) {
		b = j * m.nx;
		for (i = 0; i < m.nx; i++) {
			v[b + i] = (j < m.ny - 1) ? -amp * 0.5 * (T[b + i] + T[b + m.nx + i]) : 0;
		}
	}
}

var chk = { fails: 0, total: 0 };
function ok(name, cond, info) {
	chk.total++;
	if (!cond) chk.fails++;
	console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
}

console.log('\n0.3.0 P0 — the fluid skeleton on the stretched mesh (asinh eta, 8-40 km cells)\n');

var nx = 128, ny = 96;
var m = slabMesh(nx, ny, WRAP, ZLIN, DEPTH, SKY);
var s = makeSolver(m);
console.log('  mesh: ' + nx + ' x ' + ny + ', ' + (WRAP / 1e3).toFixed(0) + ' km wide, ' + (DEPTH / 1e3).toFixed(0)
	+ ' km deep plus ' + (SKY / 1e3).toFixed(0) + ' km of sky; the top row is '
	+ (ZLIN * (Math.sinh(m.eta0 + m.dEta) - Math.sinh(m.eta0)) / 1e3).toFixed(2) + ' km thick, the bottom row '
	+ (ZLIN * (Math.sinh(m.etaBot) - Math.sinh(m.etaBot - m.dEta)) / 1e3).toFixed(0) + ' km\n');

// 1. the identity the projection rests on: D(G p) equals the solver's operator
var p = field(m), g1 = field(m), g2 = field(m), lap = field(m), d1 = field(m);
var i, j, seed = 7;
for (i = 0; i < p.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; p[i] = (seed % 2000) / 1000 - 1; }
// D(G p) through the pair ...
gradApply(m, p, g1, g2);
divApply(m, g1, g2, d1);
// ... and L p the way pt-bench's projection check writes it
var e2 = m.dEta * m.dEta, err = 0, sc = 0;
for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
	var im = (i + nx - 1) % nx, ip = (i + 1) % nx;
	var t = m.jC[j] * (p[j * nx + ip] - 2 * p[j * nx + i] + p[j * nx + im]) / (m.dx * m.dx);
	var dn = (j > 0) ? (p[j * nx + i] - p[(j - 1) * nx + i]) / m.jF[j] : 0;
	var up = (j < ny - 1) ? (p[(j + 1) * nx + i] - p[j * nx + i]) / m.jF[j + 1] : 0;
	t += (up - dn) / e2;
	lap[j * nx + i] = t;
	err = Math.max(err, Math.abs(t - d1[j * nx + i]));
	sc = Math.max(sc, Math.abs(t));
}
ok('the gradient/divergence pair composes into the solver operator (D G = L)', err / sc < 1e-12,
	'rel ' + (err / sc).toExponential(2));

// 2. the projection removes the divergence the buoyancy source puts in. A body force that
//    acts on the eta faces with zero boundary flux is compatible with the all-Neumann solve,
//    which is why the engine's predictor can use it directly.
var u = ux(m), v = ve(m), pw = field(m), dd = field(m), dd2 = field(m);
var Tv = field(m);
for (i = 0; i < Tv.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; Tv[i] = (seed % 2000) / 1000 - 1; }
for (j = 0; j < ny; j++) { var col = 0; for (i = 0; i < nx; i++) col += Tv[j * nx + i]; col /= nx; for (i = 0; i < nx; i++) Tv[j * nx + i] -= col; }
buoyancy(m, Tv, u, v, 1e6);
divApply(m, u, v, dd);
var scale = 0;
for (i = 0; i < dd.length; i++) scale = Math.max(scale, Math.abs(dd[i]));
project(m, s, u, v, pw);
divApply(m, u, v, dd2);
var maxd = 0;
for (i = 0; i < dd2.length; i++) maxd = Math.max(maxd, Math.abs(dd2[i]));
ok('the projected velocity is divergence free (buoyancy-driven, all-Neumann)',
	maxd / scale < 1e-13, 'residual ' + (maxd / scale).toExponential(2) + ' of the source');

// 3. the physics: a conduction profile is still, a hot blob rises, a cold blob sinks
function Tref(j) { return 1 - (j + 0.5) / ny; }
function run(T, amp) {
	var u2 = ux(m), v2 = ve(m), p2 = field(m), i2, j2;
	buoyancy(m, T, u2, v2, amp);
	project(m, s, u2, v2, p2);
	return { u: u2, v: v2 };
}
var Tc = field(m);
for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) Tc[j * nx + i] = Tref(j);
var rc = run(Tc, 1e6);
var qc = 0;
for (i = 0; i < rc.v.length; i++) qc = Math.max(qc, Math.abs(rc.v[i]));
ok('a conduction profile has no flow', qc / 1e6 < 1e-9, 'max|v| = ' + (qc / 1e6).toExponential(2) + ' x amp');

var Thot = new Float64Array(Tc);
for (i = 0; i < nx; i++) for (j = 8; j < 28; j++) {
	var dxc = (i - nx / 2) / (nx / 10);
	Thot[j * nx + i] += 0.2 * Math.exp(-dxc * dxc);
}
var rh = run(Thot, 1e6);
// a hot parcel at depth rises: the eta-face flux through its own level points up (-eta)
var lift = rh.v[18 * nx + (nx >> 1)] / 1e6;
ok('a hot blob drives an upwelling through its own level', lift < 0, 'v(eta) at the blob = ' + lift.toExponential(2));

var Tcold = new Float64Array(Tc);
for (i = 0; i < nx; i++) for (j = 8; j < 28; j++) {
	var dxc = (i - nx / 2) / (nx / 10);
	Tcold[j * nx + i] -= 0.2 * Math.exp(-dxc * dxc);
}
var rcl = run(Tcold, 1e6);
// and the compensating flow must be a closed cell: the flux below the blob is the other way
var comp = rcl.v[18 * nx + (nx >> 1)] / 1e6;
ok('a cold blob drives a downwelling through its own level', comp > 0, 'v(eta) at the cold blob = ' + comp.toExponential(2));

// 4. timing
function timeIt(f, reps) {
	var t0 = Date.now(), n;
	for (n = 0; n < reps; n++) f();
	return (Date.now() - t0) / reps;
}
var Treps = new Float64Array(Tc);
for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) Treps[j * nx + i] = Tref(j) + 0.1 * Math.sin(6 * Math.PI * i / nx) * Math.sin(Math.PI * (j + 0.5) / ny);
function stepCost(nx2, ny2, reps) {
	var m2 = slabMesh(nx2, ny2, WRAP, ZLIN, DEPTH, SKY);
	var s2 = makeSolver(m2);
	var T2 = field(m2), u2 = ux(m2), v2 = ve(m2), p2 = field(m2), i2, j2;
	for (j2 = 0; j2 < ny2; j2++) for (i2 = 0; i2 < nx2; i2++) {
		T2[j2 * nx2 + i2] = 1 - (j2 + 0.5) / ny2 + 0.1 * Math.sin(6 * Math.PI * i2 / nx2) * Math.sin(Math.PI * (j2 + 0.5) / ny2);
	}
	return timeIt(function () { buoyancy(m2, T2, u2, v2, 1e6); project(m2, s2, u2, v2, p2); }, reps);
}
stepCost(nx, ny, 20);                       // let the JIT warm the pass before timing it
var tFull = stepCost(nx, ny, 10), tFull2 = stepCost(256, 96, 6);
console.log('\n  buoyancy + projection step: ' + nx + 'x' + ny + '  ' + tFull.toFixed(3) + ' ms   |   256x96  ' + tFull2.toFixed(3) + ' ms');

console.log('\n' + (chk.fails === 0 ? 'ALL PASS' : chk.fails + ' FAILURES') + ' (' + chk.total + ' checks)');
process.exitCode = chk.fails === 0 ? 0 : 1;
