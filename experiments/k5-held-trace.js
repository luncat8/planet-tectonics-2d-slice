'use strict';
// 0.1.11 trace (report only). Counts the transport-floor decisions where the closing-kind hold
// alone keeps a pair in the crush floor while its relative speed is past P.epsHi (opening), and
// lists the distinct ones within 120 km of a site and 25 frames of a frame. It needs the 0.1.11
// variant applied (experiments/logs/0.1.11-hysteresis-variants.patch, run with HYS_MODE=1); on
// the base engine it counts zero.
//
// usage: HYS_MODE=1 node experiments/k5-held-trace.js <seed> <kyrPerFrame> <frames> <siteKm> <frame>

var L = require('./lib.js');
var P = L.mods.params, COL = L.mods.columns, SIM = L.mods.sim;
var arg = process.argv.slice(2);
var seed = +arg[0], kyr = +arg[1], frames = +arg[2], siteKm = +arg[3], siteFrame = +arg[4];
var frame = 0, orig = COL.isClosingCC, seen = {}, total = 0, near = [];

COL.isClosingCC = function (st, i, j) {
	var closing = orig.call(this, st, i, j);
	var held = !this.floorClassValid && closing && st.colU[i] <= st.colU[j] &&
		st.edge[i] === P.EDGE.collide && st.edgeRPlate[i] === st.colPlate[j];
	var relN = st.colU[j] - st.colU[i];
	if (!held || relN <= P.epsHi) return closing;
	var key = frame + '/' + st.colX[i];
	if (seen[key]) return closing;
	seen[key] = true;
	total++;
	var xKm = st.colX[i] / 1e3;
	if (Math.abs(xKm - siteKm) < 120 && Math.abs(frame - siteFrame) < 25) {
		near.push('  frame ' + frame + ' x ' + xKm.toFixed(1) + ' km, opening ' +
			(relN / 1e3).toFixed(1) + ' mm/yr, felsic ' + (st.hFel[i] / 1e3).toFixed(1) + ' / ' +
			(st.hFel[j] / 1e3).toFixed(1) + ' km');
	}
	return closing;
};

L.check.planet(seed);
SIM.setGeo(kyr);
for (; frame < frames; frame++) SIM.step();
console.log('held-opening transport-floor pairs (distinct frame and column): ' + total);
console.log('within 120 km of x ' + siteKm + ' km and 25 frames of frame ' + siteFrame + ': ' + near.length);
near.slice(0, 10).forEach(function (line) { console.log(line); });
