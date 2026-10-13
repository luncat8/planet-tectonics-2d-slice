// pt-buried-deposit-melt.js — the 0.3.1 harness: the G5 deposit-routing boundary and the live
// measurement of the buried-deposit population it routes.
//
// Section A is the routing fixture: it pins the M1 gate (certificate plus depth plus meltHold),
// the certificate's arithmetic, both transfer shapes and the capacity rule, all on the kernel
// itself. Sections B and C are report-only measurement: a read-only wrapper samples deposits at
// the G5 melt-detach boundary, after the G4 phase and slab passes have completed, and measures
// the deposits below the shallow cooling mask whose G4-updated S.melt field is at or above
// meltHold. Per-frame stock and time-integral are the robust readings; parcel IDs provide
// sampled residence episodes, not unique material tracers (merges retain one ID and erosion
// changes parcel grouping).
//
// Two readings bound the deferred feature, because a zero can mean two different things:
//
//   exposure   the deposits that already meet the threshold below the mask -- stock, count and
//              mass-time of the parcels the current G5 kernel would route if it admitted them;
//   margin     how close the buried deposit population comes when nothing meets it -- per depth
//              band the sample with the highest equilibrium melt fraction, its own solidus and
//              the enthalpy it still needs, plus the mass-time histogram of that fraction. A
//              zero with a 0.4-of-H margin is a different finding from a zero sitting one
//              sample below the line, and only the margin says which one was measured.
//
// With M1 live, section A's readings also show what the route does to the metric: eligible
// mass-time becomes the crossing events themselves (the route consumes them inside the same G5
// call), so the live leg reports the shed stock (`thr.depMelt`) beside the exposure it came
// from, and the same books close on both sides.
//
// Run: node experiments/pt-buried-deposit-melt.js [liveMyr=300] [seed=1]
//      node experiments/pt-buried-deposit-melt.js [liveMyr=300] --cells seed:kyr:myr,...
//      (the matrix repeats its first cell and requires the two legs to agree bitwise;
//       --norepeat skips that leg. A cell without ":kyr" runs the shipped clock P.dt0 and
//       without ":myr" the liveMyr argument, so one cell can be a longer leg than the rest)
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), POOL = require(B + 'pool.js');
var G = require(B + 'grid.js');
var MT = require(B + 'melt.js'), FLIGHT = require(B + 'flight.js');

var M, TRACK, FRAME;
var DEP_BINS = ['30-250 km', '250-600 km', '600-2400 km', '>2400 km'];
// The histogram edges, with the threshold itself as the last one: the top bin is exactly the
// eligible population, so the histogram and the exposure reading cross-check each other.
// A "cell" is one live leg: a seed, a clock and a duration. The seed matrix is one clock over
// many seeds; the clock and duration axes are the other way round.
var XI_EDGE = [0.005, 0.01, 0.02, 0.05, P.meltHold];
var t0 = Date.now();

// ------------------------------------------------------------------ arguments
var LIVE = 300, CELLS = null, REPEAT = false;
(function parse() {
	var argv = process.argv.slice(2), pos = [], cells = null, i, a, parts, bits;
	for (i = 0; i < argv.length; i++) {
		a = argv[i];
		if (a === '--cells') {
			parts = (argv[++i] || '').split(',');
			cells = [];
			for (bits = 0; bits < parts.length; bits++) {
				var pair = parts[bits].split(':');
				cells.push({ seed: +pair[0], kyr: pair[1] === undefined ? P.dt0 : +pair[1],
					myr: pair[2] === undefined ? 0 : +pair[2] });
			}
		} else if (a === '--norepeat') REPEAT = false;
		else pos.push(+a);
	}
	if (pos.length) LIVE = pos[0];
	if (cells) {
		CELLS = cells;
		REPEAT = process.argv.indexOf('--norepeat') < 0;
	} else CELLS = [{ seed: pos.length > 1 ? pos[1] : 1, kyr: P.dt0, myr: 0 }];
	if (!(LIVE > 0) || !isFinite(LIVE)) throw new Error('liveMyr must be a positive finite number');
	for (i = 0; i < CELLS.length; i++) {
		if (!(CELLS[i].seed > 0) || !isFinite(CELLS[i].seed) || !(CELLS[i].kyr > 0)
			|| !isFinite(CELLS[i].kyr) || CELLS[i].myr < 0 || !isFinite(CELLS[i].myr)) {
			throw new Error('every cell needs a positive seed and clock: ' + JSON.stringify(CELLS[i]));
		}
	}
}());

function configure(seed, kyr) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = kyr; P.seed = seed;
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

// One deposit sample, copied whole: every field a reader needs to judge how far this parcel is
// from the mobile threshold is taken at the moment the record is beaten, so the closest-approach
// line below cannot be reconstructed from a later, colder state. The record is ordered by that
// margin rather than by xi: where nothing melts every sample ties at xi = 0, and the sample that
// comes closest is the one whose own solidus and enthalpy leave it the least to find.
//
// `margin` is the specific enthalpy the sample would still need for its *equilibrium melt
// fraction* to reach meltHold -- the test G5 makes, so the threshold is where the phase law's own
// byH puts xi = meltHold, Hthr = Ts + (meltGap + meltLat) * meltHold, and not the smaller
// sensible-only Ts + meltGap * meltHold. Both are statements of the same distance in the units
// the phase law conserves; the kernel's one is the one this harness reports.
function snapshot(rec, p, myr, band) {
	var y = S.y[p], cF = S.cF[p], cW = S.cW[p], ts = PHASE.solidus(y, cF, cW);
	rec.xi = S.melt[p]; rec.T = S.T[p]; rec.H = S.H[p]; rec.Ts = ts;
	// The node field's own temperature where the sample sits. A parcel's equilibrium reading can
	// sit above it: the marker<->grid pair is the adjoint of the deposit (grid.js renormalizes by
	// mu_k / W_k), which delivers the node's heat change by *measure per arriving mass* and not by
	// an equal specific increment, so a light parcel in a heavy node takes a large specific one.
	// Reporting the gap is what separates "the mantle there is that warm" from "the quadrature
	// concentrated heat into this parcel", and the two are different findings.
	rec.tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
	rec.margin = ts + (P.meltGap + P.meltLat) * P.meltHold - rec.H;
	rec.y = y; rec.m = S.m[p]; rec.id = S.id[p]; rec.cF = cF; rec.cW = cW;
	rec.myr = myr; rec.frame = FRAME; rec.band = band;
}

// xi and T both start below any sample, so "the record was beaten" and "the record was never
// filled" are the same test: an xi of -1 means the band held no buried deposit at all.
function record() {
	return { xi: -1, T: -1e9, H: 0, Ts: 0, margin: Infinity, y: 0, m: 0, id: -1, cF: 0, cW: 0,
		myr: 0, frame: 0, band: 0, tg: 0 };
}

// The one scratch record the sample loop fills: a buried deposit is sampled into it once and the
// per-band readings then claim it, so no object is allocated per parcel per sample.
var SCRATCH = record();

function copyRec(dst, src) {
	dst.xi = src.xi; dst.T = src.T; dst.H = src.H; dst.Ts = src.Ts; dst.margin = src.margin;
	dst.y = src.y; dst.m = src.m; dst.id = src.id; dst.cF = src.cF; dst.cW = src.cW;
	dst.myr = src.myr; dst.frame = src.frame; dst.band = src.band; dst.tg = src.tg;
}

function xiBin(xi) {
	var i = 0;
	while (i < XI_EDGE.length && xi >= XI_EDGE[i]) i++;
	return i;
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

// The G5 boundary sample. Deposits below the cooling mask fill the buried stock and its depth
// bands; the ones at or above meltHold fill the exposure reading and the parcel-ID episodes,
// and the rest fill the margin reading. The non-deposit parcels below yDeep are the interior
// yardstick beside the deepest band: what the abyssal mantle itself reaches there is the
// thermal head a deposit would have to be carried into.
function sampleDeposits(frame) {
	var p, y, xi, mass, n = 0, buried = 0, eligible = 0, melt = 0;
	var depthMass = 0, bin, id, rec, myr = SIM.t, hold = P.meltHold;
	// The sample interval is this substep, not the rendered frame: at 500 kyr/frame the G5
	// boundary is visited ten times per frame, and every mass-time and residence integral below
	// is over those visits. At the shipped 50 kyr/frame one frame is one substep and the two are
	// the same number.
	TRACK.dt = SIM.subDt > 0 ? SIM.subDt : SIM.dt;
	var dt = TRACK.dt;
	var buriedByDepth = TRACK.buriedByDepth, eligibleByDepth = TRACK.eligibleByDepth;
	var meltByDepth = TRACK.meltByDepth;
	FRAME = frame;
	buriedByDepth.fill(0); eligibleByDepth.fill(0); meltByDepth.fill(0);
	for (p = 0; p < S.n; p++) {
		if (S.T[p] > TRACK.hotAny.T) snapshot(TRACK.hotAny, p, myr, S.ph[p]);
		if (S.H[p] > TRACK.hotH.H) snapshot(TRACK.hotH, p, myr, S.ph[p]);
		if (S.ph[p] !== P.PH.dep) {
			if (S.y[p] > P.yDeep && S.T[p] > TRACK.hotDeep.T) snapshot(TRACK.hotDeep, p, myr, 3);
			continue;
		}
		y = S.y[p];
		if (!(y > P.depositCoolDepth)) continue;
		mass = S.m[p];
		buried += mass;
		bin = buriedBin(y);
		buriedByDepth[bin] += mass;
		xi = S.melt[p];
		// one sample into the scratch record, then the two per-band readings are comparisons on
		// it: the closest approach (smallest margin) and the peak temperature
		snapshot(SCRATCH, p, myr, bin);
		if (SCRATCH.margin < TRACK.bandXi[bin].margin) copyRec(TRACK.bandXi[bin], SCRATCH);
		if (SCRATCH.T > TRACK.bandT[bin].T) copyRec(TRACK.bandT[bin], SCRATCH);
		TRACK.xiHist[xiBin(xi)] += mass * dt;
		if (xi > 0) {
			TRACK.mushy.add(S.id[p]);
			TRACK.mushyTime += mass * dt;
		}
		TRACK.buriedIds.add(S.id[p]);
		if (!(xi >= hold)) continue;
		id = S.id[p];
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
		TRACK.peakAt = myr;
	}
	if (melt > TRACK.peakMelt) TRACK.peakMelt = melt;
	if (eligible > 0 && TRACK.firstAt < 0) TRACK.firstAt = myr;
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

// The closest of the four bands is the run's headline margin: the band records are per-depth so
// a shallow near-miss (quenched, and not the deferred route's population) cannot hide a deep
// population that never warmed at all. A band that held no buried deposit keeps margin Infinity,
// so it can never win this walk.
function closest(o) {
	var b, best = o.bandXi[0];
	for (b = 1; b < 4; b++) if (o.bandXi[b].margin < best.margin) best = o.bandXi[b];
	return best;
}

function hottest(o) {
	var b, best = o.bandT[0];
	for (b = 1; b < 4; b++) if (o.bandT[b].T > best.T) best = o.bandT[b];
	return best;
}

function measure(liveMyr, cell) {
	var frames, f, o, detach, sampled, t1 = Date.now();
	if (!(liveMyr > 0)) liveMyr = liveOf(cell);
	M = configure(cell.seed, cell.kyr);
	POOL.inventoryComp(S);
	o = {
		seed: cell.seed, kyr: cell.kyr,
		mass0: S.invMTot, enthalpy0: S.invHTot, heat0: S.hLedger,
		buriedMassTime: 0, eligibleMassTime: 0, meltMassTime: 0, parcelTime: 0,
		depthMassTime: 0, peakBuried: 0, peakEligible: 0, peakEligibleN: 0,
		peakMelt: 0, peakAt: -1, firstAt: -1, framesWithExposure: 0, sampledFrames: 0,
		entries: 0, entryMass: 0, entryMelt: 0, firstIds: 0,
		episodes: 0, durationSum: 0, durationMax: 0, censored: 0, mushyTime: 0,
		active: new Map(), ever: new Set(), mushy: new Set(), buriedIds: new Set(),
		bandXi: [record(), record(), record(), record()],
		bandT: [record(), record(), record(), record()],
		hotDeep: record(), hotAny: record(), hotH: record(),
		buriedByDepth: new Float64Array(4), eligibleByDepth: new Float64Array(4),
		meltByDepth: new Float64Array(4), buriedTimeByDepth: new Float64Array(4),
		eligibleTimeByDepth: new Float64Array(4), meltTimeByDepth: new Float64Array(4),
		xiHist: new Float64Array(XI_EDGE.length + 1),
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
	o.secs = (Date.now() - t1) / 1000;
	o.sampleDt = TRACK.dt;
	o.massResidual = S.invMTot - o.mass0;
	o.massRel = Math.abs(o.massResidual) / o.mass0;
	o.enthalpyResidual = (S.invHTot - o.enthalpy0) - (S.hLedger - o.heat0);
	o.enthalpyRel = Math.abs(o.enthalpyResidual) / Math.max(Math.abs(S.hLedger - o.heat0), 1);
	o.depositExpected = S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep
		- S.thr.depMelt;
	o.depositResidual = S.invM[P.PH.dep] - o.depositExpected;
	o.depositRel = Math.abs(o.depositResidual) / Math.max(Math.abs(o.depositExpected), 1);
	o.deepDep = S.thr.deepDep;
	o.depMelt = S.thr.depMelt; o.depMeltTx = S.tx.depMelt;
	// 0.3.1 M1's second identity: everything that shed melt, less what froze back, is what
	// reached the chambers plus what is still in the pool as melt
	o.meltBook = S.thr.seg + S.thr.whole + S.thr.depMelt - S.thr.freeze
		- (S.thr.intrDr + S.invM[P.PH.melt]);
	o.meltRel = Math.abs(o.meltBook) / Math.max(S.thr.intrDr + S.invM[P.PH.melt], 1);
	o.depositStock = S.invM[P.PH.dep];
	o.depositCount = S.invN[P.PH.dep];
	o.refuse = S.tx.refuse;
	o.fingerprint = S.hash();
	o.meanEligibleDepth = o.eligibleMassTime > 0 ? o.depthMassTime / o.eligibleMassTime : 0;
	o.closest = closest(o);
	o.hottest = hottest(o);
	o.mushyIds = o.mushy.size;
	o.buriedIdCount = o.buriedIds.size;
	o.histThreshold = o.xiHist[XI_EDGE.length];
	o.histLive = Math.abs(o.histThreshold - o.eligibleMassTime)
		<= 1e-9 * Math.max(o.eligibleMassTime, 1);
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

// The margin reading in full: the closest sample of each depth band, the hottest one, the
// mass-time distribution of the melt fraction and the interior yardstick beside it.
function logMargin(o) {
	var b, rec, hist = [], i, tot = 0;
	for (b = 0; b < 4; b++) {
		rec = o.bandXi[b];
		check.info('closest approach in ' + DEP_BINS[b],
			rec.xi < 0 ? 'no buried deposit sampled in this band'
				: 'xi ' + rec.xi.toFixed(4) + ' against the threshold ' + P.meltHold + ' at y '
				+ rec.y.toFixed(1) + ' km, t=' + rec.myr.toFixed(2) + ' Myr; T ' + rec.T.toFixed(3)
				+ ' against its own solidus ' + rec.Ts.toFixed(3) + ', local field T '
				+ rec.tg.toFixed(3) + '; H ' + rec.H.toFixed(4)
				+ ' against the threshold enthalpy ' + (rec.H + rec.margin).toFixed(4) + '; margin '
				+ rec.margin.toFixed(4) + ' of H (' + (P.meltHold - rec.xi).toFixed(4)
				+ ' of melt fraction) on ' + rec.m.toFixed(1) + ' km2 of host, cF '
				+ rec.cF.toFixed(3) + ' cW ' + rec.cW.toFixed(4));
	}
	rec = o.hottest;
	check.info('hottest buried deposit', rec.xi < 0 ? 'no buried deposit sampled'
		: 'T ' + rec.T.toFixed(3) + ' at y ' + rec.y.toFixed(1) + ' km, xi ' + rec.xi.toFixed(4)
		+ ', Ts ' + rec.Ts.toFixed(3) + ', local field T ' + rec.tg.toFixed(3) + ', cF '
		+ rec.cF.toFixed(3) + ' cW ' + rec.cW.toFixed(4) + ', t=' + rec.myr.toFixed(2) + ' Myr');
	for (i = 0; i <= XI_EDGE.length; i++) tot += o.xiHist[i];
	for (i = 0; i <= XI_EDGE.length; i++) {
		hist.push((i === 0 ? 'xi<' + XI_EDGE[0]
			: i === XI_EDGE.length ? 'xi>=' + P.meltHold + ' (eligible)'
			: 'xi ' + XI_EDGE[i - 1] + '-' + XI_EDGE[i])
			+ ' ' + o.xiHist[i].toExponential(3) + ' km2 Myr ('
			+ (tot > 0 ? (100 * o.xiHist[i] / tot).toFixed(3) : '0.000') + '%)');
	}
	check.info('melt-fraction mass-time histogram', hist.join('; '));
	rec = o.hotAny;
	check.info('hottest parcel in the world', 'T ' + rec.T.toFixed(3) + ' at y ' + rec.y.toFixed(1)
		+ ' km in phase ' + P.PH_NAME[rec.band] + ', H ' + rec.H.toFixed(3) + ', local field T '
		+ rec.tg.toFixed(3) + ', t=' + rec.myr.toFixed(2) + ' Myr'
		+ (rec.T > 1.02 ? ' -- above the CMB wall temperature' : ''));
	rec = o.hotH;
	check.info('highest parcel enthalpy', 'H ' + rec.H.toFixed(3) + ' (T ' + rec.T.toFixed(3)
		+ ', xi ' + rec.xi.toFixed(3) + ') at y ' + rec.y.toFixed(1) + ' km in phase '
		+ P.PH_NAME[rec.band] + ', cF ' + rec.cF.toFixed(3) + ' cW ' + rec.cW.toFixed(4)
		+ ', t=' + rec.myr.toFixed(2) + ' Myr; deep source rock\'s own liquidus sits above the '
		+ 'CMB wall by the meltSup margin plus meltGap, so a melt leaf of it may carry H above '
		+ 'the surface-anchored ' + (1 + P.meltLat).toFixed(2));
	rec = o.hotDeep;
	check.info('deep interior yardstick', rec.xi < 0 ? 'nothing below yDeep'
		: 'the hottest non-deposit parcel below ' + P.yDeep + ' km reached T ' + rec.T.toFixed(3)
		+ ' at y ' + rec.y.toFixed(1) + ' km, t=' + rec.myr.toFixed(2) + ' Myr, against the '
		+ 'buried deposit population\'s peak T '
		+ (o.hottest.xi < 0 ? 'no sample' : o.hottest.T.toFixed(3)));
	check.info('buried deposits ever above xi = 0', o.mushyIds + ' of ' + o.buriedIdCount
		+ ' sampled IDs; ' + o.mushyTime.toExponential(3) + ' km2 Myr above a zero melt fraction');
}

function cellLine(o) {
	var rec = o.closest;
	return 'buried peak ' + o.peakBuried.toFixed(1) + ' km2 (end ' + o.depositStock.toFixed(1)
		+ ' km2 in ' + o.depositCount + ' parcels); buried mass-time '
		+ o.buriedMassTime.toExponential(4) + ' km2 Myr; eligible '
		+ o.eligibleMassTime.toExponential(3) + ' km2 Myr; closest '
		+ (rec.xi < 0 ? 'none sampled' : 'xi ' + rec.xi.toFixed(4) + '/' + P.meltHold + ' at '
			+ rec.y.toFixed(0) + ' km, margin ' + rec.margin.toFixed(4) + ' of H, T '
			+ rec.T.toFixed(3) + ' vs field ' + rec.tg.toFixed(3))
		+ '; peak deposit T ' + (o.hottest.xi < 0 ? 'none' : o.hottest.T.toFixed(3))
		+ '; hottest parcel T ' + o.hotAny.T.toFixed(3) + ' / H ' + o.hotH.H.toFixed(3)
		+ '; deepDep ' + o.deepDep.toFixed(2) + ' km2; depMelt '
		+ o.depMelt.toExponential(3) + ' km2 in ' + o.depMeltTx + ' transfers'
		+ '; fingerprint ' + o.fingerprint + '; ' + o.secs.toFixed(1) + ' s';
}

// Every cell's own gate: the two books and the deposit identity close, nothing was refused, and
// the histogram's threshold band is the eligible reading it was accumulated beside.
function cellCheck(o, label) {
	check.ok(label + ' closes its books, defers nothing and agrees with its own histogram',
		o.massRel < 1e-9 && o.enthalpyRel < 1e-9 && o.depositRel < 1e-9 && o.meltRel < 1e-9
			&& o.refuse === 0 && o.histLive,
		'mass ' + o.massResidual.toExponential(2) + ' km2 (' + o.massRel.toExponential(2)
		+ ' rel); enthalpy ' + o.enthalpyResidual.toExponential(2) + ' (' + o.enthalpyRel.toExponential(2)
		+ ' rel); deposit ' + o.depositResidual.toExponential(2) + '; refusals ' + o.refuse
		+ '; melt book ' + o.meltBook.toExponential(2) + ' km2 ('
		+ o.meltRel.toExponential(2) + ' rel, ' + o.depMeltTx + ' deposits shed); threshold band '
		+ 'against eligible mass-time ' + o.histThreshold.toExponential(2) + ' / '
		+ o.eligibleMassTime.toExponential(2));
}

// The duration a cell runs: its own if it declares one, else the invocation's argument.
function liveOf(cell) { return cell.myr > 0 ? cell.myr : LIVE; }

function label(cell) {
	return 'seed ' + cell.seed + ' at ' + cell.kyr + ' kyr/frame over ' + liveOf(cell) + ' Myr';
}

// The same label for a finished leg, which carries the duration it actually ran.
function labelOf(o) { return label({ seed: o.seed, kyr: o.kyr, myr: o.live }); }

// ------------------------------------------------------------------ A. the G5 routing boundary
// 0.3.1 M1 routes exactly one population: a deposit that earned the shallow-quench certificate
// (state.js depQ, set by flight.js cool), was then buried past the cooling mask and reached the
// mobile threshold. These fixtures pin each term of that gate, the certificate's arithmetic
// (earned by cooling, kept through burial, conjunctive through merges and carries), the two
// transfer shapes (the P3.2 equilibrium split and the in-place whole change) and the capacity
// rule (a refused split defers; a whole change needs no slot).
check.section('A. the routing boundary: certificate plus depth plus meltHold, and nothing less');
M = configure(CELLS[0].seed, CELLS[0].kyr);

// one builder for the fixtures below: a deposit whose equilibrium state is exactly what the G5
// kernel reads, with an explicit certificate
function addProbe(y, x, mass, xi, cert) {
	var p = addDeposit(y, x, mass, xi);
	S.depQ[p] = cert ? 1 : 0;
	return p;
}

function xiIs(p, want) { return Math.abs(S.melt[p] - want) < 1e-9; }

S.n = 0;
var p29 = addProbe(P.depositCoolDepth - 1, 1000, 100, 0.2, 0);
var p30 = addProbe(P.depositCoolDepth, 2000, 100, 0.2, 0);
var p31 = addProbe(P.depositCoolDepth + 1, 3000, 100, 0.2, 0);
var n0 = S.n, split0 = S.tx.split, whole0 = S.tx.whole, depTx0 = S.tx.depMelt;
var h29 = S.H[p29], h30 = S.H[p30], h31 = S.H[p31], xi31 = S.melt[p31];
MT.detach(S);
check.ok('the probe starts with molten deposits on both sides of the cutoff',
	S.melt[p29] >= P.meltHold && S.melt[p30] >= P.meltHold && S.melt[p31] >= P.meltHold,
	'xi ' + S.melt[p29].toFixed(3) + '/' + S.melt[p30].toFixed(3) + '/' + S.melt[p31].toFixed(3));
check.ok('an uncertified deposit is not re-phased, however deep and however molten',
	S.n === n0 && S.ph[p29] === P.PH.dep && S.ph[p30] === P.PH.dep && S.ph[p31] === P.PH.dep
		&& S.tx.split === split0 && S.tx.whole === whole0 && S.tx.depMelt === depTx0,
	'parcels ' + S.n + ', split ' + S.tx.split + ', whole ' + S.tx.whole + ', depMelt tx '
		+ S.tx.depMelt);
FLIGHT.cool(M, S, P.depositCoolTau);
check.ok('the cooling mask includes y = depositCoolDepth',
	S.H[p29] < h29 && S.H[p30] < h30 && S.melt[p29] < P.meltHold && S.melt[p30] < P.meltHold,
	'H shallow/boundary ' + h29.toFixed(3) + '/' + h30.toFixed(3) + ' -> '
		+ S.H[p29].toFixed(3) + '/' + S.H[p30].toFixed(3));
check.ok('the pass certifies the deposits it quenched below the threshold',
	S.depQ[p29] === 1 && S.depQ[p30] === 1 && S.depQ[p31] === 0,
	'depQ shallow/boundary/deep ' + S.depQ[p29] + '/' + S.depQ[p30] + '/' + S.depQ[p31]);
check.ok('cool() leaves the deposit just below the mask unchanged and uncertified',
	S.H[p31] === h31 && S.melt[p31] === xi31 && S.melt[p31] >= P.meltHold && S.depQ[p31] === 0,
	'y ' + S.y[p31] + ' km, xi ' + S.melt[p31].toFixed(3));
MT.detach(S);
check.ok('the quenched shallow deposit is still not routed at the mask boundary',
	S.n === n0 && S.ph[p30] === P.PH.dep && S.melt[p30] < P.meltHold,
	'phase ' + P.PH_NAME[S.ph[p30]] + ', xi ' + S.melt[p30].toFixed(3));
S.depQ[p31] = 1;
var seg0 = S.thr.seg, dep0 = S.thr.depMelt;
MT.detach(S);
check.ok('a certified deposit past the mask sheds its melt through the P3.2 split',
	S.ph[p31] === P.PH.dep && S.melt[p31] === 0 && S.depQ[p31] === 1
		&& Math.abs(S.thr.depMelt - (dep0 + xi31 * 100)) < 1e-9 && S.thr.seg === seg0
		&& S.tx.depMelt === depTx0 + 1,
	'residue xi ' + S.melt[p31].toFixed(3) + ' at its solidus, depMelt +'
		+ (S.thr.depMelt - dep0).toFixed(3) + ' km2, the mantle seg book untouched');
check.ok('and the child is mobile melt with no certificate of its own',
	S.ph[n0] === P.PH.melt && S.depQ[n0] === 0 && S.melt[n0] > 0.999,
	'phase ' + P.PH_NAME[S.ph[n0]] + ', xi ' + S.melt[n0].toFixed(4));

// the whole-parcel shape: a certified deposit at xi = 1 changes phase in place and leaves the
// certificate and the mantle's whole book behind
var pWhole = addProbe(1200, 4000, 100, 1.0, 1);
var wholeTx0 = S.tx.whole, whThr0 = S.thr.whole, whDep0 = S.thr.depMelt;
MT.detach(S);
check.ok('a wholly molten certified deposit converts in place, not through the mantle book',
	S.ph[pWhole] === P.PH.melt && S.depQ[pWhole] === 0 && S.thr.whole === whThr0
		&& S.tx.whole === wholeTx0 + 1 && S.thr.depMelt === whDep0 + 100,
	'phase ' + P.PH_NAME[S.ph[pWhole]] + ', thr.whole ' + S.thr.whole.toFixed(3)
		+ ', depMelt +' + (S.thr.depMelt - whDep0).toFixed(3) + ' km2');

// the certificate is earned by cooling, never by depth, and it is checked even when the pass
// has no enthalpy delta to apply
var pFresh = addProbe(20, 5000, 100, 1.0, 0);
MT.detach(S);
check.ok('fresh hot ejecta inside the mask is not routed and not certified',
	S.ph[pFresh] === P.PH.dep && S.depQ[pFresh] === 0 && S.melt[pFresh] >= P.meltHold,
	'xi ' + S.melt[pFresh].toFixed(3));
FLIGHT.cool(M, S, 0);
check.ok('zero geological time certifies nothing', S.depQ[pFresh] === 0, 'depQ ' + S.depQ[pFresh]);
FLIGHT.cool(M, S, 0.001);
check.ok('a single short pass does not certify material still above the threshold',
	S.depQ[pFresh] === 0 && S.melt[pFresh] >= P.meltHold, 'xi ' + S.melt[pFresh].toFixed(4));
var passes = 1;
while (S.depQ[pFresh] === 0 && passes < 200) { FLIGHT.cool(M, S, 0.001); passes++; }
check.ok('positive-time passes certify it once its own reading is below meltHold',
	S.depQ[pFresh] === 1 && S.melt[pFresh] < P.meltHold,
	passes + ' passes, xi ' + S.melt[pFresh].toFixed(4));
S.y[pFresh] = 1200; S.e[pFresh] = Math.asinh(1200 / M.yLin);
var warm = PHASE.byT(PHASE.solidus(1200, S.cF[pFresh], S.cW[pFresh]) + 0.5 * P.meltGap,
	1200, S.cF[pFresh], S.cW[pFresh]);
S.H[pFresh] = warm.h; S.T[pFresh] = warm.t; S.melt[pFresh] = warm.melt;
MT.detach(S);
check.ok('the certificate survives burial, and the parcel remelts at depth',
	S.ph[pFresh] === P.PH.dep && S.melt[pFresh] === 0 && S.depQ[pFresh] === 1,
	'residue xi ' + S.melt[pFresh].toFixed(3) + ', still certified');

// the certificate is a conjunction: a merge or a carry can only clear it, and a fresh parcel
// of a certified deposit is the one transfer that keeps it
var cA = addProbe(20, 6000, 100, 0.2, 1), cB = addProbe(20, 6100, 100, 0.2, 0);
POOL.merge(M, S, cA, cB);
check.ok('a merge with uncertified material clears the certificate', S.depQ[cA] === 0,
	'depQ ' + S.depQ[cA]);
S.n = 0;
var donor = addProbe(1200, 1000, 100, 0.5, 1), recv = addProbe(20, 1100, 100, 0, 0);
var recv2 = addProbe(1200, 1200, 100, 0.5, 0), recv3 = addProbe(1200, 1300, 100, 0.5, 1);
POOL.carry(S, donor, recv, 10, P.PH.dep);
check.ok('material carried into an uncertified deposit cannot certify it', S.depQ[recv] === 0,
	'depQ ' + S.depQ[recv]);
POOL.carry(S, donor, recv2, 10, P.PH.dep);
check.ok('a certified donation cannot certify a receiver that was not',
	S.depQ[recv2] === 0, 'depQ ' + S.depQ[recv2]);
POOL.carry(S, donor, recv3, 10, P.PH.dep);
check.ok('a transfer between two certified deposits keeps the certificate',
	S.depQ[recv3] === 1, 'depQ ' + S.depQ[recv3]);
var frag = POOL.carry(S, donor, -1, 10, P.PH.dep);
check.ok('a fresh parcel of a certified deposit keeps the certificate',
	frag >= 0 && S.depQ[frag] === 1 && S.ph[frag] === P.PH.dep,
	frag < 0 ? 'refused' : 'phase ' + P.PH_NAME[S.ph[frag]] + ', depQ ' + S.depQ[frag]);

// capacity: a refused split defers once and leaves the source exactly as it was; the whole
// change is a phase change, not a transaction, so it needs no slot at all
S.n = 0;
var qFull = addProbe(1200, 1000, 100, 0.5, 1), qKeep = S.H[qFull], qMelt = S.melt[qFull];
var wFull = addProbe(1200, 2000, 100, 1.0, 1), wM = S.m[wFull];
var refuse0 = S.tx.refuse;
S.n = P.partCap;
S.melt.fill(0, 2); S.ph.fill(P.PH.mantle, 2); S.depQ.fill(0, 2); S.H.fill(0, 2);
MT.detach(S);
check.ok('a full pool defers the split and leaves the source exactly as it was',
	S.n === P.partCap && S.H[qFull] === qKeep && S.melt[qFull] === qMelt && S.depQ[qFull] === 1
		&& S.tx.refuse === refuse0 + 1,
	'refuse +' + (S.tx.refuse - refuse0) + ', certificate intact');
check.ok('a whole-parcel conversion needs no spare slot', S.ph[wFull] === P.PH.melt
	&& S.thr.depMelt >= wM && S.tx.refuse === refuse0 + 1,
	'phase ' + P.PH_NAME[S.ph[wFull]] + ', ' + (S.tx.refuse - refuse0) + ' refusal');

// The margin reading has to be the kernel's own statement, or a cell's "closest approach" line
// would be measuring something else: a deposit equilibrated exactly at meltHold sits on the
// threshold enthalpy (margin 0) and one at half the threshold is exactly half the phase
// interval's enthalpy short ((meltGap + meltLat) * meltHold / 2).
S.n = 0;
var pLow = addDeposit(1000, 4000, 50, P.meltHold * 0.5);
var pOn = addDeposit(1000, 5000, 50, P.meltHold);
var recLow = record(), recOn = record();
snapshot(recLow, pLow, 0, 2);
snapshot(recOn, pOn, 0, 2);
check.ok('the margin is the kernel threshold: zero at xi = meltHold, linear below it',
	Math.abs(recOn.margin) < 1e-12
		&& Math.abs(recLow.margin - 0.5 * (P.meltGap + P.meltLat) * P.meltHold)
			< 1e-12 * (P.meltGap + P.meltLat),
	'xi ' + recLow.xi.toFixed(6) + ' margin ' + recLow.margin.toExponential(2) + '; xi '
	+ recOn.xi.toFixed(6) + ' margin ' + recOn.margin.toExponential(2)
	+ '; the threshold is ' + ((P.meltGap + P.meltLat) * P.meltHold).toFixed(4) + ' of H');
check.ok('an unfilled record reads as never sampled, not as cold', record().xi < 0,
	'xi ' + record().xi);

// ------------------------------------------------------------------ B. the live burden
var A, AGAIN, ROWS = [], i, worst, elig = 0, buriedTime = 0, frames = 0, shed = 0, shedTx = 0;

// One positional seed is the canonical single leg with the full reading. The detail block's
// per-frame statistics assume one G5 call per rendered frame, which is exactly the shipped
// clock; a coarser clock visits G5 once per substep and belongs to the matrix branch.
if (!REPEAT && CELLS[0].kyr <= P.dtFluidMax * 1000) {
	check.section('B. live buried-deposit exposure: ' + LIVE + ' Myr requested, seed ' + CELLS[0].seed
		+ ', ' + CELLS[0].kyr + ' kyr/frame, all shipped P4 passes enabled');
	A = measure(liveOf(CELLS[0]), CELLS[0]);
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
		+ ' - deep ' + A.deepDep.toFixed(6) + ' - remelted ' + A.depMelt.toFixed(6)
		+ '; residual ' + A.depositResidual.toExponential(2));
	check.ok('the melt book closes across both sources (M1 included)', A.meltRel < 1e-9,
		'seg ' + S.thr.seg.toExponential(3) + ' + whole ' + S.thr.whole.toExponential(3)
		+ ' + depMelt ' + S.thr.depMelt.toExponential(3) + ' - freeze '
		+ S.thr.freeze.toExponential(3) + ' = intruded ' + S.thr.intrDr.toExponential(3)
		+ ' + pool melt ' + S.invM[P.PH.melt].toExponential(3) + '; gap '
		+ A.meltBook.toExponential(2) + ' km2');
	check.ok('the live leg has no capacity refusal', A.refuse === 0,
		A.refuse + ' refused transactions; fingerprint ' + A.fingerprint);
	check.ok('the depth bands add up to the eligible mass-time', A.histLive
		&& Math.abs(A.eligibleTimeByDepth[0] + A.eligibleTimeByDepth[1]
			+ A.eligibleTimeByDepth[2] + A.eligibleTimeByDepth[3] - A.eligibleMassTime)
			<= 1e-9 * Math.max(A.eligibleMassTime, 1),
		'threshold band ' + A.histThreshold.toExponential(2) + ' km2 Myr against eligible '
		+ A.eligibleMassTime.toExponential(2) + ' km2 Myr, summed over the four depth bands');
	check.info('buried deposit stock', 'peak ' + A.peakBuried.toFixed(3) + ' km2; at end '
		+ A.depositStock.toFixed(3) + ' km2 in ' + A.depositCount + ' parcels; subducted deposit '
		+ A.deepDep.toFixed(3) + ' km2; shed by certified deposits (M1) '
		+ A.depMelt.toExponential(3) + ' km2 in ' + A.depMeltTx + ' transfers');
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
		+ 'resolution ' + A.sampleDt.toFixed(3) + ' Myr. ID counts and entry-mass snapshots are '
		+ 'not unique conserved material because merges/rework change parcel grouping.');
	check.info('entry-event snapshots', A.entries + ' qualifying episodes, '
		+ A.entryMass.toFixed(3) + ' km2 host mass and ' + A.entryMelt.toFixed(3)
		+ ' km2 melt-equivalent at their first sampled frame (re-entry may count again)');
	check.info('mean depth of eligible mass-time', A.meanEligibleDepth.toFixed(1) + ' km');
	logBands(A);
	logMargin(A);
	check.info('time', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
} else {
	check.section('B. the cell matrix: ' + CELLS.length + ' cells of ' + LIVE
		+ ' Myr each unless the cell declares its own clock or duration'
		+ (REPEAT ? ', plus one repeat of the first cell' : '')
		+ ', all shipped P4 passes enabled');
	for (i = 0; i < CELLS.length; i++) {
		A = measure(liveOf(CELLS[i]), CELLS[i]);
		ROWS.push(A);
		check.info('cell ' + (i + 1) + ' ' + label(CELLS[i]), cellLine(A));
		cellCheck(A, 'cell ' + (i + 1) + ' ' + label(CELLS[i]));
		elig += A.eligibleMassTime;
		buriedTime += A.buriedMassTime;
		shed += A.depMelt; shedTx += A.depMeltTx;
		frames += A.sampledFrames;
		if (!worst || A.closest.margin < worst.closest.margin) worst = A;
	}
	if (REPEAT) {
		AGAIN = measure(liveOf(CELLS[0]), CELLS[0]);
		check.ok('the first cell repeats bitwise, so a cell does not depend on its neighbours',
			AGAIN.fingerprint === ROWS[0].fingerprint
			&& AGAIN.eligibleMassTime === ROWS[0].eligibleMassTime
			&& AGAIN.buriedMassTime === ROWS[0].buriedMassTime
			&& AGAIN.peakEligible === ROWS[0].peakEligible,
			'fingerprint ' + ROWS[0].fingerprint + ' both times, buried mass-time '
			+ ROWS[0].buriedMassTime.toExponential(4) + ' against ' + AGAIN.buriedMassTime.toExponential(4));
	}
	check.ok('eligible stock stays a subset of buried stock in every cell, at zero refusals',
		ROWS.every(function (o) { return o.peakEligible <= o.peakBuried + 1e-10 && o.refuse === 0; }),
		'worst peak eligible ' + Math.max.apply(null, ROWS.map(function (o) {
			return o.peakEligible;
		})).toFixed(3) + ' km2 against worst peak buried ' + Math.max.apply(null, ROWS.map(function (o) {
			return o.peakBuried;
		})).toFixed(3) + ' km2; ' + ROWS.reduce(function (s, o) { return s + o.refuse; }, 0)
		+ ' refusals');
	check.info('matrix total', CELLS.length + ' cells requested, ' + frames + ' sampled G5 calls '
		+ 'at the cells\' own clocks; ' + buriedTime.toExponential(5) + ' km2 Myr of '
		+ 'buried-deposit exposure; ' + elig.toExponential(5) + ' km2 Myr of eligible exposure; '
		+ 'broadest approach ' + (worst.closest.xi < 0 ? 'none sampled'
			: 'xi ' + worst.closest.xi.toFixed(4) + ' (' + labelOf(worst)
				+ ', ' + DEP_BINS[worst.closest.band] + ', y ' + worst.closest.y.toFixed(1)
				+ ' km, margin ' + worst.closest.margin.toFixed(4) + ' of H)'));
	// Three readings, not two: the route being live is a third state, and the difference
	// between "exposure exists" and "exposure exists and was consumed" is the whole point of
	// the 0.3.1 measurement (the route removes the population it routes, so M0's exposure
	// integral is a counterfactual once M1 is on).
	check.info('matrix verdict', shed > 0
		? 'the M1 route ran: ' + shed.toExponential(3) + ' km2 shed in ' + shedTx
			+ ' transfers, against ' + elig.toExponential(3) + ' km2 Myr of sampled exposure'
		: elig > 0
			? 'exposure exists and nothing was routed: the route is deferred, which is the case '
				+ 'M1 was written for'
			: 'no cell observed a threshold-qualified buried deposit; the deferred route stays '
				+ 'closed and the margin line above is what the next decision reads');
	check.info('closest cell in full ' + labelOf(worst),
		'buried peak ' + worst.peakBuried.toFixed(3) + ' km2; eligible '
		+ worst.eligibleMassTime.toExponential(3) + ' km2 Myr; fingerprint ' + worst.fingerprint);
	logMargin(worst);
	check.info('time', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
check.done();
