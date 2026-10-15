// section-bundle.js — the gate for what ships as a bundled cut in js/data/, and for the
// pinned v2 fixture the port carries. At the 0.4.2 v2 cutover (B4) the three v1 Earth
// bundles were retired; Phase B-b restored the same three ids through the globe's v2
// writer (planet-geotectonics tools/earth/bake_section.js, 0.8.2 — never the frozen
// tools/earth/bake_section.py), one bundle at a time. So this gate now holds three
// things:
//
//   A. the restore: js/data/ carries exactly the three v2 bakes, columns.html loads
//      each once, each wrapper registers its old id on SECTION_PACKS, and each pack
//      validates and verifies through the local codec with the pinned identities
//      (path + full), the recorded provenance and license, and the static-bake
//      honesty: ore potentials and damage are 0 (the t = 0 initializer, not a
//      survey), and the pack carries pack fields only — beds and deposits shown
//      after import are section reconstruction, not Earth-pack fields.
//   B. the pinned v2 fixture (port/fixtures/slice-pack-v2.json): it decodes through
//      the reader's own entry, its two identities are the recorded ones (and do not
//      move when source.built does), the canonical text is stable, and it lays a
//      real section on the page — the same cut and seed twice, one hash.
//   C. the page: ?pack=<id> lays the real bundled Earth cut through the same decode
//      entry as a paste, and a v1 pack is refused by version at the page's door,
//      with the shown world untouched (the byte-level suite lives in
//      experiments/section-pack.js §C1).
// Run: node experiments/section-bundle.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var lib = require('./lib.js');
var check = lib.check;
var SP = require('../port/slice-format.js');

var root = lib.root;
var t0 = Date.now();

// the restored v2 bakes (0.4.2 Phase B-b): regenerated one at a time through the
// globe's bake CLI at revision 9270039a7cbebe84ef667d15200ff64c335fe26e, each command
// pinning source.commit 0b10d68538488d6989939d4bf31a391775cf7581 and
// source.built 2026-10-15T00:00:00.000Z (outside both identities); every wrapper
// header carries its exact command line and license. Old v1 sample counts and
// checksums are gone with the v1 walk: these are L5 cell-run bakes of the same
// circles (193 / 193 / 209 runs).
var SOURCE_COMMIT = '0b10d68538488d6989939d4bf31a391775cf7581';
var GLOBE_REVISION = '9270039a7cbebe84ef667d15200ff64c335fe26e';
var SOURCE_BUILT = '2026-10-15T00:00:00.000Z';
var BUNDLES = [
	{ id: 'earth-gc0', file: 'section-earth-gc0.js', circle: '0 0 90',
		path: 'e0147ee8ff63d4d1', full: '63825f6abdfde871', n: 193, bytes: 17058, epochMa: 0,
		license: 'Earth start earth · PALEOMAP-0Ma (Scotese & Wright 2018) + NNR-MORVEL56 + CRUST1.0 sediment (not GlobSed)' },
	{ id: 'earth-100Ma-gc0', file: 'section-earth-100Ma-gc0.js', circle: '0 0 90',
		path: 'e0147ee8ff63d4d1', full: 'a9a17ca6721a9597', n: 193, bytes: 15941, epochMa: 100,
		license: 'Earth start earth-100Ma · PALEOMAP-PaleoDEM 100Ma (Scotese & Wright 2018)' },
	{ id: 'earth-100Ma-gc1', file: 'section-earth-100Ma-gc1.js', circle: '20 0 90',
		path: '77ac9f529df0fc55', full: '965109ddb61c5870', n: 209, bytes: 16513, epochMa: 100,
		license: 'Earth start earth-100Ma · PALEOMAP-PaleoDEM 100Ma (Scotese & Wright 2018)' }
];
var FIXTURE_TEXT = fs.readFileSync(path.join(root, 'port', 'fixtures', 'slice-pack-v2.json'), 'utf8');

console.log('  section bundle: the restored v2 bakes, and the pinned v2 fixture');
console.log('  (restored at Phase B-b through the globe bake CLI at ' + GLOBE_REVISION.slice(0, 7) + '; the format is port/slice-format.js)');
console.log('');

check.section('A. the restored v2 bakes, through the local codec');
var dataDir = path.join(root, 'js', 'data');
var onDisk = fs.readdirSync(dataDir).filter(function (f) { return /^section-.*\.js$/.test(f); });
check.ok('js/data/ carries exactly the three restored bundles',
	onDisk.length === BUNDLES.length &&
	BUNDLES.every(function (b) { return onDisk.indexOf(b.file) >= 0; }), onDisk.join(' ') || 'none');
var htmlA = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
check.ok('columns.html loads each bundle script exactly once',
	BUNDLES.every(function (b) {
		return htmlA.split('js/data/' + b.file + '"').length - 1 === 1;
	}), 'in the M4 load order, before js/section-pack.js');

// the wrappers are page data scripts with a module.exports guard: one require proves
// the registration path every ?pack= id resolves through
var registered = null;
try { registered = require(path.join(dataDir, BUNDLES[0].file)); }
catch (e) { check.ok('the wrappers register on SECTION_PACKS (' + e.message + ')', false); }
var EXPECTED_KEYS = ['format', 'version', 'source', 'path', 'planet', 'sea', 'plates', 'n']
	.concat(SP.FIELDS.map(function (f) { return f.name; }))
	.concat(['license', 'checksum']).sort().join(',');
BUNDLES.forEach(function (b) {
	var pack = registered && registered[b.id];
	check.ok(b.id + ' re-registers under its old id on SECTION_PACKS',
		!!pack && typeof pack === 'object' && !Array.isArray(pack));
	if (!pack) return;
	check.ok(b.id + ' validates and verifies through the local codec',
		SP.validate(pack) === '' && SP.verify(pack) === '', 'validate/verify both empty');
	check.ok(b.id + ' carries the pinned identities (path ' + b.path + ' · full ' + b.full + ')',
		SP.pathChecksum(pack.path) === b.path && pack.checksum === b.full,
		'path ' + SP.pathChecksum(pack.path) + ' · full ' + pack.checksum);
	check.ok(b.id + ' is the recorded bake (' + b.n + ' runs, ' + b.bytes + ' bytes)',
		pack.n === b.n && Buffer.byteLength(SP.encode(pack)) === b.bytes,
		pack.n + ' runs, ' + Buffer.byteLength(SP.encode(pack)) + ' bytes');
	check.ok(b.id + ' records the writer provenance',
		!!pack.source && pack.source.repo === 'luncat8/planet-geotectonics' &&
		pack.source.commit === SOURCE_COMMIT && pack.source.built === SOURCE_BUILT &&
		pack.source.tMyr === 0 && pack.source.epochMa === b.epochMa && pack.source.level === 5 &&
		pack.source.gridSeed === 7 && pack.source.simSeed === 7 && pack.source.rotModel === 'PALEOMAP',
		'commit ' + (pack.source ? pack.source.commit : '?') + ' (' + (pack.source ? pack.source.pack : '?') +
		' @ ' + (pack.source ? pack.source.epochMa : '?') + ' Ma, t ' + (pack.source ? pack.source.tMyr : '?') +
		' Myr), baked against globe ' + GLOBE_REVISION.slice(0, 7));
	check.ok(b.id + ' carries the pack license verbatim', pack.license === b.license, pack.license);
	check.ok(b.id + ' zeros are the t = 0 initializer, not a survey',
		pack.damage.every(function (v) { return v === 0; }) &&
		pack.pot.every(function (v) { return v === 0; }),
		'damage 0 and all six ore potentials 0');
	check.ok(b.id + ' carries pack fields only (beds/deposits are section reconstruction)',
		Object.keys(pack).sort().join(',') === EXPECTED_KEYS,
		'no beds/deposits/stratigraphy fields in the pack');
});

check.section('B. the pinned v2 fixture, through the reader\'s own entry');
var fixture = null;
try { fixture = SP.decode(FIXTURE_TEXT); } catch (e) { check.ok('the fixture decodes (' + e.message + ')', false); }
if (fixture) {
	check.ok('the fixture is the recorded globe cut (checksum and path identity)',
		fixture.checksum === '2d3941bda088d8d2' && SP.pathChecksum(fixture.path) === 'cc5cd21d5ddc5712',
		fixture.checksum + ' / ' + SP.pathChecksum(fixture.path));
	check.ok('neither identity moves when source.built does (the hashes are content, not clock)',
		(function () {
			var obj = JSON.parse(FIXTURE_TEXT);
			obj.source.built = '2030-01-01T00:00:00.000Z';
			var again = SP.decode(JSON.stringify(obj));
			return again.checksum === fixture.checksum && SP.pathChecksum(again.path) === SP.pathChecksum(fixture.path);
		})(), 'built is outside both identities');
	check.ok('the canonical text is stable (encode of decode is the shipped text, modulo its trailing newline)',
		SP.encode(fixture) === FIXTURE_TEXT.replace(/\n$/, ''), 'one canonical form');
	check.ok('the fixture names its world (closed cut, two plates, one gap)',
		fixture.path.closes === true && fixture.plates.length === 2 &&
		fixture.alive.reduce(function (a, v) { return a + (v ? 0 : 1); }, 0) === 1,
		'plates ' + fixture.plates.length + ', n ' + fixture.n);
}

// ---------------------------------------------------------------- the page
// The same loader as experiments/section-pack.js (columns.html order, a DOM parsed from
// the markup, a recording 2d context), because ?pack= is the page's own path.
var html = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
var order = lib.scriptOrder();
function idsIn(src) {
	var re = /id="([^"]+)"/g, out = [], mm;
	while ((mm = re.exec(src)) !== null) out.push(mm[1]);
	return out;
}
var IDS = idsIn(html);
function makeEl(id) {
	return {
		id: id, value: '', textContent: '', checked: false,
		attrs: {}, dataset: null, listeners: {}, files: null, children: [],
		classList: { add: function () {}, remove: function () {} },
		appendChild: function (c) { this.children.push(c); },
		clientLeft: 0, clientTop: 0,
		width: id === 'c' ? 1280 : 0, height: id === 'c' ? 560 : 0,
		clientWidth: id === 'c' ? 1280 : 0, clientHeight: id === 'c' ? 560 : 0,
		addEventListener: function (t, f) { this.listeners[t] = f; },
		removeEventListener: function (t, f) { if (this.listeners[t] === f) delete this.listeners[t]; },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 560 }; },
		getContext: function () { return this.__ctx; },
		getAttribute: function (nn) { return nn in this.attrs ? this.attrs[nn] : null; },
		setAttribute: function (nn, v) { this.attrs[nn] = String(v); }
	};
}
function load(search) {
	var els = {}, i;
	var nullCtx = {
		createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		measureText: function (s) { return { width: String(s).length * 6 }; }
	};
	for (i = 0; i < IDS.length; i++) { els[IDS[i]] = makeEl(IDS[i]); els[IDS[i]].__ctx = nullCtx; }
	var rafId = 0;
	var sb = {
		console: console,
		performance: { now: function () { return 0; } },
		requestAnimationFrame: function (f) { sb.__next = f; return ++rafId; },
		cancelAnimationFrame: function (id) { if (id === rafId) sb.__next = null; },
		addEventListener: function () {},
		removeEventListener: function () {},
		location: { search: search || '' },
		FileReader: function () {}
	};
	sb.window = sb;
	sb.document = {
		nodeType: 9,
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function () { return []; },
		createElement: function (tag) {
			return { tag: tag, value: '', textContent: '', attrs: {},
				setAttribute: function (n, v) { this.attrs[n] = String(v); },
				getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
				click: function () {}, appendChild: function () {} };
		},
		body: { classList: { add: function () {}, remove: function () {} } }
	};
	sb.document.defaultView = sb;
	vm.createContext(sb);
	for (i = 0; i < order.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, order[i]), 'utf8'), sb, { filename: order[i] });
	}
	sb.COLSIM.start(sb.document);
	return { sb: sb, els: els };
}

check.section('C. the page: the restored ids lay, the fixture lays, v1 refuses');
BUNDLES.forEach(function (b) {
	var L = load('?start=section&pack=' + b.id + '&seed=7');
	check.ok('?pack=' + b.id + ' lays the real bundled cut through the reader entry',
		L.sb.COLSECTION.pack !== null && L.sb.COLSECTION.pack.checksum === b.full &&
		L.sb.COLSECTION.world === true && L.sb.COLSECTION.origin === b.id,
		L.sb.COLSECTION.msg || ('checksum ' + (L.sb.COLSECTION.pack && L.sb.COLSECTION.pack.checksum)));
});
var L = load('?start=section&seed=7');
var laidHash = 0;
check.ok('the pinned fixture lays a real section through the paste entry',
	(function () {
		try { L.sb.COLSECTION.load(FIXTURE_TEXT, 'paste'); } catch (e) { L.__err = e.message; return false; }
		laidHash = L.sb.COLS.hash();
		return L.sb.COLSECTION.pack !== null && L.sb.COLSECTION.pack.checksum === '2d3941bda088d8d2'
			&& L.sb.COLSECTION.world === true;
	})(), L.sb.COLSECTION.msg + (L.__err ? ' [' + L.__err + ']' : ''));
var L2 = load('?start=section&seed=7');
check.ok('the same fixture and seed lay the same section twice (one state, one hash)',
	(function () {
		try { L2.sb.COLSECTION.load(FIXTURE_TEXT, 'paste'); } catch (e) { return false; }
		return L2.sb.COLS.hash() === laidHash && laidHash !== 0;
	})(), 'hash ' + laidHash);
check.ok('a v1 pack is refused by version and the shown section is untouched',
	(function () {
		var before = L.sb.COLSECTION.pack, hash = L.sb.COLS.hash(), threw = false;
		try { L.sb.COLSECTION.load(FIXTURE_TEXT.replace('"version":2', '"version":1'), 'paste'); }
		catch (e) { threw = true; }
		return threw && L.sb.COLSECTION.pack === before && L.sb.COLS.hash() === hash
			&& /version 1, this build reads 2/.test(L.sb.COLSECTION.msg);
	})(), L.sb.COLSECTION.msg);

check.done();
console.log('  (bundle gate in ' + (Date.now() - t0) + ' ms)');
