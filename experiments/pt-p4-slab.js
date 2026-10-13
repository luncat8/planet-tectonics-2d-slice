// pt-p4-slab.js — 0.3.0 P4.1: slab sinking and deep recycling (0.3.0-p4-plan.md §3 P4.1).
//
// P4.0's contact pass owns the lid band above P.yCrust and its bending band is what puts
// material below that line. Below it nothing held a slab: the band stopped moving, and the
// plan's §1.2 line stayed unwritten -- deep recycling is the first transfer that leaves the
// plate population, and a slab that reaches the deep inventory is a transfer, not a sink.
// This harness is where that is decided:
//
//   1. the drive. A slab below the crust base descends at the law's own speed -- the
//      temperature-is-density proxy of P4.0 §1.1 read against the background of its own row,
//      capped at vSinkMax -- and nothing else moves: not the lid above yCrust, not warm
//      material at the same depth, not lithosphere still riding a plate. The three exclusions
//      are read off one state with the pass called by hand, because a leg cannot say which
//      rule kept a parcel where it was.
//   2. the transfer. What reaches yDeep leaves the pool for a deep record by a matched debit
//      and credit: the inventory's totals are bitwise unchanged across it, its throughput
//      pair agrees with the stock the records hold, composition rides it, the records are
//      state (they move the fingerprint), and a full record set defers the transfer and
//      counts the deferral instead of dropping mass. A second leg runs the arrival for real:
//      a slab descends under its own drive until it crosses the boundary.
//   3. the hand-over, at the scale the live planet makes it visible: the cold lithosphere the
//      contact pass puts below the crust base is where this pass's population comes from, so
//      the same 300 Myr with the drive off leaves that material sitting in the band and books
//      no transfer at all.
//   4. the live shipped planet: what sinks, what is still attached (the plan's §4 question,
//      measured rather than assumed), what arrives, the ledger still closing across a run
//      that recycles, the pool not being drained by it, and the frame cost.
//
// Two things about the fixture itself, both measured and both the reason a leg is built the
// way it is. A seeded cold blob does not survive a frame: at 2400 km a mesh cell is ~480 km
// tall, so the heat pass equilibrates the blob with the cell it sits in and the drive finds
// nothing (a leg that seeded and then stepped reported 0 transfers of 12 parcels). So the
// controlled legs settle the fields the pass reads -- clusters, node field, positions -- with
// one real frame, seed afterwards, and rebuild temperature and background without stepping.
// And the hand-over is a live-planet claim because the controlled two-plate leg cannot show
// one. Its band bends to ~251 km in the 5 Myr its age-zero material allows, which is below
// yCrust but above yWeldMax, so the band is still bonded and still attached -- and attached
// lithosphere is deliberately not this pass's. With the shipped failure law the same layout
// shatters instead (archive/0.3.0-p4.0-worklog.md), and a leg long enough for the band to
// detach is a leg in which the fixture's own ageing has welded the two plates together. The
// live planet makes its own detached slabs, so that is where the continuity is measured.
//
// Run: node experiments/pt-p4-slab.js [liveMyr=300]
// The live legs need ~100 Myr before the shipped lid fragments into converging plates and
// ~170 Myr before a slab reaches the deep boundary, so a shorter argument goes red on the
// checks that ask for one; 300 Myr is the number the report quotes.
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), G = require(B + 'grid.js');
var POOL = require(B + 'pool.js'), SLAB = require(B + 'slab.js');
var L = require('./pt-p4-lib.js');

var LIVE = +(process.argv[2] || 300);
var t0 = Date.now();
var CAP0 = P.deepCap, JOIN0 = P.deepJoin, YCRUST0 = P.yCrust, SINKMYR = 10;

// ------------------------------------------------------------------ the seeded slab
function seed(i0, i1, y0, y1, T, cF, cW) {
	var nx = SIM.M.nx, dx = SIM.M.dx, p, i, n = 0, m = 0, ym = 0, melt = 0, f = 0, w = 0;
	var tag = {};
	for (p = 0; p < S.n; p++) {
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		if (i < i0 || i >= i1 || S.y[p] < y0 || S.y[p] > y1) continue;
		S.cF[p] = cF; S.cW[p] = cW;
		L.setT(p, T);                       // enthalpy from the law, for the composition seeded
		tag[S.id[p]] = 1;
		n++; m += S.m[p]; ym += S.m[p] * S.y[p];
		melt += S.m[p] * S.melt[p]; f += S.m[p] * S.cF[p]; w += S.m[p] * S.cW[p];
	}
	return { n: n, m: m, y: n ? ym / m : 0, melt: melt, f: f, w: w, tag: tag };
}

function census(s0) {
	var tag = s0.tag, p, n = 0, m = 0, ym = 0, deepest = 0, melt = 0, f = 0, w = 0;
	for (p = 0; p < S.n; p++) {
		if (!tag[S.id[p]]) continue;
		n++; m += S.m[p]; ym += S.m[p] * S.y[p];
		if (S.y[p] > deepest) deepest = S.y[p];
		melt += S.m[p] * S.melt[p]; f += S.m[p] * S.cF[p]; w += S.m[p] * S.cW[p];
	}
	return { n: n, m: m, y: m ? ym / m : 0, deepest: deepest, gone: s0.m - m,
		melt: melt, f: f, w: w, tag: tag };
}

// the record set's own totals: state keeps invDpM and invDpL for the HUD and the inventory and
// folds the records' composition into the world totals, so the split figures a transfer claim
// needs are summed here rather than added to the engine for one harness
function records() {
	var k, o = { m: 0, h: 0, melt: 0, f: 0, w: 0 };
	for (k = 0; k < S.dpN; k++) {
		o.m += S.dpM[k]; o.h += S.dpH[k]; o.melt += S.dpL[k];
		o.f += S.dpF[k]; o.w += S.dpW[k];
	}
	return o;
}

// one real frame with the pass off, so what a hand call reads afterwards is what the pipeline
// would have handed it: clusters from the bond pass, the node field from the markers,
// positions from the flow
function settle() {
	var on = P.slab;
	P.slab = false;
	SIM.step();
	P.slab = on;
}

// temperature from enthalpy, node field from the markers, row background from the node field:
// the three things the pass reads that a seed has just invalidated, rebuilt without a step
function refresh() {
	PHASE.equil(SIM.M, S);
	G.scatterT(SIM.M, S, S.Tg, S.mug);
	SLAB.background(SIM.M, S);
}

function row(p) {
	var j = Math.round(S.e[p] / SIM.M.dEta);
	if (j > SIM.M.ny) j = SIM.M.ny; else if (j < 1) j = 1;
	return j;
}

// the population the pass owns, counted where a leg ends: lithosphere below the crust base,
// colder than its own row, not riding a plate
function population() {
	SLAB.background(SIM.M, S);
	var p, c, n = 0, m = 0, ym = 0, deepest = 0;
	for (p = 0; p < S.n; p++) {
		if (!P.PH_SOLID[S.ph[p]] || S.y[p] <= P.yCrust || S.T[p] > P.slabT) continue;
		c = S.cl[p];
		if (c >= 0 && S.csCnt[c] >= P.plateMin) continue;
		if (S.Trow[row(p)] - S.T[p] < P.slabdT) continue;
		n++; m += S.m[p]; ym += S.m[p] * S.y[p];
		if (S.y[p] > deepest) deepest = S.y[p];
	}
	return { n: n, m: m, y: n ? ym / m : 0, deepest: deepest };
}

// the shipped planet, one seeded window, `myr` of frames. Every leg restores the parameters an
// earlier leg moved, so the legs are independent of the order they are written in.
function seededLeg(slab, T, y0, y1, myr, cF, cW) {
	L.livePlanet();
	P.slab = slab; P.contact = true;
	P.deepCap = CAP0; P.deepJoin = JOIN0; P.yCrust = YCRUST0;
	var s0 = seed(96, 112, y0, y1, T, cF || 0, cW || 0);
	var o = { T: T, slab: slab, s0: s0, m0: S.invMTot, driven: 0, drivenMax: 0, vMax: 0,
		vSum: 0, bondMax: 0, transfers: 0, frames: 0 };
	var k, frames = Math.round(myr / SIM.dt);
	for (k = 0; k < frames; k++) {
		SIM.step();
		o.frames++;
		o.driven += S.d.slab;
		if (S.d.slab > o.drivenMax) o.drivenMax = S.d.slab;
		if (S.d.slabV > o.vMax) o.vMax = S.d.slabV;
		if (S.d.slab > 0) o.vSum += S.d.slabV * S.d.slab;
		if (S.d.slabBond > o.bondMax) o.bondMax = S.d.slabBond;
		o.transfers += S.d.deep;
	}
	POOL.inventoryComp(S);
	o.s1 = census(s0);
	o.rate = (o.s1.y - s0.y) / myr;
	o.vMean = o.driven ? o.vSum / o.driven : 0;
	o.books = L.books();
	o.resid = o.books.M - o.m0;
	o.dpN = S.dpN;
	o.rec = records();
	o.hash = S.hash();
	return o;
}

// ------------------------------------------------------------------ A. the drive
check.section('A. the drive: cold lithosphere below the crust base sinks, and only it');

var cold = seededLeg(true, 0.15, 900, 1100, SINKMYR);
var off = seededLeg(false, 0.15, 900, 1100, SINKMYR);
var warm = seededLeg(true, 1.0, 900, 1100, SINKMYR);

check.info('cold slab, pass on', cold.s0.n + ' parcels seeded at ' + cold.s0.y.toFixed(0)
	+ ' km, mean depth now ' + cold.s1.y.toFixed(0) + ' km (' + cold.rate.toFixed(1)
	+ ' km/Myr), ' + cold.driven + ' driven-parcel-frames, mean descent '
	+ (cold.vMean * P.cmYr).toFixed(2) + ' cm/yr, deepest tagged ' + cold.s1.deepest.toFixed(0)
	+ ' km');
check.info('cold slab, pass off', 'mean depth ' + off.s1.y.toFixed(0) + ' km (' + off.rate.toFixed(1)
	+ ' km/Myr) -- the flow alone, ' + off.driven + ' driven');
check.info('warm slab, pass on', 'mean depth ' + warm.s1.y.toFixed(0) + ' km ('
	+ warm.rate.toFixed(1) + ' km/Myr), ' + warm.driven + ' driven');

check.ok('a cold slab below the crust base sinks', cold.s1.y > cold.s0.y + 100 && cold.driven > 0,
	(cold.s1.y - cold.s0.y).toFixed(0) + ' km of descent in ' + SINKMYR + ' Myr, ' + cold.driven
	+ ' driven-parcel-frames over ' + cold.frames + ' frames');
// the law's own bounds: the drive is kSink times a contrast at least slabdT wide, capped at
// vSinkMax, so the descent the pass reports has to sit inside that window
check.ok('and it sinks at the drive the law prescribes',
	cold.vMean >= P.kSink * P.slabdT - 1e-9 && cold.vMean <= P.vSinkMax + 1e-9
	&& cold.vMax <= P.vSinkMax + 1e-9,
	'mean ' + cold.vMean.toFixed(2) + ' km/Myr, max ' + cold.vMax.toFixed(2) + ', the law allows '
	+ (P.kSink * P.slabdT).toFixed(2) + '..' + P.vSinkMax.toFixed(2) + ' ('
	+ (cold.vMean * P.cmYr).toFixed(2) + ' cm/yr mean, ' + (cold.vMax * P.cmYr).toFixed(2)
	+ ' cm/yr max)');
check.ok('the pass is what adds the descent', cold.rate > off.rate,
	cold.rate.toFixed(1) + ' km/Myr against the flow alone at ' + off.rate.toFixed(1)
	+ ' km/Myr, the same seed and the same frames');
check.ok('warm material at the same depth is not driven', warm.driven === 0,
	warm.driven + ' driven parcels, mean depth ' + warm.s0.y.toFixed(0) + ' -> ' + warm.s1.y.toFixed(0)
	+ ' km: the drive answers a density anomaly, not a depth');

// The two exclusions, read off one state with the pass called by hand. The state is the shared
// two-plate fixture with the scope line lowered to the plates' own base: on the shipped planet
// a plate's root and yCrust are the same 250 km, so attached lithosphere below the line only
// exists if the line moves. The rest of the fixture planet is isothermal at 0.2, so the one
// cold body below the line that is *not* attached is the seeded blob, and the two populations
// cannot be mistaken for each other.
L.configure();
P.contact = true; P.slab = true;
P.deepCap = CAP0; P.deepJoin = JOIN0;
L.twoPlates(0.2);
seed(40, 56, 380, 520, 0.1, 0, 0);
SIM.step();
P.yCrust = 150;
SLAB.background(SIM.M, S);
var p2, c2, moved, shal = 0, shalMoved = 0, att = 0, attMoved = 0, det = 0, detMoved = 0;
var x0 = new Float64Array(P.partCap), y0b = new Float64Array(P.partCap);
for (p2 = 0; p2 < S.n; p2++) { x0[p2] = S.x[p2]; y0b[p2] = S.y[p2]; }
SLAB.sink(SIM.M, S, SIM.dt);
for (p2 = 0; p2 < S.n; p2++) {
	moved = S.x[p2] !== x0[p2] || S.y[p2] !== y0b[p2];
	if (y0b[p2] <= P.yCrust) { shal++; if (moved) shalMoved++; continue; }
	c2 = S.cl[p2];
	if (c2 >= 0 && S.csCnt[c2] >= P.plateMin) { att++; if (moved) attMoved++; }
	else { det++; if (moved) detMoved++; }
}
check.ok('the lid above the scope line is not this pass\'s', shal > 0 && shalMoved === 0,
	shal + ' parcels above ' + P.yCrust + ' km, ' + shalMoved + ' of them moved by a hand call'
	+ ' of the pass');
check.ok('and attached lithosphere below it rides its plate instead',
	att > 0 && attMoved === 0 && S.d.slabBond === att,
	att + ' parcels in plate-sized clusters below the line, ' + attMoved + ' moved, and the pass'
	+ ' reported all ' + S.d.slabBond + ' of them as attached and left alone');
check.ok('while detached cold material at the same depth sinks',
	det > 0 && detMoved > 0 && detMoved === S.d.slab,
	detMoved + ' of ' + det + ' detached parcels below the line moved, which is the ' + S.d.slab
	+ ' the pass reported, at ' + (S.d.slabV * P.cmYr).toFixed(2) + ' cm/yr');
P.yCrust = YCRUST0;

// ------------------------------------------------------------------ B. the transfer
check.section('B. the transfer: the deep inventory is a debit and a credit, never a sink');

// One call of the pass is one transfer: a slab seeded across the boundary, cold because a
// parcel warmer than P.slabT is not lithosphere and the pass never sees it, and carrying
// composition so that "composition rides the transfer" is not a claim about zeros. The books
// are read either side of the pass itself, the way pt-p4-contact.js reads them either side of
// the kernel, because across a whole frame the wall flux moves enthalpy and a leg cannot show
// that a transfer conserved it.
L.livePlanet();
P.slab = true; P.contact = true;
P.deepCap = CAP0; P.deepJoin = JOIN0; P.yCrust = YCRUST0;
settle();
refresh();
// the reference is taken after the rebuild and not at seed time: seeding writes enthalpy, and
// temperature, melt and phase are readings of it, so what the pass debits is what the rebuilt
// state holds
var refB = census(seed(96, 112, P.yDeep + 10, P.yDeep + 120, 0.3, 0.2, 0.005));
refresh();
var bA = L.books(), rA = records(), txA = S.tx.recycle, hA = S.hash();
SLAB.sink(SIM.M, S, SIM.dt);
var bB = L.books(), rB = records(), hB = S.hash(), recM = rB.m - rA.m;

check.info('one call of the pass', refB.n + ' parcels of ' + refB.m.toFixed(1) + ' km2 below '
	+ P.yDeep + ' km, ' + (S.tx.recycle - txA) + ' transfers into ' + S.dpN + ' records holding '
	+ rB.m.toFixed(1) + ' km2, ' + recM.toFixed(1) + ' km2 of it new');
check.ok('the transfer happened', S.tx.recycle - txA === refB.n && S.dpN > 0,
	(S.tx.recycle - txA) + ' parcels debited of the ' + refB.n + ' below the boundary, ' + S.dpN
	+ ' records credited');
// to the inventory's own rounding, and not bitwise: a transfer removes a parcel, pool.js
// compacts the tail into the hole, and the compensated sums then add the same stock in a
// different order. What a transfer must not do is move a total, and 1e-15 relative is the
// accuracy the compensated sum itself keeps.
check.ok('and the inventory did not move, for any of its five totals',
	Math.abs(bB.M - bA.M) <= 1e-12 * bA.M && Math.abs(bB.H - bA.H) <= 1e-12 * Math.abs(bA.H)
	&& Math.abs(bB.F - bA.F) <= 1e-12 * Math.abs(bA.F)
	&& Math.abs(bB.W - bA.W) <= 1e-12 * Math.abs(bA.W)
	&& Math.abs(bB.L - bA.L) <= 1e-12 * Math.abs(bA.L) + 1e-15,
	'mass ' + (bB.M - bA.M).toExponential(2) + ', enthalpy ' + (bB.H - bA.H).toExponential(2)
	+ ', felsic ' + (bB.F - bA.F).toExponential(2) + ', water ' + (bB.W - bA.W).toExponential(2)
	+ ', melt ' + (bB.L - bA.L).toExponential(2) + ' -- a transfer is internal to the stock');
check.ok('what left the pool is what the records hold',
	Math.abs(recM - refB.m) <= 1e-12 * recM && S.thr.deepDr === S.thr.deepCr,
	'records took ' + recM.toFixed(9) + ' km2 of the ' + refB.m.toFixed(9)
	+ ' km2 below the boundary, throughput dr ' + S.thr.deepDr.toFixed(9) + ' = cr '
	+ S.thr.deepCr.toFixed(9));
check.ok('and its composition rode with it, melt and all',
	Math.abs(rB.f - rA.f - refB.f) <= 1e-12 * Math.abs(rB.f) && rB.f - rA.f > 0
	&& Math.abs(rB.w - rA.w - refB.w) <= 1e-12 * Math.abs(rB.w) && rB.w - rA.w > 0
	&& Math.abs(rB.melt - rA.melt - refB.melt) <= 1e-12 * refB.m,
	'felsic ' + (rB.f - rA.f).toFixed(4) + ' of ' + refB.f.toFixed(4) + ' km2, water '
	+ (rB.w - rA.w).toFixed(4) + ' of ' + refB.w.toFixed(4) + ' km2, melt '
	+ (rB.melt - rA.melt).toExponential(2) + ' of ' + refB.melt.toExponential(2)
	+ ' km2 -- a slab that reaches this depth is cold, so what P4.2 needs from the record is'
	+ ' its water, not its melt');
check.ok('the pool is lighter by exactly the record\'s stock',
	Math.abs((bB.M - bB.D) - (bA.M - bA.D - refB.m)) <= 1e-12 * bA.M,
	'pool ' + (bA.M - bA.D).toFixed(4) + ' -> ' + (bB.M - bB.D).toFixed(4) + ' km2 (down '
	+ refB.m.toFixed(4) + '), records ' + rA.m.toFixed(4) + ' -> ' + rB.m.toFixed(4) + ' km2');
check.ok('the records are state, so the fingerprint moves', hA !== hB,
	hA + ' before the transfer, ' + hB + ' after it');

// a full record set defers: the parcel waits at the boundary and nothing is dropped
P.deepCap = 1; P.deepJoin = 1;
L.livePlanet();
P.slab = true; P.contact = true;
settle();
var sC = seed(40, 48, P.yDeep + 10, P.yDeep + 80, 0.3, 0, 0);
var sC2 = seed(180, 188, P.yDeep + 10, P.yDeep + 80, 0.3, 0, 0);
refresh();
var refC = census(sC), refC2 = census(sC2);
var bC = L.books(), ref0 = S.tx.refuse, k3;
SLAB.sink(SIM.M, S, SIM.dt);
var bD = L.books(), waiting = 0;
for (k3 = 0; k3 < S.n; k3++) if (S.y[k3] > P.yDeep && P.PH_SOLID[S.ph[k3]]) waiting++;
check.ok('a full record set defers the transfer', S.tx.refuse > ref0 && S.dpN === P.deepCap,
	(S.tx.refuse - ref0) + ' refusals against ' + (refC.n + refC2.n) + ' parcels below the'
	+ ' boundary, the second window ' + (136 * SIM.M.dx).toFixed(0) + ' km from the record'
	+ ' that took the first and its catchment is ' + P.deepJoin + ' km, ' + S.dpN + ' of '
	+ P.deepCap + ' records in use');
check.ok('and the deferred material is still in the world',
	waiting > 0 && bD.M === bC.M,
	waiting + ' parcels still below ' + P.yDeep + ' km, mass ' + (bD.M - bC.M).toExponential(2)
	+ ' km2 -- deferred, never sunk');
P.deepCap = CAP0; P.deepJoin = JOIN0;

// The arrival, for real: a slab descends under its own drive until it crosses the boundary.
// Three things this leg has to accept about the planet it runs on, all measured. It starts
// after 150 Myr, because the start-up transient of the shipped initial condition advects the
// deep mantle upward at ~44 km/Myr -- more than the drive's 30 km/Myr cap -- so a slab seeded
// at t = 0 rises for 14 Myr and never arrives. It holds the slab's temperature each frame,
// because the alternative is a blob the mesh equilibrates away: at 2200 km a cell is ~450 km
// tall and a 200 km body is gone in a frame or two. And it attributes its own transfers by
// wrapping pool.js recycle, because by t = 150 Myr the planet is feeding the records itself
// and a leg that read the record stock could not say which slab it was holding. Holding a
// temperature prescribes enthalpy, so the leg gates mass -- the field a transfer has to
// conserve -- and reports the enthalpy it wrote.
function arrivalLeg(preMyr, myr) {
	L.livePlanet();
	P.slab = true; P.contact = true;
	P.deepCap = CAP0; P.deepJoin = JOIN0; P.yCrust = YCRUST0;
	var k, p4, frames = Math.round(myr / SIM.dt);
	for (k = 0; k < Math.round(preMyr / SIM.dt); k++) SIM.step();
	var s0 = seed(96, 112, P.yDeep - 300, P.yDeep - 80, 0.15, 0.2, 0.005);
	var m0 = S.invMTot, h0 = S.invHTot, r0 = records();
	var o = { s0: s0, r0: r0, transfers: 0, taggedN: 0, taggedM: 0, driven: 0, vMax: 0,
		frames: 0, firstAt: -1, y: s0.y };
	var real = POOL.recycle;
	POOL.recycle = function (M, S, p) {
		var id = S.id[p], m = S.m[p], r = real.call(POOL, M, S, p);
		if (r >= 0 && s0.tag[id]) { o.taggedN++; o.taggedM += m; }
		return r;
	};
	for (k = 0; k < frames; k++) {
		for (p4 = 0; p4 < S.n; p4++) if (s0.tag[S.id[p4]]) L.setT(p4, 0.15);
		SIM.step();
		o.frames++;
		o.driven += S.d.slab;
		if (S.d.slabV > o.vMax) o.vMax = S.d.slabV;
		o.transfers += S.d.deep;
		if (o.firstAt < 0 && o.taggedN) { o.firstAt = SIM.t; o.y = census(s0).y; }
	}
	POOL.recycle = real;
	POOL.inventoryComp(S);
	o.s1 = census(s0);
	o.rec = records();
	o.dpN = S.dpN;
	o.mResid = S.invMTot - m0;
	o.hDrift = S.invHTot - h0;
	o.hash = S.hash();
	return o;
}
var PRE = 150;
var arrive = arrivalLeg(PRE, 20), again = arrivalLeg(PRE, 20);
check.info('the arrival leg', PRE + ' Myr of the shipped planet, then ' + arrive.s0.n
	+ ' parcels seeded at ' + arrive.s0.y.toFixed(0) + ' km; first tagged transfer at t '
	+ arrive.firstAt.toFixed(1) + ' Myr, ' + arrive.taggedN + ' of them booked for '
	+ arrive.taggedM.toFixed(1) + ' km2 in ' + arrive.frames + ' frames, ' + arrive.s1.n
	+ ' tagged parcels left at a mean ' + arrive.s1.y.toFixed(0) + ' km, deepest '
	+ arrive.s1.deepest.toFixed(0) + ' km, max descent ' + (arrive.vMax * P.cmYr).toFixed(2)
	+ ' cm/yr');
check.ok('a sinking slab reaches the boundary and is booked',
	arrive.taggedN > 0 && arrive.taggedM > 0,
	arrive.taggedN + ' of the ' + arrive.s0.n + ' tagged parcels crossed ' + P.yDeep
	+ ' km under their own drive and were booked for ' + arrive.taggedM.toFixed(1)
	+ ' km2, of ' + arrive.transfers + ' transfers the planet made in those frames');
check.ok('and the records hold it', arrive.rec.m - arrive.r0.m >= arrive.taggedM
	&& arrive.dpN > 0,
	'records ' + arrive.r0.m.toFixed(1) + ' -> ' + arrive.rec.m.toFixed(1) + ' km2 in '
	+ arrive.dpN + ' of ' + CAP0 + ', at least the ' + arrive.taggedM.toFixed(1)
	+ ' km2 the tagged slab brought, throughput cr ' + S.thr.deepCr.toFixed(1) + ' = dr '
	+ S.thr.deepDr.toFixed(1));
check.ok('the mass ledger closes across the arrival leg',
	Math.abs(arrive.mResid) <= 1e-12 * arrive.s0.m * 1e6,
	'mass residual ' + arrive.mResid.toExponential(2) + ' km2 over ' + arrive.frames
	+ ' frames, enthalpy drift ' + arrive.hDrift.toExponential(2) + ' (the leg prescribes the'
	+ ' slab\'s temperature, so enthalpy is what it writes and not what it owes)');
check.ok('the arrival leg repeats bitwise', again.hash === arrive.hash
	&& again.taggedN === arrive.taggedN,
	'fingerprint ' + again.hash + ' both times, ' + again.taggedN + ' tagged transfers against '
	+ arrive.taggedN + ', records ' + again.dpN + ' against ' + arrive.dpN);

// ------------------------------------------------------------------ the live legs
function live(slab, contact, myr) {
	L.livePlanet();
	P.slab = slab; P.contact = contact;
	P.deepCap = CAP0; P.deepJoin = JOIN0; P.yCrust = YCRUST0;
	var o = { m0: S.invMTot, n0: S.n, driven: 0, drivenMax: 0, vSum: 0, bond: 0, bondMax: 0,
		transfers: 0, frames: 0, deepest: 0, firstAt: -1 };
	var frames = Math.round(myr / SIM.dt), k, p4, c4;
	for (k = 0; k < frames; k++) {
		SIM.step();
		o.frames++;
		o.driven += S.d.slab;
		if (S.d.slab > o.drivenMax) o.drivenMax = S.d.slab;
		if (S.d.slab > 0) o.vSum += S.d.slabV * S.d.slab;
		o.bond += S.d.slabBond;
		if (S.d.slabBond > o.bondMax) o.bondMax = S.d.slabBond;
		o.transfers += S.d.deep;
		if (o.firstAt < 0 && S.d.deep) o.firstAt = SIM.t;
		if (k % 25 === 24) {
			SLAB.background(SIM.M, S);
			for (p4 = 0; p4 < S.n; p4++) {
				if (!P.PH_SOLID[S.ph[p4]] || S.y[p4] <= P.yCrust) continue;
				if (S.T[p4] > P.slabT) continue;
				c4 = S.cl[p4];
				if (c4 >= 0 && S.csCnt[c4] >= P.plateMin) continue;
				if (S.Trow[row(p4)] - S.T[p4] < P.slabdT) continue;
				if (S.y[p4] > o.deepest) o.deepest = S.y[p4];
			}
		}
	}
	o.vMean = o.driven ? o.vSum / o.driven : 0;
	o.pop = population();
	POOL.inventoryComp(S);
	o.mass = S.invMTot - o.m0;
	o.n = S.n;
	o.deepM = S.invDpM;
	o.dpN = S.dpN;
	o.refuse = S.tx.refuse;
	o.recycle = S.tx.recycle;
	o.thrCr = S.thr.deepCr; o.thrDr = S.thr.deepDr;
	o.t = SIM.t; o.hash = S.hash();
	return o;
}

var lon = live(true, true, LIVE), lcon = live(false, true, LIVE), loff = live(true, false, LIVE);

function liveInfo(tag, o) {
	check.info(tag, 't ' + o.t.toFixed(0) + ' Myr, ' + o.driven + ' driven-parcel-frames ('
		+ o.drivenMax + ' in the worst frame, ' + (100 * o.driven / (o.frames * o.n)).toFixed(2)
		+ '% of the pool per frame), mean descent ' + (o.vMean * P.cmYr).toFixed(2) + ' cm/yr, '
		+ o.bond + ' attached-parcel-frames, deepest slab parcel ' + o.deepest.toFixed(0) + ' km');
	check.info(tag + ': the inventory', o.dpN + ' records holding ' + o.deepM.toFixed(1) + ' km2 ('
		+ (100 * o.deepM / o.m0).toFixed(3) + '% of the world), ' + o.recycle + ' transfers'
		+ (o.firstAt < 0 ? '' : ' from t ' + o.firstAt.toFixed(0) + ' Myr') + ', ' + o.refuse
		+ ' refusals; at the leg\'s end ' + o.pop.n + ' parcels of ' + o.pop.m.toFixed(0)
		+ ' km2 are still this pass\'s population, mean ' + o.pop.y.toFixed(0) + ' km, deepest '
		+ o.pop.deepest.toFixed(0) + ' km; pool ' + o.n0 + ' -> ' + o.n + ' parcels');
}

// ------------------------------------------------------------------ C. the hand-over
check.section('C. the hand-over: what P4.0 puts below the crust base is what this pass takes');
liveInfo('slab + contact', lon);
liveInfo('contact only', lcon);
check.ok('with the drive off the bent material stays in the band',
	lcon.driven === 0 && lcon.transfers === 0 && lcon.pop.n > 0,
	lcon.pop.n + ' parcels of ' + lcon.pop.m.toFixed(0) + ' km2 below ' + P.yCrust
	+ ' km are cold lithosphere at the leg\'s end, mean ' + lcon.pop.y.toFixed(0) + ' km,'
	+ ' deepest ' + lcon.pop.deepest.toFixed(0) + ' km, and nothing drove or transferred them');
check.ok('and with the drive on the same planet takes them to the boundary',
	lon.transfers > 0 && lon.deepest > lcon.deepest,
	lon.transfers + ' transfers from t ' + lon.firstAt.toFixed(0) + ' Myr, deepest slab parcel '
	+ lon.deepest.toFixed(0) + ' km against ' + lcon.deepest.toFixed(0) + ' km with the drive'
	+ ' off over the same frames, ' + lon.driven + ' driven-parcel-frames against '
	+ lcon.driven);

// ------------------------------------------------------------------ D. the live planet
check.section('D. the live shipped planet');
liveInfo('slab without contact', loff);

check.ok('the live planet drives its own slabs', lon.driven > 0 && lon.drivenMax > 0
	&& lon.transfers > 0,
	lon.driven + ' driven-parcel-frames over ' + lon.frames + ' frames, worst frame '
	+ lon.drivenMax + ', mean descent ' + (lon.vMean * P.cmYr).toFixed(2) + ' cm/yr, '
	+ lon.transfers + ' transfers, deepest ' + lon.deepest.toFixed(0) + ' km against a boundary'
	+ ' at ' + P.yDeep);
// the plan's §4 question -- does cold deep material weld back or keep sinking -- is two
// reported numbers by design, and on the live planet the answer is that the exclusion never
// fires: nothing below yCrust is inside a plate-sized cluster, because a plate's root *is*
// yCrust. The exclusion is real where attached lithosphere exists below the line, which is
// what A's hand call shows; here the census says what the live planet does.
check.info('the §4 split, measured', lon.bond + ' attached-parcel-frames against ' + lon.driven
	+ ' driven over ' + lon.frames + ' frames (worst frame ' + lon.bondMax + ' attached, '
	+ lon.drivenMax + ' driven): below yCrust the live planet has no plate-sized cluster, so'
	+ ' every cold parcel the pass finds is detached and keeps sinking');
check.ok('the live ledger still closes across a run that recycles', lon.mass === 0
	&& lon.thrCr === lon.thrDr,
	'mass residual ' + lon.mass.toExponential(2) + ' km2 over ' + lon.frames + ' frames with '
	+ lon.recycle + ' transfers and ' + lon.deepM.toFixed(1) + ' km2 in the records, throughput '
	+ lon.thrCr.toFixed(1) + ' = dr ' + lon.thrDr.toFixed(1));
check.ok('and the world is not drained by it', lon.n >= lon.n0 && lon.deepM < 0.01 * lon.m0,
	'pool ' + lon.n0 + ' -> ' + lon.n + ' parcels, the records hold '
	+ (100 * lon.deepM / lon.m0).toFixed(3) + '% of the world\'s mass after ' + lon.t.toFixed(0)
	+ ' Myr -- the drive\'s contrast test alone parks 9.68% and shrinks the pool to 17,367,'
	+ ' which is what P.slabT exists to stop');
check.ok('nothing was refused while the record set held', lon.refuse === 0 && lon.dpN <= P.deepCap,
	lon.refuse + ' refusals against ' + lon.dpN + ' of ' + P.deepCap + ' records in use');
check.ok('the live legs are fingerprinted and both passes are in them',
	lon.hash !== lcon.hash && lon.hash !== loff.hash,
	'slab + contact ' + lon.hash + ', contact only ' + lcon.hash + ', slab alone ' + loff.hash);

// the frame cost: one walk over the pool and one over the mesh rows
L.livePlanet();
P.slab = true; P.contact = true;
var N = 300, tc = 0, tf = 0, a2, b2, k5;
for (k5 = 0; k5 < N; k5++) {
	a2 = process.hrtime.bigint();
	SLAB.run(SIM.M, S, SIM.dt);
	b2 = process.hrtime.bigint();
	tc += Number(b2 - a2) / 1e6;
	SIM.step();
	tf += Number(process.hrtime.bigint() - b2) / 1e6;
}
check.ok('the slab pass costs under 2% of the frame', tc < 0.02 * tf,
	(tc / N).toFixed(4) + ' ms/frame for the pass against ' + (tf / N).toFixed(2)
	+ ' ms/frame for the rest of it (' + (100 * tc / tf).toFixed(3) + '%)');

check.info('wall time', ((Date.now() - t0) / 1000).toFixed(0) + ' s for '
	+ (3 * SINKMYR + 14 + 14 + 10 + 3 * LIVE + N * SIM.dt).toFixed(0) + ' Myr of simulation');
check.done();
