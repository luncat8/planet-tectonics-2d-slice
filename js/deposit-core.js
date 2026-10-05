(function (root) {
// deposit-core.js — the deposit catalogue's deterministic core, extracted verbatim from
// planet-geotectonics @ d909476 (0.6.1) js/deposits.js: the hashing, the keyed draw, the
// truncated normal and the body geometry. The counterpart keeps these inline today, so this
// file is not in port/PORT.json (a shared file is one both sides assert byte-identical);
// until the extraction lands upstream it is pinned by experiments/fixtures/deposits-draws.json,
// which experiments/deposits.js replays: same key -> same draws, same draws -> same body.
//
// Only js/deposits.js reads this: the section's own parts (the snapshot on the ring, the
// along-the-cut tiling, the plane reduction, the instruments) stay in js/deposits.js, because
// upstream has no great circle to reduce onto.
'use strict';
var DepositCore = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var DM = node ? require('../port/deposit-models.js') : window.DepositModels;

	var Core = {
		MAX_DRAWS: 40,          // upstream Deposits.MAX_DRAWS: slots 0..39 of one candidate
		TRUNCATION: DM.truncationSigma,

		// The upstream finalizer: mixes a 32-bit word in place.
		mix32: function (h) {
			h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
			h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
			return (h ^ (h >>> 16)) >>> 0;
		},
		combine: function (h, key) {
			return Core.mix32((h ^ (key + 0x9e3779b9 + (h << 6) + (h >>> 2))) | 0);
		},
		// Fills `draws` with uniform (0,1) numbers keyed by the candidate alone, so a body's
		// geometry never depends on which other candidates were visited or accepted.
		drawCandidate: function (sc, tile, familyIndex, ordinal, draws) {
			var h = Core.combine(Core.combine(sc.seed, sc.version), tile);
			h = Core.combine(Core.combine(h, familyIndex), ordinal);
			for (var k = 0; k < Core.MAX_DRAWS; k++) {
				draws[k] = (Core.combine(h, k + 1) + 0.5) / 4294967296;
			}
			return draws;
		},
		// Normal score from two uniforms, truncated: the priors are truncated distributions.
		truncatedNormal: function (u1, u2) {
			var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			var limit = Core.TRUNCATION;
			return Math.max(-limit, Math.min(limit, z));
		},
		// Stored numbers carry six significant digits, so JSON round trips are exact.
		round: function (v) {
			return +v.toPrecision(6);
		},
		hex: function (hi, lo) {
			return ('0000000' + hi.toString(16)).slice(-8) + ('0000000' + lo.toString(16)).slice(-8);
		},
		// Two interleaved FNV-1a lanes over bytes: a 64-bit identity, not a security hash.
		fnvBytes: function (bytes, lanes) {
			var a = lanes[0], b = lanes[1];
			for (var i = 0; i < bytes.length; i++) {
				a = Math.imul(a ^ bytes[i], 16777619);
				b = Math.imul(b ^ bytes[i] ^ 0x5a, 0x01000193 + 2);
			}
			lanes[0] = a >>> 0; lanes[1] = b >>> 0;
			return lanes;
		},
		fnvText: function (text) {
			var a = 0x811c9dc5, b = 0x9747b28c;
			for (var i = 0; i < text.length; i++) {
				var c = text.charCodeAt(i);
				a = Math.imul(a ^ c, 16777619);
				b = Math.imul(b ^ c ^ 0x5a, 0x01000193 + 2);
			}
			return Core.hex(a >>> 0, b >>> 0);
		},

		// ------------------------------------------------------------------ body geometry
		// East-north-up unit axes: along strike, down dip, across (the cross product).
		axisUnits: function (strikeDeg, dipDeg, out) {
			var st = strikeDeg * Math.PI / 180, dp = dipDeg * Math.PI / 180;
			var sinS = Math.sin(st), cosS = Math.cos(st), sinD = Math.sin(dp), cosD = Math.cos(dp);
			out[0] = sinS; out[1] = cosS; out[2] = 0;
			out[3] = cosS * cosD; out[4] = -sinS * cosD; out[5] = -sinD;
			out[6] = out[1] * out[5] - out[2] * out[4]; out[7] = out[2] * out[3] - out[0] * out[5];
			out[8] = out[0] * out[4] - out[1] * out[3];
			return out;
		},
		// Half the vertical extent of the oriented ellipsoid (units are the axisUnits frame).
		verticalHalfExtent: function (axes, units) {
			var sum = 0;
			for (var k = 0; k < 3; k++) sum += axes[k] * axes[k] * units[k * 3 + 2] * units[k * 3 + 2];
			return Math.sqrt(sum);
		},
		metalTonnes: function (oreTonnes, grade, unit) {
			return oreTonnes * grade / (unit === '%' ? 100 : 1e6);
		},
		recoverableTonnes: function (metalTonnes, recovery) {
			return metalTonnes * recovery;
		},
		volumeOf: function (axes) {
			return 4 * Math.PI * axes[0] * axes[1] * axes[2] / 3;
		}
	};
	return Core;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DepositCore;
else root.COLDEPOSITCORE = DepositCore;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
