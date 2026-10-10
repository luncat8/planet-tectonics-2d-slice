// tephra-pile.js — 0.2.2: a live arc vent piles tephra until death, then writeBack.
// Isolates the arc source (kPlumeMelt held at 0) so the cone is not a plume shield.
//   node experiments/tephra-pile.js [frames=3000]
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom;

var frames = +(process.argv[2] || 3000);
var holdPlume = P.kPlumeMelt, holdMelt = P.kMelt;
P.kPlumeMelt = 0;
P.kMelt = 20;
P.sl.geo = 50e3;
P.sl.erupt = 1800;
check.planet(1, 'def');
SIM.setGeo(50e3);

var maxPile = 0, maxHpx = 0, maxWpx = 0, maxToyIn = 0, alive = 0, feeding = 0;
var liveWrote = false, f, v, c, x, pile, hpx;
var prevEd = new Float64Array(P.maxVents);
var startMass = S.mass().slice(), startProd = S.ledProd.slice(), startCons = S.ledCons.slice();
var startDelam = S.ledDelam.slice(), startIn = S.ledMixIn.slice(), startOut = S.ledMixOut.slice();

function ledgerErr() {
	var mass = S.mass(), worst = 0, l, lhs, rhs;
	for (l = 0; l < P.LITH.n; l++) {
		lhs = mass[l] + S.ledCons[l] - startCons[l] + S.ledDelam[l] - startDelam[l] +
			S.ledMixOut[l] - startOut[l];
		rhs = startMass[l] + S.ledProd[l] - startProd[l] + S.ledMixIn[l] - startIn[l];
		worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, startMass[l], Math.abs(rhs)));
	}
	return worst;
}

for (f = 0; f < frames; f++) {
	SIM.step();
	for (v = 0; v < S.nVen; v++) {
		if (S.venStyle[v] !== 3) continue;
		c = S.venCol[v];
		if (c >= 0) {
			alive++;
			if (S.venFlux[v] > 0) feeding++;
			if (S.venEdV[v] > prevEd[v] + 1e-9) liveWrote = true;
		}
		pile = 0;
		for (x = 0; x < P.ventBoxW; x++) pile += S.toyH[v * P.ventBoxW + x];
		if (pile > maxPile) maxPile = pile;
		if (S.venToyIn[v] > maxToyIn) maxToyIn = S.venToyIn[v];
		if (!(S.venH[v] > 0)) continue;
		hpx = GEO.sy(S.z[c < 0 ? 0 : c]) - GEO.sy(S.z[c < 0 ? 0 : c] + S.venH[v]);
		if (hpx > maxHpx) maxHpx = hpx;
		if (S.venW[v] / GEO.kx > maxWpx) maxWpx = S.venW[v] / GEO.kx;
		prevEd[v] = S.venEdV[v];
	}
}

var tephra = 0, i, k, b;
for (i = 0; i < S.nCol; i++) {
	b = i * P.layerCap;
	for (k = 0; k < S.colNL[i]; k++) {
		if (S.layLi[b + k] === P.LITH.tephra) tephra += S.layTh[b + k] * S.colW[i];
	}
}

check.section('0.2.2 live arc tephra piles until death');
check.info('arc cone', maxWpx.toFixed(2) + ' x ' + maxHpx.toFixed(2) + ' px, pile ' +
	maxPile.toFixed(1) + ' cells2, toyIn ' + maxToyIn.toFixed(1) + ', tephra beds ' +
	tephra.toExponential(2) + ' m2, alive/feed frames ' + alive + '/' + feeding);
check.ok('at least one arc vent is born from water-released melt', alive > 0);
check.ok('the live arc cone is in the design 10–30 px band on width', maxWpx >= 10 && maxWpx <= 30);
check.ok('the live arc cone reaches a watchable height (>= 8 px; erupt-bench 10 px at 150 cells2)',
	maxHpx >= 8, maxHpx.toFixed(2) + ' px at ' + maxPile.toFixed(1) + ' cells2');
check.ok('a live arc vent does not write tephra into the stack', !liveWrote);
check.ok('death writes tephra beds', tephra > 0);
check.ok('the per-lithology ledger closes', ledgerErr() < 1e-10, 'rel ' + ledgerErr().toExponential(2));

P.kPlumeMelt = holdPlume;
P.kMelt = holdMelt;
check.done();
