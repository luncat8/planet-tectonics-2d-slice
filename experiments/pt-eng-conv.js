// pt-eng-conv.js — 0.3.0 P1: the engine against the clock (plan §8's gate).
//
// pt-conv.js is the reference: a uniform 4:1 box, a spectral-tridiagonal Stokes solve and a
// semi-Lagrangian temperature step, with the nondimensional velocity unit calibrated in cm/yr
// (CM_YR_PER_ND). This script runs the *real frame pipeline* in that box -- as close as the
// asinh mesh can be made to a uniform one, yLin = depth -- and compares the three numbers the
// plan's §7 table quotes: Nu, max|u|, upwellings.
//
// Three caveats are printed with the result rather than hidden:
//
//   - the engine runs 2400 frames (120 Myr) because that is as far as a fixture can afford;
//     the reference is quoted at its statistical steady state (t = 0.5 diffusion times). The
//     comparison is therefore an order check on Nu and the velocity scale, gated at 25% and
//     35%, not an equality check;
//   - the velocities are compared *nondimensionally*: the engine's cm/yr carries its own
//     depth (kappa/depth), so the two boxes do not share a cm/yr. pt-conv's own table in
//     cm/yr assumes a 1000 km deep box; the plan's §7 table inherits that and is corrected
//     in the plan to quote the engine's depth;
//   - the 2400-frame state is the spin-up, not the engine's settled convection (measured
//     separately: at matched nondimensional time the engine wanders around Nu ~15 and
//     u_nd ~1500 against the reference's 27.45 and 3562, about 2x weak in both, and marker
//     density does not close it -- see archive/0.3.0-p2.1-crust-worklog.md). The gate is
//     exactly the snapshot plan §8 recorded for P1, so it catches regressions of that state.
//
// Everything the comparison touches is pinned here (box, Ra, IC, perturbation): the demo's
// planet settings are not this box's settings.
//
// Run: node experiments/pt-eng-conv.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var conv = require('./pt-conv.js');
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), G = require(B + 'grid.js'), S = require(B + 'state.js');
var F = require(B + 'fluid.js'), SIM = require(B + 'sim.js');

var RA = 1e6, ASPECT = 4, NX = 128, NY = 48, FRAMES = 2400;

console.log('  reference: pt-conv.js, ' + NX + 'x' + NY + ', aspect ' + ASPECT + ', Ra ' + RA.toExponential(0));
var ref = conv.convect(RA, 0.5, NX, NY, ASPECT, false);
var refU = ref.mu * conv.CM_YR_PER_ND;                 // cm/yr in the reference's 1000 km box
console.log('    t ' + ref.t.toFixed(3) + ' diffusion times:  Nu ' + ref.nu.toFixed(2) + '  max|u| ' + ref.mu.toFixed(0)
	+ ' nd = ' + refU.toFixed(2) + ' cm/yr (D = 1000 km)  upwellings ' + ref.wells + '\n');

// the engine in the same box: wrap = aspect * depth, yLin = depth makes the asinh mesh as
// uniform as it can be (J varies by cosh(asinh(1)) = 1.41 across the depth), the marker
// count is the demo's, and the perturbation is the reference's own (mode 1, amp 0.02)
P.wrap = ASPECT * P.depth;
P.yLin = P.depth;
P.mesh.nx = NX; P.mesh.ny = NY;
P.solid = false;                 // pt-conv.js's reference is one-phase fluid, no lid
P.ic = 'rb';
P.icMode = 1; P.icBand = 0;
P.icAmp = 0.02;
P.Ra = RA;
P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
P.view.cx = P.wrap / 2;

console.log('  engine: ' + NX + 'x' + NY + ', aspect ' + ASPECT + ', yLin = depth, ' + P.mpc + ' markers/node');
SIM.init(); SIM.reset();
SIM.run(1);
var t0 = Date.now(), k;
for (k = 1; k <= FRAMES / 200; k++) SIM.run(200);
var ms = (Date.now() - t0) / FRAMES;
var uScale = P.kappa / P.depth * P.cmYr;               // 1 nd velocity unit in cm/yr for the engine's depth
var engU = S.d.uMax / uScale;

console.log('    t ' + SIM.t.toFixed(0) + ' Myr (' + FRAMES + ' frames, ' + ms.toFixed(2) + ' ms/frame):'
	+ '  Nu ' + S.d.nu.toFixed(2) + '  max|u| ' + S.d.uMax.toFixed(2) + ' cm/yr = ' + engU.toFixed(0) + ' nd'
	+ '  upwellings ' + S.d.wells + '  T ' + S.d.tMin.toFixed(3) + '..' + S.d.tMax.toFixed(3) + '\n');

check.section('engine vs the clock');
check.ok('the engine convects at all', S.d.nu > 2, 'Nu ' + S.d.nu.toFixed(2));
check.ok('Nu is within 25% of the reference', Math.abs(S.d.nu / ref.nu - 1) < 0.25,
	'engine ' + S.d.nu.toFixed(2) + '  reference ' + ref.nu.toFixed(2) + '  (' + ((S.d.nu / ref.nu - 1) * 100).toFixed(1) + '%)');
check.ok('the velocity scale is within 35% of the reference', Math.abs(engU / ref.mu - 1) < 0.35,
	'engine ' + engU.toFixed(0) + ' nd  reference ' + ref.mu.toFixed(0) + ' nd  (' + ((engU / ref.mu - 1) * 100).toFixed(1) + '%)');
check.ok('the plan\'s §7 velocity target is the reference\'s own depth scale',
	Math.abs(refU - 11) < 2, 'pt-conv ' + refU.toFixed(2) + ' cm/yr at D = 1000 km;  the engine\'s D = '
	+ P.depth + ' km gives ' + (ref.mu * uScale).toFixed(2) + ' cm/yr for the same nondimensional flow');
check.ok('both count upwellings of the same order', Math.abs(S.d.wells - ref.wells) <= 2,
	'engine ' + S.d.wells + '  reference ' + ref.wells);

check.done();
