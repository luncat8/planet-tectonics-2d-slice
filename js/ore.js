(function (root) {
// ore.js — live, bed-anchored resources (0.2.0 M3, design §4.7). These finite
// envelopes are subsets of existing rock, never a second reservoir in S.mass().
// The immutable 3D snapshot catalogue remains the separate concern of deposits.js.
'use strict';
var node = typeof module !== 'undefined' && module.exports;
var P = node ? require('./params.js') : root.COLP;
var S = node ? require('./state.js') : root.COLS;
var COL = node ? require('./columns.js') : root.COLCOLUMNS;
var CRU = node ? require('./crust.js') : root.COLCRUST;
var MAG = node ? require('./magma.js') : root.COLMAGMA;
var SURF = node ? require('./surface.js') : root.COLSURF;
var RNG = node ? require('./rng.js') : root.COLRNG;
var fields = ['depCol', 'depLay', 'depCls', 'depGr', 'depVol', 'depPos', 'depAg', 'depId'];
var blurred = new Float64Array(P.colCap), hosts = new Int32Array(P.colCap);
var positions = new Float64Array(P.colCap), beltRate = new Float64Array(P.colCap);
var ranks = new Int32Array(P.depCap), rankState = S;

function compare(a, b) {
	return rankState.depCls[a] - rankState.depCls[b] ||
		ORE.tonnes(rankState, b) - ORE.tonnes(rankState, a) || rankState.depId[a] - rankState.depId[b];
}
function wrap(k, n) { k %= n; return k < 0 ? k + n : k; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function outranks(st, a, b, cls) {
	if (blurred[a] !== blurred[b]) return blurred[a] > blurred[b];
	if (cls === P.OCLS.pla && st.z[a] !== st.z[b]) return st.z[a] < st.z[b];
	return a < b;
}
function copy(st, from, to) {
	for (var f = 0; f < fields.length; f++) st[fields[f]][to] = st[fields[f]][from];
}
function clear(st, d) {
	for (var f = 0; f < fields.length; f++) st[fields[f]][d] = 0;
}
function allocate(st, c, k, cls, grade, volume, pos, t) {
	if (st.nDep >= P.depCap) { st.depBlocked++; return -1; }
	var d = st.nDep++;
	st.depCol[d] = c; st.depLay[d] = k; st.depCls[d] = cls;
	st.depGr[d] = grade; st.depVol[d] = volume; st.depPos[d] = pos;
	st.depAg[d] = t; st.depId[d] = ++st.depNext;
	st.layOre[c * P.layerCap + k] |= 1 << cls;
	st.layFl[c * P.layerCap + k] |= P.FLAG.ore;
	return d;
}

var ORE = {
	NAME: ['VMS', 'mafic', 'arc', 'orogenic', 'basin', 'placer'],
	COLOUR: ['#66ded7', '#a4b4ff', '#ffad6b', '#ffd46a', '#d1a5e9', '#a6e883'],
	hostPos: 0.5,

	pulse: function (old, dose) {
		return 1 - (1 - clamp(old, 0, 1)) * Math.exp(-Math.max(0, dose));
	},
	// Exact solution of o' = rate*(1-o) - kDecay*o: saturation and decay cannot
	// overshoot, and a fixed factory gives the same answer at every geo slider leg.
	advance: function (old, rate, dt) {
		var k = rate + P.kDecay, eq = k > 0 ? rate / k : 0;
		return clamp(eq + (old - eq) * Math.exp(-k * dt), 0, 1);
	},

	init: function (st, Tm) {
		for (var c = 0; c < st.nCol; c++) {
			if (st.colGhost[c] || st.hFel[c] >= P.hOceanic || !(st.hMaf[c] > 0)) continue;
			st.oVms[c] = ORE.pulse(0, P.kV * Tm * st.fert[c]) * Math.exp(-P.kDecay * st.colAge[c]);
		}
	},
	// Called after the newborn has inherited its parents' bounded concentrations.
	birth: function (st, c, Tm, opening, oceanic) {
		var dose = oceanic ? P.kV * Tm * Math.min(1, Math.max(0, opening) / P.vRef) : P.kM2;
		var field = oceanic ? st.oVms : st.oMaf;
		field[c] = ORE.pulse(field[c], dose * st.fert[c]);
	},

	accumulate: function (st, dt, Tm) {
		var n = st.nCol, c, i, j, k, speed, thr, rate, plume, recycle, arc, oro, basin, fert;
		beltRate.fill(0, 0, n);
		for (i = 0; i < n; i++) {
			if (st.edge[i] !== P.EDGE.collide || !(st.edgeRelN[i] < 0) || st.colGhost[i]) continue;
			j = (i + 1) % n;
			if (st.colGhost[j]) continue;
			speed = Math.min(2, -st.edgeRelN[i] / P.vRef);
			COL.beltAt(st, n, i);
			thr = COL.flankH + P.beltRise;
			beltRate[i] = Math.max(beltRate[i], speed); beltRate[j] = Math.max(beltRate[j], speed);
			for (var dir = -1; dir <= 1; dir += 2) {
				for (k = 1; k <= P.beltMaxCols; k++) {
					c = wrap((dir < 0 ? i : j) + dir * k, n);
					if (c === i || c === j || st.colGhost[c] || st.hTot[c] < thr) break;
					beltRate[c] = Math.max(beltRate[c], speed);
				}
			}
		}
		for (c = 0; c < n; c++) {
			if (st.colGhost[c]) continue;
			fert = st.fert[c]; plume = 0; arc = 0;
			for (i = 0; i < st.nPlm; i++) {
				if (!st.plmArrive[i] || !(st.plmStr[i] > 0)) continue;
				if (Math.abs(MAG.dx(st.colX[c], st.plmX[i])) <= Math.max(P.w0, st.plmR[i])) plume += st.plmStr[i];
			}
			if (st.trenchDist[c] >= 1 && st.trenchDist[c] <= 3 && st.colRecycle[c] > 0) {
				recycle = Math.min(2, st.colRecycle[c] / (P.w0 * 5000 * P.slabWaterSed));
				arc = P.kA * Tm * Math.min(2, CRU.arcSpeed(st, c) / P.vRef) * (1 + P.kRec * recycle);
			}
			speed = beltRate[c];
			if (st.hFel[c] > P.hOro) speed = Math.max(speed, Math.min(2, Math.max(0, -st.ext[c]) * P.w0 / P.vRef));
			oro = st.hFel[c] >= P.hOceanic ? P.kO * speed * Math.max(0, st.damage[c]) : 0;
			basin = st.wet[c] && st.hSed[c] > 2000 ? P.kB2 : 0;
			for (k = 0; k < P.OCLS.n; k++) {
				rate = k === P.OCLS.maf ? P.kM * plume : k === P.OCLS.arc ? arc :
					k === P.OCLS.oro ? oro : k === P.OCLS.bas ? basin : 0;
				var field = st[COL.oreFields[k]];
				field[c] = ORE.advance(field[c], rate * fert, dt);
			}
		}
	},

	// The host is rock, not a potential's screen location. Arc emplacement is 3–8 km
	// down; VMS requires a buried non-intrusive seafloor bed; placer is a basal lag.
	selectHost: function (st, c, cls) {
		var b = c * P.layerCap, n = st.colNL[c], k, lith, th, cover = 0, target, lo, hi;
		ORE.hostPos = 0.5;
		if (cls === P.OCLS.maf || cls === P.OCLS.oro) {
			for (k = 0; k < n; k++) {
				lith = st.layLi[b + k];
				if (cls === P.OCLS.oro ? lith === P.LITH.fel : lith === P.LITH.sill || lith === P.LITH.maf) return k;
			}
			return -1;
		}
		target = P.oreArcMin + (P.oreArcMax - P.oreArcMin) * RNG.hash2(c, cls, P.seed);
		for (k = n - 1; k >= 0; k--) {
			lith = st.layLi[b + k]; th = st.layTh[b + k];
			if (!(th > 0)) continue;
			if (cls === P.OCLS.vms && lith === P.LITH.maf && cover > 0 &&
				!(st.layFl[b + k] & P.FLAG.intr) &&
				(st.hFel[c] < P.hOceanic || (st.layFl[b + k] & P.FLAG.wet))) {
				ORE.hostPos = 0.99; return k;
			}
			if (cls === P.OCLS.arc && (lith === P.LITH.fel || lith === P.LITH.sill || lith === P.LITH.maf)) {
				lo = Math.max(cover, P.oreArcMin); hi = Math.min(cover + th, P.oreArcMax);
				if (hi > lo) { ORE.hostPos = (cover + th - clamp(target, lo, hi)) / th; return k; }
			}
			if (cls === P.OCLS.bas && lith === P.LITH.sed && (st.wet[c] || (st.layFl[b + k] & P.FLAG.wet))) return k;
			if (cls === P.OCLS.pla && lith === P.LITH.sed) { ORE.hostPos = 0.02; return k; }
			cover += th;
		}
		return -1;
	},

	create: function (st, c, k, cls, grade, t, pos) {
		if (c < 0 || c >= st.nCol || st.colGhost[c] || k < 0 || k >= st.colNL[c]) return -1;
		var th = st.layTh[c * P.layerCap + k];
		var bodyTh = Math.min(P.oreThMax[cls], th * P.oreShare[cls]) * grade;
		if (!(bodyTh > 0)) return -1;
		var at = clamp(pos === undefined ? 0.5 : pos, bodyTh / (2 * th), 1 - bodyTh / (2 * th));
		var d = allocate(st, c, k, cls, grade, bodyTh * st.colW[c], at, t);
		if (d >= 0) st.depProduced[cls] += st.depVol[d];
		return d;
	},

	scan: function (st, t) {
		var n = st.nCol, cls, c, prev, next, val, count, field, k, bit;
		if (!n) return;
		for (cls = 0; cls < P.OCLS.n; cls++) {
			field = st[COL.oreFields[cls]]; bit = 1 << cls;
			hosts.fill(-1, 0, n);
			for (c = 0; c < n; c++) {
				blurred[c] = 0;
				if (st.colGhost[c] || !(st.hTot[c] > 0)) continue;
				prev = (c + n - 1) % n; next = (c + 1) % n;
				val = field[c]; count = 1;
				if (prev !== c && !st.colGhost[prev] && st.hTot[prev] > 0) { val += field[prev]; count++; }
				if (next !== c && next !== prev && !st.colGhost[next] && st.hTot[next] > 0) { val += field[next]; count++; }
				blurred[c] = val / count;
				// A blur locates the factory, but cannot mineralize an unexposed neighbour.
				if (field[c] < P.oreThreshold[cls] || blurred[c] < P.oreThreshold[cls]) continue;
				k = ORE.selectHost(st, c, cls);
				if (k < 0) continue;
				hosts[c] = k; positions[c] = ORE.hostPos;
			}
			for (c = 0; c < n; c++) {
				k = hosts[c];
				if (k < 0 || (st.layOre[c * P.layerCap + k] & bit)) continue;
				prev = (c + n - 1) % n; next = (c + 1) % n;
				if (hosts[prev] >= 0 && outranks(st, prev, c, cls)) continue;
				if (hosts[next] >= 0 && outranks(st, next, c, cls)) continue;
				ORE.create(st, c, k, cls, blurred[c], t, positions[c]);
			}
		}
	},

	valid: function (st, d) {
		var c = st.depCol[d], k = st.depLay[d];
		return d >= 0 && d < st.nDep && c >= 0 && c < st.nCol && !st.colGhost[c] &&
			k >= 0 && k < st.colNL[c] && st.layTh[c * P.layerCap + k] > 0 && st.depVol[d] > 0;
	},
	reap: function (st) {
		var n = st.nDep, out = 0, d, volume;
		for (d = 0; d < n; d++) {
			if (!ORE.valid(st, d)) { st.depRetired[st.depCls[d]] += st.depVol[d]; continue; }
			volume = st.layTh[st.depCol[d] * P.layerCap + st.depLay[d]] * st.colW[st.depCol[d]];
			if (st.depVol[d] > volume) {
				st.depRetired[st.depCls[d]] += st.depVol[d] - volume;
				st.depVol[d] = volume;
			}
			if (out !== d) copy(st, d, out);
			out++;
		}
		for (d = out; d < n; d++) clear(st, d);
		st.nDep = out;
	},

	// Bed-wide erosion / reconciliation is a bulk removal. Keep the surviving share
	// of its delineated resource and retire the rest; this is not another crust sink.
	cut: function (st, c, k, keep, except) {
		for (var d = 0; d < st.nDep; d++) {
			if (d === except || st.depCol[d] !== c || st.depLay[d] !== k) continue;
			var lost = st.depVol[d] * (1 - keep);
			st.depVol[d] -= lost; st.depRetired[st.depCls[d]] += lost;
		}
	},
	grow: function (st, c, k, old, added) {
		for (var d = 0; d < st.nDep; d++) {
			if (st.depCol[d] === c && st.depLay[d] === k) st.depPos[d] *= old / (old + added);
		}
	},
	mergeBeds: function (st, c, k, lower, upper) {
		for (var d = 0; d < st.nDep; d++) {
			if (st.depCol[d] !== c) continue;
			if (st.depLay[d] === k) st.depPos[d] *= lower / (lower + upper);
			else if (st.depLay[d] === k + 1) st.depPos[d] = (lower + upper * st.depPos[d]) / (lower + upper);
		}
	},

	// Transport conserves resource area as well as bed volume. A split gets a fresh
	// stable id; merging into an already delineated receiver is volume-weighted.
	share: function (st, from, layer, to, newLayer, fraction, base, added) {
		var n = st.nDep, d, other, moved, remaining, pos, total, found;
		for (d = 0; d < n; d++) {
			if (st.depCol[d] !== from || st.depLay[d] !== layer || !(st.depVol[d] > 0)) continue;
			moved = st.depVol[d] * fraction; remaining = st.depVol[d] - moved;
			st.depVol[d] = remaining;
			if (to < 0 || newLayer < 0) { st.depRetired[st.depCls[d]] += moved; continue; }
			total = st.layTh[to * P.layerCap + newLayer];
			pos = total > 0 ? (base + added * st.depPos[d]) / total : 0.5;
			found = -1;
			for (other = 0; other < st.nDep; other++) {
				if (other !== d && st.depCol[other] === to && st.depLay[other] === newLayer &&
					st.depCls[other] === st.depCls[d] && st.depVol[other] > 0) { found = other; break; }
			}
			if (found >= 0) {
				total = st.depVol[found] + moved;
				st.depGr[found] = (st.depGr[found] * st.depVol[found] + st.depGr[d] * moved) / total;
				st.depPos[found] = (st.depPos[found] * st.depVol[found] + pos * moved) / total;
				st.depVol[found] = total; st.depAg[found] = Math.min(st.depAg[found], st.depAg[d]);
				continue;
			}
			if (!(remaining > 0)) {
				st.depCol[d] = to; st.depLay[d] = newLayer; st.depVol[d] = moved; st.depPos[d] = pos;
				continue;
			}
			if (allocate(st, to, newLayer, st.depCls[d], st.depGr[d], moved, pos, st.depAg[d]) < 0) st.depRetired[st.depCls[d]] += moved;
		}
	},

	depth: function (st, d) {
		if (!ORE.valid(st, d)) return NaN;
		var c = st.depCol[d], k = st.depLay[d], b = c * P.layerCap;
		var depth = st.layTh[b + k] * (1 - st.depPos[d]);
		for (var j = k + 1; j < st.colNL[c]; j++) depth += st.layTh[b + j];
		return depth;
	},
	tonnes: function (st, d) {
		if (!ORE.valid(st, d)) return 0;
		var lith = st.layLi[st.depCol[d] * P.layerCap + st.depLay[d]];
		var cls = COL.CLASS[lith], density = cls === 0 ? P.rhoSed : cls === 1 ? P.rhoFel : P.rhoMaf;
		return st.depVol[d] * density / 1000; // t per metre out of the section
	},
	byId: function (st, id) {
		for (var d = 0; d < st.nDep; d++) if (st.depId[d] === id && ORE.valid(st, d)) return d;
		return -1;
	},
	ranked: function (st) {
		rankState = st;
		var n = 0;
		for (var d = 0; d < st.nDep; d++) if (ORE.valid(st, d)) ranks[n++] = d;
		var view = ranks.subarray(0, n);
		view.sort(compare);
		return view;
	},

	// Explicit user action, addressed by stable id rather than a table slot. Mining
	// removes real host rock and credits that lithology's ledCons exactly once.
	extract: function (st, id, volume) {
		if (st !== S) return 0;
		var d = ORE.byId(st, id);
		if (d < 0 || !(Number.isFinite(volume) && volume > 0)) return 0;
		var c = st.depCol[d], k = st.depLay[d], b = c * P.layerCap, old = st.layTh[b + k];
		var w = st.colW[c], lith = st.layLi[b + k], z0 = SURF.elev(c);
		var take = Math.min(volume, st.depVol[d], old * w), th = take / w;
		st.depVol[d] -= take; st.depExtracted[st.depCls[d]] += take;
		ORE.cut(st, c, k, Math.max(0, 1 - th / old), d);
		st.ledCons[lith] += take;
		if (th >= old) COL.removeAt(st, c, k);
		else {
			st.layTh[b + k] = old - th;
			if (k + 1 < st.colNL[c]) st.layFl[b + k + 1] |= P.FLAG.unconf;
			else st.colBevel[c] = 1;
		}
		if (st.nVen > 0 && (lith === P.LITH.lava || lith === P.LITH.tephra)) {
			var toy = node ? require('./erupt.js') : root.COLERUPT;
			toy.erode(c, take);
		}
		COL.sums(c);
		st.z[c] += SURF.elev(c) - z0;
		st.hDraw[c] = st.hTot[c]; st.wet[c] = st.z[c] < st.seaLevel ? 1 : 0;
		SURF.refreshSlope(c);
		SURF.refreshSlope(wrap(c - 1, st.nCol)); SURF.refreshSlope((c + 1) % st.nCol);
		ORE.reap(st);
		return take;
	},

	k8: function (st, dt, t, Tm) {
		ORE.reap(st);
		if (dt > 0) ORE.accumulate(st, dt, Tm);
		// Eruptive write-back can make a new host while geology is paused. Recording
		// that host is bookkeeping; none of its factory clocks advance here.
		ORE.scan(st, t);
	}
};
COL.ore = ORE;

if (node) module.exports = ORE;
else root.COLORE = ORE;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
