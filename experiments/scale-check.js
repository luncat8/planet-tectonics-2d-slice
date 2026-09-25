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

function fanCells(N, C0) {
	const merges = Math.log2(C0); // 9 merge rows at round(k*N/9) -> bottom row is 1 cell
	let cells = 0, C = C0;
	for (let i = 0; i < N; i++) {
		cells += C;
		for (let k = 1; k <= merges; k++) {
			if (i + 1 === Math.round(k * N / merges) && C > 1) C = (C / 2) | 0;
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
