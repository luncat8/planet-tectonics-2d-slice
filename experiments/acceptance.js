// acceptance.js — 0.2.0 M5: the whole-series acceptance pass. `0.2.0-plan.md` §2 lists
// seven claims; this harness is the one place all seven are decided, one section each, and
// it exits non-zero on any red. Where a claim is already owned by a milestone harness the
// claim is *delegated* — the owner runs as a child and its own PASS count is quoted, so
// there is no second implementation of any measurement (the rule isomorphism.js sets).
// The three claims no milestone harness owned (§2.2 the two clocks, §2.6 determinism,
// §2.7 stability) are measured here, against the engine's own kernels.
//
//   node experiments/acceptance.js [--fast]
//
// --fast skips the delegated suites and the two 500 Myr legs, for iteration only; an
// acceptance run is the whole file. Every delegated suite's output is kept by the caller
// in experiments/logs/0.2.0-m5-<suite>.txt.
'use strict';
var cp = require('child_process');
var os = require('os');
var path = require('path');
var L = require('./lib.js');
var check = L.check, M = L.mods;
var P = M.params, S = M.state, SIM = M.sim, GEO = M.geom, MAG = M.magma, ERUPT = M.erupt, R = M.render;

var FAST = process.argv.indexOf('--fast') >= 0;
var LITH = ['sed', 'fel', 'maf', 'tephra', 'lava', 'sill'];

// ---------------------------------------------------------------- delegated suites
// One child per owner. A suite that does not print ALL PASS is a red here, and its own
// failure lines are echoed so the log names the check, not just the suite.
function suite(name, args, why) {
	var r = cp.spawnSync(process.execPath, [path.join(__dirname, name)].concat(args || []),
		{ encoding: 'utf8', maxBuffer: 1 << 26 });
	var out = (r.stdout || '') + (r.stderr || '');
	var ms = out.match(/ALL PASS \((\d+) checks\)/g);   // last, not first: a delegated owner
	var m = ms ? ms[ms.length - 1] : null;                 // may print its own children's totals
	var fails = out.match(/^FAIL  .*$/gm);
	check.ok(name + (why ? ' — ' + why : ''), r.status === 0 && !!m,
		m || 'exit ' + r.status + (fails ? '\n      ' + fails.slice(0, 6).join('\n      ') : ''));
	return out;
}

// ---------------------------------------------------------------- §2.1 eruptions
check.section('§2.1 eruptions: 10–30 px edifices, conserved mass, readable beds, honest idling');
if (FAST) check.info('SKIP (--fast)', 'edifice-bench, vent-bench, erupt-bench');
else {
	suite('edifice-bench.js', [], 'one effusive and one explosive episode each build a 10–30 px edifice with conserved mass');
	suite('vent-bench.js', [], 'an empty chamber idles the toy; an over-full one builds sills, not a 17th vent');
	suite('erupt-bench.js', [], 'the toy box: repose cone, mass-exact freeze, packets land as tephra');
}

// ---------------------------------------------------------------- §2.2 the two clocks
check.section('§2.2 two clocks: an eruption is visible at 10 kyr/frame and never teleports at 100 kyr/frame');

// One live vent on a real planet, charged the way save-bench does it: the chamber is fed
// by MAG.add until the vent births, then the clock runs and the toy is watched.
function chargeVent() {
	var c = 0, f = 0, v;
	while (c < S.nCol && S.colGhost[c]) c++;
	MAG.add(S, c, P.VbirthM2 * 1.6, false);
	while (S.volc[c] < 0 && f++ < 60) MAG.k7(S, 0.05, SIM.t, SIM.Tm);
	v = S.volc[c];
	S.venGas[v] = 0.9;                       // a gas blast keeps packets airborne to watch
	return { c: c, v: v };
}

// The drawn surface of every column except the vent's own footprint, per frame. The
// eruptive clock may only ever write into the vent's column, so this background is the
// control: it must not differ between an erupting leg and a paused one.
function clockLeg(kyrPerFrame, eruptSec) {
	P.sl.geo = kyrPerFrame * 1e3;
	P.sl.erupt = eruptSec;
	check.planet(7, 'def');
	SIM.setGeo(kyrPerFrame * 1e3);
	var w = chargeVent(), c = w.c, v = w.v;
	var prevZ = new Float64Array(P.colCap), prevVenX = -1;
	var i, f, bg = 0, bgX = 0, ventMove = 0, packetMax = 0, airborne = 0, pile = 0, riding = true, dx;
	for (i = 0; i < S.nCol; i++) prevZ[i] = GEO.sy(S.z[i]);
	for (f = 0; f < 400; f++) {
		SIM.step();
		for (i = 0; i < S.nCol; i++) {
			var dz = Math.abs(GEO.sy(S.z[i]) - prevZ[i]);
			prevZ[i] = GEO.sy(S.z[i]);
			// the vent's own footprint: its column and the two on each side (the write-back
			// and the one-hop routing target are the eruption's own territory)
			if (Math.abs(i - c) <= 2 || Math.abs(i - c) >= S.nCol - 2) continue;
			if (dz > bg) { bg = dz; bgX = S.colX[i]; }
		}
		if (S.venCol[v] >= 0) {
			riding = riding && S.venX[v] === S.colX[S.venCol[v]];
			// the edifice's own position, not its column slot: the gather renumbers slots
			// every frame, so only venX is the same object from one frame to the next
			if (prevVenX >= 0) {
				dx = S.venX[v] - prevVenX;
				if (dx > P.wrap * 0.5) dx -= P.wrap;
				else if (dx < -P.wrap * 0.5) dx += P.wrap;
				ventMove = Math.max(ventMove, Math.abs(dx));
			}
			prevVenX = S.venX[v];
		}
		airborne = Math.max(airborne, S.prN[v]);
		for (i = 0; i < P.ventBoxW; i++) pile = Math.max(pile, S.toyH[v * P.ventBoxW + i]);
		packetMax = Math.max(packetMax, ERUPT.mass(v));
	}
	return { bg: bg, bgX: bgX, ventMove: ventMove, riding: riding, airborne: airborne,
		pile: pile, mass: packetMax, v: v, c: c };
}

var slow = clockLeg(10, 1800);               // 10 kyr/frame beside 30 min/frame
var paused = clockLeg(10, 0);                // the same leg with the lava clock stopped
check.ok('§2.2a a visible eruption at 10 kyr/frame beside 30 min/frame',
	slow.airborne > 0 && slow.pile > 0,
	slow.airborne + ' packets airborne at once, pile ' + slow.pile.toFixed(2) +
	' cells, ' + slow.mass.toFixed(2) + ' cells2 in flight');
check.ok('§2.2a the crust away from the vent does not move because of the lava clock',
	slow.bg <= paused.bg * 1.000001,
	'erupting background ' + slow.bg.toFixed(4) + ' px vs ' + paused.bg.toFixed(4) +
	' px with the lava clock paused (worst at ' + (slow.bgX / 1e3).toFixed(1) + ' km)');

var fast = clockLeg(100, 1800);              // 100 kyr/frame: the eruption must ride, not jump
var plateStep = P.vMax * 100e3 / 1e6;        // m the fastest plate may move in one frame
check.ok('§2.2b the edifice stays on its own column at 100 kyr/frame', fast.riding,
	'venX followed colX on all 400 frames');
check.ok('§2.2b the eruption moves no faster than the crust under it',
	fast.ventMove <= plateStep * 1.0000001,
	'worst vent move ' + (fast.ventMove / 1e3).toFixed(2) + ' km/frame, plate ceiling ' +
	(plateStep / 1e3).toFixed(1) + ' km/frame at 100 kyr');

// ---------------------------------------------------------------- §2.3 deposits
check.section('§2.3 deposits: arc mass under arc columns, placer downslope, VMS on buried seafloor');
if (FAST) check.info('SKIP (--fast)', 'ore-bench, isomorphism');
else {
	suite('ore-bench.js', [], '> 60% of arc resource mass under the arc factories; placer routing; finite extraction');
	// pinned to the fixture leg (argv beats $UPSTREAM, and a path that does not exist is
	// the same leg everywhere): the acceptance pass must not change with an optional
	// upstream checkout. The live leg is its own harness, log 0.2.0-m5-isomorphism-live.txt.
	suite('isomorphism.js', [path.join(os.tmpdir(), 'acceptance-no-upstream')],
		'the deposit core is the counterpart\'s own numbers (the shared priors and the draw replay)');
}

// ---------------------------------------------------------------- §2.4 save/load and the HUD
check.section('§2.4 save/load resumes bitwise and the diagnostic invariants hold at 2 Hz');
if (FAST) check.info('SKIP (--fast)', 'save-bench, diag-ui');
else {
	suite('save-bench.js', [], 'save -> reload -> 1000 frames bitwise at three zooms with an eruption in flight');
	suite('diag-ui.js', [], 'each of the five invariants fires on its own injected fault and heals');
}

// The HUD samples the sweep on its own 2 Hz cadence, which on a 60 fps page is every ~30
// frames; this samples every frame, so a one-frame window cannot hide (0.2.0 M5: that is
// how the sorted and gap reds were found).
function k9Sweep(frames, kyrPerFrame, eruptSec, seed) {
	P.sl.geo = kyrPerFrame * 1e3;
	P.sl.erupt = eruptSec;
	check.planet(seed, 'def');
	SIM.setGeo(kyrPerFrame * 1e3);
	var f, d, red = 0, firstRed = -1, worst = 0, worstLi = 0, nonFinite = 0, key, a, i;
	for (f = 0; f < frames; f++) {
		SIM.step();
		d = SIM.diag();
		if (!d.ok) { red++; if (firstRed < 0) firstRed = f + 1; }
		if (d.worst > worst) { worst = d.worst; worstLi = d.worstLi; }
		if (f % 25 === 0) {
			for (key in S) {
				a = S[key];
				if (!ArrayBuffer.isView(a)) continue;
				for (i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nonFinite++; i = a.length; }
			}
		}
	}
	return { red: red, firstRed: firstRed, worst: worst, worstLi: worstLi, nonFinite: nonFinite };
}

// ---------------------------------------------------------------- §2.6 determinism
check.section('§2.6 determinism: same seed and same sliders give a bitwise-identical 1000-frame hash');
function run1000(seed, kyrPerFrame, eruptSec, preset) {
	P.sl.geo = kyrPerFrame * 1e3;
	P.sl.erupt = eruptSec;
	check.planet(seed, preset);
	SIM.setGeo(kyrPerFrame * 1e3);
	return SIM.run(1000);
}
var legs6 = [[1, 50, 1800, 'def'], [1, 100, 14400, 'def'], [5, 10, 30, 'ovw']];
legs6.forEach(function (leg) {
	var a = run1000(leg[0], leg[1], leg[2], leg[3]);
	var b = run1000(leg[0], leg[1], leg[2], leg[3]);
	check.ok('§2.6 seed ' + leg[0] + ', ' + leg[1] + ' kyr/frame, ' + leg[2] + ' s/frame, ' + leg[3] +
		': two independent 1000-frame runs agree bitwise', a === b, 'hash ' + a);
});
var other = run1000(2, 50, 1800, 'def'), same = run1000(1, 50, 1800, 'def');
check.ok('§2.6 the hash is not vacuous: a different seed diverges', other !== same,
	'seed 1 ' + same + ' vs seed 2 ' + other);

// ---------------------------------------------------------------- §2.7 stability
check.section('§2.7 stability: 500 Myr at 10 kyr/frame and at 100 kyr/frame, finite and balanced');
function stability(kyrPerFrame, label) {
	var frames = Math.round(500 / (kyrPerFrame / 1e3));
	var r = FAST ? null : k9Sweep(frames, kyrPerFrame, 1800, 1);
	if (FAST) { check.info('SKIP (--fast)', label + ': ' + frames + ' frames'); return; }
	check.ok('§2.7 ' + label + ': every buffer stays finite', r.nonFinite === 0,
		frames + ' frames (' + (frames * kyrPerFrame / 1e3).toFixed(0) + ' Myr), sampled every 25 frames');
	check.ok('§2.7 ' + label + ': the per-lithology ledger stays inside 0.1%', r.worst < 1e-3,
		'worst ' + r.worst.toExponential(2) + ' on ' + LITH[r.worstLi] + ' (the K9 sweep holds 1e-9)');
	check.ok('§2.7 ' + label + ': the K9 invariants hold on every frame', r.red === 0,
		r.red + ' red frames' + (r.red ? ', first at ' + r.firstRed : ''));
}
stability(10, '10 kyr/frame');
stability(100, '100 kyr/frame');

// The §2.4 claim about the HUD is the same sweep over the same distance, so it is measured
// once and quoted in both places.
var hudRun = FAST ? null : k9Sweep(3000, 50, 14400, 5);
if (!FAST) check.ok('§2.4 the invariants hold at 2 Hz over a long combined-clock run',
	hudRun.red === 0 && hudRun.nonFinite === 0,
	'3000 frames (150 Myr) at 50 kyr/frame with the lava clock at its maximum, ' +
	hudRun.red + ' red frames, worst ledger ' + hudRun.worst.toExponential(2));

// ---------------------------------------------------------------- §2.5 regression
check.section('§2.5 regression: the 0.1.5 harness set stays green and the body raster fits 6 ms');
if (FAST) check.info('SKIP (--fast)', 'the nine harnesses and the four strict contact legs');
else {
	['m2-check.js', 'm3-check.js', 'ledger-check.js', 'smoke.js', 'scale-check.js',
		'view-check.js', 'section-check.js'].forEach(function (name) { suite(name); });
	// The rest of the standing log set: the exchange codec, the cut and its page. Not in
	// §2.5's 0.1.5 list, but they read the same state and a red there is a red here.
	['checkpoint.js', 'section-pack.js', 'section-seed.js', 'slice-cut.js', 'coupling.js',
		'coupling-link.js', 'core-log.js', 'deposits.js', 'port-check.js', 'ore-ui.js',
		'pt-ui.js', 'r4-check.js', 'section-bundle.js'].forEach(function (name) { suite(name); });
	var raster = suite('raster-bench.js', [], 'the body raster inside the 6 ms budget');
	var bodies = raster.match(/PASS  .*body raster <= 6 ms\s+([0-9.]+) ms/g) || [];
	check.ok('§2.5 the body raster is inside 6 ms at every preset', bodies.length >= 3,
		bodies.length + ' presets timed: ' + bodies.map(function (s) {
			return /([0-9.]+) ms$/.exec(s)[1];
		}).join(' / ') + ' ms');
	[[3000, 1, 50], [3000, 1, 100], [5000, 5, 50], [5000, 5, 100]].forEach(function (leg) {
		suite('contact-audit.js', [String(leg[0]), String(leg[1]), String(leg[2]), '--strict'],
			leg[0] + ' frames, seed ' + leg[1] + ', ' + leg[2] + ' kyr/frame');
	});
}

check.done();
