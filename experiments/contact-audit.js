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
//   belt    the run of thick columns around the thickest contact: a collision belt
//           should be a wide dome, not a needle under the boundary
//   events  column births and deaths, their rate, and how many repeat at the same
//           place (a boundary that flips state every few frames is the worst offender)
//   order   columns whose stack is inverted in stratigraphic rank (P.LITH_RANK, the
//           same table COL.insertVol orders by) — the signature of stacking two
//           stratigraphies instead of inserting each bed where it belongs. The stack
//           runs deepest bed first, so the rank rises with the index (sill, mafic,
//           felsic, volcanic, sediment) and an inversion is a bed whose rank falls
//           against the one below it.
//
// Run: node experiments/contact-audit.js [frames=3000] [seed=1] [kyrPerFrame=50] [png] [--strict]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom, SIM = L.mods.sim, COL = L.mods.columns;
var R = L.mods.render;

var arg = process.argv.slice(2), flags = [], pos = [];
for (var a = 0; a < arg.length; a++) (arg[a].charAt(0) === '-' ? flags : pos).push(arg[a]);
var frames = +(pos[0] || 3000), seed = +(pos[1] || 1);
var kyr = +(pos[2] || 50), png = pos[3] && pos[3].charAt(0) !== '-' ? pos[3] : null;
var strict = flags.indexOf('--strict') >= 0;
var NS = 2048, step = P.wrap / NS;

L.check.section('contact-audit site bookkeeping');
var siteProbe = siteValues(new Set([4, 9])), seenProbe = { 4: 10 };
L.check.ok('event buckets are concrete Set values', siteProbe.length === 2 && siteProbe[0] === 4 && siteProbe[1] === 9);
L.check.ok('repeat spacing uses the current event frame',
	seen(seenProbe, 4, 10 + P.evGap - 1) === 1 && seen(seenProbe, 4, 10 + P.evGap) === 0);

L.check.planet(seed, 'def');
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
COL.k4 = function (st, dt, t, Tm) {
	var n = st.nCol, i, j, c;
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
		if (this.intent[i] === 4 && (c === i || c === j) && this.accreteLock[c] &&
			this.dead[c] === 1 && this.map[c] < 0) accSiteX[nAccSite++] = accPreX[i];
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
var siteDz = 0, awayDz = 0, f, i, k, j, m, d;
var beltN = 0, beltBump = 0, beltWide = 0, beltExcess = 0, beltRunWorst = 99, beltX = 0, beltRunX = 0;
var SITE_X = [], bSites = new Set(), dSites = new Set(), halfW = 0.4 * P.w0, unmatched = 0, rematched = 0, consumed = [];

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
	match(preX, preG, preNew, preW, preN);
	SITE_X.length = 0;
	bSites.clear();
	dSites.clear();
	for (k = 0; k < consumed.length; k++) {
		if (!preG[consumed[k]]) dSites.add(Math.floor(preX[consumed[k]] / (2.5 * P.w0)));
	}
	// A conveyor retirement has no ghost successor, so merge-walking cannot infer it
	// from the final topology. COL.k4's instrumentation captures its pre-removal site.
	for (k = 0; k < nAccSite; k++) dSites.add(Math.floor(accSiteX[k] / (2.5 * P.w0)));
	for (i = 0; i < S.nCol; i++) {
		if (S.colGhost[i]) continue;
		if (S.colW[i] < halfW) continue;              // a sliver, not a record
		if (COL.isNew[i] && (MATCH[i] < 0 || !preNew[MATCH[i]])) bSites.add(Math.floor(S.colX[i] / (2.5 * P.w0)));
	}
	var bSiteList = siteValues(bSites), dSiteList = siteValues(dSites);
	for (k = 0; k < dSiteList.length; k++) SITE_X.push(dSiteList[k] * 2.5 * P.w0);
	for (k = 0; k < bSiteList.length; k++) SITE_X.push(bSiteList[k] * 2.5 * P.w0);
	births += bSiteList.length;
	deaths += dSiteList.length;
	for (k = 0; k < bSiteList.length; k++) {
		var bs = bSiteList[k];
		flipRepeat += seen(SITE.d, bs, f);
		if (seen(SITE.b, bs, f)) birthRepeat++;
		SITE.b[bs] = f;
	}
	for (k = 0; k < dSiteList.length; k++) {
		var ds = dSiteList[k];
		flipRepeat += seen(SITE.b, ds, f);
		if (seen(SITE.d, ds, f)) deathRepeat++;
		SITE.d[ds] = f;
	}
	var event = bSites.size + dSites.size > 0;
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
				if (atSite(m * step)) { if (d > siteDz) siteDz = d; }
				else if (d > awayDz) awayDz = d;
			} else if (d > quietDz) quietDz = d;
		}
		prevZ[m] = sample[m];
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
	var nGhost = 0, gOldest = 0;
	for (i = 0; i < S.nCol; i++) {
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
	beltScan(false);
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
	'   collisions ' + beltN + ' seen, sharpest peak ' + beltExcess.toFixed(2) +
	'x flanks, ' + (beltBump ? pct(beltWide / beltBump) : '-') + ' of the ' + beltBump +
	' with a root widen to a belt' +
	'   draining records ' + ghostMax + ' live holding ' + pct(ghostShare) +
	' of the crust, widest run ' + (ghostWide / P.w0).toFixed(1) + ' columns (oldest ' +
	ghostAge.toFixed(1) + ' Myr)');
console.log('  max column     frame ' + maxHFrame + ', record ' + maxHCol + ', x ' + fmtKm(maxHX) +
	'   fel ' + fmtKm(maxHFel) + ', maf ' + fmtKm(maxHMaf) + ', sed ' + fmtKm(maxHSed) +
	', on a C-C retirement frame: ' + maxHAccrete);
console.log('  surface        worst single-frame move ' + fmtM(maxDz) + ' at frame ' + maxDzFrame +
	' x ' + fmtKm(maxDzX) + '   mean ' + (dzSum / Math.max(1, dzN)).toFixed(1) + ' m, ' +
	over100 + ' raster samples above 100 m');
console.log('  event site     ' + fmtM(siteDz) + ' at a birth/death site, ' + fmtM(awayDz) +
	' elsewhere on the same frame, quiet-frame worst ' + fmtM(quietDz) +
	'   (quiet-frame drawn thickness ' + fmtKm(quietDh) + ' and width ' + pct(quietDw) +
	', ' + unmatched + ' quiet records with no counterpart, ' + rematched + ' re-partitioned)');
console.log('  columns        worst single-frame drawn-thickness change ' + fmtKm(maxDh) + ' at frame ' +
	maxDhFrame + ' x ' + fmtKm(maxDhX) + '   worst width change ' + pct(maxDw) + ' at frame ' +
	maxDwFrame + '   worst local slope ' + (maxSlope * 100).toFixed(1) + '%');
console.log('  topology       ' + births + ' births / ' + deaths + ' deaths (' + per1000(births + deaths) +
	' per 1000 frames, incl. ' + accretions + ' C-C retirements) at ' + birthRepeat + ' repeated birth and ' + deathRepeat + ' repeated death ' +
	'sites (' + S.nCol + ' columns, ' + S.nPl + ' plates)');
console.log('  stacks         ' + inversions + ' column-frames with an inverted bed, ' +
	atCap + ' column-frames at layerCap');
beltScan(true);
if (png) writePng(png);
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

// Is this world position within a column of a record that appeared or was retired this
// frame? An event frame is its own control: the same flow, the same erosion and the
// same orogeny run everywhere on it, so the move at the event site can be read against
// the move everywhere else on the same frame.
function atSite(x) {
	for (var t = 0; t < SITE_X.length; t++) {
		var d = x - SITE_X[t];
		if (d > P.wrap * 0.5) d -= P.wrap;
		else if (d < -P.wrap * 0.5) d += P.wrap;
		if (d > -1.5 * P.w0 && d < 1.5 * P.w0) return true;
	}
	return false;
}

// Records that exist in only one of the two lists: a position in `nowX` with no record
// within half a column in `thenX` was born, and the same the other way round was a
// death. Both lists are sorted, so this is a merge walk. The site is a bucket two and a
// half columns wide -- a boundary is a stretch of ground, not a point, and one rift
// opening across its own width is one event -- so a boundary that keeps flipping in
// place shows up as a repeat.

// R2, at every continental collision, on every frame of the run: does the boundary build
// a belt or a needle? The pair of records at a collision is compared with the ground on
// either side of it, two columns out, and the belt is the run of columns inside that
// window raised a tenth above the flanks. Both numbers are ratios, so the test is about
// shape and not about how thick this planet's crust happens to be: a needle is one
// column far above its neighbours, a belt is several. The run's *worst* collision is
// reported, because the most needle-like boundary is the one that matters and the last
// frame's is not necessarily it.
//
// A collision only has a belt to be once it has built one: a pair that is still thinner
// than the ground beside it (two continental margins meeting across a closing ocean)
// carries no root yet, and the width half of the test does not apply to it. A built
// collision stands P.beltRoot above the flanks and P.beltRise is what makes a column
// part of the belt, so the width half is measured where the orogenic flow and the
// collision balance. The report says how many collisions were measured and how many got
// that far, so a run that never did cannot pass as if it had.
function wm(k) { k %= S.nCol; return k < 0 ? k + S.nCol : k; }

function beltScan(final) {
	var n = S.nCol, i, j, c, h, flank, peak, run, bump;
	for (i = 0; i < n; i++) {
		if (S.edge[i] !== P.EDGE.collide) continue;
		j = i + 1 < n ? i + 1 : 0;
		if (S.colGhost[i] || S.colGhost[j]) continue;      // mid-consumption: not a section
		// the flanks are the ground *outside* the belt, three and four columns out, so
		// the belt's own columns cannot raise the bar they are measured against. This is
		// COL.beltAt's flank, written out so the gate keeps its own copy of the
		// arithmetic; the wrapped index matters (the hand-rolled `i > 3 ? i - 3 : n - 3`
		// sent column 1's flank to n - 3, half a planet away).
		flank = 0.25 * (S.hTot[wm(i - P.beltFeed - 1)] + S.hTot[wm(i - P.beltFeed - 2)] +
			S.hTot[wm(j + P.beltFeed + 1)] + S.hTot[wm(j + P.beltFeed + 2)]);
		peak = Math.max(S.hTot[i], S.hTot[j]);
		if (!(flank > 0)) continue;
		run = 0;
		for (h = -2; h <= 3; h++) {
			if (S.hTot[wm(i + h)] >= flank + P.beltRise) run++;
		}
		beltN++;
		if (peak / flank > beltExcess) { beltExcess = peak / flank; beltX = S.colX[i]; }
		if (peak >= flank + P.beltRoot) {
			beltBump++;
			if (run >= P.beltCols) beltWide++;
			if (run < beltRunWorst) { beltRunWorst = run; beltRunX = S.colX[i]; }
		}
	}
}

function fmtKm(v) { return (v / 1e3).toFixed(1) + ' km'; }
function fmtM(v) { return v.toFixed(0) + ' m'; }
function pct(v) { return (v * 100).toFixed(1) + '%'; }
function per1000(v) { return (v / frames * 1000).toFixed(2); }

function gate() {
	L.check.section('contact contract (0.1.5-plan.md §1)');
	L.check.ok('R1 an event moves the surface no more than the rest of its own frame',
		siteDz <= P.evDzK * awayDz, 'at the site ' + fmtM(siteDz) + ', elsewhere on that frame ' +
		fmtM(awayDz) + ', ratio ' + (siteDz / Math.max(1, awayDz)).toFixed(2) +
		' (max ' + P.evDzK + ')');
	L.check.ok('R2 no collision is a needle', beltExcess <= P.beltPeak,
		beltN + ' collisions measured, the sharpest peak ' + beltExcess.toFixed(2) +
		'x its flanks at ' + fmtKm(beltX) + ' (max ' + P.beltPeak + ')');
	// A belt is not a single frame's measurement: a collision is measured on every frame
	// it exists, and the test is that all but a tenth of those measurements find a belt
	// at least P.beltCols wide. The one-in-ten is the frame that catches a collision
	// between a new root and the flow that widens it.
	L.check.ok('R2 a collision that builds a belt thickens a run of columns',
		beltBump === 0 || beltWide >= 0.9 * beltBump,
		beltWide + ' of ' + beltBump + ' collision-frames with a ' + fmtKm(P.beltRoot) +
		' root thicken ' + P.beltCols + ' or more of the 6 columns around the pair; ' +
		'narrowest seen ' + beltRunWorst + ' at ' + fmtKm(beltRunX));
	// The sink is rate limited, so its steady state sits a little over the ceiling it
	// holds: the excess is one frame of squeeze influx, measured (0.1.7) at up to
	// 35 km/Myr into a compressing column. The allowance is crustMax + influx x dt,
	// 1.8 km on 50 kyr frames and 3.5 km on 100 kyr, where a fixed 1% band failed.
	L.check.ok('R3 the crust has a ceiling', maxH <= P.crustMax + 35e3 * kyr / 1e3,
		fmtKm(maxH) + ' (ceiling ' + fmtKm(P.crustMax) + ' + ' +
		fmtKm(35e3 * kyr / 1e3) + ' of one-frame influx at ' + kyr + ' kyr/f)');
	L.check.ok('no site changes its topology twice inside the event memory',
		flipRepeat === 0, flipRepeat + ' of ' + (births + deaths) + ' events (' +
		per1000(births + deaths) + ' per 1000 frames) came within ' + P.evGap +
		' frames of an earlier one at the same site');
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
		if (!v || !v.length) continue;
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
