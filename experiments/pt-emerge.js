// pt-emerge.js — 0.3.0 P0: the claim the whole engine rests on.
//
// In the column engine a plate is a data structure (`plN`, `plU`) and a contact is a rule
// table. Here a plate has to EMERGE from particles whose only glue is a bond strength that
// depends on temperature and age:
//
//     mu(T, a) = (0.05 + 0.95 (1 - heat(T))) * weld(a),   weld(a) = 1 - exp(-a / tauWeld)
//     bond     = min(mu_i, mu_j) * weld(bond age);        strain -> damage -> break
//
// Hot or young rock is soft: its bonds yield, its rest shape follows it, and it flows.
// Cold, old rock is strong: its bonds hold, its rest shape is frozen, and it moves as one
// body. This script measures the four consequences the plan gates on:
//
//   1. rigidity  — a cold body's internal strain is far below a hot one's under the same
//                  flow, and it travels at the flow's mass-weighted mean under it (the old
//                  engine's R7 "the drive survives plate averaging", emergent here);
//   2. welding   — halves separated by a young seam part while it is hot; once the seam
//                  cools and ages they become ONE cluster and the same flow cannot pull
//                  them apart;
//   3. rifting   — a hot band under a cold lid drops below the cluster threshold and the
//                  lid splits into two plates;
//   4. slab pull — MEASURED, NOT GATED: a cold slab hanging off a plate is reported here
//                  for the record, but a rigid-cluster idealisation without a mantle to
//                  support the plate does not turn hanging weight into plate motion. The
//                  plan carries this as a P1 measurement in the engine, where the fluid
//                  supplies the support and the drag.
//
// Two failure modes were measured here and are folded into the plan as rules:
//   * rest offsets must be measured from the rest centroid of the particle's OWN cluster;
//     referencing particle 0 (or the parent body) puts the shape-matching goal a whole
//     body-length away and the projection explodes;
//   * bonds must be elastic below their own strength. Accumulating damage from any strain
//     at all makes every loaded bond creep apart, and plates disintegrate.
//
// Run: node experiments/pt-emerge.js
'use strict';

var TAU_WELD = 40;          // time units to weld a seam
var T_LO = 0.35, T_HI = 0.85;
var CLUSTER_MIN = 0.25;     // a bond softer than this does not hold a plate together
var ALPHA = 0.6;            // shape-matching rate of a fully strong particle
var EPS0 = 0.05;            // strain a fully strong bond holds elastically
var K_DAMAGE = 8.0;         // damage per unit strain above yield, per unit time
var PLASTIC = 1.5;          // rest-length relaxation per unit strain above yield
var DRAG = 0.06;

function smoothstep(a, b, x) {
	var t = (x - a) / (b - a);
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	return t * t * (3 - 2 * t);
}

function Body(nx, ny, h, x0, y0, T, age) {
	var n = nx * ny, i, j, c, d, k;
	var cap = n + 64;
	var b = {
		nx: nx, ny: ny, h: h,
		x: new Float64Array(cap), y: new Float64Array(cap),
		px: new Float64Array(cap), py: new Float64Array(cap),
		vx: new Float64Array(cap), vy: new Float64Array(cap),
		m: new Float64Array(cap), T: new Float64Array(cap), age: new Float64Array(cap),
		lx: new Float64Array(cap), ly: new Float64Array(cap),   // rest offset, cluster frame
		par: new Int32Array(cap), root: new Int32Array(cap), cl: new Int32Array(cap),
		mu: new Float64Array(cap), cmap: new Int32Array(cap),
		ccx: new Float64Array(cap), ccy: new Float64Array(cap), ccm: new Float64Array(cap),
		nb: new Int32Array(cap), bi: new Int32Array(cap * 8), rev: new Int32Array(cap * 8),
		bl: new Float64Array(cap * 8), ba: new Float64Array(cap * 8), bd: new Float64Array(cap * 8),
		n: n, cap: cap, nCl: 0
	};
	var off = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
	for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
		c = j * nx + i;
		b.x[c] = x0 + i * h; b.y[c] = y0 + j * h; b.px[c] = b.x[c]; b.py[c] = b.y[c];
		b.m[c] = h * h; b.T[c] = T; b.age[c] = age;
	}
	for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
		c = j * nx + i;
		var nb = 0;
		for (k = 0; k < off.length; k++) {
			var ii = i + off[k][0], jj = j + off[k][1];
			if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
			d = jj * nx + ii;
			b.bi[c * 8 + nb] = d;
			b.bl[c * 8 + nb] = h * ((ii !== i && jj !== j) ? Math.SQRT2 : 1);
			b.ba[c * 8 + nb] = age;
			b.bd[c * 8 + nb] = 0;
			b.rev[c * 8 + nb] = -1;      // filled by the mirrored pass below
			nb++;
		}
		b.nb[c] = nb;
	}
	for (c = 0; c < n; c++) for (k = 0; k < b.nb[c]; k++) {
		d = b.bi[c * 8 + k];
		for (var m = 0; m < b.nb[d]; m++) if (b.bi[d * 8 + m] === c) { b.rev[c * 8 + k] = d * 8 + m; break; }
	}
	restFrame(b);
	return b;
}

// rest offsets in the cluster's own frame, measured from the mass centroid of the rest
// configuration. Getting this frame wrong is a classic shape-matching bug: the goal then
// sits a whole body-length away and the projection explodes.
function restFrame(b) {
	var i, cx = 0, cy = 0, mt = 0;
	for (i = 0; i < b.n; i++) { cx += b.x[i] * b.m[i]; cy += b.y[i] * b.m[i]; mt += b.m[i]; }
	cx /= mt; cy /= mt;
	for (i = 0; i < b.n; i++) { b.lx[i] = b.x[i] - cx; b.ly[i] = b.y[i] - cy; }
	b.restx = cx; b.resty = cy;
}

function add(b, x, y, T, age) {
	var i = b.n, k;
	if (i >= b.cap) {
		var cap = b.cap * 2, grow = function (a) { return a.length >= cap * 8 ? a : null; };
		var n8 = cap * 8;
		var x2 = new Float64Array(cap); x2.set(b.x); b.x = x2;
		var y2 = new Float64Array(cap); y2.set(b.y); b.y = y2;
		var px2 = new Float64Array(cap); px2.set(b.px); b.px = px2;
		var py2 = new Float64Array(cap); py2.set(b.py); b.py = py2;
		var vx2 = new Float64Array(cap); vx2.set(b.vx); b.vx = vx2;
		var vy2 = new Float64Array(cap); vy2.set(b.vy); b.vy = vy2;
		var m2 = new Float64Array(cap); m2.set(b.m); b.m = m2;
		var T2 = new Float64Array(cap); T2.set(b.T); b.T = T2;
		var a2 = new Float64Array(cap); a2.set(b.age); b.age = a2;
		var lx2 = new Float64Array(cap); lx2.set(b.lx); b.lx = lx2;
		var ly2 = new Float64Array(cap); ly2.set(b.ly); b.ly = ly2;
		var c2 = new Float64Array(cap); c2.set(b.cl); b.cl = c2;
		var p2 = new Int32Array(cap); p2.set(b.par); b.par = p2;
		var r2 = new Int32Array(cap); r2.set(b.root); b.root = r2;
		var nb2 = new Int32Array(cap); nb2.set(b.nb); b.nb = nb2;
		var bi2 = new Int32Array(n8); bi2.set(b.bi); b.bi = bi2;
		var rv2 = new Int32Array(n8); rv2.set(b.rev); b.rev = rv2;
		var mu2 = new Float64Array(cap); mu2.set(b.mu); b.mu = mu2;
		var cm2 = new Int32Array(cap); cm2.set(b.cmap); b.cmap = cm2;
		var bl2 = new Float64Array(n8); bl2.set(b.bl); b.bl = bl2;
		var ba2 = new Float64Array(n8); ba2.set(b.ba); b.ba = ba2;
		var bd2 = new Float64Array(n8); bd2.set(b.bd); b.bd = bd2;
		b.cap = cap;
	}
	b.n = i + 1;
	b.x[i] = x; b.y[i] = y; b.px[i] = x; b.py[i] = y;
	b.vx[i] = 0; b.vy[i] = 0; b.m[i] = b.h * b.h;
	b.T[i] = T; b.age[i] = age; b.nb[i] = 0;
	if (b.restx === undefined) { b.restx = 0; b.resty = 0; }
	b.lx[i] = x - b.restx; b.ly[i] = y - b.resty;
	return i;
}

function link(b, a, c, rest, age) {
	var sa = a * 8 + b.nb[a], sc = c * 8 + b.nb[c];
	b.bi[sa] = c; b.bl[sa] = rest; b.ba[sa] = age; b.bd[sa] = 0; b.rev[sa] = sc; b.nb[a]++;
	b.bi[sc] = a; b.bl[sc] = rest; b.ba[sc] = age; b.bd[sc] = 0; b.rev[sc] = sa; b.nb[c]++;
}

function strength(b, i) {
	var heat = smoothstep(T_LO, T_HI, b.T[i]);
	var weld = 1 - Math.exp(-b.age[i] / TAU_WELD);
	var mu = (0.05 + 0.95 * (1 - heat)) * weld;
	return mu < 0 ? 0 : mu;
}

function bondStrength(b, slot) {
	var d = b.bi[slot];
	if (d < 0 || d >= b.n) return 0;
	var mu = b.mu[(slot / 8) | 0], md = b.mu[d];
	if (md < mu) mu = md;
	return mu * (1 - Math.exp(-b.ba[slot] / TAU_WELD));
}

function find(b, i) {
	var r = i, p;
	while (b.par[r] !== r) r = b.par[r];
	while (b.par[i] !== r) { p = b.par[i]; b.par[i] = r; i = p; }
	return r;
}

// one step: predict (drag + buoyancy), bonds with damage, clusters, shape matching, and a
// PBD velocity update so the projections do not add energy
function step(b, dt, flow, grav) {
	var i, k, d, slot, dx, dy, dist, err, strain, corr, sb, c, nCl, r;

	for (i = 0; i < b.n; i++) {
		b.px[i] = b.x[i]; b.py[i] = b.y[i];
		b.vx[i] += ((flow.u(b.x[i], b.y[i]) - b.vx[i]) * DRAG) * dt;
		b.vy[i] += ((flow.v(b.x[i], b.y[i]) - b.vy[i]) * DRAG + grav * (b.T[i] - 0.5)) * dt;
		b.x[i] += b.vx[i] * dt; b.y[i] += b.vy[i] * dt;
		b.age[i] += dt;
		for (k = 0; k < b.nb[i]; k++) b.ba[i * 8 + k] += dt;
	}

	// one strength per particle per step, one visit per bond. Recomputing the weld
	// exponential per bond instead costs an order of magnitude in this pass.
	for (i = 0; i < b.n; i++) b.mu[i] = strength(b, i);
	var rv, dmg;
	for (var it = 0; it < 2; it++) {
		for (i = 0; i < b.n; i++) for (k = 0; k < b.nb[i]; k++) {
			slot = i * 8 + k;
			d = b.bi[slot];
			if (d <= i || d >= b.n) continue;          // each bond once per iteration
			if (b.bd[slot] >= 1) continue;
			var mi = b.mu[i], md2 = b.mu[d];
			sb = (md2 < mi ? md2 : mi) * (1 - Math.exp(-b.ba[slot] / TAU_WELD));
			dx = b.x[d] - b.x[i]; dy = b.y[d] - b.y[i];
			dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < 1e-9) continue;
			err = dist - b.bl[slot];
			strain = Math.abs(err) / b.bl[slot];
			corr = 0.5 * err / dist * sb;
			b.x[i] += corr * dx; b.y[i] += corr * dy;
			b.x[d] -= corr * dx; b.y[d] -= corr * dy;
			// Elastic below the bond's own strength, yielding above it. A bond that
			// accumulated damage from any strain at all creeps apart under a static load
			// and every plate disintegrates; this was measured, not guessed.
			var over = strain - EPS0 * sb;
			if (over > 0) {
				dmg = b.bd[slot] + K_DAMAGE * over * dt;
				if (dmg > 1) dmg = 1;
				rv = b.rev[slot];
				b.bd[slot] = dmg; b.bd[rv] = dmg;
				var sc = 1 + (err > 0 ? 1 : -1) * PLASTIC * over * dt;   // plastic flow
				b.bl[slot] *= sc; b.bl[rv] *= sc;
			}
			if (strain > 0.5) { b.bd[slot] = 1; b.bd[b.rev[slot]] = 1; }
		}
	}

	for (i = 0; i < b.n; i++) b.par[i] = i;
	for (i = 0; i < b.n; i++) for (k = 0; k < b.nb[i]; k++) {
		slot = i * 8 + k;
		d = b.bi[slot];
		if (d <= i || d >= b.n || b.bd[slot] >= 1 || bondStrength(b, slot) < CLUSTER_MIN) continue;
		var ra = find(b, i), rb = find(b, d);
		if (ra !== rb) b.par[rb] = ra;
	}
	nCl = 0;
	for (i = 0; i < b.n; i++) b.cmap[i] = -1;
	for (i = 0; i < b.n; i++) {
		r = find(b, i);
		c = b.cmap[r];
		if (c < 0) { c = nCl++; b.root[c] = r; b.cmap[r] = c; }
		b.cl[i] = c;
	}
	for (c = 0; c < nCl; c++) { b.ccx[c] = 0; b.ccy[c] = 0; b.ccm[c] = 0; }
	for (i = 0; i < b.n; i++) {
		c = b.cl[i];
		b.ccm[c] += b.m[i];
		b.ccx[c] += b.x[i] * b.m[i];
		b.ccy[c] += b.y[i] * b.m[i];
	}
	for (c = 0; c < nCl; c++) if (b.ccm[c] > 0) { b.ccx[c] /= b.ccm[c]; b.ccy[c] /= b.ccm[c]; }

	for (c = 0; c < nCl; c++) {
		var cr = 0, ci = 0, qbx = 0, qby = 0;
		for (i = 0; i < b.n; i++) if (b.cl[i] === c) {
			// the fit uses the stored rest offsets as they are; the goal needs them about
			// the cluster's OWN rest centroid, which is not zero once a cluster has split
			// off from the body it was formed in
			qbx += b.lx[i] * b.m[i]; qby += b.ly[i] * b.m[i];
		}
		if (b.ccm[c] > 0) { qbx /= b.ccm[c]; qby /= b.ccm[c]; }
		for (i = 0; i < b.n; i++) if (b.cl[i] === c) {
			cr += b.m[i] * ((b.x[i] - b.ccx[c]) * b.lx[i] + (b.y[i] - b.ccy[c]) * b.ly[i]);
			ci += b.m[i] * ((b.x[i] - b.ccx[c]) * b.ly[i] - (b.y[i] - b.ccy[c]) * b.lx[i]);
		}
		var th = Math.atan2(ci, cr), ct = Math.cos(th), st = Math.sin(th);
		for (i = 0; i < b.n; i++) if (b.cl[i] === c) {
			var mu = strength(b, i);
			var qx = b.lx[i] - qbx, qy = b.ly[i] - qby;
			var gx = b.ccx[c] + ct * qx - st * qy;
			var gy = b.ccy[c] + st * qx + ct * qy;
			b.x[i] += ALPHA * mu * (gx - b.x[i]);
			b.y[i] += ALPHA * mu * (gy - b.y[i]);
			var rx = b.x[i] - b.ccx[c], ry = b.y[i] - b.ccy[c];
			var rate = PLASTIC * (1 - mu) * dt;
			b.lx[i] += rate * ((ct * rx + st * ry) - b.lx[i]);
			b.ly[i] += rate * ((-st * rx + ct * ry) - b.ly[i]);
		}
	}
	for (i = 0; i < b.n; i++) {
		b.vx[i] = (b.x[i] - b.px[i]) / dt;
		b.vy[i] = (b.y[i] - b.py[i]) / dt;
	}
	b.nCl = nCl;
	return nCl;
}

// internal strain: RMS deviation from the best-fit rigid transform of the initial shape
function internalStrain(b, x0, y0) {
	var i, mt = 0, mx = 0, my = 0, c0x = 0, c0y = 0, cr = 0, ci = 0, e2 = 0, sc = 0;
	for (i = 0; i < b.n; i++) {
		mt += b.m[i]; mx += b.x[i] * b.m[i]; my += b.y[i] * b.m[i];
		c0x += x0[i] * b.m[i]; c0y += y0[i] * b.m[i];
	}
	mx /= mt; my /= mt; c0x /= mt; c0y /= mt;
	for (i = 0; i < b.n; i++) {
		var ax = x0[i] - c0x, ay = y0[i] - c0y;
		cr += (b.x[i] - mx) * ax + (b.y[i] - my) * ay;
		ci += (b.x[i] - mx) * ay - (b.y[i] - my) * ax;
	}
	var th = Math.atan2(ci, cr), ct = Math.cos(th), st = Math.sin(th);
	for (i = 0; i < b.n; i++) {
		var rx = x0[i] - c0x, ry = y0[i] - c0y;
		var gx = mx + ct * rx - st * ry, gy = my + st * rx + ct * ry;
		e2 += (b.x[i] - gx) * (b.x[i] - gx) + (b.y[i] - gy) * (b.y[i] - gy);
		sc += rx * rx + ry * ry;
	}
	return Math.sqrt(e2 / b.n) / Math.sqrt(sc / b.n);
}

var chk = { fails: 0, total: 0 };
function ok(name, cond, info) {
	chk.total++;
	if (!cond) chk.fails++;
	console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '   ' + info));
}

console.log('\n0.3.0 P0 — plates emerge from bonded particles whose strength is f(T, age)\n');

var H = 25e3;

// ---- 1. rigidity vs temperature and age -----------------------------------------------
function shearFlow(ny) {
	return {
		u: function (x, y) { return 60 * Math.sin(Math.PI * y / (ny * H)); },
		v: function () { return 0; }
	};
}

function rigidity(T, age, steps) {
	var nx = 20, ny = 4;
	var b = Body(nx, ny, H, 0, 0, T, age);
	var flow = shearFlow(ny);
	var x0 = Float64Array.from(b.x), y0 = Float64Array.from(b.y);
	var n = 0;
	for (n = 0; n < steps; n++) step(b, 1, flow, 0);
	var vx = 0, mt = 0, want = 0, w = 0, i;
	for (i = 0; i < b.n; i++) { vx += b.vx[i] * b.m[i]; mt += b.m[i]; want += flow.u(x0[i], y0[i]) * b.m[i]; w += b.m[i]; }
	return { strain: internalStrain(b, x0, y0), nCl: b.nCl, vx: vx / mt, mean: want / w };
}

var cold = rigidity(0.12, 400, 400);
var hot = rigidity(0.95, 400, 400);
var young = rigidity(0.12, 0.5, 400);
console.log('  rigidity — a 20x4 lattice in a shear flow, 400 steps');
console.log('    cold, old:   strain ' + cold.strain.toExponential(2) + '   clusters ' + cold.nCl
	+ '   plate v ' + cold.vx.toFixed(2) + '  vs flow mean ' + cold.mean.toFixed(2));
console.log('    hot:         strain ' + hot.strain.toExponential(2) + '   clusters ' + hot.nCl);
console.log('    young:       strain ' + young.strain.toExponential(2) + '   clusters ' + young.nCl);
ok('cold old rock is rigid (internal strain < 2% of the body)', cold.strain < 0.02,
	'strain ' + cold.strain.toExponential(2));
ok('a rigid body travels at the mean of the flow under it (R7)', Math.abs(cold.vx - cold.mean) / cold.mean < 0.15,
	'v ' + cold.vx.toFixed(2) + ' vs mean ' + cold.mean.toFixed(2));
ok('hot rock flows where cold rock does not', hot.strain > 5 * cold.strain,
	'hot ' + hot.strain.toExponential(2) + ' vs cold ' + cold.strain.toExponential(2));
ok('young rock flows where old rock does not', young.strain > 5 * cold.strain,
	'young ' + young.strain.toExponential(2) + ' vs old ' + cold.strain.toExponential(2));

// ---- 2. welding ------------------------------------------------------------------------
// Two halves sit either side of a seam. The flow pulls them apart. While the seam is young
// it yields and the halves separate; when the seam cools and ages it welds, and the same
// flow can no longer separate them. This is the "smooth connections whose strength grows
// with age and falls with temperature" of the request, measured.
function welding(heal, steps) {
	var nx = 21, ny = 5, i, j, c, k, d;
	var b = Body(nx, ny, H, 0, 0, 0.12, 400);
	var mid = nx >> 1;
	for (j = 0; j < ny; j++) { b.age[j * nx + mid] = 0; b.T[j * nx + mid] = 0.95; }
	for (i = 0; i < b.n; i++) for (k = 0; k < b.nb[i]; k++) {
		d = b.bi[i * 8 + k];
		if (d >= b.n) continue;
		if (i % nx === mid || d % nx === mid) { b.ba[i * 8 + k] = 0; }
	}
	var flow = { u: function (x) { return x < nx * H / 2 ? -25 : 25; }, v: function () { return 0; } };
	function sep() {
		var l = 0, nl = 0, r = 0, nr = 0;
		for (var q = 0; q < b.n; q++) {
			if (b.x[q] < nx * H / 2) { l += b.x[q]; nl++; } else { r += b.x[q]; nr++; }
		}
		return r / nr - l / nl;
	}
	var n = 0, s0 = sep(), s1;
	for (n = 0; n < steps; n++) step(b, 1, flow, 0);
	s1 = sep();
	var phase1 = (s1 - s0) / H, nCl1 = b.nCl;
	if (!heal) return { phase1: phase1, phase2: 0, nCl1: nCl1, nCl2: nCl1 };
	// the seam cools and ages: temperature down, age up, damage healed, and both the rest
	// lengths and the rest SHAPE frozen to what they are now. That is what welding means:
	// the material forgets the configuration it came from and remembers this one, so the
	// shape matching does not yank the new suture back to the shape it had before the rift.
	for (j = 0; j < ny; j++) { b.T[j * nx + mid] = 0.12; b.age[j * nx + mid] = 400; }
	for (i = 0; i < b.n; i++) for (k = 0; k < b.nb[i]; k++) {
		d = b.bi[i * 8 + k];
		if (d >= b.n) continue;
		if (i % nx === mid || d % nx === mid) {
			b.ba[i * 8 + k] = 400; b.bd[i * 8 + k] = 0;
			var dx = b.x[d] - b.x[i], dy = b.y[d] - b.y[i];
			b.bl[i * 8 + k] = Math.sqrt(dx * dx + dy * dy);
		}
	}
	restFrame(b);
	var s2 = sep();
	for (n = 0; n < steps; n++) step(b, 1, flow, 0);
	return { phase1: phase1, phase2: (sep() - s2) / H, nCl1: nCl1, nCl2: b.nCl };
}

var wYoung = welding(false, 200), wWeld = welding(true, 200);
console.log('\n  welding — a divergent flow across a seam: 200 steps young, then it cools (or not)');
console.log('    young seam: separates ' + wYoung.phase1.toFixed(2) + ' cells, clusters ' + wYoung.nCl1);
console.log('    cooled seam: separates ' + wWeld.phase1.toFixed(2) + ' cells, clusters ' + wWeld.nCl1
	+ ' -> after cooling ' + wWeld.phase2.toFixed(2) + ' cells, clusters ' + wWeld.nCl2);
ok('a hot young seam yields and the halves part', wYoung.phase1 > 0.05 && wYoung.nCl1 > 1,
	'separated ' + wYoung.phase1.toFixed(3) + ' cells, clusters ' + wYoung.nCl1);
ok('once the seam cools and ages it welds: one cluster, and no further drift',
	wWeld.nCl2 === 1 && wWeld.phase2 < 0.3 * wWeld.phase1,
	'clusters ' + wWeld.nCl2 + ', drift after cooling ' + wWeld.phase2.toFixed(3)
	+ ' cells vs ' + wWeld.phase1.toFixed(2) + ' while young');

// ---- 3. rifting ------------------------------------------------------------------------
function rift(hotBand, steps) {
	var nx = 24, ny = 5, i, j, c;
	var b = Body(nx, ny, H, 0, 0, 0.12, 400);
	for (j = 0; j < ny; j++) for (i = (nx >> 1) - 1; i <= (nx >> 1); i++) {
		c = j * nx + i;
		if (hotBand) { b.T[c] = 0.95; b.age[c] = 0; }
	}
	var flow = { u: function (x) { return x < nx * H / 2 ? -20 : 20; }, v: function () { return 0; } };
	function sep() {
		var l = 0, nl = 0, r = 0, nr = 0;
		for (var q = 0; q < b.n; q++) {
			if (b.x[q] < nx * H / 2) { l += b.x[q]; nl++; } else { r += b.x[q]; nr++; }
		}
		return r / nr - l / nl;
	}
	var n = 0, s0 = sep();
	for (n = 0; n < steps; n++) step(b, 1, flow, 0);
	return { nCl: b.nCl, sep: (sep() - s0) / H };
}

var riftHot = rift(true, 250), riftCold = rift(false, 250);
console.log('\n  rifting — a divergent flow under a lid, 250 steps');
console.log('    hot band:  clusters ' + riftHot.nCl + ', halves separate ' + riftHot.sep.toFixed(2) + ' cells');
console.log('    cold band: clusters ' + riftCold.nCl + ', halves separate ' + riftCold.sep.toFixed(2) + ' cells');
ok('a hot band splits the lid into two plates', riftHot.nCl >= 2, 'clusters ' + riftHot.nCl);
ok('the same flow leaves a cold lid whole', riftCold.nCl === 1, 'clusters ' + riftCold.nCl);

// ---- 4. slab pull ----------------------------------------------------------------------
// The plate is neutrally buoyant; a cold dense slab hangs off its end. Uniform gravity
// cannot move a rigid body sideways, so any horizontal motion of the plate is the slab's
// excess weight transmitted through the bonds -- which is the mechanism, not a prescribed
// force.
function slabPull(rows, steps) {
	var nx = 20, ny = 4, i, c, anchor;
	var b = Body(nx, ny, H, 0, 0, 0.5, 400);          // plate: no buoyancy of its own
	var dip = Math.PI / 3;
	anchor = (0) * nx + (nx - 1);                     // the plate's top-right corner
	var prev = anchor;
	for (i = 0; i < rows; i++) {
		var c2 = add(b, b.x[anchor] + (i + 0.5) * H * Math.cos(dip),
			b.y[anchor] - H - i * H * Math.sin(dip), 0.0, 400);
		link(b, prev, c2, H, 400);
		prev = c2;
		if (i + 1 < rows) {                            // a two-wide slab: more hanging weight
			var c3 = add(b, b.x[anchor] + (i + 0.5) * H * Math.cos(dip) + H * 0.7,
				b.y[anchor] - H - i * H * Math.sin(dip), 0.0, 400);
			link(b, c2, c3, H, 400);
			link(b, c3, prev, H, 400);
		}
	}
	restFrame(b);
	var flow = { u: function () { return 0; }, v: function () { return 0; } };
	var s = 0;
	for (s = 0; s < steps; s++) step(b, 1, flow, 0.6);
	var vx = 0, vy = 0, mt = 0;
	for (i = 0; i < nx * ny; i++) { vx += b.vx[i]; vy += b.vy[i]; mt++; }
	return { vx: vx / mt, vy: vy / mt, nCl: b.nCl };
}

var pullShort = slabPull(2, 400), pullLong = slabPull(8, 400);
console.log('\n  slab pull — MEASURED, NOT GATED (a cold dense slab bonded to a plate end,');
console.log('  400 steps, gravity on, no mantle support under the plate)');
console.log('    short slab: plate v ' + pullShort.vx.toExponential(2) + ', ' + pullShort.vy.toExponential(2)
	+ '   clusters ' + pullShort.nCl);
console.log('    long slab:  plate v ' + pullLong.vx.toExponential(2) + ', ' + pullLong.vy.toExponential(2)
	+ '   clusters ' + pullLong.nCl);
console.log('    A rigid cluster free to fall has no horizontal force: the hanging weight moves the');
console.log('    plate only through the mantle that supports it. The engine must show this with the');
console.log('    fluid grid present (P1), so it is a measurement here, not a fixture.');

// ---- 5. cost of the solid pass ---------------------------------------------------------
// The plan budgets the solid pass separately from the fluid. This is the whole machinery
// (predict, bonds with damage, clusters, shape matching, PBD velocity) on one rigid body,
// which is the cheap case: one cluster, eight bonds per particle.
function cost(nx, ny, steps) {
	var b = Body(nx, ny, H, 0, 0, 0.12, 400);
	var flow = { u: function (x, y) { return 20 * Math.sin(Math.PI * y / (ny * H)); }, v: function () { return 0; } };
	var t0 = Date.now(), n;
	for (n = 0; n < steps; n++) step(b, 1, flow, 0);
	return { n: b.n, ms: (Date.now() - t0) / steps };
}

cost(100, 60, 50);
var c1 = cost(100, 60, 200), c2 = cost(160, 100, 100);
console.log('\n  cost of the solid pass (bones only, one cluster, 8 bonds per particle; 2 cores)');
console.log('    ' + c1.n + ' particles: ' + c1.ms.toFixed(2) + ' ms/step   ('
	+ (c1.ms / c1.n * 1000).toFixed(2) + ' us per particle)');
console.log('    ' + c2.n + ' particles: ' + c2.ms.toFixed(2) + ' ms/step   ('
	+ (c2.ms / c2.n * 1000).toFixed(2) + ' us per particle)');

console.log('\n' + (chk.fails === 0 ? 'ALL PASS' : chk.fails + ' FAILURES') + ' (' + chk.total + ' checks)');
process.exitCode = chk.fails === 0 ? 0 : 1;
