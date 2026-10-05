(function (root) {
// crust.js — K5, the column update (design §4.4): thermal age, damage and healing,
// dynamic topography (relaxation, the trench source, flexure) and the gravitational
// collapse that caps orogen height. Arc growth and ore accumulation join in M4/M6,
// erosion and deposition in M3 (K6). Headless, allocation-free, and every stencil is a
// gather: the fluxes come from the previous frame's fields, the moves are applied after,
// so a column never reads a value this same pass has written.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.COLSURF;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COLCOLUMNS;
var MAG = (typeof module !== 'undefined' && module.exports) ? require('./magma.js') : window.COLMAGMA;

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

// Growth goes where the rock belongs in the section (COL.insertVol), not on top of the
// bed that is already there: the arc's felsic thickening a sediment drape, or a large
// intrusive sheet landing at the surface, are the two inversions this removes.
CRU.addLayer = function (st, c, thick, lith, age, flags) {
	if (!(thick > 0)) return;
	COL.insertVol(st, c, lith, thick, age, flags);
};

CRU.arcSpeed = function (st, c) {
	var n = st.nCol, d, j, speed = 0;
	for (d = 0; d <= 3; d++) {
		j = (c + d) % n;
		if (st.edge[j] === P.EDGE.subduct && Math.abs(st.edgeRelN[j]) > speed) speed = Math.abs(st.edgeRelN[j]);
		j = (c - d + n) % n;
		if (st.edge[j] === P.EDGE.subduct && Math.abs(st.edgeRelN[j]) > speed) speed = Math.abs(st.edgeRelN[j]);
	}
	return speed;
};

CRU.arcGrowth = function (st, dt, t, Tm) {
	var i, speed, recycled, norm, add, ore;
	for (i = 0; i < st.nCol; i++) {
		if (!(st.trenchDist[i] > 0) || st.colGhost[i]) continue;
		speed = this.arcSpeed(st, i);
		if (!(speed > 0) || !(st.colRecycle[i] > 0)) continue;
		norm = P.w0 * 5e3 * P.slabWaterSed;
		recycled = st.colRecycle[i] / norm;
		if (recycled > 2) recycled = 2;
		add = P.kArc * Tm * speed * dt / P.vRef * (1 + P.kRec * recycled);
		if (!(add > 0)) continue;
		ore = recycled > 0 ? P.FLAG.ore : 0;
		this.addLayer(st, i, add, P.LITH.fel, t, ore);
		st.ledProd[P.LITH.fel] += add * st.colW[i];
		st.oArc[i] += P.kA * Math.min(2, speed / P.vRef) * dt * (1 + recycled);
		if (st.oArc[i] > 1) st.oArc[i] = 1;
		COL.sums(i);
	}
};

CRU.lipGrowth = function (st, dt, t) {
	var i, c, best, add;
	for (i = 0; i < st.nPlm; i++) {
		if (!st.plmArrive[i] || !(st.plmStr[i] > 0)) continue;
		c = MAG.nearest(st, st.plmX[i]);
		if (c < 0 || st.colGhost[c]) continue;
		best = Math.abs(MAG.dx(st.colX[c], st.plmX[i]));
		if (best > Math.max(P.w0, st.plmR[i])) continue;
		add = P.kLIP * st.plmStr[i] * dt;
		this.addLayer(st, c, add, P.LITH.lava, t, 0);
		// the new layer is lava, so the ledger has to credit lava, not mafic melt:
		// massBy[] is measured per stored lithology, and a mafic credit here leaves
		// the lava account with mass and no production entry
		st.ledProd[P.LITH.lava] += add * st.colW[c];
		st.oMaf[c] += 0.01 * add / 1e3;
		if (st.oMaf[c] > 1) st.oMaf[c] = 1;
		COL.sums(c);
	}
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
	CRU.delaminate(st, dt);
	CRU.collapse(st, dt);
	CRU.arcGrowth(st, dt, t, Tm);
	CRU.lipGrowth(st, dt, t);
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

// Delamination: the ceiling on crust thickness. A convergent contact shortens, and in 1D
// shortening can only make the two records thicker -- their territory is the gap between
// them, and the gap cannot go below the floor. Two 48 km continents meeting at the floor
// are two 92 km records, and neither the collapse (which moves felsic, and a squeezed
// column's excess is mafic basement) nor the isostasy (which answers thickness with
// elevation, not with less crust) can take that away. Real orogens answer it by
// foundering: the dense lower crust drips into the mantle. That is the sink this is, and
// it is the design's explicit delamination sink -- without it the crust ceiling is not a
// mechanism, only a threshold someone wrote down.
//
// The rate is proportional to the excess over the ceiling, so a column at the ceiling
// stops thickening and a column far over it sheds quickly, and the volume is peeled off
// the *base* (the mafic and intrusive beds) and booked as consumed, so the ledger says
// where the rock went instead of losing it quietly.
CRU.delaminate = function (st, dt) {
	var n = st.nCol, i, b, k, over, take, w, h, any = false, m, lit = CRU.delLit, vol = CRU.delVol;
	for (i = 0; i < n; i++) {
		if (st.colGhost[i]) continue;
		over = st.hTot[i] - P.crustMax;
		if (!(over > 0)) continue;
		// metres of crust this frame: a fraction of the excess, never all of it, so the
		// surface subsides smoothly instead of stepping down onto the ceiling
		// proportional to the excess, and never more than half of it in one frame, so
		// the ceiling is reached within a frame or two instead of stepping onto it
		take = P.kDelam * over * 1000 * dt;
		if (take > over * 500) take = over * 500;
		if (!(take > 0)) continue;
		b = i * P.layerCap;
		w = st.colW[i];
		m = 0;
		for (k = 0; k < st.colNL[i] && take > 0; k++) {
			h = st.layTh[b + k];
			if (!(h > 0)) continue;
			if (take >= h) {
				take -= h;
				st.layTh[b + k] = 0;
				lit[m] = st.layLi[b + k]; vol[m] = h * w; m++;
			} else {
				st.layTh[b + k] = h - take;
				lit[m] = st.layLi[b + k]; vol[m] = take * w; m++;
				take = 0;
			}
		}
		for (k = 0; k < m; k++) st.ledCons[lit[k]] += vol[k];
		COL.sums(i);
		any = true;
	}
	return any;
};

CRU.delLit = new Int32Array(P.layerCap);
CRU.delVol = new Float64Array(P.layerCap);

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
		// A draining sliver has no crust and so has no thickness to be low: it reads as
		// a hole in the profile, and every face next to it would pour felsic into a
		// record that is retired a few frames later. A sliver is a gap, not a basin, so
		// the faces around one carry nothing and the flow goes on past it.
		if (st.colGhost[i] || st.colGhost[ip]) continue;
		if (st.hFel[i] < P.hCollapse && st.hFel[ip] < P.hCollapse) continue;
		dh = st.hFel[ip] - st.hFel[i];
		if (dh === 0) continue;
		CRU.face[i] = kf * dh / CRU.faceGap(st, n, i);
		any = true;
	}
	if (any) {
		// face[i] > 0 is inflow into i across its right face (the same sign convention as
		// the flexure), so the material travels from the thicker i+1 to the thinner i
		for (i = 0; i < n; i++) {
			v = CRU.face[i];
			if (v === 0) continue;
			ip = i + 1 < n ? i + 1 : 0;
			if (v > 0) COL.collapseMove(ip, i, v);
			else COL.collapseMove(i, ip, -v);
		}
	}
	CRU.belt(st, dt);
};

// The orogenic flow (0.1.5 M2). A convergent contact cannot make room for the crust
// shortening adds: in 1D the only places that crust can go are up (the isostasy) and
// sideways. Without the sideways part the pair at a collision simply doubles in
// thickness and the boundary is a two-column needle standing 1.5x its flanks (measured:
// 65 km between 46 and 42 km flanks at 5 Myr, and 1.68x at 6.8 Myr, on seed 5).
//
// So the crust a collision carries above the ground beside it moves out to the columns
// beyond the pair, at a rate set by how fast the boundary is closing: a fast collision
// spreads faster than a slow one, and a pair that is no longer above its flanks carries
// nothing. The felsic is peeled off the top of the pair and handed to the column beyond
// it (COL.collapseMove -> COL.insertVol), so the belt grows outward bed by bed instead of
// the pair growing a second, third and fourth bed. It is a move inside the crust, so the
// ledger has nothing to say about it.
CRU.belt = function (st, dt) {
	var n = st.nCol, i, j, k, excess, th;
	for (i = 0; i < n; i++) {
		if (st.edge[i] !== P.EDGE.collide || st.colGhost[i]) continue;
		j = i + 1 < n ? i + 1 : 0;
		if (st.colGhost[j]) continue;
		// the flow needs ground to flow into: a draining record beside the pair is a
		// trench, not a flank
		for (k = 1; k <= P.beltFeed; k++) {
			if (st.colGhost[wmodc(i - k, n)] || st.colGhost[wmodc(j + k, n)]) break;
		}
		if (k <= P.beltFeed) continue;
		// COL.beltAt is the one belt measurement in the model, and its flanks sit just
		// outside the ground this flow reaches, so the belt is measured against ground it
		// has not thickened. A flank inside the flow's reach rises with the belt and
		// shuts the flow off as soon as it works.
		COL.beltAt(st, n, i);
		// the crust holds up a root of beltYield before it starts to flow sideways, the
		// way an orogenic wedge stands at its critical taper: without that the flow
		// flattens the boundary until no belt is left at all
		excess = 0.5 * (st.hTot[i] + st.hTot[j]) - COL.flankH - P.beltYield;
		if (!(excess > 0)) continue;
		th = P.kBelt * excess * 1000 * dt * (0.5 + Math.abs(st.edgeRelN[i]) / P.vRef);
		if (!(th > 0)) continue;
		// spread over the P.beltFeed columns each side, so the belt widens instead of
		// raising a wall two columns wide
		for (k = 1; k <= P.beltFeed; k++) {
			COL.collapseMove(i, wmodc(i - k, n), th * st.colW[i] / P.beltFeed);
			COL.collapseMove(j, wmodc(j + k, n), th * st.colW[j] / P.beltFeed);
		}
	}
};

// wrapped column index. The hand-rolled `i > 2 ? i - 2 : n - 2` this replaces sent
// column 1 to n - 2 and column n - 1's belt to column 2, i.e. across the whole planet.
function wmodc(k, n) { k %= n; return k < 0 ? k + n : k; }

if (typeof module !== 'undefined' && module.exports) module.exports = CRU;
else root.COLCRUST = CRU;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
