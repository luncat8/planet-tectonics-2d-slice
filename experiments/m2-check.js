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
check.ok('neutral contacts invent no transform damage', S.damage.every(function (d) { return d === 0; }));
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
check.ok('sim frame (K0-K3 so far) within the 4 ms budget', best <= 4, best.toFixed(3) + ' ms/frame, min of 7x20');
check.done();
