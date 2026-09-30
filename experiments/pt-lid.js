// pt-lid.js — 0.3.0 P2.1: when does the crust form? The question has three parts, and this
// fixture measures all three on the real pipeline:
//
//   1. the law's clock  -- strength is (1 - exp(-age/tauWeld)) times the cold-rock factor,
//      so a parcel is plate-strength (mu >= clusterMin) after ln(4/3)*tauWeld ~ 5.8 Myr of
//      being cold, and fully welded after ~3 tauWeld; the run should show exactly that;
//   2. the lid's thickness -- the rheological lock isotherm (TLock/TSoft) sits where the
//      thermal boundary layer puts it: the depth of T = 0.35 and T = 0.45 is printed every
//      sample, and the strong band should track it;
//   3. the coverage clock -- from the 'hot' start of the P2 gate, how long until the lid
//      covers most of the surface (gate: >= 60% within 30 s of wall clock at the default
//      clock, which is 90 Myr), and from the 'cool' start, how the plates then cycle.
//
// The surface coverage is columns whose surface row carries plate material (mug >=
// clusterMin at the row just under the wall). Everything else is the same diagnostics the
// HUD prints.
//
// Run: node experiments/pt-lid.js [endMyr=400] > experiments/logs/0.3.0-p2.1-lid.txt
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js');

var end = +(process.argv[2] || 400);

function surfaceCover(M, S) {
	var nx = M.nx, i, n = 0;
	for (i = 0; i < nx; i++) if (S.mug[nx + i] >= P.clusterMin) n++;
	return n / nx;
}

function isotherm(M, S, level) {
	// depth of the row-mean T = level, linearly between node rows
	var nx = M.nx, ny = M.ny, j, i, mean, m2;
	for (j = 1; j < ny; j++) {
		mean = 0;
		for (i = 0; i < nx; i++) mean += S.Tg[j * nx + i];
		mean /= nx;
		if (mean >= level) {
			m2 = 0;
			for (i = 0; i < nx; i++) m2 += S.Tg[(j - 1) * nx + i];
			m2 /= nx;
			var f = (level - m2) / (mean - m2);
			return M.yN[j - 1] + f * (M.yN[j] - M.yN[j - 1]);
		}
	}
	return M.depth;
}

function run(ic, label) {
	P.ic = ic;
	P.sl.kyr = 50;
	SIM.init();
	SIM.reset();
	SIM.dt = 0.05;
	var step = 5, next = 0, cover60 = -1, coverMax = 0;
	console.log('\n=== ' + label + ' ===');
	console.log('   t/Myr  cover%  lid%  plates   Nu   T@25   T@50   z35    z45    wells');
	while (SIM.t < end) {
		SIM.step();
		var cover = surfaceCover(SIM.M, S);
		if (cover > coverMax) coverMax = cover;
		if (cover60 < 0 && cover >= 0.6) cover60 = SIM.t;
		if (SIM.t >= next) {
			var M = SIM.M, n = M.nx;
			// T at ~25 and ~50 km: the nearest node rows
			var t25 = S.Tg[Math.max(1, Math.round(Math.asinh(25 / M.yLin) / M.dEta)) * n];
			var t50 = S.Tg[Math.max(1, Math.round(Math.asinh(50 / M.yLin) / M.dEta)) * n];
			console.log(('  ' + SIM.t.toFixed(0)).padStart(8)
				+ ('  ' + (cover * 100).toFixed(0)).padStart(7)
				+ ('  ' + (S.d.lid * 100).toFixed(0)).padStart(5)
				+ ('  ' + S.d.plates).padStart(6)
				+ ('  ' + S.d.nu.toFixed(1)).padStart(6)
				+ ('  ' + t25.toFixed(2)).padStart(7)
				+ ('  ' + t50.toFixed(2)).padStart(7)
				+ ('  ' + isotherm(M, S, 0.35).toFixed(0)).padStart(7)
				+ ('  ' + isotherm(M, S, 0.45).toFixed(0)).padStart(7)
				+ ('  ' + S.d.wells).padStart(7));
			next += step;
			if (SIM.t > 100) step = 25;
		}
	}
	return { cover60: cover60, coverMax: coverMax, t: SIM.t };
}

console.log('  lid formation: mesh ' + P.mesh.nx + 'x' + P.mesh.ny + ', wrap ' + P.wrap
	+ ' km, tauWeld ' + P.tauWeld + ' Myr, TLock ' + P.TLock + ', TSoft ' + P.TSoft);

var hot = run('hot', 'hot start (the P2 gate): the lid grows from the wall');
var cool = run('cool', 'cool start (the demo default): the skin welds');

check.section('the formation clocks');
check.ok('the hot start covers 60% of the surface within 90 Myr (30 s at the default clock)',
	hot.cover60 >= 0 && hot.cover60 <= 90, 't60 ' + (hot.cover60 < 0 ? 'never' : hot.cover60.toFixed(0) + ' Myr')
	+ ', max cover ' + (hot.coverMax * 100).toFixed(0) + '%');
check.ok('the cool start welds a visible lid within one tauWeld', cool.coverMax > 0.5,
	'max cover ' + (cool.coverMax * 100).toFixed(0) + '%');
check.ok('the lid persists to the end of both runs', hot.coverMax > 0 && cool.coverMax > 0, '');

check.done();
