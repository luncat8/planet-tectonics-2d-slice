// pt-p3-flight.js — 0.3.0 P3.4: conserved flight, landing, cooling and welding
// (0.3.0-p3-plan.md §2, §4 P3.4).
//
// This gate fixes the two-clock boundary with closed-form fixtures before exercising the live
// pipeline: vent supply and cooling use Myr, a ballistic arc uses bounded wall seconds, landing
// changes one parcel's phase, and compatible deposits may merge without changing inventory.
// Run: node experiments/pt-p3-flight.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var POOL = require(B + 'pool.js'), PHASE = require(B + 'phase.js');
var SC = require(B + 'solid.js'), VENT = require(B + 'vent.js'), FLIGHT = require(B + 'flight.js');

var t0 = Date.now(), M;

function configure() {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4; P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1; P.meltHold = 0.1; P.vMelt = 60;
	P.yCham = 40; P.chJoin = 250; P.chSpan = 230; P.chCap = 64;
	P.kVent = 0.5; P.kBlast = 2; P.wBlast = 0.01; P.vCap = 4000;
	P.emitEff = 1000; P.emitBlast = 4000;
	P.flightFrame = 1 / 60; P.flightDtMax = 0.05; P.flightG = 40;
	P.flightVyEff = 18; P.flightVyBlast = 30; P.flightVxEff = 30; P.flightVxBlast = 80;
	P.flightLift = 0.05; P.depositCoolT = 0; P.depositCoolTau = 0.1;
	P.depositCoolDepth = 30; P.depositMerge = 40; P.mergeCompF = 0.02; P.mergeCompW = 0.002;
	SIM.init(); SIM.reset(); SIM.dt = 0.05;
	return SIM.M;
}

function vent(k, style, m, h, melt, felsic, water) {
	S.chN = Math.max(S.chN, k + 1);
	S.chX[k] = 4000 + 500 * k; S.chY[k] = P.yCham;
	S.vState[k] = VENT.OPEN; S.vStyle[k] = style;
	S.vM[k] = m; S.vH[k] = m * h; S.vL[k] = m * melt;
	S.vF[k] = m * felsic; S.vW[k] = m * water;
}

function inv() {
	POOL.inventoryComp(S);
	return { m: S.invMTot, h: S.invHTot, l: S.invLTot, f: S.invFTot, w: S.invWTot };
}

function sumPhase(ph) {
	var p, out = 0;
	for (p = 0; p < S.n; p++) if (S.ph[p] === ph) out += S.m[p];
	return out;
}

function flyToLand(p, dt) {
	var frames = 0, peak = -S.y[p];
	while (p < S.n && S.ph[p] === P.PH.air && frames < 1000) {
		FLIGHT.advance(M, S, dt);
		if (p < S.n && -S.y[p] > peak) peak = -S.y[p];
		frames++;
	}
	return { frames: frames, seconds: frames * dt, peak: peak };
}

// ---------------------------------------------------------------- 1. vent -> air
check.section('1. vent stock becomes one conserved airborne batch on geological time');
M = configure();
vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0.005);
var a0 = inv(), emit0 = S.tx.emit, p = FLIGHT.launch(M, S, 0, 0.05), a1 = inv();
check.ok('the effusive rate emits min(stock, emitEff * dt)', p >= 0 && S.m[p] === 50 && S.vM[0] === 50,
	'air ' + (p >= 0 ? S.m[p] : -1) + '   vent ' + S.vM[0]);
check.ok('the admitted parcel is airborne and starts above its local horizon',
	S.ph[p] === P.PH.air && S.y[p] < FLIGHT.surfaceY(M, S, S.x[p]),
	'phase ' + S.ph[p] + '   y ' + S.y[p].toFixed(3));
check.near('mass closes over vent -> air', a1.m, a0.m, 1e-14, 'km2');
check.near('enthalpy closes', a1.h, a0.h, 1e-14, 'km2*H');
check.near('melt closes', a1.l, a0.l, 1e-14, 'km2');
check.near('felsic material closes', a1.f, a0.f, 1e-14, 'km2');
check.near('water closes', a1.w, a0.w, 1e-14, 'km2');
check.ok('the flight debit and credit match exactly', S.thr.airDr === S.thr.airCr
	&& S.thr.airCr === 50 && S.tx.emit === emit0 + 1,
	S.thr.airDr + '/' + S.thr.airCr + ' in ' + S.tx.emit + ' emissions');
var hash0 = S.hash();
check.ok('zero geological time emits nothing', FLIGHT.launch(M, S, 0, 0) === -1 && S.hash() === hash0);
M = configure(); vent(0, VENT.EXPLOSIVE, 300, 1.2, 1, 0.1, 0.03);
p = FLIGHT.launch(M, S, 0, 0.05);
check.ok('the explosive schedule uses its own geological transfer rate', S.m[p] === 200 && S.vM[0] === 100,
	'air ' + S.m[p] + '   vent ' + S.vM[0]);
M = configure(); vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
S.n = P.partCap;
var vBefore = S.vM[0], refuse = S.tx.refuse;
check.ok('a full pool leaves the material staged in its vent',
	FLIGHT.launch(M, S, 0, 0.05) === -1 && S.vM[0] === vBefore && S.tx.refuse === refuse + 1,
	'vent ' + S.vM[0] + '   refusals ' + S.tx.refuse);

// ---------------------------------------------------------------- 2. the wall clock
check.section('2. ballistic motion uses bounded wall time, not the geology slider');
M = configure(); vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
p = FLIGHT.launch(M, S, 0, 0.05);
var x0 = S.x[p], y0 = S.y[p], vx0 = S.vx[p], vy0 = S.vy[p], dw = 0.02;
FLIGHT.advance(M, S, dw);
var xWant = x0 + vx0 * dw; xWant -= Math.floor(xWant / M.wrap) * M.wrap;
check.near('x follows constant wall-speed motion', S.x[p], xWant, 1e-12, 'km');
check.near('y follows the closed-form constant-gravity arc', S.y[p], y0 + vy0 * dw + 0.5 * P.flightG * dw * dw, 1e-12, 'km');
check.near('and vy gains gravity times wall dt', S.vy[p], vy0 + P.flightG * dw, 1e-12, 'km/s');
function afterLong(dt, kyr) {
	M = configure(); P.sl.kyr = kyr; vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
	var q = FLIGHT.launch(M, S, 0, 0.05);
	FLIGHT.advance(M, S, dt);
	return [S.x[q], S.y[q], S.vx[q], S.vy[q]];
}
var capped = afterLong(10, 5), exact = afterLong(P.flightDtMax, 500), capOK = true;
for (var ci = 0; ci < capped.length; ci++) if (capped[ci] !== exact[ci]) capOK = false;
check.ok('a suspended-tab interval is capped at flightDtMax', capOK,
	'y ' + capped[1].toFixed(6) + '/' + exact[1].toFixed(6));
var slow = afterLong(0.03, 5), fast = afterLong(0.03, 500), sliderOK = true;
for (ci = 0; ci < slow.length; ci++) if (slow[ci] !== fast[ci]) sliderOK = false;
check.ok('the same wall interval gives the same flight at both geology-slider extremes', sliderOK);
M = configure(); vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
p = FLIGHT.launch(M, S, 0, 0.05);
var eff = flyToLand(p, 1 / 120);
check.ok('an effusive clast stays legible for the calibrated sub-second arc',
	eff.seconds > 0.75 && eff.seconds < 1.1 && eff.peak > 3 && eff.peak < 5,
	eff.seconds.toFixed(3) + ' s, peak ' + eff.peak.toFixed(2) + ' km');
M = configure(); vent(0, VENT.EXPLOSIVE, 300, 1.2, 1, 0.1, 0.03);
p = FLIGHT.launch(M, S, 0, 0.05);
var blast = flyToLand(p, 1 / 120);
check.ok('an explosive clast has the taller, longer calibrated arc',
	blast.seconds > 1.25 && blast.seconds < 1.7 && blast.peak > 8 && blast.peak < 14,
	blast.seconds.toFixed(3) + ' s, peak ' + blast.peak.toFixed(2) + ' km');
M = configure(); vent(0, VENT.EFFUSIVE, 7500, 1.2, 1, 0.1, 0);
var firstAir = -1, lastAir = -1;
for (var ff = 0; ff < 300; ff++) {
	FLIGHT.run(M, S, 0.05, 1 / 60);
	if (FLIGHT.count(S, P.PH.air) > 0) { if (firstAir < 0) firstAir = ff; lastAir = ff; }
}
var fountainSeconds = (lastAir - firstAir + 1) / 60;
check.ok('a continuously supplied fountain remains legible for the planned 2-4 seconds',
	fountainSeconds >= 2 && fountainSeconds <= 4,
	fountainSeconds.toFixed(2) + ' s from first airborne batch through the last arc');
M = configure(); vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
p = FLIGHT.launch(M, S, 0, 0.05);
var tPause = SIM.t, yp = S.y[p];
SIM.wall(0.05);
check.ok('a UI-pause wall step moves flight without advancing geology', SIM.t === tPause && S.y[p] !== yp,
	't ' + SIM.t + '   dy ' + (S.y[p] - yp).toFixed(3));

// ---------------------------------------------------------------- 3. landing and merge
check.section('3. landing returns the same material to one deposit parcel');
M = configure();
S.zh.fill(3);                                  // a physical 3 km plateau, drawn at 6 km by default
vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
p = FLIGHT.launch(M, S, 0, 0.05);
var nAir = S.n, landedMass = S.m[p];
var arc = flyToLand(p, 1 / 120);
check.ok('the clast lands as a young, bond-free deposit', S.ph[p] === P.PH.dep
	&& S.age[p] === 0 && S.mu[p] === 0 && S.dmg[p] === 0,
	'phase ' + S.ph[p] + '   age ' + S.age[p]);
check.near('it lands on the physical (unexaggerated) terrain horizon', S.y[p],
	FLIGHT.surfaceY(M, S, S.x[p]), 1e-12, 'km');
check.ok('collision does not use the renderer\'s relief exaggeration',
	S.y[p] === -3 && S.y[p] !== -P.kRelief * 3, 'landed y ' + S.y[p] + ' km');
check.ok('landing changes phase without making a renderer-only copy', S.n === nAir && S.m[p] === landedMass,
	'n ' + S.n + '   mass ' + S.m[p]);
check.ok('landing debit and credit match exactly', S.thr.landDr === S.thr.landCr
	&& S.thr.landCr === landedMass && S.tx.land === 1,
	S.thr.landDr + '/' + S.thr.landCr);
M = configure();
var d = POOL.admit(S, P.PH.dep);
S.x[d] = 4000; S.y[d] = 0; S.e[d] = 0; S.m[d] = 10; S.H[d] = 1.2; S.T[d] = 0.95;
S.melt[d] = 1; S.cF[d] = 0.1; S.cW[d] = 0;
vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
var merge0 = S.tx.merge, n0 = S.n, oldRadius = P.depositMerge;
P.depositMerge = M.wrap;
p = FLIGHT.launch(M, S, 0, 0.05); flyToLand(p, 1 / 120); P.depositMerge = oldRadius;
check.ok('a compatible landing coalesces through the pool merge, once',
	S.tx.merge === merge0 + 1 && S.n === n0, 'merge ' + S.tx.merge + '   n ' + S.n);
check.near('the coalesced deposit carries both masses', sumPhase(P.PH.dep), 60, 1e-12, 'km2');
M = configure();
var a = POOL.admit(S, P.PH.dep), b = POOL.admit(S, P.PH.dep);
S.m[a] = S.m[b] = 1; S.cF[a] = 0; S.cF[b] = P.mergeCompF + 0.01;
S.cW[a] = S.cW[b] = 0;
var ref = S.tx.refuse;
check.ok('incompatible deposit compositions remain separate',
	POOL.merge(M, S, a, b) === -1 && S.n === P.partBase + 2 && S.tx.refuse === ref + 1);

// ---------------------------------------------------------------- 4. cooling
check.section('4. landed lava cools on geological time and closes the heat books');
M = configure(); vent(0, VENT.EFFUSIVE, 100, 1.2, 1, 0.1, 0);
p = FLIGHT.launch(M, S, 0, 0.05); flyToLand(p, 1 / 120);
var c0 = inv(), hLed0 = S.hLedger, led0 = S.ledger, wall0 = S.wall, hHot = S.H[p];
for (var c = 0; c < 12; c++) FLIGHT.cool(M, S, 0.05);
var c1 = inv();
check.ok('the surface exchange cools and crystallises the deposit',
	S.H[p] < hHot && S.T[p] < P.TLock && S.melt[p] < P.meltHold,
	'H ' + hHot.toFixed(3) + ' -> ' + S.H[p].toFixed(3) + '   melt ' + S.melt[p].toFixed(3));
check.near('the inventory enthalpy change is the booked surface-wall flux to the global gate',
	c1.h - c0.h, S.hLedger - hLed0, 1e-9, 'km2*H');
check.ok('the operator-side wall book carries the same exchange',
	S.wall - wall0 === S.hLedger - hLed0, (S.wall - wall0).toFixed(6));
check.ok('sensible plus latent cooling is the same enthalpy change',
	Math.abs((S.hLedger - hLed0) - (S.ledger - led0)
		- P.meltLat * (c1.l - c0.l)) < 1e-10,
	'residual ' + ((S.hLedger - hLed0) - (S.ledger - led0) - P.meltLat * (c1.l - c0.l)).toExponential(2));
var phaseBefore = S.ph[p], chBefore = S.chN;
require(B + 'melt.js').run(M, S, 0.05);
check.ok('cooled ejecta stays a deposit instead of recycling into its source chamber',
	S.ph[p] === phaseBefore && S.chN === chBefore, 'phase ' + S.ph[p] + '   chambers ' + S.chN);
var coolHash = S.hash(); FLIGHT.cool(M, S, 0);
check.ok('zero geological time does not cool a deposit', S.hash() === coolHash);
S.H[p] = -0.1; S.T[p] = -0.1; S.melt[p] = 0;
var coldH = S.H[p], coldBook = S.hLedger;
FLIGHT.cool(M, S, 0.05);
check.ok('surface exchange also restores an overcooled deposit toward ambient',
	S.H[p] > coldH && S.H[p] < P.depositCoolT,
	'H ' + coldH.toFixed(3) + ' -> ' + S.H[p].toFixed(3));
check.near('that restoring heat is booked by the same wall transaction',
	S.hLedger - coldBook, S.m[p] * (S.H[p] - coldH), 1e-12, 'km2*H');

// ---------------------------------------------------------------- 5. welding
check.section('5. a landed deposit joins the local plate by tauWeld');
M = configure();
S.n = 3; S.chN = 0;
for (var w = 0; w < 3; w++) {
	S.x[w] = 1000 + 20 * w; S.y[w] = M.yN[1]; S.e[w] = M.dEta;
	S.m[w] = 100; S.vx[w] = 0; S.vy[w] = 0; S.T[w] = 0.05; S.H[w] = 0.05;
	S.cF[w] = 0; S.cW[w] = 0; S.melt[w] = 0; S.age[w] = w < 2 ? P.tauWeld : 0;
	S.mu[w] = 0; S.dmg[w] = 0; S.id[w] = w; S.ph[w] = w < 2 ? P.PH.mantle : P.PH.dep;
}
var oldSlab = P.kSlab, oldPush = P.kPush; P.kSlab = 0; P.kPush = 0;
SC.crust(M, S, P.tauWeld); P.kSlab = oldSlab; P.kPush = oldPush;
check.ok('after tauWeld the deposit is strong enough to bond',
	S.age[2] === P.tauWeld && S.mu[2] >= P.clusterMin,
	'age ' + S.age[2] + '   mu ' + S.mu[2].toFixed(3));
check.ok('and belongs to the same cluster as the cold substrate',
	S.cl[2] >= 0 && S.cl[2] === S.cl[0] && S.cl[2] === S.cl[1],
	'clusters ' + S.cl[0] + '/' + S.cl[1] + '/' + S.cl[2]);

// ---------------------------------------------------------------- 6. shipped pipeline
check.section('6. the shipped geometry opens and completes the material path');
M = configure();
var live0 = inv(), liveH0 = S.hLedger, first = -1, peakAir = 0, peakN = S.n;
for (var frame = 0; frame < 400; frame++) {
	SIM.step();
	if (first < 0 && S.tx.emit > 0) first = SIM.t;
	if (S.invN[P.PH.air] > peakAir) peakAir = S.invN[P.PH.air];
	if (S.n > peakN) peakN = S.n;
}
var live1 = inv();
var entRes = ((live1.h - live0.h) - (S.hLedger - liveH0)) / Math.abs(live0.h);
check.ok('the default lower-crustal geometry opens a conduit in the demonstration run',
	first > 0 && first < 10 && S.tx.vent > 0,
	'first ejecta ' + first.toFixed(2) + ' Myr   drains ' + S.tx.vent);
check.ok('vent stock reaches flight and the terrain', S.tx.emit > 0 && S.tx.land > 0
	&& peakAir > 0 && S.invN[P.PH.dep] > 0,
	'emit ' + S.tx.emit + '   land ' + S.tx.land + '   air peak ' + peakAir + '   deposits ' + S.invN[P.PH.dep]);
check.near('the live global mass inventory closes', live1.m, live0.m, 1e-12, 'km2');
check.ok('the live enthalpy inventory closes against conduction plus surface cooling',
	Math.abs(entRes) < 1e-9, 'relative residual ' + entRes.toExponential(2));
check.ok('every transfer pair matches', S.thr.ventDr === S.thr.ventCr
	&& S.thr.airDr === S.thr.airCr && S.thr.landDr === S.thr.landCr,
	'vent ' + S.thr.ventDr.toFixed(1) + ' air ' + S.thr.airDr.toFixed(1) + ' land ' + S.thr.landDr.toFixed(1));
check.near('drained chamber mass is either in a vent or credited to flight',
	S.thr.ventCr, S.invVM + S.thr.airDr, 1e-12, 'km2');
check.near('emitted mass is either airborne or debited by landing',
	S.thr.airCr, sumPhase(P.PH.air) + S.thr.landDr, 1e-12, 'km2');
check.near('landed mass is the current deposit stock despite coalescence',
	S.thr.landCr, sumPhase(P.PH.dep), 1e-12, 'km2');
check.ok('the shared reserve holds the active eruption without a dropped transfer',
	peakN < P.partCap && S.tx.refuse === 0,
	'peak ' + peakN + '/' + P.partCap + '   refusals ' + S.tx.refuse);
check.ok('the latent identity survives flight, landing and cooling',
	Math.abs((S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0)) < 1e-8,
	'residual ' + ((S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0)).toExponential(2));
check.info('the default eruption census at 20 Myr', S.chN + ' chambers, ' + S.tx.vent
	+ ' drains, ' + S.tx.emit + ' batches, ' + S.tx.land + ' landings, ' + S.tx.merge
	+ ' deposit merges, ' + VENT.count(S, VENT.BLOCKED) + ' blocked');

// ---------------------------------------------------------------- 7. replay
check.section('7. a fixed geological and wall-time sequence replays exactly');
function replay(wall) {
	M = configure(); vent(0, VENT.EXPLOSIVE, 1000, 1.2, 1, 0.1, 0.03);
	for (var r = 0; r < 90; r++) {
		FLIGHT.cool(M, S, 0.01);
		FLIGHT.run(M, S, r < 12 ? 0.01 : 0, wall[r % wall.length]);
	}
	POOL.inventory(S);
	return S.hash();
}
var seq = [0.01, 0.02, 0.015, 0.018], replayA = replay(seq), replayB = replay(seq);
check.ok('the same wall sequence has the same complete-state fingerprint', replayA === replayB,
	'hash ' + replayA + '/' + replayB);
var replayC = replay([0.005, 0.005, 0.005, 0.005]);
check.ok('a different wall sequence is state, not hidden nondeterminism', replayC !== replayA,
	'hash ' + replayA + '/' + replayC);

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
