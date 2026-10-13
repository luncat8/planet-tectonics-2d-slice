// pt-p3-check.js — 0.3.0 P3.5: the integrated acceptance pass and the tuning freeze
// (0.3.0-p3-plan.md §4 P3.5, §5).
//
// Every P3 milestone has its own gate: pt-p3-pool checks the pool's transactions, pt-p3-melt
// the segregation rules, pt-p3-enthalpy the phase law, pt-p3-erupt the conduits, pt-p3-flight
// the conserved vent-to-air path. This harness is the one place the plan's *integrated* claims
// are decided, on the real G1-G8 pipeline at the demonstration clock and across the slider
// matrix:
//
//   1. global mass closes over a live run, each split/merge/capacity transition separately, and
//      no cap event loses material;
//   2. global enthalpy changes only by the recorded wall flux, latent heat included;
//   3. every transfer has a matched debit/credit counter, and throughput is never added to the
//      stock inventory;
//   4. a landed edifice joins the crust's cluster after tauWeld, and an eruption stays legible
//      for 2-4 s of wall clock at every slider setting;
//   5. the same seed, geological-step and wall-time sequence replays to the same complete-state
//      fingerprint over 1000 frames;
//   6. the owning harnesses stay green, and pt-p3-budget confirms the frame budget with melt
//      and airborne populations present.
//
// Claims owned by a milestone harness are *delegated*: the owner runs as a child and its own
// PASS count is quoted (the rule acceptance.js set), so no measurement here has a second
// implementation. What this file measures itself is what no milestone harness owns: the two
// books over a long live run, the leg counters against the stocks they feed, welding and
// legibility on the live pipeline, the replay, and the slider matrix that freezes the reserve.
//
// Run: node experiments/pt-p3-check.js [--fast]     (--fast skips the delegated owners)
'use strict';

var cp = require('child_process');
var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var POOL = require(B + 'pool.js'), VENT = require(B + 'vent.js'), FLIGHT = require(B + 'flight.js');

var FAST = process.argv.indexOf('--fast') >= 0;
var DEMO = 50;                                   // kyr/frame, the demonstration clock
var LIVE = 1000;                                 // frames of the measured live leg
var WALL = P.flightFrame;                        // one 60 Hz presentation interval
var M;

// ---------------------------------------------------------------- the live leg
// A fresh planet at the shipped settings. This harness changes the seed, the clock and (in one
// section) the reserve; nothing else, so every number below is the shipped pipeline's.
function leg(seed, kyr) {
	P.seed = seed; P.sl.kyr = kyr;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	POOL.inventoryComp(S);
	return SIM.M;
}

// One measured leg: the books at t = 0, the worst residuals, the phase peaks and the clast
// clocks. The sections read this instead of re-measuring.
function meter(seed, kyr, clocks) {
	var o = { seed: seed, kyr: kyr, clocks: !!clocks, hash: 0,
		mass: 0, enth: 0, cov: 0, nan: 0, tMin: 1e9, tMax: -1e9,
		peak: { n: 0, melt: 0, air: 0, dep: 0 }, window: 0, run: 0,
		lives: [], born: new Map() };
	M = leg(seed, kyr);
	o.m0 = S.invMTot; o.h0 = S.invHTot; o.l0 = S.invLTot;
	o.hl0 = S.hLedger; o.led0 = S.ledger; o.wall0 = S.wall;
	o.peak.n = S.n; o.peak.melt = S.invN[P.PH.melt];
	return o;
}

// The frame loop every section shares. Geology and flight advance exactly as the page does: one
// rendered frame is `kyr / 1000` Myr of geology plus one wall interval of presentation.
function march(o, frames, wall) {
	var p, f, air, rec, id, w = o.clocks ? o.born : null, dt = wall === undefined ? WALL : wall;
	for (f = 0; f < frames; f++) {
		SIM.step(dt);
		POOL.inventoryComp(S);
		o.mass = Math.max(o.mass, Math.abs(S.invMTot - o.m0) / o.m0);
		o.enth = Math.max(o.enth, Math.abs((S.invHTot - o.h0) - (S.hLedger - o.hl0)) /
			Math.abs(S.hLedger - o.hl0));
		o.cov = Math.max(o.cov, Math.abs((S.hLedger - o.hl0) / (S.wall - o.wall0) - 1));
		if (S.n > o.peak.n) o.peak.n = S.n;
		if (S.invN[P.PH.melt] > o.peak.melt) o.peak.melt = S.invN[P.PH.melt];
		if (S.invN[P.PH.air] > o.peak.air) o.peak.air = S.invN[P.PH.air];
		if (S.invN[P.PH.dep] > o.peak.dep) o.peak.dep = S.invN[P.PH.dep];
		air = S.invN[P.PH.air];
		if (air > 0) { o.run++; if (o.run > o.window) o.window = o.run; }
		else o.run = 0;
		for (p = 0; p < S.n; p++) {
			if (S.T[p] < o.tMin) o.tMin = S.T[p];
			if (S.T[p] > o.tMax) o.tMax = S.T[p];
			if (!isFinite(S.T[p]) || !isFinite(S.H[p]) || !isFinite(S.x[p])) o.nan++;
			if (!w || S.ph[p] !== P.PH.air) continue;
			id = S.id[p];
			rec = w.get(id);
			if (rec) { rec.seen = f; if (-S.y[p] > rec.peak) rec.peak = -S.y[p]; }
			else w.set(id, { f: f, seen: f, peak: -S.y[p] });
		}
		// A life closes on the frame its parcel is no longer airborne. That includes the
		// landing that merges it into an existing deposit, because merge runs at the ground.
		if (w) w.forEach(function (r, key) {
			if (r.seen === f) return;
			o.lives.push({ s: (f - r.f + 1) / 60, peak: r.peak });
			w.delete(key);
		});
	}
	o.refuse = S.tx.refuse;
	o.hash = S.hash();
	return o;
}

// The same inventory in one independent fixture loop: every parcel, chamber and vent counted
// exactly once. Disagreement with the pool's compensated pass means a stock is double counted.
function stockSum() {
	var p, tm = 0;
	for (p = 0; p < S.n; p++) tm += S.m[p];
	for (p = 0; p < S.chN; p++) tm += S.chM[p] + S.vM[p];
	return tm;
}

function range(lives, key) {
	var i, lo = 1e9, hi = -1e9;
	for (i = 0; i < lives.length; i++) {
		if (lives[i][key] < lo) lo = lives[i][key];
		if (lives[i][key] > hi) hi = lives[i][key];
	}
	return { lo: lo, hi: hi, n: lives.length };
}

// ---------------------------------------------------------------- 1. the live run
check.section('1. the shipped pipeline at ' + DEMO + ' kyr/frame: the two books close');
var t0 = Date.now();
var A = meter(1, DEMO, true);
march(A, LIVE);
A.ones = Math.abs(stockSum() - S.invMTot) / S.invMTot;
A.latent = (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0);
A.latentRel = Math.abs(A.latent) / Math.abs(S.hLedger - S.ledger);
check.ok('global mass closes to 1e-9 on compensated summation over ' + SIM.t.toFixed(0) + ' Myr',
	A.mass < 1e-9, 'worst relative residual ' + A.mass.toExponential(2));
check.ok('every parcel and reservoir is counted exactly once', A.ones < 1e-12,
	'an independent sum over parcels + chambers + vents disagrees with the compensated one by '
	+ A.ones.toExponential(2));
check.ok('global enthalpy changes only by the recorded intake',
	A.enth < 1e-9, 'worst |dH - dH_book| / |dH_book| ' + A.enth.toExponential(2));
check.ok('latent heat is included: the two books differ by exactly L * dL',
	A.latentRel < 1e-10, 'residual ' + A.latentRel.toExponential(2) + ' relative, '
	+ A.latent.toExponential(2) + ' km2*H absolute');
check.ok('the marker intake is the wall flux the operator charged (adjoint coverage)',
	A.cov < 1e-9, '|intake/wall - 1| ' + A.cov.toExponential(2));
check.ok('no NaN and the temperature stays in range over ' + LIVE + ' frames',
	A.nan === 0 && A.tMin > -0.1 && A.tMax < 1.2,
	'NaN ' + A.nan + '   T ' + A.tMin.toFixed(3) + '..' + A.tMax.toFixed(3));
check.ok('every transfer leg is a matched debit/credit pair',
	S.thr.ventDr === S.thr.ventCr && S.thr.airDr === S.thr.airCr
	&& S.thr.landDr === S.thr.landCr && S.thr.intrDr === S.thr.intrCr,
	'vent ' + S.thr.ventDr.toExponential(6) + '  air ' + S.thr.airDr.toExponential(6)
	+ '  land ' + S.thr.landDr.toExponential(6) + '  intrude ' + S.thr.intrDr.toExponential(6));
check.near('the airborne stock is what the emission counter says is still up',
	S.invM[P.PH.air] + S.thr.landDr, S.thr.airCr, 1e-9, 'km2');
// P4.3 gives the deposit phase a second source: the surface law credits weathered rock into the
// same parcels (P3.4's landings and P4.3's sediment are one stock, not two), and it can rework a
// deposit that has a slope under it -- what leaves a deposit parcel lands in another one, so the
// phase still never loses material. P4.4 adds the phase's third debit: the slab pass recycles
// detached cold lithosphere below yDeep whatever its phase, and sediment subducted with a plate
// is exactly that (thr.deepDep, zero on this leg -- nothing reaches yDeep in 50 Myr). The stock
// is therefore the landings plus everything the erosion pass credited, less what the erosion and
// recycling passes took back out of the phase.
var depWant = S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep - S.thr.depMelt;
check.ok('the deposit stock is the landings plus the surface law, and the phase never shrinks',
	Math.abs(S.invM[P.PH.dep] - depWant) <= 1e-9 * Math.abs(depWant) && S.thr.eroDr === S.thr.eroCr,
	'deposits ' + S.invM[P.PH.dep].toFixed(6) + ' km2 against ' + depWant.toFixed(6) + ' = '
	+ S.thr.landCr.toFixed(6) + ' landed + ' + S.thr.eroCr.toFixed(6) + ' weathered - '
	+ S.thr.eroDep.toFixed(6) + ' reworked');
check.ok('the chambers filled without blocking a conduit',
	VENT.count(S, VENT.BLOCKED) === 0 && S.chN > 0 && S.chN <= P.chCap,
	'chambers ' + S.chN + '/' + P.chCap + '   blocked ' + VENT.count(S, VENT.BLOCKED));
check.info('the live census', S.tx.vent + ' drains, ' + S.tx.emit + ' emitted batches, '
	+ S.tx.land + ' landings, ' + S.tx.merge + ' deposit merges, ' + S.tx.intrude
	+ ' intrusions, ' + S.tx.refuse + ' refusals');
check.info('throughput is not stock', 'the gross legs moved '
	+ (S.thr.seg + S.thr.whole + S.thr.depMelt + S.thr.freeze + S.thr.intrDr + S.thr.ventDr + S.thr.airDr
	+ S.thr.landDr).toExponential(3) + ' km2 against a ' + S.invMTot.toExponential(3)
	+ ' km2 inventory');
check.info('the books', 'intake ' + (S.hLedger - A.hl0).toExponential(6) + '   wall '
	+ (S.wall - A.wall0).toExponential(6) + '   latent '
	+ (S.hLedger - S.ledger).toExponential(6) + '   sensible '
	+ (S.ledger - A.led0).toExponential(6));

// ---------------------------------------------------------------- 2. the cap
// The plan's capacity claim is about the event, not the average: a refusal leaves every stock
// exactly where it was, and a live run pressed to the cap still closes. The reserve is cut to
// 2% of the base, which is inside the initial condition's own mushy band, so this leg refuses
// from its first frame and never stops.
check.section('2. at the cap: every refusal is a deferral, and nothing is lost');
var keepRes = [P.resMelt, P.resAir, P.resDep];
P.resMelt = 0.005; P.resAir = 0.005; P.resDep = 0.01;
var tight = meter(1, DEMO, false);
march(tight, 300);
check.ok('the leg really ran out of room', S.tx.refuse > 0 && tight.peak.n === P.partCap,
	S.tx.refuse + ' refusals, peak ' + tight.peak.n + '/' + P.partCap
	+ ' against a base of ' + P.partBase);
check.ok('and the mass still closes exactly', tight.mass < 1e-9,
	'worst relative residual ' + tight.mass.toExponential(2));
check.ok('and so does the enthalpy book', tight.enth < 1e-9,
	'worst relative residual ' + tight.enth.toExponential(2));
P.resMelt = keepRes[0]; P.resAir = keepRes[1]; P.resDep = keepRes[2];

// the same claim at the call sites: with the pool full, each refusing transaction keeps the
// whole inventory bitwise where it was and counts itself
M = leg(1, DEMO);
var mushy = -1, tries = 0, counts = 0, inv, ref, calls, bit0, ref0;
for (p = 0; p < S.n; p++) {
	if (S.ph[p] === P.PH.mantle && S.melt[p] > 0 && S.melt[p] < 1) { mushy = p; break; }
}
S.chN = 1; S.chX[0] = 4000; S.chY[0] = P.yCham; S.vM[0] = 100; S.vH[0] = 120;
S.vL[0] = 60; S.vF[0] = 0; S.vW[0] = 0;
while (POOL.room(S) > 0) { if (POOL.admit(S, P.PH.melt) < 0) break; }
POOL.inventoryComp(S);
var bit0 = [S.invMTot, S.invHTot, S.invLTot, S.invFTot, S.invWTot, S.invChM, S.invVM].join();
var ref0 = S.tx.refuse;
calls = [POOL.admit(S, P.PH.dep), POOL.split(S, mushy, 0.5, P.PH.melt),
	POOL.separate(S, mushy), FLIGHT.launch(M, S, 0, DEMO / 1000)];
POOL.inventoryComp(S);
inv = [S.invMTot, S.invHTot, S.invLTot, S.invFTot, S.invWTot, S.invChM, S.invVM].join();
ref = S.tx.refuse - ref0;
for (p = 0; p < calls.length; p++) { tries++; if (calls[p] < 0) counts++; }
check.ok('a full pool counts every refusing transaction and keeps the material in its source',
	counts === tries && ref === tries && inv === bit0,
	counts + ' of ' + tries + ' call sites refused, refusals ' + ref0 + ' -> ' + S.tx.refuse
	+ ', inventory ' + (inv === bit0 ? 'bitwise unchanged' : 'MOVED'));

// ---------------------------------------------------------------- 3. welding
check.section('3. a landed edifice welds into the plate');
var Wl = meter(1, DEMO, false);
march(Wl, 800);                       // 40 Myr: past tauWeld for the first landed batches
var welded = -1, shared = -1, sub = -1, p, q, d, best, dep = 0;
for (p = 0; p < S.n; p++) {
	if (S.ph[p] !== P.PH.dep) continue;
	dep++;
	if (S.age[p] < P.tauWeld) continue;
	welded = p;
	best = 1e9; sub = -1;
	for (q = 0; q < S.n; q++) {
		if (!P.PH_SOLID[S.ph[q]] || S.ph[q] === P.PH.dep) continue;
		d = S.x[q] - S.x[p]; d -= Math.floor(d / M.wrap + 0.5) * M.wrap;
		d = d * d + (S.y[q] - S.y[p]) * (S.y[q] - S.y[p]);
		if (d < best) { best = d; sub = q; }
	}
	if (sub >= 0 && S.cl[sub] === S.cl[p]) shared = p;
}
check.ok('a deposit older than tauWeld is plate, not fluid',
	welded >= 0 && S.mu[welded] >= P.clusterMin && S.cl[welded] >= 0,
	welded >= 0 ? 'age ' + S.age[welded].toFixed(1) + ' Myr, mu ' + S.mu[welded].toFixed(3)
		+ ', cluster ' + S.cl[welded] : 'no deposit reached tauWeld in ' + SIM.t.toFixed(0) + ' Myr');
check.ok('and it shares its cluster with the substrate it landed on', shared >= 0,
	shared >= 0 ? 'cluster ' + S.cl[shared] + ', deposit y ' + S.y[shared].toFixed(2)
		+ ' km over substrate y ' + S.y[sub].toFixed(2) + ' km' : 'no shared cluster');
check.ok('and the landed population coalesces instead of spreading',
	dep > 0 && S.invN[P.PH.dep] < S.tx.land, S.tx.land + ' landings made '
	+ S.invN[P.PH.dep] + ' parcels, ' + S.tx.merge + ' merges');
check.info('the welding state', dep + ' deposits, ' + S.tx.land + ' landings, tauWeld '
	+ P.tauWeld + ' Myr, depositCoolTau ' + P.depositCoolTau + ' Myr');

// ---------------------------------------------------------------- 4. legibility
// P3 plan §2.4: a clast flies 0.5-1.5 s of wall clock, and a fountain stays visible for 2-4 s
// whatever the geology slider does. The shipped initial condition is dry -- composition is
// uniform zero until the exchange plan's water lands -- so every conduit takes the effusive
// style; the explosive arc is reached here by seeding one chamber's water, which is what
// wBlast keys on.
check.section('4. legibility: one clast, one fountain, at every slider setting');
function fountain(kyr, water) {
	var o = meter(2, kyr, true);
	S.chN = 1; S.chX[0] = 4000; S.chY[0] = P.yCham; S.vState[0] = VENT.CLOSED;
	S.chM[0] = 4e6; S.chH[0] = 4e6 * 1.1; S.chL[0] = 4e6 * 0.6; S.chF[0] = 0;
	S.chW[0] = (water === undefined ? 0 : water) * 4e6;
	march(o, 200);
	o.style = S.vStyle[0];
	o.windowS = o.window / 60;
	o.r = range(o.lives, 's');
	o.p = range(o.lives, 'peak');
	return o;
}
function lifeStats(o) {
	var a = o.lives.map(function (r) { return r.s; }).sort(function (x, y) { return x - y; });
	var k = a.length;
	return { n: k, lo: a[0], p10: a[Math.floor(0.1 * k)], med: a[k >> 1],
		p90: a[Math.min(k - 1, Math.floor(0.9 * k))], hi: a[k - 1], apex: range(o.lives, 'peak').hi };
}
var sliders = [10, DEMO, 100, 500], fixt = [], i4, fr;
for (i4 = 0; i4 < sliders.length; i4++) {
	fr = fountain(sliders[i4]);
	fr.l = lifeStats(fr);
	fixt.push(fr);
	check.ok('at ' + fr.kyr + ' kyr/frame the arc lasts 0.5-1.5 s of wall clock',
		fr.l.n > 0 && fr.l.med >= 0.5 && fr.l.med <= 1.5 && fr.l.hi <= 1.5 && fr.l.lo >= 0.35,
		fr.l.n + ' clasts, median ' + fr.l.med.toFixed(3) + ' s, 10-90% '
		+ fr.l.p10.toFixed(3) + '..' + fr.l.p90.toFixed(3) + ', extreme '
		+ fr.l.lo.toFixed(3) + '..' + fr.l.hi.toFixed(3) + ' s');
}
check.ok('and the fountain stays visible for at least 2 s of wall clock at every setting',
	fixt.every(function (o2) { return o2.windowS >= 2; }),
	fixt.map(function (o2) { return o2.kyr + ' kyr/frame ' + o2.windowS.toFixed(2) + ' s'; }).join(', '));
var blast = fountain(DEMO, 0.03);
blast.l = lifeStats(blast);
check.ok('a dry chamber opens effusive, a water-bearing one explosive',
	fixt.every(function (o2) { return o2.style === VENT.EFFUSIVE; })
	&& blast.style === VENT.EXPLOSIVE && blast.l.apex > 1.5 * fixt[1].l.apex
	&& blast.l.hi <= 1.5,
	'effusive apex ' + fixt[1].l.apex.toFixed(2) + ' km in ' + fixt[1].l.med.toFixed(2)
	+ ' s, explosive ' + blast.l.apex.toFixed(2) + ' km in ' + blast.l.med.toFixed(2) + ' s');
check.info('the arc the clasts actually flew, per slider',
	fixt.map(function (o2) { return o2.kyr + ' kyr/frame median ' + o2.l.med.toFixed(2)
		+ ' s (10-90% ' + o2.l.p10.toFixed(2) + '-' + o2.l.p90.toFixed(2) + ')'; }).join(', '));

// ---------------------------------------------------------------- 5. replay
// The 1000-frame leg above is the first run; this is the same sequence again, then a different
// wall sequence, which must be different state rather than hidden nondeterminism.
check.section('5. 1000 frames of the same seed, clock and wall sequence replay exactly');
var rep = meter(1, DEMO, false);
march(rep, LIVE);
check.ok('the long run replays to the same complete-state fingerprint',
	rep.hash === A.hash, 'hash ' + A.hash + ' / ' + rep.hash);
var q1 = meter(1, DEMO, false), q2, q3;
march(q1, 200, 1 / 60);
q2 = meter(1, DEMO, false);
march(q2, 200, 1 / 60);
check.ok('a fixed wall sequence replays too', q1.hash === q2.hash, 'hash ' + q1.hash + ' / ' + q2.hash);
q3 = meter(1, DEMO, false);
march(q3, 200, 1 / 45);
check.ok('and a different wall interval is state, not hidden nondeterminism',
	q3.hash !== q1.hash, 'hash 1/60 ' + q1.hash + ' against 1/45 ' + q3.hash);

// A suspended tab returns one long wall interval. The kernel caps it, so no clast may finish
// the frame below the horizon it is supposed to collide with; a tab that really did jump would
// also show up as a lost landing in the counters below.
var tab = meter(1, DEMO, false);
march(tab, 150);
var air0 = S.invN[P.PH.air], land0 = S.tx.land, below = 0, p5;
SIM.step(5.0);                                  // 5 s of hidden tab in one frame
POOL.inventoryComp(S);
for (p5 = 0; p5 < S.n; p5++) {
	if (S.ph[p5] !== P.PH.air) continue;
	// the kernel lands a descending parcel on the frame it crosses, so airborne material may
	// sit at the horizon but never under it
	if (S.y[p5] > FLIGHT.surfaceY(M, S, S.x[p5]) + 1e-9) below++;
}
check.ok('a resumed tab caps the wall interval and teleports no clast through the ground',
	below === 0, '5 s suspension: ' + below + ' of ' + S.invN[P.PH.air]
	+ ' airborne parcels under the horizon, ' + (S.tx.land - land0) + ' landed in the frame');
check.near('and the frame keeps the mass and the intake it had', S.invMTot, tab.m0, 1e-12, 'km2');

// ---------------------------------------------------------------- 6. the slider matrix
// The freeze evidence (P3 plan §5): the reserve's per-phase lines are measured, not asserted.
// Each cell is a 15 Myr leg at a slider setting, with the clast clocks on.
check.section('6. the slider matrix: every clock and seed closes, and the reserve holds');
function cell(seed, kyr) {
	var frames = Math.max(30, Math.round(15000 / kyr));
	var o = meter(seed, kyr, true);
	var tt = Date.now();
	march(o, frames);
	o.frames = frames;
	o.ms = (Date.now() - tt) / frames;
	o.base = P.partBase;
	o.t = SIM.t;
	return o;
}
var cells = [], i6, c;
for (i6 = 0; i6 < [10, DEMO, 100, 500].length; i6++) cells.push(cell(1, [10, DEMO, 100, 500][i6]));
for (i6 = 0; i6 < [2, 3, 7].length; i6++) cells.push(cell([2, 3, 7][i6], DEMO));
console.log('  seed  kyr/f  Myr    peak n/cap      melt (%)     air (%)      dep (%)      window s  ms/frame');
cells.forEach(function (o) {
	console.log('  ' + String(o.seed).padEnd(6) + String(o.kyr).padEnd(7) + o.t.toFixed(0).padEnd(7)
		+ (o.peak.n + '/' + P.partCap).padEnd(16)
		+ (o.peak.melt + ' (' + (100 * o.peak.melt / o.base).toFixed(1) + ')').padEnd(13)
		+ (o.peak.air + ' (' + (100 * o.peak.air / o.base).toFixed(1) + ')').padEnd(13)
		+ (o.peak.dep + ' (' + (100 * o.peak.dep / o.base).toFixed(1) + ')').padEnd(13)
		+ (o.window / 60).toFixed(2).padEnd(10) + o.ms.toFixed(2));
});
check.ok('every cell of the matrix closes and takes every transfer leg exactly',
	cells.every(function (o) { return o.mass < 1e-9 && o.enth < 1e-9 && o.cov < 1e-9; }),
	'worst mass ' + Math.max.apply(null, cells.map(function (o) { return o.mass; })).toExponential(2)
	+ ', enthalpy ' + Math.max.apply(null, cells.map(function (o) { return o.enth; })).toExponential(2)
	+ ', intake/wall ' + Math.max.apply(null, cells.map(function (o) { return o.cov; })).toExponential(2));
check.ok('no cell lost material to the cap', cells.every(function (o) { return o.refuse === 0; }),
	'refusals ' + cells.map(function (o) { return o.seed + '/' + o.kyr + ':' + o.refuse; }).join(' '));
check.ok('the reserve keeps its per-phase lines: melt',
	cells.every(function (o) { return o.peak.melt <= P.resMelt * o.base; }),
	'worst ' + Math.max.apply(null, cells.map(function (o) { return 100 * o.peak.melt / o.base; })).toFixed(1)
	+ '% of the base against the frozen resMelt ' + (100 * P.resMelt).toFixed(0) + '%');
check.ok('the reserve keeps its per-phase lines: air',
	cells.every(function (o) { return o.peak.air <= P.resAir * o.base; }),
	'worst ' + Math.max.apply(null, cells.map(function (o) { return 100 * o.peak.air / o.base; })).toFixed(1)
	+ '% against the frozen resAir ' + (100 * P.resAir).toFixed(0) + '%');
check.ok('the reserve keeps its per-phase lines: deposits',
	cells.every(function (o) { return o.peak.dep <= P.resDep * o.base; }),
	'worst ' + Math.max.apply(null, cells.map(function (o) { return 100 * o.peak.dep / o.base; })).toFixed(1)
	+ '% against the frozen resDep ' + (100 * P.resDep).toFixed(0) + '%');
var demoMs = Math.max.apply(null, cells.filter(function (o) { return o.kyr === DEMO; })
	.map(function (o) { return o.ms; }));
check.ok('and every seed at the demonstration clock fits the 20 ms host gate', demoMs < 20,
	'worst ' + demoMs.toFixed(2) + ' ms/frame at ' + DEMO + ' kyr/frame');
check.info('a heavier clock buys substeps with frame time, not a different trajectory',
	cells.filter(function (o) { return o.seed === 1; }).map(function (o) {
		return o.kyr + ' kyr/frame ' + o.ms.toFixed(1) + ' ms';
	}).join(', ') + ' (the fluid substep stays dtFluidMax-bounded)');
check.info('the shipped reserve', 'resMelt ' + P.resMelt + ' + resAir ' + P.resAir + ' + resDep '
	+ P.resDep + ' = resFrac ' + P.resFrac + ' -> partCap ' + P.partCap);

// ---------------------------------------------------------------- 7. the owners
// Item 6 of the plan: the P1/P2 owners stay green. Each one runs as a child and its own PASS
// count is quoted, so a red suite's lines name the check rather than this file re-testing it.
check.section('7. the owning harnesses stay green');
function suite(name) {
	var r = cp.spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: 'utf8', maxBuffer: 1 << 26 });
	var out = (r.stdout || '') + (r.stderr || '');
	var ms = out.match(/ALL PASS \((\d+) checks\)/g);
	var m = ms ? ms[ms.length - 1] : null;
	var fails = out.match(/^FAIL  .*$/gm);
	check.ok(name, r.status === 0 && !!m, m || 'exit ' + r.status
		+ (fails ? '  ' + fails.slice(0, 4).join(' / ') : ''));
}
if (FAST) check.info('SKIP (--fast)', 'pt-check, pt-crust, pt-drift, pt-surface, pt-wrap, pt-ui, pt-p3-budget, pt-p3-pool');
else for (i6 = 0; i6 < 8; i6++) {
	suite(['pt-check.js', 'pt-crust.js', 'pt-drift.js', 'pt-surface.js', 'pt-wrap.js', 'pt-ui.js',
		'pt-p3-budget.js', 'pt-p3-pool.js'][i6]);
}

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
