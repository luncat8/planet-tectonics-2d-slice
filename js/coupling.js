// coupling.js — 0.4.1 M5 step 1: the coupling envelope (`pgt-coupling` v1, plan §8.3).
//
// The globe owns kinematics and crustal inventory; the section owns beds. What travels
// between them is not a pack: it is this message, sent every N Myr of globe time, matched
// to the section's cut by `pathChecksum` and refused if it belongs to another line. A pack
// is a superset of the message, so `fromPack` derives one from a verified cut: the local
// sequence harness uses that, and a globe adapter can call it for free.
//
// Two reductions are the section's, and they are declared rather than implied: the message
// carries interval tables (plates split where the plate, its boundary type or its polarity
// changes; crust one entry per sample), and a section column joins a crust interval when
// their midpoints are within `JOIN_SPACING` local spacings (plan §8.1). Nothing here mutates
// section state: the module defines the message, checks it, and measures what a C4 reconcile
// would have in front of it (`deltas`). Applying the reconcile is the next M5 step and owns
// the ledger lines of `S.recon`.
//
// Arc arithmetic is the cut's own on both sides: a sample's sKm and a column's position are
// cumulative widths, never `S.colX`, which is an unwrapped ring coordinate whose origin drifts
// as the ring turns (the section's first column is not the globe's zero meridian).
'use strict';
var COUP = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var SP = node ? require('../port/slice-format.js') : window.SlicePack;
	var Core = node ? require('./deposit-core.js') : window.DepositCore;

	var KM = 1000;
	var FORMAT = 'pgt-coupling';
	var VERSION = 1;
	var CADENCE_MYR = 5;      // plan §8.3: one message per N Myr of globe time, N default 5
	var JOIN_SPACING = 2;     // plan §8.1: interval midpoints within 2 x the local spacing
	var HEX = /^[0-9a-f]{16}$/;

	function round(v) { return SP.round(v); }

	// ------------------------------------------------------------------ the message
	// Plate intervals: one entry per run of (id, bnd, pol), with the run's mean motion, so a
	// message carries the same velocities the pack did at the resolution the section uses.
	function plateRuns(pack) {
		var runs = [], i = 0, id, bnd, pol, start, vt, vp, n;
		while (i < pack.n) {
			id = pack.plate[i]; bnd = pack.bnd[i]; pol = pack.pol[i];
			start = i; vt = 0; vp = 0; n = 0;
			while (i < pack.n && pack.plate[i] === id && pack.bnd[i] === bnd && pack.pol[i] === pol) {
				vt += pack.vt[i]; vp += Math.abs(pack.vp[i]); n++; i++;
			}
			runs.push({
				id: id, s0Km: pack.sKm[start], s1Km: i < pack.n ? pack.sKm[i] : pack.path.arcKm,
				vt: vt / n, vp: vp / n, bnd: bnd, pol: pol
			});
		}
		return runs;
	}

	// Crust intervals: one entry per pack sample: the cut was taken at that resolution and
	// nothing is gained by merging neighbours that differ only in the last digit.
	function crustRuns(pack) {
		var runs = [], i;
		for (i = 0; i < pack.n; i++) {
			runs.push({
				s0Km: pack.sKm[i], s1Km: i + 1 < pack.n ? pack.sKm[i + 1] : pack.path.arcKm,
				hFelM: pack.hFelM[i], hMafM: pack.hMafM[i], hSedM: pack.hSedM[i],
				ageMyr: pack.ageMyr[i], fert: pack.fert[i], damage: pack.damage[i]
			});
		}
		return runs;
	}

	function fromPack(pack, opts) {
		opts = opts || {};
		var msg = {
			format: FORMAT, version: VERSION,
			pathChecksum: opts.pathChecksum || pack.checksum,
			tMyr: pack.source.tMyr, epochMa: pack.source.epochMa,
			sea: { mode: pack.sea.mode, levelM: pack.sea.levelM },
			plates: plateRuns(pack), crust: crustRuns(pack),
			trenches: [], ledger: { fel: 0, maf: 0, sed: 0 },
			checksum: ''
		};
		var i, w, a;
		for (i = 0; i < pack.n; i++) {
			if (pack.bnd[i] === SP.EDGE.subduct) msg.trenches.push(pack.sKm[i]);
			a = msg.crust[i];
			w = (a.s1Km - a.s0Km) * KM;
			msg.ledger.fel += pack.hFelM[i] * w;
			msg.ledger.maf += pack.hMafM[i] * w;
			msg.ledger.sed += pack.hSedM[i] * w;
		}
		quantize(msg);
		msg.checksum = checksum(msg);
		return msg;
	}

	// The canonical body, in a fixed key order: the checksum is over exactly this text, so a
	// message that survives a JSON round trip is the same message.
	function body(msg) {
		return {
			format: msg.format, version: msg.version, pathChecksum: msg.pathChecksum,
			tMyr: msg.tMyr, epochMa: msg.epochMa,
			sea: { mode: msg.sea.mode, levelM: msg.sea.levelM },
			plates: msg.plates, crust: msg.crust,
			trenches: msg.trenches, ledger: msg.ledger
		};
	}

	function checksum(msg) {
		return Core.fnvText(JSON.stringify(body(msg)));
	}

	// Six significant digits, the pack's own number rule, so a message has one spelling.
	function quantize(msg) {
		msg.tMyr = round(msg.tMyr);
		msg.epochMa = round(msg.epochMa);
		msg.sea.levelM = round(msg.sea.levelM);
		var i, k, t, f;
		for (i = 0; i < msg.plates.length; i++) {
			t = msg.plates[i];
			t.s0Km = round(t.s0Km); t.s1Km = round(t.s1Km);
			t.vt = round(t.vt); t.vp = round(t.vp);
		}
		for (i = 0; i < msg.crust.length; i++) {
			t = msg.crust[i];
			for (k = 0; k < 7; k++) {
				f = ['s0Km', 's1Km', 'hFelM', 'hMafM', 'hSedM', 'ageMyr', 'fert'][k];
				t[f] = round(t[f]);
			}
			t.damage = round(t.damage);
		}
		for (i = 0; i < msg.trenches.length; i++) msg.trenches[i] = round(msg.trenches[i]);
		msg.ledger.fel = round(msg.ledger.fel);
		msg.ledger.maf = round(msg.ledger.maf);
		msg.ledger.sed = round(msg.ledger.sed);
		return msg;
	}

	// One interval table: sorted, contiguous from 0, and its last edge is the arc's end.
	function tableOk(rows, name) {
		var i, r, prev = 0, end = -1;
		if (!rows || !rows.length) return name + ' is empty';
		for (i = 0; i < rows.length; i++) {
			r = rows[i];
			if (!(isFinite(r.s0Km) && isFinite(r.s1Km))) return name + ' ' + i + ' is not finite';
			if (!(r.s1Km > r.s0Km)) return name + ' ' + i + ' does not advance';
			if (i === 0 ? r.s0Km !== 0 : r.s0Km !== prev) return name + ' ' + i + ' leaves a gap at ' + r.s0Km;
			prev = r.s1Km; end = r.s1Km;
		}
		return { end: end };
	}

	function validate(msg) {
		if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'a coupling message must be an object';
		if (msg.format !== FORMAT) return 'not a ' + FORMAT + ' (' + msg.format + ')';
		if (msg.version !== VERSION) return 'message version ' + msg.version + ', this build reads ' + VERSION;
		if (!HEX.test(msg.pathChecksum || '')) return 'pathChecksum must be 16 hex digits';
		if (!(isFinite(msg.tMyr) && msg.tMyr >= 0)) return 'tMyr out of range: ' + msg.tMyr;
		if (!isFinite(msg.epochMa)) return 'epochMa is not finite';
		if (!msg.sea || typeof msg.sea.mode !== 'string' || !(msg.sea.mode.length && isFinite(msg.sea.levelM))) return 'sea must carry a mode and a finite level';
		var i, pl, cr, t;
		var p = tableOk(msg.plates, 'plates'), c = tableOk(msg.crust, 'crust');
		if (typeof p === 'string') return p;
		if (typeof c === 'string') return c;
		if (p.end !== c.end) return 'the two tables end at different arcs: ' + p.end + ' vs ' + c.end;
		for (i = 0; i < msg.plates.length; i++) {
			pl = msg.plates[i];
			if (!(pl.id >= 0 && pl.id === Math.floor(pl.id))) return 'plate id ' + i + ' is not a whole number';
			if (!(isFinite(pl.vt) && isFinite(pl.vp) && pl.vp >= 0)) return 'plate ' + i + ' motion is not finite';
			if (!(pl.bnd >= 0 && pl.bnd <= SP.EDGE.collide && pl.bnd === Math.floor(pl.bnd))) return 'plate ' + i + ' bnd out of range: ' + pl.bnd;
			if (!(Math.abs(pl.pol) <= 1)) return 'plate ' + i + ' pol out of range: ' + pl.pol;
		}
		for (i = 0; i < msg.crust.length; i++) {
			cr = msg.crust[i];
			if (!(cr.hFelM >= 0 && cr.hMafM >= 0 && cr.hSedM >= 0)) return 'crust ' + i + ' has a negative thickness';
			if (!(cr.ageMyr >= 0)) return 'crust ' + i + ' has a negative age';
			if (!(isFinite(cr.fert) && isFinite(cr.damage) && cr.damage >= 0 && cr.damage <= 1)) return 'crust ' + i + ' fertility or damage out of range';
		}
		var arc = c.end, prev = -1;
		for (i = 0; i < msg.trenches.length; i++) {
			t = msg.trenches[i];
			if (!(isFinite(t) && t >= 0 && t <= arc)) return 'trench ' + i + ' is off the cut';
			if (t < prev) return 'trenches are not sorted at ' + i;
			prev = t;
		}
		if (!msg.ledger || !(msg.ledger.fel >= 0 && msg.ledger.maf >= 0 && msg.ledger.sed >= 0) ||
			!isFinite(msg.ledger.fel + msg.ledger.maf + msg.ledger.sed)) return 'ledger must carry three finite volumes';
		if (msg.checksum) {
			var want;
			try { want = checksum(msg); } catch (e) { return 'the message cannot be serialised'; }
			if (msg.checksum !== want) return 'checksum mismatch';
		}
		return '';
	}

	function json(msg) {
		var out = body(msg);
		out.checksum = checksum(msg);
		return JSON.stringify(out);
	}

	// A message off the wire must say who it is: validate() tolerates an absent checksum so a
	// freshly derived one can be checked before it is stamped, but a parsed message cannot.
	function parse(text) {
		var msg = JSON.parse(text);
		quantize(msg);
		var why = validate(msg);
		if (why) throw new Error(why);
		if (!msg.checksum || msg.checksum !== checksum(msg)) throw new Error('checksum mismatch');
		return msg;
	}

	// The section's guard: a message for another line is refused, not blended.
	function matches(msg, pack) {
		return !!msg && msg.pathChecksum === pack.checksum;
	}

	// ------------------------------------------------------------------ the section's half
	// The join key of plan §8.1: a column takes an interval when their arc midpoints are
	// within JOIN_SPACING local spacings. Plate id is a fast path, not the identity.
	function joinTo(msg, midKm, cellKm) {
		var span = JOIN_SPACING * cellKm, i, r, best = -1, bestD = span, d;
		var wrap = msg.crust[msg.crust.length - 1].s1Km;
		for (i = 0; i < msg.crust.length; i++) {
			r = msg.crust[i];
			d = Math.abs(midKm - (r.s0Km + r.s1Km) * 0.5);
			// the ring is periodic: the last column of a cut is as close to the first interval
			// as it is to its own, and the shorter way round is the distance
			if (d > wrap * 0.5) d = wrap - d;
			if (d <= bestD) { bestD = d; best = i; }
		}
		return best;
	}

	// What a C4 reconcile would see, read-only: per section column the matched interval and
	// the thickness, age and fertility deltas, and the totals a ledger would book. `opts.rows`
	// collects the per-column detail; nothing here touches the section.
	// `st.colX` is an unwrapped ring coordinate whose origin drifts as the ring turns, so a
	// column's arc is measured from the state's own first column, the way the cut it was laid
	// from named it. A periodic ring has no absolute origin: the plate table of the message is
	// what re-synchronises the pattern, and the deltas are what say how far it has to.
	function deltas(st, msg, opts) {
		opts = opts || {};
		var n = opts.nCut === undefined ? st.nCol : opts.nCut;
		var cellKm = opts.cellKm || (st.colW[0] || 78000) / KM;
		var walk = 0;
		var out = {
			matched: 0, unmatched: 0, grew: 0, shrank: 0, ageMoves: 0, fertMoves: 0,
			dFel: 0, dMaf: 0, dSed: 0, dMax: 0, dAgeMax: 0, growVol: 0, shrinkVol: 0, rows: null
		};
		if (opts.rows) out.rows = [];
		var j, i, r, w, dF, dM, dS, dA, mid;
		for (j = 0; j < n; j++) {
			mid = (walk + (st.colW[j] || 78000) * 0.5) / KM;
			i = joinTo(msg, mid, cellKm);
			if (i < 0) { out.unmatched++; walk += st.colW[j] || 78000; continue; }
			r = msg.crust[i];
			w = st.colW[j] || 78000;
			dF = r.hFelM - st.hFel[j]; dM = r.hMafM - st.hMaf[j]; dS = r.hSedM - st.hSed[j];
			dA = r.ageMyr - st.colAge[j];
			out.matched++;
			out.dFel += dF * w; out.dMaf += dM * w; out.dSed += dS * w;
			out.dMax = Math.max(out.dMax, Math.abs(dF), Math.abs(dM), Math.abs(dS));
			out.dAgeMax = Math.max(out.dAgeMax, Math.abs(dA));
			if (dF > 0 || dM > 0 || dS > 0) out.grew++;
			if (dF < 0 || dM < 0 || dS < 0) out.shrank++;
			if (dF + dM + dS > 0) out.growVol += (dF + dM + dS) * w;
			else out.shrinkVol += (dF + dM + dS) * w;
			if (Math.abs(dA) > 0.01) out.ageMoves++;
			if (Math.abs(r.fert - st.fert[j]) > 1e-6) out.fertMoves++;
			if (out.rows) out.rows.push({ col: j, itv: i, dFel: dF, dMaf: dM, dSed: dS, dAge: dA });
			walk += st.colW[j] || 78000;
		}
		return out;
	}

	// The cadence rule of §8.3: the section's clock may not run ahead of the last message by
	// more than one cadence, or it waits.
	function clockOk(sectionTMyr, msg, cadence) {
		var n = cadence === undefined ? CADENCE_MYR : cadence;
		var lead = sectionTMyr - msg.tMyr;
		if (!(lead <= n)) return 'the section is ' + lead.toFixed(2) + ' Myr ahead of the globe (cadence ' + n + ')';
		return '';
	}

	// M5 step 2: the C4 reconcile (§8.3, §4.3.5). Matched columns take the message's interval
	// values; unmatched columns are fresh; the ledger books reconciled / diverged / fresh /
	// retired. Nothing deletes beds: the aggregate is corrected, the beds stay the section's.
	function apply(st, msg, opts) {
		opts = opts || {};
		var n = opts.nCut === undefined ? (st.nCol || 0) : opts.nCut;
		var cellKm = opts.cellKm || ((st.colW && st.colW[0]) ? st.colW[0] : 78000) / KM;
		if (!msg || typeof msg !== 'object') return 'apply needs a message object';
		var why = validate(msg);
		if (why) return 'message refused: ' + why;
		var j, i, r, w, mid, walk = 0;
		var matchedInt = {}, unmatchedCol = 0, freshVol = 0, retiredVol = 0;
		var reconciledVol = 0, divergedAtImport = 0;
		for (i = 0; i < msg.crust.length; i++) matchedInt[i] = false;
		if (st.recon) {
			st.recon.reconciled = 0;
			st.recon.diverged = 0;
			st.recon.divergedAtImport = 0;
			st.recon.fresh = 0;
			st.recon.retired = 0;
		}
		for (j = 0; j < n; j++) {
			w = (st.colW && st.colW[j]) ? st.colW[j] : 78000;
			mid = (walk + w * 0.5) / KM;
			i = joinTo(msg, mid, cellKm);
			if (i >= 0) {
				matchedInt[i] = true;
				r = msg.crust[i];
				var dF = r.hFelM - (st.hFel ? st.hFel[j] : 0);
				var dM = r.hMafM - (st.hMaf ? st.hMaf[j] : 0);
				var dS = r.hSedM - (st.hSed ? st.hSed[j] : 0);
				var deltaVol = (dF + dM + dS) * w;
				reconciledVol += Math.abs(deltaVol);
				divergedAtImport += Math.abs(deltaVol);
				if (st.hFel) st.hFel[j] = r.hFelM;
				if (st.hMaf) st.hMaf[j] = r.hMafM;
				if (st.hSed) st.hSed[j] = r.hSedM;
				if (st.colAge) st.colAge[j] = r.ageMyr;
				if (st.fert) st.fert[j] = r.fert;
				if (st.damage) st.damage[j] = r.damage;
			} else {
				unmatchedCol++;
				freshVol += (st.hTot ? (st.hTot[j] || 0) : 0) * w;
			}
			walk += w;
		}
		for (i = 0; i < msg.crust.length; i++) {
			if (!matchedInt[i]) {
				r = msg.crust[i];
				retiredVol += (r.hFelM + r.hMafM + r.hSedM) * (r.s1Km - r.s0Km) * KM;
			}
		}
		if (st.recon) {
			st.recon.reconciled = reconciledVol;
			st.recon.diverged = 0;
			st.recon.divergedAtImport = divergedAtImport;
			st.recon.fresh = unmatchedCol;
			var matchedCount = 0;
			for (i = 0; i < msg.crust.length; i++) if (matchedInt[i]) matchedCount++;
			st.recon.retired = msg.crust.length - matchedCount;
		}
		return '';
	}

	return {
		FORMAT: FORMAT, VERSION: VERSION,
		CADENCE_MYR: CADENCE_MYR, JOIN_SPACING: JOIN_SPACING,
		body: body, checksum: checksum, quantize: quantize, validate: validate,
		json: json, parse: parse, matches: matches,
		fromPack: fromPack, plateRuns: plateRuns, crustRuns: crustRuns,
		joinTo: joinTo, deltas: deltas, clockOk: clockOk, apply: apply
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = COUP;
