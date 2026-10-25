// pc-scenario.js — 0.5.0 M1's third gate, extended at M2 and M3 (0.5.0-plan.md §3.6, §9): the
// four scenarios run against an engine through one interface, and a gate's three states mean
// what they say.
//
// Two things are under test and only one of them is about the engines. First, the harness: a
// scenario must sample on its own cadence (S1's 41 samples from 100 to 300 Myr), reset with
// the seed it was given, apply its preset, and summarise the readings it collected. Second,
// honesty: a gate reads **pending with a reason** until its engine declares the feature —
// never pass. At M1 both engines were skeletons and all sixteen gates were pending; at M2
// HY declared flow and the thermal lid (S1); at M3 HY is complete and passes all twelve
// gates across S1-S4 (while SP's four scenarios still read pending until M4-M5). The fixture
// proves the other direction too by running a synthetic engine whose readings satisfy the
// gates and one whose readings do not, so a green line cannot come from a gate wired to nothing.
//
// Run: node experiments/pc-scenario.js
'use strict';

var PCOPT = require('../js/pc/opt.js');
var PCSCEN = require('../js/pc/scenario.js');
var HY = require('../js/hy/hy.js');
var SP = require('../js/sp/sp.js');
var check = require('./lib.js').check;

function count(gates, status) {
	var i, n = 0;
	for (i = 0; i < gates.length; i++) if (gates[i].status === status) n++;
	return n;
}

// A synthetic engine: the interface pc/scenario.js documents, with the readings a finished
// engine would have. `cfg.reading` decides the numbers, and returning undefined for a reading
// is how a fixture asks for a pending gate.
function fake(id, cfg) {
	var F = {
		id: id, complete: true,
		features: cfg.features || { flow: 1, lid: 1, melt: 1, erupt: 1, unload: 1 },
		opts: PCOPT.make(cfg.engine || 'sp'),
		S: { time: 0, frame: 0 },
		seed: null, tool: null, camera: null, presetApplied: null,
		clock: function () { return this.opts.get('clock'); },
		reset: function (seed) { this.seed = seed; this.S.time = 0; this.S.frame = 0; },
		step: function () { this.S.time += this.clock() / 1000; this.S.frame++; },
		read: function (key) {
			if (key === 'time') return this.S.time;
			if (key === 'frame') return this.S.frame;
			if (key === 'kyr') return this.clock();
			return cfg.reading ? cfg.reading(key, this) : undefined;
		},
		applyPreset: function (p) { this.presetApplied = p; this.opts.set('clock', p.clock); },
		setOption: function (id, v) { this.opts.set(id, v, true); },
		setCamera: function (c) { this.camera = c; },
		setTool: function (t) { this.tool = t; }
	};
	return F;
}

var GOOD = {
	S1: { peakV: 71.66, wells: 6, cells: 5, lidMobility: 0.1, interiorMobility: 0.5 },
	S2: { meltInWindow: 0.3, meltOutsideWindow: 0, meltEquilibriumGap: 0, peakV: 70 },
	S3: { ventEpisodes: 2, airMass: 10, depositMass: 6, weldMass: 4, peakV: 70 },
	S4: { solidusDrop: 0.05, meltMass: 8, load: 100, pulseGap: 0 }
};

function goodReading(id) {
	return function (key, engine) {
		var v = GOOD[id][key];
		// S4's mechanism: a pulse under the load solidus, nothing at all under the depth
		// branch — which is exactly the negative control the plan asks for
		if (key === 'meltMass' && id === 'S4') {
			if (engine.opts.get('solidusOf') === 'depth') return 0;
			return Math.max(0, 8 - 2 * engine.S.time);
		}
		return v;
	};
}

check.section('A. gates are pending until their feature exists — and pass once it does');
// HY at M3: both the liquid (M2) and the crust (M3) exist, so all four scenarios run for
// real and pass every gate, and each reports complete === true. S1 and S3 run at the 500 kyr
// clock here (their full 50 kyr legs run in hy-conv.js and hy-erupt.js); S4 runs both its
// depth-solidus negative control and its load-solidus leg. SP is still a skeleton, so all
// four of its scenarios stay pending cheaply.
HY.init();
var hyS4Ctrl = PCSCEN.run(HY, 'S4', { seed: 1, options: { solidusOf: 'depth' } });
PCSCEN.ids.forEach(function (id) {
	var opts = { seed: 1 };
	if (id === 'S1' || id === 'S3') opts.options = { clock: 500 };
	if (id === 'S4') opts.control = hyS4Ctrl.summary.pulsePeak;
	var r = PCSCEN.run(HY, id, opts);
	check.ok('hy ' + id + ' (' + r.title + '): all ' + r.gates.length + ' gates pass',
		r.passed === r.gates.length && r.failed === 0 && r.pending === 0,
		r.gates.map(function (g) { return g.status + ' ' + g.detail; }).join(' | '));
	check.ok('hy ' + id + ' reports itself complete at M3', r.complete === true);
});
SP.init();
PCSCEN.ids.forEach(function (id) {
	var r = PCSCEN.run(SP, id, { seed: 3 });
	check.ok('sp ' + id + ' (' + r.title + '): all gates pending, none passed',
		r.gates.length > 0 && count(r.gates, 'pending') === r.gates.length &&
		r.passed === 0 && r.failed === 0,
		r.gates.map(function (g) { return g.status; }).join(','));
	check.ok('sp ' + id + ' says why it is pending',
		r.gates.every(function (g) { return /no .* yet|no reading/.test(g.detail); }),
		r.gates[0].detail);
	check.ok('sp ' + id + ' reports itself incomplete', r.complete === false);
});

check.section('B. the sampler: cadence, seed, preset and the clock');
var e = fake('sp', { reading: goodReading('S1') });
var r = PCSCEN.run(e, 'S1', { seed: 7 });
check.ok('S1 samples once every 5 Myr from 100 to 300', r.samples.length === 41,
	r.samples.length + ' samples');
check.ok('the first sample is at 100 Myr and the last at 300',
	Math.abs(r.samples[0].myr - 100) < 1e-9 &&
	Math.abs(r.samples[r.samples.length - 1].myr - 300) < 1e-9,
	r.samples[0].myr + ' .. ' + r.samples[r.samples.length - 1].myr);
check.ok('the run resets with the seed it was given', e.seed === 7);
check.ok('the run applied the S1 preset', e.presetApplied === PCSCEN.preset('S1'));
check.ok('a 50 kyr clock over 300 Myr is 6,000 frames', r.frames === 6000, r.frames);
check.ok('the summary is the median of the samples', r.summary.peakV === 71.66 &&
	r.summary.wells === 6, r.summary.peakV + ' km/Myr, ' + r.summary.wells + ' wells');

var slow = fake('sp', { reading: goodReading('S1') });
var r2 = PCSCEN.run(slow, 'S1', { seed: 1, options: { clock: 500 } });
check.ok('a 500 kyr clock needs a tenth of the frames and hits the same samples',
	r2.frames === 600 && r2.samples.length === 41, r2.frames + ' frames, ' +
	r2.samples.length + ' samples');

var again = PCSCEN.run(fake('sp', { reading: goodReading('S1') }), 'S1', { seed: 7 });
check.ok('a replay with the same seed and reading is identical',
	JSON.stringify(again.samples) === JSON.stringify(r.samples));

check.section('C. a satisfied scenario passes, and a different one fails');
var s1 = PCSCEN.run(fake('sp', { reading: goodReading('S1') }), 'S1', {});
check.ok('S1 passes on the M0 leg\'s own numbers', s1.failed === 0 && s1.pending === 0 &&
	s1.passed === 3, s1.gates.map(function (g) { return g.status; }).join(','));

var hot = PCSCEN.run(fake('sp', {
	reading: function (key) {
		if (key === 'peakV') return 498.08;
		if (key === 'wells') return 9;
		if (key === 'lidMobility') return 0.4;
		if (key === 'interiorMobility') return 0.5;
		return undefined;
	}
}), 'S1', {});
check.ok('S1 fails on the contact control\'s own numbers (498 km/Myr, nine wells, no lid)',
	hot.failed === 3 && hot.passed === 0, hot.gates.map(function (g) {
		return g.status + ': ' + g.detail;
	}).join(' | '));

var s4 = PCSCEN.run(fake('sp', { reading: goodReading('S4') }), 'S4', {});
check.ok('S4 passes when the pulse is there, early and decaying', s4.passed === 3,
	s4.gates.map(function (g) { return g.status + ': ' + g.detail; }).join(' | '));

// the control is its own run: the same unload, read through `solidusOf: 'depth'`
var control = PCSCEN.run(fake('sp', { reading: goodReading('S4') }), 'S4',
	{ options: { solidusOf: 'depth' } });
check.ok('the depth-mode twin makes no pulse at all', control.summary.pulsePeak === 0,
	'peak ' + control.summary.pulsePeak);
var s4c = PCSCEN.run(fake('sp', { reading: goodReading('S4') }), 'S4',
	{ control: control.summary.pulsePeak });
check.ok('S4 passes with its own depth-mode twin as the negative control',
	s4c.failed === 0 && s4c.gates.filter(function (g) { return g.status === 'pass'; }).length === 4,
	s4c.gates.map(function (g) { return g.status; }).join(','));
var s4bad = PCSCEN.run(fake('sp', { reading: goodReading('S4') }), 'S4', { control: 3 });
check.ok('and fails when the depth branch does make one',
	count(s4bad.gates, 'fail') === 1, s4bad.gates[3].detail);

check.section('D. a missing reading is pending, not a pass');
var noWells = PCSCEN.run(fake('sp', {
	reading: function (key) {
		if (key === 'wells') return undefined;
		return GOOD.S1[key];
	}
}), 'S1', {});
check.ok('a gate whose reading the engine does not report is pending',
	noWells.passed === 2 && noWells.pending === 1, noWells.gates[1].status + ': ' +
	noWells.gates[1].detail);

var unknown = PCSCEN.run(fake('hy', { reading: goodReading('S1') }), 'S1', {});
check.ok('an engine that declares no feature cannot pass a gate that needs one',
	(function () {
		var f = fake('hy', { features: {}, reading: goodReading('S1') });
		var rr = PCSCEN.run(f, 'S1', {});
		return rr.pending === 3 && rr.passed === 0;
	}()));

check.section('E. the preset reaches the page the same way it reaches the harness');
var live = PCOPT.make('sp');
var holder = { camera: null, tool: null, setCamera: function (c) { this.camera = c; },
	setTool: function (t) { this.tool = t; } };
var applied = PCSCEN.apply('S4', live, holder);
check.ok('S4 sets the clock, the scenario and the unload tool',
	live.get('clock') === 50 && live.get('scenario') === 'S4' && holder.tool === 'unload' &&
	holder.camera === 'lid', JSON.stringify(applied));
check.ok('S2 zooms the lid and turns the melt overlay on',
	(function () {
		var o = PCOPT.make('sp');
		PCSCEN.apply('S2', o, holder);
		return holder.camera === 'lid' && o.get('melt') === true;
	}()));

check.done();
