(function (root) {
// slab.js — M4 slab ribbons (design §2.3, §4.5). A ribbon owns one stratified
// stack and a resampled polyline; node water is a separate, auditable flux. The
// column contact kernel calls appendStack only after it has converted layers to
// volume, so subduction is a transfer rather than an implicit sink.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COLCOLUMNS;

var SLAB = {
	ready: false,
	cum: new Float64Array(P.ribNodeCap),
	sx: new Float64Array(P.ribNodeCap),
	sy: new Float64Array(P.ribNodeCap),
	sd: new Float64Array(P.ribNodeCap),
	st: new Float64Array(P.ribNodeCap),
	sw: new Float64Array(P.ribNodeCap)
};

SLAB.reset = function () { this.ready = false; };

SLAB.dx = function (a, b) {
	var d = b - a;
	if (d > P.wrap * 0.5) d -= P.wrap;
	else if (d < -P.wrap * 0.5) d += P.wrap;
	return d;
};

SLAB.waterFraction = function (lith) {
	if (COL.CLASS[lith] === 0) return P.slabWaterSed;
	if (COL.CLASS[lith] === 2) return P.slabWaterMaf;
	return 0;
};

SLAB.newRibbon = function (st, r, x, dir, plate, t) {
	var base = r * P.ribNodeCap, i, depth, dip, n = 12;
	if (n > P.ribNodeCap) n = P.ribNodeCap;
	st.ribN[r] = n;
	st.ribX0[r] = x;
	st.ribDir[r] = dir;
	st.ribPlate[r] = plate;
	st.ribAge[r] = 0;
	st.ribNL[r] = 0;
	for (i = 0; i < P.ribNodeCap; i++) {
		st.ribW[base + i] = 0;
		st.ribRelW[base + i] = 0;
	}
	for (i = 0; i < n; i++) {
		depth = P.slabSurfaceDepth + i * P.slabNodeGap;
		dip = P.slabDip0 + (P.slabDipMax - P.slabDip0) * Math.min(1, depth / P.slabDissolve);
		st.ribDip[base + i] = dip;
		st.ribX[base + i] = (x + dir * depth / Math.tan(dip) + P.wrap) % P.wrap;
		st.ribY[base + i] = -depth;
		st.ribT[base + i] = -0.45 * Math.max(0, 1 - depth / P.slabDissolve);
	}
	return r;
};

// Read-only: the polyline length of the slab hanging at a trench, for the plate solve's
// slab pull. Unlike findRibbon this never creates a ribbon and never matches on the
// owning plate — a suture or a split remaps colPlate without touching ribPlate, so the
// plate id is not a reliable key, and "the slab under this trench" is a position and a
// dip direction. Returns 0 where there is none, so a trench whose slab has dissolved at
// P.slabDissolve pulls with nothing, which is a detachable slab and the reason the pull
// is a length rather than a constant.
SLAB.pullLen = function (st, x, dir) {
	var best = -1, bestD = 2.5 * P.w0, d, r, k, base, n, len, dx, dy;
	for (r = 0; r < st.nRib; r++) {
		if (st.ribDir[r] !== dir) continue;
		d = Math.abs(this.dx(st.ribX0[r], x));
		if (d < bestD) { bestD = d; best = r; }
	}
	if (best < 0) return 0;
	base = best * P.ribNodeCap;
	n = st.ribN[best];
	len = 0;
	for (k = 1; k < n; k++) {
		dx = this.dx(st.ribX[base + k - 1], st.ribX[base + k]);
		dy = st.ribY[base + k] - st.ribY[base + k - 1];
		len += Math.sqrt(dx * dx + dy * dy);
	}
	return len;
};

SLAB.findRibbon = function (st, x, dir, plate, t) {
	var best = -1, bestD = 2.5 * P.w0, d, r, slot;
	for (r = 0; r < st.nRib; r++) {
		if (st.ribDir[r] !== dir || st.ribPlate[r] !== plate) continue;
		d = Math.abs(this.dx(st.ribX0[r], x));
		if (d < bestD) { bestD = d; best = r; }
	}
	if (best >= 0) return best;
	if (st.nRib < P.ribCap) {
		slot = st.nRib++;
		return this.newRibbon(st, slot, x, dir, plate, t);
	}
	// Capacity is deliberately small, but a full run must not silently discard a
	// consumed stack. Join it to the nearest compatible tongue.
	best = 0; bestD = Infinity;
	for (r = 0; r < st.nRib; r++) {
		if (st.ribDir[r] !== dir) continue;
		d = Math.abs(this.dx(st.ribX0[r], x));
		if (d < bestD) { bestD = d; best = r; }
	}
	return best;
};

SLAB.compact = function (st, r) {
	var b = r * P.layerCap, n = st.ribNL[r], k, j, sum, k0 = -1, same = -1;
	var sameT = Infinity, anyT = Infinity;
	for (k = 0; k + 1 < n; k++) {
		sum = st.ribLTh[b + k] + st.ribLTh[b + k + 1];
		if (sum < anyT) { anyT = sum; k0 = k; }
		if (st.ribLLi[b + k] === st.ribLLi[b + k + 1] && sum < sameT) {
			sameT = sum; same = k;
		}
	}
	if (same >= 0) k0 = same;
	if (same < 0) {
		st.ledMix++;
		st.ledMixOut[st.ribLLi[b + k0 + 1]] += st.ribLTh[b + k0 + 1];
		st.ledMixIn[st.ribLLi[b + k0]] += st.ribLTh[b + k0 + 1];
	}
	st.ribLTh[b + k0] += st.ribLTh[b + k0 + 1];
	if (st.ribLAg[b + k0] < st.ribLAg[b + k0 + 1]) st.ribLAg[b + k0] = st.ribLAg[b + k0 + 1];
	st.ribLFl[b + k0] |= st.ribLFl[b + k0 + 1];
	for (j = k0 + 1; j < n - 1; j++) {
		st.ribLTh[b + j] = st.ribLTh[b + j + 1];
		st.ribLLi[b + j] = st.ribLLi[b + j + 1];
		st.ribLAg[b + j] = st.ribLAg[b + j + 1];
		st.ribLFl[b + j] = st.ribLFl[b + j + 1];
	}
	st.ribNL[r] = n - 1;
};

SLAB.appendLayer = function (st, r, thick, lith, age, flags, fraction) {
	var b = r * P.layerCap, n = st.ribNL[r], water, k;
	thick *= fraction;
	if (!(thick > 0)) return;
	while (n >= P.layerCap) { this.compact(st, r); n = st.ribNL[r]; }
	st.ribLTh[b + n] = thick;
	st.ribLLi[b + n] = lith;
	st.ribLAg[b + n] = age;
	st.ribLFl[b + n] = flags;
	st.ribNL[r] = n + 1;
	water = thick * this.waterFraction(lith);
	if (!(water > 0)) return;
	st.waterIn += water;
	var nn = st.ribN[r], base = r * P.ribNodeCap;
	for (k = 0; k < nn; k++) st.ribW[base + k] += water / nn;
};

// Called by columns.js while K4 stores layer thickness slots as volumes.
SLAB.appendStack = function (st, c, x, dir, plate, t) {
	var r = this.findRibbon(st, x, dir, plate, t), b = c * P.layerCap, k, f;
	for (k = 0; k < st.colNL[c]; k++) {
		f = COL.CLASS[st.layLi[b + k]] === 0 ? 0.5 : 1;
		this.appendLayer(st, r, st.layTh[b + k], st.layLi[b + k], st.layAg[b + k], st.layFl[b + k], f);
	}
	return r;
};

SLAB.respace = function (st, r) {
	var base = r * P.ribNodeCap, n = st.ribN[r], k, q, seg, f, dx, dy, len;
	var oldWater = 0, newWater = 0, waterScale;
	if (n < 3) return;
	for (k = 0; k < n; k++) oldWater += st.ribW[base + k];
	this.cum[0] = 0;
	for (k = 1; k < n; k++) {
		dx = this.dx(st.ribX[base + k - 1], st.ribX[base + k]);
		dy = st.ribY[base + k] - st.ribY[base + k - 1];
		this.cum[k] = this.cum[k - 1] + Math.sqrt(dx * dx + dy * dy);
	}
	len = this.cum[n - 1];
	if (!(len > 0)) return;
	for (k = 0; k < n; k++) {
		q = len * k / (n - 1);
		seg = k === n - 1 ? n - 2 : 0;
		while (seg + 1 < n - 1 && this.cum[seg + 1] < q) seg++;
		f = this.cum[seg + 1] > this.cum[seg] ? (q - this.cum[seg]) / (this.cum[seg + 1] - this.cum[seg]) : 0;
		this.sx[k] = (st.ribX[base + seg] + this.dx(st.ribX[base + seg], st.ribX[base + seg + 1]) * f + P.wrap) % P.wrap;
		this.sy[k] = st.ribY[base + seg] + (st.ribY[base + seg + 1] - st.ribY[base + seg]) * f;
		this.sd[k] = st.ribDip[base + seg] + (st.ribDip[base + seg + 1] - st.ribDip[base + seg]) * f;
		this.st[k] = st.ribT[base + seg] + (st.ribT[base + seg + 1] - st.ribT[base + seg]) * f;
		this.sw[k] = st.ribW[base + seg] + (st.ribW[base + seg + 1] - st.ribW[base + seg]) * f;
	}
	for (k = 0; k < n; k++) newWater += this.sw[k];
	waterScale = newWater > 0 ? oldWater / newWater : 0;
	for (k = 0; k < n; k++) {
		st.ribX[base + k] = this.sx[k];
		st.ribY[base + k] = this.sy[k];
		st.ribDip[base + k] = this.sd[k];
		st.ribT[base + k] = this.st[k];
		st.ribW[base + k] = this.sw[k] * waterScale;
	}
};

SLAB.release = function (st, dt) {
	var r, k, n, base, d, v, f;
	for (r = 0; r < st.nRib; r++) {
		base = r * P.ribNodeCap;
		n = st.ribN[r];
		for (k = 0; k < n; k++) st.ribRelW[base + k] = 0;
		for (k = 0; k < n; k++) {
			d = -st.ribY[base + k];
			if (d < 50e3 || d > 200e3) continue;
			v = st.ribW[base + k];
			f = 1 - Math.exp(-P.kDehy * dt);
			v *= f;
			st.ribW[base + k] -= v;
			st.ribRelW[base + k] = v;
			st.waterReleased += v;
		}
	}
};

SLAB.injectCold = function (st, dt) {
	var r, k, n, base, row, cell, C, j, v, add;
	for (r = 0; r < st.nRib; r++) {
		base = r * P.ribNodeCap;
		n = st.ribN[r];
		for (k = 0; k < n; k++) {
			row = GEO.rowOf(st.ribY[base + k]);
			if (row < 0) continue;
			cell = GEO.cellOf(row, st.ribX[base + k]);
			v = st.ribT[base + k] * 0.02 * dt;
			st.Tf[cell] += v;
			C = GEO.fanN[row];
			if (C > 1) {
				j = cell - GEO.fanOff[row];
				add = v * 0.25;
				st.Tf[ GEO.fanOff[row] + (j + C - 1) % C ] += add;
				st.Tf[ GEO.fanOff[row] + (j + 1) % C ] += add;
			}
		}
	}
};

SLAB.remove = function (st, r) {
	var last = st.nRib - 1, k, b, bl, water = 0;
	b = r * P.layerCap;
	for (k = 0; k < st.ribNL[r]; k++) {
		st.ledCons[st.ribLLi[b + k]] += st.ribLTh[b + k];
	}
	b = r * P.ribNodeCap;
	for (k = 0; k < st.ribN[r]; k++) water += st.ribW[b + k] + st.ribRelW[b + k];
	st.waterUsed += water;
	if (r !== last) {
		st.ribN[r] = st.ribN[last];
		st.ribDir[r] = st.ribDir[last];
		st.ribPlate[r] = st.ribPlate[last];
		st.ribX0[r] = st.ribX0[last];
		st.ribAge[r] = st.ribAge[last];
		st.ribNL[r] = st.ribNL[last];
		for (k = 0; k < P.ribNodeCap; k++) {
			st.ribX[b + k] = st.ribX[last * P.ribNodeCap + k];
			st.ribY[b + k] = st.ribY[last * P.ribNodeCap + k];
			st.ribDip[b + k] = st.ribDip[last * P.ribNodeCap + k];
			st.ribT[b + k] = st.ribT[last * P.ribNodeCap + k];
			st.ribW[b + k] = st.ribW[last * P.ribNodeCap + k];
			st.ribRelW[b + k] = st.ribRelW[last * P.ribNodeCap + k];
		}
		bl = last * P.layerCap;
		for (k = 0; k < P.layerCap; k++) {
			st.ribLTh[r * P.layerCap + k] = st.ribLTh[bl + k];
			st.ribLLi[r * P.layerCap + k] = st.ribLLi[bl + k];
			st.ribLAg[r * P.layerCap + k] = st.ribLAg[bl + k];
			st.ribLFl[r * P.layerCap + k] = st.ribLFl[bl + k];
		}
	}
	st.nRib = last;
};

SLAB.advance = function (st, dt, Tm) {
	var r, k, n, base, d, dip, sink, dir, last, MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.COLMANTLE;
	for (r = 0; r < st.nRib; r++) {
		st.ribAge[r] += dt;
		st.ribX0[r] = (st.ribX0[r] + MNT.uSurf(st.ribX0[r]) * dt * 0.15 + P.wrap) % P.wrap;
		base = r * P.ribNodeCap;
		st.ribX[base] = st.ribX0[r];
		st.ribY[base] = -P.slabSurfaceDepth;
		st.ribDip[base] = P.slabDip0;
		st.ribT[base] = -0.45;
		n = st.ribN[r];
		dir = st.ribDir[r];
		for (k = 1; k < n; k++) {
			d = -st.ribY[base + k];
			dip = P.slabDip0 + (P.slabDipMax - P.slabDip0) * Math.min(1, d / P.slabDissolve);
			MNT.flow(st.ribX[base + k], st.ribY[base + k]);
			sink = P.vSlab * P.slabSinkFrac * (0.45 + 0.55 * Tm / P.Tm0) * dt;
			st.ribX[base + k] = (st.ribX[base + k] + dir * sink / Math.tan(dip) + MNT.vx * dt * 0.15 + P.wrap) % P.wrap;
			st.ribY[base + k] -= sink + MNT.vy * dt * 0.02;
			if (st.ribY[base + k] > -P.slabSurfaceDepth) st.ribY[base + k] = -P.slabSurfaceDepth;
			st.ribDip[base + k] = dip;
			st.ribT[base + k] = -0.45 * Math.max(0, 1 - (-st.ribY[base + k]) / P.slabDissolve);
		}
		while (st.ribN[r] > 2 && -st.ribY[base + st.ribN[r] - 1] > P.slabDissolve) {
			last = base + st.ribN[r] - 1;
			st.waterUsed += st.ribW[last] + st.ribRelW[last];
			st.ribW[last] = 0;
			st.ribRelW[last] = 0;
			st.ribN[r]--;
		}
		last = st.ribN[r] - 1;
		if (last > 0 && -st.ribY[base + last] > P.slabDissolve) {
			this.remove(st, r);
			r--;
			continue;
		}
		this.respace(st, r);
	}
};

SLAB.k1 = function (st, dt, t, Tm) {
	var i;
	if (!(dt > 0)) return;
	this.ready = true;
	this.advance(st, dt, Tm);
	this.injectCold(st, dt);
	this.release(st, dt);
	for (i = 0; i < st.Tf.length; i++) {
		if (st.Tf[i] > 0) st.Tf[i] = 0;
		else if (st.Tf[i] < -P.lithCold) st.Tf[i] = -P.lithCold;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = SLAB;
else root.COLSLAB = SLAB;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
