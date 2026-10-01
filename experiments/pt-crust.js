// pt-crust.js — 0.3.0 P2.1: the crust law and the emergent plates, gated in the engine.
//
// pt-emerge.js measured the emergence claims on a stand-alone bonded body; this fixture
// gates the same claims where they now live (js/pt/solid.js, kernel G4) with the fluid
// pipeline behind it:
//
//   1. the law     -- mu(T, age) welds cold rock over tauWeld and never welds warm rock
//   2. failure     -- a loaded seam is elastic below its yield and opens above it; a quiet
//                     one anneals and re-welds
//   3. riding      -- a strong cluster travels as one body at the flow's mean under it
//   4. rifting     -- a hot band splits the lid in two (the P2 gate)
//   5. the long run -- the lid forms, stays plate, and the frame keeps its coverage
//
// Run: node experiments/pt-crust.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), SC = require(B + 'solid.js');

// a hand-built cloud on the engine's own mesh: n markers at given (x, y, T), no lattice
function cloud(M, pts) {
	S.n = pts.length;
	for (var p = 0; p < pts.length; p++) {
		S.x[p] = pts[p][0];
		S.y[p] = pts[p][1];
		S.e[p] = Math.asinh(pts[p][1] / M.yLin);
		S.T[p] = pts[p][2];
		S.m[p] = 1;
		S.vx[p] = pts[p][3] || 0;
		S.vy[p] = pts[p][4] || 0;
		S.age[p] = pts[p][5] || 0;
		S.mu[p] = 0; S.dmg[p] = 0; S.cl[p] = -1;
	}
}

function smoothstep(a, b, x) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
}

// the strength law written out, for the exact-value gates
function law(T, age) {
	return (0.05 + 0.95 * (1 - smoothstep(P.muLo, P.muHi, T))) * (1 - Math.exp(-age / P.tauWeld));
}

console.log('  crust: the P2.1 law and the emergent plates, engine mesh ' + P.mesh.nx + 'x' + P.mesh.ny + '\n');

// ---------------------------------------------------------------- 1. the strength law
check.section('the strength law');
P.solid = true;
SIM.init(); SIM.reset();
var M = SIM.M, dt = 1;
// a cold marker welds on the clock: mu = (1 - exp(-age/tauWeld)) at T below muLo
cloud(M, [[0.3 * M.dx, M.yN[3], 0.2]]);
for (var i = 0; i < 20; i++) SC.crust(M, S, dt);
check.near('a cold marker welds on the tauWeld clock', S.mu[0], law(0.2, 20), 1e-9);
check.near('its age is the geologic clock', S.age[0], 20, 0);
// a warm marker never acquires an age (the asthenosphere rule)
cloud(M, [[0.3 * M.dx, M.yN[3], 0.5]]);
for (i = 0; i < 20; i++) SC.crust(M, S, dt);
check.near('a warm marker resets its age and never welds', S.mu[0], 0, 1e-9);
// between TLock and TSoft the parcel holds: it neither welds nor forgets, and its strength
// is exactly the law at its held age
cloud(M, [[0.3 * M.dx, M.yN[3], 0.4]]);
S.age[0] = 10;
for (i = 0; i < 20; i++) SC.crust(M, S, dt);
check.near('the hysteresis band holds its age', S.age[0], 10, 0);
check.near('its strength is the law at the held age', S.mu[0], law(0.4, 10), 1e-9);
// heat cuts strength even for old rock
cloud(M, [[0.3 * M.dx, M.yN[3], 0.85]]);
S.age[0] = 1e6;
SC.crust(M, S, dt);
check.ok('hot rock is soft however old', S.mu[0] < P.clusterMin, 'mu ' + S.mu[0].toFixed(3));
// deep mantle (> yWeldMax) stays in ductile creep even when cold: the 'rb' CMB cold pool
// must not weld into a bottom plate
cloud(M, [[0.3 * M.dx, M.yN[M.ny - 1], 0.05]]);
S.age[0] = 100; S.dmg[0] = 0.5;
for (i = 0; i < 20; i++) SC.crust(M, S, dt);
check.near('cold rock below yWeldMax resets its age and never welds', S.mu[0], 0, 1e-9);

// ---------------------------------------------------------------- 2. a strong pair rides
check.section('a cluster rides the flow as one body');
var xa = 10 * M.dx, xb = 11 * M.dx, y0 = M.yN[4];
// both welded and strong; the flow disagrees mildly under the pair (2 km/Myr across one
// cell is half the yield strain rate, so the seam is elastic). The pipeline order is G3
// (advect with the flow) then G4 (the rigid correction), so the test advances with the flow
// first: what is left after the projection is the plate's rigid mean, with no strain
cloud(M, [[xa, y0, 0.1], [xb, y0, 0.1]]);
S.age[0] = S.age[1] = 100;
S.vx[0] = 16; S.vy[0] = 5; S.vx[1] = 14; S.vy[1] = 5;
S.x[0] += S.vx[0] * dt; S.x[1] += S.vx[1] * dt;
S.y[0] += S.vy[0] * dt; S.y[1] += S.vy[1] * dt;
SC.crust(M, S, dt);
check.ok('both markers are in one cluster', S.cl[0] === S.cl[1] && S.cl[0] >= 0, 'cl ' + S.cl[0] + ' ' + S.cl[1]);
check.near('the cluster travels at the mass-weighted mean', S.vx[0], 15, 1e-9);
check.near('and so does its partner', S.vx[1], 15, 1e-9);
var gap = Math.abs((S.x[1] - S.x[0]) - (xb - xa)) + Math.abs(S.y[1] - S.y[0]);
check.near('the body holds its shape (no internal strain)', gap, 0, 1e-9);
// slab pull: a cold root hanging below the lid at one end of a plate pulls the plate
// horizontally toward the root; symmetric left/right roots pull in opposite directions, and
// the pull is capped at vSlabMax
var yLid = M.yN[2], yRoot = M.yN[3];
cloud(M, [
	[xa, yLid, 0.1, 0, 0, 100], [xa + M.dx, yLid, 0.1, 0, 0, 100],
	[xa + 2 * M.dx, yLid, 0.1, 0, 0, 100], [xa + 3 * M.dx, yLid, 0.1, 0, 0, 100],
	[xa + 3 * M.dx, yRoot, 0.1, 0, 0, 100]
]);
SC.crust(M, S, dt);
var vRight = S.vx[0];
check.ok('a cold root at the +x end pulls the plate in +x',
	S.cl[0] === S.cl[4] && vRight > 0 && vRight <= P.vSlabMax, 'vx ' + vRight.toFixed(2) + ' km/Myr');
cloud(M, [
	[xa, yLid, 0.1, 0, 0, 100], [xa + M.dx, yLid, 0.1, 0, 0, 100],
	[xa + 2 * M.dx, yLid, 0.1, 0, 0, 100], [xa + 3 * M.dx, yLid, 0.1, 0, 0, 100],
	[xa, yRoot, 0.1, 0, 0, 100]
]);
SC.crust(M, S, dt);
var vLeft = S.vx[3];
check.near('a root at the -x end pulls in -x by the same speed', vLeft, -vRight, 1e-9);

// ---------------------------------------------------------------- 3. a hot band rifts
check.section('a hot band splits the lid');
cloud(M, [
	[xa, y0, 0.1], [xa + M.dx, y0, 0.1], [xa + 2 * M.dx, y0, 0.1],
	[xa + 3 * M.dx, y0, 0.95],                      // the hot band
	[xa + 4 * M.dx, y0, 0.1], [xa + 5 * M.dx, y0, 0.1], [xa + 6 * M.dx, y0, 0.1]
]);
for (i = 0; i < 7; i++) S.age[i] = 100;
SC.crust(M, S, 1e-3);
check.ok('the hot band is not plate', S.cl[3] < 0, 'cl ' + S.cl[3]);
check.ok('the cold side on the left is one cluster', S.cl[0] === S.cl[1] && S.cl[1] === S.cl[2], '');
check.ok('the cold side on the right is another', S.cl[4] === S.cl[5] && S.cl[5] === S.cl[6] && S.cl[4] >= 0, '');
check.ok('the rift is real: the two sides are different plates', S.cl[2] !== S.cl[4], '');

// ---------------------------------------------------------------- 4. failure and healing
check.section('a worked seam opens, a quiet one welds');
// a stretched pair far above yield damages apart; the geometry is re-pinned each frame so
// the law sees a constant load and not a converging collision
cloud(M, [[xa, y0, 0.1], [xb, y0, 0.1]]);
S.age[0] = S.age[1] = 100;
S.vx[0] = 500; S.vx[1] = -500;                     // 1000 km/Myr across 62 km: way over yield
SC.crust(M, S, 1);
var dAfter = S.dmg[0];
check.ok('a violently worked seam accumulates damage', dAfter > 0, 'dmg ' + dAfter.toFixed(3));
for (i = 0; i < 40; i++) {
	S.age[0] = S.age[1] = 100;
	S.x[0] = xa; S.x[1] = xb;
	S.vx[0] = 500; S.vx[1] = -500;
	SC.crust(M, S, 1);
}
check.ok('and it opens', S.cl[0] < 0 || S.cl[1] < 0 || S.cl[0] !== S.cl[1], 'dmg ' + S.dmg[0].toFixed(2));
// a gently loaded pair is elastic: half the yield strain rate, no damage, ever
cloud(M, [[xa, y0, 0.1], [xb, y0, 0.1]]);
S.age[0] = S.age[1] = 100;
var gentle = 0.5 * P.yieldRate * M.dx / 2;
for (i = 0; i < 50; i++) {
	S.age[0] = S.age[1] = 100;
	S.x[0] = xa; S.x[1] = xb;
	S.vx[0] = gentle; S.vx[1] = -gentle;
	SC.crust(M, S, 1);
}
check.near('a seam loaded below its yield is elastic forever', S.dmg[0], 0, 0);
check.ok('and stays bonded', S.cl[0] === S.cl[1] && S.cl[0] >= 0, '');
// re-open, then let the quiet cold seam anneal back
for (i = 0; i < 40; i++) {
	S.age[0] = S.age[1] = 100;
	S.x[0] = xa; S.x[1] = xb;
	S.vx[0] = 500; S.vx[1] = -500;
	SC.crust(M, S, 1);
}
for (i = 0; i < 3 * P.tauHeal; i++) {
	S.age[0] = S.age[1] = 100;
	S.x[0] = xa; S.x[1] = xb;
	S.vx[0] = 0; S.vx[1] = 0;
	SC.crust(M, S, 1);
}
check.near('a quiet seam anneals its damage away', S.dmg[0], 0, 1e-9);
check.ok('and welds back into one body', S.cl[0] === S.cl[1] && S.cl[0] >= 0, '');

// ---------------------------------------------------------------- 5. the live long run
check.section('the live run (the real pipeline, 300 Myr)');
P.solid = true;
P.ic = 'cool'; P.flip = 1;
P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1;   // the shipped planet draw (params.js)
P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
P.sl.kyr = 50;
SIM.init(); SIM.reset();
SIM.dt = 0.05;
var lo = 9e9, hi = -9e9, empty = 0, moved = 0, lidMin = 9e9, lidMax = -9e9, platesMax = 0, driftMax = 0;
var W0 = S.wall, L0 = S.ledger;
for (i = 0; i < 6000; i++) {
	SIM.step();
	if (S.d.tMin < lo) lo = S.d.tMin;
	if (S.d.tMax > hi) hi = S.d.tMax;
	if (S.empty > empty) empty = S.empty;
	if (S.moved > moved) moved = S.moved;
	if (SIM.t > 50) {
		if (S.d.lid < lidMin) lidMin = S.d.lid;
		if (S.d.lid > lidMax) lidMax = S.d.lid;
		if (S.d.plates > platesMax) platesMax = S.d.plates;
		if (S.d.plV > driftMax) driftMax = S.d.plV;
	}
}
var gapRatio = (S.ledger - L0) / (S.wall - W0);
console.log('  t ' + SIM.t.toFixed(0) + ' Myr: lid ' + (S.d.lid * 100).toFixed(0) + '%, plates '
	+ S.d.plates + ', drift ' + S.d.plV.toFixed(2) + ' (max ' + driftMax.toFixed(2) + ') cm/yr, Nu '
	+ S.d.nu.toFixed(1) + ', holes ' + empty + ', moved ' + moved + ', redeals ' + S.redeals);
check.ok('the crust forms and stays plate through 300 Myr', lidMin > 0.05 && lidMax < 0.40,
	'lid ' + (lidMin * 100).toFixed(0) + '..' + (lidMax * 100).toFixed(0) + '%');
check.ok('and it carries at least one plate', platesMax >= 1, 'plates max ' + platesMax);
check.ok('plates drift at the demonstration scale (3-10 cm/yr)', driftMax >= 3 && driftMax <= 10,
	'peak drift ' + driftMax.toFixed(2) + ' cm/yr');
check.ok('the field remains bounded under a rigid lid', lo > -0.5 && hi < 1.5, 'T ' + lo.toFixed(3) + '..' + hi.toFixed(3));
check.ok('the rigid motion never re-deals the lattice', S.redeals === 0, 'redeals ' + S.redeals);
check.ok('coverage survives the plates', empty < 0.15 * SIM.M.nx * (SIM.M.ny - 1), 'worst holes ' + empty);
check.ok('the ledger still closes against the wall flux', gapRatio > 0.8 && gapRatio < 1.2, 'intake/wall ' + gapRatio.toFixed(3));

// ---------------------------------------------------------------- 6. paused is paused
check.section('the clock');
var tBefore = SIM.t, hBefore = S.d.heat;
SIM.dt = 0;
SIM.run(5);
check.ok('dt = 0 reports but does not move, age or damage anything',
	SIM.t === tBefore && S.d.heat === hBefore, 't ' + SIM.t.toFixed(3));

check.done();
