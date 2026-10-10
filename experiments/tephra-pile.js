// tephra-pile.js — 0.2.2: a live arc vent piles tephra until death, then writeBack.
// Isolates the arc source (kPlumeMelt held at 0) so the cone is not a plume shield.
// The arc rate is KM in the environment (default: the committed P.kMelt), so a calibration
// table can read the cone at a candidate without editing params.js; the gate below is the
// committed rate's row.
//   node experiments/tephra-pile.js [frames=3000]
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom;

var frames = +(process.argv[2] || 3000);
// KM overrides the arc melt rate for one run (the contact-audit KG pattern), so the 0.2.3
// calibration can size the live arc cone at a candidate. Default: the committed P.kMelt.
var KM = Number(process.env.KM);
var holdPlume = P.kPlumeMelt, holdMelt = P.kMelt;
P.kPlumeMelt = 0;
if (isFinite(KM) && KM >= 0) P.kMelt = KM;
P.sl.geo = 50e3;
P.sl.erupt = 1800;
check.planet(1, 'def');
SIM.setGeo(50e3);

var maxPile = 0, maxHpx = 0, maxWpx = 0, maxToyIn = 0, alive = 0, feeding = 0;
var f, v, c, x, pile, hpx;

// The rule is tephra-only: K7 writes lava every frame, tephra waits for the vent's death.
// venEdV is not the measure of it — it also grows from the lava writes the rule still
// allows (63.8 cells2 of lava placed live against 0 of tephra at kMelt 20) and from a slot
// a later birth reuses, whose edifice is inherited rather than written. So what counts is
// what ERUPT.place actually puts in the stack while the vent is alive, read the way
// contact-audit wraps COL.k4.
var ERUPT = L.mods.erupt, oPlace = ERUPT.place, oFinish = ERUPT.finish;
var tephraLive = 0, tephraDeath = 0, inFinish = 0;
ERUPT.place = function (v, lith, cells, t) {
	if (lith === P.LITH.tephra) {
		if (inFinish) tephraDeath += cells;
		else if (S.venCol[v] >= 0) tephraLive += cells;
	}
	return oPlace.apply(this, arguments);
};
ERUPT.finish = function (v, t) { inFinish++; var r = oFinish.apply(this, arguments); inFinish--; return r; };
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
		}
		pile = 0;
		for (x = 0; x < P.ventBoxW; x++) pile += S.toyH[v * P.ventBoxW + x];
		if (pile > maxPile) maxPile = pile;
		if (S.venToyIn[v] > maxToyIn) maxToyIn = S.venToyIn[v];
		if (!(S.venH[v] > 0)) continue;
		hpx = GEO.sy(S.z[c < 0 ? 0 : c]) - GEO.sy(S.z[c < 0 ? 0 : c] + S.venH[v]);
		if (hpx > maxHpx) maxHpx = hpx;
		if (S.venW[v] / GEO.kx > maxWpx) maxWpx = S.venW[v] / GEO.kx;
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
	tephra.toExponential(2) + ' m2, alive/feed frames ' + alive + '/' + feeding +
	', tephra placed ' + tephraDeath.toFixed(1) + ' cells2 at death / ' +
	tephraLive.toFixed(3) + ' live');
check.ok('at least one arc vent is born from water-released melt', alive > 0);
check.ok('the live arc cone is in the design 10–30 px band on width', maxWpx >= 10 && maxWpx <= 30);
check.ok('the live arc cone reaches a watchable height (>= 8 px; erupt-bench 10 px at 150 cells2)',
	maxHpx >= 8, maxHpx.toFixed(2) + ' px at ' + maxPile.toFixed(1) + ' cells2');
check.ok('a live arc vent does not write tephra into the stack', tephraLive === 0,
	tephraLive.toFixed(3) + ' cells2 placed live, ' + tephraDeath.toFixed(1) + ' at death');
check.ok('death writes tephra beds', tephra > 0);
check.ok('the per-lithology ledger closes', ledgerErr() < 1e-10, 'rel ' + ledgerErr().toExponential(2));

P.kPlumeMelt = holdPlume;
P.kMelt = holdMelt;
check.done();
