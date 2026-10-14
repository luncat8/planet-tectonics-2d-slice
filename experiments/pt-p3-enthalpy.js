// pt-p3-enthalpy.js — 0.3.0 P3.1: the phase law, the equilibrium pass and the enthalpy ledger
// (0.3.0-p3-plan.md §4 P3.1, §1.1-§1.2).
//
// The plan replaces P1's visual melt potential with a per-material equilibrium state: H is the
// conserved quantity, and the phase law is the mapping from (H, depth, composition) to
// (T, melt fraction). This harness measures that law rather than trusting it:
//
//   1. the curve     -- the solidus/liquidus anchors, monotone in depth, the composition
//                       shifts, and the flat curve above the surface
//   2. the mapping   -- byT/byH are exact inverses; heating through onset, partial melt and
//                       full melt; cooling and freezing; the mush's effective heat capacity
//   3. the pool pass -- equil writes T and melt out of H and nothing else, and its sensible
//                       book is exactly the temperature change it read
//   4. the kernel    -- G3 hands the conduction increment to H, G4 maps it back: the marker
//                       enthalpy closes against the booked intake, the intake against the
//                       operator's wall flux, and the sensible book's gap to the enthalpy
//                       book is exactly the latent heat the melt stores. The x operator (the
//                       direction with no wall) is a redistribution: its rows conserve and
//                       lose their second moment to their own Dirichlet energy
//   5. the live run  -- the shipped planet: where the melt sits, how much of it there is, and
//                       that the closure holds for 150 Myr of the real pipeline
//   6. weakening     -- G4's melt weakening of rock is exactly (1 - xi), and where it bites
//
// Run: node experiments/pt-p3-enthalpy.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), PHASE = require(B + 'phase.js');
var G = require(B + 'grid.js'), S = require(B + 'state.js'), PTPOOL = require(B + 'pool.js');
var SIM = require(B + 'sim.js'), SC = require(B + 'solid.js'), F = require(B + 'fluid.js');

var t0 = Date.now(), M;

function configure(ic, mesh, frames) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = mesh[0]; P.mesh.ny = mesh[1];
	P.mpc = 4; P.ic = ic; P.flip = 1; P.solid = true;
	P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	if (frames) SIM.run(frames);
	return SIM.M;
}

// the compensated total of m*H, from pool.js's own inventory: the fixture must not keep a
// second opinion about the sum the engine reports
function invH() { PTPOOL.inventoryComp(S); return S.invHTot; }

function rel(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1); }

// the interior's spread about its own mean: the box's structure, which conduction damps
function fieldSpread(M, S) {
	var nx = M.nx, ny = M.ny, Tg = S.Tg, i, j, s = 0, cnt = 0, v, t = 0;
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) { s += Tg[j * nx + i]; cnt++; }
	s /= cnt;
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) { v = Tg[j * nx + i] - s; t += v * v; }
	return t;
}

console.log('  enthalpy: 256x24, 4 markers/node, Ra 1e+6, dt 0.050 Myr/frame\n');

// ---------------------------------------------------------------- 1. the curve
check.section('the solidus and the liquidus');
M = configure('rb', [256, 24], 0);
var y, i, ts, prev, o, H, k;

// The three anchors params.js derives the curve from: the surface solidus, the depth at which
// material at the CMB temperature meets it, and the margin the deep curve keeps over T = 1.
check.near('the solidus starts at the surface solidus', PHASE.solidus(0, 0, 0), P.meltSurf, 1e-12);
check.ok('and material at the CMB temperature meets it exactly at meltOnset',
	PHASE.solidus(P.meltOnset, 0, 0) === 1, 'Ts(' + P.meltOnset + ' km) = ' + PHASE.solidus(P.meltOnset, 0, 0));
check.ok('the deep curve keeps the calibrated margin over the CMB temperature',
	PHASE.solidus(P.depth, 0, 0) > 1 + 0.9 * P.meltSup && PHASE.solidus(P.depth, 0, 0) < 1 + P.meltSup,
	'Ts(depth) ' + PHASE.solidus(P.depth, 0, 0).toFixed(5) + '  margin ' + P.meltSup);
// Above the surface there is no pressure column, so the curve is flat there: an edifice's
// material is never *more* fusible than the surface's own rock, or a clast in flight would
// melt on the way up.
check.ok('above the surface the curve is flat', PHASE.solidus(-50, 0, 0) === PHASE.solidus(0, 0, 0)
	&& PHASE.liquidus(-50, 0, 0) === PHASE.liquidus(0, 0, 0), 'both read Ts(0) ' + PHASE.solidus(0, 0, 0));
// Monotone: one crossing per isotherm, so a parcel's melting window is a single depth
// interval and cold material sinking below the window can never melt on the way.
prev = -1e9;
var mono = true, biggest = 0;
for (i = 0; i <= 400; i++) {
	y = i / 400 * P.depth;
	ts = PHASE.solidus(y, 0, 0);
	if (ts < prev) mono = false;
	if (ts - prev > biggest) biggest = ts - prev;
	prev = ts;
}
check.ok('the curve is monotone in depth (one melting window per parcel)', mono,
	'largest step ' + biggest.toExponential(2));
check.near('the liquidus is the solidus plus the mush gap, everywhere',
	PHASE.liquidus(300, 0, 0) - PHASE.solidus(300, 0, 0), P.meltGap, 1e-12);
for (i = 1; i < 4; i++) {
	var cF = 0.1 * i, cW = 0.001 * i;
	check.near('cF ' + cF.toFixed(2) + ', cW ' + cW.toFixed(3) + ': the solidus drops by meltWF*cF + meltWW*cW',
		PHASE.solidus(400, cF, cW), PHASE.solidus(400, 0, 0) - P.meltWF * cF - P.meltWW * cW, 1e-12);
	check.near('   and the mushy interval is unchanged',
		PHASE.liquidus(400, cF, cW) - PHASE.solidus(400, cF, cW), P.meltGap, 1e-12);
}
check.ok('water is the potent flux by orders of magnitude per unit mass', P.meltWW > 50 * P.meltWF,
	'per unit mass: water moves Ts ' + (P.meltWW / P.meltWF).toFixed(0) + 'x as far as felsic material');
check.info('curve', 'Ts(0) ' + P.meltSurf + '   Ts(' + P.meltOnset + ' km) 1.0   Ts(' + P.depth + ' km) '
	+ PHASE.solidus(P.depth, 0, 0).toFixed(5) + '   gap ' + P.meltGap + '   L ' + P.meltLat);

// ---------------------------------------------------------------- 2. the mapping
check.section('heating, partial melt, full melt and freezing');
var y0 = 0, yM = 300, yD = P.depth, worstRel = 0, worstXi = 0, n = 0;
for (i = 0; i < 50000; i++) {
	y = P.depth * ((i * 7919) % 1000) / 1000;
	var cF2 = ((i * 31) % 7) * 0.05, cW2 = ((i * 17) % 5) * 0.0005;
	H = 0.3 + 1.1 * ((i * 104729) % 1000) / 1000;
	o = PHASE.byH(H, y, cF2, cW2);
	var t2 = o.t, x2 = o.melt;
	o = PHASE.byT(t2, y, cF2, cW2);
	if (rel(o.h, H) > worstRel) worstRel = rel(o.h, H);
	if (Math.abs(o.melt - x2) > worstXi) worstXi = Math.abs(o.melt - x2);
	n++;
}
// the two directions read the same state to round-off, not bitwise: each branch is its own
// affine form, so the last ulp of xi differs (the melt totals the fixtures gate are sums of
// m*xi, where that ulp is far below the closure tolerance)
check.ok('byH and byT invert each other over the state space (' + n + ' samples)',
	worstRel < 1e-12 && worstXi < 1e-12,
	'worst relative H round trip ' + worstRel.toExponential(2) + '   worst |dxi| ' + worstXi.toExponential(2));
// the heating path at three depths: solid, then mushy, then fully molten
function scan(H0, H1, len, yy) {
	var a = [], j, h, sp;
	for (j = 0; j <= len; j++) {
		h = H0 + (H1 - H0) * j / len;
		sp = PHASE.byH(h, yy, 0, 0);
		a.push({ h: h, t: sp.t, m: sp.melt });
	}
	return a;
}
[['the surface', y0], ['300 km', yM], ['the CMB', yD]].forEach(function (site) {
	var yy = site[1], tsS = PHASE.solidus(yy, 0, 0);
	var s = scan(tsS - 0.2, tsS + P.meltGap + P.meltLat + 0.2, 400, yy);
	var solid = -1, part = -1, full = -1, ordered = true, j, cp = 0;
	for (j = 1; j < s.length; j++) {
		if (s[j].t < s[j - 1].t || s[j].m < s[j - 1].m) ordered = false;
		if (s[j].m === 0) solid = j;
		if (s[j].m > 0 && s[j].m < 1) { if (part < 0) part = j; cp = Math.max(cp, (s[j].h - s[j - 1].h) / (s[j].t - s[j - 1].t)); }
		if (s[j].m === 1 && full < 0) full = j;
	}
	check.ok(site[0] + ': heating runs solid -> partial -> full melt',
		solid >= 0 && part > solid && full > part && ordered,
		'solid to ' + s[Math.max(solid, 0)].h.toFixed(3) + ', mushy ' + s[Math.max(part, 0)].h.toFixed(3)
		+ ' to ' + s[Math.max(full, 0)].h.toFixed(3) + ', molten above ' + s[Math.min(full + 1, s.length - 1)].h.toFixed(3));
	check.ok(site[0] + ': temperature and melt fraction both rise with H', ordered,
		'T ' + s[0].t.toFixed(3) + ' -> ' + s[s.length - 1].t.toFixed(3) + ' over H +'
		+ (s[s.length - 1].h - s[0].h).toFixed(2));
	check.near(site[0] + ': crossing the mush costs (1 + L/gap) times the heat per kelvin',
		cp, 1 + P.meltLat / P.meltGap, 1e-6);
	// state is a function of H alone: cooling back down the same list reproduces every reading
	var again = scan(s[0].h, s[s.length - 1].h, 400, yy), same = true;
	for (j = 0; j < again.length; j++) if (again[j].t !== s[j].t || again[j].m !== s[j].m) same = false;
	check.ok(site[0] + ': the same H always reads the same state, heating or cooling', same, '');
});
var tsM = PHASE.solidus(yM, 0, 0);
check.ok('at exactly H = Ts the parcel is solid and T is that H', (function () {
	o = PHASE.byH(tsM, yM, 0, 0); return o.melt === 0 && o.t === tsM;
}()), 'Ts(300 km) ' + tsM.toFixed(5));
o = PHASE.byH(tsM + 1e-9, yM, 0, 0);
check.ok('one step above the solidus it is just barely mushy', o.melt > 0 && o.melt < 1e-8, 'xi ' + o.melt.toExponential(2));
o = PHASE.byH(tsM + P.meltGap + P.meltLat, yM, 0, 0);
check.ok('at H = Ts + gap + L the parcel is molten', o.melt > 1 - 1e-15 && Math.abs(o.t - (tsM + P.meltGap)) < 1e-15,
	'xi ' + o.melt.toFixed(16) + '   T ' + o.t.toFixed(6) + '   Ts + gap ' + (tsM + P.meltGap).toFixed(6));
H = tsM + 0.5 * (P.meltGap + P.meltLat);
o = PHASE.byH(H, yM, 0, 0);
check.near('half-way through the mush reads xi = 1/2', o.melt, 0.5, 1e-12);
check.near('   and the sensible reading is H minus the latent part', o.t, H - P.meltLat * 0.5, 1e-15);

// ---------------------------------------------------------------- 3. the pool pass
check.section('the pool pass writes T and melt out of H, and books the sensible part');
configure('rb', [256, 24], 0);
var mass = new Float64Array(S.n), hsav = new Float64Array(S.n), told = new Float64Array(S.n);
function pattern(p) { return 0.35 + 0.95 * ((p * 104729) % 1000) / 1000; }
for (i = 0; i < S.n; i++) {
	S.H[i] = pattern(i);
	S.cF[i] = ((i * 13) % 5) * 0.08;
	S.cW[i] = ((i * 7) % 3) * 0.001;
	S.melt[i] = 0;
	mass[i] = S.m[i]; hsav[i] = S.H[i]; told[i] = S.T[i];
}
S.ledger = 0;
PHASE.equil(M, S);
var worstT = 0, worstM = 0, dH = 0, dM = 0, book = 0, grid = 0;
for (i = 0; i < S.n; i++) {
	o = PHASE.byH(hsav[i], S.y[i], S.cF[i], S.cW[i]);
	if (Math.abs(S.T[i] - o.t) > worstT) worstT = Math.abs(S.T[i] - o.t);
	if (Math.abs(S.melt[i] - o.melt) > worstM) worstM = Math.abs(S.melt[i] - o.melt);
	if (S.H[i] !== hsav[i]) dH++;
	if (S.m[i] !== mass[i]) dM++;
	if (P.PH_GRID[S.ph[i]]) { book += S.m[i] * (S.T[i] - told[i]); grid++; }
}
check.ok('every parcel reads exactly the state its H implies', worstT === 0 && worstM === 0,
	'worst |dT| ' + worstT.toExponential(2) + '   worst |dxi| ' + worstM.toExponential(2));
check.ok('the pass changes no parcel enthalpy and no parcel mass', dH === 0 && dM === 0,
	'enthalpy ' + dH + '   mass ' + dM + ' of ' + S.n);
check.ok('and books exactly the temperature change it read', S.ledger === book,
	S.ledger.toExponential(6) + ' over ' + grid + ' coupled parcels');
// melt is not a free field: overwrite the whole field and the next pass restores it from H
var sumM0 = 0, stale = 0, same = 0, sumM1 = 0;
for (i = 0; i < S.n; i++) { sumM0 += S.m[i] * S.melt[i]; S.melt[i] = S.melt[i] > 0 ? 0 : 0.5; stale++; }
PHASE.equil(M, S);
for (i = 0; i < S.n; i++) {
	o = PHASE.byH(S.H[i], S.y[i], S.cF[i], S.cW[i]);
	sumM1 += S.m[i] * S.melt[i];
	if (S.melt[i] === o.melt && S.T[i] === o.t) same++;
}
check.ok('a stale melt field is restored from H by the next pass (' + stale + ' parcels overwritten)',
	same === S.n, same + ' of ' + S.n + ' parcels');
check.ok('and the melt inventory is unchanged by the round trip', sumM1 === sumM0,
	sumM0.toExponential(6) + ' vs ' + sumM1.toExponential(6));

// ---------------------------------------------------------------- 4. the kernel wiring
check.section('G3 delivers to H, G4 maps it back');
var kFlow = SIM.k[2], kMove = SIM.k[3], kPhase = SIM.k[4], kMelt = SIM.k[5];
// (a) conduction alone, no flow: every increment is enthalpy, and the books must account for it
configure('rb', [256, 24], 0);
SIM.k[2] = null;
SIM.k[3] = function (MM, SS, dt) {
	G.diffuse(MM, SS.Tg, dt, P.kappa, MM.inc);
	G.gatherDT(MM, SS, MM.inc, SS.Tg, P.flip);
	PHASE.equil(MM, SS);
};
SIM.reset();
SIM.run(1);
var wall0 = S.wall, hl0 = S.hLedger, sens0 = S.ledger, ih0 = invH(), l0 = S.invLTot;
SIM.run(500);
var ih1 = invH();
check.ok('the marker enthalpy changed by exactly the booked intake',
	Math.abs((ih1 - ih0) - (S.hLedger - hl0)) < 1e-9 * Math.abs(ih1), 'dH ' + (ih1 - ih0).toExponential(4)
	+ '   hLedger ' + (S.hLedger - hl0).toExponential(4));
check.near('the booked intake is the operator\'s own wall flux', S.hLedger - hl0, S.wall - wall0, 1e-5, 'km2*H');
check.ok('the sensible book and the enthalpy book differ by exactly the latent heat the melt stores',
	Math.abs((S.hLedger - hl0) - (S.ledger - sens0) - P.meltLat * (S.invLTot - l0)) < 1e-9 * Math.abs(ih1),
	'enthalpy ' + (S.hLedger - hl0).toExponential(3) + '   sensible ' + (S.ledger - sens0).toExponential(3)
	+ '   latent ' + (P.meltLat * (S.invLTot - l0)).toExponential(3));
check.info('conduction only', 'H_total moved ' + (ih1 - ih0).toExponential(3) + ' of ' + ih1.toExponential(3)
	+ ' (' + ((ih1 - ih0) / ih1 * 100).toFixed(4) + '%)   latent share of the intake '
	+ (P.meltLat * (S.invLTot - l0) / (S.hLedger - hl0) * 100).toFixed(3) + '%');
SIM.k[2] = kFlow; SIM.k[3] = kMove;

// (a2) the x direction is the one with no wall at all -- it wraps -- so there the operator is
// a pure redistribution: every row of its Laplacian sums to zero (nothing is created across
// the wrap) and each row's second moment falls by exactly that row's discrete Dirichlet
// energy (S f * lap f = -(S (df)^2)/dx^2 for a periodic row). The eta direction is the one
// with walls, and (a) gates it: what enters through them is the wall book.
configure('rb', [256, 24], 0);
var M2 = SIM.M, nxs = M2.nx, nys = M2.ny, Tg2 = S.Tg, lx2 = M2.lx, inv2 = 1 / (M2.dx * M2.dx);
var jj, ii, ip, sSum, sDot, sGrad, worstSum = 0, worstId = 0, scale = 0, minGrad = Infinity;
for (jj = 1; jj < nys; jj++) for (ii = 0; ii < nxs; ii++) Tg2[jj * nxs + ii] = 0.15 + 0.7 * ((jj * nxs + ii) * 104729 % 1000) / 1000;
G.lapXX(M2, Tg2, lx2);
for (jj = 1; jj < nys; jj++) {
	sSum = 0; sDot = 0; sGrad = 0;
	for (ii = 0; ii < nxs; ii++) {
		ip = ii + 1 === nxs ? 0 : ii + 1;
		sSum += lx2[jj * nxs + ii];
		sDot += Tg2[jj * nxs + ii] * lx2[jj * nxs + ii];
		sGrad += (Tg2[jj * nxs + ip] - Tg2[jj * nxs + ii]) * (Tg2[jj * nxs + ip] - Tg2[jj * nxs + ii]) * inv2;
		if (Math.abs(lx2[jj * nxs + ii]) > scale) scale = Math.abs(lx2[jj * nxs + ii]);
	}
	if (Math.abs(sSum) > worstSum) worstSum = Math.abs(sSum);
	if (rel(sDot, -sGrad) > worstId) worstId = rel(sDot, -sGrad);
	if (sGrad < minGrad) minGrad = sGrad;
}
check.ok('every row of the x operator sums to zero: the wrap creates nothing',
	worstSum < 1e-12 * scale, 'worst row sum ' + worstSum.toExponential(2) + '   scale ' + scale.toExponential(2));
check.ok('and each row\'s second moment falls by exactly its Dirichlet energy',
	worstId < 1e-12 && minGrad > 0, 'worst rel ' + worstId.toExponential(2)
	+ '   smallest row energy ' + minGrad.toExponential(2));

// (b) a permuted pool: enthalpy moved between two parcels is redistributed, never created
configure('rb', [256, 24], 0);
var perRow = M.nx * P.mpc, q1 = 4 * perRow + 10, q2 = 20 * perRow + 10;
S.m[q1] = 1; S.m[q2] = 1;                          // one sum, two equal terms: a permutation
S.H[q1] = 0.5; S.H[q2] = 1;
var tot0 = invH(), hSwap = S.H[q1];
check.ok('a cold shallow parcel and a hot deep one', S.y[q1] < S.y[q2]
	&& PHASE.byH(S.H[q1], S.y[q1], 0, 0).melt === 0 && PHASE.byH(S.H[q2], S.y[q2], 0, 0).melt === 0,
	'y ' + S.y[q1].toFixed(0) + '/' + S.y[q2].toFixed(0) + ' km');
S.H[q1] = S.H[q2]; S.H[q2] = hSwap;
check.ok('permuting enthalpy between them leaves the total bitwise unchanged', invH() === tot0, tot0.toExponential(17));
SIM.k[2] = null; SIM.k[3] = null;
PHASE.equil(M, S);
check.ok('the phase pass reads the new state without moving the total', invH() === tot0, '');
o = PHASE.byH(S.H[q1], S.y[q1], 0, 0);
check.ok('and the deep parcel\'s heat sitting shallow is now mush', S.melt[q1] > 0 && S.melt[q1] === o.melt,
	'xi ' + S.melt[q1].toFixed(4) + ' at ' + S.y[q1].toFixed(0) + ' km, from ' + S.y[q2].toFixed(0) + ' km');
SIM.k[2] = kFlow; SIM.k[3] = kMove;

// (c) with flow, conduction and segregation disabled the mapping is idempotent (the gate is
// the P3.1 mapping's own; P3.2's split moves m and H between parcels by design and is
// gated as its own transaction in pt-p3-melt.js). P4.3's surface law is a third mover in
// this configuration -- it weathers the top of the column into sediment, and P3.4's flight
// cooling then takes that sediment's heat -- so it runs off here, as the P4 owners run it,
// and (c2) measures what it moves and whether the movement is booked.
configure('cool', [256, 24], 0);
SIM.k[2] = null; SIM.k[3] = null; SIM.k[5] = null; P.ero = false;
SIM.run(1);
var hs = new Float64Array(S.n), ms = new Float64Array(S.n);
var ts0 = new Float64Array(S.n), xs = new Float64Array(S.n), hMove = 0, readMoved = 0;
for (i = 0; i < S.n; i++) { hs[i] = S.H[i]; ms[i] = S.m[i]; ts0[i] = S.T[i]; xs[i] = S.melt[i]; }
SIM.run(100);
for (i = 0; i < S.n; i++) {
	if (S.H[i] !== hs[i] || S.m[i] !== ms[i]) hMove++;
	if (S.T[i] !== ts0[i] || S.melt[i] !== xs[i]) readMoved++;
	o = PHASE.byH(S.H[i], S.y[i], S.cF[i], S.cW[i]);
	if (S.T[i] !== o.t || S.melt[i] !== o.melt) readMoved += 1000000;
}
check.ok('100 frames with the flow and the conduction off leave every parcel\'s H and m alone',
	hMove === 0, hMove + ' of ' + S.n + ' moved');
check.ok('and leave every parcel\'s equilibrium reading of it exactly where it was',
	readMoved === 0, readMoved + ' of ' + S.n + ' changed');
SIM.k[2] = kFlow; SIM.k[3] = kMove; SIM.k[5] = kMelt; P.ero = true;

// (c2) the same 100 quiescent frames with the surface law on. It and the flight cooling it
// feeds are the only passes left that move anything, so this is where their books are read
// without the flow to hide behind: everything that moves is inside the weathering band, the
// mass stays inside the parcels, and the heat the sediment loses is the heat the cooling
// booked. (The erosion's own law is pt-p4-erosion.js's subject; this is what it does to the
// enthalpy book the rest of this harness is about.)
configure('cool', [256, 24], 0);
SIM.k[2] = null; SIM.k[3] = null; SIM.k[5] = null;
SIM.run(1);
var mTot = 0, hTot = invH(), led0 = S.hLedger, ero0 = S.thr.eroCr + S.thr.eroDep;
var nQ = S.n, cMove = 0, cH = 0, cDeep = 0, cMan = 0, cDep = 0;
for (i = 0; i < S.n; i++) mTot += S.m[i];
hs = new Float64Array(S.n); ms = new Float64Array(S.n);
for (i = 0; i < S.n; i++) { hs[i] = S.H[i]; ms[i] = S.m[i]; }
SIM.run(100);
for (i = 0; i < nQ; i++) {
	if (S.m[i] !== ms[i]) cMove++;
	if (S.H[i] !== hs[i]) cH++;
	if (S.m[i] !== ms[i] || S.H[i] !== hs[i]) {
		if (S.y[i] > P.eroBand) cDeep++;
		if (S.ph[i] === P.PH.dep) cDep++; else if (S.ph[i] === P.PH.mantle) cMan++;
	}
}
var mTot1 = 0, dHQ = invH() - hTot, dLed = S.hLedger - led0;
for (i = 0; i < S.n; i++) mTot1 += S.m[i];
check.ok('with the surface law on, everything that moves is inside the weathering band',
	cDeep === 0 && cMove > 0 && S.thr.eroCr + S.thr.eroDep > ero0,
	cMove + ' of ' + nQ + ' parcels moved (' + cMan + ' mantle weathered, ' + cDep
	+ ' sediment carried and ' + cH + ' of those cooled), none below ' + P.eroBand + ' km, '
	+ (S.thr.eroCr + S.thr.eroDep - ero0).toFixed(3) + ' km2 weathered, ' + (S.n - nQ)
	+ ' parcels added by the carries');
check.ok('the mass it moves stays inside the parcels: weathering is a carry, not a source',
	rel(mTot1, mTot) < 1e-12, 'residual ' + rel(mTot1, mTot).toExponential(2) + ' of '
	+ mTot.toFixed(3) + ' km2');
check.ok('and the heat the sediment loses is the heat the flight cooling booked',
	cH > 0 && Math.abs(dHQ - dLed) < 1e-12 * Math.abs(hTot),
	'dH ' + dHQ.toExponential(6) + ' km2*H against the booked ' + dLed.toExponential(6)
	+ ', residual ' + Math.abs(dHQ - dLed).toExponential(2) + ' = '
	+ (Math.abs(dHQ - dLed) / Math.abs(hTot)).toExponential(2) + ' of the '
	+ hTot.toExponential(3) + ' inventory, which is the resolution the sum has left at this '
	+ 'book\'s size (' + (Math.abs(dHQ - dLed) / Math.abs(dLed)).toExponential(2)
	+ ' of the book itself)');
SIM.k[2] = kFlow; SIM.k[3] = kMove; SIM.k[5] = kMelt;

// (d) the reset seeds a state the very first phase pass cannot change
configure('cool', [256, 24], 0);
var icBad = 0, icMelt = 0, icMass = 0, icDeep = 0, icMax = 0, icDT = 0, icDX = 0;
for (i = 0; i < S.n; i++) {
	o = PHASE.byH(S.H[i], S.y[i], 0, 0);
	if (rel(o.t, S.T[i]) > 1e-12 || Math.abs(o.melt - S.melt[i]) > 1e-12) icBad++;
	if (Math.abs(o.t - S.T[i]) > icDT) icDT = Math.abs(o.t - S.T[i]);
	if (Math.abs(o.melt - S.melt[i]) > icDX) icDX = Math.abs(o.melt - S.melt[i]);
	icMelt += S.m[i] * S.melt[i]; icMass += S.m[i];
	if (S.melt[i] > 0) { if (S.y[i] > icDeep) icDeep = S.y[i]; if (S.melt[i] > icMax) icMax = S.melt[i]; }
}
check.ok('the shipped initial condition is already the equilibrium state of its own H', icBad === 0,
	icBad + ' of ' + S.n + ' disagree   worst |dT| ' + icDT.toExponential(2)
	+ '   worst |dxi| ' + icDX.toExponential(2));
check.ok('the shipped start is mushy in the shallow mantle, not everywhere',
	icMelt > 0 && icMelt / icMass < 0.05 && icDeep < 0.35 * P.depth, 'xi mass ' + (icMelt / icMass * 100).toFixed(3)
	+ '%   deepest ' + icDeep.toFixed(0) + ' km   max xi ' + icMax.toFixed(3));
check.info('t = 0', 'H_total ' + invH().toExponential(4) + ' km2*H   latent stock '
	+ (P.meltLat * S.invLTot).toExponential(3) + ' km2*H');

// ---------------------------------------------------------------- 5. the live run
check.section('the live run (the shipped pipeline, 150 Myr)');
configure('cool', [256, 24], 0);
SIM.k[2] = kFlow; SIM.k[3] = kMove; SIM.k[4] = kPhase;
SIM.reset();
SIM.dt = 0.05;
var live0 = invH(), lat0 = S.invL0, peak = 0, deepWorst = 0, nan = 0, lo = 9e9, hi = -9e9, gLo = 9e9, gHi = 0, meltEnd = 0;
for (k = 1; k <= 6; k++) {
	SIM.run(500);
	PTPOOL.inventory(S);
	var deep = 0, meltW = 0, mAll = 0, yW = 0, maxXi = 0;
	for (i = 0; i < S.n; i++) {
		if (!isFinite(S.H[i]) || !isFinite(S.T[i]) || !isFinite(S.melt[i])) nan++;
		mAll += S.m[i];
		meltW += S.m[i] * S.melt[i];
		if (S.melt[i] > 0) {
			yW += S.m[i] * S.melt[i] * S.y[i];
			if (S.y[i] > deep) deep = S.y[i];
		}
		if (S.melt[i] > maxXi) maxXi = S.melt[i];
	}
	// the melt the planet carries is the parcels' plus the intrusive store's: P3.2 moves
	// part of the stock into chambers, and a census that ignored them would see the planet
	// lose melt that is sitting right under the lid. The depth census stays on the parcels
	// -- a chamber record has no marker to sample.
	var storeL = 0, storeM = 0, meltWp = meltW;
	for (i = 0; i < S.chN; i++) { storeL += S.chL[i]; storeM += S.chM[i]; }
	meltW += storeL; mAll += storeM;
	if (S.d.tMin < lo) lo = S.d.tMin;
	if (S.d.tMax > hi) hi = S.d.tMax;
	if (deep > deepWorst) deepWorst = deep;
	if (meltW / mAll > peak) peak = meltW / mAll;
	if (S.hLedger / S.wall < gLo) gLo = S.hLedger / S.wall;
	if (S.hLedger / S.wall > gHi) gHi = S.hLedger / S.wall;
	meltEnd = meltW / mAll;
	check.info('t ' + SIM.t.toFixed(0) + ' Myr', 'melt ' + (meltEnd * 100).toFixed(3) + '% of mass (store '
		+ (storeL / (mAll || 1) * 100).toFixed(3) + '%)   max xi '
		+ maxXi.toFixed(3) + '   deepest ' + deep.toFixed(0) + ' km   mean depth '
		+ (meltWp > 0 ? (yW / meltWp).toFixed(0) : '0') + ' km   lid ' + (S.d.lid * 100).toFixed(0)
		+ '%   Nu ' + S.d.nu.toFixed(1));
}
check.ok('150 Myr of the shipped planet carry real melt', meltEnd > 0.005, 'peak ' + (peak * 100).toFixed(3) + '% of mass');
check.ok('the melt stays in the shallow window, never the deep mantle', deepWorst < 1200,
	'deepest melting parcel ' + deepWorst.toFixed(0) + ' km of ' + P.depth);
check.ok('and stays a mush zone, not a magma ocean', peak < 0.10, 'peak ' + (peak * 100).toFixed(3) + '% of mass');
check.ok('no NaN in 150 Myr', nan === 0, nan + ' of ' + S.n);
check.ok('the field stays in range', lo > -0.5 && hi < 1.5, 'T ' + lo.toFixed(3) + '..' + hi.toFixed(3));
check.ok('the marker enthalpy still closes against the booked intake',
	Math.abs((invH() - live0) - S.hLedger) < 1e-9 * Math.abs(S.invHTot), 'dH ' + (invH() - live0).toExponential(4)
	+ '   hLedger ' + S.hLedger.toExponential(4));
check.ok('which closes against the operator\'s wall flux', gLo > 0.8 && gHi < 1.2,
	'intake/wall ' + gLo.toFixed(3) + '..' + gHi.toFixed(3));
check.ok('and the sensible/latent split accounts for the whole intake',
	Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - lat0)) < 1e-9 * Math.abs(S.invHTot),
	'enthalpy ' + S.hLedger.toExponential(3) + '   sensible ' + S.ledger.toExponential(3) + '   latent '
	+ (P.meltLat * (S.invLTot - lat0)).toExponential(3));
check.info('the phase change over the run', 'latent stock ' + (P.meltLat * (S.invLTot - lat0)).toExponential(3)
	+ ' km2*H of ' + S.invHTot.toExponential(3) + ' km2*H of stored enthalpy');

// ---------------------------------------------------------------- 6. melt weakening
check.section('melt weakening at G4');
configure('rb', [256, 24], 0);
// Three parcels that differ in nothing but enthalpy and composition, all at the same depth,
// age and damage. A dry parcel cannot be mushy *and* hold a welding age -- Ts(0) is far above
// TSoft, so any melt resets the age before the strength law runs -- so the mechanism is
// measured where it bites: rock whose solidus water has pushed below TSoft.
function place(p, H, yy, cW) {
	S.x[p] = (p + 0.3) * M.dx; S.y[p] = yy; S.e[p] = Math.asinh(yy / M.yLin);
	S.m[p] = 1; S.vx[p] = 0; S.vy[p] = 0; S.age[p] = 100; S.dmg[p] = 0; S.mu[p] = 0; S.cl[p] = -1;
	S.ph[p] = P.PH.mantle; S.id[p] = p; S.cW[p] = cW; S.cF[p] = 0; S.H[p] = H;
	o = PHASE.byH(H, yy, 0, cW); S.T[p] = o.t; S.melt[p] = o.melt;
}
function smoothstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
function dryMu(T, age) { return (0.05 + 0.95 * (1 - smoothstep(P.muLo, P.muHi, T))) * (1 - Math.exp(-age / P.tauWeld)); }
var yW2 = 200, wet = 0.05, wetTs = PHASE.solidus(yW2, 0, wet);
check.ok('the shipped dry mantle cannot melt and hold a welding age at once',
	PHASE.solidus(0, 0, 0) > P.TSoft, 'Ts(0) ' + PHASE.solidus(0, 0, 0).toFixed(3) + ' vs TSoft ' + P.TSoft);
check.ok('while water pushes this parcel\'s solidus below it', wetTs < P.TSoft, 'Ts(200 km, cW ' + wet + ') '
	+ wetTs.toFixed(4));
S.n = 3; S.nSolid = 3;
place(0, wetTs - 0.1, yW2, 0);            // dry and solid: H is its own temperature
place(1, wetTs + 0.5 * (P.meltGap + P.meltLat), yW2, wet);   // half melted
place(2, wetTs + (P.meltGap + P.meltLat) + 0.1, yW2, wet);   // fully molten
var state = [S.melt[0], S.melt[1], S.melt[2]];
SIM.k[4](M, S, 1);                                   // G4 as wired: equilibrium, then the crust pass
check.ok('the fixture built xi = 0, 1/2 and 1', state[0] === 0 && state[1] === 0.5 && state[2] === 1, state.join('/'));
check.near('a solid parcel is exactly as strong as the P2.1 law says',
	S.mu[0], dryMu(S.T[0], 101), 1e-12);
check.near('a half-melted parcel keeps half its cohesion',
	S.mu[1], dryMu(S.T[1], 101) * (1 - state[1]), 1e-12);
check.ok('a fully molten parcel has no cohesion left', S.mu[2] === 0 && dryMu(S.T[2], 101) > 0,
	'mu ' + S.mu[2] + ' against ' + dryMu(S.T[2], 101).toFixed(4) + ' without the factor');
// the fraction is read from the enthalpy, so a stale melt value cannot leave a parcel weak
place(1, wetTs + 0.5 * (P.meltGap + P.meltLat), yW2, wet);
S.melt[1] = 0;                                       // a stale reading: H is what counts
S.n = 3;
SIM.k[4](M, S, 1);
check.ok('and a stale melt reading cannot fake a strong parcel', S.melt[1] === 0.5
	&& S.mu[1] < 0.6 * dryMu(S.T[1], 101), 'mu ' + S.mu[1].toFixed(4) + ' with xi ' + S.melt[1].toFixed(3)
	+ ' against ' + dryMu(S.T[1], 101).toFixed(4) + ' if the stale zero had counted');
// and dry, cold rock is untouched by the factor
S.n = 1; S.nSolid = 1;
place(0, 0.2, yW2, 0);
SIM.k[4](M, S, 1);
check.ok('cold dry rock keeps the P2.1 strength exactly', S.mu[0] === dryMu(0.2, 101), 'mu ' + S.mu[0].toFixed(6));

// one timing line: the pass's own cost, next to the whole-frame budget pt-check gates
configure('cool', [256, 24], 0);
var reps = 50, tt = Date.now();
for (i = 0; i < 5; i++) PHASE.equil(SIM.M, S);
tt = Date.now();
for (i = 0; i < reps; i++) PHASE.equil(SIM.M, S);
check.info('cost', S.n + ' parcels: ' + ((Date.now() - tt) / reps).toFixed(3) + ' ms per pass');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
