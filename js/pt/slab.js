// pt/slab.js — 0.3.0 P4.1: slab sinking and deep recycling (0.3.0-p4-plan.md §3 P4.1).
//
// P4.0's contact pass owns the lid band above P.yCrust (its §1.4) and its bending band is
// what puts material below that line; below it nothing holds a slab, so this pass does. Three
// rules, in the order the plan gives them:
//
//   background  the row mean of the node temperature, which is what a local cold anomaly is
//               dense *against*. The engine's own buoyancy (grid.js stokes) is a gradient of
//               the same field, so the proxy is the same one; a drive that read the marker's
//               own node would read the marker's own scattered temperature back and find no
//               contrast at all.
//   sink        a slab below P.yCrust descends at kSink times its contrast against that
//               background, capped at vSinkMax: the temperature-is-density proxy of P4.0 §1.1
//               as a downward drive instead of P2.2's horizontal pull. Two tests pick the
//               population and they answer different questions. The contrast is the negative
//               buoyancy, and it is local on purpose -- a planet-wide cold layer has no
//               contrast against its own row and does not founder, while a slab inside a warm
//               row does -- so a slab that has warmed to its depth belongs to the flow again.
//               P.slabT is what makes the population lithosphere rather than the flow's whole
//               cold half, which is what the contrast alone selects: it is TSoft, the engine's
//               own line where rock stops being cold enough to hold a bond, and the measured
//               difference between the two is the deep inventory taking 9.68% of the world and
//               draining the pool by a quarter instead of taking 0.21% and leaving it to grow.
//   recycle     a slab that reaches P.yDeep leaves the plate population for a deep record
//               (pool.js recycle): mass, enthalpy, melt and composition debit the parcel and
//               credit the record, so the ledger's stock is unchanged and the transfer is
//               booked rather than sunk. A full record set defers and counts the deferral.
//               The boundary belongs to this pass's population and not to every parcel that
//               happens to be deep, because what is deep on a live planet is mostly the hot
//               mantle the flow is holding up.
//
// Scope. A parcel still riding a plate (a cluster of plate size) is not driven: attached
// lithosphere is P2.2's business, and pulling a plate's own root down from under it would
// fight the rigid projection the plate rides on. Below P.yWeldMax nothing can hold a bond at
// all (solid.js strength resets its age), so the exclusion only ever applies in the
// yCrust..yWeldMax band, and what it leaves is the plan's §4 question -- how much cold deep
// material is still attached, i.e. welds back, against how much detached and kept sinking --
// as two reported numbers rather than a guess.
//
// The pass writes positions and no velocity, the way the contact guard does: a marker's S.vy
// is the flow's, and the next frame's rigid fit reads it, so writing a sink speed into it
// would hand the whole plate the slab's descent. It runs at the tail of G4 (sim.js), because
// it needs the contact result the crust pass just produced and because a parcel that left for
// the deep inventory must not also shed melt this frame (G5).
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTSLAB.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;

	var SLAB = {
		// G4's tail. No-op at dt = 0 like every geological kernel: a paused frame reports
		// nothing here and moves nothing. When the pass is disabled mid-run, its per-frame
		// diagnostics are cleared so a step with P.slab off never reports the previous frame's
		// census.
		run: function (M, S, dt) {
			if (!(dt > 0) || !S.n) return;
			if (!P.slab) {
				S.d.slab = 0; S.d.slabV = 0; S.d.slabBond = 0; S.d.deep = 0;
				return;
			}
			this.background(M, S);
			this.sink(M, S, dt);
		},

		// the background each row's anomalies are measured against, rows 1..ny. Row ny is
		// filled because a marker reflects at eMax and Math.round(ny - 0.5) === ny puts it in
		// the bottom row, where scatterT leaves the wall's own value: the background there is
		// the CMB, and a slab against it is as dense as it can be. Row 0 is the surface wall
		// and the sink's clamp never reads it.
		background: function (M, S) {
			var nx = M.nx, ny = M.ny, Tg = S.Tg, Trow = S.Trow, i, j, b, s;
			for (j = 1; j <= ny; j++) {
				b = j * nx; s = 0;
				for (i = 0; i < nx; i++) s += Tg[b + i];
				Trow[j] = s / nx;
			}
		},

		// The drive and the transfer, one walk. The transfer is *inside* the population this
		// pass owns -- lithosphere, colder than its row, below the crust base, detached --
		// because a branch of its own at the top of the loop transfers whatever is below
		// P.yDeep, and what is below P.yDeep on a live planet is the mantle's own circulation:
		// measured over 300 Myr that ate 11.3e6 km2, a quarter of the world's stock, into the
		// records before a single slab had sunk. The deep inventory is subducted material, so
		// the boundary is a point on a slab's own trajectory and not a drain in the floor.
		//
		// A removal compacts the pool's tail into the hole it made, so the slot is re-visited
		// rather than stepped over -- melt.js transit's rule, because a skipped parcel would be
		// a parcel nothing ever recycles.
		sink: function (M, S, dt) {
			var ny = M.ny, yLin = M.yLin, sol = P.PH_SOLID, plate = P.plateMin;
			var ph = S.ph, y = S.y, e = S.e, T = S.T, cl = S.cl, csCnt = S.csCnt;
			var Trow = S.Trow, yCrust = P.yCrust, yDeep = P.yDeep, slabT = P.slabT;
			var p, c, j, dT, v, dy, ym, n = 0, vs = 0, bonded = 0, deep = 0;
			for (p = 0; p < S.n;) {
				if (!sol[ph[p]] || y[p] <= yCrust || T[p] > slabT) { p++; continue; }
				j = Math.round(e[p] / M.dEta);
				if (j > ny) j = ny; else if (j < 1) j = 1;
				dT = Trow[j] - T[p];
				if (dT < P.slabdT) { p++; continue; }
				// attached lithosphere rides its plate, and a plate's rigid fit is the motion
				// this pass must not fight: only detached material sinks on its own
				c = cl[p];
				if (c >= 0 && csCnt[c] >= plate) { bonded++; p++; continue; }
				if (y[p] > yDeep) {
					// the deep inventory's boundary: a transfer, not a sink. A full record set
					// defers it (pool.js counts the refusal) and the parcel waits at the
					// boundary, so nothing is ever dropped to make the ledger balance.
					if (POOL.recycle(M, S, p) >= 0) { deep++; continue; }
					p++; continue;
				}
				v = P.kSink * dT;
				if (v > P.vSinkMax) v = P.vSinkMax;
				dy = v * dt;
				ym = y[p] + 0.5 * dy;
				y[p] += dy;
				e[p] += dy / Math.sqrt(yLin * yLin + ym * ym);
				G.keepInside(M, S, p);
				n++; vs += v;
				p++;
			}
			S.d.slab = n; S.d.slabV = n ? vs / n : 0;
			S.d.slabBond = bonded; S.d.deep = deep;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = SLAB; else window.PTSLAB = SLAB;
}());
