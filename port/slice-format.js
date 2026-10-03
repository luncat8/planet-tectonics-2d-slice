/* slice-format.js — pgt-slice-pack v1: the field table, the quantisation, the checksum and the
   validation of one section pack. Pure: no DOM, no engine, no state, guarded module.exports.

   Shared-identical with planet-geotectonics (port/PORT.json, sync plan §1.2). The globe
   writes a pack and the section reads one, so the table that says what a field is called,
   in which order, in which unit and at which precision cannot live on either side alone:
   it is either one file or two opinions. Nothing here knows a grid, a page or a canvas,
   which is exactly why it can be the shared one.

   Shared files live in port/ and page modules in js/, so experiments/smoke.js keeps its
   meaning ("columns.html loads every js/*.js exactly once" — a pack format is not a page
   module) and the manifest has one directory to list.

   Number rule: six significant digits (the upstream Deposits.round convention), so a JSON
   round trip is exact and the same cut yields the same bytes on another machine.

   The checksum is the upstream's two-lane FNV-1a (Deposits.fnvBytes / Deposits.hex) over
   the header scalars, the source commit, the license line and the quantised buffers: a
   64-bit identity over what the pack says, not a security hash — it exists so two
   machines can agree that they hold the same cut. A cut is a snapshot and it says what
   it is a snapshot of (0.4.1-plan.md §1.4): world time, epoch, level, both seeds, the
   source commit and the license travel with it, and the checksum covers all of it.
*/
'use strict';

var SlicePack = {
	FORMAT: 'pgt-slice-pack',
	VERSION: 1,
	R_KM: 6371,
	// Host classes, the upstream Deposits.HOSTS order: a code, never a string, so the
	// checksum sees bytes and a reader on either side indexes the same table.
	HOSTS: ['none', 'oceanic', 'continental', 'thick continental', 'sediment'],
	// Boundaries in the section's vocabulary (P.EDGE in the column engine).
	EDGE: { none: 0, neutral: 1, open: 2, subduct: 3, collide: 4 },
	// The globe's Edges enumeration, mapped by edgeCode() below. A convergent edge is a
	// subduction or a collision depending on its polarity, which is the one conversion in
	// the whole pack that is not a straight copy.
	GLOBE_EDGE: { interior: 0, convergent: 1, divergent: 2, transform: 3 },
	// Header scalars the checksum covers, in this order, with where each one lives on the
	// pack. The scalars are not top-level (they sit under path./source.), so the checksum
	// reads them through the location table; a scalar that is missing hashes as 0, which
	// is exactly what validate() then refuses, so the table cannot quietly drop coverage.
	HEAD: [
		['n', 'n'],
		['arcKm', 'path.arcKm'],
		['cellKm', 'path.cellKm'],
		['closes', 'path.closes'],
		['epochMa', 'source.epochMa'],
		['tMyr', 'source.tMyr'],
		['level', 'source.level'],
		['gridSeed', 'source.gridSeed'],
		['simSeed', 'source.simSeed']
	],
	// Text the checksum covers after the scalars: a different source commit or a different
	// license line is a different cut, even over identical buffers.
	TEXT: ['source.commit', 'license'],
	// Per-sample columnar arrays, in the order the checksum walks them. `stride` marks the
	// one field that is six numbers per sample (the six ore potentials, ORE order).
	FIELDS: [
		{ name: 'sKm', dtype: 'f64', unit: 'km', what: 'arc length from the start of the cut' },
		{ name: 'zM', dtype: 'i32', unit: 'm', what: 'surface elevation, dynamic topography included' },
		{ name: 'hFelM', dtype: 'i32', unit: 'm', what: 'felsic crust thickness' },
		{ name: 'hMafM', dtype: 'i32', unit: 'm', what: 'mafic crust thickness' },
		{ name: 'hSedM', dtype: 'i32', unit: 'm', what: 'sediment thickness' },
		{ name: 'ageMyr', dtype: 'f32', unit: 'Myr', what: 'lithosphere thermal age' },
		{ name: 'fert', dtype: 'f32', unit: '-', what: 'ore fertility, fixed at birth upstream' },
		{ name: 'damage', dtype: 'f32', unit: '-', what: 'accumulated weakening, 0..1' },
		{ name: 'host', dtype: 'u8', unit: 'code', what: 'index into HOSTS' },
		{ name: 'plate', dtype: 'u16', unit: 'id', what: 'upstream plate id; renumbered on load' },
		{ name: 'bnd', dtype: 'u8', unit: 'code', what: 'EDGE code of the boundary to the next sample' },
		{ name: 'pol', dtype: 'i8', unit: 'sign', what: 'subduction polarity: -1/0/+1, the +s side under' },
		{ name: 'alive', dtype: 'u8', unit: 'flag', what: '0 where the cut crossed an uncovered gap' },
		{ name: 'wet', dtype: 'u8', unit: 'flag', what: 'below the displayed sea level' },
		{ name: 'vt', dtype: 'f32', unit: 'm/Myr', what: 'velocity along the cut' },
		{ name: 'vp', dtype: 'f32', unit: 'm/Myr', what: 'out-of-plane speed magnitude: what the section cannot see' },
		{ name: 'pot', dtype: 'f32', unit: '-', stride: 6, what: 'six ore potentials, oVms oMaf oArc oOro oBas oPla' }
	],
	DTYPE: {
		f32: Float32Array, f64: Float64Array,
		i8: Int8Array, u8: Uint8Array, u16: Uint16Array, i32: Int32Array
	}
};

// six significant digits, the upstream convention: a stored number round-trips through JSON
function round6(v) {
	if (!isFinite(v) || v === 0) return v;
	return +v.toPrecision(6);
}
SlicePack.round = round6;

SlicePack.hex = function (hi, lo) {
	return ('0000000' + hi.toString(16)).slice(-8) + ('0000000' + lo.toString(16)).slice(-8);
};
// two interleaved FNV-1a lanes over bytes (the upstream Deposits.fnvBytes, byte for byte)
SlicePack.fnvBytes = function (bytes, lanes) {
	var a = lanes[0], b = lanes[1];
	for (var i = 0; i < bytes.length; i++) {
		a = Math.imul(a ^ bytes[i], 16777619);
		b = Math.imul(b ^ bytes[i] ^ 0x5a, 0x01000193 + 2);
	}
	lanes[0] = a >>> 0; lanes[1] = b >>> 0;
	return lanes;
};

// The globe's edge code and polarity -> the section's EDGE. A convergent boundary whose
// polarity says "neither side wins" is a collision; everything else copies straight over.
SlicePack.edgeCode = function (globeType, polarity) {
	if (globeType === SlicePack.GLOBE_EDGE.convergent) return polarity === 2 ? SlicePack.EDGE.collide : SlicePack.EDGE.subduct;
	if (globeType === SlicePack.GLOBE_EDGE.divergent) return SlicePack.EDGE.open;
	if (globeType === SlicePack.GLOBE_EDGE.transform) return SlicePack.EDGE.neutral;
	return SlicePack.EDGE.none;
};

// An empty pack with every array allocated at the declared dtype. `path` is the cutter's
// own block (kind, lat0, lon0, az0 or verts, closes, arcKm, cellKm); make() does not
// second-guess it, validate() does.
SlicePack.make = function (n, path) {
	var pack = {
		format: SlicePack.FORMAT, version: SlicePack.VERSION,
		source: { repo: '', commit: '', pack: '', epochMa: 0, rotModel: '', built: '', tMyr: 0, level: 0, gridSeed: 0, simSeed: 0 },
		path: path || { kind: 'circle', lat0: 0, lon0: 0, az0: 0, closes: true, arcKm: 0, cellKm: 0 },
		planet: { rKm: SlicePack.R_KM },
		sea: { mode: 'level', levelM: 0, volScale: 1 },
		plates: [],
		n: n,
		checksum: '',
		license: ''
	};
	for (var k = 0; k < SlicePack.FIELDS.length; k++) {
		var f = SlicePack.FIELDS[k], len = n * (f.stride || 1);
		pack[f.name] = new SlicePack.DTYPE[f.dtype](len);
	}
	return pack;
};

// Plain arrays (a hand-written pack, or one that came out of JSON.parse) -> the declared
// dtype, in place. Idempotent: an already-typed pack is left alone.
SlicePack.normalize = function (pack) {
	for (var k = 0; k < SlicePack.FIELDS.length; k++) {
		var f = SlicePack.FIELDS[k], want = SlicePack.DTYPE[f.dtype], have = pack[f.name];
		if (!have) { pack[f.name] = new want(pack.n * (f.stride || 1)); continue; }
		if (have.constructor !== want) pack[f.name] = new want(have);
	}
	return pack;
};

// Quantise every field in place. Called by the writer before the checksum and by the reader
// after decode, so a number that travelled through JSON is the number that was hashed.
// The header scalars round too: the checksum covers them, and a world clock that drifts
// in its last ulp must not become a different cut.
SlicePack.quantize = function (pack) {
	for (var k = 0; k < SlicePack.FIELDS.length; k++) {
		var f = SlicePack.FIELDS[k], a = pack[f.name], isFloat = f.dtype === 'f32' || f.dtype === 'f64';
		if (!isFloat) continue;
		for (var i = 0; i < a.length; i++) a[i] = round6(a[i]);
	}
	var p = pack.path, s = pack.source;
	if (p) {
		p.arcKm = round6(p.arcKm); p.cellKm = round6(p.cellKm);
		if (p.kind === 'circle') { p.lat0 = round6(p.lat0); p.lon0 = round6(p.lon0); p.az0 = round6(p.az0); }
		if (p.verts) for (i = 0; i < p.verts.length; i++) p.verts[i] = round6(p.verts[i]);
	}
	if (s) {
		s.epochMa = round6(s.epochMa); s.tMyr = round6(s.tMyr);
		s.level = round6(s.level); s.gridSeed = round6(s.gridSeed); s.simSeed = round6(s.simSeed);
	}
	return pack;
};

// Walk a dotted location ('path.arcKm') on the pack.
function at(pack, loc) {
	var v = pack, parts = loc.split('.'), i;
	for (i = 0; i < parts.length; i++) {
		if (v === undefined || v === null) return undefined;
		v = v[parts[i]];
	}
	return v;
}
// UTF-8 without a TextEncoder dependency (file://, node and the browser must agree byte
// for byte — the checksum is the identity that lets two machines compare cuts).
function utf8(str, out) {
	var i, c;
	for (i = 0; i < str.length; i++) {
		c = str.charCodeAt(i);
		if (c < 0x80) out.push(c);
		else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
		else if (c >= 0xd800 && c < 0xdc00 && i + 1 < str.length) {
			c = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
			out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
		} else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
	}
	return out;
}
var _head = new Float64Array(SlicePack.HEAD.length), _u8 = [];

SlicePack.checksum = function (pack) {
	var i, k, a, v, t;
	for (i = 0; i < SlicePack.HEAD.length; i++) {
		v = at(pack, SlicePack.HEAD[i][1]);
		if (v === undefined || v === null) _head[i] = 0;
		else if (v === true) _head[i] = 1;
		else if (v === false) _head[i] = 0;
		else { v = +v; _head[i] = isFinite(v) ? v : 0; }
	}
	var lanes = SlicePack.fnvBytes(new Uint8Array(_head.buffer), [0x811c9dc5, 0x9747b28c]);
	for (i = 0; i < SlicePack.TEXT.length; i++) {
		t = at(pack, SlicePack.TEXT[i]);
		_u8.length = 0;
		SlicePack.fnvBytes(new Uint8Array(utf8(t == null ? '' : String(t), _u8)), lanes);
	}
	for (k = 0; k < SlicePack.FIELDS.length; k++) {
		a = pack[SlicePack.FIELDS[k].name];
		if (!a) continue;
		SlicePack.fnvBytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), lanes);
	}
	return SlicePack.hex(lanes[0], lanes[1]);
};

// The envelope and the ranges, in the order a reader needs them. Returns '' when the pack is
// loadable and the first reason it is not otherwise — one message, not a list, because the
// page shows it in one line.
SlicePack.validate = function (pack) {
	if (!pack || pack.format !== SlicePack.FORMAT) return 'not a ' + SlicePack.FORMAT + ' (' + (pack && pack.format) + ')';
	if (pack.version !== SlicePack.VERSION) return 'pack version ' + pack.version + ', this build reads ' + SlicePack.VERSION;
	if (!pack.license) return 'the pack carries no license line';
	if (!pack.path || (pack.path.kind !== 'circle' && pack.path.kind !== 'polyline')) return 'path.kind must be circle or polyline';
	if (!(pack.n >= 2) || !(pack.n <= 1 << 20)) return 'n out of range: ' + pack.n;
	if (!(pack.path.arcKm > 0)) return 'path.arcKm must be positive';
	if (!(pack.path.cellKm > 0)) return 'path.cellKm must be positive';
	var i, k, f, a;
	for (k = 0; k < SlicePack.FIELDS.length; k++) {
		f = SlicePack.FIELDS[k]; a = pack[f.name];
		if (!a) return 'missing field ' + f.name;
		if (a.length !== pack.n * (f.stride || 1)) return 'field ' + f.name + ' has ' + a.length + ' values for n = ' + pack.n;
		for (i = 0; i < a.length; i++) if (!isFinite(a[i])) return 'field ' + f.name + ' is not finite at ' + i;
	}
	var s = pack.sKm, z = pack.zM, hF = pack.hFelM, hM = pack.hMafM, hS = pack.hSedM;
	// sKm is the arc where a sample's span begins: the spans tile [0, arcKm], so the last one
	// starts inside the cut and ends at its end. It is the one rule that makes the arc-length
	// resample on the reader's side exact, and it is why a pack carries sKm at all.
	if (s[0] !== 0) return 'sKm must start at 0';
	for (i = 1; i < pack.n; i++) if (!(s[i] > s[i - 1])) return 'sKm is not increasing at ' + i;
	if (!(s[pack.n - 1] < pack.path.arcKm)) return 'the last sample starts past the end of the cut';
	if (pack.path.arcKm - s[pack.n - 1] > 1.5 * pack.path.cellKm) return 'the last sample is wider than a cell';
	for (i = 0; i < pack.n; i++) {
		if (hF[i] < 0 || hM[i] < 0 || hS[i] < 0) return 'a negative thickness at ' + i;
		if (!(pack.ageMyr[i] >= 0)) return 'a negative age at ' + i;
		if (pack.host[i] >= SlicePack.HOSTS.length) return 'host code ' + pack.host[i] + ' at ' + i;
		if (pack.bnd[i] > SlicePack.EDGE.collide) return 'boundary code ' + pack.bnd[i] + ' at ' + i;
		if (pack.pol[i] < -1 || pack.pol[i] > 1) return 'polarity ' + pack.pol[i] + ' at ' + i;
		if (pack.alive[i] > 1 || pack.wet[i] > 1) return 'a flag is not 0/1 at ' + i;
		if (Math.abs(z[i]) > 1e6) return 'an elevation outside +-1000 km at ' + i;
	}
	if (!/^[0-9a-f]{16}$/.test(pack.checksum)) return 'the checksum is not 16 hex digits';
	return '';
};

// The checksum is over what the pack says, so it is recomputed, never trusted.
SlicePack.verify = function (pack) {
	return SlicePack.checksum(pack) === pack.checksum ? '' : 'checksum mismatch: the pack was edited or truncated';
};

// Typed arrays stringify as {"0":…} objects, which triples a pack and does not round-trip;
// the replacer keeps the writer honest about what a pack's arrays are on the wire.
function plain(key, value) {
	return value && value.BYTES_PER_ELEMENT ? Array.prototype.slice.call(value) : value;
}
SlicePack.encode = function (pack, pretty) {
	return JSON.stringify(pack, plain, pretty ? 1 : 0);
};

// One call for the page: parse, type, quantise, validate, verify. Throws with the reason —
// a pack the page cannot load is an error, not a return value a caller may ignore.
SlicePack.decode = function (text) {
	var pack = JSON.parse(text);
	SlicePack.normalize(pack);
	SlicePack.quantize(pack);
	var bad = SlicePack.validate(pack) || SlicePack.verify(pack);
	if (bad) throw new Error(bad);
	return pack;
};

// ---------------------------------------------------------------- the path itself
// Where the cut is, in degrees, at arc distance sKm. Both sides need it: the globe draws
// the line it is about to cut, the section labels the ruler of the cross-section it drew.
// Great-circle exact for kind 'circle'; piecewise great-circle for 'polyline'.
SlicePack.DEG = 180 / Math.PI;

function dirAt(latDeg, lonDeg, out) {
	var lat = latDeg / SlicePack.DEG, lon = lonDeg / SlicePack.DEG, c = Math.cos(lat);
	out[0] = c * Math.cos(lon); out[1] = Math.sin(lat); out[2] = c * Math.sin(lon);
	return out;
}
// The tangent of the great circle that leaves (lat0, lon0) on azimuth az (from north).
function tangentAt(latDeg, lonDeg, azDeg, out) {
	var lat = latDeg / SlicePack.DEG, lon = lonDeg / SlicePack.DEG, az = azDeg / SlicePack.DEG;
	var cl = Math.cos(lat), sl = Math.sin(lat), cLon = Math.cos(lon), sLon = Math.sin(lon), ca = Math.cos(az), sa = Math.sin(az);
	out[0] = -sl * cLon * ca - sLon * sa;
	out[1] = cl * ca;
	out[2] = -sl * sLon * ca + cLon * sa;
	return out;
}
var _d0 = [0, 0, 0], _t0 = [0, 0, 0], _p = [0, 0, 0];

// p(theta) = d0 cos(theta) + t sin(theta) — the point theta radians along the circle.
function stepFrom(lat0, lon0, az0, theta, out) {
	dirAt(lat0, lon0, _d0);
	tangentAt(lat0, lon0, az0, _t0);
	var c = Math.cos(theta), s = Math.sin(theta);
	out[0] = _d0[0] * c + _t0[0] * s;
	out[1] = _d0[1] * c + _t0[1] * s;
	out[2] = _d0[2] * c + _t0[2] * s;
	return out;
}
// Central angle between two points given as degrees.
SlicePack.arcKmBetween = function (latA, lonA, latB, lonB) {
	dirAt(latA, lonA, _d0); dirAt(latB, lonB, _t0);
	var dot = Math.max(-1, Math.min(1, _d0[0] * _t0[0] + _d0[1] * _t0[1] + _d0[2] * _t0[2]));
	return Math.acos(dot) * SlicePack.R_KM;
};
// Initial azimuth of the great circle A -> B, degrees from north.
SlicePack.azimuthBetween = function (latA, lonA, latB, lonB) {
	var lat1 = latA / SlicePack.DEG, lat2 = latB / SlicePack.DEG, dLon = (lonB - lonA) / SlicePack.DEG;
	var y = Math.sin(dLon) * Math.cos(lat2);
	var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
	return Math.atan2(y, x) * SlicePack.DEG;
};

// out = [latDeg, lonDeg] at sKm along the cut. Clamped to the ends, so a ruler that asks
// past the end reads the end and not a wrapped-around position.
SlicePack.latLonAt = function (pack, sKm, out) {
	var path = pack.path, verts = path.verts, s = Math.max(0, Math.min(path.arcKm, sKm));
	var at = 0, lat0 = path.lat0, lon0 = path.lon0, az0 = path.az0;
	if (path.kind === 'polyline' && verts && verts.length >= 4) {
		var i, seg;
		for (i = 0; i + 3 < verts.length; i += 2) {
			seg = SlicePack.arcKmBetween(verts[i], verts[i + 1], verts[i + 2], verts[i + 3]);
			if (s <= at + seg || i + 5 >= verts.length) break;
			at += seg;
		}
		lat0 = verts[i]; lon0 = verts[i + 1];
		az0 = SlicePack.azimuthBetween(verts[i], verts[i + 1], verts[i + 2], verts[i + 3]);
		s -= at;
	}
	stepFrom(lat0, lon0, az0, s / SlicePack.R_KM, _p);
	out[0] = Math.asin(Math.max(-1, Math.min(1, _p[1]))) * SlicePack.DEG;
	out[1] = Math.atan2(_p[2], _p[0]) * SlicePack.DEG;
	return out;
};

if (typeof module !== 'undefined' && module.exports) module.exports = SlicePack;
