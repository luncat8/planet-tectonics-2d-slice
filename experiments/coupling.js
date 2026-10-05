// coupling.js — the coupling envelope and the pack sequence that drives it: 0.4.1-plan.md
// §8.3 (the message), §8.1 (the join key and the reconcile ledger C4 must book) and §9.5
// (the cadence N and the import-cost budget, which the plan leaves to an experiment).
//
// The globe's role is played by the pinned world itself, advanced and re-cut every cadence:
// that is exactly the pack sequence the plan says is enough to gate the protocol without a
// live channel. The section's role is the same cut, re-laid and then evolving on its own
// clock. The two are the same engine here, so the numbers below are a lower bound on what a
// 3D globe would send; what they measure is the envelope, the join and the cost, not the
// geology of a real planet.
//
// Run: node experiments/coupling.js
'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var COUP = M.coupling, SP = require('../port/slice-format.js');
var S = M.state, P = M.params, SIM = M.sim, SEED = M['section-seed'], COL = M.columns, SURF = M.surface, GEO = M.geom;
var FIX = require('./pack-fixture.js');
var CLOG = require('../js/core-log.js');
var KM = 1000;
var GLOBE_YR = 50e3;       // the globe's clock: 50 kyr per frame, 100 frames per cadence
var SECTION_YR = 25e3;     // the section's own clock, half the rate, twice the frames
var MESSAGES = 20;

function copy(msg) { return JSON.parse(COUP.json(msg)); }
// A structural mutation is recomputed under its own checksum first, so what refuses it is the
// rule and not the body it broke; a body that cannot even be serialised is refused too.
function refuses(tag, mutate, keepChecksum) {
	var m = copy(msg0), why;
	mutate(m);
	if (!keepChecksum) {
		try { m.checksum = COUP.checksum(m); } catch (e) { m.checksum = ''; }
	}
	try { why = COUP.validate(m); } catch (e) { why = 'threw: ' + e.message; }
	check.ok('refuses ' + tag, why !== '', why || 'accepted');
}
// the plate runs of §8.3, counted straight off the pack: the message must not merge two runs
// whose boundary type or polarity differs, because those are what the section's edges need
function packRuns(pack) {
	var n = 1, i;
	for (i = 1; i < pack.n; i++) {
		if (pack.plate[i] !== pack.plate[i - 1] || pack.bnd[i] !== pack.bnd[i - 1] ||
			pack.pol[i] !== pack.pol[i - 1]) n++;
	}
	return n;
}

check.section('A. the envelope derived from a verified cut');
var pack0 = FIX.pinned();
// the pack's f32 fields carry float32 noise a quantised message cannot: compare against the
// pack a JSON round trip would hand anyone else
var q0 = SP.decode(SP.encode(pack0));
var msg0 = COUP.fromPack(q0);
check.ok('a message derived from a cut validates', COUP.validate(msg0) === '', COUP.validate(msg0));
check.ok('it names the geographic path it came from and matches no other',
	msg0.pathChecksum === COUP.pathChecksum(q0) && COUP.matches(msg0, q0));
check.ok('the path identity is independent of sampled fields and source resolution',
	function () {
		var other = JSON.parse(JSON.stringify(q0));
		other.path.cellKm *= 0.5;
		other.hFelM[0] += 1000;
		return COUP.pathChecksum(other) === msg0.pathChecksum;
	}());
check.ok('its clock, epoch and sea are the pack\'s',
	msg0.tMyr === q0.source.tMyr && msg0.epochMa === q0.source.epochMa &&
	msg0.sea.mode === q0.sea.mode && msg0.sea.levelM === q0.sea.levelM,
	't ' + msg0.tMyr + ' Myr, epoch ' + msg0.epochMa);
var worst = 0, i;
for (i = 0; i < q0.n; i++) {
	var c = msg0.crust[i];
	// the f32 fields lose the six-digit rounding in storage, so the comparison is against
	// what the pack's own numbers round to, which is what the message carries
	worst = Math.max(worst, Math.abs(c.s0Km - q0.sKm[i]), Math.abs(c.hFelM - q0.hFelM[i]),
		Math.abs(c.hMafM - q0.hMafM[i]), Math.abs(c.hSedM - q0.hSedM[i]),
		Math.abs(c.ageMyr - SP.round(q0.ageMyr[i])), Math.abs(c.fert - SP.round(q0.fert[i])),
		Math.abs(c.damage - SP.round(q0.damage[i])));
	worst = Math.max(worst, Math.abs(c.s1Km - (i + 1 < q0.n ? q0.sKm[i + 1] : q0.path.arcKm)));
}
check.ok('its crust table is the pack\'s own numbers, interval for interval',
	msg0.crust.length === q0.n && worst === 0, 'worst ' + worst.toExponential(2));
check.ok('its plate intervals split where plate, boundary or polarity changes',
	msg0.plates.length === packRuns(q0), msg0.plates.length + ' intervals over ' + q0.n + ' samples');
check.ok('every plate interval carries a mean motion and a boundary code',
	msg0.plates.every(function (r) {
		return r.id >= 0 && isFinite(r.vt) && r.vp >= 0 && r.bnd >= 0 && r.bnd <= SP.EDGE.collide && Math.abs(r.pol) <= 1;
	}));
var trenchCount = 0;
for (i = 0; i < q0.n; i++) if (q0.bnd[i] === SP.EDGE.subduct) trenchCount++;
var expectedTrenches = [];
for (i = 0; i < q0.n; i++) {
	if (q0.bnd[i] === SP.EDGE.subduct) {
		expectedTrenches.push(i + 1 < q0.n ? SP.round(q0.sKm[i + 1]) : SP.round(q0.path.arcKm));
	}
}
check.ok('trench coordinates name the crossing at each sample-span end',
	msg0.trenches.length === trenchCount && msg0.trenches.length === expectedTrenches.length &&
	msg0.trenches.every(function (s, k) { return s === expectedTrenches[k]; }),
	msg0.trenches.length + ' crossings');
var fel = 0, maf = 0, sed = 0;
for (i = 0; i < q0.n; i++) {
	var w = (msg0.crust[i].s1Km - msg0.crust[i].s0Km) * KM;
	fel += q0.hFelM[i] * w; maf += q0.hMafM[i] * w; sed += q0.hSedM[i] * w;
}
check.near('its ledger is the cut\'s own crust volume per unit width', msg0.ledger.fel, fel, 1e-5);
check.near('the mafic ledger is the cut\'s too', msg0.ledger.maf, maf, 1e-5);
check.near('the sediment ledger is the cut\'s too', msg0.ledger.sed, sed, 1e-5);
var text0 = COUP.json(msg0), back = COUP.parse(text0);
check.ok('a message round-trips through JSON exactly',
	COUP.checksum(back) === msg0.checksum && JSON.stringify(COUP.body(back)) === JSON.stringify(COUP.body(msg0)));
check.ok('quantising an already quantised message changes nothing',
	COUP.checksum(COUP.quantize(copy(msg0))) === msg0.checksum);
check.info('message size', text0.length + ' chars: ' + msg0.crust.length + ' crust and ' +
	msg0.plates.length + ' plate intervals');

check.section('B. what a message may not be');
refuses('a foreign format', function (m) { m.format = 'pgt-pack'; });
refuses('a future version', function (m) { m.version = 2; });
refuses('a path checksum that is not 16 hex digits', function (m) { m.pathChecksum = 'nope'; });
refuses('a negative clock', function (m) { m.tMyr = -1; });
refuses('no sea', function (m) { m.sea = null; });
refuses('a plate interval that does not advance', function (m) { m.plates[0].s1Km = m.plates[0].s0Km; });
refuses('a plate table with a gap', function (m) { m.plates[1].s0Km += 1; });
refuses('two tables that end at different arcs', function (m) { m.crust[m.crust.length - 1].s1Km -= 1; });
refuses('a crust interval with a negative thickness', function (m) { m.crust[2].hFelM = -1; });
refuses('a negative age', function (m) { m.crust[2].ageMyr = -1; });
refuses('an infinite plate id', function (m) { m.plates[0].id = Infinity; });
refuses('an infinite crust thickness', function (m) { m.crust[2].hFelM = Infinity; });
refuses('an infinite crust age', function (m) { m.crust[2].ageMyr = Infinity; });
refuses('damage above one', function (m) { m.crust[2].damage = 1.5; });
refuses('a boundary code that is not one', function (m) { m.plates[0].bnd = 9; });
refuses('a polarity out of range', function (m) { m.plates[0].pol = 4; });
refuses('a fractional polarity code', function (m) { m.plates[0].pol = 0.5; });
refuses('no trench table', function (m) { delete m.trenches; });
refuses('a trench past the end of the cut', function (m) { m.trenches = [m.crust[m.crust.length - 1].s1Km + 1]; });
refuses('unsorted trenches', function (m) { m.trenches = [100, 50]; });
refuses('a negative ledger', function (m) { m.ledger.sed = -1; });
refuses('an edited body that keeps the old checksum', function (m) { m.ledger.fel += 1; }, true);
check.ok('a message for another cut is refused by the guard, not blended',
	!COUP.matches(msg0, { checksum: '0123456789abcdef' }));
var stripped = copy(msg0);
delete stripped.checksum;
var parseRefused = false;
try { COUP.parse(JSON.stringify(stripped)); } catch (e) { parseRefused = true; }
check.ok('a wire message with no checksum at all is refused by parse', parseRefused);

check.section('C. the pack sequence: ' + MESSAGES + ' messages at the plan cadence');
check.planet(23);
var laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
SIM.t = pack0.source.tMyr; SIM.cool();
SIM.setGeo(GLOBE_YR);
var globeFrames = Math.round(COUP.CADENCE_MYR / (GLOBE_YR / 1e6));
var packs = [pack0], msgs = [msg0], sizes = [], pathId = msg0.pathChecksum;
for (i = 1; i <= MESSAGES; i++) {
	SIM.run(globeFrames);
	var pack = SEED.exportSection({ pack: 'coupling-seq' });
	packs.push(pack);
	msgs.push(COUP.fromPack(pack, { pathChecksum: pathId }));
	sizes.push(COUP.json(msgs[i]).length);
}
var allValid = true, allNew = true, monotone = true;
for (i = 1; i <= MESSAGES; i++) {
	if (COUP.validate(msgs[i]) !== '') allValid = false;
	if (msgs[i].checksum === msgs[i - 1].checksum) allNew = false;
	if (!(msgs[i].tMyr > msgs[i - 1].tMyr)) monotone = false;
}
check.ok('every message of the sequence validates', allValid, MESSAGES + ' derived messages');
check.ok('the sequence advances the globe\'s clock one cadence a step', monotone,
	'from ' + msgs[0].tMyr + ' to ' + msgs[MESSAGES].tMyr + ' Myr');
check.ok('every message is its own cut', allNew);
check.ok('re-deriving a message from the same pack and path is the same message',
	COUP.checksum(COUP.fromPack(packs[7], { pathChecksum: pathId })) === msgs[7].checksum, 'message 7');
check.info('message size over the sequence',
	Math.round(sizes.reduce(function (a, b) { return a + b; }, 0) / sizes.length) + ' chars mean, ' +
	sizes[0] + '..' + Math.max.apply(null, sizes));

check.section('D. the section\'s half: the join, the deltas and the import budget');
// a self-message: what the section says about itself cannot be news to it
var self = COUP.fromPack(SEED.exportSection({ pack: 'coupling-self' }));
var selfD = COUP.deltas(S, self, { nCut: SEED.nCut, cellKm: pack0.path.cellKm });
// a self-message is what the section said about itself a moment ago, so the only delta left is
// the pack's own integer metre: the format stores thickness as i32, and the message carries it
check.ok('a message derived from the section itself books nothing but the format\'s own metre',
	selfD.matched === SEED.nCut && selfD.unmatched === 0 && selfD.dMax <= 0.5 + 1e-9,
	'max thickness delta ' + selfD.dMax.toFixed(3) + ' m over ' + selfD.matched + ' columns');

// The section's own run: re-laid from the first cut, then advanced on its own clock, which is
// half the globe's rate over twice the frames. That is what makes a delta exist at all in a
// two-document world where both sides are this engine.
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
SIM.t = pack0.source.tMyr; SIM.cool();
SIM.setGeo(SECTION_YR);
var sectionFrames = Math.round(COUP.CADENCE_MYR / (SECTION_YR / 1e6));
var worstJoin = 0, moves = 0, first = null, previous = null;
var grown = 0, shrunk = 0, ageMoves = 0, leadOk = true;
for (i = 1; i <= MESSAGES; i++) {
	SIM.run(sectionFrames);
	var d = COUP.deltas(S, msgs[i], { nCut: SEED.nCut, cellKm: pack0.path.cellKm });
	if (i === 1) first = d;
	previous = d;
	worstJoin = Math.max(worstJoin, d.unmatched);
	moves += d.grew + d.shrank;
	grown += d.growVol; shrunk += d.shrinkVol;
	ageMoves += d.ageMoves;
	if (COUP.clockOk(SIM.t, msgs[i]) !== '') leadOk = false;
}
check.ok('every column joins the message interval that covers it', worstJoin === 0,
	SEED.nCut + ' columns, ' + moves + ' thickness moves over ' + MESSAGES + ' messages');
check.ok('the section never runs ahead of the last message by more than the cadence', leadOk,
	'cadence ' + COUP.CADENCE_MYR + ' Myr, section clock ' + SIM.t.toFixed(2) + ' Myr');
check.ok('the reconcile the sequence would book stays smaller than the crust it corrects',
	Math.abs(previous.growVol) < 1e12 && Math.abs(previous.shrinkVol) < 1e12,
	'first message +' + (first.growVol / 1e6).toFixed(1) + ' / ' + (first.shrinkVol / 1e6).toFixed(1) +
	' Mm3/m, last +' + (previous.growVol / 1e6).toFixed(1) + ' / ' + (previous.shrinkVol / 1e6).toFixed(1) +
	' Mm3/m, ' + ageMoves + ' age moves');
check.info('deltas per message (m, globe minus section)',
	'max ' + previous.dMax.toFixed(0) + ', age max ' + previous.dAgeMax.toFixed(3) + ' Myr, ' +
	previous.ageMoves + ' of ' + previous.matched + ' columns moved');

// the join's spacing rule, on a message that is the same one a drag away. The join's own
// spacing is the message's (the pack's cellKm), so a drag is measured against 2 x that.
function shifted(msg, km) {
	var m = copy(msg), i;
	for (i = 0; i < m.crust.length; i++) {
		m.crust[i].s0Km = SP.round(m.crust[i].s0Km + km);
		m.crust[i].s1Km = SP.round(m.crust[i].s1Km + km);
	}
	m.checksum = COUP.checksum(m);
	return m;
}
// The spacing rule is a distance, not a nearest neighbour: a message that keeps only every
// sixteenth interval leaves spans wider than JOIN_SPACING local spacings, and the columns in
// them must stay unjoined rather than be handed a stack that is half a ring away. A message
// that tiles its own ring always joins, however it is dragged — that is the rule, not a bug.
var spacing = P.w0 / KM;
var sparse = copy(msgs[1]);
sparse.crust = sparse.crust.filter(function (r, k) { return k % 16 === 0; });
sparse.checksum = COUP.checksum(sparse);
var gap = COUP.deltas(S, sparse, { nCut: SEED.nCut, cellKm: spacing });
check.ok('a message with spans wider than the join radius leaves those columns unjoined',
	gap.matched > 0 && gap.unmatched > SEED.nCut * 0.5,
	gap.matched + ' of ' + SEED.nCut + ' columns joined, ' + gap.unmatched +
	' left at a ' + spacing.toFixed(1) + ' km join spacing');
var openPack = SP.decode(SP.encode(FIX.windowCut(64, 8, 12400)));
var openMsg = COUP.fromPack(openPack), openArc = openPack.path.arcKm, openTrenches = [];
for (i = 0; i + 1 < openPack.n; i++) {
	if (openPack.bnd[i] === SP.EDGE.subduct) openTrenches.push(SP.round(openPack.sKm[i + 1]));
}
check.ok('an open cut omits a false trench at its un-crossed terminal endpoint',
	openMsg.trenches.length === openTrenches.length && openMsg.trenches.every(function (s, k) {
		return s === openTrenches[k] && s < openArc;
	}), openMsg.trenches.length + ' interior crossings');
var beyondOpen = openArc + 4 * openPack.path.cellKm;
check.ok('the geographic join does not wrap an open window across its endpoints',
	COUP.joinTo(openMsg, beyondOpen, openPack.path.cellKm, false) < 0 &&
	COUP.joinTo(openMsg, beyondOpen, openPack.path.cellKm, true) >= 0,
	'open ' + COUP.joinTo(openMsg, beyondOpen, openPack.path.cellKm, false) +
	', periodic ' + COUP.joinTo(openMsg, beyondOpen, openPack.path.cellKm, true));

// The import budget of §9.5: what the cheap path costs, and the identity it must not break.
var costMs = [], lastLedger = null, t0, i0;
for (i = 0; i <= MESSAGES; i++) {
	t0 = process.hrtime.bigint();
	SEED.layout(packs[i], { seed: P.seed, t: packs[i].source.tMyr, Tm: P.Tm0 });
	costMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
var meanCost = costMs.reduce(function (a, b) { return a + b; }, 0) / costMs.length;
var maxCost = Math.max.apply(null, costMs);
SEED.ledger(packs[MESSAGES]);
var lastLedger = { seedMass: SEED.seedMass, cutMass: SEED.cutMass };
check.ok('a hard reset import keeps the ledger the message carried',
	lastLedger.seedMass > 0 && Math.abs(lastLedger.seedMass - lastLedger.cutMass) / lastLedger.cutMass < 1e-9,
	'seed ' + Math.round(lastLedger.seedMass) + ' of cut ' + Math.round(lastLedger.cutMass) + ' m3/m');
check.ok('the import cost is finite and inside a frame budget at this resolution',
	isFinite(meanCost) && meanCost < 250,
	'mean ' + meanCost.toFixed(1) + ' ms, worst ' + maxCost.toFixed(1) + ' ms over ' + costMs.length + ' layout imports');

// ---------------------------------------------------------------- M5 C4: guarded, bed-preserving apply
check.section('E. apply refusals are atomic and a matched reconcile edits beds');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
SIM.t = pack0.source.tMyr; SIM.cool();
SIM.setGeo(SECTION_YR);

var ownPack = SEED.exportSection({ pack: 'coupling-apply-self' });
var ownMsg = COUP.fromPack(ownPack, { pathChecksum: pathId });
var growMsg = copy(ownMsg), growM = 250, growVol = 0;
for (i = 0; i < growMsg.crust.length; i++) {
	growMsg.crust[i].hFelM += growM;
	growVol += growM * (growMsg.crust[i].s1Km - growMsg.crust[i].s0Km) * KM;
}
growMsg.ledger.fel = SP.round(growMsg.ledger.fel + growVol);
growMsg.checksum = COUP.checksum(growMsg);

function applyOpts(n) {
	return { nCut: n, cellKm: P.w0 / KM, pathChecksum: pathId, pack: pack0 };
}
function crustMass(n) {
	var m = 0;
	for (var j = 0; j < n; j++) m += S.hTot[j] * S.colW[j];
	return m;
}
function bedIdentities(n) {
	var out = new Array(n), LC = P.layerCap, j, k, b;
	for (j = 0; j < n; j++) {
		out[j] = [];
		b = j * LC;
		for (k = 0; k < S.colNL[j]; k++) {
			out[j].push(S.layLi[b + k] + '/' + S.layAg[b + k] + '/' + S.layFl[b + k]);
		}
	}
	return out;
}
function retainedColumns(before, n) {
	var kept = 0, eligible = 0, LC = P.layerCap, j, k, b, key;
	for (j = 0; j < n && j < before.length; j++) {
		if (!before[j].length) continue;
		eligible++;
		b = j * LC;
		for (k = 0; k < S.colNL[j]; k++) {
			key = S.layLi[b + k] + '/' + S.layAg[b + k] + '/' + S.layFl[b + k];
			if (before[j].indexOf(key) >= 0) { kept++; break; }
		}
	}
	return { kept: kept, eligible: eligible };
}

var stateHash = S.hash(), reconJSON = JSON.stringify(S.recon);
var unsigned = copy(growMsg);
delete unsigned.checksum;
var refused = COUP.apply(S, unsigned, applyOpts(S.nCol));
check.ok('an unsigned in-memory message is refused before state mutation',
	/checksum/.test(refused) && S.hash() === stateHash && JSON.stringify(S.recon) === reconJSON, refused);
var foreign = copy(growMsg);
foreign.pathChecksum = '0123456789abcdef';
foreign.checksum = COUP.checksum(foreign);
refused = COUP.apply(S, foreign, applyOpts(S.nCol));
check.ok('a message for another path is refused before state mutation',
	/pathChecksum/.test(refused) && S.hash() === stateHash && JSON.stringify(S.recon) === reconJSON, refused);
var wrongArc = copy(growMsg), lastInterval = wrongArc.crust.length - 1;
wrongArc.crust[lastInterval].s1Km -= 1;
wrongArc.plates[wrongArc.plates.length - 1].s1Km -= 1;
var wrongEnd = wrongArc.crust[lastInterval].s1Km;
wrongArc.trenches = wrongArc.trenches.filter(function (s) { return s <= wrongEnd; });
wrongArc.checksum = COUP.checksum(wrongArc);
refused = COUP.apply(S, wrongArc, applyOpts(S.nCol));
check.ok('a checksummed message whose intervals stop short of the identified cut is refused atomically',
	COUP.validate(wrongArc) === '' && /interval tables/.test(refused) &&
	S.hash() === stateHash && JSON.stringify(S.recon) === reconJSON, refused);
check.ok('a table ending short of the cut is not treated as a path match', !COUP.matches(wrongArc, pack0));
refused = COUP.apply(S, growMsg, applyOpts(0));
check.ok('a page with no reconstructed section cannot report an applied message',
	/no reconstructed section/.test(refused) && S.hash() === stateHash && JSON.stringify(S.recon) === reconJSON, refused);

// Tag a sediment host. Felsic growth inserts below it, so both the bed identity and the
// deposit's shifted layer index must survive if apply is editing the stack rather than caches.
var tagged = -1;
for (i = 0; i < S.nCol; i++) if (S.colNL[i] >= 3) { tagged = i; break; }
if (tagged < 0) throw new Error('fixture has no three-bed column');
var dep = S.nDep++, taggedLayer = S.colNL[tagged] - 1, tb = tagged * P.layerCap + taggedLayer;
S.depCol[dep] = tagged; S.depLay[dep] = taggedLayer;
var taggedKey = S.layLi[tb] + '/' + S.layAg[tb] + '/' + S.layFl[tb];
var taggedThickness = S.layTh[tb];
var applied = COUP.apply(S, growMsg, applyOpts(S.nCol));
check.ok('a checksummed message for the active path applies', applied === '', applied || 'ok');
var movedLayer = S.depLay[dep], mb = tagged * P.layerCap + movedLayer;
var movedKey = S.layLi[mb] + '/' + S.layAg[mb] + '/' + S.layFl[mb];
check.ok('an unrelated bed and its depth-resolved deposit survive matched growth',
	S.depCol[dep] === tagged && movedLayer >= 0 && movedKey === taggedKey &&
		Math.abs(S.layTh[mb] - taggedThickness) <= 0.5 + 1e-9,
	'layer ' + taggedLayer + ' -> ' + movedLayer + ', ' + taggedKey + ' -> ' + movedKey +
	', format adjustment ' + (S.layTh[mb] - taggedThickness).toFixed(3) + ' m');
var eventBed = false;
for (i = 0; i < S.colNL[tagged]; i++) {
	var eventAt = tagged * P.layerCap + i;
	if (S.layLi[eventAt] === P.LITH.fel && S.layAg[eventAt] === growMsg.tMyr &&
		S.layTh[eventAt] > growM - 1 && S.layTh[eventAt] < growM + 1) eventBed = true;
}
check.ok('matched growth is a dated reconcile bed, not cache or seed-bed inflation', eventBed,
	'fel growth dated at globe t ' + growMsg.tMyr + ' Myr');
// an import cannot stamp a bed before the moment it is applied: the section's clock floors it
var aheadMsg = copy(ownMsg), aM = 200, aVol = 0;
for (i = 0; i < aheadMsg.crust.length; i++) {
	aheadMsg.crust[i].hFelM += growM + aM;   // still ahead of the section by one more bed
	aVol += (growM + aM) * (aheadMsg.crust[i].s1Km - aheadMsg.crust[i].s0Km) * KM;
}
aheadMsg.ledger.fel = SP.round(aheadMsg.ledger.fel + aVol);
aheadMsg.checksum = COUP.checksum(aheadMsg);
var tFloor = aheadMsg.tMyr + 7.25;
applied = COUP.apply(S, aheadMsg, { nCut: S.nCol, cellKm: P.w0 / KM, pathChecksum: pathId, tNow: tFloor });
var newestBed = -1;
for (i = 0; i < S.colNL[tagged]; i++) newestBed = Math.max(newestBed, S.layAg[tagged * P.layerCap + i]);
check.ok('a message older than the section clock floors its bed dates at the clock',
	applied === '' && Math.abs(newestBed - tFloor) < 1e-9,
	applied || 'every new bed of that import is dated at t ' + tFloor + ', not ' + aheadMsg.tMyr);
// fresh stacks date the same way as every other bed: the import's floor clock minus the
// rock age of the row that rebuilt it. The coarse table (every 16th interval, widened to
// tile) makes most columns demonstrable rebuilds — joinTo refuses them, so their beds can
// only carry the t − age dating, per the row their arc falls in.
check.ok('a rebuilt column carries the import clock minus the cut\'s rock age',
	(function () {
		var laidX = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
		if (laidX) return false;
		SIM.t = pack0.source.tMyr; SIM.cool();
		var coarse2 = copy(ownMsg), rows2 = [], jj, q;
		for (jj = 0; jj < coarse2.crust.length; jj += 16) {
			var rw = JSON.parse(JSON.stringify(coarse2.crust[jj]));
			rw.s1Km = coarse2.crust[Math.min(jj + 15, coarse2.crust.length - 1)].s1Km;
			rows2.push(rw);
		}
		coarse2.crust = rows2;
		coarse2.checksum = COUP.checksum(coarse2);
		if (COUP.apply(S, coarse2, applyOpts(S.nCol)) !== '') return false;
		if (!(COUP.last.freshColumns > 0)) return false;
		var seen = 0, walk = 0, cellKm = P.w0 / KM;
		var wrap = rows2[rows2.length - 1].s1Km;
		for (jj = 0; jj < S.nCol; jj++) {
			var w = S.colW[jj], mid = (walk + w * 0.5) / KM;
			walk += w;
			if (COUP.joinTo(coarse2, mid, cellKm) >= 0) continue;   // a matched column keeps its stack
			var x = mid - Math.floor(mid / wrap) * wrap, ri = rows2.length - 1;
			for (q = 0; q < rows2.length; q++) if (x >= rows2[q].s0Km && x < rows2[q].s1Km) { ri = q; break; }
			var tf = coarse2.tMyr - rows2[ri].ageMyr, bb = jj * P.layerCap, nn = S.colNL[jj];
			var want = 0;
			if (rows2[ri].hMafM > 0) want++;
			if (rows2[ri].hFelM > 0) want++;
			if (rows2[ri].hSedM > 0) want++;
			if (nn !== want) return false;
			for (q = 0; q < nn; q++) if (S.layAg[bb + q] !== tf) return false;
			seen++;
		}
		return seen === COUP.last.freshColumns && seen > 100;
	})(), 'equal beds dated t − age at every rebuilt column, none missed');
// The reader's mirror of the same fact: with seeded, matched and rebuilt columns sharing one
// array, the log this state would send must build valid and survive its own acceptance rules.
check.ok('a coarse table rebuilding unmatched stacks still logs clean',
	(function () {
		var log = CLOG.build(S, {
			n: S.nCol, all: true, arcKm: pack0.path.arcKm,
			pathChecksum: COUP.pathChecksum(pack0), packChecksum: pack0.checksum,
			tMyr: SIM.t, epochMa: pack0.source.epochMa
		});
		if (!log || log.records.length < 300) return false;
		try { return CLOG.parse(CLOG.json(log)).checksum === log.checksum; } catch (e) { return false; }
	})(), 'one law for seeded, grown and rebuilt columns');
var massAfterApply = crustMass(S.nCol), hAfterApply = S.hTot[tagged];
COL.sumsAll();
check.ok('the imported aggregate is derived from beds and survives COL.sums',
	Math.abs(crustMass(S.nCol) - massAfterApply) <= 1e-12 * massAfterApply && S.hTot[tagged] === hAfterApply,
	'crust ' + Math.round(massAfterApply) + ' m3/m, tagged ' + hAfterApply.toFixed(3) + ' m');
check.ok('the apply ledger closes old + in - out = new to 1e-9',
	Math.abs(COUP.last.identityError) <= 1e-9 * Math.max(1, COUP.last.after),
	'error ' + COUP.last.identityError.toExponential(3) + ' over ' + COUP.last.after.toExponential(3));

// A valid but coarse table still tiles the arc. Its broad interval midpoints deliberately
// exceed the join radius for most columns: those stacks must be retired and rebuilt, with both
// volumes named and the same identity closed.
var coarse = copy(ownMsg), coarseRows = [];
for (i = 0; i < coarse.crust.length; i += 16) {
	var coarseRow = JSON.parse(JSON.stringify(coarse.crust[i]));
	coarseRow.s1Km = coarse.crust[Math.min(i + 15, coarse.crust.length - 1)].s1Km;
	coarseRows.push(coarseRow);
}
coarse.crust = coarseRows;
coarse.checksum = COUP.checksum(coarse);
applied = COUP.apply(S, coarse, applyOpts(S.nCol));
check.ok('a coarse valid table exercises the fresh/retired branch without refusal',
	applied === '' && COUP.last.matched > 0 && COUP.last.freshColumns > 0, applied ||
	(COUP.last.matched + ' matched, ' + COUP.last.freshColumns + ' fresh'));
check.ok('fresh and retired are volumes and close the same mass identity',
	COUP.last.fresh > 0 && COUP.last.retired > 0 &&
	Math.abs(COUP.last.identityError) <= 1e-9 * Math.max(1, COUP.last.after),
	'fresh ' + Math.round(COUP.last.fresh) + ', retired ' + Math.round(COUP.last.retired) +
	', error ' + COUP.last.identityError.toExponential(3));

check.section('F. the real 20-import cycle: evolve, reconcile, retain');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
SIM.t = pack0.source.tMyr; SIM.cool();
SIM.setGeo(SECTION_YR);
var worstIdentity = 0, worstCache = 0, minRetention = 1;
var totalMatched = 0, totalFreshColumns = 0, totalRetiredColumns = 0;
var cumulativeOk = true, previousReconciled = S.recon.reconciled;
for (i = 1; i <= MESSAGES; i++) {
	SIM.run(sectionFrames);
	var nLive = S.nCol;
	var bedsBefore = bedIdentities(nLive);
	var applyRes = COUP.apply(S, msgs[i], applyOpts(nLive));
	check.ok('message ' + i + ' applies cleanly', applyRes === '', applyRes || 'refused');
	if (applyRes) continue;
	var relIdentity = Math.abs(COUP.last.identityError) / Math.max(1, COUP.last.after);
	if (relIdentity > worstIdentity) worstIdentity = relIdentity;
	var cachedMass = crustMass(nLive);
	COL.sumsAll();
	var relCache = Math.abs(crustMass(nLive) - cachedMass) / Math.max(1, cachedMass);
	if (relCache > worstCache) worstCache = relCache;
	var retained = retainedColumns(bedsBefore, nLive);
	var retention = retained.eligible ? retained.kept / retained.eligible : 1;
	if (retention < minRetention) minRetention = retention;
	var post = COUP.deltas(S, msgs[i], { nCut: nLive, cellKm: P.w0 / KM });
	check.ok('apply ' + i + ' leaves matched bed aggregates on their targets',
		post.dMax < 1e-7, 'max residual ' + post.dMax.toExponential(2) + ' m');
	if (S.recon.reconciled < previousReconciled) cumulativeOk = false;
	previousReconciled = S.recon.reconciled;
	totalMatched += COUP.last.matched;
	totalFreshColumns += COUP.last.freshColumns;
	totalRetiredColumns += COUP.last.retiredColumns;
}
check.ok('all 20 mass identities close to 1e-9 relative', worstIdentity < 1e-9,
	'worst relative error ' + worstIdentity.toExponential(3));
check.ok('recomputing every aggregate from beds cannot undo an import', worstCache < 1e-12,
	'worst relative cache change ' + worstCache.toExponential(3));
check.ok('matched columns retain their bed identities through the sequence', minRetention > 0.95,
	'worst import retained ' + (100 * minRetention).toFixed(1) + '% of non-empty columns');
check.ok('the cumulative reconcile ledger never resets between imports',
	cumulativeOk && S.recon.reconciled > 0 && S.recon.diverged > 0,
	'reconciled ' + Math.round(S.recon.reconciled) + ', diverged ' + Math.round(S.recon.diverged) + ' m3/m');
(function () {
	var why = '';
	for (var jj = 0; jj < S.nCol && !why; jj++) {
		var nll = S.colNL[jj];
		if (nll <= 0) continue;
		why = CLOG.strataOK(nll, S.layTh, S.layLi, S.layAg, S.layFl, jj * P.layerCap) || '';
		if (why) why = 'column ' + jj + ': ' + why;
	}
	check.ok('twenty imports of evolution leave the strata of every column legal under the §8.5 rule',
		why === '', why || 'all columns');
})();
check.ok('fresh and retired are measured volumes and unmatched columns stay bounded',
	S.recon.fresh >= 0 && S.recon.retired >= 0 && totalFreshColumns < totalMatched,
	'total matched ' + totalMatched + ', fresh cols ' + totalFreshColumns +
	', retired cols ' + totalRetiredColumns + ', fresh volume ' + Math.round(S.recon.fresh));

check.section('G. C3 owns K2 while the live message is active');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var kinematic = copy(msgs[1]), prescribed = 12345;
for (i = 0; i < kinematic.plates.length; i++) kinematic.plates[i].vt = prescribed;
kinematic.checksum = COUP.checksum(kinematic);
for (i = 0; i < S.nPl; i++) { S.plU[i] = 0; S.plUP[i] = 0; }
COUP.activate(kinematic, 0);
SIM.kinematic = COUP.k2;
SIM.k[2](S, 0.025, SIM.t, SIM.Tm);
var slaveExact = true;
for (i = 0; i < S.nPl; i++) if (Math.abs(S.plU[i] - prescribed) > 1e-9) slaveExact = false;
for (i = 0; i < S.nCol; i++) if (Math.abs(S.colU[i] - prescribed) > 1e-9) slaveExact = false;
check.ok('the active coupling prescribes rigid plate and column velocities in K2', slaveExact,
	S.nPl + ' plates at ' + prescribed + ' m/Myr');
var beforePaused = S.plU[0];
SIM.k[2](S, 0, SIM.t, SIM.Tm);
check.ok('a zero clock leaves prescribed kinematics still', S.plU[0] === beforePaused);
COUP.deactivate();
check.ok('deactivation returns K2 ownership to the standalone solver', COUP.k2(S, 0.025) === false);
SIM.kinematic = null;

check.section('H. the accepted sea datum follows the globe snapshot');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var land = 0;
while (land < S.nCol && !(S.hTot[land] > 0 && S.z[land] >= 0)) land++;
if (land >= S.nCol) throw new Error('fixture has no dry crust column');
var landZ = S.z[land], seaMsg = copy(msg0);
seaMsg.sea.levelM = SP.round(landZ + Math.max(100, Math.abs(landZ) * 0.01));
seaMsg.checksum = COUP.checksum(seaMsg);
var seaApplied = COUP.apply(S, seaMsg, applyOpts(S.nCol));
SURF.profile(0);
var wetMatches = true;
for (i = 0; i < S.nCol; i++) if (S.wet[i] !== (S.z[i] < S.seaLevel ? 1 : 0)) wetMatches = false;
check.ok('a valid import applies its sea level without jumping the section surface',
	seaApplied === '' && S.seaLevel === seaMsg.sea.levelM && S.z[land] === landZ &&
	S.hDraw[land] === S.hTot[land], seaApplied || 'sea ' + S.seaLevel + ' m, surface ' + S.z[land] + ' m');
check.ok('wet flags follow the imported datum now and in later surface passes',
	wetMatches && S.wet[land] === 1, 'column ' + land + ' at ' + landZ.toFixed(1) + ' m, sea ' + S.seaLevel + ' m');

check.section('I. boundary and polarity updates follow the globe snapshot');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var boundaryMsg = copy(msg0), boundaryRow = -1, seam = -1, totalWidth = 0, bestDistance = Infinity;
for (i = 0; i < boundaryMsg.plates.length; i++) {
	if (boundaryMsg.plates[i].bnd === SP.EDGE.collide) { boundaryRow = i; break; }
}
if (boundaryRow < 0) throw new Error('fixture has no collision boundary to change');
for (i = 0; i < S.nCol; i++) totalWidth += S.colW[i];
var eventX = boundaryMsg.plates[boundaryRow].s1Km * KM *
	totalWidth / (boundaryMsg.plates[boundaryMsg.plates.length - 1].s1Km * KM);
var edgeWalk = 0, expectedRibbonX, ribbonGap;
for (i = 0; i < S.nCol; i++) {
	var edgeDistance = Math.abs(eventX - (edgeWalk + S.colW[i]));
	if (edgeDistance > totalWidth * 0.5) edgeDistance = totalWidth - edgeDistance;
	if (edgeDistance < bestDistance) { bestDistance = edgeDistance; seam = i; }
	edgeWalk += S.colW[i];
}
var rightAtSeam = (seam + 1) % S.nCol;
ribbonGap = S.colX[rightAtSeam] - S.colX[seam];
if (ribbonGap < 0) ribbonGap += P.wrap;
expectedRibbonX = S.colX[seam] + ribbonGap * 0.5;
expectedRibbonX -= Math.floor(expectedRibbonX / P.wrap) * P.wrap;
boundaryMsg.plates[boundaryRow].bnd = SP.EDGE.subduct;
boundaryMsg.plates[boundaryRow].pol = -1;
boundaryMsg.checksum = COUP.checksum(boundaryMsg);
var boundaryApplied = COUP.apply(S, boundaryMsg, applyOpts(S.nCol));
check.ok('a newly reported subduction edge and its polarity land on the matching section seam',
	boundaryApplied === '' && S.edge[seam] === P.EDGE.subduct && S.edgePol[seam] === -1 &&
	S.edgeRPlate[seam] === S.colPlate[rightAtSeam] && S.nRib === 1 &&
	S.ribDir[0] === 1 && S.ribPlate[0] === S.colPlate[rightAtSeam] &&
	Math.abs(S.ribX0[0] - expectedRibbonX) < 1e-6,
	boundaryApplied || 'edge ' + seam + ', left plate ' + S.colPlate[seam] +
	', overriding plate ' + S.colPlate[rightAtSeam] + ', ribbon x ' + S.ribX0[0] + ', ribbons ' + S.nRib);
S.edgeAge[seam] = 2.5;
boundaryApplied = COUP.apply(S, boundaryMsg, applyOpts(S.nCol));
check.ok('a stable reported crossing preserves its age and does not duplicate its ribbon',
	boundaryApplied === '' && S.edgeAge[seam] === 2.5 && S.nRib === 1,
	boundaryApplied || 'edge age ' + S.edgeAge[seam] + ' Myr, ribbons ' + S.nRib);
boundaryMsg.plates[boundaryRow].bnd = SP.EDGE.open;
boundaryMsg.plates[boundaryRow].pol = 0;
boundaryMsg.checksum = COUP.checksum(boundaryMsg);
boundaryApplied = COUP.apply(S, boundaryMsg, applyOpts(S.nCol));
check.ok('a later boundary-type change is applied without deleting the historical ribbon',
	boundaryApplied === '' && S.edge[seam] === P.EDGE.open && S.edgePol[seam] === 0 &&
	S.edgeAge[seam] === 0 && S.nRib === 1,
	boundaryApplied || 'edge ' + S.edge[seam] + ', polarity ' + S.edgePol[seam] + ', ribbons ' + S.nRib);

laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var pinnedMsg = copy(msg0), pinnedRow = boundaryRow, pinnedSeam = -1;
pinnedMsg.plates[pinnedRow].bnd = SP.EDGE.subduct;
pinnedMsg.plates[pinnedRow].pol = -1;
for (i = 0; i < pinnedMsg.plates.length; i++) pinnedMsg.plates[i].vt = 0;
pinnedMsg.checksum = COUP.checksum(pinnedMsg);
var pinApplied = COUP.apply(S, pinnedMsg, applyOpts(S.nCol));
for (i = 0; i < S.nCol; i++) if (S.edge[i] === P.EDGE.subduct && S.edgePol[i] === -1) { pinnedSeam = i; break; }
COUP.activate(pinnedMsg, 0);
SIM.kinematic = COUP.k2;
S.edgeRelN[pinnedSeam] = 123;
SIM.k[2](S, 0, SIM.t, SIM.Tm);
SIM.k[3](S, 0, SIM.t, SIM.Tm);
SIM.k[4](S, 0, SIM.t, SIM.Tm);
var pausedRelStayed = S.edgeRelN[pinnedSeam] === 123 &&
	S.edge[pinnedSeam] === P.EDGE.subduct && S.edgePol[pinnedSeam] === -1;
var savedTopology = COL.k4;
try {
	SIM.k[2](S, 0.025, SIM.t, SIM.Tm);
	SIM.k[3](S, 0.025, SIM.t, SIM.Tm);
	// A topology event reclassifies with dt=0 after K4; exercise that branch without
	// asking the fixture to create an unrelated ridge or suture.
	COL.k4 = function () { return true; };
	SIM.k[4](S, 0.025, SIM.t, SIM.Tm);
} finally {
	COL.k4 = savedTopology;
}
check.ok('a paused live frame defers edgeRelN refresh; active K3 refreshes it without reclassifying the globe boundary',
	pinApplied === '' && pausedRelStayed && pinnedSeam >= 0 &&
	S.edge[pinnedSeam] === P.EDGE.subduct && S.edgePol[pinnedSeam] === -1 &&
	Math.abs(S.edgeRelN[pinnedSeam]) < 1e-9,
	pinApplied || 'paused refresh ' + pausedRelStayed + ', seam ' + pinnedSeam +
	', type ' + S.edge[pinnedSeam] + ', polarity ' + S.edgePol[pinnedSeam] +
	', active relN ' + S.edgeRelN[pinnedSeam]);
COUP.deactivate();
SIM.kinematic = null;

check.section('J. age changes rebuild the thermal lid at import');
laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var deepRow = 0;
while (deepRow < GEO.N && GEO.rowCy[deepRow] < COL.lithDepth(COL.lidAgeCap)) deepRow++;
if (deepRow >= GEO.N) throw new Error('fixture has no fan row below the lithosphere lid');
var deepCell = GEO.fanOff[deepRow], deepAnomaly = -321.25;
S.Tf[deepCell] = deepAnomaly;
var ageMsg = copy(msg0), ageBefore = S.colAge.slice(0, S.nCol), fanBefore = S.Tf.slice();
var ageChangedColumns = 0, fanChangedCells = 0, lidCalls = 0, plumesBefore = S.nPlm;
for (i = 0; i < ageMsg.crust.length; i++) ageMsg.crust[i].ageMyr += 50;
ageMsg.checksum = COUP.checksum(ageMsg);
var lidFan = COL.lidFan, ageApplied;
COL.lidFan = function () { lidCalls++; return lidFan.apply(COL, arguments); };
try { ageApplied = COUP.apply(S, ageMsg, applyOpts(S.nCol)); }
finally { COL.lidFan = lidFan; }
var fanAtImport = S.Tf.slice();
for (i = 0; i < S.nCol; i++) {
	if (Math.abs(S.colAge[i] - ageBefore[i]) > 0.01) ageChangedColumns++;
}
for (i = 0; i < S.Tf.length; i++) if (Math.abs(fanAtImport[i] - fanBefore[i]) > 1e-9) fanChangedCells++;
check.ok('changed crust ages reapply the lid once at import without erasing deeper thermal anomalies',
	ageApplied === '' && ageChangedColumns > 0 && fanChangedCells > 0 && lidCalls === 1 &&
	S.Tf[deepCell] === deepAnomaly,
	ageApplied || ageChangedColumns + ' columns aged; ' + fanChangedCells + ' fan cells changed; lid calls ' + lidCalls);
check.ok('the age-lid rebuild leaves section plume objects intact', S.nPlm === plumesBefore,
	S.nPlm + ' plumes retained');

check.section('K. open-window imports respect both endpoints');
laid = SEED.layout(openPack, { seed: P.seed, t: openPack.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
var openN = SEED.nCut;
var windowApplied = COUP.apply(S, openMsg, {
	nCut: openN, cellKm: openPack.path.cellKm, pathChecksum: openMsg.pathChecksum, pack: openPack
});
var windowDeltas = COUP.deltas(S, openMsg, {
	nCut: openN, cellKm: openPack.path.cellKm, closed: false
});
check.ok('a snapshot reconciles the open path without joining across its start/end',
	windowApplied === '' && windowDeltas.matched === openN && windowDeltas.dMax < 1e-6 &&
	S.edge[openN - 1] === P.EDGE.none && S.edgeRPlate[openN - 1] === -1,
	windowApplied || openN + ' columns, ' + windowDeltas.matched + ' joined, max ' +
	windowDeltas.dMax.toExponential(2) + ' m, terminal edge ' + S.edge[openN - 1]);

check.done();
