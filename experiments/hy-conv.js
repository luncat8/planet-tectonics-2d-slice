// hy-conv.js — 0.5.0 M2's convection owner (0.5.0-plan.md §9 M2, §10): HY's liquid
// convects in S1's bands, its two books close over the same 300 Myr leg, a replay is
// bitwise, and the sharpness option's clamp is a booked ledger line rather than a sink.
//
// The velocity anchor worth restating because this harness is where it was measured:
// the shipped 0.3 planet on the same IC (cool, icBand 0.6, seed 1, 50 kyr/frame) reads
// a median peak|v| of 33 km/Myr over 100-300 Myr, and pt-conv's steady Ra 1e6 reference
// converts to 67 km/Myr at 2900 km depth. HY reading between those two numbers with
// 0.3's own Ra and kappa is the claim; the S1 band it is gated against (3-20 cm/yr)
// was amended in M2 to contain the 0.3 line's own measurements instead of its
// 1000 km-deep fixture's calibration column.
//
// Run: node experiments/hy-conv.js
'use strict';

var HY = require('../js/hy/hy.js');
var PCSCEN = require('../js/pc/scenario.js');
var PCP = require('../js/pc/params.js');
var check = require('./lib.js').check;

function fingerprint() {
	var M = HY.M, h = 2166136261, i, x;
	function mix(v) {
		x = (v * 1e9) | 0;
		h = Math.imul(h ^ x, 16777619);
	}
	for (i = 0; i < M.n; i++) { mix(M.H[i]); mix(M.u[i]); }
	for (i = 0; i < M.v.length; i++) mix(M.v[i]);
	return (h >>> 0).toString(16);
}

function bounded() {
	var d = HY.M.d;
	return isFinite(d.tMin) && isFinite(d.tMax) && d.tMin > -0.05 && d.tMax < 1.05;
}

HY.init();

check.section('A. S1 convection through the scenario interface, 300 Myr at the default rung');
var r = PCSCEN.run(HY, 'S1', { seed: 1 });
r.gates.forEach(function (g) {
	check.ok('S1 ' + g.name, g.status === 'pass', g.detail);
});
check.ok('S1 has no failing or pending gate', r.failed === 0 && r.pending === 0,
	r.passed + ' passed, ' + r.pending + ' pending');
check.ok('the leg ran the full window', r.frames === 6000 && r.samples.length === 41,
	r.frames + ' frames, ' + r.samples.length + ' samples');

check.section('B. the books over that leg');
var stock = HY.read('enthalpy'), stock0 = HY.read('stock0');
var wallNet = HY.read('wallNet'), wallGross = HY.read('wallGross');
var resid = (stock - stock0 - wallNet) / wallGross;
check.ok('heat ledger closes (stock change is the walls)', Math.abs(resid) < 5e-5,
	'residual/gross ' + resid.toExponential(2));
check.ok('cell mass is the exact wrap x depth partition',
	Math.abs(HY.read('mass') - PCP.wrap * PCP.depth) / (PCP.wrap * PCP.depth) < 1e-12,
	HY.read('mass').toExponential(6) + ' km2');
check.ok('temperature stayed in bounds', bounded(),
	HY.M.d.tMin.toFixed(3) + ' .. ' + HY.M.d.tMax.toFixed(3));
check.ok('the projection\'s divergence budget is small at the end of the leg',
	HY.read('div') < 0.05, (100 * HY.read('div')).toFixed(2) + '% of peak strain');
check.ok('Nu is in the convecting range', HY.read('nu') > 5 && HY.read('nu') < 100,
	'Nu ' + HY.read('nu').toFixed(1));
check.ok('no parcels exist yet (the skin is M3)', HY.read('population') === 0);
check.ok('equilibrium melt exists where the geotherm crosses the solidus',
	HY.read('meltMass') > 0, HY.read('meltMass').toExponential(2) + ' km2');

check.section('C. replay and seed discipline');
HY.reset(1);
for (var f = 0; f < 200; f++) HY.step();
var fp1 = fingerprint();
HY.reset(1);
for (f = 0; f < 200; f++) HY.step();
check.ok('the same seed replays bitwise over 10 Myr', fingerprint() === fp1, fp1);
HY.reset(2);
for (f = 0; f < 200; f++) HY.step();
check.ok('a different seed is a different planet', fingerprint() !== fp1, fingerprint());

check.section('D. MacCormack: sharper, finite, and its clamp is booked');
HY.reset(1);
HY.setOption('advect', 'maccormack');
for (f = 0; f < 2000; f++) HY.step();
var mResid = (HY.read('enthalpy') - HY.read('stock0') -
	HY.read('wallNet') - HY.read('clampNet')) / HY.read('wallGross');
check.ok('the maccormack leg stays bounded over 100 Myr', bounded(),
	HY.M.d.tMin.toFixed(3) + ' .. ' + HY.M.d.tMax.toFixed(3) +
	', peak ' + HY.M.d.peakV.toFixed(1) + ' km/Myr');
check.ok('its heat book closes with the clamp line included', Math.abs(mResid) < 5e-5,
	'residual/gross ' + mResid.toExponential(2));
check.info('the clamp is the option\'s price, reported not gated',
	'clamp/gross ' + (HY.read('clampNet') / HY.read('wallGross')).toExponential(2) +
	' over 100 Myr; the donor default pays nothing');
HY.setOption('advect', 'donor');
check.ok('the donor book needs no clamp line', (function () {
	HY.reset(1);
	for (var g = 0; g < 200; g++) HY.step();
	return HY.read('clampNet') === 0;
}()));

check.section('E. clock and sweep extremes stay finite');
[['clock', 500], ['clock', 5], ['projIters', 8], ['projIters', 40],
	['mobContrast', 0], ['mobContrast', 8]].forEach(function (row) {
	HY.reset(1);
	HY.setOption(row[0], row[1]);
	for (var h = 0; h < 200; h++) HY.step();
	check.ok(row[0] + ' = ' + row[1] + ' runs 200 frames bounded', bounded() &&
		isFinite(HY.read('enthalpy')),
		'peak ' + HY.M.d.peakV.toFixed(1) + ' km/Myr, k ' + HY.read('substeps'));
	HY.setOption(row[0], HY.opts.def(row[0]));
});

check.done();
