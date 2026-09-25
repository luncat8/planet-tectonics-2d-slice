// state.js — all fixed-capacity typed-array state (design §2). Allocated once here;
// reset() starts a run. No per-frame allocation anywhere: kernels mutate in place.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
var GEO = (typeof module !== 'undefined' && module.exports) ? require('./geom.js') : window.GEO;
var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.RNG;

var S = {
	// columns (design §2.2), capacity colCap
	nCol: 0,
	colX: new Float64Array(P.colCap),
	colPlate: new Int32Array(P.colCap),
	colAge: new Float64Array(P.colCap),       // Myr, 0 at a ridge
	hFel: new Float64Array(P.colCap),
	hMaf: new Float64Array(P.colCap),
	hSed: new Float64Array(P.colCap),
	damage: new Float64Array(P.colCap),
	zDyn: new Float64Array(P.colCap),
	fert: new Float64Array(P.colCap),
	oVms: new Float64Array(P.colCap),
	oMaf: new Float64Array(P.colCap),
	oArc: new Float64Array(P.colCap),
	oOro: new Float64Array(P.colCap),
	oBas: new Float64Array(P.colCap),
	oPla: new Float64Array(P.colCap),
	volc: new Int32Array(P.colCap),           // vent slot or -1
	edge: new Int8Array(P.colCap),            // boundary type with the right neighbour
	edgeAge: new Float64Array(P.colCap),      // time in that state, yr (suture timer)
	colLoad: new Float64Array(P.colCap),      // mobile sediment load, m (one-hop routing)
	colPla: new Float64Array(P.colCap),       // placer load riding colLoad, m
	// layer stacks: flat colCap x layerCap ring, per-column head + count
	colHead: new Int32Array(P.colCap),
	colNL: new Int32Array(P.colCap),
	layTh: new Float64Array(P.colCap * P.layerCap),
	layLi: new Int8Array(P.colCap * P.layerCap),
	layAg: new Float64Array(P.colCap * P.layerCap),
	layFl: new Uint8Array(P.colCap * P.layerCap),

	// plates (design §2.1), ≤ 32; u in m/yr (the HUD shows cm/yr)
	nPl: 0,
	plX0: new Float64Array(32),
	plN: new Int32Array(32),
	plU: new Float64Array(32),
	plUP: new Float64Array(32),
	plDmg: new Float64Array(32),

	// fan temperature (design §2.4)
	Tf: new Float64Array(GEO.fanOff[GEO.N]),
	TfS: new Float64Array(GEO.fanOff[GEO.N]),

	// slab ribbons (design §2.3): 8 ribbons x 48 nodes, ≤ 12 subducted layers per node
	nRib: 0,
	ribN: new Int32Array(8),
	ribX: new Float64Array(8 * 48),
	ribY: new Float64Array(8 * 48),
	ribDip: new Float64Array(8 * 48),
	ribT: new Float64Array(8 * 48),
	ribW: new Float64Array(8 * 48),           // water riding the node
	ribNL: new Int32Array(8 * 48),
	ribLTh: new Float64Array(8 * 48 * 12),
	ribLLi: new Int8Array(8 * 48 * 12),
	ribLFl: new Uint8Array(8 * 48 * 12),

	// plumes (≤ 6), conduit ≤ 24 markers
	nPlm: 0,
	plmX: new Float64Array(6),
	plmY: new Float64Array(6),
	plmR: new Float64Array(6),
	plmStr: new Float64Array(6),
	plmNCon: new Int32Array(6),
	plmConX: new Float64Array(6 * 24),
	plmConY: new Float64Array(6 * 24),
	plmConT: new Float64Array(6 * 24),

	// vents (≤ 16) + the toy boxes (design §2.3, §5)
	nVen: 0,
	venX: new Float64Array(P.maxVents),
	venW: new Float64Array(P.maxVents),
	venH: new Float64Array(P.maxVents),
	venStyle: new Int8Array(P.maxVents),      // 0 strato, 1 shield, 2 fissure, 3 arc
	venV: new Float64Array(P.maxVents),       // chamber volume, km3
	venGas: new Float64Array(P.maxVents),
	venCol: new Int32Array(P.maxVents),       // owning column or -1
	venIdle: new Float64Array(P.maxVents),    // chamber-empty time, yr
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
	depCls: new Int8Array(P.depCap),          // OCLS enum
	depGr: new Float32Array(P.depCap),

	// mass ledger (design §6): produced / consumed volume per LITH, m3
	ledProd: new Float64Array(6),
	ledCons: new Float64Array(6)
};

S.reset = function () {
	this.nCol = 0; this.nPl = 0; this.nRib = 0; this.nPlm = 0; this.nVen = 0; this.nDep = 0;
	for (var k in this) {
		var v = this[k];
		if (v && v.fill) v.fill(0);
	}
	this.volc.fill(-1);
	this.venCol.fill(-1);
	RNG.seed(P.seed);
};

S.reset();

if (typeof module !== 'undefined' && module.exports) module.exports = S;
