// melt-tune-sweep.js — the melt-production calibration the 0.2.0 M5 worklog deferred
// (archive/0.2.0-m5-worklog.md §9): a live vent cannot build a design-scale edifice because
// the section's melt supply is too small, and the constants that set it are `P.kMelt` (arc:
// melt per released water, weighted by the wedge temperature factor) and `P.kPlumeMelt`
// (plume: m2/Myr at a normalised head). Both are far below the toy's own scale — one toy
// cell is P.toyCellM2 (5.8e5 m2 = 5.8 km3 at the committed conversion), so a 10-30 px cone
// is 50-450 cells2 and a single column has to be fed 3e7-2.6e8 m2 to build one.
//
// The question this answers is not "what is the biggest multiplier that still passes" but
// "what does raising the flux cost the crust budget", because melt is booked straight into
// ledProd[maf] and spilled over chamberCap as sills. So every row carries both sides: the
// eruptive gain (vent births, duty, the mass one episode carries, the edifice in px) and
// the crust cost (melt's share of all mafic production, sill spill, the thickest column
// against crustMax, delamination), with the K9 invariants sampled every frame.
//
// Two tables, because the two sources feed different edifices (arc strato, plume shield)
// and are separate constants: each row scales one of them and holds the other at the
// committed value. Both live legs run per row.
//
//   node experiments/melt-tune-sweep.js [candidates=1,3,10,30,100,300,1000,3000] [frames=3000]
//
// Candidates are multipliers of the committed constants, so the first row is the base.
// That base moved at 0.2.3 (`kMelt` 2e-3 -> 20, landed from the contact legs), so arc
// rows before it are not comparable with rows after; the plume base is unchanged. 0.2.4
// then moved `Vbirth` 1 -> 4 (the vent cadence table), so duty/episode rows before that
// landing are not comparable with rows after either.
// Report only: nothing here edits params.js. A chosen value lands through a normal edit,
// the four strict contact legs and a full acceptance re-run.
'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom;

var CANDS = (process.argv[2] || '1,3,10,30,100,300,1000,3000').split(',').map(Number);
var frames = +(process.argv[3] || 3000);
var BASE_MELT = P.kMelt, BASE_PLM = P.kPlumeMelt;
// the two live legs 0.2.0 M5 tuned against: a 50 kyr leg and a 100 kyr leg, both at the
// default eruptive slider (30 min/frame, 0.1.0-design.md §1.6)
var LEGS = [[1, 50], [5, 100]];
var BOX_CELLS = P.ventBoxW * P.ventBoxH;

// One live leg. Every aggregate is accumulated into preallocated buffers; the loop itself
// allocates nothing but the returned row.
function leg(seed, kyr) {
	P.sl.geo = kyr * 1e3;
	P.sl.erupt = 1800;
	L.check.planet(seed, 'def');
	SIM.setGeo(kyr * 1e3);

	var prevCol = new Int32Array(P.maxVents).fill(-1);
	var prevIn = new Float64Array(P.maxVents), prevOut = new Float64Array(P.maxVents);
	var births = 0, aliveFrames = 0, feedFrames = 0;
	var toyIn = 0, toyOut = 0, epMax = 0, epN = 0;
	var maxPile = 0, pileSumMax = 0, maxWpx = 0, maxHpx = 0;
	var hTotMax = 0, delamStart = -1, delam = 0, prodStart = -1;
	// Column slots are renumbered by the gather, so nothing may be accumulated per slot
	// across frames (the 0.2.0 M5 metric trap). These are maxima taken inside one frame,
	// where a slot is stable, plus the global accumulators S.meltArc / S.meltPlume.
	var maxChamber = 0, edStock = 0;
	var k9red = 0, worstLedger = 0, f, v, c, d, alive, feeding, row, x, pile;

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
			// a slot whose counters went backwards started a new episode: bank the
			// finished one, so the totals survive slot reuse
			if (S.venToyIn[v] < prevIn[v]) { toyIn += prevIn[v]; toyOut += prevOut[v]; epN++; }
			if (S.venToyIn[v] > epMax) epMax = S.venToyIn[v];
			prevIn[v] = S.venToyIn[v];
			prevOut[v] = S.venToyOut[v];
			pile = 0;
			for (x = 0; x < P.ventBoxW; x++) {
				row = v * P.ventBoxW + x;
				pile += S.toyH[row];
				if (S.toyH[row] > maxPile) maxPile = S.toyH[row];
			}
			if (pile > pileSumMax) pileSumMax = pile;
			if (S.venEdV[v] > edStock) edStock = S.venEdV[v];
			if (!(S.venEdV[v] > 0)) continue;
			maxWpx = Math.max(maxWpx, S.venW[v] / GEO.kx);
			maxHpx = Math.max(maxHpx,
				GEO.sy(S.z[c < 0 ? 0 : c]) - GEO.sy(S.z[c < 0 ? 0 : c] + S.venH[v]));
		}
		for (c = 0; c < S.nCol; c++) {
			if (S.colChamber[c] > maxChamber) maxChamber = S.colChamber[c];
			if (S.hTot[c] > hTotMax) hTotMax = S.hTot[c];
		}
		if (alive) aliveFrames++;
		if (feeding) feedFrames++;
		if (delamStart < 0) { delamStart = 0; for (x = 0; x < P.LITH.n; x++) delamStart += S.ledDelam[x]; }
		if (prodStart < 0) { prodStart = 0; for (x = 0; x < P.LITH.n; x++) prodStart += S.ledProd[x]; }
		d = SIM.diag();
		if (!d.ok) k9red++;
		else if (d.worst > worstLedger) worstLedger = d.worst;
	}
	for (v = 0; v < S.nVen; v++) { toyIn += prevIn[v]; toyOut += prevOut[v]; }

	var prod = 0, del = 0;
	for (x = 0; x < P.LITH.n; x++) { prod += S.ledProd[x]; del += S.ledDelam[x]; }

	return {
		km3Myr: (S.meltArc + S.meltPlume) / P.venKm3M2 / (frames * kyr / 1e3),
		yieldArc: S.waterUsed > 0 ? S.meltArc / S.waterUsed : 0,
		maxChamber: maxChamber, edStock: edStock,
		births: births, duty: feedFrames / frames, alive: aliveFrames / frames,
		epMax: epMax, toyIn: toyIn, epN: epN,
		hpx: maxHpx, wpx: maxWpx, pile: pileSumMax, boxFrac: pileSumMax / BOX_CELLS,
		meltShare: prod > prodStart ? (S.meltArc + S.meltPlume) / (prod - prodStart) : 0,
		sill: S.meltSill, idle: S.meltIdle, lost: S.venLost,
		hTot: hTotMax, delam: del - delamStart,
		k9red: k9red, ledger: worstLedger, hash: S.hash()
	};
}

function sci(v) { return v === 0 ? '0' : v.toExponential(2); }
function row(mult, src, r) {
	return [mult, src, r.km3Myr.toFixed(1), sci(r.yieldArc), sci(r.maxChamber), sci(r.edStock), r.births,
		(100 * r.duty).toFixed(1), r.epMax.toFixed(1), r.toyIn.toFixed(0),
		r.hpx.toFixed(1), r.wpx.toFixed(1), r.pile.toFixed(0), (100 * r.boxFrac).toFixed(1),
		(100 * r.meltShare).toFixed(3), sci(r.sill), sci(r.idle), sci(r.lost),
		(r.hTot / 1e3).toFixed(1), sci(r.delam), r.k9red,
		r.k9red ? '-' : sci(r.ledger), r.hash].join('\t');
}

var HEAD = ['x', 'source', 'km3/Myr', 'arc yield', 'max chamber m2', 'edifice stock m2', 'births', 'duty%',
	'episode cells2', 'total cells2', 'edH px', 'edW px', 'pile cells2', 'box%',
	'melt % of mafic prod', 'sill m2', 'idle', 'lost', 'thickest km', 'delam m2',
	'K9 red', 'ledgerErr', 'hash'].join('\t');

[['kMelt', BASE_MELT, BASE_PLM, 'arc'], ['kPlumeMelt', BASE_PLM, BASE_MELT, 'plume']].forEach(function (t) {
	var key = t[0], base = t[1], other = t[2], src = t[3];
	console.log('=== ' + key + ' sweep (' + src + ' source; the other held at its committed value) ===');
	console.log(HEAD);
	CANDS.forEach(function (mult) {
		P.kMelt = src === 'arc' ? base * mult : other;
		P.kPlumeMelt = src === 'plume' ? base * mult : other;
		LEGS.forEach(function (lg) {
			var r = leg(lg[0], lg[1]);
			console.log(row(mult + ' (' + lg[0] + '/' + lg[1] + ')', src, r));
		});
	});
	console.log('');
});
P.kMelt = BASE_MELT;
P.kPlumeMelt = BASE_PLM;

console.log('leg: ' + frames + ' frames, eruptive ' + P.sl.erupt + ' s/frame (' + (P.sl.erupt / 60) +
	' min); legs are seed/kyr ' + LEGS.map(function (l) { return l[0] + '/' + l[1]; }).join(', '));
console.log('base ' + 'kMelt ' + sci(BASE_MELT) + ', kPlumeMelt ' + sci(BASE_PLM) +
	'; one toy cell ' + sci(P.toyCellM2) + ' m2 = ' + (P.toyCellM2 / P.venKm3M2).toFixed(2) +
	' km3, the box holds ' + BOX_CELLS + ' cells');
console.log('target: a live edifice of 10-30 px (0.1.0-design.md §1.5) = 50-450 cells2 of pile,' +
	' i.e. 3e7-2.6e8 m2 into one column');
