// experiments/pt-faces-guard-census.js — 0.3.2 M12: unified attribution harness for the
// three open items remaining at the close of 0.3.2 M11 across the 600 Myr distribution
// worlds (seeds 1, 3, 5, 7 x {bound, unbound}):
//
//   1. Repair-adjacent held deposit minority & G.reseed relocation census:
//      reconciles M6's heldJoin windows (where JS `null >= 0` coerced never-relocated
//      parcels into `ever` and `<= 1f`) against the true `never` vs `<= 1, 3, 10, 30, 100f`
//       and `> 100f` partition, and measures the full G.reseed donor relocation population
//      by phase, ring radius (r <= 2, 8, 32), field temperature jump, and same-frame
//      depBound absorption.
//   2. Non-deposit thermal faces (`mantle-cold` below -0.5, `mobile-melt-hot` above 1.5):
//      carrier IDs, excursion counts, mass / erosion / melt-split history, depth bands,
//      parcel-to-field gaps, adjoint gather gain (cw = mu_k / W_k) and stencil mass share,
//      raw conduction gather (di_) vs depBound stencil placement (bdGiven) decomposition,
//      and mobile-melt birth provenance (mantle-split vs dep-split vs whole conversion).
//   3. Contact guard finite-sweep residue (`S.d.resid > 0` after `P.ctSweep = 3`):
//      push/residue frame and pair counts, worst surviving `d / contactHard` ratio,
//      topological attribution (multi-pair sandwiched markers `deg >= 2` vs surface
//      reflection), and read-only scratch sweep count to clear (`sweepsToClear`).
//
// Every hook is strictly read-only with respect to engine state: running this harness
// produces bitwise-identical `S.hash()` fingerprints to the unhooked engine and to the
// M6/M8 600 Myr reference banks.
//
// Usage:
//   node experiments/pt-faces-guard-census.js [options]
//     --seed <n>        world seed (default 5)
//     --myr <n>         integration horizon in Myr (default 600)
//     --kyr <n>         clock step in kyr (default 50)
//     --dep-bound <x>   override P.depBound (0 for unbound baseline, 0.25 for landed)
//     --out <path>      write full JSON report to path
'use strict';

var fs = require('fs');
var path = require('path');
var P = require('../js/pt/params.js');
var S = require('../js/pt/state.js');
var G = require('../js/pt/grid.js');
var PH = require('../js/pt/phase.js');
var POOL = require('../js/pt/pool.js');
var MT = require('../js/pt/melt.js');
var ERODE = require('../js/pt/erode.js');
var CONTACT = require('../js/pt/contact.js');
var SIM = require('../js/pt/sim.js');
var M = SIM.M;

var argv = process.argv.slice(2);
function flag(name) { return argv.indexOf(name) >= 0; }
function arg(name, def) {
	var i = argv.indexOf(name);
	return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : def;
}

var SEED = +arg('--seed', 5);
var MYR = +arg('--myr', 600);
var KYR = +arg('--kyr', 50);
var OUT = arg('--out', '');
var HAS_DB = flag('--dep-bound');
var DEP_BOUND = HAS_DB ? +arg('--dep-bound', 0.25) : P.depBound;

var PH_NAMES = ['mantle', 'melt', 'air', 'dep'];
var T_FLOOR = -0.5, T_CEIL = 1.5;
var JOIN_WIN = [1, 3, 10, 30, 100];
var DEPTH_BANDS = [0, 50, 120, 250, 500, 1000, 2000, 3000];
var ID_CAP = 1 << 21;

function spl(u) {
	var a = u < 0 ? -u : u;
	return a < 0.5 ? 0.75 - a * a : a < 1.5 ? 0.5 * (1.5 - a) * (1.5 - a) : 0;
}

// Read-only adjoint gain and stencil mass share at marker p (exact M3 §9.2 formula)
var _gain = 0, _share = 0;
function gainShareAt(p) {
	var nx = M.nx, ny = M.ny, cw = M.cw, w = M.w, m = S.m[p];
	var px = S.x[p] / M.dx, ic = Math.round(px), pe = S.e[p] / M.dEta, jc = Math.round(pe);
	var num = 0, den = 0, part = 0, di, dj, ii, jj, wx, we, ww, q;
	px -= ic; pe -= jc;
	var wxm = spl(-1 - px), wx0 = spl(-px), wxp = spl(1 - px);
	var wem = spl(-1 - pe), we0 = spl(-pe), wep = spl(1 - pe);
	for (dj = -1; dj <= 1; dj++) {
		jj = jc + dj;
		if (jj < 1 || jj > ny - 1) continue;
		we = dj === -1 ? wem : dj === 0 ? we0 : wep;
		for (di = -1; di <= 1; di++) {
			ii = ic + di; ii -= Math.floor(ii / nx) * nx;
			wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
			ww = wx * we;
			if (!(ww > 0)) continue;
			q = jj * nx + ii;
			num += ww * cw[q]; den += ww;
			if (w[q] > 0) part += ww * (ww * m / w[q]);
		}
	}
	_gain = den > 0 ? num / den : 0;
	_share = den > 0 ? part / den : 0;
}

// Read-only raw gather increment `d` at marker p before depBound capping (exact G.gatherDT formula)
function rawGatherAt(p, inc, Tg, flip, hOld) {
	if (!P.PH_GRID[S.ph[p]]) return 0;
	var nx = M.nx, cw = M.cw, di, dj, jj, ii, ic, jc, px, pe, wsum, q;
	px = S.x[p] / M.dx; ic = Math.round(px); px -= ic;
	pe = S.e[p] / M.dEta; jc = Math.round(pe); pe -= jc;
	var wxm = spl(-1 - px), wx0 = spl(-px), wxp = spl(1 - px);
	var wem = spl(-1 - pe), we0 = spl(-pe), wep = spl(1 - pe);
	var di_ = 0, tg = 0;
	for (dj = -1; dj <= 1; dj++) {
		jj = jc + dj;
		if (jj < 1 || jj > M.ny - 1) continue;
		var we = dj === -1 ? wem : dj === 0 ? we0 : wep;
		var base = jj * nx;
		for (di = -1; di <= 1; di++) {
			ii = ic + di; ii -= Math.floor(ii / nx) * nx;
			var wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
			wsum = wx * we * cw[base + ii];
			q = base + ii;
			di_ += wsum * inc[q];
			if (flip < 1) tg += wsum * Tg[q];
		}
	}
	if (flip < 1) {
		var out = PH.byT(tg, S.y[p], S.cF[p], S.cW[p]);
		return flip * di_ + (1 - flip) * (out.h - hOld);
	}
	return di_;
}

// Per-parcel history arrays indexed by material ID
var lastMove = new Int32Array(ID_CAP);
var lastMoveRing = new Uint8Array(ID_CAP);
var lastMoveDT = new Float32Array(ID_CAP);
var moveCount = new Uint16Array(ID_CAP);

var initMass = new Float32Array(ID_CAP);
var eroSteps = new Uint16Array(ID_CAP);
var eroLost = new Float32Array(ID_CAP);
var splitSteps = new Uint16Array(ID_CAP);
var splitLost = new Float32Array(ID_CAP);

// Per-parcel cumulative gather attribution while T < 0 (for mantle-cold) and overall
var cumRawDi = new Float64Array(ID_CAP);
var cumBdGiven = new Float64Array(ID_CAP);
var negRawDi = new Float64Array(ID_CAP);
var negBdGiven = new Float64Array(ID_CAP);

// Mobile-melt birth provenance:
//   mode: 1 = mantle-split, 2 = dep-split, 3 = mantle-whole, 4 = dep-whole
var meltBirthMode = new Uint8Array(ID_CAP);
var meltBirthFrame = new Int32Array(ID_CAP);
var meltBirthY = new Float32Array(ID_CAP);
var meltBirthM = new Float32Array(ID_CAP);
var meltBirthT = new Float32Array(ID_CAP);
var meltBirthField = new Float32Array(ID_CAP);

var frame = 0;

function movedAge(p) {
	var id = S.id[p];
	var lm = (id >= 0 && id < ID_CAP) ? lastMove[id] : 0;
	return lm > 0 ? frame - lm : null;
}

// ── Section 1: heldJoin (M6 exact vs True null-separated) & G.reseed census ──
var heldSamples = 0, heldMassMyr = 0;

// M6-compatible accumulators (reproducing `age >= 0` where `null >= 0` is true)
var hjM6WinN = [0, 0, 0, 0, 0];
var hjM6WinMass = [0, 0, 0, 0, 0];
var hjM6WinGapMax = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
var hjM6EverN = 0, hjM6EverMass = 0, hjM6EverGapMax = -Infinity;
var hjM6NeverN = 0, hjM6NeverMass = 0, hjM6NeverGapMax = -Infinity;

// True null-separated accumulators (`age === null` -> never, `age !== null` -> ever)
var hjTrueWinN = [0, 0, 0, 0, 0];
var hjTrueWinMass = [0, 0, 0, 0, 0];
var hjTrueWinGapMax = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
var hjTrueEverN = 0, hjTrueEverMass = 0, hjTrueEverGapMax = -Infinity;
var hjTrueNeverN = 0, hjTrueNeverMass = 0, hjTrueNeverGapMax = -Infinity;
var hjTrueSettledN = 0, hjTrueSettledMass = 0, hjTrueSettledGapMax = -Infinity;
// Ring breakdown for held samples truly within 100 frames of a move (rings 2, 8, 32)
var hjRing100N = [0, 0, 0], hjRing100Mass = [0, 0, 0];

function hjAddBoth(age, mass, gap, ringIdx) {
	var i, mdt = mass * (KYR * 1e-3);
	// 1. M6 exact formula (`age >= 0` coerces null -> 0)
	if (age >= 0) {
		hjM6EverN++; hjM6EverMass += mdt;
		if (gap > hjM6EverGapMax) hjM6EverGapMax = gap;
		for (i = 0; i < JOIN_WIN.length; i++) {
			if (age <= JOIN_WIN[i]) {
				hjM6WinN[i]++;
				hjM6WinMass[i] += mdt;
				if (gap > hjM6WinGapMax[i]) hjM6WinGapMax[i] = gap;
			}
		}
	} else {
		hjM6NeverN++; hjM6NeverMass += mdt;
		if (gap > hjM6NeverGapMax) hjM6NeverGapMax = gap;
	}
	// 2. True formula (`age !== null`)
	if (age !== null && age >= 0) {
		hjTrueEverN++; hjTrueEverMass += mdt;
		if (gap > hjTrueEverGapMax) hjTrueEverGapMax = gap;
		for (i = 0; i < JOIN_WIN.length; i++) {
			if (age <= JOIN_WIN[i]) {
				hjTrueWinN[i]++;
				hjTrueWinMass[i] += mdt;
				if (gap > hjTrueWinGapMax[i]) hjTrueWinGapMax[i] = gap;
			}
		}
		if (age <= 100 && ringIdx >= 0 && ringIdx < 3) {
			hjRing100N[ringIdx]++;
			hjRing100Mass[ringIdx] += mdt;
		}
		if (age > 100) {
			hjTrueSettledN++;
			hjTrueSettledMass += mdt;
			if (gap > hjTrueSettledGapMax) hjTrueSettledGapMax = gap;
		}
	} else {
		hjTrueNeverN++; hjTrueNeverMass += mdt;
		if (gap > hjTrueNeverGapMax) hjTrueNeverGapMax = gap;
	}
}

// Direct G.reseed relocation census
var reseedTotal = 0;
var reseedByPhase = [0, 0, 0, 0];
var reseedByRing = [0, 0, 0]; // r<=2, 2<r<=8, 8<r<=32
var reseedDepByRing = [0, 0, 0];
var reseedAbsFieldJumpSum = [0, 0, 0, 0], reseedAbsFieldJumpMax = [0, 0, 0, 0];
var reseedPostGapSum = [0, 0, 0, 0], reseedPostGapMax = [0, 0, 0, 0];
var reseedPostOver025 = [0, 0, 0, 0];
var reseedDepSameFrameCapped = 0;
var movedDepSlotsFrame = [];

// ── Hooks Installation ──
var mvX = new Float64Array(P.partCap);
var mvY = new Float64Array(P.partCap);
var mvE = new Float64Array(P.partCap);
var origReseed = G.reseed;
G.reseed = function (M_, S_, force) {
	if (frame === 0) { origReseed.call(G, M_, S_, force); return; }
	var n = S_.n, p, id, ph, dx, dy, di, dj, rad, rIdx, tOld, tNew, dTf, gap;
	for (p = 0; p < n; p++) {
		mvX[p] = S_.x[p]; mvY[p] = S_.y[p]; mvE[p] = S_.e[p];
	}
	origReseed.call(G, M_, S_, force);
	movedDepSlotsFrame.length = 0;
	for (p = 0; p < S_.n; p++) {
		if (S_.x[p] !== mvX[p] || S_.e[p] !== mvE[p]) {
			id = S_.id[p];
			ph = S_.ph[p];
			dx = Math.abs(S_.x[p] - mvX[p]);
			if (dx > 0.5 * M_.wrap) dx = M_.wrap - dx;
			dy = Math.abs(S_.y[p] - mvY[p]);
			di = Math.round(dx / M_.dx);
			dj = Math.round(Math.abs(S_.e[p] - mvE[p]) / M_.dEta);
			rad = di > dj ? di : dj;
			rIdx = rad <= 2 ? 0 : (rad <= 8 ? 1 : 2);
			tOld = G.sampleAt(M_, S_.Tg, mvX[p], mvE[p]);
			tNew = G.sampleAt(M_, S_.Tg, S_.x[p], S_.e[p]);
			dTf = Math.abs(tNew - tOld);
			gap = Math.abs(S_.T[p] - tNew);

			reseedTotal++;
			reseedByPhase[ph]++;
			reseedByRing[rIdx]++;
			if (ph === P.PH.dep) reseedDepByRing[rIdx]++;
			reseedAbsFieldJumpSum[ph] += dTf;
			if (dTf > reseedAbsFieldJumpMax[ph]) reseedAbsFieldJumpMax[ph] = dTf;
			reseedPostGapSum[ph] += gap;
			if (gap > reseedPostGapMax[ph]) reseedPostGapMax[ph] = gap;
			if (gap > 0.25) {
				reseedPostOver025[ph]++;
				if (ph === P.PH.dep) movedDepSlotsFrame.push(p);
			}
			if (id >= 0 && id < ID_CAP) {
				lastMove[id] = frame;
				lastMoveRing[id] = rIdx + 1;
				lastMoveDT[id] = tNew - tOld;
				if (moveCount[id] < 65535) moveCount[id]++;
			}
		}
	}
};

// Gather hook: separates raw conduction increment `rawDi` from `depBound` 3x3 placement `bdGiven`
var preGatherH = new Float64Array(P.partCap);
var origGatherDT = G.gatherDT;
G.gatherDT = function (M_, S_, inc, Tg, flip) {
	var n = S_.n, cap0 = S_.bdCap, p, id, totDH, rDi, bd, k, ph;
	for (p = 0; p < n; p++) preGatherH[p] = S_.H[p];
	origGatherDT.call(G, M_, S_, inc, Tg, flip);
	var hadCap = S_.bdCap > cap0;
	for (p = 0; p < n; p++) {
		ph = S_.ph[p];
		if (ph === P.PH.mantle) {
			if (!(S_.H[p] < 0 || preGatherH[p] < 0)) continue;
			id = S_.id[p];
			if (id < 0 || id >= ID_CAP) continue;
			totDH = S_.H[p] - preGatherH[p];
			rDi = hadCap ? rawGatherAt(p, inc, Tg, flip, preGatherH[p]) : totDH;
			bd = totDH - rDi;
			negRawDi[id] += rDi;
			negBdGiven[id] += bd;
		} else if (ph === P.PH.melt) {
			id = S_.id[p];
			if (id < 0 || id >= ID_CAP) continue;
			totDH = S_.H[p] - preGatherH[p];
			rDi = hadCap ? rawGatherAt(p, inc, Tg, flip, preGatherH[p]) : totDH;
			bd = totDH - rDi;
			cumRawDi[id] += rDi;
			cumBdGiven[id] += bd;
		}
	}
	if (hadCap) {
		for (k = 0; k < movedDepSlotsFrame.length; k++) {
			p = movedDepSlotsFrame[k];
			if (p < n) {
				rDi = rawGatherAt(p, inc, Tg, flip, preGatherH[p]);
				if (Math.abs((S_.H[p] - preGatherH[p]) - rDi) > 1e-12) {
					reseedDepSameFrameCapped++;
				}
			}
		}
	}
};

// POOL.separate hook: records mantle split mass loss and mobile-melt birth provenance
var origSeparate = POOL.separate;
POOL.separate = function (S_, p, dep) {
	var mBefore = S_.m[p], idHost = S_.id[p];
	var q = origSeparate.call(POOL, S_, p, dep);
	if (q >= 0) {
		var mq = S_.m[q], idChild = S_.id[q];
		if (!dep && idHost >= 0 && idHost < ID_CAP) {
			if (splitSteps[idHost] < 65535) splitSteps[idHost]++;
			splitLost[idHost] += (mBefore - S_.m[p]);
		}
		if (idChild >= 0 && idChild < ID_CAP) {
			meltBirthMode[idChild] = dep ? 2 : 1;
			meltBirthFrame[idChild] = frame;
			meltBirthY[idChild] = S_.y[q];
			meltBirthM[idChild] = mq;
			meltBirthT[idChild] = S_.T[q];
			meltBirthField[idChild] = G.sampleAt(M, S_.Tg, S_.x[q], S_.e[q]);
		}
	}
	return q;
};

// MT.detach hook: observes held-back deposits (for heldJoin) and whole-parcel melt conversions
var preDetachPh = new Uint8Array(P.partCap);
var origDetach = MT.detach;
MT.detach = function (M_, S_) {
	var ph = S_.ph, ml = S_.melt, hold = P.meltHold, nPre = S_.n, p, Tg, Ts, age, id, rIdx;
	for (p = 0; p < nPre; p++) {
		preDetachPh[p] = ph[p];
		if (ph[p] !== P.PH.dep) continue;
		if (ml[p] < hold) continue;
		if (!(S_.depQ[p] && S_.y[p] > P.depositCoolDepth)) continue;
		Tg = G.sampleAt(M_, S_.Tg, S_.x[p], S_.e[p]);
		Ts = PH.solidus(S_.y[p], S_.cF[p], S_.cW[p]);
		if (Tg < Ts) {
			heldSamples++;
			heldMassMyr += S_.m[p] * (KYR * 1e-3);
			age = movedAge(p);
			id = S_.id[p];
			rIdx = (id >= 0 && id < ID_CAP && lastMoveRing[id] > 0) ? (lastMoveRing[id] - 1) : -1;
			hjAddBoth(age, S_.m[p], S_.T[p] - Tg, rIdx);
		}
	}
	origDetach.call(MT, M_, S_);
	for (p = 0; p < nPre && p < S_.n; p++) {
		if (preDetachPh[p] !== P.PH.melt && ph[p] === P.PH.melt) {
			id = S_.id[p];
			if (id >= 0 && id < ID_CAP) {
				meltBirthMode[id] = preDetachPh[p] === P.PH.dep ? 4 : 3;
				meltBirthFrame[id] = frame;
				meltBirthY[id] = S_.y[p];
				meltBirthM[id] = S_.m[p];
				meltBirthT[id] = S_.T[p];
				meltBirthField[id] = G.sampleAt(M_, S_.Tg, S_.x[p], S_.e[p]);
			}
		}
	}
};

// ERODE.run hook: tracks cumulative surface weathering mass removed from each mantle carrier
var preEroM = new Float64Array(P.partCap);
var origErodeRun = ERODE.run;
ERODE.run = function (M_, S_, dt) {
	var n = S_.n, p, id, dm;
	for (p = 0; p < n; p++) preEroM[p] = S_.m[p];
	origErodeRun.call(ERODE, M_, S_, dt);
	for (p = 0; p < S_.n && p < n; p++) {
		if (S_.ph[p] === P.PH.mantle && S_.m[p] < preEroM[p] - 1e-12) {
			id = S_.id[p];
			if (id >= 0 && id < ID_CAP) {
				dm = preEroM[p] - S_.m[p];
				if (eroSteps[id] < 65535) eroSteps[id]++;
				eroLost[id] += dm;
			}
		}
	}
};

// ── Section 4: CONTACT.guard finite-sweep residue attribution ──
var guardPushFrames = 0, guardTotalPushes = 0;
var guardResidFrames = 0, guardResidPairs = 0;
var guardResidSandwichFrames = 0, guardResidSandwichPairs = 0;
var guardResidReflectedFrames = 0, guardResidReflectedPairs = 0;
var guardWorstRatio = 1.0, guardWorstEvent = null;
var guardMaxSweepsToClear = 0;
var guardSweepsHist = {}; // sweepsToClear -> count of residue frames
var guardResidEvents = [];

// Scratch buffers for read-only guard replay on residue frames
var scX = new Float64Array(P.partCap);
var scY = new Float64Array(P.partCap);
var scE = new Float64Array(P.partCap);
var preGuardX = new Float64Array(P.partCap);
var preGuardY = new Float64Array(P.partCap);
var preGuardE = new Float64Array(P.partCap);
var degTouch = new Uint16Array(P.partCap);
var reflTouch = new Uint8Array(P.partCap);

function scratchKeepInside(p) {
	var hit = 0;
	if (scX[p] < 0 || scX[p] >= M.wrap) {
		scX[p] -= Math.floor(scX[p] / M.wrap) * M.wrap;
		if (scX[p] >= M.wrap) scX[p] = 0;
	}
	if (scE[p] < M.eMin) {
		scE[p] = 2 * M.eMin - scE[p];
		if (scE[p] > M.eMax) scE[p] = M.eMin;
		scY[p] = M.yLin * Math.sinh(scE[p]);
		hit = 1;
	} else if (scE[p] > M.eMax) {
		scE[p] = 2 * M.eMax - scE[p];
		if (scE[p] < M.eMin) scE[p] = M.eMax;
		scY[p] = M.yLin * Math.sinh(scE[p]);
		hit = 1;
	}
	return hit;
}

function scratchSweep(hard, move, trackDeg) {
	var nx = M.nx, wrap = M.wrap, K = P.ctTop;
	var ctCl = S.ctCl, ctP = S.ctP, ctN = S.ctN;
	var h2 = hard * hard * (1 - 1e-12), n = 0;
	var i, ip, bA, bB, nA, nB, a, b, p, q, dx, dy, d2, d, push, ux, uy;
	for (i = 0; i < nx; i++) {
		ip = (i + 1) % nx;
		bA = i * K; bB = ip * K;
		nA = ctN[i]; nB = ctN[ip];
		if (!nA || !nB) continue;
		for (a = 0; a < nA; a++) {
			p = ctP[bA + a];
			for (b = 0; b < nB; b++) {
				if (ctCl[bA + a] === ctCl[bB + b]) continue;
				q = ctP[bB + b];
				dx = scX[q] - scX[p];
				dx -= Math.floor(dx / wrap + 0.5) * wrap;
				dy = scY[q] - scY[p];
				d2 = dx * dx + dy * dy;
				if (d2 >= h2) continue;
				n++;
				if (trackDeg) { degTouch[p]++; degTouch[q]++; }
				if (!move) continue;
				d = Math.sqrt(d2);
				if (d > 1e-9) { ux = dx / d; uy = dy / d; }
				else { ux = dx >= 0 ? 1 : -1; uy = 0; }
				push = 0.5 * (hard - d);
				scX[p] -= ux * push; scX[q] += ux * push;
				scY[p] -= uy * push; scY[q] += uy * push;
				scE[p] = Math.asinh(scY[p] / M.yLin);
				if (scratchKeepInside(p) && trackDeg) reflTouch[p] = 1;
				scE[q] = Math.asinh(scY[q] / M.yLin);
				if (scratchKeepInside(q) && trackDeg) reflTouch[q] = 1;
			}
		}
	}
	return n;
}

var origGuard = CONTACT.guard;
CONTACT.guard = function (M_, S_) {
	var nx = M_.nx, K = P.ctTop, ctN = S_.ctN, ctP = S_.ctP, ctCl = S_.ctCl;
	var i, a, p, s;
	for (i = 0; i < nx; i++) {
		for (a = 0; a < ctN[i]; a++) {
			p = ctP[i * K + a];
			preGuardX[p] = S_.x[p];
			preGuardY[p] = S_.y[p];
			preGuardE[p] = S_.e[p];
		}
	}
	origGuard.call(CONTACT, M_, S_);
	if (S_.d.push > 0) {
		guardPushFrames++;
		guardTotalPushes += S_.d.push;
	}
	if (S_.d.resid > 0) {
		guardResidFrames++;
		guardResidPairs += S_.d.resid;
		var hard = P.contactHard * M_.dx, wrap = M_.wrap;
		var h2 = hard * hard * (1 - 1e-12);
		// Initialize scratch arrays from preGuard coordinates and clear touch counters
		for (i = 0; i < nx; i++) {
			for (a = 0; a < ctN[i]; a++) {
				p = ctP[i * K + a];
				scX[p] = preGuardX[p];
				scY[p] = preGuardY[p];
				scE[p] = preGuardE[p];
				degTouch[p] = 0;
				reflTouch[p] = 0;
			}
		}
		// Count initial (pre-sweep) overlapping pairs per marker to detect multi-pair sandwiches
		var initTouch = new Uint16Array(P.partCap);
		for (i = 0; i < nx; i++) {
			var ip0 = (i + 1) % nx, bA0 = i * K, bB0 = ip0 * K;
			for (a = 0; a < ctN[i]; a++) {
				p = ctP[bA0 + a];
				for (var b0 = 0; b0 < ctN[ip0]; b0++) {
					if (ctCl[bA0 + a] === ctCl[bB0 + b0]) continue;
					var q0 = ctP[bB0 + b0];
					var dx0 = scX[q0] - scX[p];
					dx0 -= Math.floor(dx0 / wrap + 0.5) * wrap;
					var dy0 = scY[q0] - scY[p];
					if (dx0 * dx0 + dy0 * dy0 < h2) { initTouch[p]++; initTouch[q0]++; }
				}
			}
		}
		// Replay the 3 standard sweeps on scratch
		for (s = 0; s < P.ctSweep; s++) {
			if (!scratchSweep(hard, true, true)) break;
		}
		// Inspect surviving pairs after sweep 3 (matches S_.x, S_.y)
		var frameSandwich = false, frameReflected = false;
		var frameWorstRatio = 1.0, frameWorstPair = null;
		for (i = 0; i < nx; i++) {
			var ip = (i + 1) % nx, bA = i * K, bB = ip * K;
			for (a = 0; a < ctN[i]; a++) {
				p = ctP[bA + a];
				for (var b = 0; b < ctN[ip]; b++) {
					if (ctCl[bA + a] === ctCl[bB + b]) continue;
					var q = ctP[bB + b];
					var dx = S_.x[q] - S_.x[p];
					dx -= Math.floor(dx / wrap + 0.5) * wrap;
					var dy = S_.y[q] - S_.y[p];
					var d2 = dx * dx + dy * dy;
					if (d2 >= h2) continue;
					var d = Math.sqrt(d2), ratio = d / hard;
					var dxInit = preGuardX[q] - preGuardX[p];
					dxInit -= Math.floor(dxInit / wrap + 0.5) * wrap;
					var dyInit = preGuardY[q] - preGuardY[p];
					var d0 = Math.sqrt(dxInit * dxInit + dyInit * dyInit);
					// A marker is sandwiched if it touched >= 2 distinct pairs across the 3 sweeps
					// (for a single isolated pair that was pushed in all 3 sweeps, degTouch is 3,
					// wait: an isolated pair clears in 1 sweep unless reflected! So let's check
					// distinct partner count `partners[p]`).
					var isRefl = (reflTouch[p] || reflTouch[q]) > 0;
					var isSand = (initTouch[p] >= 2 || initTouch[q] >= 2 || degTouch[p] > P.ctSweep || degTouch[q] > P.ctSweep);
					if (isSand) { frameSandwich = true; guardResidSandwichPairs++; }
					if (isRefl) { frameReflected = true; guardResidReflectedPairs++; }
					if (ratio < frameWorstRatio) {
						frameWorstRatio = ratio;
						frameWorstPair = {
							frame: frame, tMyr: +(frame * KYR * 1e-3).toFixed(3),
							idP: S_.id[p], idQ: S_.id[q],
							clP: ctCl[bA + a], clQ: ctCl[bB + b],
							yP: +S_.y[p].toFixed(3), yQ: +S_.y[q].toFixed(3),
							d0Ratio: +(d0 / hard).toFixed(6),
							d3Ratio: +ratio.toFixed(6),
							initTouchP: initTouch[p], initTouchQ: initTouch[q],
							sweepTouchP: degTouch[p], sweepTouchQ: degTouch[q],
							reflected: isRefl, sandwich: isSand
						};
					}
				}
			}
		}
		if (frameSandwich) guardResidSandwichFrames++;
		if (frameReflected) guardResidReflectedFrames++;

		// Continue sweeping on scratch until all overlaps clear (up to 64 total sweeps)
		var totSweeps = P.ctSweep;
		while (totSweeps < 64 && scratchSweep(hard, true, false) > 0) {
			totSweeps++;
		}
		// Check if scratchSweep(hard, false, false) is now 0; if not, one more check
		if (scratchSweep(hard, false, false) > 0) totSweeps++;
		if (totSweeps > guardMaxSweepsToClear) guardMaxSweepsToClear = totSweeps;
		guardSweepsHist[totSweeps] = (guardSweepsHist[totSweeps] || 0) + 1;
		if (frameWorstPair) {
			frameWorstPair.sweepsToClear = totSweeps;
			if (frameWorstRatio < guardWorstRatio) {
				guardWorstRatio = frameWorstRatio;
				guardWorstEvent = frameWorstPair;
			}
			if (guardResidEvents.length < 32) guardResidEvents.push(frameWorstPair);
		}
	}
};

// ── Sections 2 & 3: Mantle-Cold and Mobile-Melt-Hot Census & Attribution ──
var minT = [Infinity, Infinity, Infinity, Infinity];
var maxT = [-Infinity, -Infinity, -Infinity, -Infinity];
var outsideBelow = [0, 0, 0, 0];
var outsideAbove = [0, 0, 0, 0];

// Mantle-cold (ph === 0 && T < -0.5) accumulators
var coldCarrierSeen = new Uint8Array(ID_CAP);
var coldCarrierIds = [];
var coldInExcursion = new Uint8Array(ID_CAP);
var coldExcursionCount = 0;
var coldWorst = null;
var coldMassBins = { lt50: 0, eq50: 0, b50_200: 0, gt200: 0 };
var coldDepthBins = [0, 0, 0, 0, 0, 0, 0]; // matching DEPTH_BANDS
var coldGapSum = 0, coldGapMax = -Infinity;
var coldGainSum = 0, coldGainMax = 0;
var coldShareSum = 0, coldShareMin = Infinity, coldShareMax = 0;
var coldMovedBins = { never: 0, le1: 0, le100: 0, gt100: 0 };
var coldBandMin = [];
for (var bi = 0; bi < DEPTH_BANDS.length - 1; bi++) {
	coldBandMin.push({
		y0: DEPTH_BANDS[bi], y1: DEPTH_BANDS[bi + 1],
		T: Infinity, frame: -1, id: -1, y: 0, m: 0, field: 0, gain: 0, share: 0
	});
}

// Mobile-melt-hot (ph === 1 && T > 1.5) accumulators
var meltCarrierSeen = new Uint8Array(ID_CAP);
var meltCarrierIds = [];
var meltOpenExc = {}; // id -> excursion record
var meltExcursions = [];
var meltHotWorst = null;
var meltGapSum = 0, meltGapMax = -Infinity;
var meltGainSum = 0, meltGainMax = 0;
var meltShareSum = 0, meltShareMin = Infinity, meltShareMax = 0;
var meltMovedBins = { never: 0, le1: 0, le100: 0, gt100: 0 };
var meltByBirthMode = { unknown: 0, mantleSplit: 0, depSplit: 0, mantleWhole: 0, depWhole: 0 };

function depthBandIdx(y) {
	var k;
	for (k = 0; k < DEPTH_BANDS.length - 1; k++) {
		if (y >= DEPTH_BANDS[k] && y < DEPTH_BANDS[k + 1]) return k;
	}
	return DEPTH_BANDS.length - 2;
}

// ── Run Simulation ──
P.seed = SEED;
P.sl.kyr = KYR;
P.depBound = DEP_BOUND;

SIM.init();
SIM.reset();
M = SIM.M;
SIM.dt = KYR * 1e-3;

// Record initial masses of seed markers
for (var p0 = 0; p0 < S.n; p0++) {
	if (S.id[p0] >= 0 && S.id[p0] < ID_CAP) initMass[S.id[p0]] = S.m[p0];
}

var totalFrames = Math.round((MYR * 1000) / KYR);
var t0 = Date.now();

for (frame = 1; frame <= totalFrames; frame++) {
	SIM.step();

	var n = S.n, p, ph, T, id, m, y, Tg, gap, age, bIdx;
	for (p = 0; p < n; p++) {
		id = S.id[p];
		if (id >= 0 && id < ID_CAP && initMass[id] === 0) initMass[id] = S.m[p];
		ph = S.ph[p];
		T = S.T[p];
		if (T < minT[ph]) minT[ph] = T;
		if (T > maxT[ph]) maxT[ph] = T;
		if (T < T_FLOOR) outsideBelow[ph]++;
		if (T > T_CEIL) outsideAbove[ph]++;

		if (ph === P.PH.mantle) {
			y = S.y[p];
			bIdx = depthBandIdx(y);
			if (T < coldBandMin[bIdx].T) {
				Tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
				gainShareAt(p);
				coldBandMin[bIdx].T = +T.toFixed(4);
				coldBandMin[bIdx].frame = frame;
				coldBandMin[bIdx].id = id;
				coldBandMin[bIdx].y = +y.toFixed(2);
				coldBandMin[bIdx].m = +S.m[p].toFixed(4);
				coldBandMin[bIdx].field = +Tg.toFixed(4);
				coldBandMin[bIdx].gain = +_gain.toFixed(4);
				coldBandMin[bIdx].share = +_share.toFixed(6);
			}
			if (T < T_FLOOR) {
				m = S.m[p];
				Tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
				gainShareAt(p);
				gap = Tg - T;
				age = movedAge(p);

				if (id >= 0 && id < ID_CAP) {
					if (!coldCarrierSeen[id]) {
						coldCarrierSeen[id] = 1;
						coldCarrierIds.push(id);
					}
					if (!coldInExcursion[id]) {
						coldInExcursion[id] = 1;
						coldExcursionCount++;
					}
				}
				if (m < P.eroMinM - 1e-6) coldMassBins.lt50++;
				else if (Math.abs(m - P.eroMinM) <= 1e-6) coldMassBins.eq50++;
				else if (m <= 200) coldMassBins.b50_200++;
				else coldMassBins.gt200++;

				coldDepthBins[bIdx]++;
				coldGapSum += gap;
				if (gap > coldGapMax) coldGapMax = gap;
				coldGainSum += _gain;
				if (_gain > coldGainMax) coldGainMax = _gain;
				coldShareSum += _share;
				if (_share < coldShareMin) coldShareMin = _share;
				if (_share > coldShareMax) coldShareMax = _share;

				if (age === null) coldMovedBins.never++;
				else if (age <= 1) coldMovedBins.le1++;
				else if (age <= 100) coldMovedBins.le100++;
				else coldMovedBins.gt100++;

				if (!coldWorst || T < coldWorst.T) {
					coldWorst = {
						T: +T.toFixed(4),
						frame: frame,
						tMyr: +(frame * KYR * 1e-3).toFixed(3),
						id: id,
						x: +S.x[p].toFixed(2),
						y: +y.toFixed(2),
						m: +m.toFixed(4),
						initM: id >= 0 && id < ID_CAP ? +initMass[id].toFixed(4) : 0,
						eroSteps: id >= 0 && id < ID_CAP ? eroSteps[id] : 0,
						eroLost: id >= 0 && id < ID_CAP ? +eroLost[id].toFixed(4) : 0,
						splitSteps: id >= 0 && id < ID_CAP ? splitSteps[id] : 0,
						splitLost: id >= 0 && id < ID_CAP ? +splitLost[id].toFixed(4) : 0,
						field: +Tg.toFixed(4),
						fieldMinusT: +gap.toFixed(4),
						gain: +_gain.toFixed(4),
						share: +_share.toFixed(6),
						negRawDi: id >= 0 && id < ID_CAP ? +negRawDi[id].toFixed(4) : 0,
						negBdGiven: id >= 0 && id < ID_CAP ? +negBdGiven[id].toFixed(4) : 0,
						movedAgo: age
					};
				}
			} else if (id >= 0 && id < ID_CAP && coldInExcursion[id]) {
				coldInExcursion[id] = 0;
			}
		} else if (ph === P.PH.melt) {
			if (T > T_CEIL) {
				m = S.m[p];
				y = S.y[p];
				Tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
				gainShareAt(p);
				gap = T - Tg;
				age = movedAge(p);

				if (id >= 0 && id < ID_CAP && !meltCarrierSeen[id]) {
					meltCarrierSeen[id] = 1;
					meltCarrierIds.push(id);
				}
				meltGapSum += gap;
				if (gap > meltGapMax) meltGapMax = gap;
				meltGainSum += _gain;
				if (_gain > meltGainMax) meltGainMax = _gain;
				meltShareSum += _share;
				if (_share < meltShareMin) meltShareMin = _share;
				if (_share > meltShareMax) meltShareMax = _share;

				if (age === null) meltMovedBins.never++;
				else if (age <= 1) meltMovedBins.le1++;
				else if (age <= 100) meltMovedBins.le100++;
				else meltMovedBins.gt100++;

				var bMode = (id >= 0 && id < ID_CAP) ? meltBirthMode[id] : 0;
				if (bMode === 1) meltByBirthMode.mantleSplit++;
				else if (bMode === 2) meltByBirthMode.depSplit++;
				else if (bMode === 3) meltByBirthMode.mantleWhole++;
				else if (bMode === 4) meltByBirthMode.depWhole++;
				else meltByBirthMode.unknown++;

				var ex = meltOpenExc[id];
				if (!ex) {
					var modeNames = ['unknown', 'mantle-split', 'dep-split', 'mantle-whole', 'dep-whole'];
					ex = {
						id: id,
						birthMode: modeNames[bMode] || 'unknown',
						birthFrame: (id >= 0 && id < ID_CAP) ? meltBirthFrame[id] : -1,
						birthY: (id >= 0 && id < ID_CAP) ? +meltBirthY[id].toFixed(2) : 0,
						birthM: (id >= 0 && id < ID_CAP) ? +meltBirthM[id].toFixed(4) : 0,
						birthT: (id >= 0 && id < ID_CAP) ? +meltBirthT[id].toFixed(4) : 0,
						birthField: (id >= 0 && id < ID_CAP) ? +meltBirthField[id].toFixed(4) : 0,
						enterFrame: frame,
						enterY: +y.toFixed(2),
						enterT: +T.toFixed(4),
						enterField: +Tg.toFixed(4),
						enterGain: +_gain.toFixed(4),
						enterShare: +_share.toFixed(6),
						peakFrame: frame,
						peakY: +y.toFixed(2),
						peakT: +T.toFixed(4),
						peakField: +Tg.toFixed(4),
						peakGain: +_gain.toFixed(4),
						peakShare: +_share.toFixed(6),
						m: +m.toFixed(4),
						framesAbove: 0,
						lastFrame: frame,
						lastY: +y.toFixed(2),
						movedAgoAtEnter: age
					};
					meltOpenExc[id] = ex;
					meltExcursions.push(ex);
				}
				ex.framesAbove++;
				ex.lastFrame = frame;
				ex.lastY = +y.toFixed(2);
				if (T > ex.peakT) {
					ex.peakFrame = frame;
					ex.peakY = +y.toFixed(2);
					ex.peakT = +T.toFixed(4);
					ex.peakField = +Tg.toFixed(4);
					ex.peakGain = +_gain.toFixed(4);
					ex.peakShare = +_share.toFixed(6);
				}
				if (!meltHotWorst || T > meltHotWorst.T) {
					meltHotWorst = {
						T: +T.toFixed(4),
						frame: frame,
						tMyr: +(frame * KYR * 1e-3).toFixed(3),
						id: id,
						birthMode: ex.birthMode,
						birthFrame: ex.birthFrame,
						birthY: ex.birthY,
						birthT: ex.birthT,
						y: +y.toFixed(2),
						m: +m.toFixed(4),
						field: +Tg.toFixed(4),
						TMinusField: +gap.toFixed(4),
						gain: +_gain.toFixed(4),
						share: +_share.toFixed(6),
						cumRawDi: id >= 0 && id < ID_CAP ? +cumRawDi[id].toFixed(4) : 0,
						cumBdGiven: id >= 0 && id < ID_CAP ? +cumBdGiven[id].toFixed(4) : 0,
						movedAgo: age
					};
				}
			} else if (meltOpenExc[id]) {
				delete meltOpenExc[id];
			}
		}
	}
}

var elapsedMs = Date.now() - t0;

// Build carrier detail summaries for mantle-cold carriers
var coldCarriersDetail = [];
for (var ci = 0; ci < coldCarrierIds.length; ci++) {
	var cid = coldCarrierIds[ci];
	coldCarriersDetail.push({
		id: cid,
		initM: +initMass[cid].toFixed(4),
		eroSteps: eroSteps[cid],
		eroLost: +eroLost[cid].toFixed(4),
		splitSteps: splitSteps[cid],
		splitLost: +splitLost[cid].toFixed(4),
		negRawDi: +negRawDi[cid].toFixed(4),
		negBdGiven: +negBdGiven[cid].toFixed(4),
		moves: moveCount[cid]
	});
}

var out = {
	seed: SEED,
	myr: MYR,
	kyr: KYR,
	depBound: DEP_BOUND,
	frames: totalFrames,
	elapsedMs: elapsedMs,
	fingerprint: S.hash(),
	minT: minT.map(function (v) { return +v.toFixed(4); }),
	maxT: maxT.map(function (v) { return +v.toFixed(4); }),
	outsideBelow: outsideBelow,
	outsideAbove: outsideAbove,
	repairAndReseed: {
		heldSamples: heldSamples,
		heldMassMyr: +heldMassMyr.toFixed(2),
		heldJoinM6: {
			windows: JOIN_WIN,
			n: hjM6WinN,
			mass: hjM6WinMass.map(function (v) { return +v.toFixed(2); }),
			gap: hjM6WinN.map(function (n, i) { return n ? +hjM6WinGapMax[i].toFixed(4) : 0; }),
			ever: {
				n: hjM6EverN,
				mass: +hjM6EverMass.toFixed(2),
				gap: hjM6EverN ? +hjM6EverGapMax.toFixed(4) : 0
			},
			never: {
				n: hjM6NeverN,
				mass: +hjM6NeverMass.toFixed(2),
				gap: hjM6NeverN ? +hjM6NeverGapMax.toFixed(4) : 0
			}
		},
		heldJoinTrue: {
			windows: JOIN_WIN,
			n: hjTrueWinN,
			mass: hjTrueWinMass.map(function (v) { return +v.toFixed(2); }),
			gap: hjTrueWinN.map(function (n, i) { return n ? +hjTrueWinGapMax[i].toFixed(4) : 0; }),
			ever: {
				n: hjTrueEverN,
				mass: +hjTrueEverMass.toFixed(2),
				gap: hjTrueEverN ? +hjTrueEverGapMax.toFixed(4) : 0
			},
			never: {
				n: hjTrueNeverN,
				mass: +hjTrueNeverMass.toFixed(2),
				gap: hjTrueNeverN ? +hjTrueNeverGapMax.toFixed(4) : 0
			},
			settledGt100: {
				n: hjTrueSettledN,
				mass: +hjTrueSettledMass.toFixed(2),
				gap: hjTrueSettledN ? +hjTrueSettledGapMax.toFixed(4) : 0
			},
			ring100N: hjRing100N,
			ring100Mass: hjRing100Mass.map(function (v) { return +v.toFixed(2); }),
			win1MassSharePct: heldMassMyr > 0 ? +(100 * hjTrueWinMass[0] / heldMassMyr).toFixed(4) : 0,
			win100MassSharePct: heldMassMyr > 0 ? +(100 * hjTrueWinMass[4] / heldMassMyr).toFixed(4) : 0,
			neverMassSharePct: heldMassMyr > 0 ? +(100 * hjTrueNeverMass / heldMassMyr).toFixed(4) : 0,
			settledMassSharePct: heldMassMyr > 0 ? +(100 * hjTrueSettledMass / heldMassMyr).toFixed(4) : 0
		},
		reseedCensus: {
			total: reseedTotal,
			byPhase: reseedByPhase,
			byRing: reseedByRing,
			depByRing: reseedDepByRing,
			meanAbsFieldJump: reseedByPhase.map(function (c, i) {
				return c > 0 ? +(reseedAbsFieldJumpSum[i] / c).toFixed(4) : 0;
			}),
			maxAbsFieldJump: reseedAbsFieldJumpMax.map(function (v) { return +v.toFixed(4); }),
			meanPostGap: reseedByPhase.map(function (c, i) {
				return c > 0 ? +(reseedPostGapSum[i] / c).toFixed(4) : 0;
			}),
			maxPostGap: reseedPostGapMax.map(function (v) { return +v.toFixed(4); }),
			postOver025: reseedPostOver025,
			depSameFrameCapped: reseedDepSameFrameCapped
		}
	},
	mantleCold: {
		samples: outsideBelow[0],
		carriersCount: coldCarrierIds.length,
		excursionsCount: coldExcursionCount,
		minT: +minT[0].toFixed(4),
		worst: coldWorst,
		massBins: coldMassBins,
		depthBins: coldDepthBins,
		meanFieldMinusT: outsideBelow[0] > 0 ? +(coldGapSum / outsideBelow[0]).toFixed(4) : 0,
		maxFieldMinusT: outsideBelow[0] > 0 ? +coldGapMax.toFixed(4) : 0,
		meanGain: outsideBelow[0] > 0 ? +(coldGainSum / outsideBelow[0]).toFixed(4) : 0,
		maxGain: +coldGainMax.toFixed(4),
		meanShare: outsideBelow[0] > 0 ? +(coldShareSum / outsideBelow[0]).toFixed(6) : 0,
		minShare: outsideBelow[0] > 0 ? +coldShareMin.toFixed(6) : 0,
		maxShare: +coldShareMax.toFixed(6),
		movedBins: coldMovedBins,
		bandMinima: coldBandMin,
		carriers: coldCarriersDetail
	},
	mobileMeltHot: {
		samples: outsideAbove[1],
		carriersCount: meltCarrierIds.length,
		excursionsCount: meltExcursions.length,
		maxT: +maxT[1].toFixed(4),
		worst: meltHotWorst,
		byBirthMode: meltByBirthMode,
		meanTMinusField: outsideAbove[1] > 0 ? +(meltGapSum / outsideAbove[1]).toFixed(4) : 0,
		maxTMinusField: outsideAbove[1] > 0 ? +meltGapMax.toFixed(4) : 0,
		meanGain: outsideAbove[1] > 0 ? +(meltGainSum / outsideAbove[1]).toFixed(4) : 0,
		maxGain: +meltGainMax.toFixed(4),
		meanShare: outsideAbove[1] > 0 ? +(meltShareSum / outsideAbove[1]).toFixed(6) : 0,
		minShare: outsideAbove[1] > 0 ? +meltShareMin.toFixed(6) : 0,
		maxShare: +meltShareMax.toFixed(6),
		movedBins: meltMovedBins,
		excursions: meltExcursions
	},
	contactGuard: {
		ctSweep: P.ctSweep,
		contactHardKm: +(P.contactHard * M.dx).toFixed(4),
		pushFrames: guardPushFrames,
		totalPushes: guardTotalPushes,
		residFrames: guardResidFrames,
		residPairs: guardResidPairs,
		sandwichFrames: guardResidSandwichFrames,
		sandwichPairs: guardResidSandwichPairs,
		reflectedFrames: guardResidReflectedFrames,
		reflectedPairs: guardResidReflectedPairs,
		worstRatio: +guardWorstRatio.toFixed(6),
		worstEvent: guardWorstEvent,
		maxSweepsToClear: guardMaxSweepsToClear,
		sweepsToClearHist: guardSweepsHist,
		sampleEvents: guardResidEvents
	}
};

console.log('=== 0.3.2 M12 Faces / Repair / Guard Census ===');
console.log('seed=' + SEED + '  myr=' + MYR + '  kyr=' + KYR + '  depBound=' + DEP_BOUND +
	'  frames=' + totalFrames + '  elapsed=' + elapsedMs + 'ms  fp=' + out.fingerprint);
console.log('minT=' + JSON.stringify(out.minT) + '  maxT=' + JSON.stringify(out.maxT));
console.log('outsideBelow=' + JSON.stringify(out.outsideBelow) + '  outsideAbove=' + JSON.stringify(out.outsideAbove));
console.log('heldJoinTrue: total=' + out.repairAndReseed.heldMassMyr +
	'  never=' + out.repairAndReseed.heldJoinTrue.never.mass + ' (' + out.repairAndReseed.heldJoinTrue.neverMassSharePct + '%)' +
	'  <=1f=' + out.repairAndReseed.heldJoinTrue.mass[0] + ' (' + out.repairAndReseed.heldJoinTrue.win1MassSharePct + '%)' +
	'  <=100f=' + out.repairAndReseed.heldJoinTrue.mass[4] + ' (' + out.repairAndReseed.heldJoinTrue.win100MassSharePct + '%)' +
	'  >100f=' + out.repairAndReseed.heldJoinTrue.settledGt100.mass + ' (' + out.repairAndReseed.heldJoinTrue.settledMassSharePct + '%)');
console.log('mantleCold: samples=' + out.mantleCold.samples + '  carriers=' + out.mantleCold.carriersCount +
	'  excursions=' + out.mantleCold.excursionsCount + '  minT=' + out.mantleCold.minT +
	'  massBins=' + JSON.stringify(out.mantleCold.massBins));
console.log('mobileMeltHot: samples=' + out.mobileMeltHot.samples + '  carriers=' + out.mobileMeltHot.carriersCount +
	'  excursions=' + out.mobileMeltHot.excursionsCount + '  maxT=' + out.mobileMeltHot.maxT +
	'  byBirth=' + JSON.stringify(out.mobileMeltHot.byBirthMode));
console.log('contactGuard: pushFrames=' + out.contactGuard.pushFrames + '  pushes=' + out.contactGuard.totalPushes +
	'  residFrames=' + out.contactGuard.residFrames + '  residPairs=' + out.contactGuard.residPairs +
	'  sandwichPairs=' + out.contactGuard.sandwichPairs + '  worstRatio=' + out.contactGuard.worstRatio +
	'  maxSweepsToClear=' + out.contactGuard.maxSweepsToClear + '  hist=' + JSON.stringify(out.contactGuard.sweepsToClearHist));

if (OUT) {
	fs.mkdirSync(path.dirname(OUT), { recursive: true });
	fs.writeFileSync(OUT, JSON.stringify(out, null, '\t') + '\n');
	console.log('wrote ' + OUT);
}
