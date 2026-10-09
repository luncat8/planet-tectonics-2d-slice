// finite-probe.js — where does the first non-finite value appear? Runs the contact
// audit's leg (same planet, same clocks, combined by default) and checks every S buffer
// after every frame. Reports the first frame, the key, the index and the value, then
// keeps a per-key tally of first-bad frames. Probe only: it changes no engine code.
//
//   node experiments/finite-probe.js [frames=3000] [seed=1] [kyr=50] [--tectonic-only]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim;

var arg = process.argv.slice(2), flags = [], pos = [];
for (var a = 0; a < arg.length; a++) (arg[a].charAt(0) === '-' ? flags : pos).push(arg[a]);
var frames = +(pos[0] || 3000), seed = +(pos[1] || 1), kyr = +(pos[2] || 50);
if (flags.indexOf('--tectonic-only') >= 0) P.sl.erupt = 0;

L.check.planet(seed, 'def');
SIM.setGeo(kyr * 1e3);
console.log('leg ' + frames + ' frames, seed ' + seed + ', ' + kyr + ' kyr/frame' +
	(flags.indexOf('--tectonic-only') >= 0 ? ' (tectonic only)' : ' (combined clocks)'));

var firstBad = {};   // key -> { f, i, v }
var nBadKeys = 0;

function scan(f) {
	var key, i, v, bad = 0;
	for (key in S) {
		v = S[key];
		if (!v || !v.length) continue;
		for (i = 0; i < v.length; i++) {
			if (isFinite(v[i])) continue;
			bad++;
			if (!firstBad[key]) { firstBad[key] = { f: f, i: i, v: v[i] }; nBadKeys++; }
			if (nBadKeys <= 12 && !firstBad[key].reported) {
				firstBad[key].reported = true;
				console.log('FIRST ' + key + '[' + i + '] = ' + v[i] + ' at frame ' + f +
					' (t ' + (S.t / 1e3).toFixed(1) + ' Myr, nCol ' + S.nCol + ')');
			}
			if (bad > 5) return bad;
		}
	}
	return bad;
}

var f, bad, totalBadFrames = 0;
for (f = 0; f < frames; f++) {
	SIM.step();
	bad = scan(f);
	if (bad) {
		totalBadFrames++;
		if (totalBadFrames <= 3) console.log('frame ' + f + ': ' + bad + ' non-finite values so far');
	}
}
console.log('\nframes with non-finite values: ' + totalBadFrames + ' / ' + frames);
console.log('keys with a first-bad record: ' + nBadKeys);
var keys = Object.keys(firstBad).sort(function (a, b) { return firstBad[a].f - firstBad[b].f; });
for (var k = 0; k < keys.length; k++) {
	var r = firstBad[keys[k]];
	console.log('  ' + keys[k] + '  first bad frame ' + r.f + '  index ' + r.i + '  value ' + r.v);
}
process.exitCode = nBadKeys ? 1 : 0;
