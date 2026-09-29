// pt-stability.js — regression fixture for the P1 long-run repair and clock integrator.
//
// The original 4-marker cloud reached its first marginal transfer hole at about 135 Myr.
// Repair looked at nearest-node occupancy instead of the quadratic deposit, moved dozens of
// otherwise useful markers, and eventually re-dealt the lattice around 170 Myr. This fixture
// runs through that interval twice: once at the native 50 kyr fluid step and once through the
// 500 kyr display clock. The latter must be exactly ten of the former internally, not a
// different noisy trajectory.
//
// Run: node experiments/pt-stability.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var END = 180;

function configure(kyr) {
	P.wrap = 8000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 128; P.mesh.ny = 48;
	P.mpc = 4; P.partCap = 32768;
	P.ic = 'cool'; P.flip = 1;
	P.Ra = 1e6;
	P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = kyr;
}

function run(kyr) {
	var n, i, lo = Infinity, hi = -Infinity, empty = 0, moved = 0;
	configure(kyr);
	SIM.init();
	SIM.reset();
	SIM.dt = kyr / 1000;
	n = Math.round(END / SIM.dt);
	for (i = 0; i < n; i++) {
		SIM.step();
		if (S.d.tMin < lo) lo = S.d.tMin;
		if (S.d.tMax > hi) hi = S.d.tMax;
		if (S.empty > empty) empty = S.empty;
		if (S.moved > moved) moved = S.moved;
	}
	return {
		frame: SIM.frame, sub: SIM.sub, t: SIM.t,
		hash: S.hash(), ledger: S.ledger, wall: S.wall, heat: S.d.heat,
		nu: S.d.nu, u: S.d.uMax, v: S.d.vMax, melt: S.d.melt, meltY: S.d.meltY,
		empty: empty, moved: moved, redeals: S.redeals, lo: lo, hi: hi
	};
}

function line(name, r) {
	console.log('  ' + name + ': t ' + r.t.toFixed(0) + ' Myr, outer frames ' + r.frame
		+ ', fluid ' + r.sub + 'x, Nu ' + r.nu.toFixed(2) + ', T ' + r.lo.toFixed(3) + '..' + r.hi.toFixed(3)
		+ ', holes ' + r.empty + ', moved ' + r.moved + ', redeals ' + r.redeals);
}

console.log('  stability: 128x48, 4 markers/node, cool start, through ' + END + ' Myr\n');
var native = run(50);
var fast = run(500);
line('50 kyr/f', native);
line('500 kyr/f', fast);

check.section('long-run coverage repair');
check.ok('the native clock does not globally re-deal the cloud', native.redeals === 0, 'redeals ' + native.redeals);
check.ok('the native clock repairs only actual transfer holes', native.empty <= 2 && native.moved <= 2,
	'holes ' + native.empty + '   moved ' + native.moved);
check.ok('the field remains bounded through the former transition', native.lo > -0.15 && native.hi < 1.10,
	'T ' + native.lo.toFixed(3) + '..' + native.hi.toFixed(3));

check.section('clock invariance');
check.ok('500 kyr/f uses ten fluid substeps', fast.sub === 10, 'fluid ' + fast.sub + 'x');
check.ok('the fast clock does not globally re-deal the cloud', fast.redeals === 0, 'redeals ' + fast.redeals);
check.near('the two clocks end at the same marker state', fast.hash, native.hash, 0);
check.near('the two clocks carry the same heat ledger', fast.ledger, native.ledger, 0, 'km2*T');
check.near('the two clocks read the same wall ledger', fast.wall, native.wall, 0, 'km2*T');
check.near('the two clocks give the same Nusselt number', fast.nu, native.nu, 0);
check.near('the two clocks give the same peak vertical speed', fast.v, native.v, 0, 'cm/yr');
check.near('the two clocks give the same melt indicator', fast.melt, native.melt, 0);
check.near('the two clocks extract it at the same depth', fast.meltY, native.meltY, 0, 'km');

check.done();
