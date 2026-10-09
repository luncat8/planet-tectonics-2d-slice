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
// M3 adds live resource budgets and bed masks to M2 write-back; previous schemas are refused.
var older = saved.slice();
new Uint32Array(older.buffer)[1] = CP.VERSION - 1;
threw = false;
try { CP.load(older); } catch (e) { threw = e instanceof RangeError && /version 7/.test(e.message); }
check.ok('refuses the previous checkpoint version atomically', CP.VERSION === 8 && threw && equal(saved, CP.save()));
var shortAt = Math.min(5, S.nCol - 1), shortHash;
S.edgeShort[shortAt] = 78125;
shortHash = S.hash();
var withShort = CP.save();
S.edgeShort[shortAt] = 0;
CP.load(withShort);
check.ok('the absorbed boundary shortening is a checkpoint record and round-trips',
	S.edgeShort[shortAt] === 78125 && S.hash() === shortHash && !equal(withShort, saved));
CP.load(saved);

check.section('B. session envelope save & load');
SEC.pack = FIX.pinned();
SEC.origin = 'paste';
SEC.world = true;
SEC.raw = false;
SEC.overlay = true;
SEC.running = true;
SEC.t0 = t0;
SEC.syncTMyr = t0 + 5;
SEC.syncImports = 2;
SEC.spin = { m: 988692889403, z: 0, n: 512 };

var sessionObj = CP.saveSession();
check.ok('session format and version are declared',
	sessionObj.format === 'pgt-slice-session' && sessionObj.version === 1);
check.ok('session carries mapper and section metadata',
	sessionObj.mapper && sessionObj.mapper.MAP === SEED.MAP && sessionObj.mapper.nCut === SEED.nCut &&
	sessionObj.session && sessionObj.session.running === true && sessionObj.session.syncTMyr === t0 + 5 &&
	sessionObj.session.syncImports === 2 && sessionObj.pack.checksum === FIX.pinned().checksum);
check.ok('base64 runtime encoding round-trips bit-identically',
	equal(CP.b64dec(sessionObj.runtime), saved));

var jsonSession = JSON.stringify(sessionObj);
var beforeHash = S.hash();
SIM.run(5);
CP.loadSession(jsonSession);
check.ok('loadSession restores exact runtime state, mapper and section pack',
	S.hash() === beforeHash && SEC.pack.checksum === FIX.pinned().checksum &&
	SEED.nCut === 512 && SEC.running === true && SEC.t0 === t0 &&
	SEC.syncTMyr === t0 + 5 && SEC.syncImports === 2 && !SEC.syncLive);

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
// D1. The lattice-matched round trip. A cut of the pinned ring is laid on the section's fixed
// lattice, so the export's arc table and the reader's box filter are one grid: the plan's
// "identical carried fields" is testable here, and the residual is the pack's own six-digit
// arcs amplified by the contrast between neighbouring beds. The wider, non-uniform ring the
// engine grows as it runs is a re-cut rather than a restore (D3 below).
check.planet(12345);
var laidD = SEED.layout(FIX.pinned(), { seed: 12345, t: t0, Tm: SIM.Tm });
check.ok('the self-test lays a cut of the pinned ring without refusal', !laidD, laidD || 'ok');
SIM.t = t0; SIM.cool();
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
var reRefused = SEED.layout(expWorld, { seed: 12345, t: t0, Tm: SIM.Tm });
check.ok('reconstructed exported slice pack without refusal', !reRefused, reRefused || 'ok');

// The pack stores sKm at six significant digits, so on the 40 030 km ring a sample boundary
// sits up to `quantM` from where the section planted it. A column then trades that fraction of
// its span with a neighbour, and the residue is that fraction times the field's own contrast,
// so it is neither zero nor a number to guess: the bound below is the largest one-column
// contrast on the ring times that fraction, doubled for the two ends of a column. A column
// that really moved or a bed that really vanished shows up in whole metres and Myr, and the
// quarter-column shift at the end of D1 proves the bound can see it.
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

// The round-trip caps above are only worth having if a moved cut fails them. Shifting every
// sample boundary a quarter column, alternately in and out so the ring still fits its path,
// moves a quarter of every column's span into its neighbour's reach; the same comparison then
// has to leave the caps far behind.
var shifted = { sKm: expWorld.sKm.slice() };
for (i2 = 0; i2 < expWorld.n; i2++) shifted.sKm[i2] = SP.round(expWorld.sKm[i2] + (i2 % 2 ? 0.25 : -0.25) * P.w0 / 1000);
var copy = JSON.parse(SP.encode(expWorld));
copy.sKm = Array.prototype.slice.call(shifted.sKm);
copy.checksum = SP.checksum(SP.normalize(copy));
var shiftedRefused = SEED.layout(copy, { seed: 12345, t: t0, Tm: SIM.Tm });
var shiftedH = 0;
for (col = 0; col < S.nCol; col++) shiftedH = Math.max(shiftedH,
	Math.abs(S.hFel[col] - origHThick[col][0]), Math.abs(S.hMaf[col] - origHThick[col][1]),
	Math.abs(S.hSed[col] - origHThick[col][2]));
check.ok('a quarter-column shift of the cut moves the reconstruction orders past the cap',
	!shiftedRefused && shiftedH > 100 * maxHDiff && shiftedH > boundH,
	shiftedH.toFixed(0) + ' m vs the round-trip\'s ' + maxHDiff.toFixed(1) + ' m');

// D2. The spin-up bound. The imported section is run 1000 frames against a freshly laid one
// of the same cut and rate: an import that leaves the world agitated shows up as a mass ratio
// the fresh run does not have. The engine's own dynamics move crust on both sides, so the gate
// is the difference, not zero.
// S.mass() is the engine's own accounting: crust plus the mobile load, the chamber and the
// ribbons, so an eroding section does not read as a leaker.
function crustalMass() {
	var m = S.mass(), sum = 0, k;
	for (k = 0; k < m.length; k++) sum += m[k];
	return sum;
}
var importedStartMass = crustalMass();
SIM.t = t0; SIM.cool();
SIM.setGeo(50e3);
SIM.run(1000);
var importedDeltaRel = Math.abs(crustalMass() - importedStartMass) / importedStartMass;
var freshRefused = SEED.layout(FIX.pinned(), { seed: 12345, t: t0, Tm: SIM.Tm });
SIM.t = t0; SIM.cool();
SIM.setGeo(50e3);
var freshStartMass = crustalMass();
SIM.run(1000);
var freshDeltaRel = Math.abs(crustalMass() - freshStartMass) / freshStartMass;
check.ok('forward simulation after self round-trip stays inside the spin-up bound',
	!freshRefused && importedDeltaRel <= freshDeltaRel + 1e-3,
	'imported ' + importedDeltaRel.toExponential(2) + ' vs fresh section ' + freshDeltaRel.toExponential(2) +
	' over 1000 frames');

// D3. What the engine's ring becomes is not what it was laid: transported columns differ in
// width, so the export's arc table is no longer the section's lattice and the reader re-cuts
// rather than restores. A column's crust may then slide up to one cell sideways — the mass
// identity is what must not move, and it is the same gate the M5 sequence has to close.
SIM.t = t0; SIM.cool();
SIM.setGeo(50e3);
SIM.run(20);
var evolved = SEED.exportSection({ pack: 'self-test-evolved' });
var evOrig = [], i3, prev3;
for (i3 = 0; i3 < S.nCol; i3++) evOrig.push(S.hFel[i3] + S.hMaf[i3] + S.hSed[i3]);
// The reader gives each destination cell the arc-weighted mean of the source cells it covers,
// so the re-cut cannot put more crust in a column than the ring's own deepest cell, nor less
// than its thinnest: every value is a convex combination. A residual outside that range, or a
// column outside it, is crust the filter invented rather than moved. The move itself is
// reported, not gated — at a 20 km cell beside 88 km ones it is a whole contrast wide.
var srcMin = Infinity, srcMax = 0;
for (i3 = 0; i3 < S.nCol; i3++) {
	if (evOrig[i3] < srcMin) srcMin = evOrig[i3];
	if (evOrig[i3] > srcMax) srcMax = evOrig[i3];
}
var evRefused = SEED.layout(evolved, { seed: 12345, t: SIM.t, Tm: SIM.Tm });
var evDiff = 0, evOutside = 0, h3;
for (i3 = 0; i3 < S.nCol; i3++) {
	h3 = S.hFel[i3] + S.hMaf[i3] + S.hSed[i3];
	evDiff = Math.max(evDiff, Math.abs(h3 - evOrig[i3]));
	evOutside = Math.max(evOutside, h3 - srcMax, srcMin - h3);
}
var evMassErr = Math.abs(SEED.seedMass - SEED.cutMass) / SEED.cutMass;
check.ok('a re-cut of the engine\'s own widened ring closes the mass identity to 1e-9',
	!evRefused && evMassErr < 1e-9, 'rel ' + evMassErr.toExponential(2));
check.ok('the re-cut invents no crust: every column stays inside the ring\'s own range',
	evOutside <= 1e-6, 'worst outside by ' + evOutside.toFixed(3) + ' m of ' +
	(srcMin / 1000).toFixed(1) + '..' + (srcMax / 1000).toFixed(1) + ' km');
check.info('the re-cut residual of the evolved ring',
	'max thickness move ' + evDiff.toFixed(0) + ' m over ' + S.nCol + ' columns, ring ' +
	(P.w0 / 1000).toFixed(1) + ' km nominal');

check.done();
