// pc-phase.js — 0.5.0 M1's first gate (0.5.0-plan.md §3.1, §9 M1): the transplanted phase
// law is bitwise 0.3's at `solidusOf: 'depth'`, and the load branch is the monotone,
// continuous curve the S4 mechanism needs.
//
// The transplant is the release's one reuse claim, so it is gated the strict way: same
// (y, cF, cW, H) lattice into both modules, every returned number compared with `===`, not a
// tolerance. A drift in a constant, in the decay, or in the order of the arithmetic fails.
//
// Run: node experiments/pc-phase.js
'use strict';

var PCP = require('../js/pc/params.js');
var PCPHASE = require('../js/pc/phase.js');
var PTP = require('../js/pt/params.js');
var PTPHASE = require('../js/pt/phase.js');
var check = require('./lib.js').check;

function section(t) { check.section(t); }

// ---------------------------------------------------------------- the frozen constants

section('A. the law\'s constants are 0.3\'s, bitwise');

[
	['meltSurf'], ['meltSup'], ['meltOnset'], ['meltGap'], ['meltLat'], ['meltWF'], ['meltWW'],
	['meltDrop'], ['meltInvLam'], ['meltU0'], ['meltDeep'],
	['wrap'], ['depth'], ['yLin']
].forEach(function (row) {
	var k = row[0];
	check.ok('pc/params ' + k + ' equals js/pt/params ' + k, PCP[k] === PTP[k],
		PCP[k] + (PCP[k] === PTP[k] ? '' : ' vs ' + PTP[k]));
});

check.ok('the clock is 0.3\'s (5..500 kyr/frame, 50 default)',
	PCP.kyrMin === PTP.dtMin && PCP.kyrMax === PTP.dtMax && PCP.kyr0 === PTP.dt0,
	PCP.kyrMin + '..' + PCP.kyrMax + ' kyr, ' + PCP.kyr0 + ' default');
check.ok('the airborne clamp is 0.3\'s flight interval',
	PCP.flightDtMax === PTP.dtFluidMax, PCP.flightDtMax + ' Myr');

// ---------------------------------------------------------------- the depth branch

// the lattice: the sky above the surface, the surface itself, the three anchors of the curve,
// the CMB, and a composition cross of felsic and water content
var YS = [-40, -0.001, 0, 1e-9, 0.5, 5, 40, 80, 120, 300, 601, 700, 1200, 2010, 2900, 2901];
var CS = [[0, 0], [-0.5, 0.02], [0.02, 0.002], [0.35, 0.01], [1, 0.05]];
var TS = [-0.5, 0, 0.2, 0.4, 0.5, 0.7, 0.77, 0.9, 1, 1.05, 1.2, 1.4];
var HS = [-0.2, 0, 0.3, 0.5, 0.77, 0.9, 1, 1.02, 1.1, 1.3, 1.6];

function same(a, b) { return a === b; }

section('B. at solidusOf \'depth\' the curve and both mappings are bitwise 0.3\'s');

PCP.solidusOf = 'depth';
var i, j, k, y, c, H, T, got, want, bad = 0, n = 0, badH = 0, badT = 0, badInv = 0;

for (i = 0; i < YS.length; i++) for (j = 0; j < CS.length; j++) {
	y = YS[i]; c = CS[j];
	got = PCPHASE.solidus(y, c[0], c[1]);
	want = PTPHASE.solidus(y, c[0], c[1]);
	n++;
	if (!same(got, want)) bad++;
	got = PCPHASE.liquidus(y, c[0], c[1]);
	want = PTPHASE.liquidus(y, c[0], c[1]);
	if (!same(got, want)) bad++;
}
check.ok('solidus and liquidus agree on ' + n + ' (y, cF, cW) pairs', bad === 0,
	bad + ' differ');

n = 0;
for (i = 0; i < YS.length; i++) for (j = 0; j < CS.length; j++) for (k = 0; k < HS.length; k++) {
	y = YS[i]; c = CS[j]; H = HS[k];
	PCPHASE.byH(H, y, c[0], c[1]);
	var pcT = PCPHASE.out.t, pcM = PCPHASE.out.melt;
	PTPHASE.byH(H, y, c[0], c[1]);
	n++;
	if (!same(pcT, PTPHASE.out.t) || !same(pcM, PTPHASE.out.melt)) badH++;
}
check.ok('byH gives the same (T, melt) on ' + n + ' (H, y, cF, cW) triples', badH === 0,
	badH + ' differ');

n = 0;
for (i = 0; i < YS.length; i++) for (j = 0; j < CS.length; j++) for (k = 0; k < TS.length; k++) {
	y = YS[i]; c = CS[j]; T = TS[k];
	PCPHASE.byT(T, y, c[0], c[1]);
	var pcH = PCPHASE.out.h, pcM2 = PCPHASE.out.melt;
	PTPHASE.byT(T, y, c[0], c[1]);
	n++;
	if (!same(pcH, PTPHASE.out.h) || !same(pcM2, PTPHASE.out.melt)) badT++;
}
check.ok('byT gives the same (H, melt) on ' + n + ' (T, y, cF, cW) triples', badT === 0,
	badT + ' differ');

// The two mappings are exact inverses in the arithmetic sense that matters: one ulp. The
// round trip is not bitwise for a mushy H (byT recomputes the melt fraction from T instead of
// recovering it), so the gate is the measured bound and the bitwise claim is the one that
// does hold: pc's round trip is *the same numbers* as 0.3's round trip, ulp for ulp.
n = 0;
var rtDiff = 0, worstRel = 0, rt = 0;
for (i = 0; i < YS.length; i++) for (j = 0; j < CS.length; j++) for (k = 0; k < HS.length; k++) {
	y = YS[i]; c = CS[j]; H = HS[k];
	PCPHASE.byH(H, y, c[0], c[1]);
	PCPHASE.byT(PCPHASE.out.t, y, c[0], c[1]);
	rt = PCPHASE.out.h;
	PTPHASE.byH(H, y, c[0], c[1]);
	PTPHASE.byT(PTPHASE.out.t, y, c[0], c[1]);
	if (!same(rt, PTPHASE.out.h)) rtDiff++;
	worstRel = Math.max(worstRel, Math.abs(rt - H) / (Math.abs(H) || 1));
	n++;
}
check.ok('byT(byH(H)) is 0.3\'s own round trip, bitwise, on ' + n + ' states',
	rtDiff === 0, rtDiff + ' differ');
check.ok('the round trip closes to one ulp', worstRel <= 4e-16,
	'max relative ' + worstRel.toExponential(2));

// the amendment must be inert here: an extra load argument cannot reach the depth reading
var withLoad = PCPHASE.solidus(1200, 0.2, 0.01, 5);
var without = PCPHASE.solidus(1200, 0.2, 0.01);
check.ok('a load argument is ignored when solidusOf is depth', withLoad === without,
	withLoad + ' vs ' + without);

// ---------------------------------------------------------------- the load branch

section('C. the load branch reads the column, not the depth');

PCP.solidusOf = 'load';
var atDepth = PCPHASE.solidus(1200, 0, 0), atShallow = PCPHASE.solidus(1200, 0, 0, 120);
check.ok('under a shallower column the solidus is lower (unloading melts)',
	atShallow < atDepth, atDepth.toFixed(6) + ' at 1200 km load, ' + atShallow.toFixed(6) +
	' at 120 km load');

var prev = -Infinity, mono = true, t;
for (k = 0; k <= 40; k++) {
	t = PCPHASE.solidus(1200, 0.1, 0.005, 2900 * k / 40);
	if (!(t >= prev)) { mono = false; break; }
	prev = t;
}
check.ok('the load branch is monotone in the load', mono, '0..2900 km of column');

// continuity at the surface: the curve is flat above it and joins the load branch at 0
var below = PCPHASE.solidus(-40, 0.1, 0.005, 0);
var at0 = PCPHASE.solidus(0, 0.1, 0.005, 0);
var near = PCPHASE.solidus(1e-6, 0.1, 0.005, 1e-6);
check.ok('the load branch joins the surface value continuously',
	below === at0 && Math.abs(near - at0) < 1e-7, at0 + ' / ' + near +
	' (the curve\'s own slope over 1e-6 km)');

// a parcel with no column (a page that has not built one yet) falls back to its depth, and a
// NaN never becomes the pressure
check.ok('an absent or non-finite load falls back to depth',
	PCPHASE.solidus(1200, 0, 0, undefined) === PCPHASE.solidus(1200, 0, 0, 1200) &&
	PCPHASE.solidus(1200, 0, 0, NaN) === PCPHASE.solidus(1200, 0, 0, 1200),
	String(PCPHASE.solidus(1200, 0, 0, undefined)));

// the S4 negative control is only meaningful if the depth branch really does not move when
// the load does: the same unload under `depth` must leave the solidus exactly where it was
PCP.solidusOf = 'depth';
var d0 = PCPHASE.solidus(300, 0.1, 0.01, 300);
var d1 = PCPHASE.solidus(300, 0.1, 0.01, 30);
check.ok('the depth branch is unmoved by the same unload (S4\'s control)', d0 === d1,
	d0 + ' vs ' + d1);

// ---------------------------------------------------------------- the equilibrium pass

section('D. the equilibrium pass books its own sensible change');

function parcelState(n) {
	var S = { n: n };
	['m', 'H', 'T', 'melt', 'cF', 'cW', 'y'].forEach(function (name) {
		S[name] = new Float64Array(n);
	});
	S.ledger = 0;
	return S;
}

var S = parcelState(4), p;
for (p = 0; p < 4; p++) {
	S.m[p] = 10 + p;
	S.y[p] = 100 * (p + 1);
	S.H[p] = 0.5 + 0.2 * p;
	S.T[p] = -1;            // a state the pass must overwrite
	S.melt[p] = -1;
}
PCP.solidusOf = 'load';
PCPHASE.equil(S);
var consistent = true, booked = 0;
for (p = 0; p < 4; p++) {
	PCPHASE.byH(S.H[p], S.y[p], S.cF[p], S.cW[p], -1);
	if (PCPHASE.out.t !== S.T[p] || PCPHASE.out.melt !== S.melt[p]) consistent = false;
}
check.ok('every parcel leaves the pass on the equilibrium manifold', consistent);
check.ok('the pass books the sensible change it made', isFinite(S.ledger) && S.ledger !== 0,
	'ledger ' + S.ledger);

var S2 = parcelState(2);
S2.m[0] = 5; S2.y[0] = 200; S2.T[0] = 0.1; S2.H[0] = 0.1;
S2.m[1] = 5; S2.y[1] = 200; S2.T[1] = 0.1; S2.H[1] = 0.1;
PCPHASE.equil(S2);
check.ok('a state already in equilibrium books nothing', S2.ledger === 0,
	'ledger ' + S2.ledger);

PCP.solidusOf = PCP.solidusOf === 'load' ? 'load' : 'load';
check.done();
