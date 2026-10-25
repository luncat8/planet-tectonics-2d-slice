// hy-bench.js — 0.5.0 M2's cost owner (0.5.0-plan.md §8, §10): the integrated HY frame
// at the default rung against the plan's <= 8 ms target, where the sweep budget goes,
// what the sharpness option costs, and the 512x48 ladder row. Kernel-only numbers from
// M0's bank are not reused here: every row below times the shipped engine's own step().
//
// Run: node experiments/hy-bench.js
'use strict';

var HY = require('../js/hy/hy.js');
var check = require('./lib.js').check;

function timeFrames(frames) {
	var t0 = process.hrtime.bigint(), i;
	for (i = 0; i < frames; i++) HY.step();
	return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
}

HY.init();

check.section('A. the default rung, integrated');
HY.reset(1);
timeFrames(100);                       // warm: spin-up sweeps are not the steady cost
var ms = timeFrames(300);
check.ok('256x24 integrated frame is inside the 8 ms target', ms < 8,
	ms.toFixed(2) + ' ms/frame (flow + transport + equil + diag, no draw)');
check.ok('the timed state is a convecting one', HY.M.d.peakV > 10,
	'peak ' + HY.M.d.peakV.toFixed(1) + ' km/Myr, k ' + HY.read('substeps'));

check.section('B. where the frame goes');
var t0 = process.hrtime.bigint(), i;
for (i = 0; i < 300; i++) { HY.equil(); HY.flow(); }
var msFlow = Number(process.hrtime.bigint() - t0) / 1e6 / 300;
t0 = process.hrtime.bigint();
for (i = 0; i < 300; i++) HY.transport(0.05);
var msTr = Number(process.hrtime.bigint() - t0) / 1e6 / 300;
check.info('equil + flow', msFlow.toFixed(2) + ' ms of ' + ms.toFixed(2));
check.info('transport (advect + conduct + equil per substep)', msTr.toFixed(2) + ' ms');
check.ok('the flow solve is the frame\'s centre of mass', msFlow > msTr,
	'flow ' + msFlow.toFixed(2) + ' vs transport ' + msTr.toFixed(2));

check.section('C. the sweep budget and the sharpness option, priced');
[8, 40].forEach(function (sw) {
	HY.reset(1);
	HY.setOption('projIters', sw);
	timeFrames(20);
	check.info('projIters ' + sw, timeFrames(150).toFixed(2) + ' ms/frame');
});
HY.setOption('projIters', HY.opts.def('projIters'));
HY.reset(1);
HY.setOption('advect', 'maccormack');
timeFrames(20);
check.info('maccormack transport', timeFrames(150).toFixed(2) + ' ms/frame vs donor ' +
	ms.toFixed(2));
HY.setOption('advect', 'donor');

check.section('D. the ladder row: 512x48');
HY.defaults.nx = 512; HY.defaults.ny = 48;
HY.reset(1);
timeFrames(20);
var msBig = timeFrames(60);
check.ok('512x48 integrated frame is inside the 16 ms row', msBig < 16,
	msBig.toFixed(2) + ' ms/frame at ' + HY.read('cells') + ' cells');
check.ok('the big rung convects and stays bounded',
	HY.M.d.peakV > 1 && HY.M.d.tMax < 1.05, 'peak ' + HY.M.d.peakV.toFixed(1));
HY.defaults.nx = 256; HY.defaults.ny = 24;
HY.reset(1);
check.ok('the default rung is restored', HY.read('cells') === 6144);

check.done();
