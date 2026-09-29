// pt-asymmetry-check.js — reduced-order plume/return-flow asymmetry.
//
// Run: node experiments/pt-asymmetry-check.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), G = require(B + 'grid.js');
var M = G.alloc(G.mesh(64, 16, 8000, 2900, 40));
var T = new Float64Array(M.n), u = new Float64Array(M.ny * M.nx), v = new Float64Array(M.n);
var inc = new Float64Array(M.n), base, i, j, lo, sum0, sum1;

console.log('  upwelling/downwelling asymmetry: 64x16 test mesh\n');
check.section('hot upwellings receive additional buoyancy');
for (j = 0; j <= M.ny; j++) {
	base = j * M.nx;
	for (i = 0; i < M.nx; i++) T[base + i] = j / M.ny + 0.08 * Math.sin(2 * Math.PI * i / M.nx);
}
var boost = P.upwellBuoyancyBoost;
P.upwellBuoyancyBoost = 0;
G.stokes(M, T, u, v, P.RaK);
var plain = 0;
for (i = 0; i < v.length; i++) if (Math.abs(v[i]) > plain) plain = Math.abs(v[i]);
P.upwellBuoyancyBoost = boost;
G.stokes(M, T, u, v, P.RaK);
var enhanced = 0;
for (i = 0; i < v.length; i++) if (Math.abs(v[i]) > enhanced) enhanced = Math.abs(v[i]);
check.ok('hot-anomaly buoyancy increases peak vertical speed', enhanced > plain,
	plain.toExponential(2) + ' -> ' + enhanced.toExponential(2));

check.section('cold fingers receive conservative lateral mixing');
for (j = 0; j <= M.ny; j++) {
	base = j * M.nx;
	for (i = 0; i < M.nx; i++) T[base + i] = j / M.ny;
}
base = 6 * M.nx; T[base + 8] = 0.05;
for (j = 0; j < 100; j++) G.diffuse(M, T, 0.05, P.kappa, inc);
lo = 1; sum0 = 0;
for (i = 0; i < M.nx; i++) {
	if (T[base + i] < lo) lo = T[base + i];
	sum0 += T[base + i];
}
var loMixed = lo;

P.downwellMix = 0;
for (j = 0; j <= M.ny; j++) {
	base = j * M.nx;
	for (i = 0; i < M.nx; i++) T[base + i] = j / M.ny;
}
base = 6 * M.nx; T[base + 8] = 0.05;
for (j = 0; j < 100; j++) G.diffuse(M, T, 0.05, P.kappa, inc);
var loPlain = 1; sum1 = 0;
for (i = 0; i < M.nx; i++) {
	if (T[base + i] < loPlain) loPlain = T[base + i];
	sum1 += T[base + i];
}
check.near('cold mixing conserves each row integral', sum0, sum1, 1e-10);
check.ok('cold anomaly is less concentrated than ordinary thermal diffusion', loMixed > loPlain,
	loPlain.toFixed(4) + ' -> ' + loMixed.toFixed(4));

check.done();
