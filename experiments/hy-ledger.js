// hy-ledger.js — 0.5.0 M3 gate (0.5.0-plan.md §4.5, §4.8, §7 M3, §9.1): the two-book
// mass and enthalpy ledgers close across every cell<->parcel transaction and over a
// full 300 Myr integrated leg.
//
// In the hybrid engine, liquid lives in cells (M) and solid crust lives in parcels (S).
// Every transaction that moves material between the two books — melt shedding, whole-parcel
// melt absorption, basal accretion, vent emission, ballistic landing, deposit cooling/welding
// and S4 unloading — must debit one book and credit the other by the same float, and when
// the parcel pool is full (`S.n === S.cap`) an admission must defer cleanly without losing
// mass or heat from its host cell.
//
// Run: node experiments/hy-ledger.js
'use strict';

var PCP = require('../js/pc/params.js');
var PHASE = require('../js/pc/phase.js');
var HY = require('../js/hy/hy.js');
var check = require('./lib.js').check;

function totalComposition() {
	var M = HY.M, S = HY.S, k, p, f = M.unload.f, w = M.unload.w;
	for (k = 0; k < M.n; k++) {
		f += M.m[k] * M.cF[k];
		w += M.m[k] * M.cW[k];
	}
	for (p = 0; p < S.n; p++) {
		f += S.m[p] * S.cF[p];
		w += S.m[p] * S.cW[p];
	}
	return { f: f, w: w };
}

check.section('A. t = 0 partition: cell book + parcel skin = box stock');
HY.reset(1);
var M = HY.M, S = HY.S;
var mBox = PCP.wrap * PCP.depth;
var m0 = HY.read('mass'), h0 = HY.read('enthalpy'), s0 = HY.read('stock0');
var comp0 = totalComposition();
check.ok('cell mass + parcel mass equals wrap x depth at t = 0',
	Math.abs(m0 - M.totalMass) / M.totalMass <= 1e-14 &&
	Math.abs(m0 - mBox) / mBox <= 1e-13 &&
	HY.read('parcelMass') > 0 && HY.read('cellMass') > 0,
	'cell ' + HY.read('cellMass').toExponential(4) + ' + parcel ' +
	HY.read('parcelMass').toExponential(4) + ' = ' + m0.toExponential(6));
check.ok('cell enthalpy + parcel enthalpy equals stock0 at t = 0',
	Math.abs(h0 - s0) / s0 <= 1e-14,
	'H ' + h0.toExponential(6) + ' vs stock0 ' + s0.toExponential(6));
var maxLoadErr = 0, maxColErr = 0, i, j, k;
for (i = 0; i < M.nx; i++) {
	maxColErr = Math.max(maxColErr, Math.abs(M.colTot[i] - PCP.depth));
	for (j = 0; j < M.ny; j++) {
		k = j * M.nx + i;
		maxLoadErr = Math.max(maxLoadErr, Math.abs(M.load[k] - M.yC[j]));
	}
}
check.ok('every column integrates to depth and load[k] = yC[j] at t = 0',
	maxColErr <= 1e-11 && maxLoadErr <= 1e-11,
	'col err ' + maxColErr.toExponential(2) + ', load err ' + maxLoadErr.toExponential(2));
check.ok('initial crust skin is seeded in the 1.5k-3k target band',
	S.n === 1536 && HY.pool.invN[PCP.PH.crust] === 1536 &&
	HY.pool.invN[PCP.PH.dep] === 0 && HY.pool.invN[PCP.PH.air] === 0,
	'n = ' + S.n);

check.section('B. isolated H5/H6 transaction primitives conserve mass, enthalpy and composition');
// 1. Equilibrium melt shedding: heat parcel 0 into its partial-melt window and shed into cell 0
var p0 = 0, k0 = HY.rowOfY(S.y[p0]) * M.nx + HY.colOfX(S.x[p0]);
var dH = 0.80 - S.H[p0];
S.H[p0] += dH;
M.H[k0] -= (S.m[p0] / M.m[k0]) * dH;
HY.equil(); HY.diag();
var mBefore = HY.read('mass'), hBefore = HY.read('enthalpy'), cBefore = totalComposition();
var shedDm = HY.shedParcelMelt(p0, k0);
HY.diag();
var mAfter = HY.read('mass'), hAfter = HY.read('enthalpy'), cAfter = totalComposition();
check.ok('shedParcelMelt moves partial melt to its host cell with zero mass/enthalpy/composition residual',
	shedDm > 0 && S.melt[p0] === 0 &&
	Math.abs(mAfter - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hAfter - hBefore) / hBefore <= 1e-14 &&
	Math.abs(cAfter.f - cBefore.f) / cBefore.f <= 1e-14 &&
	Math.abs(cAfter.w - cBefore.w) / cBefore.w <= 1e-14 &&
	M.thr.meltDr === M.thr.meltCr,
	'shed ' + shedDm.toFixed(2) + ' km2, dH/H ' + (Math.abs(hAfter - hBefore) / hBefore).toExponential(2));

// 2. Whole-parcel melt absorption
var nBefore = S.n;
var absDm = HY.absorbParcel(p0, k0);
HY.diag();
mAfter = HY.read('mass'); hAfter = HY.read('enthalpy'); cAfter = totalComposition();
check.ok('absorbParcel retires the parcel into its host cell with zero residual',
	absDm > 0 && S.n === nBefore - 1 &&
	Math.abs(mAfter - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hAfter - hBefore) / hBefore <= 1e-14 &&
	Math.abs(cAfter.f - cBefore.f) / cBefore.f <= 1e-14 &&
	Math.abs(cAfter.w - cBefore.w) / cBefore.w <= 1e-14 &&
	M.thr.meltDr === M.thr.meltCr,
	'absorbed ' + absDm.toFixed(2) + ' km2');

// 3. Basal accretion (both onto an existing parcel and admitting a new crust parcel)
var accExisting = HY.accreteFromCell(0, 0, 15);
var accNew = HY.accreteFromCell(1, -1, 25);
HY.diag();
mAfter = HY.read('mass'); hAfter = HY.read('enthalpy'); cAfter = totalComposition();
check.ok('accreteFromCell (existing + new admission) conserves mass, enthalpy and composition',
	accExisting === 0 && accNew === S.n - 1 &&
	Math.abs(mAfter - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hAfter - hBefore) / hBefore <= 1e-14 &&
	Math.abs(cAfter.f - cBefore.f) / cBefore.f <= 1e-14 &&
	Math.abs(cAfter.w - cBefore.w) / cBefore.w <= 1e-14 &&
	M.thr.freezeDr === M.thr.freezeCr && M.thr.freezeCr === 40,
	'freezeCr ' + M.thr.freezeCr);

// 4. Vent launch + ballistic flight + landing
var kVent = 6 * M.nx + 10;
var clastP = HY.launchClast(10, kVent, 30);
HY.diag();
var mMidFlight = HY.read('mass'), hMidFlight = HY.read('enthalpy');
check.ok('launchClast debits the source cell and admits an airborne clast without residual',
	clastP >= 0 && HY.airCount() === 1 &&
	Math.abs(mMidFlight - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hMidFlight - hBefore) / hBefore <= 1e-14 &&
	M.thr.emitDr === M.thr.emitCr && M.thr.emitCr === 30,
	'airCount ' + HY.airCount() + ', emitCr ' + M.thr.emitCr);
var guard = 0;
while (HY.airCount() > 0 && guard++ < 160) HY.advanceFlight(HY.cfg.flightFrame);
HY.scatter(); HY.pileTop(); HY.equil(); HY.diag();
mAfter = HY.read('mass'); hAfter = HY.read('enthalpy');
check.ok('advanceFlight + landClast lands the clast into PH.dep and closes emit == land',
	HY.airCount() === 0 && HY.read('depositMass') === 30 &&
	M.thr.landDr === M.thr.landCr && M.thr.landCr === M.thr.emitCr &&
	Math.abs(mAfter - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hAfter - hBefore) / hBefore <= 1e-14,
	'steps ' + guard + ', depositMass ' + HY.read('depositMass'));

// 5. Unload book
var unlM = HY.unload(8000, 750);
mAfter = HY.read('mass'); hAfter = HY.read('enthalpy'); cAfter = totalComposition();
check.ok('unload books excavated mass, enthalpy and composition in M.unload without loss',
	unlM > 0 && M.unload.m === unlM && M.thr.unloadDr === M.thr.unloadCr &&
	Math.abs(mAfter - mBefore) / mBefore <= 1e-14 &&
	Math.abs(hAfter - hBefore) / hBefore <= 1e-14 &&
	Math.abs(cAfter.f - cBefore.f) / cBefore.f <= 1e-14 &&
	Math.abs(cAfter.w - cBefore.w) / cBefore.w <= 1e-14,
	'unloaded ' + unlM.toFixed(1) + ' km2');

check.section('C. capacity deferral: a full pool defers freeze and vent admission without loss');
HY.reset(1);
M = HY.M; S = HY.S;
while (S.n < S.cap) {
	var q = HY.pool.admit(S, PCP.PH.crust);
	S.m[q] = 0; S.H[q] = 0;
}
mBefore = HY.read('mass'); hBefore = HY.read('enthalpy');
var defAcc = HY.accreteFromCell(0, -1, 20);
var defVent = HY.launchClast(0, 6 * M.nx, 20);
HY.diag();
check.ok('accreteFromCell and launchClast return -1 and increment defer/refuse when S.n === S.cap',
	defAcc === -1 && defVent === -1 && M.tx.defer === 2 && S.tx.refuse === 2,
	'defer ' + M.tx.defer + ', refuse ' + S.tx.refuse);
check.ok('deferred transactions leave cell mass and enthalpy untouched',
	HY.read('mass') === mBefore && HY.read('enthalpy') === hBefore,
	'mass ' + HY.read('mass') + ', H ' + HY.read('enthalpy'));

check.section('D. 300 Myr integrated leg (6,000 frames at 50 kyr/frame): two-book closure');
HY.reset(1);
M = HY.M; S = HY.S;
var maxMassRel = 0, maxHeatRel = 0, maxChainGap = 0, f;
for (f = 1; f <= 6000; f++) {
	HY.step(0);
	if (f % 1000 === 0) {
		var mr = Math.abs(HY.read('mass') - M.totalMass) / M.totalMass;
		var hr = Math.abs((HY.read('enthalpy') - HY.read('stock0')) -
			(HY.read('wallNet') + HY.read('clampNet'))) /
			(HY.read('wallGross') + Math.abs(HY.read('clampNet')) || 1);
		var cg = Math.abs(HY.read('airMass') - HY.read('depositMass') - HY.read('weldMass'));
		if (mr > maxMassRel) maxMassRel = mr;
		if (hr > maxHeatRel) maxHeatRel = hr;
		if (cg > maxChainGap) maxChainGap = cg;
	}
}
check.ok('300 Myr mass ledger closes to <= 1e-12 relative at every 50 Myr checkpoint',
	maxMassRel <= 1e-12,
	'max |dM|/M0 = ' + maxMassRel.toExponential(2));
check.ok('300 Myr enthalpy ledger closes against wall + clamp flux to <= 1e-11 relative',
	maxHeatRel <= 1e-11,
	'max |dH - wallNet|/wallGross = ' + maxHeatRel.toExponential(2));
check.ok('all five two-book transaction channels fired and debit == credit on each',
	M.tx.melt > 0 && M.tx.shed > 0 && M.tx.freeze > 0 && M.tx.emit > 0 &&
	M.tx.land > 0 && M.tx.weld > 0 &&
	M.thr.meltDr === M.thr.meltCr && M.thr.freezeDr === M.thr.freezeCr &&
	M.thr.emitDr === M.thr.emitCr && M.thr.landDr === M.thr.landCr,
	'tx ' + JSON.stringify(M.tx));
check.ok('eruption chain airMass == depositMass + weldMass closes at every checkpoint',
	maxChainGap <= 1e-9,
	'max |air - dep - weld| = ' + maxChainGap.toExponential(2));
check.ok('parcel population stays inside the 1.5k-3k target band at 300 Myr',
	S.n >= 1200 && S.n <= 3000 && M.tx.defer === 0,
	'pop = ' + S.n + ', defer = ' + M.tx.defer);

check.done();
