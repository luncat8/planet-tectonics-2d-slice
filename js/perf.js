// perf.js — smoothed fps/step laps and the 2 Hz HUD pulse (design §6 budget).
'use strict';

var PERF = {
	fps: 0, msSim: 0, msDraw: 0,
	last: 0, hudAt: 0,

	// ema toward the sample; the first sample wins
	f: function (a, b) { return a ? a * 0.9 + b * 0.1 : b; },

	// returns true on the 2 Hz HUD pulse (the HUD must never rebuild strings per frame)
	tick: function (now) {
		if (!this.last) { this.last = now; return false; }
		var dt = now - this.last;
		this.last = now;
		if (dt > 0) {
			var f = 1000 / dt;
			this.fps = this.fps ? this.fps * 0.9 + f * 0.1 : f;
		}
		if (now - this.hudAt >= 500) { this.hudAt = now; return true; }
		return false;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = PERF;
