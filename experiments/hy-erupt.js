// hy-erupt.js — 0.5.0 M3 gate (0.5.0-plan.md §4.6, §4.7, §7 M3, §9.1): H6 vent
// scheduling, wall-clock ballistic flight (`flightDtMax`, geological pause), landing,
// deposit cooling/welding, H7 pile-top relief (`M.zh`), and S3 eruption over 300 Myr.
//
// Run: node experiments/hy-erupt.js
'use strict';

var PCP = require('../js/pc/params.js');
var PHASE = require('../js/pc/phase.js');
var PCSCEN = require('../js/pc/scenario.js');
var HY = require('../js/hy/hy.js');
var check = require('./lib.js').check;

check.section('A. S3 eruption through the scenario interface, 300 Myr at 50 kyr/frame');
var s3 = PCSCEN.run(HY, 'S3', { seed: 1 });
for (var g = 0; g < s3.gates.length; g++) {
	check.ok('S3 ' + s3.gates[g].name, s3.gates[g].status === 'pass', s3.gates[g].detail);
}
check.ok('S3 has no failing or pending gate', s3.passed === 2 && s3.failed === 0 && s3.pending === 0,
	s3.passed + ' passed');
var maxSampleChainGap = 0;
for (var i = 0; i < s3.samples.length; i++) {
	var smp = s3.samples[i];
	var cg = Math.abs(smp.airMass - smp.depositMass - smp.weldMass);
	if (cg > maxSampleChainGap) maxSampleChainGap = cg;
}
check.ok('the eruption chain airMass == depositMass + weldMass closes at every 5 Myr sample',
	maxSampleChainGap <= 1e-9,
	'max sample chain gap ' + maxSampleChainGap.toExponential(2));
check.ok('H7 pileTop develops positive edifice relief and negative trench relief over the leg',
	HY.M.d.zhMax > 0.2 && HY.M.d.zhMin < -0.2,
	'zh ' + HY.M.d.zhMin.toFixed(2) + ' .. +' + HY.M.d.zhMax.toFixed(2) + ' km');

check.section('B. H6 vent scheduling: intact roof seals magma; damaged roof opens a conduit');
HY.reset(1);
var M = HY.M, S = HY.S, col = 128, kMelt = 4 * M.nx + col;
// Give column 128 a rich shallow melt pocket while keeping the skin undamaged (roofCap = 1.0)
M.H[kMelt] = 1.30;
HY.scatter(); HY.equil();
HY.emitVents(0.05);
check.ok('an intact, undamaged crust skin (roofCap = 1) seals a shallow melt pocket',
	M.roofCap[col] > HY.cfg.ventRoofMax && M.ventEpisodes === 0 && HY.airCount() === 0,
	'roofCap ' + M.roofCap[col].toFixed(2) + ', vents ' + M.ventEpisodes);

// Now damage the crust parcels above column 128 as a rift seam does
for (var p = 0; p < S.n; p++) {
	if (HY.colOfX(S.x[p]) === col) S.dmg[p] = 0.85;
}
HY.scatter(); HY.equil();
HY.emitVents(0.05);
check.ok('damaging the roof over the melt pocket opens the conduit and launches a clast',
	M.roofCap[col] < 0.3 && M.vOpen[col] === 1 && M.ventEpisodes === 1 && HY.airCount() === 1,
	'roofCap ' + M.roofCap[col].toFixed(2) + ', vents ' + M.ventEpisodes + ', air ' + HY.airCount());

check.section('C. ballistic flight on the wall clock: flightDtMax clamp, blast vs effusive, pause');
HY.reset(1);
M = HY.M; S = HY.S;
var kEff = 5 * M.nx + 40, kBlast = 5 * M.nx + 80;
M.cW[kEff] = 0.002;
M.cW[kBlast] = 0.025;
var pEff = HY.launchClast(40, kEff, 20);
var pBlast = HY.launchClast(80, kBlast, 20);
check.ok('blast clasts (cW > wBlast) launch faster than effusive clasts',
	pEff >= 0 && pBlast >= 0 && Math.abs(S.vy[pBlast]) > Math.abs(S.vy[pEff]) &&
	Math.abs(S.vy[pEff]) >= 0.9 * HY.cfg.flightVyEff &&
	Math.abs(S.vy[pBlast]) >= 0.9 * HY.cfg.flightVyBlast,
	'vyEff ' + S.vy[pEff].toFixed(2) + ' vs vyBlast ' + S.vy[pBlast].toFixed(2));

// Test flightDtMax clamp: passing wallDt = 1.0 s advances by at most PCP.flightDtMax (0.05 s)
var vy0 = S.vy[pEff];
HY.advanceFlight(1.0);
var expectedVy = vy0 + HY.cfg.flightG * PCP.flightDtMax;
check.ok('advanceFlight clamps wallDt to PCP.flightDtMax (0.05 s)',
	Math.abs(S.vy[pEff] - expectedVy) <= 1e-12,
	'vy after 1.0s call: ' + S.vy[pEff].toFixed(3) + ' (expected ' + expectedVy.toFixed(3) + ')');

// Pause the geological clock (`paused = true`) and step wall frames at 60 Hz until both clasts land
var tGeo0 = HY.read('time'), frames60 = 0;
while (HY.airCount() > 0 && frames60 < 160) {
	HY.step(1 / 60, true);
	frames60++;
}
check.ok('stepping while geologically paused lands airborne clasts in 0.5-1.5 s without advancing Myr',
	HY.airCount() === 0 && HY.read('time') === tGeo0 && frames60 >= 30 && frames60 <= 95,
	frames60 + ' wall frames (' + (frames60 / 60).toFixed(2) + ' s), Myr ' + HY.read('time'));

check.section('D. landing -> deposit cooling (booked to wallTop) -> welding into crust');
HY.scatter(); HY.pileTop(); HY.equil(); HY.diag();
var depM0 = HY.read('depositMass');
var zh40 = M.zh[40], zh80 = M.zh[80];
check.ok('landed clasts enter PH.dep and raise local pile-top elevation zh',
	depM0 === 40 && zh40 > 0 && zh80 > 0,
	'depositMass ' + depM0 + ', zh[40] +' + zh40.toFixed(3) + ' km');

// Step geological time via transactions + crust settling so the deposit cools and welds into PH.crust
var wallTop0 = M.wallTop;
for (var step = 0; step < 300; step++) {
	HY.crust(0.05);
	HY.transactions(0.05);
}
HY.scatter(); HY.pileTop(); HY.equil(); HY.diag();
var heatRel = Math.abs((HY.read('enthalpy') - HY.read('stock0')) -
	(HY.read('wallNet') + HY.read('clampNet'))) / HY.read('stock0');
check.ok('shallow deposit cooling is booked to wallTop and welds cooled deposits into PH.crust',
	M.wallTop > wallTop0 && HY.read('depositMass') === 0 && HY.read('weldMass') === 40 &&
	heatRel <= 1e-14,
	'weldMass ' + HY.read('weldMass') + ', dWallTop ' + (M.wallTop - wallTop0).toFixed(2) +
	', heat residual/stock0 ' + heatRel.toExponential(2));

check.done();
