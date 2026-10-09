'use strict';
// 0.1.11 closing-kind hysteresis table (report only). Reads the strict contact-audit and K5
// probe logs of the base and of each hysteresis variant (experiments/logs/0.1.11-<tag>-*.txt),
// prints one line per variant with its strict passes, gate failures, R3 ceiling maximum and
// next-frame reclassification totals by cause, then the runs a variant fails that the base
// passes. The variants are defined in experiments/logs/0.1.11-hysteresis-variants.patch.
// Every number in archive/0.1.11-hysteresis-worklog.md traces to a log read here.
//
// usage: node experiments/k5-variant-table.js [seeds=1-16]

var path = require('path'), READ = require('./k5-table-lib.js');
var LOGS = path.join(__dirname, 'logs');
var TAGS = ['base', 'v1', 'v1e', 'v2a', 'v2b'];
var RATES = [50, 100];
var range = (process.argv[2] || '1-16').split('-').map(Number);
var SEEDS = [];
for (var s = range[0]; s <= range[1]; s++) SEEDS.push(s);

function file(tag, kind, seed, rate) {
	var name = kind === 'audit' ? 'contact-audit' : 'k5-reclass-probe';
	return path.join(LOGS, '0.1.11-' + tag + '-' + name + '-' + seed + '-' + rate + '.txt');
}

// every (seed, rate) run of a tag that has both logs on disk
function runsOf(tag) {
	var rows = [];
	SEEDS.forEach(function (seed) {
		RATES.forEach(function (rate) {
			var a = file(tag, 'audit', seed, rate), p = file(tag, 'probe', seed, rate);
			if (!READ.exists(a) || !READ.exists(p)) return;
			rows.push({ seed: seed, rate: rate, audit: READ.audit(a), probe: READ.probe(p) });
		});
	});
	return rows;
}

function summary(tag, rows) {
	var pass = rows.filter(function (r) { return r.audit.verdict === 'pass'; }).length;
	var fails = rows.reduce(function (n, r) { return n + r.audit.failed.length; }, 0);
	var r5 = rows.reduce(function (n, r) { return n + r.audit.r5repeats; }, 0);
	var r3 = rows.reduce(function (m, r) { return Math.max(m, +r.audit.r3 || 0); }, 0);
	var drain = rows.reduce(function (n, r) { return n + r.probe.drain; }, 0);
	var velocity = rows.reduce(function (n, r) { return n + r.probe.velocity; }, 0);
	console.log([tag, rows.length, pass + '/' + rows.length, fails, r5, r3.toFixed(1) + ' km',
		drain, velocity].join('\t'));
}

function byKey(rows) {
	var map = {};
	rows.forEach(function (r) { map[r.seed + '/' + r.rate] = r; });
	return map;
}

var tagRows = {};
TAGS.forEach(function (tag) { tagRows[tag] = runsOf(tag); });
var baseMap = byKey(tagRows.base);

console.log(['variant', 'runs', 'strict pass', 'gate failures', 'R5 repeats', 'R3 max',
	'drain pairs', 'velocity pairs'].join('\t'));
TAGS.forEach(function (tag) { summary(tag, tagRows[tag]); });

TAGS.slice(1).forEach(function (tag) {
	console.log('\nruns ' + tag + ' fails that the base passes:');
	tagRows[tag].forEach(function (r) {
		var b = baseMap[r.seed + '/' + r.rate];
		if (!b || b.audit.verdict !== 'pass' || r.audit.verdict === 'pass') return;
		console.log('  seed ' + r.seed + ' ' + r.rate + ' kyr: ' + r.audit.failed.join('; ') +
			' (R3 ' + r.audit.r3 + ' km)');
	});
});
