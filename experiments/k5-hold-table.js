'use strict';
// 0.1.10 crush-hold evaluation table (report only). Reads the strict contact-audit and
// K5 probe logs of the base tree and of the narrow-hold tree over seeds 1-8 at 50 and
// 100 kyr/frame (5000 frames each), and prints one row per run plus the totals that
// archive/0.1.10-narrow-hold-worklog.md quotes. Every number there traces to a log here.
//
// usage: node experiments/k5-hold-table.js

var fs = require('fs'), path = require('path');
var LOGS = path.join(__dirname, 'logs');
var SEEDS = [1, 2, 3, 4, 5, 6, 7, 8], RATES = [50, 100];
var TREES = ['base', 'narrow'];

function lineWith(lines, words) {
	for (var k = 0; k < lines.length; k++) {
		if (/^(PASS|FAIL|INFO)\s/.test(lines[k]) && lines[k].indexOf(words) >= 0) return lines[k];
	}
	return '';
}

function first(re, text) {
	var m = re.exec(text);
	return m ? m[1] : '-';
}

// verdict, the failing gate names, and the gate metrics of one strict audit
function audit(file) {
	var text = fs.readFileSync(file, 'utf8'), lines = text.split('\n'), verdict = '?', failed = [], k, m;
	for (k = 0; k < lines.length; k++) {
		m = /^(\d+) \/ \d+ FAILURES$/.exec(lines[k]);
		if (m) verdict = m[1] + ' fail';
		if (/^ALL PASS \(\d+ checks\)$/.test(lines[k])) verdict = 'pass';
		if (lines[k].indexOf('FAIL  ') === 0) failed.push(lines[k].slice(6).split('   ')[0].trim());
	}
	var r1 = lineWith(lines, 'R1 an event'), r2n = lineWith(lines, 'the pair is not a local needle');
	var r2w = lineWith(lines, 'contiguous four-column run'), r3 = lineWith(lines, 'the crust has a ceiling');
	var r5 = lineWith(lines, 'no site changes its topology twice');
	var w = /(\d+) of (\d+) built/.exec(r2w);
	return {
		verdict: verdict,
		failed: failed,
		r1: first(/ratio ([0-9.]+) \(max/, r1),
		r2needle: first(/shoulder ([0-9.]+) at/, r2n),
		r2width: w ? (100 * w[1] / w[2]).toFixed(1) : '-',
		r3: first(/([0-9.]+) km \(ceiling/, r3),
		r5repeats: +first(/(\d+) of \d+ events/, r5)
	};
}

// next-frame reclassifications of the K5 probe, by cause
function probe(file) {
	var text = fs.readFileSync(file, 'utf8');
	var m = /reclassifications in (\d+) frames \((\d+) pairs\): (\d+) from a K5 drain.*?, (\d+) from a velocity/.exec(text);
	var d = /largest deficit .*? ([0-9.]+) km/.exec(text);
	if (!m) return { frames: 0, drain: 0, velocity: 0, deficitKm: '-' };
	return { frames: +m[1], drain: +m[3], velocity: +m[4], deficitKm: d ? d[1] : '-' };
}

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
