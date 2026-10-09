// 0.2.0 M3 only: factories, depth hosts, finite extraction, bed edits and persistence.
// Run: node experiments/ore-bench.js. This does not invoke earlier milestone suites.
'use strict';
var L = require('./lib.js'), check = L.check, M = L.mods;
var P = M.params, S = M.state, COL = M.columns, ORE = M.ore, SURF = M.surface;
var CRU = M.crust, MAG = M.magma, ERUPT = M.erupt, SIM = M.sim, CP = M.checkpoint, RNG = M.rng;
var GEO = M.geom, R = M.render, DEP = M.deposits;
var LC = P.layerCap, C = P.OCLS, LI = P.LITH, c = 100, d, i, k;

function fresh() {
	S.reset(); S.nPl = 1; S.nRib = 0; S.nPlm = 0; S.nVen = 0;
	S.colPlate.fill(0); S.plN.fill(0); S.plN[0] = S.nCol;
	for (var j = 0; j < S.nCol; j++) {
		S.fert[j] = 1; S.colAge[j] = 100;
		COL.push(j, 7000, LI.maf, -100, P.FLAG.wet);
		COL.push(j, 35000, LI.fel, -100, 0);
		COL.push(j, 500, LI.sed, -10, P.FLAG.wet);
		COL.sums(j);
	}
	SIM.t = 20; SIM.tErupt = 0; SIM.frame = 0; SIM.evT = 0; SIM.event = 0; SIM.kinematic = null;
	SIM.cool(); SIM.setGeo(0); P.sl.geo = 0; P.sl.erupt = 0;
	SURF.profile(0);
	GEO.setPreset('def'); GEO.lookAt(S.colX[c]); GEO.sync(); GEO.buildColLUT(S);
}
function stack(col, beds) {
	S.colNL[col] = 0;
	for (var j = 0; j < beds.length; j++) COL.push(col, beds[j][0], beds[j][1], beds[j][2] || 0, beds[j][3] || 0);
	COL.sums(col);
}
function find(cls, col) {
	for (var j = 0; j < S.nDep; j++) if (S.depCls[j] === cls && (col === undefined || S.depCol[j] === col) && ORE.valid(S, j)) return j;
	return -1;
}
function resourceBalance() {
	var totals = new Float64Array(C.n), worst = 0;
	for (var j = 0; j < S.nDep; j++) totals[S.depCls[j]] += S.depVol[j];
	for (var cls = 0; cls < C.n; cls++) {
		var got = totals[cls] + S.depExtracted[cls] + S.depRetired[cls];
		worst = Math.max(worst, Math.abs(got - S.depProduced[cls]) / Math.max(1, S.depProduced[cls]));
	}
	return worst;
}
function ledger() {
	return { mass: S.mass().slice(), prod: S.ledProd.slice(), cons: S.ledCons.slice(),
		mixIn: S.ledMixIn.slice(), mixOut: S.ledMixOut.slice() };
}
function massError(start) {
	var mass = S.mass(), worst = 0;
	for (var li = 0; li < LI.n; li++) {
		var lhs = mass[li] + S.ledCons[li] - start.cons[li] + S.ledMixOut[li] - start.mixOut[li];
		var rhs = start.mass[li] + S.ledProd[li] - start.prod[li] + S.ledMixIn[li] - start.mixIn[li];
		worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, start.mass[li], Math.abs(rhs)));
	}
	return worst;
}
function validAll() {
	for (var j = 0; j < S.nDep; j++) {
		if (!ORE.valid(S, j) || !Number.isFinite(ORE.depth(S, j)) ||
			S.depPos[j] < 0 || S.depPos[j] > 1 || S.depGr[j] < 0 || S.depGr[j] > 1 ||
			S.depVol[j] > S.layTh[S.depCol[j] * LC + S.depLay[j]] * S.colW[S.depCol[j]] * (1 + 1e-12)) return false;
	}
	return true;
}

check.section('M3.1 bounded factories and independent clocks');
check.ok('the page pipeline registers the unbound K8 kernel', SIM.k[8] === ORE.k8);
var once = ORE.advance(0.1, 0.27, 20), split = 0.1;
for (i = 0; i < 400; i++) split = ORE.advance(split, 0.27, 0.05);
check.near('continuous saturation / decay is geo-step independent', split, once, 1e-12);
check.near('quiet potentials decay on the 500 Myr clock', ORE.advance(0.8, 0, 500), 0.8 / Math.E, 1e-12);
check.ok('large steps stay bounded without clipping a source', ORE.advance(0.9, 1000, 1e6) < 1 && ORE.advance(0.9, 1000, 1e6) > 0.99);
check.ok('birth pulses scale by fertility and spreading', ORE.pulse(0, 0.3 * 2) > ORE.pulse(0, 0.3));
fresh();
ORE.birth(S, c, 1.6, P.vRef, true);
check.near('oceanic birth uses kV, Tm and the bounded opening proxy', S.oVms[c], ORE.pulse(0, P.kV * 1.6), 1e-12);
ORE.birth(S, c + 1, 1.6, P.vRef, false);
check.near('continental rift births seed the mafic factory', S.oMaf[c + 1], ORE.pulse(0, P.kM2), 1e-12);
fresh(); S.oArc[c] = 0.9; ORE.scan(S, 20);
var rng = JSON.stringify(RNG.state()), snapshot = S.hash();
ORE.k8(S, 0, 20, 1.6); ORE.ranked(S);
check.ok('paused K8 is idempotent after recording its hosts', S.hash() === snapshot);
check.ok('scanning, depths and ranking never consume geological RNG', JSON.stringify(RNG.state()) === rng);
var oldGrade = S.depGr[0], oldAge = S.depAg[0];
S.oArc[c] = 0.99; ORE.k8(S, 0.05, 21, 1.6);
check.ok('later potentials do not rewrite an existing bed resource snapshot', S.depGr[0] === oldGrade && S.depAg[0] === oldAge);

fresh(); S.fert[c] = 1.4; S.nPlm = 1;
S.plmArrive[0] = 1; S.plmStr[0] = 0.8; S.plmX[0] = S.colX[c]; S.plmR[0] = P.w0;
S.oMaf[c] = 0.2; ORE.accumulate(S, 3, 1.6);
check.near('an arrived plume advances the fertility-scaled mafic factory exactly once', S.oMaf[c], ORE.advance(0.2, P.kM * 0.8 * 1.4, 3), 1e-12);
S.fert[c] = 0; var zeroFert = S.oMaf[c]; ORE.accumulate(S, 3, 1.6);
check.near('zero fertility allows only decay, not plume enrichment', S.oMaf[c], zeroFert * Math.exp(-3 * P.kDecay), 1e-12);
fresh(); S.fert[c] = 1.4; S.edge[c] = P.EDGE.collide; S.edgeRelN[c] = -P.vRef * 1.2; S.damage[c] = 0.6;
S.oOro[c] = 0.2; ORE.accumulate(S, 3, 1.6);
check.near('the collision factory uses belt shortening, damage and fertility', S.oOro[c], ORE.advance(0.2, P.kO * 1.2 * 0.6 * 1.4, 3), 1e-12);
check.ok('quiet continental ground outside the collision belt cannot gain orogenic potential', S.oOro[c + 20] === 0);
fresh(); S.fert[c] = 1.4; stack(c, [[7000, LI.maf], [35000, LI.fel], [2500, LI.sed, 18, P.FLAG.wet]]);
S.wet[c] = 1; S.oBas[c] = 0.2; ORE.accumulate(S, 3, 1.6);
check.near('a thick wet basin advances kB2 with fertility and saturation', S.oBas[c], ORE.advance(0.2, P.kB2 * 1.4, 3), 1e-12);
S.wet[c] = 0; var dryBasin = S.oBas[c]; ORE.accumulate(S, 3, 1.6);
check.near('the same dry basin decays rather than advancing its wet-sediment clock', S.oBas[c], dryBasin * Math.exp(-3 * P.kDecay), 1e-12);

check.section('M3.2 all six hosts, blur maxima and formation snapshots');
fresh();
stack(90, [[7000, LI.maf, -80, P.FLAG.wet], [600, LI.sed, -10, P.FLAG.wet]]);
stack(94, [[1000, LI.sill, 5], [7000, LI.maf, -80], [35000, LI.fel, -50], [500, LI.sed, -10]]);
stack(98, [[7000, LI.maf, -80], [35000, LI.fel, -50], [1400, LI.lava, 15], [500, LI.sed, 18]]);
stack(102, [[7000, LI.maf, -80], [24000, LI.fel, -60], [24000, LI.fel, -30], [500, LI.sed, 18]]);
stack(106, [[7000, LI.maf, -80], [35000, LI.fel, -50], [2500, LI.sed, 18, P.FLAG.wet]]);
stack(110, [[7000, LI.maf, -80], [35000, LI.fel, -50, P.FLAG.unconf], [500, LI.sed, 18]]);
var cols = [90, 94, 98, 102, 106, 110];
for (i = 0; i < C.n; i++) S[COL.oreFields[i]][cols[i]] = 0.9;
SURF.profile(0);
var before = ledger(); ORE.scan(S, 20);
check.ok('every class produces a real host record', S.nDep === C.n && cols.every(function (col, cls) { return find(cls, col) >= 0; }));
check.ok('delineation never creates crust or books a second reservoir', massError(before) < 1e-12);
d = find(C.vms, 90);
check.ok('VMS sits at the buried mafic seafloor horizon', d >= 0 && S.depLay[d] === 0 && ORE.depth(S, d) > 600 && ORE.depth(S, d) < 750);
d = find(C.maf, 94);
check.ok('mafic resource uses the intrusive basement bed', d >= 0 && S.layLi[94 * LC + S.depLay[d]] === LI.sill);
d = find(C.arc, 98);
check.ok('porphyry emplacement is 3–8 km under the volcanic section', d >= 0 && ORE.depth(S, d) >= P.oreArcMin && ORE.depth(S, d) <= P.oreArcMax,
	d >= 0 ? ORE.depth(S, d).toFixed(1) + ' m' : 'missing');
d = find(C.oro, 102);
check.ok('orogenic veins occupy the collided felsic root', d >= 0 && S.depLay[d] === 1 && ORE.depth(S, d) > 24000);
d = find(C.bas, 106);
check.ok('basin resource sits in a wet sediment bed', d >= 0 && S.layLi[106 * LC + S.depLay[d]] === LI.sed && (S.layFl[106 * LC + S.depLay[d]] & P.FLAG.wet));
d = find(C.pla, 110);
check.ok('placer lag is at the sediment / unconformity contact', d >= 0 && S.depPos[d] <= 0.03 && (S.layFl[110 * LC + S.depLay[d] - 1] & P.FLAG.unconf));
check.ok('resource accounting closes and all host positions are finite', resourceBalance() < 1e-12 && validAll());
var ranked = Array.from(ORE.ranked(S));
check.ok('ranking groups classes, then descending remaining tonnage', ranked.every(function (record, at) {
	if (!at) return true;
	var prev = ranked[at - 1];
	return S.depCls[prev] < S.depCls[record] || S.depCls[prev] === S.depCls[record] && ORE.tonnes(S, prev) >= ORE.tonnes(S, record);
}));
fresh(); S.oArc.fill(0.8, c - 2, c + 3); ORE.scan(S, 20);
var peakCount = S.nDep; ORE.scan(S, 20);
check.ok('plateau ties resolve once; repeated scans cannot duplicate a bed', peakCount === 1 && S.nDep === 1);
fresh(); S.oVms[c] = 1; ORE.scan(S, 20);
check.ok('an inherited wet seafloor remains eligible beneath later continental crust', find(C.vms, c) >= 0,
	'the fixture retains an explicitly wet, non-intrusive inherited seafloor bed');
S.layFl[c * LC] |= P.FLAG.intr; S.nDep = 0; S.depProduced.fill(0); S.layOre.fill(0);
ORE.scan(S, 20);
check.ok('intrusive mafic rock is refused as a VMS seafloor horizon', S.nDep === 0);

check.section('M3.3 arc factory location and real one-hop placer routing');
fresh();
var arcCols = [80, 90, 100, 110, 120];
arcCols.forEach(function (col) {
	S.trenchDist[col] = 2; S.colRecycle[col] = P.w0 * 5000 * P.slabWaterSed;
	S.edge[col - 2] = P.EDGE.subduct; S.edgeRelN[col - 2] = -P.vRef;
});
S.oArc[160] = 0.7; S.oArc[170] = 0.7;
for (i = 0; i < 400; i++) ORE.k8(S, 0.05, 20 + i * 0.05, 1.6);
var arcHere = 0, arcTotal = 0;
for (i = 0; i < S.nDep; i++) if (S.depCls[i] === C.arc) {
	arcTotal += ORE.tonnes(S, i);
	if (arcCols.indexOf(S.depCol[i]) >= 0) arcHere += ORE.tonnes(S, i);
}
var arcShare = arcHere / arcTotal;
check.ok('more than 60% of arc resource mass is under the prescribed arc factories', arcTotal > 0 && arcShare > 0.6,
	(arcShare * 100).toFixed(2) + '% (' + S.nDep + ' resources including two inherited off-factory maxima)');
check.ok('the fixed-source arc run keeps the geological and resource ledgers separate', resourceBalance() < 1e-12 && validAll());
fresh();
stack(c, [[7000, LI.maf, -80], [60000, LI.fel, -50]]);
stack(c - 1, [[7000, LI.maf, -80, P.FLAG.wet], [4000, LI.fel, -50]]);
S.oOro[c] = 0.9; S.oArc[c] = 0.7; SURF.profile(0);
var sourceZ = S.z[c], sinkZ = S.z[c - 1], routeStart = ledger();
for (i = 0; i < 80; i++) { SURF.k6(S, 0.1, 20 + i * 0.1); ORE.k8(S, 0, 20 + i * 0.1, 1.6); }
var placer = find(C.pla, c - 1);
check.ok('real K6 routing delineates placer downslope of its arc / orogenic source', placer >= 0 && sourceZ > sinkZ && S.colPla[c - 1] > 0,
	'col ' + (placer >= 0 ? S.depCol[placer] : -1) + ', source/sink ' + sourceZ.toFixed(0) + '/' + sinkZ.toFixed(0) + ' m');
check.ok('the placer host is actual routed sediment over an unconformity', placer >= 0 && S.layLi[(c - 1) * LC + S.depLay[placer]] === LI.sed && (S.layFl[c * LC + S.colNL[c] - 2] & P.FLAG.unconf));
check.ok('placer creation does not disturb the erosion / deposition ledger', massError(routeStart) < 1e-12 && resourceBalance() < 1e-12,
	'crust ' + massError(routeStart).toExponential(2) + ', resources ' + resourceBalance().toExponential(2));

check.section('M3.4 erosion, compaction, transport and volcanic write-back');
fresh(); d = ORE.create(S, c, 2, C.bas, 0.8, 20, 0.5);
var id = S.depId[d], volume = S.depVol[d];
COL.removeTop(c, 125); COL.sums(c); ORE.reap(S);
check.near('partial host erosion retires only the removed resource share', S.depVol[ORE.byId(S, id)], volume * 0.75, 1e-12);
COL.removeTop(c, 375); COL.sums(c); ORE.reap(S);
check.ok('an eroded-away deposit disappears, not a wrong-bed pointer', ORE.byId(S, id) < 0 && S.nDep === 0 && resourceBalance() < 1e-12);
fresh();
COL.push(c, 100, LI.sed, 19, P.FLAG.wet); COL.sums(c);
var lower = ORE.create(S, c, 2, C.bas, 0.8, 20, 0.5), upper = ORE.create(S, c, 3, C.pla, 0.8, 20, 0.1);
var lowerId = S.depId[lower], upperId = S.depId[upper];
var depths = [ORE.depth(S, lower), ORE.depth(S, upper)];
COL.compact(c); COL.sums(c);
check.ok('compaction keeps both hosted classes and exhausted-bed masks', S.depLay[lower] === 2 && S.depLay[upper] === 2 && (S.layOre[c * LC + 2] & (1 << C.bas | 1 << C.pla)) === (1 << C.bas | 1 << C.pla));
check.near('the lower resource stays at the same physical depth through compaction', ORE.depth(S, lower), depths[0], 1e-12);
check.near('the upper resource stays at the same physical depth through compaction', ORE.depth(S, upper), depths[1], 1e-12);
COL.insertVol(S, c, LI.sill, 200, 21, 0); COL.sums(c);
check.ok('rank-ordered intrusion shifts the records with their sediment bed', S.depLay[lower] === 3 && S.depLay[upper] === 3 && S.layLi[c * LC + S.depLay[lower]] === LI.sed);
COL.removeAt(S, c, 0); COL.sums(c);
check.ok('basal removal shifts both records and their history mask down', S.depLay[lower] === 2 && S.depLay[upper] === 2 && S.depId[lower] === lowerId && S.depId[upper] === upperId);

fresh(); d = ORE.create(S, c, 1, C.oro, 0.8, 20, 0.5);
volume = S.depVol[d]; id = S.depId[d];
COL.collapseMove(c, c + 1, S.hFel[c] * S.colW[c] * 0.25); ORE.reap(S);
var source = ORE.byId(S, id), transported = find(C.oro, c + 1);
check.ok('a partially transported bed splits a resource into two valid hosts', source >= 0 && transported >= 0 && S.depId[source] !== S.depId[transported] && validAll());
check.near('partial transport conserves delineated resource area', S.depVol[source] + S.depVol[transported], volume, 1e-12);
COL.collapseMove(c, c + 1, S.hFel[c] * S.colW[c]); ORE.reap(S);
check.ok('complete transport merges into the true felsic host, not the sediment cap', S.nDep === 1 && S.depCol[0] === c + 1 && S.layLi[(c + 1) * LC + S.depLay[0]] === LI.fel && resourceBalance() < 1e-12);
check.near('complete transport retains the original resource budget', S.depVol[0], volume, 1e-12);

fresh(); d = ORE.create(S, c, 2, C.bas, 0.8, 20, 0.5); id = S.depId[d];
S.nVen = 1; S.venCol[0] = c; S.venEdCol[0] = c; S.volc[c] = 0; S.venX[0] = S.colX[c]; ERUPT.reset(0);
var eruptionStart = ledger();
S.ledProd[LI.maf] += 12 * P.toyCellM2; S.venToyIn[0] = 12;
ERUPT.addMolten(ERUPT.at(0, P.ventBoxW >> 1), 12, 1, LI.lava);
ERUPT.finish(0, 22); ERUPT.record(0); ORE.k8(S, 0, 22, 1.6);
d = ORE.byId(S, id);
check.ok('M2 freeze / write-back preserves the existing deposit bed and mask', d >= 0 && S.layLi[c * LC + S.depLay[d]] === LI.sed && (S.layOre[c * LC + S.depLay[d]] & 1 << C.bas));
check.ok('deposit-aware write-back still transfers mass exactly once', massError(eruptionStart) < 1e-12 && resourceBalance() < 1e-12);
var volcanic = -1;
for (k = 0; k < S.colNL[c]; k++) if (S.layLi[c * LC + k] === LI.lava) volcanic = k;
d = ORE.create(S, c, volcanic, C.maf, 0.8, 22, 0.5);
var edificeBefore = S.venEdV[0], volcanicVolume = S.depVol[d];
ORE.extract(S, S.depId[d], volcanicVolume);
check.near('mining a volcanic host trims its retained edifice through the existing callback', edificeBefore - S.venEdV[0], volcanicVolume, 1e-12);
check.ok('volcanic extraction does not consume molten transit or create sediment', massError(eruptionStart) < 1e-12 && ERUPT.mass(0) === 0);

check.section('M3.5 finite extraction, stable ids and capacity');
fresh();
var a = ORE.create(S, c - 1, 2, C.bas, 0.7, 20, 0.5), b = ORE.create(S, c, 2, C.bas, 0.8, 20, 0.5);
var aId = S.depId[a], bId = S.depId[b];
COL.removeTop(c - 1, 500); COL.sums(c - 1); ORE.reap(S);
check.ok('table reaping preserves selection identity rather than a stale slot', ORE.byId(S, aId) < 0 && ORE.byId(S, bId) === 0);
d = ORE.byId(S, bId); var host = S.depLay[d], rockAge = S.layAg[c * LC + host], gr = S.depGr[d];
volume = S.depVol[d]; var oldTh = S.layTh[c * LC + host], oldZ = S.z[c], oldH = S.hTot[c], neighbour = S.z[c + 1];
var miningStart = ledger(), zBefore = SURF.elev(c);
var extracted = ORE.extract(S, bId, volume * 0.25);
check.near('partial extraction removes the requested finite resource area', extracted, volume * 0.25, 1e-12);
check.near('only that area / width leaves the real host bed', oldTh - S.layTh[c * LC + host], extracted / S.colW[c], 1e-12);
check.near('hTot reflects exactly the mined host mass', oldH - S.hTot[c], extracted / S.colW[c], 1e-12);
check.near('paused geology still gets the exact buoyancy decrement', S.z[c] - oldZ, SURF.elev(c) - zBefore, 1e-12);
check.ok('mining preserves the host age, grade and neighbouring ground', S.layAg[c * LC + host] === rockAge && S.depGr[ORE.byId(S, bId)] === gr && S.z[c + 1] === neighbour);
check.ok('per-lithology and resource ledgers both close after partial extraction', massError(miningStart) < 1e-12 && resourceBalance() < 1e-12);
var invalidHash = S.hash();
check.ok('stale ids, zero, negative, NaN and infinite requests are inert',
	ORE.extract(S, aId, 1) === 0 && ORE.extract(S, bId, 0) === 0 && ORE.extract(S, bId, -1) === 0 &&
	ORE.extract(S, bId, NaN) === 0 && ORE.extract(S, bId, Infinity) === 0 && S.hash() === invalidHash);
var rest = S.depVol[ORE.byId(S, bId)];
check.near('over-requesting is clamped to the remaining finite resource', ORE.extract(S, bId, rest * 100), rest, 1e-12);
check.ok('exhaustion removes the record but retains its bed delineation mask', ORE.byId(S, bId) < 0 && (S.layOre[c * LC + host] & 1 << C.bas));
S.oBas[c] = 1; for (i = 0; i < 20; i++) ORE.k8(S, 0, 23, 1.6);
check.ok('a mined bed cannot instantly regenerate from the unchanged potential', find(C.bas, c) < 0 && massError(miningStart) < 1e-12 && resourceBalance() < 1e-12);

fresh(); d = ORE.create(S, c, 2, C.bas, 0.8, 20, 0.5);
S.oArc[c + 10] = 0.9; S.nDep = P.depCap; var produced = S.depProduced[C.arc];
ORE.scan(S, 20);
check.ok('a full table defers without marking a bed or inventing resources', S.depBlocked > 0 && S.depProduced[C.arc] === produced && !(S.layOre[(c + 10) * LC + 1] & 1 << C.arc));
ORE.reap(S); ORE.scan(S, 20);
check.ok('freed capacity retries the deferred delineation', find(C.arc, c + 10) >= 0 && S.nDep === 2 && resourceBalance() < 1e-12);

fresh(); S.oMaf[c] = 0.9; S.colChamber[c] = P.chamberCap * 1.25;
var beforeSpill = ledger(), maficPotential = S.oMaf[c]; MAG.spill(S, 20);
check.ok('sill spill makes a real intrusive host without a duplicate mafic factory pulse',
	S.oMaf[c] === maficPotential && S.layLi[c * LC] === LI.sill && massError(beforeSpill) < 1e-12);
ORE.k8(S, 0, 20, 1.6);
check.ok('paused K8 may delineate that sill but cannot advance mafic fertility',
	S.oMaf[c] === maficPotential && find(C.maf, c) >= 0);

check.section('M3.6 imported cuts, checkpoint v8 and deterministic mining');
fresh(); S.oArc[c] = 0.9; ORE.scan(S, 20); var catBefore = DEP.snapshotSection(S).checksum;
var formation = S.depAg[0], originalId = S.depId[0];
var pack = M['section-seed'].exportSection({ tMyr: 20, level: 5 });
var seedError = M['section-seed'].layout(pack, { seed: P.seed, t: 20, Tm: SIM.Tm });
check.ok('a stopped cut delineates imported potentials at reconstruction, not by advancing geology', !seedError && find(C.arc, c) >= 0 && S.depAg[find(C.arc, c)] === 20);
check.ok('the existing 3D snapshot catalogue API remains independent', typeof DEP.generateCatalogue === 'function' && typeof catBefore === 'string' && formation === 20 && originalId > 0);
// Deposit-only C4: no active vent fixture and no invocation of the older coupling suite.
fresh(); d = ORE.create(S, c, 1, C.arc, 0.8, 20, 0.85); originalId = S.depId[d];
var COUP = M.coupling, c4pack = M['section-seed'].exportSection({ t: 20, pack: 'm3-ore-c4' });
var message = COUP.fromPack(c4pack), options = { pack: c4pack, nCut: S.nCol, cellKm: P.w0 / 1000, tNow: 20 };
var frozenGrade = S.depGr[d], frozenTime = S.depAg[d], frozenBudget = S.depVol[d], row = message.crust[c];
row.hFelM += 1000; row.fert = 2;
message.ledger.fel += (row.s1Km - row.s0Km) * 1e6; message.checksum = COUP.checksum(message);
var applied = COUP.apply(S, message, options);
S.oArc[c] = 0.99; ORE.k8(S, 0, 20, 1.6); d = ORE.byId(S, originalId);
check.ok('matched C4 growth preserves the original bed resource, grade and mineralization time',
	!applied && d >= 0 && S.depGr[d] === frozenGrade && S.depAg[d] === frozenTime && S.depVol[d] === frozenBudget && (S.layOre[c * LC + S.depLay[d]] & 1 << C.arc), applied || 'preserved');
var basinHost = S.colNL[c] - 1, basinRecord = ORE.create(S, c, basinHost, C.bas, 0.8, 20, 0.5), basinId = S.depId[basinRecord];
row.hSedM = 0; message.checksum = COUP.checksum(message);
applied = COUP.apply(S, message, options); ORE.reap(S);
check.ok('C4 removal retires only the erased host while the surviving arc id remains valid',
	!applied && ORE.byId(S, basinId) < 0 && ORE.byId(S, originalId) >= 0 && resourceBalance() < 1e-12);
var coarse = COUP.fromPack(c4pack);
coarse.crust = [Object.assign({}, coarse.crust[0], { s0Km: 0, s1Km: c4pack.path.arcKm })];
coarse.checksum = COUP.checksum(coarse);
applied = COUP.apply(S, coarse, { pack: c4pack, nCut: S.nCol, cellKm: 1, tNow: 20 });
var cleanMasks = true;
for (i = 0; i < S.nCol; i++) for (k = 0; k < S.colNL[i]; k++) if (S.layOre[i * LC + k]) cleanMasks = false;
ORE.reap(S);
check.ok('an unmatched fresh C4 stack cannot inherit a retired deposit pointer or tombstone',
	!applied && COUP.last.freshColumns > 0 && cleanMasks && ORE.byId(S, originalId) < 0 && resourceBalance() < 1e-12);

var cp = CP.save(), savedHash = S.hash(), oldVersion = new Uint8Array(cp);
new Uint32Array(oldVersion.buffer)[1] = 7;
var refused = false;
try { CP.load(oldVersion); } catch (e) { refused = /version/.test(e.message); }
check.ok('checkpoint v8 refuses a v7 header instead of a legacy reader', CP.VERSION === 8 && refused && S.hash() === savedHash);
P.sl.geo = 0.05 * 1e6; P.sl.erupt = 1800; SIM.setGeo(P.sl.geo);
cp = CP.save(); SIM.run(120); var restoredRun = S.hash();
CP.load(cp); SIM.run(120);
check.ok('checkpoint restore resumes resources and geological state bit-identically', S.hash() === restoredRun);

function replay(seed, rate) {
	P.seed = seed; P.sl.geo = rate; P.sl.erupt = 1800; SIM.reset();
	var start = ledger(), chosen = 0, worstResource = 0;
	for (var f = 0; f < 600; f++) {
		SIM.step();
		if (f === 100 && S.nDep > 0) { chosen = S.depId[0]; ORE.extract(S, chosen, S.depVol[0] * 0.1); }
		if (f === 300) { var idx = ORE.byId(S, chosen); if (idx >= 0) ORE.extract(S, chosen, S.depVol[idx]); }
		worstResource = Math.max(worstResource, resourceBalance());
	}
	return { hash: S.hash(), ledger: massError(start), resources: worstResource, valid: validAll(), nDep: S.nDep };
}
var r1 = replay(1, 50000), r2 = replay(1, 50000);
check.ok('same seed, sliders and explicit mining events reproduce the complete hash', r1.hash === r2.hash, r1.hash + ' / ' + r2.hash);
check.ok('new full-pipeline mining fixture keeps both ledgers and host invariants', r1.valid && r1.ledger < 1e-10 && r1.resources < 1e-10,
	'crust ' + r1.ledger.toExponential(2) + ', resources ' + r1.resources.toExponential(2) + ', ' + r1.nDep + ' deposits');
var r3 = replay(5, 100000);
check.ok('100 kyr mining leg remains finite, depth-valid and mass-exact', r3.valid && r3.ledger < 1e-10 && r3.resources < 1e-10,
	'crust ' + r3.ledger.toExponential(2) + ', resources ' + r3.resources.toExponential(2) + ', ' + r3.nDep + ' deposits');

check.section('M3.7 dedicated K8 cost (not a previous raster benchmark)');
var startTime = performance.now();
for (i = 0; i < 600; i++) ORE.k8(S, 0.05, SIM.t + i * 0.05, SIM.Tm);
var ms = (performance.now() - startTime) / 600;
check.info('K8', ms.toFixed(3) + ' ms/step, ' + S.nCol + ' columns / ' + S.nDep + ' deposits');
check.ok('K8 fits a 2 ms dedicated kernel budget', ms < 2);
check.done();
