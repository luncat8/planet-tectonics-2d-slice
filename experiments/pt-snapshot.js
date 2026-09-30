// pt-snapshot.js — headless look at the particle engine's section view: runs the real
// pipeline in node and paints the real raster (render.js, headless core) into PNGs at the
// requested geologic times. For eyeballing a change without a browser.
//
// Run: node experiments/pt-snapshot.js [tMyr,tMyr,...=100] [out=experiments/logs/pt-snap]
//      [kyrPerFrame=50] [view=mantle|lid] [ic=cool|rb|blob|hot]
// Writes out-<t>Myr.png for each requested time (one continuous run).
'use strict';
var path = require('path');
var png = require('./png.js');
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), R = require(B + 'render.js');

var times = (process.argv[2] || '100').split(',').map(Number);
var out = process.argv[3] || path.join(__dirname, 'logs', 'pt-snap');
var kyr = +(process.argv[4] || 50);
var view = process.argv[5] || 'mantle';
var ic = process.argv[6] || P.ic;

P.ic = ic;
P.sl.kyr = kyr;
SIM.init();
SIM.reset();
SIM.dt = kyr / 1000;
var W = P.cw, H = P.ch;
R.initHeadless(W, H, SIM.M);
R.preset(view, SIM.M);

times.sort(function (a, b) { return a - b; });
var t0 = Date.now(), k = 0;
for (var i = 0; i < times.length; i++) {
	while (SIM.t < times[i]) SIM.step();
	R.raster(SIM.M, S, R.px, W, H);
	R.stipple(SIM.M, S, R.px, W, H);
	var file = out + '-' + times[i] + 'Myr.png';
	png.write(file, W, H, R.px);
	console.log(file + '   t ' + SIM.t.toFixed(1) + ' Myr   lid ' + (S.d.lid * 100).toFixed(0)
		+ '%   plates ' + S.d.plates + '   drift ' + S.d.plV.toFixed(1) + ' cm/yr   Nu '
		+ S.d.nu.toFixed(1) + '   wells ' + S.d.wells + '   empty ' + S.empty + '   redeals ' + S.redeals);
	k++;
}
console.log('total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s for ' + SIM.frame + ' frames');
