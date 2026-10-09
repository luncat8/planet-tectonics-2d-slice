// erupt-bench.js — 0.2.0 M0: the toy eruptive box, headless. Throughput with 16 vents,
// a prescribed effusive flux builds a repose cone that freezes, an explosive flux lands
// as tephra, the pile is mass-exact, slumping only moves material downhill, and the box is
// deterministic. Run: node experiments/erupt-bench.js
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, ERUPT = L.mods.erupt;
var W = P.ventBoxW, tanR = Math.tan(P.repose);

function reset(v) {
	S.reset();
	S.nVen = v === undefined ? 1 : v + 1;
	for (var k = 0; k < S.nVen; k++) ERUPT.reset(k);
}

// tallest column, columns at least one cell high, and the largest column-to-column step
function profile(v) {
	var b = v * W, x, top = 0, n = 0, step = 0, d;
	for (x = 0; x < W; x++) {
		if (S.toyH[b + x] > top) top = S.toyH[b + x];
		if (S.toyH[b + x] >= 1) n++;
	}
	for (x = 0; x < W - 1; x++) {
		d = Math.abs(S.toyH[b + x] - S.toyH[b + x + 1]);
		if (d > step) step = d;
	}
	return { H: top, width: n, step: step };
}

function frozenAll(v) {
	var b = v * W, x, c, bad = 0;
	for (x = 0; x < W; x++) {
		c = b + x;
		if (S.toyH[c] - S.toyFz[c] > 1e-9) bad++;
	}
	return bad;
}

function ledgerError(v) {
	var got = ERUPT.mass(v), want = S.venToyIn[v];
	return Math.abs(got - want) / Math.max(1, want);
}

check.section('M0.1 throughput: 16 vents, one frame (1800 s) each');
reset(15);
for (var v = 0; v < 16; v++) { S.venGas[v] = 0.1; S.venFlux[v] = 0.02; }
var frames = 300, t0 = process.hrtime.bigint(), f;
for (f = 0; f < frames; f++) for (v = 0; v < 16; v++) ERUPT.step(1800, v);
var secs = Number(process.hrtime.bigint() - t0) / 1e9;
check.ok('16 vents step >= 60 frames/s', frames / secs >= 60, (frames / secs).toFixed(0) + ' frames/s, ' +
	(1e3 * secs / frames).toFixed(2) + ' ms per frame');

check.section('M0.2 effusive: a prescribed flux builds a repose cone that freezes');
reset(0);
S.venGas[0] = 0.1;
S.venFlux[0] = 150 / (2 * 3600);     // 150 cells^2 (a 30-wide, 10-high triangle) over 2 h
for (f = 0; f < 4; f++) ERUPT.step(1800, 0);
S.venFlux[0] = 0;
var worstLedger = 0;
for (f = 0; f < 40; f++) {
	ERUPT.step(1800, 0);
	worstLedger = Math.max(worstLedger, ledgerError(0));
}
var p = profile(0);
check.info('effusive profile', 'H ' + p.H.toFixed(2) + ' cells, width ' + p.width + ' cells, max step ' +
	p.step.toFixed(3) + ' (tan repose ' + tanR.toFixed(3) + ')');
check.ok('cone height in the 10-30 cell band', p.H >= 10 && p.H <= 30, 'H ' + p.H.toFixed(2));
check.ok('cone width in the 10-30 cell band', p.width >= 10 && p.width <= 30, 'width ' + p.width);
check.ok('flanks settle at the repose slope (within 10%)', Math.abs(p.step - tanR) < 0.1 * tanR,
	'step ' + p.step.toFixed(3));
check.ok('the cooled pile is entirely solid', frozenAll(0) === 0, 'molten columns ' + frozenAll(0));
check.ok('effusive pile is lava-lithology', S.toyLi[ERUPT.at(0, W >> 1)] === P.LITH.lava);
check.ok('effusive mass is exact (rel < 1e-9 at every frame)', worstLedger < 1e-9,
	'worst rel ' + worstLedger.toExponential(2));

check.section('M0.3 explosive: packets land as cold tephra, and the box drains');
reset(0);
S.venGas[0] = 0.6;
S.venFlux[0] = 150 / (2 * 3600);
worstLedger = 0;
for (f = 0; f < 4; f++) {
	ERUPT.step(1800, 0);
	worstLedger = Math.max(worstLedger, ledgerError(0));
}
var inFlightMid = S.prN[0];
S.venFlux[0] = 0;
for (f = 0; f < 4; f++) ERUPT.step(1800, 0);
p = profile(0);
check.info('explosive profile', 'H ' + p.H.toFixed(2) + ' cells, width ' + p.width + ' cells, packets in flight mid-eruption ' + inFlightMid);
check.ok('explosive packets are airborne while erupting', inFlightMid > 0, 'in flight ' + inFlightMid);
check.ok('all packets have landed after the eruption', S.prN[0] === 0, 'in flight ' + S.prN[0]);
check.ok('explosive pile is tephra-lithology and solid', frozenAll(0) === 0 &&
	S.toyLi[ERUPT.at(0, W >> 1)] === P.LITH.tephra);
check.ok('explosive mass is exact (rel < 1e-9 at every frame)', worstLedger < 1e-9,
	'worst rel ' + worstLedger.toExponential(2));
check.ok('explosive edifice has a 10-30 cell height and width', p.H >= 10 && p.H <= 30 && p.width >= 10 && p.width <= 30,
	'H ' + p.H.toFixed(2) + ', width ' + p.width);

check.section('M0.4 packet pool is bounded and overflow stays molten');
reset(0);
S.venGas[0] = 0.6;
S.venFlux[0] = 0.5;
S.prN[0] = P.partCap;                 // the pool is full before the feed
ERUPT.step(60, 0);
check.ok('a full packet pool does not drop mass', ledgerError(0) < 1e-9, 'rel ' + ledgerError(0).toExponential(2));
check.ok('the pool never exceeds its capacity', S.prN[0] <= P.partCap, 'n ' + S.prN[0]);
S.venFlux[0] = 0;
for (f = 0; f < 8; f++) ERUPT.step(1800, 0);
check.ok('overflow molten mass cools to solid', frozenAll(0) === 0);

check.section('M0.5 slumping: mass-exact, downhill, settles to repose');
reset(0);
var b0 = ERUPT.at(0, 0), x, m0, sum2 = [];
for (x = 0; x < W; x++) S.toyH[b0 + x] = 0;
S.toyH[b0 + (W >> 1)] = 12;
S.toyFz[b0 + (W >> 1)] = 12;
S.venToyIn[0] = 12;
m0 = ERUPT.mass(0);
var neverNegative = true, sumDown = true, prev = 0, cur, h2 = 0;
for (x = 0; x < W; x++) h2 += S.toyH[b0 + x] * S.toyH[b0 + x];
prev = h2;
for (f = 0; f < 60; f++) {
	ERUPT.slump(0);
	h2 = 0;
	for (x = 0; x < W; x++) {
		if (S.toyH[b0 + x] < 0) neverNegative = false;
		h2 += S.toyH[b0 + x] * S.toyH[b0 + x];
	}
	if (h2 > prev + 1e-9) sumDown = false;
	prev = h2;
}
check.ok('slumping keeps the mass exact', Math.abs(ERUPT.mass(0) - m0) < 1e-9 * m0, 'mass ' + ERUPT.mass(0));
check.ok('no column ever goes negative', neverNegative);
check.ok('slumping never raises the pile energy (sum of h^2)', sumDown);
var pr = profile(0);
check.ok('a steep spike relaxes to the repose slope', pr.step <= tanR + 0.05, 'step ' + pr.step.toFixed(3));

check.section('M0.6 determinism and idle');
function run() {
	reset(0);
	S.venGas[0] = 0.6; S.venFlux[0] = 0.03;
	for (var k = 0; k < 6; k++) ERUPT.step(1800, 0);
	return S.hash();
}
var h1 = run(), h2b = run();
check.ok('same flux, same box: bitwise-identical state', h1 === h2b, h1 + ' ' + h2b);
reset(0);
var before = S.hash();
ERUPT.step(1800, 0);
check.ok('zero flux, empty box: nothing changes', S.hash() === before);

check.done();
