// M2.0 gates; transport fixtures will be added alongside M2.1/M2.2 kernels.
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, COL = L.mods.columns, SIM = L.mods.sim;

function invariants() {
	var finite = true, sorted = true, sums = true, counts = new Int32Array(P.plateCap), width = 0;
	for (var key in S) {
		var a = S[key];
		if (!ArrayBuffer.isView(a)) continue;
		for (var j = 0; j < a.length; j++) if (!Number.isFinite(a[j])) finite = false;
	}
	for (var i = 0; i < S.nCol; i++) {
		sorted = sorted && S.colX[i] >= 0 && S.colX[i] < P.wrap && (i === 0 || S.colX[i] > S.colX[i - 1]);
		counts[S.colPlate[i]]++;
		width += S.colW[i];
		var total = 0;
		for (var k = 0; k < S.colNL[i]; k++) total += S.layTh[i * P.layerCap + k];
		sums = sums && Math.abs(total - S.hTot[i]) < 1e-8;
	}
	check.ok('all state buffers finite', finite);
	check.ok('positions sorted, unique and wrapped', sorted);
	check.ok('stack caches agree', sums);
	check.near('widths cover the periodic domain', width, P.wrap, 1e-12);
	check.ok('plate counts agree', counts.every(function (n, p) { return n === S.plN[p]; }));
}

check.planet(1);
invariants();
var initial = S.mass().slice(), hash = S.hash();
SIM.setGeo(0);
SIM.run(100);
check.ok('zero geological time leaves tectonic state unchanged', hash === S.hash());
check.ok('edge history starts invalid', S.edgeRPlate.every(function (p) { return p === -1; }));

// Force cross-lith compaction: all beds alternate, so a mixed merge is unavoidable.
S.colNL[0] = 0;
for (var k = 0; k < P.layerCap; k++) COL.push(0, 10 + k, k % 2, 0, 0);
COL.sums(0);
initial = S.mass().slice();
COL.compact(0);
COL.sums(0);
var mass = S.mass();
for (var l = 0; l < P.LITH.n; l++) {
	check.near('mixed merge ledger lith ' + l, mass[l] + S.ledCons[l] + S.ledMixOut[l],
		initial[l] + S.ledProd[l] + S.ledMixIn[l], 1e-12);
}
check.ok('mixed merge records one event', S.ledMix === 1);
invariants();

// K0 must queue events, never execute topology before contact resolution.
SIM.reset();
var order = [];
SIM.add(4, function () { order.push('contact'); });
SIM.add(5, function () { order.push('surface'); });
SIM.onEvent = function () { order.push('event'); };
SIM.dG = P.eventCadence * 2;
SIM.step();
check.ok('all due events execute after K4 and before K5', order.join(',') === 'contact,event,event,surface');
SIM.add(4, null); SIM.add(5, null); SIM.onEvent = null;
SIM.reset();
var first = S.hash();
SIM.reset();
check.ok('reset is deterministic, including new buffers', first === S.hash());
check.done();
