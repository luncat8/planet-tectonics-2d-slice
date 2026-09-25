// view-check.js — the geometry, the fan stencil and the LUTs against the design
// §1.2/§1.3/§1.4 tables. Loads the shipped js/ in index.html order through lib.js.
// Run: node experiments/view-check.js
'use strict';

var L = require('./lib.js');
var check = L.check;
var P = L.mods.params, GEO = L.mods.geom, S = L.mods.state, SIM = L.mods.sim;

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
