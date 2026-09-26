// columns.js — the Lagrangian crust (design §2.2): layer stacks and the initial planet
// (M1.1). Stacks are bottom-up in the fixed slot range col*layerCap + k, so a 20 m bed
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
// 10*sqrt(age) km (half-space cooling). The per-frame fan T step is mantle.js (M2).
COL.lithDepth = function (age) { return age > 0 ? 1e4 * Math.sqrt(Math.min(age, 200)) : 0; };

COL.initFanT = function () {
	var n = S.nCol, i, r, j, j0, j1, C, pitch, val, f, dLith, amp, x0, x1, iLast;
	S.Tf.fill(0);
	for (i = 0; i < n; i++) {
		dLith = this.lithDepth(S.colAge[i]);
		if (dLith <= 0) continue;
		amp = P.lithCold * Math.min(1, S.colAge[i] / P.thermAgeCap);
		x0 = S.colX[i];
		x1 = x0 + S.colW[i];
		iLast = GEO.rowOf(-dLith);
		if (iLast < 0) iLast = GEO.N - 1;
		for (r = 0; r <= iLast; r++) {
			f = GEO.rowCy[r] / dLith;
			if (f >= 1) break;
			val = -amp * (1 - f);
			C = GEO.fanN[r];
			pitch = P.wrap / C;
			j0 = Math.floor(x0 / pitch);
			j1 = Math.floor((x1 - 1e-9) / pitch);
			for (j = j0; j <= j1; j++) S.Tf[GEO.fanOff[r] + ((j % C) + C) % C] = val;
		}
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = COL;
