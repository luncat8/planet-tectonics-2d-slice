// make-deposits-fixture.js — regenerate experiments/fixtures/deposits-draws.json from the
// counterpart's own code. Run it only when the pinned upstream commit or the extraction
// changes; the fixture is checked in so experiments/deposits.js needs no upstream tree.
//
//   node experiments/make-deposits-fixture.js [path-to-planet-geotectonics] [output.json]
//
// The path defaults to $UPSTREAM or /tmp/up; the tree must be checked out at the commit
// port/PORT.json pins. The output defaults to the checked-in fixture; pass a temp path to
// regenerate beside it without touching the committed file (experiments/isomorphism.js
// does exactly that). The fixture records that commit and the sha256 of the upstream file,
// so a replay that passes is a statement about a known byte sequence, not about "upstream".
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var root = path.join(__dirname, '..');
var up = process.argv[2] || process.env.UPSTREAM || '/tmp/up';
var file = path.join(up, 'js', 'deposits.js');
var src = fs.readFileSync(file);
var D = require(file);
var Extract = require(path.join(up, 'js', 'extract.js'));

var commit = 'unknown';
try {
	commit = require('child_process').execSync('git -C ' + JSON.stringify(up) + ' rev-parse --short HEAD',
		{ encoding: 'utf8' }).trim();
} catch (e) { /* a source tarball has no git: the sha256 is the provenance that matters */ }

// one byte vector that does not depend on JSON: the fixture's own draw records, utf8
function utf8Of(text) {
	var bytes = [];
	for (var i = 0; i < text.length; i++) {
		var c = text.charCodeAt(i);
		if (c < 0x80) bytes.push(c);
		else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
		else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
	}
	return bytes;
}
var seedBytes = utf8Of(JSON.stringify([0, 1, 2, 3, 255, 128, 64]));

var fixture = {
	provenance: {
		repo: 'https://github.com/luncat8/planet-geotectonics',
		file: 'js/deposits.js',
		commit: commit,
		sha256: crypto.createHash('sha256').update(src).digest('hex'),
		generator: 'experiments/make-deposits-fixture.js'
	},
	mix32: [0, 1, 7, 0x9e3779b9, 0xffffffff, 0x80000000, 123456789, -1, -2000000000].map(function (h) {
		return { h: h, out: D.mix32(h) };
	}),
	combine: [[0, 0], [1, 0], [7, 12345], [0x9e3779b9, -1], [0xffffffff, 0x7fffffff], [42, 24575],
		[123456789, 3]].map(function (p) {
		return { h: p[0], key: p[1], out: D.combine(p[0], p[1]) };
	}),
	text: ['', 'pgt-slice-pack', 'abc123', 'BEEF0000BEEF0000', 'fixed point'].map(function (t) {
		return { text: t, out: D.fnvText(t) };
	}),
	fnvBytes: [
		{ bytes: [], lanes: [0x811c9dc5, 0x9747b28c] },
		{ bytes: [0], lanes: [0x811c9dc5, 0x9747b28c] },
		{ bytes: [0, 1, 2, 3, 255, 128, 64], lanes: [12345, 67890] },
		{ bytes: seedBytes, lanes: [0x811c9dc5, 0x9747b28c] }
	].map(function (c) {
		var lanes = [c.lanes[0], c.lanes[1]];
		D.fnvBytes(new Uint8Array(c.bytes), lanes);
		return { bytes: c.bytes, lanes: c.lanes, out: lanes.slice() };
	}),
	draws: [
		{ seed: 0, version: 1, tile: 0, family: 0, ordinal: 0 },
		{ seed: 0, version: 1, tile: 0, family: 0, ordinal: 1 },
		{ seed: 7, version: 1, tile: 1, family: 1, ordinal: 0 },
		{ seed: 12345, version: 1, tile: 812, family: 2, ordinal: 1 },
		{ seed: 0xdeadbeef, version: 1, tile: 24575, family: 0, ordinal: 1 },
		{ seed: 0xffffffff, version: 1, tile: 100000, family: 2, ordinal: 0 },
		{ seed: 0x80000000, version: 1, tile: 4096, family: 1, ordinal: 0 },
		{ seed: 42, version: 3, tile: 3, family: 2, ordinal: 1 }
	].map(function (c) {
		var out = new Float64Array(D.MAX_DRAWS);
		D.drawCandidate({ seed: c.seed, version: c.version }, c.tile, c.family, c.ordinal, out);
		return { seed: c.seed, version: c.version, tile: c.tile, family: c.family, ordinal: c.ordinal,
			out: Array.prototype.slice.call(out) };
	}),
	truncatedNormal: [[0.5, 0.25], [0.001, 0.999], [0.999, 0], [1e-12, 0.5], [0.25, 0.75]].map(function (p) {
		return { u1: p[0], u2: p[1], out: D.truncatedNormal(p[0], p[1]) };
	}),
	round: [0, 1, -1, 1234.56789, 1e-9, -0.000123456789, 999999.5].map(function (v) {
		return { v: v, out: D.round(v) };
	}),
	axisUnits: [[0, 0], [90, 0], [45, 60], [270, 85], [123.4, 33.3]].map(function (p) {
		var out = new Float64Array(9);
		D.axisUnits(p[0], p[1], out);
		return { strike: p[0], dip: p[1], out: Array.prototype.slice.call(out) };
	}),
	body: [
		{ axes: [328.4, 295.6, 492.7], strike: 210, dip: 75 },
		{ axes: [1000, 900, 150], strike: 10, dip: 20 },
		{ axes: [500, 500, 500], strike: 359, dip: 90 }
	].map(function (c) {
		var u = new Float64Array(9), units = new Float64Array(9);
		D.axisUnits(c.strike, c.dip, u);
		var v = D.verticalHalfExtent(c.axes, u);
		var vol = D.volumeOf(c.axes);
		for (var k = 0; k < 9; k++) units[k] = u[k];
		return { axes: c.axes, strike: c.strike, dip: c.dip, units: Array.prototype.slice.call(units),
			verticalHalfExtent: v, volume: vol,
			metalPct: D.metalTonnes(vol * 2.7 * 0.25, 0.45, '%'),
			metalGt: D.metalTonnes(vol * 2.7 * 0.25, 0.3, 'g/t') };
	})
};

// The host law, from the counterpart's own Extract.host on a fake one-cell state. The
// all-zero row is absent on purpose: a section column with no crust at all is not an
// ocean floor, and the local rule says `none` where upstream never sees such a cell.
fixture.host = [
	[0, 0, 3000], [500, 4000, 0], [9000, 3000, 0], [7999, 1000, 0], [8000, 1000, 0],
	[45000, 1000, 0], [45001, 1000, 0], [1000, 1000, 2500], [1000, 1000, 1500], [20000, 6000, 4000]
].map(function (t) {
	var st = { owner: [0], hFel: [t[0]], hMaf: [t[1]], hSed: [t[2]] };
	return { hFel: t[0], hMaf: t[1], hSed: t[2], out: Extract.host(st, 0) };
});

var out = process.argv[3] || path.join(root, 'experiments', 'fixtures', 'deposits-draws.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, '\t') + '\n');
console.log('wrote ' + out + ' from ' + file + ' @ ' + commit);
