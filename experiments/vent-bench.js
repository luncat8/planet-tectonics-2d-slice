// vent-bench.js — 0.2.0 M1: the vent lifecycle and the second clock, headless. A vent is
// born where a chamber reaches Vbirth, its chamber meters what the schedule may draw, the
// toy consumes exactly the scheduled flux, the gas/pressure split decides blast or effusive,
// a vent dies after tauVent with an empty chamber (or books its residual when its column is
// consumed), and the two clocks never hand the toy mass it was not given. Run:
// node experiments/vent-bench.js
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, MAG = L.mods.magma, ERUPT = L.mods.erupt;
var SIM = L.mods.sim;

function fresh() {
	S.reset();
	P.sl.geo = 50e3;
	P.sl.erupt = 1800;
}

// a vent on column c in slot v, as the birth would leave it (chamber still on the column)
function giveVent(c, v) {
	S.volc[c] = v;
	S.venCol[v] = c;
	S.venX[v] = S.colX[c];
	S.venW[v] = 0;
	S.venH[v] = 0;
	S.venStyle[v] = 0;
	S.venGas[v] = 0.1;
	S.venV[v] = 0;
	S.venIdle[v] = 0;
	S.venFlux[v] = 0;
	S.venBlast[v] = 0;
	ERUPT.reset(v);
	if (v >= S.nVen) S.nVen = v + 1;
}

function boxM2(v) { return ERUPT.mass(v) * P.toyCellM2; }

// every melt reservoir the vent system owns, in m2: column chambers, vent chambers, boxes
function meltM2() {
	var m = 0, i, b, x;
	for (i = 0; i < S.nCol; i++) m += S.colChamber[i];
	for (i = 0; i < S.nVen; i++) {
		m += S.venV[i];
		b = i * P.ventBoxW;
		for (x = 0; x < P.ventBoxW; x++) m += S.toyH[b + x] * P.toyCellM2;
		b = i * P.partCap;
		for (x = 0; x < S.prN[i]; x++) m += S.prL[b + x] * P.toyCellM2;
	}
	return m;
}

function alive() {
	var n = 0, v;
	for (v = 0; v < S.nVen; v++) if (S.venCol[v] >= 0) n++;
	return n;
}

check.section('M1.1 birth: a chamber at Vbirth opens a vent on its column');
fresh();
P.sl.erupt = 0;
S.colChamber[250] = P.VbirthM2;
S.colChamber[251] = 0.9 * P.VbirthM2;
MAG.k7(S, 0.05, 0, 1);
check.ok('a chamber at Vbirth births a vent on its column',
	S.nVen === 1 && S.venCol[0] === 250 && S.volc[250] === 0,
	'nVen ' + S.nVen + ' venCol ' + S.venCol[0] + ' volc ' + S.volc[250]);
check.ok('a chamber just below Vbirth waits', S.volc[251] === -1);
check.ok('the column chamber feeds the vent chamber (Vbirth under Vch)',
	S.venV[0] === P.VbirthM2 && S.colChamber[250] === 0,
	'venV ' + S.venV[0] + ' colChamber ' + S.colChamber[250]);
check.ok('the new vent holds no toy mass', ERUPT.mass(0) === 0 && S.prN[0] === 0);

check.section('M1.2 placement and style: arc front, plume shield, LIP fissure, strato');
fresh();
P.sl.erupt = 0;
S.colChamber[10] = P.VbirthM2; S.trenchDist[10] = 2; S.colRecycle[10] = 1;
MAG.k7(S, 0.05, 0, 1);
check.ok('an arc factory column births an arc-style vent', S.venStyle[0] === 3,
	'style ' + S.venStyle[0]);
check.ok('the gas fraction is fixed at birth from the style', S.venGas[0] === P.venGas0[3],
	'gas ' + S.venGas[0]);
fresh();
P.sl.erupt = 0;
S.nPlm = 1; S.plmArrive[0] = 1; S.plmStr[0] = 1; S.plmX[0] = S.colX[20]; S.plmR[0] = 300e3;
S.colChamber[20] = P.VbirthM2;
S.colChamber[22] = P.VbirthM2;
MAG.k7(S, 0.05, 0, 1);
check.ok('a plume\'s own column births a shield', S.venStyle[0] === 1 && S.venCol[0] === 20,
	'col ' + S.venCol[0] + ' style ' + S.venStyle[0]);
check.ok('the plume province births a fissure vent', S.venStyle[1] === 2 && S.venCol[1] === 22,
	'col ' + S.venCol[1] + ' style ' + S.venStyle[1]);
fresh();
P.sl.erupt = 0;
S.colChamber[30] = P.VbirthM2;
MAG.k7(S, 0.05, 0, 1);
check.ok('any other charged column births strato', S.venStyle[0] === 0 && S.venGas[0] === P.venGas0[0]);

check.section('M1.3 schedule: a prescribed full chamber starts and stops an eruption');
fresh();
giveVent(100, 0);
S.venGas[0] = 0.1;
S.venV[0] = P.VchM2;
var m0 = meltM2(), f, honest = true, started = false, frames = 0, pv, pb, drain, got;
for (f = 0; f < 10; f++) {
	pv = S.venV[0]; pb = ERUPT.mass(0);
	MAG.k7(S, 0.05, 0, 1);
	drain = pv - S.venV[0];
	got = ERUPT.mass(0) - pb;
	if (f === 0 && S.venFlux[0] > 0) started = true;
	if (S.venFlux[0] > 0) frames++;
	if (Math.abs(drain - got * P.toyCellM2) > 1e-9 * Math.max(1, drain)) honest = false;
}
check.ok('the eruption starts on the first frame', started);
check.ok('the eruption stops once the chamber is empty', S.venFlux[0] === 0 && S.venV[0] === 0,
	'flux ' + S.venFlux[0] + ' venV ' + S.venV[0]);
check.ok('chamber out = toy in on every frame (rel <= 1e-9)', honest);
check.ok('chamber + box is conserved over the episode (rel <= 1e-12)',
	Math.abs(meltM2() - m0) / m0 < 1e-12, 'rel ' + (Math.abs(meltM2() - m0) / m0).toExponential(2));
check.ok('S.mass() sees chamber, vent and box melt alike',
	Math.abs(S.mass()[P.LITH.maf] - meltM2()) / m0 < 1e-12);
check.info('full-chamber drain', frames + ' frames of ' + P.sl.erupt + ' s = ' +
	(frames * P.sl.erupt / 3600).toFixed(2) + ' h eruptive, box holds ' + boxM2(0).toExponential(3) + ' m2');

check.section('M1.4 an empty chamber idles the toy');
fresh();
giveVent(100, 0);
var before = S.hash();
MAG.k7(S, 0, 0, 1);
check.ok('zero chamber, running toy clock: nothing moves at all', S.hash() === before);
MAG.k7(S, 0.05, 0, 1);
check.ok('zero chamber over Myr: the box stays empty and the vent idles toward death',
	ERUPT.mass(0) === 0 && S.prN[0] === 0 && S.venFlux[0] === 0 && S.venIdle[0] > 0);

check.section('M1.5 gas and pressure decide the feed character (design §5.2)');
function firstDrain(gas, v0) {
	fresh();
	P.sl.erupt = 1800;
	giveVent(100, 0);
	S.venGas[0] = gas;
	S.venV[0] = v0;
	var d = { v: v0 };
	MAG.k7(S, 0, 0, 1);
	d.drain = v0 - S.venV[0];
	d.blast = S.venBlast[0];
	d.flux = S.venFlux[0];
	return d;
}
var blast = firstDrain(0.5, P.VchM2);
var fallback = firstDrain(0.5, 0.1 * P.VbirthM2);
var effusive = firstDrain(0.1, P.VchM2);
check.ok('gas above gasBlast at P > 1.3 P0 is a gas blast',
	blast.blast === 1 && blast.flux > 0, 'blast ' + blast.blast + ' flux ' + blast.flux);
check.ok('gas above gasBlast below 1.3 P0 falls back to effusive (so the drain reaches empty)',
	fallback.blast === 0 && fallback.flux > 0, 'blast ' + fallback.blast + ' flux ' + fallback.flux);
check.ok('gas below gasBlast is effusive at any pressure',
	effusive.blast === 0 && effusive.flux > 0, 'blast ' + effusive.blast);
check.near('the blast drains by gas and the effusive drain by (1-gas)',
	blast.drain / effusive.drain, 0.5 / 0.9, 0.01);

check.section('M1.6 death: tauVent of an empty chamber, and the pile guard');
fresh();
P.sl.erupt = 0;
giveVent(100, 0);
S.venV[0] = 0.5 * P.VdieM2;
for (f = 0; f < 40; f++) MAG.k7(S, 0.05, 0, 1);
check.ok('below Vdie for tauVent (2 Myr) the vent dies and the slot frees',
	S.venCol[0] === -1 && S.volc[100] === -1 && alive() === 0,
	'after ' + 40 * 0.05 + ' Myr, venIdle ' + S.venIdle[0]);
check.ok('the last dribble goes home to the column chamber (nothing dropped)',
	S.colChamber[100] === 0.5 * P.VdieM2, 'chamber ' + S.colChamber[100]);
S.colChamber[100] = P.VbirthM2;
MAG.k7(S, 0.05, 0, 1);
check.ok('the dead slot is reused by the next birth', S.venCol[0] === 100 && S.nVen === 1 && S.volc[100] === 0);
fresh();
P.sl.erupt = 0;
giveVent(100, 0);
S.toyH[24] = 3; // a pile still waiting for write-back (0.2.0 M2)
for (f = 0; f < 60; f++) MAG.k7(S, 0.05, 0, 1);
check.ok('a vent with an unwritten-back pile stays alive (a dead vent may leak no state)',
	S.venCol[0] === 100, 'after 3 Myr');

check.section('M1.7 a consumed vent books its residual');
fresh();
P.sl.erupt = 0;
giveVent(100, 0);
S.venV[0] = 1e3;
S.toyH[24] = 2;
var want = 1e3 + 2 * P.toyCellM2;
S.venCol[0] = -1; // what columns.js leaves behind when the column is consumed
var cons0 = S.ledCons[P.LITH.maf];
MAG.k7(S, 0.05, 0, 1);
check.ok('the residual is booked to the named line and the consume side',
	Math.abs(S.venLost - want) / want < 1e-12 && S.ledCons[P.LITH.maf] === cons0 + want,
	'lost ' + S.venLost.toExponential(3) + ' want ' + want.toExponential(3));
check.ok('the orphan slot is freed', S.venCol[0] === -1 && S.venV[0] === 0 && ERUPT.mass(0) === 0);

check.section('M1.8 the two clocks stop fighting');
fresh();
P.sl.erupt = 0;
giveVent(100, 0);
S.colChamber[100] = 2 * P.VchM2;
for (f = 0; f < 4; f++) MAG.k7(S, 0.05, 0, 1);
check.ok('eruptive pause: the chamber fills to Vch and the toy never moves',
	S.venV[0] === P.VchM2 && S.colChamber[100] === P.VchM2 && ERUPT.mass(0) === 0 && S.venFlux[0] === 0,
	'venV ' + S.venV[0] + ' box ' + ERUPT.mass(0));
fresh();
P.sl.erupt = 1800;
giveVent(100, 0);
S.venV[0] = P.VchM2;
S.colChamber[200] = 2 * P.VbirthM2;
pv = S.venV[0];
MAG.k7(S, 0, 0, 1);
check.ok('paused geology: the toy runs and no vent is born',
	S.venV[0] < pv && ERUPT.mass(0) > 0 && S.nVen === 1 && S.volc[200] === -1,
	'left ' + S.venV[0].toExponential(3) + ' m2 in the chamber');
fresh();
P.sl.erupt = 1800;
for (f = 0; f < P.maxVents; f++) giveVent(100 + f, f);
S.colChamber[300] = P.VbirthM2;
S.colMeltPlume[300] = 1234;
MAG.k7(S, 0.2, 0, 1);
check.ok('the vent list never exceeds maxVents', S.nVen === P.maxVents && alive() === P.maxVents);
check.ok('a full vent list idles the magma in its chamber and counts the wait',
	S.meltIdle === 1234 && S.colChamber[300] === P.VbirthM2 && S.volc[300] === -1,
	'meltIdle ' + S.meltIdle + ' chamber ' + S.colChamber[300]);
S.colChamber[300] = P.chamberCap + 5e6;
var sill0 = S.meltSill, prod0 = S.ledProd[P.LITH.maf], prodS = S.ledProd[P.LITH.sill];
MAG.k1(S, 0.2, 0, 1.6);
check.ok('an over-full chamber builds sills (the existing spill path, not a 17th vent)',
	S.meltSill === sill0 + 5e6 && S.colChamber[300] === P.chamberCap &&
	S.ledProd[P.LITH.maf] === prod0 - 5e6 && S.ledProd[P.LITH.sill] === prodS + 5e6 && S.volc[300] === -1,
	'sill ' + S.meltSill.toExponential(3));
fresh();
P.sl.erupt = 1800;
giveVent(100, 0);
S.venGas[0] = 0.5;
var honest2 = true, gave, mGive;
for (f = 0; f < 60; f++) {
	S.colChamber[100] += 2e4; // fast geology feeding while the toy drains on its own clock
	var chB = S.colChamber[100], vB = S.venV[0], bB = ERUPT.mass(0);
	MAG.k7(S, 0.2, 0, 1);
	gave = (vB - S.venV[0]) + (chB - S.colChamber[100]);
	mGive = (ERUPT.mass(0) - bB) * P.toyCellM2;
	if (mGive < -1e-9 || Math.abs(gave - mGive) > 1e-9 * Math.max(1, mGive)) honest2 = false;
}
check.ok('no frame gives the toy mass the chamber system did not (60 mixed-clock frames)', honest2);

check.section('M1.9 determinism');
function run() {
	fresh();
	P.sl.erupt = 1800;
	giveVent(100, 0);
	S.venGas[0] = 0.5;
	S.colChamber[100] = 2 * P.VbirthM2;
	for (var k = 0; k < 30; k++) {
		S.colChamber[100] += 1e4;
		MAG.k7(S, 0.05, 0, 1);
	}
	return S.hash();
}
check.ok('same setup, same feed: bitwise-identical state', run() === run());

check.section('M1.10 live run: vents birth from real supply');
check.planet(1, 'def');
P.sl.erupt = 1800;
SIM.setGeo(50e3);
SIM.run(4000); // 200 Myr at 50 kyr/frame
check.info('seed 1 after 200 Myr', 'vent slots ' + S.nVen + ', alive ' + alive() +
	', idle ledger ' + S.meltIdle.toFixed(0) + ' m2, lost ' + S.venLost.toFixed(0) + ' m2');
check.ok('at least one vent births from the engine\'s own supply', S.nVen >= 1, 'nVen ' + S.nVen);

check.done();
