// pt-p3-routing.js — 0.3.0 P3.0: phase routing (0.3.0-p3-plan.md §1.3, §4 P3.0).
//
// The plan's routing table is four columns wide and the engine reads it as three masks
// (params.js PH_GRID / PH_ADV / PH_SOLID). This harness measures the table rather than
// trusting it: for every phase it asks each pass whether it saw the parcel, prints the answer
// as a table, and gates the cells the plan calls non-negotiable —
//
//   * airborne material is in none of them: not in the deposit, not in the conduction
//     intake, not on the flow map, not in the repair's donor buckets, not in the crust pass
//     and not in the surface profile's crust terms;
//   * `G.reseed` repairs coverage only, and never borrows, compacts or moves airborne mass;
//   * mobile melt is grid-coupled but rides no flow map and holds no bond;
//   * a landed deposit is coupled, rides the flow, and is crust material once it is cold;
//   * with the extra phases present a live run still closes the P1 ledger inside its own
//     tolerance, and the pool has no source and no sink.
//
// Run: node experiments/pt-p3-routing.js
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), PTPOOL = require(B + 'pool.js');
var G = require(B + 'grid.js'), S = require(B + 'state.js');
var F = require(B + 'fluid.js'), SC = require(B + 'solid.js'), SIM = require(B + 'sim.js');

var t0 = Date.now();
var AB = new ArrayBuffer(8), F64 = new Float64Array(AB), U32 = new Uint32Array(AB);

function mix(h, v) {
	F64[0] = v;
	h = Math.imul(h ^ U32[0], 16777619);
	h = Math.imul(h ^ U32[1], 2246822507);
	return h >>> 0;
}
function fieldHash(a) {
	var h = 2166136261, i;
	for (i = 0; i < a.length; i++) h = mix(h, a[i]);
	return h;
}
// the fingerprint of the grid-coupled set alone: the same mantle with a fountain over it must
// hash to the same number, so the count that goes in is the coupled count, not S.n
function coupledHash(st) {
	var h = 2166136261, p, c = 0;
	for (p = 0; p < st.n; p++) {
		if (!P.PH_GRID[st.ph[p]]) continue;
		c++;
		h = mix(h, st.x[p]); h = mix(h, st.y[p]); h = mix(h, st.e[p]);
		h = mix(h, st.T[p]); h = mix(h, st.m[p]); h = mix(h, st.H[p]);
		h = mix(h, st.vx[p]); h = mix(h, st.vy[p]);
		h = mix(h, st.age[p]); h = mix(h, st.mu[p]); h = mix(h, st.dmg[p]);
		h = mix(h, st.id[p]);
	}
	return mix(h, c);
}
function col(name, idx) {
	var a = new Float64Array(idx.length), i;
	for (i = 0; i < idx.length; i++) a[i] = S[name][idx[i]];
	return a;
}
function differ(a, b) {
	var i;
	for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
	return false;
}
function worst(a, b) {
	var i, w = 0, d, s;
	for (i = 0; i < a.length; i++) {
		d = Math.abs(a[i] - b[i]); s = Math.max(Math.abs(a[i]), Math.abs(b[i]));
		if (s > 0 && d / s > w) w = d / s;
	}
	return w;
}

function configure(ic, frames) {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24;
	P.mpc = 4; P.resMelt = 0.05; P.resAir = 0.03; P.resDep = 0.12;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = ic || 'cool'; P.flip = 1; P.solid = true;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50; P.seed = 1;
	SIM.init(); SIM.reset();
	SIM.dt = P.sl.kyr / 1000;
	if (frames) SIM.run(frames);
	return SIM.M;
}

// a contiguous band of one node row: a sample no pass can miss by accident
function band(M, st, j, i0, i1) {
	var idx = [], p, jj, ii;
	for (p = 0; p < st.n; p++) {
		if (st.ph[p] !== P.PH.mantle) continue;
		jj = Math.round(st.e[p] / M.dEta);
		ii = Math.round(st.x[p] / M.dx) % M.nx;
		if (jj !== j || ii < i0 || ii > i1) continue;
		idx.push(p);
	}
	return idx;
}

// A fountain's worth of clasts, above the surface. `loud` carries sentinel mass, strength,
// damage, temperature and a fake cluster id, so a pass that should not see them cannot hide
// the leak behind a value that happens to be zero; the quiet version is what a live run gets
// (a marker's own mass, a cold clast, no bond state), so the ledger is not measured against
// a sentinel.
function injectAir(M, st, count, loud) {
	var idx = [], i, p, m = M.dEta * M.jN[1] * M.dx / P.mpc;
	for (i = 0; i < count; i++) {
		p = PTPOOL.admit(st, P.PH.air);
		st.x[p] = (i + 0.5) / count * M.wrap;
		st.y[p] = -1 - 3 * (i % 6);
		st.e[p] = Math.asinh(st.y[p] / M.yLin);
		st.m[p] = loud ? 1e6 : m;
		st.T[p] = loud ? 5 : 0.05; st.H[p] = st.T[p];
		st.vx[p] = loud ? 300 : 30; st.vy[p] = loud ? -300 : -30;
		st.age[p] = loud ? 900 : 0; st.mu[p] = loud ? 1 : 0;
		st.dmg[p] = loud ? 1 : 0; st.cl[p] = loud ? 0 : -1;
		st.cF[p] = loud ? 0.9 : 0.3; st.cW[p] = loud ? 0.5 : 0.01;
		st.melt[p] = loud ? 1 : 0;
		idx.push(p);
	}
	return idx;
}

// landed deposits, either standing above the surface (an edifice on the terrain horizon) or
// inside the mesh's own top row. Both are grid-coupled; only the second is repair material.
function injectDep(M, st, count, above) {
	var idx = [], i, p, j = 1, m = M.dEta * M.jN[j] * M.dx / P.mpc, ii;
	for (i = 0; i < count; i++) {
		p = PTPOOL.admit(st, P.PH.dep);
		st.x[p] = (i + 0.5) / count * M.wrap;
		st.e[p] = above ? -0.03 - 0.01 * (i % 3) : M.dEta * j;
		st.y[p] = M.yLin * Math.sinh(st.e[p]);
		st.m[p] = m;
		ii = Math.round(st.x[p] / M.dx) % M.nx;
		st.T[p] = st.Tg[j * M.nx + ii];
		st.H[p] = st.T[p];
		st.cF[p] = 0.3;
		idx.push(p);
	}
	return idx;
}

// ---------------------------------------------------------------- the measured table
// One run per row. Each cell asks the pass a question whose answer is a bitwise comparison:
// a loud value the field either shows or does not, a parcel state that either changed or did
// not. Nothing here is inferred from a constant.
function probeRow(name, ph, above) {
	var M = configure('cool', 50);
	var idx = band(M, S, 3, 40, 60), i, p, row = { name: name };
	var mass = M.dEta * M.jN[3] * M.dx / P.mpc;
	for (i = 0; i < idx.length; i++) {
		p = idx[i];
		S.ph[p] = ph;
		S.T[p] = 0.5; S.H[p] = 0.5; S.m[p] = mass;
		S.vx[p] = 123; S.vy[p] = -45;                     // a sentinel the flow would overwrite
		S.age[p] = 3 * P.tauWeld; S.dmg[p] = 0; S.mu[p] = 0;
		S.cF[p] = 0.4; S.cW[p] = 0.02; S.melt[p] = 0.1;
		if (above) { S.e[p] = -0.03; S.y[p] = M.yLin * Math.sinh(S.e[p]); }
	}
	// the deposit: a loud T the node field either shows or does not
	G.scatterT(M, S, S.Tg, S.mug);
	var tg = fieldHash(S.Tg);
	for (i = 0; i < idx.length; i++) S.T[idx[i]] = 1;
	G.scatterT(M, S, S.Tg, S.mug);
	row.scatter = fieldHash(S.Tg) !== tg;
	// the flow map: a sentinel velocity it either overwrites or leaves alone
	G.stokes(M, S.Tg, S.u, S.v, P.RaK);
	var vx = col('vx', idx), vy = col('vy', idx);
	G.gatherVel(M, S, M.pr);
	row.flow = differ(vx, col('vx', idx)) || differ(vy, col('vy', idx));
	// conduction: an increment that either reaches the parcel's enthalpy or does not
	G.diffuse(M, S.Tg, SIM.dt, P.kappa, M.inc);
	var h = col('H', idx);
	G.gatherDT(M, S, M.inc, S.Tg, P.flip);
	row.conduct = differ(h, col('H', idx));
	// the coverage repair, forced: the global re-deal is the most invasive thing it does. It
	// runs before advection on purpose -- advection is what would carry an above-surface
	// deposit back inside the mesh, and the repair's rule is about where the parcel stands.
	G.scatterT(M, S, S.Tg, S.mug);
	var x = col('x', idx), e = col('e', idx);
	G.reseed(M, S, true);
	row.repair = differ(x, col('x', idx)) || differ(e, col('e', idx));
	// geological advection, and what the top wall does to a parcel above the surface
	x = col('x', idx); e = col('e', idx);
	G.advect(M, S, SIM.dt);
	row.advect = differ(x, col('x', idx)) || differ(e, col('e', idx));
	row.reflected = above && row.advect && S.e[idx[0]] > 0;
	// the crust pass: a bond state and a cluster, or neither. The loud temperature the
	// deposit probe needed goes first -- at T = 1 nothing welds whatever its phase
	for (i = 0; i < idx.length; i++) {
		p = idx[i];
		S.T[p] = 0.05; S.H[p] = 0.05; S.age[p] = 3 * P.tauWeld; S.dmg[p] = 0;
	}
	SC.crust(M, S, SIM.dt);
	row.crust = false;
	for (i = 0; i < idx.length; i++) if (S.mu[idx[i]] > 0 || S.cl[idx[i]] >= 0) row.crust = true;
	row.mu = S.mu[idx[0]];
	row.cl = S.cl[idx[0]];
	return row;
}

// The surface profile's crust terms need their own control: `zh` relaxes on every call, so
// "did it change" is not the question. The question is whether a loud band of this phase
// moves the profile *more than the same band contributing nothing* — same run, same phase,
// one with mass and strength and a fake cluster id, one with none.
function surfaceProbe(ph, above, loud) {
	var M = configure('cool', 50);
	var idx = band(M, S, 3, 40, 60), i, p;
	for (i = 0; i < idx.length; i++) {
		p = idx[i];
		S.ph[p] = ph;
		if (above) { S.e[p] = -0.03; S.y[p] = M.yLin * Math.sinh(S.e[p]); }
	}
	SC.crust(M, S, SIM.dt);
	for (i = 0; i < idx.length; i++) {
		p = idx[i];
		S.mu[p] = loud ? 1 : 0; S.dmg[p] = loud ? 1 : 0;
		S.m[p] = loud ? 1e6 : 0; S.cl[p] = loud ? 0 : -1;
		S.vx[p] = loud ? 40 : 0;
	}
	F.surface(M, S, SIM.dt);
	return fieldHash(S.zh);
}

console.log('  routing: ' + P.mesh.nx + 'x' + P.mesh.ny + ' nodes, band of row 3, 50 Myr of spin-up\n');

var ROWS = [
	['mantle', P.PH.mantle, false],
	['melt', P.PH.melt, false],
	['airborne', P.PH.air, true],
	['deposit above', P.PH.dep, true],
	['deposit inside', P.PH.dep, false]
];
var table = [], r;
for (r = 0; r < ROWS.length; r++) {
	var row = probeRow(ROWS[r][0], ROWS[r][1], ROWS[r][2]);
	row.surface = surfaceProbe(ROWS[r][1], ROWS[r][2], true) !== surfaceProbe(ROWS[r][1], ROWS[r][2], false);
	table.push(row);
}

function cell(v) { return v ? 'yes' : 'no '; }
console.log('  the routing table as measured (0.3.0-p3-plan.md §1.3)');
console.log('  phase             deposit  conduct  flow map  advect  repair  crust  surface');
for (r = 0; r < table.length; r++) {
	console.log('  ' + table[r].name.padEnd(16) + '  ' + cell(table[r].scatter) + '      '
		+ cell(table[r].conduct) + '     ' + cell(table[r].flow) + '       ' + cell(table[r].advect)
		+ '     ' + cell(table[r].repair) + '    ' + cell(table[r].crust) + '    ' + cell(table[r].surface));
}
console.log('');

function rowOf(name) {
	var i2;
	for (i2 = 0; i2 < table.length; i2++) if (table[i2].name === name) return table[i2];
	return null;
}
var man = rowOf('mantle'), mlt = rowOf('melt'), air = rowOf('airborne');
var depA = rowOf('deposit above'), depI = rowOf('deposit inside');

check.section('A. the measured table is the plan\'s table');
if (depA.reflected) check.info('an above-surface deposit that rides the flow map is reflected at the top wall: '
	+ 'keepInside sends it back inside the mesh. Whether an edifice stands inside the fluid '
	+ 'domain\'s top wall or above it is P3.4\'s landing decision, not P3.0\'s.');
check.ok('mantle is in every pass', man.scatter && man.conduct && man.flow && man.advect
	&& man.repair && man.crust && man.surface, 'the reference row');
check.ok('airborne is in none of them', !air.scatter && !air.conduct && !air.flow && !air.advect
	&& !air.repair && !air.crust && !air.surface,
	'deposit ' + cell(air.scatter) + ' conduct ' + cell(air.conduct) + ' flow ' + cell(air.flow)
	+ ' advect ' + cell(air.advect) + ' repair ' + cell(air.repair) + ' crust ' + cell(air.crust)
	+ ' surface ' + cell(air.surface));
check.ok('mobile melt is grid-coupled and nothing else', mlt.scatter && mlt.conduct
	&& !mlt.flow && !mlt.advect && !mlt.crust && !mlt.surface,
	'mu ' + mlt.mu.toFixed(3) + '  cl ' + mlt.cl);
check.ok('a landed deposit is coupled, rides the flow and welds',
	depA.scatter && depA.conduct && depA.advect && depA.crust && depA.surface
	&& depI.scatter && depI.conduct && depI.advect && depI.crust && depI.surface,
	'above mu ' + depA.mu.toFixed(3) + ' cl ' + depA.cl + ', inside mu ' + depI.mu.toFixed(3) + ' cl ' + depI.cl);
check.ok('but a deposit standing above the surface is not repair material',
	!depA.repair && depI.repair, 'above ' + cell(depA.repair) + '  inside ' + cell(depI.repair));

// ---------------------------------------------------------------- B. the grid cannot see it
check.section('B. a fountain over the planet leaves the grid, the intake and the mantle alone');
function intakeRun(withAir) {
	var M = configure('cool', 20);
	var idx = withAir ? injectAir(M, S, 900, true) : null;
	var l0 = S.hLedger, s0 = idx ? col('H', idx) : null;
	G.scatterT(M, S, S.Tg, S.mug);
	var tg = fieldHash(S.Tg), cw = fieldHash(M.cw), empty = S.empty, coupled = coupledHash(S);
	G.diffuse(M, S.Tg, SIM.dt, P.kappa, M.inc);
	G.gatherDT(M, S, M.inc, S.Tg, P.flip);
	return { tg: tg, cw: cw, empty: empty, coupled: coupled, intake: S.hLedger - l0,
		air: idx ? col('H', idx) : null, air0: s0, idx: idx };
}
var refB = intakeRun(false), airB = intakeRun(true);
check.ok('the node field is the same field', airB.tg === refB.tg, 'hash ' + airB.tg + ' vs ' + refB.tg);
check.ok('the coverage weights are the same weights', airB.cw === refB.cw,
	'hash ' + airB.cw + ' vs ' + refB.cw);
check.ok('and the hole count is the same count', airB.empty === refB.empty, 'empty ' + airB.empty);
check.near('so the conduction intake is the same number', airB.intake, refB.intake, 0, 'km2*H');
check.ok('the coupled parcels ended in the same state', airB.coupled === refB.coupled,
	'hash ' + airB.coupled + ' vs ' + refB.coupled);
check.ok('and the clasts conducted nothing at all', !differ(airB.air0, airB.air),
	'worst ' + worst(airB.air0, airB.air).toExponential(2));

// ---------------------------------------------------------------- C. the flow map cannot see it
check.section('C. the geological clock does not move a clast in flight');
function advectRun(withAir) {
	var M = configure('cool', 20);
	var idx = withAir ? injectAir(M, S, 900, true) : null;
	var s0 = idx ? [col('x', idx), col('y', idx), col('e', idx), col('vx', idx), col('vy', idx)] : null;
	G.scatterT(M, S, S.Tg, S.mug);
	F.move(M, S, SIM.dt, P.kappa, P.flip);
	return { coupled: coupledHash(S), s0: s0,
		s1: idx ? [col('x', idx), col('y', idx), col('e', idx), col('vx', idx), col('vy', idx)] : null };
}
var refC = advectRun(false), airC = advectRun(true);
check.ok('the flow carried the same material to the same place', airC.coupled === refC.coupled,
	'hash ' + airC.coupled + ' vs ' + refC.coupled);
var moved = 0, k2;
for (k2 = 0; k2 < airC.s0.length; k2++) if (differ(airC.s0[k2], airC.s1[k2])) moved++;
check.ok('and left every clast exactly where it was', moved === 0,
	moved + ' of ' + airC.s0.length + ' quantities moved');

// ---------------------------------------------------------------- D. the crust cannot see it
check.section('D. the crust pass and the horizon do not count airborne material');
function crustRun(withAir) {
	var M = configure('cool', 600);
	var idx = withAir ? injectAir(M, S, 900, true) : null;
	SC.crust(M, S, SIM.dt);
	return { coupled: coupledHash(S), lid: S.d.lid, plates: S.d.plates, plV: S.d.plV,
		nSolid: S.nSolid, mu: idx ? col('mu', idx) : null, cl: idx ? col('cl', idx) : null,
		age: idx ? col('age', idx) : null };
}
var refD = crustRun(false), airD = crustRun(true);
check.near('the lid fraction is the same fraction', airD.lid, refD.lid, 0);
check.ok('because it is a fraction of the solid set, not of the pool',
	airD.nSolid === refD.nSolid && airD.nSolid === S.n - 900,
	'nSolid ' + airD.nSolid + ' vs ' + refD.nSolid + ', n ' + S.n);
check.ok('the plates and their drift are the same numbers',
	airD.plates === refD.plates && airD.plV === refD.plV,
	'plates ' + airD.plates + '/' + refD.plates + '  drift ' + airD.plV.toFixed(4) + '/' + refD.plV.toFixed(4));
check.ok('and the mantle ended in the same state', airD.coupled === refD.coupled,
	'hash ' + airD.coupled + ' vs ' + refD.coupled);
var loud = 0;
for (k2 = 0; k2 < airD.mu.length; k2++) {
	if (airD.mu[k2] !== 0 || airD.cl[k2] !== -1 || airD.age[k2] !== 0) loud++;
}
check.ok('a clast carries no bond state after the pass', loud === 0,
	loud + ' of ' + airD.mu.length + ' clasts kept a strength, an age or a cluster');

function surfaceRun(withAir) {
	var M = configure('cool', 200);
	var idx = withAir ? injectAir(M, S, 900, true) : null;
	SC.crust(M, S, SIM.dt);
	if (idx) for (k2 = 0; k2 < idx.length; k2++) {
		S.mu[idx[k2]] = 1; S.dmg[idx[k2]] = 1; S.cl[idx[k2]] = 0; S.m[idx[k2]] = 1e6;
	}
	F.surface(M, S, SIM.dt);
	return { zh: fieldHash(S.zh), zr: fieldHash(S.zRaw), hLid: fieldHash(S.hLid),
		rft: fieldHash(S.rft), colM: fieldHash(S.colM), sCl: fieldHash(S.surfaceCl) };
}
var refE = surfaceRun(false), airE = surfaceRun(true);
check.ok('the horizon is the same profile', airE.zh === refE.zh, 'hash ' + airE.zh + ' vs ' + refE.zh);
check.ok('and so are the crust terms that build it',
	airE.hLid === refE.hLid && airE.rft === refE.rft && airE.colM === refE.colM,
	'hLid ' + (airE.hLid === refE.hLid) + ' rft ' + (airE.rft === refE.rft) + ' colM ' + (airE.colM === refE.colM));
check.ok('including the collision sample', airE.sCl === refE.sCl && airE.zr === refE.zr,
	'surfaceCl ' + (airE.sCl === refE.sCl) + '  target ' + (airE.zr === refE.zr));

// ---------------------------------------------------------------- E. the repair
check.section('E. the coverage repair borrows from the mesh, never from the sky');
function repairRun(kind) {
	var M = configure('cool', 50);
	var air = kind === 'air' ? injectAir(M, S, 900, true) : null;
	var dep = kind === 'above' || kind === 'inside' ? injectDep(M, S, 400, kind === 'above') : null;
	var idx = air || dep, s0, s1, i3;
	G.scatterT(M, S, S.Tg, S.mug);
	s0 = [col('x', idx), col('e', idx), col('id', idx), col('m', idx)];
	G.reseed(M, S, true);
	s1 = [col('x', idx), col('e', idx), col('id', idx), col('m', idx)];
	var lattice = 0;
	for (i3 = 0; i3 < idx.length; i3++) {
		if (Math.abs(S.x[idx[i3]] / M.dx - Math.round(S.x[idx[i3]] / M.dx)) < 1e-12
			&& Math.abs(S.e[idx[i3]] / M.dEta - Math.round(S.e[idx[i3]] / M.dEta)) < 1e-12) lattice++;
	}
	return { moved: differ(s0[0], s1[0]) || differ(s0[1], s1[1]),
		same: !differ(s0[0], s1[0]) && !differ(s0[1], s1[1]) && !differ(s0[2], s1[2]) && !differ(s0[3], s1[3]),
		lattice: lattice, n: idx.length, redeals: S.redeals, slots: idx[0] };
}
var rpAir = repairRun('air'), rpAbove = repairRun('above'), rpInside = repairRun('inside');
check.ok('a forced re-deal left every clast bitwise alone', rpAir.same && !rpAir.moved,
	rpAir.n + ' clasts, slot ' + rpAir.slots + ' still theirs, redeals ' + rpAir.redeals);
check.ok('and every deposit standing above the surface', rpAbove.same && !rpAbove.moved,
	rpAbove.n + ' deposits, redeals ' + rpAbove.redeals);
check.ok('while a deposit inside the mesh is repair material like any marker',
	rpInside.moved && rpInside.lattice === rpInside.n,
	rpInside.lattice + ' of ' + rpInside.n + ' on lattice nodes');

// ---------------------------------------------------------------- F. melt routing, end to end
check.section('F. mobile melt conducts, holds no bond and rides no flow map');
var M2 = configure('cool', 50);
var mIdx = band(M2, S, 3, 40, 60), i4, p4;
for (i4 = 0; i4 < mIdx.length; i4++) {
	p4 = mIdx[i4];
	S.ph[p4] = P.PH.melt;
	S.T[p4] = 0.05; S.H[p4] = 0.05;                 // cold and old: without the mask it welds
	S.age[p4] = 5 * P.tauWeld; S.dmg[p4] = 0;
}
G.scatterT(M2, S, S.Tg, S.mug);
var hB = col('H', mIdx), xB = col('x', mIdx), eB = col('e', mIdx);
F.move(M2, S, SIM.dt, P.kappa, P.flip);
check.ok('the conduction increment reaches a melt parcel\'s enthalpy', differ(hB, col('H', mIdx)),
	'worst ' + worst(hB, col('H', mIdx)).toExponential(2));
check.ok('and the flow map leaves it where it was',
	!differ(xB, col('x', mIdx)) && !differ(eB, col('e', mIdx)),
	'worst x ' + worst(xB, col('x', mIdx)).toExponential(2));
SC.crust(M2, S, SIM.dt);
var bonded = 0;
for (i4 = 0; i4 < mIdx.length; i4++) if (S.mu[mIdx[i4]] > 0 || S.cl[mIdx[i4]] >= 0) bonded++;
check.ok('a cold old melt parcel still holds no bond and joins no cluster', bonded === 0,
	bonded + ' of ' + mIdx.length + ' bonded');

// ---------------------------------------------------------------- G. a deposit welds
check.section('G. a cold landed deposit is crust');
var M3 = configure('cool', 600);
var dIdx = [], j3 = 1, i5;
for (i5 = 0; i5 < S.n && dIdx.length < 200; i5++) {
	if (S.ph[i5] !== P.PH.mantle) continue;
	if (Math.round(S.e[i5] / M3.dEta) !== j3) continue;
	if (Math.round(S.x[i5] / M3.dx) % M3.nx > 24) continue;
	dIdx.push(i5);
}
for (i5 = 0; i5 < dIdx.length; i5++) {
	S.ph[dIdx[i5]] = P.PH.dep;
	S.T[dIdx[i5]] = 0.05; S.H[dIdx[i5]] = 0.05;
	S.age[dIdx[i5]] = 3 * P.tauWeld;                  // P3.4 lands a clast at age zero; this is
	                                                  // the eligibility rule, not the landing
	S.cF[dIdx[i5]] = 0.35;
}
var lidBefore = S.d.lid;
SC.crust(M3, S, SIM.dt);
var welded = 0, strong = 0;
for (i5 = 0; i5 < dIdx.length; i5++) {
	if (S.cl[dIdx[i5]] >= 0) welded++;
	if (S.mu[dIdx[i5]] >= P.clusterMin) strong++;
}
check.ok('the deposit patch is strong enough to be plate', strong === dIdx.length,
	strong + ' of ' + dIdx.length + ' at mu >= ' + P.clusterMin);
check.ok('and it joined the crust\'s clusters', welded === dIdx.length,
	welded + ' of ' + dIdx.length + ' with a cluster id, lid ' + (100 * lidBefore).toFixed(3)
	+ '% -> ' + (100 * S.d.lid).toFixed(3) + '%');
check.ok('the crust diagnostic counted it', S.nSolid === S.n, 'nSolid ' + S.nSolid + ' of ' + S.n);

// ---------------------------------------------------------------- H. the live ledgers
check.section('H. a live run with the phases present closes both ledgers');
var M4 = configure('cool', 0);
var airH = injectAir(M4, S, 800, false), depH = injectDep(M4, S, 600, true);
PTPOOL.inventoryComp(S);
var m0 = S.invMTot, h0 = S.invHTot, f0 = S.invFTot;
var airPos = [col('x', airH), col('y', airH), col('e', airH), col('m', airH), col('H', airH)];
var frames = 400, worstEmpty = 0, nan = 0, i6, p6;
for (i6 = 0; i6 < frames; i6++) {
	SIM.step();
	if (S.empty > worstEmpty) worstEmpty = S.empty;
}
for (p6 = 0; p6 < S.n; p6++) if (!isFinite(S.T[p6]) || !isFinite(S.x[p6]) || !isFinite(S.H[p6])) nan++;
PTPOOL.inventoryComp(S);
var intake = S.hLedger, wall = S.wall, gap = intake / wall;
check.ok('no NaN in ' + frames + ' frames with a fountain and an edifice in the pool', nan === 0,
	nan + ' of ' + S.n);
check.near('the pool has no source and no sink: the mass is the mass', S.invMTot, m0, 1e-12, 'km2');
check.near('and the composition is the composition', S.invFTot, f0, 1e-12, 'km2');
check.near('the enthalpy changed by exactly the recorded wall flux', S.invHTot - h0, intake, 1e-9, 'km2*H');
check.ok('which closes against the operator\'s own wall book inside the P1 tolerance',
	gap > 0.8 && gap < 1.2, 'intake/wall ' + gap.toFixed(4) + '  (' + intake.toExponential(3)
	+ ' vs ' + wall.toExponential(3) + ')');
check.ok('and the enthalpy ledger is still the heat ledger bitwise', S.hLedger === S.ledger,
	S.hLedger + ' vs ' + S.ledger);
check.ok('coverage stayed inside the P1 tolerance', worstEmpty < 0.15 * M4.nx * (M4.ny - 1),
	'worst ' + worstEmpty + ' of ' + M4.nx * (M4.ny - 1) + ' nodes');
var stayed = 0;
for (i6 = 0; i6 < airPos.length; i6++) {
	var now = col(['x', 'y', 'e', 'm', 'H'][i6], airH);
	if (!differ(airPos[i6], now)) stayed++;
}
check.ok('the clasts are still exactly where the fountain put them', stayed === airPos.length,
	stayed + ' of ' + airPos.length + ' quantities unchanged over ' + frames + ' frames');
check.ok('the phases are still the phases', S.invN[P.PH.air] === 800 && S.invN[P.PH.dep] === 600
	&& S.invN[P.PH.mantle] === P.partBase && S.invN[P.PH.melt] === 0,
	S.invN.join('/'));

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
