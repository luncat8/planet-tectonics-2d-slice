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
