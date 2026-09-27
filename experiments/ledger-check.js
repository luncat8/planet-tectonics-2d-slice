// ledger-check.js — M4 slab, plume and melt gates.
// Run: node experiments/ledger-check.js
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim;
var COL = L.mods.columns, SLAB = L.mods.slab, MAG = L.mods.magma;
var PLT = L.mods.plates, GEO = L.mods.geom, SURF = L.mods.surface;

function sum(a) {
	var v = 0, i;
	for (i = 0; i < a.length; i++) v += a[i];
	return v;
}

function finite() {
	var key, a, i;
	for (key in S) {
		a = S[key];
		if (!ArrayBuffer.isView(a)) continue;
		for (i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
	}
	return true;
}

function forceSubduction() {
	var i, j;
	for (i = 0; i < S.nCol - 1; i++) if (S.colPlate[i] !== S.colPlate[i + 1]) break;
	j = i + 1;
	S.hFel[i] = 0;
	S.hFel[j] = 35e3;
	S.oldW.set(S.colW);
	S.colX[j] = S.colX[i] + 0.5 * P.w0;
	S.widths();
	S.colU.fill(0);
	S.colU[j] = -5e4;
	S.edge[i] = P.EDGE.subduct;
	S.edgePol[i] = -1;
	S.edgeRelN[i] = -5e4;
	S.edgeRPlate[i] = S.colPlate[j];
	SLAB.ready = true;
	COL.k4(S, 0.05, 0, 1.6);
	return i;
}

check.section('M4.1 slab ribbons');
check.planet(11);
var mass0 = sum(S.mass()), edge = forceSubduction();
check.ok('subduction appends a ribbon', S.nRib === 1 && S.ribN[0] > 4,
	'ribbons ' + S.nRib + ' nodes ' + S.ribN[0]);
check.ok('ribbon keeps a stratified stack and water budget', S.ribNL[0] > 0 && S.waterIn > 0,
	'layers ' + S.ribNL[0] + ' water ' + S.waterIn.toExponential(3));
check.ok('subduction transfer is mass neutral before dissolution',
	Math.abs(sum(S.mass()) - mass0) / mass0 < 1e-12,
	'rel ' + (Math.abs(sum(S.mass()) - mass0) / mass0).toExponential(2));
var tail0 = S.ribY[S.ribN[0] - 1];
SIM.setGeo(50e3);
SIM.step();
check.ok('ribbon nodes descend and keep finite dip', S.nRib > 0 &&
	S.ribY[S.ribN[0] - 1] < tail0 && S.ribDip[S.ribN[0] - 1] >= P.slabDip0,
	'tail ' + (S.ribY[S.ribN[0] - 1] / 1e3).toFixed(1) + ' km');
var cold = Infinity, k;
for (k = 0; k < S.Tf.length; k++) if (S.Tf[k] < cold) cold = S.Tf[k];
check.ok('slab feeds a bounded cold anomaly into fan T', cold >= -P.lithCold - 1e-12 && cold < -0.01,
	'min dT ' + cold.toFixed(3));

check.section('M4.2 plume head, chamber and LIP');
check.planet(12);
var c0 = MAG.nearest(S, S.plmX[0]), hMaf0 = S.hMaf[c0], prod0 = S.ledProd[P.LITH.maf];
var lava0 = S.ledProd[P.LITH.lava], lavaMass0 = S.mass()[P.LITH.lava];
S.plmY[0] = -5e3;
S.plmStr[0] = 1;
SIM.setGeo(50e3);
SIM.step();
var lip = false, lava = false, i;
for (i = 0; i < S.nCol; i++) {
	if (S.hMaf[i] * S.colW[i] > hMaf0 * S.colW[c0]) lip = true;
	if (S.colMeltPlume[i] > 0) lava = true;
}
check.ok('a plume reaches the surface and swells', S.plmArrive[0] === 1 && S.plmY[0] <= -P.slabSurfaceDepth,
	'y ' + (S.plmY[0] / 1e3).toFixed(1) + ' km r ' + (S.plmR[0] / 1e3).toFixed(0) + ' km');
check.ok('plume head supplies a chamber and grows a mafic LIP', S.meltPlume > 0 &&
	(lava || S.meltSill > 0 || S.ledProd[P.LITH.maf] > prod0),
	'melt ' + S.meltPlume.toFixed(0) + ' m2 led ' + S.ledProd[P.LITH.maf].toExponential(3));
check.ok('the LIP credits lava production, not mafic melt',
	S.ledProd[P.LITH.lava] > lava0 && S.mass()[P.LITH.lava] > lavaMass0,
	'prod ' + (S.ledProd[P.LITH.lava] / 1e6).toFixed(1) + 'e6 m3 mass ' +
	((S.mass()[P.LITH.lava] - lavaMass0) / 1e6).toFixed(1) + 'e6 m3');
check.ok('all M4 buffers are finite', finite());

check.section('M4.3 water, melt and active-mass ledger');
check.planet(13);
var initial = S.mass().slice(), saved = SIM.k.slice();
SIM.k[5] = null;
SIM.k[6] = null;
SIM.setGeo(50e3);
SIM.run(1200);
var now = S.mass(), worst = 0, l, lhs, rhs, err;
for (l = 0; l < P.LITH.n; l++) {
	lhs = now[l] + S.ledCons[l] + S.ledMixOut[l];
	rhs = initial[l] + S.ledProd[l] + S.ledMixIn[l];
	err = Math.abs(lhs - rhs) / Math.max(1, rhs);
	if (err > worst) worst = err;
}
SIM.k[5] = saved[5];
SIM.k[6] = saved[6];
var residualWater = 0, r, base;
for (r = 0; r < S.nRib; r++) {
	base = r * P.ribNodeCap;
	for (k = 0; k < S.ribN[r]; k++) residualWater += S.ribW[base + k] + S.ribRelW[base + k];
}
check.ok('active ribbon and chamber mass balances per lithology', worst < 1e-10,
	'worst rel ' + worst.toExponential(2));
check.ok('water is conserved between ribbon, release and wedge sinks',
	Math.abs(S.waterIn - S.waterUsed - residualWater) / Math.max(1, S.waterIn) < 1e-12,
	'in ' + S.waterIn.toExponential(3) + ' used ' + S.waterUsed.toExponential(3) +
	' residual ' + residualWater.toExponential(3));
check.ok('arc melt is present after ribbon dehydration', S.meltArc > 0 && S.waterReleased > 0,
	'melt ' + S.meltArc.toFixed(0) + ' water ' + S.waterReleased.toExponential(3));
var T4 = P.Tfloor + (P.Tm0 - P.Tfloor) * Math.exp(-4000 / P.tauCool);
check.ok('cooling reaches the stagnant-lid speed scale', PLT.cD(T4) > 200 &&
	P.vRef / PLT.cD(T4) < 1e3,
	'cD(4 Gyr) ' + PLT.cD(T4).toFixed(1));
check.ok('long M4 run remains finite', finite());

check.section('M4.4 full pipeline: transformation accounting');
// The M4.3 fixture above disables K5 and K6, so it cannot see erosion or arc/LIP
// production. This one runs every kernel and demands the same closure: erosion
// converts rock into sediment, a LIP stores lava, a chamber spill stores a sill —
// each of those is a transfer between two ledger accounts, and a missing entry shows
// up here as mass with no source (measured: +110e9 m3 of sediment in 150 Myr).
check.planet(14);
var fullMass = S.mass().slice();
SIM.setGeo(50e3);
SIM.run(800);
var fullNow = S.mass(), fullWorst = 0, fl, lhsF, rhsF, errF;
for (fl = 0; fl < P.LITH.n; fl++) {
	lhsF = fullNow[fl] + S.ledCons[fl] + S.ledMixOut[fl];
	rhsF = fullMass[fl] + S.ledProd[fl] + S.ledMixIn[fl];
	errF = Math.abs(lhsF - rhsF) / Math.max(1, rhsF);
	if (errF > fullWorst) fullWorst = errF;
}
check.ok('the complete K0-K9 pipeline keeps the per-lithology ledger closed',
	fullWorst < 1e-9, 'worst rel ' + fullWorst.toExponential(2));

// a felsic top bed, lifted above the erosion knee: what erosion removes is booked as
// a rock-to-sediment transformation on both sides
check.planet(15);
var cEro = 0;
S.colNL[cEro] = 0;
COL.push(cEro, 20e3, P.LITH.fel, 100, 0);
COL.sums(cEro);
S.zDyn[cEro] = 8e3;
var mixOut0 = S.ledMixOut[P.LITH.fel], mixIn0 = S.ledMixIn[P.LITH.sed];
var eroMass = S.mass().slice();
SURF.k6(S, 0.05, 0);
check.ok('eroded rock is booked as a rock -> sediment transformation',
	S.ledMixOut[P.LITH.fel] > mixOut0 && S.ledMixIn[P.LITH.sed] > mixIn0,
	'out ' + ((S.ledMixOut[P.LITH.fel] - mixOut0) / 1e6).toFixed(2) + 'e6 m3 in ' +
	((S.ledMixIn[P.LITH.sed] - mixIn0) / 1e6).toFixed(2) + 'e6 m3');
var eroNow = S.mass(), eroWorst = 0, el;
for (el = 0; el < P.LITH.n; el++) {
	lhsF = eroNow[el] + S.ledCons[el] + S.ledMixOut[el];
	rhsF = eroMass[el] + S.ledProd[el] + S.ledMixIn[el];
	errF = Math.abs(lhsF - rhsF) / Math.max(1, rhsF);
	if (errF > eroWorst) eroWorst = errF;
}
check.ok('one erosion step stays inside the ledger', eroWorst < 1e-12, 'worst rel ' + eroWorst.toExponential(2));

// a chamber over its capacity spills a sill: the melt moves between two stored
// lithologies, so the production entry has to move with it
check.planet(16);
var cSill = 5, mafBefore = S.ledProd[P.LITH.maf];
S.colChamber[cSill] = 3 * P.chamberCap;
var sillMass = S.mass().slice();
SIM.setGeo(50e3);
SIM.step();
var sillNow = S.mass(), sillWorst = 0, sl;
for (sl = 0; sl < P.LITH.n; sl++) {
	lhsF = sillNow[sl] + S.ledCons[sl] + S.ledMixOut[sl];
	rhsF = sillMass[sl] + S.ledProd[sl] + S.ledMixIn[sl];
	errF = Math.abs(lhsF - rhsF) / Math.max(1, rhsF);
	if (errF > sillWorst) sillWorst = errF;
}
check.ok('a spilled chamber is booked as mafic -> sill', S.meltSill > 0 && S.ledProd[P.LITH.sill] >= S.meltSill - 1e-6 &&
	sillWorst < 1e-12,
	'sill ' + (S.meltSill / 1e9).toFixed(3) + 'e9 m3, maf ' +
	((S.ledProd[P.LITH.maf] - mafBefore) / 1e9).toFixed(3) + 'e9 m3, worst rel ' + sillWorst.toExponential(2));

check.done();
