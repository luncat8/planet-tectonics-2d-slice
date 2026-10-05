(function (root) {
// columns.js — the Lagrangian crust (design §2.2): layer stacks, initial planet
// and K3/K4 topology. Stacks are bottom-up in the fixed slot range col*layerCap + k, so a 20 m bed
// stays exactly 20 m for as long as the run lasts — nothing is ever resampled.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.COLRNG;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.COLSURF;

var COL = {
	slab: null,
	// lith -> density class of the cached sums: 0 sed, 1 felsic, 2 mafic. Tephra is
	// fragmental (sed density); lava and sill are crystalline (mafic density).
	CLASS: new Uint8Array([0, 1, 2, 0, 2, 2]),
	acc: new Float64Array(3),
	removed: new Float64Array(3),
	removedLi: new Float64Array(P.LITH.n),   // the same removal, split by lithology
	wScratch: new Float64Array(16),
	floorW: new Float64Array(P.colCap),
	lidAcc: new Float64Array(P.nCols),
	lidCov: new Float64Array(P.nCols),
	mask: null, prox: null, order: null, ridgeX: null
};

// --- stack ops ------------------------------------------------------------------

COL.push = function (c, thick, lith, age, flags) {
	if (!(thick > 0)) return 0;
	var LC = P.layerCap, b = c * LC, n = S.colNL[c];
	if (n >= LC) { this.compact(c); n = S.colNL[c]; }
	S.layTh[b + n] = thick;
	S.layLi[b + n] = lith;
	S.layAg[b + n] = age;
	S.layFl[b + n] = flags;
	S.colNL[c] = n + 1;
	return thick;
};

// A bed goes where it belongs in the section, not on top of everything. The stack runs
// from the deepest bed (index 0) up to the surface and P.LITH_RANK rises along it -- sill,
// mafic, felsic, volcanic, sediment -- so a bed belongs above the first bed that ranks
// below it and below the first that ranks above. Appending is what put the arc's felsic
// on top of a sediment drape and a sill on top of the whole crust (the two inversions the
// audit counts), and it is also how a column reached layerCap: every new bed took a slot
// until there were none left.
//
// Returns the volume actually placed. A bed of the same rock and the same flags as the
// one it lands against is thickened instead of added, and at layerCap the stack is
// consolidated first (thinnest adjacent pair of identical beds) so growth has somewhere
// to go.
COL.insertVol = function (st, c, lith, vol, age, flags, place) {
	if (!(vol > 0)) return 0;
	var LC = P.layerCap, b = c * LC, RANK = P.LITH_RANK, r = RANK[lith], n = st.colNL[c], p = 0, k;
	// The default lands after its rank and coalesces with the bed there. A reconcile event
	// can ask for the bottom of its lithology or the top of the stack so its timestamp remains
	// a bed rather than being absorbed into the imported seed bed.
	if (place === 'top') p = n;
	else {
		while (p < n && RANK[st.layLi[b + p]] < r) p++;
		if (place !== 'bottom') while (p < n && RANK[st.layLi[b + p]] === r) p++;
	}
	if (n >= LC) {
		this.consolidate(st, c);
		n = st.colNL[c]; p = 0;
		if (place === 'top') p = n;
		else {
			while (p < n && RANK[st.layLi[b + p]] < r) p++;
			if (place !== 'bottom') while (p < n && RANK[st.layLi[b + p]] === r) p++;
		}
	}
	// By default a bed is thickened rather than added, and the flags of the older bed win: the wet
	// bit says where the bed formed, and a later grain landing on it does not move the
	// bed somewhere else. Matching on it instead filled stacks with one bed per frame
	// (measured: 95 beds under 0.35 km on a column that had been at layerCap for 1605
	// frames), because the surface's wetness flips from frame to frame.
	if (!place && p > 0 && st.layLi[b + p - 1] === lith) {
		st.layFl[b + p - 1] |= flags & ~P.FLAG.wet;
		st.layTh[b + p - 1] += vol;
		return vol;
	}
	if (!place && p < n && st.layLi[b + p] === lith) {
		st.layTh[b + p] += vol;
		if (age < st.layAg[b + p]) st.layAg[b + p] = age;
		return vol;
	}
	// Consolidated and still full: the bed has nowhere to go. It is not lost -- it is
	// booked as consumed, so a stack that will not consolidate cannot quietly eat the
	// ledger (measured: the crust simply stopped appearing at layerCap).
	if (n >= LC) { S.ledCons[lith] += vol; return 0; }
	for (k = n - 1; k >= p; k--) {
		st.layTh[b + k + 1] = st.layTh[b + k];
		st.layLi[b + k + 1] = st.layLi[b + k];
		st.layAg[b + k + 1] = st.layAg[b + k];
		st.layFl[b + k + 1] = st.layFl[b + k];
	}
	st.layTh[b + p] = vol;
	st.layLi[b + p] = lith;
	st.layAg[b + p] = age;
	// A bed that lands under something that was already there cut it: the rock it now
	// carries formed earlier than this one, and only the flag says so. Without it a
	// reader cannot tell underplating from deposition and no age law can be stated.
	st.layFl[b + p] = p < n ? flags | P.FLAG.intr : flags;
	st.colNL[c] = n + 1;
	for (k = 0; k < S.nDep; k++) {
		if (S.depCol[k] !== c) continue;
		if (S.depLay[k] >= p) S.depLay[k]++;
	}
	return vol;
};

// Make room in a full stack. COL.compact already merges the thinnest adjacent pair --
// the same lithology where there is one, otherwise across classes with the mass booked
// as a mix -- so consolidation is compact called until it stops making progress. A stack
// that alternates felsic and sediment has no same-lithology pair to merge and fills to
// layerCap; without this the beds that arrive after that are booked as consumed, which
// is rock quietly leaving the planet (measured: 3644 column-frames at layerCap on seed 5
// at 500 Myr, the belt flow handing the pair's felsic over faster than the stack could
// take it).
COL.consolidate = function (st, c) {
	var t;
	// Room first, then resolution: a stack that is full is consolidated until it has a
	// slot, and a stack whose beds are all thinner than P.bedMin is consolidated until
	// they are not. Beds a few centimetres thick cannot be drawn on a 78 km column and
	// cannot be reasoned about either -- a record of them is 95 entries of nothing, and
	// the column has no room for anything else (measured: 3604 column-frames at
	// layerCap, the worst for 1605 frames in a row).
	while (st.colNL[c] > 2) {
		t = this.compact(c);
		if (st.colNL[c] < P.layerCap && t >= P.bedMin) return;
	}
};

// full stack: merge the thinnest adjacent same-lith pair (mass and class exact). An
// alternating stack with no such pair merges across classes and is counted in ledMix,
// so the mass balance stays auditable instead of silently drifting.
COL.compact = function (c) {
	var LC = P.layerCap, b = c * LC, n = S.colNL[c], k, j, t;
	// returns the combined thickness of the pair it merged, or -1 when there is nothing
	// left to merge
	if (n < 2) return -1;
	var anyK = -1, anyT = Infinity, sameK = -1, sameT = Infinity;
	for (k = 0; k + 1 < n; k++) {
		t = S.layTh[b + k] + S.layTh[b + k + 1];
		if (t < anyT) { anyT = t; anyK = k; }
		if (S.layLi[b + k] === S.layLi[b + k + 1] && t < sameT) { sameT = t; sameK = k; }
	}
	var k0 = sameK >= 0 ? sameK : anyK;
	if (sameK < 0) {
		S.ledMix++;
		var volume = S.layTh[b + k0 + 1] * S.colW[c];
		S.ledMixOut[S.layLi[b + k0 + 1]] += volume;
		S.ledMixIn[S.layLi[b + k0]] += volume;
	}
	S.layTh[b + k0] += S.layTh[b + k0 + 1];
	// the merged bed starts as old as its oldest member: ages are formation times, and
	// the smaller one is the earlier rock (the same rule insertVol's coalescing uses)
	S.layAg[b + k0] = Math.min(S.layAg[b + k0], S.layAg[b + k0 + 1]);
	S.layFl[b + k0] |= S.layFl[b + k0 + 1];
	for (j = k0 + 1; j < n - 1; j++) {
		S.layTh[b + j] = S.layTh[b + j + 1];
		S.layLi[b + j] = S.layLi[b + j + 1];
		S.layAg[b + j] = S.layAg[b + j + 1];
		S.layFl[b + j] = S.layFl[b + j + 1];
	}
	S.colNL[c] = n - 1;
	for (j = 0; j < S.nDep; j++) {
		if (S.depCol[j] !== c) continue;
		if (S.depLay[j] === k0 + 1) S.depLay[j] = k0;
		else if (S.depLay[j] > k0 + 1) S.depLay[j]--;
	}
	return anyT;
};

COL.sums = function (c) {
	var LC = P.layerCap, b = c * LC, n = S.colNL[c], acc = this.acc, k;
	acc[0] = 0; acc[1] = 0; acc[2] = 0;
	for (k = 0; k < n; k++) acc[this.CLASS[S.layLi[b + k]]] += S.layTh[b + k];
	S.hSed[c] = acc[0];
	S.hFel[c] = acc[1];
	S.hMaf[c] = acc[2];
	S.hTot[c] = acc[0] + acc[1] + acc[2];
};

COL.sumsAll = function () { for (var i = 0; i < S.nCol; i++) this.sums(i); };

// erosion intake (M3): take `amount` off the top, top layer first. Returns what was
// actually removed and leaves the per-class split in COL.removed and the per-lithology
// split in COL.removedLi (the erosion kernel turns every removed rock into sediment,
// which the mass ledger has to record as an explicit transformation).
COL.removeTop = function (c, amount) {
	var rem = this.removed, remLi = this.removedLi, LC = P.layerCap, b = c * LC, left = amount, k, t, take, d;
	rem[0] = 0; rem[1] = 0; rem[2] = 0;
	remLi.fill(0);
	while (left > 0 && S.colNL[c] > 0) {
		k = S.colNL[c] - 1;
		t = S.layTh[b + k];
		take = t > left ? left : t;
		rem[this.CLASS[S.layLi[b + k]]] += take;
		remLi[S.layLi[b + k]] += take;
		left -= take;
		if (take < t) { S.layTh[b + k] = t - take; break; }
		// A depth-resolved deposit hosted by a removed top bed has no horizon
		// after erosion. Do not leave it pointing one slot past the new top.
		for (d = 0; d < S.nDep; d++) {
			if (S.depCol[d] === c && S.depLay[d] >= k) S.depLay[d] = -1;
		}
		S.colNL[c] = k;
	}
	return amount - left;
};

// Remove one aggregate density class, shallowest matching bed first. Reconciliation uses
// this instead of removeTop: shrinking felsic crust must not consume a sediment drape merely
// because that drape is above it. A completely removed host invalidates its deposit; hosts
// above a removed bed move down with their bed index.
COL.removeClass = function (st, c, cls, amount) {
	if (!(amount > 0)) return 0;
	var LC = P.layerCap, b = c * LC, left = amount;
	var n = st.colNL[c], k, j, d, t, take;
	for (k = n - 1; k >= 0 && left > 0; k--) {
		if (this.CLASS[st.layLi[b + k]] !== cls) continue;
		t = st.layTh[b + k];
		take = t > left ? left : t;
		left -= take;
		if (take < t) {
			st.layTh[b + k] = t - take;
			if (k + 1 < n) st.layFl[b + k + 1] |= P.FLAG.unconf;
			else st.colBevel[c] = 1;
			break;
		}
		for (d = 0; d < st.nDep; d++) {
			if (st.depCol[d] !== c) continue;
			if (st.depLay[d] === k) st.depLay[d] = -1;
			else if (st.depLay[d] > k) st.depLay[d]--;
		}
		for (j = k; j + 1 < n; j++) {
			st.layTh[b + j] = st.layTh[b + j + 1];
			st.layLi[b + j] = st.layLi[b + j + 1];
			st.layAg[b + j] = st.layAg[b + j + 1];
			st.layFl[b + j] = st.layFl[b + j + 1];
		}
		n--;
		st.colNL[c] = n;
		if (k < n) st.layFl[b + k] |= P.FLAG.unconf;
		else st.colBevel[c] = 1;
	}
	return amount - left;
};

// Drop layer k. Deposits hosted there lose their horizon; records above move with their beds.
COL.removeAt = function (c, k) {
	var LC = P.layerCap, b = c * LC, n = S.colNL[c], j, d;
	for (d = 0; d < S.nDep; d++) {
		if (S.depCol[d] !== c) continue;
		if (S.depLay[d] === k) S.depLay[d] = -1;
		else if (S.depLay[d] > k) S.depLay[d]--;
	}
	for (j = k; j < n - 1; j++) {
		S.layTh[b + j] = S.layTh[b + j + 1];
		S.layLi[b + j] = S.layLi[b + j + 1];
		S.layAg[b + j] = S.layAg[b + j + 1];
		S.layFl[b + j] = S.layFl[b + j + 1];
	}
	S.colNL[c] = n - 1;
};

// Gravitational collapse transport (crust.js K5): move `volume` (m2 of crust per unit
// depth into the page) of felsic crust from `from` to the top of `to`. The two columns
// have different widths, so the same volume is a different thickness on each side — that
// is the whole point of keeping the flux in volume units. Collapse carries the upper
// crust, so the material is peeled off the topmost felsic beds and the beds above them
// ride down; the receiver gets one new felsic bed, or a thicker top bed if it already
// ends in felsic (collapse reworks the surface, it does not bury a new bed under it, and
// this keeps the stack from filling with metre-scale beds). A deposit in a bed that is
// fully taken follows it. hFel is a cache of the stack, so the volume is clamped to it
// and both caches are rebuilt.
COL.collapseMove = function (from, to, volume) {
	var LC = P.layerCap, bf = from * LC, bt = to * LC, k, n, t, take, moved = 0, age = 0;
	var toLayer = -1;
	var peel = volume / S.colW[from], grow;
	if (peel > S.hFel[from]) peel = S.hFel[from];
	if (!(peel > 0)) return 0;
	grow = peel * S.colW[from] / S.colW[to];
	n = S.colNL[from];
	for (k = n - 1; k >= 0; k--) {
		if (S.layLi[bf + k] !== P.LITH.fel) continue;
		age = S.layAg[bf + k];
		break;
	}
	// The sheet goes in at the felsic rank, not on top of whatever the receiver is
	// wearing: delivering it to the surface under a fresh drape every frame is what
	// built a hundred-bed stack of metre-thick beds and filled the column to
	// layerCap. insertVol also merges it into the felsic already there, so a receiver
	// that keeps receiving grows one bed, not one bed per frame.
	if (S.colNL[to] > 0 && S.layLi[bt + S.colNL[to] - 1] === P.LITH.fel) {
		k = S.colNL[to] - 1;
		S.layTh[bt + k] += grow;
		if (S.layAg[bt + k] < age) S.layAg[bt + k] = age;
		toLayer = k;
	} else {
		// insertVol rank-orders felsic beneath a higher-rank surface cap. Deposits that
		// ride with this sheet must attach to the felsic bed, not blindly to the top slot.
		this.insertVol(S, to, P.LITH.fel, grow, age, 0);
		for (k = S.colNL[to] - 1; k >= 0; k--) {
			if (S.layLi[bt + k] === P.LITH.fel) { toLayer = k; break; }
		}
	}
	for (k = n - 1; k >= 0 && moved < peel; k--) {
		if (S.layLi[bf + k] !== P.LITH.fel) continue;
		t = S.layTh[bf + k];
		take = t > peel - moved ? peel - moved : t;
		moved += take;
		S.layTh[bf + k] = t - take;
		if (S.layTh[bf + k] > 0) break;
		this.moveDeposits(from, k, to, toLayer);
		this.removeAt(from, k);
	}
	this.sums(from);
	this.sums(to);
	return moved * S.colW[from];
};

// the layer at depth d below the column's surface, or -1 below the whole stack
COL.layerAt = function (c, d) {
	var LC = P.layerCap, b = c * LC, cum = 0, k;
	for (k = S.colNL[c] - 1; k >= 0; k--) {
		cum += S.layTh[b + k];
		if (d < cum) return k;
	}
	return -1;
};

// --- the belt at a convergent edge -------------------------------------------------

function wmod(k, n) { k %= n; return k < 0 ? k + n : k; }

// One measurement of a collision belt, shared by the orogenic flow (CRU.belt), by the
// collision resistance in the plate solve (PLT.basal) and by the contract gate
// (contact-audit beltScan), so the mechanism, the force and the gate cannot disagree
// about what a belt is.
//
// The flanks are the ground *outside* the belt — three and four columns out on either
// side — so the belt cannot raise the bar it is measured against; a flank taken one
// column out rises with the belt and the flow that widens it stops as soon as it works.
// The belt is the contiguous run of columns around the pair that stands P.beltRise above
// those flanks, walked outward and stopped by a draining sliver (which has no crust to
// be thick with) or by P.beltMaxCols.
//
// Returns the number of columns in the run, and leaves the flank thickness in COL.flankH,
// the run's mean felsic thickness in COL.beltFel and its width in metres in COL.beltW.
// The pair itself always counts, so a contact that has not thickened yet still resists
// over its own two columns.
COL.flankH = 0;
COL.beltFel = 0;
COL.beltW = 0;
COL.beltAt = function (st, n, i) {
	var j = i + 1 < n ? i + 1 : 0, h = st.hTot, fel = st.hFel, w = st.colW;
	var k, c, cnt, thr, sumW, sumF;
	// The flanks sit just outside the ground the orogenic flow reaches (P.beltFeed
	// columns each side). A flank inside that reach is ground the flow itself thickens,
	// so the belt raises the bar it is measured against and shuts its own flow off.
	this.flankH = 0.25 * (h[wmod(i - P.beltFeed - 1, n)] + h[wmod(i - P.beltFeed - 2, n)] +
		h[wmod(j + P.beltFeed + 1, n)] + h[wmod(j + P.beltFeed + 2, n)]);
	thr = this.flankH + P.beltRise;
	cnt = 2; sumW = w[i] + w[j]; sumF = fel[i] + fel[j];
	for (k = 1; k <= P.beltMaxCols; k++) {
		c = wmod(i - k, n);
		if (c === j || st.colGhost[c] || !(h[c] >= thr)) break;
		cnt++; sumW += w[c]; sumF += fel[c];
	}
	for (k = 1; k <= P.beltMaxCols; k++) {
		c = wmod(j + k, n);
		if (c === i || st.colGhost[c] || !(h[c] >= thr)) break;
		cnt++; sumW += w[c]; sumF += fel[c];
	}
	this.beltW = sumW;
	this.beltFel = sumF / cnt;
	return cnt;
};

// --- initial planet (M1.1) ------------------------------------------------------
// Tm is passed in: it lives in sim.js and a require back would be a load cycle.

COL.makePlanet = function (Tm) {
	var n = S.nCol, i, j, th, best, d;
	if (!this.mask) {
		this.mask = new Float64Array(P.colCap);
		this.prox = new Float64Array(P.colCap);
		this.order = new Float64Array(P.colCap);
		this.ridgeX = new Float64Array(P.plateCap);
	}
	var nSeed = (P.seed ^ 0x9e3779b9) | 0;

	// land mask sampled on a circle in noise space: seamless across the x wrap
	var mMax = -Infinity;
	for (i = 0; i < n; i++) {
		th = 2 * Math.PI * i / n;
		this.mask[i] = RNG.fbm2(Math.cos(th) * P.maskScale, Math.sin(th) * P.maskScale, 4, nSeed);
		this.order[i] = this.mask[i];
		if (this.mask[i] > mMax) mMax = this.mask[i];
	}
	// a quantile threshold keeps the continental fraction at landFrac for any seed
	this.order.subarray(0, n).sort();
	var thr = this.order[Math.floor((1 - P.landFrac) * n)];
	// normalized against the seed's own mask range, not against 1: fbm is bell-shaped
	// around 0.5, so (mask-thr)/(1-thr) would cap hFel near 47 km and the design's
	// "mask cores reach 67 km, plateaus above hCollapse" would never happen
	var mSpan = Math.max(1e-9, mMax - thr);

	// proximity to the nearest high mask value: where the sediment supply comes from
	for (i = 0; i < n; i++) {
		best = 0;
		for (d = -P.proxRange; d <= P.proxRange; d++) {
			j = (i + d + n) % n;
			if (this.mask[j] - thr > best) best = this.mask[j] - thr;
		}
		this.prox[i] = Math.min(1, best / mSpan);
	}

	// the initial plate boundaries are the ridges: oceanic age grows away from them
	var nRidge = 0;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		if (S.colPlate[i] !== S.colPlate[j] && nRidge < P.plateCap) this.ridgeX[nRidge++] = S.colX[j];
	}

	var hMafNew = P.hMafNewBase * (1 + P.hMafNewTm * Math.max(0, Tm - 1));
	for (i = 0; i < n; i++) {
		S.colNL[i] = 0;
		S.noise[i] = RNG.range(-1, 1);
		S.fert[i] = 0.5 + 1.5 * RNG.fbm2(Math.cos(2 * Math.PI * i / n) * 3,
			Math.sin(2 * Math.PI * i / n) * 3, 2, nSeed + 77);
		if (this.mask[i] >= thr) this.continental(i, (this.mask[i] - thr) / mSpan, this.margin(i, thr), hMafNew);
		else this.oceanic(i, this.ridgeAge(i, nRidge), hMafNew);
		this.sums(i);
	}

	// sediments need the basin shape: profile, fill, profile again (isostasy responds)
	SURF.profile();
	for (i = 0; i < n; i++) { this.sedimentCover(i); this.sums(i); }
	SURF.profile();
	this.initFanT();
};

COL.ridgeAge = function (i, nRidge) {
	var x = S.colX[i], best = P.wrap, k, d;
	for (k = 0; k < nRidge; k++) {
		d = Math.abs(x - this.ridgeX[k]);
		d = d < P.wrap * 0.5 ? d : P.wrap - d;
		if (d < best) best = d;
	}
	return Math.min(P.oceanAgeMax, best / P.vSpread);
};

// bottom-heavy split of a thickness into `parts` jittered beds
COL.splitBeds = function (total, parts) {
	var w = this.wScratch, sum = 0, k;
	for (k = 0; k < parts; k++) {
		w[k] = RNG.range(0.6, 1.4) * (parts - k);
		sum += w[k];
	}
	for (k = 0; k < parts; k++) w[k] = total * w[k] / sum;
	return w;
};

// Taper the landward three columns, including at the periodic seam. The quantile
// still selects continental columns; only their margin thickness changes.
COL.margin = function (i, thr) {
	var n = S.nCol, nearest = P.marginCols;
	for (var d = 1; d < P.marginCols; d++) {
		if (this.mask[(i + d) % n] < thr || this.mask[(i - d + n) % n] < thr) {
			nearest = d;
			break;
		}
	}
	return SURF.smoothstep(nearest, 0, P.marginCols);
};

COL.continental = function (i, mm, margin, hMafNew) {
	var L = P.LITH;
	var hFel = P.hFelLand0 + P.hFelLandK * Math.pow(mm, P.hFelLandPow);
	hFel *= margin;
	this.push(i, hMafNew * (1 - margin), L.maf, P.cratonAge0, 0);
	var age = P.cratonAge0 + P.cratonAgeK * mm;
	// split into a handful of beds so bedding is visible; the count scales with the
	// total so a 60 km core gets more (thinner) beds than a 20 km shelf
	var parts = 4 + Math.round(hFel / 12e3) + RNG.i(3);
	var w = this.splitBeds(hFel, parts), k;
	// bottom-up: the deepest bed is the oldest
	for (k = 0; k < parts; k++) this.push(i, w[k], L.fel, age * (1 - 0.45 * k / parts), 0);
	S.colAge[i] = age;
};

COL.oceanic = function (i, age, hMafNew) {
	var L = P.LITH, F = P.FLAG;
	var pillow = Math.min(P.pillowH, hMafNew * 0.3);
	this.push(i, pillow, L.maf, age, F.wet);
	this.push(i, hMafNew - pillow, L.maf, age, 0);
	S.colAge[i] = age;
	// pelagic ooze on crust old enough to have collected it
	if (age > P.oozeAgeMin) this.push(i, Math.min(P.oozeMax, P.oozeRate * age), L.sed, age * 0.5, F.wet);
};

COL.sedimentCover = function (i) {
	var L = P.LITH, F = P.FLAG;
	var z = S.z[i], near = this.prox[i];
	var total = z < 0
		? Math.min(P.sedBasinMax, P.sedBasinK * (-z) * (0.35 + 0.65 * near))
		: Math.min(P.sedLandMax, P.sedLandMax * near * near * (1 - Math.min(1, z / P.zKnee)));
	if (total < 20) return;
	var parts = 2 + Math.round(total / 500) + RNG.i(2);
	var w = this.splitBeds(total, parts), k;
	for (k = 0; k < parts; k++) this.push(i, w[k], L.sed, RNG.range(0, 50), z < 0 ? F.wet : 0);
};

// cold lithospheric lid in the fan anomaly: linear from -amp at the surface to 0 at
// 10*sqrt(age) km (half-space cooling). The lid rides the columns, so the mantle
// kernel re-imposes it after every advection step; below it the field is free.
COL.lidAgeCap = 200;
COL.lithDepth = function (age) { return age > 0 ? 1e4 * Math.sqrt(Math.min(age, this.lidAgeCap)) : 0; };

COL.initFanT = function () {
	S.Tf.fill(0);
	this.lidFan();
};

// wrapped gap from the left neighbour of column i to column i (the whole wrap for a
// single column, whose cell is everything)
COL.gapLeft = function (i, n) {
	var d;
	if (n === 1) return P.wrap;
	d = S.colX[i] - S.colX[i > 0 ? i - 1 : n - 1];
	return d < 0 ? d + P.wrap : d;
};

// Deep fan rows are coarse (16 cells of 2500 km at 50 km depth), so a cell must not
// take the lid of whichever column owns its centre. Each column spreads its lid over the
// cells it overlaps; a cell blends lid and advected mantle by the covered fraction
// (a convex blend: bounds are preserved and a lid-free row is left untouched).
COL.lidFan = function () {
	var n = S.nCol, dMax = this.lithDepth(this.lidAgeCap), acc = this.lidAcc, cov = this.lidCov;
	var r, i, j, C, pitch, off, d, dLith, val, a, b, lo, hi, jj;
	if (n === 0) return;
	for (r = 0; r < GEO.N && GEO.rowCy[r] < dMax; r++) {
		C = GEO.fanN[r];
		pitch = P.wrap / C;
		off = GEO.fanOff[r];
		d = GEO.rowCy[r];
		acc.fill(0, 0, C);
		cov.fill(0, 0, C);
		for (i = 0; i < n; i++) {
			dLith = this.lithDepth(S.colAge[i]);
			if (d >= dLith) continue;
			val = -P.lithCold * Math.min(1, S.colAge[i] / P.thermAgeCap) * (1 - d / dLith);
			// the column's own cell: the midpoint of its left gap to the midpoint of its
			// right gap (S.widths). That cell is not centred on x unless the gaps are
			// equal, and the bands may start negative or end past the wrap — both are
			// handled by the modulo below. Centring a band of width colW on x instead
			// makes neighbouring bands overlap, and an overlap of one part in 1e13 is
			// enough to break the convex blend (measured: Tf undershoots -lithCold).
			a = S.colX[i] - 0.5 * this.gapLeft(i, n);
			b = a + S.colW[i];
			for (j = Math.floor(a / pitch); j * pitch < b; j++) {
				lo = a > j * pitch ? a : j * pitch;
				hi = b < (j + 1) * pitch ? b : (j + 1) * pitch;
				jj = j % C;
				if (jj < 0) jj += C;
				acc[jj] += (hi - lo) * val;
				cov[jj] += hi - lo;
			}
		}
		for (j = 0; j < C; j++) {
			if (cov[j] > 0) S.Tf[off + j] = (acc[j] + (pitch - cov[j]) * S.Tf[off + j]) / pitch;
		}
	}
};

// --- K3/K4: gather-based Lagrangian topology ---------------------------------------
// Only these fields travel with a column. Plate records, fan cells and entity tables
// have their own lifetimes. All scratch is allocated once, including the sort comparator.
COL.fields = 'colX colW colPlate colU ext edgeRelN edgePol edgeRPlate trenchDist oldW colAge hFel hMaf hSed hTot syncFel syncMaf syncSed syncValid z slope wet noise damage zDyn fert oVms oMaf oArc oOro oBas oPla volc edge edgeAge edgeSlow colLoad colLoadFel colPla colBevel colChamber colMeltArc colMeltPlume colRecycle colGhost colNL'.split(' ');
COL.oreFields = 'oVms oMaf oArc oOro oBas oPla'.split(' ');
COL.scratch = COL.fields.map(function (key) { return new S[key].constructor(P.colCap); });
COL.layerFields = ['layTh', 'layLi', 'layAg', 'layFl'];
COL.layerScratch = COL.layerFields.map(function (key) { return new S[key].constructor(P.colCap * P.layerCap); });
COL.orderViews = new Array(P.colCap + 1);
COL.layerViews = [[], [], [], []];
for (var size = 0; size <= P.colCap; size++) {
	COL.orderViews[size] = S.sortOrder.subarray(0, size);
	for (var field = 0; field < 4; field++)
		COL.layerViews[field][size] = COL.layerScratch[field].subarray(0, size * P.layerCap);
}
COL.dead = new Uint8Array(P.colCap);
COL.redirect = new Int32Array(P.colCap);
COL.intent = new Int8Array(P.colCap);
COL.accreteLoad = new Float64Array(P.colCap);
COL.accreteLoadFel = new Float64Array(P.colCap);
COL.accretePla = new Float64Array(P.colCap);
COL.accreteLock = new Uint8Array(P.colCap);
// For a consume forced by geometry rather than by the boundary class: the column that ran
// out of room, or -1 when the polarity decides.
COL.crush = new Int32Array(P.colCap);
COL.histEdge = new Int8Array(P.colCap);
COL.histPol = new Int8Array(P.colCap);
COL.histRP = new Int32Array(P.colCap);
COL.histLP = new Int32Array(P.colCap);
COL.histAge = new Float64Array(P.colCap);
COL.histSlow = new Float64Array(P.colCap);
COL.map = new Int32Array(P.colCap);
COL.birthSlot = new Int32Array(P.colCap);
COL.isNew = new Uint8Array(P.colCap);      // final index -> born in this frame's K4
COL.birthVol = new Float64Array(P.colCap); // its own volume of new crust (0 = inherit all)
COL.ramp = new Int32Array(P.colCap);      // newborns of this frame, and where in the
COL.rampG = new Float64Array(P.colCap);    // gap they sit (for the elevation ramp)
COL.rampN = 0;
COL.corrL = new Float64Array(P.plateCap);  // plate displacement the contacts demand
COL.corrR = new Float64Array(P.plateCap);
COL.sortCompare = function (a, b) { return S.colX[a] - S.colX[b] || a - b; };

COL.orderView = function (n) {
	return this.orderViews[n];
};

COL.gather = function (n) {
	var order = S.sortOrder, inv = S.sortInverse, i, k, f, src, dst, LC = P.layerCap, from, to;
	for (i = 0; i < n; i++) inv[order[i]] = i;
	for (f = 0; f < this.fields.length; f++) {
		src = S[this.fields[f]]; dst = this.scratch[f];
		for (i = 0; i < n; i++) dst[i] = src[order[i]];
		for (i = 0; i < n; i++) src[i] = dst[i];
	}
	for (f = 0; f < this.layerFields.length; f++) {
		src = S[this.layerFields[f]]; dst = this.layerScratch[f];
		for (i = 0; i < n; i++) {
			from = order[i] * LC; to = i * LC;
			for (k = 0; k < LC; k++) dst[to + k] = src[from + k];
		}
		src.set(this.layerViews[f][n]);
	}
	for (i = 0; i < S.nDep; i++) if (S.depCol[i] >= 0) S.depCol[i] = inv[S.depCol[i]];
	for (i = 0; i < S.nVen; i++) if (S.venCol[i] >= 0) S.venCol[i] = inv[S.venCol[i]];
	for (i = 0; i < n; i++) if (S.volc[i] >= 0) S.venCol[S.volc[i]] = i;
};

COL.plates = function () {
	var i, p;
	S.plN.fill(0);
	for (i = 0; i < S.nCol; i++) {
		p = S.colPlate[i];
		if (S.plN[p]++ === 0) S.plX0[p] = S.colX[i];
	}
	for (p = 0; p < S.nPl; p++) {
		if (S.plN[p] > 0) continue;
		S.plU[p] = 0;
		S.plUP[p] = 0;
		S.plDmg[p] = 0;
	}
};

COL.transport = function (st, dt) {
	if (!(dt > 0)) return;
	var n = st.nCol, i, oldRight = this.map;
	for (i = 0; i < n; i++) {
		st.oldW[i] = st.colW[i];
		st.sortOrder[i] = i;
		st.colX[i] += st.colU[i] * dt;
		st.colX[i] -= Math.floor(st.colX[i] / P.wrap) * P.wrap;
	}
	this.floor(st, n);
	this.orderView(n).sort(this.sortCompare);
	this.gather(n);
	// An edge's history is valid only if the same two records are still neighbours;
	// the right plate id alone cannot distinguish a column overtaking its neighbour.
	for (i = 0; i < n; i++) {
		oldRight[i] = st.sortInverse[(st.sortOrder[i] + 1) % n];
		if (oldRight[i] === (i + 1) % n) continue;
		st.edge[i] = P.EDGE.neutral;
		st.edgePol[i] = 0;
		st.edgeAge[i] = 0; st.edgeSlow[i] = 0;
		st.edgeRPlate[i] = -1;
	}
	st.widths();
	this.plates();
};

// A converging continental pair may compress to the conveyor floor; other boundaries keep
// the ordinary separation floor. Use the current pair velocities, not its old edge class:
// sorting can hand the edge slot to a different pair in the same frame.
COL.isClosingCC = function (st, i, j) {
	return st.colPlate[i] !== st.colPlate[j] && !st.colGhost[i] && !st.colGhost[j] &&
		st.colU[i] > st.colU[j] && st.hFel[i] >= P.hOceanic && st.hFel[j] >= P.hOceanic;
};

// Two records of different plates may not interpenetrate. Widths come from spacing, so
// an unresolved overlap squeezes a column toward zero territory and its volume-conserving
// stack toward a kilometre-scale spike; the floor is where the contact carries the stress
// instead of the records crossing and swapping in the sort.
//
// The correction is a *plate* correction, not a pair correction: each plate is displaced
// rigidly by the largest overlap it is holding up, half of it each way (momentum
// neutral). Nudging the two records apart in place instead would take the difference out
// of their outer neighbours' gaps, every frame, and the outermost column of the chain
// would end up with no width at all — and with no width, no thickness. A plate with a
// contact on both sides is pushed both ways, so the passes repeat until no pair is inside
// the floor, bounded so a plate ringed by contacts cannot spin. A ring can be over-
// constrained — a plate held between two equal overlaps has nowhere to move — so the
// floor is a bound and not an equality: measured on seed 5 at 500 Myr, 3 passes left a C-C
// pair 7.5% inside the floor, 8 left 0.8%, 16 left 0.05%, and P.floorTol carries that.
COL.floor = function (st, n) {
	var min, i, j, d, p, q, a, pass, disp, any;
	for (pass = 0; pass < P.floorPass; pass++) {
		for (i = 0; i < P.plateCap; i++) { this.corrL[i] = 0; this.corrR[i] = 0; }
		any = false;
		for (i = 0; i < n; i++) {
			j = i + 1 < n ? i + 1 : 0;
			p = st.colPlate[i]; q = st.colPlate[j];
			if (p === q) continue;
			d = st.colX[j] - st.colX[i];
			if (d < 0) d += P.wrap;
			min = this.isClosingCC(st, i, j) ? P.crushFloor : P.gFloor * P.w0;
			if (d >= min) continue;
			// settled when no pair is inside the floor, not when no plate moved: a plate
			// held between two equal overlaps has nothing to move and two pairs to fix
			any = true;
			a = 0.5 * (min - d);
			if (a > this.corrL[p]) this.corrL[p] = a;
			if (a > this.corrR[q]) this.corrR[q] = a;
		}
		if (!any) break;
		for (p = 0; p < P.plateCap; p++) {
			disp = this.corrR[p] - this.corrL[p];
			if (disp === 0) continue;
			for (i = 0; i < n; i++) if (st.colPlate[i] === p) st.colX[i] = wrapX(st.colX[i] + disp);
		}
	}
};

// K4 can add a newborn or retire an accreted record *after* K3's plate-floor solve. Apply
// the same rigid plate correction to the resulting topology, then conserve every stack and
// mobile-load volume over its corrected Voronoi width. Without this end-of-K4 projection a
// newly exposed C-O edge can finish a frame several kilometres inside its ordinary floor.
COL.finalFloor = function (st, n) {
	var i, k, b, ratio;
	for (i = 0; i < n; i++) this.floorW[i] = st.colW[i];
	this.floor(st, n);
	st.widths();
	for (i = 0; i < n; i++) {
		ratio = this.floorW[i] / st.colW[i];
		if (ratio !== 1) {
			b = i * P.layerCap;
			for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] *= ratio;
			st.colLoad[i] *= ratio;
			st.colLoadFel[i] *= ratio;
			st.colPla[i] *= ratio;
		}
		this.sums(i);
	}
};

function wrapX(x) {
	x %= P.wrap;
	return x < 0 ? x + P.wrap : x;
}

// What, if anything, a boundary does to the *number* of columns this frame. Both
// topology intents are gated on the terms the classifier itself uses to enter a state —
// past epsHi and held for evAge. The hysteresis deliberately keeps a contact classified
// at a tenth of the entry speed, so without this a boundary with no meaningful motion
// spawns and kills a record every few frames, which is the loudest thing the section
// ever does (0.1.5 M1c).
COL.intents = function () {
	var n = S.nCol, i, j, im, d, e, gL, min = P.gFloor * P.w0;
	this.intent.fill(0, 0, n);
	this.crush.fill(-1, 0, n);
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		im = i > 0 ? i - 1 : n - 1;
		d = S.colX[j] - S.colX[i];
		if (d <= 0) d += P.wrap;
		gL = S.colX[i] - S.colX[im];
		if (gL < 0) gL += P.wrap;
		// A sliver is retired the moment the trench has closed both its gaps to the
		// floor: its territory is then two floors wide, and handing that back moves each
		// neighbour's surface by metres. This is geometry, not a boundary state, so it
		// is not gated on the classifier's entry terms like the two topology intents.
		if (S.colGhost[i]) {
			// A sliver that has another sliver on its right is in a pile-up: the trench
			// has eaten several columns in a row and each of them left a marker here.
			// The rightmost one waits for its own gaps to close, so without this the
			// whole chain waits behind it and the markers squeeze the real columns
			// between them. A chain drains from the left instead.
			if (gL <= min && (d <= min * 1.0001 || S.colGhost[j])) { this.intent[i] = 3; continue; }
			// The other way a sliver is finished: its trench gap opens. The plates have
			// separated, so the sliver marks no trench any more, and what is left is a
			// zero-crust record inside its own plate stealing width from the column
			// beside it for as long as that plate lives -- the floor cannot help, because
			// a plate is rigid and both of them move together. Retire it, and the column
			// beside it gets its territory back.
			if (S.edgeRelN[S.colPlate[im] !== S.colPlate[i] ? im : i] > 0) this.intent[i] = 3;
			continue;
		}
		// Two floors on one column is a configuration the floor cannot satisfy: the
		// column's whole territory is narrower than one floor, so no position of it
		// clears both boundaries. It happens whenever a plate is squeezed from both
		// sides at once -- the separation floor holds each gap at the floor and the
		// span between the two outer columns keeps shrinking, so the middle column's
		// width collapses towards zero. The age gate below cannot be allowed to hold
		// the topology open that long, so a crushed column is absorbed across the gap
		// with a real column on the other side, on geometry alone.
		if (gL <= min && d <= min * 1.0001) {
			if (S.colGhost[im]) { this.intent[i] = 2; this.crush[i] = i; }
			else { this.intent[im] = 2; this.crush[im] = i; }
			continue;
		}
		// A closing C-C pair that has exhausted its small crush gap advances by retiring
		// its thinner boundary record. The stack is split by the exact territory each
		// neighbour gains; unlike subduction this is an in-crust move, not a sink.
		if (!this.intent[i] && S.edge[i] === P.EDGE.collide &&
			this.isClosingCC(S, i, j) && d <= P.crushFloor * 1.0001) {
			this.intent[i] = 4;
			this.crush[i] = S.hTot[i] < S.hTot[j] ? i :
				S.hTot[j] < S.hTot[i] ? j : (i < j ? i : j);
			continue;
		}
		if (!(Math.abs(S.edgeRelN[i]) > P.epsHi && S.edgeAge[i] > P.evAge)) continue;
		e = S.edge[i];
		if (e === P.EDGE.open && d > 2 * P.rGap * P.w0) this.intent[i] = 1;
		// A consuming pair is at the floor, not at the contact radius. Consuming leaves
		// the geometry of the pair unchanged (the loser becomes a sliver in the same
		// place), so a trigger at rContact re-fires on the very next frame and the
		// trench runs at the frame rate instead of the convergence rate.
		// A closing C-C pair has its own mass-exact conveyor branch above; only an
		// oceanic subducting column is sent through this consumption sink.
		if (e === P.EDGE.subduct && d <= min * 1.0001 && S.edgeRelN[i] < 0 && !S.colGhost[j]) this.intent[i] = 2;
	}
};

// During K4, layTh stores volume (m3 per unit section depth), not thickness.
// This lets every transfer and merge be exact before final widths are known.
// Move a fraction of `from`'s stack to `to`, at most `room` volume (Infinity for no
// limit), and return what moved. The cap matters at a birth: the newborn's volume is
// fixed by what its own width of new crust should be, and the material it inherits is
// what is left over.
COL.transfer = function (from, to, fraction, room) {
	var b = from * P.layerCap, k, t, moved = 0;
	for (k = 0; k < S.colNL[from]; k++) {
		t = S.layTh[b + k] * fraction;
		if (t > room - moved) t = room - moved;
		if (t <= 0) break;
		S.layTh[b + k] -= t;
		// the receiver may be taking from two parents in one frame, and each parent's
		// beds arrive deepest-first, so only a rank-ordered insert keeps the two
		// sections from being stacked on top of each other
		this.insertVol(S, to, S.layLi[b + k], t, S.layAg[b + k], S.layFl[b + k]);
		moved += t;
	}
	return moved;
};

COL.moveDeposits = function (from, layer, to, newLayer) {
	for (var d = 0; d < S.nDep; d++) {
		if (S.depCol[d] !== from || S.depLay[d] !== layer) continue;
		S.depCol[d] = to; S.depLay[d] = newLayer;
	}
};

// The subduction resolution (0.1.5 M1a). The loser's stack goes into the ribbon exactly
// as before, and the *record* is not deleted: it keeps its place and its territory, its
// plate becomes the overriding one, and it is left empty — a trench sliver. Deleting the
// record is what used to re-partition a full column of territory between the two columns
// beside it in one frame, and since thickness is volume / width that is a 20-35% loss of
// crust (a multi-kilometre pop) for both of them. The sliver holds the territory until
// the trench has closed both its gaps to the floor, and it is drawn as the profile its
// two real neighbours already make across it, so neither the consumption frame nor the
// sliver's life moves the section.
COL.consume = function (i, j, crushLoser) {
	var left = i, right = j, loser, winner, b, k, lith, t;
	var SLAB = this.slab;
	if (!SLAB) {
		SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.COLSLAB;
		this.slab = SLAB;
	}
	loser = crushLoser >= 0 ? crushLoser : (S.edgePol[i] < 0 ? left : right);
	winner = loser === left ? right : left;
	b = loser * P.layerCap;
	var ribbon = SLAB && SLAB.ready;
	if (ribbon) {
		var gap = S.colX[right] - S.colX[left];
		if (gap < 0) gap += P.wrap;
		// the ribbon is anchored at the edge (the midpoint of the pair's gap), so the
		// trench does not step half a column from frame to frame
		SLAB.appendStack(S, loser, wrapX(S.colX[left] + gap * 0.5),
			loser === left ? 1 : -1, S.colPlate[winner], 0);
	}
	for (k = 0; k < S.colNL[loser]; k++) {
		lith = S.layLi[b + k]; t = S.layTh[b + k];
		if (this.CLASS[lith] === 0) {
			// half the sediment is scraped off into the prism on the margin
			this.insertVol(S, winner, lith, t * 0.5, S.layAg[b + k], S.layFl[b + k]);
			this.moveDeposits(loser, k, winner, S.colNL[winner] - 1);
			if (!ribbon) S.ledCons[lith] += 0.5 * t * S.colW[loser];
		} else {
			this.moveDeposits(loser, k, -1, -1);
			if (!ribbon) S.ledCons[lith] += t * S.colW[loser];
		}
	}
	// A chamber belongs to the plate margin even when the oceanic column is consumed.
	// Moving it here keeps the M4 active-mass ledger exact.
	S.colChamber[winner] += S.colChamber[loser];
	S.colChamber[loser] = 0;
	// The loose load rides on the plate, so it belongs to the margin that just won the
	// pair; zeroing it here instead would delete sediment with nothing booked for it.
	S.colLoad[winner] += S.colLoad[loser];
	S.colLoadFel[winner] += S.colLoadFel[loser];
	S.colPla[winner] += S.colPla[loser];
	S.colLoad[loser] = 0; S.colLoadFel[loser] = 0; S.colPla[loser] = 0;
	S.colPlate[loser] = S.colPlate[winner];
	S.colAge[loser] = 0;
	S.colNL[loser] = 0;
	S.colGhost[loser] = 1;
	S.damage[loser] = 0;
	this.redirect[loser] = winner;
};

// Blend fields that describe the newly shared surface area, not conserved rock volume.
COL.mixArea = function (st, to, from, oldW, addW) {
	var den = oldW + addW, i, v;
	if (!(den > 0)) return;
	for (i = 0; i < this.oreFields.length; i++) {
		v = st[this.oreFields[i]];
		v[to] = (v[to] * oldW + v[from] * addW) / den;
	}
	st.fert[to] = (st.fert[to] * oldW + st.fert[from] * addW) / den;
	st.noise[to] = (st.noise[to] * oldW + st.noise[from] * addW) / den;
	st.damage[to] = (st.damage[to] * oldW + st.damage[from] * addW) / den;
	st.zDyn[to] = (st.zDyn[to] * oldW + st.zDyn[from] * addW) / den;
	if (!st.syncValid[to] || !st.syncValid[from]) { st.syncValid[to] = 0; return; }
	st.syncFel[to] = (st.syncFel[to] * oldW + st.syncFel[from] * addW) / den;
	st.syncMaf[to] = (st.syncMaf[to] * oldW + st.syncMaf[from] * addW) / den;
	st.syncSed[to] = (st.syncSed[to] * oldW + st.syncSed[from] * addW) / den;
};

// Retire one compressed C-C boundary record. Its stack remains in the crust: each bed's
// volume is divided in proportion to the Voronoi territory the two neighbours gain.
COL.accrete = function (st, c) {
	var n = st.nCol, prev = c > 0 ? c - 1 : n - 1, next = c + 1 < n ? c + 1 : 0;
	if (n < 3 || prev === next || st.plN[st.colPlate[c]] < 2 ||
		this.dead[prev] || this.dead[c] || this.dead[next] ||
		this.accreteLock[prev] || this.accreteLock[c] || this.accreteLock[next]) return false;
	var pm = prev > 0 ? prev - 1 : n - 1, np = next + 1 < n ? next + 1 : 0;
	var gapL = st.colX[c] - st.colX[prev], gapR = st.colX[next] - st.colX[c];
	var gapP = st.colX[prev] - st.colX[pm], gapN = st.colX[np] - st.colX[next];
	if (gapL < 0) gapL += P.wrap;
	if (gapR < 0) gapR += P.wrap;
	if (gapP < 0) gapP += P.wrap;
	if (gapN < 0) gapN += P.wrap;
	var totalGap = gapL + gapR;
	if (!(totalGap > 0)) return false;
	var sharePrev = gapR / totalGap, addPrev = 0.5 * gapR, addNext = 0.5 * gapL;
	var oldPrev = 0.5 * (gapP + gapL), oldNext = 0.5 * (gapR + gapN);
	var load = st.colLoad[c] * st.oldW[c];
	var loadFel = st.colLoadFel[c] * st.oldW[c];
	var pla = st.colPla[c] * st.oldW[c];
	var chamber = st.colChamber[c], meltArc = st.colMeltArc[c];
	var meltPlume = st.colMeltPlume[c], recycle = st.colRecycle[c];
	this.transfer(c, prev, sharePrev, Infinity);
	this.transfer(c, next, 1, Infinity);
	this.accreteLoad[prev] += load * sharePrev;
	this.accreteLoad[next] += load * (1 - sharePrev);
	this.accreteLoadFel[prev] += loadFel * sharePrev;
	this.accreteLoadFel[next] += loadFel * (1 - sharePrev);
	this.accretePla[prev] += pla * sharePrev;
	this.accretePla[next] += pla * (1 - sharePrev);
	st.colChamber[prev] += chamber * sharePrev;
	st.colChamber[next] += chamber * (1 - sharePrev);
	st.colMeltArc[prev] += meltArc * sharePrev;
	st.colMeltArc[next] += meltArc * (1 - sharePrev);
	st.colMeltPlume[prev] += meltPlume * sharePrev;
	st.colMeltPlume[next] += meltPlume * (1 - sharePrev);
	st.colRecycle[prev] += recycle * sharePrev;
	st.colRecycle[next] += recycle * (1 - sharePrev);
	this.mixArea(st, prev, c, oldPrev, addPrev);
	this.mixArea(st, next, c, oldNext, addNext);
	if (st.colBevel[c]) { st.colBevel[prev] = 1; st.colBevel[next] = 1; }
	st.colLoad[c] = 0; st.colLoadFel[c] = 0; st.colPla[c] = 0;
	st.colChamber[c] = 0; st.colMeltArc[c] = 0; st.colMeltPlume[c] = 0; st.colRecycle[c] = 0;
	st.colNL[c] = 0;
	this.redirect[c] = sharePrev >= 0.5 ? prev : next;
	this.accreteLock[prev] = 1; this.accreteLock[c] = 1; this.accreteLock[next] = 1;
	return true;
};

// What a draining record still holds when the trench retires it. A sliver owns no crust,
// but it is not nothing: melt can be parked in its chamber after it was drained (a plume
// head that arrives over a trench), and the gather below drops the slot, so anything left
// in it would leave the model with no entry anywhere. Booked here instead — a draining
// record is never a mass source and never a sink. Called from K4, where layTh is a volume.
COL.drain = function (st, c) {
	var b = c * P.layerCap, k;
	for (k = 0; k < st.colNL[c]; k++) {
		st.ledCons[st.layLi[b + k]] += st.layTh[b + k];
		st.layTh[b + k] = 0;
	}
	st.colNL[c] = 0;
	if (st.colChamber[c] > 0) {
		st.ledCons[P.LITH.maf] += st.colChamber[c];
		st.colChamber[c] = 0;
	}
};

// One birth per qualifying gap (design §4.3): the newborn sits at the gap midpoint,
// joins the left plate (the wrapped seam too) and starts hot (age 0, damage 0.6). Both
// donor sets continental (mean hFel over K columns >= hRiftBreakup) -> a rift column;
// otherwise the mantle sources fresh oceanic crust of hMafNew(Tm) over the newborn's own
// width, recorded in ledProd. Either way the *material* of the newborn comes from the
// territory it takes (COL.inherit), not from a share of the K donors: in 1D the gap is
// already owned by the two columns beside it and has been stretched thin by the opening,
// while the reference's 1/(K+1) share fills an *empty* fixed grid cell. Taking 1/(K+1)
// from each of 2K donors packed 1.5 columns of crust into a half-width cell — a 69 km
// spike with +6 km of relief at every rift axis instead of the design's rift valley, and
// the thickest column then won every C-C collision (347 km of crust, 55 km of relief
// after 1 Gyr). Ore potentials are concentrations (0..1, design §4.7), so they follow the
// territory as a weighted mean and stay bounded instead of summing past 1.
COL.rift = function (i, j, birth, Tm) {
	var n = S.nCol, d, a, b, gap, leftFel = 0, rightFel = 0, continental = true, f;
	for (d = 0; d < P.K; d++) {
		a = (i - d + n) % n; b = (j + d) % n;
		if (this.dead[a] || this.dead[b]) continental = false;
		leftFel += S.hFel[a]; rightFel += S.hFel[b];
	}
	continental = continental &&
		leftFel >= P.K * P.hRiftBreakup && rightFel >= P.K * P.hRiftBreakup;
	gap = S.colX[j] - S.colX[i];
	if (gap < 0) gap += P.wrap;
	for (var field = 0; field < this.fields.length; field++) S[this.fields[field]][birth] = 0;
	S.colNL[birth] = 0;
	S.colW[birth] = 1; // K4 stores layer volumes until final widths are known
	S.colX[birth] = (S.colX[i] + gap * 0.5) % P.wrap;
	S.colPlate[birth] = S.colPlate[i];
	S.colU[birth] = S.colU[i];
	S.colAge[birth] = 0;
	S.damage[birth] = 0.6;
	S.noise[birth] = (S.noise[i] + S.noise[j]) * 0.5;
	S.fert[birth] = (S.fert[i] + S.fert[j]) * 0.5;
	S.volc[birth] = -1;
	S.oldW[birth] = 0;
	S.edgeRPlate[birth] = -1;
	S.edge[birth] = P.EDGE.neutral;
	S.edgeAge[birth] = 0; S.edgeSlow[birth] = 0;
	// The newborn's final width is exactly half the gap (it sits at the midpoint), so a
	// continental rift inherits the whole of it and an oceanic one is filled out to
	// hMafNew(Tm) of new crust over that width, whatever the inherited sliver already
	// provides (COL.inherit books the difference as the mantle source). VMS seeding at
	// oceanic birth is M6 (design §4.7).
	// birthVol is the newborn's total crust in volume: the cap COL.inherit fills to. A
	// rift column has no mantle source -- it is cut from the two margins -- so its cap is
	// 0, meaning "the whole share the geometry gives you". A cap of 0 read as a literal
	// zero left the newborn empty (measured: 0 km of crust at a continental rift, and a
	// boundary that then re-opened and re-cut forever after).
	this.birthVol[birth] = continental ? 0 :
		P.hMafNewBase * (1 + P.hMafNewTm * Math.max(0, Tm - 1)) * gap * 0.5;
};

// The gap the column `q` had on one side before this frame's births: twice the final
// gap when a newborn sits in it (a newborn is placed at the gap midpoint).
COL.preGap = function (st, count, q, dir) {
	var o = dir > 0 ? (q + 1 < count ? q + 1 : 0) : (q > 0 ? q - 1 : count - 1);
	var g = dir > 0 ? st.colX[o] - st.colX[q] : st.colX[q] - st.colX[o];
	if (g < 0) g += P.wrap;
	return this.isNew[o] ? 2 * g : g;
};

// A newborn takes the territory its two parents lose, and the material that goes with
// it: fraction = (width lost) / (the parent's width before the birth). Every thickness
// is therefore unchanged by the birth — the parents keep theirs and the newborn is the
// width-weighted mean of the two, exactly what the renderer interpolates between them —
// so the profile stays continuous and mass stays inside the columns (no ledger entry).
// Runs while colW is still the volume-mode 1, so it reads positions, not widths.
COL.inherit = function (st, count) {
	var i, im, ip, gL, gR, wL, wR, f, o, v, got, b, k, target, room;
	if (count < 3) return;
	for (i = 0; i < count; i++) {
		if (!this.isNew[i]) continue;
		im = i > 0 ? i - 1 : count - 1;
		ip = i + 1 < count ? i + 1 : 0;
		gL = st.colX[i] - st.colX[im];
		gR = st.colX[ip] - st.colX[i];
		if (gL < 0) gL += P.wrap;
		if (gR < 0) gR += P.wrap;
		// half of each final gap is what the newborn took from that parent
		wL = 0.5 * (this.preGap(st, count, im, -1) + 2 * gL);
		wR = 0.5 * (2 * gR + this.preGap(st, count, ip, 1));
		target = this.birthVol[i];
		b = i * P.layerCap;
		got = 0;
		for (k = 0; k < st.colNL[i]; k++) got += st.layTh[b + k];
		room = target > 0 ? target : Infinity;
		f = wL > 0 ? 0.5 * gL / wL : 0;
		if (f > 0) got += this.transfer(im, i, f, room - got);
		f = wR > 0 ? 0.5 * gR / wR : 0;
		if (f > 0) got += this.transfer(ip, i, f, room - got);
		// What the newborn still does not have is what the rift makes: the design's
		// hMafNew of oceanic crust over the newborn's own width, booked in ledProd.
		// Without this the axis carries the gap's stretched old crust *and* a full
		// thickness of new one, which is a 13 km needle standing 2 km above its own
		// margins on the frame it is born (0.1.5 R1).
		if (target > got) {
			// New oceanic crust is the *basement* of the newborn, not a lid on its
			// inherited section, so it is inserted at the mafic rank.
			this.insertVol(st, i, P.LITH.maf, target - got, 0, P.FLAG.wet);
			st.ledProd[P.LITH.maf] += target - got;
		}
		for (o = 0; o < this.oreFields.length; o++) {
			v = st[this.oreFields[o]];
			v[i] = (v[im] * gL + v[ip] * gR) / (gL + gR);
		}
		this.ramp[this.rampN++] = i;
		this.rampG[this.rampN - 1] = gL / (gL + gR);
	}
};

// A new crustal body is not fully buoyant on the frame it appears. The newborn starts at
// the elevation its two parents make across the gap and relaxes to its own isostasy with
// tauDyn, which is what zDyn is for: a ridge is high, but it is *raised*, and a 1 km
// step out of nothing on the birth frame is exactly the kind of event the section must
// not have (0.1.5 R1). Run after K4 has turned layer volumes back into thicknesses, so
// the newborn's own isostasy is the one that will be drawn.
COL.rampZ = function (st) {
	var n = this.rampN, i, im, ip, c, g, tgt;
	for (i = 0; i < n; i++) {
		c = this.ramp[i]; g = this.rampG[i];
		im = c > 0 ? c - 1 : st.nCol - 1;
		ip = c + 1 < st.nCol ? c + 1 : 0;
		tgt = SURF.elev(im) + (SURF.elev(ip) - SURF.elev(im)) * g;
		st.zDyn[c] += tgt - SURF.elev(c);
	}
	this.rampN = 0;
};

COL.k4 = function (st, dt, t, Tm) {
	var self = COL;
	if (!(dt > 0)) return false;
	var n = st.nCol, i, j, k, b, count = 0, births = 0, appended = 0, freed = 0, reuse = 0, slot, oldN = n, any = false;
	self.intents();
	for (i = 0; i < n; i++) if (self.intent[i]) { any = true; break; }
	if (!any) {
		for (i = 0; i < n; i++) {
			if (st.colW[i] === st.oldW[i]) continue;
			b = i * P.layerCap;
			for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] *= st.oldW[i] / st.colW[i];
			// Mobile sediment and its associated fractions are heights over the same
			// Voronoi area as the stack. A no-topology frame still changes widths.
			st.colLoad[i] *= st.oldW[i] / st.colW[i];
			st.colLoadFel[i] *= st.oldW[i] / st.colW[i];
			st.colPla[i] *= st.oldW[i] / st.colW[i];
			self.sums(i);
		}
		// no topology ran, so nothing was born: a stale flag would name a record that
		// has been alive for frames
		self.isNew.fill(0, 0, n);
		return false;
	}
	self.dead.fill(0);
	self.accreteLock.fill(0, 0, n);
	self.accreteLoad.fill(0, 0, n);
	self.accreteLoadFel.fill(0, 0, n);
	self.accretePla.fill(0, 0, n);
	self.rampN = 0;
	for (i = 0; i < n; i++) {
		self.redirect[i] = i;
		self.histEdge[i] = st.edge[i]; self.histPol[i] = st.edgePol[i];
		self.histRP[i] = st.edgeRPlate[i]; self.histLP[i] = st.colPlate[i];
		self.histAge[i] = st.edgeAge[i]; self.histSlow[i] = st.edgeSlow[i];
	}
	// Convert to volume once; compaction in COL.push now records volume, not thickness.
	for (i = 0; i < n; i++) {
		b = i * P.layerCap;
		for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] *= st.oldW[i];
		st.colW[i] = 1;
	}
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (self.intent[i] !== 3 || self.dead[i] || self.dead[j]) continue;
		self.drain(st, i);
		self.dead[i] = 1;
	}
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (self.intent[i] !== 4 || self.dead[i] || self.dead[j]) continue;
		k = self.crush[i];
		if ((k !== i && k !== j) || !self.accrete(st, k)) continue;
		self.dead[k] = 1;
	}
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (self.intent[i] !== 2 || self.dead[i] || self.dead[j]) continue;
		self.consume(i, j, self.crush[i]);
	}
	for (i = 0; i < n; i++) freed += self.dead[i];
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (self.intent[i] !== 1 || self.dead[i] || self.dead[j]) continue;
		if (n - freed + births >= P.colCap) { st.spawnSkipped++; continue; }
		if (n + appended < P.colCap) slot = n + appended++;
		else {
			while (self.dead[reuse] !== 1) reuse++;
			slot = reuse++;
			self.dead[slot] = 2; // occupied by a birth, but still an old retired sliver
		}
		self.rift(i, j, slot, Tm);
		self.birthSlot[births++] = slot;
	}
	// Follow redirects before sorting. A consumed vent survives on the margin; a
	// deposit tied to a destroyed bed loses its horizon instead of pointing into
	// an unrelated stack on the margin. A sliver is both: its beds went to the
	// ribbon, so the horizon they hosted is gone.
	for (i = 0; i < st.nDep; i++) {
		if (st.depCol[i] < 0) continue;
		if (self.dead[st.depCol[i]] || st.colGhost[st.depCol[i]]) {
			j = self.redirect[st.depCol[i]];
			if (self.accreteLock[st.depCol[i]] && j >= 0 && !self.dead[j]) {
				st.depCol[i] = j;
				st.depLay[i] = -1; // the layer was split into the receiving stacks
			} else st.depCol[i] = -1;
		}
	}
	for (i = 0; i < st.nVen; i++) {
		if (st.venCol[i] < 0) continue;
		if (self.dead[st.venCol[i]] || st.colGhost[st.venCol[i]]) {
			j = self.redirect[st.venCol[i]];
			if (st.volc[j] < 0) { st.volc[j] = i; st.venCol[i] = j; }
			else st.venCol[i] = -1;
		}
	}
	for (i = 0; i < n + appended; i++) if (self.dead[i] !== 1) st.sortOrder[count++] = i;
	self.orderView(count).sort(self.sortCompare);
	self.gather(count);
	st.nCol = count;
	// Map pre-K4 indices into the final topology for edge-history hand-off.
	self.map.fill(-1, 0, n + appended);
	for (i = 0; i < count; i++) self.map[st.sortOrder[i]] = i;
	// gather() already remapped deposits/vents using inverse; dead deposits are -1.
	// For each old boundary, its new right column takes the edge from its new left
	// neighbour (which may be the newborn at a ridge or the left of a consumed one).
	for (i = 0; i < count; i++) {
		st.edge[i] = P.EDGE.none;
		st.edgeAge[i] = 0; st.edgeSlow[i] = 0;
		st.edgePol[i] = 0; st.edgeRPlate[i] = -1;
	}
	for (i = 0; i < oldN; i++) {
		j = (i + 1) % oldN;
		if (self.intent[i] === 4 && self.crush[i] === j && self.dead[j]) {
			var right = j + 1 < oldN ? j + 1 : 0;
			if (self.map[i] < 0 || self.map[right] < 0) continue;
			k = self.map[i];
			if (st.colPlate[k] !== self.histLP[i] || st.colPlate[self.map[right]] !== self.histRP[i]) continue;
			st.edge[k] = self.histEdge[i]; st.edgePol[k] = self.histPol[i];
			st.edgeAge[k] = self.histAge[i]; st.edgeSlow[k] = self.histSlow[i];
			st.edgeRPlate[k] = self.histRP[i];
			continue;
		}
		if (self.dead[j] || self.map[j] < 0) continue;
		k = (self.map[j] + count - 1) % count;
		if (st.colPlate[k] !== self.histLP[i]) continue;
		if (st.colPlate[self.map[j]] !== self.histRP[i]) continue;
		st.edge[k] = self.histEdge[i]; st.edgePol[k] = self.histPol[i];
		st.edgeAge[k] = self.histAge[i]; st.edgeSlow[k] = self.histSlow[i];
		st.edgeRPlate[k] = self.histRP[i];
	}
	self.isNew.fill(0, 0, count);
	for (i = 0; i < births; i++) {
		k = self.map[self.birthSlot[i]];
		self.isNew[k] = 1;
		self.birthVol[k] = self.birthVol[self.birthSlot[i]];
	}
	self.inherit(st, count);
	st.widths();
	for (i = 0; i < oldN; i++) {
		k = self.map[i];
		if (k < 0 || !(st.colW[k] > 0)) continue;
		// These are heights over each record's old area. Topology changes the Voronoi
		// widths, so first carry the retained load over oldW, then divide by its new
		// area and add the fraction accreted from the retired record.
		st.colLoad[k] = (st.colLoad[k] * st.oldW[k] + self.accreteLoad[i]) / st.colW[k];
		st.colLoadFel[k] = (st.colLoadFel[k] * st.oldW[k] + self.accreteLoadFel[i]) / st.colW[k];
		st.colPla[k] = (st.colPla[k] * st.oldW[k] + self.accretePla[i]) / st.colW[k];
	}
	for (i = 0; i < count; i++) {
		b = i * P.layerCap;
		for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] /= st.colW[i];
		self.sums(i);
	}
	self.rampZ(st);
	self.plates();
	return true;
};

// Due 1-Myr events: a C-C boundary that has been slower than P.vSuture for P.sutureAge
// sutures the smaller plate into the larger; a damaged corridor splits a plate only if
// both daughters have enough columns. Called after K4, never while the sorted list is
// changing.
COL.events = function (st) {
	var n = st.nCol, i, j, a, b, small, large, last, p, start, k, c;
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (st.edge[i] !== P.EDGE.collide || st.edgeSlow[i] <= P.sutureAge ||
			Math.abs(st.edgeRelN[i]) >= P.vSuture) continue;
		a = st.colPlate[i]; b = st.colPlate[j];
		if (a === b) continue;
		small = st.plN[a] <= st.plN[b] ? a : b;
		large = small === a ? b : a;
		for (k = 0; k < n; k++) if (st.colPlate[k] === small) st.colPlate[k] = large;
		last = --st.nPl;
		if (small !== last) {
			for (k = 0; k < n; k++) if (st.colPlate[k] === last) st.colPlate[k] = small;
			st.plU[small] = st.plU[last]; st.plUP[small] = st.plUP[last];
			st.plDmg[small] = st.plDmg[last];
		}
		for (k = 0; k < n; k++) st.colU[k] = st.plU[st.colPlate[k]];
		st.edgeRPlate.fill(-1, 0, n);
		COL.plates();
		return true;
	}
	if (st.nPl >= P.plateCap) return false;
	for (p = 0; p < st.nPl; p++) {
		start = -1;
		for (i = 0; i < n; i++) {
			if (st.colPlate[i] === p && st.colPlate[(i + n - 1) % n] !== p) { start = i; break; }
		}
		// start < 0 means the plate owns the whole wrap: cutting a corridor out of a closed
		// ring leaves one connected body, so there is nothing to split off
		if (start < 0) continue;
		i = COL.splitScan(st, p, start, n);      // SIM calls events without a receiver
		if (i < 0) continue;
		b = st.nPl++;
		st.plU[b] = st.plU[p]; st.plUP[b] = st.plUP[p];
		st.plDmg[b] = st.plDmg[p];
		for (k = i; k < st.plN[p]; k++) st.colPlate[(start + k) % n] = b;
		for (k = COL.corStart; k < COL.corStart + COL.corLen; k++) st.damage[(start + k) % n] = 0.5;
		st.edgeRPlate.fill(-1, 0, n);
		COL.plates();
		return true;
	}
	return false;
};

// Where plate p splits, as an offset from its first cell, or -1. Reference §5: the cells
// with damage >= splitDamage form a corridor, and the plate splits only where removing that
// corridor leaves two bodies of >= minPlateCells. In 1D *every* cell is a cut, so splitting
// at the first damaged cell fragments the planet as soon as damage is widespread (measured:
// plateCap 32 plates, 449 of 583 columns above splitDamage, 1000 km orogens). The bodies are
// the contiguous intact runs, which makes the rule self-limiting exactly as it is in 2D,
// where a wide damaged zone disconnects nothing. The corridor's cells go to the nearer
// daughter and their damage drops to 0.5, so the rift stays a weak line that cannot re-split.
COL.corStart = 0;
COL.corLen = 0;
COL.splitScan = function (st, p, start, n) {
	var L = st.plN[p], i, j, c, left = 0, cor = -1, corLen = 0, leftRun = 0, rightRun = 0;
	if (L < 2 * P.minPlateCells) return -1;
	for (i = 0; i < L; i++) {
		c = (start + i) % n;
		if (st.damage[c] >= P.splitDamage) {
			if (cor < 0) { cor = i; corLen = 0; leftRun = left; }
			corLen++;
			left = 0;
			continue;
		}
		if (cor < 0) { left++; continue; }
		rightRun = 0;
		for (j = i; j < L && st.damage[(start + j) % n] < P.splitDamage; j++) rightRun++;
		if (leftRun >= P.minPlateCells && rightRun >= P.minPlateCells) {
			COL.corStart = cor;
			COL.corLen = corLen;
			return cor + (corLen >> 1);
		}
		cor = -1;
		left = rightRun;
		i += rightRun - 1;
	}
	return -1;
};

if (typeof module !== 'undefined' && module.exports) module.exports = COL;
else root.COLCOLUMNS = COL;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
