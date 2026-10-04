// section-seed.js — 0.4.1 M2: the reconstruction. One verified pack becomes engine state:
// the cut laid on the section's own columns with an arc-length box filter, then the seeding
// table of 0.4.1-plan.md §4.3 (stacks, ages, potentials, plate runs, boundaries), the
// assumption record on S.recon (§4.3.3) and the volume ledger (§4.3.5).
//
// Two rules decide everything below.
//   The section keeps its own column count, because w0 is what the gap floor, the contact
//   radius, flexure (kf ∝ w0²) and collapse are calibrated at: the cut is resampled onto the
//   section's columns, never re-gridded to the source level (§4.3.1).
//   A resample may not invent anything. What the box filter, a cap or a merge cannot account
//   for goes to a named line, never into a neighbouring column — so an open window drops the
//   arc no whole column can hold and books it (clampedSpan stays 0, §4.4).
//
// Headless, and run once per cut rather than per frame, so the scratch below is allocated at
// module scope and the next cut reuses it. The clock is not touched here: it belongs to the
// page, which keeps this file free of SIM and of the DOM.
'use strict';
var SEED = (function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.P;
	var S = (typeof module !== 'undefined' && module.exports) ? require('./state.js') : window.S;
	var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : window.RNG;
	var COL = (typeof module !== 'undefined' && module.exports) ? require('./columns.js') : window.COL;
	var SURF = (typeof module !== 'undefined' && module.exports) ? require('./surface.js') : window.SURF;
	var PLT = (typeof module !== 'undefined' && module.exports) ? require('./plates.js') : window.PLT;
	var MNT = (typeof module !== 'undefined' && module.exports) ? require('./mantle.js') : window.MNT;
	var SP = (typeof module !== 'undefined' && module.exports) ? require('../port/slice-format.js') : window.SlicePack;
	var DEP = (typeof module !== 'undefined' && module.exports) ? require('./deposits.js') : window.Deposits;

	var KM = 1000;

	// The cut is stamped with the clock it was taken at. js/sim.js loads after this file in the
	// page (it is the bootstrap's last script), so the sim is asked for when a cut is written
	// rather than captured at load time — js/checkpoint.js's own rule.
	function simClock() {
		var s = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : window.SIM;
		return s ? s.t : 0;
	}

	// the continuous fields, in the accumulator's order, then the six potentials (the pack's one
	// stride-6 field). Every one is an arc-weighted mean: a thickness is intensive, so the widths
	// carry the mass and the values do not (0.4.0-sync-plan.md §4.2.2).
	var CF = ['hFelM', 'hMafM', 'hSedM', 'zM', 'ageMyr', 'fert', 'damage', 'vt', 'vp'];
	var NF = CF.length;
	var NC = NF + 6;
	var O = { fel: 0, maf: 1, sed: 2, z: 3, age: 4, fert: 5, dmg: 6, vt: 7, vp: 8 };

	var acc = new Float64Array(NC * P.colCap);
	var wsum = new Float64Array(P.colCap);
	var bestW = new Float64Array(P.colCap);
	var bestI = new Int32Array(P.colCap);
	var colRaw = new Int32Array(P.colCap);       // the pack's plate id, before the renumbering
	var zT = new Float64Array(P.colCap);         // the elevation the cut says the column stands at
	var uT = new Float64Array(P.colCap);         // the cut's speed along the path, per column
	var bndType = new Uint8Array(P.colCap);      // the boundary filed under a column's right edge
	var bndPol = new Int8Array(P.colCap);
	var bndScore = new Float64Array(P.colCap);
	var runA = new Int32Array(P.colCap + 1);      // a plate run is a start column and a length
	var runN = new Int32Array(P.colCap + 1);
	var runId = new Int32Array(P.colCap + 1);
	var srcArr = [];

	var SEED = {
		// the mapping version: bumped when a rule below changes, because two reconstructions of
		// one pack are only comparable at the same one (§4.3.3). v2 dates the three seed beds
		// at their formation time (clock t − the cut's rock age) instead of the raw rock age,
		// the one convention every bed writer in the engine shares (0.4.1-plan.md §4.3.2).
		MAP: 2,
		pack: null,         // the pack the current state came from
		t0: 0,              // the section's clock at the layout: imported beds date back from it
		scale: 1,           // the arc scale in force: wrap / arcKm for a closed cut, 1 for a window
		window: false,      // an open cut: no plate clock, because the engine has no end conditions
		nCut: 0,            // columns the cut covers; the rest of the ring is outside the cut
		tailKm: 0,          // the arc of a window that no whole column could take
		mapEquiv: 1,        // the seeded mass over the cut's mass: 1 to 1e-12 when the ring is covered
		runs: 0,            // plate runs along the cut, before the cap
		merges: 0,          // narrowest-run merges it took to fit plateCap
		platesFrom: new Int32Array(P.plateCap),   // engine plate -> the pack's plate id
		refused: ''         // why the last cut could not be laid, as the page shows it
	};

	// ---------------------------------------------------------------- how the cut fits
	// A closed cut is a great circle and the column engine's wrap *is* one (2π·6371 km), so the
	// only scale a circle needs is the float that six significant digits leave between arcKm and
	// P.wrap. A window is 1:1 or nothing: stretching it to the wrap would invent crust, so its
	// last partial column is dropped and booked instead (§4.4).
	SEED.measure = function (pack) {
		var arcM = pack.path.arcKm * KM, n;
		var windowCut = !pack.path.closes;
		if (windowCut && arcM > P.wrap) {
			return 'a window of ' + Math.round(arcM / KM) + ' km is longer than the section wrap of '
				+ Math.round(P.wrap / KM) + ' km, and only a closed cut may be scaled to it';
		}
		n = windowCut ? Math.floor(arcM / P.w0) : P.nCols;
		if (n < 3) return 'the cut covers ' + n + ' whole section columns; a section needs three '
			+ 'to hold a boundary and a margin on each side of it';
		SEED.window = windowCut;
		SEED.scale = windowCut ? 1 : P.wrap / arcM;
		SEED.nCut = n;
		SEED.tailKm = SEED.window ? (arcM - n * P.w0) / KM : 0;
		return '';
	};

	// The box filter. Sample i covers [sKm[i], sKm[i+1]) and the spans tile the cut, so every
	// column takes the arc-weighted mean of what fell inside it and Σ value·width over the columns
	// is Σ value·arc over the samples — which is why mass, not just shape, survives the transfer.
	SEED.filter = function (pack) {
		var n = pack.n, w0 = P.w0, sc = SEED.scale * KM, nCut = SEED.nCut, end = nCut * w0;
		var sKm = pack.sKm, i, j, k, xa, xb, lo, hi, w, base;
		for (k = 0; k < NF; k++) srcArr[k] = pack[CF[k]];
		acc.fill(0, 0, NC * nCut);
		wsum.fill(0, 0, nCut);
		bestW.fill(0, 0, nCut);
		bestI.fill(-1, 0, nCut);
		for (i = 0; i < n; i++) {
			xa = i === 0 ? 0 : sKm[i] * sc;
			xb = i + 1 < n ? sKm[i + 1] * sc : end;
			if (!(xb > xa)) continue;
			for (j = (xa / w0) | 0; j < nCut && j * w0 < xb; j++) {
				lo = xa > j * w0 ? xa : j * w0;
				hi = xb < (j + 1) * w0 ? xb : (j + 1) * w0;
				w = hi - lo;
				if (!(w > 0)) continue;
				wsum[j] += w;
				base = j * NC;
				for (k = 0; k < NF; k++) acc[base + k] += srcArr[k][i] * w;
				for (k = 0; k < 6; k++) acc[base + NF + k] += pack.pot[i * 6 + k] * w;
				if (w > bestW[j]) { bestW[j] = w; bestI[j] = i; }     // categorical: widest wins
			}
		}
		for (j = 0; j < nCut; j++) {
			base = j * NC;
			w = wsum[j] > 0 ? 1 / wsum[j] : 0;
			for (k = 0; k < NC; k++) acc[base + k] *= w;
			zT[j] = acc[base + O.z];
			uT[j] = acc[base + O.vt];
		}
	};

	// Each sample's bnd describes the crossing at the *end* of its span. The section holds one
	// boundary per column pair, so a crossing is filed under the pair it falls in and the fastest
	// one wins: an L7 cut carries more boundaries than the section has columns, and the losers are
	// booked rather than quietly overwritten (roadmap §2: a ledger is never silent).
	SEED.crossings = function (pack) {
		var n = pack.n, sc = SEED.scale * KM, nCut = SEED.nCut, i, x, b, score;
		bndType.fill(0, 0, nCut);
		bndPol.fill(0, 0, nCut);
		bndScore.fill(0, 0, nCut);
		for (i = 0; i < n; i++) {
			if (!pack.bnd[i]) continue;
			x = i + 1 < n ? pack.sKm[i + 1] * sc : (SEED.window ? pack.path.arcKm * sc : nCut * P.w0);
			b = Math.round(x / P.w0) - 1;
			if (SEED.window) {
				if (b < 0 || b > nCut - 2) { S.recon.bndCollapsed++; continue; }
			} else {
				b = ((b % nCut) + nCut) % nCut;
			}
			score = Math.abs(pack.vt[i + 1 < n ? i + 1 : 0] - pack.vt[i]);
			if (bndType[b] && score <= bndScore[b]) { S.recon.bndCollapsed++; continue; }
			if (bndType[b]) S.recon.bndCollapsed++;
			bndType[b] = pack.bnd[i];
			bndPol[b] = pack.pol[i];
			bndScore[b] = score;
		}
	};

	// Three beds, bottom-up mafic then felsic then sediment: the globe's columns carry aggregate
	// thicknesses and no stratigraphy, so every bed above these three is made by the section and
	// the page says so (§4.3.2). The cut gives a rock *age* at its own clock reading, the section
	// stores *formation time*, so each bed is dated at SEED.t0 − age — the one conversion between
	// the two vocabularies (plan §4.3.2). The globe gives no seed for a sediment age, so a
	// sediment bed inherits the crust's and books it.
	//
	// A gap sample (alive = 0) is *not* seeded as a trench sliver, which is what §4.3's row for
	// `alive` first asked for. It was tried: a hole spans several full-width columns, and the
	// engine retires a sliver by handing its territory to one neighbour, so one 202 km gap at L5
	// moved 50.7 km of crust across a column and 7.4 km of relief in a single frame at 10 kyr/f
	// (archive/0.4.1-section-worklog.md §2). The box filter's zero is the right hole at a section's
	// resolution: the gap thins the columns it covers, their mass is conserved, and the surface
	// passes through them at the elevation the cut named.
	SEED.stack = function (pack, j) {
		var base = j * NC, L = P.LITH, F = P.FLAG, i = bestI[j];
		var tf = SEED.t0 - acc[base + O.age];   // the clock read at which this rock formed
		var wet = i >= 0 && pack.wet[i], th;
		S.colNL[j] = 0;
		if (i >= 0 && !pack.alive[i]) S.recon.gapColumns++;   // crust the cut left thin, not a hole
		th = acc[base + O.maf];
		if (th > 0) COL.push(j, th, L.maf, tf, wet ? F.wet : 0);
		th = acc[base + O.fel];
		if (th > 0) COL.push(j, th, L.fel, tf, wet ? F.wet : 0);
		th = acc[base + O.sed];
		if (th > 0) {
			COL.push(j, th, L.sed, tf, wet ? F.wet : 0);
			S.recon.sedimentAge++;
		}
		COL.sums(j);
		if (S.hTot[j] > P.hCollapse) {
			// a plateau above the collapse thickness is imported as it stands: the seed does not
			// push the excess anywhere, it books it, and the collapse kernel spends it if run
			S.recon.overCollapse++;
			S.recon.overCollapseVol += (S.hTot[j] - P.hCollapse) * S.colW[j];
		}
		return 1;
	};

	function dropRun(k, r) {
		for (var j = k; j + 1 < r; j++) {
			runA[j] = runA[j + 1];
			runN[j] = runN[j + 1];
			runId[j] = runId[j + 1];
		}
		return r - 1;
	}

	// The runs of the pack's plate ids become the section's plate intervals. A plate the cut
	// crosses twice is two intervals here, because a section plate is one contiguous run of one
	// ring; `platesFrom` keeps which globe plate each came from, which is what a returned summary
	// has to be able to say (plan §8.3). More runs than plateCap merges the narrowest into its
	// wider neighbour (§4.3), and the merge is counted.
	SEED.plates = function (pack) {
		var n = SEED.nCut, j, k, p, r = 0, at, into, prev, next, sum, c;
		for (j = 0; j < n; j++) colRaw[j] = bestI[j] >= 0 ? pack.plate[bestI[j]] : 0;
		for (j = 0; j < n; j++) {
			if (r > 0 && colRaw[j] === runId[r - 1]) { runN[r - 1]++; continue; }
			runA[r] = j; runN[r] = 1; runId[r] = colRaw[j]; r++;
		}
		// a closed cut that leaves and re-enters the same plate across its own start is one interval
		if (!SEED.window && r > 1 && runId[0] === runId[r - 1]) {
			runN[r - 1] += runN[0];
			r = dropRun(0, r);
		}
		SEED.runs = r;
		SEED.merges = 0;
		while (r > P.plateCap && r > 1) {
			at = 0;
			for (j = 1; j < r; j++) if (runN[j] < runN[at]) at = j;
			prev = (at + r - 1) % r;
			next = (at + 1) % r;
			into = runN[prev] >= runN[next] ? prev : next;
			if (into === next) {
				// the union keeps the earlier start, so the id moves into the earlier slot
				runId[at] = runId[next];
				runN[at] += runN[next];
				r = dropRun(next, r);
			} else {
				runN[prev] += runN[at];
				r = dropRun(at, r);
			}
			SEED.merges++;
		}
		S.recon.shortPlateMerge = SEED.merges;
		S.nPl = r;
		for (p = 0; p < r; p++) {
			sum = 0;
			for (k = 0; k < runN[p]; k++) {
				c = (runA[p] + k) % n;
				S.colPlate[c] = p;
				sum += uT[c];
			}
			// the run mean of vt is the interval's speed; plUP starts where plU does so the first
			// frame has nothing to relax (the quiet start of §4.3.4)
			S.plU[p] = sum / runN[p];
			S.plUP[p] = S.plU[p];
			SEED.platesFrom[p] = runId[p];
		}
		for (j = 0; j < n; j++) S.colU[j] = S.plU[S.colPlate[j]];
		for (j = n; j < P.nCols; j++) { S.colPlate[j] = 0; S.colU[j] = 0; }
		COL.plates();
	};

	// The boundary state at each plate seam, from the crossings the cut carried. A seam with no
	// crossing is a contact the section calls neutral rather than inventing a trench, and the one
	// at the end of an open window is left unset: a window has no ends to reconcile.
	SEED.edges = function () {
		var n = SEED.nCut, last = SEED.window ? n - 1 : n, j, k;
		for (j = 0; j < last; j++) {
			k = j + 1 < n ? j + 1 : 0;
			S.edgeRelN[j] = S.colU[k] - S.colU[j];
			S.edgeRPlate[j] = S.colPlate[k];
			if (bndType[j]) {
				// a crossing the column resolution cannot place is lost, and said so
				if (S.colPlate[j] === S.colPlate[k]) { S.recon.bndLost++; continue; }
				S.edge[j] = bndType[j];
				S.edgePol[j] = bndPol[j];
			} else if (S.colPlate[j] !== S.colPlate[k]) {
				S.edge[j] = P.EDGE.neutral;
				S.recon.edgeFallback++;
			}
		}
	};

	// Everything below the base of the crust is the section's model, and each piece of it is
	// booked by name (§4.3.3): the fan lid follows colAge, the plumes follow the section's seed,
	// trenchDist is derived by the engine's own classifier pass, and the velocities the 1D cut
	// cannot use are counted rather than dropped.
	SEED.model = function (pack, o) {
		var j, vp, vt;
		for (j = 0; j < SEED.nCut; j++) {
			S.recon.subMohoThermal++;
			S.recon.mobileAbsent++;
			if (S.colAge[j] > COL.lidAgeCap) S.recon.lithosphereDepth++;
			if (bestI[j] >= 0 && (pack.zM[bestI[j]] < pack.sea.levelM ? 1 : 0) !== S.wet[j]) S.recon.seaDatumDisplay++;
		}
		for (j = 0; j < pack.n; j++) {
			vp = Math.abs(pack.vp[j]);
			vt = Math.abs(pack.vt[j]);
			if (vp > vt) S.recon.discardedNormalVelocity++;
		}
		COL.initFanT();
		MNT.initPlumes(S, o.seed);
		S.recon.plumeDefault = S.nPlm;
		MNT.setTime(o.t, o.Tm);
		MNT.columns(S);
		PLT.extension(S);
		PLT.trench(S);
	};

	// The volume ledger (§4.3.5): what the cut carries, against what the columns hold, with the
	// tail of a window as the third term. For a closed cut those two are one number to double
	// precision, which is the whole point of the box filter, and the fixture reads the pair from
	// here instead of re-deriving it. mapEquiv is the same statement as a ratio, for the HUD.
	SEED.ledger = function (pack) {
		var n = pack.n, sc = SEED.scale * KM, end = SEED.nCut * P.w0, arc = pack.path.arcKm * sc;
		var i, j, h, a, b, w, cut = 0, tail = 0, tot = 0;
		for (i = 0; i < n; i++) {
			h = pack.hFelM[i] + pack.hMafM[i] + pack.hSedM[i];
			a = i === 0 ? 0 : pack.sKm[i] * sc;
			b = i + 1 < n ? pack.sKm[i + 1] * sc : (SEED.window ? arc : end);
			w = b - a;
			if (!(w > 0)) continue;
			cut += h * w;
			if (b > end) tail += h * (b - (a > end ? a : end));
		}
		for (j = 0; j < SEED.nCut; j++) tot += S.hTot[j] * S.colW[j];
		SEED.cutMass = cut;
		SEED.seedMass = tot;
		SEED.tailVol = tail;
		SEED.mapEquiv = cut > 0 ? tot / cut : 1;
		S.recon.tailArcKm = SEED.tailKm;
		S.recon.tailVol = tail;
	};

	// ---------------------------------------------------------------- the entry point
	// One call per cut. A refusal comes out of `measure` before a single state field is written,
	// so a page that cannot lay a cut keeps the world it was showing (plan §4.1: no partial load).
	SEED.layout = function (pack, opts) {
		var bad = SEED.measure(pack);
		SEED.refused = bad;
		if (bad) return bad;
		var o = opts || {}, j, k, base;
		o.seed = o.seed === undefined ? P.seed : o.seed | 0;
		o.t = o.t === undefined ? 0 : +o.t;
		SEED.t0 = o.t;
		o.Tm = o.Tm === undefined ? P.Tm0 : +o.Tm;
		// one seed for the world the section lays. S.reset() seeds the drawing stream from
		// P.seed (the noise the cut inherits) and the plumes come from the same number, so the
		// page's ?seed= and this call's opts.seed have to agree or the section would carry two.
		P.seed = o.seed;
		SEED.pack = pack;
		S.reset();
		MNT.init(o.seed);
		SEED.filter(pack);
		SEED.crossings(pack);
		for (j = 0; j < SEED.nCut; j++) {
			base = j * NC;
			SEED.stack(pack, j);
			S.colAge[j] = acc[base + O.age];
			S.fert[j] = acc[base + O.fert];
			S.damage[j] = acc[base + O.dmg];
			for (k = 0; k < 6; k++) S[COL.oreFields[k]][j] = acc[base + NF + k];
			S.noise[j] = RNG.range(-1, 1);
		}
		// Outside the cut there is no data at all, so it is a hole rather than a modelled sea
		// floor. These may be sliver records where the ones inside the cut may not (§4.3): a
		// window's clock never runs (§4.4), so nothing retires them — and retiring one at full
		// width is the move the gap row above exists to avoid.
		for (j = SEED.nCut; j < P.nCols; j++) {
			S.colGhost[j] = 1;
			S.hDraw[j] = 0;
			S.recon.outsideCut++;
		}
		SEED.plates(pack);
		SEED.edges();
		// isostasy: the section computes its own surface from the seeded stacks and puts the
		// difference against the cut into zDyn, which makes |z − zM| an identity at frame 0 (§4.3.4)
		for (j = 0; j < SEED.nCut; j++) {
			S.zDyn[j] = 0;
			if (S.colGhost[j]) { zT[j] = 0; continue; }
			S.zDyn[j] = zT[j] - SURF.elev(j);
		}
		SURF.profile(0);
		SEED.model(pack, o);
		SEED.ledger(pack);
		return '';
	};

	// ---------------------------------------------------------------- export
	// M3 self round-trip: export the current column state as a verified pgt-slice-pack v1.
	SEED.exportSection = function (opts) {
		opts = opts || {};
		var n = S.nCol, w0 = P.w0, wrap = P.wrap, j, walk = 0;
		// The ring the engine actually has, not the nominal one: columns are added and retired, so
		// `colW` is not w0. Arc positions are the cumulative widths from the first column, because
		// `colX` is the engine's own unwrapped coordinate and can wrap at the seam; the widths sum
		// to the wrap, so the walk tiles [0, wrap]. The spacing is the widest span carried, which
		// is what the pack's own "the last sample is within a cell of the end" rule needs.
		var maxSpan = 0;
		for (j = 0; j < n; j++) if (S.colW[j] > maxSpan) maxSpan = S.colW[j];
		var path = {
			kind: 'circle', lat0: 0, lon0: 0, az0: 90, closes: true,
			arcKm: wrap / KM, cellKm: (maxSpan > w0 ? maxSpan : w0) / KM
		};
		var pack = SP.make(n, path);
		pack.source = {
			repo: 'planet-tectonics-2d-slice',
			commit: 'self-export',
			pack: opts.pack || 'column-engine',
			epochMa: 0,
			rotModel: '',
			built: new Date().toISOString(),
			tMyr: SP.round(opts.t !== undefined ? opts.t : simClock()),
			level: 6,
			gridSeed: P.seed,
			simSeed: P.seed
		};
		pack.license = 'CC0-1.0 column engine self-export';
		pack.sea = {
			mode: 'level',
			levelM: 0,
			volScale: 1
		};
		for (j = 0; j < n; j++) {
			pack.sKm[j] = SP.round(walk / KM);
			walk += S.colW[j];
			pack.zM[j] = Math.round(S.z[j]);
			pack.hFelM[j] = Math.round(S.hFel[j]);
			pack.hMafM[j] = Math.round(S.hMaf[j]);
			pack.hSedM[j] = Math.round(S.hSed[j]);
			pack.ageMyr[j] = SP.round(S.colAge[j]);
			pack.fert[j] = SP.round(S.fert[j]);
			pack.damage[j] = SP.round(S.damage[j]);
			// the host class has one owner (js/deposits.js), and it is applied to the numbers the
			// pack actually carries: classing the live floats would let a cut say "thick
			// continental" at 44 999.6 m while its own rounded sample reads 45 000
			pack.host[j] = DEP.hostCode(pack.hFelM[j], pack.hMafM[j], pack.hSedM[j], S.colGhost[j]);
			pack.plate[j] = S.colPlate[j];
			pack.bnd[j] = S.edge[j] || 0;
			pack.pol[j] = S.edgePol[j] || 0;
			pack.alive[j] = S.colGhost[j] ? 0 : 1;
			pack.wet[j] = S.wet[j] ? 1 : 0;
			pack.vt[j] = SP.round(S.colU[j]);
			// the ring has no out-of-plane motion, so vp (the field a globe cut fills) is 0
			pack.vp[j] = 0;
			pack.pot[j * 6 + 0] = SP.round(S.oVms[j]);
			pack.pot[j * 6 + 1] = SP.round(S.oMaf[j]);
			pack.pot[j * 6 + 2] = SP.round(S.oArc[j]);
			pack.pot[j * 6 + 3] = SP.round(S.oOro[j]);
			pack.pot[j * 6 + 4] = SP.round(S.oBas[j]);
			pack.pot[j * 6 + 5] = SP.round(S.oPla[j]);
		}
		var plateRuns = [];
		for (j = 0; j < n; j++) {
			var p = pack.plate[j];
			if (plateRuns.length === 0 || plateRuns[plateRuns.length - 1].id !== p) {
				plateRuns.push({ id: p, n: 1 });
			} else {
				plateRuns[plateRuns.length - 1].n++;
			}
		}
		pack.plates = plateRuns;
		SP.quantize(pack);
		pack.checksum = SP.checksum(pack);
		return pack;
	};

	return SEED;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SEED;
