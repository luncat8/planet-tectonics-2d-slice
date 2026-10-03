// slice-cut.js — 0.4.1: is a line drawn on the globe's map a cross-section this project can
// load? Everything the plan (0.4.1-plan.md §3, §4, §5) promises about the cut is measured here:
// the cell walk along the drawn path, the pack it produces, the pack's size, the decoder's
// refusals, and the resample that lays the pack onto the section's own columns.
//
//   1. a stand-in cell set: the sampler only needs sphere points and their neighbours, so the
//      fixture is a Fibonacci set at the counterpart's cell density (L4/L5/L6), not a copy of
//      its grid. The counts it produces are checked against the real grid's, measured once at
//      planet-geotectonics @ d909476 with its own geodesics.js (the numbers in REAL_CELLS).
//   2. walk a great circle at a third of a cell spacing and record every cell it crosses,
//      with the arc length the path spends in each: that list *is* the cut. No interpolation
//      between cells and no resampling on the globe side - the section's resolution is the
//      globe's, which is the whole point of cutting instead of guessing.
//   3. build a pack from the walk and measure: size per level, checksum stability across a
//      JSON round trip, and every refusal the decoder must make.
//   4. lay the pack on the section's 512 columns with an arc-length box filter and check the
//      one property that makes the transfer honest: the thickness integral is the same before
//      and after, upsampling or downsampling.
//
// Run: node experiments/slice-cut.js
'use strict';

var L = require('./lib.js'), check = L.check;
var P = L.mods.params;                                    // the section's caps, not guessed
var SP = require('../port/slice-format.js');

var R = SP.R_KM, DEG = 180 / Math.PI;
// Cells a full great circle crosses, measured on the counterpart's own grid at d909476 with
// its geodesics.js (three circles per level: 99/108/96, 195/200/200, 389/404/406, 777/821/836).
// Note that this is NOT circumference / mean neighbour distance (83/166/333/665): a line
// crossing a lattice meets a new cell every ~0.8 of a cell spacing, not every full one, so
// the honest count is ~1.2 x that quotient. The difference is what puts L7 (811) over the
// section's column cap and L6 (400) comfortably under it.
var REAL_CELLS = { 2562: 101, 10242: 198, 40962: 400 };
var REAL_L7 = 811;

// ------------------------------------------------------------------ a stand-in cell set
// Fibonacci points: near-uniform, deterministic, no mesh code. Neighbours are the points
// within RADIUS x the nominal spacing, found through a spatial hash on the unit cube - a
// lat/lon bucket grid misses neighbours near the poles, where points distant in longitude
// are a few hundred metres of latitude apart on the sphere.
var RADIUS = 1.8;                                         // first ring plus a margin: a
function cellSet(n) {
	var pos = new Float64Array(n * 3), i;
	var golden = Math.PI * (3 - Math.sqrt(5));
	for (i = 0; i < n; i++) {
		var y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), th = golden * i;
		pos[i * 3] = Math.cos(th) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(th) * r;
	}
	var spacing = Math.sqrt(4 * Math.PI / n);              // radians, nominal
	var h = RADIUS * spacing, inv = 1 / h, r2 = (2 * Math.sin(h / 2)) * (2 * Math.sin(h / 2));
	var size = 1 << 16, mask = size - 1;
	var head = new Int32Array(size).fill(-1), next = new Int32Array(n);
	for (i = 0; i < n; i++) {
		var key = (Math.imul(Math.floor(pos[i * 3] * inv), 73856093)
			^ Math.imul(Math.floor(pos[i * 3 + 1] * inv), 19349663)
			^ Math.imul(Math.floor(pos[i * 3 + 2] * inv), 83492791)) & mask;
		next[i] = head[key]; head[key] = i;
	}
	var ring = [], ringN = new Int32Array(n), flat = [];
	var cx = new Int32Array(27), cy = new Int32Array(27), cz = new Int32Array(27);
	for (i = 0; i < n; i++) {
		var bx = Math.floor(pos[i * 3] * inv), by = Math.floor(pos[i * 3 + 1] * inv), bz = Math.floor(pos[i * 3 + 2] * inv);
		var m = 0;
		for (var a = -1; a <= 1; a++) for (var b2 = -1; b2 <= 1; b2++) for (var c = -1; c <= 1; c++) {
			cx[m] = bx + a; cy[m] = by + b2; cz[m] = bz + c; m++;
		}
		ring.length = 0;
		for (var q = 0; q < m; q++) {
			var key2 = (Math.imul(cx[q], 73856093) ^ Math.imul(cy[q], 19349663) ^ Math.imul(cz[q], 83492791)) & mask;
			for (var j = head[key2]; j >= 0; j = next[j]) {
				if (j === i) continue;
				var dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
				if (dx * dx + dy * dy + dz * dz <= r2) ring.push(j);
			}
		}
		ring.sort(function (u, v) { return u - v; });
		flat.push(ring.slice());
		ringN[i] = ring.length;
	}
	return { n: n, pos: pos, ring: flat, ringN: ringN, spacingKm: spacing * R };
}

// nearest cell to a unit direction: hill climb from a guess, strict improvement only, ties to
// the lower index. Deterministic and terminating: every step raises the dot product.
function dot3(pos, i, dir) { return pos[i * 3] * dir[0] + pos[i * 3 + 1] * dir[1] + pos[i * 3 + 2] * dir[2]; }
function nearest(set, dir, guess) {
	var pos = set.pos, best = guess, bestDot = dot3(pos, guess, dir), moved = true;
	while (moved) {
		moved = false;
		var ring = set.ring[best];
		for (var k = 0; k < ring.length; k++) {
			var j = ring[k], d = dot3(pos, j, dir);
			if (d > bestDot || (d === bestDot && j < best)) { best = j; bestDot = d; moved = true; }
		}
	}
	return best;
}

// ------------------------------------------------------------------ the walk
// The unit direction at arc distance sKm along the great circle leaving (lat0, lon0) on az0.
function circleDir(lat0, lon0, az0, sKm, out) {
	var lat = lat0 / DEG, lon = lon0 / DEG, az = az0 / DEG;
	var cl = Math.cos(lat), sl = Math.sin(lat), clon = Math.cos(lon), slon = Math.sin(lon);
	var ca = Math.cos(az), sa = Math.sin(az);
	var th = sKm / R, c = Math.cos(th), sn = Math.sin(th);
	out[0] = cl * clon * c + (-sl * clon * ca - slon * sa) * sn;
	out[1] = sl * c + cl * ca * sn;
	out[2] = cl * slon * c + (-sl * slon * ca + clon * sa) * sn;
	return out;
}

// Every cell the path crosses, in order, with the arc length spent in each. Samples at `ds`
// (a third of a cell, so a cell cannot be jumped over) and closes each run when the next
// cell is entered. A closed circle ends on the cell it started from: that last run is the
// first one's, so the two are merged instead of listing the start twice.
function points(set, lat0, lon0, az0, arcKm, dsKm) {
	var list = [], dir = [0, 0, 0];
	var count = Math.max(2, Math.ceil(arcKm / dsKm) + 1);
	for (var i = 0; i < count; i++) {
		var s = Math.min(arcKm, i * dsKm);
		circleDir(lat0, lon0, az0, s, dir);
		list.push({ s: s, d: [dir[0], dir[1], dir[2]] });
	}
	return list;
}
// Every cell a sample list crosses, in order, with the arc length spent in each. A closed
// circle ends on the cell it started from: that last run belongs to the first one, so the two
// are merged instead of listing the start twice.
function walkPoints(set, list, closes) {
	var cells = [], arc = [], prev = -1, enter = 0, i, cell;
	for (i = 0; i < list.length; i++) {
		cell = nearest(set, list[i].d, prev < 0 ? 0 : prev);
		if (cell !== prev) {
			if (prev >= 0) { cells.push(prev); arc.push(list[i].s - enter); }
			prev = cell; enter = list[i].s;
		}
	}
	cells.push(prev); arc.push(list[list.length - 1].s - enter);
	if (closes && cells.length > 1 && cells[cells.length - 1] === cells[0]) {
		arc[0] += arc[arc.length - 1];
		cells.pop(); arc.pop();
	}
	return { cells: cells, arc: arc };
}
function walk(set, lat0, lon0, az0, arcKm, dsKm, closes) {
	return walkPoints(set, points(set, lat0, lon0, az0, arcKm, dsKm), closes);
}

// ------------------------------------------------------------------ the checks
console.log('  slice cut: a line on the globe\'s map -> a section this project can load');
console.log('  (stand-in cell set; the real grid\'s counts are from planet-geotectonics @ d909476)\n');

var t0 = Date.now();
var sets = {}, walks = {};

check.section('A. the stand-in cell set (the counterpart\'s L4/L5/L6 density)');
[2562, 10242, 40962].forEach(function (n) {
	var set = sets[n] = cellSet(n);
	var min = Infinity, max = 0, sum = 0;
	for (var i = 0; i < n; i++) { var k = set.ringN[i]; min = Math.min(min, k); max = Math.max(max, k); sum += k; }
	check.ok('L' + Math.round(Math.log((n - 2) / 10) / Math.log(4)) + ': every cell has 6-14 neighbours',
		min >= 6 && max <= 14, 'min ' + min + ' max ' + max + ' mean ' + (sum / n).toFixed(2) +
		', spacing ' + set.spacingKm.toFixed(0) + ' km');
});

check.section('B. the cell walk along a drawn great circle');
[2562, 10242, 40962].forEach(function (n) {
	var set = sets[n], ds = set.spacingKm / 3;
	var w = walks[n] = walk(set, 12, -40, 35, 2 * Math.PI * R, ds, true);
	var label = 'n=' + n + ' (' + w.cells.length + ' cells)';
	check.ok(label + ': one sample per cell crossed, no cell twice in a row',
		w.cells.length > 1 && w.cells.every(function (c, i) { return c !== w.cells[(i + 1) % w.cells.length]; }));
	var real = REAL_CELLS[n];
	check.ok(label + ': cells crossed within 10 % of the real grid\'s ' + real,
		Math.abs(w.cells.length - real) <= 0.1 * real, (100 * (w.cells.length / real - 1)).toFixed(1) + ' %');
	var mean = 2 * Math.PI * R / w.cells.length, lo = Infinity, hi = 0, total = 0, i;
	for (i = 0; i < w.cells.length; i++) { lo = Math.min(lo, w.arc[i]); hi = Math.max(hi, w.arc[i]); total += w.arc[i]; }
	check.ok(label + ': the arc spent per cell stays in [0.3, 1.8] x mean',
		lo > 0.3 * mean && hi < 1.8 * mean, (lo / mean).toFixed(2) + '..' + (hi / mean).toFixed(2) + ' mean ' + mean.toFixed(0) + ' km');
	check.near(label + ': the per-cell arcs sum to the circumference', total, 2 * Math.PI * R, 1e-12, 'km');
	var skipped = 0;
	for (i = 1; i < w.cells.length; i++) if (set.ring[w.cells[i - 1]].indexOf(w.cells[i]) < 0) skipped++;
	if (set.ring[w.cells[w.cells.length - 1]].indexOf(w.cells[0]) < 0) skipped++;
	check.ok(label + ': consecutive cells are neighbours all the way round (no cell jumped)', skipped === 0, skipped + ' gaps');
	// The same sample points visited from the other end: the cell of a point must not depend
	// on which side the walk approached it from (the hill climb starts from the previous cell,
	// so this is a real property, not a tautology). The cut is cyclic - the run holding s = 0
	// is folded into a different neighbour - so the lists may differ by a rotation.
	var back = walkPoints(set, points(set, 12, -40, 35, 2 * Math.PI * R, ds).reverse(), true);
	var rev = back.cells.slice().reverse();
	var shift = -1;
	for (var r = 0; r < rev.length && shift < 0; r++) {
		var ok = rev.length === w.cells.length;
		for (i = 0; ok && i < rev.length; i++) if (rev[(i + r) % rev.length] !== w.cells[i]) ok = false;
		if (ok) shift = r;
	}
	check.ok(label + ': the cut reads the same from either end (up to where it is cut)',
		shift >= 0, 'rotation ' + Math.min(shift, rev.length - shift) + ', ' + rev.length + ' vs ' + w.cells.length);
	var again = walk(set, 12, -40, 35, 2 * Math.PI * R, ds, true);
	check.ok(label + ': the same cut yields the same cells twice',
		again.cells.length === w.cells.length && again.cells.every(function (c, i) { return c === w.cells[i]; }));
});

// ------------------------------------------------------------------ a synthetic pack
// A stand-in for the globe's state: deterministic, in range, with more plate runs than the
// section has plates, so the merge rule the plan specifies is exercised rather than assumed.
function lcg(seed) {
	var s = seed >>> 0;
	return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function syntheticPack(n, runs) {
	var rnd = lcg(20261003), i, k;
	var pack = SP.make(n, { kind: 'circle', lat0: 12, lon0: -40, az0: 35, closes: true,
		arcKm: 2 * Math.PI * R, cellKm: 2 * Math.PI * R / n });
	pack.source = { repo: 'planet-geotectonics', commit: 'd909476', pack: '', epochMa: 0, rotModel: '',
		built: '2026-10-03T00:00:00Z', tMyr: 120.5, level: 5, gridSeed: 12345, simSeed: 7 };
	pack.license = 'synthetic fixture, no data license';
	var s = 0, run = 0, runLen = Math.ceil(n / runs), step = pack.path.arcKm / n;
	for (i = 0; i < n; i++) {
		pack.sKm[i] = s; s += step;
		var z = -5500 + 9500 * rnd();
		pack.zM[i] = Math.round(z);
		var oceanic = rnd() < 0.6;
		pack.hFelM[i] = Math.round(oceanic ? 0 : 28000 + 17000 * rnd());
		pack.hMafM[i] = Math.round(oceanic ? 6000 + 1500 * rnd() : 12000 + 6000 * rnd());
		pack.hSedM[i] = Math.round(rnd() < 0.4 ? 4000 * rnd() : 0);
		pack.ageMyr[i] = 200 * rnd();
		pack.fert[i] = 0.5 + 1.5 * rnd();
		pack.damage[i] = rnd();
		pack.host[i] = oceanic ? 1 : (pack.hSedM[i] > 2000 ? 4 : 2);
		pack.plate[i] = run;
		pack.alive[i] = rnd() < 0.02 ? 0 : 1;
		pack.wet[i] = z < 0 ? 1 : 0;
		pack.vt[i] = (rnd() - 0.5) * 2e5;
		pack.vp[i] = rnd() * 1e5;
		for (k = 0; k < 6; k++) pack.pot[i * 6 + k] = rnd();
		if ((i + 1) % runLen === 0 && run + 1 < runs) {
			pack.bnd[i] = rnd() < 0.5 ? SP.EDGE.subduct : SP.EDGE.open;
			pack.pol[i] = rnd() < 0.5 ? -1 : 1;
			run++;
		}
	}
	pack.plates = [];
	for (i = 0; i < runs; i++) pack.plates.push({ id: i, n: runLen });
	return pack;
}

check.section('C. the pack: size, checksum, round trip');
var sizes = {};
[198, 400, REAL_L7].forEach(function (n) {
	var pack = syntheticPack(n, Math.max(4, Math.round(n / 28)));
	SP.quantize(pack);
	pack.checksum = SP.checksum(pack);
	var text = SP.encode(pack);
	sizes[n] = text.length;
	check.ok('n=' + n + ': the pack validates and verifies',
		SP.validate(pack) === '' && SP.verify(pack) === '',
		(text.length / 1024).toFixed(1) + ' KB, checksum ' + pack.checksum);
	var back = SP.decode(text), worst = 0;
	SP.FIELDS.forEach(function (f) {
		for (var i = 0; i < pack[f.name].length; i++) worst = Math.max(worst, Math.abs(back[f.name][i] - pack[f.name][i]));
	});
	check.ok('n=' + n + ': every field is bit-exact through JSON', worst === 0 && back.checksum === pack.checksum,
		'max |delta| ' + worst);
});
check.info('pack size (JSON, six significant digits)',
	['L5 (198)', 'L6 (400)', 'L7 (811)'].map(function (label, i) {
		return label + ' ' + (sizes[[198, 400, REAL_L7][i]] / 1024).toFixed(1) + ' KB';
	}).join(' · '));
check.info('bytes per sample', (sizes[400] / 400).toFixed(0) + ' B');
// The source it replaces is one 536 KB Earth pack per epoch; a cut is one line out of it.
check.ok('a cut is at least 5 x smaller than the pack it came out of (536 KB)',
	sizes[400] < 536 * 1024 / 5, (sizes[400] / 1024).toFixed(1) + ' KB vs 536 KB');
check.ok('the usual cut (L5/L6) still fits a clipboard and a gist-sized file',
	sizes[400] < 128 * 1024, (sizes[198] / 1024).toFixed(1) + ' / ' + (sizes[400] / 1024).toFixed(1) + ' KB');

check.section('D. the decoder refuses what it must');
function refuses(name, mutate) {
	var pack = syntheticPack(64, 8);
	SP.quantize(pack); pack.checksum = SP.checksum(pack);
	mutate(pack);
	var msg = SP.validate(pack) || SP.verify(pack);
	check.ok('rejects ' + name, msg !== '', msg);
}
refuses('a foreign format tag', function (p) { p.format = 'pgt-something-else'; });
refuses('a future version', function (p) { p.version = 2; });
refuses('a pack with no license line', function (p) { p.license = ''; });
refuses('an edited sample (the checksum catches it)', function (p) { p.hFelM[3] += 7; });
refuses('a sample out of order', function (p) { var t = p.sKm[5]; p.sKm[5] = p.sKm[6]; p.sKm[6] = t; });
refuses('a field of the wrong length', function (p) { p.zM = new Int32Array(10); });
refuses('a host code outside the table', function (p) { p.host[2] = 9; });
refuses('a negative thickness', function (p) { p.hSedM[4] = -1; });
refuses('a number that is not finite', function (p) { p.pot[7] = NaN; });
refuses('a boundary code the section does not have', function (p) { p.bnd[1] = 7; });
refuses('a polarity outside -1/0/+1', function (p) { p.pol[2] = 3; });
refuses('a path that is neither circle nor polyline', function (p) { p.path.kind = 'spiral'; });
refuses('a cut that does not reach its own arc length', function (p) { p.path.arcKm *= 2; });

check.section('E. the fit into the section');
var big = syntheticPack(400, 16);
check.ok('one column per crossed cell fits colCap ' + P.colCap + ' at L5 and L6',
	198 <= P.colCap && 400 <= P.colCap, '198 / 400 <= ' + P.colCap);
// L7 crosses 811 cells: more than the section can hold, so that cut is resampled, not
// dropped - which is only honest because the resample conserves the thickness integral.
check.ok('L7 (' + REAL_L7 + ' cells) does not fit and must be resampled onto columns',
	REAL_L7 > P.colCap, REAL_L7 + ' > ' + P.colCap);
function plateRuns(pack) {
	var runs = [], i = 0;
	while (i < pack.n) {
		var j = i;
		while (j + 1 < pack.n && pack.plate[j + 1] === pack.plate[i]) j++;
		runs.push({ plate: pack.plate[i], len: j - i + 1 });
		i = j + 1;
	}
	return runs;
}
// the plan's rule: a cut crosses more plate runs than the section has plates, so merge the
// narrowest run into its wider neighbour until it fits - the widest neighbour wins the name.
function mergeToCap(runs, cap) {
	var merges = 0;
	while (runs.length > cap) {
		var at = 0, i;
		for (i = 1; i < runs.length; i++) if (runs[i].len < runs[at].len) at = i;
		var left = at > 0 ? runs[at - 1] : null, right = at + 1 < runs.length ? runs[at + 1] : null;
		var into = !left ? right : !right ? left : (left.len >= right.len ? left : right);
		into.len += runs[at].len;
		runs.splice(at, 1);
		merges++;
	}
	return merges;
}
var runs = plateRuns(syntheticPack(811, 29));
check.ok('plate runs survive the cut as intervals',
	runs.length > 0 && runs.reduce(function (a, r) { return a + r.len; }, 0) === 811,
	runs.length + ' runs over 811 cells');
var merges = mergeToCap(runs, P.plateCap);
check.ok('the narrowest-run merge brings the runs under plateCap ' + P.plateCap,
	runs.length <= P.plateCap, runs.length + ' runs after ' + merges + ' merges');

// The resample: one value per section column from one value per cell, arc-length weighted.
// Mass-exact in both directions, which is the only reason the section may keep its own
// column count instead of adopting the globe's.
function resample(values, arcs, nOut) {
	var total = 0, i;
	for (i = 0; i < arcs.length; i++) total += arcs[i];
	var d = total / nOut, out = new Float64Array(nOut);
	var cell = 0, cellStart = 0, cellEnd = arcs[0];
	for (i = 0; i < nOut; i++) {
		var a = i * d, b = a + d, sum = 0, wsum = 0;
		while (cellEnd <= a && cell < values.length - 1) { cell++; cellStart = cellEnd; cellEnd += arcs[cell]; }
		var c = cell, cs = cellStart, ce = cellEnd;
		while (cs < b && c < values.length) {
			var lo = Math.max(a, cs), hi = Math.min(b, ce);
			if (hi > lo) { sum += values[c] * (hi - lo); wsum += hi - lo; }
			c++; cs = ce;
			if (c < values.length) ce += arcs[c];
		}
		out[i] = wsum > 0 ? sum / wsum : values[Math.min(c, values.length - 1)];
	}
	return out;
}
var walk6 = walks[40962];
var cellVal = new Float64Array(walk6.cells.length);
for (var i = 0; i < cellVal.length; i++) cellVal[i] = 3000 + 27000 * ((i * 37) % 101) / 101;
var before = 0;
for (i = 0; i < cellVal.length; i++) before += cellVal[i] * walk6.arc[i];
[512, 128, 1024].forEach(function (nOut) {
	var out = resample(cellVal, walk6.arc, nOut);
	var after = 0;
	for (var k = 0; k < nOut; k++) after += out[k];
	after *= (2 * Math.PI * R) / nOut;
	check.near('the box filter onto ' + nOut + ' columns conserves the thickness integral', after, before, 1e-9, 'm*km');
});
check.info('source resolution vs section columns',
	'L6 ' + walk6.cells.length + ' cells at ' + (2 * Math.PI * R / walk6.cells.length).toFixed(0) +
	' km -> 512 columns at ' + (2 * Math.PI * R / 512).toFixed(0) + ' km');

check.section('F. the path block (both sides label the cut from the same block)');
var packPath = syntheticPack(333, 12);
var ll = [0, 0];
packPath.path = { kind: 'circle', lat0: 0, lon0: 0, az0: 0, closes: true, arcKm: 2 * Math.PI * R, cellKm: 120 };
SP.latLonAt(packPath, 0, ll);
check.ok('s = 0 is the point the user clicked', Math.abs(ll[0]) < 1e-9 && Math.abs(ll[1]) < 1e-9,
	ll[0].toFixed(9) + ', ' + ll[1].toFixed(9));
SP.latLonAt(packPath, Math.PI * R / 2, ll);
check.ok('a quarter of a northbound circle is the pole', Math.abs(ll[0] - 90) < 1e-6, ll[0].toFixed(6) + ' deg');
SP.latLonAt(packPath, 2 * Math.PI * R, ll);
check.ok('the full circle comes back to the click', Math.abs(ll[0]) < 1e-6 && Math.abs(ll[1]) < 1e-6,
	ll[0].toFixed(6) + ', ' + ll[1].toFixed(6));
var east = { kind: 'circle', lat0: 0, lon0: 0, az0: 90, closes: true, arcKm: 2 * Math.PI * R, cellKm: 120 };
packPath.path = east;
var prevLon = 0, turned = 0, total = 0;
for (i = 1; i <= 72; i++) {
	SP.latLonAt(packPath, i * east.arcKm / 72, ll);
	var stepLon = ll[1] - prevLon;
	stepLon -= Math.round(stepLon / 360) * 360;              // the +-180 seam is not a turn
	total += stepLon;
	if (stepLon < 0) turned++;
	prevLon = ll[1];
}
check.ok('an equatorial cut walks east the whole way round', turned === 0 && Math.abs(total - 360) < 1e-6,
	turned + ' backwards steps, ' + total.toFixed(6) + ' deg of longitude');
var seg1 = SP.arcKmBetween(0, 0, 0, 90), seg2 = SP.arcKmBetween(0, 90, 60, 90);
packPath.path = { kind: 'polyline', verts: [0, 0, 0, 90, 60, 90], closes: false, arcKm: seg1 + seg2, cellKm: 120 };
SP.latLonAt(packPath, 0, ll);
var startOk = Math.abs(ll[0]) < 1e-9 && Math.abs(ll[1]) < 1e-9;
SP.latLonAt(packPath, seg1, ll);
var midOk = Math.abs(ll[0]) < 1e-6 && Math.abs(ll[1] - 90) < 1e-6;
SP.latLonAt(packPath, seg1 + seg2, ll);
var endOk = Math.abs(ll[0] - 60) < 1e-6 && Math.abs(ll[1] - 90) < 1e-6;
check.ok('a polyline cut runs vertex to vertex', startOk && midOk && endOk,
	ll[0].toFixed(4) + ', ' + ll[1].toFixed(4));

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
