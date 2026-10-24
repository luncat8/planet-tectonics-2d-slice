// planck-smoke.js — vendored planck loads under node and its settled-contact cost is measured.
// This is the plain Box2D cost control, not the thermal look leg (planck-look.js). The first
// version of this fixture said "in a box" but created no walls and timed a falling cloud;
// M0 corrected it. Walls now keep the population in persistent contact after a warm-up.
// Run: node experiments/planck-smoke.js [--out file.json]
'use strict';

var fs = require('fs');
var path = require('path');
var pl = require(path.join(__dirname, 'vendor', 'planck-1.5.1.min.js'));
var World = pl.World, Vec2 = pl.Vec2, Circle = pl.Circle, Edge = pl.Edge;
var args = process.argv.slice(2), outIndex = args.indexOf('--out');
var outPath = outIndex >= 0 ? args[outIndex + 1] : '';

function leg(nx, ny, vel, pos, steps) {
	var width = nx * 1.1 + 2, height = ny * 1.1 + 8;
	var w = new World({ gravity: new Vec2(0, -10), allowSleep: false }), wall = w.createBody();
	wall.createFixture(Edge(new Vec2(-0.5 * width, -1), new Vec2(0.5 * width, -1)));
	wall.createFixture(Edge(new Vec2(-0.5 * width, height), new Vec2(0.5 * width, height)));
	wall.createFixture(Edge(new Vec2(-0.5 * width, -1), new Vec2(-0.5 * width, height)));
	wall.createFixture(Edge(new Vec2(0.5 * width, -1), new Vec2(0.5 * width, height)));
	var i, j, b, s, r, times = [], t0;
	for (i = 0; i < nx; i++) for (j = 0; j < ny; j++) {
		b = w.createBody({ type: 'dynamic', allowSleep: false,
			position: new Vec2((i - 0.5 * (nx - 1)) * 1.1, j * 1.1 + 1) });
		b.createFixture(Circle(0.5), { density: 1, friction: 0.3 });
	}
	for (s = 0; s < 120; s++) w.step(1 / 60, vel, pos);
	for (r = 0; r < 3; r++) {
		t0 = process.hrtime.bigint();
		for (s = 0; s < steps; s++) w.step(1 / 60, vel, pos);
		times.push(Number(process.hrtime.bigint() - t0) / 1e6 / steps);
	}
	var bad = 0, escaped = 0;
	for (b = w.getBodyList(); b; b = b.getNext()) {
		if (b.isStatic()) continue;
		var p = b.getPosition();
		if (!isFinite(p.x) || !isFinite(p.y)) bad++;
		if (Math.abs(p.x) > 0.5 * width + 0.6 || p.y < -1.6 || p.y > height + 0.6) escaped++;
	}
	return { bodies: nx * ny, vel: vel, pos: pos, msBest: Math.min.apply(Math, times),
		msMean: times.reduce(function (a, v) { return a + v; }, 0) / times.length,
		nonFinite: bad, escaped: escaped };
}

var rows = [
	[20, 20, 8, 3, 100],
	[40, 25, 8, 3, 60],
	[80, 50, 8, 3, 40],
	[80, 50, 4, 2, 40]
], results = [], ok = true;
console.log('settled planck contact cost, best/mean of three batches');
console.log('bodies   vel/pos   ms best   ms mean   nonfinite   escaped');
for (var i = 0; i < rows.length; i++) {
	var r = rows[i], result = leg(r[0], r[1], r[2], r[3], r[4]); results.push(result);
	console.log(String(result.bodies).padStart(6) + '   ' + result.vel + '/' + result.pos +
		'     ' + result.msBest.toFixed(2) + '      ' + result.msMean.toFixed(2) +
		'         ' + result.nonFinite + '           ' + result.escaped);
	if (result.nonFinite || result.escaped) ok = false;
}
console.log(ok ? 'PASS' : 'FAIL');
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ format: 'planck-smoke-v2', rows: results, valid: ok }, null, 2) + '\n');
process.exitCode = ok ? 0 : 1;
