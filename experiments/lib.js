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
// reference. One builder so r4-check and the orogen-measure comparison cannot drift.
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
		S.edgeRPlate[i] = -1; S.edgeSlow[i] = 0;
		S.colNL[i] = 0;
		COL.push(i, P.hFelLand0, P.LITH.fel, 100, 0);
		COL.sums(i);
	}
	S.nPl = 2; S.plN[0] = half; S.plN[1] = n - half;
	S.plU[0] = 0; S.plU[1] = 0;
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
