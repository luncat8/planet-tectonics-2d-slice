// Validate M10's report-only shipped drift pair, without re-running the live legs.
// node experiments/pt-drift-check.js
'use strict';
var fs = require('fs'), path = require('path'), assert = require('assert');
function read(name) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'logs', name + '.json'), 'utf8'));
}
function near(a, b) { assert(Math.abs(a - b) < 1e-5, a + ' against ' + b); }
function weighted(sample) {
	var mass = sample.rows.reduce(function (sum, r) { return sum + r.mass; }, 0);
	return sample.rows.reduce(function (sum, r) { return sum + r.mass * r.plate; }, 0) / mass;
}
var report = fs.readFileSync(path.join(__dirname, '../archive/0.3.2-M10-shipped-drift-report.md'), 'utf8');
var pair = [
	['bound', '0.3.2-M8-landed-s1-600', 0.25, [1.798993698, 5.083374243, 2.989326372]],
	['unbound', '0.3.2-M6-base-s1-600', 0, [1.31925, 0.011518048, 1.23286]]
];
pair.forEach(function (row) {
	var name = '0.3.2-M10-drift-s1-' + row[0], b = read(name), heat = read(row[1]);
	assert.strictEqual(b.seed, 1); assert.strictEqual(b.kyr, 50);
	assert.strictEqual(b.myr, 600); assert.strictEqual(b.erosion, true);
	assert.strictEqual(b.depBound, row[2]);
	assert.strictEqual(b.fingerprint, heat.fingerprint, 'observation neutrality: ' + row[0]);
	assert.strictEqual(b.samples.length, 6);
	assert.deepStrictEqual(b.samples.map(function (s) { return s.frame; }),
		[2001, 4000, 6000, 8000, 10000, 12000]);
	b.samples.forEach(function (s, i) {
		assert(Math.abs(s.t - s.frame * 0.05) < 1e-8);
		assert(s.rows.length > 0);
		assert(s.rows.every(function (r) {
			return r.n >= 64 && r.mass > 0 && r.t === s.t
				&& ['plate', 'own', 'base', 'v150', 'v300', 'v300s', 'y0', 'y1', 'mass']
					.every(function (k) { return Number.isFinite(r[k]); });
		}));
		if (i < 3) return;
		near(weighted(s), row[3][i - 3]);
		s.rows.forEach(function (r) {
			var line = '| ' + row[0] + ' / ' + Math.round(s.t) + ' | ' + r.n + ' | '
				+ ['plate', 'own', 'base', 'v150', 'v300'].map(function (k) {
					return r[k].toFixed(3);
				}).join(' | ') + ' |';
			assert(report.includes(line), 'M10 report row: ' + line);
		});
	});
	assert.strictEqual(b.samples[5].fingerprint, b.fingerprint);
	assert.strictEqual(b.samples[5].depMelt, heat.depMelt);
	assert.strictEqual(b.samples[5].boundCaps, row[2] ? heat.boundCapped : 0);
	var log = fs.readFileSync(path.join(__dirname, 'logs', name + '.txt'), 'utf8');
	assert(log.includes('ALL PASS (2 checks)'));
	console.log('PASS M10 ' + row[0] + ': six finite plate samples, exact heat-bank replay;'
		+ ' late mass-weighted drift ' + b.samples.slice(3).map(function (s) {
			return weighted(s).toFixed(3);
		}).join(' / ') + ' cm/yr');
});
console.log('M10 is a seed-1 snapshot measurement, not a universal drift acceptance gate.');
