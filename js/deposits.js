// deposits.js — 0.4.1 M3: the section's deposit catalogue, the snapshot it is conditioned on
// and the instruments that read it (0.4.0-sync-plan.md §2.5, 0.4.1-plan.md §M3).
//
// The deterministic core (hashing, keyed draws, the truncated normal, the ellipsoid maths) is
// js/deposit-core.js, extracted verbatim from the counterpart; the priors and the economics
// scenario are port/deposit-models.js and port/deposit-economics.js, byte-identical with it.
// What this file owns is what the section has and the globe does not: a snapshot on the 1D
// ring, a tiling along the cut, the plane reduction of an ellipsoid, and drill/probe.
//
// The reduction is declared, not implied (§2.5.4): a body is a 3D ellipsoid whose centre may
// sit off the cut, and only what the plane can reach is listed. A candidate draws an
// out-of-plane offset and is invisible when that offset exceeds the ellipsoid's own support
// along the plane normal; a visible body keeps the projection of its ellipsoid onto the plane,
// which is an ellipse and a superset of the true intersection, so an instrument can only
// over-report, never miss. Everything a rejection throws away is counted, never swallowed:
// a null answer from an instrument is "not detected in this plane", never "not there".
'use strict';
var Deposits = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var P = node ? require('./params.js') : window.P;
	var S = node ? require('./state.js') : window.S;
	var SP = node ? require('../port/slice-format.js') : window.SlicePack;
	var DM = node ? require('../port/deposit-models.js') : window.DepositModels;
	var DE = node ? require('../port/deposit-economics.js') : window.DepositEconomics;
	var Core = node ? require('./deposit-core.js') : window.DepositCore;

	var KM = 1000;
	// Sub-tiles per column: a tile is a fixed span of the cut, not a column, so a click's tile
	// and a whole-section scan return the same bodies for it (plan §M3 gate). Four per column
	// is ~20 km of arc at the 78 km default column — finer than the globe's own 145 km tiles.
	var SUBTILE = 4;
	// The slab the section samples: a candidate's centre may sit this far off the cut, so the
	// catalogue covers bodies within one maximum body extent of the plane and nothing further.
	var SLAB_M = DM.maxExtentM;
	var POTENTIALS = ['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'];
	var POT_IDX = {};
	POTENTIALS.forEach(function (name, k) { POT_IDX[name] = k; });

	// scratch: one candidate's draws, its axes in the plane's basis, its footprint, and the
	// reason the last candidate died. Allocated once and mutated in place: the catalogue runs
	// once per cut, but the file's rule is the engine's rule.
	var draws = new Float64Array(Core.MAX_DRAWS);
	var frame = new Float64Array(9);
	var fp = { t: 0, u: 0, n: 0, t2: 0, tu: 0, u2: 0, det: 0 };
	var reject = { why: '' };
	var llA = [0, 0], llB = [0, 0];

	// The host classes, upstream's law on the section's own numbers. The pack's `host` field
	// is this same code, so a self-export and a globe cut stay comparable, and one owner for
	// the rule is why SEED.exportSection calls this instead of carrying its own if-chain.
	function hostCode(hFel, hMaf, hSed, ghost) {
		if (ghost) return 0;
		if (hSed > 2000 && hSed > hFel && hSed > hMaf) return 4;
		if (hFel >= P.hOceanic) return hFel > P.hOro ? 3 : 2;
		return hFel + hMaf + hSed > 0 ? 1 : 0;
	}

	// The body frame in the plane's own basis (t along the cut, u up, n across), from the
	// drawn strike relative to the cut's azimuth and the drawn dip. It is DepositCore.axisUnits
	// after the change of basis (t, u, n); experiments/deposits.js §C checks the two agree.
	function planeFrame(deltaDeg, dipDeg, out) {
		var d = deltaDeg * Math.PI / 180, p = dipDeg * Math.PI / 180;
		var cd = Math.cos(d), sd = Math.sin(d), cp = Math.cos(p), sp = Math.sin(p);
		out[0] = cd; out[1] = 0; out[2] = sd;                  // along strike
		out[3] = -sd * cp; out[4] = -sp; out[5] = cd * cp;     // down dip
		out[6] = out[1] * out[5] - out[2] * out[4];            // across = e1 x e2
		out[7] = out[2] * out[3] - out[0] * out[5];
		out[8] = out[0] * out[4] - out[1] * out[3];
		return out;
	}

	// The support of the ellipsoid {axes} along each plane axis, and the footprint's quadratic
	// form M = B B^T (entries t2 = M_tt, tu = M_tu, u2 = M_uu, in m^2): a point is inside the
	// projected ellipse when y^T M^-1 y <= 1, which drill() and probe() both use.
	function footprint(axes, u9, out) {
		var t0 = axes[0] * u9[0], t1 = axes[1] * u9[3], t2 = axes[2] * u9[6];
		var u0 = axes[0] * u9[1], u1 = axes[1] * u9[4], u2 = axes[2] * u9[7];
		var n0 = axes[0] * u9[2], n1 = axes[1] * u9[5], n2 = axes[2] * u9[8];
		out.t = Math.sqrt(t0 * t0 + t1 * t1 + t2 * t2);
		out.u = Math.sqrt(u0 * u0 + u1 * u1 + u2 * u2);
		out.n = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2);
		out.t2 = out.t * out.t;
		out.tu = t0 * u0 + t1 * u1 + t2 * u2;
		out.u2 = out.u * out.u;
		out.det = out.t2 * out.u2 - out.tu * out.tu;
		return out;
	}

	// Is (ds, dy) metres from the body's centre inside the footprint grown by rM? Growing by
	// M + r^2 I is the conservative superset of the ellipse's Minkowski sum with a disc of rM.
	function inFootprint(body, ds, dy, rM) {
		var t2 = body.fp.t2 + rM * rM, tu = body.fp.tu, u2 = body.fp.u2 + rM * rM;
		var det = t2 * u2 - tu * tu;
		if (!(det > 0)) return false;
		return u2 * ds * ds - 2 * tu * ds * dy + t2 * dy * dy <= det;
	}

	var Deposits = {
		FORMAT: 'pgt-section-catalogue',
		SNAPSHOT: 'pgt-section-snapshot',
		VERSION: DM.version,
		SUBTILE: SUBTILE,
		SLAB_M: SLAB_M,
		HOSTS: SP.HOSTS,
		FAMILIES: DM.families.map(function (f) { return f.key; }),
		POTENTIALS: POTENTIALS,
		MODELS: DM,
		ECONOMICS: DE,
		hostCode: hostCode,
		planeFrame: planeFrame,
		inFootprint: inFootprint,

		hostClass: function (st, col) {
			return hostCode(st.hFel[col], st.hMaf[col], st.hSed[col], st.colGhost && st.colGhost[col]);
		},

		// ---------------------------------------------------------------- the snapshot
		// Everything the generator reads about the world, frozen (upstream's Deposits.snapshot
		// rule): the blurred potentials, host, elevation, crust thickness and age, the arc
		// positions, the cut's forward azimuth at each column, and a checksum over all of it.
		// `opts.pack` is the verified slice pack the state was laid from: its path says where
		// on the globe the cut runs. A self-exported ring has no globe, and then the forward
		// direction is the path's own az0, which is what the exporter writes.
		snapshotSection: function (st, opts) {
			st = st || S;
			opts = opts || {};
			var n = st.nCol, w0 = P.w0, path = opts.pack ? opts.pack.path : null;
			var sKm = new Float64Array(n), az = new Float64Array(n);
			var zM = new Int32Array(n), thick = new Int32Array(n);
			var age = new Float32Array(n), host = new Uint8Array(n), pot = new Float32Array(n * 6);
			var j, k, prev, next, val, cnt;
			for (j = 0; j < n; j++) {
				sKm[j] = Core.round(st.colX[j] / KM);
				zM[j] = Math.round(st.z[j]);
				thick[j] = Math.round(st.hTot[j]);
				age[j] = Core.round(st.colAge[j]);
				host[j] = hostCode(st.hFel[j], st.hMaf[j], st.hSed[j], st.colGhost[j]);
				az[j] = 90;
				if (path) {
					SP.latLonAt({ path: path }, sKm[j] - 1, llA);
					SP.latLonAt({ path: path }, sKm[j] + 1, llB);
					az[j] = SP.azimuthBetween(llA[0], llA[1], llB[0], llB[1]);
				}
			}
			// one-cell blur, upstream's Extract.blur rule: a covered column averages itself and
			// its covered neighbours and an uncovered one stays 0, so a body cannot hide under
			// a gap. (The old fixed 0.25/0.5/0.25 weights were the same number except at a
			// ghost, where they diluted the mean with a hole.)
			for (k = 0; k < 6; k++) {
				var src = st[POTENTIALS[k]];
				for (j = 0; j < n; j++) {
					prev = (j - 1 + n) % n;
					next = (j + 1) % n;
					if (!src || host[j] === 0) { pot[j * 6 + k] = 0; continue; }
					val = src[j]; cnt = 1;
					if (host[prev] !== 0) { val += src[prev]; cnt++; }
					if (host[next] !== 0) { val += src[next]; cnt++; }
					pot[j * 6 + k] = Core.round(val / cnt);
				}
			}
			var snap = {
				format: Deposits.SNAPSHOT, version: Deposits.VERSION,
				seed: opts.seed === undefined ? P.seed | 0 : opts.seed | 0,
				packChecksum: opts.packChecksum || 'local',
				subtile: SUBTILE, nCol: n, arcKm: Core.round(n * w0 / KM),
				sKm: sKm, az: az, zM: zM, thick: thick, age: age, host: host, pot: pot, checksum: ''
			};
			snap.checksum = Deposits.snapshotChecksum(snap);
			return snap;
		},

		// The header the checksum covers, then the arrays. The pack checksum travels in the
		// hashed text, so two packs of the same seed and state are still two worlds.
		snapshotChecksum: function (snap) {
			var head = new Float64Array([snap.version, snap.seed, snap.subtile, snap.nCol, snap.arcKm]);
			var lanes = Core.fnvBytes(new Uint8Array(head.buffer), [0x811c9dc5, 0x9747b28c]);
			var text = snap.packChecksum, i, bytes = [];
			for (i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
			Core.fnvBytes(new Uint8Array(bytes), lanes);
			[snap.sKm, snap.az, snap.zM, snap.thick, snap.age, snap.host, snap.pot].forEach(function (a) {
				Core.fnvBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), lanes);
			});
			return Core.hex(lanes[0], lanes[1]);
		},

		describeSnapshot: function (snap) {
			return {
				format: snap.format, version: snap.version, seed: snap.seed,
				packChecksum: snap.packChecksum, nCol: snap.nCol, arcKm: snap.arcKm,
				subtile: snap.subtile, slabM: SLAB_M, checksum: snap.checksum
			};
		},

		// ---------------------------------------------------------------- the tiles
		// One tile = one fixed span of the cut (SUBTILE per column). Its bodies are a pure
		// function of (seed, version, packChecksum, tile, family, ordinal), so a click and a
		// scan cannot disagree and a re-import reproduces them in any order (§4.5).
		tileCount: function (snap) { return snap.subtile * snap.nCol; },

		tileKm: function (snap, tile) {
			var n = snap.nCol, sub = snap.subtile;
			return (tile / sub) * (snap.arcKm / n) + ((tile % sub) + 0.5) * (snap.arcKm / n) / sub;
		},

		scenarioKey: function (snap) {
			// the pack checksum enters as the 32-bit word the core's own FNV prints, folded in
			// with the core's own combine: the section's identity is (seed, version, pack,
			// tile, family, ordinal) and no hash is re-implemented here to say so
			return Core.combine(snap.seed | 0, parseInt(Core.fnvText(snap.packChecksum).slice(0, 8), 16) | 0);
		},

		// Every candidate of one tile, split by what became of it: `bodies` are the ones the
		// plane can show, the counters are the ones it cannot (and why). One implementation,
		// so the scan's counts and a click's bodies are the same run of the same code.
		tile: function (snap, tile) {
			var n = snap.nCol, sub = snap.subtile, j = (tile / sub) | 0, q = tile - j * sub;
			var out = { tile: tile, bodies: [], candidates: 0, accepted: 0, outOfPlane: 0, tooDeep: 0, tooLarge: 0 };
			if (j < 0 || j >= n) return out;
			var sM = Deposits.tileKm(snap, tile) * KM;
			var sc = { seed: Deposits.scenarioKey(snap), version: snap.version };
			var hostName = SP.HOSTS[snap.host[j]];
			for (var f = 0; f < DM.families.length; f++) {
				var family = DM.families[f], pi = POT_IDX[family.potential];
				if (!family || pi === undefined || family.hosts.indexOf(hostName) < 0) continue;
				var pot = snap.pot[j * 6 + pi], floor = DM.potentialFloor;
				if (pot < floor) continue;
				var accept = family.maxAccept * Math.pow(Math.min(1, (pot - floor) / (1 - floor)), family.acceptGamma);
				for (var o = 0; o < DM.slots; o++) {
					out.candidates++;
					Core.drawCandidate(sc, tile, f, o, draws);
					if (draws[0] >= accept) continue;
					out.accepted++;
					var body = Deposits.body(snap, family, tile, o, j, sM, pot);
					if (body) out.bodies.push(body);
					else if (reject.why === 'outOfPlane') out.outOfPlane++;
					else if (reject.why === 'tooDeep') out.tooDeep++;
					else if (reject.why === 'tooLarge') out.tooLarge++;
				}
			}
			out.bodies.sort(Deposits.compare);
			return out;
		},

		tileBodies: function (snap, tile, out) {
			var one = Deposits.tile(snap, tile), bodies = out || one.bodies;
			if (bodies === one.bodies) return bodies;
			for (var i = 0; i < one.bodies.length; i++) bodies.push(one.bodies[i]);
			return bodies;
		},

		// The body of one accepted candidate: upstream's candidate()/assemble() with the plane
		// reduction in the middle. Null when the priors put it elsewhere, with `reject.why` set.
		body: function (snap, family, tile, ordinal, j, sM, pot) {
			reject.why = '';
			var zTon = Core.truncatedNormal(draws[3], draws[4]);
			var oreTarget = Math.exp(Math.log(family.tonnage.median) + family.tonnage.sigmaLn * zTon +
				family.tonnage.favourGain * (pot - 0.5));
			var rb = family.axisRatio[0] * Math.exp(family.axisRatioSigmaLn * Core.truncatedNormal(draws[22], draws[23]));
			var rc = family.axisRatio[1] * Math.exp(family.axisRatioSigmaLn * Core.truncatedNormal(draws[24], draws[25]));
			var volumeTarget = oreTarget / (family.rockDensity * family.oreFraction);
			var a = Math.cbrt(3 * volumeTarget / (4 * Math.PI * rb * rc));
			var axes = [Core.round(a), Core.round(a * rb), Core.round(a * rc)];
			if (Math.max(axes[0], axes[1], axes[2]) > DM.maxExtentM) { reject.why = 'tooLarge'; return null; }
			var strike = 360 * draws[20];
			var dip = family.dipDeg[0] + (family.dipDeg[1] - family.dipDeg[0]) * draws[21];
			planeFrame(strike - snap.az[j], dip, frame);
			footprint(axes, frame, fp);
			var yOut = (draws[Core.MAX_DRAWS - 1] * 2 - 1) * SLAB_M;
			if (Math.abs(yOut) > fp.n) { reject.why = 'outOfPlane'; return null; }
			var vertical = 2 * fp.u;
			var crust = snap.thick[j], room = 0.9 * crust - vertical;
			if (room < 0) { reject.why = 'tooDeep'; return null; }
			var burial = Math.min(room, family.burial.median * Math.exp(family.burial.sigmaLn * Core.truncatedNormal(draws[26], draws[27])));
			var volume = Core.round(Core.volumeOf(axes));
			var ore = Core.round(volume * family.rockDensity * family.oreFraction);
			var commodities = [], c, m;
			for (c = 0; c < family.commodities.length; c++) {
				m = family.commodities[c];
				var eps = Core.truncatedNormal(draws[5 + 2 * c], draws[6 + 2 * c]);
				var grade = Core.round(m.median * Math.exp(m.sigmaLn * (m.tonnageGradeCorr * zTon +
					Math.sqrt(1 - m.tonnageGradeCorr * m.tonnageGradeCorr) * eps)));
				commodities.push({ id: m.id, unit: m.unit, grade: grade,
					metalTonnes: Core.round(Core.metalTonnes(ore, grade, m.unit)) });
			}
			var id = 'D' + snap.packChecksum.slice(0, 8) + '-' + ('0000' + tile).slice(-5) + '-' + family.key + '-' + ordinal;
			return {
				id: id, tile: tile, col: j, family: family.key, host: SP.HOSTS[snap.host[j]],
				potential: Core.round(pot), sKm: Core.round(sM / KM),
				burialTopM: Core.round(burial), yM: Core.round(burial + fp.u),
				axesM: axes, strikeDeg: Core.round(strike), dipDeg: Core.round(dip),
				outOfPlaneKm: Core.round(yOut / KM),
				planeHalfExtentM: Core.round(Math.sqrt((fp.t2 + fp.u2 + Math.sqrt((fp.t2 - fp.u2) * (fp.t2 - fp.u2) + 4 * fp.tu * fp.tu)) / 2)),
				fp: { t2: fp.t2, tu: fp.tu, u2: fp.u2, n2: fp.n * fp.n },
				crustThicknessM: crust, waterDepthM: Core.round(Math.max(0, -snap.zM[j])),
				volumeM3: volume, rockDensityTm3: family.rockDensity, oreFraction: family.oreFraction,
				oreTonnes: ore, commodities: commodities,
				ageMa: Deposits.formationAge(family, SP.HOSTS[snap.host[j]], snap.age[j], draws[28]),
				packChecksum: snap.packChecksum, confidence: 'synthetic', status: family.status
			};
		},

		formationAge: function (family, hostName, crustAge, draw) {
			var lo = family.ageMa.min, hi = family.ageMa.max;
			if (hostName === 'oceanic') hi = Math.max(lo, Math.min(hi, crustAge));
			var age = lo + (hi - lo) * draw, width = Math.max(1, 0.1 * age);
			return [Core.round(Math.max(0, age - width)), Core.round(age + width)];
		},

		compare: function (a, b) {
			return a.sKm !== b.sKm ? a.sKm - b.sKm : a.yM !== b.yM ? a.yM - b.yM :
				(a.family < b.family ? -1 : a.family > b.family ? 1 : 0);
		},

		// ---------------------------------------------------------------- the catalogue
		// The whole-section scan: every tile in index order, with its counters summed, so the
		// HUD can say what the reduction cost and a click's tile still yields its own bodies.
		generateCatalogue: function (snap, opts) {
			opts = opts || {};
			var tiles = Deposits.tileCount(snap), bodies = [], one, i, k;
			var sum = { candidates: 0, accepted: 0, outOfPlane: 0, tooDeep: 0, tooLarge: 0 };
			for (i = 0; i < tiles; i++) {
				one = Deposits.tile(snap, i);
				for (k = 0; k < one.bodies.length; k++) bodies.push(one.bodies[k]);
				sum.candidates += one.candidates; sum.accepted += one.accepted;
				sum.outOfPlane += one.outOfPlane; sum.tooDeep += one.tooDeep; sum.tooLarge += one.tooLarge;
			}
			bodies.sort(Deposits.compare);
			var cat = {
				format: Deposits.FORMAT, version: Deposits.VERSION, seed: snap.seed,
				packChecksum: snap.packChecksum, snapshot: snap.checksum,
				tiles: tiles, slots: DM.slots, subtile: snap.subtile, slabM: SLAB_M,
				candidates: sum.candidates, accepted: sum.accepted,
				inPlane: bodies.length, outOfPlane: sum.outOfPlane,
				tooDeep: sum.tooDeep, tooLarge: sum.tooLarge,
				bodies: bodies, checksum: ''
			};
			cat.checksum = Core.fnvText(JSON.stringify(bodies));
			if (opts.describe !== false) cat.snapshotMeta = Deposits.describeSnapshot(snap);
			return cat;
		},

		// A catalogue without its scenario: answers queries for the tiles it carries. The
		// checksum covers the bodies, so a truncated export is refused before it is used.
		json: function (cat) {
			return JSON.stringify({
				format: cat.format,
				generator: {
					version: cat.version, seed: cat.seed, packChecksum: cat.packChecksum,
					snapshot: cat.snapshotMeta, tiles: cat.tiles, slots: cat.slots,
					subtitle: cat.subtile, slabM: cat.slabM
				},
				snapshot: cat.snapshot, candidates: cat.candidates, accepted: cat.accepted,
				inPlane: cat.inPlane, outOfPlane: cat.outOfPlane, tooDeep: cat.tooDeep,
				tooLarge: cat.tooLarge, count: cat.bodies.length, checksum: cat.checksum,
				bodies: cat.bodies
			});
		},

		parse: function (text) {
			var rec = JSON.parse(text), gen = rec.generator;
			if (rec.format !== Deposits.FORMAT) throw new Error('not a section deposit catalogue');
			if (!gen || gen.version !== Deposits.VERSION) throw new Error('generator version ' + (gen && gen.version));
			if (gen.snapshot && gen.snapshot.slabM !== SLAB_M) throw new Error('reduction mismatch: slab ' + gen.snapshot.slabM);
			if (!rec.bodies || rec.count !== rec.bodies.length || Core.fnvText(JSON.stringify(rec.bodies)) !== rec.checksum) {
				throw new Error('catalogue checksum mismatch');
			}
			for (var i = 0; i < rec.bodies.length; i++) {
				var why = Deposits.validate(rec.bodies[i]);
				if (why) throw new Error(rec.bodies[i].id + ': ' + why);
			}
			return rec;
		},

		validate: function (b) {
			var family = null, i;
			for (i = 0; i < DM.families.length; i++) if (DM.families[i].key === b.family) family = DM.families[i];
			if (!family) return 'unknown family ' + b.family;
			if (!(b.axesM && b.axesM.length === 3 &&
				b.axesM.every(function (v) { return v > 0 && v <= DM.maxExtentM; }))) return 'axes';
			if (!(b.burialTopM >= 0 && b.waterDepthM >= 0 && b.crustThicknessM > 0)) return 'depth';
			if (family.hosts.indexOf(b.host) < 0) return 'host ' + b.host;
			if (!(b.potential >= DM.potentialFloor && b.potential <= 1)) return 'potential';
			if (!(b.sKm >= 0) || !(b.yM > 0)) return 'position';
			if (!(b.fp && b.fp.t2 >= 0 && b.fp.u2 >= 0 && b.fp.t2 * b.fp.u2 - b.fp.tu * b.fp.tu >= 0)) return 'footprint';
			if (!(Math.abs(b.yM - b.burialTopM - Math.sqrt(b.fp.u2)) <= 1)) return 'centre below the burial top';
			if (!(b.rockDensityTm3 > 0 && b.oreFraction > 0 && b.oreFraction <= 1)) return 'density or ore fraction';
			if (!b.commodities || b.commodities.length !== family.commodities.length) return 'commodity count';
			if (!(b.ageMa[0] >= 0 && b.ageMa[1] >= b.ageMa[0])) return 'age range';
			var ore = Core.round(Core.round(Core.volumeOf(b.axesM)) * b.rockDensityTm3 * b.oreFraction);
			if (Math.abs(ore - b.oreTonnes) > 1e-5 * ore) return 'ore tonnes disagree with the envelope';
			for (i = 0; i < b.commodities.length; i++) {
				var m = b.commodities[i], want = family.commodities[i];
				if (!(m.grade > 0) || m.id !== want.id || m.unit !== want.unit) return 'grade';
				var metal = Core.metalTonnes(b.oreTonnes, m.grade, m.unit);
				if (Math.abs(metal - m.metalTonnes) > 1e-5 * metal) return 'metal tonnes disagree with grade';
			}
			return '';
		},

		// ---------------------------------------------------------------- instruments
		// A drill is a vertical line at one arc position: the beds of the column it stands in,
		// and every body whose footprint the line crosses, with the depth interval it crosses it
		// over. The page drills at a column's own arc (columnKm below).
		drill: function (st, sKm, maxDepthM, catalogue) {
			st = st || S;
			var n = st.nCol, col = -1, j;
			for (j = 0; j < n; j++) {
				if (sKm >= st.colX[j] / KM && sKm < (st.colX[j] + (st.colW[j] || P.w0)) / KM) { col = j; break; }
			}
			if (col < 0) return null;
			var nl = st.colNL[col], b = col * P.layerCap, beds = [], curY = 0, i, th;
			for (i = nl - 1; i >= 0; i--) {
				th = st.layTh[b + i];
				beds.push({
					layer: i, lith: st.layLi[b + i], thicknessM: Core.round(th),
					topYM: Math.round(curY), botYM: Math.round(curY + th),
					formedMyr: Core.round(st.layAg[b + i]), flags: st.layFl[b + i]
				});
				curY += th;
				if (maxDepthM && curY >= maxDepthM) break;
			}
			var hits = [], sM = sKm * KM, body, ds, a, bb, c, disc, y0, y1, top, bot;
			if (catalogue && catalogue.bodies) {
				for (i = 0; i < catalogue.bodies.length; i++) {
					body = catalogue.bodies[i];
					ds = sM - body.sKm * KM;
					a = body.fp.t2;
					if (!(a > 0)) continue;
					bb = -2 * body.fp.tu * ds;
					c = body.fp.u2 * ds * ds - (a * body.fp.u2 - body.fp.tu * body.fp.tu);
					disc = bb * bb - 4 * a * c;
					if (!(disc >= 0)) continue;
					y0 = (-bb - Math.sqrt(disc)) / (2 * a);
					y1 = (-bb + Math.sqrt(disc)) / (2 * a);
					top = body.yM + Math.min(y0, y1);
					bot = body.yM + Math.max(y0, y1);
					if (maxDepthM && top > maxDepthM) continue;
					if (maxDepthM && bot > maxDepthM) bot = maxDepthM;
					hits.push({
						id: body.id, family: body.family, topM: Math.round(top), botM: Math.round(bot),
						centreM: body.yM, offsetKm: Core.round(ds / KM), oreTonnes: body.oreTonnes
					});
				}
			}
			return {
				col: col, sKm: Core.round(sKm), zSurfaceM: Math.round(st.z[col]),
				totalDepthM: Math.round(curY), beds: beds, deposits: hits
			};
		},

		columnKm: function (st, col) { return (st.colX[col] + (st.colW[col] || P.w0) * 0.5) / KM; },

		// A footprint instrument (magnetic, EM, seismic) keeps its reach in along-section
		// distance and depth: every body whose projected ellipse comes within `radiusKm`.
		probe: function (catalogue, sKm, yM, radiusKm) {
			if (!catalogue || !catalogue.bodies) return [];
			var rM = radiusKm === undefined ? 5 * KM : radiusKm * KM, hits = [];
			for (var i = 0; i < catalogue.bodies.length; i++) {
				var b = catalogue.bodies[i];
				if (Math.abs(yM - b.yM) > Math.sqrt(b.fp.u2) + rM) continue;
				if (inFootprint(b, sKm * KM - b.sKm * KM, yM - b.yM, rM)) hits.push(b);
			}
			return hits;
		},

		// The one-line ledger the page shows, then the biggest bodies.
		summary: function (cat, top) {
			var counts = {}, ranked = cat.bodies.slice().sort(function (a, b) { return b.oreTonnes - a.oreTonnes; });
			var i, lines = [];
			for (i = 0; i < cat.bodies.length; i++) counts[cat.bodies[i].family] = (counts[cat.bodies[i].family] || 0) + 1;
			lines.push(cat.bodies.length + ' in plane of ' + cat.candidates + ' candidates (' +
				cat.accepted + ' accepted, ' + cat.outOfPlane + ' out of plane, ' + cat.tooDeep +
				' deeper than the crust, ' + cat.tooLarge + ' too large) · ' + JSON.stringify(counts) +
				' · ' + cat.checksum);
			for (i = 0; i < top && i < ranked.length; i++) {
				var b = ranked[i], grades = b.commodities.map(function (m) { return m.id + ' ' + m.grade + m.unit; }).join(', ');
				lines.push(b.id + '  ' + (b.oreTonnes / 1e6).toFixed(1) + ' Mt  ' + grades + '  ' + b.family +
					'  ' + b.sKm.toFixed(0) + ' km · ' + Math.round(b.yM) + ' m deep');
			}
			return lines;
		}
	};

	return Deposits;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Deposits;
