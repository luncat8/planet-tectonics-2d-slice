// 0.3.2 candidate measurement, not a shipping switch. Each cell runs in a fresh process.
// node experiments/pt-heat-tail.js [baseline|cap|floor|relax|minimum] [value] [Myr=600]
// Rejected candidates are reports, not a nonzero exit; --assert-baseline gates the bank.
'use strict';
var fs = require('fs'), path = require('path'), performance = require('perf_hooks').performance;
var B = path.join(__dirname, '../js/pt/');
var P = require(B + 'params.js'), S = require(B + 'state.js'), G = require(B + 'grid.js');
var SIM = require(B + 'sim.js'), POOL = require(B + 'pool.js'), PHASE = require(B + 'phase.js');
var MT = require(B + 'melt.js'), F = require(B + 'fluid.js');
var kind = process.argv[2] || 'baseline';
var defaults = { baseline: 0, cap: 2, floor: 0.01, relax: 0.999, minimum: 1 };
var value = process.argv[3] === undefined ? defaults[kind] : +process.argv[3];
var myr = process.argv[4] === undefined ? 600 : +process.argv[4];
if (!(kind in defaults) || !Number.isFinite(value) || !(myr > 0) || !Number.isFinite(myr)
	|| (kind === 'cap' && value < 1) || (kind === 'floor' && !(value > 0 && value <= 1))
	|| (kind === 'relax' && !(value >= 0 && value < 1)) || (kind === 'minimum' && value <= 0)) {
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
P.sl.kyr = 50; P.seed = 5;
P.contact = true; P.slab = true; P.arc = true; P.ero = true;
SIM.init(); SIM.reset(); SIM.dt = 0.05;
var M = SIM.M;
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
			heldSamples++; heldTime += S.m[p] * SIM.dt;
			heldMeltTime += S.m[p] * S.melt[p] * SIM.dt;
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
var mass = 0, enth = 0, wall = 0, latent = 0, latentFrame = 0, latentAbs = 0;
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
	var la = Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0));
	var lr = la / Math.max(1, Math.abs(S.hLedger - S.ledger));
	if (lr > latent) { latent = lr; latentFrame = frame; latentAbs = la; }
	for (var p = 0; p < S.n; p++) {
		var ph = S.ph[p], T = S.T[p];
		if (!Number.isFinite(T)) { nonfinite++; continue; }
		mins[ph] = Math.min(mins[ph], T); maxs[ph] = Math.max(maxs[ph], T);
		if (T < -0.5 || T > 1.5) outside[ph]++;
	}
}
var result = { kind: kind, value: value, seed: 5, kyr: 50, myr: myr, frames: frames,
	fingerprint: S.hash(), mass: mass, enthalpy: enth, latent: latent,
	latentWorstFrame: latentFrame, latentWorstAbs: latentAbs,
	latentEnd: Math.abs(S.hLedger - S.ledger - P.meltLat * (S.invLTot - S.invL0))
		/ Math.max(1, Math.abs(S.hLedger - S.ledger)),
	depositBook: S.invM[P.PH.dep] - (S.thr.landCr + S.thr.eroCr - S.thr.eroDep - S.thr.deepDep - S.thr.depMelt),
	meltBook: S.thr.seg + S.thr.whole + S.thr.depMelt - S.thr.freeze - S.thr.intrDr - S.invM[P.PH.melt],
	intakeWallWorst: wall,
	intakeWallEnd: Math.abs((S.hLedger - hl0) / (S.wall - w0) - 1),
	msFrame: (ms - sampleMs) / frames, minT: mins, maxT: maxs, outsideSamples: outside, nonfinite: nonfinite,
	heldSamples: heldSamples, heldMassTime: heldTime, heldMeltTime: heldMeltTime, heldGapMax: heldGap,
	mantleRoutes: mantleRoutes, depMelt: S.thr.depMelt, depTx: S.tx.depMelt, refuse: S.tx.refuse,
	merged: merged, strandedAttempts: stranded, events: events };
result.gates = { mass: mass < 1e-9, enthalpy: enth < 1e-9, latent: latent < 1e-10,
	intakeWallP4: wall < 0.01, intakeWallReference: wall < 5e-5,
	frame: result.msFrame < 20, temperature: nonfinite === 0 && outside.every(function (n) { return n === 0; }) };
console.log(JSON.stringify(result, null, '\t'));
if (process.argv.includes('--assert-baseline') && (kind !== 'baseline' || myr !== 600
	|| result.fingerprint !== 8261233554728015 || result.depTx !== 3)) process.exitCode = 1;
if (process.env.HEAT_TAIL_OUT) fs.writeFileSync(process.env.HEAT_TAIL_OUT, JSON.stringify(result, null, '\t') + '\n');
