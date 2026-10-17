// Validate M10's shipped drift pair and M11's slow-plate attribution and census distribution.
// node experiments/pt-drift-check.js
'use strict';
var fs = require('fs'), path = require('path'), assert = require('assert');

function read(name) {
	return JSON.parse(fs.readFileSync(path.join(__dirname, 'logs', name + '.json'), 'utf8'));
}
function near(a, b, tol) {
	if (tol === undefined) tol = 1e-4;
	assert(Math.abs(a - b) < tol, a + ' against ' + b + ' (tol ' + tol + ')');
}
function weighted(sample) {
	var mass = sample.rows.reduce(function (sum, r) { return sum + r.mass; }, 0);
	return sample.rows.reduce(function (sum, r) { return sum + r.mass * r.plate; }, 0) / mass;
}

// ==========================================
// M10: Shipped drift pair on seed 1
// ==========================================
var reportM10 = fs.readFileSync(path.join(__dirname, '../archive/0.3.2-M10-shipped-drift-report.md'), 'utf8');
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
		near(weighted(s), row[3][i - 3], 1e-4);
		s.rows.forEach(function (r) {
			var line = '| ' + row[0] + ' / ' + Math.round(s.t) + ' | ' + r.n + ' | '
				+ ['plate', 'own', 'base', 'v150', 'v300'].map(function (k) {
					return r[k].toFixed(3);
				}).join(' | ') + ' |';
			assert(reportM10.includes(line), 'M10 report row: ' + line);
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

// ==========================================
// M11 Section A: Slow plate attribution at 500 Myr
// ==========================================
var slowBank = read('0.3.2-M11-slow-plate-s1-500myr');
assert.strictEqual(slowBank.seed, 1);
assert.strictEqual(slowBank.unbound, true);
assert(slowBank.records.length > 0);

var f10000 = slowBank.records.filter(function (r) { return r.frame === 10000; })[0];
assert(f10000, 'frame 10000 record present');
assert.strictEqual(f10000.c, 3);
assert.strictEqual(f10000.cnt, 87);
near(f10000.mass, 53100.89, 0.1);
near(f10000.rawFlow_cmYr, 2.432, 0.01);
near(f10000.slabPull_cmYr, -6.743, 0.01);
near(f10000.ridgePush_cmYr, 0.819, 0.01);
near(f10000.preBrake_cmYr, -3.492, 0.01);
near(f10000.brakeDV_cmYr, 3.492, 0.01);
near(f10000.postBrake_cmYr, -0.0004, 0.001);
near(f10000.drift_cmYr, 0.0114, 0.005);
assert.strictEqual(f10000.holds, 2);
assert.strictEqual(f10000.arrests, 0);
assert.strictEqual(f10000.contacts.length, 2);
assert(f10000.contacts.every(function (ct) {
	return ct.regime === 'subduction' && ct.override === 3 && ct.sub === 0;
}), 'plate 3 is override in all contact sites');

console.log('PASS M11 slow-plate attribution: unbound s1 frame 10000 slow plate (0.011 cm/yr) is kinematically driven (-3.49 cm/yr) and held by subduction override brake (+3.49 cm/yr dv)');

// ==========================================
// M11 Section B: Continuous Census Distribution
// ==========================================
var reportM11Path = path.join(__dirname, '../archive/0.3.2-M11-drift-attribution-report.md');
var reportM11 = fs.existsSync(reportM11Path) ? fs.readFileSync(reportM11Path, 'utf8') : '';

var censusMatrix = [
	{ seed: 1, mode: 'bound', heatBank: '0.3.2-M8-landed-s1-600', lateDrift: 1.079, latePlates: 7520, maxEpisodeMyr: 164.5 },
	{ seed: 1, mode: 'unbound', heatBank: '0.3.2-M6-base-s1-600', lateDrift: 1.256, latePlates: 7588, maxEpisodeMyr: 167.2 },
	{ seed: 3, mode: 'bound', heatBank: '0.3.2-M8-landed-s3-600', lateDrift: 1.125, latePlates: 13920, maxEpisodeMyr: 196.5 },
	{ seed: 3, mode: 'unbound', heatBank: '0.3.2-M6-base-s3-600', lateDrift: 0.808, latePlates: 12242, maxEpisodeMyr: 206.2 },
	{ seed: 5, mode: 'bound', heatBank: '0.3.2-M8-landed-s5-600', lateDrift: 1.286, latePlates: 3119, maxEpisodeMyr: 183.4 },
	{ seed: 5, mode: 'unbound', heatBank: '0.3.2-M6-base-s5-600', lateDrift: 1.407, latePlates: 7980, maxEpisodeMyr: 183.7 },
	{ seed: 7, mode: 'bound', heatBank: '0.3.2-M6-dep-s7-600', lateDrift: 0.950, latePlates: 6835, maxEpisodeMyr: 166.9 },
	{ seed: 7, mode: 'unbound', heatBank: '0.3.2-M6-base-s7-600', lateDrift: 1.098, latePlates: 6157, maxEpisodeMyr: 166.6 }
];

censusMatrix.forEach(function (row) {
	var bankName = '0.3.2-M11-census-' + row.mode + '-s' + row.seed;
	var d = read(bankName);
	var heat = read(row.heatBank);
	assert.strictEqual(d.seed, row.seed);
	assert.strictEqual(d.unbound, row.mode === 'unbound');
	assert.strictEqual(d.fingerprint, heat.fingerprint, 'census observation neutrality: s' + row.seed + ' ' + row.mode);
	assert.strictEqual(d.totalFrames, 12000);
	near(d.lateMassDrift, row.lateDrift, 0.01);
	var totalLatePlates = d.lateSpeedBins.reduce(function (a, b) { return a + b; }, 0);
	assert.strictEqual(totalLatePlates, row.latePlates);
	near(d.slowEpisodes.maxContinuousMyr, row.maxEpisodeMyr, 0.2);

	if (reportM11) {
		var slowLate = d.lateSpeedBins[0] + d.lateSpeedBins[1];
		var fastLate = d.lateSpeedBins[3] + d.lateSpeedBins[4] + d.lateSpeedBins[5];
		var holdPct = (d.lateSlowAttribution.holdBrake / slowLate * 100).toFixed(1);
		var line = '| s' + row.seed + ' ' + row.mode + ' | ' + d.fingerprint + ' | '
			+ (d.plateFraction * 100).toFixed(1) + '% | '
			+ (d.latePlateFraction * 100).toFixed(1) + '% | '
			+ d.allMassDrift.toFixed(3) + ' | '
			+ d.lateMassDrift.toFixed(3) + ' | '
			+ totalLatePlates + ' | '
			+ (slowLate / totalLatePlates * 100).toFixed(1) + '% | '
			+ (fastLate / totalLatePlates * 100).toFixed(1) + '% | '
			+ holdPct + '% | '
			+ d.slowEpisodes.maxContinuousMyr.toFixed(1) + ' |';
		assert(reportM11.includes(line), 'M11 report table row: ' + line);
	}
});

console.log('PASS M11 census distribution: eight 600 Myr worlds verified bitwise against heat banks; continuous slow-episode census confirms late drift (0.81..1.41 cm/yr) and subduction override hold attribution across seeds.');
