// plates.js — K2 plate solve and K3 transport/classifier (design §4.2).
// A plate is rigid in 1D, so the reference's 3x3 force balance degenerates to a
// width-weighted mean of the drive over its columns plus the boundary forces acting on
// the plate as a whole, relaxed by dtGeo/tauOmega and clamped to vMax.
// Edge i is the boundary from sorted column i to its right neighbour across the wrap.
//
// Two kinds of term enter, and telling them apart is what makes the speeds come out at
// the scale of real plates:
//
//   distributed   ridge push: an equivalent basal *velocity* per column, entering the
//                 mean weighted by the column's width, so a plate feels it in
//                 proportion to the oceanic ground it carries. This is correct as a
//                 per-column quantity because it is the local slope integral: summed
//                 over an oceanic run it telescopes to the ridge-to-trench drop.
//   line force    slab pull and collision resistance act *at a boundary*, on the plate
//                 as a whole. They are summed once per plate (fP, m2/Myr = velocity x
//                 length) and divided by the plate's width by the solve itself, which is
//                 a force divided by a drag.
//
// Writing the boundary terms as per-column velocities — what 0.1.5 did — divided both by
// the number of columns in the plate. Measured on seed 1 at 100 Myr, a slab pull worth
// 2 cm/yr of equivalent velocity reached its plate as 0.6 mm/yr and a continental
// collision braking at 8 cm/yr reached its plates as 1.6 mm/yr, against a mantle drive of
// 2.5 mm/yr: the plates moved at the speed of the drive alone (mean 2.7 mm/yr, a tenth of
// the real thing) and a collision braked nothing it was not already stopping.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.MNT;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;
var SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.SLAB;

var PLT = {
	wB: new Float64Array(P.colCap),     // distributed equivalent basal velocity, m/Myr
	fP: new Float64Array(P.plateCap),   // line forces on each plate, m2/Myr, +x
	sumW: new Float64Array(P.plateCap),
	sumU: new Float64Array(P.plateCap)
};

// cD rescales every non-drag term: a cooling mantle stiffens and the same forces
// produce less speed. The extra low-T term makes the design's 4 Gyr stagnant lid
// measurable without changing the hot-start calibration.
PLT.cD = function (Tm) {
	var cold = Tm < 1 ? 1 - Tm : 0;
	return Math.exp(P.Ea * (1 / Tm - 1) + P.coolDrag * cold * cold);
};

// A sliver is the trench, not crust: it is never the downgoing side, and it is not the
// subducting plate's youngest basalt either. Reading it as continental is what keeps the
// next pair at the trench classified O-C with the *real* oceanic column subducting,
// whatever its age (0.1.5 M1a).
PLT.oceanic = function (S, i) { return S.hFel[i] < P.hOceanic && !S.colGhost[i]; };

// Ridge push on oceanic columns (downslope), and the two boundary line forces: the
// slab hanging at a trench pulls the plate that owns it, and the previous frame's C–C
// collision resistance pushes both sides apart over the width of the orogen.
PLT.basal = function (S) {
	var n = S.nCol, np = S.nPl, w = this.wB, f = this.fP, i, j, p, q, m, fb, lb;
	var slabAge, loser, dir, gap, x, len;
	for (i = 0; i < n; i++) w[i] = this.oceanic(S, i) ? -P.kRidge * S.slope[i] : 0;
	for (p = 0; p < np; p++) f[p] = 0;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		p = S.colPlate[i]; q = S.colPlate[j];
		if (p === q) continue;
		if (S.edge[i] === P.EDGE.subduct) {
			loser = S.edgePol[i] < 0 ? i : j;
			// the downgoing plate is pulled *toward* the trench, so the sign follows the
			// polarity: a left-hand loser is pulled to +x, a right-hand one to -x. One
			// unsigned `+=` on the loser (0.1.5) pulled half the trenches the wrong way
			// and pushed the slab's own plate out of the trench instead.
			dir = S.edgePol[i] < 0 ? 1 : -1;
			slabAge = Math.min(1, Math.max(0, S.colAge[loser]) / 70);
			gap = S.colX[j] - S.colX[i];
			if (gap < 0) gap += P.wrap;
			x = S.colX[i] + gap * 0.5;
			if (x >= P.wrap) x -= P.wrap;
			len = SLAB.pullLen(S, x, S.edgePol[i] < 0 ? 1 : -1);
			f[S.colPlate[loser]] += dir * P.vSlab * P.slabPullK * slabAge * len;
		}
		if (S.edge[i] !== P.EDGE.collide || S.edgeRelN[i] >= 0) continue;
		// The resistance is what the orogen is, not what the two records at the contact
		// are: it acts over the whole belt the collision has built (COL.beltAt, the same
		// measurement the R2 gate uses) and it scales with the felsic thickness standing
		// in it. A young two-column contact is a narrow wall and brakes little; a
		// twelve-column orogen of thickened crust is a buttress and brakes hard, which is
		// how a collision comes to rest without a speed limit anywhere (R4).
		COL.beltAt(S, n, i);
		lb = COL.beltW;
		fb = COL.beltFel / P.hFelLand0;
		if (fb > 2) fb = 2;
		m = P.vColl * fb * -S.edgeRelN[i] / P.vRef * lb;
		f[p] -= m;
		f[q] += m;
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
	// the line forces are already whole-plate: one term, divided by the width below
	for (p = 0; p < np; p++) su[p] += this.fP[p] * icD;
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

// ext = d(uMantle)/dx, the divergence of the mantle's own surface flow at the columns
// (1/Myr; the damage update in K5 normalizes by extRef).
//
// The design writes d(uMantle - uPlate)/dx, and inside a plate the two are the same
// thing, because a plate is rigid and its own divergence is zero there. They differ only
// at a boundary, where uPlate jumps: the difference is the jump over two columns, with
// the *opposite* sign to the geology. Measured on seed 1, a convergent boundary read
// +5.4 /Myr — 540x extRef, an instant saturation — and a divergent one read negative, so
// the field damaged the crust exactly where it was being destroyed and left the rifts
// that were opening alone (mean damage at t = 5 Myr: trench 0.75, rift 0.14).
//
// What nucleates a rift is the basal traction tearing the plate apart from below, which
// is the mantle's divergence; what a boundary does to the crust is already written in the
// boundary classification. So the plate term stays out of this field.
PLT.extension = function (S) {
	var n = S.nCol, uM = MNT.uCol, i, im, ip, dx;
	if (n < 3) { for (i = 0; i < n; i++) S.ext[i] = 0; return; }
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		ip = i + 1 < n ? i + 1 : 0;
		dx = S.colX[ip] - S.colX[im];
		if (dx <= 0) dx += P.wrap;
		S.ext[i] = (uM[ip] - uM[im]) / dx;
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
	var E = P.EDGE, n = S.nCol, i, j, rp, same, prev, prevPol, type, d;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		rp = S.colPlate[j];
		S.edgeRelN[i] = S.colU[j] - S.colU[i];
		same = S.edgeRPlate[i] === rp;
		prev = same ? S.edge[i] : E.neutral;
		prevPol = same && prev === E.subduct ? S.edgePol[i] : 0;
		S.edgeRPlate[i] = rp;
		if (S.colPlate[i] === rp) {
			S.edge[i] = E.none; S.edgePol[i] = 0; S.edgeAge[i] = 0; S.edgeSlow[i] = 0;
			continue;
		}
		type = this.edgeType(prev, S.edgeRelN[i]);
		// Hard contact: the eps hysteresis decides the boundary *state*, but a pair that
		// already overlaps and is still closing has to resolve by polarity. The reference
		// can leave such a pair neutral (its cells keep a fixed area); here widths come
		// from spacing, so an unresolved slow overlap squeezes a column toward zero width
		// and its volume-conserving stack toward a kilometre-scale spike.
		if (type === E.neutral && S.edgeRelN[i] < 0) {
			d = S.colX[j] - S.colX[i];
			if (d < 0) d += P.wrap;
			if (d < P.rContact * P.w0) type = E.subduct;
		}
		S.edge[i] = type;
		S.edgePol[i] = 0;
		if (type === E.subduct) this.polarity(S, i, j, prevPol);
		S.edgeAge[i] = same && S.edge[i] === prev ? S.edgeAge[i] + dt : 0;
		S.edgeSlow[i] = same && S.edge[i] === E.collide && prev === E.collide &&
			Math.abs(S.edgeRelN[i]) < P.vSuture ? S.edgeSlow[i] + dt : 0;
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
	COL.transport(S, dt);
	PLT.classify(S, dt);
	PLT.trench(S);
};

if (typeof module !== 'undefined' && module.exports) module.exports = PLT;
