// pt-p3-budget.js — 0.3.0 P3.0: what the pool costs (0.3.0-p3-plan.md §4 P3.0, §5, and
// 0.3.0-plan.md §7's frame budget).
//
// The plan freezes no capacity in advance: "No numerical capacity is frozen in advance. The
// benchmark output sets it." This harness is that benchmark. At every quality rung it reports
//
//   A. the base population, the reserve, the capacity, and the bytes the pool holds;
//   B. the full-frame cost of the real pipeline with the reserve *filled* with the phase mix
//      the reserves name, over a sweep of candidate reserves (0 / 0.10 / 0.20 / 0.40) for the
//      price table, and the gated ratio itself as an interleaved pair so the host cannot move
//      it;
//   C. that a frame with the phases present at capacity constructs no typed array;
//   D. that a live run pressed to the capacity refuses, counts and loses nothing;
//   E. that the shipped live eruption keeps flight and deposits active inside the host gate;
//   F. what the inventory pass costs, which is why the frame diagnostic runs the naive one
//      and the acceptance gates run the compensated one;
//   G. 0.3.0-plan.md §7's rung obligation: every supported rung run live past its first
//      eruption, with the melt, air and deposit populations the model itself carries.
//
// Report only in the sense the repository uses: it never edits params.js. The gates here are
// the plan's own (the shipped rung inside the §7 frame budget, the reserve filled exactly,
// the ledgers closed); the price table is information for the reserve decision.
//
// Run: node experiments/pt-p3-budget.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), PTPOOL = require(B + 'pool.js');
var S = require(B + 'state.js'), SIM = require(B + 'sim.js');

var t0 = Date.now();
var RUNGS = [[256, 24, 4], [512, 48, 2], [1024, 96, 2]];   // the page's quality ladder
var SHIPPED = [P.resMelt, P.resAir, P.resDep];             // the shipped reserve (P3.5 froze it)
var SCALES = [0, 0.5, 1, 2];                               // reserve 0 / 0.10 / 0.20 / 0.40
var FRAMES = [150, 60, 25];                                // timed frames per rung in B
var BUDGET = 20;                                           // ms/frame, fixed host gate
var rnd = 24680;

function draw(n) {
	rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
	return rnd % n;
}

// the same configuration pt-p3-pool.js uses, with the reserve scaled
function configure(nx, ny, mpc, scale) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = nx; P.mesh.ny = ny; P.mpc = mpc;
	P.resMelt = SHIPPED[0] * scale; P.resAir = SHIPPED[1] * scale; P.resDep = SHIPPED[2] * scale;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1;
	P.meltHold = 0.1; P.vMelt = 60; P.yCham = 40; P.chJoin = 250; P.chSpan = 230; P.chCap = 64;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	return SIM.M;
}

// A parcel of the phase, with the local state of the field where it stands: melt inside the
// mesh at a melt row, air and landed deposits above the surface. Temperature comes from the
// field, so the fill invents no thermal anomaly for the solver to chase.
function place(M, p, ph) {
	var i = draw(M.nx), j = 1 + draw(4), y;
	S.m[p] = M.dEta * M.jN[1] * M.dx / P.mpc;
	S.x[p] = (i + draw(100) / 100) * M.dx;
	if (ph === P.PH.melt) {
		S.e[p] = (j + draw(100) / 100 - 0.5) * M.dEta;
		S.y[p] = M.yLin * Math.sinh(S.e[p]);
		S.T[p] = S.Tg[j * M.nx + i];
	} else {
		y = -1 - 3 * draw(5);
		S.y[p] = y; S.e[p] = Math.asinh(y / M.yLin);
		S.T[p] = S.Tg[M.ny * M.nx + i];
	}
	S.H[p] = S.T[p];
	S.cF[p] = ph === P.PH.dep ? 0.3 : 0.02;
	S.vx[p] = 0; S.vy[p] = 0;
}

// fill the pool to its capacity, split across the phases in the reserve's own proportions
// (dep takes the rounding remainder, so the reserve is filled exactly)
function fill(M) {
	var room = PTPOOL.room(S), nMelt, nAir, nDep, made = 0, p, k;
	if (room <= 0) return 0;
	nMelt = Math.floor(room * P.resMelt / P.resFrac);
	nAir = Math.floor(room * P.resAir / P.resFrac);
	nDep = room - nMelt - nAir;
	for (k = 0; k < room; k++) {
		var ph = k < nMelt ? P.PH.melt : (k < nMelt + nAir ? P.PH.air : P.PH.dep);
		p = PTPOOL.admit(S, ph);
		if (p < 0) break;
		place(M, p, ph);
		made++;
	}
	return made;
}

// an independent Neumaier sum, so the harness's own bookkeeping is not the pool's accumulator
function neumaier(arr, n) {
	var sum = 0, comp = 0, k, v, t;
	for (k = 0; k < n; k++) {
		v = arr[k]; t = sum + v;
		comp += Math.abs(sum) >= Math.abs(v) ? (sum - t) + v : (v - t) + sum;
		sum = t;
	}
	return sum + comp;
}

// the best per-frame time over a few windows: one slow window (GC, a noisy neighbour) cannot
// move a price, and the minimum is the cost the frame can reach. The spread between the best
// and the worst window is kept, because it is the noise a price has to be read against.
var spread = 0;
function frameMs(frames) {
	var best = Infinity, worst = 0, w, t, k2 = 0, chunks = 4, per = Math.max(1, Math.floor(frames / chunks)), v;
	for (w = 0; w < chunks; w++) {
		t = Date.now();
		for (k2 = 0; k2 < per; k2++) SIM.step();
		v = (Date.now() - t) / per;
		best = Math.min(best, v); worst = Math.max(worst, v);
	}
	spread = worst / best - 1;
	return best;
}

// the pool's typed arrays, in bytes
function poolBytes() {
	var names = PTPOOL.FIELDS.concat(PTPOOL.WORK), b = 0, k;
	for (k = 0; k < names.length; k++) b += S[names[k]].length * S[names[k]].BYTES_PER_ELEMENT;
	return b;
}

// ---------------------------------------------------------------- A. the pool at every rung
check.section('A. the pool at every quality rung');
console.log('  rung        mpc  base      reserve   capacity   pool MB   ms/frame');
var rowA = [], r, rung, M, ms, bytes;
for (r = 0; r < RUNGS.length; r++) {
	rung = RUNGS[r];
	M = configure(rung[0], rung[1], rung[2], 1);
	SIM.run(40);
	ms = frameMs(rung[0] === 256 ? 100 : 30);
	bytes = poolBytes();
	rowA.push({ base: P.partBase, cap: P.partCap, bytes: bytes, ms: ms });
	console.log('  ' + (rung[0] + 'x' + rung[1]).padEnd(10) + '  ' + rung[2] + '   '
		+ String(P.partBase).padEnd(9) + ' ' + String(P.partCap - P.partBase).padEnd(9) + ' '
		+ String(P.partCap).padEnd(10) + ' ' + (bytes / 1048576).toFixed(2).padStart(7)
		+ '   ' + ms.toFixed(2));
}
check.ok('the capacity is the base plus the reserve the params name',
	rowA.every(function (q) { return q.cap === q.base + Math.ceil(q.base * (SHIPPED[0] + SHIPPED[1] + SHIPPED[2])); }),
	rowA.map(function (q) { return q.cap; }).join(' / '));
check.ok('the base is the marker population, one row short of the top wall',
	rowA.every(function (q, i2) { return q.base === RUNGS[i2][2] * RUNGS[i2][0] * (RUNGS[i2][1] - 1); }),
	rowA.map(function (q) { return q.base; }).join(' / '));
check.info('the pool\'s typed arrays at each rung', rowA.map(function (q) {
	return (q.bytes / 1048576).toFixed(2) + ' MB';
}).join(' / ') + ' (sized to the capacity, not to n)');

// ---------------------------------------------------------------- B. the reserve sweep
check.section('B. the price of the reserve, with the reserve filled');
console.log('  rung        resFrac  melt/air/dep       cap      n        ms/frame  vs empty');
var sweep = [], shipped = null, empty = {};
for (r = 0; r < RUNGS.length; r++) {
	rung = RUNGS[r];
	for (var c = 0; c < SCALES.length; c++) {
		M = configure(rung[0], rung[1], rung[2], SCALES[c]);
		var made = fill(M);
		SIM.run(40);
		var msB = frameMs(FRAMES[r]), spreadB = spread;
		if (c === 0) empty[rung[0]] = msB;
		var rec = { rung: rung[0], scale: SCALES[c], resFrac: P.resFrac, cap: P.partCap,
			base: P.partBase, made: made, n: S.n, ms: msB, rel: msB / empty[rung[0]], spread: spreadB };
		sweep.push(rec);
		console.log('  ' + (rung[0] + 'x' + rung[1]).padEnd(10) + '  ' + P.resFrac.toFixed(2).padEnd(7)
			+ ' ' + (P.resMelt.toFixed(2) + '/' + P.resAir.toFixed(2) + '/' + P.resDep.toFixed(2)).padEnd(18)
			+ String(P.partCap).padEnd(8) + ' ' + String(S.n).padEnd(8) + ' '
			+ msB.toFixed(2).padStart(8) + '  ' + rec.rel.toFixed(3) + 'x  window spread '
			+ (100 * spreadB).toFixed(0) + '%');
		if (rung[0] === 256 && SCALES[c] === 1) shipped = rec;
	}
}
check.ok('the shipped rung fills its whole reserve exactly',
	shipped.made === shipped.cap - shipped.base && shipped.n === shipped.cap,
	shipped.made + ' admitted of ' + (shipped.cap - shipped.base) + ', n ' + shipped.n + '/' + shipped.cap);
// Keep the absolute frame gate fixed at 20 ms; the relative check separately catches a pool
// regression without changing that host bar.
check.ok('the shipped rung fits the 20 ms host gate with the reserve filled',
	shipped.ms < BUDGET, shipped.ms.toFixed(2) + ' ms/frame against ' + BUDGET + ' ms');

// The price gate reads a *ratio*, so both sides have to be timed under the same host. The sweep
// above measures the curve; this measures the pair, by reconfiguring and timing the empty pool
// and the filled one in alternating windows. The sweep's own window spread is wider than the
// price it is trying to resolve (measured: the same tree prices the shipped reserve anywhere in
// 1.33-1.48x across runs), so a ratio read across two minutes of host drift is a coin flip and
// not a measurement.
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
var PAIRS = 8, side = { empty: [], filled: [] }, k3, who, name;
for (k3 = 0; k3 < PAIRS; k3++) {
	for (who = 0; who < 2; who++) {
		M = configure(256, 24, 4, who);
		if (who) fill(M);
		SIM.run(20);
		side[who ? 'filled' : 'empty'].push(frameMs(60));
	}
}
var pairedEmpty = median(side.empty), pairedFilled = median(side.filled);
var price = pairedFilled / pairedEmpty;
check.ok('and the filled reserve costs the measured marginal price, not a regression',
	price < 1.4, price.toFixed(3) + 'x an empty pool, interleaved ('
	+ PAIRS + ' windows a side: empty ' + pairedEmpty.toFixed(2) + ' ms, filled '
	+ pairedFilled.toFixed(2) + ' ms, ' + (100 * Math.max(spread, 0)).toFixed(0) + '% spread)');
check.info('the same pair read the naive way, for the record',
	'sweep ratio ' + shipped.rel.toFixed(3) + 'x against the interleaved '
	+ price.toFixed(3) + 'x -- the difference is the host, not the pool');
check.info('the reserve\'s marginal price at 256x24, against an empty pool', sweep.slice(0, SCALES.length).map(function (q) {
	return 'reserve ' + q.resFrac.toFixed(2) + ' ' + q.rel.toFixed(3) + 'x';
}).join(', '));
check.info('the noise the prices sit in: the widest window spread in the sweep, per rung', RUNGS.map(function (q) {
	return q[0] + 'x' + q[1] + ' ' + (100 * Math.max.apply(null, sweep.filter(function (s2) {
		return s2.rung === q[0];
	}).map(function (s2) { return s2.spread; }))).toFixed(0) + '%';
}).join(', ') + ' -- a reserve price inside this spread is not resolved');
check.info('the finer rungs report their own cost, they make no budget claim', RUNGS.slice(1).map(function (q) {
	var rec = sweep.filter(function (s2) { return s2.rung === q[0] && s2.scale === 1; })[0];
	return q[0] + 'x' + q[1] + ' ' + rec.ms.toFixed(1) + ' ms with the reserve filled';
}).join(', '));

// ---------------------------------------------------------------- C. no allocation
check.section('C. a frame with the phases present at capacity constructs nothing');
M = configure(256, 24, 4, 1);
fill(M);
SIM.run(40);
var Real = { f64: Float64Array, f32: Float32Array, i32: Int32Array, u8: Uint8Array, u32: Uint32Array };
var madeArr = 0;
function counted(Ctor) {
	return new Proxy(Ctor, {
		construct: function (t, args) { madeArr++; return new t(args[0], args[1], args[2]); }
	});
}
global.Float64Array = counted(Real.f64); global.Float32Array = counted(Real.f32);
global.Int32Array = counted(Real.i32); global.Uint8Array = counted(Real.u8);
global.Uint32Array = counted(Real.u32);
var mu0 = process.memoryUsage();
try {
	SIM.run(400);
} finally {
	global.Float64Array = Real.f64; global.Float32Array = Real.f32; global.Int32Array = Real.i32;
	global.Uint8Array = Real.u8; global.Uint32Array = Real.u32;
}
var mu1 = process.memoryUsage();
check.ok('400 frames at capacity construct no typed array', madeArr === 0,
	madeArr + ' arrays over 400 frames, n ' + S.n + '/' + P.partCap);
check.ok('and grow no ArrayBuffer', (mu1.arrayBuffers - mu0.arrayBuffers) < 4096,
	'arrayBuffers ' + (mu1.arrayBuffers - mu0.arrayBuffers) + ' bytes');

// ---------------------------------------------------------------- D. capacity pressure
check.section('D. a live run pressed to the capacity loses nothing');
M = configure(256, 24, 4, 1);
SIM.run(50);
PTPOOL.inventoryComp(S);
var m0 = S.invMTot, given = [], admitted = 0, i3, p3, guard;
var refuse0 = S.tx.refuse, wall0 = S.wall, led0 = S.hLedger, nan = 0, worstEmpty = 0, forcedRef = 0;
var reachedCap = false, peakN = S.n;
for (i3 = 0; i3 < 20; i3++) {
	guard = 0;
	while (PTPOOL.room(S) > 0 && guard++ < 8000) {
		p3 = PTPOOL.admit(S, i3 % 3 === 0 ? P.PH.air : P.PH.dep);
		if (p3 < 0) break;
		place(M, p3, S.ph[p3]);
		given.push(S.m[p3]);
		admitted++;
	}
	if (S.n >= P.partCap) reachedCap = true;
	if (S.n > peakN) peakN = S.n;
	// press past the end: each of these must be counted as a refusal, not dropped silently.
	// P3.2's segregation defers at capacity too and those defers are counted the same way,
	// so the forced pair is checked at its own call sites and the total only grows above it
	if (PTPOOL.admit(S, P.PH.dep) < 0) forcedRef++;
	if (PTPOOL.split(S, 0, 0.5, P.PH.melt) < 0) forcedRef++;
	SIM.step();
	if (S.n > peakN) peakN = S.n;
}
var tD = Date.now();
for (i3 = 0; i3 < 150; i3++) {
	SIM.step();
	if (S.empty > worstEmpty) worstEmpty = S.empty;
}
var msD = (Date.now() - tD) / 150;
for (p3 = 0; p3 < S.n; p3++) {
	if (!isFinite(S.T[p3]) || !isFinite(S.H[p3]) || !isFinite(S.x[p3])) nan++;
}
PTPOOL.inventoryComp(S);
check.ok('the run reached the capacity and never exceeded it', reachedCap && peakN === P.partCap,
	'peak ' + peakN + '/' + P.partCap + ' after ' + admitted + ' admissions, at ' + S.n
	+ ' now (P3.2: the store drains a full pool by matched transfers)');
check.ok('and counted every forced refusal: 20 admits + 20 splits at the top',
	forcedRef === 40 && S.tx.refuse - refuse0 >= forcedRef, 'forced ' + forcedRef
	+ '   total refusals ' + (S.tx.refuse - refuse0) + ' (segregation defers included)');
check.near('the mass it gained is the mass it was given', S.invMTot - m0,
	neumaier(given, given.length), 1e-12, 'km2');
check.ok('no NaN at capacity over 170 frames', nan === 0, nan + ' of ' + S.n);
check.ok('coverage survived the pressure', worstEmpty < 0.15 * M.nx * (M.ny - 1),
	'worst ' + worstEmpty + ' of ' + M.nx * (M.ny - 1) + ' nodes');
var gap = (S.hLedger - led0) / (S.wall - wall0);
check.ok('and the enthalpy ledger still closes against the wall flux',
	gap > 0.8 && gap < 1.2, 'intake/wall ' + gap.toFixed(4));
check.info('a frame at capacity, with the pressure still on', msD.toFixed(2) + ' ms against ' + BUDGET + ' ms');

// ---------------------------------------------------------------- E. active P3.4 load
check.section('E. the shipped live eruption keeps flight and deposits active');
M = configure(256, 24, 4, 1);
PTPOOL.inventoryComp(S);
var activeM0 = S.invMTot, activeH0 = S.invHTot, activeHL0 = S.hLedger;
SIM.run(400);                                      // 20 Myr: beyond the first shipped eruption
var activeAir0 = S.invN[P.PH.air], activeDep0 = S.invN[P.PH.dep];
var activeMs = frameMs(200), activeSpread = spread;
PTPOOL.inventoryComp(S);
var activeEnt = ((S.invHTot - activeH0) - (S.hLedger - activeHL0)) / Math.abs(activeH0);
check.ok('the timed window really carries both moving clasts and landed deposits',
	activeAir0 > 0 && activeDep0 > 0 && S.invN[P.PH.air] > 0 && S.invN[P.PH.dep] > 0,
	'before ' + activeAir0 + '/' + activeDep0 + ' air/dep, after '
	+ S.invN[P.PH.air] + '/' + S.invN[P.PH.dep]);
check.ok('the live P3.4 window emits, lands and coalesces material',
	S.tx.emit > 0 && S.tx.land > 0 && S.tx.merge > 0,
	'emit ' + S.tx.emit + ' land ' + S.tx.land + ' merge ' + S.tx.merge);
check.ok('the active flight/deposit frame fits the fixed 20 ms host gate',
	activeMs < BUDGET, activeMs.toFixed(2) + ' ms/frame, window spread ' + (100 * activeSpread).toFixed(0) + '%');
check.near('active flight and landing conserve global mass', S.invMTot, activeM0, 1e-12, 'km2');
check.ok('their cooling closes global enthalpy against the heat book',
	Math.abs(activeEnt) < 1e-9, 'relative residual ' + activeEnt.toExponential(2));
check.ok('the live reserve admits every emitted batch', S.tx.refuse === 0 && S.n < P.partCap,
	'n ' + S.n + '/' + P.partCap + ' refusals ' + S.tx.refuse);
check.info('the active-load timing', activeMs.toFixed(2) + ' ms/frame after ' + S.tx.emit
	+ ' emissions and ' + S.tx.land + ' landings');

// ---------------------------------------------------------------- F. the inventory's cost
check.section('F. the inventory: the frame pass and the gate pass');
M = configure(256, 24, 4, 1);
fill(M);
SIM.run(20);
var k2, tE = Date.now();
for (k2 = 0; k2 < 1000; k2++) PTPOOL.inventory(S);
var msNaive = (Date.now() - tE) / 1000;
tE = Date.now();
for (k2 = 0; k2 < 200; k2++) PTPOOL.inventoryComp(S);
var msComp = (Date.now() - tE) / 200;
PTPOOL.inventory(S);
var naiveM = S.invMTot, naiveH = S.invHTot;
PTPOOL.inventoryComp(S);
check.ok('the frame inventory costs less than the whole frame budget',
	msNaive < BUDGET, msNaive.toFixed(3) + ' ms per call at n ' + S.n);
check.info('the compensated pass, for the fixtures', msComp.toFixed(3) + ' ms per call, '
	+ (msComp / msNaive).toFixed(1) + 'x the frame pass');
check.near('and the two agree on the mass they report', naiveM, S.invMTot, 1e-12, 'km2');
check.near('and on the enthalpy', naiveH, S.invHTot, 1e-12, 'km2*H');
var hv = new Float64Array(S.n), mv = new Float64Array(S.n), kk;
for (kk = 0; kk < S.n; kk++) { mv[kk] = S.m[kk]; hv[kk] = S.m[kk] * S.H[kk]; }
check.near('the compensated mass is the direct Neumaier sum', S.invMTot, neumaier(mv, S.n), 1e-14, 'km2');
check.near('and the compensated enthalpy is', S.invHTot, neumaier(hv, S.n), 1e-14, 'km2*H');
check.info('the naive pass\'s own loss against the compensated one, relative', S.invErr.toExponential(2));

// ---------------------------------------------------------------- G. the live populations at every rung
// 0.3.0-plan.md §7: "P3 must benchmark all supported rungs with melt, air and deposit populations
// enabled before fixing capacity or promising 60 fps." Sections A and B price every rung with the
// reserve *filled*, melt, air and deposits all present; this runs each rung live for the same
// 20 Myr as section E and records what the model itself puts in those phases, so the reserve's
// lines are checked against the model and not only against a fill. This is also where the
// obligation's other half shows up: the finer rungs do *not* promise the shipped rung's cadence.
check.section('G. every supported rung carries the live populations');
console.log('  rung        n/cap            melt (%)      air     dep     first eject   ms/frame');
var rowG = [], k4, peak, msG, firstEmit;
for (r = 0; r < RUNGS.length; r++) {
	rung = RUNGS[r];
	M = configure(rung[0], rung[1], rung[2], 1);
	peak = { melt: 0, air: 0, dep: 0 }; firstEmit = -1;
	for (k4 = 0; k4 < 400; k4++) {                 // 20 Myr, as section E at the shipped rung
		SIM.step();
		PTPOOL.inventory(S);
		if (S.invN[P.PH.melt] > peak.melt) peak.melt = S.invN[P.PH.melt];
		if (S.invN[P.PH.air] > peak.air) peak.air = S.invN[P.PH.air];
		if (S.invN[P.PH.dep] > peak.dep) peak.dep = S.invN[P.PH.dep];
		if (firstEmit < 0 && S.tx.emit > 0) firstEmit = k4;
	}
	// the census is read at the end of the 20 Myr leg; the timing window after it moves the
	// counters on, so snapshot before it or the row would quote 25 Myr of ejecta
	var legN = S.n, legEmit = S.tx.emit, legRefuse = S.tx.refuse;
	msG = frameMs(rung[0] === 256 ? 100 : (rung[0] === 512 ? 40 : 20));
	rowG.push({ rung: rung[0], ny: rung[1], peak: peak, base: P.partBase, ms: msG,
		refuse: legRefuse, n: legN, cap: P.partCap, emit: legEmit, first: firstEmit });
	console.log('  ' + (rung[0] + 'x' + rung[1]).padEnd(10) + '  ' + (legN + '/' + P.partCap).padEnd(15)
		+ '  ' + (peak.melt + ' (' + (100 * peak.melt / P.partBase).toFixed(1) + ')').padEnd(12)
		+ ' ' + String(peak.air).padEnd(6) + '  ' + String(peak.dep).padEnd(6) + '  '
		+ ((firstEmit < 0 ? 'none by 20 Myr' : ((firstEmit * 0.05).toFixed(1) + ' Myr')).padEnd(12)) + '  ' + msG.toFixed(2));
}
check.ok('every rung carries the melt band live and never crosses the reserve line',
	rowG.every(function (q) { return q.peak.melt > 0 && q.peak.melt / q.base < P.resMelt; }),
	rowG.map(function (q) { return (100 * q.peak.melt / q.base).toFixed(2) + '% of ' + (100 * P.resMelt) + '%'; }).join(' / '));
check.ok('the live melt band is the initial condition\'s own, not the mesh\'s',
	rowG.every(function (q) { return Math.abs(q.peak.melt / q.base - rowG[0].peak.melt / rowG[0].base) / (rowG[0].peak.melt / rowG[0].base) < 0.15; }),
	rowG.map(function (q) { return (100 * q.peak.melt / q.base).toFixed(2) + '%'; }).join(' / '));
check.ok('no rung refused a transfer or lost a parcel to its cap',
	rowG.every(function (q) { return q.refuse === 0 && q.n <= q.cap; }),
	rowG.map(function (q) { return q.rung + 'x' + q.ny + ' refusals ' + q.refuse + ' n ' + q.n + '/' + q.cap; }).join(' / '));
check.ok('every rung\'s live airborne and landed peaks stay under their lines', rowG.every(function (q) {
	return q.peak.air <= P.resAir * q.base && q.peak.dep <= P.resDep * q.base;
}), rowG.map(function (q) { return q.rung + 'x' + q.ny + ' air ' + (100 * q.peak.air / q.base).toFixed(2)
	+ '% dep ' + (100 * q.peak.dep / q.base).toFixed(2) + '%'; }).join(' / ')
	+ ' against the frozen ' + (100 * P.resAir) + '% / ' + (100 * P.resDep) + '%');
check.info('the finer rungs run the same kernels on their own cadence',
	rowG.slice(1).map(function (q) { return q.rung + 'x' + q.ny + ' ' + q.ms.toFixed(1) + ' ms/frame, '
		+ (q.emit ? q.emit + ' ejecta, first at ' + (q.first * 0.05).toFixed(1) + ' Myr' : 'no ejecta by 20 Myr')
		+ ', peaks ' + q.peak.melt + '/' + q.peak.air + '/' + q.peak.dep; }).join('; ')
	+ ' -- the plan fixes no cadence across rungs, only that the phases are enabled and the books close');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
