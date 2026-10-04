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
var S = M.state, P = M.params, SIM = M.sim, SEED = M['section-seed'];
var FIX = require('./pack-fixture.js');
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
check.ok('it names the cut it came from and matches no other',
	msg0.pathChecksum === q0.checksum && COUP.matches(msg0, q0));
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
check.ok('its trenches are the cut\'s own subduct samples',
	msg0.trenches.length === trenchCount && msg0.trenches.every(function (s, k) {
		return k === 0 || msg0.trenches[k - 1] <= s;
	}), trenchCount + ' trenches');
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
refuses('damage above one', function (m) { m.crust[2].damage = 1.5; });
refuses('a boundary code that is not one', function (m) { m.plates[0].bnd = 9; });
refuses('a polarity out of range', function (m) { m.plates[0].pol = 4; });
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
var packs = [pack0], msgs = [msg0], sizes = [];
for (i = 1; i <= MESSAGES; i++) {
	SIM.run(globeFrames);
	var pack = SEED.exportSection({ pack: 'coupling-seq' });
	packs.push(pack);
	msgs.push(COUP.fromPack(pack));
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
check.ok('re-deriving a message from the same pack is the same message',
	COUP.checksum(COUP.fromPack(packs[7])) === msgs[7].checksum, 'message 7');
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

check.done();
