// pt/melt.js — 0.3.0 P3.2: G5, melt segregation and intrusive storage
// (0.3.0-p3-plan.md §3 G5, §4 P3.2). One pass, three rules, in the order the plan gives:
//
//   detach   mantle source rock sheds its equilibrium melt (pool.js separate) once the
//            fraction reaches P.meltHold; a fully molten parcel is a whole-parcel phase
//            change. A full pool defers the split and the phase fraction stays in its
//            source parcel. Landed ejecta remains a deposit while flight.js cools it.
//            The second source is 0.3.1 M1's buried remelt: a deposit that earned the
//            shallow-quench certificate (state.js depQ), was then buried past the cooling
//            mask and reached the same threshold sheds through the same split, debited to
//            thr.depMelt instead of thr.seg. Uncertified deposits are not routed: a
//            newly landed or carried-past-30 km hot parcel stays a deposit, which is the
//            difference between remelting and bypassing the surface quench.
//   transit  mobile melt rises on the flow map plus its own buoyant speed (grid.js velAt
//            plus vMelt downward-in-y terms: y is depth, so rising is -vy). Below
//            meltHold the parcel is frozen residue: it becomes mantle again and rides the
//            flow map like any other rock ("non-rising cold material").
//   store    melt reaching P.yCham intrudes into a chamber record (pool.js intrude): a
//            matched transfer into the intrusive store, never a sink. A full record set
//            defers the transfer and the melt waits at the chamber depth.
//
// meltHold is one threshold used both ways on purpose: source rock sheds at it, transit
// melt dies below it, so the two rules share a fixed point instead of fighting (a melt
// parcel frozen at a *higher* threshold than the shed one would re-shed the moment it
// became mantle).
//
// Everything moves on the geological clock (plan §2): zero dt reports and changes nothing.
// One global per new file (§6): the IIFE's only export is PTMELT.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;
	var POOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;

	var MELT = {
		run: function (M, S, dt) {
			if (!(dt > 0) || !S.n) return;
			this.detach(S);
			this.transit(M, S, dt);
		},

		// Mantle source rock sheds its melt at the equilibrium split. A landed parcel is
		// already at the end of the buoyant path; keeping it in the deposit phase lets the
		// surface exchange cool it instead of sending hot ejecta straight back to a chamber.
		// 0.3.1 M1 routes the deposits that cleared that exchange: cert, buried past the
		// cooling mask, and at the threshold. The cert test sits before any state changes,
		// so a full pool leaves the certificate exactly where it was.
		detach: function (S) {
			var ph = S.ph, ml = S.melt, hold = P.meltHold, p, xi, dep;
			for (p = 0; p < S.n; p++) {
				dep = ph[p] === P.PH.dep;
				if (!dep && ph[p] !== P.PH.mantle) continue;
				xi = ml[p];
				if (xi < hold) continue;
				if (dep && !(S.depQ[p] && S.y[p] > P.depositCoolDepth)) continue;
				if (xi < 1) { POOL.separate(S, p, dep); continue; }
				// wholly molten: one whole-parcel phase change (P3.1's rule), and a parcel
				// that is not solid carries no bond state at all (§1.3). A converted deposit
				// leaves the deposit population and its certificate with it.
				ph[p] = P.PH.melt;
				S.age[p] = 0; S.mu[p] = 0; S.dmg[p] = 0; S.pLoad[p] = 0; S.pCnt[p] = 0;
				S.tx.whole++;
				if (dep) { S.depQ[p] = 0; S.thr.depMelt += S.m[p]; S.tx.depMelt++; }
				else S.thr.whole += S.m[p];
			}
		},

		// mobile melt: freeze back, rise, and intrude at the chamber depth. The walk
		// re-visits slot p after a removal (pool.js compacts the tail into the hole), so no
		// parcel is skipped or visited twice.
		transit: function (M, S, dt) {
			var ph = S.ph, mPh = P.PH.melt, sPh = P.PH.mantle, hold = P.meltHold;
			var y = S.y, e = S.e, x = S.x, p, dy, ym;
			for (p = 0; p < S.n;) {
				if (ph[p] !== mPh) { p++; continue; }
				if (S.melt[p] < hold) { ph[p] = sPh; S.tx.freeze++; S.thr.freeze += S.m[p]; p++; continue; }
				if (y[p] <= P.yCham) {
					// intrude returns -1 only on a full record set: the melt then waits at
					// the chamber depth instead of climbing through it or being dropped
					if (POOL.intrude(M, S, p) >= 0) continue;
					p++; continue;
				}
				G.velAt(M, M.pr, x[p], e[p], y[p]);
				dy = (G.vyAt - P.vMelt) * dt;
				ym = y[p] + 0.5 * dy;
				x[p] += G.vxAt * dt;
				y[p] += dy;
				e[p] += dy / Math.sqrt(M.yLin * M.yLin + ym * ym);
				G.keepInside(M, S, p);
				p++;
			}
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = MELT; else window.PTMELT = MELT;
}());
