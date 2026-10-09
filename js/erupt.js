(function (root) {
// erupt.js — the toy eruptive box (design §5.1, §1.5): one ventBoxW x ventBoxH domain per
// vent, in screen cells. A toy column is a pile of height toyH; toyFz is its solid part
// and the rest is molten at toyT. Effusive feeds pour molten lava into the conduit column,
// which cools and freezes. Explosive feeds eject ballistic packets that land as cold
// tephra. Slumping moves material only downhill at the angle of repose. The box is a pure
// function of its state and the vent's flux, so the bench steps it without a page. Mass is
// in cells^2 (the toy volume); the jacobian to world mass is write-back's job (0.2.0 M2).
'use strict';
var node = typeof module !== 'undefined' && module.exports;
var P = node ? require('./params.js') : window.COLP;
var S = node ? require('./state.js') : window.COLS;
var RNG = node ? require('./rng.js') : window.COLRNG;

var W = P.ventBoxW;
var tanRepose = Math.tan(P.repose);
var conduit = W >> 1;
// scratch for one slump pass, allocated once: mass in, heat in, mass out per toy column
var inM = new Float64Array(W), inH = new Float64Array(W), outM = new Float64Array(W);

var ERUPT = {
	W: W,

	// one column's index in the flat per-vent arrays
	at: function (v, x) { return v * W + x; },

	reset: function (v) {
		var b = v * W, x;
		for (x = 0; x < W; x++) {
			S.toyH[b + x] = 0; S.toyFz[b + x] = 0; S.toyT[b + x] = 0; S.toyLi[b + x] = 0;
		}
		S.prN[v] = 0;
		S.venToyIn[v] = 0;
	},

	// advance vent v's box by dtSec of eruptive time, cut into toy ticks
	step: function (dtSec, v) {
		var n, dt, k;
		if (!(dtSec > 0)) return;
		n = Math.min(P.toyMaxTicks, Math.max(1, Math.ceil(dtSec / P.toyTickSec)));
		dt = dtSec / n;
		for (k = 0; k < n; k++) this.tick(v, dt);
	},

	tick: function (v, dt) {
		this.feed(v, dt);
		this.cool(v, dt);
		this.flight(v, dt);
		for (var k = 0; k < P.toyPasses; k++) this.slump(v);
	},

	explosive: function (v) { return S.venGas[v] > P.gasBlast; },

	feed: function (v, dt) {
		var m = S.venFlux[v] * dt, rest;
		if (!(m > 0)) return;
		S.venToyIn[v] += m;
		if (!this.explosive(v)) {
			this.addMolten(this.at(v, conduit), m, 1, P.LITH.lava);
			return;
		}
		rest = this.eject(v, m);
		if (rest > 0) this.addMolten(this.at(v, conduit), rest, 1, P.LITH.tephra);
	},

	// launch packets of m split evenly; returns the mass that found no free packet slot
	eject: function (v, m) {
		var per = m / P.toyPackets, k, placed = 0;
		for (k = 0; k < P.toyPackets && S.prN[v] < P.partCap; k++) {
			this.launch(v, per);
			placed += per;
		}
		return m - placed;
	},

	launch: function (v, mass) {
		var idx = v * P.partCap + S.prN[v]++, h = S.toyH[this.at(v, conduit)];
		S.prX[idx] = conduit + 0.5;
		S.prY[idx] = h + 1;
		S.prVX[idx] = RNG.range(-P.toyVx, P.toyVx);
		S.prVY[idx] = P.toyVy * RNG.range(0.8, 1.2);
		S.prT[idx] = 0;
		S.prL[idx] = mass;
	},

	// a packet is a ballistic arc: its flight ends when it returns to launch height
	flightTime: function (idx) { return 2 * S.prVY[idx] / P.toyG; },

	flight: function (v, dt) {
		var base = v * P.partCap, i;
		// backwards, so a swap-remove only moves an already-advanced packet
		for (i = S.prN[v] - 1; i >= 0; i--) {
			S.prT[base + i] += dt;
			if (S.prT[base + i] >= this.flightTime(base + i)) this.land(v, i);
		}
	},

	// the packet's own mass lands on the column under its arc; the box edge clamps it
	land: function (v, i) {
		var idx = v * P.partCap + i, last = v * P.partCap + S.prN[v] - 1;
		var x = S.prX[idx] + S.prVX[idx] * this.flightTime(idx), c;
		c = Math.min(W - 1, Math.max(0, Math.floor(x)));
		S.toyH[this.at(v, c)] += S.prL[idx];
		S.toyFz[this.at(v, c)] += S.prL[idx];
		S.toyLi[this.at(v, c)] = P.LITH.tephra;
		if (idx !== last) this.copyPacket(last, idx);
		S.prN[v]--;
	},

	copyPacket: function (from, to) {
		S.prX[to] = S.prX[from]; S.prY[to] = S.prY[from];
		S.prVX[to] = S.prVX[from]; S.prVY[to] = S.prVY[from];
		S.prT[to] = S.prT[from]; S.prL[to] = S.prL[from];
	},

	// molten mass joins a column; its temperature is the mass-weighted mean
	addMolten: function (c, m, tIn, lith) {
		var mol = S.toyH[c] - S.toyFz[c], tot = mol + m;
		S.toyT[c] = tot > 0 ? (S.toyT[c] * mol + tIn * m) / tot : 0;
		S.toyH[c] += m;
		S.toyLi[c] = lith;
	},

	// molten part cools toward air; below Tsol the whole column is solid
	cool: function (v, dt) {
		var f = Math.exp(-dt / P.tauCool), x, c;
		for (x = 0; x < W; x++) {
			c = this.at(v, x);
			if (S.toyH[c] - S.toyFz[c] <= 0) { S.toyT[c] = 0; continue; }
			S.toyT[c] *= f;
			if (S.toyT[c] < P.Tsol) this.freeze(c);
		}
	},

	freeze: function (c) {
		S.toyFz[c] = S.toyH[c];
		S.toyT[c] = 0;
	},

	// one pass: each adjacent pair steeper than the repose slope sheds half its excess
	// downhill. Transfers are computed from the pass's start heights and applied together,
	// so the pass is order-free and mass-exact.
	slump: function (v) {
		var b = v * W, x, dh, t;
		for (x = 0; x < W; x++) { inM[x] = 0; inH[x] = 0; outM[x] = 0; }
		for (x = 0; x < W - 1; x++) {
			dh = S.toyH[b + x] - S.toyH[b + x + 1];
			if (dh > tanRepose) this.shed(b, x, x + 1, 0.5 * (dh - tanRepose));
			else if (-dh > tanRepose) this.shed(b, x + 1, x, 0.5 * (-dh - tanRepose));
		}
		this.applySlump(b);
	},

	shed: function (b, src, dst, t) {
		outM[src] += t;
		inM[dst] += t;
		inH[dst] += t * S.toyT[b + src];
	},

	applySlump: function (b) {
		var x, c, mol, molNew, tot;
		for (x = 0; x < W; x++) {
			if (inM[x] === 0 && outM[x] === 0) continue;
			c = b + x;
			mol = S.toyH[c] - S.toyFz[c];
			molNew = mol + inM[x] - outM[x];
			tot = mol + inM[x];
			if (tot > 0 && inM[x] > 0) S.toyT[c] = (S.toyT[c] * mol + inH[x]) / tot;
			S.toyH[c] += inM[x] - outM[x];
			// removal takes molten mass first; only a deficit eats the solid part
			if (molNew < 0) S.toyFz[c] = Math.max(0, S.toyFz[c] + molNew);
			if (S.toyH[c] < S.toyFz[c]) S.toyFz[c] = S.toyH[c];
		}
	},

	// the box's mass: piles plus packets in flight (cells^2)
	mass: function (v) {
		var b = v * W, x, m = 0;
		for (x = 0; x < W; x++) m += S.toyH[b + x];
		for (x = 0; x < S.prN[v]; x++) m += S.prL[v * P.partCap + x];
		return m;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = ERUPT;
else root.COLERUPT = ERUPT;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
