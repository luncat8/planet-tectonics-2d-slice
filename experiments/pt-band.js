// pt-band.js — what the initial perturbation's spectrum does to a periodic planet.
//
// On a periodic map a single-mode perturbation (icBand 0) is icMode copies of one box, held
// together only until the markers' sub-node jitter breaks the symmetry. This prints, for the
// pure mode and for the broadband draw at a few seeds: the distance from icMode-fold symmetry
// (max |T(x) - T(x + wrap/icMode)|), the plate count, the fastest plate and the Nusselt number.
//
// Run: node experiments/pt-band.js [times=50,150,300,600] [seeds=1,2,3]
'use strict';
var path = require('path');
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');

var times = (process.argv[2] || '50,150,300,600').split(',').map(Number);
var seeds = (process.argv[3] || '1,2,3').split(',').map(Number);

function run(band, seed) {
	P.ic = 'cool'; P.icMode = 4; P.icAmp = 0.02; P.icBand = band; P.icBandMax = 12; P.seed = seed;
	P.solid = true; P.sl.kyr = 50;
	SIM.init(); SIM.reset(); SIM.dt = 0.05;
	var M = SIM.M, nx = M.nx, sh = nx / P.icMode, k, j, i, d, v, drMax = 0, plMax = 0, line;
	for (k = 0; k < times.length; k++) {
		while (SIM.t < times[k]) {
			SIM.step();
			if (S.d.plV > drMax) drMax = S.d.plV;
			if (S.d.plates > plMax) plMax = S.d.plates;
		}
		d = 0;
		for (j = 1; j < M.ny; j++) for (i = 0; i < nx; i++) {
			v = Math.abs(S.Tg[j * nx + i] - S.Tg[j * nx + (i + sh) % nx]);
			if (v > d) d = v;
		}
		line = '  band ' + band.toFixed(1) + '  seed ' + seed + '  t ' + times[k] + '  asym ' + d.toFixed(3)
			+ '  plates ' + S.d.plates + ' (max ' + plMax + ')  drift ' + S.d.plV.toFixed(2)
			+ ' (max ' + drMax.toFixed(2) + ') cm/yr  lid ' + (S.d.lid * 100).toFixed(0) + '%  Nu ' + S.d.nu.toFixed(1)
			+ '  wells ' + S.d.wells;
		console.log(line);
	}
}

run(0, 1);
for (var s = 0; s < seeds.length; s++) run(0.6, seeds[s]);
