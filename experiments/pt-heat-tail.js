// 0.3.2 candidate measurement, not a shipping switch. Each cell runs in a fresh process.
// node experiments/pt-heat-tail.js [baseline|cap|floor|relax|minimum|spread|stencil|relaxw|subgrid]
//      [value] [Myr=600] [--seed 5] [--kyr 50] [--scope dep|solid] [--assert-baseline|--assert-m2]
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
	relaxw: 1, subgrid: 1 };
var value = process.argv[3] === undefined ? defaults[kind] : +process.argv[3];
var myr = process.argv[4] === undefined || process.argv[4].startsWith('--') ? 600 : +process.argv[4];
var scopeAt = process.argv.indexOf('--scope'), scope = scopeAt > 0 ? process.argv[scopeAt + 1] : 'solid';
if (scope !== 'dep' && scope !== 'solid') throw new Error('--scope is dep or solid');
function flag(name, fallback) { var i = process.argv.indexOf(name); return i > 0 ? +process.argv[i + 1] : fallback; }
var seed = flag('--seed', 5), kyr = flag('--kyr', 50);
if (!(seed > 0) || !Number.isInteger(seed) || !(kyr > 0) || !Number.isFinite(kyr)) throw new Error('invalid --seed or --kyr');
if (!(kind in defaults) || !Number.isFinite(value) || !(myr > 0) || !Number.isFinite(myr)
	|| (kind === 'cap' && value < 1) || (kind === 'floor' && !(value > 0 && value <= 1))
	|| (kind === 'relax' && !(value >= 0 && value < 1)) || (kind === 'minimum' && value <= 0)
	|| ((kind === 'spread' || kind === 'stencil') && !(value > 0))
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
var spSt = { capped: 0, given: 0, giveback: 0, shortN: 0, shortH: 0 };
if (kind === 'spread' || kind === 'stencil') {
	var rad = kind === 'stencil' ? 1 : 0;
	var src = G.gatherDT.toString();
	var hi = value, lo = value - 2;
	var heads = new Int32Array(M.n), nextA = new Int32Array(S.m.length);
	var roomA = new Float64Array(S.m.length), withA = new Float64Array(S.m.length);
	var excessP = new Float64Array(M.n), excessN = new Float64Array(M.n);
	src = replaceOnce(src,
		'var nx = M.nx, p, q, di, dj, jj, ii, ic, jc, px, pe, tot = 0, d, cw = M.cw, wsum, out;',
		`var nx = M.nx, p, q, di, dj, jj, ii, ic, jc, px, pe, tot = 0, d, cw = M.cw, wsum, out;
	var hp, tb, dc, ex, room, gf, b2, wq, amt, rmd, sg, bd, exP, exN, g0 = P.PH_GRID, f0 = S.ph;
	var qi, qj, bi, bj;
	heads.fill(-1);
	for (p = S.n - 1; p >= 0; p--) {
		if (!g0[f0[p]]) continue;
		withA[p] = 0;
		q = nodeOf(M, S, p);
		nextA[p] = heads[q]; heads[q] = p;
	}`);
	src = replaceOnce(src, 'S.H[p] += d;',
		`hp = S.H[p] + d;
		tb = PTPHASE.byH(hp, S.y[p], S.cF[p], S.cW[p]).t;
		if (tb > hi || tb < lo) {
			dc = PTPHASE.byT(tb > hi ? hi : lo, S.y[p], S.cF[p], S.cW[p]).h - S.H[p];
			ex = S.m[p] * (d - dc);
			q = nodeOf(M, S, p);
			if (ex > 0) excessP[q] += ex; else excessN[q] += ex;
			withA[p] = ex;
			d = dc; st.capped++;
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
			bd = sg > 0 ? hi : lo;
			room = 0;
			for (bj = qj - rad; bj <= qj + rad; bj++) {
				if (bj < 1 || bj > M.ny - 1) continue;
				for (bi = qi - rad; bi <= qi + rad; bi++) {
					for (p = heads[bj * M.nx + bi - Math.floor(bi / M.nx) * M.nx]; p >= 0; p = nextA[p]) {
						hp = S.H[p];
						dc = PTPHASE.byT(bd, S.y[p], S.cF[p], S.cW[p]).h;
						dc = sg > 0 ? dc - hp : hp - dc;
						roomA[p] = dc > 0 ? S.m[p] * dc : 0;
						room += roomA[p];
					}
				}
			}
			gf = room >= amt ? amt / room : 1;
			for (bj = qj - rad; bj <= qj + rad; bj++) {
				if (bj < 1 || bj > M.ny - 1) continue;
				for (bi = qi - rad; bi <= qi + rad; bi++) {
					for (p = heads[bj * M.nx + bi - Math.floor(bi / M.nx) * M.nx]; p >= 0; p = nextA[p]) {
						wq = roomA[p] * gf;
						if (wq !== 0) { S.H[p] += sg * wq / S.m[p]; tot += sg * wq; st.given++; }
					}
				}
			}
			if (room >= amt) continue;
			rmd = amt - room;
			for (p = b2; p >= 0; p = nextA[p]) {
				if (sg * withA[p] <= 0) continue;
				wq = rmd * (sg * withA[p]) / amt;
				S.H[p] += sg * wq / S.m[p]; tot += sg * wq; st.giveback++;
			}
			st.shortN++; st.shortH += rmd;
		}
	}
	S.hLedger += tot;`);
	G.gatherDT = new Function('P', 'PTPHASE', 'spl', 'hi', 'lo', 'heads', 'nextA', 'roomA',
		'withA', 'excessP', 'excessN', 'nodeOf', 'st', 'rad', 'return ' + src
	)(P, PHASE, spl, hi, lo, heads, nextA, roomA, withA, excessP, excessN, G.nodeOf, spSt, rad);
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
var events = [], frame = 0, sampleMs = 0, heldTime = 0, heldMeltTime = 0, heldSamples = 0;
var heldGap = -Infinity, mantleRoutes = 0, detach = MT.detach;
// Allocation here is observation only, subtracted from the step timer. State is read-only.
MT.detach = function (M, S) {
	var start = performance.now(), p, tg, ts;
	for (p = 0; p < S.n; p++) {
		if (S.melt[p] < P.meltHold) continue;
		if (S.ph[p] === P.PH.mantle) { mantleRoutes++; continue; }
		if (S.ph[p] !== P.PH.dep || !S.depQ[p] || S.y[p] <= P.depositCoolDepth) continue;
		tg = G.sampleAt(M, S.Tg, S.x[p], S.e[p]);
		ts = PHASE.solidus(S.y[p], S.cF[p], S.cW[p]);
		if (tg < ts) {
			heldSamples++; heldTime += S.m[p] * subDt;
			heldMeltTime += S.m[p] * S.melt[p] * subDt;
			heldGap = Math.max(heldGap, S.T[p] - tg);
			continue;
		}
		events.push({ frame: frame, id: S.id[p], x: S.x[p], y: S.y[p], host: S.m[p],
			melt: S.m[p] * S.melt[p], T: S.T[p], field: tg, solidus: ts });
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
var outFrames = 0, hot = { T: -Infinity, frame: 0, ph: -1, y: 0, m: 0, field: 0 };
var ms = 0, frames = Math.round(myr / SIM.dt);
var mins = [Infinity, Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity, -Infinity];
var outside = [0, 0, 0, 0], nonfinite = 0;
for (frame = 1; frame <= frames; frame++) {
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
	for (var p = 0; p < S.n; p++) {
		var ph = S.ph[p], T = S.T[p];
		if (!Number.isFinite(T)) { nonfinite++; continue; }
		mins[ph] = Math.min(mins[ph], T); maxs[ph] = Math.max(maxs[ph], T);
		if (T < -0.5 || T > 1.5) outside[ph]++;
		if (T > hot.T) { hot.T = T; hot.frame = frame; hot.ph = ph; hot.y = S.y[p]; hot.m = S.m[p]; hot.x = S.x[p]; }
	}
	if (outside[0] + outside[1] + outside[2] + outside[3] > outBefore) outFrames++;
	if (hot.frame === frame) hot.field = G.sampleAt(M, S.Tg, hot.x, Math.asinh(hot.y / M.yLin));
}
var result = { kind: kind, value: value, scope: kind === 'relaxw' || kind === 'subgrid' ? scope : null,
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
	heldSamples: heldSamples, heldMassTime: heldTime, heldMeltTime: heldMeltTime, heldGapMax: heldGap,
	mantleRoutes: mantleRoutes, depMelt: S.thr.depMelt, depTx: S.tx.depMelt, refuse: S.tx.refuse,
	merged: merged, strandedAttempts: stranded,
	spreadCapped: spSt.capped, spreadGiven: spSt.given, spreadGiveback: spSt.giveback,
	spreadShortN: spSt.shortN, spreadShortH: spSt.shortH,
	relaxSource: rlSt.R, relaxGross: rlSt.gross, relaxReaction: rlSt.react, relaxResidMax: rlSt.resid,
	relaxSourceOverWall: rlSt.R / (S.wall - w0), intakeWallOperatorWorst: wallOp,
	outsideFrames: outFrames, hottest: hot, events: events };
result.gates = { mass: mass < 1e-9, enthalpy: enth < 1e-9, latent: latent < 1e-10, latentBook: latentBook < 1e-10,
	intakeWallP4: wall < 0.01, intakeWallReference: wall < 5e-5,
	frame: result.msFrame < 20, temperature: nonfinite === 0 && outside.every(function (n) { return n === 0; }) };
console.log(JSON.stringify(result, null, '\t'));
if (process.argv.includes('--assert-baseline') && (kind !== 'baseline' || myr !== 600 || seed !== 5 || kyr !== 50
	|| result.fingerprint !== 8261233554728015 || result.depTx !== 3)) process.exitCode = 1;
if (process.argv.includes('--assert-m2') && (kind !== 'baseline' || myr !== 600 || seed !== 5 || kyr !== 50
	|| result.fingerprint !== 6191250240167390 || result.depTx !== 3)) process.exitCode = 1;
if (process.env.HEAT_TAIL_OUT) fs.writeFileSync(process.env.HEAT_TAIL_OUT, JSON.stringify(result, null, '\t') + '\n');
