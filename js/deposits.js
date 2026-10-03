// deposits.js — 0.4.0/0.4.1 M3: deposit catalogue core, priors, snapshotSection and drilling.
// Ported from planet-geotectonics @ d909476 (0.4.0-sync-plan.md §2.5, 0.4.1-plan.md §5).
// Depth-resolved 2D projection of 3D deposit bodies along the section line.
'use strict';
var Deposits = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var P = node ? require('./params.js') : window.P;
	var S = node ? require('./state.js') : window.S;

	var HOSTS = ['none', 'oceanic', 'continental', 'thick continental', 'sediment'];
	var FAMILIES = ['vms', 'maf', 'arc', 'oro', 'bas', 'pla'];
	var POTENTIALS = ['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'];

	// 32-bit Murmur/FNV mixing
	function mix32(h, k) {
		h ^= Math.imul(k, 0xcc9e2d51);
		h = (h << 13) | (h >>> 19);
		return (Math.imul(h, 5) + 0xe6546b64) | 0;
	}
	function finalize32(h) {
		h ^= h >>> 16;
		h = Math.imul(h, 0x85ebca6b);
		h ^= h >>> 13;
		h = Math.imul(h, 0xc2b2ae35);
		h ^= h >>> 16;
		return h >>> 0;
	}
	function combine() {
		var h = 0x9e3779b9;
		for (var i = 0; i < arguments.length; i++) {
			var v = arguments[i];
			if (typeof v === 'string') {
				for (var j = 0; j < v.length; j++) h = mix32(h, v.charCodeAt(j));
			} else {
				h = mix32(h, v | 0);
			}
		}
		return finalize32(h);
	}
	function round6(v) {
		if (!isFinite(v) || v === 0) return v;
		return +v.toPrecision(6);
	}
	function fnvBytes(bytes, lanes) {
		var a = lanes[0], b = lanes[1];
		for (var i = 0; i < bytes.length; i++) {
			a = Math.imul(a ^ bytes[i], 16777619);
			b = Math.imul(b ^ bytes[i] ^ 0x5a, 0x01000193 + 2);
		}
		lanes[0] = a >>> 0; lanes[1] = b >>> 0;
		return lanes;
	}
	function hex(hi, lo) {
		return ('0000000' + hi.toString(16)).slice(-8) + ('0000000' + lo.toString(16)).slice(-8);
	}

	function prng(seed) {
		var s = seed >>> 0;
		return function () {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			return s / 4294967296;
		};
	}

	// Model prior ranges per family
	var MODELS = {
		vms: { threshold: 0.18, meanTon: 2.5e7, stdTon: 1.5e7, minTon: 1e6, maxTon: 1e8, meanGr: 0.024, minDepth: 20, maxDepth: 400, radius: 2.2 },
		maf: { threshold: 0.18, meanTon: 4.0e7, stdTon: 2.5e7, minTon: 2e6, maxTon: 2e8, meanGr: 0.018, minDepth: 500, maxDepth: 4500, radius: 3.5 },
		arc: { threshold: 0.18, meanTon: 8.0e7, stdTon: 5.0e7, minTon: 5e6, maxTon: 5e8, meanGr: 0.009, minDepth: 400, maxDepth: 3500, radius: 4.0 },
		oro: { threshold: 0.18, meanTon: 1.5e7, stdTon: 1.0e7, minTon: 5e5, maxTon: 8e7, meanGr: 0.005, minDepth: 1500, maxDepth: 6000, radius: 2.8 },
		bas: { threshold: 0.18, meanTon: 3.0e7, stdTon: 2.0e7, minTon: 1e6, maxTon: 1.5e8, meanGr: 0.004, minDepth: 200, maxDepth: 2500, radius: 3.0 },
		pla: { threshold: 0.15, meanTon: 8.0e6, stdTon: 5.0e6, minTon: 2e5, maxTon: 4e7, meanGr: 0.002, minDepth: 0, maxDepth: 150, radius: 1.8 }
	};

	var Deposits = {
		VERSION: 1,
		HOSTS: HOSTS,
		FAMILIES: FAMILIES,
		POTENTIALS: POTENTIALS,
		MODELS: MODELS,
		mix32: mix32,
		combine: combine,
		round: round6,
		fnvBytes: fnvBytes,
		hex: hex,

		hostClass: function (st, col) {
			if (st.colGhost && st.colGhost[col]) return 0;
			var tot = (st.hFel[col] || 0) + (st.hMaf[col] || 0) + (st.hSed[col] || 0);
			if (tot <= 0) return 0;
			if (st.hSed[col] > 2000 || st.hSed[col] > st.hFel[col]) return 4;
			if (st.hFel[col] > 35000) return 3;
			if (st.hFel[col] > 1000) return 2;
			return 1;
		},

		snapshotSection: function (st, opts) {
			st = st || S;
			opts = opts || {};
			var n = st.nCol, w0 = P.w0;
			var sKm = new Float64Array(n), zM = new Int32Array(n), hTot = new Int32Array(n);
			var age = new Float32Array(n), host = new Uint8Array(n), pot = new Float32Array(n * 6);
			var j, k, prev, next;
			for (j = 0; j < n; j++) {
				sKm[j] = round6(st.colX ? st.colX[j] / 1000 : (j * w0) / 1000);
				zM[j] = Math.round(st.z[j]);
				hTot[j] = Math.round(st.hTot[j]);
				age[j] = round6(st.colAge[j]);
				host[j] = Deposits.hostClass(st, j);
			}
			for (k = 0; k < 6; k++) {
				var fName = POTENTIALS[k], src = st[fName];
				for (j = 0; j < n; j++) {
					prev = (j - 1 + n) % n;
					next = (j + 1) % n;
					var val = src ? (0.25 * src[prev] + 0.5 * src[j] + 0.25 * src[next]) : 0;
					pot[j * 6 + k] = round6(val);
				}
			}
			var seed = opts.seed !== undefined ? (opts.seed | 0) : (P.seed | 0);
			var packChecksum = opts.packChecksum || 'local';
			var header = new Float64Array([seed >>> 0, Deposits.VERSION, n]);
			var lanes = fnvBytes(new Uint8Array(header.buffer), [0x811c9dc5, 0x9747b28c]);
			var strBytes = [];
			for (j = 0; j < packChecksum.length; j++) strBytes.push(packChecksum.charCodeAt(j));
			fnvBytes(new Uint8Array(strBytes), lanes);
			[sKm, zM, hTot, age, host, pot].forEach(function (a) {
				fnvBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), lanes);
			});
			var checksum = hex(lanes[0], lanes[1]);
			return {
				format: 'pgt-section-snapshot',
				version: Deposits.VERSION,
				seed: seed,
				packChecksum: packChecksum,
				nCol: n,
				sKm: sKm,
				zM: zM,
				hTot: hTot,
				age: age,
				host: host,
				pot: pot,
				checksum: checksum
			};
		},

		generateCatalogue: function (snap, opts) {
			opts = opts || {};
			var n = snap.nCol, bodies = [], j, k;
			for (j = 0; j < n; j++) {
				if (snap.host[j] === 0) continue;
				for (k = 0; k < 6; k++) {
					var fam = FAMILIES[k], mod = MODELS[fam];
					var pVal = snap.pot[j * 6 + k];
					if (pVal < mod.threshold) continue;
					var bSeed = combine(snap.seed, snap.version, snap.packChecksum, j, fam, 0);
					var rnd = prng(bSeed);
					var r3d = mod.radius * (0.8 + 0.4 * rnd());
					var yOut = (rnd() * 2 - 1) * mod.radius;
					if (Math.abs(yOut) > r3d) continue;
					var r2d = Math.sqrt(Math.max(0, r3d * r3d - yOut * yOut));
					var depth = mod.minDepth + rnd() * (mod.maxDepth - mod.minDepth);
					var tonFactor = (pVal - mod.threshold) / (1 - mod.threshold);
					var tonnage = mod.minTon + tonFactor * (mod.meanTon - mod.minTon) * (0.7 + 0.6 * rnd());
					var grade = mod.meanGr * (0.6 + 0.8 * rnd()) * (0.8 + 0.4 * pVal);
					var body = {
						id: 'dep-' + fam + '-' + j + '-' + (bSeed >>> 0).toString(16),
						col: j,
						sKm: round6(snap.sKm[j]),
						yM: Math.round(depth),
						zM: Math.round(snap.zM[j] - depth),
						family: fam,
						potential: round6(pVal),
						host: HOSTS[snap.host[j]],
						hostCode: snap.host[j],
						tonnage: round6(tonnage),
						grade: round6(grade),
						metalMass: round6(tonnage * grade),
						radiusKm: round6(r3d),
						projectedRadiusKm: round6(r2d),
						outOfPlaneKm: round6(yOut),
						packChecksum: snap.packChecksum
					};
					bodies.push(body);
				}
			}
			bodies.sort(function (a, b) {
				if (a.sKm !== b.sKm) return a.sKm - b.sKm;
				if (a.yM !== b.yM) return a.yM - b.yM;
				return a.family.localeCompare(b.family);
			});
			return bodies;
		},

		drill: function (st, col, maxDepthM, catalogue) {
			st = st || S;
			if (col < 0 || col >= st.nCol) return null;
			var nl = st.colNL[col], b = col * P.layerCap, beds = [], curY = 0;
			for (var i = nl - 1; i >= 0; i--) {
				var th = st.layTh[b + i], li = st.layLi[b + i], ag = st.layAg[b + i], fl = st.layFl[b + i];
				beds.push({
					layer: i,
					lith: li,
					thicknessM: round6(th),
					topYM: Math.round(curY),
					botYM: Math.round(curY + th),
					ageMyr: round6(ag),
					flags: fl
				});
				curY += th;
				if (maxDepthM && curY >= maxDepthM) break;
			}
			var hits = [];
			if (catalogue) {
				for (var d = 0; d < catalogue.length; d++) {
					var body = catalogue[d];
					if (body.col === col && (!maxDepthM || body.yM <= maxDepthM)) {
						hits.push(body);
					}
				}
			}
			return {
				col: col,
				sKm: round6(st.colX ? st.colX[col] / 1000 : (col * P.w0) / 1000),
				zSurfaceM: Math.round(st.z[col]),
				totalDepthM: Math.round(curY),
				beds: beds,
				deposits: hits
			};
		},

		probe: function (catalogue, sKm, yM, radiusKm) {
			if (!catalogue) return [];
			var hits = [];
			var r = radiusKm || 5.0;
			for (var i = 0; i < catalogue.length; i++) {
				var b = catalogue[i];
				var ds = Math.abs(b.sKm - sKm);
				if (ds <= (b.projectedRadiusKm || r)) hits.push(b);
			}
			return hits;
		}
	};

	return Deposits;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Deposits;
