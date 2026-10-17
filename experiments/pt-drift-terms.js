// pt-drift-terms.js — 0.3.2 M11: kinematic drive and contact projection attribution
//
// Instruments the terms that determine plate velocity on a specific frame and world:
//   1. Raw flow advection (mass-weighted mean flow at cluster markers)
//   2. Slab pull drive (kSlab * csS / csM)
//   3. Ridge push drive (kPush * csP / csM)
//   4. Pre-brake rigid velocity (sum of advection + drives)
//   5. Contact projection:
//      - subduction override hold brake (dv = -ctV on override plate)
//      - arrest balanced impulse (canceling closing rate by mass share)
//   6. Post-brake rigid velocity and post-projection marker drift
//   7. Contact boundary inventory (sites, closing rates, dT, regime, override identification)
//   8. Surrounding thermal and lid geometry
//
// Run: node experiments/pt-drift-terms.js [--seed N] [--unbound] [--span 490..515] [--out file.json]
'use strict';

var fs = require('fs');
var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), G = require(B + 'grid.js');
var CONTACT = require(B + 'contact.js'), SC = require(B + 'solid.js');

function option(name) {
	var i = process.argv.indexOf(name);
	return i < 0 ? null : process.argv[i + 1];
}

var UNBOUND = process.argv.includes('--unbound');
var SEED = option('--seed') ? +option('--seed') : 1;
var SPAN = option('--span') ? option('--span').split('..').map(Number) : [490, 515];
var OUT = option('--out');

P.ic = 'cool'; P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = SEED;
P.solid = true; P.sl.kyr = 50;
P.ero = true;
P.depBound = UNBOUND ? 0 : 0.25;

SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M;

var preBrakeVX = new Float64Array(1024);
var postBrakeVX = new Float64Array(1024);
var brakeDV = new Float64Array(1024);
var holdCount = new Int32Array(1024);
var arrestCount = new Int32Array(1024);
var lastContactLog = [];

var origDetect = CONTACT.detect;
var origBrake = CONTACT.brake;

CONTACT.detect = function (M, S, dt) {
	for (var c = 0; c < S.csN; c++) {
		preBrakeVX[c] = S.csVX[c];
		holdCount[c] = 0;
		arrestCount[c] = 0;
	}
	lastContactLog.length = 0;
	origDetect.call(CONTACT, M, S, dt);
	var nx = M.nx, dx = M.dx, K = P.ctTop;
	for (var i = 0; i < nx; i++) {
		var ip = i + 1 === nx ? 0 : i + 1;
		for (var a = 0; a < S.ctN[i]; a++) {
			for (var b = 0; b < S.ctN[ip]; b++) {
				var ca = S.ctCl[i * K + a], cb = S.ctCl[ip * K + b];
				if (ca === cb) continue;
				var closing = (S.ctV[i * K + a] - S.ctV[ip * K + b]) / dx;
				if (closing <= P.contactYield) continue;
				var dT = S.ctT[i * K + a] - S.ctT[ip * K + b];
				var regime = Math.abs(dT) < P.contactdT ? 'arrest' : 'subduction';
				var sub = dT >= 0 ? 1 : 0;
				if (regime === 'arrest') {
					arrestCount[ca]++; arrestCount[cb]++;
				} else {
					if (sub === 0) holdCount[cb]++;
					else holdCount[ca]++;
				}
				lastContactLog.push({
					colA: i, colB: ip, xA: i * dx, xB: ip * dx,
					ca: ca, cb: cb,
					vA: S.ctV[i * K + a] * P.cmYr,
					vB: S.ctV[ip * K + b] * P.cmYr,
					closing_cmYr: closing * dx * P.cmYr,
					closing_rate: closing,
					dT: dT,
					regime: regime,
					sub: sub,
					override: regime === 'subduction' ? (sub === 0 ? cb : ca) : null,
					subducting: regime === 'subduction' ? (sub === 0 ? ca : cb) : null
				});
			}
		}
	}
};

CONTACT.brake = function (M, S) {
	for (var c = 0; c < S.csN; c++) {
		if (S.csBN[c]) brakeDV[c] = S.csBX[c] / S.csBN[c];
		else brakeDV[c] = 0;
	}
	origBrake.call(CONTACT, M, S);
	for (var c = 0; c < S.csN; c++) {
		postBrakeVX[c] = S.csVX[c];
	}
};

var startFrame = Math.round(SPAN[0] / SIM.dt);
var endFrame = Math.round(SPAN[1] / SIM.dt);
var ringR2 = P.ringMax * M.wrap * M.wrap;

console.log('pt-drift-terms: seed ' + SEED + ' (' + (UNBOUND ? 'unbound' : 'bound') + '), stepping to frame ' + startFrame + ' (' + SPAN[0] + ' Myr)...');
while (SIM.frame < startFrame) SIM.step();

var records = [];
var target500 = null;

for (var f = startFrame; f <= endFrame; f++) {
	SIM.step();
	var t = SIM.t;
	var is500 = (Math.abs(t - 500.0) < 0.06);

	for (var c = 0; c < S.csN; c++) {
		if (S.csCnt[c] < P.plateMin) continue;
		var pull = (P.kSlab > 0 && S.csR2[c] < ringR2 * S.csM[c]) ? P.kSlab * (S.csS[c] / S.csM[c]) : 0;
		var push = (P.kPush > 0) ? P.kPush * (S.csP[c] / S.csM[c]) : 0;
		var raw = preBrakeVX[c] - pull - push;
		var preSp = Math.hypot(preBrakeVX[c], S.csVY[c]) * P.cmYr;
		var postSp = Math.hypot(postBrakeVX[c], S.csVY[c]) * P.cmYr;

		// Footprint
		var xMin = 1e9, xMax = -1e9, yMin = 1e9, yMax = -1e9;
		var sumM = 0, sumMVx = 0, sumMVy = 0;
		for (var p = 0; p < S.n; p++) {
			if (S.cl[p] === c) {
				if (S.x[p] < xMin) xMin = S.x[p];
				if (S.x[p] > xMax) xMax = S.x[p];
				if (S.y[p] < yMin) yMin = S.y[p];
				if (S.y[p] > yMax) yMax = S.y[p];
				sumM += S.m[p];
				sumMVx += S.m[p] * S.vx[p];
				sumMVy += S.m[p] * S.vy[p];
			}
		}
		var driftSpeed = sumM > 0 ? (Math.hypot(sumMVx, sumMVy) / sumM * P.cmYr) : 0;

		var rec = {
			frame: f, t: t, c: c, cnt: S.csCnt[c], mass: S.csM[c],
			x0: xMin, x1: xMax, y0: yMin, y1: yMax,
			csX: S.csX[c], csY: S.csY[c],
			rawFlow_cmYr: raw * P.cmYr,
			slabPull_cmYr: pull * P.cmYr,
			ridgePush_cmYr: push * P.cmYr,
			preBrake_cmYr: preBrakeVX[c] * P.cmYr,
			brakeDV_cmYr: brakeDV[c] * P.cmYr,
			postBrake_cmYr: postBrakeVX[c] * P.cmYr,
			csVY_cmYr: S.csVY[c] * P.cmYr,
			csW: S.csW[c],
			drift_cmYr: driftSpeed,
			holds: holdCount[c],
			arrests: arrestCount[c],
			contacts: lastContactLog.filter(function (ct) { return ct.ca === c || ct.cb === c; })
		};
		records.push(rec);

		if (is500 && (!target500 || rec.cnt > target500.cnt)) {
			target500 = rec;
		}
	}
}

console.log('\n--- SLOW PLATE AT 500 Myr INSTRUMENTATION ---');
if (target500) {
	console.log('Frame: ' + target500.frame + ' (t = ' + target500.t.toFixed(2) + ' Myr)');
	console.log('Plate cluster: ' + target500.c + ' (' + target500.cnt + ' markers, mass ' + target500.mass.toFixed(1) + ')');
	console.log('Footprint: x in [' + target500.x0.toFixed(1) + ', ' + target500.x1.toFixed(1) + '] km, y in [' + target500.y0.toFixed(1) + ', ' + target500.y1.toFixed(1) + '] km');
	console.log('Centroid: (' + target500.csX.toFixed(1) + ', ' + target500.csY.toFixed(1) + ') km');
	console.log('Kinematic drives:');
	console.log('  Mantle traction (raw flow): ' + target500.rawFlow_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Slab pull drive:            ' + target500.slabPull_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Ridge push drive:           ' + target500.ridgePush_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Net pre-brake velocity:     ' + target500.preBrake_cmYr.toFixed(4) + ' cm/yr');
	console.log('Contact projection:');
	console.log('  Subduction hold count:      ' + target500.holds);
	console.log('  Arrest count:               ' + target500.arrests);
	console.log('  Contact brake impulse (dv): ' + target500.brakeDV_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Post-brake rigid vx:        ' + target500.postBrake_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Vertical velocity (vy):     ' + target500.csVY_cmYr.toFixed(4) + ' cm/yr');
	console.log('  Net marker drift speed:     ' + target500.drift_cmYr.toFixed(4) + ' cm/yr');
	console.log('Contact boundaries:');
	target500.contacts.forEach(function (ct) {
		console.log('  Site x=' + ct.xA.toFixed(1) + '..' + ct.xB.toFixed(1) + ' (cols ' + ct.colA + '-' + ct.colB + '): ca=' + ct.ca + ' cb=' + ct.cb
			+ ' closing=' + ct.closing_cmYr.toFixed(3) + ' cm/yr dT=' + ct.dT.toFixed(3)
			+ ' regime=' + ct.regime + ' override=c' + ct.override + ' subducting=c' + ct.subducting);
	});
} else {
	console.log('No qualifying plate found at 500 Myr!');
}

if (OUT) {
	fs.writeFileSync(OUT, JSON.stringify({
		seed: SEED, unbound: UNBOUND, span: SPAN,
		target500: target500, records: records
	}, null, '\t') + '\n');
	console.log('\nWrote records to ' + OUT);
}
