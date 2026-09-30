// pt-load-check.js — 0.3.0 P2.1: the calibration behind `yieldRate`. The crust law's
// failure term needs a yield strain rate that keeps a plate body elastic while the
// hard-worked tail of the load distribution opens into seams. That is a statement about
// the engine's own loads, so it is measured here, not guessed:
//
//   * an intact lid (damage disabled) is run to steady convection;
//   * every pair of strong candidates within contact range reads the flow's strain rate
//     across it -- exactly the quantity solid.js pair() loads;
//   * the distribution is printed at three ages of the lid.
//
// The gates pin the calibrated regime: the body of the lid (p80) stays below yield at
// every age, so plates hold, and the tail (p99) reaches above it once the lid is worked,
// so seams open and there is such a thing as a plate boundary. If either fails, the
// number in params.js is wrong for this mesh.
//
// Run: node experiments/pt-load-check.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), G = require(B + 'grid.js');

P.kDamage = 0;                       // measure the loads of a lid that cannot fail
SIM.init();
SIM.reset();
SIM.dt = P.sl.kyr / 1000;

var samples = [1000, 2000, 4000];    // 50, 100, 200 Myr at the default clock
var stats = [];

function sample() {
	var M = SIM.M, loads = [], p, r, dx, de, dy, d2;
	G.gatherVel(M, S, M.pr);        // the flow velocities the damage term reads
	for (p = 0; p < S.n; p++) {
		if (S.y[p] > 150) continue;
		for (r = p + 1; r < S.n; r++) {
			if (S.y[r] > 150) continue;
			dx = S.x[r] - S.x[p];
			dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
			if (dx < 0 ? -dx > 1.3 * M.dx : dx > 1.3 * M.dx) continue;
			de = S.e[r] - S.e[p];
			if (de < 0 ? -de > 1.3 * M.dEta : de > 1.3 * M.dEta) continue;
			dy = S.y[r] - S.y[p];
			d2 = dx * dx + dy * dy;
			if (d2 < 1e-6) continue;
			loads.push(Math.abs((S.vx[r] - S.vx[p]) * dx + (S.vy[r] - S.vy[p]) * dy) / d2);
		}
	}
	loads.sort(function (a, b) { return a - b; });
	var q = function (f) { return loads[Math.floor(f * (loads.length - 1))]; };
	stats.push({ t: SIM.t, p50: q(0.5), p80: q(0.8), p90: q(0.9), p99: q(0.99), max: loads[loads.length - 1] });
}

console.log('  load calibration: flow strain rate across lid pairs, mesh ' + P.mesh.nx + 'x' + P.mesh.ny
	+ ', wrap ' + P.wrap + ' km\n');

var i = 0, s = 0;
while (s < samples.length) {
	SIM.step();
	i++;
	if (i === samples[s]) { sample(); s++; }
}

console.log('   t/Myr      p50      p80      p90      p99      max    yield ' + P.yieldRate.toFixed(3));
for (s = 0; s < stats.length; s++) {
	var st = stats[s];
	console.log(('  ' + st.t.toFixed(0)).padStart(8) + ('  ' + st.p50.toFixed(4)).padStart(9)
		+ ('  ' + st.p80.toFixed(4)).padStart(9) + ('  ' + st.p90.toFixed(4)).padStart(9)
		+ ('  ' + st.p99.toFixed(4)).padStart(9) + ('  ' + st.max.toFixed(3)).padStart(9));
}

check.section('the calibrated regime');
for (s = 0; s < stats.length; s++) {
	var st = stats[s];
	check.ok('t ' + st.t.toFixed(0) + ' Myr: the body of the lid stays below yield', st.p80 < P.yieldRate,
		'p80 ' + st.p80.toFixed(4) + ' < ' + P.yieldRate);
}
var late = stats[stats.length - 1];
check.ok('the worked tail reaches above yield (so seams can open)', late.p99 > P.yieldRate,
	'p99 ' + late.p99.toFixed(4) + ' > ' + P.yieldRate);
check.ok('the load scale is the one solid.js fails at', P.yieldRate > late.p50 && P.yieldRate < late.max,
	'p50 ' + late.p50.toFixed(4) + ' .. max ' + late.max.toFixed(2));

check.done();
