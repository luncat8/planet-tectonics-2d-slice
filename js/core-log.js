(function (root) {
// core-log.js — 0.4.1 M5 return path (plan §8.5): the section's one answer to the globe.
// Since 0.4.4 M2 the wire half — canonical body, hash, quantisation, validation — lives in
// port/core-log-format.js, shared byte-identical with the globe, so this file keeps only what
// belongs to the section: the cadence, the threshold, the sent ledger, and the live-stack
// reading of the same law.
//
// An observation, never a physical field: the globe may display a core log and store it in a
// side table, and the acceptance rules there are the codec's rules here, so a log that leaves
// this page cannot be refused for form. The one bed date is formation time on the section's
// clock (plan §4.3.2): rock age is the derived reading `tMyr − formedMyr`, which is why no
// second unit ever enters a record.
//
// Cadence (plan §8.5): one log per sync cadence, and only for columns whose diverged fraction
// moved beyond the threshold — or whose beds the globe has never seen. `build` selects and
// stamps; `note` commits the selection after the carrier accepted it, so a refused or dropped
// send is retried at the next cadence rather than lost.
'use strict';
var CLOG = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var CF = node ? require('../port/core-log-format.js') : window.CoreLogFormat;
	var P = node ? require('./params.js') : window.COLP;
	var State = node ? require('./state.js') : window.COLS;

	var KM = 1000;
	var FORMAT = CF.FORMAT, VERSION = CF.VERSION, TH_TOL = CF.TH_TOL;
	// plan §8.5: the fraction of a column's crust volume the section moved on its own since
	// the last accepted import must move by this much before the column is worth re-logging
	var DEFAULT_THRESHOLD = 1e-3;

	var sent = new Float64Array(P.colCap);     // diverged fraction at the last committed log
	var sentEver = new Uint8Array(P.colCap);   // 0: the globe has never seen this column's beds
	var emitCol = new Int32Array(P.colCap);    // the build's selection, committed by note()
	var emitDiv = new Float64Array(P.colCap);
	var emitN = 0;

	// The stratigraphic law the live stack must satisfy, on the same tables the codec reads:
	// formation times never decrease upward across depositional contacts. A contact is not
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
			if (!(li[at + i] >= 0 && li[at + i] < CF.LITH.length)) return 'bed ' + i + ' is not a lithology';
			if (!isFinite(ag[at + i])) return 'bed ' + i + ' has no formation time';
			if (prev >= 0 && !((fl[at + i] | fl[at + prev]) & CF.FLAG.intr) &&
				ag[at + i] < ag[at + prev] - CF.AGE_EPS) return 'bed ' + i + ' formed before the one under it';
			prev = i;
		}
		return '';
	}

	function validate(msg) { return CF.validate(msg); }
	function parse(text) { return CF.parse(text); }
	// The manual rung's field: seal again so the text always names its own checksum, then the
	// codec's one spelling. Sealing a sealed log is idempotent.
	function json(msg) { return CF.encode(CF.seal(msg)); }

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
		var j, k, b, nl, div, rec, walk = 0, mid, th;
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
			for (k = 0; k < nl; k++) {
				if (!(st.layTh[b + k] > 0)) continue;   // a delamination hole is not a bed
				rec.beds.push([st.layLi[b + k], st.layTh[b + k], st.layAg[b + k], st.layFl[b + k]]);
			}
			if (!rec.beds.length) continue;              // a column of only holes says nothing
			records.push(rec);
			emitCol[emitN] = j;
			emitDiv[emitN] = div;
			emitN++;
		}
		if (!records.length) return null;
		// the codec closes hTotM to the sum of the rounded beds and stamps the checksum,
		// so the record a build makes always survives the receiver's own sum rule
		return CF.seal({
			format: FORMAT, version: VERSION,
			pathChecksum: opts.pathChecksum, packChecksum: opts.packChecksum,
			arcKm: arc, tMyr: opts.tMyr, epochMa: opts.epochMa,
			lithologySchema: CF.LITHOLOGY_SCHEMA, records: records
		});
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
		validate: validate, json: json, parse: parse,
		build: build, note: note, reset: reset, columnDiv: columnDiv, strataOK: strataOK,
		lastEmitted: 0
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CLOG;
else root.COLCORELOG = CLOG;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
