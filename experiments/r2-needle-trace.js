// r2-needle-trace.js — trace the worst R2 needle sample of a contact-audit leg. Runs the
// leg headless and, around the target site, dumps the per-frame per-lithology ledger
// deltas (which sink took the mass), the pair columns' hTot / z / width, and the frame's
// topology counters, so the mechanism behind a one-frame needle is identified, not guessed.
// Probe only: no engine code is touched.
//
//   node experiments/r2-needle-trace.js [frames=5000] [seed=5] [kyr=100] [--tectonic-only] [xKm=29053.4] [from=2920] [to=2935]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom, SIM = L.mods.sim, COL = L.mods.columns;

var arg = process.argv.slice(2), flags = [], pos = [];
for (var a = 0; a < arg.length; a++) (arg[a].charAt(0) === '-' ? flags : pos).push(arg[a]);
var frames = +(pos[0] || 5000), seed = +(pos[1] || 5), kyr = +(pos[2] || 100);
var xWant = +(pos[3] || 29053.4), fFrom = +(pos[4] || 2920), fTo = +(pos[5] || 2935);
if (flags.indexOf('--tectonic-only') >= 0) P.sl.erupt = 0;

L.check.planet(seed, 'def');
SIM.setGeo(kyr * 1e3);
console.log('leg ' + frames + ' frames, seed ' + seed + ', ' + kyr + ' kyr/frame, target x ' + xWant +
	' km, frames ' + fFrom + '..' + fTo);

var LITH = ['sed', 'fel', 'maf', 'vol'];
var pre = {
	cons: new Float64Array(P.LITH.n), delam: new Float64Array(P.LITH.n),
	prod: new Float64Array(P.LITH.n), mixIn: new Float64Array(P.LITH.n), mixOut: new Float64Array(P.LITH.n)
};
function snapLed() {
	var i;
	for (i = 0; i < P.LITH.n; i++) {
		pre.cons[i] = S.ledCons[i]; pre.delam[i] = S.ledDelam[i]; pre.prod[i] = S.ledProd[i];
		pre.mixIn[i] = S.ledMixIn[i]; pre.mixOut[i] = S.ledMixOut[i];
	}
}
function owner(x) {
	var best = -1, bestD = Infinity, i, d;
	for (i = 0; i < S.nCol; i++) {
		d = x - S.colX[i]; d -= Math.floor(d / P.wrap) * P.wrap;
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}

var f, i, k;
for (f = 0; f < frames; f++) {
	snapLed();
	var c0 = owner(xWant * 1e3), c1 = (c0 + 1) % S.nCol;
	var h0 = S.hTot[c0], h1 = S.hTot[c1], w0 = S.colW[c0], w1 = S.colW[c1];
	var z0 = S.z[c0], z1 = S.z[c1], e0 = S.edge[c0];
	SIM.step();
	if (f < fFrom || f > fTo) continue;
	var d = [];
	for (k = 0; k < P.LITH.n; k++) {
		d.push(LITH[k] + ' cons ' + ((S.ledCons[k] - pre.cons[k]) / 1e6).toFixed(2) +
			' delam ' + ((S.ledDelam[k] - pre.delam[k]) / 1e6).toFixed(2) +
			' prod ' + ((S.ledProd[k] - pre.prod[k]) / 1e6).toFixed(2) +
			' mixIn ' + ((S.ledMixIn[k] - pre.mixIn[k]) / 1e6).toFixed(2) +
			' mixOut ' + ((S.ledMixOut[k] - pre.mixOut[k]) / 1e6).toFixed(2));
	}
	// re-find the same physical columns after the step (nearest predecessor of their old x)
	var a0 = owner(S.colX[c0] + (S.colX[c0 + 1 < S.nCol ? c0 + 1 : 0] - S.colX[c0]) * 0.5);
	console.log('frame ' + f + '  nCol ' + S.nCol + '  edge ' + e0 + '->' + S.edge[c0] +
		'  pair hTot ' + (h0 / 1e3).toFixed(2) + '->' + (S.hTot[c0] / 1e3).toFixed(2) +
		' / ' + (h1 / 1e3).toFixed(2) + '->' + (S.hTot[c1] / 1e3).toFixed(2) +
		'  z ' + (z0 / 1e3).toFixed(2) + '->' + (S.z[c0] / 1e3).toFixed(2) +
		' / ' + (z1 / 1e3).toFixed(2) + '->' + (S.z[c1] / 1e3).toFixed(2) +
		'  w ' + (w0 / P.w0).toFixed(3) + '->' + (S.colW[c0] / P.w0).toFixed(3) +
		' / ' + (w1 / P.w0).toFixed(3) + '->' + (S.colW[c1] / P.w0).toFixed(3));
	for (k = 0; k < P.LITH.n; k++) console.log('    ' + d[k] + '  (1e6 m3/m)');
}
