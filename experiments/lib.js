// lib.js — the node harness loader. It parses the <script src> tags of index.html and
// requires exactly that order, so node and the browser cannot drift (one source of
// truth for load order). Also the tiny PASS/FAIL helper every experiment uses.
//   const { mods, check } = require('./lib.js');
//   const { geom, state, columns, render, sim } = mods;
'use strict';

var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function scriptOrder() {
	var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
	var re = /<script[^>]+src="([^"]+)"/g, files = [], m;
	while ((m = re.exec(html)) !== null) files.push(m[1]);
	if (!files.length) throw new Error('no <script src> tags found in index.html');
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
