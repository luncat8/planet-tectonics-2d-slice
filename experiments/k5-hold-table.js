'use strict';
// 0.1.10 crush-hold evaluation table (report only). Reads the strict contact-audit and
// K5 probe logs of the base tree and of the narrow-hold tree over seeds 1-8 at 50 and
// 100 kyr/frame (5000 frames each), and prints one row per run plus the totals that
// archive/0.1.10-narrow-hold-worklog.md quotes. Every number there traces to a log here.
//
// usage: node experiments/k5-hold-table.js

var path = require('path'), READ = require('./k5-table-lib.js');
var audit = READ.audit, probe = READ.probe;
var LOGS = path.join(__dirname, 'logs');
var SEEDS = [1, 2, 3, 4, 5, 6, 7, 8], RATES = [50, 100];
var TREES = ['base', 'narrow'];

function file(tree, kind, seed, rate) {
	var name = kind === 'audit' ? 'contact-audit' : 'k5-reclass-probe';
	return path.join(LOGS, '0.1.10-' + tree + '-' + name + '-' + seed + '-' + rate + '.txt');
}

function runs() {
	var rows = [];
	SEEDS.forEach(function (seed) {
		RATES.forEach(function (rate) {
			var row = { seed: seed, rate: rate, base: audit(file('base', 'audit', seed, rate)),
				narrow: audit(file('narrow', 'audit', seed, rate)),
				baseProbe: probe(file('base', 'probe', seed, rate)),
				narrowProbe: probe(file('narrow', 'probe', seed, rate)) };
			rows.push(row);
		});
	});
	return rows;
}

function gateFailCount(a) {
	return a.failed.length;
}

function sumKey(rows, tree, key) {
	return rows.reduce(function (s, r) { return s + r[tree + 'Probe'][key]; }, 0);
}

function sumR5(rows, tree) {
	return rows.reduce(function (s, r) { return s + r[tree].r5repeats; }, 0);
}

var rows = runs();
var head = ['seed', 'kyr', 'base verdict', 'R1', 'R2n', 'R2w%', 'R3', 'R5', 'base drain/vel',
	'narrow verdict', 'R1', 'R2n', 'R2w%', 'R3', 'R5', 'narrow drain/vel'];
console.log(head.join('\t'));
rows.forEach(function (r) {
	var b = r.base, n = r.narrow;
	console.log([r.seed, r.rate, b.verdict, b.r1, b.r2needle, b.r2width, b.r3, b.r5repeats,
		r.baseProbe.drain + '/' + r.baseProbe.velocity,
		n.verdict, n.r1, n.r2needle, n.r2width, n.r3, n.r5repeats,
		r.narrowProbe.drain + '/' + r.narrowProbe.velocity].join('\t'));
});

console.log('\nstrict verdicts: base ' + rows.filter(function (r) { return r.base.verdict === 'pass'; }).length +
	' of ' + rows.length + ' pass, narrow ' + rows.filter(function (r) { return r.narrow.verdict === 'pass'; }).length +
	' of ' + rows.length + ' pass');
console.log('gate failures in total: base ' + rows.reduce(function (s, r) { return s + gateFailCount(r.base); }, 0) +
	', narrow ' + rows.reduce(function (s, r) { return s + gateFailCount(r.narrow); }, 0));
console.log('R5 repeats in total: base ' + sumR5(rows, 'base') + ', narrow ' + sumR5(rows, 'narrow'));
console.log('K5 next-frame reclassifications (pairs): base drain ' + sumKey(rows, 'base', 'drain') +
	', velocity ' + sumKey(rows, 'base', 'velocity') + '; narrow drain ' + sumKey(rows, 'narrow', 'drain') +
	', velocity ' + sumKey(rows, 'narrow', 'velocity'));

console.log('\nruns where narrow fails a gate the base passes:');
rows.forEach(function (r) {
	if (r.base.verdict === 'pass' && r.narrow.verdict !== 'pass') {
		console.log('  seed ' + r.seed + ' ' + r.rate + ' kyr: ' + r.narrow.failed.join('; '));
	}
});
console.log('runs where narrow passes a gate the base fails (fixed):');
rows.forEach(function (r) {
	var fixed = r.base.failed.filter(function (g) { return r.narrow.failed.indexOf(g) < 0; });
	if (fixed.length) console.log('  seed ' + r.seed + ' ' + r.rate + ' kyr: ' + fixed.join('; '));
});
