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
// P2.2 adds a second calibration to the same pass. The *number of partners* a lid marker
// has varies by a factor of several across the box (crowded regions of the Lagrangian
// sample), and P2.1's law added damage once per pair, so a crowded marker failed about as
// much faster as it had more partners. The shipped law charges the marker's *mean* excess
// instead (solid.js clusters), which needs one new constant: the rescale that keeps the
// aggregate damage rate where P2.1 calibrated it. Both laws' rates are computed from this
// same run -- the per-pair integral, and its mean -- so the table below is a statement
// about the sample, not about which law is installed; the rank correlations with the pair
// count are the gate that the mean law is the density-free one.
//
// Run: node experiments/pt-load-check.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), G = require(B + 'grid.js');

var kDamagePerPair = 3;              // the archived P2.1 constant: damage per pair per unit
                                     // excess. P2.2's kDamage must be this times the measured
                                     // rescale, and the gate below holds params.js to it.
var kDamageShipped = P.kDamage;      // read before the switch below zeroes it
P.kDamage = 0;                       // measure the loads of a lid that cannot fail
SIM.init();
SIM.reset();
SIM.dt = P.sl.kyr / 1000;

var samples = [1000, 2000, 4000];    // 50, 100, 200 Myr at the default clock
var stats = [], density = [];

function sample() {
	var M = SIM.M, loads = [], p, r, dx, de, dy, d2, n;
	var sum = new Float64Array(S.n), cnt = new Int32Array(S.n);
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
			// the damage side of the same pair: how many partners this marker has, and the
			// excess it carries (pair()'s own quantity, before the yield)
			cnt[p]++; cnt[r]++;
			sum[p] += loads[loads.length - 1]; sum[r] += loads[loads.length - 1];
		}
	}
	loads.sort(function (a, b) { return a - b; });
	var q = function (f) { return loads[Math.floor(f * (loads.length - 1))]; };
	stats.push({ t: SIM.t, p50: q(0.5), p80: q(0.8), p90: q(0.9), p99: q(0.99), max: loads[loads.length - 1] });
	// the density table: per marker, the *pair count* and the two laws' damage rates -- the
	// per-pair integral sum (what the engine accumulated before P2.2) and its mean sum/cnt
	// (what it accumulates now). Both are quoted without the yield subtraction, so the table
	// is about the load, not about one calibration; the production numbers are below.
	var rateA = [], rateB = [], count = [];
	for (p = 0; p < S.n; p++) {
		if (!cnt[p]) continue;
		rateA.push(sum[p]); rateB.push(sum[p] / cnt[p]); count.push(cnt[p]);
	}
	n = count.length;
	density.push({
		t: SIM.t, n: n, cnt10: quant(count, 0.1), cnt50: quant(count, 0.5), cnt90: quant(count, 0.9),
		rateA50: quant(rateA, 0.5), rateA90: quant(rateA, 0.9),
		rateB50: quant(rateB, 0.5), rateB90: quant(rateB, 0.9),
		corrA: spearman(count, rateA), corrB: spearman(count, rateB),
		scale: mean(rateA) / mean(rateB)
	});
}

function quant(a, f) {
	var c = a.slice().sort(function (x, y) { return x - y; });
	return c[Math.floor(f * (c.length - 1))];
}

function mean(a) {
	var s = 0, i;
	for (i = 0; i < a.length; i++) s += a[i];
	return s / a.length;
}

// rank correlation: the rates are heavy-tailed and the partner counts are small integers, so
// a Pearson on the raw values would measure the tail, not the trend
function spearman(a, b) {
	var ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb), num = 0, da = 0, db = 0, i, d;
	for (i = 0; i < ra.length; i++) {
		d = ra[i] - ma; num += d * (rb[i] - mb);
		da += d * d; db += (rb[i] - mb) * (rb[i] - mb);
	}
	return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

function rank(a) {
	var idx = [], out = new Array(a.length), i;
	for (i = 0; i < a.length; i++) idx.push(i);
	idx.sort(function (x, y) { return a[x] - a[y]; });
	for (i = 0; i < idx.length; i++) out[idx[i]] = i;
	return out;
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

console.log('\n  the density of the sample, and what the two damage laws make of it:');
console.log('   t/Myr  markers  partners p10/p50/p90   per-pair p50/p90   mean p50/p90   corr(rate,n) pair/mean   rescale');
for (s = 0; s < density.length; s++) {
	var d = density[s];
	console.log(('  ' + d.t.toFixed(0)).padStart(8) + ('  ' + d.n).padStart(9)
		+ ('   ' + d.cnt10 + '/' + d.cnt50 + '/' + d.cnt90).padStart(20)
		+ ('   ' + d.rateA50.toFixed(4) + '/' + d.rateA90.toFixed(4)).padStart(18)
		+ ('   ' + d.rateB50.toFixed(4) + '/' + d.rateB90.toFixed(4)).padStart(18)
		+ ('   ' + d.corrA.toFixed(2) + '/' + d.corrB.toFixed(2)).padStart(14)
		+ ('   ' + d.scale.toFixed(1) + 'x').padStart(9));
}

check.section('the damage rate is a property of the rock, not of the sample');
// the band spans the three samples: the rescale is not one number because the load
// distribution's tail crowds as the lid ages, so the fixture holds the shipped constant
// inside the measured band and lets the emergence gate (pt-crust, which fails seams at a
// calibrated cadence) pick the place inside it
function scaleLo() {
	var m = density[0].scale, i;
	for (i = 1; i < density.length; i++) m = Math.min(m, density[i].scale);
	return m;
}
function scaleHi() {
	var m = density[0].scale, i;
	for (i = 1; i < density.length; i++) m = Math.max(m, density[i].scale);
	return m;
}
check.ok('partners per marker vary by more than 2x across the lid (p10 to p90)',
	density[density.length - 1].cnt90 > 2 * density[density.length - 1].cnt10,
	'partners ' + density.map(function (d) { return d.cnt10 + '/' + d.cnt50 + '/' + d.cnt90; }).join('  '));
check.ok('a per-pair law tracks that count (the rate is density-dependent)',
	density[density.length - 1].corrA > 0.5,
	'corr ' + density.map(function (d) { return d.corrA.toFixed(2); }).join('/'));
check.ok('the shipped mean law does not (the rate is density-free)',
	density[density.length - 1].corrB < 0.2,
	'corr ' + density.map(function (d) { return d.corrB.toFixed(2); }).join('/'));
check.ok('params.js kDamage sits inside the measured rescale band',
	kDamageShipped >= kDamagePerPair * scaleLo() && kDamageShipped <= kDamagePerPair * scaleHi(),
	kDamageShipped + ' in [' + (kDamagePerPair * scaleLo()).toFixed(0) + ', ' +
	(kDamagePerPair * scaleHi()).toFixed(0) + ']');

check.done();
