// pack-fixture.js — a synthetic pgt-slice-pack built exactly the way the cutter builds one:
// SlicePack.make, per-sample fields from a seeded PRNG, quantise, checksum. Shared by
// slice-cut.js (the format's self-measurement) and the two section harnesses, so they cannot
// drift apart on what "the cutter's output" means. The pinned pack is the one they load on
// every run: a fixed seed, a fixed circle, a fixed line.
//
// The point of a *fixture* is that a bug in it becomes a bug the harness finds, so nothing here
// is noise, and three things in particular are not free:
//
//   · a plate is rigid. One speed per run, with a full-period sine across it that is zero at
//     both seams — the projection of a turning tangent, not a jitter. `bnd` at a seam is then
//     *derived from* the speed jump (a seam that closes is convergent, one that opens is
//     divergent), because a cut whose velocities disagreed with its own boundaries would let the
//     seeding "fix" the disagreement and read the result back as a quiet start.
//   · a convergent seam is a collision when both sides carry continental crust and a subduction
//     otherwise: that is the cutter's `edgeCode` rule, and it is what makes the polarity field
//     mean something.
//   · zM is the isostasy of the crust beside it, from the model's own densities, because the
//     cutter reads `s.z[cell]` and nothing else. A gap sample (alive = 0) carries no crust, no
//     host and no potentials: that is what "the cut crossed a cell with no column" is made of.
'use strict';

var SP = require('../port/slice-format.js');
var P = require('../js/params.js');

var R = SP.R_KM, KM = 1000;

function lcg(seed) {
	var s = seed >>> 0;
	return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// A circle of `n` samples over the whole wrap, and a window over `arcKm` of it: the two run
// modes of 0.4.1-plan.md §4.4, both as paths the shared path block can walk.
function circle(n) {
	return { kind: 'circle', lat0: 12, lon0: -40, az0: 35, closes: true,
		arcKm: 2 * Math.PI * R, cellKm: 2 * Math.PI * R / n };
}
function windowPath(n, arcKm) {
	var verts = [10, -40, 14, 8, 6, 52, -12, 78], i;
	for (i = 0; i < verts.length; i += 2) verts[i] += 0.0001 * i;      // a drawn line is not exact
	return { kind: 'polyline', verts: verts, closes: false, arcKm: arcKm, cellKm: arcKm / n };
}

// the model's own surface, so the pack's zM is the number the cutter would have read
function elev(hFel, hMaf, hSed, age) {
	var buoy = hFel * (P.rhoM - P.rhoFel) / P.rhoM + hMaf * (P.rhoM - P.rhoMaf) / P.rhoM +
		hSed * (P.rhoM - P.rhoSed) / P.rhoM;
	var t = Math.min(age, P.thermAgeCap), ci;
	if (hFel <= P.ciLo) ci = 0;
	else if (hFel >= P.ciHi) ci = 1;
	else { var x = (hFel - P.ciLo) / (P.ciHi - P.ciLo); ci = x * x * (3 - 2 * x); }
	return P.zRef + buoy - (P.thermK * Math.sqrt(t) * (1 - ci) + P.zRoot * ci);
}

// `runs` plate intervals along the cut. Speeds walk by a bounded step at each seam, and the
// seam's boundary type is whatever that step says it is.
function build(n, runs, path, seed) {
	var rnd = lcg(seed === undefined ? 20261003 : seed), i, k, j;
	var pack = SP.make(n, path || circle(n));
	pack.source = { repo: 'planet-geotectonics', commit: 'd909476', pack: '', epochMa: 0, rotModel: '',
		built: '2026-10-03T00:00:00Z', tMyr: 120.5, level: 5, gridSeed: 12345, simSeed: 7 };
	pack.license = 'synthetic fixture, no data license';
	var arc = pack.path.arcKm, step = arc / n;
	var runLen = Math.ceil(n / runs), R2 = SP.EDGE;
	var cont = [], spd = [1.1e5 + 6e4 * rnd()], kind = [], pol = [], vtRun = [], r, at;
	for (r = 0; r < runs; r++) cont[r] = rnd() < 0.42;
	// one plate whose motion is perpendicular to the cut (plan §4.4's display case: it has no
	// along-cut speed at all, and the out-of-plane fraction is the only thing that says so)
	var perp = runs > 4 ? 3 : -1;
	for (r = 0; r < runs; r++) {
		vtRun[r] = r === perp ? 0 : spd[r];
		if (r) {
			var dv = 1.6e4 + 4.2e4 * rnd();
			// keep every plate inside a real range (±22 cm/yr): when the walk would run off the
			// end, the seam reverses instead, so the sign of the jump stays the model's business
			var up = spd[r - 1] + dv > 2.2e5 || spd[r - 1] - dv < -2.2e5 ? (spd[r - 1] > 0 ? -1 : 1)
				: (rnd() < 0.5 ? 1 : -1);
			spd[r] = spd[r - 1] + up * dv;
			if (r === perp) spd[r] = spd[r - 1];
			vtRun[r] = r === perp ? 0 : spd[r];
		}
	}
	// the seam between two runs is the jump their along-cut speeds make: 0..runs-2, and for a
	// closed cut the seam that closes the ring, which is the one at the last sample of the array
	for (r = 0; r < runs; r++) {
		var nx = r + 1 < runs ? r + 1 : 0, dd = vtRun[nx] - vtRun[r];
		if (r + 1 >= runs && !pack.path.closes) break;
		kind[r] = dd > 0 ? R2.open : (cont[r] && cont[nx] ? R2.collide : R2.subduct);
		pol[r] = kind[r] === R2.subduct ? (rnd() < 0.5 ? -1 : 1) : 0;
	}
	for (i = 0; i < n; i++) {
		r = Math.min(runs - 1, (i / runLen) | 0);
		var m = i - r * runLen, mLen = Math.min(runLen, n - r * runLen);
		// a full period across the run: zero at both seams, so the plate's mean is its speed
		var wig = Math.sin(6.283185307 * m / Math.max(1, mLen));
		pack.sKm[i] = i * step;
		pack.vt[i] = vtRun[r] * (1 + 0.16 * wig);
		pack.vp[i] = r === perp ? Math.abs(spd[r]) * 0.95
			: Math.abs(spd[r] * 0.3 * Math.cos(3.141592654 * m / Math.max(1, mLen)));
		var z, oceanic = !cont[r], gap = rnd() < 0.02;
		pack.hFelM[i] = gap ? 0 : (oceanic ? 0 : 14000 + 26000 * rnd());
		pack.hMafM[i] = gap ? 0 : (oceanic ? 5500 + 2500 * rnd() : 11000 + 7000 * rnd());
		pack.hSedM[i] = gap ? 0 : (oceanic ? 150 + 900 * rnd() : 500 + 3500 * rnd());
		pack.ageMyr[i] = gap ? 0 : (oceanic ? 20 + 150 * rnd() : 30 + 260 * rnd());
		pack.fert[i] = gap ? 0 : 0.5 + 1.5 * rnd();
		pack.damage[i] = gap ? 0 : rnd() * (pack.hFelM[i] > 30000 ? 0.6 : 1);
		pack.host[i] = gap ? 0 : (oceanic ? 1 : (pack.hSedM[i] > 1500 ? 4 : 2));
		pack.alive[i] = gap ? 0 : 1;
		pack.plate[i] = r;
		z = elev(pack.hFelM[i], pack.hMafM[i], pack.hSedM[i], pack.ageMyr[i]);
		pack.zM[i] = Math.round(z);
		pack.wet[i] = z < 0 ? 1 : 0;
		for (k = 0; k < 6; k++) pack.pot[i * 6 + k] = gap ? 0 : rnd();
		// a boundary belongs to the last sample before the crossing: for the seam that closes
		// the ring, that is the last sample of the array
		at = r + 1 < runs ? (r + 1) * runLen - 1 : n - 1;
		if (i === at && (r + 1 < runs || pack.path.closes)) { pack.bnd[i] = kind[r]; pack.pol[i] = pol[r]; }
	}
	pack.plates = [];
	for (r = 0; r < runs; r++) pack.plates.push({ id: r, n: Math.min(runLen, n - r * runLen) });
	SP.quantize(pack);
	pack.checksum = SP.checksum(pack);
	return pack;
}

// The pinned pack: fixed world, fixed line, fixed bytes. Every harness loads it.
function pinned() {
	return build(198, 12);
}
// a cut finer than the section's columns: the resample has to merge boundaries and plates,
// which is where the ledger lines earn their keep (L7 crosses ~811 cells, over colCap 768)
function dense(runs, seed) {
	return build(811, runs === undefined ? 40 : runs, circle(811), seed);
}
// an open window of `arcKm`: the run mode the section may not put a clock on
function windowCut(n, runs, arcKm, seed) {
	return build(n, runs, windowPath(n, arcKm), seed);
}

module.exports = {
	build: build, pinned: pinned, dense: dense, windowCut: windowCut,
	circle: circle, windowPath: windowPath, elev: elev
};
