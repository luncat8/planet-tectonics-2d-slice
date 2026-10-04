// sim.js — the frame pipeline (design §3). K0 runs inline (clocks, Tm, the 1 Myr event
// cadence); K1..K9 sit in slots and fill in across M2..M6:
//   K1 mantle/plumes/fan T   K2 plate solve   K3 move columns + boundaries
//   K4 contact (spawn/consume)   K5 column update   K6 surface   K7 vents (eruptive
//   clock)   K8 reserved   K9 diag
// Geologic time is Myr here: the slider is yr/frame and is converted on entry, so no
// kernel ever multiplies a Myr rate by a yr step (design §9 one unit system).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.MNT;
var SLAB = (typeof module !== 'undefined' && module.exports) ? require('./slab.js') : window.SLAB;
var PLT = (typeof module !== 'undefined' && module.exports) ? require('./plates.js') : window.PLT;
var MAG = (typeof module !== 'undefined' && module.exports) ? require('./magma.js') : window.MAG;
var CRU = (typeof module !== 'undefined' && module.exports) ? require('./crust.js') : window.CRU;
var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.SURF;
var SEC = (typeof module !== 'undefined' && module.exports) ? require('./section-pack.js') : window.SectionPack;
COL.slab = SLAB;

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

var SIM = {
	// kernel slots; each is (state, dtGeo Myr, t Myr, Tm) and must no-op at dtGeo = 0
	k: [null, simK1, simK2, PLT.k3, function (st, dt, t, Tm) {
		if (COL.k4(st, dt, t, Tm)) { PLT.classify(st, 0); PLT.trench(st); }
	}, CRU.k5, SURF.k6, null, null, null],
	dG: 0,          // Myr per frame, from the plates slider
	kinematic: null, // optional C3 K2 owner; returns true when it supplied plate velocities
	t: 0,           // Myr
	tErupt: 0,      // s, the eruptive clock (the only seconds quantity)
	Tm: 0, frame: 0, evT: 0, event: 0,
	onEvent: COL.events,  // post-K4 cadence hook: split/suture

	add: function (slot, fn) { this.k[slot] = fn; },

	// both clocks from the sliders: yr/frame in, Myr/frame out
	setGeo: function (yrPerFrame) { this.dG = yrPerFrame / 1e6; },

	reset: function () {
		this.t = 0; this.tErupt = 0; this.frame = 0; this.evT = 0; this.event = 0;
		this.kinematic = null;
		this.dG = P.sl.geo / 1e6;
		this.cool();
		S.reset();
		MNT.init(P.seed);
		SLAB.reset();
		COL.makePlanet(this.Tm);
		MNT.initPlumes(S, P.seed);
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

	step: function () {
		this.frame++;
		this.k0();
		for (var i = 1; i < 10; i++) {
			var f = this.k[i];
			if (f) f(S, this.dG, this.t, this.Tm);
			if (i === 4 && this.dG > 0 && this.onEvent) {
				for (var e = 0; e < this.event; e++) {
					if (this.onEvent(S, this.dG)) { PLT.classify(S, 0); PLT.trench(S); }
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

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	// section mode (?start=section): the page is a view of a cut, not the engine's world —
	// no planet reset, no engine clock; the canvas is the raw strip until M2 seeds the
	// engine from the pack (plan §4.4: both run modes start stopped and say so)
	if (SEC.sectionStart()) {
		SEC.init();
	} else {
		SIM.reset();
		UI.init();
		RNDR.init(document.getElementById('c'));
		GEO.setPreset('def');
		UI.afterView();
	}
	function tick(now) {
		var a = performance.now();
		if (SEC.mode) SEC.frame(); else SIM.step();
		var b = performance.now();
		if (SEC.mode) SEC.draw(); else RNDR.redraw();
		var c = performance.now();
		PERF.msSim = PERF.f(PERF.msSim, b - a);
		PERF.msDraw = PERF.f(PERF.msDraw, c - b);
		if (PERF.tick(now)) { if (SEC.mode) SEC.hud(); else UI.updateHud(); }
		window.requestAnimationFrame(tick);
	}
	window.requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
