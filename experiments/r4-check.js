// r4-check.js — R4, "convergence is absorbed", measured on a fixture of its own.
//
// 0.1.5-plan.md §1 lists R4 as a contract, but nothing in the suite ever measured it:
// arrest was asserted only indirectly, as a topology-repeat count inside the event
// memory, and M3 changed shape mid-implementation — arrest turned out to be geometric
// (the belt widens, and the collision brake grows with the belt) rather than a speed
// limit on plU. A contract with no number of its own cannot tell those two apart.
//
// This is the number. Two continents are put on a collision course by a prescribed
// far-field drive, and the closing speed of their boundary is measured against the width
// of the belt that boundary has built, for 200 Myr. If the geometric route is enough, the
// closing speed falls as the belt widens. The negative control switches the collision
// brake off and must show the closing speed staying at the drive: a fixture that cannot
// fail without the mechanism is not measuring it.
//
// The fixture builder and the collision-site walk live in lib.js, shared with
// experiments/orogen-measure.js (0.1.8 M0), so the two cannot measure different fixtures.
//
// run:  node experiments/r4-check.js [frames] [drive_mm_yr] [seed]
'use strict';

var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom,
	PLT = L.mods.plates, COL = L.mods.columns;
var check = L.check;

var FRAMES = Number(process.argv[2]) || 4000;      // 200 Myr at 50 kyr/frame
var DRIVE = (Number(process.argv[3]) || 15) * 1e3; // m/Myr per continent, 15 -> 30 mm/yr closing
var KYR = 50e3;
var SEED = Number(process.argv[4]) || 1;

// The drive is a force, not a velocity: a far-field push on each continent, added to the
// per-column boundary term the plate solve already integrates. Prescribing plU instead
// would overwrite the answer, because the collision brake acts on exactly that term.
var basal = PLT.basal;
function driveOn() {
	PLT.basal = function (st) {
		basal.call(PLT, st);
		// PLT.solve multiplies this term by 1/cD with the rest of the boundary forces, so
		// the drive goes in pre-multiplied by cD and lands on the plate target as DRIVE.
		var cD = PLT.cD(SIM.Tm), i, p;
		for (i = 0; i < st.nCol; i++) {
			p = st.colPlate[i];
			if (p === 0) PLT.wB[i] += DRIVE * cD;
			else if (p === 1) PLT.wB[i] -= DRIVE * cD;
		}
	};
}

// closing speed, belt width and belt root, sampled every frame
function run(vColl) {
	var out = {
		t: new Float64Array(FRAMES), close: new Float64Array(FRAMES),
		w: new Float64Array(FRAMES), root: new Float64Array(FRAMES), live: 0, lost: -1
	};
	var keepV = P.vColl, keepD = P.kDam, i, k, peak, flank;
	P.vColl = vColl;
	P.kDam = 0;          // the drive diverges the far field; damage would split the fixture
	check.twoContinents(SEED);
	SIM.setGeo(KYR);
	driveOn();
	for (i = 0; i < FRAMES; i++) {
		SIM.step();
		k = check.collisionSite();
		if (k < 0) { if (out.lost < 0) out.lost = i; continue; }
		COL.beltAt(S, S.nCol, k);
		peak = Math.max(S.hTot[k], S.hTot[k + 1 < S.nCol ? k + 1 : 0]);
		flank = COL.flankH;
		out.t[out.live] = SIM.t;
		out.close[out.live] = -S.edgeRelN[k];
		out.w[out.live] = COL.beltW;
		out.root[out.live] = peak - flank;
		out.live++;
	}
	PLT.basal = basal;
	P.vColl = keepV;
	P.kDam = keepD;
	return out;
}

function mean(a, from, to) {
	var s = 0, n = 0, i;
	for (i = from; i < to; i++) { s += a[i]; n++; }
	return n ? s / n : 0;
}

function table(r, label) {
	var i, step = Math.max(1, Math.floor(r.live / 20));
	console.log('\n' + label);
	console.log('    t      closing    belt     root');
	console.log('   Myr     mm/yr      km       km');
	for (i = 0; i < r.live; i += step) {
		console.log('  ' + r.t[i].toFixed(0).padStart(5) + '  ' +
			(r.close[i] / 1e3).toFixed(1).padStart(8) + '  ' +
			(r.w[i] / 1e3).toFixed(0).padStart(7) + '  ' +
			(r.root[i] / 1e3).toFixed(1).padStart(7));
	}
}

check.section('R4 — convergence is absorbed (0.1.6-plan.md §1)');

var brake = run(P.vColl);
var free = run(0);

table(brake, 'with the collision brake (vColl ' + P.vColl + ' m2/Myr per km of belt)');
table(free, 'negative control: brake off (vColl 0)');

var q = Math.max(1, Math.floor(brake.live / 4));
var early = mean(brake.close, 0, q), late = mean(brake.close, brake.live - q, brake.live);
var earlyW = mean(brake.w, 0, q), lateW = mean(brake.w, brake.live - q, brake.live);
var fEarly = mean(free.close, 0, q), fLate = mean(free.close, free.live - q, free.live);
var maxRoot = 0, i;
for (i = 0; i < brake.live; i++) if (brake.root[i] > maxRoot) maxRoot = brake.root[i];

check.ok('the fixture holds a collision for the whole run', brake.live === FRAMES && brake.lost < 0,
	brake.live + ' of ' + FRAMES + ' frames measured' + (brake.lost >= 0
		? ', the boundary welded at t ' + (brake.lost * KYR / 1e9).toFixed(0) + ' Myr' : ''));
check.ok('the brake, not the drive, is what slows the boundary', fLate > 0.9 * fEarly && late < 0.95 * fLate,
	'brake off: ' + (fEarly / 1e3).toFixed(1) + ' -> ' + (fLate / 1e3).toFixed(1) +
	' mm/yr; brake on ends at ' + (late / 1e3).toFixed(1) + ' mm/yr');
check.ok('the belt root stays under the crust ceiling', maxRoot <= P.crustMax,
	(maxRoot / 1e3).toFixed(1) + ' km of root (ceiling ' + (P.crustMax / 1e3).toFixed(0) + ' km)');

// The numbers below are the verdict, and the model does not currently pass them. They are
// reported, not gated: a red suite that nobody expects hides the finding, and
// 0.1.8-plan.md §3 carries it as the open item. Measured on the honest fixture (0.1.8 M0),
// the belt does *not* decay: it is 378-400 km from the first quarter on, because the crust
// is uniform continental. What fails is that nothing grows after the contact reaches the
// separation floor (COL.floor), so the brake cannot grow with it.
console.log('\nR4 verdict — is the geometric route enough?');
console.log('  belt width      ' + (earlyW / 1e3).toFixed(0) + ' km over the first quarter -> ' +
	(lateW / 1e3).toFixed(0) + ' km over the last   (needed: widening)');
console.log('  closing speed   ' + (early / 1e3).toFixed(1) + ' mm/yr -> ' + (late / 1e3).toFixed(1) +
	' mm/yr, ' + (100 * late / early).toFixed(0) + '%   (needed: falling)');
console.log('  against a ' + (2 * DRIVE / 1e3).toFixed(0) + ' mm/yr drive, the brake buys ' +
	(100 * (1 - late / fLate)).toFixed(0) + '%');
var met = lateW > earlyW && late < 0.75 * early;
console.log('  ' + (met ? 'MET: the belt widens and the convergence is absorbed.'
	: 'NOT MET: the width is set by the crust and the contact, not by the brake, and once the ' +
	'contact pair sits at the separation floor the crust stops evolving, so no measure of it can grow.'));
console.log('  experiments/orogen-measure.js (0.1.8 M0) measures that limit and the candidate ' +
	'measures built on it.');

check.done();
