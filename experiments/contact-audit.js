// contact-audit.js — what a contact event does to the drawn section.
// Not a pass/fail gate: a measurement report. m2-check asserts *state* invariants
// (sorted, balanced, finite); nothing in the suite yet asserts that the section is
// still *smooth* after a plate boundary does something. This script measures exactly
// that, so a change to the contact kernels can be judged on numbers:
//
//   tmax    the heaviest crust anywhere (the design expects a plateau near 70 km,
//           not a 140 km needle)
//   dz      the largest single-frame move of the drawn surface, sampled on a
//           2048-point world raster at every frame; a visible pop is anything above
//           ~1 px, i.e. ~600 m at the default window and ~60 m at the x10 preset
//   dh      the largest single-frame change of one column's crust thickness, matched
//           across frames by position
//   belt    the run of thick columns around the thickest contact: a collision belt
//           should be a wide dome, not a needle under the boundary
//   events  column births and deaths, and how many of them repeat at the same place
//           (a boundary that flips state every few frames is the worst offender)
//   order   columns whose stack has a denser lithology above a lighter one
//           (mafic above felsic/sediment) — the signature of stacking two
//           stratigraphies instead of merging them by lithology
//
// Run: node experiments/contact-audit.js [frames=3000] [seed=1] [kyrPerFrame=50] [png]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom, SIM = L.mods.sim;
var R = L.mods.render;

var frames = +(process.argv[2] || 3000), seed = +(process.argv[3] || 1);
var kyr = +(process.argv[4] || 50), png = process.argv[5] || null;
var NS = 2048, step = P.wrap / NS;

L.check.planet(seed, 'def');
SIM.setGeo(kyr * 1e3);

// density order of the lithologies, densest first: a stack is ordered when this rank
// never decreases from the bottom bed upwards (within a class any order is fine)
var RANK = [2, 1, 0, 2, 2, 2];

// the drawn surface at a world x, linearly interpolated between column centres
var sample = new Float64Array(NS), prevZ = new Float64Array(NS);

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

var maxH = 0, maxDz = 0, maxDzFrame = -1, maxDzX = 0, dzSum = 0, dzN = 0, over100 = 0;
var maxDh = 0, maxDhFrame = -1, maxDhX = 0, events = 0, repeats = 0, eventSite = {};
var inversions = 0, atCap = 0, maxSlope = 0, t0 = Date.now();
var contactMax = 0, contactCol = -1, evDz = 0, evDh = 0, quietDz = 0, quietDh = 0;
var f, i, k, j, m, d;

sampleField(S.z, prevZ);

for (f = 0; f < frames; f++) {
	var preN = S.nCol;
	var preX = new Float64Array(preN), preTh = new Float64Array(preN);
	for (i = 0; i < preN; i++) { preX[i] = S.colX[i]; preTh[i] = S.hTot[i]; }
	SIM.step();
	var event = S.nCol !== preN;
	if (event) {
		events++;
		// the site, rounded to 100 km, counts repeated birth/death cycles
		var site = Math.round(S.colX[Math.min(S.nCol, preN) - 1] / 1e5);
		eventSite[site] = (eventSite[site] || 0) + 1;
		if (eventSite[site] > 1) repeats++;
	}
	sampleField(S.z, sample);
	for (m = 0; m < NS; m++) {
		d = sample[m] - prevZ[m];
		if (d < 0) d = -d;
		dzSum += d; dzN++;
		if (d > 100) over100++;
		if (d > maxDz) { maxDz = d; maxDzFrame = f; maxDzX = m * step; }
		if (d > 0) { if (event) { if (d > evDz) evDz = d; } else if (d > quietDz) quietDz = d; }
		prevZ[m] = sample[m];
	}
	// per-column jump, matched to the pre-frame record with the nearest position
	for (i = 0; i < S.nCol; i++) {
		var best = -1, bd = 8e3;
		for (j = Math.max(0, i - 4); j < Math.min(preN, i + 5); j++) {
			d = preX[j] - S.colX[i];
			if (d < 0) d = -d;
			if (d > P.wrap * 0.5) d = P.wrap - d;
			if (d < bd) { bd = d; best = j; }
		}
		if (best < 0) continue;
		d = S.hTot[i] - preTh[best];
		if (d < 0) d = -d;
		if (d > maxDh) { maxDh = d; maxDhFrame = f; maxDhX = S.colX[i]; }
		if (event) { if (d > evDh) evDh = d; } else if (d > quietDh) quietDh = d;
	}
	for (i = 0; i < S.nCol; i++) {
		if (S.hTot[i] > maxH) maxH = S.hTot[i];
		var b = i * P.layerCap;
		for (k = 0; k + 1 < S.colNL[i]; k++) {
			if (RANK[S.layLi[b + k]] > RANK[S.layLi[b + k + 1]]) { inversions++; break; }
		}
		if (S.colNL[i] >= P.layerCap) atCap++;
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
}
var ms = (Date.now() - t0) / frames;

console.log('contact audit — seed ' + seed + ', ' + fmtKyr(kyr) + '/frame, ' + frames + ' frames (' +
	SIM.t.toFixed(0) + ' Myr), ' + ms.toFixed(2) + ' ms/frame');
console.log('  crust          max ' + fmtKm(maxH) + '   thickest column at a contact ' + fmtKm(contactMax) +
	'   belt run around it ' + beltRun() + ' columns above 55 km');
console.log('  surface        worst single-frame move ' + fmtM(maxDz) + ' at frame ' + maxDzFrame +
	' x ' + fmtKm(maxDzX) + '   mean ' + (dzSum / Math.max(1, dzN)).toFixed(1) + ' m, ' +
	over100 + ' raster samples above 100 m');
console.log('  frames         on a birth/death frame ' + fmtM(evDz) + '   on a quiet frame ' + fmtM(quietDz) +
	'   (thickness change ' + fmtKm(evDh) + ' vs ' + fmtKm(quietDh) + ')');
console.log('  columns        worst single-frame thickness change ' + fmtKm(maxDh) + ' at frame ' +
	maxDhFrame + ' x ' + fmtKm(maxDhX) + '   worst local slope ' + (maxSlope * 100).toFixed(1) + '%');
console.log('  topology       ' + events + ' births/deaths, ' + repeats + ' of them at a site that ' +
	'had already flipped (' + S.nCol + ' columns, ' + S.nPl + ' plates)');
console.log('  stacks         ' + inversions + ' column-frames with an inverted bed, ' +
	atCap + ' column-frames at layerCap');
if (png) writePng(png);
console.log('targets for 0.1.5 (see 0.1.5-plan.md): a birth/death frame no worse than a quiet ' +
	'one, worst move <= 300 m at 50 kyr/frame, max crust <= 80 km, belt >= 4 columns wide');

function fmtKyr(v) { return v + ' kyr'; }
function fmtKm(v) { return (v / 1e3).toFixed(1) + ' km'; }
function fmtM(v) { return v.toFixed(0) + ' m'; }

// A collision belt is a run of columns above 55 km, not a needle: report the longest run.
function beltRun() {
	if (contactCol < 0) return 0;
	var run = 1, i = contactCol, j;
	while (run < S.nCol) {
		j = i > 0 ? i - 1 : S.nCol - 1;
		if (S.hTot[j] <= 55e3) break;
		i = j; run++;
	}
	i = contactCol;
	while (run < S.nCol) {
		j = i + 1 < S.nCol ? i + 1 : 0;
		if (S.hTot[j] <= 55e3) break;
		i = j; run++;
	}
	return run;
}

// The window around the thickest column, as a PNG (the same body raster the page uses).
function writePng(out) {
	var fs = require('fs'), zlib = require('zlib'), c = 0, i, x, y, d;
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
			for (kk = 0; kk < 8; kk++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
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
