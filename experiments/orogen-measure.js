// orogen-measure.js — 0.1.8 M0: which representation carries the orogen a collision built?
//
// The collision brake in PLT.basal is proportional to what the belt scan measures *this
// frame* (COL.beltAt -> beltW), so a belt that the contact has already redistributed, or
// one whose flanks have risen with it, can report a small orogen while a large one stands
// there. R4 asks for arrest by the orogen the collision has built, not by a snapshot of
// it, and 0.1.8-plan.md §3 names two candidates to measure before either becomes a kernel
// constant:
//
//   A. plateau excess volume — the felsic inventory above hFelLand0 in a declared,
//      moving catchment around the contact. Derived from the stacks, no new state.
//   B. decaying edge memory — a bounded scalar on the collision boundary that records the
//      belt width the edge has built, fast to build and slow to forget in /Myr units.
//
// Both candidates are run through the *same brake hook* as the incumbent, so the three
// differ only in the measure W they put in
//
//   m = k * W * fb * (-edgeRelN) / vRef        (m2/Myr, a line force, as PLT.basal's)
//
// and each is fitted by the smallest k that meets R4's arrest contract on the fit seed,
// then checked on the other. The fixture, the drive and the collision-site walk are
// shared with experiments/r4-check.js through lib.js, so the two cannot drift.
//
// The fixture-scoped gates below are the audit's contracts read on this run: R1 (the
// events move the drawn surface no more than the rest of their own frame), R2 (a collision
// is a belt, not a needle), R3 (the ceiling, with the dt-aware allowance), R5 (no site
// changes twice inside evGap). 0.1.8 M2 still owes the four strict contact-audit legs on
// the integrated kernel; this script only decides which representation the kernel takes.
//
// run:  node experiments/orogen-measure.js [frames=4000] [fitSeed=1] [checkSeed=5] [kyr=50]

'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom,
	PLT = L.mods.plates, COL = L.mods.columns;
var check = L.check;

var FRAMES = Number(process.argv[2]) || 4000;
var FIT_SEED = Number(process.argv[3]) || 1;
var CHK_SEED = Number(process.argv[4]) || 5;
var KYR = Number(process.argv[5]) || 50;
var DRIVE = 15e3;                 // m/Myr per continent: the prescribed 30 mm/yr closing
var DT_FRAME = KYR / 1e3;         // Myr per frame (KYR is kyr/frame)
var TAU_BUILD = 1;                // Myr, candidate B: the edge records what it is building
var TAU_FORGET = 50;              // Myr, candidate B: and forgets it on a geological one
var SWEEP = [2e5, 5e5, 1e6, 2e6, 4e6, 1e7, 3e7];   // m/Myr; vColl is 2e5, so the sweep starts there

var basal = PLT.basal;
var MEM = new Float64Array(P.colCap);        // candidate B, per edge slot, metres

// --- the measures -----------------------------------------------------------------

// A. The felsic excess over the undeformed reference in the catchment the contact owns:
// the pair, then outward while the crust is still above reference + beltRise, capped at
// beltMaxCols a side, stopped by a draining record. Returns the area in m2 and leaves the
// column count in A_COLS; the walk is the same shape as COL.beltAt's, so "the belt" means
// the same stretch of ground in both. The area is what the catchment holds, and dividing
// it by the same beltRise the walk tests against gives a width in metres, so candidate A
// carries the same units into the force as the belt scan and the memory do.
var A_REF = 0;
function vexAt(st, i) {
	var n = st.nCol, j = i + 1 < n ? i + 1 : 0, k, c, e, area = 0;
	A_REF = P.hFelLand0 + P.beltRise;
	for (c = 0; c < 2; c++) {
		e = st.hFel[c === 0 ? i : j] - P.hFelLand0;
		if (e > 0) area += e * st.colW[c === 0 ? i : j];
	}
	for (k = 1; k <= P.beltMaxCols; k++) {
		c = i - k; if (c < 0) c += n;
		if (c === j || st.colGhost[c] || !(st.hFel[c] >= A_REF)) break;
		e = st.hFel[c] - P.hFelLand0;
		if (e > 0) area += e * st.colW[c];
	}
	for (k = 1; k <= P.beltMaxCols; k++) {
		c = (j + k) % n;
		if (c === i || st.colGhost[c] || !(st.hFel[c] >= A_REF)) break;
		e = st.hFel[c] - P.hFelLand0;
		if (e > 0) area += e * st.colW[c];
	}
	return area;
}

function plateWidth(p) {
	var w = 0, i;
	for (i = 0; i < S.nCol; i++) if (S.colPlate[i] === p) w += S.colW[i];
	return w;
}

// --- the brake hook ---------------------------------------------------------------

// The drive is a force, not a velocity (r4-check): PLT.solve multiplies every m2/Myr term
// by 1/cD, so the prescribed push goes in pre-multiplied and lands on the plate target as
// DRIVE. The candidate brake uses PLT.basal's own sign convention on the same term.
function makeHook(mode, k) {
	return function (st) {
		basal.call(PLT, st);
		var dt = SIM.dG, n = st.nCol, i, j, p, q, m, w, fb, close;
		var aUp = 1 - Math.exp(-dt / TAU_BUILD), aDown = 1 - Math.exp(-dt / TAU_FORGET);
		var cD = PLT.cD(SIM.Tm);
		for (i = 0; i < n; i++) {
			p = st.colPlate[i];
			if (p === 0) PLT.wB[i] += DRIVE * cD;
			else if (p === 1) PLT.wB[i] -= DRIVE * cD;
		}
		for (i = 0; i < n; i++) {
			j = i + 1 < n ? i + 1 : 0;
			// candidate B records every real edge, so the memory is the boundary's own
			// history and not a function of which plate pair is being braked
			if (st.edge[i] === P.EDGE.collide && !st.colGhost[i] && !st.colGhost[j]) {
				COL.beltAt(st, n, i);
				w = COL.beltW;
				MEM[i] += (w > MEM[i] ? aUp : aDown) * (w - MEM[i]);
			} else MEM[i] -= MEM[i] * aDown;
			if (mode === 'instant' || mode === 'off') continue;
			if (st.edge[i] !== P.EDGE.collide || st.colGhost[i] || st.colGhost[j]) continue;
			// the prescribed collision only: the fixture has one, and a candidate must not
			// brake the rift the drive opens behind it
			if (st.colPlate[i] > 1 || st.colPlate[j] > 1) continue;
			close = -st.edgeRelN[i];
			if (!(close > 0)) continue;
			COL.beltAt(st, n, i);
			fb = COL.beltFel / P.hFelLand0;
			if (fb > 2) fb = 2;
			w = mode === 'A' ? vexAt(st, i) / P.beltRise : MEM[i];
			m = k * w * fb * close / P.vRef;
			p = st.colPlate[i]; q = st.colPlate[j];
			PLT.fP[p] -= m; PLT.fP[q] += m;
		}
	};
}

// --- the run ----------------------------------------------------------------------

// One R4 run under one brake. `instant` keeps PLT.basal's own term with the swept k
// (P.vColl = k); A and B switch that term off (P.vColl = 0) and add theirs, so no run
// ever carries two collision brakes.
function run(seed, mode, k) {
	var out = {
		mode: mode, k: k, seed: seed,
		t: new Float64Array(FRAMES), close: new Float64Array(FRAMES),
		wBelt: new Float64Array(FRAMES), root: new Float64Array(FRAMES),
		wA: new Float64Array(FRAMES), wB: new Float64Array(FRAMES),
		gap: new Float64Array(FRAMES), floorAt: -1,
		live: 0, lost: -1, maxH: 0, ms: 0,
		nStart: 0, nEnd: 0, pw0Start: 0, pw0End: 0, pw1Start: 0, pw1End: 0,
		peakR: 0, peakRf: -1, peakRi: -1, contR: 0, contRf: -1, prof: new Float64Array(8),
		bumps: 0, wide: 0, runWorst: 99,
		siteDz: 0, awayDz: 0, quietDz: 0,
		births: 0, deaths: 0, flipRepeat: 0, birthRepeat: 0, deathRepeat: 0
	};
	var keepV = P.vColl, keepD = P.kDam, t0 = Date.now(), i, f;
	P.kDam = 0;                  // the drive diverges the far field; damage would split it
	P.vColl = mode === 'instant' ? k : 0;
	check.twoContinents(seed);
	SIM.setGeo(KYR * 1e3);
	MEM.fill(0, 0, S.nCol);
	PLT.basal = makeHook(mode, k);
	G.init();
	G.sampleZ(G.prevZ);
	out.nStart = S.nCol;
	out.pw0Start = plateWidth(0); out.pw1Start = plateWidth(1);
	for (f = 0; f < FRAMES; f++) {
		G.pre();
		SIM.step();
		G.events(f, out);
		G.gates(f, out);
		var c = check.collisionSite();
		if (c < 0) { if (out.lost < 0) out.lost = f; continue; }
		COL.beltAt(S, S.nCol, c);
		var j = c + 1 < S.nCol ? c + 1 : 0;
		out.t[out.live] = SIM.t;
		out.close[out.live] = -S.edgeRelN[c];
		out.wBelt[out.live] = COL.beltW;
		out.root[out.live] = Math.max(S.hTot[c], S.hTot[j]) - COL.flankH;
		out.wA[out.live] = vexAt(S, c) / P.beltRise;
		out.wB[out.live] = MEM[c];
		var gap = S.colX[j] - S.colX[c];
		if (gap < 0) gap += P.wrap;
		out.gap[out.live] = gap;
		if (out.floorAt < 0 && gap <= P.gFloor * P.w0 * 1.01) out.floorAt = f;
		out.live++;
	}
	out.ms = (Date.now() - t0) / FRAMES;
	out.nEnd = S.nCol;
	out.pw0End = plateWidth(0); out.pw1End = plateWidth(1);
	PLT.basal = basal;
	P.vColl = keepV;
	P.kDam = keepD;
	return out;
}

// --- the audit's contracts, read on this fixture -----------------------------------
//
// The same arithmetic as experiments/contact-audit.js, on the same state: the sample
// raster, the record match by position, the event buckets and the site-repeat table. The
// four-leg audit itself runs the whole planet in M2/M3; a candidate that fails here has
// already failed there, and the decision should not need the whole planet to be made.
var G = {
	NS: 2048, step: 0, sample: null, prevZ: null,
	preX: null, preTh: null, preW: null, preG: null, preNew: null,
	MATCH: null, PRE: null, CONSUMED: null, siteB: null, siteD: null, SX: null,
	init: function () {
		this.step = P.wrap / this.NS;
		this.sample = new Float64Array(this.NS);
		this.prevZ = new Float64Array(this.NS);
		this.preX = new Float64Array(P.colCap);
		this.preTh = new Float64Array(P.colCap);
		this.preW = new Float64Array(P.colCap);
		this.preG = new Uint8Array(P.colCap);
		this.preNew = new Uint8Array(P.colCap);
		this.MATCH = new Int32Array(P.colCap);
		this.PRE = new Int32Array(P.colCap);
		this.CONSUMED = new Int32Array(P.colCap);
		this.siteB = new Int32Array(4096).fill(-1);
		this.siteD = new Int32Array(4096).fill(-1);
		this.SX = new Float64Array(64);
	},
	// the drawn surface on a 2048-point raster, the same picture the audit samples
	sampleZ: function (out) {
		var n = S.nCol, m, lo, hi, mid, k, km, d, dl, f, x;
		if (n === 0) { out.fill(0); return; }
		for (m = 0; m < this.NS; m++) {
			x = m * this.step;
			lo = 0; hi = n;
			while (lo < hi) { mid = (lo + hi) >> 1; if (S.colX[mid] < x) lo = mid + 1; else hi = mid; }
			k = lo < n ? lo : 0;
			km = k > 0 ? k - 1 : n - 1;
			dl = x - S.colX[km]; if (dl < 0) dl += P.wrap;
			d = S.colX[k] - S.colX[km]; if (d <= 0) d += P.wrap;
			f = d > 0 ? dl / d : 0;
			out[m] = S.z[km] + (S.z[k] - S.z[km]) * f;
		}
	},
	pre: function () {
		var n = S.nCol, i;
		for (i = 0; i < n; i++) {
			this.preX[i] = S.colX[i]; this.preTh[i] = S.hTot[i]; this.preW[i] = S.colW[i];
			this.preG[i] = S.colGhost[i]; this.preNew[i] = COL.isNew[i];
		}
		this.preN = n;
	},
	// R1/R5: the frames's event sites (births and deaths), the drawn move at a site against
	// the move elsewhere on the same frame, and a site that changes twice inside evGap.
	events: function (f, out) {
		var n = S.nCol, i, k, half = 0.4 * P.w0, site, d, ns = 0;
		this.match();
		for (k = 0; k < this.nCons; k++) {
			if (this.preG[this.CONSUMED[k]]) continue;      // already draining: not a death
			site = Math.floor(this.preX[this.CONSUMED[k]] / (2.5 * P.w0));
			if (ns < this.SX.length) this.SX[ns++] = site * 2.5 * P.w0;
			out.deaths++;
			if (this.siteB[site & 4095] >= 0 && f - this.siteB[site & 4095] < P.evGap) out.flipRepeat++;
			if (this.siteD[site & 4095] >= 0 && f - this.siteD[site & 4095] < P.evGap) out.deathRepeat++;
			this.siteD[site & 4095] = f;
		}
		for (i = 0; i < n; i++) {
			if (S.colGhost[i] || S.colW[i] < half) continue;
			if (!COL.isNew[i] || (this.MATCH[i] >= 0 && this.preNew[this.MATCH[i]])) continue;
			site = Math.floor(S.colX[i] / (2.5 * P.w0));
			if (ns < this.SX.length) this.SX[ns++] = site * 2.5 * P.w0;
			out.births++;
			if (this.siteD[site & 4095] >= 0 && f - this.siteD[site & 4095] < P.evGap) out.flipRepeat++;
			if (this.siteB[site & 4095] >= 0 && f - this.siteB[site & 4095] < P.evGap) out.birthRepeat++;
			this.siteB[site & 4095] = f;
		}
		this.nSites = ns;
		this.event = ns > 0;
		this.sampleZ(this.sample);
		for (i = 0; i < this.NS; i++) {
			d = this.sample[i] - this.prevZ[i];
			if (d < 0) d = -d;
			if (d > 0) {
				if (this.event) {
					if (this.atSite(i * this.step)) { if (d > out.siteDz) out.siteDz = d; }
					else if (d > out.awayDz) out.awayDz = d;
				} else if (d > out.quietDz) out.quietDz = d;
			}
			this.prevZ[i] = this.sample[i];
		}
	},
	atSite: function (x) {
		var t, d;
		for (t = 0; t < this.nSites; t++) {
			d = x - this.SX[t];
			if (d > P.wrap * 0.5) d -= P.wrap;
			else if (d < -P.wrap * 0.5) d += P.wrap;
			if (d > -1.5 * P.w0 && d < 1.5 * P.w0) return true;
		}
		return false;
	},
	// the audit's merge walk: the record before the step that is the same record as i
	// (MATCH[i]), and the records a draining successor replaced (CONSUMED)
	match: function () {
		var n = S.nCol, thenN = this.preN, half = 0.4 * P.w0, k, i, a, b = 0, e, x, d, cs = 0, ps = 0;
		if (thenN === 0) { this.MATCH.fill(-1, 0, n); this.nCons = 0; return; }
		for (k = 1; k < n; k++) if (S.colX[k] < S.colX[k - 1]) { cs = k; break; }
		for (k = 1; k < thenN; k++) if (this.preX[k] < this.preX[k - 1]) { ps = k; break; }
		this.MATCH.fill(-1, 0, n);
		this.PRE.fill(-1, 0, thenN);
		this.nCons = 0;
		for (i = 0; i < n; i++) {
			if (!S.colGhost[i]) continue;
			var gw = Infinity, gj = -1;
			for (k = 0; k < thenN; k++) {
				if (this.preG[k] || this.PRE[k] !== -1 || this.preW[k] < half) continue;
				d = S.colX[i] - this.preX[k];
				if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
				if (d < 0) d = -d;
				if (d > 0.1 * P.w0) continue;
				d = Math.abs((S.colW[i] - this.preW[k]) / this.preW[k]);
				if (d < gw) { gw = d; gj = k; }
			}
			if (gj >= 0 && gw < 0.1) { this.PRE[gj] = -2; if (this.nCons < this.CONSUMED.length) this.CONSUMED[this.nCons++] = gj; }
		}
		for (k = 0; k < n; k++) {
			i = (cs + k) % n;
			if (S.colGhost[i]) continue;
			x = S.colX[i];
			while (b < thenN) {
				d = this.preX[(ps + b) % thenN] - x;
				if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
				if (d < -half || d > half) b++; else break;
			}
			a = -1; e = Infinity;
			if (b < thenN && !this.preG[(ps + b) % thenN] && this.PRE[(ps + b) % thenN] !== -2 && this.preW[(ps + b) % thenN] >= half) {
				d = this.preX[(ps + b) % thenN] - x;
				if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
				if (d < 0) d = -d;
				if (d <= half) { e = d; a = (ps + b) % thenN; }
			}
			if (b > 0 && !this.preG[(ps + b - 1) % thenN] && this.PRE[(ps + b - 1) % thenN] !== -2 && this.preW[(ps + b - 1) % thenN] >= half) {
				d = x - this.preX[(ps + b - 1) % thenN];
				if (d > P.wrap * 0.5) d -= P.wrap; else if (d < -P.wrap * 0.5) d += P.wrap;
				if (d < 0) d = -d;
				if (d < e) { e = d; a = (ps + b - 1) % thenN; }
			}
			if (a >= 0 && this.PRE[a] !== -2) { this.MATCH[i] = a; this.PRE[a] = i; }
		}
	},
	// R2 and R3, exactly the audit's arithmetic: the pair against the flanks 3-4 columns
	// out, the five-and-a-half-column run above flank + beltRise, the ceiling with its
	// dt-aware allowance. Two flank readings are reported: the audit's (whatever crust is
	// there) and one restricted to continental ground on both sides, because comparing a
	// continental margin with an ocean is not the needle the contract is about.
	gates: function (f, out) {
		var n = S.nCol, i, j, k, h, c, flank, peak, run, l, r;
		for (i = 0; i < n; i++) {
			if (S.hTot[i] > out.maxH) out.maxH = S.hTot[i];
			if (S.edge[i] !== P.EDGE.collide) continue;
			j = i + 1 < n ? i + 1 : 0;
			if (S.colGhost[i] || S.colGhost[j]) continue;
			flank = 0.25 * (S.hTot[wm(i - P.beltFeed - 1)] + S.hTot[wm(i - P.beltFeed - 2)] +
				S.hTot[wm(j + P.beltFeed + 1)] + S.hTot[wm(j + P.beltFeed + 2)]);
			if (!(flank > 0)) continue;
			peak = Math.max(S.hTot[i], S.hTot[j]);
			if (peak / flank > out.peakR) {
				out.peakR = peak / flank; out.peakRf = f; out.peakRi = i;
				for (k = -3; k <= 4; k++) out.prof[k + 3] = S.hTot[wm(i + k)];
			}
			l = cont(wm(i - P.beltFeed - 1)) || cont(wm(i - P.beltFeed - 2));
			r = cont(wm(j + P.beltFeed + 1)) || cont(wm(j + P.beltFeed + 2));
			if (l && r && peak / flank > out.contR) { out.contR = peak / flank; out.contRf = f; }
			if (peak >= flank + P.beltRoot) {
				run = 0;
				for (h = -2; h <= 3; h++) if (S.hTot[wm(i + h)] >= flank + P.beltRise) run++;
				out.bumps++;
				if (run >= P.beltCols) out.wide++;
				if (run < out.runWorst) out.runWorst = run;
			}
		}
	}
};

function wm(k) { k %= S.nCol; return k < 0 ? k + S.nCol : k; }
function cont(c) { return S.hFel[c] >= P.hOceanic; }

// --- reporting ---------------------------------------------------------------------

function mean(a, from, to) {
	var s = 0, n = 0, i;
	for (i = from; i < to; i++) { s += a[i]; n++; }
	return n ? s / n : 0;
}

function table(r, label) {
	var i, step = Math.max(1, Math.floor(r.live / 10));
	console.log('\n' + label);
	console.log('    t      closing    belt     root     W(A)     W(B)');
	console.log('   Myr     mm/yr      km       km       km       km');
	for (i = 0; i < r.live; i += step) {
		console.log('  ' + r.t[i].toFixed(0).padStart(5) + '  ' + (r.close[i] / 1e3).toFixed(1).padStart(8) +
			'  ' + (r.wBelt[i] / 1e3).toFixed(0).padStart(7) + '  ' + (r.root[i] / 1e3).toFixed(1).padStart(7) +
			'  ' + (r.wA[i] / 1e3).toFixed(0).padStart(7) + '  ' + (r.wB[i] / 1e3).toFixed(0).padStart(7));
	}
}

// The R4 arrest contract, on one run against the brake-off control's numbers.
function verdict(r, ctrl) {
	var q = Math.max(1, Math.floor(r.live / 4));
	var early = mean(r.close, 0, q), late = mean(r.close, r.live - q, r.live);
	var cEarly = mean(ctrl.close, 0, q), cLate = mean(ctrl.close, ctrl.live - q, ctrl.live);
	var hold = r.live === FRAMES && r.lost < 0;
	var fall = late <= 0.75 * early;
	var ctrlFast = cLate > 0.9 * cEarly;
	var ceiling = r.maxH <= P.crustMax + 35e3 * KYR / 1e3;
	var r2 = r.peakR <= P.beltPeak && (r.bumps === 0 || r.wide >= 0.9 * r.bumps);
	var r5 = r.flipRepeat === 0;
	var r1 = r.awayDz > 0 ? r.siteDz <= P.evDzK * r.awayDz : true;
	return { early: early, late: late, hold: hold, fall: fall, ctrlFast: ctrlFast,
		ceiling: ceiling, r2: r2, r5: r5, r1: r1,
		met: hold && fall && ctrlFast && ceiling && r2 && r5 && r1,
		lateEarly: early > 0 ? late / early : Infinity,
		ctrlLateEarly: cEarly > 0 ? cLate / cEarly : Infinity };
}

function gatesLine(tag, v) {
	console.log('  ' + tag + '  closing ' + (v.early / 1e3).toFixed(1) + ' -> ' + (v.late / 1e3).toFixed(1) +
		' mm/yr (' + (100 * v.lateEarly).toFixed(0) + '% of its own first quarter, max 75)' +
		'  control ' + (100 * v.ctrlLateEarly).toFixed(0) + '% (min 90)');
	console.log('       R1 site/else ' + v.r1 + '   R2 ' + v.r2 + '   R3 ' + v.ceiling + '   R5 ' + v.r5 +
		'   live ' + v.hold);
}

function sweepLine(r, v) {
	console.log('  k ' + r.k.toExponential(0).padStart(6) + '   live ' + String(r.live).padStart(4) +
		'  close ' + (v.early / 1e3).toFixed(1).padStart(5) + ' -> ' + (v.late / 1e3).toFixed(1).padStart(5) +
		'  (' + (100 * v.lateEarly).toFixed(0).padStart(4) + '%)  belt ' + (mean(r.wBelt, Math.max(0, r.live - Math.floor(r.live / 4)), r.live) / 1e3).toFixed(0).padStart(4) +
		' km  peakH ' + (v.peakH / 1e3).toFixed(1).padStart(5) + ' km  R2 ' + (v.r2 ? 'ok ' : 'no ') +
		' R1 ' + (v.r1 ? 'ok ' : 'no ') + ' R5 ' + (v.r5 ? 'ok ' : 'no ') +
		'  ' + r.ms.toFixed(2) + ' ms/f' +
		(r.peakRi >= 0 ? '   worst peak/flank ' + r.peakR.toFixed(2) + ' at frame ' + r.peakRf + ' col ' + r.peakRi : ''));
}

// The contact geometry the control actually has, so the contract's "closing speed" can be
// read against what the collision does rather than what the velocity field says.
// After the floor, how far does the *ground* move? A pair whose index changed is a
// different pair, so a step of more than a few columns is a renumbering, not motion.
function gapRateAfterFloor(r) {
	var sum = 0, n = 0, mx = 0, i, d;
	for (i = r.floorAt + 1; i < r.live; i++) {
		d = Math.abs(r.gap[i] - r.gap[i - 1]) / DT_FRAME;
		if (d > 4 * P.w0 / DT_FRAME) continue;
		sum += d; n++;
		if (d > mx) mx = d;
	}
	return { mean: sum / Math.max(1, n), max: mx };
}

function contactReport(r) {
	var q = Math.max(1, Math.floor(r.live / 4));
	var reported = mean(r.close, 0, r.live), g = gapRateAfterFloor(r), sum = g.mean, n = 1, mx = g.max;
	console.log('  contact geometry: ' + (P.gFloor * P.w0 / 1e3).toFixed(2) + ' km is the separation floor');
	console.log('    the pair gap reached the floor at frame ' + r.floorAt + ' (t ' + (r.floorAt * DT_FRAME).toFixed(2) + ' Myr) and ends at ' +
		(r.gap[r.live - 1] / 1e3).toFixed(2) + ' km');
	console.log('    reported closing ' + (reported / 1e3).toFixed(2) + ' mm/yr; the ground then moves ' + (sum / Math.max(1, n) / 1e3).toFixed(3) +
		' mm/yr on average (' + (mx / 1e3).toFixed(2) + ' at most): the velocity is not realized');
	console.log('    columns ' + r.nStart + ' -> ' + r.nEnd + ', plate widths ' + (r.pw0Start / 1e3).toFixed(0) + '/' + (r.pw1Start / 1e3).toFixed(0) +
		' -> ' + (r.pw0End / 1e3).toFixed(0) + '/' + (r.pw1End / 1e3).toFixed(0) + ' km: nothing is consumed, so nothing keeps shortening');
	console.log('    belt ' + (mean(r.wBelt, 0, q) / 1e3).toFixed(0) + ' -> ' + (mean(r.wBelt, r.live - q, r.live) / 1e3).toFixed(0) +
		' km, root ' + (mean(r.root, 0, q) / 1e3).toFixed(1) + ' -> ' + (mean(r.root, r.live - q, r.live) / 1e3).toFixed(1) +
		' km: the crustal machine is over by the first quarter');
}

check.section('0.1.8 M0 — which representation carries a built orogen?');
console.log('fixture: ' + FRAMES + ' frames, ' + KYR + ' kyr/frame (' + (FRAMES * KYR / 1e9).toFixed(0) +
	' Myr), fit seed ' + FIT_SEED + ', check seed ' + CHK_SEED + ', drive ' + (2 * DRIVE / 1e3) + ' mm/yr closing');
console.log('brake: m = k * W * fb * (-edgeRelN) / vRef, W = the candidate measure, the same hook for all three');

var ctrl = run(FIT_SEED, 'off', 0);
table(ctrl, 'brake off (negative control)');
var cQ = Math.max(1, Math.floor(ctrl.live / 4));
console.log('  control closing ' + (mean(ctrl.close, 0, cQ) / 1e3).toFixed(1) + ' -> ' +
	(mean(ctrl.close, ctrl.live - cQ, ctrl.live) / 1e3).toFixed(1) + ' mm/yr');
contactReport(ctrl);

// 'instant' is the incumbent measure (COL.beltW in PLT.basal) — the baseline R4 fails.
// 'A' and 'B' are the candidates; each is fitted by the smallest k that meets the contract.
var MODES = process.argv[6] ? process.argv[6].split(',') : ['instant', 'A', 'B'];
var rows = [];
MODES.forEach(function (mode) {
	check.section('candidate ' + mode + (mode === 'instant' ? ' (incumbent: this frame\'s COL.beltW)'
		: mode === 'A' ? ' (plateau excess volume / beltRise: derived, no new state)'
		: ' (decaying edge memory: tauUp ' + TAU_BUILD + ' Myr, tauDown ' + TAU_FORGET + ' Myr)'));
	var fitted = null, first = null;
	SWEEP.forEach(function (k) {
		var r = run(FIT_SEED, mode, k), v = verdict(r, ctrl);
		v.peakH = r.maxH;
		rows.push({ mode: mode, k: k, r: r, v: v });
		sweepLine(r, v);
		if (!first) first = { r: r, v: v };
		if (!fitted && v.met) fitted = { r: r, v: v };
	});
	if (!fitted) {
		check.info('no coefficient in the sweep meets the arrest contract on seed ' + FIT_SEED,
			'smallest late/early ' + (100 * Math.min.apply(null, rows.filter(function (x) { return x.mode === mode; })
				.map(function (x) { return x.v.lateEarly; }))).toFixed(0) + '%');
		return;
	}
	check.info('fitted k ' + fitted.k.toExponential(0), 'the smallest that meets the contract on seed ' + FIT_SEED);
	table(fitted.r, 'fitted run, seed ' + FIT_SEED);
	gatesLine('seed ' + FIT_SEED, fitted.v);
	var chk = run(CHK_SEED, mode, fitted.k), cv = verdict(chk, run(CHK_SEED, 'off', 0));
	cv.peakH = chk.maxH;
	check.ok(mode + ' holds the arrest contract on the check seed', cv.met,
		'closing ' + (cv.early / 1e3).toFixed(1) + ' -> ' + (cv.late / 1e3).toFixed(1) +
		' mm/yr (' + (100 * cv.lateEarly).toFixed(0) + '%), R1/R2/R3/R5 ' +
		[cv.r1, cv.r2, cv.ceiling, cv.r5].map(function (b) { return b ? 'ok' : 'no'; }).join('/'));
	fitted.chk = cv; fitted.chkRun = chk;
	check.ok(mode + ' keeps the collision measurable for the whole run', cv.hold && fitted.v.hold,
		fitted.r.live + ' / ' + chk.live + ' of ' + FRAMES + ' frames');
});

// --- does a *fed* collision accumulate where the prescribed one freezes? -----------
//
// The prescribed fixture has no way to keep shortening: a C-C contact consumes nothing
// (COL.intents), the pair reaches the separation floor, and the rigid plate correction
// then holds it there, so the crust stops evolving after the first squeeze. If that is
// the whole story then no brake measure can be decided on this fixture, and the question
// moves to whether *any* collision in this model accumulates. The fed fixture puts a
// three-column ribbon continent on the leading edge of an oceanic plate whose ocean
// subducts at the far side: the trench keeps consuming ground, the plate keeps advancing,
// and the ribbon keeps being pushed into the continent. Brake off, because the question
// is whether the crust accumulates at all.
function fedControl(frames) {
	var RIBBON = 3, t, i, k, c, peak, root, vex, fel, maf, margin = 0;
	var trace = [], n = 0;
	L.check.planet(FIT_SEED, 'def');
	var wc = Math.floor(S.nCol * 0.55);
	for (i = 0; i < S.nCol; i++) {
		S.colAge[i] = 100;
		S.edge[i] = P.EDGE.none; S.edgePol[i] = 0; S.edgeAge[i] = 0;
		S.edgeRPlate[i] = -1; S.edgeSlow[i] = 0;
		S.colNL[i] = 0;
		if (i < wc) { S.colPlate[i] = 0; COL.push(i, P.hFelLand0, P.LITH.fel, 100, 0); }
		else if (i < wc + RIBBON) { S.colPlate[i] = 1; COL.push(i, P.hFelLand0, P.LITH.fel, 100, 0); }
		else { S.colPlate[i] = 1; COL.push(i, P.hOceanic, P.LITH.maf, 100, 0); }
		COL.sums(i);
	}
	S.nPl = 2; S.plN[0] = wc; S.plN[1] = S.nCol - wc;
	S.plU[0] = 0; S.plU[1] = 0;
	for (i = 0; i < S.nCol; i++) S.colU[i] = S.plU[S.colPlate[i]];
	SIM.setGeo(KYR * 1e3);
	PLT.basal = makeHook('off', 0);
	for (t = 0; t < frames; t++) {
		SIM.step();
		if (t % Math.max(1, Math.floor(frames / 10))) continue;
		c = check.collisionSite();
		n = S.nCol; peak = 0; root = 0; vex = 0; fel = 0; maf = 0; margin = 0;
		for (k = 0; k < S.nCol; k++) {
			if (S.colGhost[k]) continue;
			if (S.hFel[k] >= P.hOceanic) fel++; else maf++;
			if (S.hFel[k] - P.hFelLand0 > 0) vex += (S.hFel[k] - P.hFelLand0) * S.colW[k];
		}
		if (c >= 0) {
			COL.beltAt(S, S.nCol, c);
			peak = Math.max(S.hTot[c], S.hTot[(c + 1) % S.nCol]);
			root = peak - COL.flankH;
			for (k = -6; k <= 6; k++) { var cc = wm(c + k); if (S.hTot[cc] > margin) margin = S.hTot[cc]; }
		}
		trace.push('    ' + SIM.t.toFixed(0).padStart(4) + '   ' + (c >= 0 ? (S.colX[c] / 1e3).toFixed(0).padStart(6) : '     -') +
			'   ' + (peak / 1e3).toFixed(1).padStart(5) + '   ' + (COL.flankH / 1e3).toFixed(1).padStart(5) +
			'   ' + (peak - COL.flankH > 0 ? root / 1e3 : 0).toFixed(1).padStart(5) + '   ' + (vex / 1e9).toFixed(2).padStart(6) +
			'   ' + fel + ' / ' + maf + '   ' + (margin / 1e3).toFixed(1));
	}
	PLT.basal = basal;
	return { trace: trace, maxMargin: margin, n: n, vex: vex };
}

// --- and on the model's own planet, how long does a continental collision last? -----
//
// The fixture forces a 200 Myr collision with a prescribed far-field drive. If the engine
// itself never holds a continental collision that long, the fixture is testing a state the
// model does not produce, and R4's numbers describe it rather than the planet. Run the
// def planet and count the collide edges whose flanks are continental on both sides.
function planetCollisions(frames) {
	var t, i, j, pair, stride = Math.max(1, Math.floor(frames / 8));
	var out = [], any = 0, last = -1;
	L.check.planet(FIT_SEED, 'def');
	SIM.setGeo(KYR * 1e3);
	for (t = 0; t < frames; t++) {
		SIM.step();
		if (t % stride) continue;
		pair = 0;
		for (i = 0; i < S.nCol; i++) {
			if (S.edge[i] !== P.EDGE.collide) continue;
			j = i + 1 < S.nCol ? i + 1 : 0;
			if (S.colGhost[i] || S.colGhost[j]) continue;
			if (!(cont(wm(i - P.beltFeed - 1)) || cont(wm(i - P.beltFeed - 2)))) continue;
			if (!(cont(wm(j + P.beltFeed + 1)) || cont(wm(j + P.beltFeed + 2)))) continue;
			pair++;
		}
		if (pair > 0) last = t;
		if (pair > any) any = pair;
		out.push('    t ' + SIM.t.toFixed(0).padStart(4) + ' Myr   ' + pair + ' continental collide edge' + (pair === 1 ? '' : 's') +
			'   nCol ' + S.nCol);
	}
	return { trace: out, last: last, most: any, lastT: last * DT_FRAME };
}

if (MODES.indexOf('fed') < 0) {
	var fed = fedControl(FRAMES);
	check.section('the same contract on a fed collision (control: ribbon continent, ocean trench feeding it)');
	console.log('     t     x(km)   peak   flank   root   Vex(e9)   felsic/mafic cols   margin max');
	console.log(fed.trace.join('\n'));
	check.info('a fed collision does not accumulate either', 'the margin ends at ' + (fed.maxMargin / 1e3).toFixed(1) +
		' km against the 35 km reference, and Vex ends at ' + (fed.vex / 1e9).toFixed(2) + 'e9 m2');
}

var pl = planetCollisions(FRAMES);
check.section('the model planet: do its own continental collisions last 200 Myr?');
console.log(pl.trace.join('\n'));
check.info('the longest continental collision on the def planet',
	'last seen at t ' + pl.lastT.toFixed(0) + ' Myr, at most ' + pl.most + ' at once: the engine sutures or reclassifies them long before R4 ends');

check.section('M0 verdict');
var cQ2 = Math.max(1, Math.floor(ctrl.live / 4));
var ctrlLate = mean(ctrl.close, ctrl.live - cQ2, ctrl.live);
// only coefficients under which the collision survives the whole run can be compared as
// brakes: a row that sutures at frame 619 has not arrested the collision, it has ended it
var liveRows = rows.filter(function (x) { return x.r.live === FRAMES; });
var bestAbsorb = 0, bestAbsorbK = 0, bestAbsorbMode = '', i2, absorbed;
for (i2 = 0; i2 < liveRows.length; i2++) {
	absorbed = 1 - liveRows[i2].v.late / ctrlLate;
	if (absorbed > bestAbsorb) { bestAbsorb = absorbed; bestAbsorbK = liveRows[i2].k; bestAbsorbMode = liveRows[i2].mode; }
}
console.log('  no measure of a built orogen is selected, and the reason is measured, not fitted:');
console.log('    the prescribed fixture stops building after the first squeeze. The contact gap reaches');
console.log('    the ' + (P.gFloor * P.w0 / 1e3).toFixed(2) + ' km floor at frame ' + ctrl.floorAt + ', the plate widths and the column count');
console.log('    then stop changing (' + ctrl.nStart + ' -> ' + ctrl.nEnd + ' columns), and the belt width and the root plateau.');
console.log('    The rest of the run measures a velocity the floor cancels: ' + (gapRateAfterFloor(ctrl).mean / 1e3).toFixed(3) + ' mm/yr');
console.log('    of real gap motion against ' + (mean(ctrl.close, 0, ctrl.live) / 1e3).toFixed(1) + ' mm/yr of reported closing.');
if (MODES.indexOf('fed') < 0) {
	console.log('    the fed fixture, whose trench keeps consuming ground behind the collision, spreads its');
	console.log('    incoming crust into a lower, wider margin rather than accumulating it (' +
		(fed.maxMargin / 1e3).toFixed(1) + ' km against');
	console.log('    the 35 km reference at the end of the run).');
}
console.log('  what the sweep does say: with the collision kept open, the strongest live row (' + bestAbsorbMode +
	' at k ' + bestAbsorbK.toExponential(0) + ')');
console.log('    absorbs ' + (100 * bestAbsorb).toFixed(0) + '% of the control closing without breaking R1/R3/R5, and every');
console.log('    stronger row sutures the collision below P.vSuture and ends the measurement (the k 4e6 rows).');
console.log('    So the authority to arrest is one constant away; what is missing is an orogen that keeps');
console.log('    growing, and "late <= 75% of early" is a shape test on a machine that has already stopped.');
console.log('  M1 should land accumulation first -- a C-C contact must keep accommodating convergence after');
console.log('    the floor, the crush/consume path COL.intents reserves for a column with two floor gaps');
console.log('    being the only place a floored pair can still shorten -- and restate R4 against that: a');
console.log('    brake measure can only be chosen on a fixture whose orogen still responds.');

check.done();

