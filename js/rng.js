// rng.js — the one seeded RNG of the run (design §6): 128-bit xorshift, Marsaglia
// tuple (11,19,8) in 32-bit halves (period 2^128-1, no 64-bit ops in JS). Every draw
// happens in kernel order, so a run is bit-reproducible from (seed, sliders, params).
'use strict';

var RNG = {
	s: [1, 1, 1, 1],
	gs: 0, gh: false,

	// expand one 32-bit seed into the four state words (mulberry32 walk)
	seed: function (n) {
		var s = (n >>> 0) || 1, a = this.s, i, z, v;
		for (i = 0; i < 4; i++) {
			s = (s + 0x9e3779b9) >>> 0;
			z = s;
			z = Math.imul(z ^ (z >>> 15), z | 1);
			z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
			v = (z ^ (z >>> 14)) >>> 0 || 1; // keep the state non-zero
			a[i] = v;
		}
		this.gs = 0;
		this.gh = false;
	},

	next: function () {
		var a = this.s;
		var t = a[0] ^ (a[0] << 11);
		a[0] = a[1]; a[1] = a[2]; a[2] = a[3];
		a[3] = (a[3] ^ (a[3] >>> 19) ^ t ^ (t >>> 8)) >>> 0;
		return a[3];
	},

	u: function () { return this.next() / 4294967296; },   // [0, 1)
	i: function (m) { return Math.floor(this.u() * m); }, // [0, m)

	// Box-Muller with a cached spare
	g: function () {
		if (this.gh) { this.gh = false; return this.gs; }
		var r = Math.sqrt(-2 * Math.log(1 - this.u()));
		var th = 6.283185307179586 * this.u();
		this.gs = r * Math.sin(th);
		this.gh = true;
		return r * Math.cos(th);
	},

	// save/load hooks (design §6): the RNG state is part of a save file
	state: function () { return [this.s[0], this.s[1], this.s[2], this.s[3]]; },
	setState: function (a) { this.s[0] = a[0]; this.s[1] = a[1]; this.s[2] = a[2]; this.s[3] = a[3]; }
};

if (typeof module !== 'undefined' && module.exports) module.exports = RNG;
