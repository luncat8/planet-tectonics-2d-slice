// coupling.js — 0.4.1 M5: the `pgt-coupling` v1 envelope and C4 reconcile (plan §8.1–§8.3).
//
// The globe owns kinematics and aggregate crust; the section owns beds. A message is matched
// to the active cut before any write. Matched columns keep their stack and receive class-wise
// growth/removal through the stack primitives; a column outside the geographic join is retired
// and rebuilt fresh. The aggregate fields remain caches derived by COL.sums, never a second
// crust that can disagree with the beds.
//
// Arc arithmetic is the cut's own on both sides: a sample's sKm and a column's position are
// cumulative widths, never `S.colX`, whose unwrapped origin drifts as the ring turns.
'use strict';
var COUP = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var SP = node ? require('../port/slice-format.js') : window.SlicePack;
	var Core = node ? require('./deposit-core.js') : window.DepositCore;
	var P = node ? require('./params.js') : window.P;
	var State = node ? require('./state.js') : window.S;
	var COL = node ? require('./columns.js') : window.COL;
	var PLT = node ? require('./plates.js') : window.PLT;

	var KM = 1000;
	var FORMAT = 'pgt-coupling';
	var VERSION = 1;
	var CADENCE_MYR = 5;      // plan §8.3: one message per N Myr of globe time, N default 5
	var JOIN_SPACING = 2;     // plan §8.1: interval midpoints within 2 x the local spacing
	var HEX = /^[0-9a-f]{16}$/;
	var joined = new Int32Array(P.colCap);
	var target = new Int32Array(P.colCap);
	var last = {
		matched: 0, freshColumns: 0, retiredColumns: 0,
		before: 0, after: 0, added: 0, removed: 0,
		fresh: 0, retired: 0, reconciled: 0, diverged: 0,
		identityError: 0
	};
	var slaveW = new Float64Array(P.plateCap);
	var slaveU = new Float64Array(P.plateCap);
	var liveMsg = null, liveN = 0;

	function round(v) { return SP.round(v); }

	// The path identity excludes resolution (`cellKm`) and every sampled field: a re-cut of
	// the same geographic line at a different level must still join the section it updates.
	function pathBody(pack) {
		var p = pack.path || pack, out = {
			kind: p.kind, closes: !!p.closes, arcKm: round(p.arcKm)
		};
		if (p.kind === 'circle') {
			out.lat0 = round(p.lat0); out.lon0 = round(p.lon0); out.az0 = round(p.az0);
		} else {
			out.verts = [];
			for (var i = 0; p.verts && i < p.verts.length; i++) {
				var v = p.verts[i];
				out.verts.push(Array.isArray(v) ? [round(v[0]), round(v[1])] : round(v));
			}
		}
		return out;
	}

	function pathChecksum(pack) {
		return Core.fnvText(JSON.stringify(pathBody(pack)));
	}

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
			pathChecksum: opts.pathChecksum || pathChecksum(pack),
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
			if (!(Math.abs(pl.pol) <= 1 && pl.pol === Math.floor(pl.pol))) return 'plate ' + i + ' pol out of range: ' + pl.pol;
		}
		for (i = 0; i < msg.crust.length; i++) {
			cr = msg.crust[i];
			if (!(cr.hFelM >= 0 && cr.hMafM >= 0 && cr.hSedM >= 0)) return 'crust ' + i + ' has a negative thickness';
			if (!(cr.ageMyr >= 0)) return 'crust ' + i + ' has a negative age';
			if (!(isFinite(cr.fert) && isFinite(cr.damage) && cr.damage >= 0 && cr.damage <= 1)) return 'crust ' + i + ' fertility or damage out of range';
		}
		if (!Array.isArray(msg.trenches)) return 'trenches must be an array';
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
			if (!HEX.test(msg.checksum)) return 'checksum must be 16 hex digits';
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
		return !!msg && !!pack && msg.pathChecksum === pathChecksum(pack);
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

	// C3: prescribe one rigid velocity per section plate from the globe intervals under its
	// columns. K2 calls this instead of its force solve while a live message is active; K3 and
	// the section's own crust/surface kernels remain unchanged.
	function slave(st, msg, n) {
		n = n || st.nCol;
		var rows = msg.plates, arc = rows[rows.length - 1].s1Km;
		var p, i = 0, j, w, mid, walk = 0;
		for (p = 0; p < st.nPl; p++) { slaveW[p] = 0; slaveU[p] = 0; }
		for (j = 0; j < n; j++) {
			w = st.colW[j];
			mid = (walk + w * 0.5) / KM;
			mid -= Math.floor(mid / arc) * arc;
			while (i + 1 < rows.length && mid >= rows[i].s1Km) i++;
			p = st.colPlate[j];
			if (p >= 0 && p < st.nPl) {
				slaveW[p] += w;
				slaveU[p] += rows[i].vt * w;
			}
			walk += w;
		}
		for (p = 0; p < st.nPl; p++) {
			st.plUP[p] = st.plU[p];
			if (slaveW[p] > 0) st.plU[p] = slaveU[p] / slaveW[p];
		}
		for (j = 0; j < n; j++) st.colU[j] = st.plU[st.colPlate[j]];
		PLT.extension(st);
		return true;
	}

	function activate(msg, n) {
		liveMsg = msg;
		liveN = n || 0;
	}

	function deactivate() {
		liveMsg = null;
		liveN = 0;
	}

	function k2(st, dt) {
		if (!liveMsg) return false;
		if (dt > 0) slave(st, liveMsg, liveN || st.nCol);
		return true;
	}

	// The interval that owns an arc point, independent of whether it is close enough to
	// inherit a stack. A valid table tiles the complete arc, so this always finds one.
	function intervalAt(msg, midKm) {
		var rows = msg.crust, wrap = rows[rows.length - 1].s1Km;
		var x = midKm - Math.floor(midKm / wrap) * wrap, i;
		for (i = 0; i < rows.length; i++) {
			if (x >= rows[i].s0Km && x < rows[i].s1Km) return i;
		}
		return rows.length - 1;
	}

	function resetLast() {
		last.matched = 0; last.freshColumns = 0; last.retiredColumns = 0;
		last.before = 0; last.after = 0; last.added = 0; last.removed = 0;
		last.fresh = 0; last.retired = 0; last.reconciled = 0; last.diverged = 0;
		last.identityError = 0;
	}

	function stateError(st, n) {
		if (st !== State) return 'apply needs the live section state';
		if (!(Number.isInteger(n) && n > 0 && n <= st.nCol && n <= P.colCap)) {
			return 'no reconstructed section is ready for coupling';
		}
		var fields = ['colW', 'colNL', 'layTh', 'layLi', 'layAg', 'layFl',
			'hFel', 'hMaf', 'hSed', 'hTot', 'colAge', 'fert', 'damage',
			'syncFel', 'syncMaf', 'syncSed', 'syncValid'];
		for (var i = 0; i < fields.length; i++) {
			if (!st[fields[i]] || st[fields[i]].length < n) return 'section state is missing ' + fields[i];
		}
		if (!st.recon) return 'section state has no reconstruction ledger';
		return '';
	}

	// A fresh column has no stack identity to preserve. It receives the three aggregate beds
	// the same way an initial cut does; depth-resolved deposits on the retired stack lose their
	// horizon rather than pointing into unrelated new geology.
	function freshStack(st, c, row) {
		var LC = P.layerCap, b = c * LC, k, n = 0;
		for (k = 0; k < LC; k++) {
			st.layTh[b + k] = 0; st.layLi[b + k] = 0;
			st.layAg[b + k] = 0; st.layFl[b + k] = 0;
		}
		for (k = 0; k < st.nDep; k++) {
			if (st.depCol[k] === c) st.depLay[k] = -1;
		}
		var flags = st.wet[c] ? P.FLAG.wet : 0;
		if (row.hMafM > 0) {
			st.layTh[b + n] = row.hMafM; st.layLi[b + n] = P.LITH.maf;
			st.layAg[b + n] = row.ageMyr; st.layFl[b + n++] = flags;
		}
		if (row.hFelM > 0) {
			st.layTh[b + n] = row.hFelM; st.layLi[b + n] = P.LITH.fel;
			st.layAg[b + n] = row.ageMyr; st.layFl[b + n++] = flags;
		}
		if (row.hSedM > 0) {
			st.layTh[b + n] = row.hSedM; st.layLi[b + n] = P.LITH.sed;
			st.layAg[b + n] = row.ageMyr; st.layFl[b + n++] = flags;
		}
		st.colNL[c] = n;
		st.colBevel[c] = 0;
		COL.sums(c);
	}

	// C4 is one guarded transaction. All format, checksum, cut-identity and state checks, plus
	// the complete geographic map, are resolved before a bed is touched. Once that preflight
	// passes, stack primitives cannot refuse: growth consolidates at the cap and class removal
	// takes no more than the aggregate COL.sums just measured.
	function apply(st, msg, opts) {
		opts = opts || {};
		if (!msg || typeof msg !== 'object') return 'message refused: apply needs a message object';
		var why = validate(msg);
		if (why) return 'message refused: ' + why;
		if (!msg.checksum || !HEX.test(msg.checksum) || msg.checksum !== checksum(msg)) {
			return 'message refused: checksum mismatch';
		}
		var expected = opts.pathChecksum || (opts.pack && pathChecksum(opts.pack)) || '';
		if (!HEX.test(expected)) return 'message refused: no verified active cut identity';
		if (msg.pathChecksum !== expected) return 'message refused: pathChecksum does not match the active cut';
		var n = opts.nCut === undefined ? st.nCol : opts.nCut;
		why = stateError(st, n);
		if (why) return 'message refused: ' + why;
		var cellKm = opts.cellKm || ((st.colW && st.colW[0]) ? st.colW[0] : 78000) / KM;
		if (!(isFinite(cellKm) && cellKm > 0)) return 'message refused: local spacing is not positive';

		var j, i, w, mid, walk = 0;
		for (j = 0; j < n; j++) {
			w = st.colW[j];
			if (!(isFinite(w) && w > 0)) return 'message refused: column ' + j + ' has no positive width';
			mid = (walk + w * 0.5) / KM;
			joined[j] = joinTo(msg, mid, cellKm);
			target[j] = joined[j] >= 0 ? joined[j] : intervalAt(msg, mid);
			walk += w;
		}

		resetLast();
		var row, dF, dM, dS, dv, old, now, flags;
		for (j = 0; j < n; j++) {
			w = st.colW[j];
			COL.sums(j);
			old = st.hTot[j] * w;
			last.before += old;
			row = msg.crust[target[j]];
			if (joined[j] < 0) {
				last.freshColumns++;
				last.retiredColumns++;
				last.retired += old;
				freshStack(st, j, row);
				now = st.hTot[j] * w;
				last.fresh += now;
			} else {
				last.matched++;
				if (st.syncValid[j]) {
					last.diverged += (Math.abs(st.hFel[j] - st.syncFel[j]) +
						Math.abs(st.hMaf[j] - st.syncMaf[j]) +
						Math.abs(st.hSed[j] - st.syncSed[j])) * w;
				}
				dF = row.hFelM - st.hFel[j];
				dM = row.hMafM - st.hMaf[j];
				dS = row.hSedM - st.hSed[j];
				dv = dF * w;
				if (dv >= 0) last.added += dv; else last.removed -= dv;
				dv = dM * w;
				if (dv >= 0) last.added += dv; else last.removed -= dv;
				dv = dS * w;
				if (dv >= 0) last.added += dv; else last.removed -= dv;
				flags = st.wet[j] ? P.FLAG.wet : 0;
				// Shrink first: a message that trades one class for another makes room before
				// inserting its dated beds, so a transient full stack cannot force a mix.
				if (dF < 0) COL.removeClass(st, j, 1, -dF);
				if (dM < 0) COL.removeClass(st, j, 2, -dM);
				if (dS < 0) COL.removeClass(st, j, 0, -dS);
				if (dF > 0) COL.insertVol(st, j, P.LITH.fel, dF, msg.tMyr, flags, 'bottom');
				if (dM > 0) COL.insertVol(st, j, P.LITH.maf, dM, msg.tMyr, flags, 'bottom');
				if (dS > 0) COL.insertVol(st, j, P.LITH.sed, dS, msg.tMyr, flags, 'top');
				COL.sums(j);
			}
			st.colAge[j] = row.ageMyr;
			st.fert[j] = row.fert;
			st.damage[j] = row.damage;
			st.syncFel[j] = row.hFelM;
			st.syncMaf[j] = row.hMafM;
			st.syncSed[j] = row.hSedM;
			st.syncValid[j] = 1;
			last.after += st.hTot[j] * w;
		}
		last.reconciled = last.added + last.removed;
		last.identityError = last.before + last.added + last.fresh -
			last.removed - last.retired - last.after;
		st.recon.reconciled += last.reconciled;
		st.recon.diverged += last.diverged;
		st.recon.divergedAtImport = last.diverged;
		st.recon.fresh += last.fresh;
		st.recon.retired += last.retired;
		return '';
	}

	return {
		FORMAT: FORMAT, VERSION: VERSION,
		CADENCE_MYR: CADENCE_MYR, JOIN_SPACING: JOIN_SPACING,
		body: body, checksum: checksum, quantize: quantize, validate: validate,
		pathBody: pathBody, pathChecksum: pathChecksum,
		json: json, parse: parse, matches: matches,
		fromPack: fromPack, plateRuns: plateRuns, crustRuns: crustRuns,
		joinTo: joinTo, deltas: deltas, clockOk: clockOk,
		slave: slave, activate: activate, deactivate: deactivate, k2: k2,
		last: last, apply: apply
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = COUP;
