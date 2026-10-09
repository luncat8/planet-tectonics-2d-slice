// 0.2.0 M4 save/load: the JSON session over every typed array and scalar, and the plan's
// done protocol -- save -> reload -> 1000 frames bitwise, at two different zoom levels and
// with an active eruption at save time. Run: node experiments/save-bench.js
'use strict';
var L = require('./lib.js'), check = L.check, M = L.mods;
var P = M.params, S = M.state, SIM = M.sim, CP = M.checkpoint, GEO = M.geom;
var MAG = M.magma, ERUPT = M.erupt;

function equal(a, b) { return Buffer.from(a).equals(Buffer.from(b)); }

check.section('M4.1 the session JSON covers every typed array and scalar');
P.seed = 1;
P.sl.geo = 50e3; P.sl.erupt = 14400;
SIM.reset();
SIM.run(40);
var arrays = Object.keys(S).filter(function (k) { return ArrayBuffer.isView(S[k]); });
var scalars = Object.keys(S).filter(function (k) { return typeof S[k] === 'number'; });
var reconN = Object.keys(S.recon).length;
var session = CP.saveSession();
var bytes = CP.b64dec(session.runtime);
var head = new Uint32Array(bytes.buffer, bytes.byteOffset, 16);
check.ok('the envelope is JSON with the runtime payload inside',
	session.format === CP.SESSION_FORMAT && typeof session.runtime === 'string' &&
	bytes.length === CP.save().length, bytes.length + ' bytes');
check.ok('every typed array of the state is a checkpoint record',
	head[8] === arrays.length, head[8] + ' records for ' + arrays.length + ' arrays');
check.ok('every scalar, reconstruction line and clock has a value slot',
	head[7] === scalars.length + reconN + 7 + 10, head[7] + ' slots');
var json0 = JSON.stringify(session, null, 1);
check.ok('the JSON string round-trips through parse without loss',
	JSON.stringify(JSON.parse(json0), null, 1) === json0);

check.section('M4.2 an active eruption at save time');
// Build the eruption through the real lifecycle: chamber supply -> birth -> metered
// drain -> toy feed, kept airborne by the gas blast, with write-back still queued.
var c = 0, v, frames = 0;
while (c < S.nCol && S.colGhost[c]) c++;
MAG.add(S, c, P.VbirthM2 * 1.6, false);
while (S.volc[c] < 0 && frames++ < 60) MAG.k7(S, 0.05, SIM.t, SIM.Tm);
v = S.volc[c];
check.ok('a charged chamber births its vent on the column', v >= 0 && S.venCol[v] === c, 'vent ' + v);
S.venGas[v] = 0.9;
frames = 0;
while (frames++ < 60 && !(S.prN[v] > 0 && S.venCol[v] >= 0 && ERUPT.mass(v) > 0)) {
	if (S.colChamber[c] + S.venV[v] < P.VbirthM2) MAG.add(S, c, P.VbirthM2, false);
	MAG.k7(S, 0.05, SIM.t, SIM.Tm);
}
check.ok('save moment: airborne packets over a live, still-feeding vent',
	S.prN[v] > 0 && S.venCol[v] >= 0 && S.venToyIn[v] > 0,
	S.prN[v] + ' packets, ' + S.venToyIn[v].toFixed(1) + ' cells2 fed');
check.ok('save moment: mass is in transit in the toy',
	ERUPT.mass(v) > 0, ERUPT.mass(v).toFixed(3) + ' cells2 in transit');

check.section('M4.3 done protocol: 1000 frames bitwise at two zoom levels');
function eruptionAtSave() {
	return S.prN[v] > 0 && S.venCol[v] >= 0 && ERUPT.mass(v) > 0;
}
function leg(zoomName, json, hSave, wantLive) {
	GEO.setPreset(zoomName);
	CP.loadSession(json);
	check.ok('reload at ' + zoomName + ' restores the save bit-identically', S.hash() === hSave,
		'hash ' + S.hash());
	check.ok('the eruption is still mid-flight after reload at ' + zoomName, eruptionAtSave());
	SIM.run(1000);
	var h = S.hash();
	if (wantLive !== undefined) {
		check.ok('1000 frames after reload at ' + zoomName + ' match the live run bitwise',
			h === wantLive, 'hash ' + h);
	}
	return h;
}
GEO.setPreset('def');
var json = JSON.stringify(CP.saveSession(), null, 1), hSave = S.hash();
SIM.run(1000);
var hLive = S.hash(), liveBytes = CP.save();
var hA = leg('def', json, hSave, hLive);
check.ok('zoom def: the live 1000 frames and the resumed 1000 frames agree', hA === hLive,
	'hash ' + hA);
var hB = leg('ovw', json, hSave, hLive);
check.ok('the two zoom levels resume to the same world', hB === hA, 'hash ' + hB);
var hC = leg('cru', json, hSave, hLive);
check.ok('a third zoom (crust x10) is equally bit-identical', hC === hA, 'hash ' + hC);

check.section('M4.4 checkpoint bytes and the K9 sweep over the done run');
GEO.setPreset('bas');
CP.loadSession(json);
var clean = true, sample;
for (frames = 0; frames < 1000; frames++) {
	SIM.step();
	if (frames % 100 === 0) {
		sample = SIM.diag();
		clean = clean && sample.ok;
	}
}
check.ok('the K9 sweep holds through the resumed 1000 frames', clean);
check.ok('the whole checkpoint (clocks, RNG words, sliders, slab flag) is byte-identical to the live run',
	equal(CP.save(), liveBytes));

check.section('M4.5 the paused-geology leg: eruptive clock only');
// watching an eruption with the tectonic clock stopped is the plan's own use case; the
// toy, its RNG stream and the vent meters must resume alone, bitwise
CP.loadSession(json);
P.sl.geo = 0; SIM.setGeo(0);
SIM.run(60);
var jsonQ = JSON.stringify(CP.saveSession(), null, 1), hSaveQ = S.hash();
check.ok('the eruptive clock is free and its vent is alive in the paused world',
	S.venCol[v] >= 0 && SIM.tErupt > 0 && S.venToyIn[v] > 0, 'vent ' + v + ' at tErupt ' + SIM.tErupt);
SIM.run(200);
var hLiveQ = S.hash();
CP.loadSession(jsonQ);
check.ok('reload of the paused world restores bit-identically', S.hash() === hSaveQ,
	'hash ' + S.hash());
SIM.run(200);
check.ok('200 eruptive-only frames resume bitwise with geology paused', S.hash() === hLiveQ,
	'hash ' + S.hash());

check.done();
