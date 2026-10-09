(function (root) {
// sim.js — the frame pipeline (design §3). K0 runs inline (clocks, Tm, the 1 Myr event
// cadence); K1..K9 sit in slots and fill in across M2..M6:
//   K1 mantle/plumes/fan T   K2 plate solve   K3 move columns + boundaries
//   K4 contact (spawn/consume)   K5 column update   K6 surface   K7 vents (eruptive
//   clock)   K8 deposits / resource bookkeeping   K9 diag (SIM.diag, on the HUD's 2 Hz
//   cadence rather than per frame: invariants are a report, not a kernel).
// Geologic time is Myr here: the slider is yr/frame and is converted on entry, so no
// kernel ever multiplies a Myr rate by a yr step (design §9 one unit system). K7 is the
// one kernel with its own clock: it runs while dtGeo is 0 (lava time is free) and idles
// its toy while the eruptive slider is 0 (geology fills chambers all the same).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COLCOLUMNS;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.COLMANTLE;
var SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.COLSLAB;
var PLT = (typeof module !== 'undefined' && module.exports) ? require('./plates.js') : window.COLPLATES;
var MAG = (typeof module !== 'undefined' && module.exports) ? require('./magma.js') : window.COLMAGMA;
var CRU = (typeof module !== 'undefined' && module.exports) ? require('./crust.js') : window.COLCRUST;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.COLSURF;
var ORE = (typeof module !== 'undefined' && module.exports) ? require('./ore.js') : root.COLORE;
var SEC = (typeof module !== 'undefined' && module.exports) ? require('./section-pack.js') : window.COLSECTION;
var UI = (typeof module !== 'undefined' && module.exports) ? require('./ui.js') : root.COLUI;
var RNDR = (typeof module !== 'undefined' && module.exports) ? require('./render.js') : root.COLRENDER;
var PERF = (typeof module !== 'undefined' && module.exports) ? require('./perf.js') : root.COLPERF;
var node = typeof module !== 'undefined' && module.exports;
COL.slab = SLAB;

var active = false, activeHost = null, activeWindow = null, frameId = 0;

// --- K9 diagnostic scratch (design §6): allocated once, like every other buffer ----
// The sweep is read-only against the model, so a HUD repaint cannot change the hash.
var diagMass = new Float64Array(P.LITH.n);
var diagBase = new Float64Array(P.LITH.n);
var diagErr = new Float64Array(P.LITH.n);
var diagCounts = new Int32Array(P.plateCap);
var diagSeen = new Uint8Array(P.colCap);
var diagStale = true;

function hostDocument(host) {
	if (!host) return root.document || null;
	if (host.nodeType === 9) return host;
	return host.ownerDocument || null;
}

function hostWindow(host, doc) {
	if (host && host.window === host) return host;
	return doc && doc.defaultView ? doc.defaultView : root;
}

function hostElement(host, doc, id) {
	var scope = host || doc;
	if (!scope) return null;
	if (scope.getElementById) return scope.getElementById(id);
	return scope.querySelector ? scope.querySelector('#' + id) : null;
}

function frame(now) {
	if (!active) return;
	var win = activeWindow;
	var a = win.performance && win.performance.now ? win.performance.now() : Date.now();
	if (SEC.mode) SEC.frame(); else SIM.step();
	var b = win.performance && win.performance.now ? win.performance.now() : Date.now();
	if (SEC.mode) SEC.draw(); else RNDR.redraw();
	var c = win.performance && win.performance.now ? win.performance.now() : Date.now();
	PERF.msSim = PERF.f(PERF.msSim, b - a);
	PERF.msDraw = PERF.f(PERF.msDraw, c - b);
	if (PERF.tick(now)) { if (SEC.mode) SEC.hud(); else UI.updateHud(); }
	frameId = win.requestAnimationFrame(frame);
}

function simK1(st, dt, t, Tm) {
	if (!(dt > 0)) return;
	MNT.k1(st, dt, t, Tm);
	SLAB.k1(st, dt, t, Tm);
	MAG.k1(st, dt, t, Tm);
}

function simK2(st, dt, t, Tm) {
	if (SIM.kinematic && SIM.kinematic(st, dt, t, Tm)) return;
	PLT.k2(st, dt, t, Tm);
}

function simK3(st, dt) {
	PLT.k3(st, dt, !!SIM.kinematic);
}

var SIM = {
	// kernel slots: (state, dtGeo Myr, t Myr, Tm); only K7 and K8 bookkeeping run at dtGeo = 0
	k: [null, simK1, simK2, simK3, function (st, dt, t, Tm) {
		if (COL.k4(st, dt, t, Tm)) {
			PLT.classify(st, 0, !!SIM.kinematic);
			PLT.trench(st);
			COL.finalFloor(st, st.nCol);
		}
		// A topology-stable frame takes no freeze of its own: K3's transport already took
		// the snapshot this frame's geometry was settled under, and that is the reading the
		// rest of the frame (K5's hFel redistribution above all) must not revoke. Freezing
		// again here would replace it with the classifier's later verdict and leave the
		// settled gap judged against a floor nothing ever solved for (0.2.0 M5).
	}, CRU.k5, SURF.k6, MAG.k7, ORE.k8, null],
	dG: 0,          // Myr per frame, from the plates slider
	kinematic: null, // optional C3 K2 owner; returns true when it supplied plate velocities
	t: 0,           // Myr
	tErupt: 0,      // s, the eruptive clock (the only seconds quantity)
	Tm: 0, frame: 0, evT: 0, event: 0,
	onEvent: COL.events,  // post-K4 cadence hook: split/suture
	started: false,

	add: function (slot, fn) { this.k[slot] = fn; },

	start: function (host) {
		if (active && (!host || host === activeHost)) return this;
		if (active) this.stop();
		var target = host || root.document;
		var doc = hostDocument(target);
		var win = hostWindow(target, doc);
		if (!doc || !win || !win.requestAnimationFrame) throw new Error('COLSIM.start needs a DOM host and requestAnimationFrame');
		if (!hostElement(target, doc, 'c')) throw new Error('COLSIM host is missing the canvas #c');
		activeHost = target;
		activeWindow = win;
		if (SEC.sectionStart(target)) {
			SEC.init(target);
		} else {
			SEC.stop();
			this.reset();
			UI.init(target);
			RNDR.init(hostElement(target, doc, 'c'));
			GEO.setPreset('def');
			UI.afterView();
		}
		active = true;
		this.started = true;
		frameId = win.requestAnimationFrame(frame);
		return this;
	},

	stop: function () {
		if (!active) return this;
		active = false;
		this.started = false;
		if (frameId && activeWindow && activeWindow.cancelAnimationFrame) activeWindow.cancelAnimationFrame(frameId);
		frameId = 0;
		if (SEC.stop) SEC.stop();
		if (UI.stop) UI.stop();
		this.dG = 0;
		activeHost = null;
		activeWindow = null;
		return this;
	},

	// both clocks from the sliders: yr/frame in, Myr/frame out
	setGeo: function (yrPerFrame) { this.dG = yrPerFrame / 1e6; },

	reset: function () {
		this.t = 0; this.tErupt = 0; this.frame = 0; this.evT = 0; this.event = 0;
		this.kinematic = null;
		this.dG = P.sl.geo / 1e6;
		this.cool();
		COL.floorClassValid = false;
		UI.clearOre();
		S.reset();
		MNT.init(P.seed);
		SLAB.reset();
		COL.makePlanet(this.Tm);
		MNT.initPlumes(S, P.seed);
		ORE.init(S, this.Tm);
		this.diagReset();
	},

	cool: function () {
		this.Tm = P.Tfloor + (P.Tm0 - P.Tfloor) * Math.exp(-this.t / P.tauCool);
	},

	// K0: clocks, secular cooling, the event cadence
	k0: function () {
		this.t += this.dG;
		this.tErupt += P.sl.erupt;
		this.cool();
		this.evT += this.dG;
		this.event = 0;
		while (this.evT >= P.eventCadence) {
			this.evT -= P.eventCadence;
			this.event++;
		}
	},

	// The world was rebuilt (reset, restore, seeded cut): the next sweep re-bases the
	// ledger identity from the state it finds, exactly as the run's own t = 0.
	diagReset: function () { diagStale = true; },

	// K9's sweep, run on the HUD's 2 Hz cadence: sorted, widths, plate counts, the
	// per-lithology ledger including the named ledDelam sink, and the contact floor.
	// Every read is passive; the floor's own documented slack (floorTol) is the pass
	// bound, with a closing C-C conveyor held at the crush floor instead (0.1.5 M1).
	diag: function () {
		var n = S.nCol, i, j, k, p, l, v, d, sum, rhs, lo, cc;
		var out = {
			ok: true, sorted: true, widths: true, plates: true, ledger: true, gap: true,
			minGap: P.wrap, minCC: P.wrap, worst: 0, worstLi: 0, delam: 0, err: diagErr
		};
		for (i = 0; i + 1 < n; i++) if (S.colX[i] > S.colX[i + 1]) { out.sorted = false; break; }
		if (out.sorted) {
			for (i = 0; i < n; i++) diagSeen[i] = 0;
			for (i = 0; i < n; i++) {
				k = S.sortOrder[i];
				if (!(k >= 0 && k < n) || diagSeen[k]++) { out.sorted = false; break; }
			}
		}
		if (out.sorted) for (i = 0; i < n; i++) {
			if (S.sortInverse[S.sortOrder[i]] !== i) { out.sorted = false; break; }
		}
		sum = 0;
		for (i = 0; i < n; i++) {
			v = S.colW[i];
			if (!(v > 0) || !Number.isFinite(v)) { out.widths = false; break; }
			sum += v;
		}
		if (out.widths && Math.abs(sum - P.wrap) > 1e-9 * P.wrap) out.widths = false;
		diagCounts.fill(0);
		for (i = 0; i < n && out.plates; i++) {
			p = S.colPlate[i];
			if (!(p >= 0 && p < S.nPl)) { out.plates = false; break; }
			diagCounts[p]++;
		}
		if (out.plates) for (p = 0; p < S.nPl; p++) {
			if (diagCounts[p] !== S.plN[p]) { out.plates = false; break; }
		}
		if (diagStale) {
			S.massInto(diagMass);
			for (l = 0; l < P.LITH.n; l++) {
				diagBase[l] = diagMass[l] + S.ledCons[l] + S.ledDelam[l] +
					S.ledMixOut[l] - S.ledProd[l] - S.ledMixIn[l];
			}
			diagStale = false;
		}
		S.massInto(diagMass);
		for (l = 0; l < P.LITH.n; l++) {
			rhs = diagBase[l] + S.ledProd[l] + S.ledMixIn[l];
			v = Math.abs(diagMass[l] + S.ledCons[l] + S.ledDelam[l] + S.ledMixOut[l] - rhs) /
				Math.max(1, Math.abs(rhs));
			diagErr[l] = Number.isFinite(v) ? v : Infinity;
			if (diagErr[l] > out.worst) { out.worst = diagErr[l]; out.worstLi = l; }
			out.delam += S.ledDelam[l];
		}
		if (!(out.worst < 1e-9)) out.ledger = false;
		lo = P.gFloor * P.w0 * (1 - P.floorTol);
		cc = P.crushFloor * (1 - P.floorTol);
		for (i = 0; i < n; i++) {
			j = i + 1 < n ? i + 1 : 0;
			if (S.colPlate[i] === S.colPlate[j]) continue;
			d = S.colX[j] - S.colX[i];
			if (d < 0) d += P.wrap;
			if (COL.isClosingCC(S, i, j)) {
				if (d < out.minCC) out.minCC = d;
				if (d < cc) out.gap = false;
			} else {
				if (d < out.minGap) out.minGap = d;
				if (d < lo) out.gap = false;
			}
		}
		out.ok = out.sorted && out.widths && out.plates && out.ledger && out.gap;
		return out;
	},

	// The HUD's two diagnostic lines. Built at 2 Hz like the rest of the HUD text.
	diagText: function () {
		var d = this.diag(), name = ['sed', 'fel', 'maf', 'tephra', 'lava', 'sill'], l;
		var s = 'invariants  sorted ' + (d.sorted ? 'ok' : 'FAIL') +
			'  widths ' + (d.widths ? 'ok' : 'FAIL') +
			'  plates ' + (d.plates ? 'ok' : 'FAIL') +
			'  ledger ' + (d.ledger ? 'ok' : 'FAIL') +
			'  gap ' + (d.gap ? 'ok' : 'FAIL') + ' ' +
			(isFinite(d.minGap) ? (d.minGap / P.w0).toFixed(4) : '—') + ' w0' +
			' (C-C ' + (isFinite(d.minCC) ? (d.minCC / P.w0).toFixed(4) : '—') + ')';
		s += '\nledger    ';
		for (l = 0; l < P.LITH.n; l++) {
			s += name[l] + ' ' + (d.err[l] < 1e-9 ? 'ok' : d.err[l].toExponential(1)) + '  ';
		}
		s += 'delam ' + d.delam.toExponential(3) + ' m3';
		return s;
	},

	step: function () {
		this.frame++;
		this.k0();
		for (var i = 1; i < 10; i++) {
			var f = this.k[i];
			if (f) f(S, this.dG, this.t, this.Tm);
			if (i === 4 && this.dG > 0 && this.onEvent) {
				for (var e = 0; e < this.event; e++) {
					if (this.onEvent(S, this.dG)) {
						PLT.classify(S, 0, !!this.kinematic);
						PLT.trench(S);
						COL.finalFloor(S, S.nCol);
					}
				}
			}
		}
	},

	// n frames headless (experiments); returns the state hash
	run: function (n) {
		for (var i = 0; i < n; i++) this.step();
		return S.hash();
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
else root.COLSIM = SIM;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
