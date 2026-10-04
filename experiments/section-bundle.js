// section-bundle.js — 0.4.1 M4: the gate for the generated Earth bundles in js/data/.
// The bake (tools/earth/bake_section.py) reads the counterpart's baked Earth pack, walks
// a great circle over its raster and stamps the result through the shared
// port/slice-format.js; what lands here is the canonical JSON, wrapped as a page script.
// This file holds the slice side of the M4 gate, with no DOM where the format suffices:
//
//   A. the provenance: each bundle decodes through the same verify path as a paste
//      (SP.decode), carries its license and the pinned source commit, and its checksum
//      is the pinned one - the "same on two machines" gate, read off the committed bytes.
//   B. the walk's invariants, self-contained: the spans tile the arc, wet is z < 0,
//      every plate change is a boundary and vice versa, the polarity law holds, and the
//      static-bake promise (ore potentials and damage are 0) is asserted, not assumed.
//   C. the product: ?start=section&pack=<id> opens a real transect on the page, the HUD
//      says what it came from (both resolutions, the arc scale, the epoch, the checksum),
//      the Cut-from select lists the bundles, and the same cut and seed lay the same
//      section twice.
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

// The bakes of this tree, pinned: id -> the checksum the bake printed. A different
// number means a different cut; the gate is that two machines reading the same bytes
// print the same one.
var BUNDLES = {
	'earth-100Ma-gc0': 'e355a92a889b9c7d',
	'earth-100Ma-gc1': '665a7f23713c2b24',
	'earth-gc0': '00eb9fa91207522c'
};
// the 536 KB pack the transect replaces (planet-geotectonics js/data/earth-100Ma.js):
// the gate is at least 5x smaller (sync plan §5 M4)
var REPLACED_KB = 535724 / 1024;

var dataDir = path.join(root, 'js', 'data');
var onDisk = fs.readdirSync(dataDir).filter(function (f) { return /^section-.*\.js$/.test(f); });

console.log('  section bundle: the Earth transects in js/data/ (tools/earth/bake_section.py)');
console.log('  (the bake walks the counterpart\'s baked Earth pack; the format is port/slice-format.js)');
console.log('');

check.section('A. the bundles, decoded through the paste\'s own verify path');
var ids = onDisk.map(function (f) { return f.slice('section-'.length, -'.js'.length); }).sort();
check.ok('the disk carries exactly the pinned bundle set',
	ids.length === Object.keys(BUNDLES).length &&
	ids.every(function (id) { return BUNDLES[id] !== undefined; }), ids.join(' '));

var packs = {};
for (var bi = 0; bi < ids.length; bi++) {
	var id = ids[bi], text = fs.readFileSync(path.join(dataDir, 'section-' + id + '.js'), 'utf8');
	// the canonical JSON as shipped: the one object the wrapper assigns to SECTION_PACKS
	var m = /SECTION_PACKS\['([^']+)'\] =\s*\n\s*(\{.*\});/.exec(text);
	check.ok('the bundle wraps one canonical object under its own id', m && m[1] === id, id);
	if (!m) continue;
	var textP = m[2];
	var pack;
	try { pack = SP.decode(textP); } catch (e) { check.ok('decode: ' + id + ' refused (' + e.message + ')', false); continue; }
	packs[id] = pack;
	check.ok('the checksum is the pinned one (stable across bakes and machines)',
		pack.checksum === BUNDLES[id], pack.checksum + '  want ' + BUNDLES[id]);
	check.ok('the pack names its source, its commit and its epoch',
		pack.source.repo === 'planet-geotectonics' && pack.source.commit === 'd909476'
			&& pack.source.pack === (id.indexOf('100Ma') >= 0 ? 'earth-100Ma' : 'earth')
			&& pack.source.epochMa === (id.indexOf('100Ma') >= 0 ? 100 : 0)
			&& pack.source.tMyr === pack.source.epochMa,
		pack.source.pack + ' t ' + pack.source.tMyr + ' Myr @ ' + pack.source.commit);
	check.ok('the license travels with the pack', /CC-BY 4\.0/.test(pack.license), pack.license);
	var kb = fs.statSync(path.join(dataDir, 'section-' + id + '.js')).size / 1024;
	check.ok('the transect is at least 5x smaller than the pack it replaces',
		kb < REPLACED_KB / 5, kb.toFixed(1) + ' KB < ' + (REPLACED_KB / 5).toFixed(0) + ' KB');
	// the round trip is exact: the shipped text and the loaded object are the same cut
	var mod = require(path.join(dataDir, 'section-' + id + '.js'));
	check.ok('the page script registers the same object under SECTION_PACKS',
		mod && mod[id] && SP.decode(JSON.stringify(mod[id])).checksum === pack.checksum);
}

check.section('B. the walk\'s invariants, self-contained');
for (var id2 in packs) {
	var p = packs[id2], n = p.n, i;
	check.ok(id2 + ': sKm starts at 0, increases, and the last span is at most a cell',
		p.sKm[0] === 0 &&
		p.sKm[n - 1] < p.path.arcKm && p.path.arcKm - p.sKm[n - 1] <= 1.5 * p.path.cellKm &&
		Array.prototype.every.call(p.sKm, function (v, k) { return k === 0 || v > p.sKm[k - 1]; }),
		'n=' + n + ' last span ' + (p.path.arcKm - p.sKm[n - 1]).toFixed(2) + ' km');
	check.ok(id2 + ': the arc is the whole circle at the format\'s own radius',
		Math.abs(p.path.arcKm - 2 * Math.PI * SP.R_KM) < 0.1, p.path.arcKm.toFixed(2) + ' km');
	check.ok(id2 + ': wet is exactly z < 0 (the section\'s own datum)',
		Array.prototype.every.call(p.wet, function (w, k) { return w === (p.zM[k] < 0 ? 1 : 0); }));
	// every plate change is a boundary to the next sample (wrapped) and vice versa
	var seam = 0, both = 0, neither = 0, next;
	for (i = 0; i < n; i++) {
		next = (i + 1) % n;
		var diff = p.plate[i] !== p.plate[next], bnd = p.bnd[i] !== 0;
		if (diff && bnd) both++;
		if (diff && !bnd) seam++;
		if (!diff && bnd) neither++;
	}
	check.ok(id2 + ': a boundary sits exactly where the plate changes',
		seam === 0 && neither === 0, 'both ' + both + ', missing ' + seam + ', phantom ' + neither);
	// the polarity law: only a subduction picks a side, a collision takes none
	var polBad = 0, sub = 0, col = 0;
	for (i = 0; i < n; i++) {
		if (p.pol[i] < -1 || p.pol[i] > 1) polBad++;
		if (p.bnd[i] === SP.EDGE.subduct) { sub++; if (p.pol[i] === 0) polBad++; }
		if (p.bnd[i] === SP.EDGE.collide) { col++; if (p.pol[i] !== 0) polBad++; }
		if (p.bnd[i] !== SP.EDGE.subduct && p.bnd[i] !== SP.EDGE.collide && p.pol[i] !== 0) polBad++;
	}
	check.ok(id2 + ': the polarity names a side only for a subduction',
		polBad === 0, 'subduct ' + sub + ' collide ' + col + ' bad ' + polBad);
	// the static-bake promise: no accumulated dynamics in a snapshot
	var dyn = 0, d;
	for (i = 0; i < n; i++) {
		d = p.damage[i];
		if (d !== 0) dyn++;
		for (var k6 = 0; k6 < 6; k6++) if (p.pot[i * 6 + k6] !== 0) dyn++;
	}
	check.ok(id2 + ': ore potentials and damage are 0 (a static snapshot carries none)',
		dyn === 0, 'non-zero ' + dyn);
	// rigid bodies from real poles: the speeds are finite and earth-sized
	var maxVt = 0, maxVp = 0;
	for (i = 0; i < n; i++) { maxVt = Math.max(maxVt, Math.abs(p.vt[i])); maxVp = Math.max(maxVp, p.vp[i]); }
	check.ok(id2 + ': the plate speeds are finite and within a real-Earth bound',
		maxVt < 6e5 && maxVp < 6e5 && isFinite(maxVt) && isFinite(maxVp),
		'max |vt| ' + (maxVt / 1e4).toFixed(2) + ' cm/yr, vp ' + (maxVp / 1e4).toFixed(2) + ' cm/yr');
	// the plates block covers every id the samples carry, and its counts tile the raster
	var idsSeen = {}, plateSum = 0, j;
	for (i = 0; i < n; i++) idsSeen[p.plate[i]] = 1;
	for (j = 0; j < p.plates.length; j++) plateSum += p.plates[j].n;
	check.ok(id2 + ': the plates block covers the cut\'s plates and tiles the 360x180 raster',
		p.plates.length >= 2 && plateSum === 360 * 180 &&
		Object.keys(idsSeen).every(function (q) {
			return p.plates.some(function (e) { return e.id === +q; });
		}), 'plates ' + p.plates.length + ' of ' + Object.keys(idsSeen).length + ' crossed, cells ' + plateSum);
}

// ---------------------------------------------------------------- the page
// The same loader as experiments/section-pack.js (columns.html order, a DOM parsed from
// the markup, a recording 2d context), because ?pack= is the page's own path and the
// bundle's options live in the page's select.
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
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 560 }; },
		getContext: function () { return this.__ctx; },
		getAttribute: function (nn) { return nn in this.attrs ? this.attrs[nn] : null; },
		setAttribute: function (nn, v) { this.attrs[nn] = String(v); }
	};
}
function load(search) {
	var els = {}, i;
	for (i = 0; i < IDS.length; i++) { els[IDS[i]] = makeEl(IDS[i]); els[IDS[i]].__ctx = nullCtx; }
	var nullCtx = {
		createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		measureText: function (s) { return { width: String(s).length * 6 }; }
	};
	var sb = {
		console: console,
		performance: { now: function () { return 0; } },
		requestAnimationFrame: function (f) { sb.__next = f; return 1; },
		addEventListener: function () {},
		location: { search: search || '' },
		FileReader: function () {}
	};
	sb.window = sb;
	sb.document = {
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function () { return []; },
		createElement: function (tag) { return { tag: tag, value: '', textContent: '', children: [], appendChild: function (c) { this.children.push(c); } }; },
		body: { classList: { add: function () {} } }
	};
	vm.createContext(sb);
	for (i = 0; i < order.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, order[i]), 'utf8'), sb, { filename: order[i] });
	}
	return { sb: sb, els: els };
}

check.section('C. ?pack= opens a real transect');
var L = load('?start=section&pack=earth-100Ma-gc0&seed=7');
var SPK = L.sb.SectionPack, hud = L.els.hud.textContent;
check.ok('the bundled id loads and reconstructs a world',
	SPK.pack !== null && SPK.world !== null && SPK.origin === 'earth-100Ma-gc0', SPK.msg);
check.ok('the HUD says where the cut came from: both resolutions, the arc, the epoch',
	/source L0 · 111 km cells → 512 columns · 78 km · 40 030 km circle/.test(hud)
		&& /t 100 Myr · earth-100Ma/.test(hud) && /arc scale 1\.00/.test(hud),
	hud.split('\n').slice(0, 3).join(' | '));
check.ok('the HUD carries the cut\'s own checksum', hud.indexOf(BUNDLES['earth-100Ma-gc0']) >= 0,
	'checksum ' + BUNDLES['earth-100Ma-gc0']);
check.ok('the section holds the cut\'s crust: seeded mass is the cut\'s mass to the ledger',
	L.sb.SEED.seedMass > 0 && Math.abs(L.sb.SEED.seedMass - L.sb.SEED.cutMass) / L.sb.SEED.cutMass < 0.01,
	Math.round(L.sb.SEED.seedMass) + ' of ' + Math.round(L.sb.SEED.cutMass) + ' m3/m');
check.ok('the Cut-from select lists every bundled pack',
	L.els.sPick.children.length === 3 &&
		L.els.sPick.children.map(function (o) { return o.value; }).join(',') ===
		'earth-100Ma-gc0,earth-100Ma-gc1,earth-gc0',
	L.els.sPick.children.map(function (o) { return o.value; }).join(','));
var L2 = load('?start=section&pack=earth-100Ma-gc0&seed=7');
check.ok('the same cut and seed lay the same section twice (one state, one hash)',
	L2.sb.S.hash() === L.sb.S.hash(), L.sb.S.hash());
var L3 = load('?start=section&pack=earth-100Ma-gc1&seed=7');
check.ok('the second transect (Tethys, 437 samples) lays a different section',
	L3.sb.SectionPack.pack !== null && L3.sb.S.hash() !== L.sb.S.hash(),
	'L ' + L.sb.S.hash() + ' vs ' + L3.sb.S.hash());
var L4 = load('?start=section&pack=earth-gc0&seed=7');
check.ok('the present-day transect opens the same way, at t 0',
	L4.sb.SectionPack.pack !== null && /t 0 Myr · earth/.test(L4.els.hud.textContent),
	L4.els.hud.textContent.split('\n').slice(0, 2).join(' | '));
var L5 = load('?start=section&pack=not-a-bundle');
check.ok('an unknown id is a visible refusal on the real page too',
	L5.sb.SectionPack.pack === null && /no bundled pack 'not-a-bundle'/.test(L5.els.sMsg.textContent),
	L5.els.sMsg.textContent);

check.done();
console.log('  (bundle gate in ' + (Date.now() - t0) + ' ms)');
