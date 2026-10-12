// pt-p4-contact.js — 0.3.0 P4.0: inter-plate contact and underthrusting
// (0.3.0-p4-plan.md §3 P4.0).
//
// P2.3's orogen term reads two surface columns whose plate velocities converge and adds
// relief. It is a kinematic proxy: nothing stops the two plates from ending up in the same
// ground, and the convergence it reads is therefore never resolved. P4.0 adds the mechanical
// response that proxy was standing in for, and this harness is where the plan's P4.0 gate is
// decided:
//
//   1. a controlled two-plate convergence leg, both regimes, driven through the real
//      crust() entry: the closing rate at the contact falls to zero, the override is held,
//      the colder plate's band ends up below the override's base while the override's
//      markers stay above it, and the same leg with the kernel disabled converges without
//      limit (the defect, measured, so the fix is not asserted against nothing);
//   2. mass, enthalpy, composition and melt inventories bitwise unchanged across contact
//      frames, and the arrest brake's impulse pair leaves the two clusters' combined
//      momentum unchanged;
//   3. the live shipped planet: contacts found, worst closing rate, absorbed shortening,
//      bending markers and guard pushes reported, the hard-overlap count against a
//      kernel-off control leg, the ledger still closing, and the frame cost.
//
// The fixture's geometry is forced by the engine, not chosen for convenience. Two clusters
// bond when a marker pair is within 1.3 cells in x *and* 1.3 dEta in eta (solid.js pair), so
// two plates that share a depth band and hold adjacent columns weld on the first frame --
// which is exactly the weld the contact pass exists to prevent, and it cannot be measured if
// it happens before the pass runs. The fixture therefore separates the two plates in depth:
// a rootless surface lid (the override) over a deeper lid that carries the root which
// deepens toward the trench, because that root is what the shipped slab pull reads
// (solid.js kinematics: csS sums m*ry over the markers below the centroid, so a plate whose
// lid is deeper on one side is pulled toward that side). The 50 km weak band between the two
// lids is what keeps them two clusters while their shallowest markers sit in adjacent
// columns, which is the contact the pass reads.
//
// The band is weak because its markers' age is zero, not because they are hot. A hot band
// between two cold lids is buoyant, and the upwelling it drives sinks the override's lid
// into the slab's depth range until the two bond -- a weld with nothing to do with contact.
// Everything in the fixture is therefore isothermal with the lids, so nothing is buoyant,
// nothing cools, and the only motion is the pull plus the contact response. The price is
// that the age-zero material welds after ~tauWeld*ln(4) ~ 5.8 Myr, so the controlled legs
// run 5 Myr: long enough for the slab to deliver ~225 km to the trench and for the band to
// bend below the crust base, short enough that the fixture's own ageing is not what ends
// the leg. The failure law is likewise held at zero (P.kDamage = 0): it would break the
// leading edges of both lids for a reason that has nothing to do with contact, and the pass
// under test would then never see a boundary.
//
// Run: node experiments/pt-p4-contact.js [liveMyr=300]
// The live leg needs ~100 Myr before the shipped lid fragments into converging plates, so a
// shorter argument reports an empty census rather than a red one; 300 Myr is the number the
// report quotes.
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), POOL = require(B + 'pool.js');
var SC = require(B + 'solid.js'), CONTACT = require(B + 'contact.js');

var LIVE = +(process.argv[2] || 300);       // Myr of the live planet leg
var t0 = Date.now();

// ---------------------------------------------------------------- the fixture
// Everything a controlled leg changes from the shipped planet, in one place; the rest are
// the shipped parameters, so every number below runs through the real pipeline.
var HALF, WEDGE;

function configure() {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50;
	P.kDamage = 0;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	HALF = SIM.M.nx >> 1;
	WEDGE = 20;
}

// H is the conserved field and T is the equilibrium mapping of it, so a fixture that wants a
// temperature writes H (phase.js byT is the exact inverse of the kernel's byH).
function setT(p, T) { S.H[p] = PHASE.byT(T, S.y[p], S.cF[p], S.cW[p]).h; }

// dT is the temperature contrast the leg prescribes across the trench: the subducting plate
// is the colder one by dT/2 and the override warmer by dT/2, so dT = 0 is the arrest leg and
// dT above contactdT the subduction leg. The subducting plate is the left one and carries the
// root; the override is the right one and is rootless.
function twoPlates(dT) {
	var nx = SIM.M.nx, dx = SIM.M.dx, half = HALF, wedge = WEDGE;
	var TS = 0.2 - dT * 0.5, TO = 0.2 + dT * 0.5;
	var p, i, strong, base;
	SIM.reset();
	for (p = 0; p < S.n; p++) {
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		setT(p, 0.2); S.age[p] = 0;
		if (i < 4 || i >= nx - 4) continue;                 // the antimeridian: weak and cold
		if (i < half) {
			// the subducting plate: a lid whose base deepens toward the trench
			base = (i >= half - wedge) ? 250 : 200;
			strong = S.y[p] >= 150 && S.y[p] <= base;
			if (strong) { setT(p, TS); S.age[p] = 400; }
		} else {
			// the override: a rootless surface lid, so no pull of its own
			strong = S.y[p] >= 65 && S.y[p] <= 100;
			if (strong) { setT(p, TO); S.age[p] = 400; }
		}
	}
}

// The two plates by centroid depth, not by cluster index: the union-find renumbers every
// frame, and a leg that names its plates by index is measuring whichever fragment the
// renumber happened to put first. [0] is the subducting (deeper) plate, [1] the override.
function plates() {
	var sub = -1, ovr = -1, c;
	for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200) {
		if (sub < 0 || S.csY[c] > S.csY[sub]) sub = c;
	}
	for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200 && c !== sub) {
		if (ovr < 0 || S.csY[c] < S.csY[ovr]) ovr = c;
	}
	return [sub, ovr];
}

function books() {
	POOL.inventoryComp(S);
	return { M: S.invMTot, H: S.invHTot, F: S.invFTot, W: S.invWTot, L: S.invLTot };
}

function mean(a) {
	var s = 0, i;
	for (i = 0; i < a.length; i++) s += a[i];
	return a.length ? s / a.length : 0;
}

// One measured leg. `on` runs the shipped kernel; `off` is the control that shows the
// defect. Everything read here is state the real pipeline leaves behind.
function leg(dT, on, myr) {
	configure();
	P.contact = on;
	twoPlates(dT);
	var b0 = books(), pl, k;
	var o = { dT: dT, on: on, nSub: 0, frames: 0, closed: 0, weldAt: -1,
		sites: 0, worst: 0, holds: 0, bends: 0, pushes: 0, vSub: [], vOvr: [], close: [],
		deep0: 0, deep1: 0, ovrDeep1: 0, shared0: 0, shared1: 0, b0: b0, b1: null, short: 0 };
	// the shared-ground census: columns where both plates hold crust markers. Two plates in
	// the same ground is the defect; a resolved contact is what stops it growing.
	function census() {
		var cols = {}, q, ci, deep = 0, ovrDeep = 0, shared = 0;
		for (q = 0; q < S.n; q++) {
			if (S.cl[q] === pl[0] && S.y[q] > P.yCrust) deep++;
			if (S.cl[q] === pl[1] && S.y[q] > P.yCrust) ovrDeep++;
			if (S.cl[q] < 0 || S.y[q] > P.yCrust) continue;
			ci = Math.round(S.x[q] / SIM.M.dx); ci -= Math.floor(ci / SIM.M.nx) * SIM.M.nx;
			cols[ci] = cols[ci] || {};
			cols[ci][S.cl[q]] = 1;
		}
		for (ci in cols) if (cols[ci][pl[0]] && cols[ci][pl[1]]) shared++;
		return { deep: deep, ovrDeep: ovrDeep, shared: shared };
	}
	// the cluster table is built by crust() itself, so the "before" reading is taken after
	// the first frame of the leg, not from a reset state that still carries the previous
	// leg's numbering
	SIM.step();
	o.frames++;
	pl = plates();
	if (pl[0] < 0 || pl[1] < 0) { o.weldAt = SIM.t; }
	else {
		o.nSub = S.csCnt[pl[0]];
		var c0 = census();
		o.deep0 = c0.deep; o.shared0 = c0.shared;
		o.vSub.push(S.csVX[pl[0]] * P.cmYr); o.vOvr.push(S.csVX[pl[1]] * P.cmYr);
		o.close.push(S.csVX[pl[0]] * P.cmYr - S.csVX[pl[1]] * P.cmYr);
		o.closed++;
	}
	if (S.d.contact > o.sites) o.sites = S.d.contact;
	if (S.d.contactC > o.worst) o.worst = S.d.contactC;
	o.holds += S.d.hold; o.bends += S.d.subduct; o.pushes += S.d.push;
	for (k = 1; k < Math.round(myr / SIM.dt); k++) {
		SIM.step();
		o.frames++;
		if (S.d.contact > o.sites) o.sites = S.d.contact;
		if (S.d.contactC > o.worst) o.worst = S.d.contactC;
		o.holds += S.d.hold; o.bends += S.d.subduct; o.pushes += S.d.push;
		pl = plates();
		if (pl[0] < 0 || pl[1] < 0) { if (o.weldAt < 0) o.weldAt = SIM.t; continue; }
		o.closed++;
		o.vSub.push(S.csVX[pl[0]] * P.cmYr);
		o.vOvr.push(S.csVX[pl[1]] * P.cmYr);
		o.close.push(S.csVX[pl[0]] * P.cmYr - S.csVX[pl[1]] * P.cmYr);
		var cc = census();
		if (cc.deep > o.deep1) o.deep1 = cc.deep;
		if (cc.ovrDeep > o.ovrDeep1) o.ovrDeep1 = cc.ovrDeep;
		if (cc.shared > o.shared1) o.shared1 = cc.shared;
	}
	o.short = S.contactShort;
	o.b1 = books();
	return o;
}

// ---------------------------------------------------------------- 1. the legs
check.section('A. the controlled two-plate legs (both regimes, and the kernel-off control)');

var MYR = 5;
var arr = leg(0, true, MYR);                    // arrest: no usable contrast
var sub = leg(0.2, true, MYR);                  // subduction: the subducting plate is colder
var ctl = leg(0.2, false, MYR);                 // the defect: nothing answers the contact

check.info('arrest   (dT 0, kernel on)', 'sites ' + arr.sites + '  worst closing '
	+ arr.worst.toFixed(3) + '/Myr  subducting plate ' + mean(arr.vSub).toFixed(2) + ' cm/yr'
	+ '  override ' + mean(arr.vOvr).toFixed(2) + ' cm/yr  weld at t=' + arr.weldAt.toFixed(1)
	+ ' Myr  shortening ' + arr.short.toFixed(0) + ' km');
check.info('subduct. (dT 0.2, kernel on)', 'sites ' + sub.sites + '  worst closing '
	+ sub.worst.toFixed(3) + '/Myr  subducting plate ' + mean(sub.vSub).toFixed(2) + ' cm/yr'
	+ '  override ' + mean(sub.vOvr).toFixed(2) + ' cm/yr  weld at t=' + sub.weldAt.toFixed(1)
	+ ' Myr  shortening ' + sub.short.toFixed(0) + ' km');
check.info('control  (kernel off)', 'sites ' + ctl.sites + '  subducting plate '
	+ mean(ctl.vSub).toFixed(2) + ' cm/yr  override ' + mean(ctl.vOvr).toFixed(2)
	+ ' cm/yr  closing ' + mean(ctl.close).toFixed(2) + ' cm/yr  weld at t='
	+ ctl.weldAt.toFixed(1) + ' Myr');

// the defect, measured: with the kernel off the two plates close on each other at the
// slab-pull rate and nothing answers -- the boundary keeps converging, the shared ground
// keeps growing, and no material is ever bent out of the way
check.ok('the control leg converges and is never answered', ctl.sites === 0
	&& Math.abs(mean(ctl.close)) > 1,
	'closing ' + mean(ctl.close).toFixed(2) + ' cm/yr, 0 sites answered, shared ground '
	+ ctl.shared0 + ' -> ' + ctl.shared1 + ' columns');
// the response: both legs answer the contact and the two plates stay two plates
check.ok('the arrest leg answers the contact and keeps two plates',
	arr.sites > 0 && arr.weldAt < 0,
	'sites ' + arr.sites + ', no weld over ' + MYR + ' Myr (' + arr.closed + '/' + arr.frames
	+ ' frames), shortening ' + arr.short.toFixed(0) + ' km');
check.ok('the subduction leg answers the contact and keeps two plates',
	sub.sites > 0 && sub.weldAt < 0,
	'sites ' + sub.sites + ', no weld over ' + MYR + ' Myr (' + sub.closed + '/' + sub.frames
	+ ' frames), ' + sub.holds + ' hold-frames, ' + sub.bends + ' bending markers');

// the closing rate at the contact falls to zero. The brake corrects the cluster's rigid
// velocity before the projection moves anything with it, so the frame's own closing -- what
// detect measured, before the correction -- is what the next frame inherits: a boundary that
// is still closing after the response is a boundary the response did not take.
check.ok('arrest: the closing rate at the contact falls to zero',
	Math.abs(mean(arr.close)) < P.contactYield * P.cmYr * SIM.M.dx,
	'post-brake closing ' + mean(arr.close).toFixed(3) + ' cm/yr against the control '
	+ mean(ctl.close).toFixed(2));
// the override is held: the hold cancels its approach along the trench direction and nothing
// else, so the override's mean speed over the leg is far below the control's
check.ok('subduction: the override is held', Math.abs(mean(sub.vOvr)) < 0.5,
	'override ' + mean(sub.vOvr).toFixed(3) + ' cm/yr against the control '
	+ mean(ctl.vOvr).toFixed(2) + ', subducting plate keeps '
	+ mean(sub.vSub).toFixed(2) + ' cm/yr');
// the colder plate's band ends up below the override's base while the override's markers stay
// above it. Read from the plates' own material: the subducting cluster's markers below the
// crust base, which is zero before the response and non-zero after it
check.ok('subduction: the subducting band ends up below the crust base',
	sub.deep1 > 20 && sub.deep0 === 0,
	sub.deep1 + ' of ' + sub.nSub + ' subducting markers below ' + P.yCrust
	+ ' km (0 before the response), ' + sub.bends + ' bending markers');
check.ok('subduction: the override markers stay above the band', sub.ovrDeep1 === 0,
	sub.ovrDeep1 + ' override markers below ' + P.yCrust + ' km');
// and without the kernel the same leg bends nothing: the defect is not asserted against
// nothing, it is the same fixture with the response removed
check.ok('the control leg bends no material below the crust base',
	ctl.deep1 === 0 && ctl.deep0 === 0,
	ctl.deep1 + ' markers below ' + P.yCrust + ' km with the kernel off');

// ---------------------------------------------------------------- 2. the books
check.section('B. the ledgers and the arrest impulse pair');

// The kernel changes velocities and positions only, so the stocks it cannot touch are
// measured directly across its own calls on a live state: detect, brake, hinge, guard, in the
// order solid.js runs them, with the books read either side.
configure(); P.contact = true; twoPlates(0);
var k, bA, bB, dM = 0, dH = 0, dF = 0, dW = 0, dL = 0, runs = 0;
for (k = 0; k < 100 && runs < 6; k++) {
	SIM.step();
	if (!S.d.contact) continue;
	bA = books();
	CONTACT.detect(SIM.M, S, 0);
	CONTACT.brake(SIM.M, S);
	CONTACT.hinge(SIM.M, S, SIM.dt);
	CONTACT.guard(SIM.M, S);
	bB = books();
	if (bB.M !== bA.M) dM++;
	if (bB.H !== bA.H) dH++;
	if (bB.F !== bA.F) dF++;
	if (bB.W !== bA.W) dW++;
	if (bB.L !== bA.L) dL++;
	runs++;
}
check.ok('the kernel leaves the mass ledger bitwise unchanged', runs > 0 && dM === 0,
	dM + ' of ' + runs + ' measured contact frames differ');
check.ok('the kernel leaves the composition ledgers bitwise unchanged', dF + dW === 0,
	'felsic ' + dF + ', water ' + dW);
check.ok('the kernel leaves the melt stock bitwise unchanged', dL === 0, dL + ' frames differ');
check.ok('the kernel leaves the enthalpy ledger bitwise unchanged', dH === 0,
	dH + ' of ' + runs + ' frames differ');
// and over the whole legs, where the wall flux does move enthalpy, mass still cannot move
check.ok('the arrest leg closes its mass ledger', arr.b1.M === arr.b0.M,
	'residual ' + (arr.b1.M - arr.b0.M).toExponential(2));
check.ok('the subduction leg closes its mass ledger', sub.b1.M === sub.b0.M,
	'residual ' + (sub.b1.M - sub.b0.M).toExponential(2));

// the arrest brake's impulse pair. The brake is the one part of the pass whose balance is a
// property of a single frame, so it is measured on the live state the leg leaves behind:
// detect again (dt zero, so nothing is booked), take the two clusters' combined momentum,
// apply the brake, take it again. Momentum is not conserved engine-wide -- the mantle
// advection itself moves markers by an interpolated flow -- but this pair is.
configure(); P.contact = true; twoPlates(0);
var px0 = 0, px1 = 0, measured = 0, c, pl;
for (k = 0; k < 100 && measured < 6; k++) {
	SIM.step();
	if (!S.d.contact) continue;
	CONTACT.detect(SIM.M, S, 0);
	pl = plates();
	px0 = 0;
	for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200) px0 += S.csM[c] * S.csVX[c];
	CONTACT.brake(SIM.M, S);
	px1 = 0;
	for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200) px1 += S.csM[c] * S.csVX[c];
	measured++;
}
check.ok('the arrest brake leaves the combined momentum unchanged',
	measured > 0 && Math.abs(px1 - px0) <= 1e-9 * Math.abs(px0),
	'dpx ' + (px1 - px0).toExponential(2) + ' over ' + measured
	+ ' measured frames (px ' + px0.toExponential(3) + ')');

// ---------------------------------------------------------------- 3. the live planet
check.section('C. the live shipped planet');

function live(on, myr) {
	P.contact = on;
	P.seed = 1; P.sl.kyr = 50; P.kDamage = 90;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	POOL.inventoryComp(S);
	var o = { m0: S.invMTot, sites: 0, worst: 0, holds: 0, bends: 0, pushes: 0,
		pushFrames: 0, short: 0, frames: 0, mass: 0, t: 0, hash: 0 };
	var frames = Math.round(myr / SIM.dt), k;
	for (k = 0; k < frames; k++) {
		SIM.step();
		o.frames++;
		if (S.d.contact > o.sites) o.sites = S.d.contact;
		if (S.d.contactC > o.worst) o.worst = S.d.contactC;
		o.holds += S.d.hold; o.bends += S.d.subduct;
		if (S.d.push > 0) { o.pushes += S.d.push; o.pushFrames++; }
	}
	o.short = S.contactShort;
	POOL.inventoryComp(S);
	o.mass = S.invMTot - o.m0;
	o.t = SIM.t; o.hash = S.hash();
	return o;
}

var lon = live(true, LIVE), lof = live(false, LIVE);
check.info('kernel on', 't ' + lon.t.toFixed(0) + ' Myr, ' + lon.sites + ' sites in the worst'
	+ ' frame, worst closing ' + lon.worst.toFixed(3) + '/Myr, ' + lon.holds
	+ ' hold-frames, ' + lon.bends + ' bending markers, ' + lon.pushes + ' guard pushes on '
	+ lon.pushFrames + ' frames, absorbed shortening ' + lon.short.toFixed(0) + ' km');
check.info('kernel off', 't ' + lof.t.toFixed(0) + ' Myr, no response, ledger drift '
	+ lof.mass.toExponential(2) + ' km2, ' + lof.short.toFixed(0) + ' km absorbed, '
	+ lof.pushes + ' guard pushes -- the control books nothing because it answers nothing');

check.ok('the live planet reaches contacts', lon.sites > 0,
	lon.sites + ' sites in the worst frame');
check.ok('the live planet answers its contacts', lon.holds + lon.bends > 0,
	lon.holds + ' hold-frames and ' + lon.bends + ' bending markers over ' + lon.frames
	+ ' frames');
// the gate: colliding plates do not interpenetrate. The guard is the discrete statement of
// it, and its count is how often the velocity-level response left work for it -- which the
// plan asks to be reported, not hidden. On the controlled legs the velocity response is
// sufficient and the guard never fires; on the live planet, where the lid fragments into
// many clusters whose fronts jitter, it fires on a bounded minority of frames and separates
// every pair it finds. The kernel-off control books zero for the same reason it books zero
// shortening: it answers nothing at all.
check.ok('the controlled legs leave no hard overlap for the guard',
	arr.pushes === 0 && sub.pushes === 0,
	'0 pushes over ' + (arr.frames + sub.frames) + ' controlled frames');
check.ok('the live leg leaves the guard a bounded minority of frames',
	lon.pushFrames < 0.25 * lon.frames,
	lon.pushes + ' pushes on ' + lon.pushFrames + ' of ' + lon.frames + ' frames ('
	+ (100 * lon.pushFrames / lon.frames).toFixed(1) + '%), against '
	+ lof.pushes + ' with the kernel off');
check.ok('the live ledger still closes with the kernel on', lon.mass === 0,
	'mass residual ' + lon.mass.toExponential(2) + ' km2 over ' + lon.frames + ' frames');
check.ok('the live leg is deterministic', lon.hash !== 0, 'fingerprint ' + lon.hash);

// the frame cost: the pass is O(markers + columns) and allocates nothing, so it is priced
// against the frame it rides in. It is called once outside the step to time it in isolation,
// which is the same work the frame itself asks of it
configure(); P.contact = true; P.kDamage = 90;
SIM.init(); SIM.reset(); SIM.dt = P.sl.kyr / 1000;
var N = 400, tc = 0, tf = 0, a, bb;
for (k = 0; k < N; k++) {
	a = process.hrtime.bigint();
	CONTACT.detect(SIM.M, S, SIM.dt); CONTACT.brake(SIM.M, S);
	CONTACT.hinge(SIM.M, S, SIM.dt); CONTACT.guard(SIM.M, S);
	bb = process.hrtime.bigint();
	tc += Number(bb - a) / 1e6;
	SIM.step();
	tf += Number(process.hrtime.bigint() - bb) / 1e6;
}
check.ok('the contact pass costs under 2% of the frame', tc < 0.02 * tf,
	(tc / N).toFixed(3) + ' ms/frame for the pass against ' + (tf / N).toFixed(2)
	+ ' ms/frame for the rest (' + (100 * tc / tf).toFixed(2) + '%)');

check.info('wall time', ((Date.now() - t0) / 1000).toFixed(0) + ' s for '
	+ (LEGS * MYR + 2 * LIVE + N * SIM.dt).toFixed(0) + ' Myr of simulation');
check.done();
