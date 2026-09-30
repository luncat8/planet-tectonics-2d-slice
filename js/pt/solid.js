// pt/solid.js — 0.3.0 P2.1: the crust law and the emergent plates (plan §4.2, its kinematic
// core). This is kernel G4: it runs after the flow has advected the markers and projects the
// strong ones onto their plates' rigid motion, which is what makes the cold skin a lid
// instead of a cold fluid.
//
// Strength (plan §4.2, §3.1) is a function of temperature and of `age`, "Myr since the
// particle last froze":
//
//     heat(T)  = smoothstep(muLo, muHi, T)              hot rock is soft
//     mu(T, a) = (0.05 + 0.95 * (1 - heat)) * (1 - exp(-a / tauWeld))
//
// `age` accumulates below TLock, resets above TSoft and holds between, so the law is a
// hysteresis loop on cooling: rock that has stayed cold welds with time, rock that is warm
// never acquires an age, and the asthenosphere (T >= TSoft everywhere in a healthy run)
// stays at mu ~ 0 no matter how old the clock says it is. Without that rule the interior at
// T ~ 0.5 measures mu ~ 0.8 after a few tau and the whole mantle clusters into one body.
//
// A marker with mu >= clusterMin is a plate marker. Clusters are the connected components of
// adjacency among strong markers (plan §3.2: clusters are recomputed every frame, never
// stored): two strong markers bond if they are within contact range (~1.3 cells in x and
// eta, the stateless reading of a bond's rest length). A cluster then rides the flow as one
// rigid body -- translation and rotation fitted to the mass-weighted mean of the flow its
// members were given -- which is pt-emerge's first claim ("a cold body travels at the flow's
// mass-weighted mean under it") as a kinematics. The projection is position based: the
// marker is moved from where the flow took it to where its plate's motion wants it, blended
// by smoothstep(clusterMin, 1.4 clusterMin, mu), so a barely-strong marker joins softly.
//
// Failure (plan §4.2's damage, in rate form) is what turns one planet-wide lid into plates.
// A bond is elastic below its own yield strain rate, yieldRate * mu, and accumulates damage
// above it at kDamage per unit of *mean* excess per Myr -- the mean over the pairs that
// contact the marker, not the sum, because the sum makes the rate proportional to local
// marker density (measured: a crowded lid marker carries 2-5x the partner count of a sparse
// one and failed about as much faster). The integral is accumulated during the pair walk and
// applied after it, so the walk is read-only and order-independent. Damage reaches 1 and the
// marker's bonds are gone. The load is read from the *flow's* relative velocity across the
// pair -- the plate is loaded by the mantle under it, and a rigid fit that erased the load
// would erase the failure with it. This is pt-emerge's measured rule 1 in rate form: damage
// from any strain at all (no yield) creeps every plate apart under a static load; elastic
// below the strength is what holds a suture. A soft marker re-melts its damage; a cold quiet
// one anneals it away over tauHeal, which is how a closed seam welds back together.
//
// The heat bookkeeping does not pass through here: this kernel moves markers, never changes
// T or m, so the ledger is untouched. What is not here yet is plan §4.2's rest shapes and
// plastic rest-length relaxation, and contact between converging clusters (P2.2): two
// plates can currently interpenetrate at a convergent boundary instead of one rolling under
// the other.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;

var SC = {
	// G4: strength, clusters (damage + connectivity), then the rigid projection. No-op at
	// dt = 0 (a paused frame reports; it does not age, weld or move anything).
	crust: function (M, S, dt) {
		if (!P.solid || !(dt > 0) || !S.n) return;
		strength(M, S, dt);
		clusters(M, S, dt);
		kinematics(M, S, dt);
	}
};

function smoothstep(a, b, x) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
}

// the age hysteresis, the damage anneal, and the strength law, one pass over the markers
function strength(M, S, dt) {
	var p, T, a, heat, weld, d;
	for (p = 0; p < S.n; p++) {
		T = S.T[p];
		d = S.dmg[p];
		if (T >= P.TSoft) { S.age[p] = 0; S.dmg[p] = 0; }
		else if (T <= P.TLock) {
			S.age[p] += dt;
			if (d > 0) {
				d -= dt / P.tauHeal;
				S.dmg[p] = d < 0 ? 0 : d;
			}
		}
		a = S.age[p];
		heat = smoothstep(P.muLo, P.muHi, T);
		weld = 1 - Math.exp(-a / P.tauWeld);
		S.mu[p] = (0.05 + 0.95 * (1 - heat)) * weld;
	}
}

// union-find over the strong markers' node buckets, and the load those markers carry. The
// bucket machinery is grid.js's own (counts/slot/order, rebuilt here for these positions);
// reseed rebuilds it again when it runs, so the reuse is safe. The pair scan does both jobs
// at once: it accumulates the flow's load as damage, then bonds the survivors. The bond
// decision reads last frame's damage -- one frame of lag on a 20 Myr weld clock -- so the
// scan visits each pair once.
function clusters(M, S, dt) {
	var nx = M.nx, ny = M.ny, counts = M.counts, slot = M.slot, order = S.order;
	var p, q, i, j, c = 0, nCl = 0, q2, base, k, r, d;
	var strong = P.clusterMin, near = strong * 0.6;
	counts.fill(0);
	for (p = 0; p < S.n; p++) {
		S.cl[p] = -1;
		if (S.mu[p] * (1 - S.dmg[p]) < near) continue;
		q = G.nodeOf(M, S, p);
		S.cl[p] = -2;                       // candidate, not yet in a cluster
		S.pLoad[p] = 0; S.pCnt[p] = 0;
		counts[q]++;
	}
	for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) { q = j * nx + i; slot[q] = c; c += counts[q]; }
	for (p = 0; p < S.n; p++) {
		if (S.cl[p] !== -2) continue;
		q = G.nodeOf(M, S, p);
		S.par[p] = p;
		order[slot[q]++] = p;
	}
	S.csOf.fill(-1);
	// each marker meets the candidates in its own bucket and in the four half-neighbor
	// buckets (+x, +y, +x+y, -x+y), which visits every adjacent pair once through the
	// neighbour buckets and twice harmlessly inside the bucket itself
	for (p = 0; p < S.n; p++) {
		if (S.cl[p] !== -2) continue;
		q = G.nodeOf(M, S, p);
		j = (q / nx) | 0; i = q - j * nx;
		var ii, jj, dj, di;
		for (dj = 0; dj <= 1; dj++) for (di = -1; di <= 1; di++) {
			if (dj === 0 && di < 0) continue;
			jj = j + dj;
			if (jj < 1 || jj >= ny) continue;
			ii = i + di; ii -= Math.floor(ii / nx) * nx;
			q2 = jj * nx + ii;
			base = slot[q2] - counts[q2];
			for (k = 0; k < counts[q2]; k++) {
				r = order[base + k];
				if (r === p) continue;
				if (dj === 0 && di === 0 && r < p) continue;    // self bucket: pair once
				pair(M, S, p, r, dt);
			}
		}
	}
	// The damage, applied in one pass *after* the walk: the pair scan is then read-only, its
	// verdict cannot depend on the order the buckets were visited, and every pair sees the
	// same (previous-frame) damage -- the old form added damage in place, so a marker's bond
	// decision partly saw what earlier pairs had just charged it.
	// The rate is per unit of the marker's *mean* excess load, not per pair: damage accrued
	// per pair makes a crowded marker fail about as much faster as it has more partners, and
	// the marker count per node varies by a factor of twenty across a convecting box (a
	// crowded marker measured ~2x the median's damage rate) -- density is a property of the
	// sample, not of the rock. Dividing by the pair count makes the law mesh-independent,
	// which is what lets the sample be re-dealt or capped later without moving the physics.
	for (p = 0; p < S.n; p++) {
		if (S.cl[p] !== -2 || !S.pCnt[p]) continue;
		d = S.dmg[p] + P.kDamage * (S.pLoad[p] / S.pCnt[p]);
		S.dmg[p] = d > 1 ? 1 : d;
	}
	// number the clusters from the union-find roots, then fold the damage into mu so the
	// raster and the projection read strength after failure, not before it
	for (p = 0; p < S.n; p++) {
		if (S.cl[p] !== -2) continue;
		r = find(S, p);
		if (S.csOf[r] < 0) S.csOf[r] = nCl++;
		S.cl[p] = S.csOf[r];
	}
	S.csN = nCl;
	for (p = 0; p < S.n; p++) if (S.dmg[p] > 0) S.mu[p] *= 1 - S.dmg[p];
}

// one candidate pair: the flow's relative velocity across it is the load; damage above the
// pair's own yield, bond if what is left is strong enough. The load is taken from the flow
// (S.vx/vy at this point in the frame), never from the rigid motion that will replace it --
// a fit that erased the load would erase the failure with it. Both senses count: a seam
// stretched and a seam squeezed are both seams being worked (compression without contact is
// interpenetration in this milestone, and letting it pile up silently is worse than letting
// the seam fail and sink).
function pair(M, S, p, r, dt) {
	var dx = S.x[r] - S.x[p];
	dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
	var de = S.e[r] - S.e[p];
	if (dx < 0 ? -dx > 1.3 * M.dx : dx > 1.3 * M.dx) return;
	if (de < 0 ? -de > 1.3 * M.dEta : de > 1.3 * M.dEta) return;
	// the load is the strain rate along the pair, in physical km: |v_rel . r| / |r|^2
	var dy = S.y[r] - S.y[p];
	var d2 = dx * dx + dy * dy;
	if (d2 < 1e-6) return;
	var mu = S.mu[p] * (1 - S.dmg[p]), md = S.mu[r] * (1 - S.dmg[r]);
	if (md < mu) mu = md;
	var load = Math.abs((S.vx[r] - S.vx[p]) * dx + (S.vy[r] - S.vy[p]) * dy) / d2;
	var over = load - P.yieldRate * mu, add;
	S.pCnt[p]++; S.pCnt[r]++;                     // the pair counts even when it is elastic
	if (over > 0) {
		add = over * dt;                          // the integral clusters() divides by pCnt
		S.pLoad[p] += add; S.pLoad[r] += add;
	}
	if (mu < P.clusterMin) return;
	var a = find(S, p), b = find(S, r);
	if (a !== b) S.par[b] = a;
}

function find(S, i) {
	var r = i, p;
	while (S.par[r] !== r) r = S.par[r];
	while (S.par[i] !== r) { p = S.par[i]; S.par[i] = r; i = p; }
	return r;
}

// the rigid fit, then the projection. Three passes over the strong markers: the cluster's
// mass and first moments, its rotation about the centroid, then the move. A cluster's x
// centroid is measured from the first member's x with the periodic delta folded into
// [-wrap/2, wrap/2), so a plate that straddles the wrap seam is one body, not two.
function kinematics(M, S, dt) {
	var wrap = M.wrap, csM = S.csM, csX = S.csX, csY = S.csY;
	var csVX = S.csVX, csVY = S.csVY, csW = S.csW, csR2 = S.csR2, csRef = S.csRef;
	var p, c, m, rx, ry, vRx, vRy, w, dvx, dvy, dy, ym, plates = 0, plV = 0, lid = 0;
	for (c = 0; c < S.csN; c++) { csM[c] = 0; csX[c] = 0; csY[c] = 0; csVX[c] = 0; csVY[c] = 0; csR2[c] = 0; }
	for (p = 0; p < S.n; p++) {
		c = S.cl[p];
		if (c < 0) continue;
		m = S.m[p];
		if (csM[c] === 0) csRef[c] = S.x[p];
		var dx = S.x[p] - csRef[c];
		dx -= Math.floor(dx / wrap + 0.5) * wrap;
		csM[c] += m; csX[c] += m * dx; csY[c] += m * S.y[p];
		csVX[c] += m * S.vx[p]; csVY[c] += m * S.vy[p];
		csR2[c] += 1;                       // member count until the second pass
		lid++;
	}
	for (c = 0; c < S.csN; c++) {
		if (!(csM[c] > 0)) continue;
		csX[c] = csRef[c] + csX[c] / csM[c];
		csY[c] /= csM[c]; csVX[c] /= csM[c]; csVY[c] /= csM[c];
		// the HUD's plates: clusters big enough to be called a plate, and their top speed
		if (csR2[c] >= 64) {
			plates++;
			var sp = csVX[c] * csVX[c] + csVY[c] * csVY[c];
			if (sp > plV) plV = sp;
		}
		csR2[c] = 0;
	}
	for (p = 0; p < S.n; p++) {
		c = S.cl[p];
		if (c < 0) continue;
		rx = S.x[p] - csX[c];
		rx -= Math.floor(rx / wrap + 0.5) * wrap;
		ry = S.y[p] - csY[c];
		m = S.m[p];
		csW[c] += m * (rx * S.vy[p] - ry * S.vx[p]);      // omega numerator
		csR2[c] += m * (rx * rx + ry * ry);
	}
	for (c = 0; c < S.csN; c++) csW[c] = csR2[c] > 1e-9 ? csW[c] / csR2[c] : 0;
	for (p = 0; p < S.n; p++) {
		c = S.cl[p];
		if (c < 0) continue;
		rx = S.x[p] - csX[c];
		rx -= Math.floor(rx / wrap + 0.5) * wrap;
		ry = S.y[p] - csY[c];
		vRx = csVX[c] - csW[c] * ry;
		vRy = csVY[c] + csW[c] * rx;
		w = smoothstep(P.clusterMin, P.clusterMin * 1.4, S.mu[p]);
		dvx = w * (vRx - S.vx[p]); dvy = w * (vRy - S.vy[p]);
		S.vx[p] += dvx; S.vy[p] += dvy;
		dy = dvy * dt;
		ym = S.y[p] + 0.5 * dy;
		S.x[p] += dvx * dt;
		S.y[p] += dy;
		S.e[p] += dy / Math.sqrt(M.yLin * M.yLin + ym * ym);
		G.keepInside(M, S, p);
	}
	S.d.lid = S.n ? lid / S.n : 0;
	S.d.plates = plates;
	S.d.plV = Math.sqrt(plV) * P.cmYr;
}

if (typeof module !== 'undefined' && module.exports) module.exports = SC; else window.PTSC = SC;
