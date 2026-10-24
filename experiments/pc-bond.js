// pc-bond.js — 0.5.0 M1: the bond law transplant (0.5.0-plan.md §3.3).
//
// Two gates. First the law itself: strength at a (T, age, melt) state must equal 0.3's
// formula, recomputed here independently from js/pt/params.js, term for term. Second the
// state machine around it: the age hysteresis, the anneal, the yWeldMax ceiling, the "air
// carries no bond" rule, and the damage pass's *mean* excess — the property 0.3 measured
// after the sum made failure a function of sampling density.
//
// Run: node experiments/pc-bond.js
'use strict';

var PCP = require('../js/pc/params.js');
var PTP = require('../js/pt/params.js');
var PCBOND = require('../js/pc/bond.js');
var check = require('./lib.js').check;

function smoothstep(a, b, x) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
}

function state(n) {
	var S = { n: n };
	['x', 'y', 'T', 'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'melt'].forEach(function (k) {
		S[k] = new Float64Array(n);
	});
	S.ph = new Uint8Array(n);
	return S;
}

check.section('A. the constants are 0.3\'s, bitwise');
['tauWeld', 'muLo', 'muHi', 'clusterMin', 'yieldRate', 'kDamage', 'tauHeal', 'yWeldMax',
	'TLock', 'TSoft'].forEach(function (k) {
	check.ok('pc/params ' + k + ' equals js/pt/params ' + k, PCP[k] === PTP[k],
		PCP[k] + (PCP[k] === PTP[k] ? '' : ' vs ' + PTP[k]));
});
check.ok('the elastic strain bound is the plan\'s 0.05', PCP.eps0 === 0.05, PCP.eps0);

check.section('B. strength is 0.3\'s formula, term for term');
var bad = 0, n = 0, i, j, k, T, age, melt, want, got;
var TS = [-1, 0, 0.2, 0.34, 0.35, 0.4, 0.45, 0.6, 0.85, 1, 1.2];
var AS = [0, 0.5, 5, 20, 40, 100, 1000];
var MS = [0, 0.1, 0.5, 1];
for (i = 0; i < TS.length; i++) for (j = 0; j < AS.length; j++) for (k = 0; k < MS.length; k++) {
	T = TS[i]; age = AS[j]; melt = MS[k];
	want = (0.05 + 0.95 * (1 - smoothstep(PTP.muLo, PTP.muHi, T))) *
		(1 - Math.exp(-age / PTP.tauWeld)) * (1 - melt);
	got = PCBOND.mu(T, age, melt);
	n++;
	if (got !== want) bad++;
}
check.ok('mu matches 0.3\'s formula bitwise on ' + n + ' states', bad === 0, bad + ' differ');
check.ok('mu is 0 above TSoft and 1 at the muLo floor with full melt',
	PCBOND.mu(0.9, 100, 0) === (0.05 + 0.95 * 0) * (1 - Math.exp(-100 / PCP.tauWeld)),
	PCBOND.mu(0.9, 100, 0) + '');
check.ok('a fully molten parcel has no strength', PCBOND.mu(1, 1000, 1) === 0);
check.ok('the elastic strain bound scales with strength',
	PCBOND.elastic(0.5) === PCP.eps0 * 0.5 && PCBOND.elastic(0) === 0,
	PCBOND.elastic(0.5) + ' at mu 0.5');
check.ok('the plate threshold is 0.3\'s clusterMin',
	PCBOND.isPlate(PCP.clusterMin) && !PCBOND.isPlate(PCP.clusterMin - 1e-9));

check.section('C. the age hysteresis and the anneal');
var S = state(5);
S.ph[0] = PCP.PH.crust; S.T[0] = 0.1; S.y[0] = 50; S.age[0] = 10; S.dmg[0] = 0.8;
S.ph[1] = PCP.PH.crust; S.T[1] = 0.40; S.y[1] = 50; S.age[1] = 10; S.dmg[1] = 0.8;
S.ph[2] = PCP.PH.crust; S.T[2] = 0.60; S.y[2] = 50; S.age[2] = 10; S.dmg[2] = 0.8;
S.ph[3] = PCP.PH.crust; S.T[3] = 0.10; S.y[3] = 900; S.age[3] = 10; S.dmg[3] = 0.8;
S.ph[4] = PCP.PH.air; S.T[4] = 0.10; S.y[4] = 50; S.age[4] = 10; S.dmg[4] = 0.8;
PCBOND.settle(S, 10);
check.ok('cold rock ages (10 + 10 Myr)', S.age[0] === 20, 'age ' + S.age[0]);
check.ok('cold rock anneals damage over tauHeal', S.dmg[0] === 0.8 - 10 / PCP.tauHeal,
	'dmg ' + S.dmg[0]);
check.ok('warm rock between the two thresholds holds its age',
	S.age[1] === 10 && S.dmg[1] === 0.8, 'age ' + S.age[1]);
check.ok('hot rock resets both clocks', S.age[2] === 0 && S.dmg[2] === 0);
check.ok('rock below yWeldMax never welds', S.age[3] === 0 && S.dmg[3] === 0,
	'no bottom lid');
check.ok('airborne material carries no bond and no clock',
	S.age[4] === 0 && S.dmg[4] === 0 && S.mu[4] === 0);
check.ok('mu is read back from the state it now has',
	S.mu[0] === PCBOND.mu(0.1, 20, 0), S.mu[0] + '');

var S0 = state(1);
S0.ph[0] = PCP.PH.crust; S0.T[0] = 0.1; S0.age[0] = 3; S0.dmg[0] = 0.2;
PCBOND.settle(S0, 0);
check.ok('a paused frame ages nothing', S0.age[0] === 3 && S0.dmg[0] === 0.2);

check.section('D. failure charges the mean excess, not the sum');
function failed(load, cnt, mu, dt) {
	var F = state(1);
	F.ph[0] = PCP.PH.crust; F.T[0] = 0.1; F.mu[0] = mu; F.dmg[0] = 0;
	F.pLoad[0] = load; F.pCnt[0] = cnt;
	PCBOND.damage(F, dt);
	return F;
}
var below = failed(PCP.yieldRate * 0.5 * 10, 10, 1, 10);
check.ok('a load below yield damages nothing', below.dmg[0] === 0, 'dmg ' + below.dmg[0]);

var one = failed(PCP.yieldRate * 2 * 10, 10, 1, 0.01);
var twice = failed(PCP.yieldRate * 2 * 20, 20, 1, 0.01);
check.ok('a load at twice the yield rate accumulates at kDamage x the excess',
	Math.abs(one.dmg[0] - PCP.kDamage * PCP.yieldRate * 0.01) < 1e-15, 'dmg ' + one.dmg[0]);
check.ok('doubling both the load and the pair count changes nothing (it is a mean)',
	one.dmg[0] === twice.dmg[0], one.dmg[0] + ' vs ' + twice.dmg[0]);
check.ok('the load and the count are cleared after the pass',
	one.pLoad[0] === 0 && one.pCnt[0] === 0);
check.ok('damage saturates at 1', failed(1e9, 1, 1, 1e6).dmg[0] === 1);
check.ok('a soft parcel yields sooner than a strong one',
	failed(PCP.yieldRate * 2 * 10, 10, 0.1, 0.01).dmg[0] > one.dmg[0] && one.dmg[0] > 0,
	'soft ' + failed(PCP.yieldRate * 2 * 10, 10, 0.1, 0.01).dmg[0] + ' vs strong ' + one.dmg[0]);
check.ok('strength is the welded value net of damage',
	(function () {
		var G = state(1);
		G.mu[0] = 0.8; G.dmg[0] = 0.25;
		return Math.abs(PCBOND.strength(G, 0) - 0.6) < 1e-15;
	}()));

check.done();
