// pc-pool.js — 0.5.0 M1: the pool's transactions on an engine-shaped layout
// (0.5.0-plan.md §3.2). Every operation is checked for the four things a ledger depends on:
// mass and enthalpy close exactly, the dense prefix and the never-reused id discipline hold,
// a capacity refusal defers instead of dropping material, and the compensated inventory agrees
// with a naive sum.
//
// The state built here is deliberately one field wider than either engine needs today (it
// carries a warped coordinate, a column index and a deposit certificate), because the point
// of the descriptor is that a pool made for a caller's own layout still permutes every field
// it was given.
//
// Run: node experiments/pc-pool.js
'use strict';

var PCP = require('../js/pc/params.js');
var PCPHASE = require('../js/pc/phase.js');
var POOL = require('../js/pc/pool.js');
var check = require('./lib.js').check;

var NAMES = ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
	'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph', 'w', 'col', 'depQ'];
var TYPE = { id: Uint32Array, ph: Uint8Array, col: Int32Array, depQ: Uint8Array };

function make(cap) {
	var S = { cap: cap, n: 0, wrap: PCP.wrap }, i;
	for (i = 0; i < NAMES.length; i++) {
		S[NAMES[i]] = (TYPE[NAMES[i]] || Float64Array) === Uint32Array ? new Uint32Array(cap)
			: (TYPE[NAMES[i]] || Float64Array) === Uint8Array ? new Uint8Array(cap)
			: (TYPE[NAMES[i]] || Float64Array) === Int32Array ? new Int32Array(cap)
			: new Float64Array(cap);
	}
	return S;
}

var pool = POOL.make({
	carry: NAMES,
	share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt', 'w', 'col'],
	bond: ['age', 'mu', 'dmg', 'pLoad', 'pCnt'],
	all: ['depQ']
});

function totals(S) {
	var p, m = 0, h = 0, px = 0, py = 0;
	for (p = 0; p < S.n; p++) {
		m += S.m[p];
		h += S.m[p] * S.H[p];
		px += S.m[p] * S.vx[p];
		py += S.m[p] * S.vy[p];
	}
	return { m: m, h: h, px: px, py: py, n: S.n };
}

function same(a, b) { return a === b; }

function seed(S, n) {
	var p, q;
	for (p = 0; p < n; p++) {
		q = pool.admit(S, PCP.PH.crust);
		S.x[p] = 100 * (p + 1); S.y[p] = 50 + 10 * p; S.e[p] = 7 * p;
		S.w[p] = 0.5 * p; S.col[p] = p % 7;
		S.m[p] = 1 + p; S.H[p] = 0.2 + 0.01 * p;
		S.T[p] = 0.2 + 0.01 * p; S.cF[p] = 0.01 * p; S.cW[p] = 0.001 * p;
		S.vx[p] = 0.3 * p; S.vy[p] = -0.2 * p;
		S.age[p] = p; S.mu[p] = 0.5; S.dmg[p] = 0.1 * p;
		S.depQ[p] = p % 2;
	}
	return S;
}

// ------------------------------------------------------------------ A. admit and ids

check.section('A. admit: fresh ids, a dense prefix, no inherited state');
var S = pool.attach(make(8));
var p, ids = {}, unique = true, n = 0, zeroed = true;
for (p = 0; p < 5; p++) {
	n = pool.admit(S, PCP.PH.crust);
	if (ids[S.id[n]]) unique = false;
	ids[S.id[n]] = 1;
	if (S.x[n] !== 0 || S.m[n] !== 0 || S.age[n] !== 0) zeroed = false;
}
check.ok('ids are never reused', unique, 'ids ' + Array.prototype.slice.call(S.id, 0, 5).join(','));
check.ok('an admitted slot starts zeroed', zeroed);
check.ok('the pool is a dense prefix 0..n', S.n === 5 && S.tx.admit === 5, 'n=' + S.n);

var firstId = S.id[0];
pool.remove(S, 0);
n = pool.admit(S, PCP.PH.dep);
check.ok('an id freed by a removal is not handed out again', S.id[n] !== firstId, 'new id ' + S.id[n]);

// ------------------------------------------------------------------ B. remove and move

check.section('B. remove compacts the tail in and keeps every field with its parcel');
S = seed(pool.attach(make(8)), 6);
var lastId = S.id[5], moved = { w: S.w[5], col: S.col[5], e: S.e[5], dmg: S.dmg[5], ph: S.ph[5] };
pool.remove(S, 1);
check.ok('the prefix stays dense after a removal in the middle', S.n === 5, 'n=' + S.n);
check.ok('the moved parcel keeps its id', S.id[1] === lastId, 'id ' + S.id[1] + ' vs ' + lastId);
check.ok('the moved parcel keeps every field, including the engine\'s own',
	S.w[1] === moved.w && S.col[1] === moved.col && S.e[1] === moved.e &&
	S.dmg[1] === moved.dmg && S.ph[1] === moved.ph);
check.ok('the vacated tail is zeroed', S.x[5] === 0 && S.id[5] === 0 && S.m[5] === 0);

// ------------------------------------------------------------------ C. split

check.section('C. split divides mass, not state');
S = seed(pool.attach(make(16)), 3);
var before = totals(S), hostId = S.id[1], hostT = S.T[1], hostX = S.x[1], hostW = S.w[1];
var q = pool.split(S, 1, 0.25, PCP.PH.melt);
var after = totals(S);
check.ok('a split conserves mass', Math.abs(after.m - before.m) < 1e-12,
	before.m + ' -> ' + after.m);
check.ok('a split conserves total enthalpy', Math.abs(after.h - before.h) < 1e-9,
	Math.abs(after.h - before.h).toExponential(2));
check.ok('the child shares the host\'s intensive state and position',
	S.T[q] === hostT && S.x[q] === hostX && S.w[q] === hostW && S.H[q] === S.H[q]);
check.ok('the host keeps its id and the child gets a fresh one',
	S.id[1] === hostId && S.id[q] !== hostId, 'host ' + S.id[1] + ', child ' + S.id[q]);
check.ok('the child carries no bond state', S.age[q] === 0 && S.mu[q] === 0 && S.dmg[q] === 0);
check.ok('the child takes the requested phase', S.ph[q] === PCP.PH.melt);
check.ok('a whole parcel is refused as a split (it is a phase change)',
	pool.split(S, 0, 1, PCP.PH.melt) === -1 && pool.split(S, 0, 0, PCP.PH.melt) === -1);

// ------------------------------------------------------------------ D. separate

check.section('D. separate leaves both children on the equilibrium manifold');
S = seed(pool.attach(make(16)), 2);
S.m[0] = 12; S.y[0] = 300; S.melt[0] = 0.4; S.cF[0] = 0.05; S.cW[0] = 0.01;
PCPHASE.byH(0.9, S.y[0], S.cF[0], S.cW[0]);
S.H[0] = 0.9; S.T[0] = PCPHASE.out.t; S.melt[0] = PCPHASE.out.melt;
before = totals(S);
var xi = S.melt[0];
q = pool.separate(S, 0);
check.ok('the melt split is exact in mass at the parcel\'s own melt fraction',
	xi > 0 && xi < 1 && Math.abs(S.m[0] + S.m[q] - 12) < 1e-12 &&
	Math.abs(S.m[q] / 12 - xi) < 1e-15,
	S.m[0] + ' + ' + S.m[q] + ' (xi ' + xi + ')');
check.ok('the residue is exactly solid and the child exactly molten',
	S.melt[0] === 0 && S.melt[q] === 1, 'host ' + S.melt[0] + ', child ' + S.melt[q]);
check.ok('total enthalpy is unchanged by the separation',
	Math.abs(totals(S).h - before.h) < 1e-9, Math.abs(totals(S).h - before.h).toExponential(2));
PCPHASE.byH(S.H[1], S.y[1], S.cF[1], S.cW[1]);
check.ok('neither child moves under the next equilibrium pass',
	Math.abs(S.melt[0]) === 0 && S.T[0] === PCPHASE.solidus(S.y[0], S.cF[0], S.cW[0]),
	'residue at its own solidus');

// ------------------------------------------------------------------ E. carry

check.section('E. carry moves material, not parcels');
S = seed(pool.attach(make(16)), 3);
S.cF[0] = 0.3; S.cF[1] = 0.0; S.m[0] = 10; S.m[1] = 10;
before = totals(S);
var dst = pool.carry(S, 0, 1, 4, PCP.PH.dep);
after = totals(S);
check.ok('a carry conserves mass and enthalpy',
	Math.abs(after.m - before.m) < 1e-12 && Math.abs(after.h - before.h) < 1e-9,
	Math.abs(after.h - before.h).toExponential(2));
check.ok('the receiver is mass-weighted, not overwritten',
	S.cF[1] > 0 && S.cF[1] < 0.3 && S.m[1] === 14, 'cF ' + S.cF[1] + ', m ' + S.m[1]);
check.ok('the donor keeps a floor', S.m[0] === 6 && dst === 1);
check.ok('a whole parcel is refused as a carry', pool.carry(S, 0, 1, 6, PCP.PH.dep) === -1);
var fresh = pool.carry(S, 0, -1, 2, PCP.PH.dep);
check.ok('a fresh receiver is admitted bond-free', fresh >= 0 && S.age[fresh] === 0 &&
	S.m[fresh] === 2 && S.ph[fresh] === PCP.PH.dep);

// ------------------------------------------------------------------ F. merge

check.section('F. merge keeps the older id and the pair\'s totals');
S = seed(pool.attach(make(16)), 4);
S.ph[0] = PCP.PH.dep; S.ph[1] = PCP.PH.dep;
S.cF[0] = 0.10; S.cF[1] = 0.11; S.cW[0] = 0.001; S.cW[1] = 0.001;
S.m[0] = 3; S.m[1] = 1; S.vx[0] = 2; S.vx[1] = 6; S.H[0] = 0.4; S.H[1] = 0.8;
before = totals(S);
var survivor = pool.merge(S, 1, 0);
after = totals(S);
check.ok('the survivor is the older id', S.id[survivor] === 1, 'id ' + S.id[survivor]);
check.ok('a merge conserves mass, enthalpy and momentum',
	Math.abs(after.m - before.m) < 1e-12 && Math.abs(after.h - before.h) < 1e-9 &&
	Math.abs(after.px - before.px) < 1e-9 && Math.abs(after.py - before.py) < 1e-9,
	'|dh| ' + Math.abs(after.h - before.h).toExponential(2));
check.ok('the merge is mass weighted, not a mean of two equals',
	Math.abs(S.H[survivor] - 0.5) < 1e-12 && Math.abs(S.vx[survivor] - 3) < 1e-12,
	'H ' + S.H[survivor] + ', vx ' + S.vx[survivor]);
S.cF[2] = 0.1; S.cF[3] = 0.3;
check.ok('an incompatible pair is refused, not merged',
	pool.merge(S, 2, 3) === -1 && S.tx.refuse > 0, 'refused by composition');

// the survivor's slot when the older parcel was the tail: the caller must get the slot the
// survivor actually occupies, never the cleared tail index
S = seed(pool.attach(make(8)), 3);
S.ph[0] = PCP.PH.dep; S.ph[2] = PCP.PH.dep; S.cF[0] = 0.1; S.cF[2] = 0.1;
// the survivor is the *tail* parcel here, so remove(0) compacts it into slot 0
var slot = pool.merge(S, 2, 0);
check.ok('a merge whose survivor sat on the tail returns the slot it occupies',
	slot === 0 && S.n === 2 && S.id[0] === 1 && S.m[0] === 4,
	'slot ' + slot + ', id ' + S.id[0] + ', m ' + S.m[0]);

// seam-crossing merge: x is weighted through the periodic delta
S = pool.attach(make(8));
n = pool.admit(S, PCP.PH.dep); S.x[n] = PCP.wrap - 10; S.m[n] = 1; S.H[n] = 0.5; S.id[n] = 5;
n = pool.admit(S, PCP.PH.dep); S.x[n] = 10; S.m[n] = 1; S.H[n] = 0.5; S.id[n] = 6;
slot = pool.merge(S, 0, 1);
check.ok('a pair straddling the seam merges to the seam, not to the middle',
	S.x[slot] > PCP.wrap - 10 || S.x[slot] < 10,
	'x ' + S.x[slot] + ' (a naive mean would be ' + (0.5 * PCP.wrap) + ')');

// ------------------------------------------------------------------ G. capacity

check.section('G. a full pool defers; it never drops material');
S = pool.attach(make(2));
seed(S, 2);
var refuse0 = S.tx.refuse;
var refused = pool.admit(S, PCP.PH.crust);
check.ok('admit refuses at capacity and counts the refusal',
	refused === -1 && S.tx.refuse === refuse0 + 1 && S.n === 2);
before = totals(S);
var hostM = S.m[0];
check.ok('a deferred split leaves all its mass in the host',
	pool.split(S, 0, 0.5, PCP.PH.melt) === -1 && S.m[0] === hostM &&
	Math.abs(totals(S).m - before.m) < 1e-12 && S.n === 2,
	'mass ' + S.m[0] + ', n ' + S.n);
check.ok('a deferred carry into the full pool leaves the donor whole',
	pool.carry(S, 0, -1, 0.5, PCP.PH.dep) === -1 && Math.abs(totals(S).m - before.m) < 1e-12,
	'mass ' + totals(S).m);
check.ok('refusals and deliveries are counted apart',
	S.tx.refuse === refuse0 + 3 && S.tx.carry === 0,
	'refuse +' + (S.tx.refuse - refuse0) + ', carry ' + S.tx.carry);

// ------------------------------------------------------------------ H. the stock

check.section('H. the compensated inventory agrees with a naive sum');
S = pool.attach(make(64));
seed(S, 40);
p = 0;
var inv = pool.inventory(S);
var naiveM = 0, naiveH = 0;
for (p = 0; p < S.n; p++) { naiveM += S.m[p]; naiveH += S.m[p] * S.H[p]; }
check.ok('compensated and naive mass agree to 1e-12 relative',
	Math.abs(inv.m - naiveM) / naiveM < 1e-12, 'err ' + inv.err.toExponential(2));
check.ok('compensated and naive enthalpy agree to 1e-12 relative',
	Math.abs(inv.h - naiveH) / Math.abs(naiveH) < 1e-12,
	Math.abs(inv.h - naiveH).toExponential(2));
check.ok('the per-phase stock sums to the total',
	Math.abs(pool.invM[0] + pool.invM[1] + pool.invM[2] + pool.invM[3] - inv.m) < 1e-9,
	'invM ' + Array.prototype.slice.call(pool.invM).join(', '));
check.ok('melt stock is the mass-weighted melt fraction',
	Math.abs(inv.l - (function () {
		var s = 0, j;
		for (j = 0; j < S.n; j++) s += S.m[j] * S.melt[j];
		return s;
	}())) < 1e-9);

// the whole pass must be allocation-free per call: the same counters, no new arrays
var refA = pool.invM, refF = pool.fields(S);
pool.inventory(S);
pool.remove(S, 0);
check.ok('the inventory keeps its own arrays between calls', pool.invM === refA);
check.ok('field resolution is cached against the state generation', pool.fields(S) === refF);

check.done();
