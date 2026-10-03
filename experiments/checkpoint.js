'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var CP = M.checkpoint, S = M.state, SIM = M.sim, RNG = M.rng, SEED = M['section-seed'];
var SEC = M['section-pack'], DEP = M.deposits, P = M.params, SURF = M.surface;
var SP = require('../port/slice-format.js');
var FIX = require('./pack-fixture.js');

function equal(a, b) { return Buffer.from(a).equals(Buffer.from(b)); }
function damaged(bytes, offset, value) {
	var copy = bytes.slice(), view = new DataView(copy.buffer);
	view.setFloat64(offset, value, true);
	return copy;
}

check.section('A. runtime checkpoint codec & validation');
check.planet(7);
var t0 = FIX.pinned().source.tMyr, Tm;
SIM.t = t0; SIM.cool(); Tm = SIM.Tm;
var refused = SEED.layout(FIX.pinned(), { seed: 7, t: t0, Tm: Tm });
if (refused) throw new Error(refused);
SIM.t = t0; SIM.cool(); SIM.dG = 0.01; SIM.tErupt = 29; SIM.frame = 3; SIM.evT = 0.25;
SIM.run(3); RNG.g();
var saved = CP.save(), hash = S.hash(), recon = JSON.stringify(S.recon);
SIM.run(4); var forward = CP.save();
CP.load(saved);
check.ok('section arrays, clocks and reconstruction ledger round trip',
	S.hash() === hash && JSON.stringify(S.recon) === recon && equal(saved, CP.save()));
SIM.run(4);
check.ok('restored section resumes deterministically', equal(forward, CP.save()));
var offset = new Uint8Array(saved.length + 1); offset.set(saved, 1);
CP.load(offset.subarray(1));
check.ok('unaligned file views load', equal(saved, CP.save()));
var count = new Uint32Array(saved.buffer)[7];
[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 64 + count * 8].forEach(function (at) {
	var bad = saved.slice(); bad[at] ^= 128; var before = CP.save(), threw = false;
	try { CP.load(bad); } catch (e) { threw = true; }
	check.ok('refuses damaged header or table at ' + at + ' atomically', threw && equal(before, CP.save()));
});
var scalars = Object.keys(S).filter(function (k) { return typeof S[k] === 'number'; }).length;
var reconCount = Object.keys(S.recon).length, clockCount = 7;
var clockAt = 64 + (scalars + reconCount) * 8;
var paramAt = clockAt + clockCount * 8;
var rngAt = paramAt + 3 * 8;
[
	['non-finite state scalar', damaged(saved, 64, Infinity)],
	['out-of-capacity column count', damaged(saved, 64, S.colX.length + 1)],
	['negative geologic step', damaged(saved, clockAt, -1)],
	['invalid event remainder', damaged(saved, clockAt + 5 * 8, M.params.eventCadence)],
	['fractional event count', damaged(saved, clockAt + 6 * 8, 0.5)],
	['seed inconsistent with header', (function () { var b = saved.slice(); new Uint32Array(b.buffer)[3] ^= 1; return b; })()],
	['fractional RNG word', damaged(saved, rngAt, 1.5)],
	['slider beyond the runtime range', damaged(saved, paramAt + 8, M.params.geoMax + 1)]
].forEach(function (item) {
	var before = CP.save(), threw = false;
	try { CP.load(item[1]); } catch (e) { threw = true; }
	check.ok('refuses ' + item[0] + ' atomically', threw && equal(before, CP.save()));
});
var threw = false;
try { CP.load(saved.subarray(0, saved.length - 1)); } catch (e) { threw = true; }
check.ok('refuses truncated data', threw && equal(saved, CP.save()));

check.section('B. session envelope save & load');
SEC.pack = FIX.pinned();
SEC.origin = 'paste';
SEC.world = true;
SEC.raw = false;
SEC.overlay = true;
SEC.running = true;
SEC.t0 = t0;
SEC.spin = { m: 988692889403, z: 0, n: 512 };

var sessionObj = CP.saveSession();
check.ok('session format and version are declared',
	sessionObj.format === 'pgt-slice-session' && sessionObj.version === 1);
check.ok('session carries mapper and section metadata',
	sessionObj.mapper && sessionObj.mapper.MAP === SEED.MAP && sessionObj.mapper.nCut === SEED.nCut &&
	sessionObj.session && sessionObj.session.running === true && sessionObj.pack.checksum === FIX.pinned().checksum);
check.ok('base64 runtime encoding round-trips bit-identically',
	equal(CP.b64dec(sessionObj.runtime), saved));

var jsonSession = JSON.stringify(sessionObj);
var beforeHash = S.hash();
SIM.run(5);
CP.loadSession(jsonSession);
check.ok('loadSession restores exact runtime state, mapper and section pack',
	S.hash() === beforeHash && SEC.pack.checksum === FIX.pinned().checksum &&
	SEED.nCut === 512 && SEC.running === true && SEC.t0 === t0);

[
	['not an object', 'null'],
	['foreign format', JSON.stringify({ format: 'foreign-session', version: 1, runtime: sessionObj.runtime })],
	['future version', JSON.stringify({ format: 'pgt-slice-session', version: 99, runtime: sessionObj.runtime })],
	['missing runtime', JSON.stringify({ format: 'pgt-slice-session', version: 1 })],
	['corrupted embedded pack', (function () {
		var bad = JSON.parse(jsonSession);
		bad.pack.checksum = '0000000000000000';
		return JSON.stringify(bad);
	})()]
].forEach(function (tc) {
	var threwBad = false, curHash = S.hash();
	try { CP.loadSession(tc[1]); } catch (e) { threwBad = true; }
	check.ok('refuses ' + tc[0] + ' without state corruption', threwBad && S.hash() === curHash);
});

check.section('C. deposit catalogue core & 3D->2D snapshot');
var snap = DEP.snapshotSection(S, { packChecksum: SEC.pack ? SEC.pack.checksum : 'local' });
check.ok('snapshotSection produces valid snapshot with checksum',
	snap.format === 'pgt-section-snapshot' && snap.nCol === S.nCol &&
	/^[0-9a-f]{16}$/.test(snap.checksum));

var cat1 = DEP.generateCatalogue(snap);
var cat2 = DEP.generateCatalogue(snap);
check.ok('deposit catalogue is deterministic across repeated generations',
	cat1.length === cat2.length && JSON.stringify(cat1) === JSON.stringify(cat2),
	cat1.length + ' bodies generated');

var body = cat1[0];
check.ok('deposit body identity incorporates pack checksum and 3D->2D projection',
	body && body.packChecksum === snap.packChecksum && body.projectedRadiusKm <= body.radiusKm &&
	Math.abs(body.outOfPlaneKm) <= body.radiusKm);

var drillLog = DEP.drill(S, body.col, 5000, cat1);
check.ok('drill returns column stratigraphy and intersecting deposit bodies',
	drillLog && drillLog.col === body.col && drillLog.beds.length > 0 &&
	drillLog.deposits.some(function (d) { return d.id === body.id; }),
	'beds ' + drillLog.beds.length + ' deposits ' + drillLog.deposits.length);

var probed = DEP.probe(cat1, body.sKm, body.yM, 5.0);
check.ok('probe detects bodies within support footprint',
	probed.length > 0 && probed.some(function (d) { return d.id === body.id; }));

check.section('D. self round-trip export & re-import');
check.planet(12345);
SIM.setGeo(50e3);
SIM.run(20);
var expWorld = SEED.exportSection({ pack: 'self-test' });
check.ok('exportSection produces a valid pgt-slice-pack v1',
	expWorld.format === SP.FORMAT && expWorld.version === SP.VERSION &&
	expWorld.n === S.nCol && /^[0-9a-f]{16}$/.test(expWorld.checksum));

var valMsg = SP.validate(expWorld) || SP.verify(expWorld);
check.ok('exported slice pack passes format validation and checksum verification',
	valMsg === '', valMsg || 'valid');

var origHThick = [];
for (var col = 0; col < S.nCol; col++) {
	origHThick.push([Math.round(S.hFel[col]), Math.round(S.hMaf[col]), Math.round(S.hSed[col]), Math.round(S.z[col])]);
}
var reRefused = SEED.layout(expWorld, { seed: 12345, t: SIM.t, Tm: SIM.Tm });
check.ok('reconstructed exported slice pack without refusal', !reRefused, reRefused || 'ok');

var maxHDiff = 0;
for (col = 0; col < S.nCol; col++) {
	var dF = Math.abs(S.hFel[col] - origHThick[col][0]);
	var dM = Math.abs(S.hMaf[col] - origHThick[col][1]);
	var dS = Math.abs(S.hSed[col] - origHThick[col][2]);
	maxHDiff = Math.max(maxHDiff, dF, dM, dS);
}
check.ok('re-imported thicknesses match exported world within 6-digit cell quantisation',
	maxHDiff < 15.0, 'max thickness diff: ' + maxHDiff.toFixed(2) + ' m');

var massLedgerErr = Math.abs(SEED.seedMass - SEED.cutMass) / SEED.cutMass;
check.ok('re-imported volume ledger closes to 1e-9 relative',
	massLedgerErr < 1e-9, 'rel ' + massLedgerErr.toExponential(2));

// Frame-0 isostasy identity: |S.z[j] - zT[j]| <= 1e-3 m
var worstZId = 0, KM = 1000, nCut = SEED.nCut, sc = SEED.scale * KM, w0 = P.w0;
for (col = 0; col < nCut; col++) {
	var accZ = 0, wsum = 0;
	for (var i = 0; i < expWorld.n; i++) {
		var a = i === 0 ? 0 : expWorld.sKm[i] * sc;
		var b = i + 1 < expWorld.n ? expWorld.sKm[i + 1] * sc : nCut * w0;
		var lo = Math.max(a, col * w0), hi = Math.min(b, (col + 1) * w0);
		if (hi > lo) {
			var w = hi - lo;
			accZ += expWorld.zM[i] * w;
			wsum += w;
		}
	}
	var wantZ = wsum > 0 ? accZ / wsum : 0;
	var idErr = Math.abs(S.z[col] - wantZ);
	if (idErr > worstZId) worstZId = idErr;
}
check.ok('frame-0 isostasy identity holds on self-exported world (|z - zM| <= 1e-3 m)',
	worstZId <= 1e-3, 'worst z identity diff: ' + worstZId.toExponential(2) + ' m');

var spinStartMass = SEED.seedMass;
SIM.run(100);
var spinEndMass = 0;
for (col = 0; col < S.nCol; col++) spinEndMass += S.hTot[col] * S.colW[col];
var spinDeltaRel = Math.abs(spinEndMass - spinStartMass) / spinStartMass;
check.ok('forward simulation after self round-trip stays within spin-up bound',
	spinDeltaRel < 1e-3, 'relative mass change over 100 frames: ' + spinDeltaRel.toExponential(2));

check.done();
