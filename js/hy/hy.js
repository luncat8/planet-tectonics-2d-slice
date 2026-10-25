// hy/hy.js — 0.5.0 M2: the hybrid engine's liquid (0.5.0-plan.md §4, milestone M2).
//
// The hybrid owns its liquid in *cells* and its solid in *parcels*. M2 builds the liquid
// half (plan kernels H1-H3 with the parcel population still zero): the 0.3 (x, eta) asinh
// mesh at 256 x 24 with nx no longer required to be a power of two (there is no transform
// to size), the conserved fields (H, cF, cW) with their equilibrium readings (T, melt), a
// staggered velocity relaxed toward the Stokes balance and projected by red-black
// Gauss-Seidel, donor-cell (or MacCormack) conservative transport, finite-volume
// conduction against the two Dirichlet walls, and the heat ledger those walls feed. There
// is no crust skin yet: `features` declares flow and the thermal lid only, so S1 can go
// green and S2-S4 still read pending. M3 adds the parcels' half.
//
// The flow solve is the plan's §4.3 deal made literal. Infinite-Prandtl, so velocity is a
// *diagnostic*: each frame spends the projIters sweep budget half on a red-black viscous
// predictor (lap u = mob F, F the row-mean-removed buoyancy -RaK (T - rowMean)) and half
// on the projection Poisson solve (the same Laplacian the D/G pair composes to, metric
// factors in the form 0.3's grid.js verified), then u -= grad p. The pressure never
// feeds back into the predictor: for constant mobility the Laplacian and the projection
// commute, so the pair's fixed point is the Stokes velocity itself, while a steady
// predictor with grad p inside it is a structurally unstable iteration (the correction
// potential and the momentum pressure do not even share units). Neither solve is
// converged in a frame; both fields are warm-started from the last frame, which is what
// makes twenty sweeps enough -- the temperature they track moves far slower than they
// do. The residual divergence is a printed budget, not a hidden one.
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('../pc/params.js') : root.PCP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('../pc/phase.js') : root.PCPHASE;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('../pc/pool.js') : root.PCPOOL;
	var PCOPT = (typeof module !== 'undefined' && module.exports) ? require('../pc/opt.js') : root.PCOPT;

	var HY = {
		id: 'hy',
		name: 'hybrid',
		complete: false,                  // the crust half is M3, and the harness reads this
		features: { flow: 1, lid: 1 },    // liquid convection + the thermal (mobility) lid
		defaults: { nx: 256, ny: 24, cap: 4096, stretch: 2.5 },

		FIELDS: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
			'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph'],
		poolCfg: {
			carry: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
				'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph'],
			share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt'],
			bond: ['age', 'mu', 'dmg', 'pLoad', 'pCnt'],
			all: ['depQ']
		},

		M: null, S: null, pool: null, opts: null,
		seed: 1, camera: 'mantle', tool: null,

		init: function () {
			if (this.pool) return this;
			this.pool = POOL.make(this.poolCfg);
			this.opts = PCOPT.make('hy', function (id, v) {
				if (id === 'clock') PCP.sl.kyr = v;
			});
			return this;
		},

		// The mesh and its fields. Cells are the mantle, surface to CMB. The rows are
		// tanh-clustered at *both* walls (~8 km cells against each boundary layer,
		// ~300 km mid-mantle at ny 24), not 0.3's one-sided asinh rows: measured on
		// the asinh mesh, the 570 km bottom cell is a thermal resistor that passes
		// 1.4% of the surface heat flux, so the planet free-cools instead of
		// convecting on CMB input (0.3 survives the same rows only because its
		// markers resolve sub-cell against the wall; a cell average cannot). The
		// asinh mapping remains the *view* (the draw resamples by depth, and the
		// shared ruler still means what it means on the other pages); it is the
		// solver's row placement that changed. Every operator coefficient below is
		// built from actual y differences, so the stretching is mesh data and no
		// kernel knows the tanh formula. Velocity is staggered MAC-style:
		//   u[j][i]  at (i dx, yC[j])       the left face of cell (i, j)
		//   v[j][i]  at ((i+0.5) dx, yN[j]) the top face of cell (i, j); v = 0 at the walls
		mesh: function (nx, ny) {
			var etaBot = Math.asinh(PCP.depth / PCP.yLin);
			var n = nx * ny, nv = nx * (ny + 1), i, j, k, dx = PCP.wrap / nx;
			var beta = this.defaults.stretch, tanB = Math.tanh(beta), s;
			var M = this.M = {
				nx: nx, ny: ny, n: n, dx: dx, etaBot: etaBot,
				wrap: PCP.wrap, depth: PCP.depth, yLin: PCP.yLin,
				yN: new Float64Array(ny + 1), yC: new Float64Array(ny),
				hC: new Float64Array(ny), distN: new Float64Array(ny + 1),
				ceU: new Float64Array(ny), ceD: new Float64Array(ny), diagC: new Float64Array(ny),
				veU: new Float64Array(ny + 1), veD: new Float64Array(ny + 1),
				diagV: new Float64Array(ny + 1),
				H: new Float64Array(n), T: new Float64Array(n), melt: new Float64Array(n),
				cF: new Float64Array(n), cW: new Float64Array(n),
				m: new Float64Array(n), y: new Float64Array(n), eta: new Float64Array(n),
				load: new Float64Array(n), cx: new Float64Array(nx),
				u: new Float64Array(n), v: new Float64Array(nv),
				p: new Float64Array(n), rhs: new Float64Array(n),
				srcV: new Float64Array(nv),
				fx: new Float64Array(n), fy: new Float64Array(nv),
				dQ: new Float64Array(n), q1: new Float64Array(n), q2: new Float64Array(n),
				rowMean: new Float64Array(ny),
				time: 0, frame: 0, wallTop: 0, wallBot: 0, clamp: 0, stock0: 0, totalMass: 0,
				d: { peakV: 0, peakU: 0, wells: 0, nu: 0, div: 0, k: 1,
					lidMob: 0, intMob: 0, tMin: 0, tMax: 0 }
			};
			var cxx = 1 / (dx * dx), condMax = 0, cs, hv;
			M.cxx = cxx;
			for (j = 0; j <= ny; j++) {
				s = j / ny;
				M.yN[j] = PCP.depth * 0.5 * (1 + Math.tanh(beta * (2 * s - 1)) / tanB);
			}
			for (j = 0; j < ny; j++) {
				M.hC[j] = M.yN[j + 1] - M.yN[j];
				M.yC[j] = 0.5 * (M.yN[j] + M.yN[j + 1]);
			}
			for (j = 1; j < ny; j++) M.distN[j] = M.yC[j] - M.yC[j - 1];
			for (j = 0; j < ny; j++) {
				M.ceU[j] = j > 0 ? 1 / (M.hC[j] * M.distN[j]) : 0;
				M.ceD[j] = j < ny - 1 ? 1 / (M.hC[j] * M.distN[j + 1]) : 0;
				M.diagC[j] = 2 * cxx + M.ceU[j] + M.ceD[j];
				// the explicit conduction operator's worst row sum, walls included:
				// the substep rule's thermal half
				cs = M.diagC[j];
				if (j === 0) cs += 1 / (M.yC[0] * M.hC[0]);
				if (j === ny - 1) cs += 1 / ((PCP.depth - M.yC[j]) * M.hC[j]);
				if (cs > condMax) condMax = cs;
			}
			M.condMax = PCP.kappa * condMax;
			for (j = 1; j < ny; j++) {
				hv = 0.5 * (M.hC[j - 1] + M.hC[j]);
				M.veU[j] = 1 / (hv * M.hC[j - 1]);
				M.veD[j] = 1 / (hv * M.hC[j]);
				M.diagV[j] = 2 * cxx + M.veU[j] + M.veD[j];
			}
			for (i = 0; i < nx; i++) M.cx[i] = (i + 0.5) * dx;
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				M.eta[k] = Math.asinh(M.yC[j] / PCP.yLin);
				M.y[k] = M.yC[j];
				M.load[k] = M.yC[j];      // no parcels yet: the load column is hydrostatic
				M.m[k] = dx * M.hC[j];
				M.totalMass += M.m[k];
			}
			// the view's row lookup: raster rows at uniform asinh spacing, each
			// reading the mesh cell that contains its depth
			M.drawRows = 48;
			M.drawRow = new Int32Array(M.drawRows);
			for (j = 0; j < M.drawRows; j++) {
				s = PCP.yLin * Math.sinh((j + 0.5) * etaBot / M.drawRows);
				k = 0;
				while (k < ny - 1 && M.yN[k + 1] < s) k++;
				M.drawRow[j] = k;
			}
			return M;
		},

		reset: function (seed) {
			this.init();
			this.seed = seed === undefined ? this.seed : seed;
			// the phase law reads its pressure source off the shared PCP word, so the
			// engine's own option has to be written there before anything equilibrates
			PCP.solidusOf = this.opts.get('solidusOf');
			var nx = this.defaults.nx, ny = this.defaults.ny;
			var M = this.mesh(nx, ny), wave = new Float64Array(nx);
			var i, j, k, T, f;
			PCP.icDraw(this.seed);
			for (i = 0; i < nx; i++) wave[i] = PCP.icWave(M.cx[i]);
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				f = M.yC[j] / PCP.depth;
				T = 1 - Math.exp(-M.yC[j] / PCP.skin) +
					PCP.icAmp * Math.sin(Math.PI * f) * wave[i];
				T = T < 0 ? 0 : (T > 1 ? 1 : T);
				PHASE.byT(T, M.yC[j], 0, 0, M.load[k]);
				M.T[k] = PHASE.out.t; M.H[k] = PHASE.out.h; M.melt[k] = PHASE.out.melt;
				M.cF[k] = 0; M.cW[k] = 0;
				M.stock0 += M.m[k] * M.H[k];
			}
			// the parcel pool exists and is empty: the skin is M3's, and an empty pool is
			// a reading the harness can hold the liquid to
			this.S = { cap: this.defaults.cap, n: 0, wrap: PCP.wrap };
			this.pool.attach(this.S);
			this.diag();
			return this;
		},

		clock: function () { return this.opts.get('clock'); },

		// H4's equilibrium half, on cells: T and melt are readings of H through the
		// phase law at the cell's own load, never independent state.
		equil: function () {
			var M = this.M, H = M.H, T = M.T, ml = M.melt, cF = M.cF, cW = M.cW;
			var y = M.y, load = M.load, k;
			for (k = 0; k < M.n; k++) {
				PHASE.byH(H[k], y[k], cF[k], cW[k], load[k]);
				T[k] = PHASE.out.t; ml[k] = PHASE.out.melt;
			}
		},

		// H2: the viscous predictor, then the projection. The predictor's only
		// source is the buoyancy on the v faces (the anomaly against the row mean;
		// the mean itself is hydrostatic and belongs to p, exactly as in 0.3's
		// dT/dx forcing), weighted by the face mobility mob(T). The u predictor has
		// no source at all: its sweeps are the viscous dissipation of whatever
		// horizontal flow the projection created last frame.
		flow: function () {
			var M = this.M, nx = M.nx, ny = M.ny, dx = M.dx;
			var T = M.T, u = M.u, v = M.v, p = M.p, rhs = M.rhs;
			var srcV = M.srcV, b = this.opts.get('mobContrast');
			var iters = this.opts.get('projIters') | 0, visc = iters >> 1, proj = iters - visc;
			var i, j, k, base, im, ip, s, mean;
			if (visc < 1) visc = 1;
			for (j = 0; j < ny; j++) {
				base = j * nx; mean = 0;
				for (i = 0; i < nx; i++) mean += T[base + i];
				M.rowMean[j] = mean / nx;
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					s = 0.5 * (T[base - nx + i] + T[base + i]);
					srcV[base + i] = Math.exp(b * (s - 0.5)) * -PCP.RaK *
						(s - 0.5 * (M.rowMean[j - 1] + M.rowMean[j]));
				}
			}
			for (s = 0; s < visc; s++) { this.sweepU(); this.sweepV(); }
			// the projection's right-hand side is the predictor's divergence; p is
			// the total potential, warm-started, its null constant pinned each frame
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					ip = i + 1 < nx ? i + 1 : 0;
					rhs[base + i] = (u[base + ip] - u[base + i]) / dx +
						(v[base + nx + i] - v[base + i]) / M.hC[j];
				}
			}
			for (s = 0; s < proj; s++) this.sweepP();
			mean = 0;
			for (k = 0; k < M.n; k++) mean += p[k];
			mean /= M.n;
			for (k = 0; k < M.n; k++) p[k] -= mean;
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					im = i > 0 ? i - 1 : nx - 1;
					u[base + i] -= (p[base + i] - p[base + im]) / dx;
				}
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					v[base + i] -= (p[base + i] - p[base - nx + i]) / M.distN[j];
				}
			}
			// diagnostics the HUD and the sampler share: peaks and the divergence the
			// unconverged projection left behind, as a fraction of the peak strain
			var d = M.d, pv = 0, pu = 0, dv = 0, a;
			for (k = 0; k < M.n; k++) { a = Math.abs(u[k]); if (a > pu) pu = a; }
			for (k = 0; k < v.length; k++) { a = Math.abs(v[k]); if (a > pv) pv = a; }
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					ip = i + 1 < nx ? i + 1 : 0;
					a = Math.abs((u[base + ip] - u[base + i]) / dx +
						(v[base + nx + i] - v[base + i]) / M.hC[j]);
					if (a > dv) dv = a;
				}
			}
			d.peakU = pu; d.peakV = pv;
			d.div = pv > 0 ? dv * dx / pv : 0;
		},

		// one red-black Gauss-Seidel sweep of L w = 0 on the u rows (free-slip at
		// both walls: the missing neighbour's flux is zero, which is what ceU/ceD
		// being 0 on the boundary rows already says)
		sweepU: function () {
			var M = this.M, nx = M.nx, ny = M.ny, cxx = M.cxx, w = M.u;
			var i, j, k, base, im, ip, col, sum;
			for (col = 0; col < 2; col++) for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = (col + j) & 1; i < nx; i += 2) {
					k = base + i;
					im = i > 0 ? i - 1 : nx - 1;
					ip = i + 1 < nx ? i + 1 : 0;
					sum = cxx * (w[base + im] + w[base + ip]);
					if (j > 0) sum += M.ceU[j] * w[k - nx];
					if (j < ny - 1) sum += M.ceD[j] * w[k + nx];
					w[k] = sum / M.diagC[j];
				}
			}
		},

		sweepV: function () {
			var M = this.M, nx = M.nx, ny = M.ny, cxx = M.cxx, w = M.v, src = M.srcV;
			var i, j, k, base, im, ip, col;
			for (col = 0; col < 2; col++) for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = (col + j) & 1; i < nx; i += 2) {
					k = base + i;
					im = i > 0 ? i - 1 : nx - 1;
					ip = i + 1 < nx ? i + 1 : 0;
					w[k] = (cxx * (w[base + im] + w[base + ip]) +
						M.veU[j] * w[k - nx] + M.veD[j] * w[k + nx] + src[k]) / M.diagV[j];
				}
			}
		},

		// one sweep of L p = rhs on the cells: the same operator the D/G pair
		// composes to, so a converged potential makes D u zero by construction
		sweepP: function () {
			var M = this.M, nx = M.nx, ny = M.ny, cxx = M.cxx, w = M.p, rhs = M.rhs;
			var i, j, k, base, im, ip, col, sum;
			for (col = 0; col < 2; col++) for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = (col + j) & 1; i < nx; i += 2) {
					k = base + i;
					im = i > 0 ? i - 1 : nx - 1;
					ip = i + 1 < nx ? i + 1 : 0;
					sum = cxx * (w[base + im] + w[base + ip]);
					if (j > 0) sum += M.ceU[j] * w[k - nx];
					if (j < ny - 1) sum += M.ceD[j] * w[k + nx];
					w[k] = (sum - rhs[k]) / M.diagC[j];
				}
			}
		},

		// donor-cell advection of one specific field into `out`, flux form: every face
		// moves one amount, subtracted from its donor and added to its receiver as the
		// same number, so the field's extensive total is conserved to roundoff whatever
		// the (unconverged) divergence is. `sign` reverses the fluxes, for MacCormack.
		advectTo: function (q, sign, out) {
			var M = this.M, nx = M.nx, ny = M.ny, fx = M.fx, fy = M.fy, dQ = M.dQ, m = M.m;
			var i, j, k, base, im, f, amt;
			dQ.fill(0);
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					im = i > 0 ? i - 1 : nx - 1;
					f = sign * fx[base + i];
					amt = f * (f > 0 ? q[base + im] : q[base + i]);
					dQ[base + im] -= amt; dQ[base + i] += amt;
				}
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					f = sign * fy[base + i];
					amt = f * (f > 0 ? q[base - nx + i] : q[base + i]);
					dQ[base - nx + i] -= amt; dQ[base + i] += amt;
				}
			}
			for (k = 0; k < M.n; k++) out[k] = q[k] + dQ[k] / m[k];
		},

		advectField: function (q, isHeat) {
			var M = this.M, nx = M.nx, ny = M.ny, k, i, j, base, im, ip, lo, hi, val, cl;
			if (this.opts.get('advect') !== 'maccormack') { this.advectTo(q, 1, q); return; }
			this.advectTo(q, 1, M.q1);
			this.advectTo(M.q1, -1, M.q2);
			// the corrector half of the forward/backward error, clamped to the donor
			// stencil's own range so the sharpness cannot invent a new extreme. The
			// corrector itself conserves; the clamp does not, so what it removes from
			// the enthalpy field is booked on its own ledger line (M.clamp) instead
			// of vanishing -- MacCormack's heat book closes only with that line in it,
			// which is exactly the price the donor default does not pay.
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					k = base + i;
					im = i > 0 ? i - 1 : nx - 1;
					ip = i + 1 < nx ? i + 1 : 0;
					lo = hi = q[k];
					if (q[base + im] < lo) lo = q[base + im];
					if (q[base + im] > hi) hi = q[base + im];
					if (q[base + ip] < lo) lo = q[base + ip];
					if (q[base + ip] > hi) hi = q[base + ip];
					if (j > 0) { if (q[k - nx] < lo) lo = q[k - nx]; if (q[k - nx] > hi) hi = q[k - nx]; }
					if (j < ny - 1) { if (q[k + nx] < lo) lo = q[k + nx]; if (q[k + nx] > hi) hi = q[k + nx]; }
					val = M.q1[k] + 0.5 * (q[k] - M.q2[k]);
					cl = val < lo ? lo : (val > hi ? hi : val);
					if (isHeat && cl !== val) M.clamp += M.m[k] * (cl - val);
					q[k] = cl;
				}
			}
		},

		// conduction into H, face by face like the advection, with the two walls as
		// Dirichlet faces whose every increment is booked: wallTop is heat that left
		// upward, wallBot heat that entered from the CMB, both cumulative and
		// positive. The stock change minus (wallBot - wallTop) is the ledger residual.
		conduct: function (dtS) {
			var M = this.M, nx = M.nx, ny = M.ny, T = M.T, dQ = M.dQ, m = M.m;
			var i, j, k, base, im, amt, g = PCP.kappa * dtS;
			dQ.fill(0);
			for (j = 0; j < ny; j++) {
				base = j * nx;
				amt = g * M.hC[j] / M.dx;
				for (i = 0; i < nx; i++) {
					im = i > 0 ? i - 1 : nx - 1;
					k = amt * (T[base + im] - T[base + i]);
					dQ[base + im] -= k; dQ[base + i] += k;
				}
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				amt = g * M.dx / M.distN[j];
				for (i = 0; i < nx; i++) {
					k = amt * (T[base - nx + i] - T[base + i]);
					dQ[base - nx + i] -= k; dQ[base + i] += k;
				}
			}
			amt = g * M.dx / M.yC[0];
			for (i = 0; i < nx; i++) {
				k = amt * T[i];
				dQ[i] -= k; M.wallTop += k;
			}
			base = (ny - 1) * nx;
			amt = g * M.dx / (PCP.depth - M.yC[ny - 1]);
			for (i = 0; i < nx; i++) {
				k = amt * (1 - T[base + i]);
				dQ[base + i] += k; M.wallBot += k;
			}
			for (k = 0; k < M.n; k++) M.H[k] += dQ[k] / m[k];
		},

		// H3: transport over one frame. The velocity is frozen at the frame's solved
		// field (infinite-Prandtl: it is a balance, not a carried quantity, so there
		// is nothing to advect it with); the conserved fields move in k identical
		// substeps under the displacement cap and the conduction limit together.
		transport: function (dt) {
			var M = this.M, nx = M.nx, ny = M.ny, u = M.u, v = M.v;
			var cap = this.opts.get('substepCap'), maxC = 0, a;
			var i, j, k, base, s, dtS, kk;
			for (k = 0; k < M.n; k++) { a = Math.abs(u[k]) / M.dx; if (a > maxC) maxC = a; }
			for (j = 1; j < ny; j++) {
				base = j * nx;
				a = 1 / M.distN[j];
				for (i = 0; i < nx; i++) {
					var c = Math.abs(v[base + i]) * a;
					if (c > maxC) maxC = c;
				}
			}
			kk = Math.ceil(Math.max(maxC * dt / cap, M.condMax * dt / 0.4));
			if (kk < 1) kk = 1;
			if (kk > 64) kk = 64;
			M.d.k = kk;
			dtS = dt / kk;
			for (j = 0; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) M.fx[base + i] = u[base + i] * M.hC[j] * dtS;
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) M.fy[base + i] = v[base + i] * M.dx * dtS;
			}
			for (s = 0; s < kk; s++) {
				this.advectField(M.H, true);
				this.advectField(M.cF);
				this.advectField(M.cW);
				this.conduct(dtS);
				this.equil();
			}
		},

		// H8: the readings. Wells are counted the 0.3 way (sign changes of the
		// depth-summed vertical velocity, halved), Nu is the top wall flux against
		// the conductive drop, and the lid is read in the plan's own unit: the mean
		// mobility mob(T) of the surface band against the interior's.
		diag: function () {
			var M = this.M, nx = M.nx, ny = M.ny, T = M.T, v = M.v, d = M.d;
			var b = this.opts.get('mobContrast'), i, j, k;
			var first = 0, prev = 0, changes = 0, col, cur, seen = 0;
			var tMin = Infinity, tMax = -Infinity, lid = 0, lidN = 0, int = 0, intN = 0, nu = 0;
			for (i = 0; i < nx; i++) {
				col = 0;
				for (j = 0; j <= ny; j++) col += v[j * nx + i];
				cur = col > 0 ? 1 : 0;
				if (!seen) { first = cur; prev = cur; seen = 1; continue; }
				if (cur !== prev) { changes++; prev = cur; }
			}
			if (prev !== first) changes++;
			d.wells = changes >> 1;
			for (i = 0; i < nx; i++) nu += T[i];
			d.nu = nu / nx / M.yC[0] * PCP.depth;
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				if (T[k] < tMin) tMin = T[k];
				if (T[k] > tMax) tMax = T[k];
				if (M.yC[j] < 150) { lid += Math.exp(b * (T[k] - 0.5)); lidN++; }
				else if (M.yC[j] > 600 && M.yC[j] < 2200) {
					int += Math.exp(b * (T[k] - 0.5)); intN++;
				}
			}
			d.tMin = tMin; d.tMax = tMax;
			d.lidMob = lidN ? lid / lidN : 0;
			d.intMob = intN ? int / intN : 0;
		},

		step: function () {
			var M = this.M, dt = this.opts.get('clock') / 1000;
			if (!M || !(dt > 0)) return this;
			PCP.solidusOf = this.opts.get('solidusOf');
			// A rendered frame is nSub identical fluid steps of at most 50 kyr, the
			// same dtFluidMax contract the 0.3 line validated: the projection is
			// warm-started and unconverged, so its residual divergence compresses
			// the flux-form transport by ~(div * dt) a step -- harmless at 50 kyr
			// and a runaway at 500, where the overshoot feeds the buoyancy before
			// the sweeps can catch up. Re-solving the flow per substep also makes
			// sweeps-per-Myr independent of the clock slider.
			var nSub = Math.max(1, Math.ceil(dt / 0.05)), s;
			for (s = 0; s < nSub; s++) {
				this.equil();      // H1 no-ops at zero population: load stays hydrostatic
				this.flow();
				this.transport(dt / nSub);
			}
			M.d.k *= nSub;
			this.diag();
			M.time += dt;
			M.frame++;
			return this;
		},

		read: function (key) {
			var M = this.M, p, sum;
			if (!M) return undefined;
			if (key === 'time') return M.time;
			if (key === 'frame') return M.frame;
			if (key === 'kyr') return this.clock();
			if (key === 'cells') return M.n;
			if (key === 'population') return this.S ? this.S.n : 0;
			if (key === 'mass') return M.totalMass;
			if (key === 'peakV') return M.d.peakV;
			if (key === 'peakU') return M.d.peakU;
			if (key === 'wells') return M.d.wells;
			if (key === 'lidMobility') return M.d.lidMob;
			if (key === 'interiorMobility') return M.d.intMob;
			if (key === 'nu') return M.d.nu;
			if (key === 'div') return M.d.div;
			if (key === 'substeps') return M.d.k;
			if (key === 'wallNet') return M.wallBot - M.wallTop;
			if (key === 'wallGross') return M.wallBot + M.wallTop;
			if (key === 'clampNet') return M.clamp;
			if (key === 'stock0') return M.stock0;
			if (key === 'enthalpy' || key === 'meltMass') {
				sum = 0;
				if (key === 'enthalpy') {
					for (p = 0; p < M.n; p++) sum += M.m[p] * M.H[p];
				} else {
					for (p = 0; p < M.n; p++) sum += M.m[p] * M.melt[p];
				}
				return sum;
			}
			return undefined;
		},

		applyPreset: function (preset) {
			this.opts.set('clock', preset.clock);
			return this;
		},
		setOption: function (id, v) { this.opts.set(id, v, true); return this; },
		setCamera: function (c) { this.camera = c; return this; },
		setTool: function (t) { this.tool = t; return this; },

		hud: function () {
			var M = this.M, d = M.d, ms = this.ms || 0;
			return [
				'HY hybrid — M2 liquid (no crust yet)',
				'Myr ' + M.time.toFixed(2) + '   ' + this.clock() + ' kyr/frame   k ' + d.k,
				'peak ' + (d.peakV * PCP.cmYr).toFixed(1) + ' cm/yr   wells ' + d.wells +
					'   Nu ' + d.nu.toFixed(1) + '   div ' + (100 * d.div).toFixed(1) + '%',
				'cells ' + M.nx + 'x' + M.ny + ' = ' + M.n + '   parcels ' + this.S.n +
					'   sweeps ' + this.opts.get('projIters') + ' ' + this.opts.get('advect'),
				'ms/frame ' + ms.toFixed(2) + '   wall ' +
					(M.wallBot - M.wallTop).toExponential(3) +
					'   solidus ' + this.opts.get('solidusOf')
			].join('\n');
		},

		// The view: the temperature field as a raster scaled to the canvas with
		// smoothing off. Raster rows sit at uniform asinh depths (M.drawRow, built
		// with the mesh) because the shared page ruler is drawn in that mapping,
		// while the solver's rows are tanh-clustered -- the resample is a row
		// lookup, not an interpolation. The melt overlay brightens molten cells
		// toward white-yellow. The lid/vent cameras remap the raster's rows onto
		// its top rows instead of asking drawImage for a source rectangle, so the
		// software-canvas harness (pc-look) renders the same picture the browser does.
		_field: null,
		draw: function (ctx, w, h) {
			var M = this.M, pad = 0.05, hh = h * (1 - 2 * pad), img, small, k, t, i, j, sj, ml;
			ctx.fillStyle = '#05070c';
			ctx.fillRect(0, 0, w, h);
			if (!M) return;
			if (!this._field) {
				small = typeof document !== 'undefined' ? document.createElement('canvas') : null;
				this._field = small ? small : { width: 0, height: 0 };
			}
			small = this._field;
			if (small.width !== M.nx || small.height !== M.drawRows) {
				small.width = M.nx; small.height = M.drawRows;
				this._img = null;
			}
			if (!this._img && small.getContext) {
				this._sctx = small.getContext('2d');
				this._img = this._sctx.createImageData(M.nx, M.drawRows);
			}
			img = this._img;
			if (!img) return;
			var rows = M.drawRows, top = this.camera === 'mantle' ? rows : rows / 3;
			var showMelt = this.opts.get('melt'), npx = M.nx * rows;
			for (k = 0; k < npx; k++) {
				j = (k / M.nx) | 0;
				sj = M.drawRow[top === rows ? j : Math.min(top - 1, (j * top / rows) | 0)];
				t = M.T[sj * M.nx + (k - j * M.nx)];
				ml = showMelt ? M.melt[sj * M.nx + (k - j * M.nx)] : 0;
				i = 4 * k;
				img.data[i] = Math.round(30 + 225 * t + ml * (255 - (30 + 225 * t)));
				img.data[i + 1] = Math.round(20 + 90 * t + ml * (230 - (20 + 90 * t)));
				img.data[i + 2] = Math.round(150 - 110 * t + ml * (120 - (150 - 110 * t)));
				img.data[i + 3] = 255;
			}
			this._sctx.putImageData(img, 0, 0);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(small, 0, h * pad, w, hh);
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = HY;
	else root.HY = HY;
}(typeof window !== 'undefined' ? window : this));
