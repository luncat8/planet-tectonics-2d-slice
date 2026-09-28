// magma.js — M4 melt supply and chambers (design §4.5, §5.2). Ribbon water is
// released by slab.js, converted to a bounded wedge melt source, and held in a
// per-column chamber until it spills as an intrusive sill. Chambers are volumes per
// unit depth, so changing column widths cannot create or destroy melt.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.MNT;
var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;

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
			st.oMaf[i] = st.oMaf[i] + over / P.chamberCap * 0.01;
			if (st.oMaf[i] > 1) st.oMaf[i] = 1;
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
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = MAG;
