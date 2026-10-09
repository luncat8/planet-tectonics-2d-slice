// floor-bench.js — 0.2.1: what COL.floor's settle actually costs, and whether it settles.
// The contact floor is a max-push Jacobi sweep over plates, so a ring of squeezed plates
// converges geometrically (measured ratio ~0.87 per pass) and the pass budget in
// P.floorPass is the only thing that stops it. Two numbers decide whether that budget is
// right, and neither is visible from a PASS/FAIL elsewhere:
//
//   - the passes the settle needs. If any call reaches P.floorPass it did not settle, and
//     the frame ends inside a contact floor (this is the 0.2.1 defect: a 9.15 km gap
//     standing against its 9.38 km floor for 90-118 frames);
//   - the worst gap the solve leaves behind, against the tolerance SIM.diag applies.
//
// The legs are the two that reproduce the squeeze (seeds 1 and 4 at 100 kyr/frame — the
// defect showed on one or the other at every plume rate tried) plus a 50 kyr control.
//
//   node experiments/floor-bench.js [frames=5000] [floorTol] [floorPass]
//
// The two overrides are for demonstrating the 0.2.1 defect, not for tuning it. `0 16`
// asks the solver and the diagnostic to both demand exact equality, which is what the sweep
// could never satisfy: it fails by design, and its pass histogram is the spin that ate the
// old budget (68-79% of frames exhausting 16 passes). It is NOT the pre-fix engine, whose
// solver was exact while its diagnostic allowed floorTol.
'use strict';
var L = require('./lib.js');
var check = L.check, P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, COL = L.mods.columns;

var frames = +(process.argv[2] || 5000);
if (process.argv[3] !== undefined) P.floorTol = +process.argv[3];
if (process.argv[4] !== undefined) P.floorPass = +process.argv[4];
var LEGS = [[1, 100], [4, 100], [1, 50]];
var floor = P.gFloor * P.w0, lo = floor * (1 - P.floorTol);

check.section('COL.floor settles inside its pass budget on every frame');
check.info('configuration', 'floorTol ' + P.floorTol + ', floorPass ' + P.floorPass +
	(P.floorTol === 0 ? ' (the pre-fix engine: this leg is expected to fail)' : ''));
var worstAll = 0, redAll = 0, capAll = 0;
LEGS.forEach(function (leg) {
	var seed = leg[0], kyr = leg[1];
	P.sl.geo = kyr * 1e3;
	P.sl.erupt = 1800;
	check.planet(seed, 'def');
	SIM.setGeo(kyr * 1e3);

	var hist = new Int32Array(P.floorPass + 1), maxPass = 0, atCap = 0;
	var red = 0, firstRed = -1, worstGap = Infinity, f, d, p, t0 = Date.now();
	for (f = 0; f < frames; f++) {
		SIM.step();
		p = COL.floorPasses;
		hist[p]++;
		if (p > maxPass) maxPass = p;
		if (p >= P.floorPass) atCap++;
		d = SIM.diag();
		if (d.minGap < worstGap) worstGap = d.minGap;
		if (!d.ok) { red++; if (firstRed < 0) firstRed = f; }
	}

	var ms = Date.now() - t0, settled = 0, i;
	for (i = 1; i <= P.floorPass; i++) settled += hist[i];
	var band = '';
	[[1, 1], [2, 2], [3, 4], [5, 8], [9, 16], [17, 32], [33, P.floorPass]].forEach(function (b) {
		var n = 0;
		for (i = b[0]; i <= b[1]; i++) n += hist[i];
		if (n) band += (band ? ', ' : '') + (b[0] === b[1] ? b[0] : b[0] + '-' + b[1]) + ': ' +
			(100 * n / frames).toFixed(1) + '%';
	});
	check.info('seed ' + seed + ' at ' + kyr + ' kyr/frame: passes used by the frame\'s last settle',
		band + ' (' + frames + ' frames, cap ' + P.floorPass + ', ' +
		(ms / frames).toFixed(3) + ' ms/frame incl. the diag sweep)');
	check.ok('seed ' + seed + ' at ' + kyr + ' kyr/frame: no settle ran out of passes',
		atCap === 0, atCap + ' of ' + frames + ' frames hit the cap; worst ' + maxPass + ' passes');
	check.ok('seed ' + seed + ' at ' + kyr + ' kyr/frame: every ordinary contact holds its floor',
		worstGap >= lo, 'worst gap ' + (worstGap / 1e3).toFixed(4) + ' km against the floor ' +
		(floor / 1e3).toFixed(4) + ' km, tolerance ' + (lo / 1e3).toFixed(4));
	check.ok('seed ' + seed + ' at ' + kyr + ' kyr/frame: the K9 invariants hold on every frame',
		red === 0, red + ' red frames' + (red ? ', first at ' + firstRed : ''));
	if (maxPass > worstAll) worstAll = maxPass;
	redAll += red;
	capAll += atCap;
});

check.ok('the pass budget has margin over the worst settle measured',
	worstAll * 2 <= P.floorPass, 'worst ' + worstAll + ' passes against a cap of ' + P.floorPass);
check.ok('no leg recorded a red frame or an exhausted settle', redAll === 0 && capAll === 0,
	redAll + ' red frames, ' + capAll + ' exhausted settles over ' + (LEGS.length * frames) + ' frames');

check.done();
