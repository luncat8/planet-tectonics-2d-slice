// pt-drift.js — 0.3.0 P2.2: why do the plates not drift?
//
// P2.1's kinematics is "a cluster rides the flow as one rigid body", fitted to the
// mass-weighted mean of the flow *its own markers* were given. On a symmetric convection
// cell that mean is the surface convergence pattern: the top of the box flows outward from
// the upwelling and back in toward the downwelling, so a plate spanning a cell averages to
// nearly nothing and sits still (measured drift 0.3-1 cm/yr where the picture wants 3-10).
// Before changing the law, this fixture measures, per plate on the shipped run, the two
// candidates the worklog's next step names:
//
//   vPlate  the fitted velocity that actually moves the plate (the current law)
//   vOwn    the mass-weighted mean of the flow at the plate's own markers (what it fits)
//   vBase   the same, one node row below the plate's own base in each column it occupies
//   v150    the flow at 150 km depth under the plate's own x footprint (mass-weighted, same
//   v300    columns, 300 km) -- the asthenosphere the plate would be dragged by
//
// If a deeper sample is much larger than vPlate, the missing drift is the drag of the flow
// under the lid and the fit is averaging the wrong velocity field; if they are all small,
// the flow under the plate is itself convergent and the missing motion is force (slab pull),
// not sampling. This is a report: it calibrates whatever §4.2's kinematics upgrade becomes.
//
// Run: node experiments/pt-drift.js [spinMyr=400]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), G = require(B + 'grid.js');

var spin = +(process.argv[2] || 400);
var MIN_PLATE = 64;                  // the HUD's own threshold for calling a cluster a plate

// the shipped draw, pinned
P.ic = 'cool'; P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1;
P.solid = true; P.sl.kyr = 50;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M;

// scratch, allocated once (the fixture may, the engine may not)
var CAP = S.x.length;
var eSave = new Float64Array(CAP), ySave = new Float64Array(CAP);
var base = new Float64Array(M.n);
var mass = new Float64Array(CAP), gx = new Float64Array(CAP), gy = new Float64Array(CAP);
var gs = new Float64Array(CAP);
var cnt = new Int32Array(CAP), yLo = new Float64Array(CAP), yHi = new Float64Array(CAP);
var rows = [];

// one cluster's mass, member count, depth span and mass-weighted mean velocity, from
// whatever vx/vy currently hold
function moments() {
	var c, p, n = S.n;
	mass.fill(0); gx.fill(0); gy.fill(0); gs.fill(0); cnt.fill(0);
	for (p = 0; p < n; p++) {
		c = S.cl[p];
		if (c < 0) continue;
		if (!cnt[c]) { yLo[c] = S.y[p]; yHi[c] = S.y[p]; }
		mass[c] += S.m[p]; cnt[c]++;
		gx[c] += S.m[p] * S.vx[p]; gy[c] += S.m[p] * S.vy[p];
		gs[c] += S.m[p] * Math.hypot(S.vx[p], S.vy[p]);
		if (S.y[p] < yLo[c]) yLo[c] = S.y[p];
		if (S.y[p] > yHi[c]) yHi[c] = S.y[p];
	}
}

// the net (vector) mean, which is what drags a rigid plate, and the mean speed, which is
// what the mantle is doing locally whether or not it adds up
function speed(c) {
	return mass[c] > 0 ? Math.hypot(gx[c], gy[c]) / mass[c] * P.cmYr : 0;
}
function meanSpeed(c) {
	return mass[c] > 0 ? gs[c] / mass[c] * P.cmYr : 0;
}

function nodeOf(p) {
	var j = Math.round(S.e[p] / M.dEta);
	if (j < 1) j = 1; else if (j > M.ny - 1) j = M.ny - 1;
	var i = Math.round(S.x[p] / M.dx) % M.nx;
	return j * M.nx + (i < 0 ? i + M.nx : i);
}

// move every plate member to depth `yk` in its own column, gather, and read the cluster
// means back: the grid's own gather does the interpolation, so the fixture cannot disagree
// with the engine about the stencil (the positions are restored by the caller)
function probeAt(eLevel, out) {
	var c, p, n = S.n;
	for (p = 0; p < n; p++) {
		eSave[p] = S.e[p]; ySave[p] = S.y[p];
		if (S.cl[p] < 0) continue;
		S.e[p] = eLevel; S.y[p] = M.yLin * Math.sinh(eLevel);
	}
	G.gatherVel(M, S, M.pr);
	moments();
	for (c = 0; c < S.csN; c++) out[c] = speed(c);
	for (p = 0; p < n; p++) { S.e[p] = eSave[p]; S.y[p] = ySave[p]; }
}

function analyse(t) {
	var c, n = S.n, span = [], count = [];
	var rigid = [], own = [], under = [], v150 = [], v300 = [], v300s = [];
	// 1. the plate's own motion, straight from the state: after a frame every plate marker
	// carries the velocity the rigid fit gave it. The depth span and member count are read
	// here too, before any probe moves a marker.
	moments();
	for (c = 0; c < S.csN; c++) {
		rigid[c] = speed(c);
		span.push([yLo[c], yHi[c]]);
		count.push(cnt[c]);
	}
	// 2. the flow the plate's markers were given (the engine gathers it every frame in G3,
	// then G4 replaces it): gather it again from the same psi field
	G.gatherVel(M, S, M.pr);
	moments();
	for (c = 0; c < S.csN; c++) own[c] = speed(c);
	// 3. one row below the plate's own base, then two fixed asthenosphere depths under the
	// plate's own x footprint
	base.fill(-1e9);
	for (var p = 0; p < n; p++) {
		if (S.cl[p] < 0) continue;
		var i = nodeOf(p);
		if (S.e[p] > base[i]) base[i] = S.e[p];
	}
	for (p = 0; p < n; p++) {
		eSave[p] = S.e[p]; ySave[p] = S.y[p];
		if (S.cl[p] < 0) continue;
		var e = base[nodeOf(p)] + M.dEta;
		if (e > M.eMax) e = M.eMax;
		S.e[p] = e; S.y[p] = M.yLin * Math.sinh(e);
	}
	G.gatherVel(M, S, M.pr);
	moments();
	for (c = 0; c < S.csN; c++) under[c] = speed(c);
	for (p = 0; p < n; p++) { S.e[p] = eSave[p]; S.y[p] = ySave[p]; }
	probeAt(Math.asinh(150 / M.yLin), v150);
	probeAt(Math.asinh(300 / M.yLin), v300);
	for (c = 0; c < S.csN; c++) v300s[c] = meanSpeed(c);
	// 4. the record: one entry per plate
	for (c = 0; c < S.csN; c++) {
		if (count[c] < MIN_PLATE) continue;
		rows.push({ t: t, c: c, n: count[c], plate: rigid[c], own: own[c], base: under[c],
			v150: v150[c], v300: v300[c], v300s: v300s[c], y0: span[c][0], y1: span[c][1] });
	}
}

console.log('  drift diagnostic: the shipped run, ' + P.mesh.nx + 'x' + P.mesh.ny + ', wrap ' + P.wrap
	+ ' km, ' + P.sl.kyr + ' kyr/f, ' + spin + ' Myr\n');
console.log('   t/Myr  plate  markers   plate depth    |vPlate|   |vOwn|   |vBase|   |v150|   |v300|');

var next = 0, marks = [100, 200, 300, 400];
while (SIM.t < spin && next < marks.length) {
	SIM.step();
	if (SIM.t >= marks[next]) { analyse(SIM.t); next++; }
}

var byT = {};
for (var i = 0; i < rows.length; i++) (byT[rows[i].t] = byT[rows[i].t] || []).push(rows[i]);
var times = Object.keys(byT).sort(function (a, b) { return a - b; });
times.forEach(function (k) {
	byT[k].sort(function (a, b) { return b.n - a.n; }).slice(0, 4).forEach(function (r) {
		console.log(('  ' + r.t.toFixed(0)).padStart(8) + ('  ' + r.c).padStart(7)
			+ ('  ' + r.n).padStart(8)
			+ ('   ' + r.y0.toFixed(0) + '..' + r.y1.toFixed(0) + ' km').padStart(16)
			+ ('   ' + r.plate.toFixed(2)).padStart(11) + ('   ' + r.own.toFixed(2)).padStart(9)
			+ ('   ' + r.base.toFixed(2)).padStart(9) + ('   ' + r.v150.toFixed(2)).padStart(8)
			+ ('   ' + r.v300.toFixed(2)).padStart(8));
	});
});

console.log('\n  every plate at the last sample (>= ' + MIN_PLATE + ' markers):');
(byT[times[times.length - 1]] || []).forEach(function (r) {
	console.log('   plate ' + r.c + ': ' + r.n + ' markers   drift ' + r.plate.toFixed(2)
		+ ' cm/yr   own ' + r.own.toFixed(2) + '   base ' + r.base.toFixed(2)
		+ '   at 150 km ' + r.v150.toFixed(2) + '   at 300 km ' + r.v300.toFixed(2)
		+ ' (mean speed there ' + r.v300s.toFixed(2) + ')');
});

check.section('the diagnostic is sane');
check.ok('plates were found at every sample', times.length >= 3, times.join(', '));
check.ok('every number is finite', rows.every(function (r) {
	return isFinite(r.plate) && isFinite(r.own) && isFinite(r.base) && isFinite(r.v150) && isFinite(r.v300);
}));
var mean = function (f) {
	return rows.reduce(function (s, r) { return s + f(r); }, 0) / rows.length;
};
check.info('mean plate drift over all samples', mean(function (r) { return r.plate; }).toFixed(2) + ' cm/yr');
check.info('mean own-marker flow', mean(function (r) { return r.own; }).toFixed(2) + ' cm/yr');
check.info('mean base flow under the plates', mean(function (r) { return r.base; }).toFixed(2) + ' cm/yr');
check.info('mean flow at 150 km under the plates', mean(function (r) { return r.v150; }).toFixed(2) + ' cm/yr');
check.info('mean flow at 300 km under the plates', mean(function (r) { return r.v300; }).toFixed(2) + ' cm/yr');
check.info('mean speed (not net) at 300 km', mean(function (r) { return r.v300s; }).toFixed(2) + ' cm/yr');
check.info('ratio net-300km/plate', (mean(function (r) { return r.v300; }) / mean(function (r) { return r.plate; })).toFixed(2) + 'x');
check.done();
