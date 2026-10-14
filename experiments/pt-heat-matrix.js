// 0.3.2 M2 clock/seed matrix: every cell is a fresh child of experiments/pt-heat-tail.js (one
// world per process, so no cell can lean on its neighbour) and is gated on every frame's books,
// not on HUD samples or an end-of-leg reading. The 600 Myr seed-5 cell rides in the default set
// because it is the only one that has ever shown the two 0.3.x defects that live past 300 Myr.
//
// node experiments/pt-heat-matrix.js [--cells seed:kyr:myr,...] [--kind baseline] [--value v]
//      [--scope dep|solid] [-j 2]
// Default cells: seeds 1,2,3,5,7 at 10/50/100/500 kyr over 300 Myr, then seed 5 at 50 kyr over
// 600 Myr; the first cell runs twice and must repeat bitwise. HEAT_MATRIX_OUT=path banks the
// cell records (JSON). Frame time is reported, never gated: cells run concurrently.
//
// Gates per cell (all every frame unless stated):
//   books      mass < 1e-9 rel, enthalpy against the recorded intake < 1e-9 rel, and at the end
//              the deposit and melt books within 1e-6 km2 (three orders over their round-off)
//   latent     the P3.1 identity |hLedger - ledger - L (invLTot - invL0)| < 1e-10 of the larger
//              of the two books it is the difference of (pt-heat-tail.js latentBook); the plan's
//              floor-1 metric is printed beside it
//   wall       worst cumulative |intake/wall - 1| < 0.01, pt-p4-check.js's long-leg gate
//   T, per phase  finite, and -0.5 <= T <= 1.5 at every frame end, one check per phase
//   route      zero refusals; every deposit transfer reconciles to thr.depMelt and tx.depMelt
//              and had field support at the moment of routing
'use strict';
var path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
var RUNNER = path.join(__dirname, 'pt-heat-tail.js');
var PHASES = ['mantle', 'melt', 'air', 'dep'];

function arg(name, fallback) {
	var i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : fallback;
}
function defaultCells() {
	var cells = [], seeds = [1, 2, 3, 5, 7], clocks = [10, 50, 100, 500];
	clocks.forEach(function (kyr) { seeds.forEach(function (seed) { cells.push({ seed: seed, kyr: kyr, myr: 300 }); }); });
	cells.push({ seed: 5, kyr: 50, myr: 600 });
	return cells;
}
function parseCells(text) {
	return text.split(',').map(function (c) {
		var b = c.split(':');
		return { seed: +b[0], kyr: b[1] === undefined ? 50 : +b[1], myr: b[2] === undefined ? 300 : +b[2] };
	});
}
var kind = arg('--kind', 'baseline'), value = arg('--value', kind === 'baseline' ? '0' : undefined);
var scope = arg('--scope', 'solid'), jobs = Math.max(1, +arg('-j', 2));
var cells = process.argv.includes('--cells') ? parseCells(arg('--cells')) : defaultCells();
cells.forEach(function (c) {
	if (!(c.seed > 0) || !(c.kyr > 0) || !(c.myr > 0)) throw new Error('invalid cell ' + JSON.stringify(c));
});
var runs = cells.map(function (c, i) { return { cell: c, index: i, repeat: false }; });
runs.splice(1, 0, { cell: cells[0], index: 0, repeat: true });

function label(c) { return 'seed ' + c.seed + ' at ' + c.kyr + ' kyr/frame over ' + c.myr + ' Myr'; }

function runOne(run) {
	return new Promise(function (resolve) {
		var out = path.join(os.tmpdir(), 'pt-heat-matrix-' + process.pid + '-' + run.index + (run.repeat ? 'r' : '') + '.json');
		var argv = [RUNNER, kind, String(value), String(run.cell.myr), '--seed', String(run.cell.seed),
			'--kyr', String(run.cell.kyr), '--scope', scope];
		var t0 = Date.now();
		var child = cp.spawn(process.execPath, argv, { env: Object.assign({}, process.env, { HEAT_TAIL_OUT: out }),
			stdio: ['ignore', 'ignore', 'pipe'] });
		var err = '';
		child.stderr.on('data', function (d) { err += d; });
		child.on('close', function (code) {
			var r = null;
			if (code === 0) { r = JSON.parse(fs.readFileSync(out, 'utf8')); fs.unlinkSync(out); }
			resolve({ run: run, code: code, err: err, r: r, seconds: (Date.now() - t0) / 1000 });
		});
	});
}

function pool(list, n) {
	var results = new Array(list.length), next = 0;
	function worker() {
		if (next >= list.length) return Promise.resolve();
		var k = next++;
		return runOne(list[k]).then(function (res) {
			results[k] = res;
			process.stderr.write('  done ' + label(res.run.cell) + (res.run.repeat ? ' (repeat)' : '') + ', '
				+ res.seconds.toFixed(0) + ' s\n');
			return worker();
		});
	}
	var ws = [];
	for (var i = 0; i < n; i++) ws.push(worker());
	return Promise.all(ws).then(function () { return results; });
}

var pass = 0, fail = 0;
function check(ok, name, detail) {
	if (ok) pass++; else fail++;
	console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '   ' + detail);
}
function e3(x) { return x === null || x === undefined ? 'n/a' : (+x).toExponential(2); }

function gateCell(res) {
	var c = res.run.cell, r = res.r, L = label(c);
	if (!r) { check(false, L + ' completes', 'exit ' + res.code + ' ' + res.err.slice(-400)); return; }
	console.log('INFO  ' + L + '   fingerprint ' + r.fingerprint + '; ' + r.frames + ' frames; T dep '
		+ r.minT[3].toFixed(3) + '..' + r.maxT[3].toFixed(3) + ', mantle ' + r.minT[0].toFixed(3) + '..'
		+ r.maxT[0].toFixed(3) + '; held back ' + r.heldSamples + ' samples / ' + r.heldMassTime.toFixed(2)
		+ ' km2 Myr; deposit transfers ' + r.depTx + ' / ' + r.depMelt.toFixed(6) + ' km2; mantle routings '
		+ r.mantleRoutes + '; ' + r.msFrame.toFixed(2) + ' ms/frame (concurrent, not gated); ' + res.seconds.toFixed(0) + ' s');
	check(r.mass < 1e-9 && r.enthalpy < 1e-9 && Math.abs(r.depositBook) < 1e-6 && Math.abs(r.meltBook) < 1e-6,
		L + ' closes its books on every frame', 'mass ' + e3(r.mass) + ', enthalpy ' + e3(r.enthalpy)
		+ ', deposit ' + e3(r.depositBook) + ' km2, melt ' + e3(r.meltBook) + ' km2');
	check(r.latentBook < 1e-10, L + ' holds the P3.1 latent identity on every frame',
		'worst ' + e3(r.latentBook) + ' of its books at frame ' + r.latentBookFrame + ', largest residual '
		+ e3(r.latentAbsMax) + ' km2*H; plan floor-1 metric ' + e3(r.latent) + ' (frame ' + r.latentWorstFrame + ')');
	check(r.intakeWallWorst < 0.01, L + ' keeps the intake on the operator\'s wall flux',
		'worst |intake/wall - 1| ' + e3(r.intakeWallWorst) + ', end ' + e3(r.intakeWallEnd)
		+ ' (historical 5e-5 reference ' + (r.intakeWallWorst < 5e-5 ? 'met' : 'not met') + ')');
	PHASES.forEach(function (name, ph) {
		var seen = r.minT[ph] !== null && r.minT[ph] <= r.maxT[ph];
		check(r.nonfinite === 0 && r.outsideSamples[ph] === 0, L + ' keeps every ' + name + ' parcel inside -0.5..1.5',
			(seen ? 'T ' + r.minT[ph].toFixed(3) + '..' + r.maxT[ph].toFixed(3) : 'no parcels') + ', '
			+ r.outsideSamples[ph] + ' parcel-frame samples outside' + (r.nonfinite ? ', ' + r.nonfinite + ' non-finite' : ''));
	});
	var shed = r.events.reduce(function (s, e) { return s + e.melt; }, 0);
	var unsupported = r.events.filter(function (e) { return e.field < e.solidus; }).length;
	check(r.refuse === 0 && r.events.length === r.depTx && Math.abs(shed - r.depMelt) < 1e-9 && unsupported === 0,
		L + ' routes deposits only with field support, all accounted', r.depTx + ' transfers, '
		+ shed.toFixed(6) + ' km2 against thr.depMelt ' + r.depMelt.toFixed(6) + ', ' + unsupported
		+ ' without support, ' + r.refuse + ' refusals');
}

function sameRun(a, b) {
	var keys = ['fingerprint', 'mass', 'enthalpy', 'latent', 'latentBook', 'intakeWallWorst', 'heldSamples',
		'heldMassTime', 'depMelt', 'depTx', 'mantleRoutes', 'refuse'];
	return keys.every(function (k) { return a[k] === b[k]; })
		&& JSON.stringify([a.minT, a.maxT, a.outsideSamples, a.events]) === JSON.stringify([b.minT, b.maxT, b.outsideSamples, b.events]);
}

console.log('0.3.2 M2 clock/seed matrix: ' + cells.length + ' cells + one repeat, candidate ' + kind
	+ (kind === 'baseline' ? '' : ' ' + value + (kind === 'relaxw' || kind === 'subgrid' ? ' (scope ' + scope + ')' : ''))
	+ ', ' + jobs + ' concurrent, all shipped P3/P4 passes, pure FLIP');
var started = Date.now();
pool(runs, jobs).then(function (results) {
	var first = results[0], again = results[1];
	results.forEach(function (res) { if (!res.run.repeat) gateCell(res); });
	check(first.r && again.r && sameRun(first.r, again.r), 'the first cell repeats bitwise, so no cell depends on its neighbours',
		'fingerprint ' + (first.r && first.r.fingerprint) + ' / ' + (again.r && again.r.fingerprint));
	var bank = results.filter(function (res) { return !res.run.repeat && res.r; }).map(function (res) { return res.r; });
	var worst = { latent: 0, wall: 0, depHot: -Infinity, depCold: Infinity };
	bank.forEach(function (r) {
		worst.latent = Math.max(worst.latent, r.latentBook); worst.wall = Math.max(worst.wall, r.intakeWallWorst);
		worst.depHot = Math.max(worst.depHot, r.maxT[3]); worst.depCold = Math.min(worst.depCold, r.minT[3]);
	});
	console.log('INFO  matrix   worst latent ' + e3(worst.latent) + ' of its books, worst intake/wall ' + e3(worst.wall)
		+ ', deposit T ' + worst.depCold.toFixed(3) + '..' + worst.depHot.toFixed(3) + ', ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
	if (process.env.HEAT_MATRIX_OUT) fs.writeFileSync(process.env.HEAT_MATRIX_OUT, JSON.stringify(bank, null, '\t') + '\n');
	console.log(fail ? 'FAIL (' + fail + ' of ' + (pass + fail) + ')' : 'ALL PASS (' + pass + ')');
	process.exitCode = fail ? 1 : 0;
});
