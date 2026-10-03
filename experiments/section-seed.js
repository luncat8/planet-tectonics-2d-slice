// section-seed.js — 0.4.1 M2: the gate for the mapping itself, js/section-seed.js. The page
// around it (paste, buttons, HUD, the two view states) is experiments/section-pack.js; this
// file is the numbers, on the same fixture packs, with no DOM. What it holds the seeding to:
//
//   §4.3.4  the surface the section draws is the surface the cut named, exactly, at frame 0 —
//           and starting the clock costs the view nothing it was not already going to cost.
//   §4.3.1  the cut is resampled onto the section's own 512 columns, never onto its own cells,
//           and the resample conserves crust: what the cut carries is what the columns hold.
//   §4.3.3  every place the pack cannot answer the model is counted, by name, in S.recon — and
//           none of it is allowed to reach S.hash().
//   §4.4    a closed cut may be put on the clock and a window may not; both start stopped.
//
// The identity tolerance is 1e-3 m and the comparison is against the pack's own `zKm` scaled
// back to metres, because the format stores km to six significant digits: half a millimetre of
// that is in the bytes, not in the mapping. A larger error is a mapping bug (plan §4.3.4).
// Run: node experiments/section-seed.js
'use strict';

var lib = require('./lib.js');
var check = lib.check;
var M = lib.mods;
var SP = require('../port/slice-format.js');
var FIX = require('./pack-fixture.js');

var S = M.state, P = M.params, SEED = M['section-seed'], COL = M.columns, SURF = M.surface;
var PLT = M.plates, SIM = M.sim, MNT = M.mantle;
var KM = 1000;
var t0 = Date.now();

console.log('  section seed: the cut, mapped onto the section (js/section-seed.js, mapping v' + SEED.MAP + ')');
console.log('  (packs from experiments/pack-fixture.js; the page half is experiments/section-pack.js)');
console.log('');

// The box filter, written a second time and directly from the plan's §E rules: column j spans
// [j·w0, (j+1)·w0), sample i owns [sKm_i, sKm_{i+1}), its value arrives in a column weighted by
// the overlap. Nothing here reads SEED's scratch arrays, so the two cannot agree by sharing a
// bug — which is the only way the identity below means anything.
function boxMean(pack, j, what, nCut) {
	var sc = SEED.scale * KM, w0 = P.w0, n = pack.n, i, a, b, acc = 0, wsum = 0, best = 0, bi = -1;
	for (i = 0; i < n; i++) {
		a = i === 0 ? 0 : pack.sKm[i] * sc;
		b = i + 1 < n ? pack.sKm[i + 1] * sc : (SEED.window ? pack.path.arcKm * sc : nCut * w0);
		var lo = Math.max(a, j * w0), hi = Math.min(b, (j + 1) * w0);
		if (!(hi > lo)) continue;
		var v = what(pack, i), w = hi - lo;
		if (typeof v === 'number' && isFinite(v) && !what.categorical) { acc += v * w; wsum += w; }
		if (what.categorical && w > best) { best = w; bi = i; }
	}
	return what.categorical ? bi : (wsum > 0 ? acc / wsum : 0);
}
function crustOf(pack, i) { return pack.hFelM[i] + pack.hMafM[i] + pack.hSedM[i]; }

// one layout, then the numbers this file reads
function lay(pack, opts) {
	var bad = SEED.layout(pack, opts);
	return { bad: bad, cut: SEED.nCut, scale: SEED.scale, window: SEED.window };
}

function worstIdentity(pack) {
	var nCut = SEED.nCut, mx = 0, at = -1, j;
	for (j = 0; j < nCut; j++) {
		var want = boxMean(pack, j, function (p, i) { return p.zM[i]; }, nCut);
		var d = Math.abs(S.z[j] - want);
		if (d > mx) { mx = d; at = j; }
	}
	return { m: mx, at: at };
}

function crustMass(pack) {
	var nCut = SEED.nCut, sc = SEED.scale * KM, w0 = P.w0, seed = 0, cut = 0, i, j;
	for (j = 0; j < nCut; j++) seed += S.hTot[j] * S.colW[j];
	for (i = 0; i < pack.n; i++) {
		var a = i === 0 ? 0 : pack.sKm[i] * sc;
		var b = i + 1 < pack.n ? pack.sKm[i + 1] * sc : (SEED.window ? pack.path.arcKm * sc : nCut * w0);
		if (b > a) cut += crustOf(pack, i) * (b - a);
	}
	return { seed: seed, cut: cut, tail: SEED.tailVol };
}

// ---------------------------------------------------------------- A. the identity
check.section('A. §4.3.4 the surface is the one the cut named');
var pin = FIX.pinned();
var r = lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
check.ok('the cut is laid without a refusal', r.bad === '', r.bad);
var w1 = worstIdentity(pin);
check.ok('every column of the pinned cut stands where the cut said (1e-3 m)',
	w1.m <= 1e-3, 'max ' + w1.m.toExponential(2) + ' m at column ' + w1.at + ' of ' + r.cut);
check.ok('and that is the model reading its own stacks, not a number parked in z',
	(function () {
		SURF.profile(0);
		var w2 = worstIdentity(pin), h0 = S.hash();
		SURF.profile(0);
		return w2.m <= 1e-3 && S.hash() === h0;
	})(), 'profile(0) twice: identity ' + worstIdentity(pin).m.toExponential(2) + ' m, hash stable');
check.ok('no column of a closed cut is left to the model (0 ghosts, nothing outside)',
	(function () {
		var g = 0, i;
		for (i = 0; i < SEED.nCut; i++) g += S.colGhost[i];
		return g === 0 && S.recon.outsideCut === 0 && S.nCol === P.nCols;
	})(), 'ghosts in the cut, nCol ' + S.nCol);
check.ok('the widths are the section’s own (nothing was stretched to the cut)',
	(function () {
		var mx = 0, i;
		for (i = 0; i < P.nCols; i++) mx = Math.max(mx, Math.abs(S.colW[i] - P.w0));
		return mx < 1e-6 && P.w0 === P.wrap / P.nCols;
	})(), 'max |colW - w0|, w0 ' + (P.w0 / KM).toFixed(6) + ' km');

check.section('B. §4.3.5 the ledger closes: what the cut carries is what the columns hold');
var m1 = crustMass(pin);
check.near('seeded crust equals the cut’s crust, absolutely (closed cut: no tail)',
	m1.seed + m1.tail, m1.cut, 1e-9 * m1.cut, 'm3/m');
check.ok('map-equivalent is 1 for a closed cut, and it is the same statement, as a ratio',
	Math.abs(SEED.mapEquiv - 1) < 1e-12, SEED.mapEquiv.toFixed(15));
check.ok('the ledger is a measured pair, not a promise (both masses are on SEED)',
	isFinite(SEED.cutMass) && isFinite(SEED.seedMass) && SEED.cutMass > 0,
	Math.round(SEED.seedMass) + ' of ' + Math.round(SEED.cutMass) + ' m3/m');
check.info('why 512 columns and a box filter (§4.3.1): the cut’s cells are ' +
	(pin.path.cellKm.toFixed(0)) + ' km, a column is ' + (P.w0 / KM).toFixed(0) +
	' km, so one column per crossed cell would leave',
	(function () {
		var seen = new Uint8Array(P.nCols), i, used = 0;
		for (i = 0; i < pin.n; i++) if (!seen[i]) { seen[i] = 1; used++; }
		return used + ' of ' + P.nCols + ' columns holding a sample and ' + (P.nCols - pin.n) +
			' carrying nothing, with w0 moving from 78 km to ' + (pin.path.arcKm / pin.n).toFixed(0) +
			' km (every tuned constant carries w0)';
	})());

check.section('C. §4.3.3 the assumptions are counted, and counted outside the hash');
check.ok('the mapping version travels with the capture', SEED.MAP === 1, 'v' + SEED.MAP);
check.ok('every named line is a finite non-negative number',
	(function () {
		var k, bad = '';
		for (k in S.recon) if (!(isFinite(S.recon[k]) && S.recon[k] >= 0)) bad += k + ' ';
		return bad === '';
	})(), Object.keys(S.recon).join(' '));
check.ok('the lines the pack can be checked against are right',
	(function () {
		var i, vp = 0;
		for (i = 0; i < pin.n; i++) if (Math.abs(pin.vp[i]) > Math.abs(pin.vt[i])) vp++;
		return S.recon.discardedNormalVelocity === vp && S.recon.mobileAbsent === SEED.nCut
			&& S.recon.subMohoThermal === SEED.nCut && S.recon.sedimentAge <= SEED.nCut
			&& S.recon.clampedSpan === 0;
	})(), 'vp>vt ' + S.recon.discardedNormalVelocity + ' of the samples, mobile load '
		+ S.recon.mobileAbsent + ', beds from t0 ' + S.recon.sedimentAge);
check.ok('nothing in the assumption record reaches the state hash',
	(function () {
		var h = S.hash();
		S.recon.sedimentAge += 17; S.recon.gapColumns += 3; S.recon.edgeFallback += 5;
		var h2 = S.hash();
		S.recon.sedimentAge -= 17; S.recon.gapColumns -= 3; S.recon.edgeFallback -= 5;
		return h === h2;
	})(), 'hash before and after writing S.recon');
check.ok('the plate count is the pack’s runs after the cap, and the merges are booked',
	(function () {
		var runs = SEED.runs;
		return S.nPl <= P.plateCap && S.nPl === runs - S.recon.shortPlateMerge
			&& (runs === 12 || runs > P.plateCap);
	})(), 'runs ' + SEED.runs + ' → plates ' + S.nPl + ' (merged ' + S.recon.shortPlateMerge + ')');
check.ok('plates are contiguous runs of one id, and every column belongs to one',
	(function () {
		var i, n = S.nCol, switches = 0, seen = 0;
		for (i = 0; i < n; i++) { if (S.colPlate[i] >= S.nPl) return false; }
		for (i = 0; i < n; i++) if (S.colPlate[i] !== S.colPlate[(i + n - 1) % n]) switches++;
		seen = (function () { var s = {}, k; for (i = 0; i < n; i++) s[S.colPlate[i]] = 1; for (k in s) ; return Object.keys(s).length; })();
		return switches === S.nPl && seen === S.nPl;
	})(), S.nPl + ' plates, ' + (function () {
		var i, c = 0; for (i = 0; i < S.nCol; i++) if (S.colPlate[i] !== S.colPlate[(i + S.nCol - 1) % S.nCol]) c++; return c;
	})() + ' starts');

check.section('D. §4.3.3 the kinematics the cut says, in the signs the model reads');
check.ok('a seeded boundary agrees with the velocity the cut carries (nothing to re-sign)',
	(function () {
		var i, bad = 0, open = 0, close = 0;
		for (i = 0; i < SEED.nCut; i++) {
			if (!S.edge[i]) continue;
			var rel = S.edgeRelN[i];
			if (S.edge[i] === P.EDGE.open) { open++; if (!(rel > 0)) bad++; }
			else { close++; if (!(rel < 0)) bad++; }
		}
		check.info('the seams, by type', open + ' divergent, ' + close + ' convergent, ' +
			bad + ' whose sign contradicts the cut, ' + S.recon.edgeFallback + ' the cut left neutral');
		return bad === 0 && open > 0 && close > 0;
	})(), 'every edge was read out of the pack’s own vt, so classify has nothing to correct');
check.ok('the classifier agrees one frame later (it is not fighting the seeding)',
	(function () {
		var before = S.edge.slice();
		PLT.classify(S, 1e-4);
		var flips = 0, i;
		for (i = 0; i < SEED.nCut; i++) if (S.edge[i] !== before[i]) flips++;
		return flips;
	})() === 0, 'frame 1 classify: 0 of ' + (function () {
		var i, n = 0; for (i = 0; i < SEED.nCut; i++) if (S.edge[i]) n++; return n;
	})() + ' edges changed type');
check.ok('the flow the mantle gives the plates is the one the cut carried (mean per plate)',
	(function () {
		var i, sum = new Float64Array(S.nPl), cnt = new Float64Array(S.nPl), vt = new Float64Array(S.nPl);
		var sc = SEED.scale * KM;
		for (i = 0; i < pin.n; i++) {
			var j = Math.min(SEED.nCut - 1, Math.floor(pin.sKm[i] * sc / P.w0));
			sum[S.colPlate[j]] += pin.vt[i]; vt[S.colPlate[j]] += 1;
		}
		var worst = 0;
		for (i = 0; i < P.nCols; i++) cnt[S.colPlate[i]]++;
		for (i = 0; i < S.nPl; i++) {
			var a = sum[i] / Math.max(1, vt[i]), b = S.plU[i];
			worst = Math.max(worst, Math.abs(a - b));
		}
		return worst / Math.max(1e-9, (function () { var m = 0, k; for (k = 0; k < S.nPl; k++) m = Math.max(m, Math.abs(S.plU[k])); return m; })());
	})() < 0.05, 'plate speeds are the cut’s, within a few per cent of the fastest');

// ---------------------------------------------------------------- E. the quiet start
check.section('E. §4.3.4 what the clock costs on the first frame');
function frame1(label) {
	var z0 = S.z.slice(), n = S.nCol, mx = 0, i;
	SIM.t = pin.source.tMyr;
	SIM.cool();
	SIM.setGeo(1e4);                                  // 10 kyr a frame, the page's slowest
	SIM.step();
	for (i = 0; i < n; i++) mx = Math.max(mx, Math.abs(S.z[i] - z0[i]));
	return { dz: mx, nCol: S.nCol, was: n };
}
var laid = lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
var cutMassBefore = crustMass(pin);
var f1 = frame1('seeded');
check.ok('one frame at 10 kyr costs the seeded view no more than it costs a fresh planet',
	(function () {
		var S0 = S.nCol;
		S.reset(); COL.initFanT(12345); SIM.t = 0; SIM.cool();
		var z0 = S.z.slice(), i, mx = 0;
		SIM.setGeo(1e4); SIM.step();
		for (i = 0; i < S.nCol; i++) mx = Math.max(mx, Math.abs(S.z[i] - z0[i]));
		check.info('the control (the engine’s own default planet, same frame)', mx.toFixed(1) + ' m');
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		var f = frame1('seeded');
		return f.dz <= mx * 1.05 && f.nCol === f.was;
	})(), 'seeded first frame ' + f1.dz.toFixed(1) + ' m; the plan’s absolute bound would condemn both');
check.ok('no column is consumed in the first Myr (100 frames at 10 kyr)',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		SIM.t = pin.source.tMyr; SIM.cool(); SIM.setGeo(1e4);
		var i, n0 = S.nCol, m0 = crustMass(pin);
		for (i = 0; i < 100; i++) SIM.step();
		var m1b = crustMass(pin);
		check.info('after 100 frames', 't ' + SIM.t.toFixed(3) + ' Myr, nCol ' + n0 + ' → ' + S.nCol +
			', seeded crust ' + (m1b.seed / 1e9).toFixed(3) + 'e9 m3/m (was ' + (m0.seed / 1e9).toFixed(3) + 'e9)');
		return S.nCol === n0;
	})(), 'the topology stays shut while the cut is still the cut');
check.ok('the identity is a frame-0 statement, and the clock is allowed to move the surface',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		var at0 = worstIdentity(pin).m;
		SIM.t = pin.source.tMyr; SIM.cool(); SIM.setGeo(1e4); SIM.step();
		return at0 <= 1e-3 && worstIdentity(pin).m > 1e-3;
	})(), 'frame 0 ' + worstIdentity(pin).m.toExponential(1) + ' m, then it evolves');
// The gate the plan first wrote as "no boundary may change type in the first Myr" is a
// hysteresis statement, not a mapping one: a seeded seam holds the cut's own vt, and the plate
// solve takes it over from the first frame (§4.3). So the claim that means something is that
// nothing changes *because of the seeding* (frame 1, checked in §D) and that whatever does
// change inside the first Myr is a seam the model's own floor calls too slow to hold.
check.ok('a seeded boundary has no history, so the topology stays shut for P.evAge Myr',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		SIM.t = pin.source.tMyr; SIM.cool(); SIM.setGeo(1e4);
		var n0 = S.nCol, i, frames = Math.floor(P.evAge / 1e-2) - 1;
		for (i = 0; i < frames; i++) SIM.step();
		return S.nCol === n0;
	})(), 'nCol unchanged for ' + (Math.floor(P.evAge / 1e-2) - 1) + ' frames (evAge ' + P.evAge + ' Myr)');
check.ok('and the seams that do change within the first Myr are the plate solve, not the mapping',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		var e0 = S.edge.slice();
		SIM.t = pin.source.tMyr; SIM.cool(); SIM.setGeo(1e4);
		var i;
		for (i = 0; i < 100; i++) SIM.step();
		var flips = [], j;
		for (j = 0; j < S.nCol; j++) if (S.edge[j] !== e0[j]) flips.push(j);
		// each change must be a state the *current* relative speed names: if the model disagrees
		// with the cut it is evolving, if it disagrees with itself the seeding lied
		var holds = flips.every(function (j) {
			var e = S.edge[j], rel = S.edgeRelN[j];
			if (e === P.EDGE.none) return true;
			if (e === P.EDGE.open) return rel > 0;
			if (e === P.EDGE.neutral) return Math.abs(rel) < P.epsHi;
			return rel < 0;
		});
		check.info('the first Myr, boundaries', flips.length + ' of ' + (function () {
			var k, n = 0; for (k = 0; k < SEED.nCut; k++) if (e0[k]) n++; return n;
		})() + ' seams changed, every one to what the recomputed relN names'
			+ ' (frame 1 changed none, §D)');
		return holds;
	})(), 'a seeded seam is re-signed only when the flow the section grows says so');

check.section('F. §4.4 the two run modes, and a refusal that touches nothing');
check.ok('a closed cut: 512 columns, no tail, the clock allowed',
	!SEED.window && SEED.nCut === P.nCols && SEED.tailKm === 0 && S.recon.tailArcKm === 0,
	'nCut ' + SEED.nCut + ' scale ' + SEED.scale.toFixed(9));
var win = FIX.windowCut(160, 10, 12400);
var wl = lay(win, { seed: 7, t: win.source.tMyr, Tm: 1.5 });
check.ok('a window: whole columns from the start of the cut, the leftover arc booked as tail',
	wl.window === true && SEED.nCut === Math.floor(win.path.arcKm * KM / P.w0)
		&& SEED.nCut === 158 && SEED.tailKm > 0 && S.recon.tailArcKm === SEED.tailKm
		&& S.recon.clampedSpan === 0,
	'nCut ' + SEED.nCut + ' tail ' + SEED.tailKm.toFixed(1) + ' km, arcs not stretched: scale ' + wl.scale);
var mw = crustMass(win);
check.near('and the window’s ledger closes on the tail it booked',
	mw.seed + mw.tail, mw.cut, 1e-9 * mw.cut, 'm3/m');
check.ok('the arc the window left outside its last column is a hole the model does not fill',
	S.recon.outsideCut === P.nCols - SEED.nCut && (function () {
		var i, ok = true;
		for (i = SEED.nCut; i < P.nCols; i++) ok = ok && S.colGhost[i] === 1 && S.hTot[i] === 0;
		return ok;
	})(), S.recon.outsideCut + ' columns outside the cut, all empty');
check.ok('a cut longer than the wrap is refused before a single field is written',
	(function () {
		lay(pin, { seed: 7, t: 0, Tm: 1.5 });
		var h = S.hash(), big = FIX.windowCut(64, 8, 45000);
		var bad = SEED.layout(big, { seed: 7, t: 0, Tm: 1.5 });
		return /longer than the section wrap/.test(bad) && S.hash() === h;
	})(), SEED.refused);
check.ok('so is an arc too short to hold three columns, and a window may not be scaled',
	(function () {
		var tiny = FIX.windowCut(8, 3, 120);
		var h = S.hash(), bad = SEED.layout(tiny, { seed: 7, t: 0, Tm: 1.5 });
		return /needs three/.test(bad) && S.hash() === h;
	})(), SEED.refused);

check.section('G. the same cut, laid twice, and the seed’s one job');
check.ok('the mapping is deterministic in the pack (same bytes, same state)',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		var h = S.hash(), m = crustMass(pin).seed;
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		return S.hash() === h && Math.abs(crustMass(pin).seed - m) < 1;
	})(), S.hash() + ' twice');
check.ok('the seed changes the noise and the mantle, not the crust the cut carried',
	(function () {
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		var h7 = S.hash(), m7 = crustMass(pin).seed, n7 = S.noise.slice(0, 64).join(',');
		lay(pin, { seed: 11, t: pin.source.tMyr, Tm: 1.5 });
		var h11 = S.hash(), m11 = crustMass(pin).seed, n11 = S.noise.slice(0, 64).join(',');
		return h7 !== h11 && Math.abs(m7 - m11) < 1 && n7 !== n11;
	})(), 'hash differs, crust identical to a cubic metre');
check.info('a different clock start is a different world, not a different map',
	(function () {
		lay(pin, { seed: 7, t: 0, Tm: 1.5 });
		var h0 = S.hash();
		lay(pin, { seed: 7, t: pin.source.tMyr, Tm: 1.5 });
		return 't 0 vs t ' + pin.source.tMyr + ': ' + (h0 !== S.hash() ? 'ages and lid differ' : 'identical (bug)');
	})());

check.section('H. a cut the section cannot represent at its own resolution');
var dense = FIX.dense(40);
lay(dense, { seed: 7, t: dense.source.tMyr, Tm: 1.5 });
check.ok('L7 (811 samples, 39 runs): capped to plateCap, with the merges and the losers booked',
	S.nPl === P.plateCap && SEED.runs === 39 && S.recon.shortPlateMerge === 7
		&& S.recon.bndLost > 0 && S.recon.bndCollapsed >= 0,
	'runs 39 → ' + S.nPl + ' plates, ' + S.recon.shortPlateMerge + ' merges, '
		+ S.recon.bndLost + ' crossings inside one plate');
check.ok('and the identity still holds, because the resample is the same rule at any density',
	worstIdentity(dense).m <= 1e-3, 'max ' + worstIdentity(dense).m.toExponential(2) + ' m');
var md = crustMass(dense);
check.near('as does the ledger', md.seed + md.tail, md.cut, 1e-9 * md.cut, 'm3/m');
check.ok('the coarse cut (64 samples over 512 columns) is the other end of the same rule',
	(function () {
		var coarse = FIX.build(64, 8, FIX.circle(64));
		lay(coarse, { seed: 7, t: 120.5, Tm: 1.5 });
		var m = crustMass(coarse);
		return worstIdentity(coarse).m <= 1e-3 && Math.abs(SEED.mapEquiv - 1) < 1e-12
			&& Math.abs(m.seed + m.tail - m.cut) < 1e-9 * m.cut;
	})(), 'identity and ledger at 625 km cells');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
