// contact-birth.js — one boundary watched through the frames that lead to a birth: the
// gap, the classified state, the entry terms COL.intents gates on, and what the newborn
// ended up with. Run: node experiments/contact-birth.js [frames=400]
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, PLT = L.mods.plates, COL = L.mods.columns;
L.check.planet(1, 'def');
SIM.setGeo(50e3);
var watch = -1, hist = [], f;
for (f = 0; f < 400; f++) {
	var preN = S.nCol;
	if (watch < 0) {
		for (var q = 0; q < S.nCol; q++) {
			var r = (q + 1) % S.nCol;
			if (S.edge[q] !== P.EDGE.open || S.colPlate[q] === S.colPlate[r]) continue;
			var dd = S.colX[r] - S.colX[q];
			if (dd < 0) dd += P.wrap;
			if (dd > 1.25 * P.w0) { watch = q; break; }
		}
	}
	if (watch < 0) { SIM.step(); continue; }
	var gap = S.colX[watch + 1] - S.colX[watch];
	if (gap < 0) gap += P.wrap;
	hist.push('f' + f + ' gap ' + (gap / 1e3).toFixed(1) + ' km  w ' + (S.colW[watch] / 1e3).toFixed(1) +
		'/' + (S.colW[watch + 1] / 1e3).toFixed(1) + '  oldW ' + (S.oldW[watch] / 1e3).toFixed(1) +
		'  h ' + (S.hTot[watch] / 1e3).toFixed(2) + '/' + (S.hTot[watch + 1] / 1e3).toFixed(2) +
		'  edge ' + S.edge[watch] + ' relN ' + (S.edgeRelN[watch] / 1e3).toFixed(1) +
		' edgeAge ' + S.edgeAge[watch].toFixed(2) + '  nCol ' + preN);
	SIM.step();
	if (hist.length > 12) hist.shift();
	if (S.nCol !== preN) break;
}
console.log(hist.join('\n'));
console.log('after birth: nCol ' + S.nCol + '  (watched index ' + watch + ')');
var k = Math.max(0, Math.min(watch, S.nCol - 6));
for (var c = k - 1; c < k + 6 && c < S.nCol; c++) {
	var b = c * P.layerCap, parts = [];
	for (var t = 0; t < S.colNL[c]; t++) parts.push(S.layLi[b + t] + ':' + (S.layTh[b + t] / 1e3).toFixed(1));
	console.log('  c' + c + ' w ' + (S.colW[c] / 1e3).toFixed(1) + ' hTot ' + (S.hTot[c] / 1e3).toFixed(2) +
		' z ' + (S.z[c] / 1e3).toFixed(2) + '  [' + parts.join(' ') + ']');
}
