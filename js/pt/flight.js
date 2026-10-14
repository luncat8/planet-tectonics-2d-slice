// pt/flight.js — 0.3.0 P3.4: conserved vent-to-air transfer, wall-clock flight,
// landing, surface cooling and compatible deposit coalescence (0.3.0-p3-plan.md §2, §4 P3.4).
//
// Geological time controls how much vent stock becomes ejecta and how landed lava cools.
// Wall time controls only an airborne parcel's displayed ballistic path. A clast is therefore
// a material batch: its mass, enthalpy, melt and composition leave the vent exactly once even
// though its visible trajectory is deliberately dilated to about a second.
//
// Coordinates keep the engine's depth-positive convention. Upward launch velocity is negative
// vy; presentation gravity is positive. The physical terrain horizon is y = -zh(x), without
// the renderer's visual exaggeration. A suspended tab interval is capped before integration.
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTFLIGHT.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;
	var PHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;

	function wrapX(x, W) { return x - Math.floor(x / W) * W; }

	function draw(id, salt) {
		var h = Math.imul((id + 1) ^ salt, 1103515245) + 12345;
		h = Math.imul(h ^ (h >>> 16), 2246822519);
		return (h >>> 0) / 4294967295;
	}

	var FLIGHT = {
		// The modeled horizon, in the same depth-positive coordinates as a parcel. zh is km
		// above sea level, hence the minus sign. Linear interpolation is periodic in x.
		surfaceY: function (M, S, x) {
			var f = wrapX(x, M.wrap) / M.dx, i = Math.floor(f), u = f - i;
			var i1 = i + 1 === M.nx ? 0 : i + 1;
			return -(S.zh[i] + (S.zh[i1] - S.zh[i]) * u);
		},

		// Vent k -> one airborne material batch. Admission happens before the debit, so a full
		// pool leaves every extensive quantity in the vent and counts the refusal in pool.js.
		//
		// The parcel leaves the vent on-manifold and stock-consistent: the vent is debited at
		// the stock split (f*d* of every extensive field), but a clast that reaches the surface
		// equilibrates at pressure y=0 against its own enthalpy -- the solidus there sits below
		// the chamber's, so specific melt rises from the vent's aggregate xiStock to xiEq at
		// the surface. That adiabatic decompression melting is physically real: the parcel's
		// H is unchanged and T drops to TEq to fund the extra latent. The (T, melt) pair is set
		// to the equilibrium reading directly, and the sensible drop m * (TEq - T_stock) that
		// funds the latent is booked against S.ledger (never S.wall -- no heat crossed the
		// surface). That keeps hLedger - ledger = L * (invLTot - invL0) across the launch, and
		// no later equilibrium pass has to snap an off-manifold air parcel with nothing against
		// it (0.3.2 M1).
		launch: function (M, S, k, dt) {
			var stock = S.vM[k];
			if (!(stock > 0) || !(dt > 0)) return -1;
			var blast = S.vStyle[k] === 1;
			var d = Math.min(stock, (blast ? P.emitBlast : P.emitEff) * dt);
			if (!(d > 0)) return -1;
			var p = POOL.admit(S, P.PH.air);
			if (p < 0) return -1;
			var f = d / stock;
			var dH = f * S.vH[k], dL = f * S.vL[k], dF = f * S.vF[k], dW = f * S.vW[k];
			var xiStock = dL / d;
			// Stock-consistent on the manifold: debit extensive fields, then equilibrate the
			// clast's intensive state at surface pressure.
			S.vM[k] -= d; S.vH[k] -= dH; S.vL[k] -= dL; S.vF[k] -= dF; S.vW[k] -= dW;
			S.m[p] = d; S.H[p] = dH / d;
			S.cF[p] = dF / d; S.cW[p] = dW / d;
			PHASE.byH(S.H[p], 0, S.cF[p], S.cW[p]);
			S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt;
			// Book the air snap where it happens: S.wall stays untouched; the sensible drop
			// S.m * (TEq - T_stock) = -L * d * (xiEq - xiStock) is what funds the extra latent
			// invLTot sees. Adding it to S.ledger keeps the P3.1 identity closed at the launch
			// boundary instead of waiting for equil to snap an unbooked air parcel.
			S.ledger += d * (S.T[p] - (S.H[p] - P.meltLat * xiStock));
			S.x[p] = wrapX(S.chX[k], M.wrap);
			S.y[p] = this.surfaceY(M, S, S.x[p]) - P.flightLift;
			S.e[p] = Math.asinh(S.y[p] / M.yLin);
			var r0 = draw(S.id[p], Math.imul(k + 1, 2654435761));
			var r1 = draw(S.id[p], Math.imul(k + 1, 1597334677));
			S.vx[p] = (2 * r0 - 1) * (blast ? P.flightVxBlast : P.flightVxEff);
			S.vy[p] = -(0.9 + 0.2 * r1) * (blast ? P.flightVyBlast : P.flightVyEff);
			S.thr.airDr += d; S.thr.airCr += d; S.tx.emit++;
			return p;
		},

		emit: function (M, S, dt) {
			if (!(dt > 0)) return;
			for (var k = 0; k < S.chN; k++) this.launch(M, S, k, dt);
		},

		// Find one nearby landed parcel whose phase and composition permit a material merge.
		// The scan allocates nothing and is deterministic in slot order; the nearest candidate,
		// then the lowest slot on a tie, wins.
		mergeTarget: function (M, S, p) {
			var q, dx, dy, d2, best = -1, best2 = P.depositMerge * P.depositMerge;
			for (q = 0; q < S.n; q++) {
				if (q === p || S.ph[q] !== P.PH.dep || !POOL.compatible(S, p, q)) continue;
				dx = S.x[q] - S.x[p];
				dx -= Math.floor(dx / M.wrap + 0.5) * M.wrap;
				dy = S.y[q] - S.y[p]; d2 = dx * dx + dy * dy;
				if (d2 < best2) { best = q; best2 = d2; }
			}
			return best;
		},

		// Air -> deposit is a phase transfer, not a source or sink. The parcel lands young and
		// bond-free. If a compatible deposit is already at the site, pool.merge conserves mass,
		// momentum and enthalpy and keeps the older material id.
		land: function (M, S, p) {
			var m = S.m[p];
			S.y[p] = this.surfaceY(M, S, S.x[p]);
			S.e[p] = Math.asinh(S.y[p] / M.yLin);
			S.vx[p] = 0; S.vy[p] = 0; S.ph[p] = P.PH.dep;
			S.age[p] = 0; S.mu[p] = 0; S.dmg[p] = 0; S.pLoad[p] = 0; S.pCnt[p] = 0;
			S.thr.landDr += m; S.thr.landCr += m; S.tx.land++;
			var q = this.mergeTarget(M, S, p);
			if (q < 0) return false;
			POOL.merge(M, S, q, p);
			return true;
		},

		// Exact constant-acceleration integration in presentation units. Newly emitted parcels
		// and already-airborne ones follow the same path. Reprocess slot p after a landing merge:
		// remove() may have compacted the old tail (possibly another clast) into that slot.
		advance: function (M, S, wallDt) {
			if (!(wallDt > 0)) return;
			var dt = wallDt > P.flightDtMax ? P.flightDtMax : wallDt;
			var p = 0, vy0;
			while (p < S.n) {
				if (S.ph[p] !== P.PH.air) { p++; continue; }
				vy0 = S.vy[p];
				S.x[p] = wrapX(S.x[p] + S.vx[p] * dt, M.wrap);
				S.y[p] += vy0 * dt + 0.5 * P.flightG * dt * dt;
				S.vy[p] = vy0 + P.flightG * dt;
				S.e[p] = Math.asinh(S.y[p] / M.yLin);
				if (S.vy[p] <= 0 || S.y[p] < this.surfaceY(M, S, S.x[p])) { p++; continue; }
				if (this.land(M, S, p)) continue;
				p++;
			}
		},

		// Landed lava relaxes to the fixed-temperature surface on geological time. The
		// exchange is entered on both sides of the existing wall ledger. Updating T and
		// melt from H in the same operation keeps hLedger - ledger = L * delta(melt) true even
		// between frames. Deposits stay deposits while cooling; they cannot buoyantly return to
		// their source chamber before they have had a chance to freeze and weld.
		//
		// 0.3.1 M1: this pass is the only place a deposit can earn the shallow-quench
		// certificate (S.depQ). It earns it by *being* below the mobile threshold at the end
		// of a positive-time pass, which is a test on the parcel's own equilibrium reading --
		// checked even when there is no enthalpy delta to apply, so material that is already
		// at the surface wall still certifies. The certificate is never cleared here: a
		// parcel that warms at depth keeps it, and the G5 route is what that certificate
		// eventually buys.
		cool: function (M, S, dt) {
			if (!(dt > 0)) return;
			var a = 1 - Math.exp(-dt / P.depositCoolTau), p, h0, h1, ht, t0, q;
			for (p = 0; p < S.n; p++) {
				if (S.ph[p] !== P.PH.dep || S.y[p] > P.depositCoolDepth) continue;
				PHASE.byT(P.depositCoolT, S.y[p], S.cF[p], S.cW[p]); ht = PHASE.out.h;
				h0 = S.H[p];
				if (h0 !== ht) {
					h1 = h0 + a * (ht - h0); t0 = S.T[p];
					PHASE.byH(h1, S.y[p], S.cF[p], S.cW[p]);
					S.H[p] = h1; S.T[p] = PHASE.out.t; S.melt[p] = PHASE.out.melt;
					q = S.m[p] * (h1 - h0);
					S.hLedger += q; S.wall += q;
					S.ledger += S.m[p] * (S.T[p] - t0);
				} else PHASE.byH(h0, S.y[p], S.cF[p], S.cW[p]);
				if (PHASE.out.melt < P.meltHold) S.depQ[p] = 1;
			}
		},

		run: function (M, S, dtGeo, dtWall) {
			this.emit(M, S, dtGeo);
			this.advance(M, S, dtWall);
		},

		count: function (S, phase) {
			var n = 0;
			for (var p = 0; p < S.n; p++) if (S.ph[p] === phase) n++;
			return n;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = FLIGHT; else window.PTFLIGHT = FLIGHT;
}());
