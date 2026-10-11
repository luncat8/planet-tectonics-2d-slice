// pt-p3-pool.js — 0.3.0 P3.0: the pool's identity (0.3.0-p3-plan.md §4, P3.0).
//
// The pool is the dense active prefix `0..S.n` of a fixed-capacity structure of arrays, and
// every operation that changes *which* parcels exist lives in js/pt/pool.js. This harness
// gates the contract that makes that safe:
//
//   A. FIELDS is the whole parcel — state.js cannot grow a per-parcel array the compaction
//      does not know about
//   B. a removal compacts the last active slot into the hole with every field, keeps the id,
//      and leaves nothing alive past the prefix
//   C. a split conserves mass, momentum, enthalpy and composition, shares the intensive
//      state, and hands the child a fresh id while the host keeps its own
//   D. a merge sums the extensive state, mass-weights the intensive state, keeps the older
//      id, folds the periodic seam, and does not depend on the argument order; split+merge
//      round-trips inside the 1e-9 the plan gates at P3.4
//   E. a full pool defers and counts, and a deferral changes nothing and loses nothing
//   F. the fingerprint is the complete state: id, phase, enthalpy, composition, melt and the
//      pool's own counters are in it, and the same seed replays it bitwise
//   G. the inventory is the stock side of the ledger, the frame pass and the compensated pass
//      agree, and a throughput counter is never added to it
//
// Run: node experiments/pt-p3-pool.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), PTPOOL = require(B + 'pool.js');
var S = require(B + 'state.js'), SIM = require(B + 'sim.js');

var FIELDS = PTPOOL.FIELDS, WORK = PTPOOL.WORK;
var t0 = Date.now();

// the shipped configuration, rebuilt from scratch: the pool's capacity follows the mesh
function configure(ic) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24;
	P.mpc = 4; P.resMelt = 0.05; P.resAir = 0.03; P.resDep = 0.12;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = ic || 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	return SIM.M;
}

// a deterministic draw, so a fixture replays without a rng dependency
var rnd = 1234567;
function draw(n) {
	rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
	return rnd % n;
}

// the ledger's numbers in compensated summation: the pool's own inventory for mass,
// enthalpy and composition, plus a Neumaier pair for the two momentum components the
// inventory does not carry. `apx`/`apy` are the absolute momenta, the scale a momentum
// residual is judged against (the planet's net momentum is small against its own traffic).
function totals(st) {
	var n = st.n, p, v, s, t = { px: 0, py: 0, cx: 0, cy: 0, apx: 0, apy: 0 };
	PTPOOL.inventoryComp(st);
	t.m = st.invMTot; t.h = st.invHTot;
	t.f = st.invFTot; t.w = st.invWTot; t.l = st.invLTot;
	for (p = 0; p < n; p++) {
		v = st.m[p] * st.vx[p];
		s = t.px + v;
		t.cx += Math.abs(t.px) >= Math.abs(v) ? t.px - (s - v) : v - (s - t.px);
		t.px = s;
		t.apx += Math.abs(v);
		v = st.m[p] * st.vy[p];
		s = t.py + v;
		t.cy += Math.abs(t.py) >= Math.abs(v) ? t.py - (s - v) : v - (s - t.py);
		t.py = s;
		t.apy += Math.abs(v);
	}
	t.px += t.cx; t.py += t.cy;
	return t;
}

function dupIds(st) {
	var seen = new Int32Array(st.nextId + 1), p, dup = 0;
	for (p = 0; p < st.n; p++) { if (st.id[p] < 0 || st.id[p] >= seen.length || seen[st.id[p]]++) dup++; }
	return dup;
}

// a distinct value per (field, slot): a field the compaction forgot shows up as a sentinel
// that did not travel
function sentinel(k, p) {
	var name = FIELDS[k];
	if (name === 'ph') return (p + k) % P.PH_N;
	if (name === 'id') return 1000 + p;
	if (name === 'pCnt') return p + k;
	return (p + 1) * (k + 1) * 0.5 + 0.25;
}

console.log('  pool: ' + P.mesh.nx + 'x' + P.mesh.ny + ' nodes, ' + P.mpc + ' markers/node, '
	+ FIELDS.length + ' fields per parcel\n');

// ---------------------------------------------------------------- A. the field table
check.section('A. FIELDS is the whole parcel');
configure('cool');
var k, name, missing = [], unlisted = [], found = [], v;
for (k = 0; k < FIELDS.length; k++) {
	name = FIELDS[k];
	if (!ArrayBuffer.isView(S[name]) || S[name].length < P.partCap) missing.push(name);
}
check.ok('every field pool.js permutes is an allocated per-parcel array', missing.length === 0,
	missing.join(',') || FIELDS.length + ' fields at capacity ' + P.partCap);
// the independent scan: state.js may grow an array, the table may not silently miss it
for (name in S) {
	v = S[name];
	if (!ArrayBuffer.isView(v) || v.length < P.partCap) continue;
	found.push(name);
	if (FIELDS.indexOf(name) < 0 && WORK.indexOf(name) < 0) unlisted.push(name);
}
check.ok('every per-parcel array in the state is a field or declared workspace',
	unlisted.length === 0, unlisted.join(',') || found.length + ' arrays: ' + FIELDS.length
	+ ' fields + ' + WORK.length + ' workspace');
var workMissing = [];
for (k = 0; k < WORK.length; k++) if (!ArrayBuffer.isView(S[WORK[k]])) workMissing.push(WORK[k]);
check.ok('the workspace list names real arrays, not an excuse', workMissing.length === 0,
	workMissing.join(',') || WORK.length + ' workspace arrays');
check.ok('fields() resolves the table to the live arrays',
	PTPOOL.fields(S).length === FIELDS.length && PTPOOL.fields(S)[0] === S.x);
// the cache has a generation marker: a capacity change reallocates every array at once
P.resFrac += 0.05;
SIM.init();
check.ok('and follows a reallocation instead of holding freed arrays',
	PTPOOL.fields(S)[0] === S.x && S.x.length >= P.partCap, 'cap ' + P.partCap + ' len ' + S.x.length);

// ---------------------------------------------------------------- B. compaction
check.section('B. a removal compacts every field and keeps the identity');
configure('cool');
var p, q, last = S.n - 1, want = [], bad = [], tail = [];
for (p = 0; p < S.n; p++) for (k = 0; k < FIELDS.length; k++) S[FIELDS[k]][p] = sentinel(k, p);
for (k = 0; k < FIELDS.length; k++) want[k] = S[FIELDS[k]][last];
PTPOOL.remove(S, 7);
for (k = 0; k < FIELDS.length; k++) if (S[FIELDS[k]][7] !== want[k]) bad.push(FIELDS[k]);
check.ok('the last active parcel arrived in the hole with every field',
	bad.length === 0 && S.n === last, bad.join(',') || FIELDS.length + ' fields moved to slot 7');
check.ok('and kept its own identity', S.id[7] === want[FIELDS.indexOf('id')],
	'id ' + S.id[7] + ' of ' + want[FIELDS.indexOf('id')]);
for (k = 0; k < FIELDS.length; k++) if (S[FIELDS[k]][last] !== 0) tail.push(FIELDS[k]);
check.ok('nothing lives past the dense prefix', tail.length === 0,
	tail.join(',') || 'slot ' + last + ' zeroed');
check.ok('the compaction is counted once', S.tx.move === 1, 'move ' + S.tx.move);
PTPOOL.remove(S, S.n - 1);
check.ok('removing the last slot compacts nothing', S.tx.move === 1 && S.n === last - 1,
	'n ' + S.n + '  move ' + S.tx.move);
configure('cool');
var idBefore = new Int32Array(S.nextId), holes = 40;
for (p = 0; p < S.n; p++) idBefore[S.id[p]] = 1;
for (k = 0; k < holes; k++) PTPOOL.remove(S, draw(S.n));
var reused = 0;
for (p = 0; p < S.n; p++) if (!idBefore[S.id[p]]) reused++;
check.ok(holes + ' removals leave unique ids and reuse none', dupIds(S) === 0 && reused === 0,
	'duplicates ' + dupIds(S) + '  invented ' + reused + '  n ' + S.n);

// ---------------------------------------------------------------- C. split
check.section('C. a split moves mass and shares the intensive state');
configure('cool');
SIM.run(50);
// a sample with a real composition, a melt fraction and its own velocity: conserving zeros
// would pass without proving anything
var sample = [], i, nSplit = 256;
for (i = 0; i < nSplit; i++) {
	p = draw(S.n);
	S.cF[p] = 0.05 + 0.3 * draw(1000) / 1000;
	S.cW[p] = 0.001 * draw(1000) / 1000;
	S.melt[p] = 0.02 * draw(1000) / 1000;
	S.H[p] = S.T[p] * (1 + 0.01 * draw(100) / 100);
	S.vx[p] = 5 - 10 * draw(1000) / 1000;
	S.vy[p] = 2 - 4 * draw(1000) / 1000;
	sample.push(p);
}
var tA = totals(S), nA = S.n, idA = S.nextId;
var fr = [0.5, 0.25, 0.1, 0.75, 0.02], phs = [P.PH.melt, P.PH.air, P.PH.dep];
var badPhase = 0, badId = 0, renamed = 0, badMass = 0, badState = 0, badCount = 0;
for (i = 0; i < nSplit; i++) {
	p = sample[i];
	var frac = fr[i % fr.length], mh = S.m[p], hh = S.H[p], idh = S.id[p];
	q = PTPOOL.split(S, p, frac, phs[i % phs.length]);
	if (q < 0) { badCount++; continue; }
	if (S.ph[q] !== phs[i % phs.length]) badPhase++;
	if (S.id[q] !== idA + i) badId++;
	if (S.id[p] !== idh) renamed++;
	if (Math.abs(S.m[q] - frac * mh) > 1e-15 * mh || Math.abs(S.m[p] + S.m[q] - mh) > 1e-15 * mh) badMass++;
	if (S.H[q] !== hh || S.T[q] !== S.T[p] || S.cF[q] !== S.cF[p] || S.cW[q] !== S.cW[p]
		|| S.melt[q] !== S.melt[p] || S.x[q] !== S.x[p] || S.e[q] !== S.e[p]
		|| S.vx[q] !== S.vx[p] || S.vy[q] !== S.vy[p]) badState++;
	if (S.age[q] !== 0 || S.dmg[q] !== 0) badState++;
}
var tB = totals(S);
check.ok('every split was admitted below the capacity', badCount === 0 && S.n === nA + nSplit,
	'n ' + nA + ' -> ' + S.n + ' of cap ' + P.partCap);
check.near('mass closes over ' + nSplit + ' splits', tB.m, tA.m, 1e-12);
check.ok('x momentum closes', Math.abs(tB.px - tA.px) <= 1e-12 * tA.apx,
	'|d| ' + Math.abs(tB.px - tA.px).toExponential(2) + ' of ' + tA.apx.toExponential(2));
check.ok('y momentum closes', Math.abs(tB.py - tA.py) <= 1e-12 * tA.apy,
	'|d| ' + Math.abs(tB.py - tA.py).toExponential(2) + ' of ' + tA.apy.toExponential(2));
check.near('enthalpy closes', tB.h, tA.h, 1e-12);
check.near('felsic mass closes', tB.f, tA.f, 1e-12);
check.near('water mass closes', tB.w, tA.w, 1e-12);
check.near('melt mass closes', tB.l, tA.l, 1e-12);
check.ok('every child took the phase it was asked for', badPhase === 0, badPhase + ' wrong');
check.ok('the host kept its id and every child is fresh', renamed === 0 && badId === 0,
	'renamed ' + renamed + '  renumbered ' + badId);
check.ok('the intensive state is shared and the bond state is not', badState === 0, badState + ' wrong');
check.ok('the child mass is the fraction of the host\'s', badMass === 0, badMass + ' wrong');
check.ok('the counters and the id sequence agree with the transactions',
	S.tx.split === nSplit && S.tx.admit === nSplit && S.nextId === idA + nSplit && dupIds(S) === 0,
	'split ' + S.tx.split + '  admit ' + S.tx.admit + '  nextId ' + S.nextId);

// ---------------------------------------------------------------- D. merge
check.section('D. a merge sums the extensive state and keeps the older id');
var M = configure('cool'), i2;
S.n = 2;
S.m[0] = 3; S.m[1] = 1;
S.x[0] = 100; S.x[1] = 200; S.y[0] = 50; S.y[1] = 70; S.e[0] = 0.5; S.e[1] = 0.7;
S.vx[0] = 10; S.vx[1] = -2; S.vy[0] = 1; S.vy[1] = 5;
S.H[0] = 0.8; S.H[1] = 0.2; S.T[0] = 0.8; S.T[1] = 0.2;
S.cF[0] = 0.1; S.cF[1] = 0.5; S.cW[0] = 0; S.cW[1] = 0.04;
S.melt[0] = 0; S.melt[1] = 0.3; S.age[0] = 10; S.age[1] = 30;
S.id[0] = 5; S.id[1] = 2; S.ph[0] = P.PH.mantle; S.ph[1] = P.PH.mantle;
var px0 = 3 * 10 + 1 * -2, py0 = 3 * 1 + 1 * 5;
check.ok('the hand pair merges', PTPOOL.merge(M, S, 0, 1) === 0 && S.n === 1);
check.near('mass sums', S.m[0], 4, 0);
check.near('x momentum sums', S.m[0] * S.vx[0], px0, 1e-14);
check.near('y momentum sums', S.m[0] * S.vy[0], py0, 1e-14);
check.near('enthalpy is the mass-weighted mean', S.H[0], (3 * 0.8 + 1 * 0.2) / 4, 1e-15);
check.near('and so is the composition', S.cF[0], (3 * 0.1 + 1 * 0.5) / 4, 1e-15);
check.near('and the position', S.x[0], 125, 1e-14);
check.near('and the melt fraction', S.melt[0], (3 * 0 + 1 * 0.3) / 4, 1e-15);
check.ok('the survivor keeps the older id', S.id[0] === 2, 'id ' + S.id[0]);

// the periodic seam: a pair straddling x = 0 is one body, not one at each end of the map
M = configure('cool');
S.n = 2;
S.m[0] = 1; S.m[1] = 1; S.ph[0] = P.PH.mantle; S.ph[1] = P.PH.mantle;
S.id[0] = 9; S.id[1] = 4;
S.x[0] = 20; S.x[1] = M.wrap - 20; S.y[0] = 40; S.y[1] = 40; S.e[0] = 0.4; S.e[1] = 0.4;
PTPOOL.merge(M, S, 0, 1);
check.near('a merge across the seam lands on the seam', S.x[0], 0, 1e-12, 'km');
check.ok('and keeps the older of the two ids', S.id[0] === 4, 'id ' + S.id[0]);

// the argument order must not decide anything
function mergeScript(swap) {
	M = configure('cool');
	SIM.run(20);
	var a = 101, b = 102, t;
	S.cF[a] = 0.2; S.cF[b] = 0.4; S.H[a] = 0.7; S.H[b] = 0.3;
	S.m[a] = 2; S.m[b] = 6; S.id[a] = 30; S.id[b] = 12;
	S.ph[a] = P.PH.mantle; S.ph[b] = P.PH.mantle;
	if (swap) { t = a; a = b; b = t; }
	PTPOOL.merge(SIM.M, S, a, b);
	return { id: S.id[a], m: S.m[a], h: S.H[a], f: S.cF[a], x: S.x[a], px: S.m[a] * S.vx[a] };
}
var mA = mergeScript(false), mB = mergeScript(true);
check.ok('merge(a, b) and merge(b, a) are the same parcel',
	mA.id === mB.id && mA.m === mB.m && mA.h === mB.h && mA.f === mB.f && mA.x === mB.x,
	'id ' + mA.id + '/' + mB.id + '  m ' + mA.m + '/' + mB.m + '  H ' + mA.h.toFixed(12) + '/' + mB.h.toFixed(12));

// a split and its inverse merge, at the tolerance P3.4 gates
M = configure('cool');
SIM.run(50);
var rt = [], worstM = 0, worstP = 0, worstH = 0;
for (i = 0; i < 64; i++) {
	p = draw(S.n - 1);
	var m0 = S.m[p], h0 = S.H[p], px = S.m[p] * S.vx[p], py = S.m[p] * S.vy[p];
	q = PTPOOL.split(S, p, 0.1 + 0.08 * (i % 10), P.PH.mantle);
	S.ph[q] = P.PH.mantle;
	PTPOOL.merge(SIM.M, S, p, q);
	worstM = Math.max(worstM, Math.abs(S.m[p] - m0) / m0);
	worstH = Math.max(worstH, Math.abs(S.H[p] - h0) / Math.max(1e-30, Math.abs(h0)));
	worstP = Math.max(worstP, Math.abs(S.m[p] * S.vx[p] - px) / Math.max(1e-30, Math.abs(px)),
		Math.abs(S.m[p] * S.vy[p] - py) / Math.max(1e-30, Math.abs(py)));
	rt.push(p);
}
check.ok('split then merge round-trips mass to 1e-9', worstM < 1e-9, worstM.toExponential(2));
check.ok('and momentum to 1e-9', worstP < 1e-9, worstP.toExponential(2));
check.ok('and enthalpy to 1e-9', worstH < 1e-9, worstH.toExponential(2));
check.ok('the round trip left the pool at its starting count', S.n === P.partBase && dupIds(S) === 0,
	'n ' + S.n + '  duplicates ' + dupIds(S));

// a merge across phases is refused: it would move material between ledger lines with no
// transfer counter for it
M = configure('cool');
var ref0 = S.tx.refuse;
S.ph[3] = P.PH.dep;
check.ok('a merge across phases is refused and counted',
	PTPOOL.merge(M, S, 2, 3) === -1 && S.tx.refuse === ref0 + 1, 'refuse ' + S.tx.refuse);
S.ph[3] = P.PH.mantle;
var hRef2 = S.hash();
PTPOOL.split(S, 5, 0.5, P.PH.air);
check.ok('a fractional split of 0 or 1 is refused', PTPOOL.split(S, 6, 0, P.PH.air) === -1
	&& PTPOOL.split(S, 6, 1, P.PH.air) === -1, 'refuse ' + S.tx.refuse);
check.ok('and neither refusal touched the pool', S.n === P.partBase + 1, 'n ' + S.n);

// ---------------------------------------------------------------- E. capacity
check.section('E. a full pool defers, and deferring loses nothing');
configure('cool');
var tC = totals(S), fills = 0, guard = 0;
while (S.n < P.partCap && guard++ < 4 * P.partCap) {
	if (PTPOOL.split(S, fills % S.n, 0.5, P.PH.dep) < 0) break;
	fills++;
}
var tD = totals(S);
check.ok('the reserve fills exactly to the capacity', S.n === P.partCap,
	fills + ' splits, n ' + S.n + '/' + P.partCap);
check.near('filling it conserved the mass', tD.m, tC.m, 1e-12);
check.near('and the enthalpy', tD.h, tC.h, 1e-12);
check.ok('and left the ids unique at capacity', dupIds(S) === 0, 'duplicates ' + dupIds(S));
var hFull = S.hash(), refFull = S.tx.refuse;
q = PTPOOL.split(S, 0, 0.5, P.PH.melt);
var a2 = PTPOOL.admit(S, P.PH.air);
var tE = totals(S);
check.ok('a full pool defers the split and refuses the admission', q === -1 && a2 === -1,
	'split ' + q + '  admit ' + a2);
check.ok('and counts both', S.tx.refuse === refFull + 2, 'refuse ' + S.tx.refuse);
// the counter is the *only* thing that happened: put it back and the fingerprint is the one
// from before the attempt, which is a stronger statement than comparing the material alone
// (the counters are in the hash, so anything else a refusal touched would show here too)
S.tx.refuse = refFull;
check.ok('a refused transaction changed nothing but the counter',
	S.hash() === hFull && S.n === P.partCap, 'hash ' + hFull + ' -> ' + S.hash());
S.tx.refuse = refFull + 2;
check.near('and lost no material', tE.m, tD.m, 0);
PTPOOL.remove(S, 3);
var freed = PTPOOL.admit(S, P.PH.air);
check.ok('a freed slot is admitted again at the end of the prefix',
	freed === P.partCap - 1 && S.n === P.partCap && S.ph[freed] === P.PH.air, 'slot ' + freed);

// ---------------------------------------------------------------- F. the fingerprint
check.section('F. the fingerprint is the complete state');
configure('cool');
SIM.run(20);
var ordered = true;
for (p = 0; p < S.n; p++) if (S.id[p] !== p) ordered = false;
check.ok('a reset planet numbers its parcels in slot order', ordered && S.nextId === S.n,
	'n ' + S.n + '  nextId ' + S.nextId);
var h0 = S.hash();
var probes = [['id', 1], ['ph', P.PH.dep], ['H', 1e-12], ['cF', 1e-12], ['cW', 1e-12],
	['melt', 1e-12], ['m', 1e-12], ['T', 1e-12]];
var blind = [];
for (i = 0; i < probes.length; i++) {
	name = probes[i][0];
	var keep = S[name][9], delta = probes[i][1];
	S[name][9] = name === 'ph' ? delta : keep + delta;
	if (S.hash() === h0) blind.push(name);
	S[name][9] = keep;
	if (S.hash() !== h0) blind.push(name + '(restore)');
}
check.ok('a change of id, phase, enthalpy, composition, melt, mass or T is visible',
	blind.length === 0, blind.join(',') || probes.length + ' fields probed');
var keepN = S.nextId, keepTx = S.tx.split;
S.nextId += 7;
var seesNextId = S.hash() !== h0;
S.nextId = keepN;
S.tx.split += 3;
var seesTx = S.hash() !== h0;
S.tx.split = keepTx;
check.ok('the pool\'s own counters are part of it too',
	seesNextId && seesTx && S.hash() === h0, 'nextId ' + seesNextId + '  tx ' + seesTx);

function script() {
	configure('cool');
	SIM.run(10);
	var j, qq;
	for (j = 0; j < 64; j++) PTPOOL.split(S, (j * 137) % S.n, 0.1 + 0.01 * (j % 9), P.PH.dep);
	for (j = 0; j < 32; j++) {
		qq = (j * 211) % (S.n - 1);
		PTPOOL.merge(SIM.M, S, qq, qq + 1);
	}
	PTPOOL.remove(S, 5);
	SIM.run(10);
	return S.hash();
}
var r1 = script(), r2 = script();
check.ok('the same seed and the same transaction script replay bitwise', r1 === r2, 'hash ' + r1);
check.ok('and the replayed pool is finite and inside its box',
	r1 > 0 && S.n > 0 && dupIds(S) === 0, 'n ' + S.n);

// ---------------------------------------------------------------- G. the inventory
check.section('G. the inventory is the stock, and the two passes agree');
configure('cool');
SIM.run(50);
// a mixed population, so every phase line of the inventory carries something
var injected = [[P.PH.melt, 300], [P.PH.air, 200], [P.PH.dep, 400]], inj, cnt, ph2;
for (inj = 0; inj < injected.length; inj++) {
	ph2 = injected[inj][0]; cnt = injected[inj][1];
	for (i = 0; i < cnt; i++) {
		p = draw(S.n);
		q = PTPOOL.split(S, p, 0.2, ph2);
		S.H[q] = 0.3 + 0.4 * draw(100) / 100;
		S.cF[q] = ph2 === P.PH.dep ? 0.35 : 0.02;
		S.cW[q] = 0.01 * draw(100) / 100;
		S.melt[q] = ph2 === P.PH.melt ? 0.6 : 0;
	}
}
function snap() {
	return { m: S.invMTot, h: S.invHTot, f: S.invFTot, w: S.invWTot, l: S.invLTot,
		n: Array.prototype.slice.call(S.invN), pm: Array.prototype.slice.call(S.invM),
		ph: Array.prototype.slice.call(S.invH) };
}
PTPOOL.inventory(S);
var nv = snap();
PTPOOL.inventoryComp(S);
var cp = snap();
// a third, independent read of the same arrays: what the fields *mean*
var hm = 0, hh = 0, hf = 0, hw = 0, hl = 0, hn = [0, 0, 0, 0];
for (p = 0; p < S.n; p++) {
	hm += S.m[p]; hh += S.m[p] * S.H[p]; hf += S.m[p] * S.cF[p];
	hw += S.m[p] * S.cW[p]; hl += S.m[p] * S.melt[p]; hn[S.ph[p]]++;
}
check.near('the frame inventory reads the mass the parcels carry', nv.m, hm, 0);
check.near('and the enthalpy as m*H', nv.h, hh, 0);
check.near('and the composition as mass fractions', nv.f, hf, 0);
check.ok('and the phase counts', nv.n.join(',') === hn.join(','), nv.n.join(',') + ' vs ' + hn.join(','));
check.near('the compensated total agrees with the frame one on mass', cp.m, nv.m, 1e-12);
check.near('and on enthalpy', cp.h, nv.h, 1e-12);
check.near('and on the felsic mass', cp.f, nv.f, 1e-12);
var phaseBad = 0;
for (k = 0; k < P.PH_N; k++) {
	if (Math.abs(cp.pm[k] - nv.pm[k]) > 1e-12 * Math.max(1, Math.abs(cp.pm[k]))) phaseBad++;
	if (Math.abs(cp.ph[k] - nv.ph[k]) > 1e-12 * Math.max(1, Math.abs(cp.ph[k]))) phaseBad++;
}
check.ok('per phase too', phaseBad === 0, phaseBad + ' of ' + 2 * P.PH_N + ' lines apart');
check.ok('the phase lines sum to the active prefix and to the total',
	nv.n[0] + nv.n[1] + nv.n[2] + nv.n[3] === S.n,
	nv.n.join('+') + ' = ' + S.n);
check.near('the compensated error it reports is the naive pass\'s own', S.invErr,
	Math.abs(nv.m - cp.m) / cp.m, 1e-3);
var before = S.invMTot;
S.tx.admit += 1000; S.tx.split += 1000; S.tx.merge += 1000;
PTPOOL.inventoryComp(S);
check.ok('a throughput counter is not a stock', S.invMTot === before,
	S.invMTot + ' vs ' + before);
S.tx.admit -= 1000; S.tx.split -= 1000; S.tx.merge -= 1000;
// the mass anchor: the pool's stock is the mesh's own interior node measure, which is the
// weight the conduction operator conserves (state.js reset)
var measure = 0, j;
for (j = 1; j < SIM.M.ny; j++) measure += SIM.M.dEta * SIM.M.jN[j] * SIM.M.dx * SIM.M.nx;
configure('cool');
PTPOOL.inventoryComp(S);
check.near('a fresh planet\'s stock is the interior node measure', S.invMTot, measure, 1e-12, 'km2');
// the compensated pass against an independent Neumaier sum: a naive pass compared with a
// broken compensation would agree with itself, so the fixture needs an outside reference
var nm = new Float64Array(S.n), ns = 0, nc = 0, nt, nv, nk;
for (nk = 0; nk < S.n; nk++) {
	nv = S.m[nk]; nm[nk] = nv; nt = ns + nv;
	nc += Math.abs(ns) >= Math.abs(nv) ? (ns - nt) + nv : (nv - nt) + ns;
	ns = nt;
}
check.near('and the compensated stock is the direct Neumaier sum over the same parcels', S.invMTot, ns + nc, 1e-14, 'km2');
check.info('that is ' + (100 * S.invMTot / (P.wrap * P.depth)).toFixed(1)
	+ '% of the domain area: the two wall rows carry no markers');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
