// sim.js — the frame pipeline (design §3): K0 clocks/Tm/1-Myr events inline; kernels
// register themselves by slot (K1..K9 fill in across M2-M6 in slot order). The browser
// starts the rAF loop here; node loads get the object only.
'use strict';

var SIM = {
	k: [null, null, null, null, null, null, null, null, null, null],
	t: 0, tErupt: 0, Tm: 0, frame: 0, evT: 0,
	onEvent: null,   // the 1 Myr cadence (K0): split/suture/compact (M1.1, M2.2)

	add: function (slot, fn) { this.k[slot] = fn; },

	step: function () {
		var dG = P.sl.geo;
		this.t += dG;
		this.tErupt += P.sl.erupt;
		this.Tm = P.Tfloor + (P.Tm0 - P.Tfloor) * Math.exp(-this.t / P.tauCool);
		this.evT += dG;
		while (this.evT >= 1e6) {
			this.evT -= 1e6;
			if (this.onEvent) this.onEvent();
		}
		this.frame++;
		for (var i = 1; i < 10; i++) {
			var f = this.k[i];
			if (f) f();
		}
	}
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
	UI.init();
	RNDR.init();
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
