// pt/vent.js — 0.3.0 P3.3: G6, conduits, vent schedules and metered eruption supply
// (0.3.0-p3-plan.md §3 G6, §4 P3.3). One conduit per chamber record: vent k is chamber k's
// outlet and exists exactly while the chamber does, because chamber records are never removed
// (pool.js intrude only joins them).
//
//   open     the chamber's melt column head, chM / chSpan, against the roof's lithostatic load
//            (chY) plus its local tensile strength (the crust pass's node strength). At or below
//            that the conduit is closed. A conduit that opens takes its style from the chamber's
//            water fraction and keeps it: explosive above P.wBlast, effusive otherwise.
//   meter    an open conduit drains at kVent (effusive) or kBlast (explosive) times the excess
//            times chSpan, capped by the chamber's stock and the schedule's room. It drains no
//            further than the excess: at the threshold the overpressure is spent and the
//            conduit seals, leaving the remainder in the chamber as intrusive storage. The drain
//            is a split of extensive state: the chamber is debited and the vent is credited with
//            the same mass, enthalpy, melt, felsic and water, so the pair is one transfer and the
//            intensives ride along unchanged.
//   block    an overpressured conduit whose schedule is full does not drain. The chamber keeps
//            the melt and the state says so; nothing is dropped.
//
// The schedule may meter melt the chamber holds but may not manufacture any: its stock is
// inventory (pool.js counts it once), and the drain is throughput, reported apart. Only P3.4's
// flight takes mass out of a schedule, so until then the vent's room is what it can hold.
//
// Units are km, Myr and km of rock head (params.js chSpan). Zero dt changes nothing.
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTVENT.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;

	var CLOSED = 0, OPEN = 1, BLOCKED = 2;
	var EFFUSIVE = 0, EXPLOSIVE = 1;

	var VENT = {
		CLOSED: CLOSED, OPEN: OPEN, BLOCKED: BLOCKED,
		EFFUSIVE: EFFUSIVE, EXPLOSIVE: EXPLOSIVE,

		// the head a conduit must exceed, in km of rock head: the lithostatic load at the roof
		// plus the tensile strength there. Strength is the crust's node field, 0..1, so a hot
		// roof has almost none and a welded lid holds the melt back.
		threshold: function (M, S, k) {
			var y = S.chY[k], e = Math.asinh(y / P.yLin);
			return y + P.tensile * G.sampleAt(M, S.mug, S.chX[k], e);
		},

		// the melt column the chamber pushes with, in the same units as threshold
		head: function (S, k) { return S.chM[k] / P.chSpan; },

		run: function (M, S, dt) {
			var k;
			if (!(dt > 0)) return;
			for (k = 0; k < S.chN; k++) this.step(M, S, k, dt);
		},

		step: function (M, S, k, dt) {
			var excess = this.head(S, k) - this.threshold(M, S, k), room, rate, spent, d;
			if (!(excess > 0)) { S.vState[k] = CLOSED; return; }
			// the style is taken when the conduit first opens: a later change of the chamber's
			// water does not re-style an eruption already under way
			if (S.vState[k] === CLOSED) S.vStyle[k] = S.chW[k] > P.wBlast * S.chM[k] ? EXPLOSIVE : EFFUSIVE;
			room = P.vCap - S.vM[k];
			if (!(room > 0)) { S.vState[k] = BLOCKED; S.tx.block++; return; }
			S.vState[k] = OPEN;
			rate = (S.vStyle[k] === EXPLOSIVE ? P.kBlast : P.kVent) * excess * P.chSpan;
			spent = excess * P.chSpan;
			d = Math.min(rate * dt, spent, room, S.chM[k]);
			// the cap that binds is the overpressure itself: the conduit seals at the threshold
			if (d === spent) S.vState[k] = CLOSED;
			if (d > 0) this.transfer(S, k, d);
		},

		// chamber k -> vent k, mass d. The fraction f = d / chM is the share of every extensive
		// field the debit takes, and the same share is credited, so the pair is exact.
		transfer: function (S, k, d) {
			var f = d / S.chM[k];
			var dH = f * S.chH[k], dL = f * S.chL[k], dF = f * S.chF[k], dW = f * S.chW[k];
			S.chM[k] -= d; S.chH[k] -= dH; S.chL[k] -= dL; S.chF[k] -= dF; S.chW[k] -= dW;
			S.vM[k] += d; S.vH[k] += dH; S.vL[k] += dL; S.vF[k] += dF; S.vW[k] += dW;
			S.thr.ventDr += d; S.thr.ventCr += d;
			S.tx.vent++;
		},

		// how many conduits are in a state: the HUD's count, read at 2 Hz
		count: function (S, state) {
			var k, n = 0;
			for (k = 0; k < S.chN; k++) if (S.vState[k] === state) n++;
			return n;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = VENT; else window.PTVENT = VENT;
}());
