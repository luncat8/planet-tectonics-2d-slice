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
var snap = DEP.snapshotSection(S, { seed: P.seed, packChecksum: SEC.pack ? SEC.pack.checksum : 'local', pack: SEC.pack });
check.ok('snapshotSection produces valid snapshot with checksum',
	snap.format === 'pgt-section-snapshot' && snap.nCol === S.nCol &&
	/^[0-9a-f]{16}$/.test(snap.checksum));

var cat1 = DEP.generateCatalogue(snap);
var cat2 = DEP.generateCatalogue(snap);
check.ok('deposit catalogue is deterministic across repeated generations',
	cat1.checksum === cat2.checksum && JSON.stringify(cat1.bodies) === JSON.stringify(cat2.bodies),
	cat1.inPlane + ' bodies in plane of ' + cat1.candidates + ' candidates');

var body = cat1.bodies[0];
check.ok('deposit body identity incorporates the pack checksum and the plane reduction',
	!!body && body.packChecksum === snap.packChecksum && DEP.validate(body) === '' &&
	Math.abs(body.outOfPlaneKm) * 1000 <= Math.sqrt(body.fp.n2) + 1e-6,
	body ? body.id : 'no bodies in plane');

var drillLog = DEP.drill(S, body.sKm, 5000, cat1);
check.ok('drill returns column stratigraphy and the bodies the hole crosses',
	drillLog && drillLog.beds.length > 0 &&
	drillLog.deposits.some(function (d) { return d.id === body.id; }),
	'beds ' + drillLog.beds.length + ' deposits ' + drillLog.deposits.length);

var probed = DEP.probe(cat1, body.sKm, body.yM, 5.0);
check.ok('probe detects bodies within its footprint',
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

var origHThick = [], origAge = [], origHost = [], origPot = [], origPlate = [], origTot = [];
for (var col = 0; col < S.nCol; col++) {
	origHThick.push([S.hFel[col], S.hMaf[col], S.hSed[col]]);
	origAge.push(S.colAge[col]);
	origHost.push(DEP.hostCode(S.hFel[col], S.hMaf[col], S.hSed[col], S.colGhost[col]));
	origPot.push([S.oVms[col], S.oMaf[col], S.oArc[col], S.oOro[col], S.oBas[col], S.oPla[col]]);
	origPlate.push(S.colPlate[col]);
	origTot.push(S.hTot[col]);
}
var reRefused = SEED.layout(expWorld, { seed: 12345, t: SIM.t, Tm: SIM.Tm });
check.ok('reconstructed exported slice pack without refusal', !reRefused, reRefused || 'ok');

// The pack stores sKm at six significant digits, so on the 40 030 km ring a sample boundary
// sits up to `quantM` (~50 m) from where the section planted it. A column then trades that
// fraction of its span with a neighbour, and the residue is that fraction times the field's
// own contrast, so it is neither zero nor a number to guess: the bound below is the largest
// one-column contrast on the ring times that fraction, doubled for the two ends of a column.
// A column that really moved or a bed that really vanished shows up in whole metres and Myr,
// and the quarter-column shift at the end of this section proves the bound can see it.
var quantM = 0, i2;
for (i2 = 0; i2 < expWorld.n; i2++) quantM = Math.max(quantM, Math.abs(expWorld.sKm[i2] * 1000 - i2 * P.w0));
var adjH = 0, adjA = 0, prev = SEED.nCut - 1;
for (col = 0; col < SEED.nCut; col++) {
	adjH = Math.max(adjH, Math.abs(origHThick[col][0] - origHThick[prev][0]),
		Math.abs(origHThick[col][1] - origHThick[prev][1]), Math.abs(origHThick[col][2] - origHThick[prev][2]));
	adjA = Math.max(adjA, Math.abs(origAge[col] - origAge[prev]));
	prev = col;
}
var frac = quantM / P.w0, boundH = 2 * frac * adjH, boundA = 2 * frac * adjA;
var maxHDiff = 0, maxAgeDiff = 0, maxPotDiff = 0, hostBad = 0, plateBad = 0;
for (col = 0; col < S.nCol; col++) {
	maxHDiff = Math.max(maxHDiff, Math.abs(S.hFel[col] - origHThick[col][0]),
		Math.abs(S.hMaf[col] - origHThick[col][1]), Math.abs(S.hSed[col] - origHThick[col][2]));
	maxAgeDiff = Math.max(maxAgeDiff, Math.abs(S.colAge[col] - origAge[col]));
	if (DEP.hostCode(S.hFel[col], S.hMaf[col], S.hSed[col], S.colGhost[col]) !== origHost[col]) hostBad++;
	if (SEED.platesFrom[S.colPlate[col]] !== expWorld.plate[col]) plateBad++;
	for (i2 = 0; i2 < 6; i2++) maxPotDiff = Math.max(maxPotDiff, Math.abs(S[DEP.POTENTIALS[i2]][col] - origPot[col][i2]));
}
check.ok('re-imported thicknesses and ages are inside the pack\'s own arc quantum',
	maxHDiff <= boundH && maxAgeDiff <= boundA,
	'max ' + maxHDiff.toFixed(1) + ' m / ' + maxAgeDiff.toFixed(3) + ' Myr, bound ' +
	boundH.toFixed(0) + ' m / ' + boundA.toFixed(3) + ' Myr at a ' + quantM.toFixed(0) +
	' m quantum over a ' + (P.w0 / 1000).toFixed(1) + ' km column');
check.ok('re-imported potentials are the exported ones inside the same quantum, and the host class survives it',
	maxPotDiff <= 2 * frac && hostBad <= 2,
	'max potential diff ' + maxPotDiff.toExponential(2) + ', ' + hostBad + ' host flips');
check.ok('every column maps back to the plate the cut named', plateBad === 0, plateBad + ' mismatches');

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

// The spin-up bound is not "no mass moves": the engine's own dynamics move crust, and a fresh
// reset planet at the same plate rate is the baseline the imported state must not beat. So the
// same 1000 frames are run on both and compared.
var spinStartMass = SEED.seedMass;
SIM.run(1000);
var spinEndMass = 0;
for (col = 0; col < S.nCol; col++) spinEndMass += S.hTot[col] * S.colW[col];
var spinDeltaRel = Math.abs(spinEndMass - spinStartMass) / spinStartMass;
check.planet(12345);
SIM.setGeo(50e3);
var freshStart = 0;
for (col = 0; col < S.nCol; col++) freshStart += S.hTot[col] * S.colW[col];
SIM.run(1000);
var freshEnd = 0;
for (col = 0; col < S.nCol; col++) freshEnd += S.hTot[col] * S.colW[col];
var freshDeltaRel = Math.abs(freshEnd - freshStart) / freshStart;
check.ok('forward simulation after self round-trip stays inside the spin-up bound',
	spinDeltaRel <= freshDeltaRel + 1e-3,
	'imported ' + spinDeltaRel.toExponential(2) + ' vs fresh planet ' + freshDeltaRel.toExponential(2) +
	' over 1000 frames');

// The round-trip caps above are only worth having if a moved cut fails them. Shifting every
// sample boundary a quarter column, alternately in and out so the ring still fits its path,
// moves a quarter of every column's span into its neighbour's reach; the same comparison then
// has to leave the caps far behind.
var shifted = { sKm: expWorld.sKm.slice() };
for (i2 = 0; i2 < expWorld.n; i2++) shifted.sKm[i2] = SP.round(expWorld.sKm[i2] + (i2 % 2 ? 0.25 : -0.25) * P.w0 / 1000);
var copy = JSON.parse(SP.encode(expWorld));
copy.sKm = Array.prototype.slice.call(shifted.sKm);
copy.checksum = SP.checksum(SP.normalize(copy));
var shiftedRefused = SEED.layout(copy, { seed: 12345, t: SIM.t, Tm: SIM.Tm });
var shiftedH = 0;
for (col = 0; col < S.nCol; col++) shiftedH = Math.max(shiftedH,
	Math.abs(S.hFel[col] - origHThick[col][0]), Math.abs(S.hMaf[col] - origHThick[col][1]),
	Math.abs(S.hSed[col] - origHThick[col][2]));
check.ok('a quarter-column shift of the cut moves the reconstruction orders past the cap',
	!shiftedRefused && shiftedH > 100 * maxHDiff && shiftedH > boundH,
	shiftedH.toFixed(0) + ' m vs the round-trip\'s ' + maxHDiff.toFixed(1) + ' m');

check.done();
