'use strict';
// 0.1.9 donor-floor evaluation table (report only). Reads the strict contact-audit logs of
// each tree (the same four legs everywhere) and prints the verdict and the gate metrics,
// so every number in archive/0.1.9-k5-donor-floor-evaluation-worklog.md traces to a log.
// Logs of main and of 35816d1 use their own harness, so their rows are not comparable
// with the cf98e67 rows beyond the verdict; the cf98e67 rows share one harness.
//
// usage: node experiments/k5-donor-floor-table.js

var fs = require('fs'), path = require('path');
var LOGS = path.join(__dirname, 'logs');
var LEGS = [
	{ leg: '1-50', frames: 3000 }, { leg: '1-100', frames: 3000 },
	{ leg: '5-50', frames: 5000 }, { leg: '5-100', frames: 5000 }
];
var TREES = [
	{ name: 'main 2f168c9 (own harness)', file: function (l) {
		return '0.1.8-r2-local-gradient8-contact-audit-' + l.frames + '-' + l.leg + '.txt'; } },
	{ name: '35816d1 donor clamp (own harness)', file: function (l) {
		return '0.1.9-eval-35816d1-contact-audit-' + l.leg + '.txt'; } },
	{ name: 'cf98e67 freeze (base)', file: function (l) {
		return '0.1.9-contact-audit-' + l.leg + '.txt'; } },
	{ name: 'cf98e67 + donor clamp', file: function (l) {
		return '0.1.9-eval-donor-clamp-contact-audit-' + l.leg + '.txt'; } },
	{ name: 'cf98e67 + narrow hold', file: function (l) {
		return '0.1.9-eval-narrow-hold-contact-audit-' + l.leg + '.txt'; } }
];

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

function ofPair(re, text) {
	var m = re.exec(text);
	return m ? m[1] + '/' + m[2] : '-';
}

function summarise(text) {
	var lines = text.split('\n'), verdict = '?', failed = [], k, m;
	for (k = 0; k < lines.length; k++) {
		m = /^(\d+) \/ (\d+) FAILURES$/.exec(lines[k]);
		if (m) verdict = m[1] + '/' + m[2] + ' fail';
		if (/^ALL PASS \(\d+ checks\)$/.test(lines[k])) verdict = 'all pass';
		if (lines[k].indexOf('FAIL  ') === 0) failed.push(lines[k].slice(6).split('   ')[0]);
	}
	var r1 = lineWith(lines, 'R1 an event'), r2n = lineWith(lines, 'the pair is not a local needle');
	var r2w = lineWith(lines, 'contiguous four-column run'), r3 = lineWith(lines, 'the crust has a ceiling');
	var r5 = lineWith(lines, 'no site changes its topology twice');
	var w = /(\d+) of (\d+) built/.exec(r2w);
	return {
		verdict: verdict,
		failed: failed.length ? failed.join('; ') : '-',
		r1: first(/ratio ([0-9.]+) \(max/, r1),
		r2needle: first(/shoulder ([0-9.]+) at/, r2n),
		r2width: w ? (100 * w[1] / w[2]).toFixed(1) + '%' : '-',
		r3: first(/([0-9.]+) km \(ceiling/, r3),
		r5: ofPair(/(\d+) of (\d+) events/, r5)
	};
}

var rows = [];
TREES.forEach(function (tree) {
	LEGS.forEach(function (l) {
		var file = path.join(LOGS, tree.file(l));
		var s = fs.existsSync(file) ? summarise(fs.readFileSync(file, 'utf8')) : null;
		rows.push([tree.name, l.leg, s ? s.verdict : 'missing', s ? s.failed : '-',
			s ? s.r1 : '-', s ? s.r2needle : '-', s ? s.r2width : '-', s ? s.r3 : '-', s ? s.r5 : '-']);
	});
});

var head = ['tree', 'leg', 'verdict', 'failing gates', 'R1 ratio', 'R2 needle', 'R2 width', 'R3 km', 'R5 repeats'];
var widths = head.map(function (h, c) {
	return Math.max(h.length, Math.max.apply(null, rows.map(function (r) { return String(r[c]).length; })));
});
function pad(cells) {
	return cells.map(function (v, c) { return String(v) + new Array(widths[c] - String(v).length + 1).join(' '); }).join('  ').replace(/\s+$/, '');
}
console.log(pad(head));
rows.forEach(function (r) { console.log(pad(r)); });
