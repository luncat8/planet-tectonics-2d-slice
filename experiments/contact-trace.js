// contact-trace.js — the worst single-frame moves of the drawn surface and what the
// records around them did that frame, the way contact-audit reports them but without the
// gate. Run: node experiments/contact-trace.js [frames=600]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, PLT = L.mods.plates, COL = L.mods.columns;
var frames = +(process.argv[2] || 600);
L.check.planet(1, 'def');
SIM.setGeo(50e3);
var NS = 2048, step = P.wrap / NS, prev = new Float64Array(NS), cur = new Float64Array(NS);
function sample(field, out) {
	var n = S.nCol, m, lo, hi, mid, k, km, f, d, dl;
	for (m = 0; m < NS; m++) {
		var x = m * step;
		lo = 0; hi = n;
		while (lo < hi) { mid = (lo + hi) >> 1; if (S.colX[mid] < x) lo = mid + 1; else hi = mid; }
		k = lo < n ? lo : 0; km = k > 0 ? k - 1 : n - 1;
		dl = x - S.colX[km]; if (dl < 0) dl += P.wrap;
		d = S.colX[k] - S.colX[km]; if (d <= 0) d += P.wrap;
		f = d > 0 ? dl / d : 0;
		out[m] = field[km] + (field[k] - field[km]) * f;
	}
}
sample(S.z, prev);
var rows = [];
for (var f = 0; f < frames; f++) {
	var preN = S.nCol, preX = new Float64Array(preN), preH = new Float64Array(preN), preW = new Float64Array(preN);
	var preZ = new Float64Array(preN);
	for (var i = 0; i < preN; i++) { preX[i] = S.colX[i]; preH[i] = S.hTot[i]; preW[i] = S.colW[i]; preZ[i] = S.z[i]; }
	SIM.step();
	sample(S.z, cur);
	var worst = 0, wx = 0, m;
	for (m = 0; m < NS; m++) {
		var d = Math.abs(cur[m] - prev[m]);
		if (d > worst) { worst = d; wx = m * step; }
		prev[m] = cur[m];
	}
	if (worst < 150) continue;
	// describe the neighbourhood of the move
	var near = [];
	for (var c = 0; c < S.nCol; c++) {
		var dx = S.colX[c] - wx;
		if (dx > P.wrap * 0.5) dx -= P.wrap; else if (dx < -P.wrap * 0.5) dx += P.wrap;
		if (Math.abs(dx) > 3 * P.w0) continue;
		var best = -1, bd = 1e9;
		for (var j = 0; j < preN; j++) {
			var d2 = preX[j] - S.colX[c];
			if (d2 < 0) d2 = -d2;
			if (d2 > P.wrap * 0.5) d2 = P.wrap - d2;
			if (d2 < bd) { bd = d2; best = j; }
		}
		near.push('c' + c + '(n=' + S.nCol + ' gh' + S.colGhost[c] + ' pl' + S.colPlate[c] +
			' e' + S.edge[c] + '/' + S.edgePol[c] + ' w' + (S.colW[c] / 1e3).toFixed(1) +
			' h' + (S.hTot[c] / 1e3).toFixed(1) + (best >= 0 && bd < 8e3 ?
				'  was w' + (preW[best] / 1e3).toFixed(1) + ' h' + (preH[best] / 1e3).toFixed(1) +
				' z' + (preZ[best] / 1e3).toFixed(1) : '') + ')');
	}
	rows.push('f' + f + '  worst ' + worst.toFixed(0) + ' m at x ' + (wx / 1e3).toFixed(0) + ' km  ' +
		(near.length ? near.slice(0, 8).join(' ') : ''));
}
console.log(rows.length ? rows.join('\n') : 'no frame over 150 m');
