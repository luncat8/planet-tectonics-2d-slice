// r4-check.js — R4, "convergence is absorbed", measured on a prescribed fixture.
//
// Two continents are put on a collision course by a far-field drive, and the closing
// speed, belt width, and root are measured through the whole run. The M1 conveyor now
// allows the contact to keep consuming convergence; this check still asks whether the
// incumbent collision brake arrests it. The brake-off control is essential: if the drive
// alone slows the contact, a low closing speed is not evidence for the brake.
//
// A passing exploratory run is not the full M1/M2 acceptance set. Keep the M0 R4 failure
// open until both frame sizes/seeds, the strict event audits, and all mass/replay gates pass.
// The fixture builder is shared with experiments/orogen-measure.js so the two cannot drift.
//
// run:  node experiments/r4-check.js [frames] [drive_mm_yr] [seed] [kyr_per_frame]
'use strict';

var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom,
	PLT = L.mods.plates, COL = L.mods.columns;
var check = L.check;

var FRAMES = Number(process.argv[2]) || 4000;      // 200 Myr at 50 kyr/frame
var DRIVE = (Number(process.argv[3]) || 15) * 1e3; // m/Myr per continent, 15 -> 30 mm/yr closing
var SEED = Number(process.argv[4]) || 1;
var KYR = Number(process.argv[5]) || 50;            // kyr/frame
var DT_MYR = KYR / 1e3;

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
		w: new Float64Array(FRAMES), root: new Float64Array(FRAMES),
		live: 0, lost: -1, maxH: 0
	};
	var keepV = P.vColl, keepD = P.kDam, i, k, peak, flank;
	P.vColl = vColl;
	P.kDam = 0;          // the drive diverges the far field; damage would split the fixture
	check.twoContinents(SEED);
	SIM.setGeo(KYR * 1e3);
	driveOn();
	for (i = 0; i < FRAMES; i++) {
		SIM.step();
		for (k = 0; k < S.nCol; k++) if (S.hTot[k] > out.maxH) out.maxH = S.hTot[k];
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
var fq = Math.max(1, Math.floor(free.live / 4));
var early = mean(brake.close, 0, q), late = mean(brake.close, brake.live - q, brake.live);
var earlyW = mean(brake.w, 0, q), lateW = mean(brake.w, brake.live - q, brake.live);
var fEarly = mean(free.close, 0, fq), fLate = mean(free.close, free.live - fq, free.live);
var maxRoot = 0, i;
for (i = 0; i < brake.live; i++) if (brake.root[i] > maxRoot) maxRoot = brake.root[i];
var brakeHeld = brake.live === FRAMES && brake.lost < 0;
var controlHeld = free.live === FRAMES && free.lost < 0;
var beltWidens = lateW > earlyW;
var controlStaysFast = fEarly > 0 && fLate > 0.9 * fEarly;
var closesArrested = early > 0 && late <= 0.75 * early;
var brakeActs = fLate > 0 && late < 0.95 * fLate;
var ceiling = brake.maxH <= P.crustMax + 35e3 * DT_MYR;

check.ok('the braked fixture holds a collision for the whole run', brakeHeld,
	brake.live + ' of ' + FRAMES + ' frames measured' + (brake.lost >= 0
		? ', first unmeasurable at t ' + (brake.lost * DT_MYR).toFixed(1) + ' Myr' : ''));
check.ok('the brake-off control holds a collision for the whole run', controlHeld,
	free.live + ' of ' + FRAMES + ' frames measured' + (free.lost >= 0
		? ', first unmeasurable at t ' + (free.lost * DT_MYR).toFixed(1) + ' Myr' : ''));
check.ok('the orogen keeps widening through the last quarter', beltWidens,
	(earlyW / 1e3).toFixed(0) + ' -> ' + (lateW / 1e3).toFixed(0) + ' km');
check.ok('the final-quarter closing rate is at most 75% of the first-quarter mean', closesArrested,
	(early / 1e3).toFixed(1) + ' -> ' + (late / 1e3).toFixed(1) + ' mm/yr (' +
	(early > 0 ? (100 * late / early).toFixed(0) : 'n/a') + '%)');
check.ok('the brake-off control remains above 90% of its early speed', controlStaysFast,
	(fEarly / 1e3).toFixed(1) + ' -> ' + (fLate / 1e3).toFixed(1) + ' mm/yr (' +
	(fEarly > 0 ? (100 * fLate / fEarly).toFixed(0) : 'n/a') + '%)');
check.ok('the incumbent brake slows the contact relative to its control', brakeActs,
	'brake ' + (late / 1e3).toFixed(1) + ' vs control ' + (fLate / 1e3).toFixed(1) + ' mm/yr');
check.ok('maximum total crust stays inside the dt-aware R3 ceiling', ceiling,
	(brake.maxH / 1e3).toFixed(1) + ' km vs ' + ((P.crustMax + 35e3 * DT_MYR) / 1e3).toFixed(1) + ' km');
check.info('maximum pair root (diagnostic, not the crust ceiling)',
	(maxRoot / 1e3).toFixed(1) + ' km; maximum total crust ' + (brake.maxH / 1e3).toFixed(1) + ' km');

console.log('\nR4 verdict — incumbent brake under the M1 conveyor');
console.log('  belt width      ' + (earlyW / 1e3).toFixed(0) + ' km over the first quarter -> ' +
	(lateW / 1e3).toFixed(0) + ' km over the last (needed: widening)');
console.log('  closing speed   ' + (early / 1e3).toFixed(1) + ' mm/yr -> ' + (late / 1e3).toFixed(1) +
	' mm/yr, ' + (100 * late / early).toFixed(0) + '% (needed: <= 75%)');
console.log('  brake-off control ' + (fEarly / 1e3).toFixed(1) + ' -> ' + (fLate / 1e3).toFixed(1) +
	' mm/yr (' + (100 * fLate / fEarly).toFixed(0) + '% of its early speed; needed: > 90%)');
console.log('  against a ' + (2 * DRIVE / 1e3).toFixed(0) + ' mm/yr drive, the incumbent brake buys ' +
	(100 * (1 - late / fLate)).toFixed(0) + '% of the late control speed');
var met = brakeHeld && controlHeld && beltWidens && closesArrested && controlStaysFast && brakeActs && ceiling;
check.ok('R4 incumbent-brake contract', met,
	met ? 'all live, accumulation, arrest, negative-control and total-crust gates pass' :
		'one or more strict R4 gates above remain open');
console.log('  ' + (met ? 'MET: the collision is held and the incumbent brake absorbs convergence.'
	: 'NOT MET: R4 remains open; this run does not satisfy the complete brake/control and crust-ceiling contract.'));
console.log('  M1 accumulation is measured separately in experiments/orogen-measure.js; a passing');
console.log('  short run here is not full acceptance and does not solve the known M0 R4 failure.');

check.done();
