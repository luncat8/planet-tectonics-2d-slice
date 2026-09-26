// M2 gates: M2.0 state/ledger/event order, M2.1 mantle flow, fan T step, plate solve
// and boundary classifier. M2.2 transport/contact fixtures join as those kernels land.
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, COL = L.mods.columns, SIM = L.mods.sim;
var GEO = L.mods.geom, MNT = L.mods.mantle, PLT = L.mods.plates, E = P.EDGE;

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

check.section('M2.0 state, ledger, event order');
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
var savedContact = SIM.k[4];
SIM.add(4, function () { order.push('contact'); });
SIM.add(5, function () { order.push('surface'); });
SIM.onEvent = function () { order.push('event'); };
SIM.dG = P.eventCadence * 2;
SIM.step();
check.ok('all due events execute after K4 and before K5', order.join(',') === 'contact,event,event,surface');
SIM.add(4, savedContact); SIM.add(5, null); SIM.onEvent = COL.events;
SIM.reset();
var first = S.hash();
SIM.reset();
check.ok('reset is deterministic, including new buffers', first === S.hash());

// --- M2.1 mantle ------------------------------------------------------------------
check.section('M2.1 mantle flow and fan T');
check.planet(1);
check.ok('modes are integer harmonics of the wrap', Array.from(MNT.n).join(',') === '6,10,13,16', Array.from(MNT.n).join(','));
var modesOk = true;
for (var m = 0; m < MNT.nMode; m++) {
	var period = 2 * Math.PI / MNT.om[m];
	modesOk = modesOk && MNT.c[m] >= 0.2 && MNT.c[m] <= 0.4 && period >= 200 && period <= 500 && MNT.ph[m] >= 0 && MNT.ph[m] < 2 * Math.PI;
}
check.ok('mode obliquity, precession and phase within the design ranges', modesOk);
MNT.setTime(123.4, 1.3);
var uScale = MNT.s * MNT.amp * MNT.nMode, perErr = 0, surfErr = 0, divRel = 0, uMax = 0;
for (var q = 0; q < 1000; q++) {
	var x = (q + 0.37) * P.wrap / 1000, y = -q * 6e3, h = 10;
	perErr = Math.max(perErr, Math.abs(MNT.uSurf(x + P.wrap) - MNT.uSurf(x)));
	MNT.flow(x, y); var vx = MNT.vx, vy = MNT.vy;
	MNT.flow(x + P.wrap, y); perErr = Math.max(perErr, Math.abs(MNT.vx - vx), Math.abs(MNT.vy - vy));
	MNT.flow(x, 0); surfErr = Math.max(surfErr, Math.abs(MNT.vx - MNT.uSurf(x)));
	MNT.flow(x + h, y); var ax = MNT.vx; MNT.flow(x - h, y); var dudx = (ax - MNT.vx) / (2 * h);
	MNT.flow(x, y + h); var ay = MNT.vy; MNT.flow(x, y - h); var dvdy = (ay - MNT.vy) / (2 * h);
	divRel = Math.max(divRel, Math.abs(dudx + dvdy) / (Math.abs(dudx) + Math.abs(dvdy) + 1e-30));
	uMax = Math.max(uMax, Math.abs(vx));
}
check.ok('flow repeats after P.wrap to double precision', perErr < 1e-9 * uScale, perErr.toExponential(2) + ' m/Myr');
check.ok('surface drive is u_x(x, 0)', surfErr < 1e-9 * uScale, surfErr.toExponential(2));
check.ok('streamfunction flow is divergence-free', divRel < 1e-5, 'max |div|/(|du/dx|+|dv/dy|) ' + divRel.toExponential(2));
check.ok('flow speed bounded by the mode sum', uMax <= uScale, (uMax / 1e4).toFixed(2) + ' cm/yr');

// no lid (all columns age 0): the step is pure advection + relaxation
S.colAge.fill(0);
S.Tf.fill(0.3);
MNT.stepT(S, 0.2);
var cErr = 0, want = 0.3 * Math.exp(-0.2 / P.tauT);
for (var k2 = 0; k2 < S.Tf.length; k2++) cErr = Math.max(cErr, Math.abs(S.Tf[k2] - want));
check.ok('constant T is preserved (times the relaxation)', cErr < 1e-15, cErr.toExponential(2));

// the row recurrence must reproduce the closed-form flow: re-trace every cell with flow()
var fx = function (x, y) { return Math.sin(3 * 2 * Math.PI * x / P.wrap) * Math.exp(y / 5e5); };
for (var r = 0; r < GEO.N; r++) {
	for (var j = 0; j < GEO.fanN[r]; j++) S.Tf[GEO.fanOff[r] + j] = fx((j + 0.5) * P.wrap / GEO.fanN[r], -GEO.rowCy[r]);
}
var before = S.Tf.slice(), dtT = 0.2;
MNT.stepT(S, dtT);
var traceErr = 0;
for (r = 0; r < GEO.N; r++) {
	for (j = 0; j < GEO.fanN[r]; j++) {
		var cx = (j + 0.5) * P.wrap / GEO.fanN[r], cy = -GEO.rowCy[r];
		MNT.flow(cx, cy);
		var yd = Math.min(0, Math.max(-P.R, cy - dtT * MNT.vy));
		var ref = Math.exp(-dtT / P.tauT) * MNT.sampleT(before, cx - dtT * MNT.vx, yd);
		traceErr = Math.max(traceErr, Math.abs(S.Tf[GEO.fanOff[r] + j] - ref));
	}
}
check.ok('back-trace recurrence equals the closed-form flow', traceErr < 1e-9, traceErr.toExponential(2));

check.planet(1);
var tLo = Infinity, tHi = -Infinity;
for (k2 = 0; k2 < S.Tf.length; k2++) { tLo = Math.min(tLo, S.Tf[k2]); tHi = Math.max(tHi, S.Tf[k2]); }
SIM.setGeo(100e3);
SIM.run(400);
var tBound = true;
for (k2 = 0; k2 < S.Tf.length; k2++) tBound = tBound && S.Tf[k2] >= tLo - 1e-12 && S.Tf[k2] <= tHi + 1e-12;
check.ok('T stays finite and inside its initial bounds over 40 Myr', tBound, '[' + tLo.toFixed(3) + ', ' + tHi.toFixed(3) + ']');
var uOk = true;
for (var p = 0; p < S.nPl; p++) uOk = uOk && Math.abs(S.plU[p]) <= P.vMax && Number.isFinite(S.plU[p]);
check.ok('plate speeds finite and within vMax', uOk, Array.from(S.plU.subarray(0, S.nPl), function (u) { return (u / 1e4).toFixed(2); }).join(' ') + ' cm/yr');
check.ok('only newborn ridges have damage (not neutral contacts)',
	S.damage.every(function (d) { return d === 0 || d === 0.6; }));
invariants();

// --- M2.1 plate solve ---------------------------------------------------------------
check.section('M2.1 plate solve');
check.planet(1);
SIM.setGeo(50e3);
SIM.run(20);
// dt = tauOmega relaxes fully: u is exactly the width-weighted mean fit
MNT.setTime(SIM.t, SIM.Tm);
MNT.columns(S);
PLT.basal(S);
var sw = new Float64Array(S.nPl), su = new Float64Array(S.nPl), icD = 1 / PLT.cD(SIM.Tm);
for (var c = 0; c < S.nCol; c++) {
	sw[S.colPlate[c]] += S.colW[c];
	su[S.colPlate[c]] += S.colW[c] * (MNT.uCol[c] + PLT.wB[c] * icD);
}
PLT.solve(S, P.tauOmega, SIM.Tm);
var fitErr = 0;
for (p = 0; p < S.nPl; p++) fitErr = Math.max(fitErr, Math.abs(S.plU[p] - su[p] / sw[p]));
check.ok('dt = tauOmega gives the width-weighted mean fit', fitErr < 1e-9, fitErr.toExponential(2));
var colUOk = true;
for (c = 0; c < S.nCol; c++) colUOk = colUOk && S.colU[c] === S.plU[S.colPlate[c]];
check.ok('columns carry their plate velocity', colUOk);
var u0 = S.plU[0];
MNT.uCol.fill(1e5);
PLT.wB.fill(0);
PLT.solve(S, P.tauOmega * 0.25, SIM.Tm);
check.near('relaxation moves u by dt/tauOmega of the gap', S.plU[0], u0 + (1e5 - u0) * 0.25, 1e-12);
MNT.uCol.fill(1e7);
PLT.solve(S, P.tauOmega, SIM.Tm);
check.ok('speed clamps at vMax', S.plU[0] === P.vMax && S.plU[S.nPl - 1] === P.vMax);
check.ok('cD grows as the mantle cools (stagnant lid)', PLT.cD(0.35) > 100 * PLT.cD(1.6) && PLT.cD(1) === 1);

// --- M2.1 classifier on a prescribed two-plate fixture -----------------------------
check.section('M2.1 boundary classifier (prescribed two plates)');
function twoPlates() {
	check.planet(1);
	var n = S.nCol, half = n >> 1;
	for (var i = 0; i < n; i++) {
		S.colPlate[i] = i < half ? 0 : 1;
		S.hFel[i] = 35e3; S.colAge[i] = 100;
		S.edge[i] = 0; S.edgePol[i] = 0; S.edgeAge[i] = 0; S.edgeRPlate[i] = -1;
	}
	S.nPl = 2; S.plN[0] = half; S.plN[1] = n - half;
	return half - 1;               // the interior boundary: edge from col half-1 to half
}
function setRel(relN) {
	S.plU[0] = 0; S.plU[1] = relN;
	for (var i = 0; i < S.nCol; i++) S.colU[i] = S.plU[S.colPlate[i]];
	PLT.classify(S, 0.05);
	PLT.trench(S);
}
var bi = twoPlates(), seam = S.nCol - 1;
var seq = [[1.5e3, E.neutral], [2.5e3, E.open], [1.5e3, E.open], [0.9e3, E.neutral],
	[-1.5e3, E.neutral], [-2.5e3, E.collide], [-1.5e3, E.collide], [-0.9e3, E.neutral],
	[2.5e3, E.open], [-2.5e3, E.collide], [2.5e3, E.open]];
var seqOk = true, got = [];
for (var si = 0; si < seq.length; si++) {
	setRel(seq[si][0]);
	got.push(S.edge[bi]);
	seqOk = seqOk && S.edge[bi] === seq[si][1];
}
check.ok('epsHi enters / epsLo leaves opening and closing (C–C collides)', seqOk, got.join(','));
check.ok('the seam edge (last -> first) is the mirrored boundary', S.edge[seam] === E.collide && S.edgeRelN[seam] === -S.edgeRelN[bi]);
var interiorNone = true;
for (c = 0; c < S.nCol; c++) if (c !== bi && c !== seam) interiorNone = interiorNone && S.edge[c] === E.none;
check.ok('same-plate edges are interior', interiorNone);

bi = twoPlates();
setRel(-2.5e3); setRel(-2.5e3); setRel(-2.5e3);
check.near('edgeAge accumulates in one state', S.edgeAge[bi], 0.1, 1e-12);
setRel(0);
check.ok('edgeAge resets on a state change', S.edgeAge[bi] === 0 && S.edge[bi] === E.neutral);
bi = twoPlates();
setRel(-5e4); setRel(-5e4);
check.ok('fast collision never advances the slow suture timer', S.edgeSlow[bi] === 0);
setRel(-2.5e3);
check.near('a slow collision starts the consecutive suture timer', S.edgeSlow[bi], 0.05, 1e-12);
setRel(-5e4);
check.ok('fast convergence resets the consecutive slow timer', S.edgeSlow[bi] === 0);

setRel(2.5e3);
S.colPlate[bi + 1] = 2; S.nPl = 3;                // a different right plate: history is void
setRel(1.5e3);
check.ok('history is kept only for the same ordered plate pair', S.edge[bi] === E.neutral && S.edgeAge[bi] === 0);

bi = twoPlates();
S.hFel[bi] = 0;                                     // O–C: oceanic left subducts
setRel(-3e3);
check.ok('O–C: the oceanic side subducts', S.edge[bi] === E.subduct && S.edgePol[bi] === -1);
check.ok('trenchDist 1..3 on the overriding (right) side',
	S.trenchDist[bi + 1] === 1 && S.trenchDist[bi + 2] === 2 && S.trenchDist[bi + 3] === 3 && S.trenchDist[bi + 4] === 0 && S.trenchDist[bi] === 0);
bi = twoPlates();
S.hFel[bi] = 0; S.hFel[bi + 1] = 0; S.colAge[bi] = 30; S.colAge[bi + 1] = 90;
setRel(-3e3);
check.ok('O–O: the older side subducts', S.edge[bi] === E.subduct && S.edgePol[bi] === 1);
check.ok('trenchDist 1..3 on the overriding (left) side',
	S.trenchDist[bi] === 1 && S.trenchDist[bi - 1] === 2 && S.trenchDist[bi - 2] === 3 && S.trenchDist[bi + 1] === 0);
S.colAge[bi] = 120;
setRel(-3e3);
check.ok('O–O polarity holds while the trench runs', S.edgePol[bi] === 1);
S.hFel[bi + 1] = 35e3;
setRel(-3e3);
check.ok('O–C overrides a held O–O polarity', S.edgePol[bi] === -1);
S.hFel[bi] = 35e3;
setRel(-3e3);
check.ok('continent arriving at the trench turns it into collision', S.edge[bi] === E.collide && S.edgePol[bi] === 0);

bi = twoPlates();
setRel(-5e4);
S.slope.fill(0);
PLT.basal(S);
check.ok('collision resistance pushes both sides apart, equal and opposite', PLT.wB[bi] < 0 && PLT.wB[bi + 1] === -PLT.wB[bi],
	(PLT.wB[bi] / 1e4).toFixed(2) + ' cm/yr');
S.hFel[5] = 0; S.slope[5] = 1e-3;
PLT.basal(S);
check.ok('ridge push is downslope on oceanic columns only', PLT.wB[5] === -P.kRidge * 1e-3 && PLT.wB[6] === 0);

// --- M2.2: rigid transport, wrap, volume contacts -------------------------------
check.section('M2.2 transport and contact fixtures');
function ledger(start, name) {
	var now = S.mass(), valid = true, worst = 0;
	for (var l = 0; l < P.LITH.n; l++) {
		var lhs = now[l] + S.ledCons[l] + S.ledMixOut[l];
		var rhs = start[l] + S.ledProd[l] + S.ledMixIn[l];
		var err = Math.abs(lhs - rhs) / Math.max(1, rhs);
		worst = Math.max(worst, err);
		valid = valid && err < 1e-12;
	}
	check.ok(name + ' per-lith volume ledger', valid, 'max relative ' + worst.toExponential(2));
}
function boundary() {
	check.planet(1);
	for (var i = 0; i < S.nCol - 1; i++) if (S.colPlate[i] !== S.colPlate[i + 1]) return i;
	throw Error('no interior boundary');
}
function contact(i, spacing, rel) {
	var j = i + 1;
	S.oldW.set(S.colW);
	S.colX[j] = S.colX[i] + spacing * P.w0;
	S.widths();
	S.colU.fill(0); S.colU[j] = rel;
	S.edge[i] = rel > 0 ? E.open : (S.hFel[i] >= P.hOceanic && S.hFel[j] >= P.hOceanic ? E.collide : E.subduct);
	S.edgeRelN[i] = rel;
	S.edgePol[i] = S.hFel[i] < P.hOceanic ? -1 : 1;
	S.edgeRPlate[i] = S.colPlate[j];
	COL.k4(S, 0.05, 0, 1.6);
}
bi = boundary();
var firstX = S.colX[0];
S.noise[0] = 0.12345;
S.nDep = 1; S.depCol[0] = 0; S.depLay[0] = 0;
S.nVen = 1; S.venCol[0] = 0; S.volc[0] = 0;
var motionStart = S.mass().slice(), motionU = P.w0 * 2.25 / 0.05;
S.colU.fill(motionU, 0, S.nCol);
COL.transport(S, 0.05);
COL.k4(S, 0.05, 0, 1.6);
var owner = S.depCol[0];
check.ok('wrap gather carries stack, marker, vent and deposit together',
	owner === S.venCol[0] && S.volc[owner] === 0 && S.noise[owner] === 0.12345 &&
	S.colX[owner] === (firstX + motionU * 0.05) % P.wrap && S.colNL[owner] > 0);
check.ok('rigid movement retains every spacing through seam',
	S.colW.subarray(0, S.nCol).every(function (w) { return Math.abs(w - P.w0) < 1e-7; }));
ledger(motionStart, 'rigid wrap');
invariants();

// Three rigid columns cross the seam together. The empty rest of the wrap is
// intentionally huge: the old-width volume rule must not fabricate crust there.
check.planet(1);
S.nCol = 3; S.nPl = 1;
S.colX[0] = 0.1 * P.w0;
S.colX[1] = 1.1 * P.w0;
S.colX[2] = P.wrap - 0.9 * P.w0;
S.colPlate.fill(0, 0, 3);
S.colU.fill(5e4, 0, 3);
S.noise[0] = 0.12345;
S.widths();
var rigidX = S.colX[0], rigidWidth = S.colW[0], rigidMass = S.mass().slice();
for (var rStep = 0; rStep < 40; rStep++) { COL.transport(S, 1); COL.k4(S, 1, 0, 1.6); }
var marker = S.noise.findIndex(function (v) { return v === 0.12345; });
check.near('5 cm/yr rigid plate translates 2000 km including the wrap', S.colX[marker],
	(rigidX + 2e6) % P.wrap, 1e-10);
check.near('rigid plate carries its own width through 40 translations', S.colW[marker], rigidWidth, 1e-12);
for (rStep = 0; rStep < 100000; rStep++) { COL.transport(S, 0.05); COL.k4(S, 0.05, 0, 1.6); }
marker = S.noise.findIndex(function (v) { return v === 0.12345; });
check.near('no rigid spacing drift after 1e5 frames', S.colW[marker], rigidWidth, 1e-12);
ledger(rigidMass, 'rigid 2000 km + 1e5 frames');
invariants();

bi = boundary();
var gapMass = S.mass().slice(), gapN = S.nCol, gapPlate = S.colPlate[bi];
// Force oceanic donor sets; only the newborn mafic volume is sourced from mantle.
for (var d = -P.K + 1; d <= P.K; d++) S.hFel[(bi + d + S.nCol) % S.nCol] = 0;
contact(bi, 1.6, 5e4);
check.ok('one opening creates one oceanic packet on the left plate', S.nCol === gapN + 1 &&
	S.colPlate[bi + 1] === gapPlate && S.colAge[bi + 1] === 0 && S.damage[bi + 1] === 0.6 && S.hMaf[bi + 1] > 0);
ledger(gapMass, 'oceanic ridge');
invariants();

bi = boundary();
for (d = -P.K + 1; d <= P.K; d++) {
	var donor = (bi + d + S.nCol) % S.nCol;
	COL.push(donor, 35e3, P.LITH.fel, 100, 0);
	COL.sums(donor);
}
gapMass = S.mass().slice(); gapN = S.nCol;
var oldFel = S.hFel[bi];
contact(bi, 1.6, 5e4);
check.ok('continental opening shares felsic beds and thins donors', S.nCol === gapN + 1 &&
	S.hFel[bi + 1] > 0 && S.hFel[bi] < oldFel && S.ledProd[P.LITH.maf] === 0);
ledger(gapMass, 'continental rift');
invariants();

bi = boundary();
// A full C-C stack goes into the thicker winner, with no prism/sink.
COL.push(bi, 20e3, P.LITH.fel, 100, 0);
COL.push(bi + 1, 40e3, P.LITH.fel, 100, 0);
COL.sums(bi); COL.sums(bi + 1);
var collisionMass = S.mass().slice(), collisionN = S.nCol;
var loser = S.hFel[bi] <= S.hFel[bi + 1] ? bi : bi + 1;
S.nDep = 1; S.depCol[0] = loser; S.depLay[0] = 0;
S.nVen = 1; S.venCol[0] = loser; S.volc[loser] = 0;
contact(bi, 0.5, -5e4);
check.ok('C-C contact consumes exactly the thinner column', S.nCol === collisionN - 1 &&
	S.ledCons.every(function (v) { return v === 0; }));
check.ok('collision rehomes deposit horizon and vent to winner', S.depCol[0] >= 0 &&
	S.depLay[0] < S.colNL[S.depCol[0]] && S.venCol[0] >= 0 && S.volc[S.venCol[0]] === 0);
ledger(collisionMass, 'collision');
invariants();

bi = boundary();
var subMass = S.mass().slice(), subN = S.nCol, sedBefore = S.ledCons[P.LITH.sed];
S.hFel[bi] = 0; S.hFel[bi + 1] = 35e3;
contact(bi, 0.5, -5e4);
check.ok('subduction consumes ocean and leaves half sediment in prism', S.nCol === subN - 1 &&
	S.ledCons[P.LITH.maf] > 0 && S.ledCons[P.LITH.sed] > sedBefore);
ledger(subMass, 'subduction');
invariants();

// If the edge-carrying column is consumed, the left neighbour inherits its
// running boundary with the same right plate, not the consumed column's slot.
bi = boundary();
S.edge[bi] = E.collide; S.edgeAge[bi] = 12;
S.edgeRPlate[bi] = S.colPlate[bi + 1];
S.edgeRelN[bi] = -5e4;
S.hFel[bi] = 1; S.hFel[bi + 1] = 35e3;
S.oldW.set(S.colW);
S.colX[bi + 1] = S.colX[bi] + 0.5 * P.w0;
S.widths();
COL.k4(S, 0.05, 0, 1.6);
check.ok('consumed left owner hands its edge history to new left neighbour',
	S.edge[bi - 1] === E.collide && S.edgeAge[bi - 1] === 12);
invariants();

// Cadence events operate on the stable post-K4 list, not during a gather.
bi = boundary();
var nPlBefore = S.nPl;
S.edge[bi] = E.collide; S.edgeAge[bi] = 21; S.edgeSlow[bi] = 0;
S.edgeRelN[bi] = -2.5e3;
check.ok('one newly slow frame cannot suture an old fast collision', !COL.events(S) &&
	S.nPl === nPlBefore);
S.edgeSlow[bi] = 21;
check.ok('20-Myr slow C-C suture merges exactly one plate', COL.events(S) &&
	S.nPl === nPlBefore - 1 && S.colPlate[bi] === S.colPlate[bi + 1]);
invariants();
bi = boundary();
nPlBefore = S.nPl;
var plate = S.colPlate[bi + 1];
var splitAt = bi + 1 + P.minPlateCells;
S.damage[splitAt] = P.splitDamage + 0.01;
check.ok('damaged corridor splits two sufficiently large daughter plates', COL.events(S) &&
	S.nPl === nPlBefore + 1 && S.damage[splitAt] === 0.5 &&
	S.plN[plate] >= P.minPlateCells && S.plN[S.nPl - 1] >= P.minPlateCells);
invariants();

// A seam opening is the same event as an interior opening, including the left tie.
bi = boundary();
var seamI = S.nCol - 1;
check.planet(1);
seamI = S.nCol - 1;
var seamPlate = S.colPlate[seamI], seamMass = S.mass().slice(), seamN = S.nCol;
S.oldW.set(S.colW);
S.colX[seamI] -= 0.6 * P.w0;
S.widths();
S.edge[seamI] = E.open; S.edgeRelN[seamI] = 5e4;
COL.k4(S, 0.05, 0, 1.6);
check.ok('wrapped last-to-first gap produces one left-plate packet', S.nCol === seamN + 1 &&
	S.colPlate[S.nCol - 1] === seamPlate && S.colX[S.nCol - 1] > P.wrap - P.w0);
ledger(seamMass, 'seam opening');
invariants();

// At capacity a failed birth leaves no ledger or donor side effects. A concurrent
// consumption frees a slot, and the birth reuses it without exceeding the buffer.
function fullFixture(consumption) {
	check.planet(1);
	S.nCol = P.colCap;
	S.nPl = 3;
	var pitch = (P.wrap - 250e3) / P.colCap;
	for (var i = 0; i < S.nCol; i++) {
		S.colX[i] = i * pitch;
		S.colPlate[i] = i < 384 ? 0 : (i <= 500 ? 1 : 2);
		S.colNL[i] = 0;
		S.hFel[i] = 0; S.hSed[i] = 0; S.hMaf[i] = 0;
		S.edge[i] = E.none; S.edgeRelN[i] = 0;
		S.volc[i] = -1;
	}
	var open = 383;
	for (i = 384; i < S.nCol; i++) S.colX[i] += 0.9 * P.w0;
	S.edge[open] = E.open; S.edgeRelN[open] = 5e4;
	if (consumption) {
		S.colX[501] = S.colX[500] + 0.5 * P.w0;
		S.edge[500] = E.collide; S.edgeRelN[500] = -5e4;
		S.hFel[500] = 1; S.hFel[501] = 2;
	}
	S.widths(); S.oldW.set(S.colW);
	COL.k4(S, 0.05, 0, 1.6);
}
fullFixture(false);
check.ok('at colCap skipped birth is atomic', S.nCol === P.colCap && S.spawnSkipped === 1 &&
	S.ledProd[P.LITH.maf] === 0);
invariants();
fullFixture(true);
check.ok('a consumed slot is reused by a birth at colCap', S.nCol === P.colCap &&
	S.spawnSkipped === 0 && S.ledProd[P.LITH.maf] > 0,
	'n=' + S.nCol + ' skipped=' + S.spawnSkipped + ' prod=' + S.ledProd[P.LITH.maf]);
invariants();

check.planet(1);
var longMass = S.mass().slice();
SIM.setGeo(100e3);
SIM.run(1000);
ledger(longMass, '100 Myr evolving planet');
invariants();
SIM.setGeo(200e3);
SIM.run(3000);
ledger(longMass, '700 Myr mixed-rate evolving planet (repeated births)');
invariants();

check.section('M2.1 determinism and finite state at every kernel boundary');
check.planet(3);
SIM.setGeo(50e3);
var finiteAll = true, saved = SIM.k.slice();
function finiteState() {
	for (var key in S) {
		var a = S[key];
		if (!ArrayBuffer.isView(a)) continue;
		for (var q = 0; q < a.length; q++) if (!Number.isFinite(a[q])) return false;
	}
	return true;
}
for (var ks = 1; ks < 10; ks++) {
	if (!saved[ks]) continue;
	(function (fn) { SIM.k[ks] = function (st, dt, t, Tm) { fn(st, dt, t, Tm); finiteAll = finiteAll && finiteState(); }; })(saved[ks]);
}
SIM.run(20);
SIM.k = saved;
check.ok('all buffers finite after every kernel (20 frames)', finiteAll);
check.planet(3);
var h1 = SIM.run(300);
check.planet(3);
check.ok('same seed and dtGeo are bitwise deterministic (300 frames)', h1 === SIM.run(300));

// design §6: sim K0-K7 <= 4 ms per frame; min of runs (throttled shared CPU)
check.planet(1);
SIM.setGeo(50e3);
SIM.run(10);
var best = Infinity, t0;
for (var run = 0; run < 7; run++) {
	t0 = process.hrtime.bigint();
	SIM.run(20);
	best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6 / 20);
}
check.ok('sim frame (K0-K4) within the 4 ms budget', best <= 4, best.toFixed(3) + ' ms/frame, min of 7x20');
check.done();
