// orogen-measure.js — 0.1.8 M1: measure a collision after the conveyor's crush floor.
//
// The M1 kernel must let a continent-continent contact keep consuming convergence after its
// crush floor. This harness first measures the unbraked conveyor against the prescribed
// drive, then compares three possible arrest signals only if that machine still responds.
// The incumbent collision brake in PLT.basal uses COL.beltAt -> beltW; a belt redistributed
// by the contact, or whose flanks rise with it, can report a small orogen while a large one
// stands there. 0.1.8-plan.md §3 names two alternatives to measure before either becomes a
// kernel constant:
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
// run:  node experiments/orogen-measure.js [frames=4000] [fitSeed=1] [checkSeed=5] [kyr=50] [modes=instant,A,B|none] [kBelt=0.12]

'use strict';
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, SIM = L.mods.sim, GEO = L.mods.geom,
	PLT = L.mods.plates, COL = L.mods.columns;
var check = L.check;
var R2_SHAPE = { flank: 0, peak: 0, shoulder: 0, outerRatio: 0, needleRatio: 0,
	widthCount: 0, widthRun: 0, built: false };

var FRAMES = Number(process.argv[2]) || 4000;
var FIT_SEED = Number(process.argv[3]) || 1;
var CHK_SEED = Number(process.argv[4]) || 5;
var KYR = Number(process.argv[5]) || 50;
var BELT_ARG = process.argv[7] === undefined ? NaN : Number(process.argv[7]);
if (isFinite(BELT_ARG) && BELT_ARG >= 0) P.kBelt = BELT_ARG;
var DRIVE = 15e3;                 // m/Myr per continent: the prescribed 30 mm/yr closing
var DT_FRAME = KYR / 1e3;         // Myr per frame (KYR is kyr/frame)
var TAU_BUILD = 1;                // Myr, candidate B: the edge records what it is building
var TAU_FORGET = 50;              // Myr, candidate B: and forgets it on a geological one
var SWEEP = [2e5, 5e5, 1e6, 2e6, 4e6, 1e7, 3e7];   // m/Myr; vColl is 2e5, so the sweep starts there

var basal = PLT.basal;
var MEM = new Float64Array(P.colCap);        // candidate B, per edge slot, metres
var MEM_PREV = new Float64Array(P.colCap), MEM_NEXT = new Float64Array(P.colCap);
var ACC_GAP = new Float64Array(P.colCap), ACC_X = new Float64Array(P.colCap), ACTIVE_RUN = null;
var transport = COL.transport, topology = COL.k4;

// Memory belongs to a boundary, not to an array slot. Follow the same neighbour hand-off
// as edge history through position sorting and K4 topology changes.
COL.transport = function (st, dt) {
	var n = st.nCol, i, left, right;
	var witness0 = ACTIVE_RUN ? ACTIVE_RUN.witness0 : -1;
	var witness1 = ACTIVE_RUN ? ACTIVE_RUN.witness1 : -1;
	MEM_PREV.set(MEM.subarray(0, n));
	transport.call(this, st, dt);
	if (ACTIVE_RUN) {
		if (witness0 >= 0) ACTIVE_RUN.witness0 = st.sortInverse[witness0];
		if (witness1 >= 0) ACTIVE_RUN.witness1 = st.sortInverse[witness1];
	}
	MEM_NEXT.fill(0, 0, n);
	for (i = 0; i < n; i++) {
		left = st.sortInverse[i];
		right = st.sortInverse[(i + 1) % n];
		if (right === (left + 1) % n) MEM_NEXT[left] = MEM_PREV[i];
	}
	MEM.set(MEM_NEXT.subarray(0, n));
};

COL.k4 = function (st, dt, t, Tm) {
	var n = st.nCol, after, i, j, k, right, c, gap, post;
	MEM_PREV.set(MEM.subarray(0, n));
	if (ACTIVE_RUN) {
		this.intents();
		ACC_GAP.fill(0, 0, n);
		for (i = 0; i < n; i++) {
			if (this.intent[i] !== 4) continue;
			j = i + 1 < n ? i + 1 : 0;
			c = this.crush[i];
			if (ACTIVE_RUN.floorAt < 0) ACTIVE_RUN.floorAt = ACTIVE_RUN.frame;
			gap = st.colX[j] - st.colX[i];
			ACC_GAP[i] = gap < 0 ? gap + P.wrap : gap;
			ACC_X[i] = st.colX[c];
		}
	}
	var changed = topology.call(this, st, dt, t, Tm);
	if (!changed) return changed;
	after = st.nCol;
	if (ACTIVE_RUN) {
		if (ACTIVE_RUN.witness0 >= 0) ACTIVE_RUN.witness0 = this.map[ACTIVE_RUN.witness0];
		if (ACTIVE_RUN.witness1 >= 0) ACTIVE_RUN.witness1 = this.map[ACTIVE_RUN.witness1];
		for (i = 0; i < n; i++) {
			j = i + 1 < n ? i + 1 : 0;
			c = this.crush[i];
			if (this.intent[i] !== 4 || (c !== i && c !== j) || !this.accreteLock[c] ||
				this.dead[c] !== 1 || this.map[c] >= 0) continue;
			if (c === i) {
				if (this.map[j] < 0) continue;
				k = (this.map[j] + after - 1) % after;
			} else k = this.map[i];
			if (k < 0) continue;
			right = k + 1 < after ? k + 1 : 0;
			post = st.colX[right] - st.colX[k];
			if (post < 0) post += P.wrap;
			gap = ACC_GAP[i];
			if (post > gap) ACTIVE_RUN.reopened += post - gap;
			ACTIVE_RUN.accrete++;
			ACTIVE_RUN.accEventX[ACTIVE_RUN.accEventCount++] = ACC_X[i];
		}
	}
	MEM_NEXT.fill(0, 0, after);
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		if (!this.dead[j] && this.map[j] >= 0) {
			k = (this.map[j] + after - 1) % after;
			if (st.colPlate[k] === this.histLP[i] && st.colPlate[this.map[j]] === this.histRP[i])
				MEM_NEXT[k] = MEM_PREV[i];
			continue;
		}
		if (this.intent[i] !== 4 || this.crush[i] !== j || this.map[i] < 0) continue;
		right = j + 1 < n ? j + 1 : 0;
		k = this.map[i];
		if (this.map[right] >= 0 && st.colPlate[k] === this.histLP[i] &&
			st.colPlate[this.map[right]] === this.histRP[i]) MEM_NEXT[k] = MEM_PREV[i];
	}
	MEM.set(MEM_NEXT.subarray(0, after));
	return changed;
};

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
		wBelt: new Float64Array(FRAMES), root: new Float64Array(FRAMES), pairH: new Float64Array(FRAMES),
		wA: new Float64Array(FRAMES), wB: new Float64Array(FRAMES),
		gap: new Float64Array(FRAMES), floorAt: -1,
		witness0: -1, witness1: -1, lastX0: 0, lastX1: 0,
		accrete: 0, accEventCount: 0, accEventX: new Float64Array(P.colCap), shortening: 0, reopened: 0,
		live: 0, lost: -1, maxH: 0, ms: 0,
		nStart: 0, nEnd: 0, pw0Start: 0, pw0End: 0, pw1Start: 0, pw1End: 0,
		peakR: 0, peakRf: -1, peakRi: -1, peakH: 0, peakFlank: 0, peakRun: 0,
		peakLocalFlank: 0, peakLocalR: 0, needleR: 0, needleRf: -1, needleRi: -1,
		needleH: 0, needleShoulder: 0, needleProf: new Float64Array(8),
		contR: 0, contRf: -1, prof: new Float64Array(8),
		bumps: 0, wide: 0, wideContig: 0, runWorst: 99, runWorstF: -1, runWorstI: -1,
		runWorstPeak: 0, runWorstFlank: 0, runProf: new Float64Array(8),
		contigWorst: 99, contigWorstF: -1, contigWorstI: -1, contigProf: new Float64Array(8),
		siteDz: 0, awayDz: 0, quietDz: 0,
		births: 0, deaths: 0, flipRepeat: 0, birthRepeat: 0, deathRepeat: 0
	};
	var keepV = P.vColl, keepD = P.kDam, t0 = Date.now(), i, f, c, j, gap, x0, x1, dx0, dx1;
	P.kDam = 0;                  // the drive diverges the far field; damage would split it
	P.vColl = mode === 'instant' ? k : 0;
	check.twoContinents(seed);
	SIM.setGeo(KYR * 1e3);
	MEM.fill(0); MEM_PREV.fill(0); MEM_NEXT.fill(0);
	PLT.basal = makeHook(mode, k);
	G.init();
	G.sampleZ(G.prevZ);
	out.nStart = S.nCol;
	out.pw0Start = plateWidth(0); out.pw1Start = plateWidth(1);
	out.witness0 = Math.floor(S.nCol / 4);
	out.witness1 = Math.floor(3 * S.nCol / 4);
	out.lastX0 = S.colX[out.witness0]; out.lastX1 = S.colX[out.witness1];
	ACTIVE_RUN = out;
	for (f = 0; f < FRAMES; f++) {
		G.pre();
		out.frame = f;
		out.accEventCount = 0;
		SIM.step();
		if (out.witness0 < 0 || out.witness1 < 0) { if (out.lost < 0) out.lost = f; continue; }
		x0 = S.colX[out.witness0]; x1 = S.colX[out.witness1];
		dx0 = x0 - out.lastX0; dx1 = x1 - out.lastX1;
		if (dx0 > P.wrap * 0.5) dx0 -= P.wrap; else if (dx0 < -P.wrap * 0.5) dx0 += P.wrap;
		if (dx1 > P.wrap * 0.5) dx1 -= P.wrap; else if (dx1 < -P.wrap * 0.5) dx1 += P.wrap;
		out.shortening += dx0 - dx1;
		out.lastX0 = x0; out.lastX1 = x1;
		G.events(f, out);
		G.gates(f, out);
		c = check.collisionSite();
		if (c < 0) { if (out.lost < 0) out.lost = f; continue; }
		COL.beltAt(S, S.nCol, c);
		j = c + 1 < S.nCol ? c + 1 : 0;
		out.t[out.live] = SIM.t;
		out.close[out.live] = -S.edgeRelN[c];
		out.wBelt[out.live] = COL.beltW;
		out.pairH[out.live] = Math.max(S.hTot[c], S.hTot[j]);
		out.root[out.live] = out.pairH[out.live] - COL.flankH;
		out.wA[out.live] = vexAt(S, c) / P.beltRise;
		out.wB[out.live] = MEM[c];
		gap = S.colX[j] - S.colX[c];
		if (gap < 0) gap += P.wrap;
		out.gap[out.live] = gap;
		if (out.floorAt < 0 && gap <= P.crushFloor * 1.01) out.floorAt = f;
		out.live++;
	}
	ACTIVE_RUN = null;
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
		for (k = 0; k < out.accEventCount; k++) {
			site = Math.floor(out.accEventX[k] / (2.5 * P.w0));
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
	// R2 uses the shared local-needle / contiguous-width helper in lib.js. The historical
	// outer-flank ratio and non-contiguous count remain in the same sample for comparison;
	// R3 keeps the audit's dt-aware ceiling arithmetic.
	gates: function (f, out) {
		var n = S.nCol, i, j, k, c, flank, peak, count, contiguous, localFlank, l, r;
		for (i = 0; i < n; i++) {
			if (S.hTot[i] > out.maxH) out.maxH = S.hTot[i];
			if (S.edge[i] !== P.EDGE.collide) continue;
			j = i + 1 < n ? i + 1 : 0;
			if (S.colGhost[i] || S.colGhost[j]) continue;
			check.r2ShapeAt(S, i, R2_SHAPE);
			flank = R2_SHAPE.flank; peak = R2_SHAPE.peak;
			if (!(flank > 0)) continue;
			count = R2_SHAPE.widthCount; contiguous = R2_SHAPE.widthRun;
			if (R2_SHAPE.outerRatio > out.peakR) {
				localFlank = 0.5 * (S.hTot[wm(i - 1)] + S.hTot[wm(j + 1)]);
				out.peakR = R2_SHAPE.outerRatio; out.peakRf = f; out.peakRi = i;
				out.peakH = peak; out.peakFlank = flank; out.peakRun = count;
				out.peakLocalFlank = localFlank;
				out.peakLocalR = localFlank > 0 ? peak / localFlank : 0;
				for (k = -3; k <= 4; k++) out.prof[k + 3] = S.hTot[wm(i + k)];
			}
			if (R2_SHAPE.needleRatio > out.needleR) {
				out.needleR = R2_SHAPE.needleRatio; out.needleRf = f; out.needleRi = i;
				out.needleH = peak; out.needleShoulder = R2_SHAPE.shoulder;
				for (k = -3; k <= 4; k++) out.needleProf[k + 3] = S.hTot[wm(i + k)];
			}
			l = cont(wm(i - P.beltFeed - 1)) || cont(wm(i - P.beltFeed - 2));
			r = cont(wm(j + P.beltFeed + 1)) || cont(wm(j + P.beltFeed + 2));
			if (l && r && R2_SHAPE.outerRatio > out.contR) {
				out.contR = R2_SHAPE.outerRatio; out.contRf = f;
			}
			if (!R2_SHAPE.built) continue;
			out.bumps++;
			if (count >= P.beltCols) out.wide++;
			if (contiguous >= P.beltCols) out.wideContig++;
			if (count < out.runWorst) {
				out.runWorst = count; out.runWorstF = f; out.runWorstI = i;
				out.runWorstPeak = peak; out.runWorstFlank = flank;
				for (k = -3; k <= 4; k++) out.runProf[k + 3] = S.hTot[wm(i + k)];
			}
			if (contiguous < out.contigWorst) {
				out.contigWorst = contiguous; out.contigWorstF = f; out.contigWorstI = i;
				for (k = -3; k <= 4; k++) out.contigProf[k + 3] = S.hTot[wm(i + k)];
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
	console.log('    t      closing   pairH    belt     root     W(A)     W(B)');
	console.log('   Myr     mm/yr      km       km       km       km       km');
	for (i = 0; i < r.live; i += step) {
		console.log('  ' + r.t[i].toFixed(0).padStart(5) + '  ' + (r.close[i] / 1e3).toFixed(1).padStart(8) +
			'  ' + (r.pairH[i] / 1e3).toFixed(1).padStart(7) + '  ' + (r.wBelt[i] / 1e3).toFixed(0).padStart(7) +
			'  ' + (r.root[i] / 1e3).toFixed(1).padStart(7) + '  ' + (r.wA[i] / 1e3).toFixed(0).padStart(7) +
			'  ' + (r.wB[i] / 1e3).toFixed(0).padStart(7));
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
	var r2 = r.needleR <= P.beltPeak && (r.bumps === 0 || r.wideContig >= 0.9 * r.bumps);
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
		' local ' + r.needleR.toFixed(2) + '  contig ' + r.wideContig + '/' + r.bumps +
		' legacy width ' + r.wide + '/' + r.bumps +
		' R1 ' + (v.r1 ? 'ok ' : 'no ') + ' R5 ' + (v.r5 ? 'ok ' : 'no ') +
		'  ' + r.ms.toFixed(2) + ' ms/f' +
		(r.peakRi >= 0 ? '   legacy peak/flank ' + r.peakR.toFixed(2) + ' at frame ' + r.peakRf + ' col ' + r.peakRi : ''));
}

// Track one untouched material witness in each plate. Their unwrapped relative displacement
// is realized convergence even when K4 retires the contact records; adjacent-center gaps jump
// at those hand-offs and are not themselves material motion.
function realizedShorteningRate(r) {
	var duration = Math.max(DT_FRAME, r.live * DT_FRAME);
	return { mean: r.shortening / duration };
}

function contactReport(r) {
	var q = Math.max(1, Math.floor(r.live / 4));
	var reported = mean(r.close, 0, r.live), g = realizedShorteningRate(r);
	console.log('  contact geometry: ' + (P.crushFloor / 1e3).toFixed(2) + ' km is the C-C crush floor');
	console.log('    the first pair reached the floor at frame ' + r.floorAt + ' (t ' + (r.floorAt * DT_FRAME).toFixed(2) +
		' Myr); the live pair gap ends at ' + (r.gap[r.live - 1] / 1e3).toFixed(2) + ' km');
	console.log('    reported closing ' + (reported / 1e3).toFixed(2) + ' mm/yr; integrated shortening is ' +
		(r.shortening / 1e3).toFixed(1) + ' km (' + (g.mean / 1e3).toFixed(2) + ' mm/yr equivalent)');
	console.log('    ' + r.accrete + ' conveyor retirements release ' + (r.reopened / 1e3).toFixed(1) +
		' km (' + (r.accrete ? (FRAMES / r.accrete).toFixed(1) : 'n/a') + ' frames/event); ' +
		r.births + ' births, ' + r.deaths + ' deaths; columns ' + r.nStart + ' -> ' + r.nEnd + ', plate widths ' +
		(r.pw0Start / 1e3).toFixed(0) + '/' + (r.pw1Start / 1e3).toFixed(0) + ' -> ' +
		(r.pw0End / 1e3).toFixed(0) + '/' + (r.pw1End / 1e3).toFixed(0) + ' km');
	console.log('    legacy peak/flank ' + r.peakR.toFixed(2) + ' at frame ' + r.peakRf + ' edge ' + r.peakRi +
		'; pair ' + (r.peakH / 1e3).toFixed(1) + ' / outer flank ' + (r.peakFlank / 1e3).toFixed(1) +
		' km; mean immediate shoulders ' + (r.peakLocalFlank / 1e3).toFixed(1) + ' km (pair/mean ' +
		r.peakLocalR.toFixed(2) + '), old count ' + r.peakRun + '/6; local hTot (-3..+4) km: ' +
		Array.from(r.prof, function (h) { return (h / 1e3).toFixed(1); }).join('/'));
	console.log('    selected local needle ' + r.needleR.toFixed(2) + ' at frame ' + r.needleRf +
		' edge ' + r.needleRi + '; pair ' + (r.needleH / 1e3).toFixed(1) + ' / higher shoulder ' +
		(r.needleShoulder / 1e3).toFixed(1) + ' km (limit ' + P.beltPeak + '); local hTot (-3..+4) km: ' +
		Array.from(r.needleProf, function (h) { return (h / 1e3).toFixed(1); }).join('/'));
	console.log('    legacy width minimum count ' + r.runWorst + '/6 at frame ' + r.runWorstF +
		' edge ' + r.runWorstI + '; selected contiguous width minimum ' + r.contigWorst +
		'/6 at frame ' + r.contigWorstF + ' edge ' + r.contigWorstI + '; hTot (-3..+4) km: ' +
		Array.from(r.contigProf, function (h) { return (h / 1e3).toFixed(1); }).join('/'));
	console.log('    first/last-quarter response (pair hTot / belt / root / excess width): ' +
		(mean(r.pairH, 0, q) / 1e3).toFixed(1) + '/' + (mean(r.wBelt, 0, q) / 1e3).toFixed(0) + '/' +
		(mean(r.root, 0, q) / 1e3).toFixed(1) + '/' + (mean(r.wA, 0, q) / 1e3).toFixed(0) + ' -> ' +
		(mean(r.pairH, r.live - q, r.live) / 1e3).toFixed(1) + '/' +
		(mean(r.wBelt, r.live - q, r.live) / 1e3).toFixed(0) + '/' +
		(mean(r.root, r.live - q, r.live) / 1e3).toFixed(1) + '/' +
		(mean(r.wA, r.live - q, r.live) / 1e3).toFixed(0) + ' km');
}

function responseMetrics(r) {
	var q = Math.max(1, Math.floor(r.live / 4));
	var close = mean(r.close, 0, r.live), equivalent = realizedShorteningRate(r).mean;
	var earlyBelt = mean(r.wBelt, 0, q), lateBelt = mean(r.wBelt, r.live - q, r.live);
	var earlyExcess = mean(r.wA, 0, q), lateExcess = mean(r.wA, r.live - q, r.live);
	var ratio = close > 0 ? equivalent / close : 0;
	var shorteningMatches = ratio >= 0.9 && ratio <= 1.1;
	var orogenGrows = lateBelt > earlyBelt && lateExcess > earlyExcess;
	var held = r.live === FRAMES && r.lost < 0;
	var audit = verdict(r, r);
	var conveyorResponsive = held && r.accrete > 0 && shorteningMatches && orogenGrows;
	var auditsPass = audit.r1 && audit.r2 && audit.ceiling && audit.r5;
	return { held: held, shorteningMatches: shorteningMatches, orogenGrows: orogenGrows, audit: audit,
		conveyorResponsive: conveyorResponsive, auditsPass: auditsPass,
		selectionReady: conveyorResponsive && auditsPass,
		ratio: ratio, equivalent: equivalent, close: close,
		earlyBelt: earlyBelt, lateBelt: lateBelt, earlyExcess: earlyExcess, lateExcess: lateExcess };
}

check.section('0.1.8 M1 — conveyor and orogen response, before brake selection');
console.log('fixture: ' + FRAMES + ' frames, ' + KYR + ' kyr/frame (' + (FRAMES * KYR / 1e3).toFixed(1) +
	' Myr), fit seed ' + FIT_SEED + ', check seed ' + CHK_SEED + ', drive ' + (2 * DRIVE / 1e3) +
	' mm/yr closing, kBelt ' + P.kBelt + ' /Myr');
console.log('fixture forcing: prescribed two continents only; plume arrivals and stale trench-distance forcing cleared');

var ctrl = run(FIT_SEED, 'off', 0);
table(ctrl, 'brake off: C-C conveyor response');
var cQ = Math.max(1, Math.floor(ctrl.live / 4));
console.log('  control closing ' + (mean(ctrl.close, 0, cQ) / 1e3).toFixed(1) + ' -> ' +
	(mean(ctrl.close, ctrl.live - cQ, ctrl.live) / 1e3).toFixed(1) + ' mm/yr');
contactReport(ctrl);
var response = responseMetrics(ctrl);
check.ok('the conveyor preserves a live collision and retires records', response.held && ctrl.accrete > 0,
	ctrl.live + '/' + FRAMES + ' frames, ' + ctrl.accrete + ' retirements');
check.ok('plate-witness shortening matches reported convergence within 10%', response.shorteningMatches,
	(response.equivalent / 1e3).toFixed(2) + ' vs ' + (response.close / 1e3).toFixed(2) +
	' mm/yr (' + (100 * response.ratio).toFixed(1) + '%)');
check.ok('belt width and plateau excess continue growing before brake selection', response.orogenGrows,
	'belt ' + (response.earlyBelt / 1e3).toFixed(0) + ' -> ' + (response.lateBelt / 1e3).toFixed(0) +
	' km; excess width ' + (response.earlyExcess / 1e3).toFixed(0) + ' -> ' +
	(response.lateExcess / 1e3).toFixed(0) + ' km');
var ctrlAudit = response.audit;
check.ok('R1 event-site surface displacement remains bounded', ctrlAudit.r1,
	'max at event sites ' + (ctrl.siteDz / 1e3).toFixed(2) + ' km vs away ' + (ctrl.awayDz / 1e3).toFixed(2) + ' km');
check.ok('R2 local needle and contiguous-width gates both pass', ctrlAudit.r2,
	'local peak/shoulder ' + ctrl.needleR.toFixed(2) + ', contiguous ' + ctrl.wideContig + '/' +
	ctrl.bumps + ' built frames; legacy outer ratio ' + ctrl.peakR.toFixed(2) + ', count ' +
	ctrl.wide + '/' + ctrl.bumps);
check.ok('R3 crust stays under the dt-aware ceiling', ctrlAudit.ceiling,
	(ctrl.maxH / 1e3).toFixed(1) + ' km vs ' + ((P.crustMax + 35e3 * DT_FRAME) / 1e3).toFixed(1) + ' km');
check.ok('R5 no site flips twice inside evGap', ctrlAudit.r5,
	ctrl.flipRepeat + ' reversals, ' + ctrl.deathRepeat + ' repeated death-sites');

// 'instant', A, and B remain diagnostics; they need a live, mass-responsive conveyor, but
// the sweep itself is allowed to measure whether a candidate can repair a red shape/event
// gate. It never changes the kernel or declares M1 complete.
var MODES = process.argv[6] === 'none' ? [] :
	(process.argv[6] ? process.argv[6].split(',') : ['instant', 'A', 'B']);
var rows = [];
if (!response.conveyorResponsive) {
	if (MODES.length) check.info('candidate brake sweep deferred', 'the unbraked conveyor response failed');
	MODES = [];
} else if (!response.auditsPass && MODES.length) {
	check.info('candidate brake sweep is diagnostic; baseline R1/R2/R3/R5 remain open',
		'candidate rows must pass the same gates and do not close M1 acceptance');
}
MODES.forEach(function (mode) {
	check.section('candidate ' + mode + (mode === 'instant' ? ' (incumbent: this frame\'s COL.beltW)'
		: mode === 'A' ? ' (plateau excess volume / beltRise: derived, no new state)'
		: ' (decaying edge memory: tauUp ' + TAU_BUILD + ' Myr, tauDown ' + TAU_FORGET + ' Myr)'));
	var fitted = null;
	SWEEP.forEach(function (k) {
		var r = run(FIT_SEED, mode, k), v = verdict(r, ctrl);
		v.peakH = r.maxH;
		rows.push({ mode: mode, k: k, r: r, v: v });
		sweepLine(r, v);
		if (!fitted && v.met) fitted = { k: k, r: r, v: v };
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

// --- an independent fed-collision control -----------------------------------------
//
// This legacy control keeps a three-column ribbon continent on the leading edge of an
// oceanic plate whose ocean subducts at the far side. It is reported for comparison only;
// it is not a substitute for the prescribed C-C conveyor fixture or its acceptance gates.
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

check.section('M1 result — accumulation first; R4 arrest remains a separate open gate');
console.log('  conveyor response: ' + (response.conveyorResponsive ? 'meets the shortening/growth preconditions on this run' : 'not yet sufficient') +
	' (' + ctrl.accrete + ' retirements, shortening ' + (100 * response.ratio).toFixed(1) +
	'% of reported closing, belt/excess both grow: ' + response.orogenGrows + ').');
console.log('  R1/R2/R3/R5 audit bundle: ' + (response.auditsPass ? 'all clear' : 'not all clear') +
	'; brake selection readiness: ' + response.selectionReady + '.');
if (rows.length) {
	var liveRows = rows.filter(function (x) { return x.r.live === FRAMES; });
	var bestAbsorb = 0, bestAbsorbK = 0, bestAbsorbMode = '', i2, absorbed, ctrlLate;
	var cQ2 = Math.max(1, Math.floor(ctrl.live / 4));
	ctrlLate = mean(ctrl.close, ctrl.live - cQ2, ctrl.live);
	for (i2 = 0; i2 < liveRows.length; i2++) {
		absorbed = 1 - liveRows[i2].v.late / ctrlLate;
		if (absorbed > bestAbsorb) {
			bestAbsorb = absorbed; bestAbsorbK = liveRows[i2].k; bestAbsorbMode = liveRows[i2].mode;
		}
	}
	console.log('  diagnostic sweep only: best live row ' + (bestAbsorbMode || 'none') +
		(bestAbsorbMode ? ' at k ' + bestAbsorbK.toExponential(0) : '') +
		(bestAbsorbMode ? ', absorbing ' + (100 * bestAbsorb).toFixed(0) + '% of the late control speed.' : '.'));
} else console.log('  no brake candidate was run or selected; the kernel remains unmodified by this harness.');
console.log('  Do not call R4 solved from this M1 measurement. Acceptance still requires the full 200 Myr');
console.log('  R4 control/brake contract at 50 and 100 kyr/frame, seeds 1 and 5, all strict R1/R2/R3/R5');
console.log('  legs, mass/replay gates, and the default-planet regression.');

check.done();

