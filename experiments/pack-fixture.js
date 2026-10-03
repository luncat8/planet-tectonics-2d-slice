// pack-fixture.js — a synthetic pgt-slice-pack built exactly the way the cutter builds one:
// SlicePack.make, per-sample fields from a seeded PRNG, quantise, checksum. Shared by
// slice-cut.js (the format's self-measurement) and section-pack.js (the reader's gate), so
// the two harnesses cannot drift apart on what "the cutter's output" is. The pinned pack is
// the one the reader harness loads on every run: a fixed seed, a fixed circle, a fixed line.
'use strict';

var SP = require('../port/slice-format.js');

var R = SP.R_KM;

function lcg(seed) {
	var s = seed >>> 0;
	return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// A stand-in for the globe's state: deterministic, in range, with more plate runs than the
// section has plates, so the merge rule the plan specifies is exercised rather than assumed.
// `path` defaults to the pinned great circle (the slice-cut.js one).
function build(n, runs, path) {
	var rnd = lcg(20261003), i, k;
	var pack = SP.make(n, path || { kind: 'circle', lat0: 12, lon0: -40, az0: 35, closes: true,
		arcKm: 2 * Math.PI * R, cellKm: 2 * Math.PI * R / n });
	pack.source = { repo: 'planet-geotectonics', commit: 'd909476', pack: '', epochMa: 0, rotModel: '',
		built: '2026-10-03T00:00:00Z', tMyr: 120.5, level: 5, gridSeed: 12345, simSeed: 7 };
	pack.license = 'synthetic fixture, no data license';
	var s = 0, run = 0, runLen = Math.ceil(n / runs), step = pack.path.arcKm / n;
	for (i = 0; i < n; i++) {
		pack.sKm[i] = s; s += step;
		var z = -5500 + 9500 * rnd();
		pack.zM[i] = Math.round(z);
		var oceanic = rnd() < 0.6;
		pack.hFelM[i] = Math.round(oceanic ? 0 : 28000 + 17000 * rnd());
		pack.hMafM[i] = Math.round(oceanic ? 6000 + 1500 * rnd() : 12000 + 6000 * rnd());
		pack.hSedM[i] = Math.round(rnd() < 0.4 ? 4000 * rnd() : 0);
		pack.ageMyr[i] = 200 * rnd();
		pack.fert[i] = 0.5 + 1.5 * rnd();
		pack.damage[i] = rnd();
		pack.host[i] = oceanic ? 1 : (pack.hSedM[i] > 2000 ? 4 : 2);
		pack.plate[i] = run;
		pack.alive[i] = rnd() < 0.02 ? 0 : 1;
		pack.wet[i] = z < 0 ? 1 : 0;
		pack.vt[i] = (rnd() - 0.5) * 2e5;
		pack.vp[i] = rnd() * 1e5;
		for (k = 0; k < 6; k++) pack.pot[i * 6 + k] = rnd();
		if ((i + 1) % runLen === 0 && run + 1 < runs) {
			pack.bnd[i] = rnd() < 0.5 ? SP.EDGE.subduct : SP.EDGE.open;
			pack.pol[i] = rnd() < 0.5 ? -1 : 1;
			run++;
		}
	}
	pack.plates = [];
	for (i = 0; i < runs; i++) pack.plates.push({ id: i, n: runLen });
	SP.quantize(pack);
	pack.checksum = SP.checksum(pack);
	return pack;
}

// The pinned pack: fixed world, fixed line, fixed bytes. Both harnesses load it.
function pinned() {
	return build(198, 12);
}

module.exports = { build: build, pinned: pinned };
