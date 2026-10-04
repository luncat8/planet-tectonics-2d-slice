// core-log.js — the §8.5 return path, gated as the globe's side-table will read it: the
// acceptance rules (thicknesses sum, ages monotone across depositional contacts), one bed
// date, the divergence threshold that chooses what to log, and the refusals. Like the
// coupling gate this needs no live channel: the pinned world, advanced and reconciled, is
// the section's state at a cadence, which is all an observation ever is.
// Run: node experiments/core-log.js
'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var CLOG = M['core-log'], COUP = M.coupling, SP = require('../port/slice-format.js');
var S = M.state, P = M.params, SIM = M.sim, SEED = M['section-seed'], COL = M.columns;
var FIX = require('./pack-fixture.js');
var KM = 1000;
var SECTION_YR = 25e3;

check.section('A. the format: one date, one spelling, one checksum');
var pack0 = FIX.pinned();
function seedWorld() {
	var laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
	if (laid) throw new Error(laid);
	SIM.t = pack0.source.tMyr; SIM.cool(); SIM.setGeo(0);
	CLOG.reset();
}
function logOpts(extra) {
	var o = {
		n: SEED.nCut, arcKm: pack0.path.arcKm, pathChecksum: COUP.pathChecksum(pack0),
		packChecksum: pack0.checksum, tMyr: SIM.t, epochMa: pack0.source.epochMa
	};
	if (extra) for (var k in extra) o[k] = extra[k];
	return o;
}
function colOfArc(sKm) {
	var j, walk = 0;
	for (j = 0; j < S.nCol; j++) {
		if (sKm >= walk / KM && sKm < (walk + S.colW[j]) / KM) return j;
		walk += S.colW[j];
	}
	return -1;
}
// the rules the globe runs before it files a record — the section must emit past them
function recordOk(rec) {
	var k, sum = 0;
	for (k = 0; k < rec.beds.length; k++) sum += rec.beds[k][1];
	if (Math.abs(sum - rec.hTotM) > CLOG.TH_TOL) return 'sum ' + sum + ' vs ' + rec.hTotM;
	for (k = 1; k < rec.beds.length; k++) {
		if ((rec.beds[k][3] | rec.beds[k - 1][3]) & P.FLAG.intr) continue;
		if (rec.beds[k][2] < rec.beds[k - 1][2]) return 'age drops at bed ' + k;
	}
	return '';
}
function strataAll() {
	var j, b, LC = P.layerCap;
	for (j = 0; j < S.nCol; j++) {
		if (S.colNL[j] <= 0) continue;
		b = j * LC;
		var why = CLOG.strataOK(S.colNL[j], S.layTh, S.layLi, S.layAg, S.layFl, b);
		if (why) return 'column ' + j + ': ' + why;
	}
	return '';
}

seedWorld();
var msg = CLOG.build(S, logOpts());
check.ok('a seeded section logs every non-empty column',
	msg && msg.records.length > SEED.nCut * 0.9 && CLOG.validate(msg) === '',
	(msg ? msg.records.length : 0) + ' records, ' + (msg && CLOG.validate(msg) === '' ? 'valid' : 'invalid'));
check.ok('the log is a checksummed pgt-core-log naming its cut',
	msg.format === 'pgt-core-log' && msg.version === 1 &&
	/^[0-9a-f]{16}$/.test(msg.checksum) && msg.pathChecksum === COUP.pathChecksum(pack0) &&
	msg.packChecksum === pack0.checksum, 'log ' + msg.checksum + ' for cut ' + pack0.checksum.slice(0, 8));
check.ok('a JSON round trip is the same log', CLOG.parse(CLOG.json(msg)).checksum === msg.checksum);
check.ok('every number carries the pack\'s six digits',
	(function () {
		var i, k, r;
		for (i = 0; i < msg.records.length; i++) {
			r = msg.records[i];
			for (k = 0; k < r.beds.length; k++) {
				if (r.beds[k][1] !== SP.round(r.beds[k][1]) || r.beds[k][2] !== SP.round(r.beds[k][2])) return false;
			}
			if (r.sKm !== SP.round(r.sKm) || r.div !== SP.round(r.div)) return false;
		}
		return true;
	})());
check.ok('the whole-section log stays a clipboard-sized document',
	CLOG.json(msg).length < 512 * 1024, (CLOG.json(msg).length / 1024).toFixed(1) + ' KB at ' + msg.records.length + ' columns');
check.info('the bed date is one reading: formation time on the section clock, rock age derived',
	'seeded columns carry t0 − rock age = ' + SEED.t0 + ' − age; a record\'s t is ' + msg.tMyr);
check.ok('the seeded beds\' formation times are exactly the cut\'s implication',
	(function () {
		for (var i = 0; i < msg.records.length; i++) {
			var rec = msg.records[i], j = colOfArc(rec.sKm);
			for (var k = 0; k < rec.beds.length; k++) {
				if (Math.abs(rec.beds[k][2] - SP.round(S.layAg[j * P.layerCap + k])) > 1e-6) return false;
			}
		}
		return true;
	})(), 'record bed = live bed, no drift between the two readings');
CLOG.note();

check.section('B. the globe\'s acceptance rules hold on evolved and reconciled states');
SIM.setGeo(SECTION_YR);
SIM.run(60);
check.ok('sixty frames of the section\'s own kernels keep every column\'s strata legal',
	strataAll() === '', strataAll() || 'all columns');
var ownPack = SEED.exportSection({ pack: 'core-log-own' });
var ownMsg = COUP.fromPack(ownPack, { pathChecksum: COUP.pathChecksum(pack0) });
var grow = JSON.parse(COUP.json(ownMsg)), i, gM = 250;
for (i = 0; i < grow.crust.length; i++) grow.crust[i].hFelM += gM;
grow.ledger.fel = SP.round(grow.ledger.fel +
	grow.crust.reduce(function (a, r) { return a + gM * (r.s1Km - r.s0Km) * KM; }, 0));
grow.checksum = COUP.checksum(grow);
var applied = COUP.apply(S, grow, { nCut: S.nCol, cellKm: P.w0 / KM, pathChecksum: COUP.pathChecksum(pack0) });
check.ok('a C4 reconcile with 250 m of bottom growth applies', applied === '', applied || 'ok');
check.ok('injected growth beds are flagged, and the age law reads across them, not around them',
	strataAll() === '', strataAll() || 'all columns after reconcile');
var flagged = 0, LC = P.layerCap;
for (i = 0; i < S.nCol; i++) {
	for (var k = 0; k < S.colNL[i]; k++) if (S.layFl[i * LC + k] & P.FLAG.intr) flagged++;
}
check.ok('the intrusive-contact flag carries the inversions the growth made', flagged > 0,
	flagged + ' flagged beds');
var afterReconcile = CLOG.build(S, logOpts());
check.ok('the log after the import passes the globe\'s own rule, record by record',
	(function () {
		if (!afterReconcile || CLOG.validate(afterReconcile)) return false;
		for (var r = 0; r < afterReconcile.records.length; r++) if (recordOk(afterReconcile.records[r])) return false;
		return true;
	})(), (afterReconcile ? afterReconcile.records.length : 0) + ' records');
check.ok('a record\'s divergence is the column\'s own residual, on every record',
	(function () {
		for (var r = 0; r < afterReconcile.records.length; r++) {
			var rec = afterReconcile.records[r], j = colOfArc(rec.sKm);
			if (j < 0) return false;
			if (Math.abs(rec.div - CLOG.columnDiv(S, j)) > 5e-7 * Math.max(1, rec.div)) return false;
		}
		return true;
	})());
// the fresh-rebuild branch dates its three beds the same way; a coarse table exercises it
var coarse = JSON.parse(COUP.json(ownMsg)), rows = [];
for (i = 0; i < coarse.crust.length; i += 16) {
	var row = JSON.parse(JSON.stringify(coarse.crust[i]));
	row.s1Km = coarse.crust[Math.min(i + 15, coarse.crust.length - 1)].s1Km;
	rows.push(row);
}
coarse.crust = rows;
coarse.checksum = COUP.checksum(coarse);
applied = COUP.apply(S, coarse, { nCut: S.nCol, cellKm: P.w0 / KM, pathChecksum: COUP.pathChecksum(pack0) });
check.ok('a coarse table rebuilding unmatched stacks still logs clean',
	applied === '' && strataAll() === '' &&
	(function () {
		var m = CLOG.build(S, logOpts({ all: true }));
		return !!m && CLOG.validate(m) === '';
	})(), applied || 'one law for seeded, grown and rebuilt columns');

check.section('C. the cadence: log exactly what moved past the threshold');
CLOG.reset();
var base = new Float64Array(S.nCol);
for (i = 0; i < S.nCol; i++) base[i] = CLOG.columnDiv(S, i);
var first = CLOG.build(S, logOpts());
CLOG.note();
check.ok('a quiet section has nothing to report right after a commit',
	CLOG.build(S, logOpts()) === null, first ? first.records.length + ' were due, then none' : 'empty');
SIM.run(120);
var expected = 0;
for (i = 0; i < S.nCol; i++) {
	if (S.colNL[i] > 0 && Math.abs(CLOG.columnDiv(S, i) - base[i]) >= CLOG.DEFAULT_THRESHOLD) expected++;
}
var delta = CLOG.build(S, logOpts());
check.ok('the next log carries exactly the columns whose divergence moved',
	delta ? delta.records.length === expected : expected === 0,
	(delta ? delta.records.length : 0) + ' of ' + first.records.length + ' columns, threshold ' + CLOG.DEFAULT_THRESHOLD);
check.ok('a build that is never committed is still due at the next cadence',
	(function () {
		CLOG.reset();
		var a = CLOG.build(S, logOpts());
		var b = CLOG.build(S, logOpts());        // noted by nobody: the same view is still owed
		CLOG.note();
		var c = CLOG.build(S, logOpts());
		return !!a && !!b && b.records.length === a.records.length && c === null;
	})());
check.ok('the manual build re-logs the whole section regardless of the threshold',
	CLOG.build(S, logOpts({ all: true })) !== null);

check.section('D. refusals: the same discipline as the pack and the coupling');
seedWorld();
msg = CLOG.build(S, logOpts());
function clone(m) { return JSON.parse(JSON.stringify(m)); }
function refuses(tag, mutate, want) {
	var m = clone(msg);
	mutate(m);
	try { m.checksum = CLOG.checksum(m); } catch (e) { m.checksum = ''; }
	var why;
	try { why = CLOG.validate(m); } catch (e) { why = 'threw: ' + e.message; }
	check.ok('refuses ' + tag, why !== '' && (!want || why.indexOf(want) >= 0), why || 'accepted');
}
refuses('a malformed bed', function (m) { m.records[0].beds[0] = [1, 2]; }, 'is not [lith');
refuses('a zero-thickness bed', function (m) { m.records[0].beds[0][1] = 0; }, 'thicker than zero');
refuses('a lithology outside the table', function (m) { m.records[0].beds[0][0] = P.LITH.n; }, 'not a lithology');
refuses('a flag word wider than four bits', function (m) { m.records[0].beds[0][3] = 16; }, 'four bits');
refuses('thicknesses that do not sum', function (m) { m.records[0].beds[0][1] += 9000; }, 'do not sum');
refuses('a negative divergence', function (m) { m.records[0].div = -0.1; }, 'diverged fraction');
refuses('an unsorted arc', function (m) { var t = m.records[0]; m.records[0] = m.records[1]; m.records[1] = t; }, 'ascending arc');
refuses('a record off the cut', function (m) { m.records[0].sKm = m.arcKm + 1; }, 'off the cut');
refuses('an empty record set', function (m) { m.records = []; }, 'at least one record');
refuses('an age inversion without an intrusive contact', function (m) {
	var r = 0;
	while (r < m.records.length && (m.records[r].beds.length < 2 || (m.records[r].beds[0][3] & P.FLAG.intr))) r++;
	m.records[r].beds[1][2] = m.records[r].beds[0][2] - 5;   // the upper bed now predates its floor
}, 'not monotone');
check.ok('the same inversion is legal once the lower bed says its top contact is an injection',
	(function () {
		var m = clone(msg);
		var r = 0;
		while (r < m.records.length && m.records[r].beds.length < 2) r++;
		m.records[r].beds[1][2] = m.records[r].beds[0][2] - 5;
		m.records[r].beds[0][3] |= P.FLAG.intr;
		m.checksum = CLOG.checksum(m);
		return CLOG.validate(m) === '';
	})());
check.ok('a foreign format string is named, not guessed',
	(function () {
		var m = clone(msg);
		m.format = 'pgt-coupling';
		return /not a pgt-core-log/.test(CLOG.validate(m));
	})());
check.ok('an unsigned log never parses (a checksummed text is the only wire form)',
	(function () {
		var m = clone(msg);
		delete m.checksum;
		try { CLOG.parse(JSON.stringify(m)); return false; } catch (e) { return /checksum/.test(e.message); }
	})());
check.ok('a stale checksum is a mismatch, whatever else the body says',
	(function () {
		var m = clone(msg);
		m.tMyr = SP.round(m.tMyr + 1);
		var text = CLOG.json(m).replace(/"checksum":"[0-9a-f]{16}"/, '"checksum":"' + msg.checksum + '"');
		try { CLOG.parse(text); return false; } catch (e) { return e.message === 'checksum mismatch'; }
	})());

check.section('E. determinism, and the state an observation never touches');
seedWorld();
var detA = CLOG.build(S, logOpts());
seedWorld();
var detB = CLOG.build(S, logOpts());
check.ok('the same cut and seed log the same checksum', detA.checksum === detB.checksum, detA.checksum);
COL.sumsAll();
var h0 = S.hash();
CLOG.build(S, logOpts({ all: true }));
CLOG.note();
CLOG.reset();
check.ok('building, committing and resetting never touch the section state', S.hash() === h0,
	'the observation stays an observation (0.4.0-sync-plan.md §1.8): the state hash is unaffected');

check.done();
