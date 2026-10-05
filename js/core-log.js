(function (root) {
// core-log.js — 0.4.1 M5 return path (plan §8.5): the section's one answer to the globe.
//
// An observation, never a physical field: the globe may display a core log and store it in a
// side table, and the acceptance rules there (thicknesses sum, ages monotone) are the same
// rules `validate` enforces here, so a log that leaves this page cannot be refused for form.
// The one bed date is formation time on the section's clock (plan §4.3.2): rock age is the
// derived reading `tMyr − formedMyr`, which is why no second unit ever enters a record.
//
// Cadence (plan §8.5): one log per sync cadence, and only for columns whose diverged fraction
// moved beyond the threshold — or whose beds the globe has never seen. `build` selects and
// stamps; `note` commits the selection after the carrier accepted it, so a refused or dropped
// send is retried at the next cadence rather than lost.
'use strict';
var CLOG = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var SP = node ? require('../port/slice-format.js') : window.SlicePack;
	var Core = node ? require('./deposit-core.js') : window.COLDEPOSITCORE;
	var P = node ? require('./params.js') : window.COLP;
	var State = node ? require('./state.js') : window.COLS;

	var KM = 1000;
	var FORMAT = 'pgt-core-log';
	var VERSION = 1;
	var HEX = /^[0-9a-f]{16}$/;
	// the sum rule, as a tolerance: every bed is quantised alone, so the rounded total and
	// the sum of rounded beds part by up to a bed count of half ulps — never more here
	var TH_TOL = 1.5;
	var AGE_EPS = 1e-9;
	// plan §8.5: the fraction of a column's crust volume the section moved on its own since
	// the last accepted import must move by this much before the column is worth re-logging
	var DEFAULT_THRESHOLD = 1e-3;

	var sent = new Float64Array(P.colCap);     // diverged fraction at the last committed log
	var sentEver = new Uint8Array(P.colCap);   // 0: the globe has never seen this column's beds
	var emitCol = new Int32Array(P.colCap);    // the build's selection, committed by note()
	var emitDiv = new Float64Array(P.colCap);
	var emitN = 0;

	function round(v) { return SP.round(v); }

	// the stratigraphic law a record must satisfy, on live beds as well as on a message:
	// ages never *decrease* upward across depositional contacts. A contact is not
	// depositional when either bed touching it was inserted into the stack (FLAG.intr): the
	// injection cuts both its faces, so both neighbours are exempt — an old donor bed
	// collapsed in on top of young mafic inverts the contact below it just as surely as
	// young underplating inverts the one above (measured: a belt transfer doing it inside
	// 60 frames at cadence rate). The inversion is the record, not an error.
	//
	// Beds of no thickness are holes, not rock: the delamination kernel consumes a bed from
	// the middle of a stack by zeroing it, and the slot is kept for a same-lithology bed to
	// refuel (js/crust.js). Neither the law nor a record speaks of a hole.
	function strataOK(nl, th, li, ag, fl, at) {
		var i, prev = -1;
		for (i = 0; i < nl; i++) {
			if (!(th[at + i] > 0)) continue;
			if (!(li[at + i] >= 0 && li[at + i] < P.LITH.n)) return 'bed ' + i + ' is not a lithology';
			if (!isFinite(ag[at + i])) return 'bed ' + i + ' has no formation time';
			if (prev >= 0 && !((fl[at + i] | fl[at + prev]) & P.FLAG.intr) &&
				ag[at + i] < ag[at + prev] - AGE_EPS) return 'bed ' + i + ' formed before the one under it';
			prev = i;
		}
		return '';
	}

	// The canonical body, in a fixed key order: the checksum is over exactly this text, so a
	// log that survives a JSON round trip is the same log. `records` are ordered columns.
	function body(msg) {
		return {
			format: msg.format, version: msg.version,
			pathChecksum: msg.pathChecksum, packChecksum: msg.packChecksum,
			arcKm: msg.arcKm, tMyr: msg.tMyr, epochMa: msg.epochMa,
			records: msg.records
		};
	}

	function checksum(msg) { return Core.fnvText(JSON.stringify(body(msg))); }

	// Six significant digits, the pack's number rule, applied once so a log has one spelling.
	// A number that is not finite fails to a refusal, not to a second NaN in the record.
	function q(v) { return isFinite(v) ? round(v) : NaN; }

	function quantize(msg) {
		msg.arcKm = q(msg.arcKm);
		msg.tMyr = q(msg.tMyr);
		msg.epochMa = q(msg.epochMa);
		var i, k, r, b;
		for (i = 0; i < msg.records.length; i++) {
			r = msg.records[i];
			r.sKm = q(r.sKm);
			r.div = q(r.div);
			r.hTotM = q(r.hTotM);
			for (k = 0; k < r.beds.length; k++) {
				b = r.beds[k];
				b[1] = q(b[1]);
				b[2] = q(b[2]);
			}
		}
		return msg;
	}

	// The same acceptance the globe's side-table rule runs, kept here so one law has one
	// owner: an observation is refused before it can enter anyone's table, never after.
	function validate(msg) {
		if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'a core log must be an object';
		if (msg.format !== FORMAT) return 'not a ' + FORMAT + ' (' + msg.format + ')';
		if (msg.version !== VERSION) return 'log version ' + msg.version + ', this build reads ' + VERSION;
		if (!HEX.test(msg.pathChecksum || '')) return 'pathChecksum must be 16 hex digits';
		if (!HEX.test(msg.packChecksum || '')) return 'packChecksum must be 16 hex digits';
		if (!(isFinite(msg.arcKm) && msg.arcKm > 0)) return 'arcKm is not positive';
		if (!(isFinite(msg.tMyr) && msg.tMyr >= 0)) return 'tMyr out of range: ' + msg.tMyr;
		if (!isFinite(msg.epochMa)) return 'epochMa is not finite';
		if (!Array.isArray(msg.records) || !msg.records.length) return 'a core log carries at least one record';
		var i, k, r, b, sum, prev = -1, LC = P.layerCap;
		for (i = 0; i < msg.records.length; i++) {
			r = msg.records[i];
			if (!r || typeof r !== 'object') return 'record ' + i + ' is not an object';
			if (!(isFinite(r.sKm) && r.sKm >= 0 && r.sKm < msg.arcKm)) return 'record ' + i + ' is off the cut';
			if (!(r.sKm > prev)) return 'records are not in ascending arc order at ' + i;
			prev = r.sKm;
			if (!(isFinite(r.div) && r.div >= 0)) return 'record ' + i + ' diverged fraction is not a number';
			if (!(isFinite(r.hTotM) && r.hTotM > 0)) return 'record ' + i + ' carries no crust';
			if (!Array.isArray(r.beds) || !r.beds.length) return 'record ' + i + ' has no beds';
			if (r.beds.length > LC) return 'record ' + i + ' exceeds the layer cap';
			sum = 0;
			for (k = 0; k < r.beds.length; k++) {
				b = r.beds[k];
				if (!Array.isArray(b) || b.length !== 4) return 'record ' + i + ' bed ' + k + ' is not [lith, thM, formedMyr, flags]';
				if (!(b[0] === Math.floor(b[0]) && b[0] >= 0 && b[0] < P.LITH.n)) return 'record ' + i + ' bed ' + k + ' is not a lithology';
				if (!(b[1] > 0)) return 'record ' + i + ' bed ' + k + ' is not thicker than zero (' + b[1] + ')';
				if (!isFinite(b[2])) return 'record ' + i + ' bed ' + k + ' has no formation time';
				if (!(b[3] === Math.floor(b[3]) && b[3] >= 0 && b[3] <= 15)) return 'record ' + i + ' bed ' + k + ' flags are not four bits';
				sum += b[1];
			}
			if (Math.abs(sum - r.hTotM) > TH_TOL) return 'record ' + i + ' thicknesses do not sum: ' + sum + ' vs ' + r.hTotM;
			for (k = 1; k < r.beds.length; k++) {
				if ((r.beds[k][3] | r.beds[k - 1][3]) & P.FLAG.intr) continue;
				if (r.beds[k][2] < r.beds[k - 1][2] - AGE_EPS) return 'record ' + i + ' ages are not monotone at bed ' + k;
			}
		}
		if (msg.checksum) {
			if (!HEX.test(msg.checksum)) return 'checksum must be 16 hex digits';
			var want;
			try { want = checksum(msg); } catch (e) { return 'the log cannot be serialised'; }
			if (msg.checksum !== want) return 'checksum mismatch';
		}
		return '';
	}

	function json(msg) {
		var out = body(msg);
		out.checksum = checksum(msg);
		return JSON.stringify(out);
	}

	// A log off the wire must say what it is: validate tolerates an absent checksum so a
	// freshly built one can be checked before it is stamped, but a parsed one cannot.
	function parse(text) {
		var msg = JSON.parse(text);
		quantize(msg);
		var why = validate(msg);
		if (why) throw new Error(why);
		if (!msg.checksum || msg.checksum !== checksum(msg)) throw new Error('checksum mismatch');
		return msg;
	}

	// The column's own divergence: what the section's kernels moved since the last accepted
	// import, over the crust the column carries. An unsynced column (never imported, or born
	// after the last cut) reads 0 — it is not divergence, it is the section's own planet.
	function columnDiv(st, j) {
		if (!st.syncValid || !st.syncValid[j] || !(st.hTot[j] > 0)) return 0;
		var d = Math.abs(st.hFel[j] - st.syncFel[j]) + Math.abs(st.hMaf[j] - st.syncMaf[j]) +
			Math.abs(st.hSed[j] - st.syncSed[j]);
		return d / st.hTot[j];
	}

	// One build per cadence. `opts.all` forces every column (the manual copy is the whole
	// section, not the delta); otherwise a column is logged when the globe has never seen
	// its beds or its diverged fraction moved by `opts.threshold` since the last commit.
	function build(st, opts) {
		st = st || State;
		opts = opts || {};
		var n = opts.n === undefined ? st.nCol : opts.n;
		var thr = opts.threshold === undefined ? DEFAULT_THRESHOLD : opts.threshold;
		var LC = P.layerCap, arc = opts.arcKm;
		var j, i, k, b, nl, div, rec, sum, walk = 0, mid, th;
		emitN = 0;
		var records = [];
		for (j = 0; j < n; j++) {
			th = st.colW[j] || 0;
			mid = (walk + th * 0.5) / KM;
			walk += th;
			nl = st.colNL[j];
			if (nl <= 0) continue;                       // a hole is not an observation
			div = columnDiv(st, j);
			if (!opts.all) {
				if (sentEver[j] && Math.abs(div - sent[j]) < thr) continue;
			}
			b = j * LC;
			rec = { sKm: mid, div: div, hTotM: 0, beds: [] };
			sum = 0;
			for (k = 0; k < nl; k++) {
				if (!(st.layTh[b + k] > 0)) continue;   // a delamination hole is not a bed
				rec.beds.push([st.layLi[b + k], st.layTh[b + k], st.layAg[b + k], st.layFl[b + k]]);
				sum += st.layTh[b + k];
			}
			if (!rec.beds.length) continue;              // a column of only holes says nothing
			rec.hTotM = sum;
			records.push(rec);
			emitCol[emitN] = j;
			emitDiv[emitN] = div;
			emitN++;
		}
		if (!records.length) return null;
		var msg = {
			format: FORMAT, version: VERSION,
			pathChecksum: opts.pathChecksum, packChecksum: opts.packChecksum,
			arcKm: arc, tMyr: opts.tMyr, epochMa: opts.epochMa,
			records: records, checksum: ''
		};
		quantize(msg);
		// hTotM is the *sum of the rounded beds* — the record must survive its own rule
		for (i = 0; i < records.length; i++) {
			rec = records[i];
			sum = 0;
			for (k = 0; k < rec.beds.length; k++) sum += rec.beds[k][1];
			rec.hTotM = round(sum);
		}
		msg.checksum = checksum(msg);
		var why = validate(msg);
		if (why) throw new Error('a core log this build made is invalid: ' + why);
		return msg;
	}

	// The commit after a carrier took the log: the selected columns now read as "known" to
	// the globe at their current fraction. Not committing is what makes the next cadence
	// retry the same columns, so a lost send cannot silently drop an observation.
	function note() {
		var k;
		for (k = 0; k < emitN; k++) {
			sent[emitCol[k]] = emitDiv[k];
			sentEver[emitCol[k]] = 1;
		}
		CLOG.lastEmitted = emitN;
		emitN = 0;
	}

	// A new cut, or a cleared page, resets the side table: the columns mean other arcs, and
	// "the globe has never seen this" is then true again.
	function reset() {
		sent.fill(0);
		sentEver.fill(0);
		emitN = 0;
		CLOG.lastEmitted = 0;
	}

	return {
		FORMAT: FORMAT, VERSION: VERSION, TH_TOL: TH_TOL, DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
		body: body, checksum: checksum, quantize: quantize, validate: validate,
		json: json, parse: parse, build: build, note: note, reset: reset,
		columnDiv: columnDiv, strataOK: strataOK,
		lastEmitted: 0
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CLOG;
else root.COLCORELOG = CLOG;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
