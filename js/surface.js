// surface.js — isostatic elevation and the column profile (design §4.6, reference §7.1
// ported to the 1D line: neighbours are the two adjacent columns). M3 adds erosion,
// one-hop routing and deposition (design §4.6, reference §7.3). Headless, allocation-free.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;

var SURF = {};

SURF.smoothstep = function (x, a, b) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
};

SURF.elev = function (i) {
	var buoy = S.hFel[i] * (P.rhoM - P.rhoFel) / P.rhoM +
		S.hMaf[i] * (P.rhoM - P.rhoMaf) / P.rhoM +
		S.hSed[i] * (P.rhoM - P.rhoSed) / P.rhoM;
	var ci = this.smoothstep(S.hFel[i], P.ciLo, P.ciHi);
	var therm = P.thermK * Math.sqrt(Math.min(S.colAge[i], P.thermAgeCap)) * (1 - ci) + P.zRoot * ci;
	return P.zRef + buoy - therm + S.zDyn[i];
};

SURF.profile = function () {
	var n = S.nCol, i, im, ip, dx;
	for (i = 0; i < n; i++) {
		S.z[i] = this.elev(i);
		S.wet[i] = S.z[i] < 0 ? 1 : 0;
	}
	if (n < 3) return;
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		ip = i + 1 < n ? i + 1 : 0;
		dx = S.colX[ip] - S.colX[im];
		if (dx <= 0) dx += P.wrap;
		S.slope[i] = dx > 0 ? (S.z[ip] - S.z[im]) / dx : 0;
	}
};

// M3 scratch
SURF.lo = new Int32Array(P.colCap);
SURF.volE = new Float64Array(P.colCap);
SURF.volFel = new Float64Array(P.colCap);
SURF.volPla = new Float64Array(P.colCap);
SURF.depVol = new Float64Array(P.colCap);
SURF.depFel = new Float64Array(P.colCap);
SURF.depPla = new Float64Array(P.colCap);
SURF.inVol = new Float64Array(P.colCap);
SURF.inFel = new Float64Array(P.colCap);
SURF.inPla = new Float64Array(P.colCap);
SURF.changed = new Uint8Array(P.colCap);
SURF.slopeDirty = new Uint8Array(P.colCap);

SURF.k6 = function (st, dt, t) {
	if (!(dt > 0)) return;
	var n = st.nCol;
	if (n === 0) return;
	var LC = P.layerCap;
	var FLAG_WET = P.FLAG.wet, FLAG_UNCONF = P.FLAG.unconf;
	var LITH_SED = P.LITH.sed;
	var Cmod = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;
	var CLASS = Cmod.CLASS;
	// local aliases
	var colNL = st.colNL, layTh = st.layTh, layLi = st.layLi, layFl = st.layFl, layAg = st.layAg;
	var colW = st.colW, z = st.z, wet = st.wet, slope = st.slope;
	var colBevel = st.colBevel, colLoad = st.colLoad, colLoadFel = st.colLoadFel, colPla = st.colPla;
	var hFel = st.hFel, hMaf = st.hMaf, hSed = st.hSed, hTot = st.hTot;
	var oOro = st.oOro, oArc = st.oArc, oPla = st.oPla, oBas = st.oBas;
	var lo = SURF.lo, volE = SURF.volE, volFel = SURF.volFel, volPla = SURF.volPla;
	var depVol = SURF.depVol, depFel = SURF.depFel, depPla = SURF.depPla;
	var inVol = SURF.inVol, inFel = SURF.inFel, inPla = SURF.inPla;
	var changed = SURF.changed, slopeDirty = SURF.slopeDirty;

	SURF.profile();

	var i, j;
	for (i = 0; i < n; i++) {
		lo[i] = -1;
		volE[i] = 0; volFel[i] = 0; volPla[i] = 0;
		depVol[i] = 0; depFel[i] = 0; depPla[i] = 0;
		inVol[i] = 0; inFel[i] = 0; inPla[i] = 0;
		changed[i] = 0; slopeDirty[i] = 0;
	}

	var kEro = P.kEro, zKnee = P.zKnee, slopeRef = P.slopeRef, kPlacer = P.kPlacer;
	var delta = P.delta;
	// erosion
	for (i = 0; i < n; i++) {
		var zi = z[i];
		if (zi <= 0) continue;
		var sl = slope[i]; if (sl < 0) sl = -sl;
		var q = zi / zKnee;
		var e = kEro * zi * q * q * (1 + 2 * sl / slopeRef) * dt;
		if (!(e > 0)) continue;
		if (colNL[i] <= 0) continue;
		// Keep the stack operation in one place: it also invalidates deposits
		// hosted by a completely removed top bed.
		var Cremoved = Cmod.removeTop(i, e);
		var removed = Cremoved;
		var remFel = Cmod.removed[1];
		if (removed > 0) {
			Cmod.sums(i);
			hFel[i] = st.hFel[i]; hMaf[i] = st.hMaf[i];
			hSed[i] = st.hSed[i]; hTot[i] = st.hTot[i];
		}
		if (!(removed > 0)) continue;
		colBevel[i] = 1;
		changed[i] = 1;
		var w = colW[i];
		volE[i] = removed * w;
		volFel[i] = remFel * w;
		// Erosion does not destroy rock, it turns it into sediment: every removed bed of
		// another lithology is an explicit transformation, exactly the accounting
		// COL.compact uses when it merges across lithologies. Without this the sediment
		// mass grows with no source entry and the per-lithology ledger breaks as soon as
		// the surface kernel runs (measured: +110e9 m3 of sediment at 150 Myr).
		var remLi = Cmod.removedLi, l;
		for (l = 0; l < P.LITH.n; l++) {
			if (l === LITH_SED || remLi[l] === 0) continue;
			var volM = remLi[l] * w;
			st.ledMixOut[l] += volM;
			st.ledMixIn[LITH_SED] += volM;
		}
		var oSum = oOro[i] + oArc[i];
		if (oSum > 0) volPla[i] = kPlacer * oSum * removed * w;
		colLoad[i] = removed;
		colLoadFel[i] = remFel;
	}

	// routing target
	for (i = 0; i < n; i++) {
		if (volE[i] === 0) { lo[i] = -1; continue; }
		var im = i > 0 ? i - 1 : n - 1;
		var ip = i + 1 < n ? i + 1 : 0;
		var zl = z[im], zr = z[ip], zi2 = z[i];
		var leftLow = zl < zi2 - delta;
		var rightLow = zr < zi2 - delta;
		if (!leftLow && !rightLow) lo[i] = -1;
		else if (leftLow && !rightLow) lo[i] = im;
		else if (!leftLow && rightLow) lo[i] = ip;
		else lo[i] = zl < zr ? im : ip;
	}

	// split
	for (i = 0; i < n; i++) {
		var v = volE[i];
		if (v === 0) continue;
		var vf = volFel[i], vp = volPla[i];
		var dest = lo[i];
		if (dest < 0) {
			depVol[i] += v; depFel[i] += vf; depPla[i] += vp;
		} else if (wet[i] || wet[dest]) {
			var half = v * 0.5, hf = vf * 0.5, hp = vp * 0.5;
			depVol[i] += half; depFel[i] += hf; depPla[i] += hp;
			inVol[dest] += half; inFel[dest] += hf; inPla[dest] += hp;
		} else {
			inVol[dest] += v; inFel[dest] += vf; inPla[dest] += vp;
		}
	}

	// deposition
	var kB = P.kB;
	for (j = 0; j < n; j++) {
		var totV = depVol[j] + inVol[j];
		if (totV <= 0) {
			if (volE[j] !== 0) { colLoad[j] = 0; colLoadFel[j] = 0; }
			continue;
		}
		var totF = depFel[j] + inFel[j];
		var totP = depPla[j] + inPla[j];
		var wj = colW[j];
		var th = totV / wj;

		if (colBevel[j] && colNL[j] > 0) {
			var bj = j * LC;
			var topIdx = colNL[j] - 1;
			layFl[bj + topIdx] |= FLAG_UNCONF;
			colBevel[j] = 0;
		}

		var fl = wet[j] ? FLAG_WET : 0;
		var nl = colNL[j];
		var b2 = j * LC;
		if (nl > 0 && layLi[b2 + nl - 1] === LITH_SED && (layFl[b2 + nl - 1] & FLAG_WET) === (fl & FLAG_WET) && layTh[b2 + nl - 1] < 400) {
			layTh[b2 + nl - 1] += th;
			hSed[j] += th; hTot[j] += th;
		} else {
			if (nl < LC) {
				layTh[b2 + nl] = th;
				layLi[b2 + nl] = LITH_SED;
				layAg[b2 + nl] = t;
				layFl[b2 + nl] = fl;
				colNL[j] = nl + 1;
				hSed[j] += th; hTot[j] += th;
			} else {
				// at cap — thicken top if sed, else drop (rare, avoids compact scan)
				if (nl > 0 && layLi[b2 + nl - 1] === LITH_SED) {
					layTh[b2 + nl - 1] += th;
					hSed[j] += th; hTot[j] += th;
				} else {
					// last resort: compact via module (slow path, very rare)
					Cmod.push(j, th, LITH_SED, t, fl);
					Cmod.sums(j);
				}
			}
		}
		changed[j] = 1;
		var plaThDep = totP / wj;
		colPla[j] += plaThDep;
		if (plaThDep > 0) {
			var add = plaThDep * 0.005;
			var np = oPla[j] + add;
			oPla[j] = np > 1 ? 1 : np;
		}
		if (wet[j] && totF > 0) {
			var felFrac = totF / totV;
			var addBas = th * felFrac * kB;
			if (addBas > 0) {
				var nb = oBas[j] + addBas;
				oBas[j] = nb > 1 ? 1 : nb;
			}
		}
		colLoad[j] = 0; colLoadFel[j] = 0;
	}

	// clear remaining routed-away sources
	for (i = 0; i < n; i++) {
		if (volE[i] !== 0 && colLoad[i] !== 0) {
			// if it had a destination and routed 100%, clear
			var d = lo[i];
			if (d >= 0 && !(wet[i] || wet[d])) {
				colLoad[i] = 0; colLoadFel[i] = 0;
			} else if (d < 0) {
				// pit already deposited, cleared above
			} else {
				// wet 50% case: depVol already deposited half, but colLoad still holds full
				// we cleared via deposition loop if depVol>0, so if still non-zero, clear
				if (depVol[i] > 0) { colLoad[i] = 0; colLoadFel[i] = 0; }
			}
		}
	}

	// incremental profile for changed columns + neighbours
	for (i = 0; i < n; i++) if (changed[i]) {
		z[i] = SURF.elev(i);
		wet[i] = z[i] < 0 ? 1 : 0;
		slopeDirty[i] = 1;
		var im2 = i > 0 ? i - 1 : n - 1;
		var ip2 = i + 1 < n ? i + 1 : 0;
		slopeDirty[im2] = 1; slopeDirty[ip2] = 1;
	}
	if (n >= 3) {
		for (i = 0; i < n; i++) if (slopeDirty[i]) {
			var im3 = i > 0 ? i - 1 : n - 1;
			var ip3 = i + 1 < n ? i + 1 : 0;
			var dx = st.colX[ip3] - st.colX[im3];
			if (dx <= 0) dx += P.wrap;
			slope[i] = dx > 0 ? (z[ip3] - z[im3]) / dx : 0;
		}
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = SURF;
