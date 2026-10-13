// pt-buried-deposit-melt.js — report-only measurement for the deferred buried-sediment route.
//
// The live leg uses the shipped G1-G8 pipeline with contact, slab, arc and erosion enabled.
// A read-only wrapper samples deposits at the G5 melt-detach boundary, after the G4 phase and
// slab passes have completed. It measures deposits below the shallow cooling mask whose current
// the G4-updated S.melt field is at or above meltHold. Per-frame stock and time-integral are
// the robust readings; parcel IDs provide sampled residence episodes, not unique material tracers (merges retain
// one ID and erosion changes parcel grouping).
//
// A controlled three-depth probe also pins the existing boundary: deposits at and above
// depositCoolDepth are quenched, a deeper molten deposit is not, and melt.detach() routes none
// of them. Nothing in this harness changes the engine or enables deposit remelting.
//
// Run: node experiments/pt-buried-deposit-melt.js [liveMyr=300] [seed=1]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), POOL = require(B + 'pool.js');
var MT = require(B + 'melt.js'), FLIGHT = require(B + 'flight.js');

var LIVE = +(process.argv[2] || 300), SEED = +(process.argv[3] || 1);
var M, TRACK, FRAME;
var DEP_BINS = ['30-250 km', '250-600 km', '600-2400 km', '>2400 km'];
var t0 = Date.now();

function configure(seed) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = seed;
	P.contact = true; P.slab = true; P.arc = true; P.ero = true;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	return SIM.M;
}

function addDeposit(y, x, mass, xi) {
	var p = POOL.admit(S, P.PH.dep), cF = 0.2, cW = 0.005;
	var ts, state;
	if (p < 0) throw new Error('deposit probe could not admit its parcel');
	ts = PHASE.solidus(y, cF, cW);
	state = PHASE.byT(ts + xi * P.meltGap, y, cF, cW);
	S.x[p] = x; S.y[p] = y; S.e[p] = Math.asinh(y / M.yLin);
	S.m[p] = mass; S.T[p] = state.t; S.H[p] = state.h; S.melt[p] = state.melt;
	S.cF[p] = cF; S.cW[p] = cW;
	S.age[p] = 0; S.mu[p] = 0; S.dmg[p] = 0; S.pLoad[p] = 0; S.pCnt[p] = 0;
	return p;
}

function buriedBin(y) {
	if (y <= P.yCrust) return 0;
	if (y <= P.yArcMax) return 1;
	if (y <= P.yDeep) return 2;
	return 3;
}

function closeEpisode(rec, censored) {
	var duration = rec.frames * TRACK.dt;
	TRACK.episodes++;
	TRACK.durationSum += duration;
	if (duration > TRACK.durationMax) TRACK.durationMax = duration;
	if (censored) TRACK.censored++;
}

function expireEpisode(rec, id) {
	if (rec.lastFrame === FRAME) return;
	closeEpisode(rec, false);
	TRACK.active.delete(id);
}

function censorEpisode(rec) { closeEpisode(rec, true); }

function sampleDeposits(frame) {
	var p, y, xi, mass, n = 0, buried = 0, eligible = 0, melt = 0;
	var depthMass = 0, bin, id, rec;
	var buriedByDepth = TRACK.buriedByDepth, eligibleByDepth = TRACK.eligibleByDepth;
	var meltByDepth = TRACK.meltByDepth, dt = TRACK.dt;
	FRAME = frame;
	buriedByDepth.fill(0); eligibleByDepth.fill(0); meltByDepth.fill(0);
	for (p = 0; p < S.n; p++) {
		if (S.ph[p] !== P.PH.dep) continue;
		y = S.y[p];
		if (!(y > P.depositCoolDepth)) continue;
		buried += S.m[p];
		bin = buriedBin(y);
		buriedByDepth[bin] += S.m[p];
		xi = S.melt[p];
		if (!(xi >= P.meltHold)) continue;
		mass = S.m[p]; id = S.id[p];
		eligible += mass; melt += mass * xi; n++; depthMass += mass * y;
		eligibleByDepth[bin] += mass;
		meltByDepth[bin] += mass * xi;
		rec = TRACK.active.get(id);
		if (!rec) {
			rec = { frames: 0, lastFrame: frame };
			TRACK.active.set(id, rec);
			TRACK.entries++;
			TRACK.entryMass += mass;
			TRACK.entryMelt += mass * xi;
			if (!TRACK.ever.has(id)) {
				TRACK.ever.add(id);
				TRACK.firstIds++;
			}
		}
		rec.lastFrame = frame;
		rec.frames++;
	}
	TRACK.active.forEach(expireEpisode);
	TRACK.sampledFrames++;
	TRACK.buriedMassTime += buried * dt;
	TRACK.eligibleMassTime += eligible * dt;
	TRACK.meltMassTime += melt * dt;
	TRACK.parcelTime += n * dt;
	TRACK.depthMassTime += depthMass * dt;
	if (eligible > 0) TRACK.framesWithExposure++;
	if (buried > TRACK.peakBuried) TRACK.peakBuried = buried;
	if (eligible > TRACK.peakEligible) {
		TRACK.peakEligible = eligible;
		TRACK.peakEligibleN = n;
		TRACK.peakAt = SIM.t;
	}
	if (melt > TRACK.peakMelt) TRACK.peakMelt = melt;
	if (eligible > 0 && TRACK.firstAt < 0) TRACK.firstAt = SIM.t;
	for (bin = 0; bin < 4; bin++) {
		TRACK.buriedTimeByDepth[bin] += buriedByDepth[bin] * dt;
		TRACK.eligibleTimeByDepth[bin] += eligibleByDepth[bin] * dt;
		TRACK.meltTimeByDepth[bin] += meltByDepth[bin] * dt;
	}
}

function closeOpenEpisodes() {
	TRACK.active.forEach(censorEpisode);
	TRACK.active.clear();
}

function measure(liveMyr, seed) {
	var frames, f, o, detach, sampled;
	M = configure(seed);
	POOL.inventoryComp(S);
	o = {
		mass0: S.invMTot, enthalpy0: S.invHTot, heat0: S.hLedger,
		buriedMassTime: 0, eligibleMassTime: 0, meltMassTime: 0, parcelTime: 0,
		depthMassTime: 0, peakBuried: 0, peakEligible: 0, peakEligibleN: 0,
		peakMelt: 0, peakAt: -1, firstAt: -1, framesWithExposure: 0, sampledFrames: 0,
		entries: 0, entryMass: 0, entryMelt: 0, firstIds: 0,
		episodes: 0, durationSum: 0, durationMax: 0, censored: 0,
		active: new Map(), ever: new Set(),
		buriedByDepth: new Float64Array(4), eligibleByDepth: new Float64Array(4),
		meltByDepth: new Float64Array(4), buriedTimeByDepth: new Float64Array(4),
		eligibleTimeByDepth: new Float64Array(4), meltTimeByDepth: new Float64Array(4),
		dt: SIM.dt
	};
	TRACK = o;
	frames = Math.round(liveMyr / SIM.dt);
	detach = MT.detach;
	sampled = 0;
	MT.detach = function (state) {
		sampleDeposits(++sampled);
		return detach.call(MT, state);
	};
	try {
		for (f = 0; f < frames; f++) SIM.step();
	} finally {
		MT.detach = detach;
	}
	closeOpenEpisodes();
	POOL.inventoryComp(S);
	o.frames = frames;
	o.myr = frames * SIM.dt;
	o.massResidual = S.invMTot - o.mass0;
	o.massRel = Math.abs(o.massResidual) / o.mass0;
	o.enthalpyResidual = (S.invHTot - o.enthalpy0) - (S.hLedger - o.heat0);
	o.enthalpyRel = Math.abs(o.enthalpyResidual) / Math.max(Math.abs(S.hLedger - o.heat0), 1);
	o.depositExpected = S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep;
	o.depositResidual = S.invM[P.PH.dep] - o.depositExpected;
	o.depositRel = Math.abs(o.depositResidual) / Math.max(Math.abs(o.depositExpected), 1);
	o.deepDep = S.thr.deepDep;
	o.depositStock = S.invM[P.PH.dep];
	o.depositCount = S.invN[P.PH.dep];
	o.refuse = S.tx.refuse;
	o.fingerprint = S.hash();
	o.meanEligibleDepth = o.eligibleMassTime > 0 ? o.depthMassTime / o.eligibleMassTime : 0;
	return o;
}

function logBands(o) {
	var b;
	for (b = 0; b < DEP_BINS.length; b++) {
		check.info('eligible deposits at ' + DEP_BINS[b],
			o.eligibleTimeByDepth[b].toFixed(3) + ' km2 Myr host-mass exposure; '
			+ o.meltTimeByDepth[b].toFixed(3) + ' km2 Myr melt-equivalent exposure; '
			+ o.buriedTimeByDepth[b].toFixed(3) + ' km2 Myr total buried-deposit exposure');
	}
}

if (!(LIVE > 0) || !isFinite(LIVE) || !(SEED > 0) || !isFinite(SEED)) {
	throw new Error('liveMyr and seed must be positive finite numbers');
}

// ------------------------------------------------------------------ A. the cooling and routing boundary
check.section('A. current boundary: shallow deposits quench; deep molten deposits stay deposits');
M = configure(SEED);
S.n = 0;
var p29 = addDeposit(P.depositCoolDepth - 1, 1000, 100, 0.2);
var p30 = addDeposit(P.depositCoolDepth, 2000, 100, 0.2);
var p31 = addDeposit(P.depositCoolDepth + 1, 3000, 100, 0.2);
var n0 = S.n, split0 = S.tx.split, whole0 = S.tx.whole;
var h29 = S.H[p29], h30 = S.H[p30], h31 = S.H[p31], xi31 = S.melt[p31];
MT.detach(S);
check.ok('the probe starts with molten deposits on both sides of the cutoff',
	S.melt[p29] >= P.meltHold && S.melt[p30] >= P.meltHold && S.melt[p31] >= P.meltHold,
	'xi ' + S.melt[p29].toFixed(3) + '/' + S.melt[p30].toFixed(3) + '/' + S.melt[p31].toFixed(3));
check.ok('G5 detach does not re-phase any deposit, including a deep molten one',
	S.n === n0 && S.ph[p29] === P.PH.dep && S.ph[p30] === P.PH.dep && S.ph[p31] === P.PH.dep
		&& S.tx.split === split0 && S.tx.whole === whole0,
	'parcels ' + S.n + ', split ' + S.tx.split + ', whole ' + S.tx.whole);
FLIGHT.cool(M, S, P.depositCoolTau);
check.ok('the cooling mask includes y = depositCoolDepth',
	S.H[p29] < h29 && S.H[p30] < h30 && S.melt[p29] < P.meltHold && S.melt[p30] < P.meltHold,
	'H shallow/boundary ' + h29.toFixed(3) + '/' + h30.toFixed(3) + ' -> '
	+ S.H[p29].toFixed(3) + '/' + S.H[p30].toFixed(3));
check.ok('cool() leaves the deposit just below the mask unchanged',
	S.H[p31] === h31 && S.melt[p31] === xi31 && S.melt[p31] >= P.meltHold,
	'y ' + S.y[p31] + ' km, xi ' + S.melt[p31].toFixed(3));
MT.detach(S);
check.ok('the deep deposit remains unrouted after both G5 and shallow cooling',
	S.n === n0 && S.ph[p31] === P.PH.dep && S.H[p31] === h31 && S.melt[p31] === xi31,
	'phase ' + P.PH_NAME[S.ph[p31]] + ', xi ' + S.melt[p31].toFixed(3));

// ------------------------------------------------------------------ B. the live burden
check.section('B. live buried-deposit exposure: ' + LIVE + ' Myr requested, seed ' + SEED
	+ ', 50 kyr/frame, all shipped P4 passes enabled');
var A = measure(LIVE, SEED);
var meanEligible = A.framesWithExposure ? A.eligibleMassTime / (A.framesWithExposure * SIM.dt) : 0;
var meanDuration = A.episodes ? A.durationSum / A.episodes : 0;
check.ok('every requested geological frame was sampled once', A.sampledFrames === A.frames,
	A.sampledFrames + ' samples over ' + A.frames + ' frames at '
	+ (1000 * SIM.dt).toFixed(0) + ' kyr/frame');
check.ok('exposure metrics are finite and non-negative',
	isFinite(A.eligibleMassTime + A.meltMassTime + A.parcelTime + A.durationSum)
		&& A.eligibleMassTime >= 0 && A.meltMassTime >= 0 && A.durationSum >= 0,
	'host mass-time ' + A.eligibleMassTime.toExponential(3) + ' km2 Myr; melt-equivalent '
	+ A.meltMassTime.toExponential(3) + ' km2 Myr');
check.ok('threshold-qualified deposit stock is a subset of the buried deposit stock',
	A.peakEligible <= A.peakBuried + 1e-10 * Math.max(A.peakBuried, 1),
	'peak eligible ' + A.peakEligible.toFixed(3) + ' km2 against peak buried '
	+ A.peakBuried.toFixed(3) + ' km2');
check.ok('the global mass and enthalpy books still close',
	A.massRel < 1e-9 && A.enthalpyRel < 1e-9,
	'mass residual ' + A.massResidual.toExponential(2) + ' km2 (' + A.massRel.toExponential(2)
	+ ' rel); enthalpy residual ' + A.enthalpyResidual.toExponential(2) + ' ('
	+ A.enthalpyRel.toExponential(2) + ' rel)');
check.ok('the existing deposit inventory identity closes, including deep recycling',
	A.depositRel < 1e-9,
	'dep ' + A.depositStock.toFixed(6) + ' = land ' + S.thr.landCr.toFixed(6)
	+ ' + erosion ' + S.thr.eroCr.toFixed(6) + ' - rework ' + S.thr.eroDep.toFixed(6)
	+ ' - deep ' + A.deepDep.toFixed(6) + '; residual ' + A.depositResidual.toExponential(2));
check.ok('the live leg has no capacity refusal', A.refuse === 0,
	A.refuse + ' refused transactions; fingerprint ' + A.fingerprint);
check.info('buried deposit stock', 'peak ' + A.peakBuried.toFixed(3) + ' km2; at end '
	+ A.depositStock.toFixed(3) + ' km2 in ' + A.depositCount + ' parcels; subducted deposit '
	+ A.deepDep.toFixed(3) + ' km2');
check.info('melt-eligible buried deposit stock', 'peak ' + A.peakEligible.toFixed(3)
	+ ' km2 host mass (' + A.peakEligibleN + ' parcels)'
	+ (A.peakEligible > 0 ? ' at t=' + A.peakAt.toFixed(2) + ' Myr' : '; no qualifying sample')
	+ '; peak equilibrium melt ' + A.peakMelt.toFixed(3) + ' km2; first exposure '
	+ (A.firstAt < 0 ? 'none' : 't=' + A.firstAt.toFixed(2) + ' Myr'));
check.info('sampled burden', A.eligibleMassTime.toFixed(3) + ' km2 Myr eligible host-mass; '
	+ A.meltMassTime.toFixed(3) + ' km2 Myr melt-equivalent; mean simultaneous eligible stock '
	+ meanEligible.toFixed(3) + ' km2 over ' + A.framesWithExposure + ' exposed frames; '
	+ A.parcelTime.toFixed(3) + ' parcel-Myr');
check.info('continuous residence by parcel id', A.episodes + ' exposure episodes, '
	+ A.firstIds + ' IDs ever observed; mean ' + meanDuration.toFixed(3) + ' Myr, longest '
	+ A.durationMax.toFixed(3) + ' Myr, ' + A.censored + ' right-censored at run end; sample '
	+ 'resolution ' + SIM.dt.toFixed(3) + ' Myr. ID counts and entry-mass snapshots are not '
	+ 'unique conserved material because merges/rework change parcel grouping.');
check.info('entry-event snapshots', A.entries + ' qualifying episodes, '
	+ A.entryMass.toFixed(3) + ' km2 host mass and ' + A.entryMelt.toFixed(3)
	+ ' km2 melt-equivalent at their first sampled frame (re-entry may count again)');
check.info('mean depth of eligible mass-time', A.meanEligibleDepth.toFixed(1) + ' km');
logBands(A);
check.info('time', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
