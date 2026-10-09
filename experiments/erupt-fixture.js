// Shared, mass-booked eruptive fixtures for the M2 and raster benches.
'use strict';
var L = require('./lib.js'), M = L.mods;
var P = M.params, S = M.state, COL = M.columns, SURF = M.surface;
var ERUPT = M.erupt, SIM = M.sim, GEO = M.geom;

function fresh(c) {
	P.seed = 1; P.sl.geo = 0; P.sl.erupt = 1800;
	SIM.reset();
	S.nPl = 1; S.plN.fill(0); S.plN[0] = S.nCol; S.colPlate.fill(0);
	S.nPlm = 0; S.nRib = 0;
	for (var i = 0; i < S.nCol; i++) {
		S.colNL[i] = 0; S.colAge[i] = 100; S.noise[i] = 0; S.zDyn[i] = 0;
		COL.push(i, 7000, P.LITH.maf, 0, 0); COL.push(i, 35000, P.LITH.fel, 0, 0);
		COL.sums(i); S.zDyn[i] = -SURF.elev(i);
		S.z[i] = 0; S.hDraw[i] = S.hTot[i]; S.wet[i] = 0; S.slope[i] = 0;
	}
	SIM.t = 42; SIM.cool(); SIM.setGeo(0);
	GEO.setPreset('def'); GEO.lookAt(S.colX[c === undefined ? 100 : c]);
	GEO.sync(); GEO.buildColLUT(S);
}

function vent(c, v, gas) {
	S.nVen = Math.max(S.nVen, v + 1);
	S.volc[c] = v; S.venCol[v] = c; S.venEdCol[v] = c; S.venX[v] = S.colX[c];
	S.venStyle[v] = gas > P.gasBlast ? 3 : 1; S.venGas[v] = gas;
	ERUPT.reset(v);
}

function molten(v, cells, lith, temp) {
	S.ledProd[P.LITH.maf] += cells * P.toyCellM2; S.venToyIn[v] += cells;
	ERUPT.addMolten(ERUPT.at(v, P.ventBoxW >> 1), cells, temp === undefined ? 1 : temp, lith);
}

function packet(v, cells) {
	S.ledProd[P.LITH.maf] += cells * P.toyCellM2; S.venToyIn[v] += cells;
	return ERUPT.launch(v, cells);
}

function active16() {
	fresh(115);
	for (var v = 0; v < P.maxVents; v++) {
		vent(100 + 2 * v, v, v % 2 ? 0.5 : 0.1);
		S.venFlux[v] = 150 / 7200; S.venBlast[v] = v % 2;
		S.ledProd[P.LITH.maf] += 150 * P.toyCellM2;
		ERUPT.step(7200, v); ERUPT.writeBack(v, SIM.t);
		S.venFlux[v] = 0;
		ERUPT.step(18000, v); ERUPT.writeBack(v, SIM.t); ERUPT.record(v);
		packet(v, 0.01); S.prT[v * P.partCap] = 5;
	}
	GEO.buildColLUT(S);
}

module.exports = { fresh: fresh, vent: vent, molten: molten, packet: packet, active16: active16 };
