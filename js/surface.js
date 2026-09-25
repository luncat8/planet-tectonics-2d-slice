// surface.js — isostatic elevation and the column profile (design §4.6, reference §7.1
// ported to the 1D line: neighbours are the two adjacent columns). Erosion, one-hop
// routing and deposition land here in M3; M1 needs the profile because the initial
// planet's elevation *is* isostatic and the renderer paints against it.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;

var SURF = {};

SURF.smoothstep = function (x, a, b) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
};

// z = zRef + buoy - therm + zDyn. Calibration (reference §7.1), reproduced by
// experiments/scale-check.js: 7 km mafic age 0 -> -2600 m, age 80 -> -5730 m,
// 35 km felsic -> +400 m, 70 km felsic -> +6234 m, 15 km felsic over 7 km mafic ~ -2.5 km.
SURF.elev = function (i) {
	var buoy = S.hFel[i] * (P.rhoM - P.rhoFel) / P.rhoM +
		S.hMaf[i] * (P.rhoM - P.rhoMaf) / P.rhoM +
		S.hSed[i] * (P.rhoM - P.rhoSed) / P.rhoM;
	var ci = this.smoothstep(S.hFel[i], P.ciLo, P.ciHi);
	var therm = P.thermK * Math.sqrt(Math.min(S.colAge[i], P.thermAgeCap)) * (1 - ci) + P.zRoot * ci;
	return P.zRef + buoy - therm + S.zDyn[i];
};

// elevation, wet flag and the wrapped central-difference slope for every column
SURF.profile = function () {
	var n = S.nCol, i, im, ip, dx;
	for (i = 0; i < n; i++) {
		S.z[i] = this.elev(i);
		S.wet[i] = S.z[i] < 0 ? 1 : 0;
	}
	if (n < 3) return;
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		ip = i + 1 < n ? i + 1 : 0;
		dx = S.colX[ip] - S.colX[im];
		if (dx <= 0) dx += P.wrap;
		S.slope[i] = dx > 0 ? (S.z[ip] - S.z[im]) / dx : 0;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = SURF;
