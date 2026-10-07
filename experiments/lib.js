// lib.js — the node harness loader. It parses the <script src> tags of columns.html and
// requires exactly that order, so node and the browser cannot drift (one source of
// truth for load order). Also the tiny PASS/FAIL helper every experiment uses.
//   const { mods, check } = require('./lib.js');
//   const { geom, state, columns, render, sim } = mods;
'use strict';

var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function scriptOrder() {
	var html = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
	var re = /<script[^>]+src="([^"]+)"/g, files = [], m;
	while ((m = re.exec(html)) !== null) files.push(m[1]);
	if (!files.length) throw new Error('no <script src> tags found in columns.html');
	return files;
}

var mods = {};
(function load() {
	var order = scriptOrder(), i, full;
	for (i = 0; i < order.length; i++) {
		full = path.resolve(root, order[i]);
		require(full);
		mods[path.basename(order[i], '.js')] = require.cache[full].exports;
	}
})();

var check = { fails: 0, total: 0 };

check.section = function (title) { console.log('\n' + title); };

check.info = function (name, what) {
	console.log('INFO  ' + name + (what === undefined ? '' : '   ' + what));
};

check.ok = function (name, cond, info) {
	this.total++;
	if (!cond) this.fails++;
	console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
};

// tol < 1 is a relative tolerance, tol >= 1 an absolute one (in `unit`)
check.near = function (name, got, want, tol, unit) {
	var d = Math.abs(got - want);
	var rel = want === 0 ? d : d / Math.abs(want);
	var pass = tol === 0 ? got === want : (tol < 1 ? rel < tol : d <= tol);
	this.ok(name, pass && isFinite(got), (tol < 1 ? 'rel ' : 'abs ') + d.toExponential(2) +
		'  got ' + got + (unit ? ' ' + unit : '') + '  want ' + want);
};

check.done = function () {
	console.log('\n' + (this.fails === 0
		? 'ALL PASS (' + this.total + ' checks)'
		: this.fails + ' / ' + this.total + ' FAILURES'));
	process.exitCode = this.fails === 0 ? 0 : 1;
	return this.fails;
};

// a ready-to-run planet at the given seed (default: params.seed)
check.planet = function (seed, preset) {
	var P = mods.params, GEO = mods.geom, SIM = mods.sim;
	if (seed !== undefined) P.seed = seed;
	SIM.reset();
	GEO.setPreset(preset || 'def');
	GEO.sync();
	GEO.buildColLUT(mods.state);
	return mods.state;
};

// The prescribed two-continent fixture (0.1.6-plan.md §5, corrected 0.1.8 M0): two
// plates, half the planet each, both uniform continental crust at the undeformed
// reference. Plumes and stale trench sources are removed so an unrelated LIP or arc cannot
// turn this controlled C-C test into a different boundary. One builder keeps r4-check and
// the orogen-measure comparison identical.
//
// The crust is built as *stacks*. The fixture this replaces assigned only `hFel`, and
// every kernel derives its caches from the stacks (COL.sums), so the continents were the
// `def` planet's mixed 13.6-67 km crust and the collision pair started thinner than its
// own flanks; the numbers it produced described a fixture nobody had declared.
check.twoContinents = function (seed) {
	var P = mods.params, S = mods.state, COL = mods.columns;
	check.planet(seed === undefined ? P.seed : seed, 'def');
	var n = S.nCol, half = n >> 1, i;
	for (i = 0; i < n; i++) {
		S.colPlate[i] = i < half ? 0 : 1;
		S.colAge[i] = 100;
		S.edge[i] = P.EDGE.none; S.edgePol[i] = 0; S.edgeAge[i] = 0;
		S.edgeRPlate[i] = -1; S.edgeSlow[i] = 0; S.edgeShort[i] = 0;
		S.colNL[i] = 0;
		COL.push(i, P.hFelLand0, P.LITH.fel, 100, 0);
		COL.sums(i);
	}
	S.nPl = 2; S.plN[0] = half; S.plN[1] = n - half;
	S.plU[0] = 0; S.plU[1] = 0;
	S.nPlm = 0;
	S.trenchDist.fill(0, 0, n);
	for (i = 0; i < n; i++) S.colU[i] = S.plU[S.colPlate[i]];
	return S;
};

// The collision site of that fixture: the closing collide edge between the two
// prescribed plates, or -1 once the boundary welded and there is nothing to measure.
check.collisionSite = function () {
	var P = mods.params, S = mods.state, i, j;
	for (i = 0; i < S.nCol; i++) {
		if (S.edge[i] !== P.EDGE.collide || !(S.edgeRelN[i] < 0)) continue;
		j = i + 1 < S.nCol ? i + 1 : 0;
		if (S.colGhost[i] || S.colGhost[j]) continue;
		if (S.colPlate[i] > 1 || S.colPlate[j] > 1) continue;
		return i;
	}
	return -1;
};

function wrapR2(k, n) { k %= n; return k < 0 ? k + n : k; }

// The ground at a shoulder slot. A draining record holds no ground -- its hTot is ~0 and
// the trench retires it within a few frames -- so it is not a shoulder the pair can rise
// above: step outward to the nearest real column. The walk is bounded to the orogenic
// flow's own reach (beltFeed + 1) so a wide draining run cannot pull in a distant flank.
// With no real column at all the shoulder is 0, which keeps the pre-existing reading (a
// pair with no ground beside it has nothing to prove it is a belt and fails the ratio).
function r2Ground(st, n, k, dir) {
	var c = wrapR2(k, n), d;
	for (d = 0; d <= mods.params.beltFeed + 1; d++) {
		if (!st.colGhost[c]) return st.hTot[c];
		c = wrapR2(c + dir, n);
	}
	return 0;
}

// The shoulder of one side: the highest real ground over the slots `k, k+dir, ...` out to
// `reach` columns, each slot read through r2Ground. The selected R2 needle reads the belt's
// own neighbourhood this way (beltFeed + 2 each side: the flow's reach and the flank
// columns COL.beltAt measures the belt against); the immediate-slot reading is kept as the
// legacy field. A needle is an *isolated* rise, so the bar is the highest ground beside the
// pair, not its own notch.
function r2Shoulder(st, n, k, dir, reach) {
	var best = 0, d, g;
	for (d = 0; d < reach; d++) {
		g = r2Ground(st, n, k + d * dir, dir);
		if (g > best) best = g;
	}
	return best;
}

// The selected R2 shape measure is shared by both audits. `out` is caller-owned so the
// per-frame scan allocates nothing; outerRatio/widthCount/needleImmediateRatio retain the
// legacy readings.
//
// The shoulder is the real ground beside the pair (r2Ground), not the raw neighbour slot:
// on seed 1 at 100 kyr/frame every one of the 144 needle failures was a pair whose
// immediate left slot held a draining record, so the pair was compared against the low
// ground beyond a trench instead of the plateau one column further out (measured worst
// 2.02 as written, 1.24 against the real ground; with the walk the leg has no needle
// failure above 1.38). This changes no threshold and cannot turn a passing pair red --
// skipping a draining record only raises the shoulder, and the shoulder only lowers the
// ratio.
//
// The shoulder is read over the *belt's own neighbourhood* (0.1.9-plan.md §2): the ground
// from `i-1` out to `i-(beltFeed+2)` and from `j+1` out to `j+(beltFeed+2)` -- the flow's
// reach and the flank columns COL.beltAt measures the belt against. A belt with a notch or
// a twin crest is the shape the old immediate-slot reading calls a needle: measured on
// seed 5/100 at 1424.1 km, an inherited margin column 45.8 km over ground that is 20.5 km
// at its own notch, 21.4 km one column on and 40.9 km at the flank, read 2.23 against the
// notch and 1.12 against the neighbourhood. The wider window is a superset of the old one,
// so it can only lower the ratio and cannot turn a passing pair red; the width half is
// deliberately unchanged: COL.beltAt's own belt walk stops at a draining record, so a
// window broken by one is two shorter belts and the contiguity clause must see it that way.
check.r2ShapeAt = function (st, i, out) {
	var P = mods.params, n = st.nCol, j = i + 1 < n ? i + 1 : 0;
	var h = st.hTot, flank, peak, shoulder, count = 0, width = 0, run = 0, k, c, rise;
	flank = 0.25 * (h[wrapR2(i - P.beltFeed - 1, n)] + h[wrapR2(i - P.beltFeed - 2, n)] +
		h[wrapR2(j + P.beltFeed + 1, n)] + h[wrapR2(j + P.beltFeed + 2, n)]);
	peak = Math.max(h[i], h[j]);
	shoulder = Math.max(r2Shoulder(st, n, i - 1, -1, P.beltFeed + 2),
		r2Shoulder(st, n, j + 1, +1, P.beltFeed + 2));
	out.needleImmediate = Math.max(r2Ground(st, n, i - 1, -1), r2Ground(st, n, j + 1, +1));
	rise = flank + P.beltRise;
	for (k = -2; k <= 3; k++) {
		c = wrapR2(i + k, n);
		if (h[c] >= rise) {
			count++;
			if (++run > width) width = run;
		} else run = 0;
	}
	out.flank = flank;
	out.peak = peak;
	out.shoulder = shoulder;
	out.outerRatio = flank > 0 ? peak / flank : (peak > 0 ? Infinity : 1);
	out.needleRatio = shoulder > 0 ? peak / shoulder : (peak > 0 ? Infinity : 1);
	out.needleImmediateRatio = out.needleImmediate > 0 ? peak / out.needleImmediate :
		(peak > 0 ? Infinity : 1);
	out.widthCount = count;
	out.widthRun = width;
	out.built = peak >= flank + P.beltRoot;
	return out;
};

// brute-force owner of a world x: the reference the column LUT is checked against.
// The column whose position is the nearest *predecessor* of x going backwards around
// the circle. O(n) on purpose: it must not share any assumption with the LUT walk, so
// it stays correct for unwrapped, non-uniform and single-column states.
check.owner = function (S, x) {
	var P = mods.params, n = S.nCol, i, d, best = -1, bestD = Infinity;
	for (i = 0; i < n; i++) {
		d = x - S.colX[i];
		d -= Math.floor(d / P.wrap) * P.wrap;
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
};

module.exports = { mods: mods, check: check, root: root, scriptOrder: scriptOrder };
