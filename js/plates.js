// plates.js — K2 plate solve and the K3 boundary classifier (design §4.2).
// A plate is rigid in 1D, so the reference's 3x3 force balance degenerates to a
// width-weighted mean of (mantle drive + equivalent basal velocities w / cD) over its
// columns, relaxed by dtGeo/tauOmega and clamped to vMax. Slab pull joins in M4.
// Edge i is the boundary from sorted column i to its right neighbour across the wrap.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.MNT;

var PLT = {
	wB: new Float64Array(P.colCap),     // equivalent basal velocity, m/Myr
	sumW: new Float64Array(P.plateCap),
	sumU: new Float64Array(P.plateCap)
};

// cD rescales every non-drag term: a cooling mantle stiffens and the same forces
// produce less speed, so plates freeze into a stagnant lid without a switch
PLT.cD = function (Tm) { return Math.exp(P.Ea * (1 / Tm - 1)); };

PLT.oceanic = function (S, i) { return S.hFel[i] < P.hOceanic; };

// ridge push on oceanic columns (downslope), and the previous frame's C–C collision
// resistance pushing both sides apart, growing with the felsic thickness in contact
PLT.basal = function (S) {
	var n = S.nCol, w = this.wB, i, j, m, f;
	for (i = 0; i < n; i++) w[i] = this.oceanic(S, i) ? -P.kRidge * S.slope[i] : 0;
	for (i = 0; i < n; i++) {
		if (S.edge[i] !== P.EDGE.collide || S.edgeRelN[i] >= 0) continue;
		j = i + 1 < n ? i + 1 : 0;
		f = Math.min(2, (S.hFel[i] + S.hFel[j]) / (2 * P.hFelLand0));
		m = P.vColl * f * -S.edgeRelN[i] / P.vRef;
		w[i] -= m;
		w[j] += m;
	}
};

PLT.solve = function (S, dt, Tm) {
	var n = S.nCol, np = S.nPl, sw = this.sumW, su = this.sumU, i, p, target;
	var icD = 1 / this.cD(Tm), a = Math.min(1, dt / P.tauOmega);
	for (p = 0; p < np; p++) { sw[p] = 0; su[p] = 0; }
	for (i = 0; i < n; i++) {
		p = S.colPlate[i];
		sw[p] += S.colW[i];
		su[p] += S.colW[i] * (MNT.uCol[i] + this.wB[i] * icD);
	}
	for (p = 0; p < np; p++) {
		S.plUP[p] = S.plU[p];
		if (!(sw[p] > 0)) continue;
		target = su[p] / sw[p];
		S.plU[p] += (target - S.plU[p]) * a;
		if (S.plU[p] > P.vMax) S.plU[p] = P.vMax;
		else if (S.plU[p] < -P.vMax) S.plU[p] = -P.vMax;
	}
	for (i = 0; i < n; i++) S.colU[i] = S.plU[S.colPlate[i]];
};

// ext = d(uMantle - uPlate)/dx, periodic centred differences at the column positions
// (1/Myr; the damage update in K5 normalizes by extRef)
PLT.extension = function (S) {
	var n = S.nCol, uM = MNT.uCol, i, im, ip, dx;
	if (n < 3) { for (i = 0; i < n; i++) S.ext[i] = 0; return; }
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		ip = i + 1 < n ? i + 1 : 0;
		dx = S.colX[ip] - S.colX[im];
		if (dx <= 0) dx += P.wrap;
		S.ext[i] = ((uM[ip] - S.colU[ip]) - (uM[im] - S.colU[im])) / dx;
	}
};

PLT.k2 = function (S, dt, t, Tm) {
	if (!(dt > 0)) return;
	PLT.basal(S);
	PLT.solve(S, dt, Tm);
	PLT.extension(S);
};

// --- K3 classifier ----------------------------------------------------------------

// hysteresis on the signed normal speed (positive opens); the kept state must have the
// same sign as the speed, so a reversal always passes through neutral or a threshold
PLT.edgeType = function (prev, relN) {
	var E = P.EDGE;
	if (relN > P.epsHi) return E.open;
	if (relN < -P.epsHi) return E.subduct;
	if (prev === E.open && relN > P.epsLo) return E.open;
	if ((prev === E.subduct || prev === E.collide) && relN < -P.epsLo) return E.subduct;
	return E.neutral;
};

// closing edge -> collide or subduct with polarity (-1 left subducts, +1 right):
// C–C collides, O–C oceanic subducts, O–O older subducts. An established O–O polarity
// is kept for the same plate pair, so an age tie never flips a running trench.
PLT.polarity = function (S, i, j, keepPol) {
	var oi = this.oceanic(S, i), oj = this.oceanic(S, j);
	if (!oi && !oj) { S.edge[i] = P.EDGE.collide; S.edgePol[i] = 0; return; }
	S.edge[i] = P.EDGE.subduct;
	if (oi !== oj) { S.edgePol[i] = oi ? -1 : 1; return; }
	S.edgePol[i] = keepPol !== 0 ? keepPol : (S.colAge[i] >= S.colAge[j] ? -1 : 1);
};

PLT.classify = function (S, dt) {
	var E = P.EDGE, n = S.nCol, i, j, rp, same, prev, prevPol, type;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		rp = S.colPlate[j];
		S.edgeRelN[i] = S.colU[j] - S.colU[i];
		same = S.edgeRPlate[i] === rp;
		prev = same ? S.edge[i] : E.neutral;
		prevPol = same && prev === E.subduct ? S.edgePol[i] : 0;
		S.edgeRPlate[i] = rp;
		if (S.colPlate[i] === rp) {
			S.edge[i] = E.none; S.edgePol[i] = 0; S.edgeAge[i] = 0;
			continue;
		}
		type = this.edgeType(prev, S.edgeRelN[i]);
		S.edge[i] = type;
		S.edgePol[i] = 0;
		if (type === E.subduct) this.polarity(S, i, j, prevPol);
		S.edgeAge[i] = same && S.edge[i] === prev ? S.edgeAge[i] + dt : 0;
	}
};

// trenchDist 1..3 on the overriding side of each subduction edge (the arc factory)
PLT.trench = function (S) {
	var n = S.nCol, i, j, c, d, pl, step;
	S.trenchDist.fill(0, 0, n);
	for (i = 0; i < n; i++) {
		if (S.edge[i] !== P.EDGE.subduct) continue;
		j = i + 1 < n ? i + 1 : 0;
		c = S.edgePol[i] < 0 ? j : i;
		step = S.edgePol[i] < 0 ? 1 : n - 1;
		pl = S.colPlate[c];
		for (d = 1; d <= 3 && S.colPlate[c] === pl; d++) {
			if (S.trenchDist[c] === 0 || d < S.trenchDist[c]) S.trenchDist[c] = d;
			c = (c + step) % n;
		}
	}
};

PLT.k3 = function (S, dt) {
	if (!(dt > 0)) return;
	PLT.classify(S, dt);
	PLT.trench(S);
};

if (typeof module !== 'undefined' && module.exports) module.exports = PLT;
