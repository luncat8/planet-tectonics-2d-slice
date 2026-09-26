// columns.js — the Lagrangian crust (design §2.2): layer stacks, initial planet
// and K3/K4 topology. Stacks are bottom-up in the fixed slot range col*layerCap + k, so a 20 m bed
// stays exactly 20 m for as long as the run lasts — nothing is ever resampled.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.RNG;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.SURF;

var COL = {
	// lith -> density class of the cached sums: 0 sed, 1 felsic, 2 mafic. Tephra is
	// fragmental (sed density); lava and sill are crystalline (mafic density).
	CLASS: new Uint8Array([0, 1, 2, 0, 2, 2]),
	acc: new Float64Array(3),
	removed: new Float64Array(3),
	wScratch: new Float64Array(16),
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

// full stack: merge the thinnest adjacent same-lith pair (mass and class exact). An
// alternating stack with no such pair merges across classes and is counted in ledMix,
// so the mass balance stays auditable instead of silently drifting.
COL.compact = function (c) {
	var LC = P.layerCap, b = c * LC, n = S.colNL[c], k, j, t;
	if (n < 2) return;
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
	S.layAg[b + k0] = Math.max(S.layAg[b + k0], S.layAg[b + k0 + 1]);
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
// actually removed and leaves the per-class split in COL.removed.
COL.removeTop = function (c, amount) {
	var rem = this.removed, LC = P.layerCap, b = c * LC, left = amount, k, t, take;
	rem[0] = 0; rem[1] = 0; rem[2] = 0;
	while (left > 0 && S.colNL[c] > 0) {
		k = S.colNL[c] - 1;
		t = S.layTh[b + k];
		take = t > left ? left : t;
		rem[this.CLASS[S.layLi[b + k]]] += take;
		left -= take;
		if (take < t) { S.layTh[b + k] = t - take; break; }
		S.colNL[c] = k;
	}
	return amount - left;
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
			a = S.colX[i];
			b = a + S.colW[i];
			for (j = Math.floor(a / pitch); j * pitch < b; j++) {
				lo = a > j * pitch ? a : j * pitch;
				hi = b < (j + 1) * pitch ? b : (j + 1) * pitch;
				jj = j % C;
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
COL.fields = 'colX colW colPlate colU ext edgeRelN edgePol edgeRPlate trenchDist oldW colAge hFel hMaf hSed hTot z slope wet noise damage zDyn fert oVms oMaf oArc oOro oBas oPla volc edge edgeAge edgeSlow colLoad colPla colNL'.split(' ');
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
COL.histEdge = new Int8Array(P.colCap);
COL.histPol = new Int8Array(P.colCap);
COL.histRP = new Int32Array(P.colCap);
COL.histLP = new Int32Array(P.colCap);
COL.histAge = new Float64Array(P.colCap);
COL.histSlow = new Float64Array(P.colCap);
COL.map = new Int32Array(P.colCap);
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
	S.plN.fill(0);
	for (var i = 0; i < S.nCol; i++) {
		var p = S.colPlate[i];
		if (S.plN[p]++ === 0) S.plX0[p] = S.colX[i];
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

COL.intents = function () {
	var n = S.nCol, i, j, d, e;
	this.intent.fill(0, 0, n);
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		d = S.colX[j] - S.colX[i];
		if (d <= 0) d += P.wrap;
		e = S.edge[i];
		if (e === P.EDGE.open && d > 2 * P.rGap * P.w0) this.intent[i] = 1;
		if ((e === P.EDGE.subduct || e === P.EDGE.collide) && d < P.rContact * P.w0 &&
			S.edgeRelN[i] < -P.epsHi) this.intent[i] = 2;
	}
};

// During K4, layTh stores volume (m3 per unit section depth), not thickness.
// This lets every transfer and merge be exact before final Voronoi widths are known.
COL.transfer = function (from, to, fraction, sedimentOnly) {
	var b = from * P.layerCap, k, t, lith;
	for (k = 0; k < S.colNL[from]; k++) {
		lith = S.layLi[b + k];
		if (sedimentOnly && this.CLASS[lith] !== 0) continue;
		if (!sedimentOnly && this.CLASS[lith] === 2) continue;
		t = S.layTh[b + k] * fraction;
		S.layTh[b + k] -= t;
		this.push(to, t, lith, S.layAg[b + k], S.layFl[b + k]);
	}
};

COL.moveDeposits = function (from, layer, to, newLayer) {
	for (var d = 0; d < S.nDep; d++) {
		if (S.depCol[d] !== from || S.depLay[d] !== layer) continue;
		S.depCol[d] = to; S.depLay[d] = newLayer;
	}
};

COL.consume = function (i, j) {
	var E = P.EDGE, left = i, right = j, loser, winner, b, k, lith, t;
	if (S.edge[i] === E.collide) {
		loser = S.hFel[left] <= S.hFel[right] ? left : right;
		winner = loser === left ? right : left;
		b = loser * P.layerCap;
		for (k = 0; k < S.colNL[loser]; k++) {
			this.push(winner, S.layTh[b + k], S.layLi[b + k], S.layAg[b + k], S.layFl[b + k]);
			this.moveDeposits(loser, k, winner, S.colNL[winner] - 1);
		}
	} else {
		loser = S.edgePol[i] < 0 ? left : right;
		winner = loser === left ? right : left;
		b = loser * P.layerCap;
		for (k = 0; k < S.colNL[loser]; k++) {
			lith = S.layLi[b + k]; t = S.layTh[b + k];
			if (this.CLASS[lith] === 0) {
				this.push(winner, t * 0.5, lith, S.layAg[b + k], S.layFl[b + k]);
				this.moveDeposits(loser, k, winner, S.colNL[winner] - 1);
				S.ledCons[lith] += t * 0.5;
			} else {
				this.moveDeposits(loser, k, -1, -1);
				S.ledCons[lith] += t;
			}
		}
	}
	this.dead[loser] = 1;
	this.redirect[loser] = winner;
};

COL.rift = function (i, j, birth, Tm) {
	var n = S.nCol, d, a, b, o, v, leftFel = 0, rightFel = 0;
	var donors = true, fraction = 1 / (P.K + 1), f;
	for (d = 0; d < P.K; d++) {
		a = (i - d + n) % n; b = (j + d) % n;
		if (this.dead[a] || this.dead[b]) donors = false;
		leftFel += S.hFel[a]; rightFel += S.hFel[b];
	}
	donors = donors && leftFel >= P.K * P.hRiftBreakup && rightFel >= P.K * P.hRiftBreakup;
	for (var field = 0; field < this.fields.length; field++) S[this.fields[field]][birth] = 0;
	S.colNL[birth] = 0;
	S.colW[birth] = 1; // K4 stores layer volumes until final widths are known
	S.colX[birth] = (S.colX[i] + (S.colX[j] + (j <= i ? P.wrap : 0))) * 0.5 % P.wrap;
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
	if (!donors) {
		f = P.hMafNewBase * (1 + P.hMafNewTm * Math.max(0, Tm - 1));
		// Half the opened gap is the newborn's initial width; final width is
		// computed only after all births. The material is a mantle source.
		f *= (S.colX[j] - S.colX[i] + (j <= i ? P.wrap : 0)) * 0.5;
		this.push(birth, f, P.LITH.maf, 0, P.FLAG.wet);
		S.ledProd[P.LITH.maf] += f;
		S.oVms[birth] = (S.oVms[i] + S.oVms[j]) * 0.5;
		return;
	}
	for (d = 0; d < P.K; d++) {
		a = (i - d + n) % n; b = (j + d) % n;
		this.transfer(a, birth, fraction, false);
		this.transfer(b, birth, fraction, false);
		for (o = 0; o < this.oreFields.length; o++) {
			v = S[this.oreFields[o]];
			v[birth] += (v[a] + v[b]) * fraction;
			v[a] *= 1 - fraction; v[b] *= 1 - fraction;
		}
	}
};

COL.k4 = function (st, dt, t, Tm) {
	var self = COL;
	if (!(dt > 0)) return;
	var n = st.nCol, i, j, k, b, count = 0, births = 0, appended = 0, freed = 0, reuse = 0, slot, oldN = n, any = false;
	self.intents();
	for (i = 0; i < n; i++) if (self.intent[i]) { any = true; break; }
	if (!any) {
		for (i = 0; i < n; i++) {
			if (st.colW[i] === st.oldW[i]) continue;
			b = i * P.layerCap;
			for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] *= st.oldW[i] / st.colW[i];
			self.sums(i);
		}
		SURF.profile();
		return false;
	}
	self.dead.fill(0);
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
		if (self.intent[i] !== 2 || self.dead[i] || self.dead[j]) continue;
		self.consume(i, j);
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
			self.dead[slot] = 2; // occupied by a birth, but still an old consumed record
		}
		self.rift(i, j, slot, Tm);
		births++;
	}
	// Follow redirects before sorting. A consumed vent survives on the margin; a
	// deposit tied to a destroyed bed loses its horizon instead of pointing into
	// an unrelated stack on the margin.
	for (i = 0; i < st.nDep; i++) if (st.depCol[i] >= 0 && self.dead[st.depCol[i]]) st.depCol[i] = -1;
	for (i = 0; i < st.nVen; i++) {
		if (st.venCol[i] < 0 || !self.dead[st.venCol[i]]) continue;
		j = self.redirect[st.venCol[i]];
		if (st.volc[j] < 0) { st.volc[j] = i; st.venCol[i] = j; }
		else st.venCol[i] = -1;
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
		if (self.dead[j] || self.map[j] < 0) continue;
		k = (self.map[j] + count - 1) % count;
		if (st.colPlate[k] !== self.histLP[i]) continue;
		if (st.colPlate[self.map[j]] !== self.histRP[i]) continue;
		st.edge[k] = self.histEdge[i]; st.edgePol[k] = self.histPol[i];
		st.edgeAge[k] = self.histAge[i]; st.edgeSlow[k] = self.histSlow[i];
		st.edgeRPlate[k] = self.histRP[i];
	}
	st.widths();
	for (i = 0; i < count; i++) {
		b = i * P.layerCap;
		for (k = 0; k < st.colNL[i]; k++) st.layTh[b + k] /= st.colW[i];
		self.sums(i);
	}
	self.plates();
	SURF.profile();
	return true;
};

// Due 1-Myr events: a slow C-C boundary sutures the smaller plate into the
// larger after 20 Myr; a damaged corridor splits a plate only if both daughters
// have enough columns. Called after K4, never while the sorted list is changing.
COL.events = function (st) {
	var n = st.nCol, i, j, a, b, small, large, last, p, start, k, c;
	for (i = 0; i < n; i++) {
		j = (i + 1) % n;
		if (st.edge[i] !== P.EDGE.collide || st.edgeSlow[i] <= 20 ||
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
		if (start < 0 || st.plN[p] < 2 * P.minPlateCells) continue;
		for (i = P.minPlateCells; i <= st.plN[p] - P.minPlateCells; i++) {
			c = (start + i) % n;
			if (st.damage[c] < P.splitDamage) continue;
			b = st.nPl++;
			st.plU[b] = st.plU[p]; st.plUP[b] = st.plUP[p];
			st.plDmg[b] = st.plDmg[p];
			for (k = i; k < st.plN[p]; k++) st.colPlate[(start + k) % n] = b;
			st.damage[c] = 0.5;
			st.edgeRPlate.fill(-1, 0, n);
			COL.plates();
			return true;
		}
	}
	return false;
};

if (typeof module !== 'undefined' && module.exports) module.exports = COL;
