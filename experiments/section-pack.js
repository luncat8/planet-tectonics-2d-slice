// section-pack.js — 0.4.1 M1 and M2: the reader's gate and the page's half of the seeding.
// The page in section mode (?start=section) is loaded the way smoke.js loads the page
// (columns.html order, a DOM parsed from the markup), with a recording 2d context so both the
// raw strip and the reconstructed view are data, not pixels. Checks: the section-mode boot
// (no engine world, clock off and said so), the reader accepting the cutter-shaped bytes,
// refusing the twelve corruptions without touching the shown cut, a paste and a file load of
// the same bytes giving the same strip, the same state and the same S.hash(), the ?pack= id
// path, the raw strip's content, and the three switches of the section view. What the seeding
// *maps* is js/section-seed.js's own gate (experiments/section-seed.js); this file stays on
// the page around it.
// Run: node experiments/section-pack.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var lib = require('./lib.js');
var check = lib.check;
var SP = require('../port/slice-format.js');
var FIX = require('./pack-fixture.js');
var COUP = lib.mods.coupling;

var root = lib.root;
var html = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
var order = lib.scriptOrder();
var CLOG = lib.mods['core-log'];
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
		removeEventListener: function (t, f) { if (this.listeners[t] === f) delete this.listeners[t]; },
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
	var rafId = 0;
	var sb = {
		console: console,
		performance: { now: function () { return 0; } },
		requestAnimationFrame: function (f) { sb.__next = f; return ++rafId; },
		cancelAnimationFrame: function (id) { if (id === rafId) sb.__next = null; },
		addEventListener: function (ty, f) { (sb.__win = sb.__win || {})[ty] = f; },
		removeEventListener: function (ty, f) { if (sb.__win && sb.__win[ty] === f) delete sb.__win[ty]; },
		location: { search: search || '' },
		FileReader: function () {
			var self = this;
			this.readAsText = function (f) { self.result = f.__text; self.onload({ target: self }); };
		}
	};
	if (extra) for (var k in extra) sb[k] = extra[k];
	sb.window = sb;
	sb.document = {
		nodeType: 9,
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function (sel) { return sel === '#presets button' ? btns : []; },
		createElement: function (tag) { return { tag: tag, value: '', textContent: '', appendChild: function () {} }; },
		body: { classList: { add: function (c) { (sb.__classes = sb.__classes || []).push(c); }, remove: function () {} } }
	};
	sb.document.defaultView = sb;
	vm.createContext(sb);
	for (i = 0; i < order.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, order[i]), 'utf8'), sb, { filename: order[i] });
	}
	sb.COLSIM.start(sb.document);
	return { sb: sb, els: els, rec: rec };
}
// the transport under test: the paste event into the textarea (clipboardData, the only
// thing a file:// page is guaranteed), then the frame loop's draw
function viaPaste(L, text) {
	L.els.sText.listeners.paste.call(L.els.sText,
		{ clipboardData: { getData: function () { return text; } } });
	L.sb.COLSECTION.draw();
	L.sb.COLSECTION.hud();
}
function viaFile(L, text) {
	L.els.sFile.files = [{ __text: text, name: 'slice-test.json' }];
	L.els.sFile.listeners.change.call(L.els.sFile);
	L.sb.COLSECTION.draw();
	L.sb.COLSECTION.hud();
}

console.log('  section pack: the reader half of the cut (the page in ?start=section mode)');
console.log('  (packs from experiments/pack-fixture.js; the shared format is port/slice-format.js)');
console.log('');

check.section('A. section mode: the boot');
var L = load('?start=section&seed=7&geo=0&erupt=0');
check.ok('the page boots in section mode', L.sb.COLSECTION.mode === true);
// the world is "built" when a preset makes the planet: the column stacks carry mass.
// In section mode nothing is built, so every stack is still zero (state.js lays out the
// geometry at module load — nCol alone cannot say "no world").
var hnz = 0, ci;
for (ci = 0; ci < L.sb.COLS.nCol; ci++) if (L.sb.COLS.hFel[ci] !== 0) hnz++;
// the world only appears with a cut: an empty section page has the geometry of the ring and
// nothing in it, which is what makes the next check (a paste lays mass, a refusal does not) mean
check.ok('no engine world is built before a cut arrives',
	hnz === 0, 'hFel non-zero cols=' + hnz + ' nCol=' + L.sb.COLS.nCol);
check.ok('the frame loop is running', typeof L.sb.__next === 'function');
check.ok('the HUD says the clock is off', /plate clock off/.test(L.els.hud.textContent),
	L.els.hud.textContent.split('\n')[0]);
check.ok('with no peer, the handshake announces the manual clipboard/file rung',
	/link: clipboard\/file/.test(L.els.hud.textContent), L.els.hud.textContent.split('\n')[1]);
check.ok('the body is in section mode (the engine bar is off, the Slice panel is on)',
	(L.sb.__classes || []).indexOf('section-mode') >= 0);
check.ok('the Slice panel ids are on the page',
	['sText', 'sPaste', 'sFile', 'sPick', 'sMsg'].every(function (id) { return IDS.indexOf(id) >= 0; }),
	['sText', 'sPaste', 'sFile', 'sPick', 'sMsg'].join(','));
check.ok('the URL params are read and applied (the section sets its own seed and clocks)',
	L.sb.COLSECTION.start.seed === '7' && L.sb.COLP.seed === 7
		&& L.sb.COLP.sl.geo === 0 && L.sb.COLP.sl.erupt === 0, JSON.stringify(L.sb.COLSECTION.start));

check.section('A2. the normal boot is untouched');
var N = load();
var nhnz = 0, ni;
for (ni = 0; ni < N.sb.COLS.nCol; ni++) if (N.sb.COLS.hFel[ni] !== 0) nhnz++;
check.ok('without ?start=section the engine boots as before (and its world is built)',
	N.sb.COLSECTION.mode === false && N.sb.COLS.nCol === 512 && nhnz > 0,
	'mode=' + N.sb.COLSECTION.mode + ' nCol=' + N.sb.COLS.nCol + ' hFel non-zero cols=' + nhnz);

check.section('B. the reader accepts the cutter-shaped bytes');
var pin = FIX.pinned();
var text = SP.encode(pin);
viaPaste(L, text);
check.ok('a paste of the pinned cut loads', L.sb.COLSECTION.pack !== null
	&& L.sb.COLSECTION.pack.checksum === pin.checksum, L.sb.COLSECTION.msg);
check.ok('the readout says what the cut is (level, both resolutions, arc, mode, checksum)',
	new RegExp('L5 · \\d+ km cells → 512 columns · 78 km · \\d[\\d ]+ km circle · t 120\\.5 Myr · seed 7 · mapping 2 · checksum '
		+ pin.checksum).test(L.sb.COLSECTION.describe(L.sb.COLSECTION.pack)),
	L.sb.COLSECTION.describe(L.sb.COLSECTION.pack));
check.ok('the cut has been laid as a section (the stacks carry the cut mass, the clock stays off)',
	(function () {
		var i, nz = 0;
		for (i = 0; i < L.sb.COLS.nCol; i++) if (L.sb.COLS.hFel[i] > 0) nz++;
		return nz > 0 && L.sb.COLSIM.dG === 0 && L.sb.COLSIM.t === 120.5
			&& L.sb.COLSECTION.world === true && L.sb.COLSECTION.running === false;
	})(), L.els.hud.textContent.split('\n')[0]);
check.ok('the HUD books what the seeding assumed and what it mapped (plan §4.3.3, §4.3.5)',
	/^start: 3 layers from the cut/m.test(L.els.hud.textContent)
		&& /^spin-up since the cut: crust /m.test(L.els.hud.textContent)
		&& /^assumed: /m.test(L.els.hud.textContent)
		&& /^ledger: map-equivalent 1\.000000/m.test(L.els.hud.textContent)
		&& /crust \d+ of \d+ m3\/m/.test(L.els.hud.textContent), L.els.hud.textContent);
check.ok("the engine's own HUD lines come under the section's",
	/^t 120\.500 Myr/m.test(L.els.hud.textContent) && /fastest plate /.test(L.els.hud.textContent),
	L.els.hud.textContent.split('\n')[6]);

check.section('C. the reader refuses the twelve corruptions');
// Two transports, because they fail differently. `bytes` is what a real cut arrives as, and a
// mutation of a number there is caught by the checksum rather than by the field check; `object`
// is the path a bundled pack takes (window.SECTION_PACKS, M4), which has never been through
// JSON, so the field checks are the only thing between it and the state.
function refuses(name, mutate, via) {
	var bad = FIX.build(64, 8);
	mutate(bad);
	var before = L.sb.COLSECTION.pack.checksum, threw = false;
	try {
		if (via === 'object') L.sb.COLSECTION.loadPack(bad, 'object');
		else L.sb.COLSECTION.load(SP.encode(bad), 'paste');
	} catch (e) { threw = true; }
	check.ok('refuses ' + name, threw && L.sb.COLSECTION.pack.checksum === before, L.sb.COLSECTION.msg);
}
refuses('a foreign format tag', function (p) { p.format = 'pgt-something-else'; });
refuses('a future version', function (p) { p.version = 2; });
refuses('a pack with no license line', function (p) { p.license = ''; });
refuses('an edited sample (the checksum catches it)', function (p) { p.hFelM[3] += 7; });
refuses('a sample out of order', function (p) { var t = p.sKm[5]; p.sKm[5] = p.sKm[6]; p.sKm[6] = t; });
refuses('a field of the wrong length', function (p) { p.zM = new Int32Array(10); });
refuses('a host code outside the table', function (p) { p.host[2] = 9; });
refuses('a negative thickness', function (p) { p.hSedM[4] = -1; });
// JSON has no NaN: encode writes null and the reader would see a zero, so this corruption
// only exists on the object path — which is exactly why the object path is verified too
refuses('a number that is not finite', function (p) { p.pot[7] = NaN; }, 'object');
refuses('a boundary code the section does not have', function (p) { p.bnd[1] = 7; });
refuses('a polarity outside -1/0/+1', function (p) { p.pol[2] = 3; });
refuses('a path that is neither circle nor polyline', function (p) { p.path.kind = 'spiral'; });
var threw2 = false;
try { L.sb.COLSECTION.load('{ this is not json', 'paste'); } catch (e) { threw2 = true; }
check.ok('refuses bytes that are not JSON (and keeps the shown cut)', threw2
	&& L.sb.COLSECTION.pack.checksum === pin.checksum, L.sb.COLSECTION.msg);
var shownPack = L.sb.COLSECTION.pack, shownHash = L.sb.COLS.hash(), primitiveRefused = false;
try { L.sb.COLSECTION.load('null', 'paste'); } catch (e) { primitiveRefused = true; }
check.ok('refuses a JSON primitive with a clear message and no live-state change',
	primitiveRefused && L.sb.COLSECTION.pack === shownPack && L.sb.COLSECTION.world
		&& L.sb.COLS.hash() === shownHash && /must be a JSON object/.test(L.sb.COLSECTION.msg),
	L.sb.COLSECTION.msg);

check.section('C2. layout refusal is atomic against a running section');
L.sb.COLP.sl.geo = 10000;
L.els.bRun.listeners.click.call(L.els.bRun);
L.sb.COLSECTION.frame();
var activePack = L.sb.COLSECTION.pack;
var activeHash = L.sb.COLS.hash();
var activeClock = [L.sb.COLSIM.t, L.sb.COLSIM.Tm, L.sb.COLSIM.dG, L.sb.COLSIM.frame, L.sb.COLSIM.evT,
	L.sb.COLSIM.event, L.sb.COLSECTION.running].join(',');
var activeMap = [L.sb.COLSEED.window, L.sb.COLSEED.scale, L.sb.COLSEED.nCut, L.sb.COLSEED.tailKm].join(',');
var refusedLayout = false;
try { L.sb.COLSECTION.load(SP.encode(FIX.windowCut(64, 8, 45000)), 'paste'); } catch (e) { refusedLayout = true; }
check.ok('a valid but unplaceable cut is refused without replacing the running section',
	refusedLayout && L.sb.COLSECTION.pack === activePack && L.sb.COLSECTION.world
		&& L.sb.COLS.hash() === activeHash && L.sb.COLSECTION.running
		&& [L.sb.COLSIM.t, L.sb.COLSIM.Tm, L.sb.COLSIM.dG, L.sb.COLSIM.frame, L.sb.COLSIM.evT,
			L.sb.COLSIM.event, L.sb.COLSECTION.running].join(',') === activeClock
		&& [L.sb.COLSEED.window, L.sb.COLSEED.scale, L.sb.COLSEED.nCut, L.sb.COLSEED.tailKm].join(',') === activeMap,
	L.sb.COLSECTION.msg);
viaPaste(L, text);
check.ok('a successful replacement stops a previously running section before laying the new cut',
	L.sb.COLSECTION.pack.checksum === pin.checksum && L.sb.COLSECTION.world
		&& !L.sb.COLSECTION.running && L.sb.COLSIM.dG === 0 && L.sb.COLSIM.t === pin.source.tMyr);

check.section('D. paste and file of the same bytes');
var A = load('?start=section'), B = load('?start=section');
viaPaste(A, text);
viaFile(B, text);
check.ok('the pack checksum is the same', A.sb.COLSECTION.pack.checksum === B.sb.COLSECTION.pack.checksum
	&& A.sb.COLSECTION.pack.checksum === pin.checksum, A.sb.COLSECTION.pack.checksum);
check.ok('the origin names the transport and nothing else changes',
	A.sb.COLSECTION.origin === 'paste' && B.sb.COLSECTION.origin === 'file');
check.ok('the two transports draw identically (every call, every argument)',
	A.rec.length === B.rec.length && A.rec.join('\n') === B.rec.join('\n'),
	'A ' + A.rec.length + ' calls, B ' + B.rec.length + ' calls');
// L arrived on ?seed=7 and A/B on the default seed, so the two pages are not comparable;
// within one page the transport must not change the state at all
check.ok('paste and file lay the same state (S.hash of the seeded planet)',
	A.sb.COLS.hash() === B.sb.COLS.hash() && A.sb.COLS.hash() !== '', A.sb.COLS.hash());
check.ok('the HUD agrees on everything but the transport line',
	A.els.hud.textContent.split('\n').slice(1).join('\n') === B.els.hud.textContent.split('\n').slice(1).join('\n'),
	B.els.hud.textContent);

check.section('D2. coupling text uses the guarded reader on paste and file');
var couplingMsg = COUP.fromPack(pin), couplingText = COUP.json(couplingMsg);
var C = load('?start=section');
viaPaste(C, text);
viaPaste(C, couplingText);
check.ok('a checksummed coupling snapshot for the active path applies through paste',
	C.sb.COLSECTION.syncImports === 1 && C.sb.COLSECTION.syncTMyr === couplingMsg.tMyr &&
	/coupling snapshot/.test(C.els.sMsg.textContent), C.els.sMsg.textContent);
check.ok('the HUD identifies the manual coupling rung and its reconciliation fractions',
	/coupling: manual snapshot 1/.test(C.els.hud.textContent) && /reconciled/.test(C.els.hud.textContent));
var coupledHash = C.sb.COLS.hash(), coupledRecon = JSON.stringify(C.sb.COLS.recon);
var noStamp = JSON.stringify(COUP.body(couplingMsg));
viaPaste(C, noStamp);
check.ok('the page refuses an unsigned coupling message without state mutation',
	/checksum mismatch/.test(C.els.sMsg.textContent) && C.sb.COLS.hash() === coupledHash &&
	JSON.stringify(C.sb.COLS.recon) === coupledRecon, C.els.sMsg.textContent);
var wrongPath = JSON.parse(couplingText);
wrongPath.pathChecksum = '0123456789abcdef';
wrongPath.checksum = COUP.checksum(wrongPath);
viaPaste(C, JSON.stringify(wrongPath));
check.ok('the page refuses a checksummed message for another cut without state mutation',
	/pathChecksum/.test(C.els.sMsg.textContent) && C.sb.COLS.hash() === coupledHash &&
	JSON.stringify(C.sb.COLS.recon) === coupledRecon, C.els.sMsg.textContent);
var CFile = load('?start=section');
viaPaste(CFile, text);
viaFile(CFile, couplingText);
check.ok('a coupling file goes through the same reader and produces the same state',
	CFile.sb.COLSECTION.syncImports === 1 && CFile.sb.COLS.hash() === coupledHash);
var CIdle = load('?start=section');
viaPaste(CIdle, couplingText);
check.ok('a coupling message cannot apply before a cut is reconstructed',
	/no reconstructed section/.test(CIdle.els.sMsg.textContent) && CIdle.sb.COLSECTION.syncImports === 0,
	CIdle.els.sMsg.textContent);

// The carrier delivers the same envelope object; the page still runs parse/apply rather than
// trusting the channel. Clock status is a separate handshake message and has the same path guard.
C.sb.COLSECTION.linkMessage('coupling', JSON.parse(couplingText), 'postMessage');
check.ok('a live carrier uses the same coupling reader, rung and C3 K2 owner',
	C.sb.COLSECTION.syncLive && C.sb.COLSECTION.syncImports === 2 &&
	C.sb.COLSIM.kinematic === C.sb.COLCOUPLING.k2 &&
	/coupling: live postMessage/.test(C.els.hud.textContent));
var livePath = C.sb.COLCOUPLING.pathChecksum(C.sb.COLSECTION.pack), liveT = C.sb.COLSIM.t;
C.sb.COLSECTION.linkMessage('clock', {
	pathChecksum: livePath, tMyr: couplingMsg.tMyr, cadenceMyr: 5, paused: true
}, 'postMessage');
C.sb.COLSECTION.frame();
check.ok('a paused globe pins the section clock and its label',
	C.sb.COLSECTION.syncPaused && C.sb.COLSIM.dG === 0 && C.sb.COLSIM.t === liveT &&
	/globe paused/.test(C.els.hud.textContent), C.els.hud.textContent.split('\n')[0]);
C.sb.COLSECTION.linkMessage('clock', {
	pathChecksum: livePath, tMyr: couplingMsg.tMyr, cadenceMyr: 5, paused: false
}, 'postMessage');
C.sb.COLSECTION.frame();
check.ok('an unpaused handshake resumes inside the advertised cadence',
	!C.sb.COLSECTION.syncPaused && C.sb.COLSIM.t > liveT && /live · globe t/.test(C.els.hud.textContent),
	't ' + C.sb.COLSIM.t.toFixed(3) + ' dG ' + C.sb.COLSIM.dG);
var clockT = C.sb.COLSIM.t;
C.sb.COLSECTION.linkMessage('clock', {
	pathChecksum: '0123456789abcdef', tMyr: couplingMsg.tMyr, paused: true
}, 'postMessage');
check.ok('a clock for another path is refused without pausing the section',
	/pathChecksum/.test(C.els.sMsg.textContent) && C.sb.COLSIM.t === clockT && !C.sb.COLSECTION.syncPaused,
	C.els.sMsg.textContent);

// The return path (§8.5) and the last clause of §8.1 run on this page now: the live import
// answered with a log, the manual rung places what it cannot send, and a link that stops
// answering demotes the section instead of holding its clock hostage.
check.section('D4. the observation return and the abandoned cadence');
var obsText = C.els.sObsOut.value;
check.ok('the live import auto-logged and the manual paste did not spam the out field',
	C.sb.COLSECTION.obsRecords > 0 && obsText.length > 0,
	C.sb.COLSECTION.obsRecords + ' columns logged at the live rung');
var parsedObs = null, obsWhy = '';
try { parsedObs = CLOG.parse(obsText); } catch (e) { obsWhy = e.message; }
check.ok('the out field holds a checksummed pgt-core-log for this exact cut',
	!!parsedObs && parsedObs.packChecksum === C.sb.COLSECTION.pack.checksum &&
	parsedObs.pathChecksum === COUP.pathChecksum(C.sb.COLSECTION.pack),
	obsWhy || (parsedObs ? parsedObs.records.length + ' records, log ' + parsedObs.checksum : 'none'));
C.els.sObsOut.value = '';
C.els.sObs.listeners.click.call(C.els.sObs);
check.ok('the button re-logs the whole section (a threshold build would say nothing here)',
	C.els.sObsOut.value.length > 0 && /ready to copy/.test(C.els.sMsg.textContent),
	C.els.sMsg.textContent);
check.ok('a manual rung records "placed", never a live send it did not make',
	!/sent via/.test(C.els.sMsg.textContent) &&
	C.sb.COLSECTION.link.rung === 'clipboard/file',
	C.sb.COLSECTION.msg);
var ahead = C.sb.COLSIM.t;
C.sb.COLSIM.t = couplingMsg.tMyr + 40;   // eight cadences past the last accepted snapshot
C.sb.COLSECTION.frame();
check.ok('the cadence guard pins the clock and counts the wait',
	C.sb.COLSIM.t === couplingMsg.tMyr + 40 && C.sb.COLSECTION.linkStall === 1,
	'stall ' + C.sb.COLSECTION.linkStall + ', dG ' + C.sb.COLSIM.dG);
C.sb.COLSECTION.linkStall = 239;
C.sb.COLSECTION.frame();
check.ok('an abandoned wait demotes the section: its own solve, K2 released, said unsynced',
	!C.sb.COLSECTION.syncLive && C.sb.COLSECTION.syncStale && C.sb.COLSECTION.couplingMsg === null &&
	C.sb.COLSIM.kinematic === null && /unsynced · own solve \(detached G\)/.test(C.els.hud.textContent),
	C.els.hud.textContent.split('\n')[0]);
var demotedT = C.sb.COLSIM.t;
C.sb.COLSECTION.frame();
check.ok('the demoted clock runs free of the message that never came', C.sb.COLSIM.t > demotedT,
	demotedT.toFixed(3) + ' → ' + C.sb.COLSIM.t.toFixed(3) + ' Myr');
C.sb.COLSECTION.linkMessage('coupling', JSON.parse(couplingText), 'postMessage');
check.ok('a later snapshot re-arms the live state, staleness and all',
	C.sb.COLSECTION.syncLive && !C.sb.COLSECTION.syncStale && C.sb.COLSIM.kinematic === C.sb.COLCOUPLING.k2 &&
	/coupling: live postMessage/.test(C.els.hud.textContent), 'imports ' + C.sb.COLSECTION.syncImports);
check.ok('and answering it goes back to logging, not to waiting',
	/core log: .*ready to copy/.test(C.els.sMsg.textContent), C.els.sMsg.textContent);
var failedCol = 0, oldHF, deltaHF, failedMsg, retryMsg, retryOpts;
while (failedCol < C.sb.COLS.nCol && !(C.sb.COLS.syncValid[failedCol] && C.sb.COLS.hTot[failedCol] > 0)) failedCol++;
oldHF = C.sb.COLS.hFel[failedCol];
deltaHF = Math.max(1000, C.sb.COLS.hTot[failedCol] * 0.01);
C.sb.COLS.hFel[failedCol] += deltaHF;
C.sb.COLSECTION.link.rung = 'postMessage';
C.sb.COLSECTION.link.target = null;
failedMsg = C.sb.COLSECTION.observe(false);
retryOpts = {
	n: C.sb.COLS.nCol, arcKm: C.sb.COLSECTION.pack.path.arcKm,
	pathChecksum: COUP.pathChecksum(C.sb.COLSECTION.pack),
	packChecksum: C.sb.COLSECTION.pack.checksum, tMyr: C.sb.COLSIM.t,
	epochMa: C.sb.COLSECTION.pack.source.epochMa
};
retryMsg = C.sb.COLCORELOG.build(C.sb.COLS, retryOpts);
check.ok('a failed live send leaves the observation due and says it can be copied',
	!!failedMsg && !!retryMsg && failedMsg.checksum === retryMsg.checksum &&
	/send failed · retry pending/.test(C.els.sMsg.textContent) &&
	C.els.sObsOut.value.indexOf(failedMsg.checksum) >= 0,
	C.els.sMsg.textContent);
var obsField = C.sb.COLSECTION.obsOutEl;
C.sb.COLSECTION.obsOutEl = null;
C.sb.COLSECTION.link.rung = 'clipboard/file';
var unplacedMsg = C.sb.COLSECTION.observe(false), unplacedStatus = C.sb.COLSECTION.msg;
C.sb.COLSECTION.obsOutEl = obsField;
var placedRetry = C.sb.COLSECTION.observe(false);
check.ok('a manual observation is not committed when its host has no output field',
	!!unplacedMsg && !!placedRetry && unplacedMsg.checksum === failedMsg.checksum &&
	placedRetry.checksum === failedMsg.checksum &&
	/manual output unavailable · retry pending/.test(unplacedStatus) &&
	/placed · out field ready to copy/.test(C.sb.COLSECTION.msg), C.sb.COLSECTION.msg);
C.sb.COLS.hFel[failedCol] = oldHF;
C.sb.COLCORELOG.reset();
var W2 = load('?start=section');
viaPaste(W2, text);
var baselineLog = W2.sb.COLSECTION.observe(false), resetPack = W2.sb.COLSECTION.pack;
check.ok('a quiet (never imported) section owes the globe its baseline and nothing else',
	W2.sb.COLSECTION.obsRecords > 0,
	W2.sb.COLSECTION.obsRecords + ' columns at first registration');
var resetOpts = {
	n: W2.sb.COLS.nCol, arcKm: resetPack.path.arcKm,
	pathChecksum: COUP.pathChecksum(resetPack), packChecksum: resetPack.checksum,
	tMyr: W2.sb.COLSIM.t, epochMa: resetPack.source.epochMa
};
W2.sb.COLSECTION.clear();
var afterClearLog = W2.sb.COLCORELOG.build(W2.sb.COLS, resetOpts);
check.ok('clearing a section resets which columns the globe has seen',
	!!baselineLog && !!afterClearLog && afterClearLog.records.length === baselineLog.records.length,
	(baselineLog ? baselineLog.records.length : 0) + ' baseline records after clear ' +
	(afterClearLog ? afterClearLog.records.length : 0));

check.section('E. the raw strip says what the pack says');
// the view the page switches to after a load is the reconstruction; `raw cut` (the button,
// not a flag poked from outside) is what puts the strip back
A.els.bRaw.listeners.click.call(A.els.bRaw);
A.sb.COLSECTION.draw();
check.ok('the raw cut switch is the one that is lit, and it is the strip that comes back',
	A.els.bRaw.getAttribute('aria-pressed') === 'true' && /raw cut/.test(A.rec.slice(-A.rec.length).join('\n')),
	'aria-pressed=' + A.els.bRaw.getAttribute('aria-pressed'));
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
// 'fixture-pack' is the id the synthetic fixture wears in this harness: the generated
// bundles in js/data/ (their own gate, experiments/section-bundle.js) keep their real ids
var D = load('?start=section&pack=fixture-pack', { SECTION_PACKS: { 'fixture-pack': FIX.pinned() } });
check.ok('a bundled id loads through the same verify path',
	D.sb.COLSECTION.pack !== null && D.sb.COLSECTION.pack.checksum === pin.checksum
		&& D.sb.COLSECTION.origin === 'fixture-pack', D.sb.COLSECTION.msg);
var E = load('?start=section&pack=no-such-pack');
check.ok('an id with no bundle is a visible refusal, not a guess',
	E.sb.COLSECTION.pack === null && E.sb.COLSECTION.bad === true
		&& /no bundled pack 'no-such-pack'/.test(E.els.sMsg.textContent), E.els.sMsg.textContent);

check.section('G2. the three switches');
var V = load('?start=section');
viaPaste(V, text);
check.ok('the overlay is on, the run switch is off, and both are lit from the state (plan §4.2)',
	V.els.bOvl.getAttribute('aria-pressed') === 'true' && V.els.bRun.getAttribute('aria-pressed') === 'false'
		&& V.els.bRun.disabled === false && V.els.bRaw.disabled === false,
	'aria-pressed bRun=' + V.els.bRun.getAttribute('aria-pressed') + ' disabled=' + V.els.bRun.disabled);
var hash0 = V.sb.COLS.hash(), tStart = V.sb.COLSIM.t;
V.els.bRun.listeners.click.call(V.els.bRun);
V.sb.COLSECTION.frame();
V.sb.COLSECTION.hud();
check.ok('detach and run puts the section on its own clock, one frame at a time',
	V.els.bRun.getAttribute('aria-pressed') === 'true' && V.sb.COLSIM.dG > 0 && V.sb.COLSIM.t > tStart
		&& /running \+/.test(V.els.hud.textContent), 'dG ' + V.sb.COLSIM.dG + ' t ' + V.sb.COLSIM.t.toFixed(5));
var moved = V.sb.COLS.hash();
check.ok('the spin-up line measures the model, not the mapping: one frame and it is no longer zero',
	!/, mean z 0\.0 m/.test(V.els.hud.textContent) && /spin-up since the cut: crust/.test(V.els.hud.textContent),
	V.els.hud.textContent.split('\n').filter(function (l) { return /^spin-up/.test(l); })[0]);
V.els.bRun.listeners.click.call(V.els.bRun);
check.ok('and stopping it leaves the world where the clock put it, without re-laying the cut',
	V.els.bRun.getAttribute('aria-pressed') === 'false' && V.sb.COLSIM.dG === 0 && V.sb.COLS.hash() === moved
		&& moved !== hash0, 't ' + V.sb.COLSIM.t.toFixed(5));
var on = V.rec.length;
V.sb.COLSECTION.draw();
var withOvl = V.rec.slice(on).join('\n');
V.els.bOvl.listeners.click.call(V.els.bOvl);
var off = V.rec.length;
V.sb.COLSECTION.draw();
var noOvl = V.rec.slice(off).join('\n');
check.ok('the overlay paints the cut zM line, the hatch below the crust, and its own label',
	/strokeStyle=rgba\(150,215,235,0.5\)/.test(withOvl) && /fillText\(the cut's own zM/.test(withOvl)
		&& withOvl.length > noOvl.length, withOvl.length + ' calls with it, ' + noOvl.length + ' without');
check.ok('switching it off leaves the engine view alone, exactly',
	V.els.bOvl.getAttribute('aria-pressed') === 'false' && !/rgba\(150,215,235,0.5\)/.test(noOvl),
	V.els.bOvl.getAttribute('aria-pressed'));
check.ok('r and o are the same two switches on the keyboard, and a field being typed into keeps its keys',
	(function () {
		var raw0 = V.sb.COLSECTION.raw, ovl0 = V.sb.COLSECTION.overlay;
		V.sb.COLSECTION.key({ key: 'r' });
		V.sb.COLSECTION.key({ key: 'o', target: { tagName: 'TEXTAREA' } });
		return V.sb.COLSECTION.raw !== raw0 && V.sb.COLSECTION.overlay === ovl0;
	})());
var W = load('?start=section');
viaPaste(W, SP.encode(FIX.windowCut(160, 10, 12400)));
check.ok('a window is laid as a section but cannot be put on the clock (plan §4.4)',
	W.els.bRun.disabled === true && /window · plate clock off/.test(W.els.hud.textContent)
		&& W.sb.COLSIM.dG === 0, W.els.sMsg.textContent);
check.ok('and the frame loop leaves a window alone however it is asked',
	(W.sb.COLSIM.dG = 1e-2, W.sb.COLSECTION.frame(), W.sb.COLSIM.dG === 0), W.sb.COLSIM.dG);
var X = load('?start=section');
var hashX = X.sb.COLS.hash();
var threwH = false;
try { viaPaste(X, SP.encode(FIX.windowCut(64, 8, 45000))); } catch (e) { threwH = true; }
check.ok('a cut the section cannot lay keeps its strip up, with the reason, and no half-world',
	X.sb.COLS.hash() === hashX && X.sb.COLSECTION.world === false && X.sb.COLSECTION.pack !== null
		&& /longer than the section wrap/.test(X.els.sMsg.textContent)
		&& /raw cut|zM/.test(X.rec.join('\n')), X.els.sMsg.textContent);
check.ok('the panel says which of the two answers it is giving (the reader took the bytes)',
	/^loaded /.test(X.sb.COLSECTION.msg) === false && /longer than the section wrap/.test(X.sb.COLSECTION.msg),
	X.sb.COLSECTION.msg);
// the engine's own keys must not fire while the paste box has them (the section page's textarea)
check.ok('typing into the paste box does not reach the engine keys',
	(function () {
		var mesh = V.sb.COLRENDER.mesh;
		V.sb.COLUI.key({ key: 'm', target: { tagName: 'TEXTAREA' } });
		return V.sb.COLRENDER.mesh === mesh;
	})());

check.section('G. the idle strip and the clear');
var I = load('?start=section');
I.sb.COLSECTION.draw();
check.ok('before a cut the strip names the section mode and the panel',
	/section mode/.test(I.rec.join('')) && /Slice panel/.test(I.rec.join('')));
L.els.sPick.value = '';
L.els.sPick.listeners.change.call(L.els.sPick);
check.ok('the empty Cut-from option drops the cut, its world and its overlay',
	L.sb.COLSECTION.pack === null && L.sb.COLSECTION.world === false
		&& L.sb.COLSECTION.spin === null && L.sb.COLS.nCol === 512
		&& L.els.sMsg.textContent === 'cut cleared', L.els.sMsg.textContent);
L.els.sPick.value = 'no-such-pack';
L.els.sPick.listeners.change.call(L.els.sPick);
check.ok('and an id the bundle does not have is a message from the same control',
	/no bundled pack 'no-such-pack'/.test(L.els.sMsg.textContent)
		&& L.sb.COLSECTION.pack === null, L.els.sMsg.textContent);
L.sb.COLSECTION.draw();
check.ok('and the next draw is the idle strip again', /section mode/.test(L.rec.join('')));

console.log('\n  total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
check.done();
