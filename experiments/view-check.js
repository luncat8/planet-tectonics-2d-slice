// view-check.js — the geometry, the fan stencil and the LUTs against the design
// §1.2/§1.3/§1.4 tables. Loads the shipped js/ in index.html order through lib.js.
// Run: node experiments/view-check.js
'use strict';

var L = require('./lib.js');
var check = L.check;
var P = L.mods.params, GEO = L.mods.geom, S = L.mods.state, SIM = L.mods.sim;
var RNDR = L.mods.render;

// the merge rule of the design table, restated so the table itself is checked
function fanCells(N) {
	var cells = 0, C = P.nCols, i, k;
	for (i = 0; i < N; i++) {
		cells += C;
		for (k = 1; k <= 9; k++) {
			if (i + 1 === Math.round(k * (N - 1) / 9) && C > 1) { C >>= 1; break; }
		}
	}
	return cells;
}

check.section('A. row schedule (design §1.2)');
check.near('q closed form', GEO.q, 1.18748, 5e-5);
check.near('hTop[N] = R', GEO.hTop[GEO.N], P.R, 1, 'm');
check.near('row 0 = h0 = 20 m', GEO.hTop[1] - GEO.hTop[0], P.h0, 1e-9, 'm');
check.near('bottom row 1006 km', P.R - GEO.hTop[GEO.N - 1], 1006e3, 1e3, 'm');
check.ok('sky rows = 34', GEO.skyN === 34, 'got ' + GEO.skyN);
var mono = true, i, r;
for (i = 1; i <= GEO.N; i++) if (GEO.hTop[i] <= GEO.hTop[i - 1]) mono = false;
check.ok('hTop strictly increasing', mono);
var ratio = true;
for (i = 1; i < GEO.N; i++) {
	var rr = GEO.rowH[i] / GEO.rowH[i - 1];
	if (Math.abs(rr - GEO.q) > 1e-9 * GEO.q) ratio = false;
}
check.ok('rowH is geometric with ratio q', ratio);
// rowOf must bracket its own altitude over a wide sample
var bracket = 0, samples = 4000;
for (i = 0; i < samples; i++) {
	var y = -P.R * i / samples;
	r = GEO.rowOf(y);
	if (r >= 0 && -y >= GEO.hTop[r] && -y < GEO.hTop[r + 1]) bracket++;
}
check.ok('rowOf brackets its altitude over ' + samples + ' samples', bracket === samples,
	bracket + '/' + samples);
check.ok('rowOf(0) = 0 (the 0 m band)', GEO.rowOf(0) === 0, 'got ' + GEO.rowOf(0));
check.ok('rowOf(+1 km) = -1 (sky has no row)', GEO.rowOf(1e3) === -1, 'got ' + GEO.rowOf(1e3));
var cyIn = true;
for (i = 0; i < GEO.N; i++) if (GEO.rowCy[i] <= GEO.hTop[i] || GEO.rowCy[i] >= GEO.hTop[i + 1]) cyIn = false;
check.ok('rowCy lies inside its row', cyIn);

check.section('B. fan budget (design §1.3)');
check.ok('fan cells = ' + fanCells(P.nRows), GEO.fanOff[P.nRows] === fanCells(P.nRows),
	'got ' + GEO.fanOff[P.nRows]);
[48, 64, 80, 96, 128].forEach(function (N) {
	check.ok('design table fanCells N=' + N, fanCells(N) ===
		{ 48: 5247, 64: 7155, 80: 9063, 96: 10903, 128: 14341 }[N], 'got ' + fanCells(N));
});
check.ok('bottom band is exactly 1 cell', GEO.fanN[GEO.N - 1] === 1, 'got ' + GEO.fanN[GEO.N - 1]);
check.ok('band 0 has nCols cells', GEO.fanN[0] === P.nCols, 'got ' + GEO.fanN[0]);
var dbl = true, merges = 0;
for (i = 1; i < GEO.N; i++) {
	if (GEO.fanN[i] === GEO.fanN[i - 1]) continue;
	merges++;
	if (GEO.fanN[i] * 2 !== GEO.fanN[i - 1]) dbl = false;
}
check.ok('exactly 9 halvings, each exactly /2', dbl && merges === 9, merges + ' halvings');
check.ok('bandOf covers every row', GEO.bandBot[GEO.bands - 1] === GEO.N,
	'last band ends at ' + GEO.bandBot[GEO.bands - 1]);
// cellOf must return the cell that owns its own centre
var cellOk = 0;
for (r = 0; r < GEO.N; r++) {
	var pitch = P.wrap / GEO.fanN[r];
	for (i = 0; i < GEO.fanN[r]; i++) {
		if (GEO.cellOf(r, (i + 0.5) * pitch) === GEO.fanOff[r] + i) cellOk++;
	}
}
check.ok('cellOf(centre) = cell for all ' + GEO.fanOff[GEO.N] + ' cells',
	cellOk === GEO.fanOff[GEO.N], cellOk + '/' + GEO.fanOff[GEO.N]);

check.section('C. fan neighbour stencil (design §1.3)');
var nbr = GEO.nbr, face = GEO.nbrFace, dist = GEO.nbrDist, tot = GEO.fanOff[GEO.N];
var sym = 0, asymFace = 0, asymDist = 0, missing = 0, self = 0, lrOk = 0, faceSumBad = 0;
for (var c = 0; c < tot; c++) {
	var row = 0;
	while (GEO.fanOff[row + 1] <= c) row++;
	var pj = P.wrap / GEO.fanN[row];
	var downSum = 0, upSum = 0;
	for (var sl = 0; sl < 6; sl++) {
		var o = c * 6 + sl, j = nbr[o];
		if (j < 0) continue;
		if (j === c) self++;
		if (sl === 0 || sl === 1) lrOk++;
		if (sl === 2 || sl === 3) downSum += face[o];
		if (sl === 4 || sl === 5) upSum += face[o];
		// the reverse link must exist with the same face and the same distance
		var found = false;
		for (var t = 0; t < 6; t++) {
			if (nbr[j * 6 + t] !== c) continue;
			found = true;
			if (face[j * 6 + t] !== face[o]) asymFace++;
			if (Math.abs(dist[j * 6 + t] - dist[o]) > 1e-6 * dist[o]) asymDist++;
		}
		if (found) sym++; else missing++;
	}
	if (row + 1 < GEO.N && Math.abs(downSum - pj) > 1e-6 * pj) faceSumBad++;
	if (row > 0 && Math.abs(upSum - pj) > 1e-6 * pj) faceSumBad++;
}
check.ok('neighbour links are symmetric (present both ways)', missing === 0, missing + ' missing');
check.ok('symmetric pairs carry the same face width', asymFace === 0, asymFace + ' mismatches');
check.ok('symmetric pairs carry the same centre distance', asymDist === 0, asymDist + ' mismatches');
check.ok('no cell is its own neighbour', self === 0, self + ' self links');
check.ok('every cell has left and right except the 1-cell bottom row',
	lrOk === 2 * (tot - 1), lrOk + '/' + 2 * (tot - 1));
check.ok('coarse-fine faces conserve the own pitch', faceSumBad === 0, faceSumBad + ' rows wrong');
check.ok('symmetric link count', sym % 2 === 0, sym + ' directed links');
// every non-edge row cell has a down neighbour, every non-top row cell an up neighbour
var downOk = 0, downWant = 0, upOk = 0, upWant = 0;
for (c = 0; c < tot; c++) {
	var rw = 0;
	while (GEO.fanOff[rw + 1] <= c) rw++;
	var hasD = nbr[c * 6 + 2] >= 0, hasU = nbr[c * 6 + 4] >= 0;
	if (rw + 1 < GEO.N) { downWant++; if (hasD) downOk++; }
	if (rw > 0) { upWant++; if (hasU) upOk++; }
}
check.ok('every interior cell has a down neighbour', downOk === downWant, downOk + '/' + downWant);
check.ok('every interior cell has an up neighbour', upOk === upWant, upOk + '/' + upWant);

check.section('D. display map and LUTs (design §1.4)');
var mapErr = 0;
for (i = 0; i <= 2000; i++) {
	var yy = -P.R + (P.R + P.skyTop) * i / 2000;
	var e = Math.abs(GEO.y(GEO.u(yy)) - yy) / Math.max(1, Math.abs(yy));
	if (e > mapErr) mapErr = e;
}
check.ok('|y(u(y)) - y| < 1e-12 rel', mapErr < 1e-12, 'max rel ' + mapErr.toExponential(2));
GEO.setPreset('def');
GEO.sync();
check.near('window top maps to canvas row 0', GEO.sy(P.winTop), 0, 1e-9, 'px');
check.near('window bottom maps to canvas row ch', GEO.sy(P.winBot), P.ch, 1e-9, 'px');
check.near('screen/world altitude maps are inverse', GEO.yAt(GEO.sy(-123e3)), -123e3, 1e-8, 'm');
check.ok('higher altitude maps toward canvas top', GEO.sy(1) < GEO.sy(0) && GEO.sy(0) < GEO.sy(-1));
var m2 = true;
for (i = 1; i < P.ch; i++) if (GEO.lutY[i] >= GEO.lutY[i - 1]) m2 = false;
check.ok('lutY strictly decreasing top -> down', m2);
check.near('lutY[0] = window top +33 km', GEO.lutY[0] / 1e3, 33, 1, 'km');
check.near('lutY[ch-1] = window bottom -300 km', GEO.lutY[P.ch - 1] / 1e3, -300, 1, 'km');
var xOk = true;
for (i = 0; i < P.cw; i++) {
	var want = GEO.wrapX(GEO.x0 + (i + 0.5) * GEO.kx);
	if (Math.abs(GEO.lutX[i] - want) > 1e-6) xOk = false;
}
check.ok('lutX filled across the full canvas width', xOk);
check.ok('lutX wrapped into [0, wrap)',
	GEO.lutX[0] >= 0 && GEO.lutX[P.cw - 1] < P.wrap,
	GEO.lutX[0] + ' .. ' + GEO.lutX[P.cw - 1]);
var rowOk = true;
for (i = 0; i < P.ch; i++) if (GEO.lutRow[i] !== GEO.rowOf(GEO.lutY[i])) rowOk = false;
check.ok('lutRow agrees with rowOf(lutY)', rowOk);
var fanOk = true;
for (i = 0; i < P.ch; i++) {
	r = GEO.lutRow[i];
	if (r < 0) { if (GEO.lutRowCnt[i] !== 1) fanOk = false; continue; }
	if (GEO.lutRowBase[i] !== GEO.fanOff[r] || GEO.lutRowCnt[i] !== GEO.fanN[r]) fanOk = false;
	if (Math.abs(GEO.lutRowInvP[i] - GEO.fanN[r] / P.wrap) > 1e-15) fanOk = false;
}
check.ok('per-row fan LUTs match the band tables', fanOk);
// --- the two rulers (design §1.4) ------------------------------------------------
// The scale lines are the readable form of the asinh map, so they are checked the way
// they are read: spacing, ordering, ladder membership and the label that sits on each.

var VIEWS = [
	['default', function () { GEO.setPreset('def'); }],
	['overview', function () { GEO.setPreset('ovw'); }],
	['crust x10', function () { GEO.setPreset('cru'); }],
	['basin x40', function () { GEO.setPreset('bas'); }],
	['deep window', function () { GEO.setPreset('def'); GEO.lookAt(0, GEO.u(-200e3), GEO.u(-1200e3)); }],
	['max zoom', function () { GEO.setPreset('bas'); GEO.setZoomX(P.zoomMax); GEO.setZoomY(P.zoomMax); }]
];

// k x 10^d for integer k in 1..9: the ladder membership of one value
function onLadder(v) {
	var a = Math.abs(v), d = Math.pow(10, Math.floor(Math.log10(a) + 1e-9));
	var k = Math.round(a / d);
	return k >= 1 && k <= 9 && Math.abs(k * d - a) < a * 1e-9;
}

// a line value a reader can say out loud: at most three significant digits
function roundValue(v) {
	var a = Math.abs(v), u = Math.pow(10, Math.floor(Math.log10(a) + 1e-9) - 2);
	return Math.abs(Math.round(a / u) * u - a) < a * 1e-9;
}

// the overlay's own label pass, captured through a stub context
function capture() {
	var out = { line: [], text: [], sea: -1 };
	RNDR.ctx = {
		beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, stroke: function () {},
		fillText: function (text, x, y) {
			if (text === '0 m sea level') { out.sea = y + 3; return; }
			out.text.push(text); out.line.push(y);
		}
	};
	RNDR.overlayGrid();
	RNDR.ctx = null;
	return out;
}

var vi, vname;
for (vi = 0; vi < VIEWS.length; vi++) {
	vname = VIEWS[vi][0];
	VIEWS[vi][1]();
	GEO.sync();
	var n = GEO.vgN, ordered = true, inWin = true, ladder = true, gap = Infinity, big = 0, prev = 0;
	for (i = 0; i < n; i++) {
		if (GEO.vgS[i] < 0 || GEO.vgS[i] > P.ch) inWin = false;
		if (!roundValue(GEO.vgY[i])) ladder = false;
		if (i > 0) {
			if (GEO.vgY[i] <= GEO.vgY[i - 1] || GEO.vgS[i] >= GEO.vgS[i - 1]) ordered = false;
			gap = Math.min(gap, GEO.vgS[i - 1] - GEO.vgS[i]);
		}
	}
	// largest strip of canvas with no altitude line, window edges included
	prev = P.ch;
	for (i = 0; i < n; i++) { big = Math.max(big, prev - GEO.vgS[i]); prev = GEO.vgS[i]; }
	big = Math.max(big, prev);
	check.ok(vname + ': altitude lines ordered, in window, round values',
		n > 2 && ordered && inWin && ladder, n + ' lines');
	check.ok(vname + ': altitude lines never crowd', gap >= P.gridGapY,
		'min gap ' + gap.toFixed(1) + ' px (limit ' + P.gridGapY + ')');
	check.ok(vname + ': altitude lines never leave a blank band', big <= 200,
		'largest blank ' + big.toFixed(0) + ' px');

	var hn = GEO.hgN, hOk = true, hGap = Infinity, hStep = 0;
	for (i = 0; i < hn; i++) {
		if (GEO.hgS[i] < -1 || GEO.hgS[i] > P.cw + 1) hOk = false;
		if (i > 0) {
			if (GEO.hgS[i] <= GEO.hgS[i - 1]) hOk = false;
			// a lap seam restarts the count, so only same-lap neighbours carry the step
			if (GEO.hgV[i] > GEO.hgV[i - 1]) {
				hStep = GEO.hgV[i] - GEO.hgV[i - 1];
				hGap = Math.min(hGap, GEO.hgS[i] - GEO.hgS[i - 1]);
			}
		}
	}
	check.ok(vname + ': distance lines ordered and in window', hn > 1 && hOk, hn + ' lines');
	check.ok(vname + ': distance step is a 1-2-5 decade, never crowding',
		hGap >= P.gridGapX && onLadder(hStep) && [1, 2, 5].indexOf(hStep / Math.pow(10, Math.floor(Math.log10(hStep) + 1e-9))) >= 0,
		'step ' + hStep + ' m = ' + hGap.toFixed(1) + ' px');

	var cap = capture();
	var labelled = 0, labelOk = true;
	for (i = 0; i < GEO.vgN; i++) if (GEO.vgS[i] >= 10 && GEO.vgS[i] <= P.ch - 6) labelled++;
	for (i = 0; i < GEO.hgN; i++) if (GEO.hgS[i] >= 2 && GEO.hgS[i] <= P.cw - 64) labelled++;
	if (cap.text.length !== labelled) labelOk = false;
	for (i = 0; i < cap.text.length; i++) if (!/^([+-]?\d+(\.\d+)? (m|km)|0)$/.test(cap.text[i])) labelOk = false;
	check.ok(vname + ': every on-screen line is labelled once, in m or km', labelOk,
		cap.text.length + '/' + labelled + '  ' + cap.text.slice(0, 4).join(' '));
}

// the labels of the default window, spelled out: signs, ladder, sea level on its line
GEO.setPreset('def'); GEO.sync();
var dcap = capture();
var signed = true, onLine = true;
for (i = 0; i < GEO.vgN; i++) {
	var want = (GEO.vgY[i] > 0 ? '+' : '-') +
		(Math.abs(GEO.vgY[i]) >= 1000 ? Math.abs(GEO.vgY[i]) / 1000 + ' km' : Math.abs(GEO.vgY[i]) + ' m');
	if (GEO.vgT[i] !== want) signed = false;
}
for (i = 0; i < dcap.line.length; i++) if (dcap.line[i] < 0 || dcap.line[i] > P.ch) onLine = false;
check.ok('altitude labels carry an explicit sign and the line value', signed,
	GEO.vgT.slice(0, GEO.vgN).join(' '));
check.ok('no label is drawn off the canvas', onLine);
check.near('sea-level label sits on its horizontal line', dcap.sea, GEO.sy(0), 1e-9, 'px');
check.ok('the scale-lines toggle removes every ruler line but keeps sea level', (function () {
	RNDR.showScale = false;
	var off = capture();
	RNDR.showScale = true;
	return off.text.length === 0 && Math.abs(off.sea - GEO.sy(0)) < 1e-9;
})());

// the rung choice is anchored at 0 m, so a pan slides the lines instead of reshuffling
GEO.setPreset('def'); GEO.sync();
var before = GEO.vgT.slice(0, GEO.vgN).join(' ');
GEO.panBy(0, 120); GEO.sync();
var after = GEO.vgT.slice(0, GEO.vgN).join(' ');
check.ok('a vertical pan keeps the same ladder rungs', after.length > 0 &&
	(before.indexOf(after) >= 0 || after.indexOf(before) >= 0 ||
		after.split(' ').every(function (t) { return before.indexOf(t) >= 0; })),
	before + '  ->  ' + after);

check.section('E. presets and camera');
check.near('default kx = winW/cw', GEO.kx, P.winW / P.cw, 1e-12);
GEO.setPreset('ovw'); GEO.sync();
check.near('overview keeps the default horizontal scale', GEO.kx, P.winW / P.cw, 1e-12);
check.near('overview fits the full depth', GEO.y(GEO.uB), -P.R, 1, 'm');
check.near('overview top is the sky band', GEO.y(GEO.uT), P.skyTop, 1, 'm');
GEO.setPreset('cru'); GEO.sync();
check.near('crust preset is x10', GEO.kx, P.winW / P.cw / 10, 1e-9);
GEO.setPreset('bas'); GEO.sync();
check.near('basin preset is x40', GEO.kx, P.winW / P.cw / 40, 1e-9);

// the two axis sliders: setZoom must read back exactly, so a slider can be driven from
// the camera without drifting, and the vertical one must not move the centred altitude
check.near('def reads back as zoom 1 on both axes',
	(function () { GEO.setPreset('def'); GEO.sync(); return GEO.zoomX() * GEO.zoomY(); })(), 1, 1e-12);
check.near('cru reads back as zoom 10 on both axes',
	(function () { GEO.setPreset('cru'); GEO.sync(); return GEO.zoomX() + GEO.zoomY(); })(), 20, 1e-9);
check.near('ovw reads back as the anisotropic preset', (function () {
	GEO.setPreset('ovw'); GEO.sync();
	return GEO.zoomX() - GEO.zoomY() / GEO.zoomYMin;
})(), 0, 1e-9);
var zRt = true, zCen = true, zi, zz, uc0;
GEO.setPreset('def'); GEO.sync();
for (zi = 0; zi <= 20; zi++) {
	zz = P.zoomMin * Math.pow(P.zoomMax / P.zoomMin, zi / 20);
	GEO.setZoomX(zz); GEO.sync();
	if (Math.abs(GEO.zoomX() - zz) > zz * 1e-12) zRt = false;
}
for (zi = 0; zi <= 20; zi++) {
	zz = GEO.zoomYMin * Math.pow(P.zoomMax / GEO.zoomYMin, zi / 20);
	uc0 = (P.view.uT + P.view.uB) / 2;
	GEO.setZoomY(zz); GEO.sync();
	if (Math.abs(GEO.zoomY() - zz) > zz * 1e-9) zRt = false;
	// zoomed out far enough the window hits the sky top and slides: only an unclamped
	// span can keep its centre
	if (P.view.uT < GEO.u(P.skyTop) - 1e-9 && P.view.uB > GEO.u(-P.R) + 1e-9 &&
		Math.abs((P.view.uT + P.view.uB) / 2 - uc0) > 1e-12) zCen = false;
}
check.ok('setZoomX / setZoomY read back over the whole slider sweep', zRt);
check.ok('vertical scale keeps the centred altitude while the window fits', zCen);
GEO.setZoomX(1e6); GEO.setZoomY(1e6); GEO.sync();
check.near('both axes clamp at zoomMax', GEO.zoomX() + GEO.zoomY(), 2 * P.zoomMax, 1e-9);
GEO.setZoomY(1e-6); GEO.sync();
check.near('vertical scale clamps at the whole planet', GEO.zoomY(), GEO.zoomYMin, 1e-9);
check.near('the whole planet is exactly sky top to center', GEO.y(GEO.uB), -P.R, 1, 'm');
// zoom about a cursor point must keep that world point fixed
GEO.setPreset('def'); GEO.sync();
var sx = 411.5, sy = 233.5;
var wx0 = GEO.xAt(sx), wy0 = GEO.yAt(sy);
GEO.zoomAt(1.7, sx, sy); GEO.sync();
check.near('zoom keeps the cursor world x fixed', GEO.wrapX(GEO.xAt(sx) - wx0 + P.wrap / 2) - P.wrap / 2, 0, 1e-6, 'm');
check.near('zoom keeps the cursor world y fixed', GEO.yAt(sy) - wy0, 0, 1e-9, 'm');
GEO.panBy(37, -19); GEO.sync();
check.near('pan moves x by -37 px', GEO.xAt(sx) - (wx0 - 37 * GEO.kx), 0, 1e-6, 'm');
// a stale camera must not be possible: every mover marks the view dirty
GEO.setPreset('def');
GEO.sync();
check.ok('sync clears the dirty flag', GEO.dirty === false);
GEO.lookAt(1234);
check.ok('lookAt marks the view dirty', GEO.dirty === true);
GEO.sync();
check.near('lookAt moved the window centre', P.view.cx, 1234, 1e-12);

check.section('F. column LUT vs brute-force owner');
SIM.reset();
function checkLUT(name, preset) {
	GEO.setPreset(preset); GEO.sync(); GEO.buildColLUT(S);
	var bad = 0;
	for (var px = 0; px < P.cw; px++) {
		if (GEO.lutCol[px] !== L.check.owner(S, GEO.x0 + (px + 0.5) * GEO.kx)) bad++;
	}
	check.ok(name, bad === 0, bad + '/' + P.cw + ' wrong owners');
}
checkLUT('default window', 'def');
checkLUT('overview', 'ovw');
checkLUT('crust x10', 'cru');
checkLUT('basin x40', 'bas');
// windows that straddle the x = 0 seam, and a window exactly one wrap wide
[0, 1, P.wrap - 1, P.wrap / 2, -P.wrap / 3, P.wrap * 3 + 7].forEach(function (cx, k) {
	GEO.lookAt(cx);
	checkLUT('seam window #' + k + ' (cx = ' + cx.toExponential(3) + ')', 'def');
});
P.view.kx = P.wrap / P.cw;
GEO.invalidate();
checkLUT('window exactly one wrap wide', 'def');
P.view.kx = P.winW / P.cw;
// non-uniform columns: perturb every other column, the walk must still be exact
var save = new Float64Array(S.colX);
for (i = 0; i < S.nCol; i += 2) S.colX[i] += 3e3 * ((i / 2) % 3 - 1);
S.colX.subarray(0, S.nCol).sort();
S.widths();
checkLUT('non-uniform perturbed columns', 'def');
checkLUT('non-uniform perturbed columns x40', 'bas');
S.colX.set(save);
S.widths();
// degenerate column counts
var n0 = S.nCol;
S.nCol = 1; S.colX[0] = 5e6; S.widths();
checkLUT('a single column', 'def');
S.nCol = 0;
GEO.buildColLUT(S);
var allEmpty = true;
for (i = 0; i < P.cw; i++) if (GEO.lutCol[i] !== -1) allEmpty = false;
check.ok('zero columns -> every pixel unowned', allEmpty);
S.nCol = n0;
S.colX.set(save);
S.widths();

check.done();
