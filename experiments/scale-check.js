// Scale tables for the slice: vertical row schedule, fan cell budget, display maps.
// Run: node experiments/scale-check.js
// Cited by 0.1.0-design.md and 0.1.0-plan.md. Pure math, no DOM.

'use strict';

const R = 6371e3;          // planet radius, m
const CRUST = 35e3;        // reference crustal thickness, m
const LAMBDA_Y = 40e3;     // display map linear-core half-width (asinh), m
const CANVAS_W = 1280;
const CANVAS_H = 560;
const WINDOW_KM = 3000;    // default view width along the surface

// --- geometric row schedule: h_i = h0 * q^i, sum = R --------------------------

function solveQ(h0, N, span) {
	let lo = 1.0000001, hi = 2;
	for (let k = 0; k < 200; k++) {
		const q = (lo + hi) / 2;
		const s = h0 * (Math.pow(q, N) - 1) / (q - 1);
		if (s < span) lo = q; else hi = q;
	}
	return (lo + hi) / 2;
}

function rowDepth(h0, q, i) {
	// top depth of row i (positive down), geometric sum
	return h0 * (Math.pow(q, i) - 1) / (q - 1);
}

function schedule(h0, N) {
	const q = solveQ(h0, N, R);
	const hBot = h0 * Math.pow(q, N - 1);
	let crustRows = 0;
	while (rowDepth(h0, q, crustRows + 1) <= CRUST) crustRows++;
	let fineRows = 0, fineDepth = 0;
	while (h0 * Math.pow(q, fineRows) <= 100) {
		fineDepth += h0 * Math.pow(q, fineRows);
		fineRows++;
	}
	return { q, hBot, crustRows, fineRows, fineDepth };
}

// The 9 merge rows sit at round(k*(N-1)/9), k = 1..9, so the last merge lands ON the
// last row and the bottom row is the single cell the design asks for. round(k*N/9) puts
// the ninth merge past the last row and leaves 2 cells at the center (7186 at N = 64) —
// measured and rejected. js/geom.js holds the one implementation; the F. section below
// asserts this table against it.
function fanCells(N, C0) {
	const merges = Math.log2(C0);
	let cells = 0, C = C0;
	for (let i = 0; i < N; i++) {
		cells += C;
		for (let k = 1; k <= merges; k++) {
			if (i + 1 === Math.round(k * (N - 1) / merges) && C > 1) C >>= 1;
		}
	}
	return cells;
}

// --- display maps: world y (m, up positive) -> u (screen-proportional) --------

const asinhU = (y, lam) => Math.asinh(y / lam);
const asinhY = (u, lam) => lam * Math.sinh(u);

function pxSpan(mapU, yTop, yBot) {
	return mapU(yTop) - mapU(yBot); // u units per full canvas height
}

function edificePx(mapU, yTop, yBot, wKm, hKm) {
	const duPx = pxSpan(mapU, yTop, yBot) / CANVAS_H;
	const wPx = (wKm * 1000) / (WINDOW_KM * 1000 / CANVAS_W);
	const y0 = Math.max(0, yBot) + 2e3; // stand the cone on a 2 km foothill
	const hPx = (mapU(y0 + hKm * 1000) - mapU(y0)) / duPx;
	return [wPx, hPx];
}

function bedPx(mapU, yTop, yBot, y, bedM, zoom) {
	const duPx = pxSpan(mapU, yTop, yBot) / CANVAS_H / zoom;
	const du = mapU(y + bedM) - mapU(y);
	return du / duPx;
}

// row-uniform map: each row gets one u unit (the "log display as rows" idea)
function rowUniform(h0, q) {
	const idx = (y) => Math.log(1 + Math.max(0, y) * (q - 1) / h0) / Math.log(q);
	return (y) => (y >= 0 ? idx(y) : -idx(-y) * 0.33); // sky band compressed so it fits
}

// --- report ------------------------------------------------------------------

function line(s) { console.log(s); }

line('A. geometric rows (h0 = 20 m at the 0 m band, sum = R = ' + (R / 1e3) + ' km)');
line('N     q        hBot    crustRows  rows<=100m (depth)   fanCells(512->1)  uniformCells');
for (const N of [48, 64, 80, 96, 128]) {
	const s = schedule(20, N);
	line(String(N).padEnd(6) + s.q.toFixed(5) + '  ' +
		String(Math.round(s.hBot / 1e3)).padEnd(7) + '  ' +
		String(s.crustRows).padEnd(10) + '  ' +
		(s.fineRows + ' (' + Math.round(s.fineDepth) + ' m)').padEnd(20) + '  ' +
		String(fanCells(N, 512)).padEnd(17) + '  ' + (N * 512));
}

const N0 = 64, q0 = schedule(20, N0).q;
line('');
line('B. default schedule N = 64 (the "20 m at surface -> 1000 km at center" pair)');
line('i     topY      h');
for (const i of [0, 5, 10, 15, 20, 25, 30, 33, 40, 45, 50, 55, 60, 63]) {
	const h = 20 * Math.pow(q0, i);
	line(String(i).padEnd(6) + String(Math.round(rowDepth(20, q0, i) / 1e3) + ' km').padEnd(10) +
		(h < 1000 ? Math.round(h) + ' m' : (h / 1e3).toFixed(1) + ' km'));
}
const sky = (() => { let n = 0; while (rowDepth(20, q0, n) < 33e3) n++; return n; })();
line('sky rows mirrored upward to +33 km: ' + sky);

line('');
line('C. display maps at the default window (' + WINDOW_KM + ' km wide, +33 .. -300 km, ' +
	CANVAS_W + 'x' + CANVAS_H + ')');
const yTop = 33e3, yBot = -300e3;
const mapA = (y) => asinhU(y, LAMBDA_Y);
const duPx = pxSpan(mapA, yTop, yBot) / CANVAS_H;
line('asinh(y / 40 km): u/px = ' + duPx.toFixed(5));
for (const y of [0, 5e3, 20e3, -20e3, -70e3, -200e3]) {
	const mPx = Math.sqrt(y * y + LAMBDA_Y * LAMBDA_Y) * duPx;
	line('  dy/dpx at y = ' + String(Math.round(y / 1e3) + ' km').padEnd(7) + ' = ' +
		(mPx < 1000 ? Math.round(mPx) + ' m/px' : (mPx / 1e3).toFixed(2) + ' km/px'));
}
line('  cone sizes as [width px, height px]:');
for (const [w, h] of [[2, 0.5], [20, 2], [40, 4], [60, 8]]) {
	const [wPx, hPx] = edificePx(mapA, yTop, yBot, w, h);
	line('    ' + String(w + ' km x ' + h + ' km').padEnd(14) + ' -> ' +
		wPx.toFixed(1) + ' x ' + hPx.toFixed(1) +
		(wPx >= 10 && wPx <= 30 && hPx >= 10 && hPx <= 30 ? '   in the 10-30 px band' : ''));
}
line('  bed pixels (50 m / 10 m) at y = -5 km:');
for (const z of [1, 10, 30]) {
	line('    zoom x' + String(z).padEnd(4) +
		bedPx(mapA, yTop, yBot, -5e3, 50, z).toFixed(2) + ' / ' +
		bedPx(mapA, yTop, yBot, -5e3, 10, z).toFixed(2) + ' px');
}

line('');
line('D. rejected display maps, same window and same cone (40 km x 4 km):');
const rowU = rowUniform(20, q0);
const [rw, rh] = edificePx((y) => rowU(y), yTop, yBot, 40, 4);
line('  row-uniform over the graded rows -> ' + rw.toFixed(1) + ' x ' + rh.toFixed(1) +
	' px  (needle, ' + (rh / rw).toFixed(1) + ':1)');
const lin = (y) => y / 1e3;
const [lw, lh] = edificePx(lin, yTop, yBot, 40, 4);
line('  linear vertical              -> ' + lw.toFixed(1) + ' x ' + lh.toFixed(1) +
	' px  (pancake, ' + (lw / lh).toFixed(1) + ':1); 10 m bed = ' +
	bedPx(lin, yTop, yBot, -5e3, 10, 1).toFixed(3) + ' px at zoom x1');
const signLog = (y) => Math.sign(y) * Math.log(1 + Math.abs(y) / 20);
const [sw, sh] = edificePx(signLog, yTop, yBot, 40, 4);
line('  signed log (20 m kink at 0)   -> ' + sw.toFixed(1) + ' x ' + sh.toFixed(1) +
	' px  (needle, ' + (sh / sw).toFixed(1) + ':1), slope kink at sea level');

line('');
line('E. overview check (full depth -6371 .. +33 km, same asinh map)');
const oTop = 33e3, oBot = -R;
const duPxO = pxSpan(mapA, oTop, oBot) / CANVAS_H;
const [ow, oh] = edificePx(mapA, oTop, oBot, 40, 4);
line('  y=0 scale ' + Math.round(LAMBDA_Y * duPxO) + ' m/px, center scale ' +
	(R * duPxO / 1e3).toFixed(0) + ' km/px (' + Math.round(R / LAMBDA_Y) + ':1 compression)');
line('  40 km x 4 km cone -> ' + ow.toFixed(1) + ' x ' + oh.toFixed(1) + ' px (still small but square)');

// --- F. assertions against the shipped code ------------------------------------
// Everything above derives the design's numbers from first principles; this section
// checks the shipped js/ modules produce them, so the table cannot drift from the code.
const { mods, check } = require('./lib.js');
const P = mods.params, GEO = mods.geom, SURF = mods.surface, S = mods.state;

line('');
line('F. shipped code vs the tables above');
check.near('q solves sum(h_i) = R', GEO.hTop[GEO.N], R, 1, 'm');
check.near('q', GEO.q, q0, 5e-5);
check.near('center row h_63', P.R - GEO.hTop[GEO.N - 1], 1006e3, 1e3, 'm');
check.ok('sky rows = 34', GEO.skyN === 34, 'got ' + GEO.skyN);
check.near('w0 = wrap/nCols', P.w0, 78.184e3, 1, 'm');
check.ok('fan cells = ' + fanCells(P.nRows, P.nCols), GEO.fanOff[GEO.N] === fanCells(P.nRows, P.nCols),
	'got ' + GEO.fanOff[GEO.N]);
check.ok('bottom fan band is 1 cell', GEO.fanN[GEO.N - 1] === 1, 'got ' + GEO.fanN[GEO.N - 1]);
check.ok('band 0 has nCols cells', GEO.fanN[0] === P.nCols, 'got ' + GEO.fanN[0]);
check.near('4.6x cheaper than uniform', P.nRows * P.nCols / GEO.fanOff[GEO.N], 4.588, 0.005);

// isostasy calibration points (reference §7.1) through the shipped surface.js
function elev(hFel, hMaf, hSed, age) {
	S.hFel[0] = hFel; S.hMaf[0] = hMaf; S.hSed[0] = hSed; S.colAge[0] = age; S.zDyn[0] = 0;
	return SURF.elev(0);
}
check.near('7 km mafic age 0 -> -2600 m', elev(0, 7e3, 0, 0), -2600, 5, 'm');
check.near('7 km mafic age 80 -> -5730 m', elev(0, 7e3, 0, 80), -5730, 5, 'm');
check.near('35 km felsic -> +400 m', elev(35e3, 0, 0, 300), 400, 5, 'm');
check.near('70 km felsic -> +6234 m', elev(70e3, 0, 0, 300), 6234, 5, 'm');
check.near('15 km felsic + 7 km mafic age 80 ~ -2.5 km', elev(15e3, 7e3, 0, 80), -2460, 60, 'm');

// display map: the cone and bed numbers of sections C/E, from the shipped LUTs
GEO.setPreset('def'); GEO.sync();
check.near('default 2.34 km/px horizontal', GEO.kx / 1e3, 2.34375, 1e-6);
check.near('247 m/px at y = 0', Math.sqrt(P.yLin * P.yLin) * GEO.duPx, 247, 1, 'm');
check.near('cone 40 km wide = 17.1 px', 40e3 / GEO.kx, 17.1, 0.05, 'px');
check.near('cone 4 km tall = 16.1 px',
	(GEO.u(0) - GEO.u(-4e3)) / GEO.duPx, 16.1, 0.05, 'px');
check.near('50 m bed = 0.20 px at x1', 50 / (Math.sqrt(P.yLin * P.yLin + 25e6) * GEO.duPx), 0.2, 0.005, 'px');
GEO.setPreset('ovw'); GEO.sync();
check.near('overview 465 m/px at y = 0', Math.sqrt(P.yLin * P.yLin) * GEO.duPx, 465, 1, 'm');
check.near('overview cone still 17.1 px wide', 40e3 / GEO.kx, 17.1, 0.05, 'px');

check.done();
