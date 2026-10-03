'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var CP = M.checkpoint, S = M.state, SIM = M.sim, RNG = M.rng, SEED = M['section-seed'];
var FIX = require('./pack-fixture.js');
function equal(a, b) { return Buffer.from(a).equals(Buffer.from(b)); }
function damaged(bytes, offset, value) {
	var copy = bytes.slice(), view = new DataView(copy.buffer);
	view.setFloat64(offset, value, true);
	return copy;
}
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
check.done();
