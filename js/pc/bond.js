// pc/bond.js — 0.5.0 M1: the bond law, transplanted from 0.3 (0.5.0-plan.md §3.3).
//
// Strength is a function of temperature and of `age`, "Myr since the parcel last froze":
//
//     heat(T)  = smoothstep(muLo, muHi, T)                          hot rock is soft
//     mu(T, a) = (0.05 + 0.95 (1 - heat)) * (1 - e^(-a / tauWeld)) * (1 - melt)
//
// `age` accumulates below TLock, resets above TSoft and holds between, so the law is a
// hysteresis loop on cooling: rock that has stayed cold welds with time, warm rock never
// acquires an age, and the asthenosphere stays at mu ~ 0 however old the clock says it is.
// Welding is confined to y <= yWeldMax: below that, pressure and adiabatic heating keep cold
// downwellings in ductile creep instead of welding them into a bottom plate.
//
// Failure is the rate form 0.3 measured (P2.2): a bond carries yieldRate * mu elastically and
// accumulates damage above it at kDamage per unit of *mean* excess strain rate per Myr — the
// mean over the pairs that touch the parcel, not the sum, because the sum makes the failure
// rate a function of local sampling density. Damage reaches 1 and the bonds are gone; a soft
// parcel re-melts its damage to zero and a cold quiet one anneals it away over tauHeal. That
// is what turns one planet-wide lid into plates that rift, drift and suture.
//
// `eps0` is the elastic strain bound of a bond in the solver's own units — what the strength
// clamp reads before the rate law sees a load. 0.3 carried it implicitly inside yieldRate;
// the two new engines need it explicitly because their bonds are pairwise springs rather than
// a cluster projection, so it is defined here and used from M3/M5 on.
//
// Nothing here allocates and nothing here reads a page: the pass takes the caller's SoA and
// its own field names, so each engine keeps ownership of its arrays (plan §3.2).
'use strict';

(function (root) {
	var PCP = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : root.PCP;

	function smoothstep(a, b, x) {
		var t = (x - a) / (b - a);
		t = t < 0 ? 0 : (t > 1 ? 1 : t);
		return t * t * (3 - 2 * t);
	}

	var BOND = {
		smoothstep: smoothstep,

		// the strength window: 0 in cold rock, 1 in hot rock and in melt
		heat: function (T) { return smoothstep(PCP.muLo, PCP.muHi, T); },

		// mu from intensive state alone. `melt` is the parcel's equilibrium melt fraction and
		// defaults to 0: a solid parcel is as strong as its own welding. A mushy one is as
		// weak as its solid fraction.
		mu: function (T, age, melt) {
			var h = smoothstep(PCP.muLo, PCP.muHi, T);
			var weld = 1 - Math.exp(-age / PCP.tauWeld);
			return (0.05 + 0.95 * (1 - h)) * weld * (1 - (melt || 0));
		},

		// The elastic strain bound the solver's own clamp reads: a bond at strength mu carries
		// eps0 * mu of stretch before the rate law is allowed to charge it.
		elastic: function (mu) { return PCP.eps0 * mu; },

		// a parcel at or above this strength is plate material (0.3's cluster threshold)
		isPlate: function (mu) { return mu >= PCP.clusterMin; },

		// The strength pass: age hysteresis, the anneal, and mu. `sol` is the phase mask of
		// the parcels that may carry bonds (PCP.PH_SOLID by default). A parcel that cannot
		// carry bonds — airborne, or SP's mobile melt — reads zero and its clock restarts.
		// No-op at dt <= 0: a paused frame reports, it does not age or weld anything.
		settle: function (S, dt, sol) {
			if (!(dt > 0) || !S.n) return;
			var p, T, d, a, heat, weld;
			var n = S.n, ph = S.ph, y = S.y, age = S.age, dmg = S.dmg, mu = S.mu;
			var melt = S.melt, mask = sol || PCP.PH_SOLID, solid, m;
			for (p = 0; p < n; p++) {
				solid = ph ? mask[ph[p]] : 1;
				if (!solid) { age[p] = 0; dmg[p] = 0; mu[p] = 0; continue; }
				m = melt ? melt[p] : 0;
				T = S.T[p];
				d = dmg[p];
				if (T >= PCP.TSoft || y[p] > PCP.yWeldMax) { age[p] = 0; dmg[p] = 0; }
				else if (T <= PCP.TLock) {
					age[p] += dt;
					if (d > 0) {
						d -= dt / PCP.tauHeal;
						dmg[p] = d < 0 ? 0 : d;
					}
				}
				a = age[p];
				heat = smoothstep(PCP.muLo, PCP.muHi, T);
				weld = 1 - Math.exp(-a / PCP.tauWeld);
				mu[p] = (0.05 + 0.95 * (1 - heat)) * weld * (1 - m);
			}
		},

		// The failure pass, applied after a pair walk so the walk itself stays read-only and
		// order-independent. pLoad is the pair walk's summed excess load per parcel and pCnt
		// the number of pairs it is a sum over; the mean is what the law charges.
		damage: function (S, dt) {
			if (!(dt > 0) || !S.n || !S.pLoad) return;
			var p, mean, add;
			var n = S.n, pLoad = S.pLoad, pCnt = S.pCnt, dmg = S.dmg, mu = S.mu;
			for (p = 0; p < n; p++) {
				if (!(pCnt[p] > 0)) { pLoad[p] = 0; pCnt[p] = 0; continue; }
				mean = pLoad[p] / pCnt[p];
				add = mean - PCP.yieldRate * mu[p];
				if (add > 0) {
					mean = dmg[p] + PCP.kDamage * add * dt;
					dmg[p] = mean > 1 ? 1 : mean;
				}
				pLoad[p] = 0; pCnt[p] = 0;
			}
		},

		// What every consumer that needs strength should read: the welded strength net of
		// damage. (0.3 folded this into mu after the damage pass; the new engines read it
		// where they need it so a pass order cannot leave mu half-applied.)
		strength: function (S, p) { return S.mu[p] * (1 - S.dmg[p]); }
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = BOND;
	else root.PCBOND = BOND;
}(typeof window !== 'undefined' ? window : this));
