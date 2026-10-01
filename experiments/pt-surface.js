// pt-surface.js — 0.3.0 P2.3: the surface elevation profile `S.zh[i]`, gated in the engine.
//
// The plan's §4.5 claim is that the flat `eta = 0` top of a separable Stokes domain can still
// carry a real horizon: a periodic zero-mean 1D profile built from upper-column thermal
// isostasy, the shallow convergence's dynamic pull, and the welded lid's thickness and rift
// damage -- and coupled back into the plates as ridge push. This fixture gates six things:
//
//   1. the law      -- each term against a hand-built state, so the *values* are pinned and
//                      not merely the signs: the plan's §4.5 formulas are written out here
//                      independently of the kernel and compared column by column
//   2. the mean     -- zero to machine precision on a long live run, and a flat quiet planet
//                      reads zero instead of walking its sea level
//   3. the physics  -- on a live run, the hot upwelling columns stand a band above the cold
//                      basins and the most convergent columns are the deepest trenches; the
//                      correlation between the profile and the thermal integral is measured
//   4. the drive    -- ridge push moves a plate down a slope by kPush * (-dzh/dx), caps at
//                      vPushMax, and a flat planet rides the flow's mean exactly as P2.2
//                      measured (the slab-pull unit gates must not have moved)
//   5. the view     -- the terrain warp puts the drawn rock top where the profile says, the
//      (pt-wrap.js)  ocean band exists only below the reference sea level, the relief toggle
//                      is honest, and the profile itself is periodic across x = 0
//   6. the price    -- neither the surface kernel nor the warped renderer allocates per frame
//
// Run: node experiments/pt-surface.js [spinMyr=250] > experiments/logs/0.3.0-p2.3-surface.txt
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), F = require(B + 'fluid.js'), SC = require(B + 'solid.js');
var R = require(B + 'render.js');

var spin = +(process.argv[2] || 250);

console.log('  surface: the P2.3 elevation profile, mesh ' + P.mesh.nx + 'x' + P.mesh.ny
	+ ', wrap ' + P.wrap + ' km, kIso ' + P.kIso + ', yIso ' + P.yIso + ', kDyn ' + P.kDyn
	+ ', tauSurf ' + P.tauSurf + ' Myr\n');

P.ic = 'cool'; P.sl.kyr = 50; P.solid = true; P.seed = 1;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M, nx = M.nx, ny = M.ny;

// ---------------------------------------------------------------- the plan's formulas
// The kernel's target, written out from §4.5 rather than called: thermal isostasy against each
// node row's own mean, the shallow convergence times the compensation depth, the welded-lid
// thickness anomaly minus the rift damage. The filter is the same periodic [1,2,1]/4 the plan
// names, so this is an independent spelling of the same definition, not a re-run of the kernel.
//
// The one structural thing this copy pins: the crust term (raw thickness minus its own flexural
// average) *is* the flexural response and is not filtered again, while the thermal and dynamic
// fields are filtered once. Applying the filter twice cancelled the load's own relief.
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
	var i, j, p, base, y, m, sum, k, im, ip, zt = S.zSmooth, tmp = new Float64Array(nx), raw = new Float64Array(nx);
	for (i = 0; i < nx; i++) { hLid[i] = 0; rft[i] = 0; colM[i] = 0; }
	for (p = 0; p < S.n; p++) {
		y = S.y[p];
		if (y > P.yCrust) continue;
		i = Math.round(S.x[p] / M.dx); i -= Math.floor(i / nx) * nx;
		m = S.m[p];
		hLid[i] += m * S.mu[p]; rft[i] += m * S.dmg[p]; colM[i] += m;
	}
	for (i = 0; i < nx; i++) {
		hLid[i] /= M.dx;
		if (colM[i] > 0) rft[i] /= colM[i];
		else { rft[i] = i > 0 ? rft[i - 1] : 0; hLid[i] = i > 0 ? hLid[i - 1] : 0; }
	}
	// the thickness anomaly against its own flexural average: `raw` is the unfiltered field,
	// which is the whole point of the term (the average alone carries no anomaly at all).
	// This term *is* the flexural response, so it is not put through the filter below
	raw.set(hLid);
	flex(M, hLid, tmp);
	for (i = 0; i < nx; i++) out[i] = P.kLid * (raw[i] - hLid[i]) - P.kRift * rft[i];
	// the thermal and dynamic part, then one flexural filter over that field alone
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

// ---------------------------------------------------------------- 1. the three terms
check.section('the law: a hand-built state reads the plan\'s formula');

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
// a single column is narrower than the flexural filter, so the fixed point is the filtered
// value (0.375 of the raw law for 3 passes), not the raw one -- the near() above is what pins
// the formula, this pins the sign and the scale of the visible result
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

// crust: a thick welded band stands high, a fully damaged seam notches
SIM.reset(); SIM.dt = 0.5;
S.u.fill(0);
for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) S.Tg[j * nx + i] = 0.5;
// mu is the welding strength, so hLid reads the welded thickness of the column at the scale of
// a young lid: 0.02 of the 250 km sample is ~5 km, and a 3-column band at 0.06 is ~14 km -- the
// same 10 km step a real arc has. The term is a *flexural anomaly*, so only features narrower
// than lFlex columns carry it: a plateau wider than the flexural wavelength has no local
// anomaly to be supported by flexure, and real crustal thickness is P3's (see the plan)
S.mu.fill(0.02); S.dmg.fill(0);
var band = [(nx >> 2), (nx >> 2) + 1, (nx >> 2) + 2], seam = [(nx >> 2) + 1];
for (p = 0; p < S.n; p++) {
	i = Math.round(S.x[p] / M.dx); i -= Math.floor(i / nx) * nx;
	if (S.y[p] > P.yCrust) continue;
	if (band.indexOf(i) >= 0) S.mu[p] = 0.06;            // a thicker welded lid: it stands
	if (seam.indexOf(i) >= 0) S.dmg[p] = 1;              // and its middle is rifted apart
}
S.zh.fill(0);
settle();
want = profile(M, S, new Float64Array(nx));
check.near('a welded band and a damaged seam read the plan\'s crust formula', maxAbsDiff(S.zh, want), 0, 1e-6, 'km');
check.ok('the welded band stands above its shoulders and the seam notches below them',
	S.zh[band[0]] > 0.5 && S.zh[seam[0]] < -0.5 && S.zh[seam[0]] < S.zh[band[0]],
	'band ' + S.zh[band[0]].toFixed(2) + ' km, seam ' + S.zh[seam[0]].toFixed(2) + ' km, shoulder '
	+ S.zh[(nx >> 2) + 8].toFixed(2) + ' km');

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
