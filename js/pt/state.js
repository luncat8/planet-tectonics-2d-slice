// pt/state.js — 0.3.0 P1: all fixed-capacity state (plan §3). Structure of arrays, allocated
// once, mutated in place: nothing here allocates in the frame loop.
//
// The markers are the mantle and the grid is its view of them. Each marker carries its
// temperature; the grid field Tg is rebuilt from them every frame (grid.js scatterT) and the
// conduction increment is handed back to them (gatherDT), so heat moves between the two
// representations but is not created by either. In P1 the marker set is fixed: one marker
// per interior node, each carrying the node's own measure, so the marker heat equals the
// field's heat exactly and the ledger (plan §3.4) has nothing to balance but the walls.
//
// P3.0 turned that fixed set into a *pool* (0.3.0-p3-plan.md §1.1-§1.3): every parcel carries
// a transport phase, a stable material id, a specific enthalpy and a composition, `0..S.n` is
// a dense prefix of `P.partCap`, and the transactions that change which parcels exist live in
// pool.js. What this file owns is the storage, the reset that seeds it and the fingerprint
// that has to cover all of it.
'use strict';
var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
// aliased under the name pool.js exports, so this adds no second global (P3 plan §6)
var PTPOOL = (typeof module !== 'undefined' && module.exports) ? require('./pool.js') : window.PTPOOL;
// the phase law: the reset seeds H from the initial temperature through it (P3.1)
var PTPHASE = (typeof module !== 'undefined' && module.exports) ? require('./phase.js') : window.PTPHASE;

// The fingerprint runs in fixtures and debug tools, not in the frame loop. Reuse one view
// pair so it hashes the exact Float64 representation without allocating per call.
var HASH_BUFFER = new ArrayBuffer(8);
var HASH_F64 = new Float64Array(HASH_BUFFER);
var HASH_U32 = new Uint32Array(HASH_BUFFER);
var HASH_PRIME_A = 16777619;
var HASH_PRIME_B = 2246822507;

function mixHash(hash, value, prime) {
	HASH_F64[0] = value;
	hash = Math.imul(hash ^ HASH_U32[0], prime);
	hash = Math.imul(hash ^ HASH_U32[1], prime);
	return hash >>> 0;
}

var PTS = {
	n: 0,
	x: null, y: null, e: null,      // km, km (depth), asinh(y/yLin) — e is carried, not derived
	T: null,                        // 0 at the surface, 1 at the CMB
	m: null,                        // mass per unit out-of-plane depth, km2 (fixed in P1)
	vx: null, vy: null,             // km/Myr while coupled; airborne presentation uses km/s
	// the P3.0 material state (0.3.0-p3-plan.md §1.1, §1.3). One transport phase per parcel,
	// one id that survives every move it makes, one specific enthalpy in the normalized unit
	// the phase law will repartition, and composition as mass fractions that stay in the
	// global inventory however the parcel is split or merged.
	id: null,                       // stable material identity: never reused, never renumbered
	ph: null,                       // P.PH — mantle, mobile melt, airborne, landed deposit.
	                                // The routing masks P.PH_GRID/PH_ADV/PH_SOLID say which
	                                // passes see it; a phase is not a plate id
	H: null,                        // specific enthalpy: sensible + latent, the conserved
	                                // quantity. P3.0 kept H === T bitwise (sensible heat
	                                // alone, cp = 1 in the normalized unit); P3.1 makes T the
	                                // equilibrium reading of H through the phase law
	                                // (phase.js), so the identity holds exactly while the
	                                // parcel is solid and breaks by the latent heat it holds
	cF: null, cW: null,             // composition: felsic and water mass fraction. Both
	                                // depress the solidus (params.js meltWF/meltWW)
	melt: null,                     // melt fraction of the parcel's own mass, 0..1: the
	                                // equilibrium reading of H (P3.1), not a free field. P3.2
	                                // detaches it, P3.3 erupts it
	nextId: 0,                      // the id the next admitted parcel gets
	age: null,                      // Myr since the marker last froze (plan §3.1): the
	                                // welding clock of the crust law (solid.js)
	mu: null,                       // strength 0..1 from T and age (plan §4.2); >=
	                                // clusterMin means the marker is plate, not fluid
	dmg: null,                      // accumulated bond damage (plan §4.2): 1 = bonds gone
	pLoad: null, pCnt: null,        // this frame's load integral per marker: the sum of the
	                                // pair excess and the number of pairs it was measured
	                                // over, so the damage rate is per *mean* excess and does
	                                // not scale with local marker density (solid.js pair)
	Tg: null,                       // node temperature field (ny+1) * nx
	mug: null,                      // node mean strength, the raster's crust overlay
	Mg: null,                       // node mean melt fraction, the raster's melt overlay: the
	                                // mass-weighted reading of the parcels' own equilibrium
	                                // melt (P3.1 replaced P1's pressure-release indicator)
	u: null, v: null,               // staggered velocity fields
	empty: 0, clamp: 0,             // diagnostics of the last frame: nodes with no marker, and
	                                // markers that had to be kept inside the box
	ledger: 0,                      // km2 * T, the sensible part of the intake: the phase
	                                // kernel books the temperature change it reads out of H, so
	                                // this and hLedger agree while nothing melts and diverge
	                                // by exactly the latent heat stored once something does
	wall: 0,                        // the same heat read from the operator's side (sim.js k[8])
	hLedger: 0,                     // km2 * H, the intake booked as enthalpy in gatherDT. This
	                                // is the P3 heat invariant's Q_wall (P3 plan §1.2): P3 has
	                                // no external source and no export, so it is the only net
	                                // change H_total may show
	// pool transaction counters (pool.js): what was admitted, split, merged, moved, intruded,
	// recycled and refused since reset. A refused transaction is a capacity event and is never
	// silent, so the block exists from load and reset zeroes it
	tx: { admit: 0, split: 0, merge: 0, move: 0, intrude: 0, recycle: 0, refuse: 0,
		whole: 0, freeze: 0, vent: 0, block: 0, emit: 0, land: 0 },
	// gross throughput, mass (km2) since reset: phase changes and each reservoir/phase leg.
	// Dr/Cr pairs are matching debit and credit sides. Throughput is never inventory.
	thr: { seg: 0, whole: 0, freeze: 0, intrDr: 0, intrCr: 0, ventDr: 0, ventCr: 0,
		airDr: 0, airCr: 0, landDr: 0, landCr: 0, deepDr: 0, deepCr: 0 },
	invN: null, invM: null,         // the stock inventory by phase: parcels, mass, m*H
	invH: null,
	invMTot: 0, invHTot: 0,         // and the totals, with composition and melt as mass: the
	invFTot: 0, invWTot: 0,         // closure a fixture gates to 1e-9 (pool.js inventoryComp)
	invLTot: 0, invErr: 0,
	invChM: 0, invChL: 0,           // the chamber stock's mass and melt, split out of the
	                                // totals so the HUD can show the intrusive store apart
	invVM: 0, invVL: 0,             // the vent schedules' stock, split out the same way
	invDpM: 0, invDpL: 0,           // and the deep inventory's (P4.1), split out the same way
	invL0: 0,                       // invLTot right after the last reset: the latent heat a run
	                                // has stored so far is meltLat * (invLTot - invL0)
	// the intrusive store (P3.2, 0.3.0-p3-plan.md §1.2): fixed-capacity chamber records,
	// allocated once. A chamber is a reservoir, not a parcel -- mass, enthalpy, melt and
	// composition accumulate in it through matched transfers (pool.js intrude), its stock is
	// part of the inventory and of the enthalpy total, and the full record set defers the
	// transfer instead of dropping mass. chX/chY are the mass-weighted mean of what the
	// chamber has eaten; P3.3's conduit reads that as its emplacement site.
	chN: 0,                         // chamber records in use (a record with mass > 0)
	chX: null, chY: null, chM: null, chH: null, chL: null, chF: null, chW: null,
	// the conduit of chamber k (P3.3, vent.js): its state, its style fixed at opening, and the
	// extensive stock waiting in its schedule. Vent k exists exactly while chamber k does
	vState: null, vStyle: null,     // conduit: VENT.CLOSED / OPEN / BLOCKED; style: EFFUSIVE / EXPLOSIVE
	vM: null, vH: null, vL: null, vF: null, vW: null,
	// the deep inventory (P4.1, 0.3.0-p4-plan.md §1.2): fixed-capacity records of the slab
	// material that reached yDeep and left the plate population. It is the ledger's first new
	// line since P3.0 and it is stock, not a sink -- pool.js recycle debits a parcel and
	// credits a record with the same mass, enthalpy, melt and composition, the inventory
	// counts the records exactly once, and a full set defers the transfer instead of dropping
	// mass. dpX/dpY are the mass-weighted mean of what the record has eaten.
	dpN: 0,                         // deep records in use
	dpX: null, dpY: null, dpM: null, dpH: null, dpL: null, dpF: null, dpW: null,
	Trow: null,                     // the background temperature of each mesh row, which is what
	                                // a slab's cold is dense against (slab.js rebuilds it per
	                                // frame from Tg, so it is workspace and not a field)
	moved: 0, redeals: 0,           // markers the last repair moved; lattice re-deals since reset
	nSolid: 0,                      // parcels the crust pass may bond this frame (PH_SOLID):
	                                // the lid fraction's denominator, so airborne material
	                                // cannot dilute a crust diagnostic
	order: null,                    // marker indices, bucketed by node (grid.js reseed)
	// cluster scratch for the crust pass (solid.js), sized with the marker set. Clusters are
	// recomputed every frame from the strong markers' adjacency, so this is workspace, not
	// state: par is the union-find, cl the cluster of each marker, and the cs* arrays are the
	// per-cluster accumulators (mass, centroid, velocity fit)
	par: null, cl: null, csOf: null,
	csM: null, csX: null, csY: null, csVX: null, csVY: null, csW: null, csR2: null,
	csS: null, csP: null, csCnt: null,
	csRef: null, csN: 0,            // csN: clusters of the last crust pass (plate markers only)
	// the surface elevation profile (G7): zh is the drawn horizon, zRaw its target, and the
	// per-column buffers hold filtered crust samples and the shallow plate boundary state
	zh: null, zRaw: null, zSmooth: null,
	hLid: null, hRaw: null, rft: null, colM: null,
	surfaceY: null, surfaceV: null, surfaceCl: null, jIso: 1,
	bandA: null, bandP: null,       // the initial perturbation's seeded band (icT)
	// the P4.0 contact table (contact.js): the shallowest strong crust marker of each
	// cluster, per column, and what the pass decided at each column boundary. The table is
	// per-frame workspace -- the frame rebuilds it -- except ctConv/ctSite, which the relief
	// terms (G7) read as the belt's source: the convergence the contact pass arrested, so a
	// locked boundary that keeps converging keeps thickening. A subducting site books its
	// convergence to the slab instead, and its belt comes from the arc, not from this proxy.
	ctCl: null, ctY: null, ctP: null, ctT: null, ctV: null, ctN: null,
	ctConv: null, ctSite: null,
	hgCl: null, hgX: null, hgS: null, hgC: null, hgN: 0,   // the bending bands of this frame
	// the contact pass's cumulative counters: km of convergence taken up by contact, the
	// guard's position pushes, the momentum the brake injected (the subduction hold's
	// unbalanced impulse -- an arrest pair cancels, so it contributes nothing) and the
	// subducting sites the ctHinge cap left without a bending band. All four are in the
	// fingerprint: a run that reached the same parcels through a different contact history
	// is not the same run.
	contactShort: 0, contactPush: 0, contactHold: 0, hgOver: 0,
	// per-frame diagnostics, mutated in place: the HUD formats them at 2 Hz
	d: {
		nu: 0, uMax: 0, vMax: 0, wells: 0, heat: 0, mHeat: 0, tMin: 0, tMax: 0,
		fluxTop: 0, fluxBot: 0, wallRate: 0, drift: 0, melt: 0, meltY: 0,
		lid: 0, plates: 0, plV: 0, zMin: 0, zMax: 0,
		contact: 0, contactC: 0, hold: 0, subduct: 0, push: 0, over: 0, resid: 0,
		slab: 0, slabV: 0, slabBond: 0, deep: 0
	},

	// allocate for a mesh (idempotent: the quality switch can change the mesh size)
	init: function (M, phase) {
		var cap = P.partCap;
		if (!this.x || this.x.length < cap) {
			this.x = new Float64Array(cap); this.y = new Float64Array(cap); this.e = new Float64Array(cap);
			this.T = new Float64Array(cap); this.m = new Float64Array(cap);
			this.vx = new Float64Array(cap); this.vy = new Float64Array(cap);
			this.age = new Float64Array(cap); this.mu = new Float64Array(cap);
			this.dmg = new Float64Array(cap);
			this.pLoad = new Float64Array(cap); this.pCnt = new Int32Array(cap);
			// the P3.0 material state: id and phase are integers, H and the composition
			// fractions ride the same Float64 precision as m so a split/merge closes to 1e-9
			this.id = new Int32Array(cap); this.ph = new Uint8Array(cap);
			this.H = new Float64Array(cap);
			this.cF = new Float64Array(cap); this.cW = new Float64Array(cap);
			this.melt = new Float64Array(cap);
			this.par = new Int32Array(cap); this.cl = new Int32Array(cap); this.csOf = new Int32Array(cap);
			this.csM = new Float64Array(cap); this.csX = new Float64Array(cap);
			this.csY = new Float64Array(cap); this.csVX = new Float64Array(cap);
			this.csVY = new Float64Array(cap); this.csW = new Float64Array(cap);
			this.csR2 = new Float64Array(cap); this.csRef = new Float64Array(cap);
			this.csS = new Float64Array(cap); this.csP = new Float64Array(cap);
			this.csCnt = new Int32Array(cap);
			// the contact pass's own workspace (contact.js): the brake's demanded correction
			// and the count it is a mean over, and the bending band's target velocity. All of
			// it is rebuilt every frame and none of it is carried by a parcel, which is why
			// pool.js lists it as workspace rather than a field.
			this.csBX = new Float64Array(cap); this.csBN = new Int32Array(cap);
			this.hinge = new Uint8Array(cap);
			this.hvx = new Float64Array(cap); this.hvy = new Float64Array(cap);
			this.order = new Int32Array(cap);
		}
		if (!this.invN || this.invN.length !== P.PH_N) {
			this.invN = new Int32Array(P.PH_N);
			this.invM = new Float64Array(P.PH_N);
			this.invH = new Float64Array(P.PH_N);
		}
		if (!this.chM || this.chM.length !== P.chCap) {
			this.chX = new Float64Array(P.chCap); this.chY = new Float64Array(P.chCap);
			this.chM = new Float64Array(P.chCap); this.chH = new Float64Array(P.chCap);
			this.chL = new Float64Array(P.chCap); this.chF = new Float64Array(P.chCap);
			this.chW = new Float64Array(P.chCap);
			this.vState = new Uint8Array(P.chCap); this.vStyle = new Uint8Array(P.chCap);
			this.vM = new Float64Array(P.chCap); this.vH = new Float64Array(P.chCap);
			this.vL = new Float64Array(P.chCap); this.vF = new Float64Array(P.chCap);
			this.vW = new Float64Array(P.chCap);
		}
		if (!this.dpM || this.dpM.length !== P.deepCap) {
			this.dpX = new Float64Array(P.deepCap); this.dpY = new Float64Array(P.deepCap);
			this.dpM = new Float64Array(P.deepCap); this.dpH = new Float64Array(P.deepCap);
			this.dpL = new Float64Array(P.deepCap); this.dpF = new Float64Array(P.deepCap);
			this.dpW = new Float64Array(P.deepCap);
		}
		if (!this.Tg || this.Tg.length !== M.n) {
			this.Tg = new Float64Array(M.n);
			this.Trow = new Float64Array(M.ny + 1);
			this.mug = new Float64Array(M.n);
			this.Mg = new Float64Array(M.n);
			this.u = new Float64Array(M.ny * M.nx);
			this.v = new Float64Array((M.ny + 1) * M.nx);
		}
		if (!this.zh || this.zh.length !== M.nx) {
			this.zh = new Float64Array(M.nx); this.zRaw = new Float64Array(M.nx);
			this.zSmooth = new Float64Array(M.nx);
			this.hLid = new Float64Array(M.nx); this.hRaw = new Float64Array(M.nx);
			this.rft = new Float64Array(M.nx); this.colM = new Float64Array(M.nx);
			this.surfaceY = new Float64Array(M.nx); this.surfaceV = new Float64Array(M.nx);
			this.surfaceCl = new Int32Array(M.nx);
			// the contact table: P.ctTop clusters per column, plus the per-column verdict the
			// relief terms read
			var kTop = P.ctTop, nTop = M.nx * kTop;
			this.ctCl = new Int32Array(nTop); this.ctY = new Float64Array(nTop);
			this.ctP = new Int32Array(nTop); this.ctT = new Float64Array(nTop);
			this.ctV = new Float64Array(nTop); this.ctN = new Int32Array(M.nx);
			this.ctConv = new Float64Array(M.nx); this.ctSite = new Uint8Array(M.nx);
		}
		if (!this.hgCl || this.hgCl.length !== P.ctHinge) {
			this.hgCl = new Int32Array(P.ctHinge); this.hgX = new Float64Array(P.ctHinge);
			this.hgS = new Int8Array(P.ctHinge); this.hgC = new Float64Array(P.ctHinge);
		}
		// Resolve the transaction field table at setup, not on the first live split or launch.
		PTPOOL.fields(this);
		// the compensation depth as a node row: the last row at or above P.yIso (the top
		// row, the surface boundary, is never included -- it carries no markers)
		this.jIso = 1;
		for (var jj = 1; jj < M.ny; jj++) if (M.yN[jj] <= P.yIso) this.jIso = jj;
		this.reset(M, phase || 0);
	},

	// one marker per interior node, mass = the node measure dEta * jN * dx: the same weight
	// the conduction operator conserves (grid.js, the lap identity), so the two heats agree
	// to round-off. The cell measure jC is *not* it -- mixing the two puts the marker heat
	// 2.6% above the field's and puts a constant offset under every ledger reading.
	// The initial temperature
	// profile is the plan's §8 P1 state: 'rb' is pt-conv.js's own conduction profile plus one
	// cosine perturbation (the fixture compares against it), 'cool' is a hot planet with a
	// cold skin, 'hot' is the P2 cooling start (nearly uniform hot, the lid has to grow from
	// the wall), 'blob' is one plume head under a conduction profile.
	reset: function (M, phase) {
		var nx = M.nx, ny = M.ny, i, j, k, p = 0, m, T, rnd = 12345, e, tx = this.tx;
		var mpc = P.mpc, out;
		this.band(phase);
		for (j = 1; j < ny; j++) for (i = 0; i < nx; i++) {
			m = M.dEta * M.jN[j] * M.dx / mpc;
			T = this.icT(M, i, j, phase);
			for (k = 0; k < mpc; k++) {
				// a deterministic sub-node offset: markers on a perfect lattice make the
				// transfer's quadrature resonate with the grid, and the offsets are the cure
				// (the seed is fixed, so a run still replays exactly)
				rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
				this.x[p] = (i + (rnd / 0x7fffffff - 0.5)) * M.dx;
				rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
				e = (j + (rnd / 0x7fffffff - 0.5)) * M.dEta;
				if (e < M.eMin) e = M.eMin; else if (e > M.eMax) e = M.eMax;
				this.e[p] = e;
				this.y[p] = M.yLin * Math.sinh(e);
				this.T[p] = T;
				this.m[p] = m;
				this.vx[p] = 0; this.vy[p] = 0;
				// A fresh planet is one phase: every parcel is mantle, carries no felsic
				// material and no water, and its enthalpy is the equilibrium enthalpy of
				// the initial temperature (phase.js). Below the solidus that is the
				// identity H = T; where the initial geotherm is *above* its own solidus
				// -- the shipped 'cool' start is mushy in a 250-700 km band, measured
				// in experiments/pt-p3-enthalpy.js -- H = T + L*xi and the melt
				// fraction comes with it. Either way T is the equilibrium reading
				// of H from the first frame, so the first phase pass changes nothing.
				// Ids are the slot order, so a reset planet's identity is its geometry
				// and a replay reproduces both.
				out = PTPHASE.byT(T, this.y[p], 0, 0);
				this.id[p] = p; this.ph[p] = P.PH.mantle; this.H[p] = out.h;
				this.cF[p] = 0; this.cW[p] = 0; this.melt[p] = out.melt;
				p++;
			}
		}
		this.n = p; this.nextId = p;
		this.empty = 0; this.clamp = 0; this.ledger = 0; this.wall = 0; this.hLedger = 0;
		this.moved = 0; this.redeals = 0; this.csN = 0; this.nSolid = 0;
		tx.admit = 0; tx.split = 0; tx.merge = 0; tx.move = 0; tx.intrude = 0;
		tx.recycle = 0; tx.refuse = 0;
		tx.whole = 0; tx.freeze = 0; tx.vent = 0; tx.block = 0; tx.emit = 0; tx.land = 0;
		this.thr.seg = 0; this.thr.whole = 0; this.thr.freeze = 0;
		this.thr.intrDr = 0; this.thr.intrCr = 0; this.thr.ventDr = 0; this.thr.ventCr = 0;
		this.thr.airDr = 0; this.thr.airCr = 0; this.thr.landDr = 0; this.thr.landCr = 0;
		this.thr.deepDr = 0; this.thr.deepCr = 0;
		this.chN = 0;
		this.chX.fill(0); this.chY.fill(0); this.chM.fill(0); this.chH.fill(0);
		this.chL.fill(0); this.chF.fill(0); this.chW.fill(0);
		this.vState.fill(0); this.vStyle.fill(0);
		this.vM.fill(0); this.vH.fill(0); this.vL.fill(0); this.vF.fill(0); this.vW.fill(0);
		// the deep inventory restarts with the planet: a fresh world has recycled nothing
		this.dpN = 0;
		this.dpX.fill(0); this.dpY.fill(0); this.dpM.fill(0); this.dpH.fill(0);
		this.dpL.fill(0); this.dpF.fill(0); this.dpW.fill(0);
		this.Tg.fill(0); this.mug.fill(0); this.Mg.fill(0); this.Trow.fill(0);
		this.age.fill(0); this.mu.fill(0); this.dmg.fill(0); this.cl.fill(-1);
		this.csN = 0;                             // the cluster table is rebuilt by crust()
		this.pLoad.fill(0); this.pCnt.fill(0);
		// the contact workspace is cleared, not merely unused: a band flag or a brake demand
		// left behind by a bigger population would be a decision a wrongly bounded pass could
		// find, and the cumulative counters restart with the planet
		this.csBX.fill(0); this.csBN.fill(0);
		this.hinge.fill(0); this.hvx.fill(0); this.hvy.fill(0);
		this.ctN.fill(0); this.ctConv.fill(0); this.ctSite.fill(0);
		this.hgN = 0;
		this.contactShort = 0; this.contactPush = 0; this.contactHold = 0; this.hgOver = 0;
		this.d.contact = 0; this.d.contactC = 0; this.d.hold = 0;
		this.d.subduct = 0; this.d.push = 0; this.d.over = 0; this.d.resid = 0;
		this.d.slab = 0; this.d.slabV = 0; this.d.slabBond = 0; this.d.deep = 0;
		// the material state past the prefix is cleared, not merely unused: a phase or an id
		// left behind by a bigger population would be a parcel a wrongly bounded pass could
		// find. pool.js remove() keeps the same rule per transaction.
		this.ph.fill(P.PH.mantle, p); this.H.fill(0, p); this.id.fill(-1, p);
		this.cF.fill(0, p); this.cW.fill(0, p); this.melt.fill(0, p);
		this.u.fill(0); this.v.fill(0);
		// a fresh planet is flat: the horizon relaxes up from the reference sea level as the
		// upper column's buoyancy, convergence and welded lid develop
		this.zh.fill(0); this.zRaw.fill(0); this.zSmooth.fill(0);
		this.hLid.fill(0); this.hRaw.fill(0); this.rft.fill(0); this.colM.fill(0);
		this.surfaceY.fill(0); this.surfaceV.fill(0); this.surfaceCl.fill(-1);
		for (i = 0; i < nx; i++) this.Tg[ny * nx + i] = 1;
		this.d.nu = 0; this.d.uMax = 0; this.d.vMax = 0; this.d.wells = 0;
		this.d.heat = 0; this.d.tMin = 0; this.d.tMax = 0; this.d.fluxTop = 0; this.d.fluxBot = 0;
		this.d.melt = 0; this.d.meltY = 0;
		this.d.lid = 0; this.d.plates = 0; this.d.plV = 0;
		this.d.zMin = 0; this.d.zMax = 0;
		// the stock side of the ledger is true at t = 0, before any frame's G8 has run: the
		// page's HUD and a fixture that reads the inventory at reset see the planet, not zeros
		PTPOOL.inventory(this);
		// the latent heat a run stores is measured against the stock it started with
		this.invL0 = this.invLTot;
	},

	// the initial temperature of the node at (i, j)
	// the broadband part of the initial perturbation (params.js icBand): per-mode amplitude
	// and phase drawn from the seed, normalised so the band carries icBand of the energy
	band: function (phase) {
		var K = P.icBandMax, k, a, sum = 0, rnd = (P.seed * 7919 + 1) & 0x7fffffff;
		if (!this.bandA || this.bandA.length !== K + 1) {
			this.bandA = new Float64Array(K + 1); this.bandP = new Float64Array(K + 1);
		}
		for (k = 1; k <= K; k++) {
			rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
			a = 0.25 + rnd / 0x7fffffff;
			rnd = (Math.imul(rnd, 1103515245) + 12345) & 0x7fffffff;
			this.bandA[k] = a;
			this.bandP[k] = phase + 6.283185307179586 * rnd / 0x7fffffff;
			sum += a * a;
		}
		a = Math.sqrt(P.icBand / sum);
		for (k = 1; k <= K; k++) this.bandA[k] *= a;
	},

	icT: function (M, i, j, phase) {
		var y = M.yN[j], f = y / M.depth, x = i * M.dx;
		var base;
		if (P.ic === 'cool') base = 1 - Math.exp(-y / P.skin);
		else if (P.ic === 'hot') base = 1;
		else base = f;
		var pert = Math.sin(Math.PI * f);
		var ph = phase;
		var k, wave = Math.sqrt(1 - P.icBand) * Math.cos(2 * Math.PI * P.icMode * x / M.wrap + ph);
		for (k = 1; P.icBand > 0 && k <= P.icBandMax; k++) wave += this.bandA[k] * Math.cos(2 * Math.PI * k * x / M.wrap + this.bandP[k]);
		var T = base + P.icAmp * pert * wave;
		if (P.ic === 'blob') {
			var dc = (x - 0.5 * M.wrap) / (0.08 * M.wrap), dz = (f - 0.72) / 0.12;
			T += 0.25 * Math.exp(-dc * dc - dz * dz);
		}
		return T < 0 ? 0 : (T > 1 ? 1 : T);
	},

	// the marker count per node, worst node first: a marker field that has drifted into
	// holes and piles is the thing to look at when the picture gets noisy
	counts: function (M, out) {
		var nx = M.nx, p, q;
		out.fill(0);
		for (p = 0; p < this.n; p++) {
			q = (Math.round(this.e[p] / M.dEta)) * nx + Math.round(this.x[p] / M.dx);
			q -= Math.floor(q / nx) * nx;
			if (q >= 0 && q < out.length) out[q]++;
		}
	},

	// A deterministic fingerprint for replay, pause and view-mutation checks. Include the
	// material, mechanical and surface state: a marker-only checksum misses a changed relief
	// profile or a different plate failure history. P3.0 made it the *complete* state
	// fingerprint the P3 plan's §1.3 asks for -- id, phase, enthalpy and composition are in
	// it per parcel, and the pool's own counters (nextId and tx) are in it too, so two runs
	// that reached the same population by a different transaction history do not compare
	// equal. A capture is this plus the capacity word (§6 of that plan).
	hash: function () {
		var a = 2166136261, b = 2654435769, p, i, n = this.n, tx = this.tx;
		a = mixHash(a, n, HASH_PRIME_A); b = mixHash(b, n, HASH_PRIME_B);
		for (p = 0; p < n; p++) {
			a = mixHash(a, this.x[p], HASH_PRIME_A); b = mixHash(b, this.x[p], HASH_PRIME_B);
			a = mixHash(a, this.y[p], HASH_PRIME_A); b = mixHash(b, this.y[p], HASH_PRIME_B);
			a = mixHash(a, this.e[p], HASH_PRIME_A); b = mixHash(b, this.e[p], HASH_PRIME_B);
			a = mixHash(a, this.T[p], HASH_PRIME_A); b = mixHash(b, this.T[p], HASH_PRIME_B);
			a = mixHash(a, this.m[p], HASH_PRIME_A); b = mixHash(b, this.m[p], HASH_PRIME_B);
			a = mixHash(a, this.vx[p], HASH_PRIME_A); b = mixHash(b, this.vx[p], HASH_PRIME_B);
			a = mixHash(a, this.vy[p], HASH_PRIME_A); b = mixHash(b, this.vy[p], HASH_PRIME_B);
			a = mixHash(a, this.age[p], HASH_PRIME_A); b = mixHash(b, this.age[p], HASH_PRIME_B);
			a = mixHash(a, this.mu[p], HASH_PRIME_A); b = mixHash(b, this.mu[p], HASH_PRIME_B);
			a = mixHash(a, this.dmg[p], HASH_PRIME_A); b = mixHash(b, this.dmg[p], HASH_PRIME_B);
			a = mixHash(a, this.cl[p], HASH_PRIME_A); b = mixHash(b, this.cl[p], HASH_PRIME_B);
			a = mixHash(a, this.id[p], HASH_PRIME_A); b = mixHash(b, this.id[p], HASH_PRIME_B);
			a = mixHash(a, this.ph[p], HASH_PRIME_A); b = mixHash(b, this.ph[p], HASH_PRIME_B);
			a = mixHash(a, this.H[p], HASH_PRIME_A); b = mixHash(b, this.H[p], HASH_PRIME_B);
			a = mixHash(a, this.cF[p], HASH_PRIME_A); b = mixHash(b, this.cF[p], HASH_PRIME_B);
			a = mixHash(a, this.cW[p], HASH_PRIME_A); b = mixHash(b, this.cW[p], HASH_PRIME_B);
			a = mixHash(a, this.melt[p], HASH_PRIME_A); b = mixHash(b, this.melt[p], HASH_PRIME_B);
		}
		if (this.zh) for (i = 0; i < this.zh.length; i++) {
			a = mixHash(a, this.zh[i], HASH_PRIME_A); b = mixHash(b, this.zh[i], HASH_PRIME_B);
		}
		a = mixHash(a, this.ledger, HASH_PRIME_A); b = mixHash(b, this.ledger, HASH_PRIME_B);
		a = mixHash(a, this.wall, HASH_PRIME_A); b = mixHash(b, this.wall, HASH_PRIME_B);
		a = mixHash(a, this.hLedger, HASH_PRIME_A); b = mixHash(b, this.hLedger, HASH_PRIME_B);
		a = mixHash(a, this.nextId, HASH_PRIME_A); b = mixHash(b, this.nextId, HASH_PRIME_B);
		a = mixHash(a, tx.admit, HASH_PRIME_A); b = mixHash(b, tx.admit, HASH_PRIME_B);
		a = mixHash(a, tx.split, HASH_PRIME_A); b = mixHash(b, tx.split, HASH_PRIME_B);
		a = mixHash(a, tx.merge, HASH_PRIME_A); b = mixHash(b, tx.merge, HASH_PRIME_B);
		a = mixHash(a, tx.move, HASH_PRIME_A); b = mixHash(b, tx.move, HASH_PRIME_B);
		a = mixHash(a, tx.intrude, HASH_PRIME_A); b = mixHash(b, tx.intrude, HASH_PRIME_B);
		a = mixHash(a, tx.recycle, HASH_PRIME_A); b = mixHash(b, tx.recycle, HASH_PRIME_B);
		a = mixHash(a, tx.refuse, HASH_PRIME_A); b = mixHash(b, tx.refuse, HASH_PRIME_B);
		a = mixHash(a, tx.whole, HASH_PRIME_A); b = mixHash(b, tx.whole, HASH_PRIME_B);
		a = mixHash(a, tx.freeze, HASH_PRIME_A); b = mixHash(b, tx.freeze, HASH_PRIME_B);
		a = mixHash(a, tx.vent, HASH_PRIME_A); b = mixHash(b, tx.vent, HASH_PRIME_B);
		a = mixHash(a, tx.block, HASH_PRIME_A); b = mixHash(b, tx.block, HASH_PRIME_B);
		a = mixHash(a, tx.emit, HASH_PRIME_A); b = mixHash(b, tx.emit, HASH_PRIME_B);
		a = mixHash(a, tx.land, HASH_PRIME_A); b = mixHash(b, tx.land, HASH_PRIME_B);
		a = mixHash(a, this.thr.seg, HASH_PRIME_A); b = mixHash(b, this.thr.seg, HASH_PRIME_B);
		a = mixHash(a, this.thr.whole, HASH_PRIME_A); b = mixHash(b, this.thr.whole, HASH_PRIME_B);
		a = mixHash(a, this.thr.freeze, HASH_PRIME_A); b = mixHash(b, this.thr.freeze, HASH_PRIME_B);
		a = mixHash(a, this.thr.intrDr, HASH_PRIME_A); b = mixHash(b, this.thr.intrDr, HASH_PRIME_B);
		a = mixHash(a, this.thr.intrCr, HASH_PRIME_A); b = mixHash(b, this.thr.intrCr, HASH_PRIME_B);
		a = mixHash(a, this.thr.ventDr, HASH_PRIME_A); b = mixHash(b, this.thr.ventDr, HASH_PRIME_B);
		a = mixHash(a, this.thr.ventCr, HASH_PRIME_A); b = mixHash(b, this.thr.ventCr, HASH_PRIME_B);
		a = mixHash(a, this.thr.airDr, HASH_PRIME_A); b = mixHash(b, this.thr.airDr, HASH_PRIME_B);
		a = mixHash(a, this.thr.airCr, HASH_PRIME_A); b = mixHash(b, this.thr.airCr, HASH_PRIME_B);
		a = mixHash(a, this.thr.landDr, HASH_PRIME_A); b = mixHash(b, this.thr.landDr, HASH_PRIME_B);
		a = mixHash(a, this.thr.landCr, HASH_PRIME_A); b = mixHash(b, this.thr.landCr, HASH_PRIME_B);
		a = mixHash(a, this.thr.deepDr, HASH_PRIME_A); b = mixHash(b, this.thr.deepDr, HASH_PRIME_B);
		a = mixHash(a, this.thr.deepCr, HASH_PRIME_A); b = mixHash(b, this.thr.deepCr, HASH_PRIME_B);
		// the contact pass's cumulative counters are state too: a run that reached the same
		// parcels through a different contact history is not the same run (P4.0)
		a = mixHash(a, this.contactShort, HASH_PRIME_A); b = mixHash(b, this.contactShort, HASH_PRIME_B);
		a = mixHash(a, this.contactPush, HASH_PRIME_A); b = mixHash(b, this.contactPush, HASH_PRIME_B);
		a = mixHash(a, this.contactHold, HASH_PRIME_A); b = mixHash(b, this.contactHold, HASH_PRIME_B);
		a = mixHash(a, this.hgOver, HASH_PRIME_A); b = mixHash(b, this.hgOver, HASH_PRIME_B);
		// the intrusive store is state: a run that reached the same parcels by a different
		// chamber history is not the same run (P3.2)
		a = mixHash(a, this.chN, HASH_PRIME_A); b = mixHash(b, this.chN, HASH_PRIME_B);
		for (i = 0; i < this.chN; i++) {
			a = mixHash(a, this.chX[i], HASH_PRIME_A); b = mixHash(b, this.chX[i], HASH_PRIME_B);
			a = mixHash(a, this.chY[i], HASH_PRIME_A); b = mixHash(b, this.chY[i], HASH_PRIME_B);
			a = mixHash(a, this.chM[i], HASH_PRIME_A); b = mixHash(b, this.chM[i], HASH_PRIME_B);
			a = mixHash(a, this.chH[i], HASH_PRIME_A); b = mixHash(b, this.chH[i], HASH_PRIME_B);
			a = mixHash(a, this.chL[i], HASH_PRIME_A); b = mixHash(b, this.chL[i], HASH_PRIME_B);
			a = mixHash(a, this.chF[i], HASH_PRIME_A); b = mixHash(b, this.chF[i], HASH_PRIME_B);
			a = mixHash(a, this.chW[i], HASH_PRIME_A); b = mixHash(b, this.chW[i], HASH_PRIME_B);
			a = mixHash(a, this.vState[i], HASH_PRIME_A); b = mixHash(b, this.vState[i], HASH_PRIME_B);
			a = mixHash(a, this.vStyle[i], HASH_PRIME_A); b = mixHash(b, this.vStyle[i], HASH_PRIME_B);
			a = mixHash(a, this.vM[i], HASH_PRIME_A); b = mixHash(b, this.vM[i], HASH_PRIME_B);
			a = mixHash(a, this.vH[i], HASH_PRIME_A); b = mixHash(b, this.vH[i], HASH_PRIME_B);
			a = mixHash(a, this.vL[i], HASH_PRIME_A); b = mixHash(b, this.vL[i], HASH_PRIME_B);
			a = mixHash(a, this.vF[i], HASH_PRIME_A); b = mixHash(b, this.vF[i], HASH_PRIME_B);
			a = mixHash(a, this.vW[i], HASH_PRIME_A); b = mixHash(b, this.vW[i], HASH_PRIME_B);
		}
		// the deep inventory is state the same way (P4.1): a run that recycled a different
		// slab into a different set of records is not the same run
		a = mixHash(a, this.dpN, HASH_PRIME_A); b = mixHash(b, this.dpN, HASH_PRIME_B);
		for (i = 0; i < this.dpN; i++) {
			a = mixHash(a, this.dpX[i], HASH_PRIME_A); b = mixHash(b, this.dpX[i], HASH_PRIME_B);
			a = mixHash(a, this.dpY[i], HASH_PRIME_A); b = mixHash(b, this.dpY[i], HASH_PRIME_B);
			a = mixHash(a, this.dpM[i], HASH_PRIME_A); b = mixHash(b, this.dpM[i], HASH_PRIME_B);
			a = mixHash(a, this.dpH[i], HASH_PRIME_A); b = mixHash(b, this.dpH[i], HASH_PRIME_B);
			a = mixHash(a, this.dpL[i], HASH_PRIME_A); b = mixHash(b, this.dpL[i], HASH_PRIME_B);
			a = mixHash(a, this.dpF[i], HASH_PRIME_A); b = mixHash(b, this.dpF[i], HASH_PRIME_B);
			a = mixHash(a, this.dpW[i], HASH_PRIME_A); b = mixHash(b, this.dpW[i], HASH_PRIME_B);
		}
		return a * 2097152 + (b & 0x1fffff);
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = PTS; else window.PTS = PTS;
