// r2-needle-persist.js — how long does an R2 needle reading stand? Runs a contact-audit
// leg headless, scans every non-ghost collide pair every frame with the shared measure
// (lib.js r2ShapeAt, the same one the audit gates), and for every sample above P.beltPeak
// records the site bucket and frame. Prints, per leg: the failing sample count, the
// longest run of consecutive frames above the limit at one site, and the run-length
// histogram — the measurement a persistence clause would read. Probe only.
//
//   node experiments/r2-needle-persist.js [frames=5000] [seed=5] [kyr=100] [--tectonic-only]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim;

var arg = process.argv.slice(2), flags = [], pos = [];
for (var a = 0; a < arg.length; a++) (arg[a].charAt(0) === '-' ? flags : pos).push(arg[a]);
var frames = +(pos[0] || 5000), seed = +(pos[1] || 5), kyr = +(pos[2] || 100);
if (flags.indexOf('--tectonic-only') >= 0) P.sl.erupt = 0;

L.check.planet(seed, 'def');
SIM.setGeo(kyr * 1e3);

var scratch = { flank: 0, peak: 0, shoulder: 0, outerRatio: 0, needleRatio: 0,
	needleImmediate: 0, needleImmediateRatio: 0, widthCount: 0, widthRun: 0, built: false };
var bucketW = 2.5 * P.w0;
// site bucket -> last frame above the limit, and the run length ending there
var lastF = {}, runLen = {}, runs = {};
var nSamples = 0, nOver = 0, worst = 0, worstAt = '';
var f, i, j;
for (f = 0; f < frames; f++) {
	SIM.step();
	for (i = 0; i < S.nCol; i++) {
		if (S.edge[i] !== P.EDGE.collide) continue;
		j = i + 1 < S.nCol ? i + 1 : 0;
		if (S.colGhost[i] || S.colGhost[j]) continue;
		L.check.r2ShapeAt(S, i, scratch);
		if (!(scratch.flank > 0)) continue;
		nSamples++;
		if (scratch.needleRatio <= P.beltPeak) continue;
		nOver++;
		if (scratch.needleRatio > worst) { worst = scratch.needleRatio; worstAt = 'frame ' + f + ' x ' + (S.colX[i] / 1e3).toFixed(1) + ' km'; }
		var site = Math.floor(S.colX[i] / bucketW);
		var prev = lastF[site];
		var len = prev === f - 1 ? (runLen[site] || 1) + 1 : 1;
		lastF[site] = f; runLen[site] = len;
		runs[len] = (runs[len] || 0) + 1;
	}
}
console.log('leg ' + frames + ' frames, seed ' + seed + ', ' + kyr + ' kyr/frame' +
	(flags.indexOf('--tectonic-only') >= 0 ? ' (tectonic only)' : ' (combined)'));
console.log('collision samples ' + nSamples + ', above P.beltPeak ' + P.beltPeak + ': ' + nOver +
	' samples, worst ' + worst.toFixed(2) + ' at ' + worstAt);
var lens = Object.keys(runs).map(Number).sort(function (a, b) { return a - b; });
console.log('run lengths (consecutive frames above the limit at one site):');
lens.forEach(function (len) {
	console.log('  ' + len + ' frame' + (len > 1 ? 's' : '') + ': ' + runs[len] + ' site' + (runs[len] > 1 ? 's' : '') +
		'  (' + (len * kyr / 1000).toFixed(2) + ' Myr at ' + kyr + ' kyr/frame)');
});
