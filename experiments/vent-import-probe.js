// vent-import-probe.js — dump the per-lithology ledger at each stage of the active-vent
// C4 import fixture (restore -> apply -> continued eruption), to locate any line that does
// not close. Probe only.
'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var COUP = M.coupling, SP = require('../port/slice-format.js');
var S = M.state, P = M.params, SIM = M.sim, SEED = M['section-seed'], COL = M.columns, SURF = M.surface, GEO = M.geom;
var MAG = M.magma, ERUPT = M.erupt, CP = M.checkpoint;
var FIX = require('./pack-fixture.js');
var KM = 1000;
var GLOBE_YR = 50e3;

function copy(msg) { return JSON.parse(COUP.json(msg)); }
function dump(tag, start) {
	var now = S.mass(), names = ['sed', 'fel', 'maf', 'teph', 'lava', 'sill'], l;
	console.log(tag);
	for (l = 0; l < P.LITH.n; l++) {
		var lhs = now[l] + S.ledCons[l] + S.ledDelam[l] + S.ledMixOut[l];
		var rhs = (start ? start[l] : 0) + S.ledProd[l] + S.ledMixIn[l];
		var err = start ? Math.abs(lhs - rhs) / Math.max(1, rhs) : 0;
		console.log('  ' + names[l] + '  mass ' + (now[l] / 1e6).toFixed(3) + 'e6  cons ' + (S.ledCons[l] / 1e6).toFixed(3) +
			'  delam ' + (S.ledDelam[l] / 1e6).toFixed(3) + '  mixOut ' + (S.ledMixOut[l] / 1e6).toFixed(3) +
			'  prod ' + (S.ledProd[l] / 1e6).toFixed(3) + '  mixIn ' + (S.ledMixIn[l] / 1e6).toFixed(3) +
			(start ? '  | start ' + (start[l] / 1e6).toFixed(3) + '  err ' + err.toExponential(2) : ''));
	}
}

var pack0 = FIX.pinned();
check.planet(1);
var laid = SEED.layout(pack0, { seed: P.seed, t: pack0.source.tMyr, Tm: P.Tm0 });
if (laid) throw new Error(laid);
SIM.t = pack0.source.tMyr; SIM.cool();
P.sl.geo = GLOBE_YR; P.sl.erupt = 14400;
SIM.setGeo(GLOBE_YR);
SIM.run(40);
var vc = 0, vv = -1, vf = 0;
while (vc < S.nCol && S.colGhost[vc]) vc++;
MAG.add(S, vc, P.VbirthM2 * 1.6, false);
while (S.volc[vc] < 0 && vf++ < 60) MAG.k7(S, 0.05, SIM.t, SIM.Tm);
vv = S.volc[vc];
S.venGas[vv] = 0.9;
vf = 0;
while (vf++ < 200 && !(S.prN[vv] > 0 && S.venCol[vv] >= 0 && ERUPT.mass(vv) > 1)) {
	if (S.colChamber[vc] + S.venV[vv] < P.VbirthM2) MAG.add(S, vc, P.VbirthM2, false);
	MAG.k7(S, 0.05, SIM.t, SIM.Tm);
}
console.log('vent ' + vv + ' col ' + S.venCol[vv] + ' packets ' + S.prN[vv] +
	' toyMass ' + ERUPT.mass(vv).toFixed(3) + ' fed ' + S.venToyIn[vv].toFixed(1) +
	' queues ' + (S.venLava[vv] + S.venTephra[vv]).toFixed(3));
var venCol0 = S.venCol[vv], hTot0 = S.hTot[venCol0];
var chamberSum0 = 0, ci;
for (ci = 0; ci < S.nCol; ci++) chamberSum0 += S.colChamber[ci];
dump('A. at the import moment (pre-save)', null);
var jsonV = JSON.stringify(CP.saveSession(), null, 1), hSaveV = S.hash();
CP.loadSession(jsonV);
console.log('restore hash match: ' + (S.hash() === hSaveV));
var startA = S.mass().slice();
var ventPack = SEED.exportSection({ pack: 'coupling-apply-vent' });
var ventMsg = COUP.fromPack(ventPack, { pathChecksum: COUP.pathChecksum(pack0) });
var ventGrow = copy(ventMsg), growV = 250, growVolV = 0, i;
for (i = 0; i < ventGrow.crust.length; i++) {
	ventGrow.crust[i].hFelM += growV;
	growVolV += growV * (ventGrow.crust[i].s1Km - ventGrow.crust[i].s0Km) * KM;
}
ventGrow.ledger.fel = SP.round(ventGrow.ledger.fel + growVolV);
ventGrow.checksum = COUP.checksum(ventGrow);
var appliedV = COUP.apply(S, ventGrow, { nCut: S.nCol, cellKm: P.w0 / KM,
	pathChecksum: ventGrow.pathChecksum, pack: pack0 });
console.log('apply: ' + (appliedV || 'OK') + '  identityError ' + COUP.last.identityError.toExponential(2) +
	'  added ' + (COUP.last.added / 1e6).toFixed(3) + 'e6  removed ' + (COUP.last.removed / 1e6).toFixed(3) + 'e6');
console.log('vent col ' + venCol0 + ' hFel ' + S.hFel[venCol0] + ' hTot ' + (hTot0 / 1e3).toFixed(6) +
	' -> ' + (S.hTot[venCol0] / 1e3).toFixed(6) + ' km (delta ' + (S.hTot[venCol0] - hTot0).toFixed(6) +
	' m, want ' + growV + ')');
var chamberSum1 = 0;
for (ci = 0; ci < S.nCol; ci++) chamberSum1 += S.colChamber[ci];
console.log('chamber sum ' + (chamberSum0 / 1e6).toFixed(6) + ' -> ' + (chamberSum1 / 1e6).toFixed(6) + 'e6 m2');
dump('B. after the apply (vs pre-apply)', startA);
var startB = S.mass().slice();
SIM.run(400);
dump('C. after 400 erupted frames (vs post-apply)', startB);
dump('D. after 400 erupted frames (vs pre-apply, the import is external)', startA);
console.log('vent ' + vv + ' alive: col ' + S.venCol[vv] + ' queues ' + (S.venLava[vv] + S.venTephra[vv]).toFixed(6) +
	' edV ' + S.venEdV[vv].toFixed(0) + ' placed ' + (S.venToyOut[vv] * P.toyCellM2).toFixed(0));
