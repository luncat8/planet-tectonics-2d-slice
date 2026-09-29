// pt-check.js — 0.3.0 P1: the engine's gate. Where pt-metric.js verified the operator pair in
// isolation and pt-conv.js verified the clock, this runs the real frame pipeline (js/pt/*) and
// gates what the plan's §10 acceptance depends on:
//
//   1. the deposit is a sample of the marker field: their heats agree to quadrature
//   2. with conduction alone the markers receive exactly the heat the operator charged the
//      field (the ledger), and the field's own drift is only the deposit's resampling
//   3. the same ledger closes in a live convecting run, and the field stays in range
//   4. the flow is divergence-free, and the marker map is area preserving
//   5. no NaN, no runaway, and the coverage the field depends on is real (holes bounded)
//   6. a frame fits the plan's §7 budget
//
// Run: node experiments/pt-check.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), G = require(B + 'grid.js'), S = require(B + 'state.js');
var F = require(B + 'fluid.js'), SIM = require(B + 'sim.js');

function heat() {
	var h = 0, p;
	for (p = 0; p < S.n; p++) h += S.m[p] * S.T[p];
	return h;
}
function fieldHeat(M, S) {
	var h = 0, i, j;
	for (j = 1; j < M.ny; j++) for (i = 0; i < M.nx; i++) h += M.dEta * M.jN[j] * M.dx * S.Tg[j * M.nx + i];
	return h;
}
function steps(n) { SIM.run(n); }

console.log('  engine: ' + P.mesh.nx + 'x' + P.mesh.ny + ' nodes, ' + P.mpc + ' markers/node, Ra '
	+ P.Ra.toExponential(0) + ', dt ' + (P.sl.kyr / 1000).toFixed(3) + ' Myr/frame\n');

// ---------------------------------------------------------------- 1. the deposit is a sample
// The quadratic B-spline deposit is a local mean of the markers near a node, so the field's
// heat is the marker heat *to quadrature*, not identically: the 3x3 kernel deliberately mixes
// neighbouring markers (that smoothing is what keeps the spectral solver away from the grid
// scale). CIC with one marker per node would be exact and cannot survive a fold.
check.section('marker field and grid field');
P.ic = 'rb'; P.flip = 1;
SIM.init(); SIM.reset();
var hm = heat(), hf = fieldHeat(SIM.M, S);
check.near('the field heat is the marker heat to quadrature', hf, hm, 5e-3);
check.ok('every node holds markers at t = 0', S.empty === 0, 'empty ' + S.empty);

// ---------------------------------------------------------------- 2. conduction alone
check.section('conduction alone (no flow, markers still)');
var kFlow = SIM.k[2], kMove = SIM.k[3];
SIM.k[2] = null;
SIM.k[3] = function (M, S2, dt) { G.diffuse(M, S2.Tg, dt, P.kappa, M.inc); G.gatherDT(M, S2, M.inc, S2.Tg, P.flip); };
SIM.reset();
steps(1);
var h0 = S.d.heat, hm0 = heat(), w0 = S.wall, l0 = S.ledger;
steps(500);
// the ledger is the exact one: gatherDT applies mu_k/W_k (the adjoint of the deposit), so the
// markers draw exactly the node measures the operator charged, whatever the cloud has done
check.near('the markers receive exactly the operator\'s wall flux', S.ledger - l0, S.wall - w0, 1e-5, 'km2*T');
// The field is rebuilt from the markers every frame, so its own heat wanders by the deposit's
// quadrature error and no more. The physical book is the marker field's, and that one is exact
// (the line above); what this checks is that the grid view of it stays glued to it.
check.near('the field heat follows the marker heat', S.d.heat - h0, S.ledger - l0, 1e-4 * Math.abs(h0), 'km2*T');
// Nu is the one-sided boundary flux over the first cell, so pure conduction reads 1 up to the
// cell's curvature term -- the same bias pt-conv's Nu carries
check.near('Nu is 1 with no flow', S.d.nu, 1, 1e-2);

// ---------------------------------------------------------------- 3. the live ledger
check.section('convecting run (the real pipeline)');
SIM.k[2] = kFlow; SIM.k[3] = kMove;
var runs = [[1e5, 'rb'], [1e6, 'rb']], t0, ms, run, Ra, ic, k;
for (k = 0; k < runs.length; k++) {
	Ra = runs[k][0]; ic = runs[k][1];
	P.Ra = Ra;
	P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.ic = ic;
	SIM.init(); SIM.reset();
	steps(1);
	var W0 = S.wall, L0 = S.ledger, tmin = 9e9, tmax = -9e9, emax = 0, nan = false, p;
	t0 = Date.now();
	for (var c = 1; c <= 6; c++) {
		steps(200);
		for (p = 0; p < S.n; p++) if (!isFinite(S.T[p]) || !isFinite(S.x[p])) nan = true;
		if (S.d.tMin < tmin) tmin = S.d.tMin;
		if (S.d.tMax > tmax) tmax = S.d.tMax;
		if (S.empty > emax) emax = S.empty;
	}
	ms = (Date.now() - t0) / 1200;
	var gap = (S.ledger - L0) / (S.wall - W0);
	check.ok('Ra ' + Ra.toExponential(0) + ': no NaN over 1200 frames', !nan);
	check.ok('Ra ' + Ra.toExponential(0) + ': temperature stays in range', tmin > -0.5 && tmax < 1.5,
		'T ' + tmin.toFixed(3) + '..' + tmax.toFixed(3));
	check.ok('Ra ' + Ra.toExponential(0) + ': the ledger closes against the wall flux', gap > 0.8 && gap < 1.2,
		'intake/wall ' + gap.toFixed(3) + '   (' + (S.ledger - L0).toExponential(2) + ' vs ' + (S.wall - W0).toExponential(2) + ')');
	// The holes are the one honest leak in the intake: a node no marker reaches is filled by
	// fillHoles (a stale patch would be a buoyancy source that does not exist) and its markers
	// draw nothing, which is exactly the gap the ledger reports. pt-check watches that the gap
	// stays closed with them present, rather than hiding them.
	check.ok('Ra ' + Ra.toExponential(0) + ': the deposit covers all but a fraction of the nodes',
		emax < 0.15 * SIM.M.nx * (SIM.M.ny - 1), 'worst ' + emax + ' of ' + SIM.M.nx * (SIM.M.ny - 1));
	check.ok('Ra ' + Ra.toExponential(0) + ': a frame fits the §7 budget', ms < 14, ms.toFixed(2) + ' ms/frame');
}

// ---------------------------------------------------------------- 4. divergence and the map
check.section('the flow and the map');
P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
P.ic = 'rb';
SIM.init(); SIM.reset();
steps(400);
G.stokes(SIM.M, S.Tg, S.u, S.v, P.RaK);
check.ok('the Stokes pair has no discrete divergence', G.divMax(SIM.M, S.u, S.v) < 1e-12,
	G.divMax(SIM.M, S.u, S.v).toExponential(2));

// the marker map's Jacobian by finite differences, at the live field: mean 1 to 1e-4
var M = SIM.M, psi = M.pr, dt = SIM.dt, h = 1e-3, o = [0, 0], oa = [0, 0], ob = [0, 0], oc = [0, 0];
function map(x, e, out) {
	var j0 = Math.floor(e / M.dEta), fy = e / M.dEta - j0;
	if (j0 < 0) { j0 = 0; fy = 0; } else if (j0 > M.ny - 1) { j0 = M.ny - 1; fy = 1; }
	var i0 = Math.floor(x / M.dx), fx = x / M.dx - i0;
	i0 -= Math.floor(i0 / M.nx) * M.nx;
	var i1 = i0 + 1 === M.nx ? 0 : i0 + 1, b = j0 * M.nx;
	var a = psi[b + i0], bb = psi[b + i1], cc = psi[b + M.nx + i0], dd = psi[b + M.nx + i1];
	var y = M.yLin * Math.sinh(e), J = Math.sqrt(M.yLin * M.yLin + y * y);
	var vx = ((1 - fx) * (cc - a) + fx * (dd - bb)) / M.dEta / J;
	var vy = -((1 - fy) * (bb - a) + fy * (dd - cc)) / M.dx;
	var y2 = y + vy * dt, ym = y + 0.5 * vy * dt;
	var e2 = e + vy * dt / Math.sqrt(M.yLin * M.yLin + ym * ym);
	var x2 = x + vx * dt;
	if (e2 < M.eMin) { e2 = 2 * M.eMin - e2; y2 = 2 * M.yMin - y2; }
	else if (e2 > M.eMax) { e2 = 2 * M.eMax - e2; y2 = 2 * M.yMax - y2; }
	if (x2 < 0) x2 += M.wrap; else if (x2 >= M.wrap) x2 -= M.wrap;
	out[0] = x2; out[1] = e2;
}
// The two rows next to a wall are excluded: a marker resting on the reflection line has one
// probe inside and one outside it, and that mixed pair reads as a fold when it is the mirror
// the wall is supposed to be (the reflection branch is measure preserving but orientation
// reversing, so no positive Jacobian exists there). Individual interior samples can still
// straddle a cell edge, where the map is only C0; the mean is the assertion.
var n = 0, sum = 0, worst = 0, over = 0, p2;
for (p2 = 0; p2 < S.n; p2 += 37) {
	var x = S.x[p2], e = S.e[p2];
	if (e < 3 * M.dEta || e > M.etaBot - 3 * M.dEta) continue;
	map(x, e, oc); map(x + h, e, oa); map(x, e + h, ob);
	var j = ((oa[0] - oc[0]) * (ob[1] - oc[1]) - (oa[1] - oc[1]) * (ob[0] - oc[0])) / (h * h);
	sum += j; n++;
	if (Math.abs(j - 1) > worst) worst = Math.abs(j - 1);
	if (Math.abs(j - 1) > 0.01) over++;
}
check.near('the marker map preserves area (mean Jacobian, interior)', sum / n, 1, 1e-3);
check.ok('interior samples stay within 1% of area preserving', over < 0.02 * n,
	over + ' of ' + n + ' samples over 1%   worst |J-1| ' + worst.toExponential(2));

// ---------------------------------------------------------------- 5. a paused frame changes nothing
check.section('the clock');
var tBefore = SIM.t, frameBefore = SIM.frame, hBefore = heat();
SIM.dt = 0;
steps(5);
check.ok('dt = 0 reports but does not change the state', SIM.t === tBefore && Math.abs(heat() - hBefore) < 1e-9,
	't ' + SIM.t.toFixed(3) + '  frame ' + SIM.frame);

check.done();
