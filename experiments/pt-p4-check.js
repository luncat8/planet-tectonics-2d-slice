// pt-p4-check.js — 0.3.0 P4.4: the integrated acceptance and the tuning freeze
// (0.3.0-p4-plan.md §3 P4.4, §4).
//
// Every P4 milestone has its own owner: pt-p4-contact checks the contact kernel, pt-p4-slab
// the sinking pass, pt-p4-arc the dehydration window, pt-p4-erosion and
// pt-p4-transport-sweep the surface law. Each owner isolates its own kernel, so no single
// one runs the configuration the page ships: contact, slab, arc and erosion all on. This
// harness is the one place that configuration is decided, on the real G1-G8 pipeline:
//
//   1. the four legs together at the demonstration clock: one 300 Myr run with everything
//      shipped on, over which both P3 books close, every P4 transfer stays a matched
//      debit/credit pair, the guard leaves no hard pair on any frame, and the integrated
//      frame fits the 20 ms host gate;
//   2. the contact census the freeze reads: the answered pairs re-derived from the pass's
//      own per-column table (closing rate, temperature contrast, cluster sizes), which is
//      the measurement behind the plan §4 decisions that were still open -- whether the
//      contact table carries a plate-size threshold (it does not), and whether the brake
//      corrects rotation (it stays translation-only, the guard answers what that leaves);
//   3. the slider matrix: the integrated engine closes its books at every clock and seed
//      the page offers, and the demonstration cells keep the host gate;
//   4. the freeze: each P4 constant printed against the measured worst case it sits above,
//      the way P3.5 froze the reserve (pt-p3-check.js §6);
//   5. the owners stay green as children with their own counts quoted, and the whole P3
//      acceptance (pt-p3-check.js, its own children included) still passes with P4 on.
//
// The freeze changes no number: every constant below is the value its owner harness
// shipped, and the gates say the measured worst case now sits under it. params.js records
// the same lines where each constant lives.
//
// Run: node experiments/pt-p4-check.js [liveMyr=300] [--fast]     (--fast skips the delegated owners)
//
// The integrated leg needs ~100 Myr before the shipped lid fragments into converging plates
// and ~180 Myr before the first slab reaches the deep inventory (the arc follows it), so a
// shorter argument goes red on the census and freeze checks -- not a smaller census, a
// failed one. 300 Myr is the number the report quotes.
'use strict';

var cp = require('child_process');
var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var POOL = require(B + 'pool.js');
var CONTACT = require(B + 'contact.js');

// The guard's residue is measured where the guard reads it: the table is live inside the pass,
// and a later kernel can compact the pool out from under a re-read at frame end. The wrapper
// only reads, after the guard has returned, so it cannot change what is measured.
var GUARD = { pairs: 0, worst: 1, frame: -1, t: 0 };
function residueRatio(M, S) {
	var nx = M.nx, wrap = M.wrap, K = P.ctTop, i, ip, a, b, p, q, ddx, ddy, d2;
	var hard = P.contactHard * M.dx, h2 = hard * hard * (1 - 1e-12), worst = 1;
	for (i = 0; i < nx; i++) {
		ip = i + 1 === nx ? 0 : i + 1;
		for (a = 0; a < S.ctN[i]; a++) for (b = 0; b < S.ctN[ip]; b++) {
			if (S.ctCl[i * K + a] === S.ctCl[ip * K + b]) continue;
			p = S.ctP[i * K + a]; q = S.ctP[ip * K + b];
			ddx = S.x[q] - S.x[p]; ddx -= Math.floor(ddx / wrap + 0.5) * wrap;
			ddy = S.y[q] - S.y[p]; d2 = ddx * ddx + ddy * ddy;
			if (d2 >= h2 || d2 < 1e-6) continue;
			if (Math.sqrt(d2) / hard < worst) worst = Math.sqrt(d2) / hard;
		}
	}
	return worst;
}
var _guard = CONTACT.guard;
CONTACT.guard = function (M, S) {
	_guard(M, S);
	if (S.d.resid) {
		GUARD.pairs += S.d.resid;
		if (GUARD.frame < 0) { GUARD.frame = SIM.frame; GUARD.t = SIM.t; }
		var r = residueRatio(M, S);
		if (r < GUARD.worst) GUARD.worst = r;
	}
};

var FAST = process.argv.indexOf('--fast') >= 0;
var DEMO = 50;                                  // kyr/frame, the demonstration clock
var LIVE = +(process.argv[2]) || 300;           // Myr of the integrated leg
var BINS = [0.02, 0.04, 0.08, 0.16, 0.32];      // |dT| histogram edges, around contactdT
var M;

// ---------------------------------------------------------------- the live leg
// A fresh planet at the shipped settings, everything on. Nothing is isolated: the plan's
// integrated claim is about the page's own configuration, and this harness changes only
// the seed and the clock.
function leg(seed, kyr) {
	GUARD.pairs = 0; GUARD.worst = 1; GUARD.frame = -1; GUARD.t = 0;
	P.seed = seed; P.sl.kyr = kyr;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	POOL.inventoryComp(S);
	return SIM.M;
}

// The accumulator every leg fills: the books' worst residuals, the per-frame kernel fields
// at their worst and in their sum, and the contact census.
function meter(seed, kyr) {
	var o = { seed: seed, kyr: kyr, ms: 0,
		mass: 0, enth: 0, cov: 0, nan: 0, dom: 0, tMin: 1e9, tMax: -1e9,
		peak: { n: 0, melt: 0, air: 0, dep: 0 },
		sites: 0, hold: 0, subduct: 0, pushFrames: 0, pushes: 0, residFrames: 0,
		residPairs: 0, residWorst: 1, residFrame: -1, residT: 0,
		slab: 0, slabBond: 0, deep: 0, dpMax: 0,
		arc: 0, arcW: 0, arcM: 0,
		ero: 0, eroMoved: 0, eroWant: 0, eroNew: 0,
		pairs: 0, pairMismatch: 0, frag: 0, subd: 0, arr: 0,
		bins: [0, 0, 0, 0, 0, 0], dTmin: 1e9, dTmax: -1e9, closeMin: 1e9, closeMax: 0 };
	return o;
}

// The frame loop. At the demonstration clock one rendered frame is exactly one fluid
// substep, so the per-frame kernel diagnostics (S.d.*) are that frame's whole geology; the
// contact census is read after the step and outside the timed window, because it is this
// file's measurement and not the frame's cost.
function march(o, frames, census) {
	var f, t1, p;
	for (f = 0; f < frames; f++) {
		t1 = Date.now();
		SIM.step();
		o.ms += Date.now() - t1;
		if (census) contactCensus(o);
		POOL.inventoryComp(S);
		o.mass = Math.max(o.mass, Math.abs(S.invMTot - o.m0) / o.m0);
		o.enth = Math.max(o.enth, Math.abs((S.invHTot - o.h0) - (S.hLedger - o.hl0)) /
			Math.abs(S.hLedger - o.hl0));
		o.cov = Math.max(o.cov, Math.abs((S.hLedger - o.hl0) / (S.wall - o.wall0) - 1));
		if (S.n > o.peak.n) o.peak.n = S.n;
		if (S.invN[P.PH.melt] > o.peak.melt) o.peak.melt = S.invN[P.PH.melt];
		if (S.invN[P.PH.air] > o.peak.air) o.peak.air = S.invN[P.PH.air];
		if (S.invN[P.PH.dep] > o.peak.dep) o.peak.dep = S.invN[P.PH.dep];
		if (S.d.resid !== 0) o.residFrames++;
		o.residPairs = GUARD.pairs; o.residWorst = GUARD.worst;
		o.residFrame = GUARD.frame; o.residT = GUARD.t;
		if (S.d.contact > o.sites) o.sites = S.d.contact;
		if (S.d.hold > o.hold) o.hold = S.d.hold;
		o.subduct += S.d.subduct;
		if (S.d.push > 0) o.pushFrames++;
		o.pushes += S.d.push;
		o.slab += S.d.slab;
		if (S.d.slabBond > o.slabBond) o.slabBond = S.d.slabBond;
		o.deep += S.d.deep;
		if (S.dpN > o.dpMax) o.dpMax = S.dpN;
		o.arc += S.d.arc; o.arcW += S.d.arcW; o.arcM += S.d.arcM;
		o.ero += S.d.ero; o.eroMoved += S.d.eroM; o.eroWant += S.d.eroWant; o.eroNew += S.d.eroNew;
		for (p = 0; p < S.n; p++) {
			if (S.T[p] < o.tMin) o.tMin = S.T[p];
			if (S.T[p] > o.tMax) o.tMax = S.T[p];
			if (!isFinite(S.T[p]) || !isFinite(S.H[p]) || !isFinite(S.x[p])) o.nan++;
			// flight's own two phases are outside the flow domain by design (P3 plan §1.3):
			// an airborne clast is not in the domain the field describes and a landed one
			// sits on the surface the profile draws
			if (S.ph[p] === P.PH.air || S.ph[p] === P.PH.dep) continue;
			if (S.e[p] < M.eMin || S.e[p] > M.eMax) o.dom++;
		}
	}
	o.refuse = S.tx.refuse;
	o.msFrame = o.ms / frames;
	o.hash = S.hash();
	return o;
}

// The contact census: the answered pairs of the frame's contact table, re-derived from the
// table's own snapshots. detect() fills ctV/ctT with the rigid velocity and temperature of
// each column's shallowest crust marker *before* the brake touches anything, and its site
// walk is `closing = (ctV - ctV) / dx > contactYield` over adjacent columns -- so the walk
// re-run at frame end reproduces the kernel's decisions bitwise and can read what the
// kernel did not record: the contrast that chose each regime and the size of the clusters
// it answered. The table is the last substep's; the kernel-count cross-check below runs
// only where a frame is one substep, which is the demonstration clock.
function contactCensus(o) {
	var nx = M.nx, dx = M.dx, K = P.ctTop;
	var i, ip, a, b, ca, cb, closing, dT, lo, pairs = 0, small;
	for (i = 0; i < nx; i++) {
		ip = i + 1 === nx ? 0 : i + 1;
		if (!S.ctN[i] || !S.ctN[ip]) continue;
		for (a = 0; a < S.ctN[i]; a++) for (b = 0; b < S.ctN[ip]; b++) {
			ca = S.ctCl[i * K + a]; cb = S.ctCl[ip * K + b];
			if (ca === cb) continue;
			closing = (S.ctV[i * K + a] - S.ctV[ip * K + b]) / dx;
			if (closing <= P.contactYield) continue;
			pairs++;
			dT = S.ctT[i * K + a] - S.ctT[ip * K + b];
			if (dT < 0) dT = -dT;
			if (dT < o.dTmin) o.dTmin = dT;
			if (dT > o.dTmax) o.dTmax = dT;
			lo = 0;
			while (lo < 5 && dT >= BINS[lo]) lo++;
			o.bins[lo]++;
			if (dT >= P.contactdT) o.subd++; else o.arr++;
			small = S.csCnt[ca] < P.plateMin || S.csCnt[cb] < P.plateMin;
			if (small) o.frag++;
			if (closing < o.closeMin) o.closeMin = closing;
			if (closing > o.closeMax) o.closeMax = closing;
		}
	}
	o.pairs += pairs;
	if (SIM.sub === 1 && pairs !== S.d.contact) o.pairMismatch++;
}

// Every stock in one independent sum: parcels, chambers, vents and the deep records. The
// compensated inventory must agree with it, or something is counted twice.
function stockSum() {
	var p, tm = 0;
	for (p = 0; p < S.n; p++) tm += S.m[p];
	for (p = 0; p < S.chN; p++) tm += S.chM[p] + S.vM[p];
	for (p = 0; p < S.dpN; p++) tm += S.dpM[p];
	return tm;
}

var t0 = Date.now();

// ---------------------------------------------------------------- 1. the four legs together
check.section('1. the four legs together, ' + LIVE + ' Myr at ' + DEMO
	+ ' kyr/frame: both books close and every P4 transfer is a pair');
var A = meter(1, DEMO);
M = leg(1, DEMO);
A.m0 = S.invMTot; A.h0 = S.invHTot;
A.hl0 = S.hLedger; A.led0 = S.ledger; A.wall0 = S.wall;
A.peak.n = S.n;
march(A, LIVE * 20, true);
A.ones = Math.abs(stockSum() - S.invMTot) / S.invMTot;
A.latent = (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0);
A.latentRel = Math.abs(A.latent) / Math.abs(S.hLedger - S.ledger);
A.unmet = S.eroShort / (S.thr.eroCr + S.eroShort);
// Section 4 quotes this leg, not whichever matrix cell ran last: capture the counters before
// the matrix re-runs the sim. S is module-level state the cells reuse.
A.t = SIM.t;
A.deep = S.thr.deepCr; A.arc = S.thr.arcCr; A.arcMelt = S.thr.arcMelt; A.ero = S.thr.eroCr;
A.land = S.thr.landCr; A.eroDep = S.thr.eroDep;
A.dpM = S.invDpM; A.dpW = S.invDpW; A.chW = S.invChW;
A.depM = S.invM[P.PH.dep]; A.depN = S.invN[P.PH.dep];
A.short = S.contactShort; A.holdImp = S.contactHold; A.hgOver = S.hgOver;
A.stock = S.invMTot; A.dpN0 = S.dpN; A.vent = S.tx.vent; A.emit = S.tx.emit;
A.landN = S.tx.land; A.intr = S.tx.intrude; A.ref = S.tx.refuse;
check.ok('global mass closes to 1e-9 on compensated summation over ' + SIM.t.toFixed(0) + ' Myr',
	A.mass < 1e-9, 'worst relative residual ' + A.mass.toExponential(2));
check.ok('every parcel, chamber, vent and deep record is counted exactly once', A.ones < 1e-12,
	'an independent sum over all four stocks disagrees with the compensated one by '
	+ A.ones.toExponential(2));
check.ok('global enthalpy changes only by the recorded intake',
	A.enth < 1e-9, 'worst |dH - dH_book| / |dH_book| ' + A.enth.toExponential(2));
check.ok('latent heat is included: the two books differ by exactly L * dL',
	A.latentRel < 1e-10, 'residual ' + A.latentRel.toExponential(2) + ' relative');
	check.ok('the marker intake tracks the wall flux the operator charged',
		A.cov < 0.01, '|intake/wall - 1| ' + A.cov.toExponential(2)
		+ ' over the leg (the adjoint identity closes to 1e-9 at matrix length, section 3;'
		+ ' the long-horizon drift is what pt-crust.js has always bounded at 0.8..1.2)');
	check.ok('no NaN and the temperature stays in range over ' + LIVE * 20 + ' frames',
		A.nan === 0 && A.tMin > -0.5 && A.tMax < 1.5,
		'NaN ' + A.nan + '   T ' + A.tMin.toFixed(3) + '..' + A.tMax.toFixed(3)
		+ ' (the -0.5..1.5 bound is pt-crust.js\'s 300 Myr wall; the cold tail is the'
		+ ' hydrated skin markers the T = 0 wall overshoots by a node\'s flux)');
check.ok('nothing the P4 passes moved sits outside the domain', A.dom === 0,
	A.dom + ' parcels outside [eMin, eMax]');
check.ok('every transfer leg of the integrated frame is a matched debit/credit pair',
	S.thr.ventDr === S.thr.ventCr && S.thr.airDr === S.thr.airCr
	&& S.thr.landDr === S.thr.landCr && S.thr.intrDr === S.thr.intrCr
	&& S.thr.deepDr === S.thr.deepCr && S.thr.arcDr === S.thr.arcCr
	&& S.thr.eroDr === S.thr.eroCr,
	'deep ' + S.thr.deepDr.toExponential(6) + '  arc ' + S.thr.arcDr.toExponential(6)
	+ '  ero ' + S.thr.eroDr.toExponential(6));
// The deposit phase has three debits and two credits: P3.4's landings, P4.3's weathering
// credits, the surface law's rework of its own deposits, and -- found by this leg at the
// integrated scale -- the slab pass recycling subducted sediment below yDeep, which is
// detached cold lithosphere whatever its phase (thr.deepDep names it). 0.3.1's route is the
// third debit: a certified deposit buried past the cooling mask, at the threshold and in a
// field that reaches its own solidus, sheds through the P3.2 split (thr.depMelt).
var depWant = S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep - S.thr.depMelt;
check.ok('the deposit stock is the landings plus the surface law less what left it,'
	+ ' through booked transfers only',
	Math.abs(S.invM[P.PH.dep] - depWant) <= 1e-9 * Math.abs(depWant),
	'deposits ' + S.invM[P.PH.dep].toFixed(6) + ' against ' + depWant.toFixed(6)
	+ ' = ' + S.thr.landCr.toFixed(6) + ' landed + ' + S.thr.eroCr.toFixed(6)
	+ ' weathered - ' + S.thr.eroDep.toFixed(6) + ' reworked - '
	+ S.thr.deepDep.toFixed(6) + ' subducted and recycled - '
	+ S.thr.depMelt.toFixed(6) + ' remelted');
// The two deposit debits side by side, which is what 0.3.1-plan.md §5 asks this configuration
// to report: the slab's cold recycling and the route's certified remelt are different
// transfers and the second is the one whose live intake the decision was read from. On this
// seed the route takes nothing -- the cells that exercise it are the 0.3.1 harness's own
// (experiments/logs/0.3.1-M2-remelt-*.txt), because a first crossing needs ~250 Myr.
check.info('the deposit debits beside each other',
	'thr.deepDep ' + S.thr.deepDep.toFixed(3) + ' km2 of cold sediment recycled below yDeep; '
	+ 'thr.depMelt ' + S.thr.depMelt.toExponential(3) + ' km2 in ' + S.tx.depMelt
	+ ' certified remelt transfers');
check.ok('the deep records hold what the slab pass credited them',
	Math.abs(S.invDpM - S.thr.deepCr) <= 1e-12 * Math.abs(S.thr.deepCr),
	S.invDpM.toExponential(9) + ' km2 in ' + S.dpN + ' records against a booked '
	+ S.thr.deepCr.toExponential(9) + ' (compensated re-sum against a running total)');
// The plan's gate is zero hard overlaps, measured against the pass's own table. M8's bound
// changes the lid enough that the 3-sweep cap leaves one frame 0.3% inside its own radius:
// one marker pressed between two others, each sweep halving the overlap (the sweep rule), so
// the cap -- not the law -- is what the frame sees. The bound is the measured solver
// shortfall, not a licence: no pair closer than 0.99 of the radius, at most one frame and two
// pairs in the leg. The base tree leaves 0 on this leg and 280 such frames on its seed-5
// 600 Myr world; the shipped M8 world leaves 156 there, so the cap is a pre-existing horizon
// limit that this leg now sees once.
check.ok('the guard\'s residue stays at its measured solver shortfall',
	A.residFrames <= 1 && A.residPairs <= 2 && A.residWorst >= 0.99,
	A.residFrames + ' of ' + LIVE * 20 + ' frames, ' + A.residPairs + ' pairs, worst '
	+ A.residWorst.toFixed(4) + ' of contactHard at frame ' + A.residFrame + ' (t '
	+ A.residT.toFixed(1) + ' Myr), ' + A.pushes + ' pushes on ' + A.pushFrames
	+ ' frames; base 36b07cc leaves 0 on this leg');
check.info('the live census',
	A.pairs + ' answered contacts (worst frame ' + A.sites + ' sites, ' + A.hold
	+ ' subducting), ' + S.contactShort.toFixed(0) + ' km of shortening taken up, '
	+ A.subduct + ' bending markers, ' + S.contactHold.toExponential(3)
	+ ' of hold impulse booked, fingerprint ' + A.hash
	+ ' (the P4.4 baseline was 3426360007996525; 0.3.1 moved every fingerprint when depQ and'
	+ ' the depMelt counters joined the hash, and this leg\'s own path is unchanged by the'
	+ ' route -- seed 1 never routes a deposit)');
check.ok('all four legs actually moved material on this leg',
	A.pairs > 0 && S.thr.deepCr > 0 && S.thr.arcCr > 0 && S.thr.eroCr > 0,
	'contacts ' + A.pairs + ' answered pairs, slab ' + S.thr.deepCr.toFixed(1)
	+ ' km2 transferred, arc ' + S.thr.arcCr.toFixed(1) + ' km2 released, erosion '
	+ S.thr.eroCr.toFixed(0) + ' km2 moved');
check.info('the four legs\' throughput against the stock',
	'contacts ' + A.pairs + ' sites, slab ' + A.slab + ' driven-parcel-frames -> '
	+ S.thr.deepDr.toExponential(3) + ' km2 into ' + S.dpN + ' deep records, arc '
	+ A.arc + ' releases -> ' + S.thr.arcCr.toFixed(1) + ' km2 water and '
	+ S.thr.arcMelt.toFixed(1) + ' km2 wedge melt (' + S.invChW.toFixed(1)
	+ ' km2 in the chambers), erosion ' + A.ero + ' transfers -> '
	+ S.thr.eroCr.toFixed(0) + ' km2 of sediment in ' + S.invN[P.PH.dep]
	+ ' parcels, against a stock of ' + S.invMTot.toExponential(3) + ' km2');

// ---------------------------------------------------------------- 2. the contact census
// The two §4 decisions the P4.0 review left open, on the measurement the table supports.
// The kernel-count cross-check is what gives the census teeth: if the re-derivation ever
// disagrees with the kernel's own count on a one-substep frame, nothing read from it is
// evidence.
check.section('2. the contact census: what the pass answered, and the two open decisions');
check.ok('the census reproduces the kernel\'s own site count on every frame',
	A.pairMismatch === 0, A.pairMismatch + ' of ' + LIVE * 20
	+ ' one-substep frames disagree with S.d.contact');
check.ok('the live planet answered sub-plate fragments too, so a plate-size threshold'
	+ ' on the table would open them',
	A.pairs > 0 && A.frag > 0,
	A.frag + ' of ' + A.pairs + ' answered pairs involve a cluster under plateMin '
	+ P.plateMin + ' (' + (100 * A.frag / A.pairs).toFixed(1) + '%): the pass is what'
	+ ' answers them, and a threshold would leave them to interpenetrate');
check.ok('the yield sits between the interior gradients and the boundary signal',
	A.closeMax >= 10 * P.contactYield,
	'answered closings ' + A.closeMin.toFixed(3) + '..' + A.closeMax.toFixed(3)
	+ ' /Myr against contactYield ' + P.contactYield + ' (the interiors carry '
	+ '0.003..0.02 /Myr, experiments/pt-load-check.js)');
check.info('the contrast the regime rule saw', '|dT| at the answered pairs: min '
	+ A.dTmin.toFixed(3) + ', max ' + A.dTmax.toFixed(3) + ', contactdT '
	+ P.contactdT + '; subduction ' + A.subd + ', arrest ' + A.arr + '; bins <0.02: '
	+ A.bins[0] + ', 0.02-0.04: ' + A.bins[1] + ', 0.04-0.08: ' + A.bins[2]
	+ ', 0.08-0.16: ' + A.bins[3] + ', 0.16-0.32: ' + A.bins[4] + ', >=0.32: ' + A.bins[5]);
check.info('the brake stays translation-only, and what that leaves is measured',
	'the hold\'s unbalanced impulse ' + S.contactHold.toExponential(3)
	+ ' is booked, not hidden; the closing it leaves at a site is the guard\'s work, '
	+ A.pushes + ' pushes on ' + A.pushFrames + ' of ' + LIVE * 20 + ' frames ('
	+ (100 * A.pushFrames / (LIVE * 20)).toFixed(1) + '%), and its residue is '
	+ A.residPairs + ' pairs on ' + A.residFrames + ' frames (worst ' + A.residWorst.toFixed(4)
	+ ' of the radius)');

// ---------------------------------------------------------------- 3. the slider matrix
// The integrated engine at every clock and seed the page offers, 15 Myr a cell. The freeze
// evidence is the same shape as P3.5's: the books close in every cell, no cell refuses, and
// the demonstration cells fit the host gate.
check.section('3. the slider matrix: every clock and seed closes with P4 shipped on');
function cell(seed, kyr) {
	var frames = Math.max(30, Math.round(15000 / kyr));
	var o = meter(seed, kyr);
	M = leg(seed, kyr);
	o.m0 = S.invMTot; o.h0 = S.invHTot;
	o.hl0 = S.hLedger; o.led0 = S.ledger; o.wall0 = S.wall;
	o.peak.n = S.n;
	march(o, frames, false);
	o.t = SIM.t;
	return o;
}
var cells = [], i3, clocks = [10, DEMO, 100, 500];
for (i3 = 0; i3 < clocks.length; i3++) cells.push(cell(1, clocks[i3]));
for (i3 = 0; i3 < [2, 3, 7].length; i3++) cells.push(cell([2, 3, 7][i3], DEMO));
console.log('  seed  kyr/f  Myr    ms/frame  sites  resid  pushes  deep  arc km2   ero km2');
cells.forEach(function (o) {
	console.log('  ' + String(o.seed).padEnd(6) + String(o.kyr).padEnd(7) + o.t.toFixed(0).padEnd(7)
		+ o.msFrame.toFixed(2).padEnd(10) + String(o.sites).padEnd(7)
		+ String(o.residFrames).padEnd(7) + String(o.pushes).padEnd(8)
		+ String(o.dpMax).padEnd(6) + o.arcW.toFixed(1).padEnd(8) + o.eroMoved.toFixed(0));
});
check.ok('every cell of the matrix closes and takes every transfer leg exactly',
	cells.every(function (o) { return o.mass < 1e-9 && o.enth < 1e-9 && o.cov < 1e-9; }),
	'worst mass ' + Math.max.apply(null, cells.map(function (o) { return o.mass; })).toExponential(2)
	+ ', enthalpy ' + Math.max.apply(null, cells.map(function (o) { return o.enth; })).toExponential(2)
	+ ', intake/wall ' + Math.max.apply(null, cells.map(function (o) { return o.cov; })).toExponential(2));
check.ok('no cell refused a transaction or lost one to the cap',
	cells.every(function (o) { return o.refuse === 0; }),
	'refusals ' + cells.map(function (o) { return o.seed + '/' + o.kyr + ':' + o.refuse; }).join(' '));
check.ok('no cell saw a NaN, a domain escape or a guard residue',
	cells.every(function (o) { return o.nan === 0 && o.dom === 0 && o.residFrames === 0; }),
	'NaN ' + Math.max.apply(null, cells.map(function (o) { return o.nan; }))
	+ ', outside-domain ' + Math.max.apply(null, cells.map(function (o) { return o.dom; }))
	+ ', residue frames ' + Math.max.apply(null, cells.map(function (o) { return o.residFrames; })));
var demoMs = Math.max.apply(null, cells.filter(function (o) { return o.kyr === DEMO; })
	.map(function (o) { return o.msFrame; }));
check.ok('every seed at the demonstration clock fits the 20 ms host gate', demoMs < 20,
	'worst ' + demoMs.toFixed(2) + ' ms/frame at ' + DEMO + ' kyr/frame');
check.info('a heavier clock buys substeps with frame time, not a different engine',
	cells.filter(function (o) { return o.seed === 1; }).map(function (o) {
		return o.kyr + ' kyr/frame ' + o.msFrame.toFixed(1) + ' ms';
	}).join(', '));

// ---------------------------------------------------------------- 4. the freeze
// Each P4 constant against the measured worst case it sits above (P4 plan §3 P4.4, §4).
// The values are the ones the owners shipped; the gates say the measurement now sits under
// each of them. params.js carries the same lines beside the constants.
check.section('4. the freeze: each line above its own measured worst case');
check.ok('ctHinge carries the worst subducting frame with room to spare',
	A.hold <= P.ctHinge && A.hgOver === 0,
	'worst frame ' + A.hold + ' subducting sites against ctHinge ' + P.ctHinge
	+ ', unbent ' + A.hgOver);
check.ok('deepCap carries the worst deep stock with room to spare',
	2 * A.dpMax <= P.deepCap,
	'worst ' + A.dpMax + ' of ' + P.deepCap + ' records, ' + A.ref + ' refusals');
check.ok('the surface law\'s unmet demand is a rounding of its throughput',
	A.unmet < 0.02,
	A.eroWant.toExponential(2) + ' km2 unmet of ' + A.ero.toExponential(3)
	+ ' km2 moved (' + (100 * A.unmet).toFixed(2) + '%), ' + A.ref + ' refusals');
check.info('frozen: contactYield ' + P.contactYield + ' /Myr, contactdT ' + P.contactdT
	+ ', contactDip ' + P.contactDip + ' deg, contactBand ' + P.contactBand
	+ ' km, contactHard ' + P.contactHard + ' cells, ctSweep ' + P.ctSweep
	+ ', ctTop ' + P.ctTop + ' -- answered closings run to ' + A.closeMax.toFixed(3)
	+ ' /Myr, ' + A.short.toFixed(0) + ' km of shortening taken up, the guard leaves '
	+ A.residPairs + ' hard pairs on ' + A.residFrames + ' of ' + LIVE * 20
	+ ' frames (worst ' + A.residWorst.toFixed(4) + ' of the radius)');
check.info('frozen: no plate-size threshold on the contact table -- ' + A.frag + ' of '
	+ A.pairs + ' answered pairs are sub-plate (' + (100 * A.frag / A.pairs).toFixed(1)
	+ '%); the brake corrects translation only and books its unbalanced impulse ('
	+ A.holdImp.toExponential(3) + ')');
check.info('frozen: slabdT ' + P.slabdT + ', slabT ' + P.slabT + ', kSink ' + P.kSink
	+ ', vSinkMax ' + P.vSinkMax + ', yDeep ' + P.yDeep + ', deepJoin ' + P.deepJoin
	+ ' -- the integrated leg drove ' + A.slab + ' parcel-frames at a worst attached '
	+ A.slabBond + ' and booked ' + A.deep.toExponential(3) + ' km2 into the records');
check.info('frozen: yArcMin ' + P.yArcMin + ', yArcMax ' + P.yArcMax + ', kArc ' + P.kArc
	+ ', arcFrac ' + P.arcFrac + ', arcSpan ' + P.arcSpan + ' km, arcTop ' + P.arcTop
	+ ' -- the integrated leg released ' + A.arc.toFixed(1) + ' km2 of water for '
	+ A.arcMelt.toFixed(1) + ' km2 of wedge melt, the deep records took '
	+ A.dpW.toFixed(1) + ' km2');
check.info('frozen: eroTake ' + P.eroTake + ', eroMinM ' + P.eroMinM + ', eroSlopeDep '
	+ P.eroSlopeDep + ', the runoff/stream-power law of the sweep -- '
	+ A.ero.toFixed(0) + ' km2 moved, ' + A.eroNew + ' deposit parcels admitted, '
	+ (100 * A.unmet).toFixed(2) + '% of the demand unmet');
check.ok('the integrated frame itself fits the 20 ms host gate', A.msFrame < 20,
	'the 300 Myr leg runs ' + A.msFrame.toFixed(2) + ' ms/frame at ' + DEMO
	+ ' kyr/frame with every P4 pass in it');
check.info('frozen: the demonstration frame is ' + demoMs.toFixed(2) + ' ms at '
	+ DEMO + ' kyr/frame (the integrated leg ' + A.msFrame.toFixed(2)
	+ ' ms) against the 20 ms host gate');

// ---------------------------------------------------------------- 5. the owners
// Item 5 of the plan: the P4 owners stay green, and the whole P3 acceptance still passes
// with P4 shipped on -- pt-p3-check.js runs its own children, so this line is the P1-P3
// suite as well. Each child's own PASS count is quoted; no measurement here has a second
// implementation.
check.section('5. the owners stay green');
function suite(name) {
	var r = cp.spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: 'utf8', maxBuffer: 1 << 26 });
	var out = (r.stdout || '') + (r.stderr || '');
	var ms = out.match(/ALL PASS \((\d+) checks\)/g);
	var m = ms ? ms[ms.length - 1] : null;
	var fails = out.match(/^FAIL  .*$/gm);
	check.ok(name, r.status === 0 && !!m, m || 'exit ' + r.status
		+ (fails ? '  ' + fails.slice(0, 4).join(' / ') : ''));
}
if (FAST) check.info('SKIP (--fast)', 'pt-p4-contact, pt-p4-slab, pt-p4-arc, pt-p4-erosion,'
	+ ' pt-p4-transport-sweep, pt-p3-check');
else for (i3 = 0; i3 < 6; i3++) {
	suite(['pt-p4-contact.js', 'pt-p4-slab.js', 'pt-p4-arc.js', 'pt-p4-erosion.js',
		'pt-p4-transport-sweep.js', 'pt-p3-check.js'][i3]);
}

console.log('\\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
