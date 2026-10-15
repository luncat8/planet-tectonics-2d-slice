// section-bundle.js — the gate for what ships as a bundled cut in js/data/, and for the
// pinned v2 fixture the port carries. At the 0.4.2 v2 cutover (B4) the three v1 Earth
// bundles were retired: no v1 artifact ships, and bundle *restore* waits for a globe
// v2 writer (Phase B-b, gated). So this gate now holds three things:
//
//   A. the retirement: js/data/ carries no section-*.js bundle, columns.html loads
//      none, and a retired id asked for on the page is a visible refusal, not a
//      silent fallback to some other world.
//   B. the pinned v2 fixture (port/fixtures/slice-pack-v2.json): it decodes through
//      the reader's own entry, its two identities are the recorded ones (and do not
//      move when source.built does), the canonical text is stable, and it lays a
//      real section on the page — the same cut and seed twice, one hash.
//   C. a v1 pack is refused by version at the page's door, with the shown world
//      untouched (the byte-level suite lives in experiments/section-pack.js §C1).
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

// the retired v1 bakes (0.4.1 M4): gone at the cutover, and they stay gone until a
// v2 writer regenerates them (Phase B-b)
var RETIRED = ['section-earth-gc0.js', 'section-earth-100Ma-gc0.js', 'section-earth-100Ma-gc1.js'];
var FIXTURE_TEXT = fs.readFileSync(path.join(root, 'port', 'fixtures', 'slice-pack-v2.json'), 'utf8');

console.log('  section bundle: retirement of the v1 bakes, and the pinned v2 fixture');
console.log('  (bundle restore is Phase B-b, gated on a globe v2 writer; the format is port/slice-format.js)');
console.log('');

check.section('A. no v1 artifact ships');
var dataDir = path.join(root, 'js', 'data');
var onDisk = fs.readdirSync(dataDir).filter(function (f) { return /^section-.*\.js$/.test(f); });
check.ok('js/data/ carries no section bundle', onDisk.length === 0, onDisk.join(' ') || 'none');
check.ok('the retired bundle files are absent',
	RETIRED.every(function (f) { return !fs.existsSync(path.join(dataDir, f)); }), RETIRED.join(' '));
var htmlA = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
check.ok('columns.html loads no bundle script',
	!/js\/data\/section-[^"]*\.js/.test(htmlA), 'bundle script tags return with the v2 bake at Phase B-b');

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

check.section('C. the page: retired ids refuse, the fixture lays, v1 refuses');
var L5 = load('?start=section&pack=earth-100Ma-gc0&seed=7');
check.ok('a retired bundle id is a visible refusal, not a fallback world',
	L5.sb.COLSECTION.pack === null && /no bundled pack 'earth-100Ma-gc0'/.test(L5.els.sMsg.textContent),
	L5.els.sMsg.textContent);
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
