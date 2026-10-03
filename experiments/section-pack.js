// section-pack.js — 0.4.1 M1: the reader's gate. The page in section mode (?start=section)
// is loaded the way smoke.js loads the page (columns.html order, a DOM parsed from the
// markup), with a recording 2d context so "the raw strip" is data, not pixels. Checks:
// the section-mode boot (no engine world, clock off and said so), the reader accepting the
// cutter-shaped bytes, refusing the twelve corruptions without touching the shown cut, a
// paste and a file load of the same bytes giving the same raw strip and the same checksum,
// the ?pack= id path, and the raw strip's content.
// Run: node experiments/section-pack.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var lib = require('./lib.js');
var check = lib.check;
var SP = require('../port/slice-format.js');
var FIX = require('./pack-fixture.js');

var root = lib.root;
var html = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
var order = lib.scriptOrder();
var t0 = Date.now();

function idsIn(src) {
	var re = /id="([^"]+)"/g, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}
var IDS = idsIn(html);

// a 2d context that records: every call and every property set, so two pages that drew
// the same bytes must produce the same recording
function recCtx(rec) {
	return new Proxy({
		createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		measureText: function (s) { return { width: String(s).length * 6 }; }
	}, {
		get: function (t, k) {
			if (k in t) return t[k];
			return function () { rec.push(k + '(' + Array.prototype.join.call(arguments, ',') + ')'); };
		},
		set: function (t, k, v) { t[k] = v; rec.push(k + '=' + String(v).slice(0, 48)); return true; }
	});
}

function makeEl(id) {
	return {
		id: id, value: '', textContent: '', checked: false,
		attrs: {}, dataset: null, listeners: {}, files: null,
		classList: { add: function () {}, remove: function () {} },
		appendChild: function () {},
		clientLeft: id === 'c' ? 1 : 0, clientTop: id === 'c' ? 1 : 0,
		width: id === 'c' ? 1280 : 0, height: id === 'c' ? 560 : 0,
		clientWidth: id === 'c' ? 1280 : 0, clientHeight: id === 'c' ? 560 : 0,
		addEventListener: function (t, f) { this.listeners[t] = f; },
		getBoundingClientRect: function () {
			return id === 'c' ? { left: 0, top: 0, width: 1282, height: 562 } : { left: 0, top: 0, width: 1280, height: 560 };
		},
		getContext: function () { return this.__ctx; },
		getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
		setAttribute: function (n, v) { this.attrs[n] = String(v); }
	};
}

// one page load. `search` is the URL the browser would have; `extra` names the page-level
// globals a generated bundle would define (SECTION_PACKS lands with M4's bake)
function load(search, extra) {
	var els = {}, i, rec = [];
	for (i = 0; i < IDS.length; i++) { els[IDS[i]] = makeEl(IDS[i]); els[IDS[i]].__ctx = recCtx(rec); }
	var btns = ['def', 'ovw', 'cru', 'bas'].map(function (v) {
		var e = makeEl('preset-' + v); e.dataset = { v: v }; return e;
	});
	var sb = {
		console: console,
		performance: { now: function () { return 0; } },
		requestAnimationFrame: function (f) { sb.__next = f; return 1; },
		addEventListener: function (ty, f) { (sb.__win = sb.__win || {})[ty] = f; },
		location: { search: search || '' },
		FileReader: function () {
			var self = this;
			this.readAsText = function (f) { self.result = f.__text; self.onload({ target: self }); };
		}
	};
	if (extra) for (var k in extra) sb[k] = extra[k];
	sb.window = sb;
	sb.document = {
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function (sel) { return sel === '#presets button' ? btns : []; },
		createElement: function (tag) { return { tag: tag, value: '', textContent: '', appendChild: function () {} }; },
		body: { classList: { add: function (c) { (sb.__classes = sb.__classes || []).push(c); } } }
	};
	vm.createContext(sb);
	for (i = 0; i < order.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, order[i]), 'utf8'), sb, { filename: order[i] });
	}
	return { sb: sb, els: els, rec: rec };
}
// the transport under test: the paste event into the textarea (clipboardData, the only
// thing a file:// page is guaranteed), then the frame loop's draw
function viaPaste(L, text) {
	L.els.sText.listeners.paste.call(L.els.sText,
		{ clipboardData: { getData: function () { return text; } } });
	L.sb.SectionPack.draw();
	L.sb.SectionPack.hud();
}
function viaFile(L, text) {
	L.els.sFile.files = [{ __text: text, name: 'slice-test.json' }];
	L.els.sFile.listeners.change.call(L.els.sFile);
	L.sb.SectionPack.draw();
	L.sb.SectionPack.hud();
}

console.log('  section pack: the reader half of the cut (the page in ?start=section mode)');
console.log('  (packs from experiments/pack-fixture.js; the shared format is port/slice-format.js)');
console.log('');

check.section('A. section mode: the boot');
var L = load('?start=section&seed=7&geo=0&erupt=0');
check.ok('the page boots in section mode', L.sb.SectionPack.mode === true);
// the world is "built" when a preset makes the planet: the column stacks carry mass.
// In section mode nothing is built, so every stack is still zero (state.js lays out the
// geometry at module load — nCol alone cannot say "no world").
var hnz = 0, ci;
for (ci = 0; ci < L.sb.S.nCol; ci++) if (L.sb.S.hFel[ci] !== 0) hnz++;
check.ok('no engine world is built (until M2 seeds one, the cut is a view, not a planet)',
	hnz === 0, 'hFel non-zero cols=' + hnz + ' nCol=' + L.sb.S.nCol);
check.ok('the frame loop is running', typeof L.sb.__next === 'function');
check.ok('the HUD says the clock is off', /plate clock off/.test(L.els.hud.textContent),
	L.els.hud.textContent.split('\n')[0]);
check.ok('the body is in section mode (the engine bar is off, the Slice panel is on)',
	(L.sb.__classes || []).indexOf('section-mode') >= 0);
check.ok('the Slice panel ids are on the page',
	['sText', 'sPaste', 'sFile', 'sPick', 'sMsg'].every(function (id) { return IDS.indexOf(id) >= 0; }),
	['sText', 'sPaste', 'sFile', 'sPick', 'sMsg'].join(','));
check.ok('the URL params are read (seed/geo/erupt travel to M2)',
	L.sb.SectionPack.start.seed === '7' && L.sb.SectionPack.start.geo === '0'
		&& L.sb.SectionPack.start.erupt === '0', JSON.stringify(L.sb.SectionPack.start));

check.section('A2. the normal boot is untouched');
var N = load();
var nhnz = 0, ni;
for (ni = 0; ni < N.sb.S.nCol; ni++) if (N.sb.S.hFel[ni] !== 0) nhnz++;
check.ok('without ?start=section the engine boots as before (and its world is built)',
	N.sb.SectionPack.mode === false && N.sb.S.nCol === 512 && nhnz > 0,
	'mode=' + N.sb.SectionPack.mode + ' nCol=' + N.sb.S.nCol + ' hFel non-zero cols=' + nhnz);

check.section('B. the reader accepts the cutter-shaped bytes');
var pin = FIX.pinned();
var text = SP.encode(pin);
viaPaste(L, text);
check.ok('a paste of the pinned cut loads', L.sb.SectionPack.pack !== null
	&& L.sb.SectionPack.pack.checksum === pin.checksum, L.sb.SectionPack.msg);
check.ok('the readout says what the cut is (level, cell span, arc, mode, checksum)',
	new RegExp('L5 · \\d+ km cells · \\d[\\d ]+ km circle · t 120\\.5 Myr · checksum ' + pin.checksum)
		.test(L.sb.SectionPack.describe(L.sb.SectionPack.pack)),
	L.sb.SectionPack.describe(L.sb.SectionPack.pack));

check.section('C. the reader refuses the twelve corruptions');
function refuses(name, mutate) {
	var bad = FIX.build(64, 8);
	mutate(bad);
	var before = L.sb.SectionPack.pack.checksum;
	var threw = false;
	try { L.sb.SectionPack.load(SP.encode(bad), 'paste'); } catch (e) { threw = true; }
	check.ok('refuses ' + name, threw && L.sb.SectionPack.pack.checksum === before, L.sb.SectionPack.msg);
}
refuses('a foreign format tag', function (p) { p.format = 'pgt-something-else'; });
refuses('a future version', function (p) { p.version = 2; });
refuses('a pack with no license line', function (p) { p.license = ''; });
refuses('an edited sample (the checksum catches it)', function (p) { p.hFelM[3] += 7; });
refuses('a sample out of order', function (p) { var t = p.sKm[5]; p.sKm[5] = p.sKm[6]; p.sKm[6] = t; });
refuses('a field of the wrong length', function (p) { p.zM = new Int32Array(10); });
refuses('a host code outside the table', function (p) { p.host[2] = 9; });
refuses('a negative thickness', function (p) { p.hSedM[4] = -1; });
refuses('a number that is not finite', function (p) { p.pot[7] = NaN; });
refuses('a boundary code the section does not have', function (p) { p.bnd[1] = 7; });
refuses('a polarity outside -1/0/+1', function (p) { p.pol[2] = 3; });
refuses('a path that is neither circle nor polyline', function (p) { p.path.kind = 'spiral'; });
var threw2 = false;
try { L.sb.SectionPack.load('{ this is not json', 'paste'); } catch (e) { threw2 = true; }
check.ok('refuses bytes that are not JSON (and keeps the shown cut)', threw2
	&& L.sb.SectionPack.pack.checksum === pin.checksum, L.sb.SectionPack.msg);

check.section('D. paste and file of the same bytes');
var A = load('?start=section'), B = load('?start=section');
viaPaste(A, text);
viaFile(B, text);
check.ok('the pack checksum is the same', A.sb.SectionPack.pack.checksum === B.sb.SectionPack.pack.checksum
	&& A.sb.SectionPack.pack.checksum === pin.checksum, A.sb.SectionPack.pack.checksum);
check.ok('the origin names the transport and nothing else changes',
	A.sb.SectionPack.origin === 'paste' && B.sb.SectionPack.origin === 'file');
check.ok('the raw strip draws identically (every call, every argument)',
	A.rec.length === B.rec.length && A.rec.join('\n') === B.rec.join('\n'),
	'A ' + A.rec.length + ' calls, B ' + B.rec.length + ' calls');
check.ok('the HUD agrees on everything but the transport line',
	A.els.hud.textContent.split('\n').slice(1).join('\n') === B.els.hud.textContent.split('\n').slice(1).join('\n'),
	B.els.hud.textContent);

check.section('E. the raw strip says what the pack says');
var R = A.rec.join('\n');
check.ok('the crust is drawn in the stack order (sediment / felsic / mafic)',
	R.indexOf('fillStyle=#cbb591') >= 0 && R.indexOf('fillStyle=#dca58c') >= 0 && R.indexOf('fillStyle=#464b52') >= 0);
check.ok('the plate band is drawn (a stable colour per plate id)', /fillStyle=hsl\(\d+,46%,44%\)/.test(R));
check.ok('the boundary ticks are drawn (the fixture has subducts and opens)',
	/fillStyle=#e05555/.test(R) || /fillStyle=#e8c84a/.test(R));
check.ok('the six potential strips are labelled',
	['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'].every(function (n) {
		return R.indexOf('fillText(' + n + ',') >= 0;
	}));
check.ok('the ruler carries the lat/lon from the shared path block',
	/°[NSEW]/.test(R) && R.indexOf('fillText(0 km,') >= 0);
check.ok('the surface is a stroked line, the sea level a dashed one',
	R.indexOf('strokeStyle=#dfe7f5') >= 0 && R.indexOf('stroke()') >= 0 && R.indexOf('setLineDash(4,4)') >= 0);
// a gap sample (alive = 0) owns no crust: the plate band paints it in the hole colour,
// and the crust pass skips it — the drawn mafic columns are exactly the alive samples
// that carry mafic, no more
function countOf(s, needle) {
	var c = 0, at = 0;
	while ((at = s.indexOf(needle, at)) >= 0) { c++; at += needle.length; }
	return c;
}
var mafAlive = 0, gaps = 0;
for (var gi = 0; gi < pin.n; gi++) {
	if (!pin.alive[gi]) gaps++;
	else if (pin.hMafM[gi] > 0) mafAlive++;
}
check.ok('a gap sample owns no crust (the strip shows the hole)',
	gaps > 0 && countOf(R, 'fillStyle=#10141c') >= 1 && countOf(R, 'fillStyle=#464b52') === mafAlive,
	'gaps ' + gaps + ', mafic columns drawn ' + countOf(R, 'fillStyle=#464b52') + ' of ' + mafAlive);

check.section('F. the ?pack= id path');
var D = load('?start=section&pack=earth-100Ma-gc0', { SECTION_PACKS: { 'earth-100Ma-gc0': FIX.pinned() } });
check.ok('a bundled id loads through the same verify path',
	D.sb.SectionPack.pack !== null && D.sb.SectionPack.pack.checksum === pin.checksum
		&& D.sb.SectionPack.origin === 'earth-100Ma-gc0', D.sb.SectionPack.msg);
var E = load('?start=section&pack=no-such-pack');
check.ok('an id with no bundle is a message, not a guess',
	E.sb.SectionPack.pack === null && /no bundled pack 'no-such-pack'/.test(E.els.sMsg.textContent),
	E.els.sMsg.textContent);

check.section('G. the idle strip and the clear');
var I = load('?start=section');
I.sb.SectionPack.draw();
check.ok('before a cut the strip names the section mode and the panel',
	/section mode/.test(I.rec.join('')) && /Slice panel/.test(I.rec.join('')));
L.sb.SectionPack.clear();
check.ok('clear drops the cut and the panel says so', L.sb.SectionPack.pack === null
	&& L.els.sMsg.textContent === 'cut cleared', L.els.sMsg.textContent);
L.sb.SectionPack.draw();
check.ok('and the next draw is the idle strip again', /section mode/.test(L.rec.join('')));

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
