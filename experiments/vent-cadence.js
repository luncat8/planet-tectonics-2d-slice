// vent-cadence.js — 0.2.4: one live leg's eruption cadence, the measurement the duty
// sweep reads. The 0.2.3 table landed kMelt from the contact legs and named the duty
// cycle (97.9 / 92.9% of frames feeding against 0.2.1's 57-69%) as the one visible cost
// whose knob is Vbirth / tauVent (design §5.2's vent lifecycle). This harness is that
// knob's decision column: full sources on one (frames, seed, kyr) leg, report only.
//
// The row separates the two things a single duty number conflates:
//   section duty   frames where any vent feeds (venFlux > 0) — the standing 0.2.x
//                  metric, comparable to melt-tune-sweep's duty% column;
//   visDuty        frames where the box actually receives >= visMin cells2 — a vent
//                  that feeds a per-frame trickle below Vdie is alive and "feeding"
//                  every frame while the viewer sees nothing;
//   style splits   the same duty for arc-style vents and plume-owned vents (shield +
//                  fissure) separately, and each style's longest quiet run, because a
//                  plume's continuous supply is not an arc's episodic one;
//   episodes       births / deaths and the mass one life carries (banked at death and
//                  at the end of the run, exact across slot reuse).
//
// VB / TV / VD in the environment override P.Vbirth (km3), P.tauVent (Myr) and
// P.Vdie (km3) for one run (the contact-audit KG / KM pattern), re-deriving VbirthM2,
// VdieM2 and kErupt the way params.js does; the default run is the committed values.
// Vdie is not the sweep's knob (vent-contact-sweep.js sweeps Vbirth x tauVent) but the
// death rule reads it, and the starved% column below is only interpretable beside it —
// 0.2.4's knob probe needed the override to name the regime the fed columns live in.
// The sweep (vent-contact-sweep.js) spawns this per leg and parses the row.
//
//   node experiments/vent-cadence.js [frames=3000] [seed=1] [kyr=50]
//
// Report only: nothing here edits params.js and nothing here is a gate — the chosen
// row lands through a normal edit and a full-suite re-acceptance.
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom;

var frames = +(process.argv[2] || 3000), seed = +(process.argv[3] || 1), kyr = +(process.argv[4] || 50);
var VB = Number(process.env.VB), TV = Number(process.env.TV), VD = Number(process.env.VD);
if (isFinite(VB) && VB > 0) {
	P.Vbirth = VB;
	P.VbirthM2 = P.Vbirth * P.venKm3M2;
	P.kErupt = 2 * Math.sqrt(P.VchM2 * P.VbirthM2) / P.tDrain;
}
if (isFinite(TV) && TV > 0) P.tauVent = TV;
if (isFinite(VD) && VD > 0) {
	P.Vdie = VD;
	P.VdieM2 = P.Vdie * P.venKm3M2;
}
P.sl.geo = kyr * 1e3;
P.sl.erupt = 1800;
L.check.planet(seed, 'def');
SIM.setGeo(kyr * 1e3);

// one visible feed: the box receives at least this many toy cells2 in the frame
// (a ballistic packet is 1 cell2; an episode frame at the landed rates carries 5-10)
var VIS_MIN = 0.1;

var prevCol = new Int32Array(P.maxVents).fill(-1);
var prevIn = new Float64Array(P.maxVents), life0 = new Float64Array(P.maxVents);
var birthF = new Int32Array(P.maxVents).fill(-1), deadF = new Int32Array(P.maxVents).fill(-1);
var lifeFeed = new Int32Array(P.maxVents);
var births = 0, deaths = 0, feedFrames = 0, visFrames = 0, aliveFrames = 0, aliveVentFrames = 0, starvedFrames = 0;
var arcFeedFrames = 0, plumeFeedFrames = 0, arcBirths = 0, plumeBirths = 0, maxIdleMyr = 0;
var feedRuns = 0, maxFeed = 0, maxQuiet = 0, maxQuietArc = 0, maxQuietPlume = 0;
var feedRun = 0, quietRun = 0, quietArc = 0, quietPlume = 0;
var toyIn = 0, epN = 0, epMax = 0;
// per-life banks (a life is one slot's birth -> death; the edifice cadence a viewer
// reads at one cone, which the section-wide duty can hide behind phase-tiled vents)
var lifeDurs = [], lifeDuties = [], lifeGaps = [];
var maxPile = 0, pileSumMax = 0, maxWpx = 0, maxHpx = 0;
var k9red = 0, worstLedger = 0;
var f, v, c, d, x, row, pile, alive, feeding, arcFeed, plumeFeed, toyNow, delta, hpx;

for (f = 0; f < frames; f++) {
	SIM.step();
	alive = 0; feeding = 0; arcFeed = 0; plumeFeed = 0; toyNow = 0;
	for (v = 0; v < S.nVen; v++) {
		c = S.venCol[v];
		if (c >= 0) {
			alive++;
			if (prevCol[v] < 0) {
				births++; life0[v] = S.venToyIn[v]; birthF[v] = f; lifeFeed[v] = 0;
				if (deadF[v] >= 0) lifeGaps.push(f - deadF[v]);
				if (S.venStyle[v] === 3) arcBirths++;
				else if (S.venStyle[v] === 1 || S.venStyle[v] === 2) plumeBirths++;
			}
			// venIdle > 0 is the death rule's own accumulator: the post-fill chamber
			// has sat below Vdie for some of the tauVent window. A vent that feeds
			// every frame with venIdle pinned at 0 is in the permanent-vent regime and
			// no (Vbirth, tauVent) can give it repose — 0.2.4's mechanism column.
			if (S.venIdle[v] > 0) starvedFrames++;
			if (S.venIdle[v] > maxIdleMyr) maxIdleMyr = S.venIdle[v];
			if (S.venFlux[v] > 0) {
				feeding++; lifeFeed[v]++;
				if (S.venStyle[v] === 3) arcFeed++;
				else if (S.venStyle[v] === 1 || S.venStyle[v] === 2) plumeFeed++;
			}
		} else if (prevCol[v] >= 0) {
			deaths++; deadF[v] = f;
			delta = S.venToyIn[v] - life0[v];
			if (delta > 0) { toyIn += delta; epN++; if (delta > epMax) epMax = delta; }
			if (birthF[v] >= 0) {
				lifeDurs.push(f - birthF[v] + 1);
				lifeDuties.push(lifeFeed[v] / (f - birthF[v] + 1));
				birthF[v] = -1;
			}
		}
		if (S.venToyIn[v] < prevIn[v]) delta = S.venToyIn[v];   // slot reset mid-frame
		else delta = S.venToyIn[v] - prevIn[v];
		if (delta > 0) toyNow += delta;
		prevCol[v] = c;
		prevIn[v] = S.venToyIn[v];
		pile = 0;
		for (x = 0; x < P.ventBoxW; x++) {
			row = v * P.ventBoxW + x;
			pile += S.toyH[row];
			if (S.toyH[row] > maxPile) maxPile = S.toyH[row];
		}
		if (pile > pileSumMax) pileSumMax = pile;
		if (!(S.venEdV[v] > 0)) continue;
		maxWpx = Math.max(maxWpx, S.venW[v] / GEO.kx);
		hpx = GEO.sy(S.z[c < 0 ? 0 : c]) - GEO.sy(S.z[c < 0 ? 0 : c] + S.venH[v]);
		if (hpx > maxHpx) maxHpx = hpx;
	}
	// section-wide feeding / quiet runs; the style runs are the per-edifice repose a
	// viewer reads, since an always-fed plume vent hides an arc's quiet in the union
	if (feeding) {
		if (!feedRun) feedRuns++;
		feedRun++; quietRun = 0;
		if (feedRun > maxFeed) maxFeed = feedRun;
	} else { quietRun++; feedRun = 0; if (quietRun > maxQuiet) maxQuiet = quietRun; }
	if (arcFeed) quietArc = 0; else { quietArc++; if (quietArc > maxQuietArc) maxQuietArc = quietArc; }
	if (plumeFeed) quietPlume = 0;
	else { quietPlume++; if (quietPlume > maxQuietPlume) maxQuietPlume = quietPlume; }
	if (alive) { aliveFrames++; aliveVentFrames += alive; }
	if (feeding) feedFrames++;
	if (arcFeed) arcFeedFrames++;
	if (plumeFeed) plumeFeedFrames++;
	if (toyNow >= VIS_MIN) visFrames++;
	d = SIM.diag();
	if (!d.ok) k9red++;
	else if (d.worst > worstLedger) worstLedger = d.worst;
}
for (v = 0; v < S.nVen; v++) {
	if (prevCol[v] < 0) continue;
	delta = S.venToyIn[v] - life0[v];
	if (delta > 0) { toyIn += delta; epN++; if (delta > epMax) epMax = delta; }
	if (birthF[v] >= 0) {
		lifeDurs.push(frames - birthF[v]);
		lifeDuties.push(lifeFeed[v] / (frames - birthF[v]));
	}
}
function median(a) {
	if (!a.length) return 0;
	var s = a.slice().sort(function (p, q) { return p - q; }), m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

var HEAD = ['f', 'seed', 'kyr', 'Vbirth', 'tauVent', 'Vdie', 'births', 'deaths', 'arcBirths',
	'plumeBirths', 'duty%', 'visDuty%', 'arcDuty%', 'plumeDuty%', 'starved%', 'maxIdle Myr',
	'feedRuns', 'maxFeed f', 'maxQuiet f', 'maxQuiet Myr', 'maxQuietArc Myr',
	'maxQuietPlume Myr', 'lives', 'medLife f', 'medLifeDuty%', 'medGap Myr',
	'epMax cells2', 'epMean cells2', 'toyIn cells2', 'edW px', 'edH px',
	'pile cells2', 'sill m2', 'idle m2', 'lost m2', 'K9 red', 'ledgerErr', 'hash'].join('\t');
function pc(n) { return (100 * n / frames).toFixed(1); }
function myr(n) { return (n * kyr / 1e3).toFixed(2); }
var ROW = [frames, seed, kyr, P.Vbirth, P.tauVent, P.Vdie, births, deaths, arcBirths, plumeBirths,
	pc(feedFrames), pc(visFrames), pc(arcFeedFrames), pc(plumeFeedFrames),
	aliveVentFrames ? (100 * starvedFrames / aliveVentFrames).toFixed(1) : '0', maxIdleMyr.toFixed(2),
	feedRuns, maxFeed, maxQuiet, myr(maxQuiet), myr(maxQuietArc), myr(maxQuietPlume),
	lifeDurs.length, median(lifeDurs).toFixed(0), (100 * median(lifeDuties)).toFixed(0),
	(median(lifeGaps) * kyr / 1e3).toFixed(2),
	epMax.toFixed(1), epN ? (toyIn / epN).toFixed(1) : '0', toyIn.toFixed(0),
	maxWpx.toFixed(1), maxHpx.toFixed(1), pileSumMax.toFixed(0),
	S.meltSill.toExponential(2), S.meltIdle.toExponential(2), S.venLost.toExponential(2),
	k9red, k9red ? '-' : worstLedger.toExponential(2), S.hash()].join('\t');

console.log(HEAD);
console.log(ROW);
console.log('leg: ' + frames + ' frames (' + (frames * kyr / 1e3).toFixed(0) + ' Myr), seed ' +
	seed + ', ' + kyr + ' kyr/frame, eruptive ' + P.sl.erupt + ' s/frame (' + (P.sl.erupt / 60) +
	' min); Vbirth ' + P.Vbirth + ' km3, tauVent ' + P.tauVent + ' Myr, Vdie ' + P.Vdie + ' km3' +
	(isFinite(VB) || isFinite(TV) || isFinite(VD) ? ' (overridden)' : ' (committed)'));
console.log('supply ' + ((S.meltArc + S.meltPlume) / P.venKm3M2 / (frames * kyr / 1e3)).toFixed(1) +
	' km3/Myr (arc ' + (S.meltArc / P.venKm3M2 / (frames * kyr / 1e3)).toFixed(1) + ', plume ' +
	(S.meltPlume / P.venKm3M2 / (frames * kyr / 1e3)).toFixed(1) + '); deaths bank episodes, ' +
	'the last open ones are banked at the end of the run');
console.log('duty is frames with any feeding vent; visDuty needs >= ' + VIS_MIN +
	' cells2 into the box that frame; the style splits count frames where that style feeds');
console.log('starved% is the share of alive vent-frames whose venIdle counter is running ' +
	'(the post-fill chamber below Vdie); maxIdle Myr is the furthest any counter got');
console.log('lives are slot birth->death intervals (open ones banked at the run end): medLife ' +
	'is the median life length in frames, medLifeDuty the median share of those frames ' +
	'feeding, medGap the median same-slot repose between death and the next birth');
