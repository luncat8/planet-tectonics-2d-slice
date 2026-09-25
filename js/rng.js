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
	range: function (a, b) { return a + (b - a) * this.u(); },

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

// Stable world noise: a hashed lattice, NOT a permutation table. It is a pure function
// of (x, y, seed), so it survives column motion, spawn and consume without any stored
// field, and two runs with the same seed agree everywhere. The stream RNG above is for
// draws in kernel order; this is for terrain, and the two never share state.
RNG.smooth = function (t) { return t * t * (3 - 2 * t); };

RNG.hash2 = function (i, j, s) {
	var h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) +
		Math.imul(s | 0, 1442695041)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
};

RNG.noise2 = function (x, y, s) {
	var xi = Math.floor(x), yi = Math.floor(y);
	var fx = this.smooth(x - xi), fy = this.smooth(y - yi);
	var a = this.hash2(xi, yi, s), b = this.hash2(xi + 1, yi, s);
	var c = this.hash2(xi, yi + 1, s), d = this.hash2(xi + 1, yi + 1, s);
	var ab = a + (b - a) * fx, cd = c + (d - c) * fx;
	return ab + (cd - ab) * fy;
};

// normalized fbm in [0, 1]; each octave doubles the frequency and halves the amplitude
RNG.fbm2 = function (x, y, oct, s) {
	var sum = 0, amp = 1, norm = 0, f = 1, o;
	for (o = 0; o < oct; o++) {
		sum += amp * this.noise2(x * f, y * f, s + o * 1013);
		norm += amp;
		amp *= 0.5;
		f *= 2;
	}
	return sum / norm;
};

if (typeof module !== 'undefined' && module.exports) module.exports = RNG;
