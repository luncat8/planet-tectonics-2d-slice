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

	// G7: the surface elevation profile (plan §4.5, §5, P2.3). The Stokes domain keeps its
	// flat coordinate top eta = 0 -- the separable FFT + Thomas solve needs it -- so the
	// visible horizon is a separate periodic 1D field: zh[i] in km above the reference sea
	// level y = 0, zero horizontal mean, relaxed toward the three-term target of params.js
	// over tauSurf.
	//
	// It is a *relative* field on purpose. The thermal term is taken against each node row's
	// own horizontal mean, which makes the domain's sum zero by construction, and the crust
	// term against the smoothed column thickness, so a broad uniform lid carries no relief at
	// all: only the contrasts -- a plume swell against an old basin, an arc against its
	// back-arc, a rift neck against its shoulders -- become elevation. The rock is moved by
	// the slack in the convection, not by its own weight.
	//
	// Nothing here touches T, m or the markers' positions, so the heat ledger is untouched;
	// the only coupling back into the physics is the ridge push (solid.js kinematics), which
	// reads zh[] as a slope.
	surface: function (M, S, dt) {
		if (!(dt > 0) || !S.n) return;
		var nx = M.nx, dx = M.dx, dEta = M.dEta;
		var Tg = S.Tg, zh = S.zh, zr = S.zRaw, zt = S.zSmooth, u = S.u;
		var hLid = S.hLid, hRaw = S.hRaw, rft = S.rft, colM = S.colM;
		var i, j, p, base, y, m, sum, mean, k, a, im, ip;

		// the column sample, top yCrust km only: welded lid thickness (mass * strength,
		// divided back out by dx: a fully welded column of thickness Y reads Y) and the
		// mass-weighted shallow damage
		for (i = 0; i < nx; i++) { hLid[i] = 0; rft[i] = 0; colM[i] = 0; }
		for (p = 0; p < S.n; p++) {
			y = S.y[p];
			if (y > P.yCrust) continue;
			i = Math.round(S.x[p] / dx);
			i -= Math.floor(i / nx) * nx;
			m = S.m[p];
			hLid[i] += m * S.mu[p];
			rft[i] += m * S.dmg[p];
			colM[i] += m;
		}
		// a column the sample missed takes its neighbour's thickness rather than reading as a
		// hole in the plate: the profile is a smooth horizon, not a marker histogram
		for (i = 0; i < nx; i++) {
			hLid[i] /= dx;
			if (colM[i] > 0) rft[i] /= colM[i];
			else { rft[i] = i > 0 ? rft[i - 1] : 0; hLid[i] = i > 0 ? hLid[i - 1] : 0; }
		}
		// the thickness *anomaly* against its own flexural average: hRaw keeps the raw welded
		// thickness, hLid comes back as the average flexure would give it. That difference is
		// the flexural response itself, so this term is *not* filtered again below -- doing so
		// applied the plate's stiffness twice and cancelled the load (measured: a 14 km band
		// read as a 0.1 km ripple with +-1.3 km side lobes around it)
		hRaw.set(hLid);
		flex(nx, hLid, zt, P.lFlex);
		for (i = 0; i < nx; i++) zr[i] = P.kLid * (hRaw[i] - hLid[i]) - P.kRift * rft[i];

		// thermal isostasy: the column's temperature anomaly against its own rows' means,
		// integrated to the compensation depth
		for (i = 0; i < nx; i++) zt[i] = 0;
		for (j = 1; j <= S.jIso; j++) {
			base = j * nx; sum = 0;
			for (i = 0; i < nx; i++) sum += Tg[base + i];
			sum /= nx;
			k = P.kIso * M.jN[j] * dEta;
			for (i = 0; i < nx; i++) zt[i] += k * (Tg[base + i] - sum);
		}
		// dynamic: the shallowest cell row's horizontal convergence, times the compensation
		// depth -- the vertical flow that convergence implies at yIso, by incompressibility
		k = P.kDyn * P.yIso / (2 * dx);
		for (i = 0; i < nx; i++) {
			im = i === 0 ? nx - 1 : i - 1;
			ip = i + 1 === nx ? 0 : i + 1;
			zt[i] += k * (u[ip] - u[im]);
		}
		// one flexural filter over the thermal and dynamic part, which is the field that needs
		// it. hRaw is spent by now, so it serves as the scratch and hLid keeps the smoothed
		// thickness for the diagnostics
		flex(nx, zt, hRaw, P.lFlex);
		for (i = 0; i < nx; i++) zr[i] += zt[i];

		a = 1 - Math.exp(-dt / P.tauSurf);
		for (i = 0; i < nx; i++) zh[i] += a * (zr[i] - zh[i]);
		// the zero mean, exactly: the filter and the relaxation both preserve it, but the
		// target is re-derived from a marker field every frame and its own mean is only zero
		// to round-off, so that residue would random-walk the sea level
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

// The flexural filter of the surface profile (plan §4.5): `passes` of the periodic [1,2,1]/4
// stencil, in place, with the caller's scratch. It is the cheap stand-in for a 1D flexure
// solve and it is conservative -- the sum over the ring is exactly the sum that went in --
// which is what keeps the profile's zero mean from needing a second correction.
//
// The result is in `a`; `tmp` is scratch and its contents afterwards are not defined. That
// matters at the one call that needs the *input* as well: the crust term subtracts the raw
// welded thickness from this average, so the kernel copies the raw field out first. An earlier
// version read the scratch, which the last pass leaves equal to `a` -- the anomaly was exactly
// zero and every welded plateau read flat, which is what pt-surface's band check catches.
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
