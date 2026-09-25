// sim.js — the frame pipeline (design §3). K0 runs inline (clocks, Tm, the 1 Myr event
// cadence); K1..K9 register themselves by slot and fill in across M2..M6:
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

var SIM = {
	k: [null, null, null, null, null, null, null, null, null, null],
	dG: 0,          // Myr per frame, from the plates slider
	t: 0,           // Myr
	tErupt: 0,      // s, the eruptive clock (the only seconds quantity)
	Tm: 0, frame: 0, evT: 0, event: 0,
	onEvent: null,  // the 1 Myr cadence hook (K0): split/suture/compact (M2.2)

	add: function (slot, fn) { this.k[slot] = fn; },

	// both clocks from the sliders: yr/frame in, Myr/frame out
	setGeo: function (yrPerFrame) { this.dG = yrPerFrame / 1e6; },

	reset: function () {
		this.t = 0; this.tErupt = 0; this.frame = 0; this.evT = 0; this.event = 0;
		this.dG = P.sl.geo / 1e6;
		this.cool();
		S.reset();
		COL.makePlanet(this.Tm);
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
			this.event = 1;
			if (this.onEvent) this.onEvent();
		}
	},

	step: function () {
		this.frame++;
		this.k0();
		for (var i = 1; i < 10; i++) {
			var f = this.k[i];
			if (f) f();
		}
	},

	// n frames headless (experiments); returns the state hash
	run: function (n) {
		for (var i = 0; i < n; i++) this.step();
		return S.hash();
	}
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	SIM.reset();
	UI.init();
	RNDR.init(document.getElementById('c'));
	GEO.setPreset('def');
	function tick(now) {
		var a = performance.now();
		SIM.step();
		var b = performance.now();
		RNDR.redraw();
		var c = performance.now();
		PERF.msSim = PERF.f(PERF.msSim, b - a);
		PERF.msDraw = PERF.f(PERF.msDraw, c - b);
		if (PERF.tick(now)) UI.updateHud();
		window.requestAnimationFrame(tick);
	}
	window.requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
