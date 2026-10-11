// pt-p3-erupt.js — 0.3.0 P3.3: conduits, vent schedules and metered eruption supply
// (0.3.0-p3-plan.md §4 P3.3, §1.2).
//
// The plan makes the chamber's melt leave through a conduit that opens on an overpressure
// rule, and makes the schedule meter what the chamber holds. This harness measures each rule
// against an independent calculation, then runs the shipped pipeline and a footprint fixture:
//
//   1. the threshold   -- the roof opens at its lithostatic load plus its tensile strength, the
//                         sign is right at the boundary, and a stronger roof holds more head
//   2. the states      -- a closed conduit and a blocked one do not drain; a blocked one counts
//   3. the schedules   -- effusive and explosive drains are the rate law exactly, the explosive
//                         one is kBlast / kVent faster, and the style is fixed at opening
//   4. the seal        -- the drain stops at the threshold and the remainder stays in the chamber
//                         as intrusive storage; the schedule cannot take more than the chamber
//                         holds
//   5. the transfer    -- every extensive field (mass, enthalpy, melt, felsic, water) is debited
//                         from the chamber and credited to the vent exactly, intensives unchanged
//   6. the room        -- a full schedule caps the drain and blocks the conduit, nothing dropped
//   7. the books       -- vent stock closes inside the pool inventory exactly once; throughput is
//                         matched debit/credit and reported apart from stock; zero time changes
//                         nothing
//   8. the live run    -- 100 Myr of the shipped pipeline (footprint 400 km): closure, no NaN,
//                         and the margin between the largest head and its threshold
//   9. the live run    -- 100 Myr with the footprint at 100 km, a fixture that opens conduits so
//                         the whole path runs live: closure with vents in the inventory, blocked
//                         conduits counted, enthalpy and the latent identity unmoved
//  10. the crystal     -- a chamber with no melt is stock once, with mass and heat and no melt
//
// Report-only numbers (the margin, the footprint at which the shipped run would open, the time
// the fixture's schedules fill) never edit params.js. Run: node experiments/pt-p3-erupt.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js');
var S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PTPOOL = require(B + 'pool.js'), VENT = require(B + 'vent.js');

var t0 = Date.now(), M;

function configure(chSpan) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4; P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1;
	P.meltHold = 0.1; P.vMelt = 60; P.yCham = 80; P.chJoin = 400; P.chCap = 64;
	P.chSpan = chSpan || 400;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	return SIM.M;
}

function inv() { PTPOOL.inventoryComp(S); return { m: S.invMTot, h: S.invHTot, f: S.invFTot, w: S.invWTot, l: S.invLTot }; }
function identity() { return (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0); }
function sum(a, n) { var s = 0, i; for (i = 0; i < n; i++) s += a[i]; return s; }
// the melt-phase mass in flight: the other side of the melt book (segregated mass, plus whole-parcel
// melting, less freeze-backs, is what intrusions and the mass still in flight must add up to)
function meltInFlight() { var k, m = 0; for (k = 0; k < S.n; k++) if (S.ph[k] === P.PH.melt) m += S.m[k]; return m; }
function meltBookGap() { return S.thr.seg + S.thr.whole - S.thr.freeze - (S.thr.intrDr + meltInFlight()); }

// one chamber record at a chosen head (km of rock head) and roof depth, with a stock whose
// intensives are fixed: H = 1.25, melt = 1, felsic 0.1, water cW. The roof strength is flat.
function chamber(k, y, head, mug, cW) {
	var m = head * P.chSpan;
	S.chN = Math.max(S.chN, k + 1);
	S.chX[k] = 4000; S.chY[k] = y;
	S.chM[k] = m; S.chH[k] = 1.25 * m; S.chL[k] = m; S.chF[k] = 0.1 * m; S.chW[k] = (cW || 0) * m;
	S.vState[k] = 0; S.vStyle[k] = 0;
	S.vM[k] = 0; S.vH[k] = 0; S.vL[k] = 0; S.vF[k] = 0; S.vW[k] = 0;
	S.mug.fill(mug || 0);
}

// ---------------------------------------------------------------- 1. the threshold
check.section('1. the roof opens at its lithostatic load plus its tensile strength');
M = configure(0);
chamber(0, 64, 64, 0.5);
check.ok('the threshold is the depth plus tensile times the roof strength',
	Math.abs(VENT.threshold(M, S, 0) - (64 + P.tensile * 0.5)) < 1e-12,
	'threshold ' + VENT.threshold(M, S, 0).toFixed(6) + '   expected ' + (64 + P.tensile * 0.5).toFixed(6) + ' km');
chamber(0, 64, 64, 0);
check.ok('with no strength the threshold is exactly the lithostatic load', VENT.threshold(M, S, 0) === 64,
	'threshold ' + VENT.threshold(M, S, 0));
chamber(0, 64, 64.2, 0.5);
check.ok('a strong roof holds more head: 64.2 km opens it at mug 0.5 (threshold 64.15)',
	VENT.head(S, 0) > VENT.threshold(M, S, 0), 'head ' + VENT.head(S, 0) + ' vs ' + VENT.threshold(M, S, 0).toFixed(3));
chamber(0, 64, 64.2, 1);
check.ok('and holds it shut at mug 1 (threshold 64.3)', VENT.head(S, 0) <= VENT.threshold(M, S, 0),
	'head ' + VENT.head(S, 0) + ' vs ' + VENT.threshold(M, S, 0).toFixed(3));

// ---------------------------------------------------------------- 2. the states
check.section('2. a closed conduit and a blocked one do not drain');
M = configure(0);
chamber(0, 64, 64, 0);                           // head exactly at the threshold
var mAt = S.chM[0];
VENT.run(M, S, 0.05); VENT.run(M, S, 0.05);
check.ok('at the threshold the conduit stays closed and the chamber keeps all of it',
	S.vState[0] === VENT.CLOSED && S.chM[0] === mAt && S.vM[0] === 0,
	'state ' + S.vState[0] + '   chM ' + S.chM[0] + '   vM ' + S.vM[0]);
chamber(0, 64, 70, 0);
S.vM[0] = P.vCap;
var mFull = S.chM[0], rb = S.tx.block;
VENT.run(M, S, 0.05);
check.ok('an overpressured conduit with a full schedule is blocked and does not drain',
	S.vState[0] === VENT.BLOCKED && S.chM[0] === mFull && S.vM[0] === P.vCap,
	'state ' + S.vState[0] + '   chM ' + S.chM[0] + '   vM ' + S.vM[0]);
check.ok('the block is counted, one event per attempt', S.tx.block === rb + 1, 'block ' + S.tx.block);

// ---------------------------------------------------------------- 3. the schedules
check.section('3. effusive and explosive schedules drain at the rate law');
M = configure(0);
var dt = 0.05;
chamber(0, 64, 70, 0, 0);                        // dry: effusive
VENT.run(M, S, dt);
var expEff = P.kVent * (70 - 64) * P.chSpan * dt;
check.ok('the effusive drain is kVent times the excess times the footprint times dt',
	Math.abs(S.vM[0] - expEff) < 1e-9 * expEff, 'drained ' + S.vM[0].toFixed(6) + '   expected ' + expEff.toFixed(6) + ' km2');
check.ok('a dry chamber is effusive', S.vStyle[0] === VENT.EFFUSIVE && S.vState[0] === VENT.OPEN,
	'style ' + S.vStyle[0] + '   state ' + S.vState[0]);
M = configure(0);
chamber(1, 64, 70, 0, 0.05);                     // water fraction 0.05 > wBlast: explosive
VENT.run(M, S, dt);
var expBlast = P.kBlast * (70 - 64) * P.chSpan * dt;
check.ok('a wet chamber is explosive, and drains at kBlast', S.vStyle[1] === VENT.EXPLOSIVE
	&& Math.abs(S.vM[1] - expBlast) < 1e-9 * expBlast, 'style ' + S.vStyle[1] + '   drained ' + S.vM[1].toFixed(6)
	+ '   expected ' + expBlast.toFixed(6));
check.near('at the same excess, explosive over effusive is kBlast over kVent', expBlast / expEff,
	P.kBlast / P.kVent, 1e-12, '');
S.chW[1] = 0;
VENT.run(M, S, dt);
check.ok('the style is fixed when the conduit opens: drying the chamber does not re-style it',
	S.vStyle[1] === VENT.EXPLOSIVE, 'style ' + S.vStyle[1]);

// ---------------------------------------------------------------- 4. the seal
check.section('4. the drain stops at the threshold and the rest stays stored');
M = configure(0);
chamber(0, 0.5, 3, 0);                           // head 3, threshold 0.5: excess 2.5
var tot0 = S.chM[0] + S.vM[0];
VENT.run(M, S, 10);                              // a long step: the rate would drain 5000 km2
check.ok('a long step cannot drain past the overpressure: the conduit seals',
	S.vState[0] === VENT.CLOSED, 'state ' + S.vState[0]);
check.near('the vent takes exactly the overpressure, 2.5 km of head over the footprint',
	S.vM[0], 2.5 * P.chSpan, 1e-12, 'km2');
check.near('the chamber keeps the threshold head: the intrusive remainder', S.chM[0], 0.5 * P.chSpan, 1e-12, 'km2');
check.near('and nothing was made: chamber plus vent equal the start', S.chM[0] + S.vM[0], tot0, 1e-12, 'km2');
M = configure(0);
chamber(0, 0.5, 3, 0);
VENT.run(M, S, 0.05);
check.ok('a short step drains only what the rate allows, and stays open',
	S.vState[0] === VENT.OPEN && S.vM[0] < 2.5 * P.chSpan, 'state ' + S.vState[0] + '   drained ' + S.vM[0].toFixed(2));

// ---------------------------------------------------------------- 5. the transfer
check.section('5. the transfer splits every extensive field exactly');
M = configure(0);
chamber(0, 64, 70, 0, 0.03);
var before = { m: S.chM[0], h: S.chH[0], l: S.chL[0], f: S.chF[0], w: S.chW[0] };
var rH0 = before.h / before.m, rL0 = before.l / before.m, rF0 = before.f / before.m, rW0 = before.w / before.m;
VENT.run(M, S, 0.5);
var after = { m: S.chM[0] + S.vM[0], h: S.chH[0] + S.vH[0], l: S.chL[0] + S.vL[0], f: S.chF[0] + S.vF[0], w: S.chW[0] + S.vW[0] };
check.near('mass is debited and credited exactly', after.m, before.m, 1e-12, 'km2');
check.near('enthalpy is debited and credited exactly', after.h, before.h, 1e-12, 'km2*H');
check.near('melt is debited and credited exactly', after.l, before.l, 1e-12, 'km2');
check.near('felsic is debited and credited exactly', after.f, before.f, 1e-12, 'km2');
check.near('water is debited and credited exactly', after.w, before.w, 1e-12, 'km2');
// a share of every field leaves together, so the intensives (per unit mass) are unchanged on
// both sides of the pair
check.near('the chamber keeps its enthalpy per unit mass', S.chH[0] / S.chM[0], rH0, 1e-12, '');
check.near('and its melt per unit mass', S.chL[0] / S.chM[0], rL0, 1e-12, '');
check.near('and its felsic per unit mass', S.chF[0] / S.chM[0], rF0, 1e-12, '');
check.near('and its water per unit mass', S.chW[0] / S.chM[0], rW0, 1e-12, '');
check.near('the vent takes the same enthalpy per unit mass', S.vH[0] / S.vM[0], rH0, 1e-12, '');
check.near('and the same melt, felsic and water per unit mass', S.vL[0] / S.vM[0] + S.vF[0] / S.vM[0]
	+ S.vW[0] / S.vM[0], rL0 + rF0 + rW0, 1e-12, '');

// ---------------------------------------------------------------- 6. the room
check.section('6. a full schedule caps the drain, then blocks the conduit');
M = configure(0);
chamber(0, 0.5, 60, 0, 0);                       // a large excess: the room binds first
S.vM[0] = P.vCap - 10;
VENT.run(M, S, 1);
check.near('the drain takes exactly the 10 km2 left, and fills the vent to its capacity', S.vM[0], P.vCap, 1e-12, 'km2');
check.ok('and the conduit is still open at that step', S.vState[0] === VENT.OPEN, 'state ' + S.vState[0]);
var chamberAtFull = S.chM[0];
VENT.run(M, S, 1);
check.ok('the next step finds the schedule full and blocks', S.vState[0] === VENT.BLOCKED
	&& S.chM[0] === chamberAtFull, 'state ' + S.vState[0] + '   chM ' + S.chM[0]);

// ---------------------------------------------------------------- 7. the books
check.section('7. vent stock is inventory once, throughput is matched and apart');
M = configure(0);
chamber(0, 64, 70, 0.2, 0.02);
chamber(1, 40, 80, 0.2, 0.0);
chamber(2, 0.3, 3, 0.0, 0.01);
var b0 = inv(), id0 = identity(), hL0 = S.hLedger, led0 = S.ledger;
for (var r = 0; r < 20; r++) VENT.run(M, S, 0.2);
var b1 = inv();
check.near('the pool inventory closes over vent drains (mass)', b1.m, b0.m, 1e-12, 'km2');
check.near('and enthalpy', b1.h, b0.h, 1e-12, 'km2*H');
check.near('and melt', b1.l, b0.l, 1e-12, 'km2');
check.near('and felsic', b1.f, b0.f, 1e-12, 'km2');
check.near('and water', b1.w, b0.w, 1e-12, 'km2');
check.ok('the latent identity does not move: melt in a vent is melt in the book',
	identity() === id0 && S.hLedger === hL0 && S.ledger === led0,
	'identity ' + identity().toExponential(3) + ' vs ' + id0.toExponential(3));
check.near('the vent stock is counted in its own line', S.invVM, sum(S.vM, S.chN), 1e-12, 'km2');
check.near('and its melt in the inventory melt', S.invVL, sum(S.vL, S.chN), 1e-12, 'km2');
check.near('the drained mass is the vent stock, since no schedule has given any back', S.thr.ventCr,
	sum(S.vM, S.chN), 1e-12, 'km2');
check.ok('throughput debit and credit match exactly', S.thr.ventDr === S.thr.ventCr,
	'debit ' + S.thr.ventDr + '   credit ' + S.thr.ventCr);
check.near('the total is the particles plus the chambers plus the vents', b1.m,
	sum(S.m, S.n) + sum(S.chM, S.chN) + sum(S.vM, S.chN), 1e-12, 'km2');
var hashZ = S.hash();
VENT.run(M, S, 0);
check.ok('zero geological time changes nothing', S.hash() === hashZ, 'hash ' + S.hash());

// ---------------------------------------------------------------- 8. the shipped run
check.section('8. 100 Myr of the shipped pipeline (footprint 400 km)');
M = configure(0);
var lc0 = inv(), hl0 = S.hLedger, frames = 2000, fk, nan = 0, pk, maxEx = -1e9, maxK = -1;
var opened = 0, kk, ex;
for (fk = 0; fk < frames; fk++) {
	SIM.step();
	for (kk = 0; kk < S.chN; kk++) {
		ex = VENT.head(S, kk) - VENT.threshold(M, S, kk);
		if (ex > maxEx) { maxEx = ex; maxK = kk; }
	}
	opened = Math.max(opened, VENT.count(S, VENT.OPEN) + VENT.count(S, VENT.BLOCKED));
}
for (pk = 0; pk < S.n; pk++) if (!isFinite(S.H[pk]) || !isFinite(S.m[pk]) || !isFinite(S.T[pk])) nan++;
var lc1 = inv(), entRes8 = ((lc1.h - lc0.h) - (S.hLedger - hl0)) / Math.abs(lc0.h);
check.ok('no NaN over ' + frames + ' frames', nan === 0, nan + ' sightings');
check.near('the pool and the store close: mass', lc1.m, lc0.m, 1e-12, 'km2');
check.ok('the global enthalpy residual is round-off', Math.abs(entRes8) < 1e-9, 'residual ' + entRes8.toExponential(2));
check.ok('the latent identity still holds', Math.abs(identity()) < 1e-9 * Math.abs(S.hLedger),
	'identity ' + identity().toExponential(3));
check.near('the melt book closes over the shipped run: segregated plus whole, less freeze, is intruded plus in flight',
	S.thr.seg + S.thr.whole - S.thr.freeze, S.thr.intrDr + meltInFlight(), 1e-12, 'km2');
check.ok('the shipped run opens no conduit', opened === 0 && S.tx.vent === 0 && S.invVM === 0,
	'max open ' + opened + '   vent drains ' + S.tx.vent);
check.info('the margin at the shipped footprint', 'largest head ' + (maxEx + VENT.threshold(M, S, maxK)).toFixed(1)
	+ ' km against a threshold of ' + VENT.threshold(M, S, maxK).toFixed(1) + ' km (chamber ' + maxK + ', margin '
	+ maxEx.toFixed(1) + ' km of head)');
check.info('the footprint that would open that chamber now', 'chSpan* = chM / threshold = '
	+ (S.chM[maxK] / VENT.threshold(M, S, maxK)).toFixed(0) + ' km (shipped ' + P.chSpan + ' km)');

// ---------------------------------------------------------------- 9. the fixture run
check.section('9. 100 Myr with the footprint at 100 km: the whole eruption path runs live');
M = configure(100);
// a band of felsic and water, as section 7b of pt-p3-melt does, so the closure of both is real.
// The water stays small: meltWW scales it into the solidus, and a large fraction would melt the band
var sd, seeded9 = 0;
for (sd = 0; sd < S.n; sd++) if (S.y[sd] >= 100 && S.y[sd] <= 500) { S.cF[sd] = 0.15; S.cW[sd] = 0.0008; seeded9++; }
var fx0 = inv(), hl9 = S.hLedger, nan9 = 0, first = -1;
for (fk = 0; fk < frames; fk++) {
	SIM.step();
	if (first < 0 && VENT.count(S, VENT.OPEN) + VENT.count(S, VENT.BLOCKED) > 0) first = SIM.t;
}
for (pk = 0; pk < S.n; pk++) if (!isFinite(S.H[pk]) || !isFinite(S.m[pk]) || !isFinite(S.T[pk])) nan9++;
var fx1 = inv(), entRes9 = ((fx1.h - fx0.h) - (S.hLedger - hl9)) / Math.abs(fx0.h);
var vStock = S.invVM, drained = S.thr.ventCr, nBlk = VENT.count(S, VENT.BLOCKED);
check.ok('no NaN over ' + frames + ' frames', nan9 === 0, nan9 + ' sightings');
check.ok('conduits open on the overpressure the intrusions built', first >= 0 && S.tx.vent > 0,
	'first at ' + (first < 0 ? 'never' : first.toFixed(2) + ' Myr') + '   drain events ' + S.tx.vent);
check.near('the pool and the store close with vents in the inventory: mass', fx1.m, fx0.m, 1e-12, 'km2');
check.ok('the seed is felsic and wet', seeded9 > 0 && fx0.f > 0 && fx0.w > 0, 'parcels ' + seeded9 + '   felsic '
	+ fx0.f.toExponential(3) + '   water ' + fx0.w.toExponential(3));
check.near('felsic closes with the vents in the inventory', fx1.f, fx0.f, 1e-12, 'km2');
check.near('and water', fx1.w, fx0.w, 1e-12, 'km2');
check.ok('the global enthalpy residual is round-off', Math.abs(entRes9) < 1e-9, 'residual ' + entRes9.toExponential(2));
check.ok('the latent identity holds across the eruptions', Math.abs(identity()) < 1e-9 * Math.abs(S.hLedger),
	'identity ' + identity().toExponential(3));
check.near('the drained mass is the vent stock, once', drained, vStock, 1e-12, 'km2');
check.near('the melt book closes over the seeded run, with the eruptions beside it', S.thr.seg + S.thr.whole - S.thr.freeze,
	S.thr.intrDr + meltInFlight(), 1e-12, 'km2');
check.ok('a schedule that fills blocks its conduit and the chamber keeps the rest', S.tx.block > 0 && nBlk > 0,
	'blocked events ' + S.tx.block + '   blocked now ' + nBlk);
check.ok('nothing was dropped: refusals stay at the pool\'s own count', S.tx.refuse === 0, 'refuse ' + S.tx.refuse);
check.info('the eruption census', 'open ' + VENT.count(S, VENT.OPEN) + '   blocked ' + nBlk + '   closed '
	+ VENT.count(S, VENT.CLOSED) + '   vent stock ' + (vStock / fx1.m * 100).toFixed(3) + '% of mass   drained '
	+ drained.toFixed(0) + ' km2   explosive conduits ' + (function () {
		var k, n = 0; for (k = 0; k < S.chN; k++) if (S.vState[k] && S.vStyle[k] === VENT.EXPLOSIVE) n++; return n;
	}()));
check.info('the throughputs, apart from stock', 'segregated ' + S.thr.seg.toFixed(0) + '   intruded '
	+ S.thr.intrDr.toFixed(0) + '   drained ' + drained.toFixed(0) + ' km2  (never added to the inventory)');

// ---------------------------------------------------------------- 10. crystallised intrusions
// No chamber cools in P3.3, so the live run never holds a crystal-only record. The inventory
// is checked on a fixture instead: a record with its melt at zero adds its mass and heat once,
// and adds nothing to the melt total, so a crystallised intrusion is stock exactly once.
check.section('10. a crystallised intrusion is stock once, with no melt');
M = configure(0);
chamber(0, 64, 40, 0.2, 0.02);
var cM = S.chM[0], cH = S.chH[0], cF = S.chF[0], cW = S.chW[0];
S.chL[0] = 0;
var withCrystal = inv();
var cmBefore = S.invChM;
S.chM[0] = 0; S.chH[0] = 0; S.chF[0] = 0; S.chW[0] = 0;
var noRecord = inv();
check.near('a crystal-only record adds its mass to the inventory once', withCrystal.m - noRecord.m, cM, 1e-12, 'km2');
check.near('and its enthalpy once', withCrystal.h - noRecord.h, cH, 1e-12, 'km2*H');
check.near('and its felsic and water once', (withCrystal.f - noRecord.f) + (withCrystal.w - noRecord.w), cF + cW, 1e-12, 'km2');
check.ok('and adds no melt, since none is held', withCrystal.l === noRecord.l,
	'melt with ' + withCrystal.l.toExponential(3) + ' without ' + noRecord.l.toExponential(3));
check.ok('the chamber total counts the record in its own line, once', cmBefore === cM,
	'invChM ' + cmBefore.toFixed(3) + ' vs record ' + cM.toFixed(3));

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
