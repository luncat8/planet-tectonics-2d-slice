// view-check.js — verifies js/geom.js + the state layout against the design
// §1.2/§1.3/§1.4 tables (section C/E numbers of scale-check.js).
// Run: node experiments/view-check.js
'use strict';

var P = require('../js/params.js');
var GEO = require('../js/geom.js');
var S = require('../js/state.js');

var fails = 0;
function check(name, got, want, tol) {
	var ok = Math.abs(got - want) <= tol;
	if (!ok) fails++;
	console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '   got ' + got + '   want ' + want);
}

// --- row schedule (design §1.2 table, N = 64) ---
check('q', GEO.q, 1.18748, 5e-5);
check('hTop[N] = R', GEO.hTop[64], P.R, 1);
check('row 0 = h0 (20 m)', GEO.hTop[1] - GEO.hTop[0], 20, 0.01);
check('bottom row 1006 km', P.R - GEO.hTop[63], 1006e3, 1e3);
check('skyN 34', GEO.skyN, 34, 0);
var crust = 0;
while (GEO.hTop[crust + 1] <= 35e3) crust++;
check('crust rows 33', crust, 33, 0);
var fine = 0, fineD = 0;
while (20 * Math.pow(GEO.q, fine) <= 100) { fineD += 20 * Math.pow(GEO.q, fine); fine++; }
check('fine rows 10', fine, 10, 0);
check('fine cover 488 m', fineD, 488, 2);

// --- fan (design §1.3) ---
check('fanCells 7186', GEO.fanOff[64], 7186, 0);
check('band 0 = 512 cells', GEO.fanN[0], 512, 0);
check('bottom row 2 cells', GEO.fanN[63], 2, 0);

// --- default window (design §1.4 / scale-check C) ---
var v = { cx: 0, kx: 3000e3 / 1280, uT: GEO.u(33e3), uB: GEO.u(-300e3) };
GEO.rebuild(v);
check('kx 2.34375 km/px', GEO.kx / 1e3, 2.34375, 1e-9);
check('247 m/px at y=0', P.yLin * GEO.duPx, 247, 2);
check('499 m/px at y=-70 km', Math.sqrt(P.yLin * P.yLin + 70e3 * 70e3) * GEO.duPx, 499, 3);
check('1.26 km/px at y=-200 km', Math.sqrt(P.yLin * P.yLin + 200e3 * 200e3) * GEO.duPx / 1e3, 1.26, 0.01);
check('lutY top +33 km (row center)', GEO.lutY[0] / 1e3, 33, 1.0);
check('lutY bottom -300 km (row center)', GEO.lutY[P.ch - 1] / 1e3, -300, 1.0);
check('window edges exact', Math.abs(GEO.y(GEO.uB) + 300e3) + Math.abs(GEO.y(GEO.uT) - 33e3), 0, 1e-6);
check('cone 17.1 px wide', 40e3 / GEO.kx, 17.1, 0.05);
check('cone 16.1 px tall', (GEO.u(6e3) - GEO.u(2e3)) / GEO.duPx, 16.1, 0.05);
check('50 m bed 0.20 px at x1', (GEO.u(-5e3 + 50) - GEO.u(-5e3)) / GEO.duPx, 0.20, 0.005);
check('50 m bed 2.0 px at x10', (GEO.u(-5e3 + 50) - GEO.u(-5e3)) / (GEO.duPx / 10), 2.0, 0.02);

// --- overview: default horizontal + full depth (design §1.4 zoom note) ---
var ov = { cx: 0, kx: 3000e3 / 1280, uT: GEO.u(P.skyTop), uB: GEO.u(-P.R) };
GEO.rebuild(ov);
check('ovw 465 m/px at 0', P.yLin * GEO.duPx, 465, 3);
check('ovw 74 km/px at center', P.R * GEO.duPx / 1e3, 74, 1);
check('ovw cone 17.1 px wide', 40e3 / GEO.kx, 17.1, 0.05);
check('ovw cone 8.5 px tall', (GEO.u(6e3) - GEO.u(2e3)) / GEO.duPx, 8.5, 0.1);

// --- LUT monotonicity (display map must be one-to-one) ---
var mono = true, r;
for (r = 1; r < P.ch; r++) if (GEO.lutY[r] >= GEO.lutY[r - 1]) { mono = false; break; }
check('lutY strictly decreasing top->down', mono ? 1 : 0, 1, 0);

// --- the state layout matches the grid (design §2, §2.4) ---
check('fan T sized', S.Tf.length, GEO.fanOff[64], 0);
check('layer storage sized', S.layTh.length, P.colCap * P.layerCap, 0);

console.log(fails ? 'FAIL (' + fails + ')' : 'PASS (all)');
process.exit(fails ? 1 : 0);
