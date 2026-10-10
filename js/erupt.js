(function (root) {
// erupt.js — square-cell pile geometry and ballistic packets on the eruptive clock.
// Freeze / landing queue. Nothing writes back while the vent lives: lava and tephra
// both wait for vent death (finish), so a live pile — effusive or explosive — is box
// mass, not a K6 surface bed (0.2.2 tephra, 0.2.5 lava). After transfer the solid
// profile stays for drawing and owns no mass.
'use strict';
var node = typeof module !== 'undefined' && module.exports;
var P = node ? require('./params.js') : window.COLP;
var S = node ? require('./state.js') : window.COLS;
var RNG = node ? require('./rng.js') : window.COLRNG;
var COL = node ? require('./columns.js') : window.COLCOLUMNS;
var SURF = node ? require('./surface.js') : window.COLSURF;

var W = P.ventBoxW, conduit = W >> 1, tanRepose = Math.tan(P.repose);
var inMol = new Float64Array(W), inFz = new Float64Array(W), inHeat = new Float64Array(W);
var inAsh = new Float64Array(W), outM = new Float64Array(W), inLi = new Int8Array(W);

var ERUPT = {
	W: W,
	at: function (v, x) { return v * W + x; },

	reset: function (v) {
		var b = v * W, x;
		for (x = 0; x < W; x++) {
			S.toyH[b + x] = 0; S.toyFz[b + x] = 0; S.toyAsh[b + x] = 0;
			S.toyT[b + x] = 0; S.toyLi[b + x] = 0;
		}
		S.prN[v] = 0;
		S.venToyIn[v] = 0; S.venToyOut[v] = 0;
		S.venLava[v] = 0; S.venTephra[v] = 0;
		S.venW[v] = 0; S.venH[v] = 0; S.venEdV[v] = 0; S.venLast[v] = 0;
		S.venRng[v] = (RNG.hash2(v + 1, 0, P.seed) * 4294967296) >>> 0 || 1;
	},

	step: function (dtSec, v) {
		if (!(dtSec > 0)) return;
		var n = Math.min(P.toyMaxTicks, Math.max(1, Math.ceil(dtSec / P.toyTickSec)));
		var dt = dtSec / n, k;
		for (k = 0; k < n; k++) this.tick(v, dt);
	},

	tick: function (v, dt) {
		this.flight(v, dt);
		this.feed(v, dt);
		this.cool(v, dt);
		for (var k = 0; k < P.toyPasses; k++) this.slump(v);
	},

	explosive: function (v) { return S.venBlast[v] > 0; },

	feed: function (v, dt) {
		var m = S.venFlux[v] * dt, rest;
		if (!(m > 0)) return;
		S.venToyIn[v] += m;
		if (!this.explosive(v)) {
			this.addMolten(this.at(v, conduit), m, 1, P.LITH.lava);
			return;
		}
		rest = this.eject(v, m, dt);
		if (rest > 0) this.addMolten(this.at(v, conduit), rest, 1, P.LITH.tephra);
	},

	// Launch times span the tick. Even a capped, long tick leaves its newest packets
	// airborne rather than retiring every packet before the renderer can see one.
	eject: function (v, m, dt) {
		var per = m / P.toyPackets, k, idx, placed = 0;
		for (k = 0; k < P.toyPackets && S.prN[v] < P.partCap; k++) {
			idx = this.launch(v, per);
			S.prT[idx] = dt * (k + 0.5) / P.toyPackets;
			if (S.prT[idx] >= this.flightTime(idx)) this.land(v, S.prN[v] - 1);
			placed += per;
		}
		return Math.max(0, m - placed);
	},

	// The second clock must not change later plate / plume draws merely by making FX.
	random: function (v) {
		var x = S.venRng[v];
		x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
		S.venRng[v] = x >>> 0;
		return (x >>> 0) / 4294967296;
	},

	launch: function (v, mass) {
		var idx = v * P.partCap + S.prN[v]++, h = S.toyH[this.at(v, conduit)];
		S.prX[idx] = conduit + 0.5; S.prY[idx] = h + 1;
		S.prVX[idx] = P.toyVx * (2 * this.random(v) - 1);
		S.prVY[idx] = P.toyVy * (0.8 + 0.4 * this.random(v));
		S.prT[idx] = 0; S.prL[idx] = mass;
		return idx;
	},

	flightTime: function (idx) { return 2 * S.prVY[idx] / P.toyG; },

	flight: function (v, dt) {
		var base = v * P.partCap, i;
		for (i = S.prN[v] - 1; i >= 0; i--) {
			S.prT[base + i] += dt;
			if (S.prT[base + i] >= this.flightTime(base + i)) this.land(v, i);
		}
	},

	land: function (v, i) {
		var idx = v * P.partCap + i, last = v * P.partCap + S.prN[v] - 1;
		var x = S.prX[idx] + S.prVX[idx] * this.flightTime(idx);
		var c = this.at(v, Math.min(W - 1, Math.max(0, Math.floor(x))));
		S.toyH[c] += S.prL[idx]; S.toyFz[c] += S.prL[idx];
		S.toyLi[c] = P.LITH.tephra;
		S.venTephra[v] += S.prL[idx];
		if (idx !== last) this.copyPacket(last, idx);
		S.prN[v]--;
	},

	copyPacket: function (from, to) {
		S.prX[to] = S.prX[from]; S.prY[to] = S.prY[from];
		S.prVX[to] = S.prVX[from]; S.prVY[to] = S.prVY[from];
		S.prT[to] = S.prT[from]; S.prL[to] = S.prL[from];
	},

	addMolten: function (c, m, tIn, lith) {
		var mol = S.toyH[c] - S.toyFz[c], tot = mol + m;
		S.toyT[c] = tot > 0 ? (S.toyT[c] * mol + tIn * m) / tot : 0;
		S.toyH[c] += m;
		if (lith === P.LITH.tephra) S.toyAsh[c] += m;
		S.toyLi[c] = lith;
	},

	cool: function (v, dt) {
		var f = Math.exp(-dt / P.toyCoolSec), x, c;
		for (x = 0; x < W; x++) {
			c = this.at(v, x);
			if (S.toyH[c] <= S.toyFz[c]) { S.toyT[c] = 0; continue; }
			S.toyT[c] *= f;
			if (S.toyT[c] < P.Tsol) this.freeze(c);
		}
	},

	freeze: function (c) {
		var v = (c / W) | 0, m = S.toyH[c] - S.toyFz[c];
		if (!(m > 0)) return;
		S.venTephra[v] += S.toyAsh[c];
		S.venLava[v] += m - S.toyAsh[c];
		S.toyFz[c] = S.toyH[c]; S.toyT[c] = 0; S.toyAsh[c] = 0;
	},

	// First count each donor's total outflow; then split its molten-first removal
	// between its two receivers. This preserves solid geometry, ash and heat, even
	// when one cell sheds to both sides. Written rock must never become new melt.
	slump: function (v) {
		var b = v * W, x, dh, moved = false;
		outM.fill(0);
		for (x = 0; x < W - 1; x++) {
			dh = S.toyH[b + x] - S.toyH[b + x + 1];
			if (dh > tanRepose) { outM[x] += 0.5 * (dh - tanRepose); moved = true; }
			else if (-dh > tanRepose) { outM[x + 1] += 0.5 * (-dh - tanRepose); moved = true; }
		}
		if (!moved) return;
		inMol.fill(0); inFz.fill(0); inHeat.fill(0); inAsh.fill(0); inLi.fill(0);
		for (x = 0; x < W - 1; x++) {
			dh = S.toyH[b + x] - S.toyH[b + x + 1];
			if (dh > tanRepose) this.shed(b, x, x + 1, 0.5 * (dh - tanRepose));
			else if (-dh > tanRepose) this.shed(b, x + 1, x, 0.5 * (-dh - tanRepose));
		}
		this.applySlump(b);
	},

	shed: function (b, src, dst, t) {
		var c = b + src, mol = S.toyH[c] - S.toyFz[c];
		var m = Math.min(mol, outM[src]) * (t / outM[src]);
		inMol[dst] += m; inFz[dst] += t - m; inHeat[dst] += m * S.toyT[c];
		if (mol > 0) inAsh[dst] += m * S.toyAsh[c] / mol;
		inLi[dst] = S.toyLi[c];
	},

	applySlump: function (b) {
		var x, c, mol, take, left, solid, ash, next;
		for (x = 0; x < W; x++) {
			if (inMol[x] === 0 && inFz[x] === 0 && outM[x] === 0) continue;
			c = b + x;
			mol = S.toyH[c] - S.toyFz[c]; take = Math.min(mol, outM[x]);
			left = mol - take; next = left + inMol[x];
			solid = S.toyFz[c] - (outM[x] - take) + inFz[x];
			ash = mol > 0 ? S.toyAsh[c] * (left / mol) : 0;
			S.toyT[c] = next > 0 ? (left * S.toyT[c] + inHeat[x]) / next : 0;
			S.toyAsh[c] = Math.min(next, ash + inAsh[x]);
			S.toyFz[c] = solid; S.toyH[c] = solid + next;
			if (inMol[x] > 0 || inFz[x] > 0) S.toyLi[c] = inLi[x];
		}
	},

	place: function (v, lith, cells, t) {
		if (!(cells > 0)) return 0;
		var c = S.venCol[v], volume = cells * P.toyCellM2;
		var placed = COL.insertVol(S, c, lith, volume / S.colW[c], t, S.wet[c] ? P.FLAG.wet : 0);
		// Same reclassification as chamber -> sill: the original melt source now
		// belongs to its solid lithology, not to both accounts at once.
		S.ledProd[P.LITH.maf] -= volume; S.ledProd[lith] += volume;
		S.venToyOut[v] += cells; S.venEdV[v] += placed * S.colW[c];
		return placed;
	},

	// lith omitted: both (death). Lava can write every K7 — a shield still freezes
	// into the stack as it cools. Tephra waits for death so K6 cannot shave a live
	// explosive pile (0.2.2).
	writeBack: function (v, t, lith) {
		var c = S.venCol[v], lava = 0, ash = 0, z0, placed;
		if (c < 0 || S.colGhost[c]) return;
		if (lith === undefined || lith === P.LITH.lava) lava = S.venLava[v];
		if (lith === undefined || lith === P.LITH.tephra) ash = S.venTephra[v];
		if (!(lava + ash > 0)) return;
		z0 = SURF.elev(c);
		placed = this.place(v, P.LITH.lava, lava, t) + this.place(v, P.LITH.tephra, ash, t);
		if (lith === undefined || lith === P.LITH.lava) S.venLava[v] = 0;
		if (lith === undefined || lith === P.LITH.tephra) S.venTephra[v] = 0;
		if (!(placed > 0)) return;
		COL.sums(c);
		// K6 has already run. Apply only the buoyancy change of this transfer, so
		// paused geology gets fresh z / Moho too, without another erosion pass.
		S.z[c] += SURF.elev(c) - z0;
		S.hDraw[c] = S.hTot[c]; S.wet[c] = S.z[c] < S.seaLevel ? 1 : 0;
		SURF.refreshSlope(c);
		SURF.refreshSlope(c > 0 ? c - 1 : S.nCol - 1);
		SURF.refreshSlope(c + 1 < S.nCol ? c + 1 : 0);
	},

	record: function (v) {
		var b = v * W, x, h = 0, lo = W, hi = -1, edge;
		for (x = 0; x < W; x++) h = Math.max(h, S.toyH[b + x]);
		edge = Math.min(1, h * 0.1);
		for (x = 0; x < W; x++) {
			if (!(S.toyH[b + x] > 0) || S.toyH[b + x] < edge) continue;
			lo = Math.min(lo, x); hi = x;
		}
		S.venW[v] = hi >= lo ? (hi - lo + 1) * P.toyCellX : 0;
		S.venH[v] = h * P.toyCellY;
	},

	// A consumed column's written rock went through K4, not into the vent's new
	// home. Keep only its transit mass, and adopt a dormant destination's geometry.
	rehome: function (v, c) {
		var b = v * W, other, ob, x, mol;
		for (x = 0; x < W; x++) { S.toyH[b + x] -= S.toyFz[b + x]; S.toyFz[b + x] = 0; }
		S.venEdV[v] = 0;
		for (other = 0; other < S.nVen; other++) {
			if (other === v || S.venCol[other] >= 0 || S.venEdCol[other] !== c) continue;
			ob = other * W;
			for (x = 0; x < W; x++) {
				mol = S.toyH[b + x] - S.toyFz[b + x];
				S.toyH[b + x] += S.toyFz[ob + x]; S.toyFz[b + x] += S.toyFz[ob + x];
				if (!(mol > 0)) S.toyLi[b + x] = S.toyLi[ob + x];
			}
			S.venEdV[v] += S.venEdV[other]; S.venLast[v] = Math.max(S.venLast[v], S.venLast[other]);
			S.venToyIn[v] += S.venToyIn[other]; S.venToyOut[v] += S.venToyOut[other];
			S.venEdCol[other] = -1; this.reset(other);
		}
		this.record(v);
	},

	// Burial hides solid relief but does not remove its rock from the column.
	// An unwritten live pile is still box mass (writeBack waits for death), so
	// sediment on the column is not covering stack-owned edifice rock.
	bury: function (c, thick) {
		var v, b, x, mol, next, lower = thick / P.toyCellY;
		if (!(lower > 0)) return;
		for (v = 0; v < S.nVen; v++) {
			if (S.venEdCol[v] !== c || !(S.venEdV[v] > 0)) continue;
			b = v * W;
			for (x = 0; x < W; x++) {
				mol = S.toyH[b + x] - S.toyFz[b + x];
				next = Math.max(0, S.toyFz[b + x] - lower);
				S.toyFz[b + x] = next; S.toyH[b + x] = next + mol;
			}
			this.record(v);
		}
	},

	// Erosion cuts the summit before the flanks. The stack removal owns the mass
	// and its rock -> sediment ledger; this only trims the sub-column shape / record.
	erode: function (c, volume) {
		var v, b, x, h, total, take, target, lo, hi, mid, cut, k, mol, next;
		if (!(volume > 0)) return;
		for (v = 0; v < S.nVen; v++) {
			if (S.venEdCol[v] !== c) continue;
			take = Math.min(volume, S.venEdV[v]); S.venEdV[v] -= take; volume -= take;
			b = v * W; h = 0; total = 0;
			for (x = 0; x < W; x++) { h = Math.max(h, S.toyFz[b + x]); total += S.toyFz[b + x]; }
			target = Math.min(total, take / P.toyCellM2); lo = 0; hi = h;
			if (!(target > 0)) continue;
			if (target >= total) hi = 0;
			else for (k = 0; k < 32; k++) {
				mid = (lo + hi) * 0.5; cut = 0;
				for (x = 0; x < W; x++) cut += Math.max(0, S.toyFz[b + x] - mid);
				if (cut > target) lo = mid; else hi = mid;
			}
			for (x = 0; x < W; x++) {
				mol = S.toyH[b + x] - S.toyFz[b + x]; next = Math.min(S.toyFz[b + x], hi);
				S.toyFz[b + x] = next; S.toyH[b + x] = next + mol;
			}
			this.record(v);
		}
	},

	// Geological retirement cannot wait on a paused eruptive clock: cool the last
	// molten material and settle its packets before releasing the domain.
	finish: function (v, t) {
		for (var x = 0; x < W; x++) this.freeze(this.at(v, x));
		while (S.prN[v] > 0) this.land(v, S.prN[v] - 1);
		this.writeBack(v, t);
	},

	// Transit mass: queues, molten, packets. After finish() drains the queues the
	// frozen profile is stack rock and is not counted again.
	mass: function (v) {
		var b = v * W, x, m = S.venLava[v] + S.venTephra[v];
		for (x = 0; x < W; x++) m += S.toyH[b + x] - S.toyFz[b + x];
		for (x = 0; x < S.prN[v]; x++) m += S.prL[v * P.partCap + x];
		return m;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = ERUPT;
else root.COLERUPT = ERUPT;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
