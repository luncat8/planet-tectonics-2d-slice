// hy/hy.js — 0.5.0 M2–M3: the hybrid engine (0.5.0-plan.md §4, milestones M2 and M3).
//
// The hybrid owns its liquid in *cells* and its solid in *parcels*.
//   M2 built the liquid (H2–H3): the 256 x 24 tanh two-sided mesh, conserved cell fields
//   (H, cF, cW) with equilibrium readings (T, melt), MAC-staggered viscous predictor +
//   red-black projection, donor/MacCormack conservative transport, and wall conduction.
//   M3 adds the crust half (H1, H4–H8):
//     H1  scatter: parcel mass, solid fraction, damage and the downward lithostatic load
//         column (cell liquid + parcel overburden)
//     H4  phase equilibrium on cells and parcels; bond aging, anneal, pair strain load,
//         rate-form damage, union-find plate clusters, pairwise elastic springs (bounded
//         by eps0 * mu) and slab-pull root drive, with `links` on/off
//     H5  two-book transactions: parcel<->cell harmonic thermal exchange, shallow deposit
//         surface cooling (booked to wallTop), deposit->crust welding, crust->cell melt
//         absorption and equilibrium melt shedding, cell->crust basal accretion, capacity
//         deferral, and lateral isostatic load re-equilibration
//     H6  vent scheduling from overpressured melt columns under damaged/thinned skin,
//         wall-clock ballistic flight, landing, deposit coalescence
//     H7  pile top per column (relief M.zh), ocean/edifice/trench geometry
//     H8  ledgers, scenario readings, HUD diagnostics
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('../pc/params.js') : root.PCP;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('../pc/phase.js') : root.PCPHASE;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('../pc/pool.js') : root.PCPOOL;
	var PCBOND = (typeof module !== 'undefined' && module.exports) ? require('../pc/bond.js') : root.PCBOND;
	var PCOPT = (typeof module !== 'undefined' && module.exports) ? require('../pc/opt.js') : root.PCOPT;

	function wrapX(x, W) { return x - Math.floor(x / W) * W; }

	function smoothstep(a, b, x) {
		var t = (x - a) / (b - a);
		t = t < 0 ? 0 : (t > 1 ? 1 : t);
		return t * t * (3 - 2 * t);
	}

	function draw(id, salt) {
		var h = Math.imul((id + 1) ^ salt, 1103515245) + 12345;
		h = Math.imul(h ^ (h >>> 16), 2246822519);
		return (h >>> 0) / 4294967295;
	}

	function find(par, i) {
		var r = i, p;
		while (par[r] !== r) r = par[r];
		while (par[i] !== r) { p = par[i]; par[i] = r; i = p; }
		return r;
	}

	var HY = {
		id: 'hy',
		name: 'hybrid',
		complete: true,
		features: { flow: 1, lid: 1, melt: 1, erupt: 1, unload: 1 },
		defaults: { nx: 256, ny: 24, cap: 6144, stretch: 2.5 },
		loadBack: 0.05,

		cfg: {
			skinRows: 2,
			skinFrac: 0.35,
			bondRangeY: 28,
			kBondSpring: 0.30,
			kSlab: 12,
			vSlabMax: 35,
			ringMax: 0.04,
			plateMin: 16,
			kSink: 45,
			vSinkMax: 25,
			kSlope: 80,
			tauThermal: 2.5,
			meltHold: 0.10,
			meltAbsorb: 0.45,
			minParcelMass: 12,
			kAccrete: 0.06,
			kReequil: 0.12,
			ventDepthMax: 420,
			ventBaseHead: 6,
			ventTensile: 12,
			ventRoofMax: 0.92,
			ventCooldown: 4,
			kVent: 0.35,
			emitEff: 80,
			emitBlast: 160,
			wBlast: 0.01,
			minEmitMass: 10,
			flightFrame: 1 / 60,
			flightG: 40,
			flightVyEff: 18,
			flightVyBlast: 27,
			flightVxEff: 30,
			flightVxBlast: 80,
			flightLift: 0.05,
			depositCoolT: 0,
			depositCoolTau: 0.1,
			depositCoolDepth: 30,
			depositMerge: 40,
			maxDepMergeMass: 450,
			unloadSpan: 750,
			unloadHead: 22
		},

		FIELDS: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
			'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph', 'load', 'cl', 'par', 'rScale'],
		poolCfg: {
			carry: ['x', 'y', 'e', 'vx', 'vy', 'm', 'H', 'T', 'melt', 'cF', 'cW',
				'age', 'mu', 'dmg', 'pLoad', 'pCnt', 'id', 'ph', 'load', 'cl', 'par', 'rScale'],
			share: ['x', 'y', 'e', 'vx', 'vy', 'T', 'H', 'cF', 'cW', 'melt', 'load', 'rScale'],
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

		alloc: function (cap, nx) {
			var K = this.FIELDS, S = this.S, k, name;
			if (!S || S.cap !== cap) {
				S = this.S = { cap: cap, n: 0, wrap: PCP.wrap };
				for (k = 0; k < K.length; k++) {
					name = K[k];
					S[name] = name === 'id' ? new Uint32Array(cap)
						: (name === 'ph' ? new Uint8Array(cap)
						: (name === 'cl' || name === 'par' ? new Int32Array(cap)
						: new Float64Array(cap)));
				}
				S.order = new Int32Array(cap);
				S.csOf = new Int32Array(cap);
				S.csM = new Float64Array(cap);
				S.csX = new Float64Array(cap);
				S.csY = new Float64Array(cap);
				S.csVX = new Float64Array(cap);
				S.csVY = new Float64Array(cap);
				S.csRef = new Float64Array(cap);
				S.csS = new Float64Array(cap);
				S.csCnt = new Int32Array(cap);
			}
			if (!S.counts || S.counts.length !== nx) {
				S.counts = new Int32Array(nx);
				S.slot = new Int32Array(nx);
			}
			S.n = 0; S.ledger = 0; S.wrap = PCP.wrap; S.firstAir = cap;
			S.tx = { admit: 0, move: 0, split: 0, separate: 0, carry: 0, merge: 0, refuse: 0 };
			S.nextId = 1;
			this.pool.attach(S);
			return S;
		},

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
				m0: new Float64Array(n), m: new Float64Array(n),
				mPar: new Float64Array(n), fSol: new Float64Array(n),
				muCell: new Float64Array(n), dmgCell: new Float64Array(n),
				y: new Float64Array(n), eta: new Float64Array(n),
				load: new Float64Array(n), cx: new Float64Array(nx),
				colPar: new Float64Array(nx), colDep: new Float64Array(nx),
				colTot: new Float64Array(nx), skin0: new Float64Array(nx),
				zh: new Float64Array(nx), zhTmp: new Float64Array(nx),
				colDst: new Int32Array(nx), colDeep: new Int32Array(nx), colCnt: new Int32Array(nx),
				depCol: new Int32Array(nx), colRem: new Float64Array(nx),
				meltHead: new Float64Array(nx), roofCap: new Float64Array(nx),
				vCool: new Float64Array(nx),
				vOpen: new Uint8Array(nx), uLoad: new Uint8Array(nx),
				u: new Float64Array(n), v: new Float64Array(nv),
				p: new Float64Array(n), rhs: new Float64Array(n),
				srcV: new Float64Array(nv),
				fx: new Float64Array(n), fy: new Float64Array(nv),
				dQ: new Float64Array(n), q1: new Float64Array(n), q2: new Float64Array(n),
				rowMean: new Float64Array(ny), solMean: new Float64Array(ny),
				time: 0, frame: 0, wallTop: 0, wallBot: 0, clamp: 0, stock0: 0, totalMass: 0,
				cellMass: 0, cellH: 0, cellMelt: 0, ventEpisodes: 0, ventWait: 0,
				thr: { meltDr: 0, meltCr: 0, freezeDr: 0, freezeCr: 0,
					emitDr: 0, emitCr: 0, landDr: 0, landCr: 0, weld: 0,
					unloadDr: 0, unloadCr: 0 },
				tx: { melt: 0, shed: 0, freeze: 0, emit: 0, land: 0, weld: 0,
					unload: 0, defer: 0 },
				unload: { m: 0, h: 0, f: 0, w: 0, count: 0, x: 0, span: 0,
					drop: 0, pulse: 0, eqPulse: 0, gap: 0 },
				d: { peakV: 0, peakU: 0, wells: 0, nu: 0, div: 0, k: 1,
					lidMob: 0, intMob: 0, tMin: 0, tMax: 0,
					bonds: 0, clusters: 0, plates: 0,
					meltInWin: 0, meltOutWin: 0, meltEqGap: 0,
					zhMin: 0, zhMax: 0 }
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
				M.load[k] = M.yC[j];
				M.m0[k] = dx * M.hC[j];
				M.m[k] = M.m0[k];
				M.totalMass += M.m0[k];
			}
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
			this.opts.commit();
			PCP.solidusOf = this.opts.get('solidusOf');
			var nx = this.defaults.nx, ny = this.defaults.ny;
			var cap = Math.max(this.defaults.cap, nx * 24);
			var M = this.mesh(nx, ny), S = this.alloc(cap, nx);
			var wave = new Float64Array(nx), i, j, k, s, p, T, f, dm;
			var pSize = this.opts.get('partSize');
			var nSub = Math.max(1, Math.round(3 / pSize));
			PCP.icDraw(this.seed);
			for (i = 0; i < nx; i++) wave[i] = PCP.icWave(M.cx[i]);
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				f = M.yC[j] / PCP.depth;
				T = 1 - Math.exp(-M.yC[j] / PCP.skin) +
					PCP.icAmp * Math.sin(Math.PI * f) * wave[i];
				T = T < 0 ? 0 : (T > 1 ? 1 : T);
				M.cF[k] = j < this.cfg.skinRows ? 0.15 : 0;
				M.cW[k] = j < this.cfg.skinRows ? 0.01 : 0;
				PHASE.byT(T, M.yC[j], M.cF[k], M.cW[k], M.load[k]);
				M.T[k] = PHASE.out.t; M.H[k] = PHASE.out.h; M.melt[k] = PHASE.out.melt;
				M.stock0 += M.m0[k] * M.H[k];
			}
			for (j = 0; j < this.cfg.skinRows && j < ny; j++) {
				for (i = 0; i < nx; i++) {
					k = j * nx + i;
					dm = (this.cfg.skinFrac * M.m0[k]) / nSub;
					for (s = 0; s < nSub; s++) {
						p = this.pool.admit(S, PCP.PH.crust);
						if (p < 0) break;
						M.m[k] -= dm;
						S.m[p] = dm;
						S.x[p] = i * M.dx + (s + 0.5) * (M.dx / nSub);
						S.y[p] = M.yN[j] + (0.28 + 0.44 * (s & 1)) * M.hC[j];
						S.e[p] = Math.asinh(S.y[p] / PCP.yLin);
						S.load[p] = S.y[p];
						S.H[p] = M.H[k]; S.T[p] = M.T[k]; S.melt[p] = M.melt[k];
						S.cF[p] = M.cF[k]; S.cW[p] = M.cW[k];
						S.age[p] = PCP.tauWeld;
						S.mu[p] = PCBOND.mu(S.T[p], S.age[p], S.melt[p]);
						S.dmg[p] = 0;
						S.rScale[p] = pSize;
						M.skin0[i] += dm;
					}
				}
			}
			this.scatter();
			this.pileTop();
			this.equil();
			this.diag();
			return this;
		},

		clock: function () { return this.opts.get('clock'); },

		rowOfY: function (y) {
			var M = this.M, ny = M.ny, j = 0;
			if (y <= M.yN[1]) return 0;
			if (y >= M.yN[ny - 1]) return ny - 1;
			while (j < ny - 1 && M.yN[j + 1] < y) j++;
			return j;
		},

		colOfX: function (x) {
			var M = this.M, i = Math.floor(wrapX(x, M.wrap) / M.dx);
			return i < 0 ? 0 : (i >= M.nx ? M.nx - 1 : i);
		},

		surfaceY: function (x) {
			var M = this.M, f = wrapX(x, M.wrap) / M.dx, i = Math.floor(f), u = f - i;
			if (i >= M.nx) i = 0;
			var i1 = i + 1 === M.nx ? 0 : i + 1;
			return -(M.zh[i] + (M.zh[i1] - M.zh[i]) * u);
		},

		// H1: scatter parcel mass, solid fraction and damage to cells, then integrate
		// the downward lithostatic load column (liquid cells + solid parcel overburden).
		scatter: function () {
			var M = this.M, S = this.S, nx = M.nx, ny = M.ny, dx = M.dx, invDx = 1 / dx;
			var mPar = M.mPar, fSol = M.fSol, muC = M.muCell, dmgC = M.dmgCell;
			var colPar = M.colPar, colDep = M.colDep, colTot = M.colTot, roof = M.roofCap;
			var yN = M.yN, yC = M.yC, loadC = M.load, mCell = M.m;
			var p, i, j, k, m, str, tot, acc, th, mTop, dmgTop, refSkin, cov;
			mPar.fill(0); fSol.fill(0); muC.fill(0); dmgC.fill(0);
			colPar.fill(0); colDep.fill(0); M.depCol.fill(-1);
			if (S && S.n > 0) {
				var n = S.n, sx = S.x, sy = S.y, sm = S.m, smu = S.mu, sdmg = S.dmg;
				var sph = S.ph, sload = S.load;
				for (p = 0; p < n; p++) {
					if (sph[p] === PCP.PH.air) { sload[p] = 0; continue; }
					i = (sx[p] * invDx) | 0;
					if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
					j = 0;
					if (sy[p] > yN[1]) {
						if (sy[p] >= yN[ny - 1]) j = ny - 1;
						else while (j < ny - 1 && yN[j + 1] < sy[p]) j++;
					}
					k = j * nx + i;
					m = sm[p];
					mPar[k] += m;
					colPar[i] += m;
					if (sph[p] === PCP.PH.dep) { colDep[i] += m; M.depCol[i] = p; }
					str = smu[p] * (1 - sdmg[p]);
					muC[k] += m * str;
					dmgC[k] += m * sdmg[p];
				}
			}
			for (k = 0; k < M.n; k++) {
				tot = mCell[k] + mPar[k];
				fSol[k] = tot > 0 ? mPar[k] / tot : 0;
				if (mPar[k] > 0) {
					muC[k] /= mPar[k];
					dmgC[k] /= mPar[k];
				}
			}
			for (i = 0; i < nx; i++) {
				acc = 0;
				for (j = 0; j < ny; j++) {
					k = j * nx + i;
					th = (mCell[k] + mPar[k]) * invDx;
					loadC[k] = acc + 0.5 * th;
					acc += th;
				}
				colTot[i] = acc;
				mTop = mPar[i] + (ny > 1 ? mPar[nx + i] : 0);
				dmgTop = mTop > 0
					? (mPar[i] * dmgC[i] + (ny > 1 ? mPar[nx + i] * dmgC[nx + i] : 0)) / mTop
					: 0;
				refSkin = M.skin0[i] > 0 ? M.skin0[i] : 1;
				cov = mTop / refSkin;
				if (cov > 1.5) cov = 1.5;
				roof[i] = cov * (1 - dmgTop);
			}
			if (S && S.n > 0) {
				var n2 = S.n, sx2 = S.x, sy2 = S.y, sph2 = S.ph, sload2 = S.load;
				for (p = 0; p < n2; p++) {
					if (sph2[p] === PCP.PH.air) continue;
					i = (sx2[p] * invDx) | 0;
					if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
					j = 0;
					if (sy2[p] > yN[1]) {
						if (sy2[p] >= yN[ny - 1]) j = ny - 1;
						else while (j < ny - 1 && yN[j + 1] < sy2[p]) j++;
					}
					k = j * nx + i;
					tot = loadC[k] + (sy2[p] - yC[j]);
					sload2[p] = tot > 0 ? tot : 0;
				}
			}
		},

		// H4a: equilibrium on cells Only (used inside transport substeps) or on both
		// cells and parcels (`equil`).
		equilCells: function () {
			var M = this.M, H = M.H, T = M.T, ml = M.melt, cF = M.cF, cW = M.cW;
			var y = M.y, load = M.load, k;
			for (k = 0; k < M.n; k++) {
				PHASE.byH(H[k], y[k], cF[k], cW[k], load[k]);
				T[k] = PHASE.out.t; ml[k] = PHASE.out.melt;
			}
		},

		equil: function () {
			this.equilCells();
			if (this.S && this.S.n > 0) PHASE.equil(this.S, this.S.load);
		},

		// H2: viscous predictor + red-black projection, with optional load-back from
		// the row-mean-removed solid-fraction anomaly.
		flow: function () {
			var M = this.M, nx = M.nx, ny = M.ny, dx = M.dx;
			var T = M.T, fSol = M.fSol, u = M.u, v = M.v, p = M.p, rhs = M.rhs;
			var srcV = M.srcV, b = this.opts.get('mobContrast'), lb = this.loadBack;
			var iters = this.opts.get('projIters') | 0, visc = iters >> 1, proj = iters - visc;
			var i, j, k, base, im, ip, s, mean, sm, fAnom;
			if (visc < 1) visc = 1;
			for (j = 0; j < ny; j++) {
				base = j * nx; mean = 0; sm = 0;
				for (i = 0; i < nx; i++) { mean += T[base + i]; sm += fSol[base + i]; }
				M.rowMean[j] = mean / nx;
				M.solMean[j] = sm / nx;
			}
			for (j = 1; j < ny; j++) {
				base = j * nx;
				for (i = 0; i < nx; i++) {
					s = 0.5 * (T[base - nx + i] + T[base + i]);
					fAnom = (s - 0.5 * (M.rowMean[j - 1] + M.rowMean[j])) -
						lb * (0.5 * (fSol[base - nx + i] + fSol[base + i]) -
						0.5 * (M.solMean[j - 1] + M.solMean[j]));
					srcV[base + i] = Math.exp(b * (s - 0.5)) * -PCP.RaK * fAnom;
				}
			}
			for (s = 0; s < visc; s++) { this.sweepU(); this.sweepV(); }
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
			// Exact barotropic + continuity gauge cleanup: removing the column-varying part
			// of depth-integrated u and integrating v downward from v[0]=0 closes discrete
			// cell divergence to machine roundoff (~1e-16) in every cell of the box.
			var uBar = 0, colU = M.zhTmp, corrU;
			for (i = 0; i < nx; i++) {
				s = 0;
				for (j = 0; j < ny; j++) s += u[j * nx + i] * M.hC[j];
				colU[i] = s;
				uBar += s;
			}
			uBar /= nx;
			for (i = 0; i < nx; i++) {
				corrU = (colU[i] - uBar) / PCP.depth;
				for (j = 0; j < ny; j++) u[j * nx + i] -= corrU;
			}
			for (i = 0; i < nx; i++) {
				ip = i + 1 < nx ? i + 1 : 0;
				v[i] = 0;
				for (j = 0; j < ny - 1; j++) {
					base = j * nx;
					v[base + nx + i] = v[base + i] - (u[base + ip] - u[base + i]) * (M.hC[j] / dx);
				}
				v[ny * nx + i] = 0;
			}
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

		transport: function (dt) {
			var M = this.M, nx = M.nx, ny = M.ny, u = M.u, v = M.v;
			var cap = this.opts.get('substepCap'), maxC = 0, minFrac = 1, fr, a;
			var i, j, k, base, s, dtS, kk;
			for (k = 0; k < M.n; k++) {
				fr = M.m[k] / M.m0[k];
				if (fr < minFrac) minFrac = fr;
				a = Math.abs(u[k]) / M.dx;
				if (a > maxC) maxC = a;
			}
			if (minFrac < 0.25) minFrac = 0.25;
			for (j = 1; j < ny; j++) {
				base = j * nx;
				a = 1 / M.distN[j];
				for (i = 0; i < nx; i++) {
					var c = Math.abs(v[base + i]) * a;
					if (c > maxC) maxC = c;
				}
			}
			kk = Math.ceil(Math.max(maxC * dt / (cap * minFrac), M.condMax * dt / (0.4 * minFrac)));
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
				this.equilCells();
			}
		},

		// H4b: the crust skin — bond aging and healing, velocity sampling from the
		// staggered fluid grid + negative-buoyancy slab descent, pair scan with
		// elastic spring response (bounded by eps0 * mu), rate-form damage, union-find
		// plate clustering with slab-pull root drive, and position update.
		crust: function (dt) {
			var M = this.M, S = this.S;
			if (!(dt > 0) || !S || !S.n) {
				if (M) { M.d.bonds = 0; M.d.clusters = 0; M.d.plates = 0; }
				return;
			}
			var nx = M.nx, ny = M.ny, dx = M.dx, invDx = 1 / dx, wrap = M.wrap, n = S.n;
			var sHeal = this.opts.get('tauHeal');
			var sYield = this.opts.get('yieldRate');
			var sDmg = this.opts.get('kDamage');
			var links = this.opts.get('links');
			var inertia = this.opts.get('inertia');
			var gamma = inertia > 0 ? Math.pow(inertia, dt / 0.05) : 0;
			var sx = S.x, sy = S.y, se = S.e, svx = S.vx, svy = S.vy, sT = S.T, sph = S.ph;
			var scl = S.cl, spLoad = S.pLoad, spCnt = S.pCnt, colDeep = M.colDeep;
			var u = M.u, v = M.v, yN = M.yN, yC = M.yC, hC = M.hC, rowMean = M.rowMean, zh = M.zh;
			var p, i, j, j2, ip, base, base2, fx, fy, fyU, u0, u1, uFlow, vFlow, vSink, slope;

			PCBOND.settle(S, dt, PCP.PH_SOLID, sHeal);

			colDeep.fill(-1);
			for (p = 0; p < n; p++) {
				if (sph[p] !== PCP.PH.crust) continue;
				i = (sx[p] * invDx) | 0;
				if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
				if (colDeep[i] < 0 || sy[p] > sy[colDeep[i]]) colDeep[i] = p;
			}

			for (p = 0; p < n; p++) {
				scl[p] = -1;
				spLoad[p] = 0; spCnt[p] = 0;
				if (sph[p] === PCP.PH.air) continue;
				fx = sx[p] * invDx;
				i = fx | 0;
				if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
				fx -= i;
				ip = i + 1 < nx ? i + 1 : 0;
				j = 0;
				if (sy[p] > yN[1]) {
					if (sy[p] >= yN[ny - 1]) j = ny - 1;
					else while (j < ny - 1 && yN[j + 1] < sy[p]) j++;
				}
				base = j * nx;
				u0 = (1 - fx) * u[base + i] + fx * u[base + ip];
				j2 = sy[p] >= yC[j] ? (j + 1 < ny ? j + 1 : j) : (j > 0 ? j - 1 : 0);
				if (j2 !== j) {
					base2 = j2 * nx;
					u1 = (1 - fx) * u[base2 + i] + fx * u[base2 + ip];
					fyU = Math.abs(sy[p] - yC[j]) / Math.abs(yC[j2] - yC[j]);
					if (fyU > 1) fyU = 1;
					uFlow = (1 - fyU) * u0 + fyU * u1;
				} else {
					uFlow = u0;
				}
				fy = (sy[p] - yN[j]) / hC[j];
				if (fy < 0) fy = 0; else if (fy > 1) fy = 1;
				vFlow = (1 - fy) * v[base + i] + fy * v[base + nx + i];
				if (sph[p] === PCP.PH.dep) {
					vSink = (2.5 - sy[p]) * 0.04;
					vFlow = 0;
				} else if (sy[p] > yN[2]) {
					vSink = 7;
					vFlow = Math.max(0, 0.20 * vFlow);
				} else if ((p === colDeep[i] || sy[p] > 15) && v[nx + i] > 6 && M.colPar[i] > 1.08 * M.skin0[i]) {
					vSink = 0.45 * v[nx + i];
					vFlow = 0;
				} else {
					vSink = sy[p] > 20 ? (20 - sy[p]) * 0.04 : 0;
					vFlow *= 0.04;
				}
				slope = (zh[ip] - zh[i]) * invDx;
				uFlow -= this.cfg.kSlope * slope;
				svx[p] = gamma * svx[p] + (1 - gamma) * uFlow;
				svy[p] = gamma * svy[p] + (1 - gamma) * (vFlow + vSink);
			}

			if (links) {
				this.bondWalk(dt, sYield, sDmg);
			} else {
				M.d.bonds = 0; M.d.clusters = 0; M.d.plates = 0;
			}

			for (p = 0; p < n; p++) {
				if (sph[p] === PCP.PH.air) continue;
				sx[p] = wrapX(sx[p] + svx[p] * dt, wrap);
				sy[p] += svy[p] * dt;
				if (sy[p] < 0.5) sy[p] = 0.5;
				else if (sy[p] > PCP.depth - 5) sy[p] = PCP.depth - 5;
				se[p] = Math.asinh(sy[p] / PCP.yLin);
			}
		},

		bondWalk: function (dt, sYield, sDmg) {
			var M = this.M, S = this.S, nx = M.nx, dx = M.dx, invDx = 1 / dx, wrap = M.wrap, n = S.n;
			var counts = S.counts, slot = S.slot, order = S.order, par = S.par, cl = S.cl, csOf = S.csOf;
			var sx = S.x, sy = S.y, svx = S.vx, svy = S.vy, sm = S.m, smu = S.mu, sdmg = S.dmg;
			var spCnt = S.pCnt, spLoad = S.pLoad, sph = S.ph;
			var strong = PCP.clusterMin, near = 0.6 * strong;
			var rangeX = 0.65 * dx, rangeY = this.cfg.bondRangeY;
			var r0 = dx / Math.max(1, Math.round(3 / this.opts.get('partSize')));
			var r02 = r0 * r0;
			var kSpr = this.cfg.kBondSpring, eps0 = PCP.eps0;
			var p, q, i, ip, b0, b1, k, c = 0, d, dxp, dyp, d2, denom, dist, mu, md, load;
			var eps, el, corr, mt, wP, wQ, nBonds = 0, nCl = 0, plates = 0, a, b;

			counts.fill(0);
			for (p = 0; p < n; p++) {
				csOf[p] = -1;
				if (sph[p] === PCP.PH.air) continue;
				d = smu[p] * (1 - sdmg[p]);
				if (d < near) continue;
				cl[p] = d >= strong ? -2 : -3;
				par[p] = p;
				i = (sx[p] * invDx) | 0;
				if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
				counts[i]++;
			}
			for (i = 0; i < nx; i++) { slot[i] = c; c += counts[i]; }
			for (p = 0; p < n; p++) {
				if (cl[p] > -2) continue;
				i = (sx[p] * invDx) | 0;
				if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
				order[slot[i]++] = p;
			}

			var lim0, lim1;
			for (i = 0; i < nx; i++) {
				b0 = slot[i] - counts[i];
				ip = i + 1 < nx ? i + 1 : 0;
				b1 = slot[ip] - counts[ip];
				lim1 = counts[ip] < 8 ? counts[ip] : 8;
				for (k = 0; k < counts[i]; k++) {
					p = order[b0 + k];
					lim0 = counts[i] < k + 8 ? counts[i] : k + 8;
					for (c = k + 1; c < lim0; c++) {
						q = order[b0 + c];
						dxp = sx[q] - sx[p];
						if (dxp < -rangeX || dxp > rangeX) continue;
						dyp = sy[q] - sy[p];
						if (dyp < -rangeY || dyp > rangeY) continue;
						d2 = dxp * dxp + dyp * dyp;
						if (d2 < 1e-6) continue;
						denom = d2 > r02 ? d2 : r02;
						mu = smu[p] * (1 - sdmg[p]);
						md = smu[q] * (1 - sdmg[q]);
						if (md < mu) mu = md;
						load = Math.abs((svx[q] - svx[p]) * dxp + (svy[q] - svy[p]) * dyp) / denom;
						spCnt[p]++; spCnt[q]++;
						spLoad[p] += load; spLoad[q] += load;
						if (mu < strong) continue;
						a = find(par, p); b = find(par, q);
						if (a !== b) par[b] = a;
						nBonds++;
					}
					for (c = 0; c < lim1; c++) {
						q = order[b1 + c];
						dxp = sx[q] - sx[p];
						if (dxp > 0.5 * wrap) dxp -= wrap;
						else if (dxp < -0.5 * wrap) dxp += wrap;
						if (dxp < -rangeX || dxp > rangeX) continue;
						dyp = sy[q] - sy[p];
						if (dyp < -rangeY || dyp > rangeY) continue;
						d2 = dxp * dxp + dyp * dyp;
						if (d2 < 1e-6) continue;
						denom = d2 > r02 ? d2 : r02;
						mu = smu[p] * (1 - sdmg[p]);
						md = smu[q] * (1 - sdmg[q]);
						if (md < mu) mu = md;
						load = Math.abs((svx[q] - svx[p]) * dxp + (svy[q] - svy[p]) * dyp) / denom;
						spCnt[p]++; spCnt[q]++;
						spLoad[p] += load; spLoad[q] += load;
						if (mu < strong) continue;
						a = find(par, p); b = find(par, q);
						if (a !== b) par[b] = a;
						nBonds++;
					}
				}
			}

			PCBOND.damage(S, dt, sYield, sDmg);

			for (p = 0; p < n; p++) {
				if (cl[p] !== -2) { cl[p] = -1; continue; }
				if (smu[p] * (1 - sdmg[p]) < strong) { cl[p] = -1; continue; }
				k = find(par, p);
				if (csOf[k] < 0) csOf[k] = nCl++;
				cl[p] = csOf[k];
			}

			var csM = S.csM, csX = S.csX, csY = S.csY, csVX = S.csVX, csVY = S.csVY;
			var csRef = S.csRef, csS = S.csS, csCnt = S.csCnt;
			for (c = 0; c < nCl; c++) {
				csM[c] = 0; csX[c] = 0; csY[c] = 0;
				csVX[c] = 0; csVY[c] = 0; csS[c] = 0; csCnt[c] = 0;
			}
			for (p = 0; p < n; p++) {
				c = cl[p];
				if (c < 0) continue;
				mt = sm[p];
				if (csM[c] === 0) csRef[c] = sx[p];
				dxp = sx[p] - csRef[c];
				if (dxp > 0.5 * wrap) dxp -= wrap;
				else if (dxp < -0.5 * wrap) dxp += wrap;
				csM[c] += mt; csX[c] += mt * dxp; csY[c] += mt * sy[p];
				csVX[c] += mt * svx[p]; csVY[c] += mt * svy[p];
				csCnt[c]++;
			}
			for (c = 0; c < nCl; c++) {
				if (!(csM[c] > 0)) continue;
				csX[c] = csRef[c] + csX[c] / csM[c];
				csY[c] /= csM[c]; csVX[c] /= csM[c]; csVY[c] /= csM[c];
			}
			for (p = 0; p < n; p++) {
				c = cl[p];
				if (c < 0) continue;
				dxp = sx[p] - csX[c];
				if (dxp > 0.5 * wrap) dxp -= wrap;
				else if (dxp < -0.5 * wrap) dxp += wrap;
				dyp = sy[p] - csY[c];
				d2 = dxp * dxp + dyp * dyp;
				if (d2 > 1e-9 && dyp > 0) csS[c] += sm[p] * (dxp / Math.sqrt(d2)) * dyp;
			}
			for (c = 0; c < nCl; c++) {
				if (!(csM[c] > 0)) continue;
				corr = this.cfg.kSlab * (csS[c] / csM[c]);
				if (corr > this.cfg.vSlabMax) corr = this.cfg.vSlabMax;
				else if (corr < -this.cfg.vSlabMax) corr = -this.cfg.vSlabMax;
				csVX[c] += corr;
				if (csCnt[c] >= this.cfg.plateMin) plates++;
			}
			for (p = 0; p < n; p++) {
				c = cl[p];
				if (c < 0) continue;
				wP = smoothstep(strong, 1.4 * strong, smu[p] * (1 - sdmg[p]));
				svx[p] += wP * (csVX[c] - svx[p]);
				svy[p] += wP * (csVY[c] - svy[p]);
			}
			M.d.bonds = nBonds; M.d.clusters = nCl; M.d.plates = plates;
		},

		// H5: two-book transactions (cell <-> parcel). Every transaction conserves
		// mass, enthalpy, felsic and water across M and S to floating-point roundoff.
		transactions: function (dt) {
			var M = this.M, S = this.S;
			if (!(dt > 0) || !M || !S) return;
			var nx = M.nx, p, i, j, k, h0, h1, q, mEff, dQ;
			var aCool = 1 - Math.exp(-dt / this.cfg.depositCoolTau);
			var aTherm = 1 - Math.exp(-dt / this.cfg.tauThermal);
			var aSub = 1 - Math.exp(-dt / 0.5);

			for (p = 0; p < S.n; p++) {
				if (S.ph[p] === PCP.PH.air) continue;
				if (S.ph[p] === PCP.PH.dep && S.y[p] <= this.cfg.depositCoolDepth) {
					h0 = S.H[p];
					if (h0 !== 0) {
						h1 = h0 * (1 - aCool);
						q = S.m[p] * (h1 - h0);
						S.H[p] = h1;
						M.wallTop -= q;
						PHASE.byH(h1, S.y[p], S.cF[p], S.cW[p], S.load[p]);
						S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt;
					}
					continue;
				}
				i = this.colOfX(S.x[p]);
				j = this.rowOfY(S.y[p]);
				k = j * nx + i;
				mEff = (S.m[p] * M.m[k]) / (S.m[p] + M.m[k]);
				dQ = (j >= 2 ? aSub : aTherm) * mEff * (M.T[k] - S.T[p]);
				if (dQ === 0) continue;
				S.H[p] += dQ / S.m[p];
				M.H[k] -= dQ / M.m[k];
				PHASE.byH(S.H[p], S.y[p], S.cF[p], S.cW[p], S.load[p]);
				S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt;
				PHASE.byH(M.H[k], M.y[k], M.cF[k], M.cW[k], M.load[k]);
				M.T[k] = PHASE.out.t; M.melt[k] = PHASE.out.melt;
			}

			for (p = 0; p < S.n; p++) {
				if (S.ph[p] !== PCP.PH.dep) continue;
				if (PCBOND.isPlate(S.mu[p] * (1 - S.dmg[p]))) {
					S.ph[p] = PCP.PH.crust;
					M.thr.weld += S.m[p];
					M.tx.weld++;
				}
			}

			p = 0;
			while (p < S.n) {
				if (S.ph[p] !== PCP.PH.crust) { p++; continue; }
				i = this.colOfX(S.x[p]);
				j = this.rowOfY(S.y[p]);
				k = j * nx + i;
				if (S.melt[p] >= 1 || S.y[p] > 180 ||
					(S.y[p] > M.yN[2] && (S.melt[p] >= this.cfg.meltAbsorb || S.T[p] >= 0.88))) {
					this.absorbParcel(p, k);
					continue;
				}
				if (S.melt[p] >= this.cfg.meltHold) {
					if (S.m[p] * (1 - S.melt[p]) < this.cfg.minParcelMass) {
						this.absorbParcel(p, k);
						continue;
					}
					this.shedParcelMelt(p, k);
				}
				p++;
			}

			this.basalAccrete(dt);
			this.reequil(dt);
		},

		absorbParcel: function (p, k) {
			var M = this.M, S = this.S;
			var dm = S.m[p], mc = M.m[k], mNew = mc + dm, w = dm / mNew;
			M.H[k] += w * (S.H[p] - M.H[k]);
			M.cF[k] += w * (S.cF[p] - M.cF[k]);
			M.cW[k] += w * (S.cW[p] - M.cW[k]);
			M.m[k] = mNew;
			PHASE.byH(M.H[k], M.y[k], M.cF[k], M.cW[k], M.load[k]);
			M.T[k] = PHASE.out.t; M.melt[k] = PHASE.out.melt;
			M.thr.meltDr += dm; M.thr.meltCr += dm; M.tx.melt++;
			this.pool.remove(S, p);
			return dm;
		},

		shedParcelMelt: function (p, k) {
			var M = this.M, S = this.S;
			var xi = S.melt[p], m0 = S.m[p], dm = m0 * xi;
			if (!(dm > 0) || !(dm < m0)) return 0;
			var ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p], S.load[p]);
			var hLiq = (m0 * S.H[p] - (m0 - dm) * ts) / dm;
			var mc = M.m[k], mNew = mc + dm, w = dm / mNew;
			M.H[k] += w * (hLiq - M.H[k]);
			M.cF[k] += w * (S.cF[p] - M.cF[k]);
			M.cW[k] += w * (S.cW[p] - M.cW[k]);
			M.m[k] = mNew;
			S.m[p] = m0 - dm;
			S.H[p] = ts; S.T[p] = ts; S.melt[p] = 0;
			PHASE.byH(M.H[k], M.y[k], M.cF[k], M.cW[k], M.load[k]);
			M.T[k] = PHASE.out.t; M.melt[k] = PHASE.out.melt;
			M.thr.meltDr += dm; M.thr.meltCr += dm; M.tx.melt++; M.tx.shed++;
			return dm;
		},

		accreteFromCell: function (k, dst, dm) {
			var M = this.M, S = this.S, q, mNew, w, j, i;
			if (!(dm > 0) || M.m[k] - dm < 0.4 * M.m0[k]) return -1;
			if (dst >= 0) {
				mNew = S.m[dst] + dm;
				w = dm / mNew;
				S.H[dst] += w * (M.H[k] - S.H[dst]);
				S.cF[dst] += w * (M.cF[k] - S.cF[dst]);
				S.cW[dst] += w * (M.cW[k] - S.cW[dst]);
				S.m[dst] = mNew;
				M.m[k] -= dm;
				PHASE.byH(S.H[dst], S.y[dst], S.cF[dst], S.cW[dst], S.load[dst]);
				S.T[dst] = PHASE.out.t; S.melt[dst] = PHASE.out.melt;
				M.thr.freezeDr += dm; M.thr.freezeCr += dm; M.tx.freeze++;
				return dst;
			}
			q = this.pool.admit(S, PCP.PH.crust);
			if (q < 0) { M.tx.defer++; return -1; }
			j = (k / M.nx) | 0; i = k - j * M.nx;
			M.m[k] -= dm;
			S.x[q] = M.cx[i]; S.y[q] = M.yC[j]; S.e[q] = M.eta[k]; S.load[q] = M.load[k];
			S.m[q] = dm; S.H[q] = M.H[k]; S.T[q] = M.T[k]; S.melt[q] = M.melt[k];
			S.cF[q] = M.cF[k]; S.cW[q] = M.cW[k];
			S.age[q] = 0; S.mu[q] = PCBOND.mu(S.T[q], 0, S.melt[q]);
			S.rScale[q] = this.opts.get('partSize');
			M.thr.freezeDr += dm; M.thr.freezeCr += dm; M.tx.freeze++;
			return q;
		},

		basalAccrete: function (dt) {
			var M = this.M, S = this.S, nx = M.nx;
			var i, k, p, q, dst, deficit, dm, target;
			var colDst = M.colDst, colCnt = M.colCnt;
			colDst.fill(-1); colCnt.fill(0);
			for (p = 0; p < S.n; p++) {
				if (S.ph[p] !== PCP.PH.crust || S.y[p] > M.yN[2]) continue;
				i = this.colOfX(S.x[p]);
				colCnt[i]++;
				if (colDst[i] < 0 || S.m[p] < S.m[colDst[i]]) colDst[i] = p;
			}
			for (i = 0; i < nx; i++) {
				target = 1.05 * M.skin0[i];
				if (M.colPar[i] >= target) continue;
				k = M.ny > 1 ? nx + i : i;
				if (M.melt[k] > 0 || M.T[k] > PCP.TSoft) k = i;
				if (M.melt[k] > 0 || M.T[k] > PCP.TSoft) continue;
				if (M.m[k] <= 0.55 * M.m0[k]) continue;
				deficit = target - M.colPar[i];
				dst = colDst[i];
				if (dst < 0) {
					if (deficit < 0.20 * M.skin0[i]) continue;
					dm = Math.min(0.20 * M.skin0[i], M.m[k] - 0.55 * M.m0[k]);
				} else {
					dm = Math.min(this.cfg.kAccrete * deficit * dt, M.m[k] - 0.55 * M.m0[k]);
				}
				if (!(dm > 0.2)) continue;
				p = this.accreteFromCell(k, dst, dm);
				if (p >= 0) {
					M.colPar[i] += dm;
					if (S.m[p] > 0.42 * M.skin0[i] && colCnt[i] < 6) {
						q = this.pool.split(S, p);
						if (q >= 0) {
							S.x[q] = wrapX(S.x[p] + 0.25 * M.dx, M.wrap);
							colCnt[i]++;
						}
					}
				}
			}
		},

		reequil: function (dt) {
			var M = this.M, nx = M.nx, dx = M.dx, i, im, j, a, b, diff, dm, w;
			var rate = this.cfg.kReequil * dt;
			if (rate > 0.25) rate = 0.25;
			var hTot = M.hC[0] + (M.ny > 1 ? M.hC[1] : 0);
			for (i = 0; i < nx; i++) {
				im = i > 0 ? i - 1 : nx - 1;
				diff = M.colTot[im] - M.colTot[i];
				if (Math.abs(diff) < 1e-6) continue;
				for (j = 0; j < 2 && j < M.ny; j++) {
					a = diff > 0 ? j * nx + im : j * nx + i;
					b = diff > 0 ? j * nx + i : j * nx + im;
					dm = rate * 0.5 * Math.abs(diff) * dx * (M.hC[j] / hTot);
					if (M.m[a] - dm < 0.45 * M.m0[a]) dm = M.m[a] - 0.45 * M.m0[a];
					if (!(dm > 0)) continue;
					M.m[a] -= dm;
					w = dm / (M.m[b] + dm);
					M.H[b] += w * (M.H[a] - M.H[b]);
					M.cF[b] += w * (M.cF[a] - M.cF[b]);
					M.cW[b] += w * (M.cW[a] - M.cW[b]);
					M.m[b] += dm;
				}
				M.colTot[im] -= rate * 0.5 * diff;
				M.colTot[i] += rate * 0.5 * diff;
			}
		},

		// H6: vent scheduling from overpressured shallow melt columns under damaged or
		// thinned skin, ballistic flight on the wall clock, landing and coalescence.
		emitVents: function (dt) {
			var M = this.M, S = this.S;
			if (!(dt > 0) || !M || !S) return;
			var nx = M.nx, ny = M.ny, dx = M.dx, yMax = this.cfg.ventDepthMax;
			var i, j, k, ml, head, kSrc, bestScore, score, thresh, excess, dm;
			var bestI = -1, bestK = -1, bestEx = 0;
			if (M.ventWait > 0) {
				M.ventWait -= dt;
				if (M.ventWait < 0) M.ventWait = 0;
			}
			for (i = 0; i < nx; i++) {
				head = 0; kSrc = -1; bestScore = 0;
				for (j = 1; j < ny - 1; j++) {
					if (M.yC[j] > yMax) break;
					k = j * nx + i;
					ml = M.melt[k];
					if (!(ml > 0)) continue;
					head += (M.m[k] * ml) / dx;
					score = ml / (1 + 0.005 * M.yC[j]);
					if (score > bestScore && M.m[k] > 0.55 * M.m0[k]) {
						bestScore = score; kSrc = k;
					}
				}
				M.meltHead[i] = head;
				thresh = this.cfg.ventBaseHead + this.cfg.ventTensile * M.roofCap[i];
				if (head <= 0.75 * thresh || kSrc < 0 || M.roofCap[i] > this.cfg.ventRoofMax) {
					M.vOpen[i] = 0;
					continue;
				}
				if (head > thresh && head - thresh > bestEx) {
					bestEx = head - thresh;
					bestI = i;
					bestK = kSrc;
				}
			}
			if (bestI >= 0 && M.ventWait <= 0) {
				dm = Math.min(
					this.cfg.kVent * bestEx * dx,
					this.cfg.emitEff,
					0.4 * M.m[bestK] * M.melt[bestK],
					M.m[bestK] - 0.5 * M.m0[bestK]
				);
				if (dm >= this.cfg.minEmitMass && this.launchClast(bestI, bestK, dm) >= 0) {
					M.vOpen[bestI] = 1;
					M.ventEpisodes++;
					M.ventWait = this.cfg.ventCooldown;
				}
			}
		},

		launchClast: function (i, kSrc, dm) {
			var M = this.M, S = this.S;
			if (!(dm > 0) || M.m[kSrc] - dm < 0.4 * M.m0[kSrc]) return -1;
			var p = this.pool.admit(S, PCP.PH.air);
			if (p < 0) { M.tx.defer++; return -1; }
			if (p < S.firstAir) S.firstAir = p;
			var pSize = this.opts.get('partSize');
			M.m[kSrc] -= dm;
			S.m[p] = dm;
			S.H[p] = M.H[kSrc]; S.cF[p] = M.cF[kSrc]; S.cW[p] = M.cW[kSrc];
			S.load[p] = 0;
			PHASE.byH(S.H[p], 0, S.cF[p], S.cW[p], 0);
			S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt;
			S.x[p] = M.cx[i];
			S.y[p] = this.surfaceY(S.x[p]) - this.cfg.flightLift;
			S.e[p] = Math.asinh(Math.max(0, S.y[p]) / PCP.yLin);
			S.rScale[p] = this.opts.get('sizeByMaterial') ? 0.6 * pSize : pSize;
			var blast = S.cW[p] > this.cfg.wBlast;
			var r0 = draw(S.id[p], Math.imul(i + 1, 2654435761));
			var r1 = draw(S.id[p], Math.imul(i + 1, 1597334677));
			S.vx[p] = (2 * r0 - 1) * (blast ? this.cfg.flightVxBlast : this.cfg.flightVxEff);
			S.vy[p] = -(0.9 + 0.2 * r1) * (blast ? this.cfg.flightVyBlast : this.cfg.flightVyEff);
			M.thr.emitDr += dm; M.thr.emitCr += dm; M.tx.emit++;
			return p;
		},

		mergeTarget: function (p) {
			var M = this.M, S = this.S, wrap = M.wrap, q, dx, dy, d2;
			var best = -1, best2 = this.cfg.depositMerge * this.cfg.depositMerge;
			var capM = this.cfg.maxDepMergeMass;
			var i = this.colOfX(S.x[p]), im = i > 0 ? i - 1 : M.nx - 1, ip = i + 1 < M.nx ? i + 1 : 0;
			var cols = [M.depCol[i], M.depCol[im], M.depCol[ip]], c;
			for (c = 0; c < 3; c++) {
				q = cols[c];
				if (q < 0 || q >= S.n || q === p || S.ph[q] !== PCP.PH.dep) continue;
				if (!this.pool.compatible(S, p, q)) continue;
				if (S.m[q] + S.m[p] > capM && S.n < S.cap - 64) continue;
				dx = S.x[q] - S.x[p];
				if (dx > 0.5 * wrap) dx -= wrap;
				else if (dx < -0.5 * wrap) dx += wrap;
				dy = S.y[q] - S.y[p];
				d2 = dx * dx + dy * dy;
				if (d2 < best2) { best = q; best2 = d2; }
			}
			return best;
		},

		landClast: function (p) {
			var M = this.M, S = this.S, m = S.m[p];
			var ySurf = this.surfaceY(S.x[p]);
			S.y[p] = ySurf > 0.5 ? ySurf : 0.5;
			S.e[p] = Math.asinh(S.y[p] / PCP.yLin);
			S.vx[p] = 0; S.vy[p] = 0; S.ph[p] = PCP.PH.dep;
			S.age[p] = 0; S.mu[p] = 0; S.dmg[p] = 0; S.pLoad[p] = 0; S.pCnt[p] = 0;
			M.thr.landDr += m; M.thr.landCr += m; M.tx.land++;
			var q = this.mergeTarget(p);
			if (q < 0) {
				M.depCol[this.colOfX(S.x[p])] = p;
				return false;
			}
			this.pool.merge(S, q, p);
			M.depCol[this.colOfX(S.x[q])] = q;
			return true;
		},

		advanceFlight: function (wallDt) {
			var M = this.M, S = this.S;
			if (!(wallDt > 0) || !M || !S || S.firstAir >= S.n) return;
			var dt = wallDt > PCP.flightDtMax ? PCP.flightDtMax : wallDt;
			var p = S.firstAir < 0 ? 0 : S.firstAir, nextFirst = S.cap, vy0, ySurf;
			while (p < S.n) {
				if (S.ph[p] !== PCP.PH.air) { p++; continue; }
				vy0 = S.vy[p];
				S.x[p] = wrapX(S.x[p] + S.vx[p] * dt, M.wrap);
				S.y[p] += vy0 * dt + 0.5 * this.cfg.flightG * dt * dt;
				S.vy[p] = vy0 + this.cfg.flightG * dt;
				S.e[p] = Math.asinh(Math.max(0, S.y[p]) / PCP.yLin);
				ySurf = this.surfaceY(S.x[p]);
				if (S.vy[p] <= 0 || S.y[p] < ySurf) {
					if (p < nextFirst) nextFirst = p;
					p++;
					continue;
				}
				if (this.landClast(p)) continue;
				p++;
			}
			S.firstAir = nextFirst;
		},

		airCount: function () {
			var S = this.S, p, n = 0;
			if (!S || S.firstAir >= S.n) return 0;
			for (p = S.firstAir < 0 ? 0 : S.firstAir; p < S.n; p++) {
				if (S.ph[p] === PCP.PH.air) n++;
			}
			return n;
		},

		// H7: pile top per column (relief M.zh).
		pileTop: function () {
			var M = this.M, nx = M.nx, dx = M.dx, zh = M.zh, tmp = M.zhTmp;
			var i, im, ip, pass, zMin = Infinity, zMax = -Infinity;
			for (i = 0; i < nx; i++) {
				zh[i] = 0.25 * (M.colTot[i] - PCP.depth) + M.colDep[i] / dx;
			}
			for (pass = 0; pass < 3; pass++) {
				for (i = 0; i < nx; i++) {
					im = i > 0 ? i - 1 : nx - 1;
					ip = i + 1 < nx ? i + 1 : 0;
					tmp[i] = 0.25 * zh[im] + 0.5 * zh[i] + 0.25 * zh[ip];
				}
				for (i = 0; i < nx; i++) zh[i] = tmp[i];
			}
			for (i = 0; i < nx; i++) {
				if (zh[i] < zMin) zMin = zh[i];
				if (zh[i] > zMax) zMax = zh[i];
			}
			M.d.zhMin = isFinite(zMin) ? zMin : 0;
			M.d.zhMax = isFinite(zMax) ? zMax : 0;
		},

		unload: function (xCenter, spanKm) {
			var M = this.M, S = this.S;
			if (!M || !S) return 0;
			var nx = M.nx, dx = M.dx, wrap = M.wrap;
			var xc = xCenter === undefined ? 0.5 * wrap : wrapX(xCenter, wrap);
			var span = spanKm === undefined ? this.cfg.unloadSpan : spanKm;
			var half = 0.5 * span, p = 0, i, j, k, dist, dm, removed = 0;
			var colRem = M.colRem;
			colRem.fill(0);
			M.uLoad.fill(0);
			for (i = 0; i < nx; i++) {
				dist = Math.abs(M.cx[i] - xc);
				if (dist > 0.5 * wrap) dist = wrap - dist;
				if (dist <= half) M.uLoad[i] = 1;
			}
			while (p < S.n) {
				if (S.ph[p] === PCP.PH.air) { p++; continue; }
				i = this.colOfX(S.x[p]);
				if (!M.uLoad[i]) { p++; continue; }
				dm = S.m[p];
				M.unload.m += dm;
				M.unload.h += dm * S.H[p];
				M.unload.f += dm * S.cF[p];
				M.unload.w += dm * S.cW[p];
				M.thr.unloadDr += dm; M.thr.unloadCr += dm; M.tx.unload++;
				colRem[i] += dm;
				removed += dm;
				this.pool.remove(S, p);
			}
			var targetM = this.cfg.unloadHead * dx, need;
			for (i = 0; i < nx; i++) {
				if (!M.uLoad[i]) continue;
				need = targetM - colRem[i];
				for (j = 0; j < 2 && j < M.ny && need > 0; j++) {
					k = j * nx + i;
					dm = Math.min(need, M.m[k] - 0.35 * M.m0[k]);
					if (!(dm > 0)) continue;
					M.m[k] -= dm;
					M.unload.m += dm;
					M.unload.h += dm * M.H[k];
					M.unload.f += dm * M.cF[k];
					M.unload.w += dm * M.cW[k];
					M.thr.unloadDr += dm; M.thr.unloadCr += dm; M.tx.unload++;
					need -= dm;
					removed += dm;
				}
			}
			M.unload.count++;
			M.unload.x = xc;
			M.unload.span = span;
			this.scatter();
			this.pileTop();
			this.equil();
			this.diag();
			return removed;
		},

		// H8: diagnostics, books and scenario readings.
		diag: function () {
			var M = this.M, S = this.S, nx = M.nx, ny = M.ny, T = M.T, v = M.v, d = M.d;
			var b = this.opts.get('mobContrast'), i, j, k, p;
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

			var cellM = 0, cellH = 0, cellMelt = 0, inWin = 0, ml;
			for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
				k = j * nx + i;
				if (T[k] < tMin) tMin = T[k];
				if (T[k] > tMax) tMax = T[k];
				if (M.yC[j] < 150) { lid += Math.exp(b * (T[k] - 0.5)); lidN++; }
				else if (M.yC[j] > 600 && M.yC[j] < 2200) {
					int += Math.exp(b * (T[k] - 0.5)); intN++;
				}
				cellM += M.m[k];
				cellH += M.m[k] * M.H[k];
				ml = M.melt[k];
				cellMelt += M.m[k] * ml;
				if (ml > inWin) inWin = ml;
			}
			if (S && S.n > 0) {
				for (p = 0; p < S.n; p++) {
					ml = S.melt[p];
					if (ml > inWin) inWin = ml;
				}
			}
			M.cellMass = cellM; M.cellH = cellH; M.cellMelt = cellMelt;
			d.tMin = tMin; d.tMax = tMax;
			d.lidMob = lidN ? lid / lidN : 0;
			d.intMob = intN ? int / intN : 0;
			d.meltInWin = inWin;
			d.meltOutWin = 0;
			d.meltEqGap = 0;

			var dropMax = 0, pulse = 0, eqPulse = 0, tsDepth, tsLoad, dTs, xiDepth, xiEq;
			if (M.unload.count > 0) {
				for (i = 0; i < nx; i++) {
					if (!M.uLoad[i]) continue;
					for (j = 0; j < ny; j++) {
						k = j * nx + i;
						tsDepth = PHASE.solidusAt(M.y[k], M.cF[k], M.cW[k]);
						tsLoad = PHASE.solidus(M.y[k], M.cF[k], M.cW[k], M.load[k]);
						dTs = tsDepth - tsLoad;
						if (dTs > dropMax) dropMax = dTs;
						xiDepth = (M.H[k] - tsDepth) / (PCP.meltGap + PCP.meltLat);
						if (xiDepth < 0) xiDepth = 0; else if (xiDepth > 1) xiDepth = 1;
						if (M.melt[k] > xiDepth) pulse += M.m[k] * (M.melt[k] - xiDepth);
						xiEq = (M.H[k] - tsLoad) / (PCP.meltGap + PCP.meltLat);
						if (xiEq < 0) xiEq = 0; else if (xiEq > 1) xiEq = 1;
						if (xiEq > xiDepth) eqPulse += M.m[k] * (xiEq - xiDepth);
					}
				}
			}
			M.unload.drop = dropMax;
			M.unload.pulse = pulse;
			M.unload.eqPulse = eqPulse;
			M.unload.gap = eqPulse > 0 ? Math.abs(pulse - eqPulse) / eqPulse : Math.abs(pulse - eqPulse);
		},

		step: function (wallDt, paused) {
			var M = this.M, dt = (paused || this.paused) ? 0 : this.opts.get('clock') / 1000;
			if (!M || !(dt > 0)) {
				if (M && wallDt > 0) this.advanceFlight(wallDt);
				return this;
			}
			PCP.solidusOf = this.opts.get('solidusOf');
			if (this.tool === 'unload' && M.unload.count === 0) {
				this.unload(0.5 * PCP.wrap);
			}
			this.flow();
			this.transport(dt);
			this.crust(dt);
			this.transactions(dt);
			this.emitVents(dt);
			if (wallDt > 0) {
				this.advanceFlight(wallDt);
			} else if (this.S.firstAir < this.S.n) {
				var guard = 0;
				while (this.S.firstAir < this.S.n && guard++ < 160) {
					this.advanceFlight(this.cfg.flightFrame);
				}
			}
			this.scatter();
			this.pileTop();
			this.equil();
			this.diag();
			M.time += dt;
			M.frame++;
			return this;
		},

		read: function (key) {
			var M = this.M, S = this.S, inv;
			if (!M) return undefined;
			if (key === 'time') return M.time;
			if (key === 'frame') return M.frame;
			if (key === 'kyr') return this.clock();
			if (key === 'cells') return M.n;
			if (key === 'population') return S ? S.n : 0;
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
			if (key === 'bonds') return M.d.bonds;
			if (key === 'clusters') return M.d.clusters;
			if (key === 'plates') return M.d.plates;
			if (key === 'meltInWindow') return M.d.meltInWin;
			if (key === 'meltOutsideWindow') return M.d.meltOutWin;
			if (key === 'meltEquilibriumGap') return M.d.meltEqGap;
			if (key === 'ventEpisodes') return M.ventEpisodes;
			inv = this.pool.inventory(S);
			if (key === 'cellMass') return M.cellMass;
			if (key === 'parcelMass') return inv.m;
			if (key === 'unloadMass') return M.unload.m;
			if (key === 'mass') return M.cellMass + inv.m + M.unload.m;
			if (key === 'enthalpy') return M.cellH + inv.h + M.unload.h;
			if (key === 'totalMeltMass') return M.cellMelt + inv.l;
			if (key === 'meltMass') {
				return M.unload.count > 0 ? M.unload.pulse : M.cellMelt + inv.l;
			}
			if (key === 'airMass') return M.thr.landCr;
			if (key === 'depositMass') return this.pool.invM[PCP.PH.dep];
			if (key === 'crustMass') return this.pool.invM[PCP.PH.crust];
			if (key === 'weldMass') return M.thr.weld;
			if (key === 'solidusDrop') return M.unload.drop;
			if (key === 'pulseGap') return M.unload.gap;
			if (key === 'load') return M.load[(M.nx >> 1)];
			return undefined;
		},

		applyPreset: function (preset) {
			var k;
			this.init();
			this.opts.set('clock', preset.clock);
			if (preset.options) {
				for (k in preset.options) {
					try { this.opts.set(k, preset.options[k], true); } catch (e) {}
				}
			}
			if (preset.camera) this.camera = preset.camera;
			this.tool = preset.tool || null;
			return this;
		},
		setOption: function (id, v) { this.init(); this.opts.set(id, v, true); return this; },
		setCamera: function (c) { this.camera = c; return this; },
		setTool: function (t) { this.tool = t; return this; },

		hud: function () {
			var M = this.M, S = this.S, d = M.d, ms = this.ms || 0;
			var inv = this.pool.inventory(S);
			var nCr = this.pool.invN[PCP.PH.crust] | 0;
			var nDep = this.pool.invN[PCP.PH.dep] | 0;
			var nAir = this.pool.invN[PCP.PH.air] | 0;
			return [
				'HY hybrid — M3 liquid + crust',
				'Myr ' + M.time.toFixed(2) + '   ' + this.clock() + ' kyr/frame   k ' + d.k +
					(nAir > 0 ? '   flight ' + (1000 * this.cfg.flightFrame).toFixed(0) + ' ms' : ''),
				'peak ' + (d.peakV * PCP.cmYr).toFixed(1) + ' cm/yr   wells ' + d.wells +
					'   Nu ' + d.nu.toFixed(1) + '   div ' + (100 * d.div).toFixed(1) + '%',
				'cells ' + M.nx + 'x' + M.ny + ' = ' + M.n + '   parcels ' + S.n +
					' (crust ' + nCr + ' dep ' + nDep + ' air ' + nAir + ')' +
					'   plates ' + d.plates + '   vents ' + M.ventEpisodes,
				'ms/frame ' + ms.toFixed(2) + '   mass ' +
					(M.cellMass + inv.m + M.unload.m).toExponential(4) +
					'   wall ' + (M.wallBot - M.wallTop).toExponential(3) +
					'   solidus ' + this.opts.get('solidusOf')
			].join('\n');
		},

		_field: null,
		_drawOrder: null,
		draw: function (ctx, w, h) {
			var M = this.M, S = this.S, pad = 0.05, hh = h * (1 - 2 * pad), img, small, k, t, i, j, sj, ml;
			ctx.fillStyle = '#060a14';
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
			var rows = M.drawRows, top = this.camera === 'mantle' ? rows : rows / 3;
			var etaMax = M.etaBot * (top / rows);
			var showMelt = this.opts.get('melt'), npx = M.nx * rows;
			if (img) {
				for (k = 0; k < npx; k++) {
					j = (k / M.nx) | 0;
					sj = M.drawRow[top === rows ? j : Math.min(top - 1, (j * top / rows) | 0)];
					t = M.T[sj * M.nx + (k - j * M.nx)];
					ml = showMelt ? M.melt[sj * M.nx + (k - j * M.nx)] : 0;
					i = 4 * k;
					// desaturated mantle glow: keep contrast but let pebbles dominate
					var rr = 30 + 225 * t + ml * (255 - (30 + 225 * t));
					var gg = 20 + 90 * t + ml * (230 - (20 + 90 * t));
					var bb = 150 - 110 * t + ml * (120 - (150 - 110 * t));
					// soften saturation slightly for hydrogel aesthetic
					var lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
					var desat = 0.22;
					rr = lum * desat + rr * (1 - desat);
					gg = lum * desat + gg * (1 - desat);
					bb = lum * desat + bb * (1 - desat);
					img.data[i] = Math.round(rr * 0.55 + 14);
					img.data[i + 1] = Math.round(gg * 0.55 + 10);
					img.data[i + 2] = Math.round(bb * 0.60 + 16);
					img.data[i + 3] = 255;
				}
				this._sctx.putImageData(img, 0, 0);
				ctx.imageSmoothingEnabled = true;
				ctx.globalAlpha = 0.52;
				ctx.drawImage(small, 0, h * pad, w, hh);
				ctx.globalAlpha = 1;
			}

			// subtle mantle vignette — deepens bottom without hard edge
			if (ctx.createLinearGradient) {
				var grad = ctx.createLinearGradient(0, h * pad, 0, h * pad + hh);
				if (grad && grad.addColorStop) {
					grad.addColorStop(0, 'rgba(6,10,20,0)');
					grad.addColorStop(0.72, 'rgba(6,10,20,0)');
					grad.addColorStop(1, 'rgba(6,10,20,0.55)');
					ctx.fillStyle = grad;
					ctx.fillRect(0, h * pad, w, hh);
				}
			}

			// relief horizon — filled translucent pile + crisp line
			if (this.opts.get('relief')) {
				ctx.save();
				ctx.beginPath();
				for (i = 0; i < M.nx; i++) {
					var px = M.cx[i] * w / M.wrap;
					var ySurf = -M.zh[i];
					var etaS = ySurf >= 0 ? Math.asinh(ySurf / M.yLin) : -Math.asinh(-ySurf / M.yLin);
					var py = h * pad + (etaS / etaMax) * hh;
					if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
				}
				// close to top to fill sky above pile
				ctx.lineTo(w, h * pad);
				ctx.lineTo(0, h * pad);
				ctx.closePath();
				ctx.fillStyle = 'rgba(18,26,44,0.55)';
				ctx.fill();
				ctx.beginPath();
				for (i = 0; i < M.nx; i++) {
					var px2 = M.cx[i] * w / M.wrap;
					var ySurf2 = -M.zh[i];
					var etaS2 = ySurf2 >= 0 ? Math.asinh(ySurf2 / M.yLin) : -Math.asinh(-ySurf2 / M.yLin);
					var py2 = h * pad + (etaS2 / etaMax) * hh;
					if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
				}
				ctx.strokeStyle = 'rgba(150,210,255,0.75)';
				ctx.lineWidth = 1.2;
				ctx.stroke();
				// soft glow under horizon
				ctx.strokeStyle = 'rgba(100,180,255,0.18)';
				ctx.lineWidth = 6;
				ctx.stroke();
				ctx.restore();
			}

			if (S && S.n > 0 && this.opts.get('bonds') && this.opts.get('links')) {
				// dense bond web — all near neighbours that are bonded, not just one per column
				var counts = S.counts, slot = S.slot, order = S.order;
				var rangeX = 0.70 * M.dx, rangeY = this.cfg.bondRangeY;
				ctx.save();
				ctx.lineCap = 'round';
				for (i = 0; i < M.nx; i++) {
					var b0 = slot[i] - counts[i];
					var ip = i + 1 < M.nx ? i + 1 : 0;
					var b1 = slot[ip] - counts[ip];
					for (var kk = 0; kk < counts[i]; kk++) {
						var p = order[b0 + kk];
						if (S.e[p] > etaMax) continue;
						var muP = S.mu[p] * (1 - S.dmg[p]);
						if (muP < 0.18) continue;
						// same column neighbours ahead
						for (var c = kk + 1; c < Math.min(counts[i], kk + 8); c++) {
							var q = order[b0 + c];
							if (S.e[q] > etaMax) continue;
							var muQ = S.mu[q] * (1 - S.dmg[q]);
							if (muQ < 0.18) continue;
							var dxp = S.x[q] - S.x[p];
							if (dxp < -rangeX || dxp > rangeX) continue;
							var dyp = S.y[q] - S.y[p];
							if (dyp < -rangeY || dyp > rangeY) continue;
							var mu = muP < muQ ? muP : muQ;
							var a = 0.10 + 0.35 * mu;
							ctx.strokeStyle = 'rgba(190,230,255,' + a.toFixed(3) + ')';
							ctx.lineWidth = 0.9 + mu * 0.8;
							ctx.beginPath();
							ctx.moveTo(S.x[p] * w / M.wrap, h * pad + (S.e[p] / etaMax) * hh);
							ctx.lineTo(S.x[q] * w / M.wrap, h * pad + (S.e[q] / etaMax) * hh);
							ctx.stroke();
						}
						// next column
						for (var c2 = 0; c2 < Math.min(counts[ip], 8); c2++) {
							var q2 = order[b1 + c2];
							if (S.e[q2] > etaMax) continue;
							var muQ2 = S.mu[q2] * (1 - S.dmg[q2]);
							if (muQ2 < 0.18) continue;
							var dxp2 = S.x[q2] - S.x[p];
							if (dxp2 > 0.5 * M.wrap) dxp2 -= M.wrap;
							else if (dxp2 < -0.5 * M.wrap) dxp2 += M.wrap;
							if (dxp2 < -rangeX || dxp2 > rangeX) continue;
							var dyp2 = S.y[q2] - S.y[p];
							if (dyp2 < -rangeY || dyp2 > rangeY) continue;
							var mu2 = muP < muQ2 ? muP : muQ2;
							var a2 = 0.10 + 0.35 * mu2;
							ctx.strokeStyle = 'rgba(190,230,255,' + a2.toFixed(3) + ')';
							ctx.lineWidth = 0.9 + mu2 * 0.8;
							ctx.beginPath();
							ctx.moveTo(S.x[p] * w / M.wrap, h * pad + (S.e[p] / etaMax) * hh);
							ctx.lineTo(S.x[q2] * w / M.wrap, h * pad + (S.e[q2] / etaMax) * hh);
							ctx.stroke();
						}
					}
				}
				ctx.restore();
			}

			if (S && S.n > 0 && this.opts.get('markers')) {
				var showCrust = this.opts.get('crust');
				var shrink = this.opts.get('sizeByHeat');
				// sort deep→shallow for correct translucent overlap (back-to-front)
				var orderIdx = this._drawOrder;
				if (!orderIdx || orderIdx.length !== S.n) orderIdx = this._drawOrder = new Int32Array(S.cap);
				for (var idx = 0; idx < S.n; idx++) orderIdx[idx] = idx;
				// insertion sort by eta is cheap for n~2k? use built-in sort on slice for simplicity
				var tmp = Array.prototype.slice.call(orderIdx.subarray(0, S.n));
				tmp.sort(function (a, b) { return S.e[b] - S.e[a]; });
				for (var sIdx = 0; sIdx < S.n; sIdx++) orderIdx[sIdx] = tmp[sIdx];

				var pxPerKm = w / M.wrap;
				var dxPx = M.dx * pxPerKm;
				for (var oi = 0; oi < S.n; oi++) {
					var p = orderIdx[oi];
					var eta = S.e[p];
					if (eta > etaMax) continue;
					var px = S.x[p] * w / M.wrap;
					var py = h * pad + (eta / etaMax) * hh;
					t = S.T[p]; ml = S.melt[p]; var ph = S.ph[p];
					var baseR = dxPx * 0.62 * (S.rScale[p] || 1) * (1 - 0.35 * shrink * t);
					if (baseR < 2.0) baseR = 2.0;
					if (baseR > dxPx * 1.15) baseR = dxPx * 1.15;
					var r = baseR;
					var fill, strokeA = 0.18, alpha = 0.86;
					if (ph === PCP.PH.air) {
						fill = 'rgba(255,232,120,' + alpha + ')';
						strokeA = 0.35;
					} else if (ph === PCP.PH.dep) {
						// hydrogel deposit: warm amber, translucent
						var depR = showCrust ? 217 : 255, depG = showCrust ? 140 : 152, depB = showCrust ? 82 : 72;
						fill = 'rgba(' + depR + ',' + depG + ',' + depB + ',' + (0.78 + 0.12 * t) + ')';
					} else if (showCrust) {
						var mu = S.mu[p] * (1 - S.dmg[p]);
						var rr = Math.round(88 + 88 * (1 - mu) + 66 * ml + 22 * t);
						var gg = Math.round(118 + 62 * mu + 18 * ml);
						var bb = Math.round(142 + 68 * mu - 28 * ml);
						// hydrogel tint: slightly desaturated, translucent
						fill = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + alpha + ')';
					} else {
						var rr2 = Math.round(60 + 190 * t);
						var gg2 = Math.round(50 + 100 * t);
						var bb2 = Math.round(160 - 110 * t);
						fill = 'rgba(' + rr2 + ',' + gg2 + ',' + bb2 + ',' + alpha + ')';
					}
					// main pebble body
					ctx.beginPath();
					ctx.arc(px, py, r, 0, Math.PI * 2);
					ctx.fillStyle = fill;
					ctx.fill();
					// subtle outer rim — defines packed contact
					ctx.strokeStyle = 'rgba(255,255,255,' + strokeA + ')';
					ctx.lineWidth = 0.85;
					ctx.stroke();
					// inner highlight — hydrogel specular
					ctx.beginPath();
					ctx.arc(px - r * 0.32, py - r * 0.32, r * 0.38, 0, Math.PI * 2);
					ctx.fillStyle = 'rgba(255,255,255,' + (0.16 + 0.14 * (1 - t)).toFixed(3) + ')';
					ctx.fill();
					// inner shadow for volume
					ctx.beginPath();
					ctx.arc(px + r * 0.18, py + r * 0.18, r * 0.72, 0, Math.PI * 2);
					ctx.strokeStyle = 'rgba(0,10,30,0.10)';
					ctx.lineWidth = 0.7;
					ctx.stroke();
				}
			}
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = HY;
	else root.HY = HY;
}(typeof window !== 'undefined' ? window : this));
