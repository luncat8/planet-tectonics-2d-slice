// 0.3.2 candidate measurement, not a shipping switch. Each cell runs in a fresh process.
// node experiments/pt-heat-tail.js [baseline|cap|floor|relax|minimum|spread|stencil|relaxw|subgrid|frb]
//      [value] [Myr=600] [--seed 5] [--kyr 50] [--scope dep|solid] [--watch] [--dpart D] [--cap PHI]
//      [--trace-id a,b,c] [--assert-baseline|--assert-m2]
// --seed/--kyr make one cell of the M2 clock/seed matrix (experiments/pt-heat-matrix.js runs it).
// Rejected candidates are reports, not a nonzero exit; --assert-baseline gates the M0 bank
// (pre-M2 tree), --assert-m2 the re-banked M2 cell (launch/air remedy in).
'use strict';
var fs = require('fs'), path = require('path'), performance = require('perf_hooks').performance;
var B = path.join(__dirname, '../js/pt/');
var P = require(B + 'params.js'), S = require(B + 'state.js'), G = require(B + 'grid.js');
var SIM = require(B + 'sim.js'), POOL = require(B + 'pool.js'), PHASE = require(B + 'phase.js');
var MT = require(B + 'melt.js'), F = require(B + 'fluid.js');
var kind = process.argv[2] || 'baseline';
var defaults = { baseline: 0, cap: 2, floor: 0.01, relax: 0.999, minimum: 1, spread: 1.5, stencil: 1.5,
	relaxw: 1, subgrid: 1, frb: 0.25 };
var value = process.argv[3] === undefined ? defaults[kind] : +process.argv[3];
var myr = process.argv[4] === undefined || process.argv[4].startsWith('--') ? 600 : +process.argv[4];
var scopeAt = process.argv.indexOf('--scope'), scope = scopeAt > 0 ? process.argv[scopeAt + 1] : 'solid';
if (scope !== 'dep' && scope !== 'solid') throw new Error('--scope is dep or solid');
function flag(name, fallback) { var i = process.argv.indexOf(name); return i > 0 ? +process.argv[i + 1] : fallback; }
var seed = flag('--seed', 5), kyr = flag('--kyr', 50);
// declared before the probe that closes over it: --share scales the frb bound by a parcel's
// own stencil mass share (s0 = 0 is the flat bound, the form measured first)
var shr = flag('--share', 0);
var place = (function () { var i = process.argv.indexOf('--place');
	return i > 0 ? process.argv[i + 1] : 'room'; })();
// 0.3.2 M5 (--trace-id): the material correspondence trace, declared before the probe that
// closes over it. Two runs of one cell diverge, so a material id is not a material identity
// across them -- ids come from S.nextId, a split's child is a new id and a merge survivor takes
// the smaller one, so the same deposit carries different ids in the control and in a candidate
// once their trajectories part. What is comparable is a parcel's own history inside the run that
// produced it: the frame and the place it first appears, how it is buried, what the bound
// withholds from it, when it reaches the routing threshold, whether the field support holds it
// back and whether it is delivered. The first-seen record is also the test of whether one id
// means one material in the two runs: where the two agree the id was assigned before the
// divergence and compares directly, and where they do not only the site and the burial do.
// Observation only -- nothing here writes engine state, so a traced run keeps its fingerprint.
var trIds = (function () {
	var i = process.argv.indexOf('--trace-id');
	if (i < 0) return [];
	return String(process.argv[i + 1]).split(',').map(Number)
		.filter(function (v) { return Number.isInteger(v) && v >= 0; });
})();
var TRN = trIds.length, TRCAP = 1 << 21, TRSTRIDE = 200;
var trIdx = TRN ? new Int32Array(TRCAP).fill(-1) : null, trFrame = { frame: 0 };
// why: 0 stride, 1 at or above its own solidus - 0.05, 2 molten, 3 capped this frame,
// 4 held back by the field support, 5 delivered, 6 phase change, 7 the last frame
var trace = trIds.map(function (id, k) {
	if (trIdx) trIdx[id] = k;
	return { id: id, seen: 0, first: null, last: null, lastPh: -1, cappedFrame: -1, rows: [], caps: [],
		maxT: -Infinity, maxTFrame: 0, maxGap: -Infinity, maxGapFrame: 0, maxGapY: 0,
		capped: 0, withheld: 0, withheldMax: 0, routed: 0, held: 0, delivered: 0, deliveredFrame: 0 };
});
function trSlot(S, p) { var id = S.id[p]; return TRN && id < TRCAP ? trIdx[id] : -1; }
function trSample(M, S, p, k, why) {
	var t = trace[k], tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]), ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p]);
	var row = { frame: frame, why: why, ph: S.ph[p], x: S.x[p], y: S.y[p], m: S.m[p], T: S.T[p], H: S.H[p],
		melt: S.melt[p], field: tg, solidus: ts, cF: S.cF[p], cW: S.cW[p] };
	if (!t.first) t.first = row;
	t.last = row; t.seen++;
	if (S.T[p] > t.maxT) { t.maxT = S.T[p]; t.maxTFrame = frame; }
	if (S.T[p] - tg > t.maxGap) { t.maxGap = S.T[p] - tg; t.maxGapFrame = frame; t.maxGapY = S.y[p]; }
	t.rows.push(row);
}
// the bound's own act on a traced parcel, recorded where it happens: the equilibrium temperature
// the delivery would have reached, the two sides of the bound at that parcel and what was withheld
function trCap(S, p, tb, bh, bl, ex, fr) {
	var k = trSlot(S, p);
	if (k < 0) return;
	var t = trace[k];
	t.capped++; t.withheld += ex; t.cappedFrame = fr;
	if (Math.abs(ex) > t.withheldMax) t.withheldMax = Math.abs(ex);
	if (t.caps.length < 4000) t.caps.push({ frame: fr, y: S.y[p], m: S.m[p], T: tb, hi: bh, lo: bl, withheld: ex });
}
if (place !== 'room' && place !== 'mass') throw new Error('--place is room or mass');
if (!(shr >= 0)) throw new Error('--share is the mass share at which the frb bound is full, >= 0');
if (!(seed > 0) || !Number.isInteger(seed) || !(kyr > 0) || !Number.isFinite(kyr)) throw new Error('invalid --seed or --kyr');
if (!(kind in defaults) || !Number.isFinite(value) || !(myr > 0) || !Number.isFinite(myr)
	|| (kind === 'cap' && value < 1) || (kind === 'floor' && !(value > 0 && value <= 1))
	|| (kind === 'relax' && !(value >= 0 && value < 1)) || (kind === 'minimum' && value <= 0)
	|| ((kind === 'spread' || kind === 'stencil' || kind === 'frb') && !(value > 0))
	|| ((kind === 'relaxw' || kind === 'subgrid') && !(value > 0))) {
	throw new Error('invalid candidate, value or duration');
}
function replaceOnce(text, from, to) {
	if (text.split(from).length !== 2) throw new Error('kernel anchor changed: ' + from);
	return text.replace(from, to);
}
function spl(d) {
	var a = Math.abs(d);
	return a <= 0.5 ? 0.75 - d * d : a < 1.5 ? 0.5 * (1.5 - a) * (1.5 - a) : 0;
}
// Keep the production stencil, application and ledger arithmetic. No edited runtime file.
// cap scales the entire specific increment by min(1, cap / normalized stencil gain).
// floor scales it by min(1, normalized stencil mass share / floor). Both affect all phases.
if (kind === 'cap' || kind === 'floor') {
	var src = G.gatherDT.toString();
	src = replaceOnce(src, 'var di_ = 0, tg = 0;', 'var di_ = 0, tg = 0, gain = 0, den = 0, share = 0;');
	src = replaceOnce(src, 'di_ += wsum * inc[q];', `di_ += wsum * inc[q];
				gain += wsum; den += wx * we;
				if (M.w[q] > 0) share += wx * we * wx * we * S.m[p] / M.w[q];`);
	src = replaceOnce(src, 'S.H[p] += d;', (kind === 'cap'
		? 'if (gain > value * den) d *= value * den / gain;'
		: 'if (den > 0) d *= Math.min(1, share / (den * value));') + '\n\t\tS.H[p] += d;');
	G.gatherDT = new Function('P', 'PTPHASE', 'spl', 'value', 'return ' + src)(P, PHASE, spl, value);
}
// Relax only deposits, toward the ordinary bilinear field (NOT the adjoint-weighted
// PIC temperature, whose weights need not sum to one). The correction is honestly booked.
if (kind === 'relax') {
	var gather = G.gatherDT;
	G.gatherDT = function (M, S, inc, Tg, flip) {
		gather(M, S, inc, Tg, flip);
		var p, h, d, total = 0;
		for (p = 0; p < S.n; p++) {
			if (S.ph[p] !== P.PH.dep) continue;
			h = PHASE.byT(G.sampleAt(M, Tg, S.x[p], S.e[p]), S.y[p], S.cF[p], S.cW[p]).h;
			d = (1 - value) * (h - S.H[p]);
			S.H[p] += d; total += S.m[p] * d;
		}
		S.hLedger += total;
	};
}
P.wrap = 16000; P.depth = 2900; P.yLin = 40;
P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
P.resFrac = P.resMelt + P.resAir + P.resDep;
P.ic = 'cool'; P.flip = 1; P.solid = true;
P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12;
P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
P.sl.kyr = kyr; P.seed = seed;
P.contact = true; P.slab = true; P.arc = true; P.ero = true;
SIM.init(); SIM.reset(); SIM.dt = kyr / 1000;
var M = SIM.M;
// G5 runs once per fluid substep, so its held-back residence integrates over the substep
// (sim.js: n = ceil(dt / dtFluidMax)); at 50 kyr one frame is one substep.
var subDt = SIM.dt / Math.max(1, Math.ceil(SIM.dt / P.dtFluidMax));
// relaxw / subgrid (0.3.2 M2 re-measurement): every passive host parcel relaxes toward the
// ordinary bilinear field (the reading G5's field-support term uses) after the adjoint gather,
// at the sub-grid conductive rate of its own size: retention exp(-value * kappa * dt / m), the
// parcel area m standing for its length squared. The rate is clock-independent and needs no
// tuned constant (value = 1 is the slowest mode of a parcel-sized region, kept as the
// conservative choice): a base parcel of ~1.8e3 km2 keeps 0.9991 per 50 kyr, a 50 km2 deposit
// 0.969, a 0.014 km2 sliver nothing -- the light parcels whose FLIP increments never feed back
// into the field they sit in are exactly the ones it restores. The relaxed set is the passive
// host material (PH_SOLID: mantle and deposits; --scope dep narrows it to deposits, the M0
// relaxation's own scope); mobile melt keeps its own P3.2 transit, so the probe does not become
// a magma-freezing rule. The reaction (subgrid) reaches every grid-coupled parcel, because the
// adjoint identity is over the whole coupled set.
// relaxw books the net correction R as an explicit non-operator source (hLedger only, beside
// the wall, never folded into S.wall: the plan forbids balancing the wall gate that way).
// subgrid makes the exchange zero-sum: each parcel's extensive correction is scattered over the
// covered nodes of its stencil and taken back from the parcels there through the adjoint
// weights (sum_p m_p W_pk cw_k = mu_k), so the reaction a parcel feels is sum_k W_pk E_k / w_k,
// never amplified, and the wall integral is the operator's own.
var rlSt = { R: 0, gross: 0, react: 0, resid: 0 };
// the parcel's stencil restricted to covered nodes (cw > 0), in one scratch: node indices in
// stQ, weights in stW, the count returned. Both relaxation passes read the same set.
var stQ = new Int32Array(9), stW = new Float64Array(9);
function covered(M, S, p) {
	var nx = M.nx, ny = M.ny, cw = M.cw, n = 0, di, dj, ii, jj, q, we;
	var px = S.x[p] / M.dx, ic = Math.round(px), pe = S.e[p] / M.dEta, jc = Math.round(pe);
	px -= ic; pe -= jc;
	for (dj = -1; dj <= 1; dj++) {
		jj = jc + dj; if (jj < 1 || jj > ny - 1) continue;
		we = spl(dj - pe);
		for (di = -1; di <= 1; di++) {
			ii = ic + di; ii -= Math.floor(ii / nx) * nx; q = jj * nx + ii;
			if (cw[q] > 0) { stQ[n] = q; stW[n] = spl(di - px) * we; n++; }
		}
	}
	return n;
}
if (kind === 'relaxw' || kind === 'subgrid') {
	var gatherR = G.gatherDT, moveR = F.move, dtR = 0, zeroSum = kind === 'subgrid';
	var Ek = new Float64Array(M.n), relaxSet = new Uint8Array(P.PH_N);
	if (scope === 'dep') relaxSet[P.PH.dep] = 1; else relaxSet.set(P.PH_SOLID);
	F.move = function (M, S, dt, kappa, flip) { dtR = dt; moveR(M, S, dt, kappa, flip); };
	G.gatherDT = function (M, S, inc, Tg, flip) {
		gatherR(M, S, inc, Tg, flip);
		var w = M.w, grid = P.PH_GRID, ph = S.ph, k = P.kappa * dtR * value;
		var p, h, d, e, total = 0, back = 0, n, i, ws, wt;
		if (zeroSum) Ek.fill(0);
		for (p = 0; p < S.n; p++) {
			if (!relaxSet[ph[p]]) continue;
			h = PHASE.byT(G.sampleAt(M, Tg, S.x[p], S.e[p]), S.y[p], S.cF[p], S.cW[p]).h;
			d = (1 - Math.exp(-k / S.m[p])) * (h - S.H[p]);
			if (d === 0) continue;
			S.H[p] += d; e = S.m[p] * d; total += e; rlSt.gross += Math.abs(e);
			if (!zeroSum) continue;
			n = covered(M, S, p); ws = 0;
			for (i = 0; i < n; i++) ws += stW[i];
			for (i = 0; i < n; i++) Ek[stQ[i]] += e * stW[i] / ws;
		}
		if (zeroSum) {
			for (p = 0; p < S.n; p++) {
				if (!grid[ph[p]]) continue;
				n = covered(M, S, p); wt = 0;
				for (i = 0; i < n; i++) wt += stW[i] * Ek[stQ[i]] / w[stQ[i]];
				S.H[p] -= wt; back += S.m[p] * wt;
			}
			rlSt.react += back;
		}
		// whatever the adjoint does not return exactly (round-off, or a parcel G.reseed moved
		// after the scatter that built w) stays booked, so the enthalpy book closes on every row
		rlSt.R += total - back; S.hLedger += total - back;
		if (zeroSum) rlSt.resid = Math.max(rlSt.resid, Math.abs(total - back));
	};
}
// Node-wise conservative bounded redistribution (0.3.2 M1, the plan's next measurement after
// the rejected M0 families): bound the parcel-specific delivery at the gate's own equilibrium
// temperature bounds (value .. value - 2, default 1.5 .. -0.5) and hand each node's withheld
// extensive increment to the bucket members at that node that can still take it under the
// same bound. Per-node totals are preserved, so the intake, the books and the wall gate see
// the baseline's own delivery to round-off; nothing is attenuated and nothing is
// manufactured. Where a bucket's eligible capacity cannot absorb the withheld increment, the
// remainder goes back to the capped parcels that raised it -- the node total is still
// preserved and the bound stays violated, but smaller than the baseline's -- and the event is
// counted and integrated (shortN/shortH): feasibility is measured, not hidden in an unbooked
// global correction. The bound is checked on the equilibrium reading of the delivered
// enthalpy (byH), at the parcel's pre-advection depth; the frame-end gate reads the same
// quantity after advection, so a capped parcel can still finish a hair outside the bound.
// The two violation sides are placed separately, and a giveback never exceeds the capped
// parcel's own withholding, so no parcel can finish worse than the baseline's own delivery
// at it. The first cut of this probe divided the giveback by the bucket's *net* excess; a
// mixed-sign bucket near cancellation then amplified one parcel's share without bound (a
// deposit flung to T -2.44 where the baseline's coldest is -0.791,
// logs/0.3.2-tail-spread15-v1.json) -- a rejected implementation of the family, kept as the
// measurement that motivated the per-parcel cap.
// stencil (0.3.2 M2 re-measurement): the same probe with the placement set widened from the
// nearest-node bucket to the 3x3 node block of the gather stencil around the capped parcel's
// node, so the conservation unit is the stencil block rather than the node. Blocks overlap and
// are placed in node order on the live enthalpy, so headroom one placement used is gone for
// the next; the giveback still returns only to the capped parcels of the node that raised it.
// frb (0.3.2 M4, the candidate M3 §9.1 leaves standing): the same conservative placement, but
// the bound is the field a parcel sits in instead of a constant -- the delivered state may not
// leave (T_field - value, T_field + value) -- so the bound is two-sided by construction and it
// bites where M2's constant bound only clipped (a light deposit parked at T 1.500 while still
// 0.72 of T above its own field). The field is the pre-gather nodal temperature, read once per
// coupled parcel into tfP before the delivery loop, so the bound, the headroom and the giveback
// all read the same snapshot. Placement is unchanged, so per-node totals, the intake, the books
// and the wall integral are still the baseline's own delivery to round-off: the probe bounds the
// distribution, never the integral.
// `--share s0 > 0` is M3 §9.1's own form of the same bound: the departure a parcel may hold
// from the field it sits in is `K * share / s0`, share being the parcel's own fraction of its
// stencil's marker mass, so a parcel that *is* the field there is left alone and the slivers
// the concentration rides on are clamped toward nothing. (s0 = 0 is the flat bound, measured
// first: it holds the gate on every phase and every frame and takes the pipeline with it --
// the departure from the field is also what makes melt segregate and erupt, so a bound tight
// enough to empty the tail empties the engine along with it.)
// `--place mass` changes who receives a withheld increment: M1/M2 hand it to the block member
// with the most headroom under the bound, and headroom is largest for the *coldest* parcel, so
// the family pumps heat out of the tail and into the cold bulk -- measured on the bank cell, the
// mantle then sits above the melt threshold 1,400x as often and the pool refuses millions of
// slots. Weighted by the member's marker share instead, the withheld heat goes back to the
// material that *is* the field there; a weight is still clipped at that member's own headroom,
// and whatever the block cannot take returns to the capped parcels as before, so node totals
// are preserved either way.
var spSt = { capped: 0, given: 0, giveback: 0, shortN: 0, shortH: 0 };
if (kind === 'spread' || kind === 'stencil' || kind === 'frb') {
	var rad = kind === 'spread' ? 0 : 1;
	var fr = kind === 'frb';
	var src = G.gatherDT.toString();
	var hiOff = value, loOff = fr ? -value : value - 2;
	// the field reading every bound below is taken against, and the stencil mass share that
	// scales it: one snapshot per frame, taken together in one pass
	var tfP = new Float64Array(S.m.length), shP = new Float64Array(S.m.length);
	var heads = new Int32Array(M.n), nextA = new Int32Array(S.m.length);
	var roomA = new Float64Array(S.m.length), withA = new Float64Array(S.m.length);
	var wA = new Float64Array(S.m.length);
	var excessP = new Float64Array(M.n), excessN = new Float64Array(M.n);
	src = replaceOnce(src,
		'var nx = M.nx, p, q, di, dj, jj, ii, ic, jc, px, pe, tot = 0, d, cw = M.cw, wsum, out;',
		`var nx = M.nx, p, q, di, dj, jj, ii, ic, jc, px, pe, tot = 0, d, cw = M.cw, wsum, out;
	var hp, tb, bh, bl, kp, dc, ex, room, gf, b2, wq, amt, rmd, sg, bd, exP, exN, g0 = P.PH_GRID, f0 = S.ph;
	var placed;
	var num, den, part, ww, wxm, wx0, wxp, wem, we0, wep;
	var qi, qj, bi, bj;
	heads.fill(-1);
	for (p = S.n - 1; p >= 0; p--) {
		if (!g0[f0[p]]) continue;
		withA[p] = 0;
		if (fr) {
			tfP[p] = sample(M, Tg, S.x[p], S.e[p]);
			// the share is read whether or not the bound scales by it: --place mass weights by it
			px = S.x[p] / M.dx; ic = Math.round(px); px -= ic;
			pe = S.e[p] / M.dEta; jc = Math.round(pe); pe -= jc;
			wxm = spl(-1 - px); wx0 = spl(-px); wxp = spl(1 - px);
			wem = spl(-1 - pe); we0 = spl(-pe); wep = spl(1 - pe);
			num = 0; den = 0; part = 0;
			for (dj = -1; dj <= 1; dj++) {
				jj = jc + dj;
				if (jj < 1 || jj > M.ny - 1) continue;
				we = dj === -1 ? wem : dj === 0 ? we0 : wep;
				for (di = -1; di <= 1; di++) {
					ii = ic + di; ii -= Math.floor(ii / nx) * nx;
					wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
					ww = wx * we;
					if (!(ww > 0)) continue;
					q = jj * nx + ii;
					den += ww;
					if (M.w[q] > 0) part += ww * (ww * S.m[p] / M.w[q]);
				}
			}
			shP[p] = den > 0 ? part / den : 0;
		}
		q = nodeOf(M, S, p);
		nextA[p] = heads[q]; heads[q] = p;
	}`);
	src = replaceOnce(src, 'S.H[p] += d;',
		`hp = S.H[p] + d;
		tb = PTPHASE.byH(hp, S.y[p], S.cF[p], S.cW[p]).t;
		if (fr) {
			kp = shr > 0 ? shP[p] / shr : 1;
			bh = tfP[p] + hiOff * kp; bl = tfP[p] - hiOff * kp;
		} else { bh = hiOff; bl = loOff; }
		if ((!fr || !scopeDep || S.ph[p] === P.PH.dep) && (tb > bh || tb < bl)) {
			dc = PTPHASE.byT(tb > bh ? bh : bl, S.y[p], S.cF[p], S.cW[p]).h - S.H[p];
			ex = S.m[p] * (d - dc);
			q = nodeOf(M, S, p);
			if (ex > 0) excessP[q] += ex; else excessN[q] += ex;
			withA[p] = ex;
			d = dc; st.capped++;
			if (TRC) TRC(S, p, tb, bh, bl, ex, TRF.frame);
		}
		S.H[p] += d;`);
	src = replaceOnce(src, 'S.hLedger += tot;',
		`for (q = 0; q < M.n; q++) {
		exP = excessP[q]; exN = excessN[q];
		if (exP === 0 && exN === 0) continue;
		excessP[q] = 0; excessN[q] = 0;
		b2 = heads[q]; qi = q % M.nx; qj = (q - qi) / M.nx;
		for (sg = 1; sg >= -1; sg -= 2) {
			amt = sg > 0 ? exP : -exN;
			if (amt === 0) continue;
			bd = sg > 0 ? hiOff : loOff;
			room = 0; placed = 0;
			for (bj = qj - rad; bj <= qj + rad; bj++) {
				if (bj < 1 || bj > M.ny - 1) continue;
				for (bi = qi - rad; bi <= qi + rad; bi++) {
					for (p = heads[bj * M.nx + bi - Math.floor(bi / M.nx) * M.nx]; p >= 0; p = nextA[p]) {
						hp = S.H[p];
						if (fr) {
							kp = shr > 0 ? shP[p] / shr : 1;
							bd = tfP[p] + (sg > 0 ? hiOff : -hiOff) * kp;
						}
						dc = PTPHASE.byT(bd, S.y[p], S.cF[p], S.cW[p]).h;
						dc = sg > 0 ? dc - hp : hp - dc;
						roomA[p] = dc > 0 ? S.m[p] * dc : 0;
						wA[p] = pmass ? shP[p] : roomA[p];
						room += wA[p];
					}
				}
			}
			gf = room >= amt ? amt / room : 1;
			for (bj = qj - rad; bj <= qj + rad; bj++) {
				if (bj < 1 || bj > M.ny - 1) continue;
				for (bi = qi - rad; bi <= qi + rad; bi++) {
					for (p = heads[bj * M.nx + bi - Math.floor(bi / M.nx) * M.nx]; p >= 0; p = nextA[p]) {
						wq = wA[p] * gf;
						if (wq > roomA[p]) wq = roomA[p];
						if (wq > 0) { S.H[p] += sg * wq / S.m[p]; tot += sg * wq; st.given++; placed += wq; }
					}
				}
			}
			if (pmass) { rmd = amt - placed; if (rmd <= 0) continue; }
			else { if (room >= amt) continue; rmd = amt - room; }
			for (p = b2; p >= 0; p = nextA[p]) {
				if (sg * withA[p] <= 0) continue;
				wq = rmd * (sg * withA[p]) / amt;
				S.H[p] += sg * wq / S.m[p]; tot += sg * wq; st.giveback++;
			}
			st.shortN++; st.shortH += rmd;
		}
	}
	S.hLedger += tot;`);
	G.gatherDT = new Function('P', 'PTPHASE', 'spl', 'hiOff', 'loOff', 'heads', 'nextA', 'roomA',
		'withA', 'wA', 'excessP', 'excessN', 'nodeOf', 'st', 'rad', 'fr', 'tfP', 'shP', 'shr', 'pmass',
		'sample', 'scopeDep', 'TRC', 'TRF',
		'return ' + src
	)(P, PHASE, spl, hiOff, loOff, heads, nextA, roomA, withA, wA, excessP, excessN, G.nodeOf, spSt,
		rad,
		fr, tfP, shP, shr, place === 'mass', G.sampleAt, scope === 'dep', TRN ? trCap : null, trFrame);
}
var merged = 0, stranded = 0;
// Conservative same-node, compatible-composition, same-certificate merge before scatter.
// Greedy ascending slots; rebuild buckets after a successful compacting merge. A floor
// cannot be promised where no compatible local recipient exists: count those attempts.
if (kind === 'minimum') {
	var transfer = F.transfer, heads = new Int32Array(M.nx * (M.ny + 1));
	var next = new Int32Array(S.m.length);
	function buckets() {
		heads.fill(-1);
		for (var p = S.n - 1; p >= 0; p--) {
			if (S.ph[p] !== P.PH.dep) continue;
			var q = G.nodeOf(M, S, p);
			next[p] = heads[q]; heads[q] = p;
		}
	}
	F.transfer = function (M, S) {
		buckets();
		var p = 0, b;
		while (p < S.n) {
			if (S.ph[p] !== P.PH.dep || S.m[p] >= value) { p++; continue; }
			b = heads[G.nodeOf(M, S, p)];
			while (b >= 0 && !(S.m[b] >= value && S.depQ[b] === S.depQ[p]
				&& POOL.compatible(S, p, b))) b = next[b];
			if (b < 0) { stranded++; p++; continue; }
			POOL.merge(M, S, b, p); merged++; buckets();
		}
		transfer(M, S);
	};
}
// 0.3.2 M3 (step 1): melt depletion of the split residue, measured as a probe on the P3.2
// source law -- the residue's solidus has to move with what has been extracted, or a
// restoring exchange re-melts the same residue every frame for ever. Two independent
// channels, both off by default, neither one in the engine state:
//
//   --dpart D  the extracted melt carries the parcel's water and felsic material at the
//              batch-melting partition D: c_melt = c / (D + F (1 - D)), c_res = c D / (D +
//              F (1 - D)), F the split's own melt fraction. The residue's solidus rises by
//              meltWW * dcW + meltWF * dcF; the residue is left at its old solidus with H
//              unchanged and nothing booked (it is simply subsolidus now), and the melt child
//              keeps its own H, reading back as superheated melt (xi = 1). Both children stay
//              exactly on the law's manifold, so the "a split moves material, it does not melt
//              it" identity and the P3.1 latent identity are untouched. This is the water-flux
//              reading of depletion: the flux leaves with the melt.
//   --cap PHI  a parcel may shed at most a fraction PHI of its own mass over its life (probe
//              map by material id, never engine state); the first split of a parcel is
//              unaffected, later ones stop once the inventory is spent, and a spent parcel
//              never routes again however warm its field is. This is the refractory-residue
//              limit the water budget alone cannot reach: the banked M2 subgrid row's bleed
//              residues sit a median 0.022 of T above their own solidus and 4,509 of the row's
//              8,559 candidates still sit above the residue's DRY solidus (the water removed
//              outright), so drying alone closes less than half of them.
var dpartD = flag('--dpart', 0), capPhi = flag('--cap', 0);
var dpSt = { splits: 0, dw: 0, tsMax: 0, tsSum: 0, wetLost: 0 };
if (dpartD > 0 || capPhi > 0) {
	if (!(dpartD >= 0 && dpartD <= 1) || !(capPhi >= 0 && capPhi <= 1)) throw new Error('invalid --dpart or --cap');
}
if (dpartD > 0) {
	var srcS = POOL.separate.toString();
	srcS = replaceOnce(srcS, '\t\t\tS.cF[q] = S.cF[p]; S.cW[q] = S.cW[p];',
		'\t\t\tvar den = dpart + xi * (1 - dpart), wq = S.cW[p] / den, fq = S.cF[p] / den, cW0 = S.cW[p], cF0 = S.cF[p];\n' +
		'\t\t\tif (wq > 1) wq = 1;\n' +
		'\t\t\tif (fq > 1) fq = 1;\n' +
		'\t\t\tS.cF[q] = fq; S.cW[q] = wq;\n' +
		'\t\t\tS.cW[p] = (cW0 - xi * wq) / (1 - xi); if (S.cW[p] < 0) S.cW[p] = 0;\n' +
		'\t\t\tS.cF[p] = (cF0 - xi * fq) / (1 - xi); if (S.cF[p] < 0) S.cF[p] = 0;\n' +
		'\t\t\tDP.rise(P.meltWW * (cW0 - S.cW[p]) + P.meltWF * (cF0 - S.cF[p]));');
	POOL.separate = new Function('P', 'PHASE', 'dpart', 'DP', 'return ' + srcS)(P, PHASE, dpartD, dpSt);
}
var capSt = { parcels: 0, blocked: 0, whole: 0, spent: 0 };
if (capPhi > 0) {
	var budget = new Map();
	var detSrc = MT.detach.toString();
	detSrc = replaceOnce(detSrc, 'var ph = S.ph, ml = S.melt, hold = P.meltHold, p, xi, dep;',
		'var ph = S.ph, ml = S.melt, hold = P.meltHold, p, xi, dep, q0;');
	detSrc = replaceOnce(detSrc, '\t\t\t\tif (xi < 1) { POOL.separate(S, p, dep); continue; }',
		'\t\t\t\tif (xi < 1) {\n' +
		'\t\t\t\t\tif (!capOk(S, p)) { capSt.blocked++; continue; }\n' +
		'\t\t\t\t\tq0 = POOL.separate(S, p, dep);\n' +
		'\t\t\t\t\tif (q0 >= 0) capTake(S, p, S.m[q0]);\n' +
		'\t\t\t\t\tcontinue;\n' +
		'\t\t\t\t}');
	detSrc = replaceOnce(detSrc, '\t\t\t\tph[p] = P.PH.melt;',
		'\t\t\t\tif (!capOk(S, p)) { capSt.blocked++; capSt.whole++; continue; }\n' +
		'\t\t\t\tcapTake(S, p, S.m[p]);\n' +
		'\t\t\t\tph[p] = P.PH.melt;');
	// melt.js's fieldHolds is private to that file; the harness's own copy is the same test
	// (the node field the parcel sits in reaches the parcel's solidus), so the rewritten detach
	// can take it as a parameter like the rest of the kernel's helpers.
	detSrc = replaceOnce(detSrc, 'fieldHolds(M, S, p)', 'fHolds(M, S, p)');
	MT.detach = new Function('P', 'POOL', 'fHolds', 'capOk', 'capTake', 'capSt', 'return ' + detSrc)(
		P, POOL, fHolds, capOk, capTake, capSt);
}
function fHolds(M, S, p) {
	return G.sampleAt(M, S.Tg, S.x[p], S.e[p]) >= PHASE.solidus(S.y[p], S.cF[p], S.cW[p]);
}
function capOk(S, p) {
	var id = S.id[p], b = budget.get(id);
	if (b === undefined) { b = capPhi * S.m[p]; budget.set(id, b); capSt.parcels++; }
	return b > 0;
}
function capTake(S, p, amount) {
	var id = S.id[p], b = budget.get(id) - amount;
	budget.set(id, b > 0 ? b : 0);
	if (b <= 0) capSt.spent++;
}
dpSt.rise = function (rise) {
	dpSt.splits++;
	if (rise > dpSt.tsMax) dpSt.tsMax = rise;
	dpSt.tsSum += rise;
};

var events = [], frame = 0, sampleMs = 0, heldTime = 0, heldMeltTime = 0, heldSamples = 0;
var heldGap = -Infinity, mantleRoutes = 0, detach = MT.detach;
// Allocation here is observation only, subtracted from the step timer. State is read-only.
MT.detach = function (M, S) {
	var start = performance.now(), p, tg, ts, tk;
	for (p = 0; p < S.n; p++) {
		if (S.melt[p] < P.meltHold) continue;
		tk = trSlot(S, p);
		if (tk >= 0) trace[tk].routed++;
		if (S.ph[p] === P.PH.mantle) { mantleRoutes++; continue; }
		if (S.ph[p] !== P.PH.dep || !S.depQ[p] || S.y[p] <= P.depositCoolDepth) continue;
		tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
		ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p]);
		if (tg < ts) {
			heldSamples++; heldTime += S.m[p] * subDt;
			heldMeltTime += S.m[p] * S.melt[p] * subDt;
			heldGap = Math.max(heldGap, S.T[p] - tg);
			if (tk >= 0) { trace[tk].held++; trSample(M, S, p, tk, 4); }
			continue;
		}
		events.push({ frame: frame, id: S.id[p], x: S.x[p], y: S.y[p], host: S.m[p],
			melt: S.m[p] * S.melt[p], T: S.T[p], field: tg, solidus: ts,
			cF: S.cF[p], cW: S.cW[p] });
		if (tk >= 0) { trace[tk].delivered++; trace[tk].deliveredFrame = frame; trSample(M, S, p, tk, 5); }
	}
	sampleMs += performance.now() - start;
	detach(M, S);
};
POOL.inventoryComp(S);
var m0 = S.invMTot, h0 = S.invHTot, hl0 = S.hLedger, w0 = S.wall;
var mass = 0, enth = 0, wall = 0, wallOp = 0, latent = 0, latentFrame = 0, latentAbs = 0;
// latentBook scales the residual by the two books it is the difference of (the plan's metric
// floors |hLedger - ledger| at 1, which near a zero crossing of that difference is an absolute
// 1e-10 km2*H gate, below the compensated-inventory round-off of a ~4e7 km2*H pool)
var latentBook = 0, latentBookFrame = 0, latentAbsMax = 0, l0 = S.ledger;
// hottest carries the material id (0.3.2 M5): the outlier the whole release is about was banked
// as a temperature, a frame and a place, which is enough to report it and not enough to trace it
var outFrames = 0, hot = { T: -Infinity, frame: 0, ph: -1, y: 0, m: 0, field: 0, id: -1 };
// the mesh repair's own counters (0.3.2 M5). F.transfer calls G.reseed when a node's deposited
// weight falls below coverage, and reseed's donor pull *moves* a marker onto the hole -- id, mass,
// composition and heat preserved, position replaced -- out of rings of radius 2, 8 then 32 nodes
// (dx = 62.5 km, so 32 nodes is 2000 km), with G.redeal's lattice permutation behind that. The M5
// trace found buried deposit material relocated by up to 737 km in depth and 376 km laterally, and
// one parcel's largest departure from its own field three frames after such a move; how often the
// repair fires, and how much material it moves, is a population question a six-parcel trace cannot
// answer, so the counters ride along in every bank from here on.
var movedSum = 0, movedMax = 0, movedFrames = 0;
var ms = 0, frames = Math.round(myr / SIM.dt);
var mins = [Infinity, Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity, -Infinity];
var outside = [0, 0, 0, 0], outsideLo = [0, 0, 0, 0], outsideHi = [0, 0, 0, 0], nonfinite = 0;
// 0.3.2 M3 (steps 2 and 3), --watch: read-only observation of the two faces the M2 matrix
// opened. The band table reads the cold side as its own quantity -- per-depth extrema per
// phase, with the frame and the material id that set each one, and the path of every new
// global mantle minimum -- instead of one minT scalar per phase. The excursion table watches
// mobile melt above the 1.5 bound by itself: each excursion records the entry reading, the
// frame the parcel was hottest in it, the field it crossed and the parcel's own state there,
// and the close, so the report can separate "the gather heated a light parcel" from "the
// parcel's own transit carries the excess".
var watch = process.argv.includes('--watch');
var BANDS = [0, 50, 120, 250, 500, 1000, 2000, 3000];
var NB = BANDS.length;
function bandOf(y) { for (var b = NB - 1; b > 0; b--) if (y >= BANDS[b]) return b; return 0; }
var bndMin = new Float64Array(4 * NB), bndFrame = new Int32Array(4 * NB), bndId = new Int32Array(4 * NB);
for (var kb = 0; kb < 4 * NB; kb++) { bndMin[kb] = Infinity; bndId[kb] = -1; }
var cold = { T: Infinity, frame: 0, id: -1, y: 0, m: 0, field: 0, H: 0 };
var coldPath = [];
var xruns = new Map(), excur = [], xsamples = [], exSamples = 0, meltSeen = 0;
function gapAt(S, p) { return PHASE.byT(G.sampleAt(M, S.Tg, S.x[p], S.e[p]), S.y[p], S.cF[p], S.cW[p]).h - S.H[p]; }
// M3 §9.2: the pairing's own gain and the parcel's mass share of the same stencil, ported from
// experiments/pt-buried-deposit-melt.js (routeGain) so the cold side is measured rather than
// inferred. gatherDT hands parcel p the specific increment sum_q W_pq cw_q inc_q, so
// cw = mu / W is exactly the factor between a plain interpolation of the node increments and
// what the parcel took: above 1 the quadrature concentrated heat into it. cw and w are G1's,
// i.e. the deposit that produced the delivery now closing; the parcel has advected a substep
// since, so a reading is a sample of the mechanism and not a reconstruction of the history.
var RG = { gain: 0, share: 0 };
function gainAt(S, p) {
	var nx = M.nx, ny = M.ny, cw = M.cw, w = M.w, m = S.m[p];
	var px = S.x[p] / M.dx, ic = Math.round(px), pe = S.e[p] / M.dEta, jc = Math.round(pe);
	var num = 0, den = 0, part = 0, di, dj, ii, jj, wx, we, ww, q;
	px -= ic; pe -= jc;
	var wxm = spl(-1 - px), wx0 = spl(-px), wxp = spl(1 - px);
	var wem = spl(-1 - pe), we0 = spl(-pe), wep = spl(1 - pe);
	for (dj = -1; dj <= 1; dj++) {
		jj = jc + dj;
		if (jj < 1 || jj > ny - 1) continue;
		we = dj === -1 ? wem : dj === 0 ? we0 : wep;
		for (di = -1; di <= 1; di++) {
			ii = ic + di; ii -= Math.floor(ii / nx) * nx;
			wx = di === -1 ? wxm : di === 0 ? wx0 : wxp;
			ww = wx * we;
			if (!(ww > 0)) continue;
			q = jj * nx + ii;
			num += ww * cw[q]; den += ww;
			if (w[q] > 0) part += ww * (ww * m / w[q]);
		}
	}
	RG.gain = den > 0 ? num / den : 0;
	RG.share = den > 0 ? part / den : 0;
}
for (frame = 1; frame <= frames; frame++) {
	trFrame.frame = frame;
	var t = performance.now();
	SIM.step();
	ms += performance.now() - t;
	POOL.inventoryComp(S);
	mass = Math.max(mass, Math.abs(S.invMTot - m0) / m0);
	enth = Math.max(enth, Math.abs(S.invHTot - h0 - (S.hLedger - hl0)) / Math.max(1, Math.abs(S.hLedger - hl0)));
	wall = Math.max(wall, Math.abs((S.hLedger - hl0) / (S.wall - w0) - 1));
	wallOp = Math.max(wallOp, Math.abs((S.hLedger - hl0 - rlSt.R) / (S.wall - w0) - 1));
	var outBefore = outside[0] + outside[1] + outside[2] + outside[3];
	var la = Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0));
	var lr = la / Math.max(1, Math.abs(S.hLedger - S.ledger));
	if (lr > latent) { latent = lr; latentFrame = frame; latentAbs = la; }
	if (la > latentAbsMax) latentAbsMax = la;
	lr = la / Math.max(1, Math.abs(S.hLedger - hl0), Math.abs(S.ledger - l0));
	if (lr > latentBook) { latentBook = lr; latentBookFrame = frame; }
	movedSum += S.moved;
	if (S.moved > movedMax) movedMax = S.moved;
	if (S.moved > 0) movedFrames++;
	for (var p = 0; p < S.n; p++) {
		var ph = S.ph[p], T = S.T[p], tk, tr, why;
		if (!Number.isFinite(T)) { nonfinite++; continue; }
		mins[ph] = Math.min(mins[ph], T); maxs[ph] = Math.max(maxs[ph], T);
		if (T < -0.5) { outsideLo[ph]++; outside[ph]++; }
		else if (T > 1.5) { outsideHi[ph]++; outside[ph]++; }
		if (T > hot.T) { hot.T = T; hot.frame = frame; hot.ph = ph; hot.y = S.y[p]; hot.m = S.m[p]; hot.x = S.x[p]; hot.id = S.id[p]; }
		if (TRN) {
			tk = trSlot(S, p);
			if (tk >= 0) {
				tr = trace[tk];
				why = tr.cappedFrame === frame ? 3 : S.melt[p] > 0 ? 2
					: T >= PHASE.solidus(S.y[p], S.cF[p], S.cW[p]) - 0.05 ? 1
					: frame === frames ? 7 : tr.lastPh !== ph ? 6 : frame % TRSTRIDE === 0 ? 0 : -1;
				if (why >= 0) trSample(M, S, p, tk, why);
				tr.lastPh = ph;
			}
		}
		if (!watch) continue;
		var kb = ph * NB + bandOf(S.y[p]);
		if (T < bndMin[kb]) { bndMin[kb] = T; bndFrame[kb] = frame; bndId[kb] = S.id[p]; }
		if (ph === P.PH.mantle && T < cold.T) {
			cold.T = T; cold.frame = frame; cold.id = S.id[p]; cold.y = S.y[p]; cold.m = S.m[p];
			cold.H = S.H[p]; cold.field = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
			gainAt(S, p);
			coldPath.push({ frame: frame, id: S.id[p], y: S.y[p], m: S.m[p], T: T, H: S.H[p],
				field: cold.field, melt: S.melt[p], hm: cold.field - cold.T,
				gain: RG.gain, share: RG.share });
		}
		if (ph === P.PH.melt) {
			meltSeen++;
			var r = xruns.get(S.id[p]);
			if (T > 1.5) {
				exSamples++;
				gainAt(S, p);
				if (xsamples.length < 2000) xsamples.push({ frame: frame, id: S.id[p], T: T, y: S.y[p], m: S.m[p],
					H: S.H[p], melt: S.melt[p], field: G.sampleAt(M, S.Tg, S.x[p], S.e[p]),
					cF: S.cF[p], cW: S.cW[p], gap: gapAt(S, p), gain: RG.gain, share: RG.share });
				if (r === undefined) xruns.set(S.id[p], { frame0: frame, m0: S.m[p], H0: S.H[p], y0: S.y[p], T0: T,
					maxT: T, maxFrame: frame, n: 1, seen: frame, entryGap: gapAt(S, p), cF: S.cF[p], cW: S.cW[p],
					maxM: S.m[p], maxY: S.y[p], maxField: G.sampleAt(M, S.Tg, S.x[p], S.e[p]), maxMelt: S.melt[p], maxH: S.H[p],
					gain0: RG.gain, share0: RG.share, maxGain: RG.gain, maxShare: RG.share });
				else {
					r.n++; r.seen = frame;
					if (T > r.maxT) {
						gainAt(S, p);
						r.maxT = T; r.maxFrame = frame; r.maxM = S.m[p]; r.maxY = S.y[p]; r.maxMelt = S.melt[p];
						r.maxH = S.H[p]; r.maxField = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
						r.maxGain = RG.gain; r.maxShare = RG.share;
					}
				}
			}
		}
	}
	if (watch) xruns.forEach(function (r, id) {
		if (r.seen === frame) return;
		excur.push({ id: id, frame0: r.frame0, frame1: frame, frames: r.n, m0: r.m0, H0: r.H0, y0: r.y0, T0: r.T0,
			maxT: r.maxT, maxFrame: r.maxFrame, maxM: r.maxM, maxY: r.maxY, maxMelt: r.maxMelt, maxField: r.maxField,
			cF: r.cF, cW: r.cW, entryGap: r.entryGap, gain0: r.gain0, share0: r.share0,
			maxGain: r.maxGain, maxShare: r.maxShare });
		xruns.delete(id);
	});
	if (outside[0] + outside[1] + outside[2] + outside[3] > outBefore) outFrames++;
	if (hot.frame === frame) hot.field = G.sampleAt(M, S.Tg, hot.x, Math.asinh(hot.y / M.yLin));
}
// Excursion runs still open at the last frame are closed here, so a crossing in the final
// frame is recorded rather than dropped.
if (watch) xruns.forEach(function (r, id) {
	excur.push({ id: id, frame0: r.frame0, frame1: frames, frames: r.n, m0: r.m0, H0: r.H0, y0: r.y0, T0: r.T0,
		maxT: r.maxT, maxFrame: r.maxFrame, maxM: r.maxM, maxY: r.maxY, maxMelt: r.maxMelt, maxField: r.maxField,
		cF: r.cF, cW: r.cW, entryGap: r.entryGap, gain0: r.gain0, share0: r.share0,
		maxGain: r.maxGain, maxShare: r.maxShare, open: true });
});
var result = { kind: kind, value: value, scope: kind === 'relaxw' || kind === 'subgrid' || kind === 'frb' ? scope : null,
	seed: seed, kyr: kyr, myr: myr, frames: frames,
	fingerprint: S.hash(), mass: mass, enthalpy: enth, latent: latent,
	latentWorstFrame: latentFrame, latentWorstAbs: latentAbs, latentAbsMax: latentAbsMax,
	latentBook: latentBook, latentBookFrame: latentBookFrame,
	latentEnd: Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0))
		/ Math.max(1, Math.abs(S.hLedger - S.ledger)),
	depositBook: S.invM[P.PH.dep] - (S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep - S.thr.depMelt),
	meltBook: S.thr.seg + S.thr.whole + S.thr.depMelt - S.thr.freeze - S.thr.intrDr - S.invM[P.PH.melt],
	intakeWallWorst: wall,
	intakeWallEnd: Math.abs((S.hLedger - hl0) / (S.wall - w0) - 1),
	msFrame: (ms - sampleMs) / frames, minT: mins, maxT: maxs, outsideSamples: outside, nonfinite: nonfinite,
	outsideBelow: outsideLo, outsideAbove: outsideHi,
	heldSamples: heldSamples, heldMassTime: heldTime, heldMeltTime: heldMeltTime, heldGapMax: heldGap,
	mantleRoutes: mantleRoutes, depMelt: S.thr.depMelt, depTx: S.tx.depMelt, refuse: S.tx.refuse,
	merged: merged, strandedAttempts: stranded,
	movedSum: movedSum, movedMax: movedMax, movedFrames: movedFrames, redeals: S.redeals,
	spreadCapped: spSt.capped, spreadGiven: spSt.given, spreadGiveback: spSt.giveback,
	spreadShortN: spSt.shortN, spreadShortH: spSt.shortH,
	relaxSource: rlSt.R, relaxGross: rlSt.gross, relaxReaction: rlSt.react, relaxResidMax: rlSt.resid,
	relaxSourceOverWall: rlSt.R / (S.wall - w0), intakeWallOperatorWorst: wallOp,
	outsideFrames: outFrames, hottest: hot, events: events,
	// the frozen P3.2 census, for the depletion probes' own gate (M3 step 1)
	census: { split: S.tx.split, whole: S.tx.whole, freeze: S.tx.freeze, seg: S.thr.seg,
		wholeMass: S.thr.whole, freezeMass: S.thr.freeze, intrDr: S.thr.intrDr, intrCr: S.thr.intrCr,
		landDr: S.thr.landDr, landCr: S.thr.landCr, ventDr: S.thr.ventDr, chambers: S.chN,
		meltM: S.invM[P.PH.melt], depN: S.invM[P.PH.dep], nMelt: countPhase(S, P.PH.melt), nDep: countPhase(S, P.PH.dep) },
	depletion: { dpart: dpartD, cap: capPhi, riseMax: dpSt.tsMax, riseSum: dpSt.tsSum, rises: dpSt.splits,
		capParcels: capSt.parcels, capBlocked: capSt.blocked, capWholeBlocked: capSt.whole, capSpent: capSt.spent } };
function countPhase(S, ph) { var n = 0, p; for (p = 0; p < S.n; p++) if (S.ph[p] === ph) n++; return n; }
if (watch) {
	result.bands = { y: BANDS.slice(0), min: Array.prototype.slice.call(bndMin), frame: Array.prototype.slice.call(bndFrame),
		id: Array.prototype.slice.call(bndId) };
	result.cold = cold;
	result.coldPath = coldPath;
	result.excursions = excur;
	result.exSamples = exSamples;
	result.exSampleLog = xsamples;
}
// the trace is banked beside the run it explains: a material history is a property of one run,
// and the correspondence argument reads two of them side by side
if (TRN) {
	result.trace = { stride: TRSTRIDE, capRows: 4000,
		why: ['stride', 'at or above its own solidus - 0.05', 'molten', 'capped by the bound this frame',
			'held back by the field support', 'delivered', 'phase change', 'the last frame'],
		history: trace.map(function (t) {
			return { id: t.id, seen: t.seen, first: t.first, last: t.last,
				maxT: Number.isFinite(t.maxT) ? t.maxT : null, maxTFrame: t.maxTFrame,
				maxGap: Number.isFinite(t.maxGap) ? t.maxGap : null, maxGapFrame: t.maxGapFrame, maxGapY: t.maxGapY,
				capped: t.capped, withheld: t.withheld, withheldMax: t.withheldMax,
				routed: t.routed, held: t.held, delivered: t.delivered, deliveredFrame: t.deliveredFrame,
				rows: t.rows, caps: t.caps };
		}) };
}
result.gates = { mass: mass < 1e-9, enthalpy: enth < 1e-9, latent: latent < 1e-10, latentBook: latentBook < 1e-10,
	intakeWallP4: wall < 0.01, intakeWallReference: wall < 5e-5,
	frame: result.msFrame < 20, temperature: nonfinite === 0 && outside.every(function (n) { return n === 0; }) };
// The bank file is the record; stdout is the console record a run's `.txt` log keeps. Printing
// the whole bank to both made every `> logs/x.txt` redirect a byte-identical twin of
// `logs/x.json` (0.3.2 M3: 21 MB of twins for 21 MB of banks), so with HEAT_TAIL_OUT set the
// console gets this summary and the bank keeps the detail. Without it stdout stays the full
// bank, so an ad-hoc `node pt-heat-tail.js ... | jq` still reads everything.
function summary(r) {
	var names = ['mantle', 'melt', 'air', 'dep'], g = r.gates, out = [], i, t;
	// a metric no sample ever set (-Infinity) reads as 'none', not as a number
	function e(x, d) { return Number.isFinite(x) ? Number(x).toExponential(d === undefined ? 3 : d) : 'none'; }
	function f(x, d) { return Number.isFinite(x) ? Number(x).toFixed(d === undefined ? 3 : d) : 'none'; }
	out.push('pt-heat-tail ' + r.kind + ' ' + r.value + (r.scope ? ' scope ' + r.scope : '') + ' seed ' + r.seed
		+ ' at ' + r.kyr + ' kyr/frame over ' + r.myr + ' Myr, ' + r.frames + ' frames');
	out.push('fingerprint ' + r.fingerprint + '   ' + f(r.msFrame) + ' ms/frame'
		+ (process.env.HEAT_TAIL_OUT ? '   bank ' + process.env.HEAT_TAIL_OUT : ''));
	out.push('gates: mass ' + (g.mass ? 'ok' : 'FAIL') + ', enthalpy ' + (g.enthalpy ? 'ok' : 'FAIL')
		+ ', latent identity ' + (g.latentBook ? 'ok' : 'FAIL') + ', wall (P4 < 0.01) ' + (g.intakeWallP4 ? 'ok' : 'FAIL')
		+ ', frame (< 20 ms) ' + (g.frame ? 'ok' : 'FAIL') + ', per-phase T bound ' + (g.temperature ? 'ok' : 'FAIL')
		+ ', refusals ' + r.refuse);
	out.push('wall |intake/wall - 1| worst ' + e(r.intakeWallWorst) + ', end ' + e(r.intakeWallEnd)
		+ ', operator-only ' + e(r.intakeWallOperatorWorst) + ', R/wall ' + e(r.relaxSourceOverWall, 2));
	for (i = 0; i < 4; i++) {
		out.push('T ' + names[i] + ' ' + f(r.minT[i], 4) + '..' + f(r.maxT[i], 4) + ' (' + r.outsideSamples[i]
			+ ' outside -0.5..1.5' + (r.outsideBelow ? ', ' + r.outsideAbove[i] + ' above / '
			+ r.outsideBelow[i] + ' below' : '') + ')');
	}
	out.push('hottest parcel T ' + f(r.hottest.T, 4) + ' in a field of ' + f(r.hottest.field, 4) + ' at '
		+ f(r.hottest.y, 1) + ' km, ' + f(r.hottest.m, 2) + ' km2, phase ' + names[r.hottest.ph] + ', frame ' + r.hottest.frame);
	out.push('route: ' + r.events.length + ' field-supported candidates, ' + r.depTx + ' delivered transfers, '
		+ r.events.filter(function (v) { return v.host < 1e-3; }).length + ' bleeding (host < 1e-3 km2), '
		+ f(r.depMelt, 6) + ' km2 shed, ' + r.mantleRoutes + ' mantle routings, ' + r.refuse + ' refusals');
	out.push('held back by field support: ' + r.heldSamples + ' samples, ' + f(r.heldMassTime, 4) + ' km2*Myr of host, '
		+ f(r.heldMeltTime, 4) + ' of melt-equivalent, worst T-field gap ' + f(r.heldGapMax, 4));
	t = r.census;
	out.push('P3.2 census: split ' + t.split + ', whole ' + t.whole + ', freeze ' + t.freeze + ', chambers ' + t.chambers
		+ ', seg ' + f(t.seg, 1) + ', intrDr ' + f(t.intrDr, 1) + ', landCr ' + f(t.landCr, 1) + ', ventDr ' + f(t.ventDr, 1)
		+ ', meltM ' + f(t.meltM, 1) + ', depN ' + f(t.depN, 1) + ', nMelt ' + t.nMelt + ', nDep ' + t.nDep);
	t = r.depletion;
	out.push('depletion: --dpart ' + t.dpart + ' (' + t.rises + ' rises, max ' + f(t.riseMax, 4) + ', sum ' + f(t.riseSum, 4)
		+ '), --cap ' + t.cap + ' (' + t.capParcels + ' parcels budgeted, ' + t.capBlocked + ' split candidates blocked, '
		+ t.capWholeBlocked + ' whole blocked, ' + t.capSpent + ' spent)');
	out.push('books: mass ' + e(r.mass, 2) + ', enthalpy ' + e(r.enthalpy, 2) + ', latent ' + e(r.latentAbsMax, 2)
		+ ' km2*H (' + e(r.latentBook, 2) + ' of its books), deposit ' + e(r.depositBook, 2) + ', melt ' + e(r.meltBook, 2));
	if (r.cold) out.push('global mantle minimum T ' + f(r.cold.T, 4) + ' at frame ' + r.cold.frame + ', id ' + r.cold.id
		+ ', ' + f(r.cold.y, 1) + ' km, ' + f(r.cold.m, 1) + ' km2, field ' + f(r.cold.field, 4)
		+ ' (parcel ' + f(r.cold.field - r.cold.T, 4) + ' below its own field); ' + r.coldPath.length + ' new minima');
	if (r.trace) r.trace.history.forEach(function (h) {
		out.push('trace ' + h.id + ': ' + (h.first
			? 'first seen frame ' + h.first.frame + ' at x ' + f(h.first.x, 1) + ' km, ' + f(h.first.y, 1)
				+ ' km deep, ' + f(h.first.m, 3) + ' km2, phase ' + names[h.first.ph]
			: 'no parcel of this id in this run')
			+ '; max T ' + f(h.maxT, 4) + ' (frame ' + h.maxTFrame + '), max T-field ' + f(h.maxGap, 4)
			+ ' at ' + f(h.maxGapY, 1) + ' km (frame ' + h.maxGapFrame + ')');
		out.push('        ' + h.capped + ' caps withholding ' + f(h.withheld, 4) + ' km2*H (largest '
			+ f(h.withheldMax, 4) + '), ' + h.routed + ' frames at the routing threshold, ' + h.held
			+ ' held by field support, ' + h.delivered + ' delivered'
			+ (h.deliveredFrame ? ' at frame ' + h.deliveredFrame : '') + ', last seen frame '
			+ (h.last ? h.last.frame : 'none') + ', ' + h.rows.length + ' rows');
	});
	if (r.excursions) out.push('mobile melt above 1.5: ' + r.excursions.length + ' excursion(s) over ' + r.exSamples
		+ ' parcel-frames' + (r.excursions.some(function (v) { return v.open; }) ? ', at least one still open at the last frame' : ''));
	return out.join('\n');
}
if (process.argv.includes('--assert-baseline') && (kind !== 'baseline' || myr !== 600 || seed !== 5 || kyr !== 50
	|| result.fingerprint !== 8261233554728015 || result.depTx !== 3)) process.exitCode = 1;
if (process.argv.includes('--assert-m2') && (kind !== 'baseline' || myr !== 600 || seed !== 5 || kyr !== 50
	|| result.fingerprint !== 6191250240167390 || result.depTx !== 3)) process.exitCode = 1;
if (process.env.HEAT_TAIL_OUT) {
	fs.writeFileSync(process.env.HEAT_TAIL_OUT, JSON.stringify(result, null, '\t') + '\n');
	console.log(summary(result));
} else console.log(JSON.stringify(result, null, '\t'));
