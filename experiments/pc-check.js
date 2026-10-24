// pc-check.js — 0.5.0 M1's acceptance pass: it runs the six owner harnesses as children and
// quotes their counts rather than re-measuring them, the way pt-p3-check.js and pt-p4-check.js
// do for the 0.3 line (0.5.0-plan.md §9 M1, §10).
//
// Run: node experiments/pc-check.js
'use strict';

var path = require('path');
var spawnSync = require('child_process').spawnSync;
var check = require('./lib.js').check;

var OWNERS = [
	['pc-phase.js', 'the phase law transplant: bitwise 0.3 at depth, monotone under load'],
	['pc-pool.js', 'the pool: transactions conserve, ids never reuse, a full pool defers'],
	['pc-bond.js', 'the bond law transplant: 0.3\'s mu, the age hysteresis, the mean excess'],
	['pc-opt.js', 'the option registry and both bars, entry for entry, plus the presets'],
	['pc-scenario.js', 'S1-S4 through one interface; every gate pending on a skeleton'],
	['pc-boot.js', 'both pages boot in a DOM, one frame loop, the bar drives the engines'],
	['pc-look.js', 'both skeletons render through their own draw path (writes PNGs)']
];

var total = 0, failed = 0, i, row, out, m, passed;

check.section('0.5.0 M1 — the shared substrate and both page skeletons');

for (i = 0; i < OWNERS.length; i++) {
	row = OWNERS[i];
	out = spawnSync(process.execPath, [path.join(__dirname, row[0])], {
		cwd: path.join(__dirname, '..'), encoding: 'utf8'
	});
	m = /ALL PASS \((\d+) checks\)/.exec(out.stdout || '');
	passed = m && out.status === 0;
	if (!passed) {
		var bad = /(\d+) \/ (\d+) FAILURES/.exec(out.stdout || '');
		failed += bad ? Number(bad[1]) : 1;
	}
	if (m) total += Number(m[1]);
	check.ok(row[0] + ' — ' + row[1], passed,
		m ? m[1] + ' checks' : (out.stderr || out.stdout || '').split('\n').slice(-4).join(' '));
}

check.ok('no owner harness reports a failure', failed === 0, failed + ' failures');
console.log('INFO  ' + OWNERS.length + ' owner harnesses, ' + total + ' checks delegated');

check.done();
