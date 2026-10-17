// experiments/pt-faces-guard-check.js — 0.3.2 M12 assertion suite for the three open items
// attributed across the 8 600-Myr distribution worlds (seeds 1, 3, 5, 7 x {base, dep}):
//
//   1. Bitwise fingerprint & M6/M8 reference bank parity across all 8 worlds.
//   2. Repair-adjacent held deposit minority: exact algebraic reconciliation of M6's
//      `heldJoin` (`null >= 0` coercion) against `heldJoinTrue` (`never` vs `<= 1..100f`
//      vs `> 100f`), plus G.reseed ring/phase census and same-frame depBound clamping.
//   3. Non-deposit thermal faces (`mantle-cold` below -0.5, `mobile-melt-hot` above 1.5):
//      0-50 km surface-band localization, eroMinM = 50 km2 & melt-split mass attribution,
//      raw conduction gather vs depBound placement sign check, and mobile-melt birth
//      provenance (100% deep mantle-split in shipped worlds, depWhole on base-s3 closed).
//   4. Contact guard finite-sweep residue (`S.d.resid > 0` after `P.ctSweep = 3`):
//      100% multi-pair sandwich attribution (`sandwichPairs === residPairs`), worst
//      surviving distance ratio `d / contactHard >= 0.9758` on all shipped worlds, and
//      100% finite scratch-sweep clearance (`sweepsToClear <= 40` on all shipped worlds).
'use strict';

var fs = require('fs');
var path = require('path');

var LOG_DIR = path.join(__dirname, 'logs');
var SEEDS = [1, 3, 5, 7];
var MODES = ['base', 'dep'];

var passed = 0, failed = 0;
function ok(cond, msg) {
	if (cond) {
		passed++;
	} else {
		failed++;
		console.error('FAIL: ' + msg);
	}
}
function near(a, b, tol, msg) {
	ok(Math.abs(a - b) <= tol, msg + ' (got ' + a + ', expected ' + b + ', tol ' + tol + ')');
}

function loadJson(name) {
	var p = path.join(LOG_DIR, name);
	if (!fs.existsSync(p)) throw new Error('missing bank: ' + p);
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

var m6 = {}, m8 = {}, m12 = {};
SEEDS.forEach(function (s) {
	MODES.forEach(function (m) {
		var k = m + '-s' + s;
		m6[k] = loadJson('0.3.2-M6-' + m + '-s' + s + '-600.json');
		m12[k] = loadJson('0.3.2-M12-' + m + '-s' + s + '-600.json');
	});
	if (s !== 7) {
		m8['dep-s' + s] = loadJson('0.3.2-M8-landed-s' + s + '-600.json');
	}
});

// ── 1. Bitwise fingerprint & M6/M8 bank parity across all 8 worlds ──
var EXP_FP = {
	'base-s1': 5524785744115553,
	'dep-s1': 5025891284893073,
	'base-s3': 7478865669897216,
	'dep-s3': 3305588838878544,
	'base-s5': 6191250240167390,
	'dep-s5': 1808048552219233,
	'base-s7': 4424600941464687,
	'dep-s7': 1401659456291387
};

SEEDS.forEach(function (s) {
	MODES.forEach(function (m) {
		var k = m + '-s' + s;
		var d6 = m6[k], d12 = m12[k];
		ok(d12.fingerprint === EXP_FP[k], k + ' fingerprint matches expected bank');
		ok(d12.fingerprint === d6.fingerprint, k + ' fingerprint matches M6 bank bitwise');
		if (m8[k]) {
			ok(d12.fingerprint === m8[k].fingerprint, k + ' fingerprint matches M8 landed bank bitwise');
		}
		ok(d12.frames === 12000 && d12.myr === 600 && d12.kyr === 50, k + ' horizon 600 Myr / 12000 frames');
		for (var ph = 0; ph < 4; ph++) {
			ok(d12.outsideBelow[ph] === d6.outsideBelow[ph], k + ' outsideBelow[' + ph + '] matches M6');
			ok(d12.outsideAbove[ph] === d6.outsideAbove[ph], k + ' outsideAbove[' + ph + '] matches M6');
			near(d12.minT[ph], d6.minT[ph], 1e-4, k + ' minT[' + ph + '] matches M6');
			near(d12.maxT[ph], d6.maxT[ph], 1e-4, k + ' maxT[' + ph + '] matches M6');
		}
		ok(d12.repairAndReseed.heldSamples === d6.heldSamples, k + ' heldSamples matches M6');
		near(d12.repairAndReseed.heldMassMyr, d6.heldMassTime, 0.02, k + ' heldMassMyr matches M6');
		ok(d12.repairAndReseed.reseedCensus.total === d6.movedSeen, k + ' reseedCensus.total matches M6 movedSeen');
	});
});
console.log('PASS  M12 §1 bitwise fingerprint and M6/M8 bank parity across all 8 600-Myr worlds');

// ── 2. Repair-adjacent held deposit minority & G.reseed census ──
var EXP_TRUE_HELD = {
	'base-s1': { neverN: 8947, neverMass: 718.94, win1N: 94, win1Mass: 51.01, win100N: 2418, win100Mass: 1002.68, gt100N: 40985, gt100Mass: 37287.78 },
	'dep-s1':  { neverN: 2088, neverMass: 2927.79, win1N: 21, win1Mass: 2.26, win100N: 1407, win100Mass: 228.69, gt100N: 8756, gt100Mass: 16137.09 },
	'base-s3': { neverN: 4511, neverMass: 5150.33, win1N: 19, win1Mass: 37.89, win100N: 778, win100Mass: 1520.01, gt100N: 8008, gt100Mass: 11753.55 },
	'dep-s3':  { neverN: 0, neverMass: 0, win1N: 9, win1Mass: 4.07, win100N: 304, win100Mass: 287.36, gt100N: 2023, gt100Mass: 3695.85 },
	'base-s5': { neverN: 14035, neverMass: 22592.10, win1N: 32, win1Mass: 121.47, win100N: 509, win100Mass: 1264.05, gt100N: 16362, gt100Mass: 44283.99 },
	'dep-s5':  { neverN: 0, neverMass: 0, win1N: 5, win1Mass: 7.82, win100N: 65, win100Mass: 43.94, gt100N: 648, gt100Mass: 650.79 },
	'base-s7': { neverN: 2242, neverMass: 4182.44, win1N: 19, win1Mass: 12.19, win100N: 427, win100Mass: 508.40, gt100N: 30107, gt100Mass: 39003.80 },
	'dep-s7':  { neverN: 0, neverMass: 0, win1N: 4, win1Mass: 1.67, win100N: 141, win100Mass: 21.20, gt100N: 1580, gt100Mass: 1083.27 }
};

SEEDS.forEach(function (s) {
	MODES.forEach(function (m) {
		var k = m + '-s' + s;
		var d6 = m6[k], rr = m12[k].repairAndReseed;
		var hj6 = rr.heldJoinM6, hjt = rr.heldJoinTrue, exp = EXP_TRUE_HELD[k];

		// M6 reproduction
		ok(hj6.ever.n === d6.heldJoin.ever.n && hj6.never.n === 0, k + ' M6 heldJoin coerced never -> ever');
		for (var i = 0; i < 5; i++) {
			ok(hj6.n[i] === d6.heldJoin.n[i], k + ' M6 heldJoin.n[' + i + '] exact');
			near(hj6.mass[i], d6.heldJoin.mass[i], 0.02, k + ' M6 heldJoin.mass[' + i + '] exact');
			// Exact algebraic identity: hjM6[i] === hjTrue[i] + hjTrue.never
			ok(hj6.n[i] === hjt.n[i] + hjt.never.n, k + ' algebraic identity hjM6.n[' + i + '] = hjTrue.n[' + i + '] + never.n');
			near(hj6.mass[i], hjt.mass[i] + hjt.never.mass, 0.02, k + ' algebraic identity hjM6.mass[' + i + '] = hjTrue.mass[' + i + '] + never.mass');
		}
		// True partition closure
		ok(hjt.ever.n + hjt.never.n === rr.heldSamples, k + ' true ever + never sample closure');
		near(hjt.ever.mass + hjt.never.mass, rr.heldMassMyr, 0.02, k + ' true ever + never mass closure');
		ok(hjt.n[4] + hjt.settledGt100.n === hjt.ever.n, k + ' true <=100f + >100f sample closure');
		near(hjt.mass[4] + hjt.settledGt100.mass, hjt.ever.mass, 0.02, k + ' true <=100f + >100f mass closure');
		ok(hjt.ring100N[0] + hjt.ring100N[1] + hjt.ring100N[2] === hjt.n[4], k + ' ring100N sums to <=100f samples');
		near(hjt.ring100Mass[0] + hjt.ring100Mass[1] + hjt.ring100Mass[2], hjt.mass[4], 0.02, k + ' ring100Mass sums to <=100f mass');

		// Banked expected values
		ok(hjt.never.n === exp.neverN, k + ' true never.n');
		near(hjt.never.mass, exp.neverMass, 0.02, k + ' true never.mass');
		ok(hjt.n[0] === exp.win1N, k + ' true <=1f n');
		near(hjt.mass[0], exp.win1Mass, 0.02, k + ' true <=1f mass');
		ok(hjt.n[4] === exp.win100N, k + ' true <=100f n');
		near(hjt.mass[4], exp.win100Mass, 0.02, k + ' true <=100f mass');
		ok(hjt.settledGt100.n === exp.gt100N, k + ' true >100f n');
		near(hjt.settledGt100.mass, exp.gt100Mass, 0.02, k + ' true >100f mass');

		// True 1-frame share is <= 0.21% on 7/8 worlds and 1.13% on dep-s5; <=100f share is < 8.3% on all 8 worlds
		if (k === 'dep-s5') {
			near(hjt.win1MassSharePct, 1.1258, 0.005, k + ' win1MassSharePct');
		} else {
			ok(hjt.win1MassSharePct <= 0.21, k + ' win1MassSharePct <= 0.21% (got ' + hjt.win1MassSharePct + '%)');
		}
		ok(hjt.win100MassSharePct <= 8.3, k + ' win100MassSharePct <= 8.3%');
		near(hjt.neverMassSharePct + hjt.win100MassSharePct + hjt.settledMassSharePct, 100, 0.01, k + ' mass share pct sums to 100%');

		// Reseed census closure & same-frame depBound clamping
		var rc = rr.reseedCensus;
		ok(rc.byPhase[0] + rc.byPhase[1] + rc.byPhase[2] + rc.byPhase[3] === rc.total, k + ' reseed byPhase sums to total');
		ok(rc.byRing[0] + rc.byRing[1] + rc.byRing[2] === rc.total, k + ' reseed byRing sums to total');
		ok(rc.depByRing[0] + rc.depByRing[1] + rc.depByRing[2] === rc.byPhase[3], k + ' reseed depByRing sums to dep total');
		if (m === 'dep') {
			ok(rc.depSameFrameCapped >= rc.postOver025[3], k + ' all post-reseed dep gaps > 0.25 capped on same frame');
		} else {
			ok(rc.depSameFrameCapped === 0, k + ' unbound world has 0 depSameFrameCapped');
		}
	});
});
console.log('PASS  M12 §2 repair-adjacent heldJoin null-coercion reconciliation & G.reseed census');

// ── 3. Non-deposit thermal faces (`mantle-cold` and `mobile-melt-hot`) ──
var EXP_COLD = {
	'base-s1': { samples: 671, carriers: 3, exc: 3, minT: -3.7470, lt50: 554, eq50: 0, b50_200: 117 },
	'dep-s1':  { samples: 273, carriers: 4, exc: 5, minT: -0.5678, lt50: 0, eq50: 170, b50_200: 103 },
	'base-s3': { samples: 3268, carriers: 5, exc: 7, minT: -0.6128, lt50: 0, eq50: 1121, b50_200: 2147 },
	'dep-s3':  { samples: 865, carriers: 5, exc: 6, minT: -0.7776, lt50: 186, eq50: 679, b50_200: 0 },
	'base-s5': { samples: 0, carriers: 0, exc: 0, minT: -0.4887, lt50: 0, eq50: 0, b50_200: 0 },
	'dep-s5':  { samples: 0, carriers: 0, exc: 0, minT: -0.3783, lt50: 0, eq50: 0, b50_200: 0 },
	'base-s7': { samples: 2768, carriers: 4, exc: 4, minT: -0.9172, lt50: 0, eq50: 2768, b50_200: 0 },
	'dep-s7':  { samples: 1815, carriers: 4, exc: 5, minT: -0.8970, lt50: 141, eq50: 1517, b50_200: 157 }
};

var EXP_MELT = {
	'base-s1': { samples: 485, carriers: 9, exc: 9, maxT: 1.5564, mantleSplit: 485, depWhole: 0 },
	'dep-s1':  { samples: 488, carriers: 5, exc: 5, maxT: 1.5955, mantleSplit: 488, depWhole: 0 },
	'base-s3': { samples: 38, carriers: 1, exc: 1, maxT: 1.6518, mantleSplit: 0, depWhole: 38 },
	'dep-s3':  { samples: 0, carriers: 0, exc: 0, maxT: 1.3381, mantleSplit: 0, depWhole: 0 },
	'base-s5': { samples: 0, carriers: 0, exc: 0, maxT: 1.4811, mantleSplit: 0, depWhole: 0 },
	'dep-s5':  { samples: 0, carriers: 0, exc: 0, maxT: 1.4288, mantleSplit: 0, depWhole: 0 },
	'base-s7': { samples: 165, carriers: 3, exc: 3, maxT: 1.5491, mantleSplit: 165, depWhole: 0 },
	'dep-s7':  { samples: 229, carriers: 4, exc: 4, maxT: 1.5439, mantleSplit: 229, depWhole: 0 }
};

SEEDS.forEach(function (s) {
	MODES.forEach(function (m) {
		var k = m + '-s' + s;
		var mc = m12[k].mantleCold, ec = EXP_COLD[k];
		ok(mc.samples === ec.samples, k + ' mantleCold.samples');
		ok(mc.carriersCount === ec.carriers, k + ' mantleCold.carriersCount');
		ok(mc.excursionsCount === ec.exc, k + ' mantleCold.excursionsCount');
		near(mc.minT, ec.minT, 1e-4, k + ' mantleCold.minT');
		ok(mc.massBins.lt50 === ec.lt50 && mc.massBins.eq50 === ec.eq50 &&
			mc.massBins.b50_200 === ec.b50_200 && mc.massBins.gt200 === 0,
			k + ' mantleCold massBins exact and 0 samples above 200 km2');
		// 100% in 0-50 km depth band
		ok(mc.depthBins[0] === mc.samples, k + ' 100% of mantleCold samples in 0-50 km band');
		for (var bi = 1; bi < mc.depthBins.length; bi++) {
			ok(mc.depthBins[bi] === 0, k + ' 0 mantleCold samples in depth band ' + bi);
		}
		if (mc.samples > 0) {
			ok(mc.worst.y <= 45, k + ' worst mantleCold in shallow conductive boundary layer');
			ok(mc.worst.eroLost > 70, k + ' worst mantleCold carrier was heavily weathered by ERODE.run');
			ok(mc.worst.negRawDi < -0.5, k + ' worst mantleCold driven by negative raw conduction gather');
			if (m === 'dep') {
				ok(mc.worst.negBdGiven >= 0, k + ' depBound placement is non-negative (warming) on worst mantleCold carrier');
			}
		}

		var mm = m12[k].mobileMeltHot, em = EXP_MELT[k];
		ok(mm.samples === em.samples, k + ' mobileMeltHot.samples');
		ok(mm.carriersCount === em.carriers, k + ' mobileMeltHot.carriersCount');
		ok(mm.excursionsCount === em.exc, k + ' mobileMeltHot.excursionsCount');
		near(mm.maxT, em.maxT, 1e-4, k + ' mobileMeltHot.maxT');
		ok(mm.byBirthMode.mantleSplit === em.mantleSplit &&
			mm.byBirthMode.depWhole === em.depWhole &&
			mm.byBirthMode.depSplit === 0 &&
			mm.byBirthMode.mantleWhole === 0 &&
			mm.byBirthMode.unknown === 0,
			k + ' mobileMeltHot birth provenance exact');
		if (k === 'base-s3') {
			ok(mm.movedBins.never === 0 && mm.movedBins.le1 === 2 && mm.movedBins.le100 === 36,
				k + ' dep-whole excursion triggered on same frame as G.reseed move (movedAgoAtEnter=0)');
		} else {
			ok(mm.movedBins.never === mm.samples, k + ' 100% of mantle-split mobileMeltHot samples are never-relocated');
		}
		if (m === 'dep' && mm.samples > 0) {
			ok(mm.maxT < 1.60, k + ' shipped mobileMeltHot maxT < 1.60');
			mm.excursions.forEach(function (ex) {
				ok(ex.birthMode === 'mantle-split', k + ' melt exc id=' + ex.id + ' born via mantle-split');
				ok(ex.birthY > 1000 && ex.birthT > 1.15 && ex.birthT < 1.17, k + ' melt exc id=' + ex.id + ' born deep on liquidus');
				ok(ex.m > 10 && ex.m < 45, k + ' melt exc id=' + ex.id + ' small parcel mass');
				ok(ex.enterShare < 0.01 && ex.peakShare < 0.025, k + ' melt exc id=' + ex.id + ' low stencil mass share');
				ok(ex.lastY <= 55, k + ' melt exc id=' + ex.id + ' terminates at chamber depth');
			});
		}
	});
});
console.log('PASS  M12 §3 mantle-cold and mobile-melt-hot faces census & physical attribution');

// ── 4. Contact guard finite-sweep residue (`S.d.resid > 0` after `P.ctSweep = 3`) ──
var EXP_GUARD = {
	'base-s1': { pushFrames: 6148, pushes: 24046, residFrames: 146, residPairs: 150, reflPairs: 50, worstRatio: 0.919015, maxSweeps: 55 },
	'dep-s1':  { pushFrames: 5981, pushes: 22222, residFrames: 112, residPairs: 115, reflPairs: 14, worstRatio: 0.976654, maxSweeps: 25 },
	'base-s3': { pushFrames: 5333, pushes: 15314, residFrames: 70,  residPairs: 80,  reflPairs: 22, worstRatio: 0.992917, maxSweeps: 34 },
	'dep-s3':  { pushFrames: 5349, pushes: 14621, residFrames: 26,  residPairs: 29,  reflPairs: 20, worstRatio: 0.994689, maxSweeps: 11 },
	'base-s5': { pushFrames: 5905, pushes: 25653, residFrames: 280, residPairs: 286, reflPairs: 53, worstRatio: 0.941958, maxSweeps: 33 },
	'dep-s5':  { pushFrames: 5590, pushes: 21694, residFrames: 156, residPairs: 157, reflPairs: 22, worstRatio: 0.975830, maxSweeps: 40 },
	'base-s7': { pushFrames: 5752, pushes: 20761, residFrames: 121, residPairs: 125, reflPairs: 13, worstRatio: 0.945526, maxSweeps: 40 },
	'dep-s7':  { pushFrames: 5505, pushes: 18700, residFrames: 72,  residPairs: 80,  reflPairs: 21, worstRatio: 0.989463, maxSweeps: 22 }
};

SEEDS.forEach(function (s) {
	MODES.forEach(function (m) {
		var k = m + '-s' + s;
		var cg = m12[k].contactGuard, eg = EXP_GUARD[k];
		ok(cg.ctSweep === 3, k + ' ctSweep=3');
		near(cg.contactHardKm, 34.375, 1e-4, k + ' contactHardKm=34.375');
		ok(cg.pushFrames === eg.pushFrames && cg.totalPushes === eg.pushes, k + ' guard pushFrames & totalPushes');
		ok(cg.residFrames === eg.residFrames && cg.residPairs === eg.residPairs, k + ' guard residFrames & residPairs');
		// 100% of surviving pairs are multi-pair sandwiched markers
		ok(cg.sandwichFrames === cg.residFrames && cg.sandwichPairs === cg.residPairs,
			k + ' 100% of guard residue frames and pairs are multi-pair sandwiches');
		ok(cg.reflectedPairs === eg.reflPairs, k + ' guard reflectedPairs');
		near(cg.worstRatio, eg.worstRatio, 1e-6, k + ' guard worstRatio');
		ok(cg.maxSweepsToClear === eg.maxSweeps, k + ' guard maxSweepsToClear');
		if (m === 'dep') {
			ok(cg.worstRatio >= 0.9758, k + ' shipped world worstRatio >= 0.9758 of contactHard');
			ok(cg.maxSweepsToClear <= 40, k + ' shipped world clears all residues in <= 40 scratch sweeps');
		}
		// Histogram of sweepsToClear sums to residFrames
		var histSum = 0;
		Object.keys(cg.sweepsToClearHist).forEach(function (sw) {
			var swNum = +sw;
			ok(swNum >= 4 && swNum <= cg.maxSweepsToClear, k + ' hist key ' + sw + ' in 4..maxSweepsToClear');
			histSum += cg.sweepsToClearHist[sw];
		});
		ok(histSum === cg.residFrames, k + ' sweepsToClearHist sums to residFrames');
	});
});
console.log('PASS  M12 §4 contact guard finite-sweep residue census & sandwich/sweep-to-clear attribution');

console.log('ALL PASS (' + passed + ' assertions, ' + failed + ' failed)');
if (failed > 0) process.exit(1);
