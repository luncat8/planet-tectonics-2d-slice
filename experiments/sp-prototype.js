// sp-prototype.js — 0.5.0 M0's headless, FFT-free particle soup.
// This is an experiment, not the soup page. It exists to price and falsify the plan's
// coordinate, solver, size and substep choices before js/sp/ is designed around them.
//
// Book mass and packing size are deliberately different quantities. A size-policy change
// never edits m. Conduction is a symmetric flux on the same pairs as mechanics; its own
// CFL substeps are independent of the displacement clamp. x is periodic, q is w=eta*s in
// screen space or physical depth y in km space.
'use strict';

var TAU = Math.PI * 2;

function alloc(n) {
	return {
		x: new Float64Array(n), q: new Float64Array(n), y: new Float64Array(n),
		J: new Float64Array(n), baseT: new Float64Array(n), anomaly: new Float64Array(n),
		smoothA: new Float64Array(n), smoothB: new Float64Array(n), smoothW: new Float64Array(n),
		T: new Float64Array(n), m: new Float64Array(n),
		diam: new Float64Array(n), pack: new Float64Array(n),
		vx: new Float64Array(n), vy: new Float64Array(n), vq: new Float64Array(n),
		kickX: new Float64Array(n), kickQ: new Float64Array(n),
		oldX: new Float64Array(n), oldQ: new Float64Array(n), oldY: new Float64Array(n),
		rho: new Float64Array(n), lambda: new Float64Array(n),
		gx: new Float64Array(n), gq: new Float64Array(n), gs: new Float64Array(n),
		cx: new Float64Array(n), cq: new Float64Array(n), dT: new Float64Array(n),
		rate: new Float64Array(n), cTop: new Float64Array(n), cBot: new Float64Array(n),
		neigh: new Int32Array(n), colV: new Float64Array(256),
		colN: new Int32Array(256), colSmooth: new Float64Array(256)
	};
}

function wrapDelta(dx, wrap) {
	if (dx > 0.5 * wrap) return dx - wrap;
	if (dx < -0.5 * wrap) return dx + wrap;
	return dx;
}

function heat01(T, lo, hi) {
	var a = (T - lo) / (hi - lo);
	if (a <= 0) return 0;
	if (a >= 1) return 1;
	return a * a * (3 - 2 * a);
}

function makeBand(seed, count, band) {
	var a = new Float64Array(count + 1), p = new Float64Array(count + 1);
	var rnd = (seed * 7919 + 1) & 0x7fffffff, k, sum = 0, scale;
	for (k = 1; k <= count; k++) {
		rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
		a[k] = 0.25 + rnd / 0x7fffffff;
		rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
		p[k] = TAU * rnd / 0x7fffffff;
		sum += a[k] * a[k];
	}
	scale = Math.sqrt(band / sum);
	for (k = 1; k <= count; k++) a[k] *= scale;
	return { a: a, p: p };
}

function initialTemperature(S, x, y, phase) {
	var f = y / S.depth, base = 1 - Math.exp(-y / S.skin);
	var wave = Math.sqrt(1 - S.icBand) * Math.cos(TAU * S.icMode * x / S.wrap + phase);
	for (var k = 1; k <= S.icBandMax; k++) {
		wave += S.bandA[k] * Math.cos(TAU * k * x / S.wrap + S.bandP[k] + phase);
	}
	var T = base + S.icAmp * Math.sin(Math.PI * f) * wave;
	return T < 0 ? 0 : (T > 1 ? 1 : T);
}

function create(options) {
	options = options || {};
	var space = options.space || 'screen';
	var wrap = options.wrap || 16000, depth = options.depth || 2900;
	var yLin = options.yLin || 40, etaBot = Math.asinh(depth / yLin);
	var scale = options.scale || 1300;
	var height = space === 'screen' ? etaBot * scale : depth;
	var nx = options.nx || 256, dx = wrap / nx;
	var rows = options.rows || Math.max(2, Math.round(height / dx));
	var dq = height / rows, d0 = Math.min(dx, dq), n = nx * rows;
	var seed = options.seed === undefined ? 1 : options.seed;
	var band = makeBand(seed, 12, options.icBand === undefined ? 0.6 : options.icBand);
	var S = alloc(n), i, j, p = 0, x, q, y, J, m;
	S.n = n; S.cap = n; S.space = space; S.wrap = wrap; S.depth = depth;
	S.yLin = yLin; S.etaBot = etaBot; S.scale = scale; S.height = height;
	S.nx = nx; S.rows = rows; S.dx = dx; S.dq = dq; S.d0 = d0;
	S.rowSum = new Float64Array(rows); S.rowN = new Int32Array(rows);
	S.rowMean = new Float64Array(rows);
	S.mode = options.mode || 'pbf'; S.sizePolicy = options.sizePolicy || 'uniform';
	S.sizeByHeat = options.sizeByHeat === undefined ? 0.5 : options.sizeByHeat;
	S.pbfIters = options.pbfIters || 2; S.contactIters = options.contactIters || 1;
	S.substepCap = options.substepCap || 0.35; S.heatCfl = options.heatCfl || 0.7;
	S.motionPolicy = options.motionPolicy || 'substep';
	S.heatMode = options.heatMode || 'analytic';
	S.drive = options.drive === undefined ? 35 : options.drive;
	S.buoyancy = options.buoyancy || 'row';
	S.buoySmooth = options.buoySmooth || 0;
	S.inertia = options.inertia || 0;
	S.mobContrast = options.mobContrast === undefined ? 4 : options.mobContrast;
	S.kappa = options.kappa === undefined ? 31.56 : options.kappa;
	S.skin = options.skin || 80; S.icAmp = options.icAmp === undefined ? 0.02 : options.icAmp;
	S.icMode = options.icMode || 4; S.icBand = options.icBand === undefined ? 0.6 : options.icBand;
	S.icBandMax = 12; S.bandA = band.a; S.bandP = band.p; S.seed = seed;
	S.mass0 = 0; S.heat0 = 0; S.wall = 0; S.time = 0; S.frame = 0;
	S.h = 1.5 * d0; S.pairCap = Math.max(64, n * 16);
	S.pi = new Int32Array(S.pairCap); S.pj = new Int32Array(S.pairCap);
	S.pc = new Float64Array(S.pairCap); S.np = 0;
	S.ncx = Math.max(3, Math.floor(wrap / S.h));
	S.ncy = Math.max(1, Math.floor(height / S.h));
	S.hx = wrap / S.ncx; S.hy = height / S.ncy;
	S.cellCount = new Int32Array(S.ncx * S.ncy + 1);
	S.cellStart = new Int32Array(S.ncx * S.ncy + 1);
	S.cellCursor = new Int32Array(S.ncx * S.ncy + 1);
	S.order = new Int32Array(n); S.cellOf = new Int32Array(n);
	S.diag = { kMotion: 1, kHeat: 1, kHeatMax: 1, pairs: 0, neighbours: 0,
		maxNeighbours: 0, nonFinite: 0, wallClamp: 0, motionClip: 0, unsatisfied: 0, maxDensity: 0,
		maxOverlap: 0, vMax: 0, uMax: 0, wells: 0, tMin: 1, tMax: 0,
		heatResidual: 0, massResidual: 0 };
	for (j = 0; j < rows; j++) for (i = 0; i < nx; i++) {
		x = (i + 0.5) * dx;
		q = (j + 0.5) * dq;
		// A small deterministic offset breaks lattice resonances without changing coverage.
		var rnd = (Math.imul(p + 1 + seed * 131, 1103515245) + 12345) & 0x7fffffff;
		x += (rnd / 0x7fffffff - 0.5) * 0.04 * dx;
		rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
		q += (rnd / 0x7fffffff - 0.5) * 0.04 * dq;
		if (space === 'screen') {
			y = yLin * Math.sinh(q / scale);
			J = Math.sqrt(yLin * yLin + y * y);
			m = dx * dq * J / scale;
		} else {
			y = q; J = Math.sqrt(yLin * yLin + y * y); m = dx * dq;
		}
		S.x[p] = x; S.q[p] = q; S.y[p] = y; S.J[p] = J; S.m[p] = m;
		S.T[p] = initialTemperature(S, x, y, 0);
		S.diam[p] = d0; S.pack[p] = 1; S.mass0 += m; S.heat0 += m * S.T[p];
		p++;
	}
	S.massInitial = S.mass0; S.heatInitial = S.heat0;
	S.rest = restDensity(S);
	updateSizes(S);
	buildPairs(S);
	return S;
}

function restDensity(S) {
	var h2 = S.h * S.h, norm = 4 / (Math.PI * Math.pow(S.h, 8));
	var sum = norm * h2 * h2 * h2, i, j, dx, dq, r2;
	for (j = -3; j <= 3; j++) for (i = -3; i <= 3; i++) {
		if (!i && !j) continue;
		dx = i * S.dx; dq = j * S.dq; r2 = dx * dx + dq * dq;
		if (r2 < h2) sum += norm * Math.pow(h2 - r2, 3);
	}
	return sum;
}

function updateSizes(S) {
	var i, d, heat;
	for (i = 0; i < S.n; i++) {
		d = S.d0;
		if (S.sizePolicy === 'material' && (i % 8) === 0) d *= 0.5;
		if (S.sizePolicy === 'heat') {
			heat = heat01(S.T[i], 0.35, 0.85);
			d *= 1 - S.sizeByHeat * heat;
		}
		S.diam[i] = d;
		S.pack[i] = d * d / (S.d0 * S.d0);
	}
}

function rebuildPairCapacity(S) {
	S.pairCap *= 2;
	S.pi = new Int32Array(S.pairCap); S.pj = new Int32Array(S.pairCap);
	S.pc = new Float64Array(S.pairCap);
}

function buildPairs(S) {
	var n = S.n, ncx = S.ncx, ncy = S.ncy, cells = ncx * ncy;
	var counts = S.cellCount, starts = S.cellStart, cursor = S.cellCursor;
	var order = S.order, cellOf = S.cellOf, x = S.x, q = S.q;
	var i, j, cx, cy, ox, oy, nx, cell, c, np = 0, overflow = false;
	counts.fill(0); S.neigh.fill(0);
	for (i = 0; i < n; i++) {
		cx = Math.floor(x[i] / S.hx); cx -= Math.floor(cx / ncx) * ncx;
		cy = Math.floor(q[i] / S.hy);
		if (cy < 0) cy = 0; else if (cy >= ncy) cy = ncy - 1;
		cell = cy * ncx + cx; cellOf[i] = cell; counts[cell]++;
	}
	starts[0] = 0;
	for (c = 0; c < cells; c++) starts[c + 1] = starts[c] + counts[c];
	for (c = 0; c <= cells; c++) cursor[c] = starts[c];
	for (i = 0; i < n; i++) order[cursor[cellOf[i]]++] = i;
	var h2 = S.h * S.h, dx, dq, r2;
	for (cy = 0; cy < ncy; cy++) for (cx = 0; cx < ncx; cx++) {
		cell = cy * ncx + cx;
		for (c = starts[cell]; c < starts[cell + 1]; c++) {
			i = order[c];
			for (oy = -1; oy <= 1; oy++) {
				var yy = cy + oy;
				if (yy < 0 || yy >= ncy) continue;
				for (ox = -1; ox <= 1; ox++) {
					nx = (cx + ox + ncx) % ncx;
					var other = yy * ncx + nx;
					for (var z = starts[other]; z < starts[other + 1]; z++) {
						j = order[z];
						if (j <= i) continue;
						dx = wrapDelta(x[i] - x[j], S.wrap); dq = q[i] - q[j];
						r2 = dx * dx + dq * dq;
						if (r2 >= h2) continue;
						if (np >= S.pairCap) { overflow = true; break; }
						S.pi[np] = i; S.pj[np] = j; np++;
						S.neigh[i]++; S.neigh[j]++;
					}
					if (overflow) break;
				}
				if (overflow) break;
			}
			if (overflow) break;
		}
		if (overflow) break;
	}
	if (overflow) { rebuildPairCapacity(S); return buildPairs(S); }
	S.np = np; S.diag.pairs = np;
	return np;
}

function clearConstraintScratch(S) {
	S.rho.fill(0, 0, S.n); S.lambda.fill(0, 0, S.n);
	S.gx.fill(0, 0, S.n); S.gq.fill(0, 0, S.n); S.gs.fill(0, 0, S.n);
	S.cx.fill(0, 0, S.n); S.cq.fill(0, 0, S.n);
}

function confine(S) {
	var i, x, q, clamps = 0;
	for (i = 0; i < S.n; i++) {
		x = S.x[i]; q = S.q[i];
		x -= Math.floor(x / S.wrap) * S.wrap;
		if (q < 0) { q = 0; clamps++; }
		else if (q > S.height) { q = S.height; clamps++; }
		S.x[i] = x; S.q[i] = q;
	}
	S.diag.wallClamp += clamps;
}

function solvePbf(S) {
	var h2 = S.h * S.h, h8 = Math.pow(S.h, 8), wNorm = 4 / (Math.PI * h8);
	var gNorm = -24 / (Math.PI * h8), rest = S.rest, relax = 1e-5;
	var iter, k, i, j, dx, dq, r2, a, w, gx, gq, gl, c, maxC;
	var pi = S.pi, pj = S.pj, np = S.np;
	S.diag.unsatisfied = 0; S.diag.maxDensity = 0;
	for (iter = 0; iter < S.pbfIters; iter++) {
		clearConstraintScratch(S);
		for (i = 0; i < S.n; i++) S.rho[i] = S.pack[i] * wNorm * h2 * h2 * h2;
		for (k = 0; k < np; k++) {
			i = pi[k]; j = pj[k];
			dx = wrapDelta(S.x[i] - S.x[j], S.wrap); dq = S.q[i] - S.q[j];
			r2 = dx * dx + dq * dq; a = h2 - r2;
			if (a <= 0) continue;
			w = wNorm * a * a * a;
			S.rho[i] += S.pack[j] * w; S.rho[j] += S.pack[i] * w;
			a = gNorm * a * a; gx = a * dx; gq = a * dq;
			S.gx[i] += S.pack[j] * gx; S.gq[i] += S.pack[j] * gq;
			S.gx[j] -= S.pack[i] * gx; S.gq[j] -= S.pack[i] * gq;
			gl = gx * gx + gq * gq;
			S.gs[i] += S.pack[j] * S.pack[j] * gl / (rest * rest);
			S.gs[j] += S.pack[i] * S.pack[i] * gl / (rest * rest);
		}
		maxC = 0;
		for (i = 0; i < S.n; i++) {
			S.gs[i] += (S.gx[i] * S.gx[i] + S.gq[i] * S.gq[i]) / (rest * rest);
			c = S.rho[i] / rest - 1;
			if (c > maxC) maxC = c;
			if (c > 0.02 && iter === S.pbfIters - 1) S.diag.unsatisfied++;
			S.lambda[i] = c > 0 ? -c / (S.gs[i] + relax) : 0;
		}
		S.diag.maxDensity = maxC;
		for (k = 0; k < np; k++) {
			i = pi[k]; j = pj[k];
			dx = wrapDelta(S.x[i] - S.x[j], S.wrap); dq = S.q[i] - S.q[j];
			r2 = dx * dx + dq * dq; a = h2 - r2;
			if (a <= 0) continue;
			a = gNorm * a * a; gx = a * dx; gq = a * dq;
			c = (S.lambda[i] + S.lambda[j]) / rest;
			S.cx[i] += S.pack[j] * c * gx; S.cq[i] += S.pack[j] * c * gq;
			S.cx[j] -= S.pack[i] * c * gx; S.cq[j] -= S.pack[i] * c * gq;
		}
		for (i = 0; i < S.n; i++) {
			dx = S.cx[i]; dq = S.cq[i];
			a = Math.sqrt(dx * dx + dq * dq);
			if (a > S.substepCap * S.d0) { c = S.substepCap * S.d0 / a; dx *= c; dq *= c; }
			S.x[i] += dx; S.q[i] += dq;
		}
		confine(S);
	}
}

function solveContact(S) {
	var iter, k, i, j, dx, dq, r2, r, reach, push, c;
	var pi = S.pi, pj = S.pj, np = S.np;
	for (iter = 0; iter < S.contactIters; iter++) {
		S.cx.fill(0, 0, S.n); S.cq.fill(0, 0, S.n);
		for (k = 0; k < np; k++) {
			i = pi[k]; j = pj[k];
			dx = wrapDelta(S.x[i] - S.x[j], S.wrap); dq = S.q[i] - S.q[j];
			r2 = dx * dx + dq * dq; reach = 0.5 * (S.diam[i] + S.diam[j]);
			if (r2 >= reach * reach) continue;
			r = Math.sqrt(r2);
			if (r < 1e-12) { dx = ((i + j) & 1) ? 1e-12 : -1e-12; dq = 0; r = 1e-12; }
			push = 0.5 * (reach - r) / r;
			S.cx[i] += dx * push; S.cq[i] += dq * push;
			S.cx[j] -= dx * push; S.cq[j] -= dq * push;
		}
		for (i = 0; i < S.n; i++) {
			dx = S.cx[i]; dq = S.cq[i]; r = Math.sqrt(dx * dx + dq * dq);
			if (r > S.substepCap * S.d0) { c = S.substepCap * S.d0 / r; dx *= c; dq *= c; }
			S.x[i] += dx; S.q[i] += dq;
		}
		confine(S);
	}
}

function updateMetric(S) {
	for (var i = 0; i < S.n; i++) {
		if (S.space === 'screen') S.y[i] = S.yLin * Math.sinh(S.q[i] / S.scale);
		else S.y[i] = S.q[i];
		S.J[i] = Math.sqrt(S.yLin * S.yLin + S.y[i] * S.y[i]);
		S.baseT[i] = 1 - Math.exp(-S.y[i] / S.skin);
	}
}

function pairConductance(S) {
	var i, k, p, q, dx, dy, r2, axis, harmonic, c;
	S.rate.fill(0, 0, S.n);
	for (i = 0; i < S.n; i++) {
		var dy0 = 0.5 * S.dq * S.J[i] / (S.space === 'screen' ? S.scale : 1);
		var top = Math.max(S.y[i], 0.5 * dy0, 1e-6);
		var bot = Math.max(S.depth - S.y[i], 0.5 * dy0, 1e-6);
		S.cTop[i] = S.m[i] / (top * top);
		S.cBot[i] = S.m[i] / (bot * bot);
		S.rate[i] = (S.cTop[i] + S.cBot[i]) / S.m[i];
	}
	for (k = 0; k < S.np; k++) {
		p = S.pi[k]; q = S.pj[k];
		dx = wrapDelta(S.x[p] - S.x[q], S.wrap); dy = S.y[p] - S.y[q];
		r2 = dx * dx + dy * dy;
		if (r2 < 1e-16) continue;
		axis = (dx * dx * dx * dx + dy * dy * dy * dy) / (r2 * r2);
		harmonic = 2 * S.m[p] * S.m[q] / (S.m[p] + S.m[q]);
		c = harmonic * axis / r2;
		S.pc[k] = c;
		S.rate[p] += c / S.m[p]; S.rate[q] += c / S.m[q];
	}
	var maxRate = 0;
	for (i = 0; i < S.n; i++) if (S.rate[i] > maxRate) maxRate = S.rate[i];
	return maxRate;
}

function conduct(S, dt) {
	var maxRate = pairConductance(S);
	var k = Math.max(1, Math.ceil(maxRate * S.kappa * dt / S.heatCfl));
	var hdt = dt / k, step, p, q, i, flux, c;
	for (step = 0; step < k; step++) {
		S.dT.fill(0, 0, S.n);
		for (var z = 0; z < S.np; z++) {
			p = S.pi[z]; q = S.pj[z]; c = S.pc[z];
			flux = hdt * S.kappa * c * (S.T[p] - S.T[q]);
			S.dT[p] -= flux / S.m[p]; S.dT[q] += flux / S.m[q];
		}
		for (i = 0; i < S.n; i++) {
			flux = hdt * S.kappa * S.cTop[i] * (0 - S.T[i]);
			S.dT[i] += flux / S.m[i]; S.wall += flux;
			flux = hdt * S.kappa * S.cBot[i] * (1 - S.T[i]);
			S.dT[i] += flux / S.m[i]; S.wall += flux;
		}
		for (i = 0; i < S.n; i++) S.T[i] += S.dT[i];
	}
	S.diag.kHeat = k;
	if (k > S.diag.kHeatMax) S.diag.kHeatMax = k;
}

function conductAnalytic(S, dt) {
	pairConductance(S);
	var i, oldT, nextT, rate, wallT, cSum, flip = S.heatFlip ? 1 : 0;
	S.heatFlip = !S.heatFlip;
	// Each wall operation is the exact solution of its two Dirichlet relaxations. Each pair
	// operation is the exact solution of its two-capacity exchange. Both are convex and
	// conserve the book for any dt; alternating pair direction removes a fixed sweep bias.
	for (i = 0; i < S.n; i++) {
		cSum = S.cTop[i] + S.cBot[i];
		if (!(cSum > 0)) continue;
		oldT = S.T[i]; wallT = S.cBot[i] / cSum;
		rate = dt * S.kappa * cSum / S.m[i];
		nextT = wallT + (oldT - wallT) * Math.exp(-rate);
		S.T[i] = nextT; S.wall += S.m[i] * (nextT - oldT);
	}
	var z, p, q, c, a, total, Ti, Tj;
	for (var zz = 0; zz < S.np; zz++) {
		z = flip ? S.np - 1 - zz : zz;
		p = S.pi[z]; q = S.pj[z]; c = S.pc[z];
		if (!(c > 0)) continue;
		rate = dt * S.kappa * c * (1 / S.m[p] + 1 / S.m[q]);
		a = rate < 1e-5 ? rate * (1 - 0.5 * rate) : 1 - Math.exp(-rate);
		total = S.m[p] + S.m[q]; Ti = S.T[p]; Tj = S.T[q];
		S.T[p] = Ti + a * S.m[q] / total * (Tj - Ti);
		S.T[q] = Tj + a * S.m[p] / total * (Ti - Tj);
	}
	S.diag.kHeat = 1; S.diag.kHeatMax = 1;
}

function updateAnomaly(S) {
	if (S.buoyancy !== 'row') {
		for (var i = 0; i < S.n; i++) {
			S.anomaly[i] = S.buoyancy === 'absolute' ? S.T[i] - 0.5 : S.T[i] - S.baseT[i];
		}
		return smoothAnomaly(S);
	}
	S.rowSum.fill(0); S.rowN.fill(0);
	var i, row, mean = 0;
	for (i = 0; i < S.n; i++) {
		row = Math.floor(S.q[i] / S.height * S.rows);
		if (row < 0) row = 0; else if (row >= S.rows) row = S.rows - 1;
		S.rowSum[row] += S.T[i]; S.rowN[row]++; mean += S.T[i];
	}
	mean /= S.n;
	for (row = 0; row < S.rows; row++) S.rowMean[row] = S.rowN[row] ? S.rowSum[row] / S.rowN[row] : mean;
	for (i = 0; i < S.n; i++) {
		row = Math.floor(S.q[i] / S.height * S.rows);
		if (row < 0) row = 0; else if (row >= S.rows) row = S.rows - 1;
		S.anomaly[i] = S.T[i] - S.rowMean[row];
	}
	smoothAnomaly(S);
}

function smoothAnomaly(S) {
	if (!S.buoySmooth || !S.np) return;
	S.smoothA.set(S.anomaly);
	for (var pass = 0; pass < S.buoySmooth; pass++) {
		S.smoothB.set(S.smoothA); S.smoothW.fill(1, 0, S.n);
		for (var k = 0; k < S.np; k++) {
			var i = S.pi[k], j = S.pj[k];
			var dx = wrapDelta(S.x[i] - S.x[j], S.wrap), dq = S.q[i] - S.q[j];
			var a = Math.max(0, 1 - (dx * dx + dq * dq) / (S.h * S.h));
			var w = a * a;
			S.smoothB[i] += w * S.smoothA[j]; S.smoothB[j] += w * S.smoothA[i];
			S.smoothW[i] += w; S.smoothW[j] += w;
		}
		for (var p = 0; p < S.n; p++) S.smoothA[p] = S.smoothB[p] / S.smoothW[p];
	}
	S.anomaly.set(S.smoothA);
}

function buoyVelocity(S, i) {
	var mob = Math.exp(S.mobContrast * (S.T[i] - 0.5));
	return -S.drive * S.anomaly[i] * mob;
}

function predictCount(S, dt) {
	if (S.motionPolicy === 'clip') return 1;
	var i, vx, vy, qv, max = 0, a, gamma = Math.pow(S.inertia, dt / 0.05);
	for (i = 0; i < S.n; i++) {
		vy = buoyVelocity(S, i);
		vx = gamma * S.vx[i] + (1 - gamma) * S.kickX[i];
		qv = gamma * S.vq[i] + (1 - gamma) * (S.kickQ[i] +
			(S.space === 'screen' ? vy * S.scale / S.J[i] : vy));
		a = Math.max(Math.abs(vx * dt), Math.abs(qv * dt));
		if (a > max) max = a;
	}
	return Math.max(1, Math.ceil(max / (S.substepCap * S.d0)));
}

function motion(S, dt, refresh) {
	var i, vy, qv, dx, dq, len, clip, gamma = Math.pow(S.inertia, dt / 0.05);
	if (refresh) updateAnomaly(S);
	for (i = 0; i < S.n; i++) {
		S.oldX[i] = S.x[i]; S.oldQ[i] = S.q[i]; S.oldY[i] = S.y[i];
		vy = buoyVelocity(S, i);
		qv = gamma * S.vq[i] + (1 - gamma) * (S.kickQ[i] +
			(S.space === 'screen' ? vy * S.scale / S.J[i] : vy));
		dx = (gamma * S.vx[i] + (1 - gamma) * S.kickX[i]) * dt;
		dq = qv * dt;
		if (S.motionPolicy === 'clip') {
			len = Math.sqrt(dx * dx + dq * dq);
			if (len > S.substepCap * S.d0) {
				clip = S.substepCap * S.d0 / len; dx *= clip; dq *= clip;
				S.diag.motionClip++;
			}
		}
		S.x[i] += dx; S.q[i] += dq;
	}
	confine(S); buildPairs(S);
	if (S.mode === 'contact') solveContact(S); else solvePbf(S);
	updateMetric(S);
	for (i = 0; i < S.n; i++) {
		S.vx[i] = wrapDelta(S.x[i] - S.oldX[i], S.wrap) / dt;
		S.vq[i] = (S.q[i] - S.oldQ[i]) / dt;
		S.vy[i] = (S.y[i] - S.oldY[i]) / dt;
	}
}

function diagnostics(S) {
	var i, heat = 0, mass = 0, tMin = Infinity, tMax = -Infinity;
	var vMax = 0, uMax = 0, bad = 0, maxNeigh = 0;
	S.colV.fill(0); S.colN.fill(0);
	for (i = 0; i < S.n; i++) {
		if (!isFinite(S.x[i] + S.q[i] + S.y[i] + S.T[i] + S.vx[i] + S.vy[i] + S.vq[i])) bad++;
		heat += S.m[i] * S.T[i]; mass += S.m[i];
		if (S.T[i] < tMin) tMin = S.T[i]; if (S.T[i] > tMax) tMax = S.T[i];
		if (Math.abs(S.vy[i]) > vMax) vMax = Math.abs(S.vy[i]);
		if (Math.abs(S.vx[i]) > uMax) uMax = Math.abs(S.vx[i]);
		if (S.neigh[i] > maxNeigh) maxNeigh = S.neigh[i];
		var col = Math.floor(S.x[i] / S.wrap * 128) & 127;
		S.colV[col] += S.vy[i]; S.colN[col]++;
	}
	for (i = 0; i < 128; i++) {
		S.colV[i] = S.colN[i] ? S.colV[i] / S.colN[i] : 0;
		S.colSmooth[i] = 0.25 * S.colV[(i + 127) & 127] + 0.5 * S.colV[i] + 0.25 * S.colV[(i + 1) & 127];
	}
	var transitions = 0, prev = 0, first = 0, sign;
	for (i = 0; i < 128; i++) {
		sign = S.colSmooth[i] > 1e-6 ? 1 : (S.colSmooth[i] < -1e-6 ? -1 : 0);
		if (!sign) continue;
		if (first && sign !== prev) transitions++;
		if (!first) first = sign;
		prev = sign;
	}
	if (first && prev !== first) transitions++;
	S.diag.wells = transitions >> 1;
	S.diag.nonFinite = bad; S.diag.tMin = tMin; S.diag.tMax = tMax;
	S.diag.vMax = vMax; S.diag.uMax = uMax; S.diag.maxNeighbours = maxNeigh;
	S.diag.neighbours = 2 * S.np / S.n;
	var heatGap = Math.abs(heat - S.heatInitial - S.wall);
	S.diag.heatAbsolute = heatGap;
	S.diag.heatResidual = heatGap / Math.max(1, Math.abs(S.heatInitial));
	S.diag.heatWallResidual = heatGap / Math.max(1, Math.abs(S.wall));
	S.diag.massResidual = Math.abs(mass - S.massInitial) / S.massInitial;
	S.diag.heat = heat; S.diag.mass = mass;
	return S.diag;
}

function step(S, dt) {
	if (!(dt > 0)) return S.diag;
	updateSizes(S); updateMetric(S); updateAnomaly(S);
	S.diag.wallClamp = 0; S.diag.motionClip = 0; S.diag.kHeatMax = 1;
	var kMotion = predictCount(S, dt), k, hdt = dt / kMotion;
	S.diag.kMotion = kMotion;
	for (k = 0; k < kMotion; k++) {
		motion(S, hdt, k > 0);
		if (S.heatMode === 'explicit') conduct(S, hdt); else conductAnalytic(S, hdt);
	}
	S.time += dt; S.frame++;
	return diagnostics(S);
}

function snapshot(S) {
	var d = S.diag;
	return {
		n: S.n, mode: S.mode, space: S.space, sizePolicy: S.sizePolicy, heatMode: S.heatMode,
		buoyancy: S.buoyancy, inertia: S.inertia,
		frames: S.frame, timeMyr: S.time, pairs: S.np,
		neighbours: d.neighbours, maxNeighbours: d.maxNeighbours,
		kMotion: d.kMotion, kHeat: d.kHeat, kHeatMax: d.kHeatMax,
		vMax: d.vMax, uMax: d.uMax, wells: d.wells,
		tMin: d.tMin, tMax: d.tMax, nonFinite: d.nonFinite,
		heatResidual: d.heatResidual, heatAbsolute: d.heatAbsolute,
		heatWallResidual: d.heatWallResidual, massResidual: d.massResidual,
		unsatisfied: d.unsatisfied, maxDensity: d.maxDensity,
		wallClamp: d.wallClamp, motionClip: d.motionClip
	};
}

function pairFixture(space, cap) {
	var S = create({ nx: 4, rows: 4, space: space || 'km', mode: 'contact',
		drive: 0, kappa: 0, icAmp: 0, mobContrast: 0, substepCap: cap });
	S.n = 2;
	var d = S.d0;
	for (var i = 0; i < 2; i++) {
		S.x[i] = 0.5 * S.wrap; S.q[i] = 0.5 * S.height + (i ? 0.6 : -0.6) * d;
		S.T[i] = 0.5; S.m[i] = 1; S.diam[i] = d; S.pack[i] = 1;
		S.kickX[i] = 0; S.kickQ[i] = 0;
	}
	updateMetric(S); buildPairs(S);
	return S;
}

function tunnelTest(space, cap) {
	var S = pairFixture(space, cap), d = S.d0;
	S.kickQ[0] = 4 * d; S.kickQ[1] = -4 * d;
	step(S, 1);
	return { crossed: S.q[0] > S.q[1], separation: Math.abs(S.q[1] - S.q[0]) / d,
		substeps: S.diag.kMotion, nonFinite: S.diag.nonFinite };
}

function displayStats(S, width, height) {
	width = width || 1280; height = height || 520;
	var minRatio = Infinity, maxRatio = 0, sumRatio = 0, outside = 0, bad = 0;
	var i, cx, cy, rx, ry, e0, e1, ratio;
	for (i = 0; i < S.n; i++) {
		cx = S.x[i] / S.wrap * width;
		rx = 0.5 * S.diam[i] / S.wrap * width;
		if (S.space === 'screen') {
			cy = S.q[i] / S.height * height;
			ry = 0.5 * S.diam[i] / S.height * height;
		} else {
			e0 = Math.asinh(Math.max(0, S.y[i] - 0.5 * S.diam[i]) / S.yLin) / S.etaBot;
			e1 = Math.asinh(Math.min(S.depth, S.y[i] + 0.5 * S.diam[i]) / S.yLin) / S.etaBot;
			cy = 0.5 * (e0 + e1) * height; ry = 0.5 * (e1 - e0) * height;
		}
		if (!isFinite(cx + cy + rx + ry) || !(ry > 0)) { bad++; continue; }
		if (cx < 0 || cx > width || cy < 0 || cy > height) outside++;
		ratio = rx / ry; sumRatio += ratio;
		if (ratio < minRatio) minRatio = ratio;
		if (ratio > maxRatio) maxRatio = ratio;
	}
	return { n: S.n, width: width, height: height, nonFinite: bad, outsideCenters: outside,
		rxOverRyMin: minRatio, rxOverRyMax: maxRatio, rxOverRyMean: sumRatio / Math.max(1, S.n - bad) };
}

function svg(S, title, width, height) {
	width = width || 1280; height = height || 520;
	var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
		'<rect width="100%" height="100%" fill="#080d18"/>',
		'<text x="12" y="22" fill="#dbe7ff" font-family="monospace" font-size="14">' + title + '</text>'];
	var i, cx, cy, rx, ry, T, r, g, b, e0, e1;
	for (i = 0; i < S.n; i++) {
		cx = S.x[i] / S.wrap * width;
		rx = 0.5 * S.diam[i] / S.wrap * width;
		if (S.space === 'screen') {
			cy = S.q[i] / S.height * height;
			ry = 0.5 * S.diam[i] / S.height * height;
		} else {
			e0 = Math.asinh(Math.max(0, S.y[i] - 0.5 * S.diam[i]) / S.yLin) / S.etaBot;
			e1 = Math.asinh(Math.min(S.depth, S.y[i] + 0.5 * S.diam[i]) / S.yLin) / S.etaBot;
			cy = 0.5 * (e0 + e1) * height; ry = Math.max(0.25, 0.5 * (e1 - e0) * height);
		}
		T = Math.max(0, Math.min(1, S.T[i]));
		r = Math.round(255 * Math.min(1, 2 * T));
		b = Math.round(255 * Math.min(1, 2 * (1 - T)));
		g = Math.round(150 * (1 - Math.abs(2 * T - 1)) + 30);
		out.push('<ellipse cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" rx="' + Math.max(0.3, rx).toFixed(2) + '" ry="' + Math.max(0.3, ry).toFixed(2) + '" fill="rgb(' + r + ',' + g + ',' + b + ')"/>');
	}
	out.push('</svg>');
	return out.join('\n');
}

module.exports = { create: create, step: step, diagnostics: diagnostics, snapshot: snapshot,
	tunnelTest: tunnelTest, displayStats: displayStats, svg: svg, restDensity: restDensity };
