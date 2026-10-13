// pt-p4-lib.js — the P4 fixtures' shared two-plate builder. Not a harness: it prints nothing
// and gates nothing, it is the geometry both P4 owner harnesses drive (k5-table-lib.js and
// lib.js are the precedent).
//
// Everything a controlled P4 leg changes from the shipped planet lives in configure(); the
// rest are the shipped parameters, so every number a P4 fixture reports runs through the real
// pipeline. The geometry itself is forced by the engine rather than chosen, and the full
// derivation of each choice -- the depth offset the bond test demands, why the band between
// the lids is weak because its age is zero and not because it is hot, why the legs run 5 Myr,
// why the failure law is off -- is archive/0.3.0-p4.0-worklog.md. What follows is the summary
// a reader of a P4 fixture needs:
//
//   two plates   the left one subducts and carries the root that deepens toward the trench,
//                because solid.js' pull reads csS = sum m*ry over the markers below the
//                centroid: a plate whose lid is deeper on one side is pulled toward that side.
//   the override is a surface lid with a root of its own a few columns back from the boundary,
//                so the same pull drags it *into* the contact. Without it the override drifts
//                away from the trench, P4.0's hold never fires, and "the override is held" is
//                a claim about nothing. The buffer keeps the 50 km depth gap at the adjacent
//                columns, which is what stops the two plates welding before the pass sees them.
//   one clean system   the depth separation that holds the plates apart at the trench holds
//                them apart around the back of the planet too, so no antimeridian channel is
//                needed and the fixture is two clusters, not three.
//
// The plates are found by centroid depth and never by cluster index: the union-find renumbers
// every frame, so a leg that named its plates by index would measure whichever fragment the
// renumber happened to put first.
'use strict';

var path = require('path');
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), POOL = require(B + 'pool.js'), G = require(B + 'grid.js');

var HALF, WEDGE;

// the geometry and the initial condition both entry points share: every one of these is the
// shipped default, named so that neither entry inherits a controlled leg's settings
function planet() {
	P.wrap = 16000; P.depth = 2900; P.yLin = 40;
	P.mesh.nx = 256; P.mesh.ny = 24; P.mpc = 4;
	P.resFrac = P.resMelt + P.resAir + P.resDep;
	P.ic = 'cool'; P.flip = 1; P.solid = true;
	P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = 1;
	P.Ra = 1e6; P.RaK = P.Ra * P.kappa / (P.depth * P.depth * P.depth);
	P.sl.kyr = 50;
}

// the override's lid: a 65 km surface lid whose base deepens to OVRROOT from OVRBUF columns
// in from the boundary, over the WEDGE columns that face the trench
var OVRBASE = 100, OVRROOT = 140, OVRBUF = 6;

var L = {
	OVRBASE: OVRBASE, OVRROOT: OVRROOT, OVRBUF: OVRBUF,

	// the shipped planet with the fixture's mesh, clock and initial condition. It sets
	// neither P.contact nor P.slab: which kernel a leg runs is the leg's own claim.
	configure: function () {
		planet();
		P.kDamage = 0;                  // the failure law would break both lids' leading edges
		SIM.init(); SIM.reset();
		SIM.dt = P.sl.kyr / 1000;
		HALF = SIM.M.nx >> 1;
		WEDGE = 20;
		return SIM.M;
	},

	// the live planet at the shipped settings, for a census leg. Every value the shipped
	// planet is named here rather than inherited: a fixture that reaches this after a
	// controlled leg is otherwise measuring that leg's mesh.
	livePlanet: function () {
		planet();
		P.kDamage = 90;
		SIM.init(); SIM.reset();
		SIM.dt = P.sl.kyr / 1000;
		POOL.inventoryComp(S);
		return SIM.M;
	},

	// H is the conserved field and T the equilibrium mapping of it, so a fixture that wants a
	// temperature writes H (phase.js byT is the exact inverse of the kernel's byH)
	setT: function (p, T) { S.H[p] = PHASE.byT(T, S.y[p], S.cF[p], S.cW[p]).h; },

	// dT is the contrast prescribed across the trench: the subducting plate is colder by dT/2
	// and the override warmer by dT/2, so dT = 0 is the arrest leg and dT above P.contactdT
	// the subduction leg. The subducting plate is the left one.
	twoPlates: function (dT) {
		var nx = SIM.M.nx, dx = SIM.M.dx, half = HALF, wedge = WEDGE;
		var TS = 0.2 - dT * 0.5, TO = 0.2 + dT * 0.5;
		var p, i, strong, base;
		SIM.reset();
		for (p = 0; p < S.n; p++) {
			i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
			L.setT(p, 0.2); S.age[p] = 0;
			if (i < 4 || i >= nx - 4) continue;                 // the antimeridian: weak and cold
			if (i < half) {
				// the subducting plate: a lid whose base deepens toward the trench
				base = (i >= half - wedge) ? 250 : 200;
				strong = S.y[p] >= 150 && S.y[p] <= base;
				if (strong) { L.setT(p, TS); S.age[p] = 400; }
			} else {
				base = (i >= half + OVRBUF && i < half + wedge) ? OVRROOT : OVRBASE;
				strong = S.y[p] >= 65 && S.y[p] <= base;
				if (strong) { L.setT(p, TO); S.age[p] = 400; }
			}
		}
		// The prescription above writes enthalpy, but the kernels that read temperature read
		// S.T and the mesh field: G1's scatter builds Tg from S.T, and the contact pass takes
		// its arrest-or-subduct contrast from the parcels' own S.T. Only G4's equilibrium
		// mapping refreshes S.T from H, so without this the first frame of every leg scatters
		// the initial condition's hot interior into the mesh and reads no contrast at the
		// trench -- one frame, but it is the frame the leg's numbers start from.
		PHASE.equil(SIM.M, S);
		G.scatterT(SIM.M, S, S.Tg, S.mug);
	},

	// [0] is the subducting (deeper) plate, [1] the override
	plates: function () {
		var sub = -1, ovr = -1, c;
		for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200) {
			if (sub < 0 || S.csY[c] > S.csY[sub]) sub = c;
		}
		for (c = 0; c < S.csN; c++) if (S.csCnt[c] > 200 && c !== sub) {
			if (ovr < 0 || S.csY[c] < S.csY[ovr]) ovr = c;
		}
		return [sub, ovr];
	},

	// the ledger's stock side, compensated: what a closure gate reads
	books: function () {
		POOL.inventoryComp(S);
		return { M: S.invMTot, H: S.invHTot, F: S.invFTot, W: S.invWTot, L: S.invLTot,
			D: S.invDpM };
	},

	mean: function (a) {
		var s = 0, i;
		for (i = 0; i < a.length; i++) s += a[i];
		return a.length ? s / a.length : 0;
	}
};

module.exports = L;
