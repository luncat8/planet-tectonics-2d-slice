(function (root) {
// state.js — all fixed-capacity typed-array state (design §2). Allocated once here;
// reset() starts a run. No per-frame allocation anywhere: kernels mutate in place.
// Layer stacks live in the fixed slot range col*layerCap + k, bottom-up with a count,
// so a 20 m bed is exactly 20 m for as long as the run lasts (nothing is resampled).
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.COLP;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.COLGEO;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.COLRNG;

var S = {
	// columns (design §2.2), capacity colCap
	nCol: 0,
	spawnSkipped: 0,
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
	// Last accepted C4 targets travel with their Lagrangian column. A zero syncValid marks a
	// newborn or a section that has not received a coupling message, so its first import is
	// not misreported as section divergence.
	syncFel: new Float64Array(P.colCap),
	syncMaf: new Float64Array(P.colCap),
	syncSed: new Float64Array(P.colCap),
	syncValid: new Uint8Array(P.colCap),
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
	edgeAge: new Float64Array(P.colCap),    // Myr in that boundary state
	edgeSlow: new Float64Array(P.colCap),   // consecutive Myr of slow C-C contact
	// The shortening a C-C boundary has itself absorbed, m: the territory each conveyor
	// retirement releases (0.1.8 M2, measure D). It is the collision brake's length scale.
	// Section-local by design: not a COL.fields entry, so the v1 slice pack is untouched
	// and a cut or import restarts it at zero. It is a checkpoint array.
	edgeShort: new Float64Array(P.colCap),
	colLoad: new Float64Array(P.colCap),    // mobile sediment load, m (one-hop routing)
	colLoadFel: new Float64Array(P.colCap), // felsic fraction of mobile load, m
	colPla: new Float64Array(P.colCap),     // placer load riding colLoad, m
	colBevel: new Uint8Array(P.colCap),     // 1 if top beveled since last burial (unconformity)
	colChamber: new Float64Array(P.colCap), // stored melt volume, m2 per unit depth
	colMeltArc: new Float64Array(P.colCap), // arc melt supplied in the current frame, m2
	colMeltPlume: new Float64Array(P.colCap), // plume melt supplied in the current frame, m2
	colRecycle: new Float64Array(P.colCap), // ribbon water reaching this arc column, m2
	// 0.1.5: a consumed record is not deleted, it becomes a trench sliver (colGhost) and
	// gives its crust to the ribbon, keeping its place and its (now tiny) territory
	// until the trench has closed both its gaps. colAge is its life, as for any record.
	// hDraw is the crust thickness that is *on screen*: a sliver owns no mass but keeps
	// its span in the picture, so the drawn profile passes straight through it (design
	// §1.3 "what is drawn is the integral of the columns" holds everywhere except
	// across a sliver, where it is a stated, bounded exception).
	colGhost: new Uint8Array(P.colCap),
	hDraw: new Float64Array(P.colCap),      // drawn crust thickness, m (surface.js)
	// layer stacks: flat colCap x layerCap, bottom-up from col*layerCap
	colNL: new Int32Array(P.colCap),
	layTh: new Float64Array(P.colCap * P.layerCap),
	layLi: new Int8Array(P.colCap * P.layerCap),
	// Myr on the section's clock, the time the bed's rock formed. One convention for every
	// writer: the engines stamp t at deposition, and an import converts the globe's rock
	// age into formation time (t − age) instead of carrying a second unit into the stack.
	layAg: new Float64Array(P.colCap * P.layerCap),
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
	ribW: new Float64Array(P.ribCap * P.ribNodeCap),  // water riding the node, m2
	ribRelW: new Float64Array(P.ribCap * P.ribNodeCap), // water released this frame, m2
	ribDir: new Int8Array(P.ribCap),
	ribPlate: new Int32Array(P.ribCap),
	ribX0: new Float64Array(P.ribCap),
	ribAge: new Float64Array(P.ribCap),
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
	plmAge: new Float64Array(P.plumeCap),
	plmLife: new Float64Array(P.plumeCap),
	plmArrive: new Uint8Array(P.plumeCap),
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

	// 0.4.1 M2: the assumption record of a reconstruction (0.4.1-plan.md §4.3.3). One named
	// line per quantity a seeded column needed and the cut did not carry, plus the two
	// volumes the ledger owes (§4.3.5). Read by the HUD, the capture and the fixture. Not in
	// the state hash: it says how the state was made, not what it is, so a world the section
	// built for itself and a world seeded from a cut hash alike when their state agrees.
	recon: {
		sedimentAge: 0,             // beds whose age is the crust's, because the globe gives none
		subMohoThermal: 0,          // columns whose sub-Moho temperature is the fan's own law
		lithosphereDepth: 0,        // columns whose lid hit the age cap the fan law uses
		plumeDefault: 0,            // plumes seeded from the section's seed, not from the cut
		mobileAbsent: 0,            // columns whose mobile load the pack cannot carry (hMob)
		overCollapse: 0,            // columns imported above hCollapse, which the seed does not push
		overCollapseVol: 0,         // m3 of that excess
		shortPlateMerge: 0,         // narrowest-run merges it took to fit plateCap
		clampedSpan: 0,             // spans clamped to reach the section's arc: never, in this version
		discardedNormalVelocity: 0, // samples whose out-of-plane speed is larger than the seen one
		seaDatumDisplay: 0,         // columns whose wet flag moves when the datum becomes the section's
		bndCollapsed: 0,            // crossings that had to share a column pair, or fell in a tail
		bndLost: 0,                 // crossings inside one plate after the resample: not representable
		edgeFallback: 0,            // plate seams the cut left without a boundary, called neutral
		gapColumns: 0,              // columns whose crust the cut thinned by crossing a gap
		outsideCut: 0,              // columns of the ring an open window leaves with no data
		tailArcKm: 0,               // the arc of a window no whole column could take
		tailVol: 0,                  // m3 of crust that arc carried
		// M5 C4 ledger, all volumes in m3 per metre out of section. Four lines are
		// cumulative; divergedAtImport is the one current residual shown beside them.
		reconciled: 0,               // absolute volume added or removed on matched columns
		diverged: 0,                 // own-kernel change from the previous accepted targets
		divergedAtImport: 0,         // current own-kernel residual before this reconcile
		fresh: 0,                    // target volume built where no ancestor is close enough
		retired: 0                   // old stack volume retired where no descendant is close
	},
	// The active sea datum is zero for a standalone section and follows accepted globe snapshots.
	seaLevel: 0,
	// mass ledger (design §6): produced / consumed volume per LITH, m3
	ledProd: new Float64Array(P.LITH.n),
	ledCons: new Float64Array(P.LITH.n),
	ledMixIn: new Float64Array(P.LITH.n),
	ledMixOut: new Float64Array(P.LITH.n),
	ledMix: 0,                              // cross-lithology merges and rock -> sediment conversions
	waterIn: 0,                             // slab-bound water volume, m2
	waterReleased: 0,                       // cumulative dehydration, m2
	waterUsed: 0,                            // wedge / mantle water sink, m2
	meltArc: 0,                              // generated arc melt volume, m2
	meltPlume: 0,                            // generated plume melt volume, m2
	meltSill: 0,                             // chamber overflow emplaced as sill, m2
	massBy: new Float64Array(P.LITH.n)      // measured crust mass per LITH, m3
};

S.reset = function () {
	this.nCol = 0; this.nPl = 0; this.nRib = 0; this.nPlm = 0; this.nVen = 0; this.nDep = 0;
	this.ledMix = 0; this.spawnSkipped = 0; this.seaLevel = 0;
	this.waterIn = 0; this.waterReleased = 0; this.waterUsed = 0;
	this.meltArc = 0; this.meltPlume = 0; this.meltSill = 0;
	for (var k in this.recon) this.recon[k] = 0;
	for (k in this) {
		var v = this[k];
		if (v && v.fill) v.fill(0);
	}
	this.edgeRPlate.fill(-1);
	this.volc.fill(-1);
	this.venCol.fill(-1);
	sViews = null;
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

// Column width = the territory the column owns: from the midpoint of its left gap to the
// midpoint of its right gap (not centred on x unless the two gaps are equal). The renderer
// draws the crust as a piecewise-linear profile with the columns as nodes, so this
// trapezoid width makes SUM(thickness*width) exactly the integral of what is on screen,
// and SUM(colW) = wrap for any spacing. It is also symmetric in the two margins: an
// opening gap stretches (and thins) BOTH of them, and inserting a column takes territory
// from both parents instead of all of it from the left one. The left-anchored width
// (x[i+1]-x[i]) did the opposite, which is why COL.inherit hands a newborn the material of
// the territory it takes: with these widths a birth leaves every thickness unchanged, so a
// rift axis is a valley and not a spike.
S.widths = function () {
	var n = this.nCol, i, im, ip, dl, dr;
	if (n === 0) return;
	if (n === 1) { this.colW[0] = P.wrap; return; }
	for (i = 0; i < n; i++) {
		im = i > 0 ? i - 1 : n - 1;
		ip = i + 1 < n ? i + 1 : 0;
		dl = this.colX[i] - this.colX[im];
		dr = this.colX[ip] - this.colX[i];
		if (dl < 0) dl += P.wrap;
		if (dr < 0) dr += P.wrap;
		this.colW[i] = 0.5 * (dl + dr);
	}
};

// measured crust mass per lithology, m3 (unit depth into the page)
// includes mobile sediment load as sediment so total crust+mobile is conserved
// through an erosion->routing->deposition frame (M3)
S.mass = function () {
	var m = this.massBy, i, k, b, n, rb, rn;
	m.fill(0);
	for (i = 0; i < this.nCol; i++) {
		b = i * P.layerCap;
		n = this.colNL[i];
		for (k = 0; k < n; k++) m[this.layLi[b + k]] += this.layTh[b + k] * this.colW[i];
		m[P.LITH.sed] += this.colLoad[i] * this.colW[i];
		m[P.LITH.maf] += this.colChamber[i];
	}
	// A ribbon owns the consumed stack until it reaches the 660 km dissolution depth.
	// Its layers are already volumes per unit depth, so no column width is applied.
	for (i = 0; i < this.nRib; i++) {
		rb = i * P.layerCap;
		rn = this.ribNL[i];
		for (k = 0; k < rn; k++) m[this.ribLLi[rb + k]] += this.ribLTh[rb + k];
	}
	return m;
};

S.massStack = function () {
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
else root.COLS = S;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
