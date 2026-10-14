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
console.log('Candidate rejections are measurement outcomes, not a failing measurement harness.');
