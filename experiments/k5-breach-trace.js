'use strict';
// 0.1.11 breach trace (report only). Two views of one run, on whichever engine the tree holds:
//   1. every frame whose global maximum thickness rises by more than 25 km (from frame 4150),
//      with the topology operations that ran in that step (none means a transport or floor move);
//   2. the columns in a window [lo, hi] km over the last frames before the breach.
// The breach of archive/0.1.11-hysteresis-worklog.md is seed 12, 100 kyr/frame, frame 4263 at
// x 1175.6 km, reached with the variant applied (experiments/logs/0.1.11-hysteresis-variants.patch,
// HYS_MODE=1). The base engine does not produce it on that seed.
//
// usage: node experiments/k5-breach-trace.js <seed> <kyr> <frames> <loKm> <hiKm> <fromFrame>

var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, COL = L.mods.columns, SIM = L.mods.sim;
var arg = process.argv.slice(2);
var seed = +arg[0], kyr = +arg[1], frames = +arg[2], lo = +arg[3], hi = +arg[4], fromFrame = +arg[5];
var OPS = ['consume', 'accrete', 'drain', 'rift'], ops = [], frame = 0, prevMax = 0, jumps = [];

function km(v) { return (v / 1e3).toFixed(1); }
function track(name) {
	var orig = COL[name];
	COL[name] = function () {
		var r = orig.apply(this, arguments);
		ops.push(name);
		return r;
	};
}
function globalMax() {
	var m = 0, c;
	for (c = 0; c < S.nCol; c++) if (S.hTot[c] > m) m = S.hTot[c];
	return m;
}
function windowAt(frameNo) {
	var c, n, x, lines = ['frame ' + frameNo + ' (nCol ' + S.nCol + ')'];
	for (c = 0; c < S.nCol; c++) {
		x = S.colX[c] / 1e3;
		if (x < lo || x > hi) continue;
		n = (c + 1) % S.nCol;
		lines.push('  col ' + c + ' x ' + x.toFixed(1) + ' w ' + (S.colW[c] / P.w0).toFixed(2) + ' w0 hTot ' +
			km(S.hTot[c]) + ' hFel ' + km(S.hFel[c]) + ' plate ' + S.colPlate[c] + ' | edge ' + S.edge[c] +
			' relN ' + ((S.colU[n] - S.colU[c]) / 1e3).toFixed(1) + ' mm/yr gap ' +
			(((S.colX[n] - S.colX[c] + P.wrap) % P.wrap) / 1e3).toFixed(1) + ' km');
	}
	return lines.join('\n');
}

OPS.forEach(track);
L.check.planet(seed);
SIM.setGeo(kyr);
for (; frame < frames; frame++) {
	ops.length = 0;
	SIM.step();
	var now = globalMax();
	if (now - prevMax > 25e3 && frame >= fromFrame - 100) {
		jumps.push('frame ' + frame + ': global max ' + km(prevMax) + ' -> ' + km(now) + ' km; topology ops: ' +
			(ops.join(', ') || 'none'));
	}
	prevMax = now;
	if (frame >= fromFrame - 2 && frame <= fromFrame + 2) console.log(windowAt(frame));
}
console.log('global-max rises over 25 km from frame ' + (fromFrame - 100) + ': ' + jumps.length);
jumps.forEach(function (j) { console.log(j); });
