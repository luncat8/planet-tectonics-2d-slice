// 0.2.0 M2: write-back, one mass owner, the box-shaped edifice, FX and retirement.
// Run: node experiments/edifice-bench.js
'use strict';
var L = require('./lib.js'), check = L.check, M = L.mods, F = require('./erupt-fixture.js');
var P = M.params, S = M.state, ERUPT = M.erupt, MAG = M.magma, COL = M.columns;
var GEO = M.geom, R = M.render, SIM = M.sim, CP = M.checkpoint;
var px = new Uint32Array(P.cw * P.ch), W = P.ventBoxW, c = 100, v = 0, k, f;

function ledger() {
	return { mass: S.mass().slice(), prod: S.ledProd.slice(), cons: S.ledCons.slice(),
		inM: S.ledMixIn.slice(), outM: S.ledMixOut.slice() };
}
function error(start) {
	var mass = S.mass(), worst = 0, l, lhs, rhs;
	for (l = 0; l < P.LITH.n; l++) {
		lhs = mass[l] + S.ledCons[l] - start.cons[l] + S.ledMixOut[l] - start.outM[l];
		rhs = start.mass[l] + S.ledProd[l] - start.prod[l] + S.ledMixIn[l] - start.inM[l];
		worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, start.mass[l], Math.abs(rhs)));
	}
	return worst;
}
function rock(col, lith) {
	var mass = 0, b = col * P.layerCap;
	for (var i = 0; i < S.colNL[col]; i++) if (S.layLi[b + i] === lith) mass += S.layTh[b + i] * S.colW[col];
	return mass;
}
function pile(vent) {
	var mass = 0;
	for (var i = 0; i < W; i++) mass += S.toyH[vent * W + i];
	return mass;
}
function drawBody() { GEO.sync(); GEO.buildColLUT(S); R.w = P.cw; R.h = P.ch; R.body(px, P.cw, P.ch); }
function capture() {
	drawBody();
	var out = { fills: [], arcs: 0, clips: 0, depth: 0, finite: true }, path = [];
	function point(x, y) { out.finite = out.finite && Number.isFinite(x) && Number.isFinite(y); path.push([x, y]); }
	R.ctx = {
		save: function () { out.depth++; }, restore: function () { out.depth--; },
		beginPath: function () { path = []; }, moveTo: point, lineTo: point,
		closePath: function () {}, clip: function () { out.clips++; },
		fill: function () { out.fills.push(path.slice()); }, stroke: function () {},
		arc: function (x, y) { out.arcs++; point(x, y); }
	};
	R.overlayVents(); R.ctx = null;
	return out;
}

check.section('M2.1 freeze: exact transfer, lithology, z / hTot / Moho and repeat safety');
F.fresh(c); F.vent(c, v, 0.1);
var start = ledger(), z0 = S.z[c], h0 = S.hTot[c], moho0 = z0 - S.hDraw[c];
var leftZ = S.z[c - 1], rightZ = S.z[c + 1];
F.molten(v, 12, P.LITH.lava); F.molten(v, 5, P.LITH.tephra);
ERUPT.cool(v, 900);
check.ok('above Tsol nothing enters the stack', S.venLava[v] === 0 && S.venTephra[v] === 0 && S.hTot[c] === h0);
ERUPT.cool(v, 100);
check.ok('mixed molten lithologies freeze into their own exact queues', S.venLava[v] === 12 && S.venTephra[v] === 5);
var calls = [], insert = COL.insertVol;
COL.insertVol = function (st, col, lith, thick, t, flags) {
	calls.push([col, lith, thick, t]); return insert.call(COL, st, col, lith, thick, t, flags);
};
ERUPT.writeBack(v, 42); COL.insertVol = insert; ERUPT.record(v);
var thickness = 17 * P.toyCellM2 / S.colW[c];
var rise = P.toyCellM2 / S.colW[c] * (12 * (P.rhoM - P.rhoMaf) + 5 * (P.rhoM - P.rhoSed)) / P.rhoM;
check.ok('both lithologies use COL.insertVol on the owner alone', calls.length === 2 && calls.every(function (a) { return a[0] === c && a[3] === 42; }));
check.near('lava mass equals the frozen lava, not the last-writer lithology', rock(c, P.LITH.lava), 12 * P.toyCellM2, 1e-12);
check.near('tephra mass equals the frozen ash', rock(c, P.LITH.tephra), 5 * P.toyCellM2, 1e-12);
check.near('hTot gains exactly transferred volume / column width', S.hTot[c] - h0, thickness, 1e-12);
check.near('z gains only the transfer\'s buoyancy', S.z[c] - z0, rise, 1e-12);
check.near('Moho changes only by rise minus the added thickness', S.z[c] - S.hDraw[c] - moho0, rise - thickness, 1e-12);
check.ok('neighbour ground does not move', S.z[c - 1] === leftZ && S.z[c + 1] === rightZ);
check.ok('K7 output queues empty; frozen heights are no longer melt', S.venLava[v] === 0 && S.venTephra[v] === 0 && ERUPT.mass(v) === 0 && S.toyFz[W >> 1] === 17);
var written = S.venEdV[v], height = S.hTot[c], prod = S.ledProd.slice();
ERUPT.writeBack(v, 43); ERUPT.cool(v, 9000); ERUPT.writeBack(v, 43);
check.ok('freeze / write-back cannot book the same solid twice', S.venEdV[v] === written && S.hTot[c] === height && S.ledProd.every(function (x, i) { return x === prod[i]; }));
check.ok('per-lithology mass identity closes after reclassification', error(start) < 1e-12, 'rel ' + error(start).toExponential(2));

check.section('M2.2 landing and slump: written solids never turn back into melt');
F.fresh(c); F.vent(c, v, 0.5); start = ledger();
var packet = F.packet(v, 3);
ERUPT.flight(v, ERUPT.flightTime(packet) + 1);
check.ok('landing retires the packet and queues its tephra once', S.prN[v] === 0 && S.venTephra[v] === 3 && S.venLava[v] === 0);
ERUPT.writeBack(v, 44);
for (f = 0; f < 100; f++) ERUPT.slump(v);
ERUPT.writeBack(v, 45);
check.ok('slump retains solid geometry without generating a second output', Math.abs(pile(v) - 3) < 1e-12 && ERUPT.mass(v) === 0 && S.venToyOut[v] === 3);
check.near('only the landed mass belongs to the tephra bed', rock(c, P.LITH.tephra), 3 * P.toyCellM2, 1e-12);
F.molten(v, 8, P.LITH.lava); F.molten(v, 4, P.LITH.tephra, 0.8);
for (f = 0; f < 100; f++) ERUPT.slump(v);
ERUPT.cool(v, 3000);
check.near('slump preserves the molten lava fraction through two-sided transfers', S.venLava[v], 8, 1e-12);
check.near('slump preserves the molten ash fraction', S.venTephra[v], 4, 1e-12);
ERUPT.writeBack(v, 46);
check.ok('mixed, slumped write-back keeps the per-lithology ledger', error(start) < 1e-12, 'rel ' + error(start).toExponential(2));

check.section('M2.3 full K7 episodes: 10–30 px, exact mass and ordinary dated beds');
function episode(gas, name) {
	F.fresh(c); F.vent(c, v, gas);
	var initial = ledger(), cells = 150, worst = 0, queues = true, frames = 0;
	MAG.add(S, c, cells * P.toyCellM2, false);
	P.sl.erupt = P.eruptMax;
	while (S.colChamber[c] + S.venV[v] > 0 && frames < 1000) {
		MAG.k7(S, 0, 42, SIM.Tm); frames++;
		worst = Math.max(worst, error(initial));
		queues = queues && S.venLava[v] === 0 && S.venTephra[v] === 0;
	}
	P.sl.erupt = 1800;
	for (var j = 0; j < 4; j++) { MAG.k7(S, 0, 42, SIM.Tm); worst = Math.max(worst, error(initial)); }
	drawBody();
	var width = S.venW[v] / GEO.kx, tall = GEO.sy(S.z[c]) - GEO.sy(S.z[c] + S.venH[v]);
	check.info(name, width.toFixed(2) + ' x ' + tall.toFixed(2) + ' px, ' + frames + ' metered K7 frames, worst ledger ' + worst.toExponential(2));
	check.ok(name + ': 10–30 px edifice at the default window', width >= 10 && width <= 30 && tall >= 10 && tall <= 30);
	check.ok(name + ': every K7 drains its output queues', queues && S.venLava[v] === 0 && S.venTephra[v] === 0);
	check.ok(name + ': no pending mass after cooling / landing', ERUPT.mass(v) === 0 && S.venV[v] === 0 && S.colChamber[c] === 0);
	check.near(name + ': the stack owns the whole supplied mass', S.venEdV[v], cells * P.toyCellM2, 1e-10);
	check.near(name + ': the retained box geometry matches that same episode', pile(v), cells, 1e-10);
	check.ok(name + ': mass identity holds on every frame', worst < 1e-10);
	var lith = gas > P.gasBlast ? P.LITH.tephra : P.LITH.lava;
	check.ok(name + ': the intended lithology dominates the edifice', rock(c, lith) > 0.99 * S.venEdV[v]);
	var b = c * P.layerCap, bed = -1;
	for (j = 0; j < S.colNL[c]; j++) if (S.layLi[b + j] === lith) bed = j;
	check.ok(name + ': volcanic bed carries the section formation time', bed >= 0 && S.layAg[b + bed] === 42 && S.venLast[v] === 42);
	var sx = Math.round(R.screenX(S.venX[v]) - 2), base = R.profileAt(sx);
	var cone = R.pileAt(v, (W >> 1) - 2) * P.toyCellY;
	R.updateProbe(sx, GEO.sy(base + cone * 0.5));
	check.ok(name + ': cone hover resolves its actual column and a dated volcanic bed',
		R.probe.indexOf('col ' + c + ' ') === 0 && /edifice/.test(R.probe) && /formed 42 Myr/.test(R.probe) && !/above surface/.test(R.probe), R.probe.split('\n').slice(-4).join(' | '));
	var sample = capture();
	check.ok(name + ': filled box geometry is clipped to the profile', sample.fills.length > 0 && sample.clips === 1 && sample.depth === 0 && sample.finite);
}
episode(0.1, 'effusive');
episode(0.5, 'explosive');

check.section('M2.4 render reads the box, zooms honestly and leaves state untouched');
var original = capture(), oldW = S.venW[v], oldH = S.venH[v];
S.venW[v] = 1; S.venH[v] = 1;
var notAGlyph = capture();
check.ok('changing record dimensions does not synthesize a different cone', JSON.stringify(original.fills) === JSON.stringify(notAGlyph.fills));
S.toyH[W >> 1] += 2; S.toyFz[W >> 1] += 2;
check.ok('changing the box itself changes the drawn cone', JSON.stringify(original.fills) !== JSON.stringify(capture().fills));
S.toyH[W >> 1] -= 2; S.toyFz[W >> 1] -= 2; S.venW[v] = oldW; S.venH[v] = oldH;
var hash = S.hash(), overviewH;
GEO.setPreset('ovw'); GEO.lookAt(S.venX[v]); drawBody();
overviewH = GEO.sy(S.z[c]) - GEO.sy(S.z[c] + S.venH[v]);
check.near('overview keeps the default horizontal footprint', S.venW[v] / GEO.kx, 27, 0.1);
check.ok('overview compresses the vertical footprint rather than changing mass', overviewH > 5 && overviewH < 10 && S.hash() === hash);
GEO.setPreset('cru'); GEO.lookAt(S.venX[v]); drawBody();
check.near('x10 camera multiplies the cone width by ten', S.venW[v] / GEO.kx, 270, 0.1);
check.ok('render and camera changes do not mutate the simulation', S.hash() === hash);

check.section('M2.5 FX remain airborne even at the largest eruptive step');
F.fresh(c); F.vent(c, v, 0.5); start = ledger();
MAG.add(S, c, P.VchM2, false); P.sl.erupt = P.eruptMax;
MAG.k7(S, 0, 42, SIM.Tm);
var fx = capture();
check.ok('the long tick keeps its newest ballistic packets in flight', S.prN[v] > 0 && S.prN[v] <= P.partCap);
check.ok('overlay draws FX from the live packet buffers', fx.arcs === S.prN[v] && fx.finite && fx.depth === 0);
check.ok('long-step ballistic FX still owns only supplied mass', error(start) < 1e-12);

check.section('M2.6 tauVent retirement, dormant geometry, sorting and slot reuse');
F.fresh(c); F.vent(c, v, 0.5); start = ledger();
F.molten(v, 12, P.LITH.lava); F.packet(v, 3);
S.venV[v] = 0.5 * P.VdieM2; S.ledProd[P.LITH.maf] += S.venV[v];
S.venIdle[v] = P.tauVent - 0.01; P.sl.erupt = 0;
MAG.k7(S, 0.02, 80, SIM.Tm);
check.ok('tauVent alone retires a paused, hot, airborne vent', S.venCol[v] === -1 && S.volc[c] === -1 && ERUPT.mass(v) === 0 && S.prN[v] === 0);
check.ok('retirement leaves dated beds, a dormant edifice and the chamber dribble',
	S.venEdCol[v] === c && S.venEdV[v] > 0 && S.venW[v] > 0 && S.venH[v] > 0 && S.colChamber[c] === 0.5 * P.VdieM2 && error(start) < 1e-12);
MAG.k7(S, 0, 80, SIM.Tm);
check.ok('dormant geometry is not mistaken for orphan melt', S.venEdCol[v] === c && S.venLost === 0 && capture().fills.length > 0);
var xBefore = S.colX[c], move = P.w0 * 2.25;
S.colU.fill(move / 0.05); S.noise[c] = 0.12345;
COL.transport(S, 0.05); COL.k4(S, 0.05, 80, SIM.Tm);
MAG.k7(S, 0, 80, SIM.Tm);
var owner = S.venEdCol[v];
check.ok('a dormant edifice follows its Lagrangian owner through wrap sorting', owner >= 0 && S.noise[owner] === 0.12345 && Math.abs(S.venX[v] - GEO.wrapX(xBefore + move)) < 1e-7);
var oldRock = rock(owner, P.LITH.lava), newCol = owner + 10;
MAG.add(S, newCol, P.VbirthM2, false);
MAG.k7(S, 0.05, 81, SIM.Tm);
check.ok('a reused slot starts a clean box and record, never deleting the old beds',
	S.nVen === 1 && S.venCol[v] === newCol && S.venEdCol[v] === newCol && S.venEdV[v] === 0 && S.venH[v] === 0 && rock(owner, P.LITH.lava) === oldRock);

check.section('M2.6b a new episode on the same column keeps its dormant edifice');
F.fresh(c); F.vent(c, v, 0.1); F.molten(v, 12, P.LITH.lava);
ERUPT.freeze(W >> 1); ERUPT.writeBack(v, 42); ERUPT.record(v);
P.sl.erupt = 0; MAG.k7(S, P.tauVent, 44, SIM.Tm);
var dormantVolume = S.venEdV[v], dormantPile = pile(v), dormantHeight = S.venH[v];
MAG.add(S, c, P.VbirthM2, false); MAG.k7(S, 0.05, 45, SIM.Tm);
check.ok('same-column rebirth reuses the existing shape and volume rather than erasing it',
	S.nVen === 1 && S.venCol[v] === c && S.venEdV[v] === dormantVolume && S.venH[v] === dormantHeight && pile(v) === dormantPile);

check.section("M2.6c a redirected vent adopts only its destination's written geometry");
F.fresh(c); F.vent(c, 0, 0.5); F.vent(c + 1, 1, 0.1);
F.molten(0, 12, P.LITH.lava); F.molten(1, 6, P.LITH.tephra);
ERUPT.freeze(W >> 1); ERUPT.freeze(W + (W >> 1));
ERUPT.writeBack(0, 42); ERUPT.writeBack(1, 42); ERUPT.record(0); ERUPT.record(1);
MAG.venDeath(S, 1, 44); F.molten(0, 2, P.LITH.lava); F.packet(0, 1);
start = ledger(); var transit = ERUPT.mass(0), destinationVolume = S.venEdV[1];
ERUPT.rehome(0, c + 1);
check.ok('rehome does not drag already handed-over source rock to a new column',
	S.venEdV[0] === destinationVolume && Math.abs(pile(0) - 8) < 1e-12 && S.venEdCol[1] === -1 && S.venEdV[1] === 0);
check.ok('adopting dormant geometry cannot copy or lose transit mass', ERUPT.mass(0) === transit && error(start) < 1e-12);

check.section('M2.7 consumed ownership: an occupied margin cannot resurrect an orphan');
c = 255; F.fresh(c); F.vent(c, 0, 0.5); F.vent(c + 1, 1, 0.1);
S.nPl = 2; S.plN[0] = 256; S.plN[1] = 256;
S.colPlate.fill(1, 256, S.nCol);
S.colNL[c] = 0; COL.push(c, 7000, P.LITH.maf, 0, 0); COL.sums(c);
F.molten(0, 2, P.LITH.lava); F.packet(0, 1);
S.venV[0] = 1000; S.ledProd[P.LITH.maf] += 1000;
start = ledger(); var lost = S.venV[0] + ERUPT.mass(0) * P.toyCellM2;
S.oldW.set(S.colW); S.colX[c + 1] = S.colX[c] + P.gFloor * P.w0; S.widths();
S.colU.fill(0); S.colU[c + 1] = -5e4;
S.edge[c] = P.EDGE.subduct; S.edgePol[c] = -1; S.edgeRelN[c] = -5e4;
S.edgeAge[c] = P.evAge + 1; S.edgeRPlate[c] = 1;
M.slab.ready = true; COL.k4(S, 0.05, 42, SIM.Tm);
check.ok('K4 clears the consumed inverse owner before gather', S.venCol[0] === -1 && S.venEdCol[0] === -1 && S.volc[c] === -1 && S.venCol[1] === c + 1 && S.volc[c + 1] === 1);
P.sl.erupt = 0; MAG.k7(S, 0, 42, SIM.Tm);
check.near('orphan loss is exactly the untransferred chamber / box / packet mass', S.venLost, lost, 1e-12);
check.ok('consumed ownership keeps the complete per-lithology ledger', error(start) < 1e-12, 'rel ' + error(start).toExponential(2));

check.section('M2.8 rank / capacity discipline and deposit slots');
c = 100; F.fresh(c); F.vent(c, v, 0.1);
COL.insertVol(S, c, P.LITH.sed, 200, 10, P.FLAG.wet); COL.sums(c);
S.nDep = 1; S.depCol[0] = c; S.depLay[0] = S.colNL[c] - 1;
var dep = S.depLay[0];
F.molten(v, 1, P.LITH.lava); ERUPT.freeze(W >> 1); ERUPT.writeBack(v, 44);
var ordered = true, b = c * P.layerCap;
for (k = 1; k < S.colNL[c]; k++) if (P.LITH_RANK[S.layLi[b + k - 1]] > P.LITH_RANK[S.layLi[b + k]]) ordered = false;
check.ok('volcanic write-back honors rank ordering and shifts an existing deposit with its bed', ordered && S.depLay[0] === dep + 1 && S.layLi[b + S.depLay[0]] === P.LITH.sed);
F.fresh(c); F.vent(c, v, 0.1); S.colNL[c] = 0;
for (k = 0; k < P.layerCap; k++) COL.push(c, 250, P.LITH.fel, 0, 0);
COL.sums(c); start = ledger();
F.molten(v, 2, P.LITH.lava); ERUPT.freeze(W >> 1); ERUPT.writeBack(v, 44);
check.ok('a full stack consolidates before accepting the real volume', S.colNL[c] <= P.layerCap && rock(c, P.LITH.lava) === 2 * P.toyCellM2 && error(start) < 1e-12);

check.section('M2.8b K6 cuts and buries the edifice without a second mass ledger');
function settledCone() {
	F.fresh(c); F.vent(c, v, 0.1); F.molten(v, 150, P.LITH.lava);
	ERUPT.freeze(W >> 1);
	for (var j = 0; j < 1000; j++) ERUPT.slump(v);
	ERUPT.writeBack(v, 42); ERUPT.record(v);
}
settledCone(); start = ledger();
var peakBefore = S.venH[v], flankBefore = S.toyFz[(W >> 1) + 12], stockBefore = S.venEdV[v];
S.zDyn[c] += 8000; M.surface.k6(S, 0.05, 44);
check.ok('K6 erodes the summit before its lower flanks', S.venH[v] < peakBefore && S.toyFz[(W >> 1) + 12] === flankBefore);
check.near('the remaining record volume is the volcanic rock still in the stack', S.venEdV[v], rock(c, P.LITH.lava), 1e-12);
check.ok('erosion moves no solid profile back to the melt account', S.venEdV[v] < stockBefore && ERUPT.mass(v) === 0 && error(start) < 1e-12);
settledCone(); start = ledger(); peakBefore = S.venH[v]; stockBefore = S.venEdV[v];
S.zDyn[c] -= 1000; S.zDyn[c - 1] += 8000; S.zDyn[c - 2] += 9000;
M.surface.k6(S, 0.05, 44);
check.ok('one-hop sediment burial lowers the exposed cone gradually', S.hSed[c] > 0 && S.venH[v] > 0 && S.venH[v] < peakBefore);
check.ok('buried volcanic rock stays in the stack and the volume record', S.venEdV[v] === stockBefore && ERUPT.mass(v) === 0 && error(start) < 1e-12);

settledCone();
var blanket = S.venH[v] + 100, buriedStock = S.venEdV[v];
COL.insertVol(S, c, P.LITH.sed, blanket, 43, P.FLAG.wet);
S.ledProd[P.LITH.sed] += blanket * S.colW[c]; COL.sums(c);
ERUPT.bury(c, blanket); MAG.venDeath(S, v, 44); start = ledger();
check.ok('complete burial hides a dormant shape without deleting its written stock',
	S.venH[v] === 0 && S.venW[v] === 0 && S.venEdV[v] === buriedStock && S.venEdCol[v] === c);
COL.removeTop(c, blanket + buriedStock / S.colW[c]);
for (k = 0; k < P.LITH.n; k++) S.ledCons[k] += COL.removedLi[k] * S.colW[c];
COL.sums(c); S.venEdCol[v] = -1; // the written rock / owner are gone, as on K4 consumption
P.sl.erupt = 0; MAG.k7(S, 0, 44, SIM.Tm);
check.ok('an invalid zero-height edifice clears stale stock without consuming it twice',
	S.venEdV[v] === 0 && S.venLost === 0 && error(start) < 1e-12);

check.section('M2.9 periodic clipping and 16 active domains');
F.fresh(0); F.vent(0, 0, 0.1); F.molten(0, 12, P.LITH.lava);
ERUPT.freeze(W >> 1); ERUPT.writeBack(0, 42); ERUPT.record(0);
GEO.lookAt(P.winW * 0.5); var left = capture();
GEO.lookAt(-P.winW * 0.5); var right = capture();
check.ok('a cone straddling either canvas edge is still drawn with finite coordinates', left.fills.length > 0 && right.fills.length > 0 && left.finite && right.finite);
GEO.setZoomX(P.zoomMin); var laps = capture();
check.ok('a view wider than one lap draws the periodic copies', laps.fills.length > 2 && laps.finite);
F.active16(); var many = capture();
check.ok('all 16 domains draw their own cones and packet FX', many.fills.length >= 16 && many.arcs === 16 && many.finite && many.depth === 0);

check.section('M2.10 active write-back checkpoint and bitwise resume at two zooms');
F.fresh(c); F.vent(c, v, 0.5); F.molten(v, 8, P.LITH.lava); F.packet(v, 2);
MAG.add(S, c, P.VchM2, false); P.sl.erupt = 30;
MAG.k7(S, 0, SIM.t, SIM.Tm); SIM.setGeo(0);
var saved = CP.save();
check.ok('the checkpoint includes hot ash / molten lava, airborne packets and edifice ownership', CP.VERSION === 7 && S.prN[v] > 0 && ERUPT.mass(v) > 0 && S.venEdCol[v] === c);
SIM.run(1000); var forward = CP.save();
CP.load(saved); GEO.setPreset('cru'); SIM.run(1000);
check.ok('active eruption resumes bitwise at a different zoom (1000 frames)', Buffer.from(forward).equals(Buffer.from(CP.save())));
CP.load(saved); GEO.setPreset('def'); SIM.run(1000);
check.ok('same seed / feed / zoom reproduces the same full checkpoint', Buffer.from(forward).equals(Buffer.from(CP.save())));

check.done();
