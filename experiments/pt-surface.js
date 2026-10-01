// pt-surface.js — P2.3: the surface elevation profile `S.zh[i]`, gated in the engine.
//
// The flat `eta = 0` top of the Stokes domain carries a separate periodic horizon. This
// fixture checks the independent target law (thermal/dynamic relief, filtered lid and rift
// proxies, convergent-plate uplift), zero-mean conservation, collision geometry, erosion,
// live swells and trenches, ridge push, the terrain warp, and the no-allocation budget.
// Collision uplift is a proxy from plate-cluster velocities; it is not a contact or crust
// composition model. Its role here is to build broad relief, while nonlinear diffusion rounds
// the high-gradient part of the profile.
//
// Run: node experiments/pt-surface.js [spinMyr=250] > experiments/logs/0.3.0-p2.3b-surface.txt
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), F = require(B + 'fluid.js'), SC = require(B + 'solid.js');
var R = require(B + 'render.js');

var spin = +(process.argv[2] || 250);

console.log('  surface: P2.3 relief, mesh ' + P.mesh.nx + 'x' + P.mesh.ny + ', wrap ' + P.wrap + ' km'
	+ '\n    iso ' + P.kIso + ' / ' + P.yIso + ' km, dyn ' + P.kDyn + ', lid/rift '
	+ P.kLid + '/' + P.kRift + ', crust/orogen depth ' + P.yCrust + '/' + P.yOrogen + ' km'
	+ '\n    collision ' + P.kOrogen + ' km Myr, yield ' + P.collisionYield + ' /Myr, cap '
	+ P.zOrogenMax + ' km, flex ' + P.lFlex + ', relax ' + P.tauSurf + ' Myr'
	+ '\n    erosion ' + P.kErode + ' km2/Myr, slope scale ' + P.slopeErode + '\n');

P.ic = 'cool'; P.sl.kyr = 50; P.solid = true; P.seed = 1;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M, nx = M.nx, ny = M.ny;
var erosionK = P.kErode, surfaceTau = P.tauSurf, lidScale = P.kLid, riftScale = P.kRift;
P.kErode = 0;

// ---------------------------------------------------------------- the independent target law
// The kernel's target is spelled here without calling F.surface: linear particle-to-column
// deposition, shallowest strong-marker plate identity, convergence uplift, the thermal and
// dynamic terms, then the periodic flexural filter. Erosion is disabled for these target-law
// fixtures and checked separately as an evolution step.
function flex(M, a, tmp) {
	var nx = M.nx, i, s, im, ip;
	for (s = 0; s < P.lFlex; s++) {
		for (i = 0; i < nx; i++) {
			im = i === 0 ? nx - 1 : i - 1; ip = i + 1 === nx ? 0 : i + 1;
			tmp[i] = 0.25 * a[im] + 0.5 * a[i] + 0.25 * a[ip];
		}
		a.set(tmp);
	}
}
var jIso = S.jIso, i, j, p, q;
function profile(M, S, out) {
	var nx = M.nx, Tg = S.Tg, u = S.u, hLid = S.hLid, rft = S.rft, colM = S.colM;
	var sy = new Float64Array(nx), sv = new Float64Array(nx), sc = new Int32Array(nx);
	var i, j, p, base, y, x, fx, w0, w1, m, sum, k, im, ip;
	var zt = S.zSmooth, tmp = new Float64Array(nx);
	for (i = 0; i < nx; i++) {
		hLid[i] = 0; rft[i] = 0; colM[i] = 0; out[i] = 0;
		sy[i] = 1e9; sv[i] = 0; sc[i] = -1;
	}
	for (p = 0; p < S.n; p++) {
		y = S.y[p];
		if (y > P.yCrust) continue;
		x = S.x[p] / M.dx; i = Math.floor(x); fx = x - i;
		i -= Math.floor(i / nx) * nx; ip = i + 1 === nx ? 0 : i + 1;
		w0 = 1 - fx; w1 = fx; m = S.m[p];
		hLid[i] += m * S.mu[p] * w0; hLid[ip] += m * S.mu[p] * w1;
		rft[i] += m * S.dmg[p] * w0; rft[ip] += m * S.dmg[p] * w1;
		colM[i] += m * w0; colM[ip] += m * w1;
		if (y > P.yOrogen || S.cl[p] < 0 || S.mu[p] < P.clusterMin) continue;
		i = Math.round(x); i -= Math.floor(i / nx) * nx;
		if (y >= sy[i]) continue;
		sy[i] = y; sv[i] = S.vx[p]; sc[i] = S.cl[p];
	}
	for (i = 0; i < nx; i++) {
		hLid[i] /= M.dx;
		if (colM[i] > 0) rft[i] /= colM[i];
	}
	for (i = 0; i < nx; i++) {
		ip = i + 1 === nx ? 0 : i + 1;
		if (sc[i] < 0 || sc[ip] < 0 || sc[i] === sc[ip]) continue;
		k = (sv[i] - sv[ip]) / M.dx - P.collisionYield;
		if (k <= 0) continue;
		k *= P.kOrogen;
		if (k > P.zOrogenMax) k = P.zOrogenMax;
		out[i] += 0.5 * k; out[ip] += 0.5 * k;
	}
	flex(M, out, tmp);
	flex(M, hLid, tmp);
	flex(M, rft, tmp);
	for (i = 0; i < nx; i++) out[i] += P.kLid * hLid[i] - P.kRift * rft[i];
	for (i = 0; i < nx; i++) zt[i] = 0;
	for (j = 1; j <= S.jIso; j++) {
		base = j * nx; sum = 0;
		for (i = 0; i < nx; i++) sum += Tg[base + i];
		sum /= nx;
		k = P.kIso * M.jN[j] * M.dEta;
		for (i = 0; i < nx; i++) zt[i] += k * (Tg[base + i] - sum);
	}
	k = P.kDyn * P.yIso / (2 * M.dx);
	for (i = 0; i < nx; i++) {
		im = i === 0 ? nx - 1 : i - 1; ip = i + 1 === nx ? 0 : i + 1;
		zt[i] += k * (u[ip] - u[im]);
	}
	flex(M, zt, tmp);
	for (i = 0; i < nx; i++) out[i] += zt[i];
	sum = 0;
	for (i = 0; i < nx; i++) sum += out[i];
	sum /= nx;
	for (i = 0; i < nx; i++) out[i] -= sum;
	zt.fill(0);
	return out;
}

// hold the state still and let the kernel's relaxation converge: 100 frames of 0.5 Myr leave
// (1 - a)^100 = 4e-15 of the initial gap, so what is left in zh is the fixed point
function settle(n) {
	for (var k = 0; k < (n || 100); k++) F.surface(M, S, 0.5);
}

function maxAbsDiff(a, b) {
	var m = 0, d, i;
	for (i = 0; i < a.length; i++) { d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
	return m;
}

// ---------------------------------------------------------------- 1. the target law
check.section('the target law: a hand-built state reads the independent formula');

// thermal: one hot column over a uniform field. The profile carries it as
// kIso * sum_j (Tg - rowMean) * jN * dEta, exactly before the filter and the mean
P.solid = false;
SIM.reset(); SIM.dt = 0.5;
for (i = 0; i < nx; i++) S.u[i] = 0;
S.mu.fill(0); S.dmg.fill(0);
var hot = nx >> 2, dT = 0.12;
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5 + (i === hot && j <= jIso ? dT : 0);
S.zh.fill(0);
settle();
var want = profile(M, S, new Float64Array(nx));
check.near('a hot column rises by kIso * sum(dT * dy) through the filter', maxAbsDiff(S.zh, want), 0, 1e-6, 'km');
// the single-column anomaly is spread by the flexural filter; the near() above pins its
// exact filtered value, while this pins the sign and a visible minimum scale
check.ok('and it rises', S.zh[hot] > 0.25, 'zh ' + S.zh[hot].toFixed(2) + ' km at the column, '
	+ S.zh[(hot + 8) % nx].toFixed(2) + ' km eight columns away');

// dynamic: a convergence pattern and nothing else. u is the shallowest cell row's velocity
SIM.reset(); SIM.dt = 0.5;
S.mu.fill(0); S.dmg.fill(0);
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
var conv = 0;                                       // one convergent band, one divergent
for (i = 0; i < nx; i++) {
	var a = 2 * Math.PI * i / nx;
	S.u[i] = 20 * Math.sin(a) + 8 * Math.sin(3 * a);
}
S.zh.fill(0);
settle();
want = profile(M, S, new Float64Array(nx));
check.near('the shallow convergence pulls the horizon down by kDyn * yIso * du/dx',
	maxAbsDiff(S.zh, want), 0, 1e-6, 'km');
// and the deepest column of the pattern is where du/dx is most negative
var lowI = 0, low = 1e9;
for (i = 0; i < nx; i++) if (S.zh[i] < low) { low = S.zh[i]; lowI = i; }
var im = lowI === 0 ? nx - 1 : lowI - 1, ip = lowI + 1 === nx ? 0 : lowI + 1;
check.ok('the deepest column is the most convergent one',
	(S.u[ip] - S.u[im]) < 0 && low < 0 && Math.abs(S.zh[hot]) < 1e-9,
	'dzh/dx ' + ((S.u[ip] - S.u[im]) / (2 * M.dx)).toFixed(4) + ' /Myr at column ' + lowI
	+ ', zh ' + low.toFixed(2) + ' km');

// crust proxy: a broad welded region lifts, while a damaged seam lowers its centre without
// the old thickness-minus-flexure high-pass moats
SIM.reset(); SIM.dt = 0.5;
S.cl.fill(-1); S.u.fill(0);
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
S.mu.fill(0.02); S.dmg.fill(0);
var bandStart = nx >> 2, bandWidth = 12, seam = bandStart + 6, col;
for (p = 0; p < S.n; p++) {
	if (S.y[p] > P.yCrust) continue;
	col = Math.round(S.x[p] / M.dx); col -= Math.floor(col / nx) * nx;
	if (col >= bandStart && col < bandStart + bandWidth) S.mu[p] = 0.06;
	if (col === seam) S.dmg[p] = 1;
}
S.zh.fill(0);
settle();
want = profile(M, S, new Float64Array(nx));
check.near('the welded-lid and rift terms match the filtered target', maxAbsDiff(S.zh, want), 0, 1e-6, 'km');
check.ok('a thick lid makes a broad swell',
	S.zh[bandStart + 3] > S.zh[bandStart + 20] + 0.2 && S.zh[bandStart + 9] > S.zh[bandStart + 20],
	'band ' + S.zh[bandStart + 3].toFixed(2) + '/' + S.zh[bandStart + 9].toFixed(2)
	+ ' km, outside ' + S.zh[bandStart + 20].toFixed(2) + ' km');
check.ok('rift damage makes a rounded notch without high-pass side moats',
	S.zh[seam] < S.zh[seam - 1] && S.zh[seam] < S.zh[seam + 1],
	'notch ' + S.zh[seam].toFixed(2) + ' km, shoulders '
	+ S.zh[seam - 1].toFixed(2) + '/' + S.zh[seam + 1].toFixed(2) + ' km');

check.section('convergent plates build a smoothed mountain belt');
P.kLid = 0; P.kRift = 0;
function collisionState(vLeft, vRight, samePlate) {
	SIM.reset(); SIM.dt = 0.5;
	S.cl.fill(-1); S.mu.fill(0.8); S.dmg.fill(0); S.u.fill(0); S.vx.fill(0);
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
	for (p = 0; p < S.n; p++) {
		var left = S.x[p] < M.wrap * 0.5;
		S.cl[p] = samePlate ? 0 : (left ? 0 : 1);
		S.vx[p] = left ? vLeft : vRight;
	}
	S.zh.fill(0);
	settle();
}
var boundary = nx >> 1, beltPeak = -1e9, beltIndex = boundary, beltOutside = -1e9, d;
collisionState(6, -6, false);
want = profile(M, S, new Float64Array(nx));
check.near('plates closing at 12 km/Myr follow the independent collision law', maxAbsDiff(S.zh, want), 0, 1e-6, 'km');
for (i = 0; i < nx; i++) {
	d = Math.abs(i - boundary); if (d > nx / 2) d = nx - d;
	if (d <= 8 && S.zh[i] > beltPeak) { beltPeak = S.zh[i]; beltIndex = i; }
	if (d > 8 && S.zh[i] > beltOutside) beltOutside = S.zh[i];
}
check.ok('convergence raises a broad crest, not a single-column needle',
	beltPeak > 0.5 && S.zh[(beltIndex + nx - 1) % nx] > 0 && S.zh[(beltIndex + 1) % nx] > 0,
	'crest ' + beltPeak.toFixed(2) + ' km at ' + beltIndex + ', neighbours '
	+ S.zh[(beltIndex + nx - 1) % nx].toFixed(2) + '/' + S.zh[(beltIndex + 1) % nx].toFixed(2)
	+ ' km, outside max ' + beltOutside.toFixed(2) + ' km');
collisionState(6, -6, true);
check.ok('relative motion inside one rigid cluster does not build a range',
	maxAbsDiff(S.zh, new Float64Array(nx)) < 1e-9,
	'max |zh| ' + maxAbsDiff(S.zh, new Float64Array(nx)).toExponential(2) + ' km');
collisionState(-6, 6, false);
check.ok('a divergent boundary does not uplift', S.zh[boundary] < S.zh[0],
	'divergent ' + S.zh[boundary].toFixed(2) + ' km, convergent wrap seam ' + S.zh[0].toFixed(2) + ' km');
P.kLid = lidScale; P.kRift = riftScale;

check.section('slope-dependent erosion smooths sharp relief and conserves the mean');
P.kErode = erosionK; P.tauSurf = 1e300;
SIM.reset(); SIM.dt = 0.5;
S.cl.fill(-1); S.mu.fill(0); S.dmg.fill(0); S.u.fill(0);
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
S.zh.fill(-4 / (nx - 1)); S.zh[0] = 4;
var peakBefore = S.zh[0], neighborBefore = S.zh[1], floorBefore = S.zh[1];
F.surface(M, S, 0.5);
mean = 0;
for (i = 0; i < nx; i++) mean += S.zh[i];
mean /= nx;
check.ok('erosion lowers a one-cell crest and deposits into its neighbours',
	S.zh[0] < peakBefore - 0.05 && S.zh[1] > neighborBefore + 0.02
		&& Math.abs(S.zh[1] - S.zh[nx - 1]) < 1e-12,
	'crest ' + peakBefore.toFixed(3) + '->' + S.zh[0].toFixed(3) + ' km, shoulder '
	+ neighborBefore.toFixed(3) + '->' + S.zh[1].toFixed(3) + ' km');
check.ok('periodic erosion keeps the sea-level mean at zero', Math.abs(mean) < 1e-12,
	'mean ' + mean.toExponential(2) + ' km');
check.ok('erosion does not create a new undershoot', Math.min.apply(null, S.zh) >= floorBefore - 1e-9,
	'min ' + Math.min.apply(null, S.zh).toFixed(4) + ' km from ' + floorBefore.toFixed(4) + ' km');
P.tauSurf = surfaceTau; P.kErode = erosionK;

// a flat, quiet planet must read zero: the profile is relative, so nothing to compensate is
// nothing to draw, and a stale sea level would be a fake ocean
SIM.reset(); SIM.dt = 0.5;
S.u.fill(0); S.mu.fill(0); S.dmg.fill(0);
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
for (i = 0; i < 40; i++) F.surface(M, S, 0.5);
check.ok('a flat quiet planet reads zero', maxAbsDiff(S.zh, new Float64Array(nx)) < 1e-12,
	'max |zh| ' + maxAbsDiff(S.zh, new Float64Array(nx)).toExponential(2) + ' km');

// ---------------------------------------------------------------- 2. the live run
check.section('the live run: swells, basins and trenches at 250 Myr');
P.solid = true;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var t0 = Date.now();
while (SIM.t < spin) SIM.step();
console.log('  spin-up to ' + SIM.t.toFixed(1) + ' Myr in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

var zh = S.zh, therm = new Float64Array(nx), conv2 = new Float64Array(nx), mean = 0;
for (i = 0; i < nx; i++) mean += zh[i];
mean /= nx;
for (j = 1; j <= jIso; j++) {
	var base = j * nx, sum = 0;
	for (i = 0; i < nx; i++) sum += S.Tg[base + i];
	sum /= nx;
	var kk = M.jN[j] * M.dEta;
	for (i = 0; i < nx; i++) therm[i] += (S.Tg[base + i] - sum) * kk;
}
for (i = 0; i < nx; i++) {
	im = i === 0 ? nx - 1 : i - 1; ip = i + 1 === nx ? 0 : i + 1;
	conv2[i] = (S.u[ip] - S.u[im]) / (2 * M.dx);
}
// the tails: the hottest 5% of columns against the coldest 5%, and the most convergent 5%
function tailMean(val, key, frac, top) {
	var idx = Array.apply(null, Array(nx)).map(function (v, k) { return k; });
	idx.sort(function (a, b) { return key[a] - key[b]; });
	var n = Math.max(1, Math.round(frac * nx)), s = 0;
	for (var k = 0; k < n; k++) s += val[top ? idx[nx - 1 - k] : idx[k]];
	return s / n;
}
var hotMean = tailMean(zh, therm, 0.05, true), coldMean = tailMean(zh, therm, 0.05, false);
var trenchMean = tailMean(zh, conv2, 0.05, false), domeMean = tailMean(zh, conv2, 0.05, true);
check.ok('hot upwelling columns stand above the cold basins',
	hotMean > coldMean + 2, 'hot ' + hotMean.toFixed(2) + ' km vs cold ' + coldMean.toFixed(2) + ' km');
check.ok('the most convergent columns are the deepest trenches',
	trenchMean < -3, 'mean zh ' + trenchMean.toFixed(2) + ' km, deepest ' + Math.min.apply(null, zh).toFixed(2) + ' km');
check.ok('and the most divergent ones are swells', domeMean > coldMean,
	'divergent ' + domeMean.toFixed(2) + ' km vs cold ' + coldMean.toFixed(2) + ' km');
// the profile is mostly a thermal isostasy: the correlation says whether that is true or the
// terms merely happen to move together
var ma = hotMean, mb = coldMean, sa = 0, sb = 0, sab = 0, d1, d2;
for (i = 0; i < nx; i++) { sa += therm[i]; sb += zh[i]; }
sa /= nx; sb /= nx;
for (i = 0; i < nx; i++) { d1 = therm[i] - sa; d2 = zh[i] - sb; sab += d1 * d2; }
var corr = sab / Math.sqrt((function () { var s = 0; for (i = 0; i < nx; i++) s += (therm[i] - sa) * (therm[i] - sa); return s; })()
	* (function () { var s = 0; for (i = 0; i < nx; i++) s += (zh[i] - sb) * (zh[i] - sb); return s; })());
// measured: r = 1.00 at the start (thermal only), 0.48 at 120 Myr and 0.98 at 250 Myr -- the
// dynamic term is a large share of the profile while the lid is still thin, which is physical,
// so the gate asks for the ordering rather than for a fixed share
check.ok('the horizon is thermal isostasy first (r > 0.4 with the upper-column integral)',
	corr > 0.4, 'r ' + corr.toFixed(2) + ' over ' + nx + ' columns');
check.ok('the mean elevation is zero to machine precision after a live run',
	Math.abs(mean) < 1e-12, 'mean ' + mean.toExponential(2) + ' km');
check.ok('the profile stays inside the drawn band', Math.max.apply(null, zh) < P.zVisMax
	&& Math.min.apply(null, zh) > -3 * P.zVisMax,
	'zh ' + Math.min.apply(null, zh).toFixed(2) + '..' + Math.max.apply(null, zh).toFixed(2) + ' km');
var activeOrogen = 0, maxClosure = 0, closure;
for (i = 0; i < nx; i++) {
	ip = i + 1 === nx ? 0 : i + 1;
	if (S.surfaceCl[i] < 0 || S.surfaceCl[ip] < 0 || S.surfaceCl[i] === S.surfaceCl[ip]) continue;
	closure = (S.surfaceV[i] - S.surfaceV[ip]) / M.dx;
	if (closure <= P.collisionYield) continue;
	activeOrogen++;
	if (closure > maxClosure) maxClosure = closure;
}
check.ok('the live run contains active convergent plate boundaries', activeOrogen > 0,
	activeOrogen + ' edges, max closure ' + maxClosure.toFixed(3) + ' /Myr');

// ---------------------------------------------------------------- 3. the view
check.section('the view: the drawn horizon, the ocean band and the warp');
var w = 320, h = 160;
R.initHeadless(w, h, M);
R.preset('lid', M);
R.raster(M, S, R.px, w, h);
var tops = new Int32Array(w), waters = 0, oceanAbove = 0, jj;
for (i = 0; i < w; i++) {
	tops[i] = -1;
	for (jj = 0; jj < h; jj++) {
		q = jj * w + i;
		if (R.px[q] === R.WATER) { waters++; if (R.yRow[jj] < 0) oceanAbove++; }
		else if (R.px[q] !== R.SKY && tops[i] < 0) tops[i] = jj;
	}
}
check.ok('the ocean band exists only below the reference sea level', waters > 0 && oceanAbove === 0,
	waters + ' water pixels, ' + oceanAbove + ' of them above y = 0');
// every column's topmost rock pixel must be the first screen row at or below its drawn horizon
function drawnTop(i) {
	var xk = (R.iOf[i] + R.fxOf[i]) * M.dx, ci = Math.floor(xk / M.dx), f = xk / M.dx - Math.floor(xk / M.dx);
	ci -= Math.floor(ci / nx) * nx;
	var zv = S.zh[ci] + (S.zh[(ci + 1) % nx] - S.zh[ci]) * f;
	if (zv > P.zVisMax) zv = P.zVisMax; else if (zv < -P.zVisMax) zv = -P.zVisMax;
	return -P.kRelief * zv;
}
var bad = 0, worst = 0;
for (i = 0; i < w; i++) {
	var want2 = drawnTop(i), found = -1;
	for (jj = 0; jj < h; jj++) if (R.yRow[jj] >= want2) { found = jj; break; }
	if (found >= 0 && tops[i] >= 0 && Math.abs(tops[i] - found) > 2) { bad++; worst = Math.max(worst, Math.abs(tops[i] - found)); }
}
check.ok('the drawn rock top sits on the profile (within a row)', bad === 0,
	bad + ' of ' + w + ' columns off, worst ' + worst + ' rows');
// with the relief toggle off the horizon is flat at y = 0 for every column, and no column can
// have water above it
R.relief = false;
R.px.fill(0);
R.raster(M, S, R.px, w, h);
var waterOff = 0, flat = 1, t2;
for (q = 0; q < w * h; q++) if (R.px[q] === R.WATER) waterOff++;
for (i = 0; i < w; i++) {
	t2 = -1;
	for (jj = 0; jj < h; jj++) if (R.px[jj * w + i] !== R.SKY && t2 < 0) t2 = jj;
	if (t2 >= 0 && Math.abs(R.yRow[t2] - Math.abs(R.yRow[t2])) > 0 && R.yRow[t2] > 0.5 * (h / 2) - 100) {}
	if (t2 < 0) { flat = 0; continue; }
	if (R.yRow[t2] > 12) flat = 0;                      // the row just past y = 0 is ~8 km deep
}
check.ok('the relief toggle off leaves the unwarped raster', waterOff === 0 && flat === 1,
	waterOff + ' water pixels, flat ' + flat);
R.relief = true;
// A marker rides the same warp: put one marker at the centre of a swell and of a basin and
// draw it twice, with the relief on and off. The shift the stipple applies must be the warp
// the raster used, kRelief * zh * exp(-y / yTaper) / J(y) converted to screen rows. One marker
// at a time, so nothing else in the cloud can move the answer.
var hiCol = 0, loCol = 0;
for (i = 0; i < nx; i++) { if (S.zh[i] > S.zh[hiCol]) hiCol = i; if (S.zh[i] < S.zh[loCol]) loCol = i; }
var keepN = S.n, keep = [S.x[0], S.y[0], S.e[0], S.mu[0]];
function markerRow(col, ya, on) {
	S.n = 1;
	S.x[0] = (col + 0.5) * M.dx; S.y[0] = ya;
	S.e[0] = Math.asinh(ya / M.yLin); S.mu[0] = 0.9;
	R.relief = on;
	P.view.cx = S.x[0];
	R.build(M);
	R.px.fill(0);
	R.stipple(M, S, R.px, w, h);
	for (var jj2 = 0; jj2 < h; jj2++) if (R.px[jj2 * w + (w >> 1)]) return jj2;
	return -1;
}
// the same interpolation and the same clip the stipple applies, so this is the warp law the
// view actually runs and not a re-derivation that could drift from it
function zhAt(x) {
	var f = x / M.dx, ci = Math.floor(f), cf = f - ci;
	ci -= Math.floor(ci / nx) * nx;
	return S.zh[ci] + (S.zh[ci + 1 === nx ? 0 : ci + 1] - S.zh[ci]) * cf;
}
function warpRows(x, ya) {
	var zv = zhAt(x);
	if (zv > P.zVisMax) zv = P.zVisMax; else if (zv < -P.zVisMax) zv = -P.zVisMax;
	return P.kRelief * zv * Math.exp(-ya / P.yTaper)
		/ Math.sqrt(M.yLin * M.yLin + ya * ya) / ((P.view.eB - P.view.eT) / h);
}
var yTest = 8, offHi = markerRow(hiCol, yTest, false), onHi = markerRow(hiCol, yTest, true);
check.near('a marker on a swell is drawn up by the profile', offHi - onHi,
	warpRows((hiCol + 0.5) * M.dx, yTest), 2, 'rows (zh at the marker ' + zhAt((hiCol + 0.5) * M.dx).toFixed(2) + ' km)');
var offLo = markerRow(loCol, yTest, false), onLo = markerRow(loCol, yTest, true);
check.near('and a marker in a basin is drawn down by it', onLo - offLo,
	-warpRows((loCol + 0.5) * M.dx, yTest), 2, 'rows (zh at the marker ' + zhAt((loCol + 0.5) * M.dx).toFixed(2) + ' km)');
check.ok('the two warps really are opposite', onHi < offHi && onLo > offLo,
	'swell ' + offHi + '->' + onHi + ', basin ' + offLo + '->' + onLo);
S.n = keepN; S.x[0] = keep[0]; S.y[0] = keep[1]; S.e[0] = keep[2]; S.mu[0] = keep[3];
R.relief = true;

// ---------------------------------------------------------------- 5. the drive (last: it replaces the live state with its own test plate)
check.section('ridge push: a slope moves a plate, a flat planet does not');
P.solid = true;
var xa = 10 * M.dx, y0 = M.yN[3];
function plate(M, S, pts) {
	S.n = pts.length;
	for (var p = 0; p < pts.length; p++) {
		S.x[p] = pts[p][0]; S.y[p] = pts[p][1];
		S.e[p] = Math.asinh(pts[p][1] / M.yLin);
		S.T[p] = pts[p][2]; S.m[p] = 1;
		S.vx[p] = pts[p][3]; S.vy[p] = 0;
		S.age[p] = pts[p][4]; S.dmg[p] = 0; S.mu[p] = 0; S.cl[p] = -1; S.vy[p] = 0;
	}
}
for (i = 0; i < nx; i++) zh[i] = 0;
if (M.zh === undefined) { /* no-op: zh lives in the state */ }
S.zh.fill(0);
plate(M, S, [[xa, y0, 0.1, 0, 100], [xa + M.dx, y0, 0.1, 0, 100], [xa + 2 * M.dx, y0, 0.1, 0, 100], [xa + 3 * M.dx, y0, 0.1, 0, 100]]);
SC.crust(M, S, 1);
check.ok('a flat planet does not push', Math.abs(S.vx[0]) < 1e-12 && Math.abs(S.vx[3]) < 1e-12,
	'vx ' + S.vx[0].toExponential(2) + ' km/Myr');
// a slope under the plate: zh falls by S0 km per km, so -dzh/dx = S0 and the plate must gain
// exactly kPush * S0 (capped at vPushMax). The ramp's own jump at the seam is far away -- the
// plate sits in the middle of it.
var S0 = -0.002, mid = Math.round(xa / M.dx) + 2;
for (i = 0; i < nx; i++) S.zh[i] = S0 * (i - mid) * M.dx;
S.zh[0] = S.zh[nx - 1];                              // keep the ramp single-valued at the seam
plate(M, S, [[xa, y0, 0.1, 0, 100], [xa + M.dx, y0, 0.1, 0, 100], [xa + 2 * M.dx, y0, 0.1, 0, 100], [xa + 3 * M.dx, y0, 0.1, 0, 100]]);
SC.crust(M, S, 1);
check.near('a slope pushes the plate at kPush * (-dzh/dx)', S.vx[0], -P.kPush * S0, 1e-9, 'km/Myr');
// and the cap holds when a plate sits under a real mountain front
S0 = -0.05;
for (i = 0; i < nx; i++) S.zh[i] = S0 * (i - mid) * M.dx;
S.zh[0] = S.zh[nx - 1];
plate(M, S, [[xa, y0, 0.1, 0, 100], [xa + M.dx, y0, 0.1, 0, 100], [xa + 2 * M.dx, y0, 0.1, 0, 100], [xa + 3 * M.dx, y0, 0.1, 0, 100]]);
SC.crust(M, S, 1);
check.near('and the push is capped at vPushMax', S.vx[0], P.vPushMax, 0, 'km/Myr');

// ---------------------------------------------------------------- 6. the price
check.section('the price: no per-frame allocation');
// The engine is typed arrays only, so its allocations are ArrayBuffers and `process` reports
// those separately from the heap. The wrapped constructors catch a single `new` on any of
// them; the heap delta is the fallback for a path the wrappers miss (a literal, a closure).
var Real = { f64: Float64Array, f32: Float32Array, i32: Int32Array, u8: Uint8Array, u32: Uint32Array };
var made = 0;
function wrap(name) {
	var R2 = global[name];
	global[name] = new Proxy(R2, {
		construct: function (t, args) { made++; return new t(args[0], args[1], args[2]); },
		apply: function (t, th, args) { made++; return new t(args[0], args[1], args[2]); }
	});
	return R2;
}
function restore() {
	global.Float64Array = Real.f64; global.Float32Array = Real.f32; global.Int32Array = Real.i32;
	global.Uint8Array = Real.u8; global.Uint32Array = Real.u32;
}
wrap('Float64Array'); wrap('Float32Array'); wrap('Int32Array'); wrap('Uint8Array'); wrap('Uint32Array');
F.surface(M, S, 0.05); F.surface(M, S, 0.05);        // warm up with the rest of the code
R.raster(M, S, R.px, w, h); R.stipple(M, S, R.px, w, h);
made = 0;
var m0 = process.memoryUsage();
for (i = 0; i < 400; i++) { F.surface(M, S, 0.05); R.raster(M, S, R.px, w, h); R.stipple(M, S, R.px, w, h); }
var m1 = process.memoryUsage();
restore();
check.ok('the surface kernel and the warped view construct no arrays per frame', made === 0,
	made + ' typed arrays over 400 frames');
check.ok('and grow no ArrayBuffer memory', (m1.arrayBuffers - m0.arrayBuffers) < 4096,
	'arrayBuffers ' + (m1.arrayBuffers - m0.arrayBuffers) + ' bytes, heap '
	+ (m1.heapUsed - m0.heapUsed) + ' bytes over 400 frames');

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s of spin-ups');
check.done();
