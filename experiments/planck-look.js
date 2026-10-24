// planck-look.js — 0.5.0 M0's actual circles + temperature + lift reference.
// The older planck-smoke leg is a settling cost curve. This leg has walls, persistent
// contacts, contact conduction, hot-bottom/cold-top relaxation and thermal lift, and writes
// the snapshot that the bake-off's look comparison reads. Pages never load planck.
'use strict';

var fs = require('fs');
var path = require('path');
var pl = require(path.join(__dirname, 'vendor', 'planck-1.5.1.min.js'));
var Vec2 = pl.Vec2, Circle = pl.Circle, Edge = pl.Edge;
var args = process.argv.slice(2), quick = args.indexOf('--quick') >= 0;
function argValue(name) {
	var i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
}
var outPath = argValue('--out'), svgPath = argValue('--svg');

function create(nx, ny) {
	var spacing = 1.05, radius = 0.5, width = nx * spacing + 1, height = ny * spacing + 1;
	var w = new pl.World({ gravity: new Vec2(0, -10), allowSleep: false });
	var wall = w.createBody();
	wall.createFixture(Edge(new Vec2(-0.5 * width, 0), new Vec2(0.5 * width, 0)));
	wall.createFixture(Edge(new Vec2(-0.5 * width, height), new Vec2(0.5 * width, height)));
	wall.createFixture(Edge(new Vec2(-0.5 * width, 0), new Vec2(-0.5 * width, height)));
	wall.createFixture(Edge(new Vec2(0.5 * width, 0), new Vec2(0.5 * width, height)));
	var bodies = [], T = new Float64Array(nx * ny), i, j, b, x, y;
	for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
		x = (i - 0.5 * (nx - 1)) * spacing; y = 0.75 + j * spacing;
		b = w.createBody({ type: 'dynamic', allowSleep: false, position: new Vec2(x, y) });
		b.createFixture(Circle(radius), { density: 1, friction: 0.25 });
		b.__thermalIndex = bodies.length; bodies.push(b);
		T[b.__thermalIndex] = Math.max(0, Math.min(1, 1 - y / height +
			0.08 * Math.sin(Math.PI * y / height) * Math.cos(2 * Math.PI * 4 * x / width)));
	}
	return { world: w, bodies: bodies, T: T, width: width, height: height,
		radius: radius, nx: nx, ny: ny, steps: 0, lift: new Vec2(0, 0) };
}

function step(S, dt) {
	var i, b, m, c, a, d, p, q, Ti, Tj;
	for (i = 0; i < S.bodies.length; i++) {
		b = S.bodies[i]; m = b.getMass();
		S.lift.y = 20 * m * S.T[i];       // gravity -10 plus this: cold sinks, hot rises
		b.applyForceToCenter(S.lift, true);
	}
	// Exact equal-capacity exchange across each touching contact. Sequential convex pair
	// updates are deterministic and cannot overshoot, matching the custom solver's control.
	for (c = S.world.getContactList(); c; c = c.getNext()) {
		if (!c.isTouching()) continue;
		p = c.getFixtureA().getBody().__thermalIndex;
		q = c.getFixtureB().getBody().__thermalIndex;
		if (p === undefined || q === undefined) continue;
		Ti = S.T[p]; Tj = S.T[q]; a = 0.5 * (1 - Math.exp(-dt / 0.2));
		S.T[p] = Ti + a * (Tj - Ti); S.T[q] = Tj + a * (Ti - Tj);
	}
	for (i = 0; i < S.bodies.length; i++) {
		b = S.bodies[i]; d = b.getPosition().y;
		var target = d < 1.5 ? 1 : (d > S.height - 1.5 ? 0 : -1);
		if (target < 0) continue;
		a = 1 - Math.exp(-dt / 0.1); S.T[i] += a * (target - S.T[i]);
	}
	S.world.step(dt, 8, 3); S.steps++;
}

function run(S, steps) { for (var i = 0; i < steps; i++) step(S, 1 / 60); }
function diagnostics(S) {
	var bad = 0, escaped = 0, vMax = 0, i, b, p, v, colV = new Float64Array(64), colN = new Int32Array(64);
	for (i = 0; i < S.bodies.length; i++) {
		b = S.bodies[i]; p = b.getPosition(); v = b.getLinearVelocity();
		if (!isFinite(p.x + p.y + v.x + v.y + S.T[i])) bad++;
		if (Math.abs(p.x) > 0.5 * S.width + 0.6 || p.y < -0.6 || p.y > S.height + 0.6) escaped++;
		vMax = Math.max(vMax, Math.abs(v.y));
		var col = Math.max(0, Math.min(63, Math.floor((p.x / S.width + 0.5) * 64)));
		colV[col] += v.y; colN[col]++;
	}
	for (i = 0; i < 64; i++) colV[i] = colN[i] ? colV[i] / colN[i] : 0;
	var transitions = 0, first = 0, prev = 0, sign;
	for (i = 0; i < 64; i++) {
		sign = colV[i] > 1e-4 ? 1 : (colV[i] < -1e-4 ? -1 : 0);
		if (!sign) continue;
		if (first && sign !== prev) transitions++;
		if (!first) first = sign;
		prev = sign;
	}
	if (first && prev !== first) transitions++;
	return { bodies: S.bodies.length, steps: S.steps, nonFinite: bad, escaped: escaped,
		vMax: vMax, wells: transitions >> 1 };
}
function timed(nx, ny) {
	var S = create(nx, ny), warm = quick ? 30 : 240, batches = quick ? 1 : 3, steps = quick ? 20 : 60;
	run(S, warm);
	var times = [], b, t0;
	for (b = 0; b < batches; b++) {
		t0 = process.hrtime.bigint(); run(S, steps);
		times.push(Number(process.hrtime.bigint() - t0) / 1e6 / steps);
	}
	return { state: S, msBest: Math.min.apply(Math, times),
		msMean: times.reduce(function (a, v) { return a + v; }, 0) / times.length,
		diag: diagnostics(S) };
}
function svg(S, title) {
	var W = 1280, H = Math.round(W * S.height / S.width), out = [
		'<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">',
		'<rect width="100%" height="100%" fill="#080d18"/>',
		'<text x="12" y="22" fill="#dbe7ff" font-family="monospace" font-size="14">' + title + '</text>'];
	for (var i = 0; i < S.bodies.length; i++) {
		var p = S.bodies[i].getPosition(), T = Math.max(0, Math.min(1, S.T[i]));
		var cx = (p.x / S.width + 0.5) * W, cy = (1 - p.y / S.height) * H;
		var rr = S.radius / S.width * W, r = Math.round(255 * Math.min(1, 2 * T));
		var b = Math.round(255 * Math.min(1, 2 * (1 - T))), g = Math.round(150 * (1 - Math.abs(2 * T - 1)) + 30);
		out.push('<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="' + rr.toFixed(2) + '" fill="rgb(' + r + ',' + g + ',' + b + ')"/>');
	}
	out.push('</svg>'); return out.join('\n');
}

// These populations and box aspects match the three small native screen-space SP rows
// in sp-bench.js exactly: 403, 1,000 and 1,960 circles.
var rows = quick ? [[31, 13]] : [[31, 13], [50, 20], [70, 28]], results = [];
console.log('0.5.0 M0 — planck thermal look reference\nbodies\tms best\tms mean\tv max\twells\tnonfinite\tescaped');
for (var z = 0; z < rows.length; z++) {
	var row = timed(rows[z][0], rows[z][1]); results.push(row);
	console.log(row.diag.bodies + '\t' + row.msBest.toFixed(2) + '\t' + row.msMean.toFixed(2) + '\t' +
		row.diag.vMax.toFixed(3) + '\t' + row.diag.wells + '\t' + row.diag.nonFinite + '\t' + row.diag.escaped);
}
var valid = results.every(function (r) { return r.diag.nonFinite === 0 && r.diag.escaped === 0; });
var convects = results.some(function (r) { return r.diag.wells >= 1 && r.diag.vMax > 0.1; });
console.log((valid ? 'PASS' : 'FAIL') + '  thermal planck states finite and contained');
console.log((convects ? 'PASS' : 'FAIL') + '  temperature and lift produce circulation');
if (svgPath) fs.writeFileSync(svgPath, svg(results[results.length - 1].state, 'planck 1.5.1: temperature + lift'));
if (outPath) {
	fs.writeFileSync(outPath, JSON.stringify({ format: 'planck-look-v1', rows: results.map(function (r) {
		return { msBest: r.msBest, msMean: r.msMean, diag: r.diag };
	}), valid: valid, convects: convects }, null, 2) + '\n');
}
process.exitCode = valid && convects ? 0 : 1;
