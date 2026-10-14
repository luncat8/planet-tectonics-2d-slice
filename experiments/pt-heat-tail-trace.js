// 0.3.2 M1 latent-book localization: the P3.1 identity residual traced across every kernel
// boundary of the *unchanged* banked 600 Myr seed-5 cell (0.3.2-M0-heat-tail-report.md:
// worst 9.6649e-3 relative at frame 11992, 167.35794 km2*H absolute). Read-only observation:
// no kernel is edited, no candidate runs here -- the trajectory and the fingerprint must
// reproduce the M0 baseline bank exactly, or the trace is measuring a different world.
// node experiments/pt-heat-tail-trace.js [myr=600]
// stdout is pure JSON (bank it); the PASS/FAIL lines go to stderr and into the JSON itself.
'use strict';
var fs = require('fs'), path = require('path');
// stdout stays pure JSON for the bank; the PASS/FAIL lines go to stderr
var stdoutLog = console.log;
console.log = function () { console.error.apply(console, arguments); };
var check = require('./lib.js').check;
var B = path.join(__dirname, '../js/pt/');
var P = require(B + 'params.js'), S = require(B + 'state.js'), G = require(B + 'grid.js');
var SIM = require(B + 'sim.js'), POOL = require(B + 'pool.js'), PHASE = require(B + 'phase.js');
var MT = require(B + 'melt.js'), F = require(B + 'fluid.js'), SC = require(B + 'solid.js');
var SLAB = require(B + 'slab.js'), ARC = require(B + 'arc.js'), VENT = require(B + 'vent.js');
var FLIGHT = require(B + 'flight.js'), ERODE = require(B + 'erode.js');
var bank = JSON.parse(fs.readFileSync(path.join(__dirname, 'logs/0.3.2-tail-baseline-repeat.json'), 'utf8'));

var myr = process.argv[2] === undefined ? 600 : +process.argv[2];
if (!(myr > 0) || !Number.isFinite(myr)) throw new Error('invalid duration');

// ---------------------------------------------------------------- the banked cell, verbatim
P.wrap = 16000; P.depth = 2900; P.yLin = 40;
P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
P.resFrac = P.resMelt + P.resAir + P.resDep;
P.ic = 'cool'; P.flip = 1; P.solid = true;
P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12;
P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
P.sl.kyr = 50; P.seed = 5;
P.contact = true; P.slab = true; P.arc = true; P.ero = true;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M;

// ---------------------------------------------------------------- the fast boundary residual
// The identity is hLedger - ledger = meltLat * (invLTot - invL0). The per-frame gate reads
// invLTot from the compensated inventory; a boundary probe needs the same quantity after
// every kernel call, where a naive sum in the inventory's own order is exact enough to
// attribute jumps of 1e-3..1e2 against its own ~1e-8 noise floor. The compensated reading
// stays the authoritative per-frame metric and must reproduce the bank bit for bit.
function latNaive() {
	var t = 0, p;
	for (p = 0; p < S.n; p++) t += S.m[p] * S.melt[p];
	for (p = 0; p < S.chN; p++) t += S.chL[p] + S.vL[p];
	for (p = 0; p < S.dpN; p++) t += S.dpL[p];
	return t;
}
function residFast() {
	return (S.hLedger - S.ledger) - P.meltLat * (latNaive() - S.invL0);
}

// ---------------------------------------------------------------- boundary attribution table
var NAMES = ['transfer', 'flow', 'move', 'diffuse', 'gatherDT', 'gatherVel', 'advect',
	'equil', 'crust', 'slab', 'arc', 'arc.wedge', 'arc.release', 'melt', 'detach', 'transit',
	'vent', 'cool', 'surface', 'erode', 'erode.move', 'wall', 'flight', 'emit', 'launch',
	'advance', 'land', 'diag'];
var BS = {};
NAMES.forEach(function (name) {
	BS[name] = { calls: 0, sumPos: 0, sumNeg: 0, sumAbs: 0, maxAbs: 0, maxFrame: 0, notable: 0 };
});
var frame = 0, lastR = 0, chainSum = 0;
var jumps = [], JUMP_MIN = 1e-6, JUMP_KEEP = 256;

function probe(name) {
	var r = residFast(), d = r - lastR, a = Math.abs(d), b = BS[name];
	lastR = r; chainSum += d;
	b.calls++;
	if (d > 0) b.sumPos += d; else b.sumNeg += d;
	b.sumAbs += a;
	if (a > b.maxAbs) { b.maxAbs = a; b.maxFrame = frame; }
	if (a > JUMP_MIN) {
		b.notable++;
		if (jumps.length < JUMP_KEEP) jumps.push({ frame: frame, boundary: name, d: d });
		else {
			var lo = 0, i;
			for (i = 1; i < jumps.length; i++) if (Math.abs(jumps[i].d) < Math.abs(jumps[lo].d)) lo = i;
			if (a > Math.abs(jumps[lo].d)) jumps[lo] = { frame: frame, boundary: name, d: d };
		}
	}
	return d;
}

function wrapB(obj, key, name) {
	var fn = obj[key];
	obj[key] = function () {
		var r = fn.apply(this, arguments);
		probe(name);
		return r;
	};
}

// ---------------------------------------------------------------- mechanism instrumentation
// Snapshots: the pool's arrays are fixed after init, so full-length copies need no views.
var snapH = new Float64Array(S.H.length), snapT = new Float64Array(S.T.length);
var snapX = new Float64Array(S.melt.length);
var gatherPhase = [0, 0, 0, 0], sensPhase = [0, 0, 0, 0], latPhase = [0, 0, 0, 0];
var airFreshN = 0, airFreshL = 0, airFlightN = 0, airFlightL = 0, airSens = 0;
var launches = [], fresh = {};

// G3's gather: the intake it books lands in hLedger; per-phase Sum m*dH says where.
var gather0 = G.gatherDT;
G.gatherDT = function (Mx, Sx, inc, Tg, flip) {
	var n = Sx.n, p;
	snapH.set(Sx.H);
	gather0.apply(this, arguments);
	for (p = 0; p < n; p++) gatherPhase[Sx.ph[p]] += Sx.m[p] * (Sx.H[p] - snapH[p]);
	probe('gatherDT');
};

// G4's equilibrium pass: it re-reads (T, melt) from H for the *whole* pool but books the
// sensible change of grid-coupled parcels only. A grid parcel's re-read cancels its gather
// intake exactly (dT + L*dxi = dH on the manifold); a phase no ledger books -- air -- moves
// invLTot with nothing against it. Attribute every melt-fraction step of every air parcel,
// split into the first re-read after launch (the stock fraction snapped to equilibrium) and
// later in-flight re-reads (the clast's own depth moving its solidus).
var equil0 = PHASE.equil;
PHASE.equil = function (Mx, Sx) {
	var n = Sx.n, p, q, dT, dX, l;
	snapT.set(Sx.T); snapX.set(Sx.melt);
	equil0.apply(this, arguments);
	for (p = 0; p < n; p++) {
		q = Sx.ph[p];
		dT = Sx.T[p] - snapT[p];
		dX = Sx.melt[p] - snapX[p];
		if (dT !== 0) sensPhase[q] += Sx.m[p] * dT;
		if (dX !== 0) latPhase[q] += Sx.m[p] * dX;
		if (q !== P.PH.air || dX === 0) continue;
		l = -P.meltLat * Sx.m[p] * dX;
		if (fresh[Sx.id[p]] !== undefined) { airFreshN++; airFreshL += l; delete fresh[Sx.id[p]]; }
		else { airFlightN++; airFlightL += l; }
		airSens += Sx.m[p] * dT;
	}
	probe('equil');
};

// The launch itself conserves latent stock (the vent's dL becomes the parcel's m*xi); what
// it creates is an off-manifold air parcel: T from byH at y = 0 but melt from the stock's
// aggregate fraction. Record the predicted first-snap step for each one.
var launch0 = FLIGHT.launch;
FLIGHT.launch = function (Mx, Sx, k, dt) {
	var p = launch0.apply(this, arguments), rec;
	probe('launch');
	if (p >= 0) {
		PHASE.byH(Sx.H[p], 0, Sx.cF[p], Sx.cW[p]);
		rec = { i: launches.length, frame: frame, vent: k, m: Sx.m[p], H: Sx.H[p], T: Sx.T[p],
			xiStock: Sx.melt[p], xiEq: PHASE.out.melt,
			step: -P.meltLat * Sx.m[p] * (PHASE.out.melt - Sx.melt[p]) };
		launches.push(rec);
		fresh[Sx.id[p]] = rec;
	}
	return p;
};

// A landing ends the air phase: clear the fresh mark (the parcel books from here on).
var land0 = FLIGHT.land;
FLIGHT.land = function (Mx, Sx, p) {
	delete fresh[Sx.id[p]];
	var r = land0.apply(this, arguments);
	probe('land');
	return r;
};

// The G5 detach observer of pt-heat-tail.js verbatim (held-back census and the event bank),
// with the boundary probe attached. Read-only; the pass itself is the production one.
var events = [], heldTime = 0, heldMeltTime = 0, heldSamples = 0;
var heldGap = -Infinity, mantleRoutes = 0, detach0 = MT.detach;
MT.detach = function (Mx, Sx) {
	var p, tg, ts;
	for (p = 0; p < Sx.n; p++) {
		if (Sx.melt[p] < P.meltHold) continue;
		if (Sx.ph[p] === P.PH.mantle) { mantleRoutes++; continue; }
		if (Sx.ph[p] !== P.PH.dep || !Sx.depQ[p] || Sx.y[p] <= P.depositCoolDepth) continue;
		tg = G.sampleAt(Mx, Sx.Tg, Sx.x[p], Sx.e[p]);
		ts = PHASE.solidus(Sx.y[p], Sx.cF[p], Sx.cW[p]);
		if (tg < ts) {
			heldSamples++; heldTime += Sx.m[p] * SIM.dt;
			heldMeltTime += Sx.m[p] * Sx.melt[p] * SIM.dt;
			heldGap = Math.max(heldGap, Sx.T[p] - tg);
			continue;
		}
		events.push({ frame: frame, id: Sx.id[p], x: Sx.x[p], y: Sx.y[p], host: Sx.m[p],
			melt: Sx.m[p] * Sx.melt[p], T: Sx.T[p], field: tg, solidus: ts });
	}
	detach0.apply(this, arguments);
	probe('detach');
};

wrapB(F, 'transfer', 'transfer');
wrapB(F, 'flow', 'flow');
wrapB(F, 'move', 'move');
wrapB(G, 'diffuse', 'diffuse');
wrapB(G, 'gatherVel', 'gatherVel');
wrapB(G, 'advect', 'advect');
wrapB(SC, 'crust', 'crust');
wrapB(SLAB, 'run', 'slab');
wrapB(ARC, 'run', 'arc');
wrapB(ARC, 'wedge', 'arc.wedge');
wrapB(ARC, 'release', 'arc.release');
wrapB(MT, 'run', 'melt');
wrapB(MT, 'transit', 'transit');
wrapB(VENT, 'run', 'vent');
wrapB(FLIGHT, 'cool', 'cool');
wrapB(F, 'surface', 'surface');
wrapB(ERODE, 'run', 'erode');
wrapB(ERODE, 'move', 'erode.move');
wrapB(F, 'wall', 'wall');
wrapB(FLIGHT, 'run', 'flight');
wrapB(FLIGHT, 'emit', 'emit');
wrapB(FLIGHT, 'advance', 'advance');
wrapB(F, 'diag', 'diag');

// ---------------------------------------------------------------- the leg
POOL.inventoryComp(S);
var rStart = residFast();
lastR = rStart;
var m0 = S.invMTot, h0 = S.invHTot, hl0 = S.hLedger, w0 = S.wall;
var mass = 0, enth = 0, wall = 0, latent = 0, latentFrame = 0, latentAbs = 0;
var timeline = [];
var mins = [Infinity, Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity, -Infinity];
var outside = [0, 0, 0, 0], nonfinite = 0;
var frames = Math.round(myr / SIM.dt);
for (frame = 1; frame <= frames; frame++) {
	SIM.step();
	POOL.inventoryComp(S);
	mass = Math.max(mass, Math.abs(S.invMTot - m0) / m0);
	enth = Math.max(enth, Math.abs(S.invHTot - h0 - (S.hLedger - hl0)) / Math.max(1, Math.abs(S.hLedger - hl0)));
	wall = Math.max(wall, Math.abs((S.hLedger - hl0) / (S.wall - w0) - 1));
	var la = Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0));
	var lr = la / Math.max(1, Math.abs(S.hLedger - S.ledger));
	if (lr > latent) { latent = lr; latentFrame = frame; latentAbs = la; }
	timeline.push(la);
	for (var p = 0; p < S.n; p++) {
		var ph = S.ph[p], T = S.T[p];
		if (!Number.isFinite(T)) { nonfinite++; continue; }
		mins[ph] = Math.min(mins[ph], T); maxs[ph] = Math.max(maxs[ph], T);
		if (T < -0.5 || T > 1.5) outside[ph]++;
	}
}
var drift = lastR - rStart;
var launchPredicted = 0, launchMass = 0, launchSnapped = 0, launchWorst = 0, i;
for (i = 0; i < launches.length; i++) {
	launchPredicted += launches[i].step;
	launchMass += launches[i].m;
	if (launches[i].xiEq !== launches[i].xiStock) launchSnapped++;
	if (Math.abs(launches[i].step) > Math.abs(launchWorst)) launchWorst = launches[i].step;
}
// The bank keeps the records the report quotes, not all 200k: every significant step, the
// 50 worst, and the first and last 200 in run order (onset and end-of-leg context), with
// the aggregates above computed over the complete list before the trim.
var keep = {}, keepList = [];
for (i = 0; i < launches.length; i++) if (Math.abs(launches[i].step) > 1e-9) keep[i] = 1;
launches.slice().sort(function (a, b) { return Math.abs(b.step) - Math.abs(a.step); })
	.slice(0, 50).forEach(function (rec) { keep[rec.i] = 1; });
for (i = 0; i < Math.min(200, launches.length); i++) keep[i] = 1;
for (i = Math.max(0, launches.length - 200); i < launches.length; i++) keep[i] = 1;
Object.keys(keep).map(Number).sort(function (a, b) { return a - b; })
	.forEach(function (ix) { keepList.push(launches[ix]); });
var otherSum = 0;
NAMES.forEach(function (name) {
	if (name === 'gatherDT' || name === 'equil' || name === 'arc' || name === 'arc.release'
		|| name === 'flight' || name === 'emit' || name === 'advance' || name === 'melt'
		|| name === 'erode') return;               // parents double-count their children
	otherSum += BS[name].sumPos + BS[name].sumNeg;
});
var pairResidue = BS.gatherDT.sumPos + BS.gatherDT.sumNeg + BS.equil.sumPos + BS.equil.sumNeg;
jumps.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });

var result = {
	kind: 'trace-latent', seed: 5, kyr: 50, myr: myr, frames: frames,
	fingerprint: S.hash(),
	latent: latent, latentWorstFrame: latentFrame, latentWorstAbs: latentAbs,
	latentEnd: Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0))
		/ Math.max(1, Math.abs(S.hLedger - S.ledger)),
	latentEndAbs: Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0)),
	mass: mass, enthalpy: enth, intakeWallWorst: wall,
	intakeWallEnd: Math.abs((S.hLedger - hl0) / (S.wall - w0) - 1),
	depMelt: S.thr.depMelt, depTx: S.tx.depMelt, refuse: S.tx.refuse,
	heldSamples: heldSamples, heldMassTime: heldTime, heldMeltTime: heldMeltTime,
	heldGapMax: heldGap, mantleRoutes: mantleRoutes,
	minT: mins, maxT: maxs, outsideSamples: outside, nonfinite: nonfinite,
	tx: JSON.parse(JSON.stringify(S.tx)), thr: JSON.parse(JSON.stringify(S.thr)),
	residStart: rStart, driftFast: drift, chainSum: chainSum,
	boundaries: BS, jumps: jumps,
	equil: {
		gatherPhase: gatherPhase, sensPhase: sensPhase, latPhase: latPhase,
		airFreshN: airFreshN, airFreshL: airFreshL, airFlightN: airFlightN, airFlightL: airFlightL,
		airSensUnbooked: airSens, pairResidue: pairResidue, otherSum: otherSum
	},
	launches: { n: launches.length, mass: launchMass, snapped: launchSnapped,
		predicted: launchPredicted, worst: launchWorst,
		recordsKept: keepList.length, recordsOmitted: launches.length - keepList.length,
		recordsRule: 'all |step| > 1e-9, the 50 worst, and the first/last 200 in run order',
		records: keepList },
	timeline: timeline, events: events
};

// ---------------------------------------------------------------- checks (stderr + JSON)
check.section('0.3.2 M1 latent trace: the banked cell, the chain and the mechanism');
check.ok('the trace reproduces the banked trajectory', myr !== 600 || result.fingerprint === bank.fingerprint,
	'fingerprint ' + result.fingerprint);
if (myr === 600) {
	check.ok('and the banked latent metric, worst frame and absolute value',
		Math.abs(latent - bank.latent) < 1e-12 && latentFrame === bank.latentWorstFrame
		&& Math.abs(latentAbs - bank.latentWorstAbs) < 1e-9,
		'latent ' + latent + ' at frame ' + latentFrame + ', ' + latentAbs + ' km2*H');
	check.ok('and the banked books, held census and temperature samples',
		mass === bank.mass && Math.abs(enth - bank.enthalpy) < 1e-15
		&& Math.abs(wall - bank.intakeWallWorst) < 1e-12 && heldSamples === bank.heldSamples
		&& mantleRoutes === bank.mantleRoutes && result.depTx === bank.depTx
		&& JSON.stringify(outside) === JSON.stringify(bank.outsideSamples),
		'enth ' + enth.toExponential(3) + ', wall ' + wall + ', held ' + heldSamples);
	check.ok('and all three protected event records', events.length === bank.events.length
		&& events.every(function (e, k) {
			var b = bank.events[k];
			return e.frame === b.frame && e.id === b.id && Math.abs(e.host - b.host) < 1e-12
				&& Math.abs(e.melt - b.melt) < 1e-12;
		}), events.length + ' events, frames ' + events.map(function (e) { return e.frame; }).join());
}
check.ok('the fast residual starts at zero on the reset planet', rStart === 0, 'rStart ' + rStart);
check.ok('the boundary chain telescopes to the drift it reports',
	Math.abs(drift - chainSum) < 1e-6 && Math.abs(drift - (lastR - rStart)) < 1e-12,
	'drift ' + drift + ' km2*H against chain sum ' + chainSum);
check.ok('the drift is the unbooked air snaps, and nothing else',
	Math.abs(drift - (airFreshL + airFlightL)) < 1e-2,
	'drift ' + drift.toFixed(6) + ' = launch snaps ' + airFreshL.toFixed(6)
	+ ' + in-flight snaps ' + airFlightL.toFixed(6) + ', gap '
	+ (drift - airFreshL - airFlightL).toExponential(3)
	+ '; gather/equil pair residue ' + pairResidue.toExponential(3)
	+ ', all other boundaries ' + otherSum.toExponential(3));
check.ok('the launch prediction and the measured first snap agree',
	launches.length === 0 || Math.abs(launchPredicted - airFreshL) < 1e-2 + 0.02 * Math.abs(launchPredicted),
	'predicted ' + launchPredicted.toFixed(6) + ' over ' + launches.length + ' launches ('
	+ launchSnapped + ' off-manifold), measured ' + airFreshL.toFixed(6));
check.info('compensated end residual', result.latentEndAbs.toFixed(5) + ' km2*H ('
	+ result.latentEnd.toExponential(4) + ' relative) against fast drift ' + drift.toFixed(5));
var fails = check.done();
result.checks = { total: check.total, fails: check.fails };
console.log = stdoutLog;
console.log(JSON.stringify(result, null, '\t'));
if (process.env.HEAT_TAIL_TRACE_OUT) fs.writeFileSync(process.env.HEAT_TAIL_TRACE_OUT, JSON.stringify(result, null, '\t') + '\n');
if (fails) process.exitCode = 1;
