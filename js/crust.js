// crust.js — K5, the column update (design §4.4): thermal age, damage and healing,
// dynamic topography (relaxation, the trench source, flexure) and the gravitational
// collapse that caps orogen height. Arc growth and ore accumulation join in M4/M6,
// erosion and deposition in M3 (K6). Headless, allocation-free, and every stencil is a
// gather: the fluxes come from the previous frame's fields, the moves are applied after,
// so a column never reads a value this same pass has written.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.SURF;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;

var CRU = {
	face: new Float64Array(P.colCap)     // right-face flux of each column, per stencil
};

// Lithosphere strength (design §4.4, reference §6.5): thick, old crust on a cold planet
// resists damage. Divided by Tm, so a hot young planet is weak everywhere and damage
// localizes as the mantle cools — that is what makes split corridors appear late.
CRU.strength = function (i, Tm) {
	var s = P.strBase +
		P.strFelK * SURF.smoothstep(S.hFel[i], P.strFelLo, P.strFelHi) +
		P.strAgeK * SURF.smoothstep(S.colAge[i], P.strAgeLo, P.strAgeHi);
	if (s < P.strBase) s = P.strBase;
	else if (s > P.strMax) s = P.strMax;
	return s / Tm;
};

CRU.k5 = function (st, dt, t, Tm) {
	if (!(dt > 0)) return;
	var n = st.nCol, i, ext, dmg;
	for (i = 0; i < n; i++) {
		st.colAge[i] += dt;
		// only extension damages (a converging column shortens and thickens instead);
		// the kDamT*|relT| term stays deferred — this 1D plate state has no transverse
		// velocity, so a neutral contact must not invent damage (design §4.3)
		ext = st.ext[i] > 0 ? st.ext[i] / P.extRef : 0;
		dmg = st.damage[i];
		dmg += dt * (P.kDam * ext / CRU.strength(i, Tm) - P.kHeal * dmg);
		st.damage[i] = dmg < 0 ? 0 : (dmg > 1 ? 1 : dmg);
	}
	CRU.zDyn(st, dt);
	CRU.collapse(st, dt);
};

// Face gap of the periodic face i -> i+1, floored. Both column stencils below are
// finite-volume: the face flux is one number seen from both sides, so SUM(width*field)
// is unchanged by the diffusion whatever the spacing is, and the floor caps the explicit
// rate where two columns are squeezed together (a face gap of 0.05*w0 would otherwise
// ask for a 200x smaller step than the frame provides).
CRU.faceGap = function (st, n, i) {
	var ip = i + 1 < n ? i + 1 : 0, g = st.colX[ip] - st.colX[i], min = P.faceGapMin * P.w0;
	if (g < 0) g += P.wrap;
	return g < min ? min : g;
};

// zDyn (design §4.4): relaxes toward its source with tauDyn, and the source is the
// trench — the overriding margin column of a running subduction edge (trenchDist 1),
// pulled down toward -zTrench. Written as one exponential pull toward the target rather
// than the reference's "-= zTrench every frame", which would make the depth of a trench
// depend on the frame step; this way a running trench settles at exactly -3 km at any
// dtGeo, and a trench that stops relaxes back to 0 in ~10 Myr. Plume swell is M4.
CRU.zDyn = function (st, dt) {
	var n = st.nCol, i, im, z = st.zDyn, a = 1 - Math.exp(-dt / P.tauDyn), kf, f;
	if (n < 3) return;
	for (i = 0; i < n; i++) {
		z[i] += ((st.trenchDist[i] === 1 ? -P.zTrench : 0) - z[i]) * a;
	}
	// Flexure: the design's 1D Laplacian on zDyn as a periodic width-weighted diffusion.
	// Conductance w0^2/gap makes a uniform grid exactly the reference's
	// kFlex*dt*SUM(zDyn_j - zDyn_i), so kFlex keeps its 1/Myr meaning; dividing by the
	// column's own width is the finite-volume weighting. It spreads the trench
	// depression into a foreland beside the orogen without creating any of it.
	kf = P.kFlex * dt * P.w0 * P.w0;
	for (i = 0; i < n; i++) CRU.face[i] = kf * (z[i + 1 < n ? i + 1 : 0] - z[i]) / CRU.faceGap(st, n, i);
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		f = (CRU.face[i] - CRU.face[im]) / st.colW[i];
		z[i] += f;
	}
};

// Gravitational collapse (design §4.4, reference §7.2): felsic crust diffuses between
// neighbours while either side is above hCollapse, so plateaus spread and an orogen
// stops growing. Shortening conserves volume while it removes area, so without a sink the
// pile-up is unbounded: over 1 Gyr at 100 kyr/frame (seed 5) the peak column reaches 946 km
// of crust and 153 km of relief with no K5 at all, and 142 km / 17 km with collapse on. It
// is a real cap but a slow one, and it stays the only one until M3 erosion arrives — at
// 17 km of relief the knee law removes ~3 km/Myr, at 100 km ~620 km/Myr, orders of
// magnitude more than this diffusion carries. It moves real beds, because hFel is a cache
// of the stack and the two must never disagree.
CRU.collapse = function (st, dt) {
	var n = st.nCol, i, ip, dh, kf = P.kCollapse * dt * P.w0 * P.w0, any = false, v;
	if (n < 3) return;
	for (i = 0; i < n; i++) {
		ip = i + 1 < n ? i + 1 : 0;
		CRU.face[i] = 0;
		if (st.hFel[i] < P.hCollapse && st.hFel[ip] < P.hCollapse) continue;
		dh = st.hFel[ip] - st.hFel[i];
		if (dh === 0) continue;
		CRU.face[i] = kf * dh / CRU.faceGap(st, n, i);
		any = true;
	}
	if (!any) return;
	// face[i] > 0 is inflow into i across its right face (the same sign convention as
	// the flexure), so the material travels from the thicker i+1 to the thinner i
	for (i = 0; i < n; i++) {
		v = CRU.face[i];
		if (v === 0) continue;
		ip = i + 1 < n ? i + 1 : 0;
		if (v > 0) COL.collapseMove(ip, i, v);
		else COL.collapseMove(i, ip, -v);
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = CRU;
