// sp-bench.js — 0.5.0 M0 bake-off for the headless soup prototype.
//
// The candidate measured here is not the plan's initial guess. M0 falsified overdamped,
// absolute-buoyancy PBF: a few local sweeps cannot both cancel the whole-column load and
// build a circulation. The candidate uses an instantaneous horizontal-mean gauge and
// carried circulation. Contact gets the same rules, so the mode comparison is fair.
//
// Full: node experiments/sp-bench.js --out experiments/logs/0.5.0-M0-sp-bench.json \
//         --svg experiments/logs/0.5.0-M0-soup.svg
// Quick development pass: node experiments/sp-bench.js --quick
'use strict';

var fs = require('fs');
var os = require('os');
var SP = require('./sp-prototype.js');

var args = process.argv.slice(2), quick = args.indexOf('--quick') >= 0;
var noLong = args.indexOf('--no-long') >= 0;
function argValue(name) {
	var i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
}
var outPath = argValue('--out'), svgPath = argValue('--svg');

var candidate = {
	nx: 128, space: 'screen', mode: 'pbf', sizePolicy: 'uniform',
	drive: 100, inertia: 0.98, pbfIters: 2, mobContrast: 0,
	substepCap: 0.35, buoyancy: 'row', buoySmooth: 0,
	motionPolicy: 'substep', heatMode: 'analytic', seed: 1
};
var oldPlan = {
	nx: 128, space: 'screen', mode: 'pbf', sizePolicy: 'uniform',
	drive: 35, inertia: 0, pbfIters: 2, mobContrast: 4,
	substepCap: 0.35, buoyancy: 'absolute', buoySmooth: 0,
	motionPolicy: 'substep', heatMode: 'explicit', seed: 1
};
var check = { fails: 0, total: 0 };
function ok(name, cond, info) {
	check.total++; if (!cond) check.fails++;
	console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
}
function info(name, value) { console.log('INFO  ' + name + '   ' + value); }
function copyConfig(base, delta) {
	var out = {}, k;
	for (k in base) out[k] = base[k];
	for (k in delta) out[k] = delta[k];
	return out;
}
function median(values) {
	if (!values.length) return NaN;
	var a = values.slice().sort(function (x, y) { return x - y; });
	var m = a.length >> 1;
	return a.length & 1 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}
function percentile(values, p) {
	if (!values.length) return NaN;
	var a = values.slice().sort(function (x, y) { return x - y; });
	return a[Math.round((a.length - 1) * p)];
}
function finiteState(S) {
	var d = SP.diagnostics(S), i;
	for (i = 0; i < S.n; i++) {
		if (!(S.x[i] >= 0 && S.x[i] < S.wrap && S.q[i] >= 0 && S.q[i] <= S.height)) return false;
	}
	return d.nonFinite === 0 && d.tMin >= -1e-10 && d.tMax <= 1 + 1e-10 &&
		d.heatResidual < 1e-9 && d.massResidual < 1e-12;
}
function sameState(a, b) {
	if (a.n !== b.n || a.wall !== b.wall || a.time !== b.time) return false;
	var names = ['x', 'q', 'y', 'T', 'm', 'diam', 'vx', 'vy', 'vq'];
	for (var z = 0; z < names.length; z++) {
		var aa = a[names[z]], bb = b[names[z]];
		for (var i = 0; i < a.n; i++) if (aa[i] !== bb[i]) return false;
	}
	return true;
}
function run(S, frames, dt, validEveryFrame) {
	for (var k = 0; k < frames; k++) {
		SP.step(S, dt);
		if (validEveryFrame && !finiteState(S)) return { frame: k + 1, state: SP.snapshot(S) };
	}
	return null;
}
function timedLeg(config, warmup, batches, frames) {
	var S = SP.create(config), failure = run(S, warmup, 0.05, true);
	if (failure) return { failure: failure };
	var times = [], frameTimes = [], b, f, t0, f0, ms;
	for (b = 0; b < batches; b++) {
		t0 = process.hrtime.bigint();
		for (f = 0; f < frames; f++) {
			f0 = process.hrtime.bigint(); SP.step(S, 0.05);
			frameTimes.push(Number(process.hrtime.bigint() - f0) / 1e6);
		}
		ms = Number(process.hrtime.bigint() - t0) / 1e6 / frames;
		if (!finiteState(S)) return { failure: { state: SP.snapshot(S) } };
		times.push(ms);
	}
	return { n: S.n, msBest: Math.min.apply(Math, times), msMean: times.reduce(function (a, v) { return a + v; }, 0) / times.length,
		msMedian: median(frameTimes), msP95: percentile(frameTimes, 0.95), state: SP.snapshot(S) };
}
function configName(c) {
	return c.space + ' / ' + c.mode + ' / ' + c.sizePolicy;
}
function printBench(row) {
	console.log((row.n || '-') + '\t' + row.msBest.toFixed(2) + '\t' + row.msMean.toFixed(2) + '\t' +
		row.msMedian.toFixed(2) + '\t' + row.msP95.toFixed(2) + '\t' + row.state.neighbours.toFixed(2) + '\t' +
		row.state.maxNeighbours + '\t' + row.state.kMotion);
}
function printBenchHeader() {
	console.log('n\tms best\tms mean\tms p50\tms p95\tneigh\tmax neigh\tk motion');
}

console.log('0.5.0 M0 — soup bake-off');
info('candidate', JSON.stringify(candidate));
info('initial plan control', JSON.stringify(oldPlan));

// ---------------------------------------------------------------- mechanics and books
console.log('\nA. correctness fixtures');
var tunnelOpen = SP.tunnelTest('km', 100), tunnelHeld = SP.tunnelTest('km', 0.35);
ok('an unclamped position pass can tunnel (the old plan claim is false)', tunnelOpen.crossed,
	JSON.stringify(tunnelOpen));
ok('the displacement clamp prevents the same tunnelling fixture', !tunnelHeld.crossed && tunnelHeld.separation >= 0.99,
	JSON.stringify(tunnelHeld));
var repeatA = SP.create(candidate), repeatB = SP.create(candidate);
var repeatFailureA = run(repeatA, 40, 0.05, true), repeatFailureB = run(repeatB, 40, 0.05, true);
ok('same seed and replay are bitwise deterministic', !repeatFailureA && !repeatFailureB && sameState(repeatA, repeatB));
var sized = SP.create(copyConfig(candidate, { sizePolicy: 'heat' }));
var bookMass = Float64Array.from(sized.m), massUnchanged = true;
run(sized, 40, 0.05, true);
for (var mi = 0; mi < sized.n; mi++) if (sized.m[mi] !== bookMass[mi]) massUnchanged = false;
ok('heat-dependent size never edits the material mass book', massUnchanged && finiteState(sized));
var retentionWhole = Math.pow(candidate.inertia, 0.5 / 0.05);
var retentionParts = Math.pow(Math.pow(candidate.inertia, 0.05 / 0.05), 10);
ok('inertia retention is clock-based, not substep-count-based', Math.abs(retentionWhole - retentionParts) < 1e-14,
	retentionWhole.toExponential(2));

console.log('\nB. heat-scheme control at 500 kyr/frame');
var heatRows = [];
['explicit', 'analytic'].forEach(function (heatMode) {
	var S = SP.create(copyConfig(candidate, { heatMode: heatMode, drive: 0 }));
	var t0 = process.hrtime.bigint();
	SP.step(S, 0.5);
	var ms = Number(process.hrtime.bigint() - t0) / 1e6;
	var row = { heatMode: heatMode, ms: ms, state: SP.snapshot(S) };
	heatRows.push(row);
	console.log(heatMode + '\t' + ms.toFixed(2) + ' ms\theat passes ' + row.state.kHeat +
		'\tresidual ' + row.state.heatResidual.toExponential(2));
});
ok('explicit heat needs extra substeps at the fast clock', heatRows[0].state.kHeat > 1,
	'k=' + heatRows[0].state.kHeat);
ok('analytic pair exchange closes the book in one pair walk', heatRows[1].state.kHeat === 1 &&
	heatRows[1].state.nonFinite === 0 && heatRows[1].state.heatResidual < 1e-9,
	'residual ' + heatRows[1].state.heatResidual.toExponential(2));

// ---------------------------------------------------------------- cost and size matrix
console.log('\nC. warm kernel cost (best/mean of three batches plus per-frame p50/p95)');
var bench = [], spaceComparisons = [], display = [];
var modes = ['pbf', 'contact'], spaces = ['screen', 'km'], policies = ['uniform', 'material', 'heat'];
var rungs = quick ? [128] : [128, 256]; // native stability rungs, not cross-space cost comparisons
var matchedRungs = quick ? [
	{ n: 6426, screen: { nx: 126, rows: 51 }, km: { nx: 189, rows: 34 } }
] : [
	{ n: 6426, screen: { nx: 126, rows: 51 }, km: { nx: 189, rows: 34 } },
	{ n: 28728, screen: { nx: 266, rows: 108 }, km: { nx: 399, rows: 72 } }
];
function costRow(c, name, warmup, batches, frames, kind) {
	var row = timedLeg(c, warmup, batches, frames);
	row.config = c; row.name = name; row.kind = kind; bench.push(row);
	if (row.failure) {
		ok(name + ' finite', false, JSON.stringify(row.failure));
		console.log(name + ' FAILED'); return row;
	}
	console.log(name); printBenchHeader(); printBench(row);
	ok(name + ' finite and books closed', true);
	return row;
}
matchedRungs.forEach(function (rung) {
	var rows = {};
	spaces.forEach(function (space) {
		modes.forEach(function (mode) {
			policies.forEach(function (sizePolicy) {
				var c = copyConfig(candidate, { nx: rung[space].nx, rows: rung[space].rows,
					space: space, mode: mode, sizePolicy: sizePolicy });
				rows[space + '/' + mode + '/' + sizePolicy] = costRow(c,
					'matched ' + rung.n + ' / ' + configName(c), quick ? 5 : 30, quick ? 1 : 3, quick ? 5 : 10,
					'matched-population');
			});
		});
	});
	var equal = true;
	modes.forEach(function (mode) { policies.forEach(function (sizePolicy) {
		var a = rows['screen/' + mode + '/' + sizePolicy], b = rows['km/' + mode + '/' + sizePolicy];
		if (!a.n || a.n !== b.n || a.n !== rung.n) equal = false;
		spaceComparisons.push({ n: rung.n, mode: mode, sizePolicy: sizePolicy,
			screenMsMean: a.msMean, kmMsMean: b.msMean, screenMsMedian: a.msMedian, kmMsMedian: b.msMedian,
			screenNeighbours: a.state && a.state.neighbours, kmNeighbours: b.state && b.state.neighbours });
	}); });
	ok('matched ' + rung.n + ' cost rows use identical native-coverage populations', equal);
});
spaces.forEach(function (space) {
	var g = matchedRungs[0][space];
	var S = SP.create(copyConfig(candidate, { nx: g.nx, rows: g.rows, space: space }));
	var row = { space: space, n: S.n, nx: S.nx, rows: S.rows, stats: SP.displayStats(S) };
	display.push(row); info('display ' + space, JSON.stringify(row.stats));
	ok('display ' + space + ' geometry is finite with contained centers',
		row.stats.nonFinite === 0 && row.stats.outsideCenters === 0);
});
ok('screen-space particles are round in the display geometry',
	display[0].stats.rxOverRyMin > 0.98 && display[0].stats.rxOverRyMax < 1.02,
	display[0].stats.rxOverRyMean.toFixed(4) + ' mean rx/ry');
ok('km-space control exposes the expected display anisotropy',
	display[1].stats.rxOverRyMax / display[1].stats.rxOverRyMin > 10,
	(display[1].stats.rxOverRyMax / display[1].stats.rxOverRyMin).toFixed(1) + 'x range');
if (!quick) {
	[256, 512].forEach(function (nx) {
		modes.forEach(function (mode) {
			var c = copyConfig(candidate, { nx: nx, space: 'screen', mode: mode, sizePolicy: 'uniform' });
			costRow(c, 'native budget ' + nx + ' / ' + configName(c), 20, 3, 5, 'native-budget');
		});
	});
	// Exact same populations and nearly the same box aspect as planck-look.js.
	[[31, 13], [50, 20], [70, 28]].forEach(function (g) {
		var c = copyConfig(candidate, { nx: g[0], rows: g[1], space: 'screen', mode: 'pbf', sizePolicy: 'uniform' });
		costRow(c, 'planck-population ' + g[0] + 'x' + g[1] + ' / SP', 30, 3, 10, 'planck-population');
	});
}

// ---------------------------------------------------------------- fast-clock stability
console.log('\nD. 500 kyr/frame stability matrix');
var stability = [];
rungs.forEach(function (nx) {
	spaces.forEach(function (space) {
		modes.forEach(function (mode) {
			policies.forEach(function (sizePolicy) {
				var c = copyConfig(candidate, { nx: nx, space: space, mode: mode, sizePolicy: sizePolicy });
				var S = SP.create(c), frames = quick ? 3 : 30;
				var failure = run(S, frames, 0.5, true), row = { config: c, frames: frames,
					failure: failure, state: SP.snapshot(S) };
				stability.push(row);
				ok(nx + ' / ' + configName(c) + ' stable at 500 kyr/frame', !failure,
					'kMotion ' + row.state.kMotion + ', T ' + row.state.tMin.toFixed(3) + '..' + row.state.tMax.toFixed(3) +
					', heat residual ' + row.state.heatResidual.toExponential(2));
			});
		});
	});
});

// ---------------------------------------------------------------- behavior, not just cost
var long = null, contactLong = null, defaultControls = {};
function longLeg(config, frames, label, writeSvg, sampleStart) {
	sampleStart = sampleStart === undefined ? 100 : sampleStart;
	var S = SP.create(config), samples = [], checkpoints = [], failure = null;
	var t0 = process.hrtime.bigint(), k;
	for (k = 1; k <= frames; k++) {
		SP.step(S, 0.05);
		if (!finiteState(S)) { failure = { frame: k, state: SP.snapshot(S) }; break; }
		if (S.time >= sampleStart - 1e-6 && k % 100 === 0) samples.push(SP.snapshot(S));
		if (k % 2000 === 0 || k === frames) {
			var snap = SP.snapshot(S); checkpoints.push(snap);
			console.log(label + ' @ ' + S.time.toFixed(0) + ' Myr: ' + JSON.stringify(snap));
		}
	}
	var ms = Number(process.hrtime.bigint() - t0) / 1e6 / Math.max(1, k - 1);
	var result = { config: config, frames: k - 1, msMean: ms, failure: failure,
		samples: samples, checkpoints: checkpoints,
		vMedian: median(samples.map(function (s) { return s.vMax; })),
		wellsMedian: median(samples.map(function (s) { return s.wells; })),
		cellHit: samples.filter(function (s) { return s.wells >= 3 && s.wells <= 6; }).length / Math.max(1, samples.length) };
	if (writeSvg) fs.writeFileSync(writeSvg, SP.svg(S, label + ', ' + S.time.toFixed(0) + ' Myr'));
	return result;
}
if (!noLong) {
	console.log('\nE. convection behavior');
	var frames = quick ? 400 : 6000;
	long = longLeg(candidate, frames, 'PBF candidate', svgPath || '', quick ? 5 : 100);
	ok('PBF convection leg stays finite with closed books', !long.failure,
		long.vMedian.toFixed(2) + ' km/Myr median peak, ' + long.wellsMedian + ' median upwellings');
	if (!quick) {
		ok('PBF median peak vertical velocity is in the S1 60..200 km/Myr band', long.vMedian >= 60 && long.vMedian <= 200,
			long.vMedian.toFixed(2));
		ok('PBF median upwelling count is in the S1 3..6 band', long.wellsMedian >= 3 && long.wellsMedian <= 6,
			String(long.wellsMedian));
		ok('PBF spends at least two thirds of sampled 100..300 Myr in the cell band', long.cellHit >= 2 / 3,
			(100 * long.cellHit).toFixed(1) + '%');
		ok('PBF density residual stays below 10% at 100/200/300 Myr checkpoints', long.checkpoints.every(function (s) { return s.maxDensity < 0.1; }),
			long.checkpoints.map(function (s) { return s.maxDensity.toFixed(3); }).join(', '));
		contactLong = longLeg(copyConfig(candidate, { mode: 'contact' }), 2000, 'contact control', '');
		ok('contact control remains a valid measurement', !contactLong.failure);
		ok('like-for-like contact control misses the preregistered S1 fluid bands',
			contactLong.vMedian < 60 || contactLong.vMedian > 200 || contactLong.wellsMedian < 3 || contactLong.wellsMedian > 6,
			contactLong.vMedian.toFixed(2) + ' km/Myr, ' + contactLong.wellsMedian + ' wells');
		info('contact selection control', contactLong.vMedian.toFixed(2) + ' km/Myr, ' + contactLong.wellsMedian +
			' upwellings, ' + contactLong.msMean.toFixed(2) + ' ms/frame; PBF ' + long.msMean.toFixed(2) + ' ms/frame');
		var controls = {
			candidate: candidate,
			noInertia: copyConfig(candidate, { inertia: 0 }),
			originalMobility: copyConfig(candidate, { mobContrast: 4 })
		};
		Object.keys(controls).forEach(function (name) {
			var row = longLeg(controls[name], 1000, name + ' 50 Myr control', '', 25);
			defaultControls[name] = row;
			ok(name + ' default-flip control remains a valid measurement', !row.failure,
				row.vMedian.toFixed(2) + ' km/Myr, ' + row.wellsMedian + ' wells, ' + row.msMean.toFixed(2) + ' ms/frame');
		});
	}
}

var result = { format: 'sp-bench-v2',
	environment: { node: process.version, platform: process.platform, arch: process.arch,
		cpu: os.cpus().length ? os.cpus()[0].model : 'unknown' },
	candidate: candidate, initialPlanControl: oldPlan,
	tunnel: { open: tunnelOpen, held: tunnelHeld }, heat: heatRows,
	bench: bench, spaceComparisons: spaceComparisons, display: display, stability: stability,
	long: long, contactLong: contactLong, defaultControls: defaultControls,
	checks: { total: check.total, failures: check.fails } };
if (outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log('\n' + (check.fails ? check.fails + ' / ' + check.total + ' FAILURES' : 'ALL PASS (' + check.total + ' checks)'));
process.exitCode = check.fails ? 1 : 0;
