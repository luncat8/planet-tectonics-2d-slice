// hy-crust.js — 0.5.0 M3 gate (0.5.0-plan.md §4.1, §4.4, §7 M3, §9.1): the crust skin
// (H1 scatter + load column, H4 phase equilibrium + bonds + damage + clusters), S2
// melting, S4 unpressurize (with its `solidusOf: 'depth'` negative control), both
// positions of `links` (on/off), and the load-back stability fixture across three load
// magnitudes.
//
// Run: node experiments/hy-crust.js
'use strict';

var PCP = require('../js/pc/params.js');
var PHASE = require('../js/pc/phase.js');
var PCBOND = require('../js/pc/bond.js');
var PCSCEN = require('../js/pc/scenario.js');
var HY = require('../js/hy/hy.js');
var check = require('./lib.js').check;

check.section('A. S2 melting through the scenario interface, 100 Myr at 50 kyr/frame');
var s2 = PCSCEN.run(HY, 'S2', { seed: 1 });
for (var g = 0; g < s2.gates.length; g++) {
	check.ok('S2 ' + s2.gates[g].name, s2.gates[g].status === 'pass', s2.gates[g].detail);
}
check.ok('S2 has no failing or pending gate', s2.passed === 3 && s2.failed === 0 && s2.pending === 0,
	s2.passed + ' passed');

// Direct independent audit of every cell and parcel against PHASE.byH at end of S2
var M = HY.M, S = HY.S, k, p, maxCellEqErr = 0, maxParEqErr = 0;
for (k = 0; k < M.n; k++) {
	PHASE.byH(M.H[k], M.y[k], M.cF[k], M.cW[k], M.load[k]);
	maxCellEqErr = Math.max(maxCellEqErr,
		Math.abs(M.T[k] - PHASE.out.t), Math.abs(M.melt[k] - PHASE.out.melt));
}
for (p = 0; p < S.n; p++) {
	PHASE.byH(S.H[p], S.y[p], S.cF[p], S.cW[p], S.load[p]);
	maxParEqErr = Math.max(maxParEqErr,
		Math.abs(S.T[p] - PHASE.out.t), Math.abs(S.melt[p] - PHASE.out.melt));
}
check.ok('every cell and parcel sits on the exact PHASE.byH manifold of its local H and load',
	maxCellEqErr <= 1e-14 && maxParEqErr <= 1e-14,
	'cell err ' + maxCellEqErr.toExponential(2) + ', parcel err ' + maxParEqErr.toExponential(2));

check.section('B. H4 crust skin: bonds, damage, clusters, and the links toggle (on vs off)');
var damaged = 0, intact = 0;
for (p = 0; p < S.n; p++) {
	if (S.dmg[p] > 0.05) damaged++;
	if (PCBOND.strength(S, p) >= PCP.clusterMin) intact++;
}
check.ok('with links: true, bonds and plate clusters form and strain damages rift boundaries',
	HY.read('bonds') >= 500 && HY.read('clusters') >= 2 && HY.read('plates') >= 1 &&
	intact >= 200 && damaged >= 20,
	'bonds ' + HY.read('bonds') + ', plates ' + HY.read('plates') +
	', intact ' + intact + ', damaged ' + damaged);

// Now stage links: false, reset, and run 400 frames (20 Myr)
HY.setOption('links', false);
HY.reset(1);
for (var f = 0; f < 400; f++) HY.step(0);
M = HY.M; S = HY.S;
var welded = 0;
for (p = 0; p < S.n; p++) if (S.mu[p] >= PCP.clusterMin) welded++;
var mrOff = Math.abs(HY.read('mass') - M.totalMass) / M.totalMass;
check.ok('with links: false, no pair bonds or clusters form while settle still ages cold rock',
	HY.opts.get('links') === false && HY.read('bonds') === 0 &&
	HY.read('clusters') === 0 && HY.read('plates') === 0 && welded > 500,
	'bonds ' + HY.read('bonds') + ', welded ' + welded);
check.ok('with links: false, the run stays bounded and the mass book closes',
	isFinite(HY.read('peakV')) && HY.read('peakV') > 0 && mrOff <= 1e-12,
	'peakV ' + HY.read('peakV').toFixed(1) + ', |dM|/M0 ' + mrOff.toExponential(2));

// Restore links: true and verify partSize reset option scales initial skin parcel count
HY.setOption('links', true);
HY.setOption('partSize', 1.5);
HY.reset(1);
var nCoarse = HY.S.n;
HY.setOption('partSize', 1.0);
HY.reset(1);
var nDefault = HY.S.n;
check.ok('partSize scales the crust skin resolution at reset and restores cleanly',
	nCoarse < nDefault && nDefault === 1536 && HY.opts.get('links') === true,
	'partSize 1.5 -> ' + nCoarse + ' parcels, 1.0 -> ' + nDefault);

check.section('C. S4 unpressurize and the solidusOf: depth negative control');
var s4Ctrl = PCSCEN.run(HY, 'S4', { seed: 1, options: { solidusOf: 'depth' } });
var s4 = PCSCEN.run(HY, 'S4', { seed: 1, control: s4Ctrl.summary.pulsePeak });
for (g = 0; g < s4.gates.length; g++) {
	check.ok('S4 ' + s4.gates[g].name, s4.gates[g].status === 'pass', s4.gates[g].detail);
}
check.ok('S4 has all four gates passing (including negative control)',
	s4.passed === 4 && s4.failed === 0 && s4.pending === 0,
	s4.passed + ' passed');
check.ok('S4 pulseGap (equilibrium vs stored decompression melt) is <= 1e-9 at every sample',
	s4.samples.every(function (smp) { return smp.pulseGap <= 1e-9; }),
	'max pulseGap ' + Math.max.apply(null, s4.samples.map(function (s) { return s.pulseGap; })).toExponential(2));

// Direct click-to-unload at an off-centre column (x = 4,000 km)
HY.setOption('solidusOf', 'load');
HY.setTool(null);
HY.reset(1);
var loadBefore = HY.M.load[64];
var rem = HY.unload(4000, 750);
var loadAfter = HY.M.load[64];
check.ok('direct HY.unload(x) reduces column load and drops the solidus under the excavated patch',
	rem > 0 && loadAfter < loadBefore && HY.read('solidusDrop') > 0.01 &&
	Math.abs(HY.read('mass') - HY.M.totalMass) / HY.M.totalMass <= 1e-14,
	'load[64] ' + loadBefore.toFixed(2) + ' -> ' + loadAfter.toFixed(2) +
	' km, drop ' + HY.read('solidusDrop').toFixed(4));

check.section('D. load-back stability fixture across one-way (0) and three load magnitudes');
var mags = [0, 0.05, 0.15, 0.30];
var peakByMag = [];
for (var m = 0; m < mags.length; m++) {
	HY.loadBack = mags[m];
	HY.reset(1);
	for (f = 0; f < 200; f++) HY.step(0);
	M = HY.M;
	var relM = Math.abs(HY.read('mass') - M.totalMass) / M.totalMass;
	peakByMag.push(M.d.peakV);
	check.ok('loadBack = ' + mags[m] + ' runs 200 frames bounded, divergence-free and ledger-closed',
		isFinite(M.d.peakV) && M.d.peakV > 10 && M.d.peakV < 250 &&
		M.d.tMin >= 0 && M.d.tMax <= 1.05 && M.d.div <= 1e-12 && relM <= 1e-12,
		'peakV ' + M.d.peakV.toFixed(2) + ' km/Myr, T ' + M.d.tMin.toFixed(3) + '..' +
		M.d.tMax.toFixed(3) + ', div ' + M.d.div.toExponential(2));
}
HY.loadBack = 0.05;
check.ok('load-back coupling Perturbs the velocity field smoothly relative to one-way (loadBack = 0)',
	peakByMag[0] !== peakByMag[1] && peakByMag[1] !== peakByMag[2] && peakByMag[2] !== peakByMag[3],
	peakByMag.map(function (v) { return v.toFixed(3); }).join(' / '));

check.done();
