// Regression for archive/0.1.webp: passive margins and a continuous rendered Moho.
'use strict';
var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom;
var COL = L.mods.columns, R = L.mods.render;
var pixels = new Uint32Array(P.cw * P.ch);
for (var seed of [1, 2, 19, 12345]) {
	check.planet(seed);
	var continental = 0, margins = 0, valid = true;
	for (var c = 0; c < S.nCol; c++) {
		if (S.hFel[c] <= 0) continue;
		continental++;
		var left = (c + S.nCol - 1) % S.nCol, right = (c + 1) % S.nCol;
		if (S.hFel[left] > 0 && S.hFel[right] > 0) continue;
		margins++;
		valid = valid && S.hFel[c] < P.hFelLand0 && S.hMaf[c] > 0;
	}
	check.ok('seed ' + seed + ': continental quantile unchanged', continental === S.nCol - Math.floor((1 - P.landFrac) * S.nCol));
	check.ok('seed ' + seed + ': coast has thinned felsic over mafic margin', margins > 0 && valid);
}
// Explicit seam fixture independent of the randomly selected coastline.
COL.mask.fill(1); COL.mask[S.nCol - 1] = 0;
check.ok('margin taper wraps at the seam', COL.margin(0, 0.5) === COL.margin(S.nCol - 2, 0.5) && COL.margin(0, 0.5) < 1);

check.planet(1);
var kxSeen = {};
for (var preset of ['def', 'ovw', 'cru', 'bas']) {
	GEO.setPreset(preset); GEO.sync(); GEO.buildColLUT(S);
	kxSeen[GEO.kx.toFixed(3) + '/' + GEO.duPx.toExponential(3)] = 1;
	var before = S.hash();
	R.body(pixels, P.cw, P.ch);
	var maxError = 0;
	for (var x = 0; x < P.cw; x++) {
		var c = GEO.lutCol[x], next = (c + 1) % S.nCol, f = GEO.lutFrac[x];
		var expected = R.profY[x] - S.hTot[c] * (1 - f) - S.hTot[next] * f;
		maxError = Math.max(maxError, Math.abs(R.mohoY[x] - expected));
	}
	check.ok(preset + ': Moho uses the same interpolation as surface', maxError < 1e-8, maxError);
	check.ok(preset + ': display interpolation never mutates beds or mass', before === S.hash());
}
check.ok('the four preset keys select four distinct windows', Object.keys(kxSeen).length === 4);
check.done();
