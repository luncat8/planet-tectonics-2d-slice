(function (root) {
// magma.js — M4 melt supply and chambers (design §4.5, §5.2). Ribbon water is
// released by slab.js, converted to a bounded wedge melt source, and held in a
// per-column chamber until it spills as an intrusive sill. Chambers are volumes per
// unit depth, so changing column widths cannot create or destroy melt.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.COLS;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.COLMANTLE;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COLCOLUMNS;
// erupt.js and perf.js are loaded after this file (columns.html order), so both are
// resolved at call time, as js/checkpoint.js does for its own late dependencies
function erupt() {
	return (typeof module !== 'undefined' && module.exports) ? require('./erupt.js') : root.COLERUPT;
}
function perf() {
	return (typeof module !== 'undefined' && module.exports) ? require('./perf.js') : root.COLPERF;
}
function now() {
	return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

var MAG = {
	dx: function (a, b) {
		var d = b - a;
		if (d > P.wrap * 0.5) d -= P.wrap;
		else if (d < -P.wrap * 0.5) d += P.wrap;
		return d;
	},

	// Sorted column positions make this a logarithmic nearest-owner lookup. The two
	// candidates around the insertion point are enough on the periodic line.
	nearest: function (st, x) {
		var n = st.nCol, lo = 0, hi = n, m, k, km, d, dm;
		if (n === 0) return -1;
		while (lo < hi) {
			m = (lo + hi) >> 1;
			if (st.colX[m] < x) lo = m + 1; else hi = m;
		}
		k = lo < n ? lo : 0;
		km = k > 0 ? k - 1 : n - 1;
		d = Math.abs(this.dx(st.colX[k], x));
		dm = Math.abs(this.dx(st.colX[km], x));
		return dm < d ? km : k;
	},

	arcColumn: function (st, x) {
		var c = this.nearest(st, x), n = st.nCol, q, best = -1, bestD = 300e3, d;
		if (c < 0) return -1;
		for (q = -4; q <= 4; q++) {
			var j = (c + q + n) % n;
			if (!(st.trenchDist[j] > 0) || st.colGhost[j]) continue;
			d = Math.abs(this.dx(st.colX[j], x));
			if (d < bestD) { bestD = d; best = j; }
		}
		return best;
	},

	add: function (st, c, amount, arc) {
		if (!(amount > 0) || c < 0) return;
		st.colChamber[c] += amount;
		if (arc) {
			st.colMeltArc[c] += amount;
			st.meltArc += amount;
		} else {
			st.colMeltPlume[c] += amount;
			st.meltPlume += amount;
		}
		st.ledProd[P.LITH.maf] += amount;
	},

	arc: function (st, dt) {
		var r, k, n, base, rel, c, temp, amount, x, y;
		for (r = 0; r < st.nRib; r++) {
			base = r * P.ribNodeCap;
			n = st.ribN[r];
			for (k = 0; k < n; k++) {
				rel = st.ribRelW[base + k];
				if (!(rel > 0)) continue;
				x = st.ribX[base + k];
				y = st.ribY[base + k];
				c = this.arcColumn(st, x);
				if (c >= 0) {
					temp = P.wedgeT0 + MNT.sampleT(st.Tf, x, y) - P.Tc;
					if (temp > 0) {
						amount = P.kMelt * rel * temp;
						this.add(st, c, amount, true);
						st.colRecycle[c] += rel;
					}
				}
				// Released water has left the slab even if the wedge is too cold or
				// the nearest arc column is outside the 300 km factory range.
				st.waterUsed += rel;
				st.ribRelW[base + k] = 0;
			}
		}
		void dt;
	},

	// The column a plume melts into: the nearest one that is real ground. A draining
	// sliver is the trench, not crust, and melt parked in its chamber leaves the model
	// unbooked when the trench retires the record (measured: 1.35e4 m3 of mafic on two
	// slivers retired in one frame at 112 Myr on seed 1).
	plumeColumn: function (st, x) {
		var c = this.nearest(st, x), n = st.nCol, q, j;
		if (c < 0) return -1;
		for (q = 0; q <= 4; q++) {
			j = (c + q) % n;
			if (!st.colGhost[j]) return j;
			j = (c - q + n) % n;
			if (!st.colGhost[j]) return j;
		}
		return -1;
	},

	plume: function (st, dt) {
		var i, c, temp, amount;
		for (i = 0; i < st.nPlm; i++) {
			if (!st.plmArrive[i] || !(st.plmStr[i] > 0)) continue;
			c = this.plumeColumn(st, st.plmX[i]);
			if (c < 0) continue;
			temp = 0.8 + st.plmStr[i] * 0.4;
			amount = P.kPlumeMelt * st.plmStr[i] * temp * dt;
			this.add(st, c, amount, false);
		}
	},

	spill: function (st, t) {
		var i, over, th;
		for (i = 0; i < st.nCol; i++) {
			over = st.colChamber[i] - P.chamberCap;
			if (!(over > 0)) continue;
			st.colChamber[i] = P.chamberCap;
			th = over / st.colW[i];
			// a sill is an intrusive sheet: the deepest rank, not a surface lid
			COL.insertVol(st, i, P.LITH.sill, th, t, 0);
			COL.sums(i);
			// The chamber is audited as mafic melt; solidifying it into a sill moves the
			// mass between two stored lithologies, so the production entry moves with it.
			st.ledProd[P.LITH.maf] -= over;
			st.ledProd[P.LITH.sill] += over;
			st.meltSill += over;
			// Sills supply a host; the fertility / saturation factory advances once at K8.
		}
	},

	k1: function (st, dt, t, Tm) {
		var i;
		if (!(dt > 0)) return;
		for (i = 0; i < st.nCol; i++) {
			st.colMeltArc[i] = 0;
			st.colMeltPlume[i] = 0;
			st.colRecycle[i] = 0;
		}
		this.arc(st, dt);
		this.plume(st, dt);
		this.spill(st, t);
		void Tm;
	},

	// --- vents (0.2.0 M1): the eruptive clock's kernel -------------------------
	// The two clocks meet only through the chamber buffer: geology fills colChamber
	// (K1), the vent's chamber venV meters what the schedule may draw, and the toy
	// consumes exactly the flux the schedule set — never a cell more.

	// The arrived plume whose reach covers column c, or -1 (the range lipGrowth uses)
	plumeAt: function (st, c) {
		var i, d, r;
		for (i = 0; i < st.nPlm; i++) {
			if (!st.plmArrive[i] || !(st.plmStr[i] > 0)) continue;
			d = Math.abs(this.dx(st.colX[c], st.plmX[i]));
			r = Math.max(P.w0, st.plmR[i]);
			if (d <= r) return i;
		}
		return -1;
	},

	// Style fixed at birth: arc at the arc factory; the plume's actual owner builds
	// a shield, its province vents as a LIP fissure field; anything
	// else that somehow holds a charged chamber is strato.
	ventStyle: function (st, c) {
		var p;
		if (st.trenchDist[c] >= 1 && st.trenchDist[c] <= 3 && st.colRecycle[c] > 0) return 3;
		p = this.plumeAt(st, c);
		if (p < 0) return 0;
		return c === this.plumeColumn(st, st.plmX[p]) ? 1 : 2;
	},

	// Prefer the column's dormant edifice, then a dead slot, then a fresh one.
	venSlot: function (st, c) {
		var v;
		for (v = 0; v < st.nVen; v++) if (st.venCol[v] < 0 && st.venEdCol[v] === c) return v;
		for (v = 0; v < st.nVen; v++) if (st.venCol[v] < 0) return v;
		return st.nVen < P.maxVents ? st.nVen : -1;
	},

	// A vent is born on a column whose chamber first reaches Vbirth (design §5.2). With
	// the vent list full the magma idles in its chamber — never dropped — and the wait
	// is counted so a stalled planet is visible in the ledger.
	venBirth: function (st) {
		var n = st.nCol, c, v, style, sameEdifice;
		for (c = 0; c < n; c++) {
			if (st.colGhost[c] || st.volc[c] >= 0) continue;
			if (!(st.colChamber[c] >= P.VbirthM2)) continue;
			v = this.venSlot(st, c);
			if (v < 0) {
				st.meltIdle += st.colMeltArc[c] + st.colMeltPlume[c];
				continue;
			}
			if (v === st.nVen) st.nVen = v + 1;
			style = this.ventStyle(st, c);
			sameEdifice = st.venEdCol[v] === c;
			if (!sameEdifice) erupt().reset(v);
			st.volc[c] = v;
			st.venCol[v] = c; st.venEdCol[v] = c;
			st.venX[v] = st.colX[c];
			st.venStyle[v] = style;
			st.venGas[v] = P.venGas0[style];
			st.venV[v] = 0;
			st.venIdle[v] = 0;
			st.venFlux[v] = 0;
			st.venBlast[v] = 0;
		}
	},

	// Fill before testing Vdie: fresh supply resets the geological idle interval.
	// Reaping an orphan is bookkeeping and runs even while the plate clock is paused.
	venTick: function (st, dt, t) {
		var v, c, box = erupt();
		for (v = 0; v < st.nVen; v++) {
			c = st.venCol[v];
			if (c >= 0 && st.colGhost[c]) {
				if (st.volc[c] === v) st.volc[c] = -1;
				st.venCol[v] = c = -1;
			}
			if (c < 0) {
				if (st.venV[v] > 0 || box.mass(v) > 0) this.venReap(st, v);
				else if (st.venEdCol[v] < 0 && (st.venH[v] > 0 || st.venEdV[v] > 0)) this.venClear(st, v);
				continue;
			}
			this.venFill(st, v);
			if (!(dt > 0)) continue;
			if (st.venV[v] < P.VdieM2) st.venIdle[v] += dt; else st.venIdle[v] = 0;
			if (st.venIdle[v] >= P.tauVent) this.venDeath(st, v, t);
		}
	},

	venDeath: function (st, v, t) {
		var c = st.venCol[v];
		erupt().finish(v, t);
		erupt().record(v);
		st.colChamber[c] += st.venV[v];
		this.venClear(st, v, true);
		if (st.volc[c] === v) st.volc[c] = -1;
	},

	// A vent whose column was consumed has no home left. Book the residual (the named
	// line and the consume side of the mass identity), never drop it silently.
	venReap: function (st, v) {
		var lost = st.venV[v] + erupt().mass(v) * P.toyCellM2;
		if (lost > 0) {
			st.venLost += lost;
			st.ledCons[P.LITH.maf] += lost;
		}
		this.venClear(st, v);
	},

	venClear: function (st, v, keepEdifice) {
		st.venV[v] = 0;
		st.venIdle[v] = 0;
		st.venFlux[v] = 0;
		st.venBlast[v] = 0;
		st.venCol[v] = -1;
		if (keepEdifice) return;
		st.venEdCol[v] = -1;
		erupt().reset(v);
	},

	// The clock boundary: the column's chamber (geological supply) hands melt to the
	// vent's chamber (the schedule's meter), capped at Vch. Both are m2, so the transfer
	// is exact and S.mass() sees the melt wherever it sits.
	venFill: function (st, v) {
		var c = st.venCol[v], room = P.VchM2 - st.venV[v], d;
		if (c < 0 || !(room > 0)) return;
		d = st.colChamber[c] < room ? st.colChamber[c] : room;
		st.colChamber[c] -= d;
		st.venV[v] += d;
	},

	// The frame's schedule (design §5.2): the chamber's overpressure is its own volume
	// in Vbirth units (P/P0 = 1 + V/Vbirth). A gas blast needs gas above gasBlast AND P
	// above 1.3 P0; below that a gas-rich vent falls back to effusive, so every vent
	// drains to empty and the death rule (V < Vdie) is reachable. The drain rate is
	// (1-gas)*sqrt(P-P0) effusive, gas*sqrt(P-P0) explosive, emitted as toy cells^2 per
	// eruptive second — the mass the box may consume this frame and nothing else.
	venSchedule: function (st, v, dtSec) {
		var gas = st.venGas[v], pOver = st.venV[v] / P.VbirthM2, rate, drain;
		st.venFlux[v] = 0;
		if (!(dtSec > 0) || !(pOver > 0)) { st.venBlast[v] = 0; return; }
		st.venBlast[v] = (gas > P.gasBlast && 1 + pOver > P.blastP) ? 1 : 0;
		rate = P.kErupt * (st.venBlast[v] ? gas : 1 - gas) * Math.sqrt(pOver);
		drain = Math.min(rate * dtSec, st.venV[v]);
		st.venV[v] -= drain;
		st.venFlux[v] = drain / (dtSec * P.toyCellM2);
	},

	// K7: geological birth / death; eruptive drain, box, lava write-back. Tephra
	// stays in the box until venDeath -> finish, so a live explosive pile is not a
	// surface bed for K6 to shave (0.2.1 §8). Column ownership is settled by K4.
	k7: function (st, dt, t, Tm) {
		var dtSec = P.sl.erupt, v, box = erupt(), t0, toyMs = 0;
		MAG.venTick(st, dt, t);
		if (dt > 0) MAG.venBirth(st);
		for (v = 0; v < st.nVen; v++) {
			if (st.venEdCol[v] >= 0) st.venX[v] = st.colX[st.venEdCol[v]];
			if (st.venCol[v] < 0) continue;
			MAG.venFill(st, v);
			MAG.venSchedule(st, v, dtSec);
			if (st.venFlux[v] > 0) st.venLast[v] = t;
			// the toy step cost (design §6's per-vent budget) is the HUD's third number
			t0 = now();
			box.step(dtSec, v);
			toyMs += now() - t0;
			// box.writeBack(v, t, P.LITH.lava); // "pile before death" rule
			box.record(v);
		}
		perf().msToy = perf().f(perf().msToy, toyMs);
		void Tm;
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = MAG;
else root.COLMAGMA = MAG;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
