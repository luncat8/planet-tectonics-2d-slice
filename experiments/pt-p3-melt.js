// pt-p3-melt.js — 0.3.0 P3.2: melt segregation and intrusive storage
// (0.3.0-p3-plan.md §4 P3.2, §1.2, §5).
//
// The plan makes this milestone a material pipeline: a mushy parcel's melt leaves it at the
// equilibrium split, rises on its own buoyant rule, and reaches shallow storage as an
// intrusion -- every leg a matched transfer, no sink. This harness measures each leg rather
// than trusting it:
//
//   1. the split     -- the host keeps its unmelted mass at its solidus, the child takes the
//                       melt mass at its liquidus, m and H close, the sensible book moves
//                       not at all (the P3.1 identity survives a split), and the children
//                       are bitwise-quiet under the next equilibrium pass
//   2. the criterion -- meltHold gates both directions: source rock sheds at it, a wholly
//                       molten parcel is one phase change, trapped melt stays put
//   3. the refusal   -- a full pool defers and counts; the phase fraction stays in its
//                       source parcel and nothing is lost
//   4. the rise      -- hot melt moves at flow + vMelt per geological step, frozen melt and
//                       mantle do not; zero dt changes nothing
//   5. the wrap      -- rising melt crosses the periodic seam and lands inside [0, wrap)
//   6. the store     -- intrusion is a matched transfer into a chamber record; records join
//                       within chJoin; a full record set defers at the chamber depth
//   7. the live run  -- 100 Myr of the shipped pipeline: coverage, mass and enthalpy close,
//                       the marker/grid heat gap is reported separately from the global
//                       enthalpy residual, and the census reports the burst the criterion
//                       released and where the melt went
//
// Report-only for the tuning numbers (criterion histogram, reserve pressure, chamber
// census): it never edits params.js.
//
// Run: node experiments/pt-p3-melt.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), PHASE = require(B + 'phase.js');
var G = require(B + 'grid.js'), S = require(B + 'state.js'), PTPOOL = require(B + 'pool.js');
var SIM = require(B + 'sim.js'), MT = require(B + 'melt.js');

var t0 = Date.now(), M;

function configure(frames) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4; P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1;
	P.meltHold = 0.1; P.vMelt = 60; P.yCham = 80; P.chJoin = 400; P.chCap = 64;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	if (frames) SIM.run(frames);
	return SIM.M;
}

function inv() { PTPOOL.inventoryComp(S); return { m: S.invMTot, h: S.invHTot, f: S.invFTot, w: S.invWTot, l: S.invLTot }; }
function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1); }
function identity() { return (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0); }

// one parcel at a chosen melt fraction, on the law at its own depth and composition
function mush(p, y, xi, cF, cW) {
	S.x[p] = 3000 + 7 * p; S.y[p] = y; S.e[p] = Math.asinh(y / P.yLin);
	S.cF[p] = cF; S.cW[p] = cW;
	S.m[p] = 1200; S.vx[p] = 0; S.vy[p] = 0;
	var ts = PHASE.solidus(y, cF, cW);
	if (xi > 0 && xi < 1) {
		S.T[p] = ts + xi * P.meltGap;
		S.H[p] = S.T[p] + P.meltLat * xi;
		S.melt[p] = xi;
	} else if (xi >= 1) {
		S.T[p] = ts + P.meltGap; S.H[p] = S.T[p] + P.meltLat; S.melt[p] = 1;
	} else { S.T[p] = ts; S.H[p] = ts; S.melt[p] = 0; }
	return ts;
}

console.log('  melt: 256x24, 4 markers/node, Ra 1e+6, dt 0.050 Myr/frame   hold ' + P.meltHold
	+ ', vMelt ' + P.vMelt + ' km/Myr, yCham ' + P.yCham + ' km, chJoin ' + P.chJoin + ' km, chCap ' + P.chCap + '\n');

// ---------------------------------------------------------------- 1. the equilibrium split
check.section('1. a split moves material and does not melt it');
M = configure(0);
var p = 5, y = 400, cF = 0.1, cW = 0.002, xi = 0.25;
var ts = mush(p, y, xi, cF, cW), tl = ts + P.meltGap;
var idp = S.id[p], m0 = S.m[p], H0 = S.H[p], T0 = S.T[p];
var b0 = inv(), led0 = S.ledger, hled0 = S.hLedger, id0 = identity(), nxId = S.nextId;
var q = PTPOOL.separate(S, p);
check.ok('the split was admitted', q >= 0, 'child slot ' + q);
check.ok('the host keeps its id and the child is fresh', S.id[p] === idp && S.id[q] === nxId,
	'id ' + S.id[p] + '/' + S.id[q]);
check.near('the host keeps exactly its unmelted mass', S.m[p], m0 * (1 - xi), 1e-14, 'km2');
check.near('and the child takes exactly the melt mass', S.m[q], m0 * xi, 1e-14, 'km2');
check.ok('the host sits at its solidus, exactly solid',
	Math.abs(S.T[p] - ts) < 1e-15 && S.H[p] === S.T[p] && S.melt[p] === 0,
	'T ' + S.T[p] + ' = Ts ' + ts);
check.ok('the child sits at its liquidus, molten', S.ph[q] === P.PH.melt
	&& S.melt[q] > 1 - 1e-15 && Math.abs(S.T[q] - tl) < 1e-15,
	'xi ' + S.melt[q].toFixed(16) + '   T ' + S.T[q].toFixed(6) + '   Tl ' + tl.toFixed(6));
check.ok('the child carries no bond state', S.age[q] === 0 && S.dmg[q] === 0 && S.mu[q] === 0,
	'age ' + S.age[q] + '   dmg ' + S.dmg[q]);
check.ok('intensive identity is shared where the plan says so',
	S.x[q] === S.x[p] && S.y[q] === S.y[p] && S.e[q] === S.e[p]
	&& S.cF[q] === S.cF[p] && S.cW[q] === S.cW[p], 'x/y/e/cF/cW shared');
var b1 = inv();
check.near('mass closes over the split', b1.m, b0.m, 1e-14, 'km2');
check.near('enthalpy closes over the split', b1.h, b0.h, 1e-14, 'km2*H');
check.near('melt mass closes over the split', b1.l, b0.l, 1e-14, 'km2');
check.near('composition closes over the split', b1.f, b0.f, 1e-14, 'km2');
check.ok('the sensible book does not move (a split does not melt)', S.ledger === led0 && S.hLedger === hled0,
	'ledger ' + S.ledger + '   hLedger ' + S.hLedger);
check.ok('and the P3.1 identity survives it untouched', identity() === id0,
	'identity ' + identity().toExponential(3));
var o = PHASE.byH(S.H[p], S.y[p], S.cF[p], S.cW[p]);
check.ok('the residue is bitwise-quiet under the next equilibrium pass',
	o.t === S.T[p] && o.melt === S.melt[p], 'read T ' + o.t + '   xi ' + o.melt);
o = PHASE.byH(S.H[q], S.y[q], S.cF[q], S.cW[q]);
check.ok('and so is the melt child', o.t === S.T[q] && o.melt === S.melt[q],
	'read T ' + o.t + '   xi ' + o.melt);
check.ok('a pure parcel has nothing to separate', PTPOOL.separate(S, p) === -1 && PTPOOL.separate(S, q) === -1,
	'refuse ' + S.tx.refuse);

// ---------------------------------------------------------------- 2. the criterion
check.section('2. meltHold decides what leaves and what dies');
M = configure(0);
S.n = 4;
mush(0, 400, P.meltHold - 0.01, 0, 0);          // trapped: stays with its host
mush(1, 400, P.meltHold, 0, 0);                 // at the threshold: sheds
mush(2, 400, 1, 0, 0);                          // wholly molten: one phase change
S.ph[2] = P.PH.mantle;
S.age[2] = 5 * P.tauWeld; S.dmg[2] = 0.5; S.mu[2] = 0.9;
mush(3, 400, 0.5, 0, 0);                        // melt-phase mushy transit: detach leaves it
S.ph[3] = P.PH.melt;
var nA = S.n, mTrap = S.m[0], hTrap = S.H[0];
MT.detach(S);
check.ok('trapped melt stays in its source parcel',
	S.m[0] === mTrap && S.H[0] === hTrap && S.melt[0] === P.meltHold - 0.01,
	'xi ' + S.melt[0] + '   m ' + S.m[0]);
check.ok('melt at the threshold separates', S.n === nA + 1 && S.melt[1] === 0, 'n ' + S.n);
check.ok('a wholly molten parcel is one phase change to melt',
	S.ph[2] === P.PH.melt && S.melt[2] === 1 && S.n === nA + 1, 'ph ' + S.ph[2]);
check.ok('and drops its bond state with its phase',
	S.age[2] === 0 && S.dmg[2] === 0 && S.mu[2] === 0, 'age ' + S.age[2] + '   dmg ' + S.dmg[2]);
check.ok('detach is source-side only: transit melt keeps its state',
	S.ph[3] === P.PH.melt && S.melt[3] === 0.5 && S.n === nA + 1, 'ph ' + S.ph[3] + '   xi ' + S.melt[3]);

// ---------------------------------------------------------------- 3. the refusal
check.section('3. a full pool defers and the phase fraction stays home');
M = configure(0);
mush(3, 400, 0.25, 0, 0);
var m3 = S.m[3], H3 = S.H[3], xi3 = S.melt[3];
while (PTPOOL.admit(S, P.PH.mantle) >= 0) { /* fill to the cap */ }
check.ok('the pool is at its capacity', S.n === P.partCap, 'n ' + S.n + ' of ' + P.partCap);
var r0 = S.tx.refuse;
check.ok('separate refuses and counts', PTPOOL.separate(S, 3) === -1 && S.tx.refuse === r0 + 1,
	'refuse ' + S.tx.refuse);
check.ok('and the phase fraction is exactly where it was',
	S.m[3] === m3 && S.H[3] === H3 && S.melt[3] === xi3, 'm ' + S.m[3] + '   xi ' + S.melt[3]);

// ---------------------------------------------------------------- 4. the rise
check.section('4. hot melt rises, cold material does not');
M = configure(0);
M.pr.fill(0);                                   // no flow: the melt rule alone is measurable
S.n = 3;
mush(0, 400, 1, 0, 0); S.ph[0] = P.PH.melt;      // hot melt: rises at vMelt
mush(1, 400, 0.05, 0, 0); S.ph[1] = P.PH.melt;   // frozen transit: dies to mantle, no rise
mush(2, 400, 0, 0, 0);                           // mantle: not this kernel's business
var y0 = S.y[0], y1 = S.y[1], y2 = S.y[2], dt = 0.05;
MT.run(M, S, dt);
check.near('hot melt rises at vMelt per geological step', S.y[0], y0 - P.vMelt * dt, 1e-12, 'km');
check.ok('cold melt stops being melt and stops rising',
	S.ph[1] === P.PH.mantle && S.y[1] === y1, 'ph ' + S.ph[1] + '   y ' + S.y[1]);
check.ok('mantle is left to the flow map', S.ph[2] === P.PH.mantle && S.y[2] === y2, 'y ' + S.y[2]);
var hash0 = S.hash();
MT.run(M, S, 0);
check.ok('zero geological time moves nothing', S.hash() === hash0, 'hash ' + S.hash());

// ---------------------------------------------------------------- 5. the wrap
check.section('5. rising melt wraps the periodic seam');
M = configure(0);
S.n = 1;
mush(0, 200, 1, 0, 0); S.ph[0] = P.PH.melt;
// a psi ramp in eta gives a constant eastward flow: vx = K/dEta/J at the parcel
var nx = M.nx, j, i, K = 200 * M.dEta * Math.sqrt(P.yLin * P.yLin + 200 * 200);
for (j = 0; j <= M.ny; j++) for (i = 0; i < nx; i++) M.pr[j * nx + i] = K * j;
S.x[0] = M.wrap - 10;
var xBefore = S.x[0];
for (i = 0; i < 5 && S.x[0] > 100; i++) MT.run(M, S, 0.05);
check.ok('the parcel crossed the seam and landed inside [0, wrap)',
	S.x[0] >= 0 && S.x[0] < M.wrap && S.x[0] < 100, 'x ' + xBefore.toFixed(1) + ' -> ' + S.x[0].toFixed(1) + ' km');

// ---------------------------------------------------------------- 6. the store
check.section('6. intrusion is a transfer into the chamber records');
M = configure(0);
M.pr.fill(0);
// the tail is removed first: pool.js compacts the last active slot into a hole, and the
// fixture keeps its slot labels honest about that
S.n = 3;
mush(0, 50, 1, 0, 0); S.ph[0] = P.PH.melt; S.x[0] = 3000;   // its own site
mush(1, 50, 1, 0, 0); S.ph[1] = P.PH.melt; S.x[1] = 9100;   // within chJoin of the first record
mush(2, 50, 1, 0, 0); S.ph[2] = P.PH.melt; S.x[2] = 9000;   // the first record's site
var cB = inv(), rm = S.m[2], rH = S.m[2] * S.H[2], rL = S.m[2] * S.melt[2];
check.ok('an intrusion fills a fresh record', PTPOOL.intrude(M, S, 2) === 0 && S.chN === 1, 'chN ' + S.chN);
check.near('its mass moved into the record', S.chM[0], rm, 1e-14, 'km2');
check.near('its enthalpy moved with it', S.chH[0], rH, 1e-12, 'km2*H');
check.near('and its melt stock', S.chL[0], rL, 1e-14, 'km2');
var cA = inv();
check.near('the transfer closes the global mass', cA.m, cB.m, 1e-14, 'km2');
check.near('and the global enthalpy', cA.h, cB.h, 1e-12, 'km2*H');
check.ok('a second intrusion within chJoin joins the record',
	PTPOOL.intrude(M, S, 1) === 0 && S.chN === 1 && S.chM[0] > rm, 'chN ' + S.chN + '   chM ' + S.chM[0].toFixed(1));
check.ok('a third site opens its own record', PTPOOL.intrude(M, S, 0) === 1 && S.chN === 2,
	'chN ' + S.chN);
check.near('the joined transfers still close the global mass', inv().m, cB.m, 1e-14, 'km2');
// with the record set full, a new site's melt defers and waits at the chamber depth
P.chCap = 2; SIM.init(); SIM.reset(); M = SIM.M;
M.pr.fill(0);
S.n = 3;
mush(0, 50, 1, 0, 0); S.ph[0] = P.PH.melt; S.x[0] = 1000;
mush(1, 50, 1, 0, 0); S.ph[1] = P.PH.melt; S.x[1] = 2000;
mush(2, 50, 1, 0, 0); S.ph[2] = P.PH.melt; S.x[2] = 3000;
var cF2 = inv();
check.ok('two sites fill the set', PTPOOL.intrude(M, S, 2) === 0 && PTPOOL.intrude(M, S, 1) === 1 && S.chN === 2,
	'chN ' + S.chN);
var rF = S.tx.refuse;
check.ok('the third site\'s transfer defers and counts', PTPOOL.intrude(M, S, 0) === -1
	&& S.tx.refuse === rF + 1 && S.n === 1, 'n ' + S.n + '   refuse ' + S.tx.refuse);
MT.run(M, S, 0.05);
check.ok('and the melt waits at the chamber depth instead of being dropped',
	S.n === 1 && S.y[0] === 50 && S.ph[0] === P.PH.melt, 'y ' + S.y[0] + '   n ' + S.n);
check.near('the deferred transfer changed nothing globally', inv().m, cF2.m, 1e-14, 'km2');
// with records available again, a parcel a few steps above the depth reaches the store
P.chCap = 64; SIM.init(); SIM.reset(); M = SIM.M;
M.pr.fill(0);
S.n = 1;
mush(0, 90, 1, 0, 0); S.ph[0] = P.PH.melt; S.x[0] = 6000;
var nEnd = S.n;
for (var k = 0; k < 10 && S.n === nEnd; k++) MT.run(M, S, 0.05);
check.ok('melt from above the chamber depth reaches the store on its own',
	S.n === 0 && S.chN === 1 && Math.abs(S.chM[0] - 1200) < 1e-9, 'n ' + S.n + '   chN ' + S.chN);

// ---------------------------------------------------------------- 7. the live run
check.section('7. 100 Myr of the shipped pipeline');
M = configure(0);
var lc0 = inv(), hled1 = S.hLedger, lat1 = S.invL0;
var worstEmpty = 0, nan = 0, peakN = 0, burst = 0, frames = 2000, fk, pk;
var th = [0.02, 0.05, P.meltHold, 0.15], hist = th.map(function () { return 0; });
for (pk = 0; pk < S.n; pk++) {
	if (!isFinite(S.H[pk]) || !isFinite(S.m[pk])) nan++;
	for (var t2 = 0; t2 < th.length; t2++) if (S.melt[pk] >= th[t2]) hist[t2]++;
}
peakN = S.n;
var tBurst = 0, tStore = -1;
for (fk = 0; fk < frames; fk++) {
	SIM.step();
	if (fk === 0) burst = S.tx.split;
	if (tStore < 0 && S.chN > 0) tStore = SIM.t;
	if (S.empty > worstEmpty) worstEmpty = S.empty;
	if (S.n > peakN) peakN = S.n;
	for (pk = 0; pk < S.n; pk++) if (!isFinite(S.T[pk]) || !isFinite(S.x[pk]) || !isFinite(S.H[pk])) nan++;
}
var lc1 = inv();
// the two gaps the plan asks for separately: the quadrature of the deposit (marker heat vs
// grid field heat) and the closure of the enthalpy book (what the wall put in vs what the
// parcels and the chambers hold). They measure different things and must not be conflated.
var mkHeat = 0, fdHeat = 0, i2, j2, mu;
for (pk = 0; pk < S.n; pk++) mkHeat += S.m[pk] * S.T[pk];
for (j2 = 1; j2 < M.ny; j2++) for (i2 = 0; i2 < M.nx; i2++) {
	mu = M.dEta * M.jN[j2] * M.dx;
	fdHeat += mu * S.Tg[j2 * M.nx + i2];
}
var mgGap = (fdHeat - mkHeat) / mkHeat;
var entRes = ((lc1.h - lc0.h) - (S.hLedger - hled1)) / Math.abs(lc0.h);
check.ok('no NaN over ' + frames + ' frames', nan === 0, nan + ' sightings');
check.ok('coverage held through the segregation', worstEmpty < 0.15 * M.nx * (M.ny - 1),
	'worst ' + worstEmpty + ' of ' + M.nx * (M.ny - 1) + ' nodes');
check.near('the pool has no source and no sink: mass closes', lc1.m, lc0.m, 1e-12, 'km2');
check.near('composition closes with it', lc1.f, lc0.f, 1e-12, 'km2');
check.ok('the global enthalpy residual is round-off against the booked intake',
	Math.abs(entRes) < 1e-9, 'residual ' + entRes.toExponential(2));
check.ok('and the P3.1 latent identity still holds across all of it',
	Math.abs(identity()) < 1e-9 * Math.abs(S.hLedger), 'identity ' + identity().toExponential(3));
check.ok('the burst separated real melt and the store received it',
	burst > 0 && S.chN > 0 && S.chM[0] >= 0 && S.tx.intrude > 0,
	'burst ' + burst + ' splits   intrusions ' + S.tx.intrude + '   chambers ' + S.chN);
check.ok('and nothing was dropped at capacity', S.tx.refuse === 0,
	'refuse ' + S.tx.refuse + '   peak n ' + peakN + ' of ' + P.partCap);
check.info('the two gaps, reported separately', 'marker/grid heat gap ' + mgGap.toExponential(2)
	+ ' (quadrature)   global enthalpy residual ' + entRes.toExponential(2) + ' (closure)');
check.info('the census', 'splits ' + S.tx.split + '   intrusions ' + S.tx.intrude
	+ '   moved ' + S.tx.move + '   chambers ' + S.chN + '   store mass '
	+ (S.chM.reduce(function (a, b) { return a + b; }, 0) / lc1.m * 100).toFixed(3) + '% of the planet');
check.info('the melt after ' + SIM.t.toFixed(0) + ' Myr', 'stock ' + (lc1.l / lc1.m * 100).toFixed(3)
	+ '% of mass (parcels + store)   store melt ' + (S.chL.reduce(function (a, b) { return a + b; }, 0) / lc1.m * 100).toFixed(3)
	+ '%   in flight ' + (S.invN[P.PH.melt]) + ' parcels');

// ---------------------------------------------------------------- 8. the tuning report
check.section('8. what this run says about the three open knobs (report only)');
check.info('the split criterion at t = 0', 'xi>=' + th.map(function (v) { return v; }).join(' >= ')
	+ ': ' + hist.join(' ') + ' of ' + P.partBase + ' parcels   (meltHold ' + P.meltHold
	+ ' released ' + burst + ' splits on the first frame)');
check.info('the reserve', 'peak pool ' + peakN + ' of ' + P.partCap + ' ('
	+ ((peakN - P.partBase) / (P.partCap - P.partBase) * 100).toFixed(0) + '% of the reserve), refusals '
	+ S.tx.refuse);
check.info('the chamber radius', 'chJoin ' + P.chJoin + ' km left ' + S.chN + ' records of ' + P.chCap
	+ ' holding ' + (S.chM.reduce(function (a, b) { return a + b; }, 0)).toFixed(0) + ' km2');
check.info('the transit', 'first chamber at t = ' + (tStore < 0 ? 'never' : tStore.toFixed(1) + ' Myr')
	+ ' (the burst starts at t = ' + (P.sl.kyr / 1000).toFixed(2) + ' Myr)');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
