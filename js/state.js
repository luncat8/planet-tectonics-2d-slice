// state.js — all fixed-capacity typed-array state (design §2). Allocated once here;
// reset() starts a run. No per-frame allocation anywhere: kernels mutate in place.
// Layer stacks live in the fixed slot range col*layerCap + k, bottom-up with a count,
// so a 20 m bed is exactly 20 m for as long as the run lasts (nothing is resampled).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.RNG;

var S = {
	// columns (design §2.2), capacity colCap
	nCol: 0,
	colX: new Float64Array(P.colCap),
	colW: new Float64Array(P.colCap),       // width from the neighbour gaps (S.widths)
	colPlate: new Int32Array(P.colCap),
	colU: new Float64Array(P.colCap),
	ext: new Float64Array(P.colCap),
	edgeRelN: new Float64Array(P.colCap),
	edgePol: new Int8Array(P.colCap),        // -1 left subducts, +1 right, 0 neither
	edgeRPlate: new Int32Array(P.colCap),
	trenchDist: new Uint8Array(P.colCap),
	oldW: new Float64Array(P.colCap),
	sortOrder: new Int32Array(P.colCap),
	sortInverse: new Int32Array(P.colCap),
	colAge: new Float64Array(P.colCap),     // Myr, 0 at a ridge
	hFel: new Float64Array(P.colCap),
	hMaf: new Float64Array(P.colCap),
	hSed: new Float64Array(P.colCap),
	hTot: new Float64Array(P.colCap),       // cached stack total, m
	z: new Float64Array(P.colCap),          // isostatic elevation, m (surface.js)
	slope: new Float64Array(P.colCap),      // wrapped central difference of z
	wet: new Uint8Array(P.colCap),          // below sea level
	noise: new Float64Array(P.colCap),      // per-column relief noise, -1..1
	damage: new Float64Array(P.colCap),
	zDyn: new Float64Array(P.colCap),
	fert: new Float64Array(P.colCap),
	oVms: new Float64Array(P.colCap),
	oMaf: new Float64Array(P.colCap),
	oArc: new Float64Array(P.colCap),
	oOro: new Float64Array(P.colCap),
	oBas: new Float64Array(P.colCap),
	oPla: new Float64Array(P.colCap),
	volc: new Int32Array(P.colCap),         // vent slot or -1
	edge: new Int8Array(P.colCap),          // boundary type with the right neighbour
	edgeAge: new Float64Array(P.colCap),    // Myr in that state (suture timer)
	colLoad: new Float64Array(P.colCap),    // mobile sediment load, m (one-hop routing)
	colPla: new Float64Array(P.colCap),     // placer load riding colLoad, m
	// layer stacks: flat colCap x layerCap, bottom-up from col*layerCap
	colNL: new Int32Array(P.colCap),
	layTh: new Float64Array(P.colCap * P.layerCap),
	layLi: new Int8Array(P.colCap * P.layerCap),
	layAg: new Float64Array(P.colCap * P.layerCap),   // Myr
	layFl: new Uint8Array(P.colCap * P.layerCap),     // P.FLAG bits

	// plates (design §2.1); u in m/Myr (the HUD shows cm/yr)
	nPl: 0,
	plX0: new Float64Array(P.plateCap),
	plN: new Int32Array(P.plateCap),
	plU: new Float64Array(P.plateCap),
	plUP: new Float64Array(P.plateCap),
	plDmg: new Float64Array(P.plateCap),

	// fan temperature (design §2.4)
	Tf: new Float64Array(GEO.fanOff[GEO.N]),
	TfS: new Float64Array(GEO.fanOff[GEO.N]),

	// slab ribbons (design §2.3): a polyline of nodes plus ONE stack for the whole
	// ribbon — a per-node stack would multiply the layer table by the node count for
	// no visible gain
	nRib: 0,
	ribN: new Int32Array(P.ribCap),
	ribX: new Float64Array(P.ribCap * P.ribNodeCap),
	ribY: new Float64Array(P.ribCap * P.ribNodeCap),
	ribDip: new Float64Array(P.ribCap * P.ribNodeCap),
	ribT: new Float64Array(P.ribCap * P.ribNodeCap),
	ribW: new Float64Array(P.ribCap * P.ribNodeCap),  // water riding the node
	ribNL: new Int32Array(P.ribCap),
	ribLTh: new Float64Array(P.ribCap * P.layerCap),
	ribLLi: new Int8Array(P.ribCap * P.layerCap),
	ribLAg: new Float64Array(P.ribCap * P.layerCap),
	ribLFl: new Uint8Array(P.ribCap * P.layerCap),

	// plumes, conduit marker chain
	nPlm: 0,
	plmX: new Float64Array(P.plumeCap),
	plmY: new Float64Array(P.plumeCap),
	plmR: new Float64Array(P.plumeCap),
	plmStr: new Float64Array(P.plumeCap),
	plmNCon: new Int32Array(P.plumeCap),
	plmConX: new Float64Array(P.plumeCap * P.conduitCap),
	plmConY: new Float64Array(P.plumeCap * P.conduitCap),
	plmConT: new Float64Array(P.plumeCap * P.conduitCap),

	// vents + the toy boxes (design §2.3, §5)
	nVen: 0,
	venX: new Float64Array(P.maxVents),
	venW: new Float64Array(P.maxVents),
	venH: new Float64Array(P.maxVents),
	venStyle: new Int8Array(P.maxVents),    // 0 strato, 1 shield, 2 fissure, 3 arc
	venV: new Float64Array(P.maxVents),     // chamber volume, km3
	venGas: new Float64Array(P.maxVents),
	venCol: new Int32Array(P.maxVents),     // owning column or -1
	venIdle: new Float64Array(P.maxVents),  // Myr with an empty chamber
	toyH: new Float32Array(P.maxVents * P.ventBoxW),
	toyLi: new Int8Array(P.maxVents * P.ventBoxW),
	toyT: new Float32Array(P.maxVents * P.ventBoxW),
	prN: new Int32Array(P.maxVents),
	prX: new Float32Array(P.maxVents * P.partCap),
	prY: new Float32Array(P.maxVents * P.partCap),
	prVX: new Float32Array(P.maxVents * P.partCap),
	prVY: new Float32Array(P.maxVents * P.partCap),
	prT: new Float32Array(P.maxVents * P.partCap),
	prL: new Float32Array(P.maxVents * P.partCap),

	// deposits (design §2.2, §4.7)
	nDep: 0,
	depCol: new Int32Array(P.depCap),
	depLay: new Int32Array(P.depCap),
	depCls: new Int8Array(P.depCap),        // OCLS enum
	depGr: new Float32Array(P.depCap),

	// mass ledger (design §6): produced / consumed volume per LITH, m3
	ledProd: new Float64Array(P.LITH.n),
	ledCons: new Float64Array(P.LITH.n),
	ledMixIn: new Float64Array(P.LITH.n),
	ledMixOut: new Float64Array(P.LITH.n),
	ledMix: 0,                              // cross-lithology stack merges (auditable loss)
	massBy: new Float64Array(P.LITH.n)      // measured crust mass per LITH, m3
};

S.reset = function () {
	this.nCol = 0; this.nPl = 0; this.nRib = 0; this.nPlm = 0; this.nVen = 0; this.nDep = 0;
	this.ledMix = 0;
	for (var k in this) {
		var v = this[k];
		if (v && v.fill) v.fill(0);
	}
	this.edgeRPlate.fill(-1);
	this.volc.fill(-1);
	this.venCol.fill(-1);
	RNG.seed(P.seed);
	this.layout();
};

// the geometry of the initial planet: nCols uniform columns in plates0 plates whose
// boundaries sit at even spacing plus a seeded jitter; stacks empty. The first boundary
// is jittered too, so the last plate usually wraps across x = 0 (a rotated interval
// anchored at its own first column). The geology is columns.js makePlanet.
S.layout = function () {
	var n = P.nCols, np = P.plates0, i, k, b0, b1, first;
	this.nCol = n;
	for (i = 0; i < n; i++) this.colX[i] = i * P.w0;
	this.nPl = np;
	b0 = first = RNG.i(P.plateJitter + 1);
	for (k = 0; k < np; k++) {
		b1 = k + 1 < np ? Math.round((k + 1) * n / np) + RNG.i(2 * P.plateJitter + 1) - P.plateJitter : first + n;
		this.plX0[k] = this.colX[b0 % n];
		this.plN[k] = b1 - b0;
		for (i = b0; i < b1; i++) this.colPlate[i % n] = k;
		b0 = b1;
	}
	this.widths();
};

// column width from the neighbour gaps (columns are born equal but stop being so
// once rifts spawn and trenches consume; every mass integral uses the real width)
S.widths = function () {
	var n = this.nCol, i;
	if (n === 0) return;
	if (n === 1) { this.colW[0] = P.wrap; return; }
	for (i = 0; i < n; i++) {
		var j = i + 1 < n ? i + 1 : 0;
		var d = this.colX[j] - this.colX[i];
		if (d <= 0) d += P.wrap;
		this.colW[i] = d;
	}
};

// measured crust mass per lithology, m3 (unit depth into the page)
S.mass = function () {
	var m = this.massBy, i, k, b, n;
	m.fill(0);
	for (i = 0; i < this.nCol; i++) {
		b = i * P.layerCap;
		n = this.colNL[i];
		for (k = 0; k < n; k++) m[this.layLi[b + k]] += this.layTh[b + k] * this.colW[i];
	}
	return m;
};

// FNV-1a over every buffer and scalar: the determinism key (design §6, acceptance 10).
// The byte views are built once (module scope, so reset() cannot zero them) and the
// scalar scratch is reused — hashing allocates nothing.
var S_HASH_BUF = new ArrayBuffer(8);
var S_HASH_F64 = new Float64Array(S_HASH_BUF);
var S_HASH_U8 = new Uint8Array(S_HASH_BUF);
var sViews = null;

function sMix(h, x) {
	S_HASH_F64[0] = x;
	for (var i = 0; i < 8; i++) h = (Math.imul(h ^ S_HASH_U8[i], 16777619)) >>> 0;
	return h;
}

S.hash = function () {
	var h = 2166136261 >>> 0, i, j, n, v;
	if (!sViews) {
		sViews = [];
		for (var k in this) {
			v = this[k];
			if (typeof v === 'number') sViews.push(k);
			else if (v && v.buffer) sViews.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
		}
	}
	for (i = 0; i < sViews.length; i++) {
		v = sViews[i];
		if (typeof v === 'string') { h = sMix(h, this[v]); continue; }
		n = v.length;
		for (j = 0; j < n; j++) h = (Math.imul(h ^ v[j], 16777619)) >>> 0;
	}
	return h;
};

S.reset();

if (typeof module !== 'undefined' && module.exports) module.exports = S;
