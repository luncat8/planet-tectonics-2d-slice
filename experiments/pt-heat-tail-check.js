// Validate the experiment bank without re-running the expensive cells.
// node experiments/pt-heat-tail-check.js
'use strict';
var fs = require('fs'), path = require('path'), assert = require('assert');
var root = path.join(__dirname, 'logs/0.3.2-tail-');
function read(name) { return JSON.parse(fs.readFileSync(root + name + '.json', 'utf8')); }
var baseline = read('baseline'), repeat = read('baseline-repeat');
assert.strictEqual(baseline.fingerprint, 8261233554728015);
assert.strictEqual(repeat.fingerprint, baseline.fingerprint);
assert.deepStrictEqual(repeat.events, baseline.events);
assert.strictEqual(baseline.depTx, 3);
assert(Math.abs(baseline.depMelt - 9.73015809837463) < 1e-12);
assert.deepStrictEqual(baseline.events.map(function (e) { return e.frame; }), [9341, 10157, 10660]);
assert.deepStrictEqual(baseline.events.map(function (e) { return e.id; }), [42152, 165372, 194306]);
['mass', 'enthalpy', 'latent', 'intakeWallWorst', 'heldSamples', 'heldMassTime', 'heldMeltTime',
	'heldGapMax', 'mantleRoutes', 'depMelt', 'depTx', 'refuse'].forEach(function (key) {
	assert.strictEqual(repeat[key], baseline[key], key + ' replay');
});
assert.deepStrictEqual(repeat.minT, baseline.minT);
assert.deepStrictEqual(repeat.maxT, baseline.maxT);
assert.deepStrictEqual(repeat.outsideSamples, baseline.outsideSamples);
console.log('PASS baseline fingerprint, individual transfers and untimed diagnostics replay exactly');
console.log('candidate       wall worst   ms/frame   dep T range       held km2 Myr  tx    melt km2   exact old events  decision');
['baseline', 'cap2', 'floor001', 'relax999', 'minimum1', 'spread15', 'baseline-repeat'].forEach(function (name) {
	var r = read(name);
	assert.strictEqual(r.frames, 12000);
	assert.strictEqual(r.seed, 5); assert.strictEqual(r.kyr, 50); assert.strictEqual(r.myr, 600);
	assert.strictEqual(r.refuse, 0);
	assert.strictEqual(r.events.length, r.depTx);
	assert(Math.abs(r.events.reduce(function (sum, e) { return sum + e.melt; }, 0) - r.depMelt) < 1e-9);
	assert(r.events.every(function (e) { return e.field >= e.solidus; }));
	assert(r.gates.mass && r.gates.enthalpy);
	assert.strictEqual(r.gates.intakeWallP4, r.intakeWallWorst < 0.01);
	assert.strictEqual(r.gates.frame, r.msFrame < 20);
	assert.strictEqual(r.gates.temperature, !r.nonfinite && r.outsideSamples.every(function (n) { return n === 0; }));
	var matched = baseline.events.filter(function (e) {
		return r.events.some(function (other) { return JSON.stringify(e) === JSON.stringify(other); });
	}).length;
	var accepted = r.gates.mass && r.gates.enthalpy && r.gates.latent && r.gates.intakeWallP4
		&& r.gates.frame && r.gates.temperature && matched === 3 && r.heldMassTime === 0;
	console.log(name.padEnd(16) + r.intakeWallWorst.toExponential(3).padEnd(13)
		+ r.msFrame.toFixed(2).padEnd(11) + (r.minT[3].toFixed(3) + '..' + r.maxT[3].toFixed(3)).padEnd(18)
		+ r.heldMassTime.toFixed(2).padEnd(14) + String(r.depTx).padEnd(6) + r.depMelt.toFixed(6).padEnd(11)
		+ String(matched).padEnd(18) + (accepted ? 'eligible for wider acceptance' : 'NOT ACCEPTED'));
	if (name === 'spread15') {
		assert(r.spreadCapped > 0, 'the redistribution probe never capped a parcel');
		console.log('  spread: ' + r.spreadCapped + ' parcel deliveries capped, ' + r.spreadGiven
			+ ' bucket absorptions, ' + r.spreadGiveback + ' infeasible givebacks on '
			+ r.spreadShortN + ' short nodes, ' + r.spreadShortH.toFixed(6) + ' km2*H returned');
	}
});
console.log('PASS seven complete cells; events reconcile to actual transfers, field support and global books');

// The M2 re-measurement on the re-banked cell (launch/air remedy in). The re-banked baseline must
// reproduce the M0 bank's every grid-coupled reading bitwise -- the remedy touched airborne melt
// only -- while its latent identity closes; the tail rows are then read against it. Refusals
// are reported here, not asserted zero: one probe saturates the pool, and that is its outcome.
var m2 = read('m2-baseline');
assert.strictEqual(m2.fingerprint, 6191250240167390);
assert.deepStrictEqual(m2.events, baseline.events, 'protected events moved under the launch remedy');
['heldSamples', 'heldMassTime', 'heldMeltTime', 'heldGapMax', 'mantleRoutes', 'depMelt', 'depTx',
	'intakeWallWorst', 'mass', 'enthalpy', 'refuse'].forEach(function (key) {
	assert.strictEqual(m2[key], baseline[key], key + ' moved under the launch remedy');
});
assert.deepStrictEqual([m2.minT, m2.maxT, m2.outsideSamples], [baseline.minT, baseline.maxT, baseline.outsideSamples]);
assert(m2.latentAbsMax < 1e-7 && m2.latentBook < 1e-10, 'the re-banked latent identity is not closed');
console.log('PASS M2 re-bank 6191250240167390: every grid-coupled reading and all three protected events equal the M0 bank bitwise; latent '
	+ m2.latentAbsMax.toExponential(2) + ' km2*H, ' + m2.latentBook.toExponential(2) + ' of its books (M0 bank: '
	+ baseline.latent.toExponential(2) + ' relative)');
// a transfer whose host is already below 1e-3 km2 is a residue re-split toward vanishing mass:
// the degenerate route the plan rejects, counted beside the transfers
console.log('M2 row             wall worst   R/wall      dep T range       mantle out  held km2 Myr  tx    bleed  melt km2     refusals  same-id  decision');
['m2-baseline', 'm2-stencil15', 'm2-subgrid1-dep', 'm2-subgrid1-solid', 'm2-relaxw1-dep'].forEach(function (name) {
	var r = read(name);
	assert.strictEqual(r.frames, 12000);
	assert.strictEqual(r.seed, 5); assert.strictEqual(r.kyr, 50); assert.strictEqual(r.myr, 600);
	assert(r.gates.mass && r.gates.enthalpy, name + ' books');
	assert(Math.abs(r.depositBook) < 1e-6 && Math.abs(r.meltBook) < 1e-6, name + ' deposit/melt books');
	assert(r.latentAbsMax === undefined ? r.latentWorstAbs < 1e-7 : r.latentAbsMax < 1e-7, name + ' latent identity');
	assert.strictEqual(r.gates.intakeWallP4, r.intakeWallWorst < 0.01);
	var sameId = baseline.events.filter(function (e) {
		return r.events.some(function (other) { return other.id === e.id; });
	}).length;
	var bleed = r.events.filter(function (e) { return e.host < 1e-3; }).length;
	var accepted = r.gates.intakeWallP4 && r.gates.temperature && r.refuse === 0 && sameId === 3
		&& r.heldMassTime === 0 && bleed === 0;
	console.log(name.padEnd(19) + r.intakeWallWorst.toExponential(3).padEnd(13)
		+ (r.relaxSourceOverWall || 0).toExponential(2).padEnd(12)
		+ (r.minT[3].toFixed(3) + '..' + r.maxT[3].toFixed(3)).padEnd(18) + String(r.outsideSamples[0]).padEnd(12)
		+ r.heldMassTime.toFixed(2).padEnd(14) + String(r.depTx).padEnd(6) + String(bleed).padEnd(7) + r.depMelt.toFixed(6).padEnd(13)
		+ String(r.refuse).padEnd(10) + String(sameId).padEnd(9) + (accepted ? 'eligible for wider acceptance' : 'NOT ACCEPTED'));
	if (name === 'm2-stencil15') {
		assert(r.spreadCapped > 0, 'the stencil probe never capped a parcel');
		console.log('  stencil: ' + r.spreadCapped + ' capped, ' + r.spreadGiven + ' absorptions, ' + r.spreadGiveback
			+ ' infeasible givebacks on ' + r.spreadShortN + ' short nodes; hottest deposit T '
			+ r.hottest.T.toFixed(3) + ' in a field of ' + r.hottest.field.toFixed(3) + ' at ' + r.hottest.y.toFixed(1) + ' km');
	}
	if (r.relaxGross) {
		console.log('  relax (' + r.kind + ', scope ' + r.scope + '): gross exchange ' + r.relaxGross.toExponential(3)
			+ ' km2*H, booked net ' + r.relaxSource.toExponential(3) + ', smallest routed host '
			+ Math.min.apply(null, r.events.map(function (e) { return e.host; })).toExponential(2) + ' km2');
	}
});
console.log('PASS M2 rows; every row closes mass, enthalpy, deposit, melt and latent books on every frame');
console.log('Candidate rejections are measurement outcomes, not a failing measurement harness.');

// 0.3.2 M3: the depletion channels and the two faces, read from the banks the report quotes.
// Every number archive/0.3.2-M3-depletion-report.md states is asserted here against its own
// bank, so the report cannot drift from the evidence and a pruned bank fails loudly instead of
// silently. Banks are one per world: each row's fingerprint is exact, and rows that share a
// world (batch/timed/watch re-runs) were pruned to the survivor named here.
var root3 = path.join(__dirname, 'logs/0.3.2-M3-');
function read3(name) { return JSON.parse(fs.readFileSync(root3 + name + '.json', 'utf8')); }
function near(a, b, tol, what) { assert(Math.abs(a - b) <= (tol || 1e-12) * Math.max(1, Math.abs(b)), what + ': ' + a + ' vs ' + b); }
function bleedOf(r) { return r.events.filter(function (e) { return e.host < 1e-3; }).length; }
// every M3 row: the books, the wall and the refusals hold on every frame whatever the probe did
var M3ROWS = [
	['baseline600-final2', 'control bank cell', 6191250240167390],
	['baseline600-watch', 'control bank cell, watch tables', 6191250240167390],
	['baseline-dpart01', 'bank cell + --dpart 0.01', 3883078751638937],
	['baseline-cap25', 'bank cell + --cap 0.25', 6180919500229157],
	['timed-subgrid1dep-watch', 'sub-grid control (serial)', 3546678272699960],
	['subgrid1dep-comp', 'sub-grid control, cF/cW events', 3546678272699960],
	['timed-subgrid1dep-dpart01-watch', 'sub-grid + --dpart 0.01 (serial)', 7597164752167614],
	['timed-subgrid1dep-dpart02-watch', 'sub-grid + --dpart 0.2 (serial)', 8062761652553677],
	['timed-subgrid1dep-cap25-watch', 'sub-grid + --cap 0.25 (serial)', 1369981785435233],
	['timed-subgrid1dep-dpart01-cap25-watch', 'sub-grid + both (serial)', 1596370252976586]
];
M3ROWS.forEach(function (row) {
	var r = read3(row[0]);
	assert.strictEqual(r.fingerprint, row[2], row[1] + ' fingerprint');
	assert.strictEqual(r.seed, 5); assert.strictEqual(r.kyr, 50); assert.strictEqual(r.myr, 600);
	assert.strictEqual(r.frames, 12000);
	assert(r.mass < 1e-9 && r.enthalpy < 1e-9, row[1] + ' books');
	// the plan's gate is the identity relative to the books it is the difference of; the absolute
	// residual is printed in the table below, where the --cap rows read 1.3e-7 km2*H against the
	// control's 6.4e-8 -- round-off on a ~4e7 km2*H pool either way, 6.19e-13 of its books
	assert(r.latentBook < 1e-10, row[1] + ' latent identity');
	assert(r.latentAbsMax < 1e-6, row[1] + ' latent residual');
	assert(Math.abs(r.depositBook) < 1e-6 && Math.abs(r.meltBook) < 1e-6, row[1] + ' deposit/melt books');
	assert.strictEqual(r.refuse, 0, row[1] + ' refusals');
	assert(r.intakeWallWorst < 0.01, row[1] + ' wall (P4 gate)');
	assert.strictEqual(r.gates.intakeWallP4, true);
	assert.strictEqual(r.gates.intakeWallReference, false, row[1] + ' fails the 5e-5 historical reference like the control does');
	assert.strictEqual(r.events.filter(function (e) { return e.field < e.solidus; }).length, 0, row[1] + ' field support');
});
console.log('PASS ' + M3ROWS.length + ' M3 rows: fingerprints exact, mass/enthalpy/latent/deposit/melt books and the P4 wall gate close on every frame, zero refusals');
// ms/frame is the serial reading on the rows named (serial) and a concurrent batch reading on
// the others, which the report quotes only for the serial five
console.log('M3 row                        ms/frame    cand    tx  bleed  melt km2  held km2 Myr  split  manT out  depT range       latent km2*H  same-id  bound  decision');
var PROT = [42152, 165372, 194306];
M3ROWS.forEach(function (row) {
	var r = read3(row[0]);
	var same = PROT.filter(function (id) { return r.events.some(function (e) { return e.id === id; }); }).length;
	var bound = r.outsideSamples.every(function (n) { return n === 0; }) && r.nonfinite === 0;
	var eligible = bound && same === 3 && r.heldMassTime === 0 && bleedOf(r) === 0 && r.refuse === 0;
	console.log(row[1].padEnd(30) + r.msFrame.toFixed(3).padStart(8) + String(r.events.length).padStart(8)
		+ String(r.depTx).padStart(6) + String(bleedOf(r)).padStart(7) + r.depMelt.toFixed(4).padStart(11)
		+ r.heldMassTime.toFixed(2).padStart(14) + String(r.census.split).padStart(7)
		+ (String(r.outsideSamples[0]) + '/' + String(r.outsideSamples[3])).padStart(9)
		+ (r.minT[3].toFixed(3) + '..' + r.maxT[3].toFixed(3)).padStart(17)
		+ r.latentAbsMax.toExponential(2).padStart(14)
		+ String(same).padStart(9) + (bound ? '  ok' : '  FAIL').padStart(7) + '   ' + (eligible ? 'ELIGIBLE' : 'not selected'));
	assert.strictEqual(eligible, false, row[1] + ': no M3 row is eligible');
});
// the two channels alone on the bank cell, and the same two on the M2 sub-grid row
var ctl = read3('baseline600-final2');
assert.deepStrictEqual(ctl.events.map(function (e) { return e.id; }), PROT);
assert.deepStrictEqual(ctl.events.map(function (e) { return e.frame; }), [9341, 10157, 10660]);
near(ctl.depMelt, 9.73015809837463, 1e-12, 'control shed');
near(ctl.heldMassTime, 68140.14284555816, 1e-12, 'control held-back residence');
assert.strictEqual(ctl.census.split, 5086);
var dp = read3('baseline-dpart01'), cp = read3('baseline-cap25');
assert.strictEqual(dp.depTx, 11, 'dpart on the bank cell opens the route');
near(dp.maxT[3], 2.6652, 1e-4, 'dpart raises the deposit tail above the control\'s 2.267');
near(dp.heldMassTime, 50692.8051491391, 1e-9, 'dpart held-back');
assert.strictEqual(dp.depletion.rises, dp.census.split, 'every split is depleted');
assert.strictEqual(cp.depTx, 2, 'cap on the bank cell delivers 2 of its candidates');
assert.strictEqual(cp.events.length, 1051);
assert.strictEqual(cp.depletion.capBlocked, 225360);
assert.strictEqual(cp.depletion.capWholeBlocked, 47896);
assert(cp.mantleRoutes > 40 * ctl.mantleRoutes, 'a blocked split re-presents its residue every frame');
near(cp.heldMassTime, 158323.06658104915, 1e-9, 'cap held-back grows');
// the sub-grid row: depletion removes the bleed and returns the frozen census to the bank's own
var sg = read3('timed-subgrid1dep-watch'), sg1 = read3('timed-subgrid1dep-dpart01-watch');
var sg2 = read3('timed-subgrid1dep-dpart02-watch'), sgc = read3('timed-subgrid1dep-cap25-watch');
var both = read3('timed-subgrid1dep-dpart01-cap25-watch');
assert.strictEqual(sg.depTx, 8559); assert.strictEqual(bleedOf(sg), 7876);
assert.strictEqual(sg.heldMassTime, 0, 'the sub-grid row generates no held-back residence');
assert.strictEqual(sg.census.split, 13273, 'the bleed row\'s cost to the frozen census');
assert.strictEqual(sg1.depTx, 75); assert.strictEqual(bleedOf(sg1), 3);
assert.strictEqual(sg1.census.split, 5017, 'depletion returns the census to the bank cell\'s own 5086');
near(sg1.depletion.riseMax, 0.4598730821107844, 1e-9, 'dpart 0.01 rise max');
near(sg1.depletion.riseSum / sg1.depletion.rises, 0.0030729, 1e-4, 'mean solidus rise per split');
assert.strictEqual(sg1.outsideSamples[0], 814, 'the mantle cold side crosses');
near(sg1.minT[0], -1.0689, 1e-4, 'dpart mantle minimum');
assert.strictEqual(sg2.depTx, 872); assert.strictEqual(bleedOf(sg2), 717, 'D = 0.2 barely closes the bleed');
assert.strictEqual(sgc.events.length, 6604); assert.strictEqual(sgc.depTx, 50); assert.strictEqual(bleedOf(sgc), 0);
assert.strictEqual(sgc.depletion.capBlocked, 178181);
assert(sgc.heldMassTime > 0, 'the cap lets the held-back population return');
assert.strictEqual(both.events.length, 595); assert.strictEqual(both.depTx, 41); assert.strictEqual(bleedOf(both), 0);
assert(both.minT[0] < -0.5 && both.maxT[0] > 1.5, 'the combination row violates both ends of the bound in the mantle');
assert.strictEqual(both.outsideSamples[0], 3484);
// the serial timings the report quotes, and their worlds equal the batch banks'
[['timed-subgrid1dep-watch', 15.777], ['timed-subgrid1dep-dpart01-watch', 15.002],
['timed-subgrid1dep-dpart02-watch', 14.206], ['timed-subgrid1dep-cap25-watch', 13.974],
['timed-subgrid1dep-dpart01-cap25-watch', 14.463]].forEach(function (t) {
	var r = read3(t[0]);
	near(r.msFrame, t[1], 1e-3, t[0] + ' serial ms/frame');
	assert(r.gates.frame, t[0] + ' inside the 20 ms gate');
});
console.log('PASS the depletion channels: dpart 0.01 takes the sub-grid row from 8559 transfers / 7876 bleeding to 75 / 3 and its census from 13273 splits to 5017; cap 0.25 delivers 50 of 6604 candidates at zero bleed; both hold the books and the wall, neither holds the per-phase bound');
// the dry-solidus reading that sizes what water alone can close (the --cap probe's own reason)
var PH3 = require(path.join(__dirname, '../js/pt/phase.js'));
var comp = read3('subgrid1dep-comp');
assert.strictEqual(comp.events.length, 8559);
assert(comp.events.every(function (e) { return e.cF === 0; }), 'every candidate is felsic-free, so the dry reading is the water-only one');
assert(comp.events.every(function (e) { return Math.abs(PH3.solidus(e.y, e.cF, e.cW) - e.solidus) < 1e-12; }), 'the recorded solidus is the shipped law\'s');
var dry = comp.events.map(function (e) { return e.field - PH3.solidus(e.y, e.cF, 0); });
var aboveDry = dry.filter(function (x) { return x >= 0; }).length;
assert.strictEqual(aboveDry, 4509, 'candidates still above the fully dry solidus');
var margin = comp.events.map(function (e) { return e.T - e.solidus; }).sort(function (a, b) { return a - b; });
near(margin[margin.length >> 1], 0.0217, 1e-3, 'median T above the candidate\'s own solidus');
// the report's percentile table, at the nearest-rank index floor(q (n - 1)) of the sorted set
function pct(a, q) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[q === 1 ? s.length - 1 : Math.floor(q * (s.length - 1))]; }
var wet = comp.events.map(function (e) { return e.field - e.solidus; });
[[wet, [0.0081, 0.0159, 0.0219, 0.0766, 0.2338], 'field - wet solidus'],
[dry, [-0.085, -0.0793, 0.0031, 0.0184, 0.1635], 'field - dry solidus'],
[margin, [0.015, 0.0159, 0.0217, 0.0753, 0.2343], 'T - own solidus']].forEach(function (row) {
	[0, 0.1, 0.5, 0.9, 1].forEach(function (q, i) { near(pct(row[0], q), row[1][i], 1e-3, row[2] + ' q' + q); });
});
console.log('PASS the dry-solidus reading: 4509 of 8559 candidates (52.7%) still sit above the fully dry solidus, so drying alone closes 47.3% of the row');
// face 1: mobile melt above the bound, on the three clocks the M2 matrix found
[['seed2-300-kyr50-exlog', 1.5105, true], ['seed2-300-kyr100-exlog', 1.5156, false],
['seed2-300-kyr500-exlog', 1.5273, false]].forEach(function (c) {
	var r = read3(c[0]);
	assert.strictEqual(r.seed, 2); assert.strictEqual(r.myr, 300);
	assert.strictEqual(r.excursions.length, 1, c[0] + ' one excursion');
	assert.strictEqual(r.outsideSamples[1], r.exSamples, c[0] + ' the excursion table accounts for every melt sample outside');
	var x = r.excursions[0];
	near(x.maxT, c[1], 1e-4, c[0] + ' overshoot');
	assert.strictEqual(x.maxMelt, 1, 'the parcel is fully molten through the crossing');
	assert.strictEqual(!!x.open, c[2], c[0] + ' the run open at the last frame is closed by the observer, not dropped');
	assert(x.maxT - x.T0 > 0, 'the crossing is still rising at its hottest frame');
	var samples = r.exSampleLog.filter(function (s) { return s.id === x.id; });
	assert.strictEqual(samples.length, r.exSamples);
	samples.forEach(function (s) {
		assert.strictEqual(s.melt, 1, 'xi = 1 through the excursion');
		near(s.T, s.H - require(path.join(__dirname, '../js/pt/params.js')).meltLat, 1e-12, 'dT = dH at xi = 1: the whole intake is sensible');
		assert(s.field < s.T - 1, 'the parcel crosses a field more than a unit of T below itself');
	});
	assert(samples[samples.length - 1].y < x.y0, 'the parcel is rising through the crossing');
	console.log('  ' + c[0] + ': id ' + x.id + ', frames ' + x.frame0 + '-' + x.frame1 + ', ' + x.m0.toFixed(1) + ' km2, entry T '
		+ x.T0.toFixed(4) + ' (H ' + x.H0.toFixed(4) + ') at ' + x.y0.toFixed(1) + ' km, hottest ' + x.maxT.toFixed(4)
		+ ' at ' + x.maxY.toFixed(1) + ' km in a field of ' + x.maxField.toFixed(4) + ', entry gap ' + x.entryGap.toFixed(4));
});
console.log('PASS the mobile-melt face: one excursion per clock, a light fully molten rising parcel, dT = dH from a field 1.1-1.7 of T below it, overshoot 0.011 / 0.016 / 0.027 at 50 / 100 / 500 kyr');
// face 2: the cold side, per band and along the global mantle minimum's own path
var PHN = ['mantle', 'melt', 'air', 'dep'], NB = 8;
function bandMin(r, ph, b) { return r.bands.min[ph * NB + b]; }
var bw = read3('baseline600-watch');
near(bw.cold.T, -0.48872371593994096, 1e-12, 'the control\'s global mantle minimum');
assert.strictEqual(bw.cold.frame, 7827); assert.strictEqual(bw.cold.id, 5618);
near(bw.cold.field - bw.cold.T, 0.5484402041912796, 1e-9, 'the control\'s coldest parcel is already 0.548 below its own field');
assert(bw.cold.T > -0.5, 'the control stays 0.011 inside the wall');
// both phases populate every band these two comparisons read, so neither can pass vacuously
for (var b3 = 0; b3 < 7; b3++) {
	assert(bandMin(bw, 3, b3) !== null && bandMin(bw, 0, b3) !== null, 'control band ' + b3 + ' is populated');
	assert(bandMin(bw, 3, b3) < bandMin(bw, 0, b3), 'control band ' + b3 + ': quenched deposits are the coldest material in their own band');
}
for (b3 = 2; b3 < 7; b3++) {
	assert(bandMin(sg, 3, b3) !== null && bandMin(sg, 0, b3) !== null, 'sub-grid band ' + b3 + ' is populated');
	assert(bandMin(sg, 3, b3) > bandMin(sg, 0, b3), 'sub-grid band ' + b3 + ': the deposit-scope relaxation inverts that ordering');
}
console.log('PASS the cold side: the control\'s own global minimum is a 191 km2 parcel 0.548 of T below its field, 0.011 inside the wall; quenched deposits are the coldest material in every band of the control and the deposit-scope relaxation inverts that at depth');
[['timed-subgrid1dep-dpart01-watch', 406], ['timed-subgrid1dep-cap25-watch', 154],
['timed-subgrid1dep-dpart01-cap25-watch', 801]].forEach(function (c) {
	var r = read3(c[0]), below = r.coldPath.filter(function (e) { return e.T < -0.5; });
	assert.strictEqual(below.length, c[1], c[0] + ' new global minima below the wall');
	assert(below.every(function (e) { return e.m <= 200 && e.y <= 25 && e.hm >= 0.5; }),
		c[0] + ': every crossing minimum is a shallow light parcel far below its own field');
	var ids = {}; below.forEach(function (e) { ids[e.id] = 1; });
	console.log('  ' + c[0] + ': ' + below.length + ' minima below -0.5 from ' + Object.keys(ids).length + ' material ids ('
		+ Object.keys(ids).join(', ') + '), ' + Math.min.apply(null, below.map(function (e) { return e.m; })).toFixed(1) + '-'
		+ Math.max.apply(null, below.map(function (e) { return e.m; })).toFixed(1) + ' km2 at '
		+ Math.min.apply(null, below.map(function (e) { return e.y; })).toFixed(1) + '-'
		+ Math.max.apply(null, below.map(function (e) { return e.y; })).toFixed(1) + ' km, '
		+ Math.min.apply(null, below.map(function (e) { return e.hm; })).toFixed(3) + '-'
		+ Math.max.apply(null, below.map(function (e) { return e.hm; })).toFixed(3) + ' of T below their own field');
});
console.log('PASS the crossing rows: the cold side is 1-3 individual shallow parcels at or near the erosion floor, not a population');
console.log('No M3 row is eligible: the two-sided bound and the three protected events fail together in every probe row.');

// --- 0.3.2 M4: the field-relative bound (frb) and the two instruments. Six rows on the M2/M3
// bank cell; every number the report quotes is asserted here against the row's own bank.
var root4 = path.join(__dirname, 'logs/0.3.2-M4-');
function read4(name) { return JSON.parse(fs.readFileSync(root4 + name + '.json', 'utf8')); }
var M4ROWS = [
	['frb025-600', 'frb 0.25', 3436672068889011, 0, 0],
	['frb005-600', 'frb 0.05', 7670258870680534, 0, 0],
	['frb025-share01-600', 'frb 0.25 --share 0.1', 301728381202803, 0, 0],
	['frb05-share01-600', 'frb 0.5 --share 0.1', 4044321228233077, 145, 0],
	['frb025-mass-600', 'frb 0.25 --place mass', 6134000684222626, 0, 1],
	['frb025-sh01-mass-600', 'frb 0.25 --share 0.1 --place mass', 4414087139002819, 0, 0]
];
console.log('M4 row                              held km2 Myr  max gap  wall worst  refuse      tx   outside  decision');
M4ROWS.forEach(function (row) {
	var r = read4(row[0]);
	assert.strictEqual(r.fingerprint, row[2], row[0] + ' fingerprint');
	assert.strictEqual(r.kind, 'frb');
	assert.strictEqual(r.seed, 5); assert.strictEqual(r.kyr, 50);
	assert.strictEqual(r.myr, 600); assert.strictEqual(r.frames, 12000);
	// the exchange is the operator's own: books, wall and the latent identity on every frame
	assert(r.gates.mass && r.gates.enthalpy, row[0] + ' books');
	assert(r.gates.latentBook, row[0] + ' latent identity');
	assert(r.gates.intakeWallP4, row[0] + ' wall');
	assert.strictEqual(r.nonfinite, 0, row[0] + ' finite temperatures');
	// the instrument: the outside count splits into its two ends and the split is the whole
	assert(Array.isArray(r.outsideBelow) && Array.isArray(r.outsideAbove), row[0] + ' split counters');
	for (var i = 0; i < 4; i++) {
		assert.strictEqual(r.outsideBelow[i] + r.outsideAbove[i], r.outsideSamples[i], row[0] + ' split');
	}
	assert.strictEqual(r.outsideSamples.reduce(function (a, b) { return a + b; }, 0), row[3],
		row[0] + ' samples outside -0.5..1.5');
	// the instrument: the mechanism is read, not inferred
	var cp = r.coldPath;
	assert(cp.length > 1000, row[0] + ' cold path is populated');
	assert(cp.every(function (e) { return e.gain > 0 && e.share >= 0 && e.share <= 1; }),
		row[0] + ' every cold minimum carries a gain and a mass share');
	// the concentration is what the family removes; the route is what it costs
	// every row takes the concentration down at least 3x (21.5 .. 16304 against the control's
	// 68140.14 km2*Myr); that is the one thing the family does in every form
	assert(r.heldMassTime < 68140.14 / 3, row[0] + ' held-back concentration reduced');
	assert.strictEqual(r.depTx, row[4], row[0] + ' delivered transfers');
	var bound = row[3] === 0 ? 'ok' : 'FAIL';
	console.log('  ' + row[1] + ' '.repeat(Math.max(1, 32 - row[1].length))
		+ r.heldMassTime.toFixed(2).padStart(12) + '  ' + r.heldGapMax.toFixed(4).padStart(7)
		+ '  ' + r.intakeWallWorst.toExponential(3) + '  ' + String(r.refuse).padStart(9)
		+ '  ' + String(r.depTx).padStart(3) + '  ' + String(row[3]).padStart(7) + '  ' + bound);
});
// the cold extreme of a bounded row is set by the bound, not by the mechanism: the loosest bound
// is the only row that crosses, and it crosses on the cold side alone
var loose = read4('frb05-share01-600'), tight = read4('frb025-600');
assert.strictEqual(loose.outsideAbove.reduce(function (a, b) { return a + b; }, 0), 0, 'M4: no row crosses the upper bound');
assert(loose.outsideBelow[0] === 145 && loose.minT[0] < -0.5, 'M4: the loosest bound crosses on the cold side');
assert(tight.minT[0] > -0.5 && tight.maxT[3] < 1.5, 'M4: K 0.25 holds both ends on every phase');
var tg = tight.coldPath.map(function (e) { return e.hm; });
// a hair over K: the bound is read before advection, the observer reads after it
near(Math.max.apply(null, tg), 0.25, 1e-2, 'M4: the bounded row\'s cold extreme is the bound itself');
assert(tight.spreadCapped > 1e7 && tight.mantleRoutes > 1e6,
	'M4: the bounded row caps the bulk, and the mantle then sits above the melt threshold 1,000x as often');
assert.strictEqual(read4('frb025-600').landCr === undefined, true, 'M4: landCr is read from the census');
assert(read4('frb005-600').census.landCr === 0 && read4('frb005-600').census.nMelt === 1,
	'M4: the tightest row empties the surface pipeline');
assert(read4('frb025-mass-600').census.nMelt > 900,
	'M4: placing by marker share runs the pipeline again and melts the world');
console.log('PASS 6 M4 rows: books, wall and the latent identity close; the concentration falls from 68140 to 21-16304 km2*Myr; the two-sided bound holds on five rows and only the loosest crosses, on the cold side');
console.log('No M4 row is eligible: every row that removes the concentration empties the pipeline or saturates the pool (0-1 transfers, 5.2M-16.9M refusals).');

// --- 0.3.2 M4 continuation: scope the bound to the deposit phase, then frb + --dpart.
var dep = read4('frb025-dep-600'), frbd = read4('frb025-dpart01-600');
assert.strictEqual(dep.fingerprint, 1808048552219233, 'M4 continuation dep fingerprint');
assert.strictEqual(dep.kind, 'frb'); assert.strictEqual(dep.scope, 'dep');
assert.strictEqual(dep.seed, 5); assert.strictEqual(dep.kyr, 50); assert.strictEqual(dep.myr, 600);
assert(dep.gates.mass && dep.gates.enthalpy && dep.gates.latentBook && dep.gates.intakeWallP4 && dep.gates.temperature);
assert.strictEqual(dep.nonfinite, 0);
assert.strictEqual(dep.refuse, 0);
assert.strictEqual(dep.depTx, 2);
assert(dep.heldMassTime < 68140.14 / 3);
console.log('  frb 0.25 --scope dep: held ' + dep.heldMassTime.toFixed(2) + ' km2*Myr, ' + dep.depTx + ' transfers, '
	+ dep.refuse + ' refusals, frame ' + dep.msFrame.toFixed(3) + ' ms');
assert.strictEqual(frbd.fingerprint, 1460769074631962, 'M4 continuation frb+dpart fingerprint');
assert.strictEqual(frbd.kind, 'frb');
assert(frbd.gates.mass && frbd.gates.enthalpy && frbd.gates.latentBook && frbd.gates.intakeWallP4 && frbd.gates.temperature);
assert.strictEqual(frbd.outsideSamples.reduce(function (a, b) { return a + b; }, 0), 0);
console.log('  frb 0.25 + --dpart 0.01: held ' + frbd.heldMassTime.toFixed(2) + ' km2*Myr, ' + frbd.depTx
	+ ' transfers, ' + frbd.refuse + ' refusals, frame ' + frbd.msFrame.toFixed(3) + ' ms');
console.log('PASS M4 continuation: deposit-scoped bound and frb + --dpart measured; banks asserted.');

// --- 0.3.2 M5: the material correspondence argument, the open question M4 section 7 leaves.
// Two traced runs of the cell every milestone was read on: the control, and frb 0.25 --scope dep,
// each tracing the five ids that matter -- the three the control delivered and the two the
// candidate did -- plus, in the candidate, the id of the control's T 2.267 outlier. The trace
// writes no engine state, so each run keeps the fingerprint of its own untraced world and every
// diagnostic the family was read on is the banked one, field for field. That neutrality is what
// lets what follows be read as the same two runs and not as two new ones.
var root5 = path.join(__dirname, 'logs/0.3.2-M5-');
function read5(name) { return JSON.parse(fs.readFileSync(root5 + name + '.json', 'utf8')); }
var tctl = read5('baseline-trace-600'), tdep = read5('frb025-dep-trace-600');
var bctl = read3('baseline600-final2'), bdep = read4('frb025-dep-600');
assert.strictEqual(tctl.fingerprint, 6191250240167390, 'M5 traced control keeps the control world');
assert.strictEqual(tdep.fingerprint, 1808048552219233, 'M5 traced candidate keeps the dep-scoped world');
assert.deepStrictEqual(tctl.events, bctl.events, 'M5 traced control reproduces the banked transfers');
assert.deepStrictEqual(tdep.events, bdep.events, 'M5 traced candidate reproduces the banked transfers');
['heldSamples', 'heldMassTime', 'heldMeltTime', 'heldGapMax', 'spreadCapped', 'spreadGiven',
	'mantleRoutes', 'depTx', 'depMelt', 'refuse', 'intakeWallWorst'].forEach(function (k) {
	assert.strictEqual(tctl[k], bctl[k], 'M5 traced control diagnostic ' + k);
	assert.strictEqual(tdep[k], bdep[k], 'M5 traced candidate diagnostic ' + k);
});
assert.deepStrictEqual(tctl.maxT, bctl.maxT, 'M5 traced control maxT');
assert.deepStrictEqual(tdep.maxT, bdep.maxT, 'M5 traced candidate maxT');
assert.deepStrictEqual(tdep.census, bdep.census, 'M5 traced candidate census');
// hottest carries the material id, so the outlier is nameable -- and its name is not among the ids
// either run delivered, in either run
assert.strictEqual(tctl.hottest.id, 134747, 'M5 control outlier id');
near(tctl.hottest.T, 2.2671, 1e-3, 'M5 control outlier temperature');
assert.strictEqual(tdep.hottest.id, 130330, 'M5 candidate hottest id');
assert(tctl.maxT[3] > 2.2, 'M5 the control deposit phase reaches the outlier');
assert(tdep.maxT[3] < 1.2 && tdep.maxT[3] <= tdep.maxT[2] + 1e-12,
	'M5 the candidate deposit phase never leaves the grid-coupled range');

// One id does not mean one material across the divergence. Every id the two runs share is admitted
// at a different site -- circularly, on the 16000 km wrap -- most in a different phase, with a
// different mass and a different lifetime. The admission frames stay within 34 of each other, so
// the counter keeps step with the eruption cadence while the material it names does not, which is
// exactly why an id match looks available here and is not.
var ctlH = {}, depH = {};
tctl.trace.history.forEach(function (h) { ctlH[h.id] = h; });
tdep.trace.history.forEach(function (h) { depH[h.id] = h; });
function circ(a, b) { var d = Math.abs(a - b) % 16000; return Math.min(d, 16000 - d); }
var shared = [42152, 165372, 194306, 124861, 217799];
console.log('  id      control admission                       candidate admission                     circ Dx km  dframe   ctl rows  dep rows   ctl tx   dep tx');
shared.forEach(function (id) {
	var a = ctlH[id], b = depH[id];
	assert(a && a.first && b && b.first, 'M5 id ' + id + ' exists in both runs');
	assert(circ(a.first.x, b.first.x) > 1000, 'M5 id ' + id + ' is admitted at a different site in each run');
	assert(Math.abs(a.first.frame - b.first.frame) <= 50, 'M5 id ' + id + ' is admitted within the same cadence');
	var admit = function (h) {
		return 'f' + h.first.frame + ' x' + h.first.x.toFixed(0) + ' y' + h.first.y.toFixed(1)
			+ ' m' + h.first.m.toFixed(3) + ' ph' + h.first.ph;
	};
	console.log('  ' + String(id).padEnd(8) + admit(a).padEnd(38) + admit(b).padEnd(38)
		+ circ(a.first.x, b.first.x).toFixed(0).padStart(8) + String(b.first.frame - a.first.frame).padStart(8)
		+ String(a.rows.length).padStart(11) + String(b.rows.length).padStart(10)
		+ String(a.delivered).padStart(9) + String(b.delivered).padStart(9));
});

// The candidate's two transfers are ordinary pipeline deposits, not the control's tail in different
// clothing: admitted at the surface as deposit material of 0.03 and 0.20 km2, buried, held back by
// the field support on every frame but one of the 133 and 29 they sat at the routing threshold, and
// delivered one frame after their own hottest frame, 0.06 and 0.02 of T above their own solidus.
[124861, 217799].forEach(function (id) {
	var h = depH[id], e = tdep.events.filter(function (x) { return x.id === id; })[0];
	assert.strictEqual(h.first.ph, 3, 'M5 candidate ' + id + ' admitted as deposit material');
	assert(h.first.y < 0 && h.first.m < 1, 'M5 candidate ' + id + ' admitted small, at the surface');
	assert.strictEqual(h.delivered, 1, 'M5 candidate ' + id + ' delivered once');
	assert.strictEqual(h.deliveredFrame, e.frame, 'M5 candidate ' + id + ' delivered on the event frame');
	assert.strictEqual(h.maxTFrame, e.frame - 1, 'M5 candidate ' + id + ' hottest the frame before it goes');
	assert(e.field >= e.solidus && e.T - e.solidus < 0.1, 'M5 candidate ' + id + ' goes field-supported, near solidus');
	assert(h.routed > 20 && h.held === h.routed - 1, 'M5 candidate ' + id + ' held back until its field caught up');
});
// And the bound acts on the parcels that do transfer, which is the mechanism read at the material
// rather than at the population: 332 caps withholding -55.83 km2*H on the first, 316 of them on the
// cold side -- there the bound warms the parcel toward its own field -- and 25 caps withholding
// +9.14 km2*H on the second, 18 of them on the hot side.
assert.strictEqual(depH[124861].capped, 332, 'M5 candidate 124861 capped by the bound');
near(depH[124861].withheld, -55.83390112914293, 1e-9, 'M5 candidate 124861 withheld km2*H');
assert.strictEqual(depH[124861].caps.filter(function (c) { return c.withheld < 0; }).length, 316,
	'M5 candidate 124861 capped on the cold side');
assert.strictEqual(depH[217799].capped, 25, 'M5 candidate 217799 capped by the bound');
near(depH[217799].withheld, 9.138446812486684, 1e-9, 'M5 candidate 217799 withheld km2*H');
assert.strictEqual(depH[217799].caps.filter(function (c) { return c.withheld > 0; }).length, 18,
	'M5 candidate 217799 capped on the hot side');
// The control's three, traced in the control, are never capped -- it has no bound -- and the first
// of them stands 0.86 of T above its own field after delivery, which is the tail the family exists
// to remove. The two ids the candidate delivers are, in the control, short-lived airborne parcels
// that never transfer at all: the crossover is complete in both directions.
assert.strictEqual(ctlH[42152].capped, 0, 'M5 control has no bound to cap it');
near(ctlH[42152].maxGap, 0.8615690046862132, 1e-9, 'M5 control 42152 max T - field');
assert.strictEqual(ctlH[124861].delivered, 0, 'M5 control never delivers 124861');
assert.strictEqual(ctlH[217799].delivered, 0, 'M5 control never delivers 217799');
assert.strictEqual(depH[134747].delivered, 0, 'M5 candidate never delivers the control outlier id');
assert.strictEqual(depH[134747].first.ph, 2, 'M5 that id is airborne material in the candidate');

// The mesh repair the trace walked into, measured at the population rather than at six parcels.
// F.transfer calls G.reseed when a node's deposited weight falls below coverage, and reseed's donor
// pull *moves* a marker onto the hole -- id, mass, composition and heat preserved, position
// replaced -- out of rings of radius 2, 8 then 32 nodes (dx is 62.5 km, so the widest ring is
// 2000 km), with G.redeal's lattice permutation behind that. It is routine in both worlds, it never
// falls back to the global re-deal, and the bound does not change how much it moves: the repair is
// not the route by which the deposit-scoped row removes the concentration.
assert.strictEqual(tctl.movedSum, 13234, 'M5 control marker relocations over 600 Myr');
assert.strictEqual(tdep.movedSum, 13439, 'M5 candidate marker relocations over 600 Myr');
assert.strictEqual(tctl.movedFrames, 5209, 'M5 control frames with a relocation');
assert.strictEqual(tdep.movedFrames, 5126, 'M5 candidate frames with a relocation');
assert.strictEqual(tctl.redeals, 0, 'M5 control never re-deals the lattice');
assert.strictEqual(tdep.redeals, 0, 'M5 candidate never re-deals the lattice');
assert(Math.abs(tdep.movedSum - tctl.movedSum) < 0.05 * tctl.movedSum, 'M5 the bound leaves the repair alone');
// and to one parcel: the control's first protected transfer is relocated ten times over its 1484
// sampled frames, by up to 737 km in depth and 376 km laterally, and its widest departure from its
// own field (0.862 at y 49.3 km, in a field of 0.175) is reached three frames after one of them
function relocations(h) {
	var seen = {}, last = null, out = { n: 0, dx: 0, dy: 0 };
	h.rows.forEach(function (r) {
		if (seen[r.frame]) return;
		seen[r.frame] = 1;
		if (last && r.frame - last.frame === 1) {
			var ax = Math.abs(r.x - last.x), jx = Math.min(ax, 16000 - ax), jy = Math.abs(r.y - last.y);
			if (jx > 100 || jy > 20) { out.n++; out.dx = Math.max(out.dx, jx); out.dy = Math.max(out.dy, jy); }
		}
		last = r;
	});
	return out;
}
var ctlMoves = relocations(ctlH[42152]), depMoves = relocations(depH[124861]);
assert.strictEqual(ctlMoves.n, 10, 'M5 control 42152 relocations');
assert(ctlMoves.dy > 700 && ctlMoves.dx > 300, 'M5 one relocation spans hundreds of km');
assert.strictEqual(depMoves.n, 2, 'M5 candidate 124861 relocations');
assert.strictEqual(ctlH[42152].maxGapFrame, 9405, 'M5 the widest gap is three frames after a relocation');
// the frame-time gate: the same cell banked in M4 read 21.589 ms with --watch on and failed it;
// with the trace instead of the watch instruments it reads 15.768 ms and passes. The trace's own
// cost is what the control says it is -- 11.696 ms banked without it, 11.700 with it.
assert.strictEqual(tdep.gates.frame, tdep.msFrame < 20, 'M5 candidate frame gate is its own reading');
assert(tdep.gates.frame === true && bdep.gates.frame === false,
	'M5 the candidate cell passes the frame-time gate once the watch instruments are off');
console.log('  repair: ' + tctl.movedSum + ' relocations in the control (' + tctl.movedFrames + ' frames, max '
	+ tctl.movedMax + '/frame), ' + tdep.movedSum + ' in the candidate (' + tdep.movedFrames + ' frames, max '
	+ tdep.movedMax + '/frame), ' + tctl.redeals + ' and ' + tdep.redeals + ' global re-deals');
console.log('  frame time: control 11.700 ms traced against 11.696 banked untraced; candidate 15.768 ms traced against 21.589 banked with --watch');
console.log('PASS M5: the trace is neutral (both worlds, every banked diagnostic field for field); no id the two runs share names the same material -- the worlds diverge before every traced admission -- so the candidate 2 transfers are new deposits the ordinary pipeline runs and not the control 3 in different clothing; the candidate deposit phase never exceeds T 1.1136 against the control 2.2671, its held-back concentration is 694.73 against 68140.14 km2*Myr, and its deposit-to-melt flux is 1.2838 against 9.7302 km2.');

// --- 0.3.2 M6: the bound against the world, and the repair join. Eight serial cells: the control
// and frb 0.25 --scope dep on seeds 1, 3 and 7 (the other seeds of the matrix set) beside the
// seed-5 pair every milestone was read on, re-run with the join so the question M5 left open is
// answered on the very numbers it quoted. Every number archive/0.3.2-M6-distribution-report.md
// states is asserted here against its own bank. One bank per world: these are the survivors.
var root6 = path.join(__dirname, 'logs/0.3.2-M6-');
function read6(name) { return JSON.parse(fs.readFileSync(root6 + name + '.json', 'utf8')); }
var M6ROWS = [
	// name, seed, fingerprint, depTx, depMelt, heldMassTime, heldSamples, maxTdep, heldGapMax, msFrame, max host
	['base-s5-600', 5, 6191250240167390, 3, 9.73015809837463, 68140.14284555816, 30906, 2.267069502201132, 1.3276533479616148, 15.280883841250034, 50],
	['dep-s5-600', 5, 1808048552219233, 2, 1.2838165494261151, 694.7296454453834, 713, 1.1136447535633849, 0.2503481501218162, 21.351125761416576, 5.240696509186323],
	['base-s1-600', 1, 5524785744115553, 29, 142.69160449574065, 39009.40422323297, 52350, 2.3128475130252686, 1.9944785161036562, 15.179226384999986, 83.01736396801212],
	['dep-s1-600', 1, 5025891284893073, 25, 80.72013109972458, 19293.565114745375, 12251, 1.114970360850176, 0.2513038667907077, 21.460615049333565, 152.72845368510758],
	['base-s3-600', 3, 7478865669897216, 4, 35.93644904679494, 18423.89178544559, 13297, 1.6072146652070176, 1.1724055383443293, 15.567853885333307, 35.06086230043179],
	['dep-s3-600', 3, 3305588838878544, 11, 115.04154147546977, 3983.209687546376, 2327, 1.1138015761489664, 0.2504142016439308, 21.80023574608327, 80.188307938032],
	['base-s7-600', 7, 4424600941464687, 4, 68.29668917217981, 43694.63240246308, 32776, 1.9357911324082142, 1.8716877960231488, 14.90162163308344, 81.25123694302376],
	['dep-s7-600', 7, 1401659456291387, 8, 5.777096193777766, 1104.4715478012263, 1721, 1.1138127399627262, 0.2525162026272012, 21.45841568333326, 7.018349906075348]
];
var M6 = {};
console.log('M6 world  row       tx   depMelt km2   max host   held km2 Myr   maxT dep  worst gap  ms/frame   vs own control');
M6ROWS.forEach(function (row) {
	var r = read6(row[0]), seed = row[1];
	M6[row[0]] = r;
	assert.strictEqual(r.fingerprint, row[2], row[0] + ' fingerprint');
	assert.strictEqual(r.seed, seed); assert.strictEqual(r.kyr, 50); assert.strictEqual(r.myr, 600);
	assert.strictEqual(r.frames, 12000);
	assert(r.gates.mass && r.gates.enthalpy, row[0] + ' books');
	assert(r.gates.latentBook, row[0] + ' latent identity');
	assert(r.gates.intakeWallP4, row[0] + ' wall');
	assert.strictEqual(r.refuse, 0, row[0] + ' refusals');
	assert.strictEqual(r.nonfinite, 0, row[0] + ' finite');
	assert.strictEqual(r.depTx, row[3], row[0] + ' transfers');
	near(r.depMelt, row[4], 1e-12, row[0] + ' deposit->melt flux');
	near(r.heldMassTime, row[5], 1e-12, row[0] + ' held mass-time');
	assert.strictEqual(r.heldSamples, row[6], row[0] + ' held samples');
	near(r.maxT[3], row[7], 1e-12, row[0] + ' deposit phase maximum');
	near(r.heldGapMax, row[8], 1e-12, row[0] + ' worst held gap');
	near(r.msFrame, row[9], 1e-9, row[0] + ' kernel frame time');
	near(Math.max.apply(null, r.events.map(function (e) { return e.host; })), row[10], 1e-12,
		row[0] + ' largest delivered host');
	assert.strictEqual(r.gates.frame, r.msFrame < 20, row[0] + ' frame gate is its own reading');
	// every delivered transfer reconciles and carried field support
	assert.strictEqual(r.events.length, r.depTx, row[0] + ' event count');
	assert(Math.abs(r.events.reduce(function (s, e) { return s + e.melt; }, 0) - r.depMelt) < 1e-9,
		row[0] + ' events reconcile to thr.depMelt');
	assert(r.events.every(function (e) { return e.field >= e.solidus; }), row[0] + ' field support');
	// the join instrument: the wrap's own count equals the kernel's, the lattice is untouched,
	// and the ever/never totals partition the held census exactly
	assert.strictEqual(r.movedSeen, r.movedSum, row[0] + ' the diff sees exactly the repair\'s moves');
	assert.strictEqual(r.redeals, 0, row[0] + ' no lattice re-deal');
	var j = r.heldJoin, i;
	assert.deepStrictEqual(j.win, [1, 3, 10, 30, 100], row[0] + ' join windows');
	for (i = 1; i < j.win.length; i++) {
		assert(j.mass[i] >= j.mass[i - 1] && j.n[i] >= j.n[i - 1], row[0] + ' windows cumulative');
	}
	assert(j.mass.every(function (m) { return m <= j.ever.mass + 1e-9; }), row[0] + ' windows inside ever');
	near(j.ever.mass + j.never.mass, r.heldMassTime, 1e-9, row[0] + ' ever + never = held mass-time');
	assert.strictEqual(j.ever.n + j.never.n, r.heldSamples, row[0] + ' ever + never = held samples');
	assert.strictEqual(j.never.n, 0, row[0] + ' every held sample sits on relocated material');
	r.events.forEach(function (e, k) {
		if (e.movedAgo === null) return;
		assert(e.movedAgo >= 0 && e.movedAgo < e.frame, row[0] + ' event ' + k + ' relocation age');
	});
});
[5, 1, 3, 7].forEach(function (seed) {
	['base', 'dep'].forEach(function (kind) {
		var r = M6[kind + '-s' + seed + '-600'], ctl = M6['base-s' + seed + '-600'];
		console.log('  s' + seed + '     ' + (kind === 'dep' ? 'candidate' : 'control  ')
			+ String(r.depTx).padStart(4) + r.depMelt.toFixed(4).padStart(13)
			+ Math.max.apply(null, r.events.map(function (e) { return e.host; })).toFixed(2).padStart(11)
			+ r.heldMassTime.toFixed(1).padStart(14) + r.maxT[3].toFixed(4).padStart(11)
			+ r.heldGapMax.toFixed(4).padStart(11) + r.msFrame.toFixed(2).padStart(10)
			+ (kind === 'dep' ? (r.depMelt / ctl.depMelt).toFixed(3) + 'x depMelt' : '-').padStart(16));
	});
});
console.log('PASS 8 M6 cells: books, the latent identity and the wall close on every frame of every world; zero refusals; the join diff equals the kernel\'s own relocation count');
// The decision rule M5 section 7 names. The flux ratio is not a constant of the bound: it spans
// 0.085 to 3.20 across worlds, including an inversion (seed 3) where the candidate delivers over
// three times the control's flux -- so the seed-5 'seventh' was one world's variance, and by the
// plan's own rule the row's standing is open again. What IS constant is the defect's removal.
var ratios = [1, 3, 7, 5].map(function (s) {
	return M6['dep-s' + s + '-600'].depMelt / M6['base-s' + s + '-600'].depMelt;
});
assert(Math.min.apply(null, ratios) < 0.1 && Math.max.apply(null, ratios) > 3,
	'M6 the flux ratio varies with the world');
assert(M6ROWS.filter(function (row) { return row[0].indexOf('dep-') === 0; }).every(function (row) {
	return M6[row[0]].maxT[3] < 1.12 && M6[row[0]].outsideSamples[3] === 0;
}), 'M6 the candidate deposit phase stays inside 1.5 on every world');
assert(M6ROWS.filter(function (row) { return row[0].indexOf('base-') === 0; }).every(function (row) {
	return M6[row[0]].maxT[3] > 1.5 && M6[row[0]].outsideSamples[3] > 0;
}), 'M6 the control deposit phase leaves the wall on every world');
assert(M6ROWS.filter(function (row) { return row[0].indexOf('dep-') === 0; }).every(function (row) {
	return M6[row[0]].heldGapMax < 0.26;
}), 'M6 the candidate held gap is the bound\'s own width on every world');
assert([1, 3, 7, 5].every(function (s) {
	return M6['dep-s' + s + '-600'].heldMassTime < M6['base-s' + s + '-600'].heldMassTime;
}), 'M6 the concentration is reduced on every world');
// the temperature gate by phase, the report's cold-face column (mantle, melt, air, deposit),
// split into its two ends: the candidate's residual crossings are the mantle cold side and the
// air hot side -- phases the deposit-scoped bound does not touch by design -- while the deposit
// phase, the release's own defect, crosses both ends in every control and neither in any candidate
var M6OUT = {
	'base-s5-600': [[0, 0, 0, 1744], [0, 0, 0, 1112]], 'dep-s5-600': [[0, 0, 0, 0], [0, 0, 0, 0]],
	'base-s1-600': [[671, 0, 0, 2491], [0, 485, 0, 883]], 'dep-s1-600': [[273, 0, 0, 0], [0, 488, 0, 0]],
	'base-s3-600': [[3268, 0, 0, 443], [0, 38, 0, 46]], 'dep-s3-600': [[865, 0, 0, 0], [0, 0, 0, 0]],
	'base-s7-600': [[2768, 0, 0, 1704], [0, 165, 0, 726]], 'dep-s7-600': [[1815, 0, 0, 0], [0, 229, 0, 0]]
};
Object.keys(M6OUT).forEach(function (name) {
	var below = M6OUT[name][0], above = M6OUT[name][1], totals = below.map(function (b, i) { return b + above[i]; });
	assert.deepStrictEqual(M6[name].outsideSamples, totals, name + ' samples outside -0.5..1.5 by phase');
	assert.deepStrictEqual(M6[name].outsideBelow, below, name + ' samples below -0.5 by phase');
	assert.deepStrictEqual(M6[name].outsideAbove, above, name + ' samples above 1.5 by phase');
	assert.strictEqual(M6[name].gates.temperature, totals.every(function (n) { return n === 0; }),
		name + ' temperature gate is its own reading');
});
// the residual faces' own extremes, the report's extrema
near(M6['dep-s7-600'].minT[0], -0.897, 5e-3, 'M6 mantle cold extreme of the candidate family');
near(M6['dep-s1-600'].maxT[1], 1.595, 5e-3, 'M6 air hot extreme of the candidate family');
console.log('  depMelt ratio candidate/control: s5 ' + ratios[3].toFixed(3) + ', s1 ' + ratios[0].toFixed(3)
	+ ', s3 ' + ratios[1].toFixed(3) + ' (inverted), s7 ' + ratios[2].toFixed(3)
	+ '; deposit T max 1.1136..1.1150 against 1.6072..2.3128');
// The repair join's own answer: the held census is 100% on material the repair had moved at
// least once (never = 0 in all eight cells), but the recent share is world-variable and the
// worst gap sits mostly on settled material -- so the concentration is not predominantly a
// fresh coverage drop, and a bound on deliveries is not the wrong instrument for it.
var w1shares = M6ROWS.map(function (row) {
	var j = M6[row[0]].heldJoin;
	return { name: row[0], s1: j.mass[0] / M6[row[0]].heldMassTime, s100: j.mass[4] / M6[row[0]].heldMassTime,
		settled: (j.ever.mass - j.mass[4]) / M6[row[0]].heldMassTime,
		gapSettled: j.ever.gap > j.gap[4] };
});
assert(w1shares.every(function (w) { return w.s1 >= 0 && w.s1 < 0.35; }), 'M6 no world holds a majority of held mass-time within a frame of a relocation');
assert(w1shares.every(function (w) { return w.settled > 0.5; }), 'M6 every world keeps most held mass-time on settled material');
// the report's join table, to its printed precision: within 1 frame, within 100 frames, settled
var M6JOIN = {
	'base-s5-600': [33.3, 35.0], 'dep-s5-600': [1.1, 6.3], 'base-s1-600': [2.0, 4.4],
	'dep-s1-600': [15.2, 16.4], 'base-s3-600': [28.2, 36.2], 'dep-s3-600': [0.1, 7.2],
	'base-s7-600': [9.6, 10.7], 'dep-s7-600': [0.2, 1.9]
};
w1shares.forEach(function (w) {
	var e = M6JOIN[w.name];
	assert.strictEqual((100 * w.s1).toFixed(1), e[0].toFixed(1), w.name + ' within-one-frame share');
	assert.strictEqual((100 * w.s100).toFixed(1), e[1].toFixed(1), w.name + ' within-one-hundred-frame share');
});
// the worst held gap is settled material on every cell but the s7 control, where it is attained
// inside the 100-frame window (ever.gap === window gap there and nowhere else)
assert.deepStrictEqual(w1shares.map(function (w) { return w.gapSettled; }),
	[true, true, true, true, true, true, false, true], 'M6 worst-gap placement by cell');
assert.strictEqual(M6['dep-s1-600'].events[0].movedAgo, 3076,
	'M6 the s1 candidate 152.73 km2 host went 3076 frames past its last relocation');
console.log('M6 join   <=1f share of held   <=100f share   settled >100f   worst gap at settled?   held km2 Myr');
M6ROWS.forEach(function (row, i) {
	var w = w1shares[i];
	console.log('  ' + row[0].padEnd(13) + (100 * w.s1).toFixed(1).padStart(6) + '%'
		+ (100 * w.s100).toFixed(1).padStart(12) + '%' + (100 * w.settled).toFixed(1).padStart(13) + '%'
		+ String(w.gapSettled ? 'yes' : 'no').padStart(17) + M6[row[0]].heldMassTime.toFixed(1).padStart(18));
});
// the quoted world's own join, the numbers M5 section 7 asked its question on
var j5 = M6['base-s5-600'].heldJoin;
near(j5.mass[0], 22713.566026608973, 1e-12, 'M6 seed-5 control held mass-time within one frame of a relocation');
near(j5.mass[4], 23856.149521100207, 1e-12, 'M6 seed-5 control held mass-time within one hundred frames');
assert.deepStrictEqual(j5.n, [14067, 14092, 14154, 14274, 14544], 'M6 seed-5 control join sample counts');
assert.strictEqual(M6['base-s5-600'].movedSum, 13234, 'M6 seed-5 control relocations');
assert.strictEqual(M6['base-s5-600'].movedIds, 2786, 'M6 seed-5 control relocated material ids');
assert.strictEqual(M6['dep-s5-600'].movedSum, 13439, 'M6 seed-5 candidate relocations');
assert.strictEqual(M6['dep-s5-600'].movedIds, 2794, 'M6 seed-5 candidate relocated material ids');
assert.deepStrictEqual(M6['base-s5-600'].events.map(function (e) { return e.movedAgo; }), [22, 36, 14],
	'M6 the three protected transfers were relocated 14-36 frames before delivery');
assert.deepStrictEqual(M6['dep-s5-600'].events.map(function (e) { return e.movedAgo; }), [211, 1],
	'M6 the candidate pair: one transfer fresh off a relocation, one settled');
assert.strictEqual(M6['base-s5-600'].hottest.movedAgo, 205, 'M6 the outlier id sat 205 frames from its last relocation');
console.log('PASS M6: the flux ratio varies 0.085..3.20 with the world (the seed-5 seventh was one large event), the defect is absent on every world (deposit T 1.1136..1.1150 against 1.6072..2.3128, held gap the bound\'s own 0.25 against 1.17..1.99), and the held census is 100% on relocated material with 0.1..33% within one frame of a move -- a sizeable repair-adjacent minority, not the majority of the concentration.');
console.log('The row\'s standing is open again (M5 section 7\'s own rule); eligibility turns on condition 5\'s material branch beyond seed 5, not on the flux.');
