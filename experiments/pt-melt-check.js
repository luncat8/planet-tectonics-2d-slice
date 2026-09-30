// pt-melt-check.js — P1's pressure-release melt indicator.
//
// This is intentionally not P3 magma conservation. It verifies the narrower contract added
// to the fluid-only world: no flow means no melt indicator; hot upward mantle produces a
// shallow, visible indicator; and enabling it does not alter the one-phase thermal solution.
//
// Run: node experiments/pt-melt-check.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');

function configure(proxy) {
	P.wrap = 8000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 128; P.mesh.ny = 48;
	P.mpc = 4; P.partCap = 32768;
	P.ic = 'cool'; P.flip = 1;
	P.icMode = 1; P.icAmp = 0.02; P.icBand = 0;   // the validated draw; the demo's planet uses other modes
	P.solid = false;          // this fixture gates the fluid pipeline alone (pt-crust.js has the solid one)
	P.Ra = 1e6;
	P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.meltProxy = proxy;
	P.sl.kyr = 50;
	SIM.init();
	SIM.reset();
	SIM.dt = 0.05;
}

function run(myr) {
	var n = Math.round(myr / SIM.dt);
	SIM.run(n);
	return { hash: S.hash(), ledger: S.ledger, melt: S.d.melt, meltY: S.d.meltY };
}

console.log('  melt indicator: 128x48, 4 markers/node, cool start\n');

check.section('the source needs upward flow');
configure(true);
var kFlow = SIM.k[2];
SIM.k[2] = null;
run(2);
check.near('conduction without a Stokes flow makes no melt indicator', S.d.melt, 0, 0);
SIM.k[2] = kFlow;

check.section('hot upwelling and pressure release');
configure(true);
var hot = run(160);
console.log('  t 160 Myr: melt* ' + hot.melt.toFixed(3) + ' at ' + hot.meltY.toFixed(0) + ' km');
check.ok('a hot upward pathway creates a visible melt indicator', hot.melt > 0.10, 'melt* ' + hot.melt.toFixed(3));
check.ok('the indicator stays in the shallow decompression window',
	hot.meltY >= P.meltTop && hot.meltY < 250, hot.meltY.toFixed(0) + ' km');
var capClear = true;
for (var j = 1; j < SIM.M.ny; j++) if (SIM.M.yN[j] <= P.meltTop) {
	for (var i = 0; i < SIM.M.nx; i++) if (S.Mg[j * SIM.M.nx + i] !== 0) capClear = false;
}
check.ok('melt is extracted before reaching the surface cap', capClear);

check.section('it is diagnostic until P3');
configure(true);
var withProxy = run(20);
configure(false);
var withoutProxy = run(20);
check.near('the indicator does not alter thermal marker motion', withProxy.hash, withoutProxy.hash, 0);
check.near('the indicator does not alter the heat ledger', withProxy.ledger, withoutProxy.ledger, 0, 'km2*T');
check.near('disabled indicator remains empty', withoutProxy.melt, 0, 0);

check.done();
