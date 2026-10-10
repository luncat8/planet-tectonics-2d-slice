// vent-tune-sweep.js — 0.2.0 M5 eruptive tuning: the chamber scale against the section's
// own melt supply. The design fixes the three chamber figures as ratios (Vch : Vbirth :
// Vdie = 5 : 1 : 0.1 km3, 0.1.0-design.md §5.2) and tauVent, Tsol and the repose angle as
// absolutes; what it cannot fix is the km3 -> section-m2 conversion, because a section
// column is a strip of a planet and not the planet. P.venKm3M2 is that one scale, and it
// decides which regime the section's eruptives live in:
//
//   scale too small   every column crosses Vbirth: vents everywhere, each one starved;
//   scale in band     chambers cross Vbirth often enough to watch, and a vent drains a
//                     meaningful fraction of a design-scale cone per episode;
//   scale too large   Vbirth sits above the section's own supply and no vent is ever born.
//
// One row per candidate over a live leg, with the numbers a viewer and the ledger both
// read: vents born, the eruption duty cycle, the mass one episode actually carries (in
// toy cells^2, the box's own unit — a design-scale cone is 10-30 cells tall and wide, so
// ~50-450 cells^2), the edifice in px at the default window, the supply the section
// produced, the spill / idle / lost lines, and the K9 invariants on every frame.
// The committed value (params.js) is the first row, so the table reads as the base plus
// its candidates.
//
//   node experiments/vent-tune-sweep.js [candidates=0.25,0.5,1,2,4,8] [frames=3000] [seed=1] [kyr=50]
//
// Candidates are multipliers of the committed P.venKm3M2, so the first row is the base.
// That scale carries the vent-chamber figures, which moved at 0.2.4 (`Vbirth` 1 -> 4,
// landed from the cadence contact table), so rows before that landing are not comparable
// with rows after.
// Report only: nothing here edits params.js; the chosen scale lands through a normal edit
// and a full-suite re-acceptance.
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom;

var CANDS = (process.argv[2] || '0.25,0.5,1,2,4,8').split(',').map(Number);
var frames = +(process.argv[3] || 3000), seed = +(process.argv[4] || 1), kyr = +(process.argv[5] || 50);
var BASE = P.venKm3M2;

// The scale moves three thresholds and the drain constant derived from two of them;
// nothing else in the engine reads venKm3M2.
function applyScale(mult) {
	P.venKm3M2 = BASE * mult;
	P.VchM2 = P.Vch * P.venKm3M2;
	P.VbirthM2 = P.Vbirth * P.venKm3M2;
	P.VdieM2 = P.Vdie * P.venKm3M2;
	P.kErupt = 2 * Math.sqrt(P.VchM2 * P.VbirthM2) / P.tDrain;
}

// One live leg at the default eruptive slider (30 min/frame, design §1.6). Every metric is
// an aggregate over frames and the per-slot trackers are preallocated, so the loop
// allocates nothing.
function leg(mult) {
	applyScale(mult);
	P.sl.geo = kyr * 1e3;
	P.sl.erupt = 1800;
	L.check.planet(seed, 'def');
	SIM.setGeo(kyr * 1e3);

	var prevCol = new Int32Array(P.maxVents).fill(-1);
	var prevIn = new Float64Array(P.maxVents), prevOut = new Float64Array(P.maxVents);
	var births = 0, aliveFrames = 0, feedFrames = 0;
	var toyIn = 0, toyOut = 0, epMax = 0, epN = 0;
	var maxChamber = 0, aboveBirth = 0;
	var maxPile = 0, maxWpx = 0, maxHpx = 0, edV = 0, nEd = 0;
	var k9red = 0, worstLedger = 0, f, v, c, d, alive, feeding, row, x;

	for (f = 0; f < frames; f++) {
		SIM.step();
		alive = 0; feeding = 0;
		for (v = 0; v < S.nVen; v++) {
			c = S.venCol[v];
			if (c >= 0) {
				alive++;
				if (prevCol[v] < 0) births++;
				if (S.venFlux[v] > 0) feeding++;
			}
			prevCol[v] = c;
			// a slot whose cumulative counters went backwards started a new episode: bank
			// the finished one, so the totals survive slot reuse
			if (S.venToyIn[v] < prevIn[v]) { toyIn += prevIn[v]; toyOut += prevOut[v]; epN++; }
			if (S.venToyIn[v] > epMax) epMax = S.venToyIn[v];
			prevIn[v] = S.venToyIn[v];
			prevOut[v] = S.venToyOut[v];
			for (x = 0; x < P.ventBoxW; x++) {
				row = v * P.ventBoxW + x;
				if (S.toyH[row] > maxPile) maxPile = S.toyH[row];
			}
			if (!(S.venEdV[v] > 0)) continue;
			edV += S.venEdV[v];
			nEd++;
			maxWpx = Math.max(maxWpx, S.venW[v] / GEO.kx);
			maxHpx = Math.max(maxHpx, GEO.sy(S.z[c < 0 ? 0 : c]) - GEO.sy(S.z[c < 0 ? 0 : c] + S.venH[v]));
		}
		for (c = 0; c < S.nCol; c++) {
			if (S.colChamber[c] > maxChamber) maxChamber = S.colChamber[c];
			if (S.colChamber[c] >= P.VbirthM2) aboveBirth++;
		}
		if (alive) aliveFrames++;
		if (feeding) feedFrames++;
		d = SIM.diag();
		if (!d.ok) k9red++;
		else if (d.worst > worstLedger) worstLedger = d.worst;
	}
	for (v = 0; v < S.nVen; v++) { toyIn += prevIn[v]; toyOut += prevOut[v]; }

	return {
		births: births, duty: feedFrames / frames, alive: aliveFrames / frames,
		toyIn: toyIn, toyOut: toyOut, epMax: epMax, epN: epN,
		maxWpx: maxWpx, maxHpx: maxHpx, pile: maxPile, edV: edV, nEd: nEd,
		maxChamber: maxChamber, aboveBirth: aboveBirth,
		supply: S.meltArc + S.meltPlume, sill: S.meltSill, idle: S.meltIdle, lost: S.venLost,
		k9red: k9red, ledger: worstLedger, hash: S.hash()
	};
}

function sci(v) { return v === 0 ? '0' : v.toExponential(2); }

console.log(['x', 'Vbirth m2', 'Vch m2', 'births', 'duty%', 'alive%', 'episode cells2 (max)',
	'total cells2 in', 'out', 'edW px', 'edH px', 'pile cells', 'edStock m2', 'nEd frames',
	'maxChamber', 'colFrames>Vbirth', 'supply m2', 'spill', 'idle', 'lost', 'K9 red frames',
	'ledgerErr', 'hash'].join('\t'));
CANDS.forEach(function (mult) {
	var r = leg(mult);
	console.log([mult, sci(P.VbirthM2), sci(P.VchM2), r.births,
		(100 * r.duty).toFixed(1), (100 * r.alive).toFixed(1),
		r.epMax.toFixed(2), r.toyIn.toFixed(1), r.toyOut.toFixed(1),
		r.maxWpx.toFixed(1), r.maxHpx.toFixed(1), r.pile.toFixed(1),
		sci(r.edV), r.nEd, sci(r.maxChamber), r.aboveBirth, sci(r.supply),
		sci(r.sill), sci(r.idle), sci(r.lost), r.k9red,
		r.k9red ? '-' : sci(r.ledger), r.hash].join('\t'));
});
console.log('\nleg: ' + frames + ' frames (' + (frames * kyr / 1e3).toFixed(0) + ' Myr), seed ' +
	seed + ', ' + kyr + ' kyr/frame, eruptive ' + P.sl.erupt + ' s/frame (' + (P.sl.erupt / 60) +
	' min); base venKm3M2 ' + sci(BASE) + ', one toy cell ' + sci(P.toyCellM2) + ' m2');
console.log('a design-scale edifice is 10-30 cells tall and wide (0.1.0-design.md §1.5),' +
	' i.e. ~50-450 cells2 of pile');
