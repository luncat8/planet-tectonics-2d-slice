// pt/fluid.js — 0.3.0 P1: the fluid kernels of the frame pipeline (plan §5, G1..G3 and G8).
// Each one no-ops at zero population; the clock is the caller's business (sim.js).
//
// The order inside one frame is the plan's: the markers make the grid, the grid makes the
// flow, conduction happens on the grid, the increment goes back to the markers, and then
// the markers are carried by the flow. Nothing is projected: the flow is exactly
// divergence-free by construction (grid.js), so the marker field is not squeezed by a
// residual it would have to absorb.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;

var F = {
	// markers -> node temperature (G1). Repair runs while M.w still describes these exact
	// marker positions. Running it after advection used a previous field's holes to move the
	// next field's markers, which is how one marginal node became a visible map-wide jump.
	transfer: function (M, S) {
		if (!S.n) return;
		S.moved = 0;
		G.scatterT(M, S, S.Tg, S.mug);
		if (S.empty) G.reseed(M, S, false);
	},

	// buoyancy and the Stokes solve (G2): the velocity field the whole frame rides on
	flow: function (M, S, RaK) {
		G.stokes(M, S.Tg, S.u, S.v, RaK);
	},

	// conduction on the grid, the increment back to the markers, then marker motion (G3).
	// Coverage repair belongs to transfer, before this pass: after advection M.w is a stale
	// description of where the markers used to be. The velocity is gathered from the psi map
	// and the markers ride it; the solid pass (G4, solid.js) runs after this kernel and
	// projects the strong markers onto their plates' rigid motion.
	move: function (M, S, dt, kappa, flip) {
		if (!(dt > 0)) return;
		G.diffuse(M, S.Tg, dt, kappa, M.inc);
		G.gatherDT(M, S, M.inc, S.Tg, flip);
		G.gatherVel(M, S, M.pr);
		G.advect(M, S, dt);
		this.melt(M, S, dt);
	},

	// P1 has one conserved thermal mantle phase, so this is an indicator rather than a second
	// material ledger. Hot rising mantle creates it in the decompression window; it segregates
	// upward and is removed at the shallow extraction cap instead of painting the surface wall.
	// P3 replaces this diagnostic with conserved melt particles and conduits.
	melt: function (M, S, dt) {
		if (!P.meltProxy || !(dt > 0)) return;
		var nx = M.nx, ny = M.ny, T = S.Tg, u = S.u, v = S.v, mg = S.Mg, out = S.MgS, row = S.rowT;
		var i, j, q, base, y, decomp, sum, ux, vy, m, hot, up;
		for (j = 1; j < ny; j++) {
			base = j * nx; sum = 0;
			for (i = 0; i < nx; i++) sum += T[base + i];
			row[j] = sum / nx;
		}
		for (j = 1; j < ny; j++) {
			base = j * nx; y = M.yN[j];
			decomp = (P.meltDepth - y) / (P.meltDepth - P.meltTop);
			if (decomp < 0) decomp = 0; else if (decomp > 1) decomp = 1;
			for (i = 0; i < nx; i++) {
				q = base + i;
				if (y <= P.meltTop) { out[q] = 0; continue; }
				ux = 0.5 * (u[(j - 1) * nx + i] + u[base + i]);
				vy = v[q] - P.meltRise;
				m = meltSample(M, mg, i * M.dx - ux * dt, j * M.dEta - vy * dt / M.jN[j]);
				hot = (T[q] - row[j] - P.meltExcess) / P.meltRange;
				up = -v[q] / P.meltUpRef;
				if (hot < 0) hot = 0; else if (hot > 1) hot = 1;
				if (up < 0) up = 0; else if (up > 1) up = 1;
				m += dt * (P.meltBuild * decomp * hot * up - m / P.meltDecay);
				out[q] = m < 0 ? 0 : (m > 1 ? 1 : m);
			}
		}
		for (i = 0; i < nx; i++) { out[i] = 0; out[ny * nx + i] = 0; }
		mg.set(out);
	},

	// G7: a separate periodic horizon keeps the separable Stokes domain's coordinate top flat.
	// Its filtered target combines thermal buoyancy, shallow dynamic stress, the welded-lid
	// and rift proxies, and uplift where distinct plate clusters converge. A conservative,
	// slope-dependent hillslope flux rounds the resulting profile without changing its mean.
	// This surface model never changes marker positions, temperature or mass; ridge push is
	// the only mechanical feedback, read by solid.js on the next frame.
	surface: function (M, S, dt) {
		if (!(dt > 0) || !S.n) return;
		var nx = M.nx, dx = M.dx, dEta = M.dEta;
		var Tg = S.Tg, zh = S.zh, zr = S.zRaw, zt = S.zSmooth, u = S.u;
		var hLid = S.hLid, hRaw = S.hRaw, rft = S.rft, colM = S.colM;
		var i, j, p, base, y, x, fx, w0, w1, m, sum, mean, k, a, im, ip;
		var sY = S.surfaceY, sV = S.surfaceV, sCl = S.surfaceCl;
		var slope, ratio, dL, dR, dtDx2;

		for (i = 0; i < nx; i++) {
			hLid[i] = 0; rft[i] = 0; colM[i] = 0; zr[i] = 0;
			sY[i] = 1e9; sV[i] = 0; sCl[i] = -1;
		}
		// Conservative linear splatting avoids the one-column histogram that made the crust
		// term grow narrow ridges out of marker sampling noise. The shallowest strong marker
		// also identifies each column's surface plate for the collision pass.
		for (p = 0; p < S.n; p++) {
			y = S.y[p];
			if (y > P.yCrust) continue;
			x = S.x[p] / dx;
			i = Math.floor(x); fx = x - i;
			i -= Math.floor(i / nx) * nx;
			ip = i + 1 === nx ? 0 : i + 1;
			w0 = 1 - fx; w1 = fx; m = S.m[p];
			hLid[i] += m * S.mu[p] * w0; hLid[ip] += m * S.mu[p] * w1;
			rft[i] += m * S.dmg[p] * w0; rft[ip] += m * S.dmg[p] * w1;
			colM[i] += m * w0; colM[ip] += m * w1;
			if (y > P.yOrogen || S.cl[p] < 0 || S.mu[p] < P.clusterMin) continue;
			i = Math.round(x);
			i -= Math.floor(i / nx) * nx;
			if (y >= sY[i]) continue;
			sY[i] = y; sV[i] = S.vx[p]; sCl[i] = S.cl[p];
		}
		for (i = 0; i < nx; i++) {
			hLid[i] /= dx;
			if (colM[i] > 0) rft[i] /= colM[i];
		}

		// Shortening between distinct, strong surface clusters adds a broad orogenic load.
		// The source is shared across the boundary's two columns and capped before filtering.
		for (i = 0; i < nx; i++) {
			ip = i + 1 === nx ? 0 : i + 1;
			if (sCl[i] < 0 || sCl[ip] < 0 || sCl[i] === sCl[ip]) continue;
			k = (sV[i] - sV[ip]) / dx - P.collisionYield;
			if (k <= 0) continue;
			k *= P.kOrogen;
			if (k > P.zOrogenMax) k = P.zOrogenMax;
			zr[i] += 0.5 * k; zr[ip] += 0.5 * k;
		}
		flex(nx, zr, hRaw, P.lFlex);
		flex(nx, hLid, hRaw, P.lFlex);
		flex(nx, rft, hRaw, P.lFlex);
		for (i = 0; i < nx; i++) zr[i] += P.kLid * hLid[i] - P.kRift * rft[i];

		// Thermal isostasy against each upper node row's horizontal mean.
		for (i = 0; i < nx; i++) zt[i] = 0;
		for (j = 1; j <= S.jIso; j++) {
			base = j * nx; sum = 0;
			for (i = 0; i < nx; i++) sum += Tg[base + i];
			sum /= nx;
			k = P.kIso * M.jN[j] * dEta;
			for (i = 0; i < nx; i++) zt[i] += k * (Tg[base + i] - sum);
		}
		// Dynamic stress from the shallow horizontal convergence, scaled by yIso.
		k = P.kDyn * P.yIso / (2 * dx);
		for (i = 0; i < nx; i++) {
			im = i === 0 ? nx - 1 : i - 1;
			ip = i + 1 === nx ? 0 : i + 1;
			zt[i] += k * (u[ip] - u[im]);
		}
		flex(nx, zt, hRaw, P.lFlex);
		for (i = 0; i < nx; i++) zr[i] += zt[i];

		a = 1 - Math.exp(-dt / P.tauSurf);
		for (i = 0; i < nx; i++) zh[i] += a * (zr[i] - zh[i]);

		// A conservative nonlinear diffusion redistributes profile elevation downhill. It is
		// a topographic proxy only: no marker mass moves and no sediment is created here.
		// The capped slope multiplier rounds sharp crests faster than broad, low-gradient swells.
		dtDx2 = dt / (dx * dx);
		for (i = 0; i < nx; i++) {
			im = i === 0 ? nx - 1 : i - 1;
			ip = i + 1 === nx ? 0 : i + 1;
			slope = (zh[i] - zh[im]) / dx;
			ratio = Math.abs(slope) / P.slopeProfileDiff;
			if (ratio > 2) ratio = 2;
			dL = P.kProfileDiff * (1 + ratio * ratio);
			slope = (zh[ip] - zh[i]) / dx;
			ratio = Math.abs(slope) / P.slopeProfileDiff;
			if (ratio > 2) ratio = 2;
			dR = P.kProfileDiff * (1 + ratio * ratio);
			zt[i] = zh[i] + dtDx2 * (dR * (zh[ip] - zh[i]) - dL * (zh[i] - zh[im]));
		}
		for (i = 0; i < nx; i++) zh[i] = zt[i];

		// The zero mean is the sea-level datum; periodic profile diffusion conserves it apart
		// from roundoff. This is not a particle-mass or sediment ledger.
		mean = 0;
		for (i = 0; i < nx; i++) mean += zh[i];
		mean /= nx;
		for (i = 0; i < nx; i++) zh[i] -= mean;
	},

	// The wall heat flux is needed after every fluid substep, while the full diagnostic is
	// intentionally only sampled once per rendered frame. Keeping this short pass separate
	// makes a 500 kyr display step conserve the same wall book as ten 50 kyr steps.
	wall: function (M, S) {
		var nx = M.nx, ny = M.ny, i, T = S.Tg, d = S.d, top = 0, bot = 0;
		// The boundary gradients are one-sided across the *cell* next to the wall, on the cell
		// midpoint metric jC -- the same coefficient the conduction operator's row balance
		// uses (grid.js, the col[j-1]/jC[j-1] ladder). Reading the wall node's own metric
		// jN[ny] makes the bottom distance 2.6% too long and creates a phantom wall flux.
		for (i = 0; i < nx; i++) {
			top += (T[nx + i] - T[i]) / (M.dEta * M.jC[0]);
			bot += (T[ny * nx + i] - T[(ny - 1) * nx + i]) / (M.dEta * M.jC[ny - 1]);
		}
		d.fluxTop = top / nx * M.depth;
		d.fluxBot = bot / nx * M.depth;
		d.wallRate = (d.fluxBot - d.fluxTop) * P.kappa * M.wrap / M.depth;
	},

	// G8: the numbers the HUD prints and the fixtures gate on. Cheap enough to run every
	// rendered frame (two passes over the markers), and averaged over the HUD's 2 Hz pulse so
	// the reported extremes are not a single frame's noise.
	diag: function (M, S) {
		var nx = M.nx, ny = M.ny, i, j, T = S.Tg, u = S.u, v = S.v, d = S.d;
		this.wall(M, S);
		var um = 0, vm = 0, wells = 0, prev = 0, first = 0, col;
		for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
			var a = Math.abs(u[j * nx + i]);
			if (a > um) um = a;
		}
		for (j = 0; j <= ny; j++) for (i = 0; i < nx; i++) {
			var b = Math.abs(v[j * nx + i]);
			if (b > vm) vm = b;
		}
		// upwellings: sign changes of the depth-averaged vertical velocity (plan §2.2)
		first = 0;
		for (i = 0; i < nx; i++) {
			col = 0;
			for (j = 0; j <= ny; j++) col += v[j * nx + i];
			var cur = col > 0;
			if (!first) { prev = cur; first = 1; continue; }
			if (cur !== prev) { wells++; prev = cur; }
		}
		d.nu = d.fluxTop;
		d.uMax = um * P.cmYr;              // km/Myr -> cm/yr
		d.vMax = vm * P.cmYr;
		d.wells = wells >> 1;
		// d.heat is the field's heat in the mesh measure -- the integral the conduction
		// operator conserves exactly. d.mHeat is the same heat carried on the markers: the
		// two differ by the transfer's quadrature error, and the fixture watches the gap.
		var heat = 0;
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) heat += M.dEta * M.jN[j] * M.dx * T[j * nx + i];
		var mheat = 0, tmin = 9e9, tmax = -9e9, p, tp;
		for (p = 0; p < S.n; p++) {
			tp = S.T[p];
			mheat += S.m[p] * tp;
			if (tp < tmin) tmin = tp;
			if (tp > tmax) tmax = tp;
		}
		d.heat = heat; d.mHeat = mheat;
		d.tMin = tmin; d.tMax = tmax;
		var melt = 0, meltY = 0, meltMax = 0, mq;
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) {
			mq = S.Mg[j * nx + i];
			melt += mq; meltY += mq * M.yN[j];
			if (mq > meltMax) meltMax = mq;
		}
		d.melt = meltMax; d.meltY = melt ? meltY / melt : 0;
		// the surface profile's own extremes, for the panel (P2.3)
		var zlo = 9e9, zhi = -9e9, zv;
		for (i = 0; i < nx; i++) {
			zv = S.zh[i];
			if (zv < zlo) zlo = zv;
			if (zv > zhi) zhi = zv;
		}
		d.zMin = zlo; d.zMax = zhi;
	},

	// The ledger is accumulated where the heat changes hands, in gatherDT: it is the marker
	// field's own book, and the marker heat closes against it to round-off *by construction*.
	// That is the point -- it is the number the HUD can be trusted to print. The walls' flux
	// is the same heat read from the operator's side ((fluxBot - fluxTop) * kappa * wrap /
	// depth, accumulated in sim.js as S.wall) and the two agree only up to how well the
	// markers sample the conduction intake; that gap is the physics error, and it is what
	// pt-check gates.
};

// The periodic [1,2,1]/4 flexural filter is a conservative low-pass on each surface source.
// The result is in `a`; `tmp` is scratch and its contents afterwards are not defined.
function flex(nx, a, tmp, passes) {
	var i, s, im, ip;
	for (s = 0; s < passes; s++) {
		for (i = 0; i < nx; i++) {
			im = i === 0 ? nx - 1 : i - 1;
			ip = i + 1 === nx ? 0 : i + 1;
			tmp[i] = 0.25 * a[im] + 0.5 * a[i] + 0.25 * a[ip];
		}
		a.set(tmp);
	}
}

// Bilinear sample of the node-centred melt indicator. The scalar is extracted at both walls,
// so a backtrace outside the mantle is zero rather than a reflected parcel.
function meltSample(M, a, x, e) {
	var nx = M.nx, ny = M.ny, i0, i1, j0, j1, fx, fy, base, a0, a1;
	if (e <= 0 || e >= M.etaBot) return 0;
	i0 = Math.floor(x / M.dx); fx = x / M.dx - i0;
	i0 -= Math.floor(i0 / nx) * nx;
	i1 = i0 + 1 === nx ? 0 : i0 + 1;
	j0 = Math.floor(e / M.dEta); fy = e / M.dEta - j0;
	if (j0 < 0 || j0 >= ny) return 0;
	j1 = j0 + 1; base = j0 * nx;
	a0 = a[base + i0] + (a[base + i1] - a[base + i0]) * fx;
	a1 = a[base + nx + i0] + (a[base + nx + i1] - a[base + nx + i0]) * fx;
	return a0 + (a1 - a0) * fy;
}

if (typeof module !== 'undefined' && module.exports) module.exports = F; else window.PTF = F;
