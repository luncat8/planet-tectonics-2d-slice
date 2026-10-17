// pt-p4-transport-sweep.js — 0.3.0 P4.3: the surface law's comparison, and the decision
// (0.3.0-p4-plan.md §3 P4.3, §4 "the surface law ... chosen by measurement, not preference";
// 0.3.0-plan.md §4.3 asks for a particle-based runoff/stream-power rule against a conservative
// hillslope rule before erosion or deposition is claimed).
//
// Both candidates are driven through the shipped pass's own machinery (js/pt/erode.js
// `route` / `law` / `move`) on one controlled relief fixture, so the comparison is between
// *laws* and not between implementations:
//
//   runoff / stream power   E_i = kStream * sqrt(A_i) * slope_i km/Myr, capped at eroMax,
//                           A_i the drainage area the profile's steepest-descent receiver map
//                           accumulates into column i and slope_i the drop to that receiver
//                           over dx. One frame's demand is E_i * dt * dx km2
//                           and every column's material settles at the end of its own flow
//                           path: the first reach whose channel slope has fallen below
//                           `eroSlopeDep`, or the sink the path ends in.
//   conservative hillslope  q = D * (z_i - z_j) per face, j the steeper lower neighbour,
//                           D = kProfileDiff km2/Myr, P2.3's profile diffusivity applied to
//                           material: creep, one column per hop, no routing.
//
// Equal work, both ways (§C). Both laws are linear in their own coefficient, so a leg that scales
// one law's demand scales every column's demand by the same factor and changes no shape. The
// fixture is therefore run twice: once at the hillslope law's own yield (the runoff law throttled
// to it) and once at the runoff law's own fixture yield (the hillslope law throttled to that).
// A verdict that depends on which equal-work level it was read at is not a verdict about the law,
// so every criterion has to hold at both. At the shipped kStream the fixture's demand stays below
// the channel cap, so both rate-B tables are the shipped law's own shape.
//
// The decision rule, fixed before the numbers (§4 of the plan):
//   D1 conservation -- mass, enthalpy, felsic, water and melt close across a hand-called frame,
//      the matched books balance, the P3.1 latent identity holds and the fingerprint moves.
//      Both laws must pass.
//   D2 downhill -- every demand column's material lands on a column reachable by walking its own
//      receiver chain, at a height no higher than its own. A transfer that cannot lose height
//      settles in the source column itself; the in-place share is measured and reported apart.
//      Both laws must pass.
//   D3 basin capture -- at equal work, at least three quarters of the moved mass settles inside
//      the fixture's two basins (each deposition reach extended by its own sink: a sink is a
//      basin floor even where its outgoing face is too steep to be called flat, so the reading
//      uses the same terrain the law's own site map ends in).
//   D4 transport reach -- at equal work, at least half of the moved mass settles more than one
//      column from the column it was taken from. A one-hop law's share is zero by construction;
//      that is the whole content of "runoff against hillslope" in a slice.
//   D5 budget and effect -- on the shipped planet at the shipped coefficients, background frozen
//      so the reading is the law's own: the pass costs at most 1.0 ms/frame of its own work, meets
//      no pool refusal and starves no reach, and the runoff rule's net redistribution is a real
//      share of the mass it moves (the hillslope leg's own readings are reported beside it). A law
//      whose throughput is large but whose divergence is small smooths the crust; it does not move
//      the crust's material anywhere.
// The shipped law is the candidate that passes D1-D4 at both equal-work rates and whose D5 holds;
// on a tie, the cheaper.
//
// Run: node experiments/pt-p4-transport-sweep.js [legFrames=400] [liveMyr=8]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var POOL = require(B + 'pool.js'), ERODE = require(B + 'erode.js');
var L = require('./pt-p4-lib.js');

var FRAMES = +(process.argv[2] || 400);
var LIVE = +(process.argv[3] || 8);              // Myr of shipped planet per live leg
var ERO0 = P.ero;
var HILL = P.kProfileDiff;        // the hillslope candidate's coefficient: P2.3's profile
                                  // diffusivity, read here rather than re-typed

function books() { POOL.inventoryComp(S); return { M: S.invMTot, H: S.invHTot, F: S.invFTot, W: S.invWTot }; }

function latent() { return (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0); }

function same(a, b) {
	var i;
	if (a.length !== b.length) return false;
	for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// ---------------------------------------------------------------- the two candidate laws
// Both fill the shipped demand table S.erD and, for the law whose destination is not the end of
// the drainage path, the site table S.erSite. Nothing else differs between them. A sink is a lake
// floor -- the drainage ends there, it is a site and not a source -- and a flat reach erodes
// nothing, which is what makes a basin depositional.

function candStream(M, S, dt) {
	var nx = M.nx, dx = M.dx, invDx = 1 / dx, k = P.kStream, cap = P.eroMax, i, r, s, e;
	for (i = 0; i < nx; i++) {
		S.erD[i] = 0;
		r = S.erR[i];
		if (r < 0) continue;
		s = (S.zh[i] - S.zh[r]) * invDx;
		if (!(s > 0)) continue;
		e = k * Math.sqrt(S.erA[i]) * s;
		if (e > cap) e = cap;
		S.erD[i] = e * dt * dx;
	}
}

function candHill(M, S, dt) {
	var nx = M.nx, k = HILL, i, ip, im, dr, dl, r;
	for (i = 0; i < nx; i++) {
		ip = i + 1 === nx ? 0 : i + 1; im = i === 0 ? nx - 1 : i - 1;
		dr = S.zh[i] - S.zh[ip]; dl = S.zh[i] - S.zh[im];
		S.erD[i] = 0;
		r = -1;                                        // the steeper drop is the transport axis
		if (dr > 0 && dr >= dl) r = ip; else if (dl > 0) r = im;
		if (r < 0) continue;
		S.erSite[i] = r;                               // one hop: that is the law
		S.erD[i] = k * (r === ip ? dr : dl) * dt;
	}
}

// the two laws' raw per-frame demand tables on the fixture (no transfer, no scaling)
function rawTables() {
	var nx = SIM.M.nx, dx = SIM.M.dx, i, r;
	ERODE.route(SIM.M, S);
	candStream(SIM.M, S, SIM.dt);
	var s = 0, capHit = 0;
	for (i = 0; i < nx; i++) {
		s += S.erD[i];
		r = S.erR[i];
		if (r >= 0 && P.kStream * Math.sqrt(S.erA[i]) * (S.zh[i] - S.zh[r]) / dx > P.eroMax) capHit++;
	}
	ERODE.route(SIM.M, S);
	candHill(SIM.M, S, SIM.dt);
	var h = 0, hops = 0, d;
	for (i = 0; i < nx; i++) {
		h += S.erD[i];
		if (!(S.erD[i] > 0)) continue;
		d = S.erSite[i] - i;
		if (d > nx / 2) d -= nx; else if (d < -nx / 2) d += nx;
		if (d !== 1 && d !== -1) hops++;
	}
	return { stream: s, hill: h, capHit: capHit, hops: hops };
}

// the demand table read as transfers: a column's material lands at its site, so the shares the
// criteria read are shares of the demand. `basin` counts a site inside a basin range, `far` and
// `inPlace` measure how far the material travels, `mean` its mean hop.
function shares(ranges) {
	var nx = SIM.M.nx, i, b, d, k, site, isBasin;
	var tot = 0, far = 0, inPlace = 0, hop = 0, basin = 0;
	for (i = 0; i < nx; i++) {
		k = S.erD[i];
		if (!(k > 0)) continue;
		site = S.erSite[i];
		isBasin = false;
		for (b = 0; b < ranges.length; b++) if (site >= ranges[b][0] && site <= ranges[b][1]) isBasin = true;
		d = site - i;
		if (d > nx / 2) d -= nx; else if (d < -nx / 2) d += nx;
		tot += k; hop += k * (d < 0 ? -d : d);
		if (isBasin) basin += k;
		if (d > 1 || d < -1) far += k;
		else if (d === 0) inPlace += k;
	}
	return { mass: tot, basin: tot ? basin / tot : 0, far: tot ? far / tot : 0,
		inPlace: tot ? inPlace / tot : 0, mean: tot ? hop / tot : 0 };
}

// D2, measured: every demand column's material must land on a column reachable by walking its own
// receiver chain -- the site map and the receiver map must agree -- at a height no higher than its
// own. Returns the count of each violation.
function downhill() {
	var nx = SIM.M.nx, i, s, w, n, off = 0, up = 0;
	for (i = 0; i < nx; i++) {
		if (!(S.erD[i] > 0)) continue;
		s = S.erSite[i];
		w = i; n = 0;
		while (w !== s && n++ <= nx) { w = S.erR[w]; if (w < 0) break; }
		if (w !== s) { off++; continue; }
		if (S.zh[s] > S.zh[i]) up++;
	}
	return { off: off, up: up };
}

// the net redistribution the crust's band took: the sum of the positive per-column changes, half
// the total movement. It ignores the circulation a diffusive law does (out of a column and back
// into its neighbour) because the band is measured as a whole -- the arriving deposit sits inside
// it -- and that circulation is exactly the difference D5 is about.
function net(before, after) {
	var nx = SIM.M.nx, i, up = 0;
	for (i = 0; i < nx; i++) if (after[i] > before[i]) up += after[i] - before[i];
	return up;
}

// ------------------------------------------------------------------ the fixture leg
// One leg on the frozen fixture: the demand table is scaled to `target` km2/frame and the shipped
// machinery moves it, frame after frame. The profile is frozen (erode.js never writes zh), so the
// tables are the same every frame and the leg's census is one table times the frames.
function fixtureLeg(law, target, frames) {
	var nx = SIM.M.nx, i, f, sum = 0, t, sh = null, down = null;
	L.configure();
	L.relief();
	var ranges = L.basins();
	ERODE.route(SIM.M, S);
	law(SIM.M, S, SIM.dt);
	for (i = 0; i < nx; i++) sum += S.erD[i];
	f = sum > 0 ? target / sum : 0;
	POOL.inventoryComp(S);
	var before = L.bandMass(), dep0 = S.invN[P.PH.dep], mDep0 = S.invM[P.PH.dep];
	var moved0 = S.thr.eroCr, short0 = S.eroShort, refuse0 = S.tx.refuse, tx0 = S.tx.ero;
	for (t = 0; t < frames; t++) {
		ERODE.route(SIM.M, S);
		law(SIM.M, S, SIM.dt);
		for (i = 0; i < nx; i++) S.erD[i] *= f;
		if (t === 0) { sh = shares(ranges); down = downhill(); }
		ERODE.move(SIM.M, S);
	}
	var after = L.bandMass();
	POOL.inventoryComp(S);
	return { moved: S.thr.eroCr - moved0, starved: S.eroShort - short0, sh: sh, down: down,
		admit: S.invN[P.PH.dep] - dep0, sed: S.invM[P.PH.dep] - mDep0, net: net(before, after),
		dip: L.mean(after) - L.mean(before), refuse: S.tx.refuse - refuse0, tx: S.tx.ero - tx0,
		frames: frames, scale: f, target: target, ranges: ranges };
}

// ------------------------------------------------------------------ the live planet leg
// The shipped planet at the shipped coefficients, background frozen: the warm-up is a real run,
// then only the law's own route/law/move step, so the census is the law's and not the rest of the
// model's -- the phase, arc, vent and flight passes also move material in and out of the band and
// would drown a redistribution reading. Both laws start from the same warmed state (the engine is
// deterministic), which the run checks rather than assumes.
function frozenLeg(law, name, frames) {
	var i, t0, ms = 0;
	L.livePlanet();
	P.ero = false;
	// 0.3.2 M8's deposit field bound is later than this freeze and shifts the live world; off in
	// this owner's legs, on in the integrated P4.4 leg (which is the shipped configuration).
	P.depBound = 0;
	for (i = 0; i < 100; i++) SIM.step();
	var before = L.bandMass();
	POOL.inventoryComp(S);
	var moved0 = S.thr.eroCr, short0 = S.eroShort, dep0 = S.invN[P.PH.dep];
	var tx0 = S.tx.ero, refuse0 = S.tx.refuse;
	for (i = 0; i < frames; i++) {
		t0 = Date.now();
		ERODE.route(SIM.M, S);
		law(SIM.M, S, SIM.dt);
		ERODE.move(SIM.M, S);
		ms += Date.now() - t0;
	}
	var after = L.bandMass();
	POOL.inventoryComp(S);
	var band0 = 0, band1 = 0;
	for (i = 0; i < nx; i++) { band0 += before[i]; band1 += after[i]; }
	P.ero = ERO0;
	return { name: name, before: before, after: after, moved: S.thr.eroCr - moved0,
		starved: S.eroShort - short0, admit: S.invN[P.PH.dep] - dep0, sed: S.invM[P.PH.dep],
		net: net(before, after), band: band1 - band0, tx: S.tx.ero - tx0,
		refuse: S.tx.refuse - refuse0, pass: ms / frames, frames: frames };
}

// ------------------------------------------------------------------ A. the fixture
check.section('A. the controlled relief fixture: two divides, two basins, one drainage map');

var M = L.configure();
L.relief();
var nx = M.nx, dx = M.dx, i, ip, q, b, j;
var meanSlope = (function () {
	var s = 0, k;
	for (k = 0; k < nx; k++) s += Math.abs(S.zh[(k + 1) % nx] - S.zh[k]) / dx;
	return s / nx;
}());
console.log('  relief ' + nx + ' columns x ' + dx + ' km, wrap ' + P.wrap + ' km, '
	+ L.RELIEF.length + ' knots');
console.log('    zh ' + Math.min.apply(null, S.zh).toFixed(2) + '..'
	+ Math.max.apply(null, S.zh).toFixed(2) + ' km, mean ' + L.mean(S.zh).toExponential(2)
	+ ', mean |slope| ' + meanSlope.toExponential(2));
var sinks = L.sinks(), flats = L.flats(), basins = L.basins();
console.log('    sinks ' + sinks.join(', ') + '   deposition reaches (|slope| < ' + P.eroSlopeDep
	+ ') ' + flats.map(function (r) { return r[0] + '..' + r[1]; }).join('  ') + '   basins '
	+ basins.map(function (r) { return r[0] + '..' + r[1]; }).join('  '));
check.ok('the fixture has two divides and two basins', sinks.length === 2 && basins.length === 2,
	sinks.length + ' sinks, ' + basins.length + ' basins');
var inBasin = 0;
for (i = 0; i < sinks.length; i++) for (b = 0; b < basins.length; b++)
	if (sinks[i] >= basins[b][0] && sinks[i] <= basins[b][1]) { inBasin++; break; }
check.ok('each basin holds its own sink', inBasin === 2, inBasin + ' of 2');

// the route map and the drainage, by hand: the receiver is the steeper lower neighbour, and the
// area is a per-column upstream walk (nothing of erode.js is used for the check)
ERODE.route(M, S);
var bad = 0, areaBad = 0;
for (i = 0; i < nx; i++) {
	ip = i + 1 === nx ? 0 : i + 1; b = i === 0 ? nx - 1 : i - 1;
	var dr = S.zh[i] - S.zh[ip], dl = S.zh[i] - S.zh[b], want;
	want = (dr > 0 && dr >= dl) ? ip : (dl > 0 ? b : -1);
	if (S.erR[i] !== want) bad++;
}
check.ok('every receiver is the steepest lower neighbour, recomputed by hand', bad === 0,
	bad + ' disagreements');
for (q = 0; q < nx; q++) {
	var tot = 0;
	for (j = 0; j < nx; j++) {
		var w = j, guard = 0;
		while (w >= 0 && guard++ <= nx) { if (w === q) { tot += dx; break; } w = S.erR[w]; }
	}
	if (Math.abs(tot - S.erA[q]) > 1e-9) areaBad++;
}
check.ok('the drainage peel equals a per-column upstream walk', areaBad === 0, areaBad + ' columns differ');

// the demand table, by hand, from zh and the receiver -- not from erS -- on a right-draining
// column, a left-draining column (the divide, whose two faces differ) and a sink. Reading
// |erS| would restate the pass and would not have caught a right-face slope.
ERODE.law(M, S, SIM.dt);
var ok = 0, cols = [100, L.RELIEF[2][0], sinks[0]], e, r, sChan;
for (i = 0; i < cols.length; i++) {
	q = cols[i];
	r = S.erR[q];
	sChan = r < 0 ? 0 : (S.zh[q] - S.zh[r]) / dx;
	e = sChan > 0 ? P.kStream * Math.sqrt(S.erA[q]) * sChan : 0;
	if (e > P.eroMax) e = P.eroMax;
	if (Math.abs(S.erD[q] - e * SIM.dt * dx) < 1e-12) ok++;
}
check.ok('the demand is kStream * sqrt(A) * channel-slope * dt * dx, and a sink gets none, by hand',
	ok === 3 && S.erR[L.RELIEF[2][0]] === L.RELIEF[2][0] - 1,
	ok + ' of 3 columns; the divide drains left so the right-face slope is the wrong face');
var raw = rawTables();
console.log('    one frame at the shipped coefficients: runoff ' + raw.stream.toFixed(3)
	+ ' km2 (' + raw.capHit + ' columns at the channel cap), hillslope ' + raw.hill.toFixed(3)
	+ ' km2 (' + raw.hops + ' transfers longer than one column), ratio '
	+ (raw.stream / raw.hill).toFixed(2) + 'x');
check.ok('the fixture\'s runoff demand stays under the channel cap, so the compared shape is the '
	+ 'shipped law\'s own', raw.capHit === 0, raw.capHit + ' columns capped');
check.ok('the runoff law routes and the hillslope law hops one column', raw.hops === 0,
	'stray hops ' + raw.hops);

// ------------------------------------------------------------------ B. conservation
check.section('B. conservation: both laws move material as a pool transaction');

function conservation(name, law) {
	L.configure();
	L.relief();
	var b0 = books(), h0 = S.hash(), lat0 = latent();
	ERODE.route(M, S);
	law(M, S, SIM.dt);
	ERODE.move(M, S);
	var b1 = books();
	var dM = b1.M - b0.M, dH = b1.H - b0.H, dF = b1.F - b0.F, dW = b1.W - b0.W;
	check.ok(name + ': mass closes across one hand-called frame', dM === 0, 'dM ' + dM.toExponential(2));
	check.ok(name + ': enthalpy closes', Math.abs(dH) < 1e-9 * Math.abs(b0.H),
		'dH ' + dH.toExponential(2) + ' of ' + b0.H.toExponential(2));
	check.ok(name + ': felsic and water mass close', dF === 0 && dW === 0,
		'dF ' + dF.toExponential(2) + ', dW ' + dW.toExponential(2));
	check.ok(name + ': the P3.1 latent identity holds across the pass', Math.abs(latent() - lat0) < 1e-6,
		'shift ' + (latent() - lat0).toExponential(2));
	check.ok(name + ': the matched books balance and the fingerprint moves',
		S.thr.eroDr === S.thr.eroCr && S.tx.ero > 0 && S.hash() !== h0,
		S.tx.ero + ' transfers, ' + S.thr.eroCr.toFixed(2) + ' km2');
	check.ok(name + ': no refusal on a hand-called frame', S.tx.refuse === 0, 'refusals ' + S.tx.refuse);
}

conservation('runoff', candStream);
conservation('hillslope', candHill);

L.configure();
L.relief();
ERODE.route(M, S);
var hCtl = S.hash(), mCtl = S.invMTot;
check.ok('a frame that does not call move changes neither mass nor the fingerprint',
	S.invMTot === mCtl && S.hash() === hCtl && S.tx.ero === 0, 'mass ' + mCtl.toExponential(2));

// ------------------------------------------------------------------ C. equal work, both ways
check.section('C. equal work on the fixture: ' + FRAMES + ' frames per leg, the same mass per frame');

// rate A is the hillslope law's own fixture yield, rate B the runoff law's: at each, both laws are
// throttled to the same total, so each law is throttled once and unthrottled once
var legA_S = fixtureLeg(candStream, raw.hill, FRAMES);
var legA_H = fixtureLeg(candHill, raw.hill, FRAMES);
var legB_S = fixtureLeg(candStream, raw.stream, FRAMES);
var legB_H = fixtureLeg(candHill, raw.stream, FRAMES);

function report(tag, r, law) {
	console.log('  ' + tag + ' ' + law + ': moved ' + r.moved.toFixed(2) + ' km2 in ' + r.tx
		+ ' transfers (scale ' + r.scale.toExponential(2) + '), sediment ' + r.admit + ' parcels '
		+ r.sed.toFixed(2) + ' km2, net redistribution ' + r.net.toFixed(2) + ' km2');
	console.log('      lands in basins ' + (r.sh.basin * 100).toFixed(1) + '%   >1 column away '
		+ (r.sh.far * 100).toFixed(1) + '%   in place ' + (r.sh.inPlace * 100).toFixed(1)
		+ '%   mean hop ' + r.sh.mean.toFixed(2) + ' columns   starved '
		+ r.starved.toExponential(2) + ' km2, refusals ' + r.refuse);
}
report('rate A', legA_S, 'runoff   ');
report('rate A', legA_H, 'hillslope');
report('rate B', legB_S, 'runoff   ');
report('rate B', legB_H, 'hillslope');

var rates = [[legA_S, legA_H, 'rate A'], [legB_S, legB_H, 'rate B']];
for (i = 0; i < rates.length; i++) {
	var rs = rates[i][0], rh = rates[i][1], tag = rates[i][2];
	check.near('at equal work both laws move the same total mass (' + tag + ')',
		rh.moved, rs.moved, 1e-9, 'km2');
	check.ok('D2 no law lands material outside its own receiver chain or uphill (' + tag + ')',
		rs.down.off === 0 && rs.down.up === 0 && rh.down.off === 0 && rh.down.up === 0,
		'runoff off/uphill ' + rs.down.off + '/' + rs.down.up + ', hillslope '
		+ rh.down.off + '/' + rh.down.up);
	check.ok('D3 runoff: at least 3/4 of the moved mass settles inside the basins (' + tag + ')',
		rs.sh.basin >= 0.75, (rs.sh.basin * 100).toFixed(1) + '%');
	check.ok('D4 runoff: at least 1/2 of the moved mass settles more than one column away (' + tag + ')',
		rs.sh.far >= 0.5, (rs.sh.far * 100).toFixed(1) + '%');
	// the alternative's criteria readings are the comparison's evidence, not the engine's gate:
	// the gate on them is the verdict at the end, where the shipped law has to win
	check.info('D3/D4 hillslope (' + tag + ')', 'basin ' + (rh.sh.basin * 100).toFixed(1)
		+ '%, >1 column ' + (rh.sh.far * 100).toFixed(1) + '%, in place '
		+ (rh.sh.inPlace * 100).toFixed(1) + '%, mean hop ' + rh.sh.mean.toFixed(2));
	check.ok('neither leg starves the weathering band or meets a refusal (' + tag + ')',
		rs.starved === 0 && rh.starved === 0 && rs.refuse === 0 && rh.refuse === 0,
		'starved ' + rs.starved.toExponential(2) + '/' + rh.starved.toExponential(2)
		+ ', refusals ' + rs.refuse + '/' + rh.refuse);
}

// ------------------------------------------------------------------ D. the shipped planet
check.section('D. the shipped planet at the shipped coefficients: cost, and where the mass ends up');

var liveFrames = Math.round(LIVE / SIM.dt);
L.livePlanet();
for (i = 0; i < 100; i++) SIM.step();
var t0 = Date.now();
for (i = 0; i < liveFrames; i++) SIM.step();
var fullMs = (Date.now() - t0) / liveFrames;
t0 = Date.now();
for (i = 0; i < 200; i++) { ERODE.route(M, S); ERODE.law(M, S, SIM.dt); ERODE.move(M, S); }
var shipPass = (Date.now() - t0) / 200;
var shipShort = S.eroShort, shipRefuse = S.tx.refuse, shipMoved = S.thr.eroCr, shipTx = S.tx.ero;
console.log('  shipped run: ' + liveFrames + ' frames of ' + SIM.dt + ' Myr, frame ' + fullMs.toFixed(2)
	+ ' ms with the pass, pass alone ' + shipPass.toFixed(3) + ' ms/frame');
console.log('    moved ' + shipMoved.toFixed(1) + ' km2 in ' + shipTx + ' transfers, sediment '
	+ S.invM[P.PH.dep].toFixed(0) + ' km2 in ' + S.invN[P.PH.dep] + ' parcels, starved '
	+ shipShort.toFixed(3) + ' km2, refusals ' + shipRefuse);

// the shipped law is the runoff candidate: the same state, the same demand, bitwise
var ship = new Float64Array(nx);
ERODE.route(M, S);
ERODE.law(M, S, SIM.dt);
for (i = 0; i < nx; i++) ship[i] = S.erD[i];
ERODE.route(M, S);
candStream(M, S, SIM.dt);
var differ = 0, maxd = 0;
for (i = 0; i < nx; i++) {
	if (ship[i] !== S.erD[i]) differ++;
	if (Math.abs(ship[i] - S.erD[i]) > maxd) maxd = Math.abs(ship[i] - S.erD[i]);
}
check.ok('the shipped law is the runoff candidate, bitwise, on a live state', differ === 0,
	differ + ' columns differ, worst ' + maxd.toExponential(2) + ' km2');

var legR = frozenLeg(candStream, 'runoff', liveFrames);
var legL = frozenLeg(candHill, 'hillslope', liveFrames);
check.ok('both legs start from the same crust (the warm-up is deterministic)',
	same(legR.before, legL.before), 'band ' + L.mean(legR.before).toFixed(0) + ' km2/column');
console.log('  live legs, ' + LIVE + ' Myr each at each law\'s own coefficient, background frozen:');
console.log('    runoff    moved ' + legR.moved.toFixed(1) + ' km2 in ' + legR.tx
	+ ' transfers, net redistribution ' + legR.net.toFixed(1) + ' km2 ('
	+ (100 * legR.net / (legR.moved || 1)).toFixed(1) + '% of what it moved), sediment '
	+ legR.admit + ' parcels, band ' + legR.band.toFixed(1) + ' km2, pass '
	+ legR.pass.toFixed(3) + ' ms/frame');
console.log('    hillslope moved ' + legL.moved.toFixed(1) + ' km2 in ' + legL.tx
	+ ' transfers, net redistribution ' + legL.net.toFixed(1) + ' km2 ('
	+ (100 * legL.net / (legL.moved || 1)).toFixed(1) + '% of what it moved), sediment '
	+ legL.admit + ' parcels, band ' + legL.band.toFixed(1) + ' km2, pass '
	+ legL.pass.toFixed(3) + ' ms/frame');
console.log('    hillslope / runoff: throughput ' + (100 * legL.moved / (legR.moved || 1)).toFixed(1)
	+ '%, net redistribution ' + (100 * legL.net / (legR.net || 1)).toFixed(1)
	+ '%, concentration net/moved ' + (100 * legR.net / (legR.moved || 1)).toFixed(1) + '% against '
	+ (100 * legL.net / (legL.moved || 1)).toFixed(1) + '%');
check.ok('the runoff law redistributes a real share of the mass it moves (it concentrates it)',
	legR.net >= 0.25 * legR.moved, (100 * legR.net / (legR.moved || 1)).toFixed(1) + '%');
check.ok('neither frozen leg starves a column or meets a refusal',
	legR.starved === 0 && legL.starved === 0 && legR.refuse === 0 && legL.refuse === 0,
	'starved ' + legR.starved.toFixed(3) + '/' + legL.starved.toFixed(3) + ' km2, refusals '
	+ legR.refuse + '/' + legL.refuse);
check.ok('D5 the shipped pass costs at most 1.0 ms/frame of its own work', shipPass <= 1.0,
	shipPass.toFixed(3) + ' ms');
check.ok('D5 the shipped run meets no refusal and starves no reach',
	shipRefuse === 0 && shipShort === 0,
	'refusals ' + shipRefuse + ', starved ' + shipShort.toFixed(3) + ' km2');

// ------------------------------------------------------------------ E. the decision
check.section('E. the decision');

// the criteria a shipped law has to meet: D2 (nothing uphill, nothing off its own path), D3
// (three quarters of the moved mass reaches the basins) and D4 (half of it travels more than one
// column), read at both equal-work rates
function verdict(r) { return r.down.off === 0 && r.down.up === 0 && r.sh.basin >= 0.75 && r.sh.far >= 0.5; }
var passS = verdict(legA_S) && verdict(legB_S), passH = verdict(legA_H) && verdict(legB_H);
console.log('  D1 conservation        both laws close mass, enthalpy, felsic, water and melt');
console.log('  D2 downhill            runoff ' + [legA_S, legB_S].reduce(function (a, r) {
	return a + r.down.off + r.down.up; }, 0) + ' violations, hillslope '
	+ [legA_H, legB_H].reduce(function (a, r) { return a + r.down.off + r.down.up; }, 0)
	+ '   (in place: runoff ' + (legA_S.sh.inPlace * 100).toFixed(1) + '%, hillslope '
	+ (legA_H.sh.inPlace * 100).toFixed(1) + '%)');
console.log('  D3 basin capture       runoff ' + (legA_S.sh.basin * 100).toFixed(1) + '/' 
	+ (legB_S.sh.basin * 100).toFixed(1) + '%   hillslope ' + (legA_H.sh.basin * 100).toFixed(1)
	+ '/' + (legB_H.sh.basin * 100).toFixed(1) + '%   (need 75%)');
console.log('  D4 transport reach     runoff ' + (legA_S.sh.far * 100).toFixed(1) + '/'
	+ (legB_S.sh.far * 100).toFixed(1) + '%   hillslope ' + (legA_H.sh.far * 100).toFixed(1)
	+ '/' + (legB_H.sh.far * 100).toFixed(1) + '%   (need 50%)');
console.log('  D5 budget and effect   shipped pass ' + shipPass.toFixed(3) + ' ms/frame, live legs '
	+ legR.pass.toFixed(3) + '/' + legL.pass.toFixed(3) + ' ms, concentration '
	+ (100 * legR.net / (legR.moved || 1)).toFixed(1) + '% against '
	+ (100 * legL.net / (legL.moved || 1)).toFixed(1) + '% (net/moved), throughput '
	+ (100 * legL.moved / (legR.moved || 1)).toFixed(0) + '% of the runoff law\'s');
check.ok('the comparison picks the runoff/stream-power rule', passS && !passH,
	'runoff ' + (passS ? 'passes' : 'fails') + ', hillslope ' + (passH ? 'passes' : 'fails'));
console.log('\nDECISION: runoff/stream power ships: E = kStream*sqrt(A)*slope, capped at eroMax,');
console.log('  each column settling at the end of its own flow path (js/pt/erode.js). The hillslope');
console.log('  rule loses D3 and D4 by construction -- every transfer is one hop, so material creeps');
console.log('  along the profile instead of following the drainage the profile defines -- and D5 by');
console.log('  measurement: at this model\'s gradients a diffusive law circulates material between');
console.log('  neighbours and only its divergence changes the crust, so its net redistribution is a');
console.log('  small fraction of the stream-power rule\'s.');

check.done();
