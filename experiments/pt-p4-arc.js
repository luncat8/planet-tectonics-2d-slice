// pt-p4-arc.js — 0.3.0 P4.2: arc melt from the slab (0.3.0-p4-plan.md §3 P4.2).
//
// P4.1's slab pass drives cold detached lithosphere below P.yCrust toward P.yDeep, and a slab
// that starts in the hydrated surface skin carries bound water (cW) down with it. Inside the
// cold slab itself that water cannot melt the rock: at P.slabW (0.005) the solidus drops by
// 0.10, which leaves a cold slab (T <= P.slabT = 0.45) well below its own solidus at every
// depth. Above the slab, the mantle wedge (P.yCham..P.yArcMin) is warm enough to sit near its
// dry solidus, and what it lacks is the water. This harness decides all four claims of §3 P4.2:
//
//   A. the release rule and its exclusions. One hand call of ARC.run() transfers
//      min(kArc * dt, arcFrac) of the water in a slab inside (yArcMin, yArcMax] into the warm
//      mantle wedge above it, closes mass, enthalpy, felsic and water across the call, leaves
//      the cold slab solid while depressing the warm wedge's solidus through meltWW into the
//      mushy interval, preserves the P3.1 latent-heat identity, and moves the fingerprint.
//      Five exclusions are read off one state by hand: nothing dehydrates above yArcMin (the
//      forearc), below yArcMax (the deep slab heading to yDeep), in warm mantle, in attached
//      plate-sized lithosphere, or where no warm wedge sits above the slab (deferred, never
//      lost).
//   B. the dipping slab under a fixed wedge: where melt appears. Along a slab dipping at
//      contactDip from the forearc through (yArcMin, yArcMax] into the deep mantle beneath a
//      uniform warm sub-solidus wedge, 100% of the wedge melt appears above the
//      (yArcMin, yArcMax] window (within +-arcSpan), 0 in the forearc and 0 behind the deep
//      edge; translating the trench by +40 columns translates the arc melt by the same 40
//      columns; and both controls (P.arc off on the same wet slab, and a dry slab with P.arc
//      on) produce 0 water release and 0 wedge melt.
//   C. the P3 path unchanged. Over a multi-frame SIM.step() leg with no temperature
//      prescription inside the loop, the water-fluxed wedge melt crosses meltHold, separates
//      (P3.2), rises into chambers above the slab, opens explosive conduits once chW/chM >
//      wBlast (P3.3), launches ballistic clasts and lands coalesced wet arc deposits at the
//      arc (P3.4), while P.arc off on the identical initial state produces 0 splits, 0
//      chambers, 0 drains, 0 emissions and 0 deposits, and all four books (mass, water,
//      enthalpy and latent heat) close.
//   D. the live shipped planet (300 Myr, seed 1, 50 kyr/frame): subducting slabs carry the
//      surface skin's bound water into the dehydration window, release most of it into the
//      wedge and the shallow chambers while carrying the remainder into P4.1's deep records
//      at yDeep, against P.arc off on the same wet planet where 0 water reaches the chambers
//      and all of it rides the slabs into the deep records.
//
// Run: node experiments/pt-p4-arc.js [liveMyr=300]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), G = require(B + 'grid.js');
var POOL = require(B + 'pool.js'), SLAB = require(B + 'slab.js');
var ARC = require(B + 'arc.js'), VENT = require(B + 'vent.js');
var L = require('./pt-p4-lib.js');

var LIVE = +(process.argv[2] || 300);
var t0 = Date.now();
var YCRUST0 = P.yCrust, YMIN0 = P.yArcMin, YMAX0 = P.yArcMax;
var KARC0 = P.kArc, FRAC0 = P.arcFrac, SPAN0 = P.arcSpan, YWET0 = P.yWet, SLABW0 = P.slabW;

function restore() {
	P.yCrust = YCRUST0; P.yArcMin = YMIN0; P.yArcMax = YMAX0;
	P.kArc = KARC0; P.arcFrac = FRAC0; P.arcSpan = SPAN0;
	P.yWet = YWET0; P.slabW = SLABW0;
}
// P4.3's surface law is pt-p4-erosion.js's business, and it shipped after this harness's
// legs were measured: sediment welds into the lid and every leg here drifts off its report
// planet. Off the whole file the way P4.1's slab is, so these numbers stay this harness's
// own; the integrated census is P4.4's (pt-p4-check.js).
P.ero = false;

function seedBox(i0, i1, y0, y1, T, cF, cW) {
	var nx = SIM.M.nx, dx = SIM.M.dx, p, i, tag = {};
	for (p = 0; p < S.n; p++) {
		if (!P.PH_SOLID[S.ph[p]]) continue;
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		if (i < i0 || i >= i1 || S.y[p] < y0 || S.y[p] > y1) continue;
		S.cF[p] = cF; S.cW[p] = cW;
		L.setT(p, T);
		tag[S.id[p]] = 1;
	}
	return tag;
}

function census(tag) {
	var p, n = 0, m = 0, ym = 0, melt = 0, f = 0, w = 0;
	for (p = 0; p < S.n; p++) {
		if (!tag[S.id[p]]) continue;
		n++; m += S.m[p]; ym += S.m[p] * S.y[p];
		melt += S.m[p] * S.melt[p]; f += S.m[p] * S.cF[p]; w += S.m[p] * S.cW[p];
	}
	return { n: n, m: m, y: m ? ym / m : 0, melt: melt, f: f, w: w, tag: tag };
}

function settle() {
	var onS = P.slab, onA = P.arc;
	P.slab = false; P.arc = false;
	SIM.step();
	P.slab = onS; P.arc = onA;
}

function refresh() {
	PHASE.equil(SIM.M, S);
	G.scatterT(SIM.M, S, S.Tg, S.mug);
	SLAB.background(SIM.M, S);
}

function identity() {
	POOL.inventoryComp(S);
	return (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0);
}

// ------------------------------------------------------------------ A. the release rule
check.section('A. the release rule: water leaves the slab in the window, and only there');

restore();
P.arc = false; L.livePlanet();
P.contact = true; P.slab = true; P.arc = true;
settle();
var p0, ts0;
for (p0 = 0; p0 < S.n; p0++) {
	S.cW[p0] = 0; S.cF[p0] = 0;
	ts0 = PHASE.solidus(S.y[p0], 0, 0);
	if (S.T[p0] > ts0 - 0.05) L.setT(p0, ts0 - 0.05);
}
var wTag = {}, sTag = seedBox(96, 112, 330, 380, 0.20, 0.2, P.slabW);
for (p0 = 0; p0 < S.n; p0++) {
	var col0 = Math.round(S.x[p0] / SIM.M.dx);
	col0 -= Math.floor(col0 / SIM.M.nx) * SIM.M.nx;
	if (col0 >= 96 && col0 < 112 && S.y[p0] > P.yCham && S.y[p0] <= P.yArcMin) {
		S.cF[p0] = 0; S.cW[p0] = 0;
		L.setT(p0, PHASE.solidus(S.y[p0], 0, 0) - 0.015);
		wTag[S.id[p0]] = 1;
	}
}
refresh();
var sA0 = census(sTag), wA0 = census(wTag);
var bA = L.books(), idA = identity(), txA = S.tx.arc, hA = S.hash();
ARC.run(SIM.M, S, SIM.dt);
var sA1 = census(sTag), wA1 = census(wTag);
var bB = L.books(), idB = identity(), hB = S.hash();
var wantW = Math.min(P.kArc * SIM.dt, P.arcFrac) * sA0.w;
var debW = sA0.w - sA1.w, credW = wA1.w - wA0.w;

check.info('one call of the pass', sA0.n + ' slab parcels (' + sA0.w.toFixed(4)
	+ ' km2 water at ' + sA0.y.toFixed(0) + ' km) under ' + wA0.n + ' warm wedge parcels ('
	+ wA0.y.toFixed(0) + ' km): ' + S.d.arc + ' transfers moved ' + debW.toFixed(4)
	+ ' km2 of water into the wedge and produced ' + S.d.arcM.toFixed(2) + ' km2 of wedge melt');
check.ok('the slab in the window releases water at the law\'s rate',
	S.d.arc === sA0.n && S.tx.arc - txA === sA0.n
	&& Math.abs(debW - wantW) <= 1e-12 * wantW
	&& S.thr.arcDr === S.thr.arcCr && Math.abs(S.d.arcW - debW) <= 1e-12 * debW,
	S.d.arc + ' of ' + sA0.n + ' slab parcels debited ' + debW.toFixed(6) + ' km2 against '
	+ wantW.toFixed(6) + ' km2 prescribed, throughput dr ' + S.thr.arcDr.toFixed(6) + ' = cr '
	+ S.thr.arcCr.toFixed(6));
check.ok('what left the slab entered the wedge above it',
	Math.abs(credW - debW) <= 1e-12 * debW && credW > 0,
	'wedge gained ' + credW.toFixed(6) + ' km2 of the ' + debW.toFixed(6) + ' km2 the slab lost');
check.ok('mass, enthalpy, felsic and water close across the release',
	Math.abs(bB.M - bA.M) <= 1e-12 * bA.M && Math.abs(bB.H - bA.H) <= 1e-12 * Math.abs(bA.H)
	&& Math.abs(bB.F - bA.F) <= 1e-12 * Math.abs(bA.F)
	&& Math.abs(bB.W - bA.W) <= 1e-12 * Math.abs(bA.W),
	'mass ' + (bB.M - bA.M).toExponential(2) + ', enthalpy ' + (bB.H - bA.H).toExponential(2)
	+ ', felsic ' + (bB.F - bA.F).toExponential(2) + ', water ' + (bB.W - bA.W).toExponential(2));
check.ok('the cold slab stays solid while the wedge\'s solidus depression melts the wedge',
	sA0.melt === 0 && sA1.melt === 0 && wA0.melt === 0 && wA1.melt > 0
	&& Math.abs(wA1.melt - S.d.arcM) <= 1e-12 * wA1.melt
	&& Math.abs(bB.L - bA.L - S.d.arcM) <= 1e-12 * S.d.arcM,
	'slab melt ' + sA0.melt.toFixed(2) + ' -> ' + sA1.melt.toFixed(2)
	+ ' km2, wedge melt ' + wA0.melt.toFixed(2) + ' -> ' + wA1.melt.toFixed(2)
	+ ' km2 (d.arcM ' + S.d.arcM.toFixed(2) + ')');
check.ok('and the P3.1 latent identity holds across the solidus depression',
	Math.abs(idB - idA) <= 1e-12 * Math.abs(bA.H),
	'identity shift ' + (idB - idA).toExponential(2) + ' km2*H');
check.ok('the release is state, so the fingerprint moves, and dt = 0 or P.arc off no-ops',
	(function () {
		var h1 = hB;
		ARC.run(SIM.M, S, 0);
		if (S.hash() !== h1) return false;
		P.arc = false;
		ARC.run(SIM.M, S, SIM.dt);
		P.arc = true;
		return hA !== hB && S.hash() === h1 && S.d.arc === 0;
	}()),
	hA + ' -> ' + hB + ', paused/disabled leaves ' + S.hash());

// The five exclusions, read off one state with the pass called by hand. Lowering yCrust and
// yArcMin to 150 km puts the two-plate fixture's attached roots (150..250 km) inside the
// dehydration window, the same way pt-p4-slab.js tests its attached exclusion.
restore();
P.arc = false; L.configure();
P.contact = true; P.slab = true; P.arc = true;
L.twoPlates(0.2);
SIM.step();
P.yCrust = 150; P.yArcMin = 150; P.yArcMax = 600;
var nx = SIM.M.nx, dx = SIM.M.dx, p2, col2, cl2;
var gShal = {}, gDeep = {}, gWarm = {}, gAtt = {}, gNoWedge = {}, gValid = {};
for (p2 = 0; p2 < S.n; p2++) {
	S.cW[p2] = 0;
	col2 = Math.round(S.x[p2] / dx); col2 -= Math.floor(col2 / nx) * nx;
	// warm wedge above the scope line everywhere except columns 172..196, which stay cold so
	// the slab seeded at 180..188 has no warm wedge candidate above it
	if (S.y[p2] > P.yCham && S.y[p2] <= P.yArcMin) {
		if (col2 >= 172 && col2 < 196) L.setT(p2, 0.20);
		else if (col2 < 16 || col2 >= 32) L.setT(p2, PHASE.solidus(S.y[p2], 0, 0) - 0.02);
	}
	if (col2 >= 20 && col2 < 28 && S.y[p2] >= 60 && S.y[p2] <= 140) {
		S.cW[p2] = P.slabW; L.setT(p2, 0.10); gShal[S.id[p2]] = 1;
	} else if (col2 >= 60 && col2 < 68 && S.y[p2] >= 650 && S.y[p2] <= 850) {
		S.cW[p2] = P.slabW; L.setT(p2, 0.10); gDeep[S.id[p2]] = 1;
	} else if (col2 >= 100 && col2 < 108 && S.y[p2] >= 320 && S.y[p2] <= 450) {
		S.cW[p2] = P.slabW; L.setT(p2, 0.85); gWarm[S.id[p2]] = 1;
	} else if (S.y[p2] > P.yArcMin && S.y[p2] <= 250) {
		cl2 = S.cl[p2];
		if (cl2 >= 0 && S.csCnt[cl2] >= P.plateMin) {
			S.cW[p2] = P.slabW; L.setT(p2, 0.10); gAtt[S.id[p2]] = 1;
		}
	} else if (col2 >= 180 && col2 < 188 && S.y[p2] >= 320 && S.y[p2] <= 450) {
		S.cW[p2] = P.slabW; L.setT(p2, 0.10); S.cl[p2] = -1; gNoWedge[S.id[p2]] = 1;
	} else if (col2 >= 220 && col2 < 228 && S.y[p2] >= 320 && S.y[p2] <= 450) {
		S.cW[p2] = P.slabW; L.setT(p2, 0.10); S.cl[p2] = -1; gValid[S.id[p2]] = 1;
	}
}
refresh();
var cShal0 = census(gShal), cDeep0 = census(gDeep), cWarm0 = census(gWarm);
var cAtt0 = census(gAtt), cNoW0 = census(gNoWedge), cVal0 = census(gValid);
var bEx0 = L.books();
ARC.run(SIM.M, S, SIM.dt);
var cShal1 = census(gShal), cDeep1 = census(gDeep), cWarm1 = census(gWarm);
var cAtt1 = census(gAtt), cNoW1 = census(gNoWedge), cVal1 = census(gValid);
var bEx1 = L.books();

check.ok('shallow material above yArcMin is forearc/lid and does not dehydrate',
	cShal0.n > 0 && cShal1.w === cShal0.w,
	cShal0.n + ' wet cold parcels above ' + P.yArcMin + ' km, water ' + cShal0.w.toFixed(4)
	+ ' -> ' + cShal1.w.toFixed(4) + ' km2');
check.ok('deep slab material below yArcMax keeps its remaining water for yDeep',
	cDeep0.n > 0 && cDeep1.w === cDeep0.w,
	cDeep0.n + ' wet cold parcels below ' + P.yArcMax + ' km, water ' + cDeep0.w.toFixed(4)
	+ ' -> ' + cDeep1.w.toFixed(4) + ' km2');
check.ok('warm material in the window is not a slab and does not dehydrate',
	cWarm0.n > 0 && cWarm1.w === cWarm0.w,
	cWarm0.n + ' warm wet parcels at 320..450 km, water ' + cWarm0.w.toFixed(4)
	+ ' -> ' + cWarm1.w.toFixed(4) + ' km2');
check.ok('attached lithosphere in the window rides its plate and does not dehydrate',
	cAtt0.n > 0 && cAtt1.w === cAtt0.w,
	cAtt0.n + ' wet parcels in plate-sized clusters below ' + P.yArcMin + ' km, water '
	+ cAtt0.w.toFixed(4) + ' -> ' + cAtt1.w.toFixed(4) + ' km2');
check.ok('a slab with no warm wedge above it keeps its water (deferred, never lost)',
	cNoW0.n > 0 && cNoW1.w === cNoW0.w && Math.abs(bEx1.W - bEx0.W) <= 1e-12 * bEx0.W,
	cNoW0.n + ' wet slab parcels under a cold column, water ' + cNoW0.w.toFixed(4)
	+ ' -> ' + cNoW1.w.toFixed(4) + ' km2, world water residual '
	+ (bEx1.W - bEx0.W).toExponential(2));
check.ok('while detached cold slab material under a warm wedge releases its share',
	cVal0.n > 0 && S.d.arc === cVal0.n && cVal1.w < cVal0.w,
	S.d.arc + ' of ' + cVal0.n + ' detached slab parcels under the warm wedge released '
	+ (cVal0.w - cVal1.w).toFixed(4) + ' km2');
restore();

// ------------------------------------------------------------------ B. where melt appears
check.section('B. the dipping slab under a fixed wedge: where melt appears');

// A dipping slab descending at contactDip from 100 km (forearc) through (yArcMin, yArcMax]
// down to 950 km (deep sub-arc) beneath a horizontally uniform warm sub-solidus wedge. The
// wedge itself has no preferred column; where melt appears is decided entirely by where the
// dipping slab intersects the release window.
function dippingLeg(trenchCol, arcOn, slabW) {
	restore();
	P.arc = false; L.livePlanet();
	P.contact = true; P.slab = true; P.arc = arcOn;
	settle();
	var M = SIM.M, nx = M.nx, dx = M.dx, tanDip = P.contactSin / P.contactCos;
	var p, i, relCol, ySlab, ts, slabIds = {};
	for (p = 0; p < S.n; p++) {
		S.cW[p] = 0; S.cF[p] = 0; S.cl[p] = -1;
		ts = PHASE.solidus(S.y[p], 0, 0);
		if (S.y[p] > P.yCham && S.y[p] <= P.yArcMin) L.setT(p, ts - 0.015);
		else L.setT(p, Math.min(0.70, ts - 0.08));
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		relCol = i - trenchCol; relCol -= Math.floor(relCol / nx) * nx;
		if (relCol >= 0 && relCol <= 22) {
			ySlab = 100 + relCol * dx * tanDip;
			if (ySlab - 55 > P.yCham && Math.abs(S.y[p] - ySlab) <= 55 && S.y[p] > 110) {
				if (S.y[p] > P.yArcMin || relCol <= 3) {
					S.cW[p] = slabW; S.cF[p] = 0.2;
					L.setT(p, 0.15);
					slabIds[S.id[p]] = 1;
				}
			}
		}
	}
	refresh();
	var b0 = L.books(), steps = 12, s, dy = P.vSinkMax * SIM.dt, dxStep = dy / tanDip;
	var colMin = 999, colMax = -1;
	for (s = 0; s < steps; s++) {
		for (p = 0; p < S.n; p++) {
			if (!slabIds[S.id[p]]) continue;
			i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
			relCol = i - trenchCol; relCol -= Math.floor(relCol / nx) * nx;
			if (S.y[p] > P.yArcMin && S.y[p] <= P.yArcMax) {
				if (relCol < colMin) colMin = relCol;
				if (relCol > colMax) colMax = relCol;
			}
		}
		ARC.run(M, S, SIM.dt);
		// advance the slab along its dip under the fixed wedge
		for (p = 0; p < S.n; p++) {
			if (!slabIds[S.id[p]]) continue;
			S.x[p] += dxStep;
			if (S.x[p] >= M.wrap) S.x[p] -= M.wrap;
			S.y[p] += dy;
			S.e[p] = Math.asinh(S.y[p] / M.yLin);
			G.keepInside(M, S, p);
		}
		refresh();
	}
	var spanCols = Math.round(P.arcSpan / dx);
	var inArc = 0, forearc = 0, backarc = 0, xSum = 0, mSum = 0, m;
	for (p = 0; p < S.n; p++) {
		if (S.y[p] <= P.yCham || S.y[p] > P.yArcMin || !(S.melt[p] > 0)) continue;
		m = S.m[p] * S.melt[p];
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		relCol = i - trenchCol; relCol -= Math.floor(relCol / nx) * nx;
		if (relCol > nx / 2) relCol -= nx;
		if (relCol < colMin - spanCols) forearc += m;
		else if (relCol > colMax + spanCols) backarc += m;
		else inArc += m;
		xSum += m * ((trenchCol + relCol) * dx);
		mSum += m;
	}
	var b1 = L.books();
	return { inArc: inArc, forearc: forearc, backarc: backarc, totMelt: mSum,
		meanX: mSum ? xSum / mSum : 0, colMin: colMin, colMax: colMax,
		spanCols: spanCols, relW: S.thr.arcCr, tx: S.tx.arc,
		wDiff: b1.W - b0.W, mDiff: b1.M - b0.M };
}

var dipA = dippingLeg(60, true, P.slabW);
var dipShift = dippingLeg(100, true, P.slabW);
var dipOff = dippingLeg(60, false, P.slabW);
var dipDry = dippingLeg(60, true, 0);

check.info('dipping slab, trench col 60', 'window cols +' + dipA.colMin + '..+' + dipA.colMax
	+ ' (+-' + dipA.spanCols + ' span), ' + dipA.tx + ' transfers (' + dipA.relW.toFixed(2)
	+ ' km2 water), wedge melt in arc ' + dipA.inArc.toFixed(2) + ' km2, forearc '
	+ dipA.forearc.toFixed(2) + ', backarc ' + dipA.backarc.toFixed(2) + ', mean x '
	+ dipA.meanX.toFixed(0) + ' km');
check.info('shifted slab, trench col 100', 'mean x ' + dipShift.meanX.toFixed(0) + ' km (shift +'
	+ (dipShift.meanX - dipA.meanX).toFixed(0) + ' km against +' + (40 * SIM.M.dx).toFixed(0)
	+ ' km trench shift), wedge melt ' + dipShift.inArc.toFixed(2) + ' km2');
check.ok('wedge melt appears above the (yArcMin, yArcMax] slab window',
	dipA.inArc > 0 && dipA.relW > 0,
	dipA.inArc.toFixed(2) + ' km2 of wedge melt above cols +' + dipA.colMin + '..+' + dipA.colMax
	+ ' from ' + dipA.relW.toFixed(2) + ' km2 of released slab water');
check.ok('and nowhere else: zero melt in the forearc and zero behind the deep window',
	dipA.forearc === 0 && dipA.backarc === 0,
	'forearc ' + dipA.forearc.toFixed(2) + ' km2, backarc ' + dipA.backarc.toFixed(2)
	+ ' km2, 100% of ' + dipA.totMelt.toFixed(2) + ' km2 inside the arc footprint');
check.ok('shifting the slab shifts the arc by the same distance',
	Math.abs((dipShift.meanX - dipA.meanX) - 40 * SIM.M.dx) <= SIM.M.dx,
	'arc mean x ' + dipA.meanX.toFixed(1) + ' -> ' + dipShift.meanX.toFixed(1) + ' km (delta '
	+ (dipShift.meanX - dipA.meanX).toFixed(1) + ' km against ' + (40 * SIM.M.dx).toFixed(1) + ' km)');
check.ok('with the pass off or the slab dry, no water leaves and no wedge melts',
	dipOff.relW === 0 && dipOff.totMelt === 0 && dipDry.relW === 0 && dipDry.totMelt === 0,
	'pass off: relW ' + dipOff.relW + ', melt ' + dipOff.totMelt
	+ '; dry slab: relW ' + dipDry.relW + ', melt ' + dipDry.totMelt);

// ------------------------------------------------------------------ C. the P3 path unchanged
check.section('C. the P3 segregation, conduit and eruption path runs unchanged on the arc melt');

function fullPathLeg(arcOn) {
	restore();
	P.arc = false; L.livePlanet();
	P.contact = true; P.slab = true; P.arc = false;
	SIM.step();
	var M = SIM.M, nx = M.nx, dx = M.dx, p, i, ts;
	for (p = 0; p < S.n; p++) {
		S.cW[p] = 0; S.cF[p] = 0;
		ts = PHASE.solidus(S.y[p], 0, 0);
		if (S.T[p] > ts - 0.05) L.setT(p, ts - 0.05);
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		if (i >= 92 && i < 116 && S.y[p] > P.yCham && S.y[p] <= P.yArcMin) {
			L.setT(p, ts - 0.005);
		}
		if (i >= 96 && i < 112 && S.y[p] > P.yArcMin + 10 && S.y[p] <= 460) {
			S.cF[p] = 0.2; S.cW[p] = 0.025;
			L.setT(p, 0.20); S.cl[p] = -1;
		}
	}
	for (p = S.n - 1; p >= 0; p--) if (S.ph[p] !== P.PH.mantle) POOL.remove(S, p);
	S.chN = 0; S.chM.fill(0); S.chH.fill(0); S.chL.fill(0); S.chF.fill(0); S.chW.fill(0);
	S.vState.fill(0); S.vStyle.fill(0); S.vM.fill(0); S.vH.fill(0); S.vL.fill(0); S.vF.fill(0); S.vW.fill(0);
	S.tx.split = 0; S.tx.intrude = 0; S.tx.vent = 0; S.tx.emit = 0; S.tx.land = 0;
	S.tx.merge = 0; S.tx.arc = 0;
	S.thr.seg = 0; S.thr.intrDr = 0; S.thr.intrCr = 0; S.thr.ventDr = 0; S.thr.ventCr = 0;
	S.thr.airDr = 0; S.thr.airCr = 0; S.thr.landDr = 0; S.thr.landCr = 0;
	S.thr.arcDr = 0; S.thr.arcCr = 0; S.thr.arcMelt = 0;
	refresh();
	POOL.inventoryComp(S);
	S.invL0 = S.invLTot; S.ledger = 0; S.hLedger = 0; S.wall = 0;
	var b0 = L.books(), hl0 = S.hLedger;
	P.arc = arcOn;
	var blastFrames = 0, k, c;
	for (k = 0; k < 120; k++) {
		SIM.step();
		for (c = 0; c < S.chN; c++) if (S.vState[c] && S.vStyle[c] === VENT.EXPLOSIVE) blastFrames++;
	}
	var b1 = L.books();
	var depN = 0, depM = 0, depW = 0, depX = 0;
	for (p = 0; p < S.n; p++) if (S.ph[p] === P.PH.dep) {
		depN++; depM += S.m[p]; depW += S.m[p] * S.cW[p]; depX += S.m[p] * S.x[p];
	}
	return {
		arcTx: S.tx.arc, arcW: S.thr.arcCr, arcDr: S.thr.arcDr, arcMelt: S.thr.arcMelt,
		split: S.tx.split, intrude: S.tx.intrude, chN: S.chN, chW: S.invChW,
		vent: S.tx.vent, blastFrames: blastFrames, emit: S.tx.emit, land: S.tx.land,
		merge: S.tx.merge, depN: depN, depM: depM, depW: depW,
		depX: depM ? depX / depM : 0, wantX: 104 * dx,
		mDiff: b1.M - b0.M, wDiff: b1.W - b0.W, m0: b0.M, w0: b0.W, h0: b0.H,
		entErr: (b1.H - b0.H) - (S.hLedger - hl0),
		latErr: (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0),
		hash: S.hash()
	};
}

var pathOn = fullPathLeg(true);
var pathAgain = fullPathLeg(true);
var pathOff = fullPathLeg(false);

check.info('full pipeline, P.arc on', pathOn.arcTx + ' releases (' + pathOn.arcW.toFixed(1)
	+ ' km2 water) -> ' + pathOn.arcMelt.toFixed(1) + ' km2 wedge melt -> ' + pathOn.split
	+ ' splits -> ' + pathOn.intrude + ' intrusions into ' + pathOn.chN + ' chambers ('
	+ pathOn.chW.toFixed(1) + ' km2 water) -> ' + pathOn.vent + ' drains (' + pathOn.blastFrames
	+ ' explosive conduit-frames) -> ' + pathOn.emit + ' emissions -> ' + pathOn.land
	+ ' landings (' + pathOn.merge + ' merges, ' + pathOn.depN + ' deposits of '
	+ pathOn.depM.toFixed(1) + ' km2 carrying ' + pathOn.depW.toFixed(2) + ' km2 water at x '
	+ pathOn.depX.toFixed(0) + ' km)');
check.info('full pipeline, P.arc off', pathOff.arcTx + ' releases, ' + pathOff.split
	+ ' splits, ' + pathOff.intrude + ' intrusions, ' + pathOff.chN + ' chambers, '
	+ pathOff.vent + ' drains, ' + pathOff.emit + ' emissions, ' + pathOff.land + ' landings');
check.ok('the depressed wedge separates and intrudes into chambers above the slab',
	pathOn.split > 0 && pathOn.intrude > 0 && pathOn.chN > 0 && pathOn.chW > 0
	&& pathOff.split === 0 && pathOff.intrude === 0 && pathOff.chN === 0,
	pathOn.split + ' splits and ' + pathOn.intrude + ' intrusions (' + pathOn.chW.toFixed(1)
	+ ' km2 chamber water) against 0 and 0 with P.arc off');
check.ok('the wet arc chambers open explosive conduits and erupt',
	pathOn.vent > 0 && pathOn.blastFrames > 0 && pathOn.emit > 0 && pathOff.vent === 0,
	pathOn.vent + ' drains, ' + pathOn.blastFrames + ' explosive conduit-frames, '
	+ pathOn.emit + ' airborne batches against 0 with P.arc off');
check.ok('and land coalesced wet deposits on the overriding plate above the slab',
	pathOn.land > 0 && pathOn.depN > 0 && pathOn.depW > 0
	&& Math.abs(pathOn.depX - pathOn.wantX) <= 4 * SIM.M.dx && pathOff.land === 0,
	pathOn.land + ' landings (' + pathOn.merge + ' merges) into ' + pathOn.depN
	+ ' deposits carrying ' + pathOn.depW.toFixed(2) + ' km2 water at x '
	+ pathOn.depX.toFixed(0) + ' km against slab center ' + pathOn.wantX.toFixed(0) + ' km');
check.ok('mass, water, enthalpy and the latent identity all close across the full arc path',
	Math.abs(pathOn.mDiff) <= 1e-12 * pathOn.m0 && Math.abs(pathOn.wDiff) <= 1e-12 * pathOn.w0
	&& Math.abs(pathOn.entErr) <= 1e-9 * Math.abs(pathOn.h0)
	&& Math.abs(pathOn.latErr) <= 1e-9 * Math.abs(pathOn.h0)
	&& pathOn.arcDr === pathOn.arcW,
	'mass ' + pathOn.mDiff.toExponential(2) + ', water ' + pathOn.wDiff.toExponential(2)
	+ ', enthalpy ' + pathOn.entErr.toExponential(2) + ', latent '
	+ pathOn.latErr.toExponential(2));
check.ok('the arc eruption leg repeats bitwise',
	pathAgain.hash === pathOn.hash && pathAgain.land === pathOn.land,
	'fingerprint ' + pathOn.hash + ' both times, ' + pathAgain.land + ' landings against '
	+ pathOn.land);

// ------------------------------------------------------------------ D. the live shipped planet
check.section('D. the live shipped planet');

function live(arcOn, myr) {
	restore();
	// Both legs start from the same hydrated 'cool' initial condition (P.arc = true during
	// reset), so the comparison isolates the G5 dehydration pass itself on identical starting
	// water.
	P.arc = true;
	L.livePlanet();
	P.contact = true; P.slab = true; P.arc = arcOn;
	var o = { m0: S.invMTot, w0: S.invWTot, h0: S.invHTot, l0: S.invL0, n0: S.n,
		frames: 0, arcFrames: 0, arcMax: 0, firstAt: -1 };
	var frames = Math.round(myr / SIM.dt), k;
	for (k = 0; k < frames; k++) {
		SIM.step();
		o.frames++;
		if (S.d.arc > 0) {
			o.arcFrames++;
			if (S.d.arc > o.arcMax) o.arcMax = S.d.arc;
			if (o.firstAt < 0) o.firstAt = SIM.t;
		}
	}
	POOL.inventoryComp(S);
	o.n = S.n;
	o.mDiff = S.invMTot - o.m0;
	o.wDiff = S.invWTot - o.w0;
	o.latErr = (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - o.l0);
	o.arcTx = S.tx.arc;
	o.arcDr = S.thr.arcDr; o.arcCr = S.thr.arcCr; o.arcMelt = S.thr.arcMelt;
	o.chW = S.invChW; o.vW = S.invVW; o.dpW = S.invDpW; o.dpM = S.invDpM; o.dpN = S.dpN;
	o.recycle = S.tx.recycle; o.refuse = S.tx.refuse;
	o.t = SIM.t; o.hash = S.hash();
	return o;
}

var lon = live(true, LIVE), loff = live(false, LIVE);

function liveInfo(tag, o) {
	check.info(tag, 't ' + o.t.toFixed(0) + ' Myr, ' + o.arcTx + ' dehydration transfers on '
		+ o.arcFrames + ' of ' + o.frames + ' frames'
		+ (o.firstAt < 0 ? '' : ' from t ' + o.firstAt.toFixed(1) + ' Myr')
		+ ' (worst frame ' + o.arcMax + '), ' + o.arcCr.toFixed(2) + ' km2 water released -> '
		+ o.arcMelt.toFixed(1) + ' km2 wedge melt; chamber water ' + o.chW.toFixed(2)
		+ ' km2, deep water ' + o.dpW.toFixed(2) + ' km2 in ' + o.dpN + ' records ('
		+ o.recycle + ' transfers), pool ' + o.n0 + ' -> ' + o.n + ' parcels');
}

liveInfo('live, P.arc on', lon);
liveInfo('live, P.arc off (same initial water)', loff);

check.ok('the live planet dehydrates its sinking slabs in the window',
	lon.arcTx > 0 && lon.arcCr > 0 && lon.arcMelt > 0,
	lon.arcTx + ' transfers from t ' + lon.firstAt.toFixed(1) + ' Myr released '
	+ lon.arcCr.toFixed(2) + ' km2 of water and produced ' + lon.arcMelt.toFixed(1)
	+ ' km2 of wedge melt');
check.ok('dehydration delivers slab water to the shallow chambers and spares the deep records',
	lon.chW > 0 && loff.chW === 0 && lon.dpW > 0 && lon.dpW < loff.dpW,
	'chamber water ' + lon.chW.toFixed(2) + ' km2 (pass off ' + loff.chW.toFixed(2)
	+ ' km2 -- without the pass the cold skin never melts on its own), deep record water '
	+ lon.dpW.toFixed(2) + ' km2 against ' + loff.dpW.toFixed(2) + ' km2 with the pass off');
check.ok('the live mass, water and latent books close across 6000 frames of dehydration',
	Math.abs(lon.mDiff) <= 1e-12 * lon.m0 && Math.abs(lon.wDiff) <= 1e-12 * lon.w0
	&& Math.abs(lon.latErr) <= 1e-9 * Math.abs(S.hLedger) && lon.arcDr === lon.arcCr,
	'mass ' + lon.mDiff.toExponential(2) + ', water ' + lon.wDiff.toExponential(2)
	+ ' of ' + lon.w0.toFixed(2) + ' km2, latent ' + lon.latErr.toExponential(2)
	+ ', throughput dr ' + lon.arcDr.toFixed(2) + ' = cr ' + lon.arcCr.toFixed(2));
check.ok('nothing was refused and the two live legs fingerprint apart',
	lon.refuse === 0 && lon.hash !== loff.hash,
	lon.refuse + ' refusals, P.arc on ' + lon.hash + ' vs off ' + loff.hash);

// the frame cost, measured at t = 300 Myr where wet slabs are actively in the window
restore();
P.arc = true; P.contact = true; P.slab = true;
var N = 300, tc = 0, tf = 0, a2, b2, k5;
for (k5 = 0; k5 < N; k5++) {
	a2 = process.hrtime.bigint();
	ARC.run(SIM.M, S, SIM.dt);
	b2 = process.hrtime.bigint();
	tc += Number(b2 - a2) / 1e6;
	SIM.step();
	tf += Number(process.hrtime.bigint() - b2) / 1e6;
}
check.ok('the arc pass costs under 2% of the frame', tc < 0.02 * tf,
	(tc / N).toFixed(4) + ' ms/frame for the pass against ' + (tf / N).toFixed(2)
	+ ' ms/frame for the rest of it (' + (100 * tc / tf).toFixed(3) + '%)');

check.info('wall time', ((Date.now() - t0) / 1000).toFixed(0) + ' s for '
	+ (3 * 6 + 2 * LIVE + N * SIM.dt).toFixed(0) + ' Myr of simulation');
check.done();
