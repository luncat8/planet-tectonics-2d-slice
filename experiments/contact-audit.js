// contact-audit.js — what a contact event does to the drawn section, and the gate
// that keeps it from doing anything louder than the background. A measurement report by
// default; `--strict` turns the contract in 0.1.5-plan.md §1 into checked gates and
// exits 1 on a violation, so the contact kernels can only change against numbers.
//
//   tmax    the heaviest crust anywhere (the design expects a plateau near 70 km,
//           not a 140 km needle)
//   dz      the largest single-frame move of the drawn surface, sampled on a
//           2048-point world raster at every frame; a visible pop is anything above
//           ~1 px, i.e. ~600 m at the default window and ~60 m at the x10 preset
//   dh      the largest single-frame change of one column's crust thickness, matched
//           across frames by position
//   dw      the largest single-frame *width* change of one column: the mechanism
//           behind every pop, since thickness is volume / width
//   belt    the local pair/shoulder ratio and contiguous width around each collision:
//           the needle's shoulder is the highest real ground in the belt's own
//           neighbourhood (the flow's reach and the flank columns); the immediate-slot
//           reading, the outer-flank ratio and the non-contiguous count are reported as
//           legacy comparison fields
//   events  column births and deaths, their rate, and how many repeat at the same
//           place (a boundary that flips state every few frames is the worst offender)
//   site    R1: the largest drawn-surface move within an event's own footprint (a birth's
//           record, a death's pre-frame record, an accretion's merged column) against the
//           section's own background, the largest move on a frame with no event. The
//           event-frame background and the same-frame pairing are reported beside it:
//           measured 12-22x on every leg, the same-frame pairing is a diagnostic, not a
//           gate, because on most event frames the rest of the section is not moving.
//   order   columns whose stack is inverted in stratigraphic rank (P.LITH_RANK, the
//           same table COL.insertVol orders by) — the signature of stacking two
//           stratigraphies instead of inserting each bed where it belongs. The stack
//           runs deepest bed first, so the rank rises with the index (sill, mafic,
//           felsic, volcanic, sediment) and an inversion is a bed whose rank falls
//           against the one below it.
//
// Run: node experiments/contact-audit.js [frames=3000] [seed=1] [kyrPerFrame=50] [png] [--strict] [--tectonic-only]
// --tectonic-only pauses K7's eruptive clock for the 0.2.0 §0 surface-budget contract;
// the default remains a combined-clock stress run, with the same unchanged gates.
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom, SIM = L.mods.sim, COL = L.mods.columns, CRU = L.mods.crust;
var R = L.mods.render;

var arg = process.argv.slice(2), flags = [], pos = [];
for (var a = 0; a < arg.length; a++) (arg[a].charAt(0) === '-' ? flags : pos).push(arg[a]);
var frames = +(pos[0] || 3000), seed = +(pos[1] || 1);
var kyr = +(pos[2] || 50), png = pos[3] && pos[3].charAt(0) !== '-' ? pos[3] : null;
var strict = flags.indexOf('--strict') >= 0;
var tectonicOnly = flags.indexOf('--tectonic-only') >= 0;
// --detail names the failures a strict run reports: which R2 samples fail and what they
// are (a pair beside a draining record, a narrow belt, a belt broken by a hole), the
// stage chain that takes a column over the R3 ceiling, and both ends of each R5 repeat
// with the distance and time between them. Report only; the gate arithmetic is unchanged.
var detail = flags.indexOf('--detail') >= 0;
var NS = 2048, step = P.wrap / NS;

// 0.2.0 M5 contact-tuning sweep hook, the way orogen-measure.js's KFIX freezes its
// constant: KG overrides P.kBeltGradient for one run, so a sweep can measure the belt
// flow's rate without editing params.js per candidate. The default run is unchanged.
var KG = Number(process.env.KG);
if (isFinite(KG) && KG > 0) P.kBeltGradient = KG;
// The same hook for the arc melt rate (0.2.3): KM overrides P.kMelt for one run, so the
// kMelt calibration can read the four strict contact legs at a candidate without editing
// params.js per candidate. The default run is unchanged.
var KM = Number(process.env.KM);
if (isFinite(KM) && KM >= 0) P.kMelt = KM;
// And for the vent lifecycle (0.2.4): VB overrides P.Vbirth (km3) and TV P.tauVent (Myr),
// re-deriving VbirthM2 and kErupt the way params.js does, so the Vbirth/tauVent cadence
// table can gate every candidate on the same four legs. The default run is unchanged.
var VB = Number(process.env.VB), TV = Number(process.env.TV);
if (isFinite(VB) && VB > 0) {
	P.Vbirth = VB;
	P.VbirthM2 = P.Vbirth * P.venKm3M2;
	P.kErupt = 2 * Math.sqrt(P.VchM2 * P.VbirthM2) / P.tDrain;
}
if (isFinite(TV) && TV > 0) P.tauVent = TV;

// The kernel's event memory at this leg's rate: P.evAge of simulated time in frames.
// 0.2.0 M5's frame-versus-clock policy reads it in both event gates (R5's repeat
// window, R2's standing-needle run); it coincides with the old P.evGap frame window
// only at the 50 kyr reference rate (40 frames = 2 Myr).
var evAgeFrames = P.evAge / (kyr * 1e-3);

L.check.section('contact-audit site bookkeeping');
var siteProbe = siteValues(new Set([4, 9])), seenProbe = { 4: 10 };
L.check.ok('event buckets are concrete Set values', siteProbe.length === 2 && siteProbe[0] === 4 && siteProbe[1] === 9);
L.check.ok('repeat spacing uses the current event frame',
	seen(seenProbe, 4, 10 + P.evGap - 1) === 1 && seen(seenProbe, 4, 10 + P.evGap) === 0);
// The R1 window is the event's own footprint, not the bucket's left edge: an event at
// 4/5 of its 2.5 w0 bucket is 0.5 w0 past the old window's right edge (the window spans
// the bucket's left edge +- 1.5 w0, i.e. the left 60% of the bucket), and the event's
// own footprint there is exactly what the gate must read as "at the site".
var bucketW = 2.5 * P.w0, probeEvent = 0.8 * bucketW;
L.check.ok('the R1 window is anchored at the event, not at its bucket',
	inWindow(probeEvent, probeEvent) && inWindow(probeEvent + 1.4 * P.w0, probeEvent) &&
	!inWindow(probeEvent + 1.6 * P.w0, probeEvent) &&
	inWindow(probeEvent, Math.floor(probeEvent / bucketW) * bucketW) === false,
	'event at ' + (probeEvent / 1e3).toFixed(1) + ' km, bucket left edge ' +
	(Math.floor(probeEvent / bucketW) * bucketW / 1e3).toFixed(1) + ' km');
// The standing-needle run (0.2.0 M5's R2 gate): consecutive frames above the limit at
// one site, counted once per frame per site, resetting on a gap.
var standProbe = { last: {}, run: {} }, standProbeRun = 0, standProbeK;
for (standProbeK = 0; standProbeK < evAgeFrames + 2; standProbeK++) standProbeRun = standRun(standProbe, 4, 100 + standProbeK);
L.check.ok('a standing-needle run counts consecutive frames and resets on a gap',
	standProbeRun === evAgeFrames + 2 &&
	standRun(standProbe, 4, 100 + evAgeFrames + 5) === 1 &&
	standRun(standProbe, 4, 100 + evAgeFrames + 5) === 1,
	'a run of ' + (evAgeFrames + 2) + ' frames reaches ' + standProbeRun +
	', a gap resets to 1, a second sample in one frame does not double-count');

if (tectonicOnly) P.sl.erupt = 0;
L.check.planet(seed, 'def');
L.check.info('clock scope', tectonicOnly ? 'tectonic only (eruptive slider paused)' : 'combined clocks (K7 write-back included)');
SIM.setGeo(kyr * 1e3);

var RANK = P.LITH_RANK;
var SITE = { b: {}, d: {} };   // rounded event sites, to catch a boundary that keeps flipping
var MATCH = new Int32Array(P.colCap), PRE = new Int32Array(P.colCap);
var NEAR = new Int32Array(P.colCap), NEAR2 = new Int32Array(P.colCap);

var sample = new Float64Array(NS), prevZ = new Float64Array(NS);
// pre-frame records, reused every frame: this loop runs 3000-5000 times and the audit is
// the measurement the tuning reads, so it may not spend its time in the collector
var preX = new Float64Array(P.colCap), preTh = new Float64Array(P.colCap);
var preW = new Float64Array(P.colCap), preG = new Uint8Array(P.colCap), preNew = new Uint8Array(P.colCap);
var accPreX = new Float64Array(P.colCap), accSiteX = new Float64Array(P.colCap), nAccSite = 0, k4 = COL.k4;
// The accretion's territory is the merged column: the retired record's pre-K4 position and
// the surviving record's. R1's site is the event's own footprint, and for an accretion the
// footprint is both ends of the merge (measured 3.9 km apart at the crush floor, so the two
// windows nearly coincide; the survivor's x is still read so the report can name it).
var accSurvX = new Float64Array(P.colCap);
COL.k4 = function (st, dt, t, Tm) {
	var n = st.nCol, i, j, c, other;
	nAccSite = 0;
	this.intents();
	for (i = 0; i < n; i++) {
		if (this.intent[i] !== 4) continue;
		c = this.crush[i];
		if (c >= 0 && c < n) accPreX[i] = st.colX[c];
	}
	var changed = k4.call(this, st, dt, t, Tm);
	if (!changed) return changed;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		c = this.crush[i];
		if (this.intent[i] !== 4 || !(c === i || c === j) || !this.accreteLock[c]) continue;
		if (this.dead[c] !== 1 || this.map[c] >= 0) continue;
		other = c === i ? j : i;
		accSiteX[nAccSite] = accPreX[i];
		accSurvX[nAccSite] = this.map[other] >= 0 ? st.colX[this.map[other]] : accPreX[i];
		nAccSite++;
	}
	return changed;
};

function sampleField(field, out) {
	var n = S.nCol, m, lo, hi, mid, k, km, f, d, dl;
	if (n === 0) { out.fill(0); return; }
	for (m = 0; m < NS; m++) {
		var x = m * step;
		lo = 0; hi = n;
		while (lo < hi) { mid = (lo + hi) >> 1; if (S.colX[mid] < x) lo = mid + 1; else hi = mid; }
		k = lo < n ? lo : 0;
		km = k > 0 ? k - 1 : n - 1;
		dl = x - S.colX[km]; if (dl < 0) dl += P.wrap;
		d = S.colX[k] - S.colX[km]; if (d <= 0) d += P.wrap;
		f = d > 0 ? dl / d : 0;
		out[m] = field[km] + (field[k] - field[km]) * f;
	}
}

var maxH = 0, maxHFrame = -1, maxHCol = -1, maxHX = 0, maxHAccrete = false, maxHFel = 0, maxHMaf = 0, maxHSed = 0, maxDz = 0, maxDzFrame = -1, maxDzX = 0, dzSum = 0, dzN = 0, over100 = 0;
// The same repeats read against the model's own memory, P.evAge (Myr), and against the
// frame window P.evGap. They coincide at the 50 kyr reference rate (40 frames = 2 Myr);
// at 100 kyr the frame window is twice the time the kernel promises. 0.2.0 M5 settled
// the frame-versus-clock policy: the gate is the P.evAge count (the kernel's promise),
// the P.evGap count stays reported (see gate() below).
var flipRepeatAge = 0;
var maxDh = 0, maxDhFrame = -1, maxDhX = 0, maxDw = 0, maxDwFrame = -1;
var births = 0, deaths = 0, accretions = 0, birthRepeat = 0, deathRepeat = 0, flipLast = 0;
var inversions = 0, atCap = 0, atCapStay = 0, maxSlope = 0, t0 = Date.now();
// A stack that is full is fine for the frame it consolidates in and a defect for every
// frame after that: a column that never frees a bed is dropping the arrivals. Records
// are gathered and their indices move, so the stay is counted per column width of
// position rather than per index: a slot per w0 of world, stamped with the last frame it
// was touched. A key far from another cannot collide -- 4096 slots is eight worlds wide.
var CAP_K = 4096;
var capLast = new Int32Array(CAP_K).fill(-1), capStay = new Int32Array(CAP_K);
var capStayMax = 0;
var contactMax = 0, contactCol = -1, evDz = 0, flipRepeat = 0;
var quietDz = 0, quietDh = 0, quietDw = 0, ghostMax = 0, ghostWide = 0, ghostAge = 0, ghostShare = 0;
var siteDz = 0, awayDz = 0, siteDzFrame = -1, siteDzX = 0, siteDzKind = '-', awayDzFrame = -1, awayDzX = 0, f, i, k, j, m, d;
// The same-frame pairing (report only): the worst frame whose event-site move is loud
// against the rest of that same frame.
var frameRatio = 0, frameRatioF = -1, frameRatioSite = 0, frameRatioAway = 0;
var quietFr = -1, quietX = 0;
var beltN = 0, beltBump = 0, beltWide = 0, beltContigWide = 0, beltExcess = 0;
var beltRunWorst = 99, beltX = 0, beltRunX = 0, beltNeedleMax = 0, beltNeedleX = 0;
var beltPeakFrame = -1, beltPeakI = -1, beltPeakH = 0, beltPeakFlank = 0, beltPeakLocal = 0;
var beltPeakLocalR = 0, beltPeakWindow = 0, beltPeakProfile = new Float64Array(8);
var beltRunFrame = -1, beltRunI = -1, beltRunPeak = 0, beltRunFlank = 0, beltRunProfile = new Float64Array(8);
var beltNeedleFrame = -1, beltNeedleI = -1, beltNeedlePeak = 0, beltNeedleShoulder = 0;
var beltNeedleProfile = new Float64Array(8), beltContigWorst = 99, beltContigFrame = -1;
var beltContigI = -1, beltContigProfile = new Float64Array(8);
// The standing-needle bookkeeping (0.2.0 M5's R2 gate): per 2.5 w0 site (the same bucket
// the R5 bookkeeping uses) the run of consecutive frames above P.beltPeak. A run longer
// than the kernel's event memory (P.evAge of simulated time) is the standing needle the
// clause gates; the single-frame worst draw stays reported beside it (beltNeedleMax).
var needleStand = 0, needleRunMax = 0, needleSite = { last: {}, run: {} }, needleStood = {};
var D_STAND = [];
var r2Scratch = { flank: 0, peak: 0, shoulder: 0, outerRatio: 0, needleRatio: 0,
	needleImmediate: 0, needleImmediateRatio: 0, widthCount: 0, widthRun: 0, built: false };
// R1's site is the event's own footprint, in metres: a birth's record, a drained death's
// pre-frame record, an accretion's merged column (both ends). The bucket sets below stay
// the R5 bookkeeping (repeats are counted per 2.5 w0 site) and the event counters; the
// window is read off these positions, never off the bucket's left edge (0.1.9-plan.md §2).
var SITE_X = [], SITE_B = [], SITE_D = [], SITE_A = [];
var bSites = new Set(), dSites = new Set(), halfW = 0.4 * P.w0, unmatched = 0, rematched = 0, consumed = [];
// detail state (--detail)
var D_NEEDLE = { n: 0, ghost: 0, worst: 0, worstRow: null, rawN: 0, rawGhost: 0, rawWorst: 0 }, D_WIDTH = { n: 0, narrow: 0, hole: 0, ghostWin: 0 };
var D_WIDTH_SITES = {}, D_WIDTH_FIRST = {}, D_WIDTH_LAST = {};
var D_BREACH = { n: 0, frames: 0, rows: [] }, D_BREACH_ALLOW = P.crustMax + 35e3 * kyr / 1e3;
var D_STAGE = ['k4', 'zDyn', 'collapse', 'arcGrowth', 'lipGrowth', 'delaminate'], D_HIST = {};
var D_CUR = { b: {}, d: {} }, D_LASTX = { b: {}, d: {} }, D_REPEATS = [];
var dPreH = new Float64Array(P.colCap), dPreW = new Float64Array(P.colCap), dPreX = new Float64Array(P.colCap);
if (detail) {
	for (i = 0; i < D_STAGE.length; i++) D_HIST[D_STAGE[i]] = new Float64Array(P.colCap);
	var dK4 = COL.k4;
	COL.k4 = function (st, dt, t, Tm) {
		var n = st.nCol, q;
		for (q = 0; q < n; q++) { dPreH[q] = st.hTot[q]; dPreW[q] = st.colW[q]; dPreX[q] = st.colX[q]; }
		var r = dK4.call(COL, st, dt, t, Tm);
		D_HIST.k4.set(st.hTot.subarray(0, st.nCol));
		return r;
	};
	for (i = 1; i < D_STAGE.length; i++) {
		var dFn = CRU[D_STAGE[i]];
		CRU[D_STAGE[i]] = (function (nm, orig) {
			return function (st, dt, t, Tm) {
				var r = orig.call(CRU, st, dt, t, Tm);
				D_HIST[nm].set(st.hTot.subarray(0, st.nCol));
				return r;
			};
		})(D_STAGE[i], dFn);
	}
}

sampleField(S.z, prevZ);

for (f = 0; f < frames; f++) {
	var preN = S.nCol;
	for (i = 0; i < preN; i++) { preX[i] = S.colX[i]; preTh[i] = S.hTot[i]; preW[i] = S.colW[i]; preG[i] = S.colGhost[i]; preNew[i] = COL.isNew[i]; }
	SIM.step();
	accretions += nAccSite;
	// Whether this is an event frame is read off the crust itself, and off the code's
	// own flags rather than off a comparison: a record consumed this frame is a draining
	// one whose age has been zeroed, and a record born this frame is one the contact
	// kernel marked that is not the same marked record as it was. The record count is no
	// guide -- a split leaves it alone, and so does a consumption. Getting this wrong is
	// not a detail of the report: a frame that re-partitions looks quiet, and the pieces
	// of one column then report their parent's whole section as a one-frame change
	// (measured: 53.5 km of drawn thickness and 135% of width on a frame the audit had
	// called quiet).
	consumed.length = 0;
	if (detail) { D_CUR.b = {}; D_CUR.d = {}; }
	match(preX, preG, preNew, preW, preN);
	SITE_X.length = 0; SITE_B.length = 0; SITE_D.length = 0; SITE_A.length = 0;
	bSites.clear();
	dSites.clear();
	for (k = 0; k < consumed.length; k++) {
		if (preG[consumed[k]]) continue;
		dSites.add(Math.floor(preX[consumed[k]] / (2.5 * P.w0)));
		SITE_X.push(preX[consumed[k]]); SITE_D.push(preX[consumed[k]]);
		if (detail) {
			var dk = Math.floor(preX[consumed[k]] / (2.5 * P.w0));
			(D_CUR.d[dk] = D_CUR.d[dk] || []).push(preX[consumed[k]]);
		}
	}
	// A conveyor retirement has no ghost successor, so merge-walking cannot infer it
	// from the final topology. COL.k4's instrumentation captures its pre-removal site.
	for (k = 0; k < nAccSite; k++) {
		dSites.add(Math.floor(accSiteX[k] / (2.5 * P.w0)));
		SITE_X.push(accSiteX[k]); SITE_A.push(accSiteX[k]);
		SITE_X.push(accSurvX[k]); SITE_A.push(accSurvX[k]);
		if (detail) {
			var ak = Math.floor(accSiteX[k] / (2.5 * P.w0));
			(D_CUR.d[ak] = D_CUR.d[ak] || []).push(accSiteX[k]);
		}
	}
	for (i = 0; i < S.nCol; i++) {
		if (S.colGhost[i]) continue;
		if (S.colW[i] < halfW) continue;              // a sliver, not a record
		if (COL.isNew[i] && (MATCH[i] < 0 || !preNew[MATCH[i]])) {
			bSites.add(Math.floor(S.colX[i] / (2.5 * P.w0)));
			SITE_X.push(S.colX[i]); SITE_B.push(S.colX[i]);
			if (detail) {
				var bk = Math.floor(S.colX[i] / (2.5 * P.w0));
				(D_CUR.b[bk] = D_CUR.b[bk] || []).push(S.colX[i]);
			}
		}
	}
	var bSiteList = siteValues(bSites), dSiteList = siteValues(dSites);
	births += bSiteList.length;
	deaths += dSiteList.length;
	for (k = 0; k < bSiteList.length; k++) {
		var bs = bSiteList[k];
		flipRepeat += seen(SITE.d, bs, f);
		flipRepeatAge += seenAge(SITE.d, bs, f);
		if (detail && lastAt(SITE.d, bs, f) >= 0) D_REPEATS.push({ f: f, kind: 'birth', site: bs, gap: f - lastAt(SITE.d, bs, f),
			x: minSepX(D_CUR.b[bs], D_LASTX.d[bs]), events: D_CUR.b[bs].length + D_LASTX.d[bs].length,
			otherKind: 'death', otherF: lastAt(SITE.d, bs, f) });
		if (seen(SITE.b, bs, f)) birthRepeat++;
		SITE.b[bs] = f;
		if (detail) D_LASTX.b[bs] = D_CUR.b[bs];
	}
	for (k = 0; k < dSiteList.length; k++) {
		var ds = dSiteList[k];
		flipRepeat += seen(SITE.b, ds, f);
		flipRepeatAge += seenAge(SITE.b, ds, f);
		if (detail && lastAt(SITE.b, ds, f) >= 0) D_REPEATS.push({ f: f, kind: 'death', site: ds, gap: f - lastAt(SITE.b, ds, f),
			x: minSepX(D_CUR.d[ds], D_LASTX.b[ds]), events: D_CUR.d[ds].length + D_LASTX.b[ds].length,
			otherKind: 'birth', otherF: lastAt(SITE.b, ds, f) });
		if (seen(SITE.d, ds, f)) deathRepeat++;
		SITE.d[ds] = f;
		if (detail) D_LASTX.d[ds] = D_CUR.d[ds];
	}
	var event = bSites.size + dSites.size > 0;
	var smF = 0, amF = 0, axF = 0;
	sampleField(S.z, sample);
	for (m = 0; m < NS; m++) {
		d = sample[m] - prevZ[m];
		if (d < 0) d = -d;
		dzSum += d; dzN++;
		if (d > 100) over100++;
		if (d > maxDz) { maxDz = d; maxDzFrame = f; maxDzX = m * step; }
		if (d > 0) {
			if (event) {
				if (d > evDz) evDz = d;
				if (atSite(m * step)) {
					if (d > smF) smF = d;
					if (d > siteDz) {
						siteDz = d; siteDzFrame = f; siteDzX = m * step;
						siteDzKind = siteKind(m * step);
					}
				} else if (d > amF) { amF = d; axF = m * step; }
			} else if (d > quietDz) { quietDz = d; quietFr = f; quietX = m * step; }
		}
		prevZ[m] = sample[m];
	}
	if (event) {
		if (amF > awayDz) { awayDz = amF; awayDzFrame = f; awayDzX = axF; }
		// the same-frame pairing, report only: the worst frame whose event-footprint move
		// is loud against the rest of that same frame
		if (amF > 0 && smF / amF > frameRatio) {
			frameRatio = smF / amF; frameRatioF = f; frameRatioSite = smF; frameRatioAway = amF;
		}
	}
	if (!event) {
		// A quiet frame is the only place this can be read: with nothing born and
		// nothing consumed, every real record has exactly one record to be the same
		// record as, and a change in its drawn thickness or its width is the crust
		// changing with no event to account for. Draining records are excluded -- a
		// sliver is a line between two margins, so the thickness it hands back is the
		// margin's -- and so is anything narrower than 0.4 of a column, which is a
		// sliver that has not quite finished draining.
		for (i = 0; i < S.nCol; i++) {
			if (S.colGhost[i] || S.colW[i] < halfW) continue;
			var best = MATCH[i];
			if (best < 0) { unmatched++; continue; }
			// width first, thickness second: a record that wins or loses territory shows
			// up here before it shows up in the drawn picture. A pair that is not the
			// same width is not the same record -- a suture welds two of them into one
			// and the test would report the whole of one as the other's change -- so
			// those are counted and not measured.
			if (preW[best] > 0) {
				d = Math.abs(S.colW[i] - preW[best]) / preW[best];
				if (d > 0.1) { rematched++; continue; }
				if (d > maxDw) { maxDw = d; maxDwFrame = f; }
				if (d > quietDw) quietDw = d;
			}
			d = S.hTot[i] - preTh[best];
			if (d < 0) d = -d;
			if (d > maxDh) { maxDh = d; maxDhFrame = f; maxDhX = S.colX[i]; }
			if (d > quietDh) quietDh = d;
		}
	}
	var nGhost = 0, gOldest = 0, fMax = 0, fMaxCol = 0;
	for (i = 0; i < S.nCol; i++) {
		if (detail && S.hTot[i] > fMax) { fMax = S.hTot[i]; fMaxCol = i; }
		if (S.hTot[i] > maxH) {
			maxH = S.hTot[i]; maxHFrame = f; maxHCol = i; maxHX = S.colX[i]; maxHAccrete = nAccSite > 0;
			maxHFel = S.hFel[i]; maxHMaf = S.hMaf[i]; maxHSed = S.hSed[i];
		}
		var b = i * P.layerCap;
		for (k = 0; k + 1 < S.colNL[i]; k++) {
			if (RANK[S.layLi[b + k]] > RANK[S.layLi[b + k + 1]]) { inversions++; break; }
		}
		if (S.colNL[i] >= P.layerCap) {
			atCap++;
			// +16 and mod: a position at the wrap has a negative rounding when a column
			// sits a hair before x = 0
			var capKey = (Math.round(S.colX[i] / P.w0) + 16) % CAP_K;
			capStay[capKey] = capLast[capKey] === f - 1 ? capStay[capKey] + 1 : 1;
			capLast[capKey] = f;
			if (capStay[capKey] > capStayMax) capStayMax = capStay[capKey];
		}
		if (S.colGhost[i]) {
			nGhost++;
			if (S.colAge[i] > gOldest) gOldest = S.colAge[i];
		}
		j = i + 1 < S.nCol ? i + 1 : 0;
		d = S.colX[j] - S.colX[i]; if (d < 0) d += P.wrap;
		if (d > 0) {
			var sl = Math.abs(S.z[j] - S.z[i]) / d;
			if (sl > maxSlope) maxSlope = sl;
		}
		if (S.edge[i] === P.EDGE.collide || (S.edge[i] === P.EDGE.subduct && S.edgePol[i] > 0)) {
			if (S.hTot[i] > contactMax) { contactMax = S.hTot[i]; contactCol = i; }
		}
	}
	if (detail && fMax > D_BREACH_ALLOW) {
		// the stage chain of the breaching column: hTot after K4 and after every K5 stage,
		// with its width and the volume those imply, plus where it came from (the pre-K4
		// state, matched by position)
		var row = { f: f, c: fMaxCol, x: S.colX[fMaxCol], w: S.colW[fMaxCol], ghost: S.colGhost[fMaxCol],
			edge: S.edge[fMaxCol], h: fMax, stages: [], pre: null };
		for (k = 0; k < D_STAGE.length; k++) row.stages.push(D_HIST[D_STAGE[k]][fMaxCol]);
		for (k = 0; k < S.nCol; k++) {
			if (dPreH[k] <= 0 || dPreH[k] < dPreH[fMaxCol] * 0.5) continue;
			d = S.colX[fMaxCol] - dPreX[k];
			if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d < 0) d = -d;
			if (d < 2e3) { row.pre = { h: dPreH[k], w: dPreW[k], x: dPreX[k] }; break; }
		}
		D_BREACH.n++;
		if (D_BREACH.frames < 8) { D_BREACH.frames++; D_BREACH.rows.push(row); }
	}
	beltScan();
	if (capStayMax > atCapStay) atCapStay = capStayMax;
	if (nGhost > ghostMax) ghostMax = nGhost;
	if (gOldest > ghostAge) ghostAge = gOldest;
	{
		var run = 0, widest = 0, share = 0;
		for (i = 0; i < S.nCol; i++) {
			run = S.colGhost[i] ? run + 1 : 0;
			if (run > widest) widest = run;
			if (S.colGhost[i]) share += S.colW[i];
		}
		if (widest > ghostWide) ghostWide = widest;
		if (share > ghostShare) ghostShare = share / P.wrap;
	}
}
var ms = (Date.now() - t0) / frames;

console.log('contact audit — seed ' + seed + ', ' + kyr + ' kyr/frame, ' + frames + ' frames (' +
	SIM.t.toFixed(0) + ' Myr), ' + ms.toFixed(2) + ' ms/frame' + (strict ? '   [STRICT]' : ''));
console.log('  crust          max ' + fmtKm(maxH) + '   thickest at a contact ' + fmtKm(contactMax) +
	'   collisions ' + beltN + ' seen; legacy peak/flank ' + beltExcess.toFixed(2) +
	'x, legacy 4-of-6 ' + (beltBump ? pct(beltWide / beltBump) : '-') +
	', contiguous 4-of-6 ' + (beltBump ? pct(beltContigWide / beltBump) : '-') +
	' of ' + beltBump + ' built samples' +
	'   draining records ' + ghostMax + ' live holding ' + pct(ghostShare) +
	' of the crust, widest run ' + (ghostWide / P.w0).toFixed(1) + ' columns (oldest ' +
	ghostAge.toFixed(1) + ' Myr)');
console.log('  R2 legacy peak frame ' + beltPeakFrame + ', edge ' + beltPeakI + ', pair ' + fmtKm(beltPeakH) +
	' / outer flank ' + fmtKm(beltPeakFlank) + ' (' + beltExcess.toFixed(2) + 'x), mean immediate shoulders ' +
	fmtKm(beltPeakLocal) + ' (' + beltPeakLocalR.toFixed(2) + 'x), legacy count ' + beltPeakWindow +
	'/6 above outer flank + ' + fmtKm(P.beltRise) + ': ' +
	Array.from(beltPeakProfile, function (h) { return (h / 1e3).toFixed(1); }).join('/') + ' km');
console.log('  R2 local needle frame ' + beltNeedleFrame + ', edge ' + beltNeedleI + ', pair ' +
	fmtKm(beltNeedlePeak) + ' / highest belt-neighbourhood shoulder ' + fmtKm(beltNeedleShoulder) +
	' (' + beltNeedleMax.toFixed(2) + 'x; max ' + P.beltPeak + '), local hTot (-3..+4) km: ' +
	Array.from(beltNeedleProfile, function (h) { return (h / 1e3).toFixed(1); }).join('/'));
console.log('  R2 legacy width narrowest count ' + beltRunWorst + '/6 at frame ' + beltRunFrame + ', edge ' +
	beltRunI + ', pair/flank ' + (beltRunFlank > 0 ? (beltRunPeak / beltRunFlank).toFixed(2) : 'n/a') +
	': ' + Array.from(beltRunProfile, function (h) { return (h / 1e3).toFixed(1); }).join('/') + ' km');
console.log('  R2 contiguous width minimum ' + beltContigWorst + '/6 at frame ' + beltContigFrame +
	', edge ' + beltContigI + ': ' +
	Array.from(beltContigProfile, function (h) { return (h / 1e3).toFixed(1); }).join('/') + ' km');
console.log('  max column     frame ' + maxHFrame + ', record ' + maxHCol + ', x ' + fmtKm(maxHX) +
	'   fel ' + fmtKm(maxHFel) + ', maf ' + fmtKm(maxHMaf) + ', sed ' + fmtKm(maxHSed) +
	', on a C-C retirement frame: ' + maxHAccrete);
console.log('  surface        worst single-frame move ' + fmtM(maxDz) + ' at frame ' + maxDzFrame +
	' x ' + fmtKm(maxDzX) + '   mean ' + (dzSum / Math.max(1, dzN)).toFixed(1) + ' m, ' +
	over100 + ' raster samples above 100 m');
console.log('  R1 event site  ' + fmtM(siteDz) + ' in an event footprint (' + siteDzKind + ', frame ' + siteDzFrame +
	' x ' + fmtKm(siteDzX) + ') against the quiet-frame yardstick ' + fmtM(quietDz) + ' (frame ' + quietFr + ' x ' +
	fmtKm(quietX) + '), ratio ' + (siteDz / Math.max(1, quietDz)).toFixed(2) + ' (max ' + P.evDzK + ')' +
	'\n                 event-frame background (report) ' + fmtM(awayDz) + ' (frame ' + awayDzFrame + ' x ' + fmtKm(awayDzX) +
	'), worst same-frame pairing (report) ' + frameRatio.toFixed(2) + ' at frame ' + frameRatioF + ' (' + fmtM(frameRatioSite) +
	' vs ' + fmtM(frameRatioAway) + ')' +
	'\n                 quiet-frame drawn thickness ' + fmtKm(quietDh) + ' and width ' + pct(quietDw) +
	', ' + unmatched + ' quiet records with no counterpart, ' + rematched + ' re-partitioned)');
console.log('  columns        worst single-frame drawn-thickness change ' + fmtKm(maxDh) + ' at frame ' +
	maxDhFrame + ' x ' + fmtKm(maxDhX) + '   worst width change ' + pct(maxDw) + ' at frame ' +
	maxDwFrame + '   worst local slope ' + (maxSlope * 100).toFixed(1) + '%');
console.log('  topology       ' + births + ' births / ' + deaths + ' deaths (' + per1000(births + deaths) +
	' per 1000 frames, incl. ' + accretions + ' C-C retirements) at ' + birthRepeat + ' repeated birth and ' + deathRepeat + ' repeated death ' +
	'sites (' + S.nCol + ' columns, ' + S.nPl + ' plates)');
console.log('  stacks         ' + inversions + ' column-frames with an inverted bed, ' +
	atCap + ' column-frames at layerCap');
if (png) writePng(png);
if (detail) detailReport();
if (strict) gate();

// The pre-frame record each current record continues, by position: a gather reorders
// the whole array, so an index window is not a correspondence. Two sorted lists, one
// merge walk, -1 where a record is new (or has moved further than half a column).
// Match the records across a step: MATCH[i] is the record before the step that is the
// same record as i after it, and PRE[j] the same the other way (-1 where there is none).
//
// Two properties make the answer trustworthy. The window is 0.4 of a column, not half
// of one: records are a column wide, so half a column can reach a record's neighbour
// and hand it the neighbour's history. And both sides are only sorted around the
// circle -- a plate that crosses the antimeridian is renumbered, so the records run
// off the end of the array and start again at the front -- so the walk starts after
// the descent in each array. Walking from index 0 instead matched a column at 4700 km
// to one at 24600 km, which is where 53 km of one-frame thickness change came from.
//
// Draining records are left out of it. A draining record stands a few km from the
// margin whose ground it is drawing, so the two claim each other's counterpart and
// both come away unmatched; the margin is a real record and is matched to the record
// that was there, which is the only history the drawn-thickness test may use.
function match(thenX, thenG, thenNew, thenW, thenN) {
	var half = 0.4 * P.w0, k, i, b, x, d, e, a, cs = 0, ps = 0;
	for (k = 1; k < S.nCol; k++) if (S.colX[k] < S.colX[k - 1]) { cs = k; break; }
	for (k = 1; k < thenN; k++) if (thenX[k] < thenX[k - 1]) { ps = k; break; }
	MATCH.fill(-1, 0, S.nCol);
	PRE.fill(-1, 0, thenN);
	// A draining record is matched first and keeps the record it replaced, which is
	// the consumption the audit reports and the only history a real record may not
	// take: the record is four km from the margin that has just closed over it, and
	// left in the pool the margin picks it up and reports 48 km of one-frame drawn
	// thickness change (measured at frame 4863 on seed 5).
	for (i = 0; i < S.nCol; i++) {
		if (!S.colGhost[i]) continue;
		// A draining record stands a few km from the margin that has closed over it, and
		// the two are the same width to within a couple of per cent where the margin is
		// a third wider, so the width is what says which record this one was. A ghost
		// that was already draining has no real record to claim and is left alone: it is
		// being retired, which is not a change of topology.
		var gw = Infinity, gj = -1;
		for (k = 0; k < thenN; k++) {
			if (thenG[k] || PRE[k] !== -1 || thenW[k] < halfW) continue;
			d = S.colX[i] - thenX[k];
			if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d < 0) d = -d;
			if (d > 0.1 * P.w0) continue;
			d = (S.colW[i] - thenW[k]) / thenW[k];
			if (d < 0) d = -d;
			if (d < gw) { gw = d; gj = k; }
		}
		if (gj >= 0 && gw < 0.1) { PRE[gj] = -2; consumed.push(gj); }
	}
	b = 0;
	for (k = 0; k < S.nCol; k++) {
		i = (cs + k) % S.nCol;
		if (S.colGhost[i]) continue;
		x = S.colX[i];
		while (b < thenN) {                      // catch up over the seam, then walk on
			d = thenX[(ps + b) % thenN] - x;
			if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d < -half) b++; else if (d > half) b++; else break;
		}
		a = -1; e = Infinity;
		if (b < thenN && !thenG[(ps + b) % thenN] && PRE[(ps + b) % thenN] !== -2 && thenW[(ps + b) % thenN] >= halfW) {
			d = thenX[(ps + b) % thenN] - x;
			if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d < 0) d = -d;
			if (d <= half) { e = d; a = (ps + b) % thenN; }
		}
		if (b > 0 && !thenG[(ps + b - 1) % thenN] && PRE[(ps + b - 1) % thenN] !== -2 && thenW[(ps + b - 1) % thenN] >= halfW) {
			d = x - thenX[(ps + b - 1) % thenN];
			if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d < 0) d = -d;
			if (d < e) { e = d; a = (ps + b - 1) % thenN; }
		}
		MATCH[i] = a;
		if (a >= 0) PRE[a] = i;
	}
}

// A site that changes again too soon is a boundary flickering between states, which is
// what the sustained-event gate in the contact kernel exists to prevent. Re-opening a
// rift after a Wilson cycle is geology, so the test is spacing, not a flat "never twice".
function siteValues(set) { return Array.from(set); }

function seen(table, site, frame) {
	var prev = table[site];
	if (prev === undefined) return 0;
	return (frame - prev) < P.evGap ? 1 : 0;
}

// The closest pair of event positions between two frames' event lists, and the list
// sizes: a "site" is a 2.5-column bucket, so the separation, not the bucket, is what says
// whether the two events are the same boundary or two boundaries that share a bucket.
function minSepX(a, b) {
	if (!a || !b) return NaN;
	var i, j, d, cost = Infinity;
	for (i = 0; i < a.length; i++) for (j = 0; j < b.length; j++) {
		d = Math.abs(a[i] - b[j]);
		if (d > P.wrap * 0.5) d = P.wrap - d;
		if (d < cost) cost = d;
	}
	return cost;
}

// the same spacing test in time: inside P.evAge Myr of the previous event
function seenAge(table, site, frame) {
	var prev = table[site];
	if (prev === undefined) return 0;
	return (frame - prev) < evAgeFrames ? 1 : 0;
}

// The standing-needle run: consecutive frames above the limit at one site, counted once
// per frame per site (a bucket can hold two collide pairs), resetting on a gap. Returns
// the run length ending at this frame.
function standRun(table, site, frame) {
	var prev = table.last[site];
	if (prev === frame) return table.run[site];
	var run = prev === frame - 1 ? table.run[site] + 1 : 1;
	table.last[site] = frame;
	table.run[site] = run;
	return run;
}

// the frame of the last event at a site when it is inside the event memory, else -1
function lastAt(table, site, frame) {
	var prev = table[site];
	if (prev === undefined || (frame - prev) >= P.evGap) return -1;
	return prev;
}

// --detail: classify one R2 sample. The needle half reports the raw-slot reading next to
// the selected one, so the leg that made the shoulder walk necessary stays visible.
function detailSample(i, j, f) {
	var rawRatio = r2Scratch.needleImmediateRatio;
	if (rawRatio > P.beltPeak) {
		D_NEEDLE.rawN++;
		if (S.colGhost[wm(i - 1)] || S.colGhost[wm(j + 1)]) D_NEEDLE.rawGhost++;
		if (rawRatio > D_NEEDLE.rawWorst) D_NEEDLE.rawWorst = rawRatio;
	}
	if (r2Scratch.needleRatio > P.beltPeak) {
		D_NEEDLE.n++;
		if (S.colGhost[wm(i - 1)] || S.colGhost[wm(j + 1)]) D_NEEDLE.ghost++;
		if (r2Scratch.needleRatio > D_NEEDLE.worst) {
			D_NEEDLE.worst = r2Scratch.needleRatio;
			D_NEEDLE.worstRow = { f: f, i: i, x: S.colX[i], ratio: r2Scratch.needleRatio, peak: r2Scratch.peak,
				shoulder: r2Scratch.shoulder, immediate: r2Scratch.needleImmediate,
				grew: r2Scratch.needleImmediateRatio, gl: S.colGhost[wm(i - 1)], gr: S.colGhost[wm(j + 1)],
				hl: S.hTot[wm(i - 1)], hr: S.hTot[wm(j + 1)], built: r2Scratch.built,
				prof: [-2, -1, 0, 1, 2, 3].map(function (d) { return S.hTot[wm(i + d)] / 1e3; }) };
		}
	}
	if (!r2Scratch.built || r2Scratch.widthRun >= P.beltCols) return;
	D_WIDTH.n++;
	var rise = r2Scratch.flank + P.beltRise, cnt = 0, gwin = 0, d, c;
	for (d = -2; d <= 3; d++) {
		c = wm(i + d);
		if (S.colGhost[c]) gwin++; else if (S.hTot[c] >= rise) cnt++;
	}
	if (gwin) D_WIDTH.ghostWin++;
	if (cnt < P.beltCols) D_WIDTH.narrow++; else D_WIDTH.hole++;
	var key = Math.round(S.colX[i] / P.w0);
	D_WIDTH_SITES[key] = (D_WIDTH_SITES[key] || 0) + 1;
	if (D_WIDTH_FIRST[key] === undefined) D_WIDTH_FIRST[key] = { f: f, i: i, x: S.colX[i], cnt: cnt, ghost: gwin,
		run: r2Scratch.widthRun, margin: r2Scratch.peak - r2Scratch.flank, needle: r2Scratch.needleRatio,
		rel: S.edgeRelN[i], prof: [-2, -1, 0, 1, 2, 3].map(function (d) { return S.hTot[wm(i + d)] / 1e3; }) };
	D_WIDTH_LAST[key] = f;
}

// --detail report. Report only: it reads the same state the gates read and changes none
// of it (no counters here feed a gate decision).
function detailReport() {
	var i, k, keys, r;
	console.log('\n--detail: what the failures are (report only; gates above are unchanged)');
	console.log('  R2 needle   immediate-slot failures ' + D_NEEDLE.rawN + ' (worst ' + D_NEEDLE.rawWorst.toFixed(2) +
		', of which a draining shoulder ' + D_NEEDLE.rawGhost + '); with the belt-neighbourhood shoulder ' + D_NEEDLE.n +
		' (worst ' + D_NEEDLE.worst.toFixed(2) + ', draining shoulder ' + D_NEEDLE.ghost + ')');
	if (D_NEEDLE.worstRow) {
		r = D_NEEDLE.worstRow;
		console.log('    worst frame ' + r.f + ' x ' + (r.x / 1e3).toFixed(1) + ' km peak ' + (r.peak / 1e3).toFixed(1) +
			' / shoulder ' + (r.shoulder / 1e3).toFixed(1) + ' (' + r.ratio.toFixed(2) + 'x; immediate ' +
			(r.immediate / 1e3).toFixed(1) + ' = ' + r.grew.toFixed(2) + 'x), slots ' + (r.hl / 1e3).toFixed(1) +
			' / ' + (r.hr / 1e3).toFixed(1) + ' km ghost ' + r.gl + '/' + r.gr + ', built ' + r.built);
		console.log('      profile (-2..+3) km: ' + r.prof.map(function (v) { return v.toFixed(1); }).join(' / '));
	}
	console.log('  R2 width    failures ' + D_WIDTH.n + ' (narrow belt ' + D_WIDTH.narrow + ', broken belt ' + D_WIDTH.hole +
		', with a draining cell inside the window ' + D_WIDTH.ghostWin + ')');
	keys = Object.keys(D_WIDTH_SITES).sort(function (a, b) { return D_WIDTH_SITES[b] - D_WIDTH_SITES[a]; });
	for (k = 0; k < keys.length && k < 10; k++) {
		r = D_WIDTH_FIRST[keys[k]];
		console.log('    site x ' + (r.x / 1e3).toFixed(1) + ' km frames ' + r.f + '..' + D_WIDTH_LAST[keys[k]] +
			' fail ' + D_WIDTH_SITES[keys[k]] + ' first run ' + r.run + ' cells ' + r.cnt + ' margin ' + (r.margin / 1e3).toFixed(1) +
			' km needle ' + r.needle.toFixed(2) + ' rel ' + (r.rel / 1e3).toFixed(1) + ' mm/yr');
		console.log('      profile (-2..+3) km: ' + r.prof.map(function (v) { return v.toFixed(1); }).join(' / '));
	}
	console.log('  R3 ceiling  breaching frames ' + D_BREACH.n + ' (allowance ' + (D_BREACH_ALLOW / 1e3).toFixed(1) + ' km); first ' + D_BREACH.frames + ' traced:');
	for (k = 0; k < D_BREACH.rows.length; k++) {
		r = D_BREACH.rows[k];
		console.log('    frame ' + r.f + ' x ' + (r.x / 1e3).toFixed(1) + ' km w ' + (r.w / P.w0).toFixed(2) + 'w0 ghost ' + r.ghost +
			' edge ' + r.edge + ' end hTot ' + (r.h / 1e3).toFixed(2) + ' km');
		console.log('      ' + D_STAGE.map(function (nm, q) { return nm + ' ' + (r.stages[q] / 1e3).toFixed(2); }).join(' -> ') +
			(r.pre ? '   pre-K4 ' + (r.pre.h / 1e3).toFixed(2) + ' km at ' + (r.pre.w / P.w0).toFixed(2) + 'w0' : ''));
	}
	console.log('  R5 repeats  ' + D_REPEATS.length + ':');
	for (k = 0; k < D_REPEATS.length; k++) {
		r = D_REPEATS[k];
		console.log('    ' + r.kind + ' frame ' + r.f + ', after ' + r.otherKind + ' frame ' + r.otherF + ': gap ' + r.gap +
			' frames (' + (r.gap * kyr / 1e3).toFixed(2) + ' Myr), closest pair of ' + r.events + ' event columns ' +
			(r.x / 1e3).toFixed(1) + ' km apart, site bucket ' + (2.5 * P.w0 / 1e3).toFixed(0) + ' km wide');
	}
	// 0.2.0 M5: the standing needles -- sites whose over-limit run passed the kernel's
	// event memory. Empty on a green leg; the single-frame transients above are the
	// belt's birth and are not listed here (they clear the gate's run test).
	console.log('  R2 standing needles  ' + D_STAND.length + ' (gate: none beyond ' + P.evAge + ' Myr):');
	for (k = 0; k < D_STAND.length; k++) {
		r = D_STAND[k];
		console.log('    site x ' + (r.x / 1e3).toFixed(1) + ' km, run reaches ' + r.run + ' frames at frame ' + r.f +
			', peak ' + (r.peak / 1e3).toFixed(1) + ' / shoulder ' + (r.shoulder / 1e3).toFixed(1) +
			' km (' + r.ratio.toFixed(2) + 'x)');
	}
}

// Is this world position within a column of a record that appeared or was retired this
// frame? An event frame is its own control: the same flow, the same erosion and the
// same orogeny run everywhere on it, so the move at the event site can be read against
// the move everywhere else on the same frame.
function atSite(x) {
	for (var t = 0; t < SITE_X.length; t++) if (inWindow(x, SITE_X[t])) return true;
	return false;
}

// Is x inside a site's own footprint? The event is the record, and the drawn surface is
// interpolated between records, so the footprint is the record's position +- 1.5 w0: its
// own half-column and the half-span to each neighbour's centre. The old reading took the
// 2.5 w0 bucket's left edge as the site, which puts an event that lands near the bucket's
// right edge up to 2.4 w0 outside its own window (measured: 5000/5/100 frame 2364, a
// conveyor retirement's own footprint 2.6 km past the window edge, read as "elsewhere").
function inWindow(x, site) {
	var d = x - site;
	if (d > P.wrap * 0.5) d -= P.wrap;
	else if (d < -P.wrap * 0.5) d += P.wrap;
	return d > -1.5 * P.w0 && d < 1.5 * P.w0;
}

// Which event class holds this position: a birth, a drained death, or an accretion. The
// three classes are collected separately so the worst site move can name its own kind.
function siteKind(x) {
	var t;
	for (t = 0; t < SITE_B.length; t++) if (inWindow(x, SITE_B[t])) return 'birth';
	for (t = 0; t < SITE_D.length; t++) if (inWindow(x, SITE_D[t])) return 'drained death';
	return 'accretion';
}

// Records that exist in only one of the two lists: a position in `nowX` with no record
// within half a column in `thenX` was born, and the same the other way round was a
// death. Both lists are sorted, so this is a merge walk. The site is a bucket two and a
// half columns wide -- a boundary is a stretch of ground, not a point, and one rift
// opening across its own width is one event -- so a boundary that keeps flipping in
// place shows up as a repeat.

// R2, at every collision and frame, uses the shared local-shape measure from lib.js:
// pair peak over the higher of its two immediate shoulders, plus the longest contiguous
// run in the six-cell window above outer flank + P.beltRise. The old outer-flank ratio and
// non-contiguous count are retained as legacy diagnostics, never substituted for the
// local needle and contiguous-width gates. The worst local needle profile is reported.
//
// A collision only has a belt to be once it has built one: a pair that is still thinner
// than the ground beside it (two continental margins meeting across a closing ocean)
// carries no root yet, and the width half of the test does not apply to it. A built
// collision stands P.beltRoot above the flanks and P.beltRise is what makes a column
// part of the belt, so the width half is measured where the orogenic flow and the
// collision balance. The report says how many collisions were measured and how many got
// that far, so a run that never did cannot pass as if it had.
function wm(k) { k %= S.nCol; return k < 0 ? k + S.nCol : k; }

function beltScan() {
	var n = S.nCol, i, j, h, flank, peak, count, contiguous, localFlank;
	for (i = 0; i < n; i++) {
		if (S.edge[i] !== P.EDGE.collide) continue;
		j = i + 1 < n ? i + 1 : 0;
		if (S.colGhost[i] || S.colGhost[j]) continue;
		L.check.r2ShapeAt(S, i, r2Scratch);
		flank = r2Scratch.flank; peak = r2Scratch.peak;
		if (!(flank > 0)) continue;
		count = r2Scratch.widthCount; contiguous = r2Scratch.widthRun;
		if (detail) detailSample(i, j, f);
		beltN++;
		if (r2Scratch.outerRatio > beltExcess) {
			beltExcess = r2Scratch.outerRatio; beltX = S.colX[i];
			beltPeakFrame = f; beltPeakI = i; beltPeakH = peak; beltPeakFlank = flank;
			beltPeakWindow = count;
			localFlank = 0.5 * (S.hTot[wm(i - 1)] + S.hTot[wm(j + 1)]);
			beltPeakLocal = localFlank;
			beltPeakLocalR = localFlank > 0 ? peak / localFlank : 0;
			for (h = -3; h <= 4; h++) beltPeakProfile[h + 3] = S.hTot[wm(i + h)];
		}
		if (r2Scratch.needleRatio > beltNeedleMax) {
			beltNeedleMax = r2Scratch.needleRatio; beltNeedleX = S.colX[i];
			beltNeedleFrame = f; beltNeedleI = i; beltNeedlePeak = peak;
			beltNeedleShoulder = r2Scratch.shoulder;
			for (h = -3; h <= 4; h++) beltNeedleProfile[h + 3] = S.hTot[wm(i + h)];
		}
		// 0.2.0 M5: track the run of consecutive frames this site spends above the
		// limit. Measured over sixteen seeds at both rates and both clock modes, every
		// over-limit sample is a 1-4 frame transient (<= 0.4 Myr) -- the belt's birth,
		// when a collision thickens its own pair before its shoulders (0.1.9-plan.md
		// §1.2: "the mechanism, not a defect"). Only a run longer than the kernel's
		// event memory counts as the standing needle the clause gates.
		if (r2Scratch.needleRatio > P.beltPeak) {
			var nb = Math.floor(S.colX[i] / (2.5 * P.w0));
			var nRun = standRun(needleSite, nb, f);
			if (nRun > needleRunMax) needleRunMax = nRun;
			if (nRun > evAgeFrames && !needleStood[nb]) {
				needleStood[nb] = 1; needleStand++;
				if (detail) D_STAND.push({ f: f, site: nb, x: S.colX[i], ratio: r2Scratch.needleRatio,
					run: nRun, peak: peak, shoulder: r2Scratch.shoulder });
			}
		}
		if (!r2Scratch.built) continue;
		beltBump++;
		if (count >= P.beltCols) beltWide++;
		if (contiguous >= P.beltCols) beltContigWide++;
		if (count < beltRunWorst) {
			beltRunWorst = count; beltRunX = S.colX[i]; beltRunFrame = f; beltRunI = i;
			beltRunPeak = peak; beltRunFlank = flank;
			for (h = -3; h <= 4; h++) beltRunProfile[h + 3] = S.hTot[wm(i + h)];
		}
		if (contiguous < beltContigWorst) {
			beltContigWorst = contiguous; beltContigFrame = f; beltContigI = i;
			for (h = -3; h <= 4; h++) beltContigProfile[h + 3] = S.hTot[wm(i + h)];
		}
	}
}

function fmtKm(v) { return (v / 1e3).toFixed(1) + ' km'; }
function fmtM(v) { return v.toFixed(0) + ' m'; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }
function per1000(v) { return (v / frames * 1000).toFixed(2); }

function gate() {
	L.check.section('contact contract (0.1.9-plan.md §2)');
	// R1's background is the section's own: the largest movement on a frame with no
	// event at all (0.1.5-plan.md §1 names it as R1's yardstick). The event-frame
	// background and the same-frame pairing are reported beside it -- the latter reads
	// 12-22x on every leg, because on most event frames the rest of the section is simply
	// not moving, so it is a diagnostic and not a gate (0.1.9-plan.md §2).
	L.check.ok('R1 an event stays inside the section\'s own background',
		siteDz <= P.evDzK * quietDz, 'the ' + siteDzKind + ' footprint ' + fmtM(siteDz) + ' at frame ' +
		siteDzFrame + ' x ' + fmtKm(siteDzX) + ' against the quiet-frame yardstick ' + fmtM(quietDz) +
		' (frame ' + quietFr + ' x ' + fmtKm(quietX) + '), ratio ' +
		(siteDz / Math.max(1, quietDz)).toFixed(2) + ' (max ' + P.evDzK + ')');
	L.check.info('event-frame background (report only)',
		fmtM(awayDz) + ' away from any event footprint, frame ' + awayDzFrame + ' x ' + fmtKm(awayDzX));
	L.check.info('same-frame pairing (report only)',
		'worst ' + frameRatio.toFixed(2) + ' at frame ' + frameRatioF + ' (' + fmtM(frameRatioSite) +
		' at the site against ' + fmtM(frameRatioAway) + ' elsewhere on that frame)');
	// 0.2.0 M5 settles the R2 side of the frame-versus-clock policy: the needle clause
	// gates a STANDING rise, not a single-frame draw. A collision thickens its own pair
	// before its shoulders -- 0.1.9-plan.md §1.2 calls that "the mechanism, not a
	// defect" -- so a young collision reads tall for a few frames while its belt builds;
	// measured over sixteen seeds at both rates and both clock modes, every sample
	// above P.beltPeak is a 1-4 frame transient (<= 0.4 Myr), and no site stands above
	// the limit anywhere in that population. A pair that has been rising for longer
	// than the kernel's own event memory (P.evAge, 2 Myr) is the standing needle the
	// clause exists for -- the 0.1.8 M3 case (seed 5/100, frame 3312, edgeAge 4.10 Myr)
	// is exactly that shape. The single-frame worst draw stays in the report, so the
	// gate reads the sustained shape and the report keeps the worst draw. Direction
	// check (0.1.9 §0's convention): the clause can only clear a failing site, never
	// create one. The width half is unchanged, and the static m2-check fixtures still
	// pin the measurement itself (a narrow pair on a plain reads 2.00x).
	L.check.ok('R2 the pair is not a local needle', needleStand === 0,
		beltN + ' collisions measured, worst pair / highest belt-neighbourhood shoulder ' +
		beltNeedleMax.toFixed(2) + ' at ' + fmtKm(beltNeedleX) + ' (single-frame limit ' + P.beltPeak +
		'), longest standing run ' + needleRunMax + ' frames (' + (needleRunMax * kyr / 1e3).toFixed(2) +
		' Myr, limit ' + P.evAge + ' Myr = ' + evAgeFrames.toFixed(0) + ' frames), ' + needleStand +
		' site' + (needleStand === 1 ? '' : 's') + ' stood above the limit beyond the event memory');
	L.check.ok('R2 built belts have a contiguous four-column run',
		beltBump === 0 || beltContigWide >= 0.9 * beltBump,
		beltContigWide + ' of ' + beltBump + ' built collision-frames have at least ' +
		P.beltCols + ' contiguous columns above outer flank + ' + fmtKm(P.beltRise) +
		' (90% required); narrowest run ' + beltContigWorst + ' at frame ' + beltContigFrame);
	L.check.info('legacy R2 outer-flank peak ratio',
		beltExcess.toFixed(2) + 'x at ' + fmtKm(beltX) + ' (historical limit ' + P.beltPeak + ')');
	L.check.info('legacy R2 non-contiguous four-of-six width',
		beltWide + ' of ' + beltBump + ' built samples passed; narrowest count ' +
		beltRunWorst + '/6 at ' + fmtKm(beltRunX));
	// The sink is rate limited, so its steady state sits a little over the ceiling it
	// holds: the excess is one frame of squeeze influx, measured (0.1.7) at up to
	// 35 km/Myr into a compressing column. The allowance is crustMax + influx x dt,
	// 1.8 km on 50 kyr frames and 3.5 km on 100 kyr, where a fixed 1% band failed.
	L.check.ok('R3 the crust has a ceiling', maxH <= P.crustMax + 35e3 * kyr / 1e3,
		fmtKm(maxH) + ' (ceiling ' + fmtKm(P.crustMax) + ' + ' +
		fmtKm(35e3 * kyr / 1e3) + ' of one-frame influx at ' + kyr + ' kyr/f)');
	// 0.2.0 M5 settles the frame-versus-clock policy the roadmap left open: the gate is
	// the kernel's own promise, P.evAge of simulated time, enforced at the classifier
	// (columns.js holds an edge's classification for P.evAge before it may change). The
	// old gate window was the fixed P.evGap frame count, which is not a kernel constant
	// (nothing in js/ reads it) and coincides with the promise only at the 50 kyr
	// reference rate (40 frames = 2 Myr); at 100 kyr/frame it is twice the promise, so it
	// gated geology -- a scar re-opening as a rift after its sliver was consumed, 2.2-3.9
	// Myr of simulated time after the death, every one outside P.evAge (0.1.8 §2). The
	// frame-window count stays reported, so the wider net is still on the record. No
	// constant moves: P.evGap and P.evAge keep their values and meanings.
	L.check.ok('no site changes its topology twice inside the event memory',
		flipRepeatAge === 0, flipRepeatAge + ' of ' + (births + deaths) + ' events (' +
		per1000(births + deaths) + ' per 1000 frames) came within ' + P.evAge +
		' Myr (' + evAgeFrames.toFixed(0) + ' frames at this rate) of an earlier one at the same site');
	L.check.info('R5 repeats inside the frame window (P.evGap ' + P.evGap + ' frames, report only)',
		flipRepeat + ' of ' + (births + deaths) + ' events');
	L.check.ok('R5 stacks stay in stratigraphic order', inversions === 0,
		inversions + ' inverted column-frames');
	L.check.ok('R5 no column runs out of beds', atCapStay <= P.capStay,
		atCap + ' column-frames touched layerCap, the longest stay ' + atCapStay +
		' frames (max ' + P.capStay + ')');
	L.check.ok('a draining record holds no ground', ghostShare <= P.sliverMax,
		pct(ghostShare) + ' of the crust in ' + ghostMax + ' draining records, widest run ' +
		(ghostWide / P.w0).toFixed(1) + ' columns (max ' + pct(P.sliverMax) + ')');
	L.check.ok('every buffer is finite', finite());
	L.check.done();
}

function finite() {
	var key, i;
	for (key in S) {
		var v = S[key];
		// every state buffer is a typed array; S also carries scalars, the recon object
		// and methods (S.massInto has arity 1, so a !v.length guard reads its [0] and
		// reports undefined — the same ArrayBuffer.isView guard ledger-check uses)
		if (!ArrayBuffer.isView(v)) continue;
		for (i = 0; i < v.length; i++) if (!isFinite(v[i])) return false;
	}
	return true;
}

// The window around the thickest column, as a PNG (the same body raster the page uses).
function writePng(out) {
	var fs = require('fs'), zlib = require('zlib'), c = 0, i, y, d;
	for (i = 0; i < S.nCol; i++) if (S.hTot[i] > S.hTot[c]) c = i;
	GEO.setPreset('cru');
	P.view.cx = S.colX[c];
	GEO.dirty = true;
	GEO.sync();
	GEO.buildColLUT(S);
	var w = P.cw, h = P.ch, px = new Uint32Array(w * h);
	R.body(px, w, h);
	var BAR = [0, 0xffb4b4b4, 0xff78eb6e, 0xff4b5fff, 0xff3cafff];
	for (i = 0; i < S.nCol; i++) {
		var e = S.edge[i];
		if (!e) continue;
		var sx = Math.floor(R.screenX(S.colX[(i + 1) % S.nCol]));
		if (sx < 1 || sx >= w - 1) continue;
		for (y = 0; y < 14; y++) for (d = -1; d <= 1; d++) px[y * w + sx + d] = BAR[e];
	}
	function crc32(buf) {
		var cc, crc = 0xffffffff, n, kk;
		for (n = 0; n < buf.length; n++) {
			cc = (crc ^ buf[n]) & 0xff;
			for (kk = 0; kk < 8; kk++) cc = cc & 1 ? 0xedb88320 ^ (crc >>> 1) : cc >>> 1;
			crc = (crc >>> 8) ^ cc;
		}
		return (crc ^ 0xffffffff) >>> 0;
	}
	function chunk(type, data) {
		var len = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	}
	var raw = Buffer.alloc((w * 4 + 1) * h), bytes = Buffer.from(px.buffer);
	for (y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		bytes.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
	}
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
	fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
	console.log('  wrote ' + out + ' (x10 window around column ' + c + ', ' + fmtKm(S.colX[c]) + ')');
}
