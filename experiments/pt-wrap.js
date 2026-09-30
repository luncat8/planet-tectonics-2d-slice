// pt-wrap.js — is the particle engine's x axis really periodic? A shift-equivariance gate.
//
// A periodic engine has no special column: translate the whole state by k cells, run it, and
// translate back -- the result must be the unshifted run. Anything that treats x = 0 or
// x = wrap as an edge (a clamped stencil, a non-wrapped cluster centroid, a seam in the FFT's
// spectral derivative, a split plate) breaks that identity at the seam and shows up here as a
// marker mismatch or a different plate count.
//
//   1. spin the shipped config ('cool', crust on) up to a state with several plates
//   2. run A: continue it for `frames`
//   3. run B: the same state shifted by k cells (markers moved, persistent grid fields rolled),
//      run for `frames`, shifted back
//   4. compare markers one by one (index-for-index: the marker set is a permutation-free SoA)
//   5. find a plate that straddles the seam and check it is one cluster, not two
//
// Integer-cell shifts only: the grid is not translation invariant under sub-cell shifts, and
// that is sampling, not a seam. The residue is float round-off (x + shift - wrap drops bits,
// the FFT sums in a different order) amplified by the flow over `frames`.
//
// Run: node experiments/pt-wrap.js [spinMyr=200] [frames=100] [shiftCells=97]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), R = require(B + 'render.js');

var spin = +(process.argv[2] || 200);
var frames = +(process.argv[3] || 100);
var shift = +(process.argv[4] || 97);

// the shipped draw, pinned (a fixture owns every parameter it measures)
P.ic = 'cool'; P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1; P.solid = true; P.sl.kyr = 50;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M, nx = M.nx, W = M.wrap;

console.log('  wrap: shift equivariance of the whole pipeline, ' + nx + 'x' + M.ny + ', wrap ' + W
	+ ' km, shift ' + shift + ' cells (' + (shift * M.dx).toFixed(1) + ' km)\n');

var t0 = Date.now();
while (SIM.t < spin) SIM.step();
console.log('  spin-up to ' + SIM.t.toFixed(1) + ' Myr: plates ' + S.d.plates + ', lid '
	+ (S.d.lid * 100).toFixed(0) + '%, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

// the persistent state: per-marker fields and the grid fields that survive a frame (Tg and
// mug are rebuilt by the transfer, but a paused diag reads them; Mg is carried by the melt
// indicator's semi-Lagrangian step)
var MK = ['x', 'y', 'e', 'T', 'm', 'vx', 'vy', 'age', 'mu', 'dmg'];
var GR = ['Tg', 'mug', 'Mg'];
function save() {
	var o = { n: S.n, t: SIM.t, frame: SIM.frame, ledger: S.ledger, wall: S.wall }, k;
	for (k = 0; k < MK.length; k++) o[MK[k]] = S[MK[k]].slice(0, S.n);
	for (k = 0; k < GR.length; k++) o[GR[k]] = S[GR[k]].slice();
	return o;
}
function load(o) {
	var k;
	S.n = o.n; SIM.t = o.t; SIM.frame = o.frame; S.ledger = o.ledger; S.wall = o.wall;
	for (k = 0; k < MK.length; k++) S[MK[k]].set(o[MK[k]]);
	for (k = 0; k < GR.length; k++) S[GR[k]].set(o[GR[k]]);
}
// translate the live state by `cells` columns: markers move, node rows roll
function translate(cells) {
	var d = cells * M.dx, p, k, j, i, a, tmp = new Float64Array(nx), s = ((cells % nx) + nx) % nx;
	for (p = 0; p < S.n; p++) {
		S.x[p] += d;
		S.x[p] -= Math.floor(S.x[p] / W) * W;
	}
	for (k = 0; k < GR.length; k++) {
		a = S[GR[k]];
		for (j = 0; j <= M.ny; j++) {
			for (i = 0; i < nx; i++) tmp[(i + s) % nx] = a[j * nx + i];
			a.set(tmp, j * nx);
		}
	}
}
function dxWrap(a, b) {
	var d = a - b;
	return d - Math.floor(d / W + 0.5) * W;
}

var base = save();

// run A
SIM.run(frames);
var A = save(), dA = { nu: S.d.nu, plates: S.d.plates, lid: S.d.lid, csN: S.csN, uMax: S.d.uMax, heat: S.d.heat };

// run B: the shifted twin
load(base);
translate(shift);
SIM.run(frames);
translate(-shift);
var Bs = save(), dB = { nu: S.d.nu, plates: S.d.plates, lid: S.d.lid, csN: S.csN, uMax: S.d.uMax, heat: S.d.heat };

// ---------------------------------------------------------------- 1. marker state
check.section('the shifted twin, shifted back, is the same run');
var dxMax = 0, deMax = 0, dTMax = 0, dMuMax = 0, dDmgMax = 0, p, v;
for (p = 0; p < A.n; p++) {
	v = Math.abs(dxWrap(A.x[p], Bs.x[p])); if (v > dxMax) dxMax = v;
	v = Math.abs(A.e[p] - Bs.e[p]); if (v > deMax) deMax = v;
	v = Math.abs(A.T[p] - Bs.T[p]); if (v > dTMax) dTMax = v;
	v = Math.abs(A.mu[p] - Bs.mu[p]); if (v > dMuMax) dMuMax = v;
	v = Math.abs(A.dmg[p] - Bs.dmg[p]); if (v > dDmgMax) dDmgMax = v;
}
// tolerances are round-off amplified by the flow over the run: a seam bug moves markers by a
// fraction of a cell (tens of km) and flips plate memberships, round-off moves them by
// micrometres
check.ok('every marker ends at the same x (folded)', dxMax < 1e-3 * M.dx, 'max ' + dxMax.toExponential(2) + ' km');
check.ok('every marker ends at the same depth', deMax < 1e-6, 'max d(eta) ' + deMax.toExponential(2));
check.ok('every marker carries the same T', dTMax < 1e-6, 'max ' + dTMax.toExponential(2));
check.ok('every marker has the same strength', dMuMax < 1e-6, 'max ' + dMuMax.toExponential(2));
check.ok('every marker has the same damage', dDmgMax < 1e-6, 'max ' + dDmgMax.toExponential(2));

check.section('the diagnostics do not see the shift');
check.near('same Nusselt number', dB.nu, dA.nu, 1e-9);
check.near('same peak speed', dB.uMax, dA.uMax, 1e-9);
check.near('same field heat', dB.heat, dA.heat, 1e-9);
check.ok('same cluster count', dB.csN === dA.csN, 'A ' + dA.csN + '  B ' + dB.csN);
check.ok('same plate count', dB.plates === dA.plates, 'A ' + dA.plates + '  B ' + dB.plates);
check.near('same lid fraction', dB.lid, dA.lid, 1e-12);
check.near('same heat ledger', Bs.ledger, A.ledger, 1e-9);

// ---------------------------------------------------------------- 2. a plate across the seam
// Find the shift that puts the seam through the middle of the biggest plate, run a frame, and
// check its markers on both sides of x = 0 carry one cluster id.
check.section('a plate across the seam is one plate');
load(A);
SIM.run(1);
var cl = S.cl, big = -1, cnt = new Int32Array(S.csN), c;
for (p = 0; p < S.n; p++) if (cl[p] >= 0) cnt[cl[p]]++;
for (c = 0; c < S.csN; c++) if (big < 0 || cnt[c] > cnt[big]) big = c;
// the plate's centre: the circular mean of its members' x
var sx = 0, sy = 0, a;
for (p = 0; p < S.n; p++) if (cl[p] === big) { a = 2 * Math.PI * S.x[p] / W; sx += Math.cos(a); sy += Math.sin(a); }
var xc = (Math.atan2(sy, sx) / (2 * Math.PI) * W + W) % W;
var toSeam = Math.round((W - xc) / M.dx);
var before = cnt[big];
translate(toSeam);
SIM.run(1);
var left = 0, right = 0, ids = {}, nIds = 0;
for (p = 0; p < S.n; p++) {
	if (S.cl[p] < 0 || S.mu[p] < P.clusterMin) continue;
	if (Math.abs(dxWrap(S.x[p], 0)) > 4 * M.dx || S.y[p] > 60) continue;
	if (S.x[p] < W / 2) left++; else right++;
	if (!ids[S.cl[p]]) { ids[S.cl[p]] = 1; nIds++; }
}
check.info('biggest plate', cnt[big] + ' markers, centred at ' + xc.toFixed(0) + ' km, moved by ' + toSeam + ' cells');
check.ok('the seam cuts through it (plate markers on both sides of x = 0)', left > 20 && right > 20, 'left ' + left + '  right ' + right);
check.ok('and the markers at the seam carry one cluster id', nIds === 1, nIds + ' ids');
var cnt2 = new Int32Array(S.csN), best = 0;
for (p = 0; p < S.n; p++) if (S.cl[p] >= 0) cnt2[S.cl[p]]++;
for (c = 0; c < S.csN; c++) if (cnt2[c] > best) best = cnt2[c];
check.ok('the biggest plate is still whole after sitting on the seam', Math.abs(best - before) <= 0.02 * before,
	'before ' + before + '  on the seam ' + best);

// ---------------------------------------------------------------- 3. the view wraps too
// The raster samples the field modulo wrap; the marker stipple and the camera must agree, or
// a view panned across x = 0 shows the field on both sides and markers on one.
check.section('the view wraps: a camera centred on the seam draws both sides');
var w = 640, h = 280, lit = [0, 0], q;
R.initHeadless(w, h, M);
R.preset('mantle', M);
P.view.cx = 0; R.build(M);
R.px.fill(0);
R.stipple(M, S, R.px, w, h);
for (q = 0; q < w * h; q++) if (R.px[q]) lit[(q % w) < w / 2 ? 0 : 1]++;
check.ok('markers are drawn left and right of the seam', lit[0] > 0.3 * lit[1] && lit[1] > 0.3 * lit[0],
	'left ' + lit[0] + '  right ' + lit[1]);
R.panBy(-3 * W / P.view.kx, 0, M);          // three full turns to the east
check.ok('panning round the planet keeps the camera in [0, wrap)', P.view.cx >= 0 && P.view.cx < W,
	'cx ' + P.view.cx.toFixed(3) + ' km');
R.zoomAt(w / 2, h / 2, 50, M);
check.ok('zooming out stops at one period across', Math.abs(P.view.kx * w - W) < 1e-6 * W,
	(P.view.kx * w).toFixed(0) + ' km across');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
