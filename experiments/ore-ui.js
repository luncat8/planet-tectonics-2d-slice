// 0.2.0 M3 UI only: classic-script / file:// wiring, live overlay, probe and mining.
// Run: node experiments/ore-ui.js. No previous milestone harness is invoked.
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var L = require('./lib.js'), check = L.check, html = fs.readFileSync(path.join(L.root, 'columns.html'), 'utf8');
var noop = function () {}, points = [], arcs = [], text = [];
var context = new Proxy({
	createImageData: function (w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
	measureText: function (s) { return { width: s.length * 7 }; },
	moveTo: function (x, y) { points.push([x, y]); }, lineTo: function (x, y) { points.push([x, y]); },
	arc: function (x, y, r) { arcs.push([x, y, r]); }, fillText: function (s) { text.push(s); }
}, { get: function (t, k) { return k in t ? t[k] : noop; }, set: function (t, k, v) { t[k] = v; return true; } });

function events(target) {
	target.listeners = {};
	target.addEventListener = function (type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); };
	target.removeEventListener = function (type, fn) {
		var list = this.listeners[type] || [], at = list.indexOf(fn);
		if (at >= 0) list.splice(at, 1);
	};
	target.fire = function (type, e) {
		e = e || {}; e.target = e.target || this; e.preventDefault = e.preventDefault || noop;
		(this.listeners[type] || []).slice().forEach(function (fn) { fn.call(target, e); });
	};
	return target;
}
function classes() {
	var names = new Set();
	return { add: function (s) { names.add(s); }, remove: function (s) { names.delete(s); }, contains: function (s) { return names.has(s); } };
}
function element(tag, attrs) {
	var e = events({ tagName: tag.toUpperCase(), attrs: attrs || {}, children: [], value: '', disabled: false, hidden: false });
	var content = '';
	Object.defineProperty(e, 'textContent', {
		get: function () { return content; },
		set: function (v) { content = String(v); this.children.length = 0; }
	});
	e.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
	e.setAttribute = function (k, v) { this.attrs[k] = String(v); };
	e.appendChild = function (child) { this.children.push(child); };
	e.checked = 'checked' in e.attrs; e.hidden = 'hidden' in e.attrs; e.disabled = 'disabled' in e.attrs;
	e.width = +(e.attrs.width || 1280); e.height = +(e.attrs.height || 560);
	e.getContext = function () { return context; };
	e.clientLeft = 1; e.clientTop = 1; e.clientWidth = 1280; e.clientHeight = 560;
	e.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1282, height: 562 }; };
	return e;
}
var sb = events({ console: console, location: { search: '' }, performance: { now: function () { return 100; } } });
sb.window = sb; sb.requestAnimationFrame = function (fn) { sb.nextFrame = fn; return 1; };
sb.cancelAnimationFrame = function () { sb.nextFrame = null; };
var doc = { nodeType: 9, defaultView: sb, body: { classList: classes() } };
doc.createElement = function (tag) { var e = element(tag); e.ownerDocument = doc; return e; };
function scope() {
	var els = {}, presets = [];
	var tags = html.match(/<[a-z]+[^>]*>/gi) || [];
	tags.forEach(function (src) {
		var id = src.match(/\bid="([^"]+)"/), attrs = {}, re = /\b([a-z][a-z-]*)(?:="([^"]*)")?/gi, match;
		while ((match = re.exec(src))) attrs[match[1]] = match[2] === undefined ? '' : match[2];
		if (!id && !attrs['data-v']) return;
		var e = element(src.match(/^<([a-z]+)/i)[1], attrs); e.ownerDocument = doc;
		if (id) els[id[1]] = e;
		if (attrs['data-v']) presets.push(e);
	});
	return { els: els, presets: presets, classList: classes(), nodeType: 1, ownerDocument: doc,
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function (sel) { return sel === '#presets button' ? presets : []; } };
}
var main = scope();
doc.getElementById = main.getElementById; doc.querySelectorAll = main.querySelectorAll;
sb.document = doc;
vm.createContext(sb);
var oreGlobals;
L.scriptOrder().forEach(function (file) {
	var before = Object.keys(sb);
	vm.runInContext(fs.readFileSync(path.join(L.root, file), 'utf8'), sb, { filename: file });
	if (file === 'js/ore.js') oreGlobals = Object.keys(sb).filter(function (key) { return before.indexOf(key) < 0; });
});
vm.runInContext('COLSIM.start(document);', sb);
var P = sb.COLP, S = sb.COLS, ORE = sb.COLORE, UI = sb.COLUI, COL = sb.COLCOLUMNS;
var R = sb.COLRENDER, GEO = sb.COLGEO, SIM = sb.COLSIM, SEC = sb.COLSECTION, els = main.els;
var c = 100, cls = P.OCLS, li = P.LITH;

function resources() {
	S.reset(); S.nPlm = 0; S.nRib = 0; S.nVen = 0;
	for (var i = 0; i < S.nCol; i++) {
		S.fert[i] = 1; S.noise[i] = 0; S.colAge[i] = 100;
		COL.push(i, 7000, li.maf, -100, P.FLAG.wet);
		COL.push(i, 35000, li.fel, -50, 0);
		COL.push(i, 2000, li.sed, 10, P.FLAG.wet);
		COL.sums(i);
	}
	SIM.t = 20; SIM.setGeo(0); P.sl.geo = 0; P.sl.erupt = 0;
	sb.COLSURF.profile(0); GEO.setPreset('def'); GEO.lookAt(S.colX[c]); GEO.sync(); GEO.buildColLUT(S);
	UI.clearOre();
}
function add(col, type, grade) {
	var host = type === cls.maf || type === cls.vms ? 0 : type === cls.arc || type === cls.oro ? 1 : 2;
	return ORE.create(S, col, host, type, grade, 20, 0.5);
}
function draw() { GEO.sync(); GEO.buildColLUT(S); R.body(R.px, R.w, R.h); }
function key(k, target, repeat) { sb.fire('keydown', { key: k, target: target || doc.body, repeat: !!repeat }); }

check.section('M3 UI.1 file:// scripts, controls and ranked list');
check.ok('the new module exports only COLORE in classic-script mode', oreGlobals.length === 1 && oreGlobals[0] === 'COLORE');
check.ok('the page loads ore.js before its UI and frame pipeline', L.scriptOrder().indexOf('js/ore.js') < L.scriptOrder().indexOf('js/ui.js') && SIM.k[8] === ORE.k8);
check.ok('deposits start hidden with an accessible page toggle', els.orePanel.hidden && els.bDeposits.getAttribute('aria-pressed') === 'false' && els.bDeposits.getAttribute('aria-controls') === 'orePanel');
check.ok('legend and explicit extraction controls bind inside the page host', els.oreLegend.children.length === cls.n && els.oreMine.listeners.click.length === 1 && els.oreMineAll.listeners.click.length === 1);
resources();
for (var type = 0; type < cls.n; type++) add(c + type, type, 0.8);
var low = add(c + 8, cls.bas, 0.3), high = add(c + 9, cls.bas, 0.95), highId = S.depId[high];
var displayHash = S.hash(); key('d');
check.ok('d opens both live symbols and the ranked resource panel', R.showDeposits && !els.orePanel.hidden && els.bDeposits.getAttribute('aria-pressed') === 'true');
check.ok('each class is present in the ranked list with honest slice tonnage', ORE.NAME.every(function (name) { return els.orePick.children.some(function (option) { return option.textContent.indexOf(name + ' #') === 0 && /Mt\/m/.test(option.textContent); }); }));
var basOptions = els.orePick.children.filter(function (option) { return option.textContent.indexOf('basin #') === 0; });
check.ok('within a class the highest remaining tonnage is first', basOptions[0].value === String(highId));
check.ok('opening, ranking and HUD refresh do not alter model state', (UI.hudText(), S.hash()) === displayHash);
key('d', els.sText); key('d', els.sGeo); key('d', els.orePick); key('d', doc.body, true);
check.ok('typing controls and held keys cannot toggle deposits accidentally', R.showDeposits);
els.bDeposits.fire('click');
check.ok('the button and key share the same renderer-owned state', !R.showDeposits && els.orePanel.hidden && els.bDeposits.getAttribute('aria-pressed') === 'false');
els.bDeposits.fire('click');
check.ok('mining remains disabled until an explicit selection', els.oreMine.disabled && els.oreMineAll.disabled);
els.orePick.value = String(highId); els.orePick.fire('change');
check.ok('selection shows real host, mineralization, depth and frozen grade', UI.selectedDepId === highId && !els.oreMine.disabled && /layer 2/.test(els.oreInfo.textContent) && /grade index/.test(els.oreInfo.textContent) && /mineralized 20/.test(els.oreInfo.textContent));
var extra = add(c + 10, cls.bas, 0.4); UI.hudText();
check.ok('2 Hz HUD refresh preserves stable-id selection as the table grows', UI.selectedDepId === highId && els.orePick.value === String(highId) && S.depId[extra] !== highId);
var shapes = [];
for (type = 0; type < cls.n; type++) {
	points.length = 0; arcs.length = 0; R.depositGlyph(context, type, 20, 20);
	shapes.push(JSON.stringify([points, arcs]));
}
check.ok('all six classes have distinct finite overlay glyphs', new Set(shapes).size === cls.n && points.every(function (p) { return Number.isFinite(p[0]) && Number.isFinite(p[1]); }));
var refreshes = 0, updateOre = UI.updateOre;
UI.updateOre = function () { refreshes++; return updateOre.call(this); };
sb.COLPERF.last = 0; sb.COLPERF.hudAt = 0;
for (var frame = 1; frame <= 60; frame++) sb.nextFrame(frame * 1000 / 60);
check.ok('the actual 60-frame loop rebuilds the ranked list at 2 Hz, not every frame', refreshes === 2, refreshes + ' refreshes');
els.bDeposits.fire('click'); refreshes = 0;
for (frame = 61; frame <= 120; frame++) sb.nextFrame(frame * 1000 / 60);
check.ok('the hidden list is not rebuilt even on the HUD cadence', refreshes === 0);
UI.updateOre = updateOre; els.bDeposits.fire('click');

check.section('M3 UI.2 explicit extraction and stale selection');
var budget = S.depVol[ORE.byId(S, highId)], bed = S.depLay[ORE.byId(S, highId)];
var beforeRock = S.layTh[(c + 9) * P.layerCap + bed], beforeCons = S.ledCons[li.sed];
els.oreMine.fire('click');
check.near('extract 10% mines precisely the selected remaining budget', S.depVol[ORE.byId(S, highId)], budget * 0.9, 1e-12);
check.near('the browser action books the same area as consumed sediment', S.ledCons[li.sed] - beforeCons, budget * 0.1, 1e-12);
check.near('the displayed host is real rock, not a detached resource counter', beforeRock - S.layTh[(c + 9) * P.layerCap + bed], budget * 0.1 / S.colW[c + 9], 1e-12);
check.ok('status explains the irreversible explicit action', /booked as consumed host rock/.test(els.oreStatus.textContent) && /no automatic refill/.test(els.oreStatus.textContent));
els.oreMineAll.fire('click');
check.ok('extract remainder removes the resource and clears selection', ORE.byId(S, highId) < 0 && UI.selectedDepId === 0 && els.oreMine.disabled && els.oreMineAll.disabled);
check.ok('exhausted ids disappear from the ranked list, not just the overlay', !els.orePick.children.some(function (option) { return option.value === String(highId); }));
var stale = S.depId[low], unaffected = S.depVol[0];
UI.selectedDepId = stale; S.depCol[ORE.byId(S, stale)] = -1; ORE.reap(S);
els.oreMine.fire('click');
check.ok('an action on a retired selection cannot mine the next table slot', UI.selectedDepId === 0 && S.depVol[0] === unaffected);

check.section('M3 UI.3 actual overlay paths, stretch, wrap and probe');
resources(); var record = add(c, cls.bas, 0.8), id = S.depId[record];
UI.selectedDepId = id; UI.updateOre(); draw();
points.length = 0; arcs.length = 0; var stateBeforePaint = S.hash(), viewBefore = JSON.stringify(P.view);
R.overlayDeposits();
var centre = arcs.find(function (a) { return a[2] === 3; });
check.ok('a live bed resource draws its class glyph and stable-id selection ring', !!centre && arcs.some(function (a) { return a[2] === 7; }));
check.ok('deposit overlay paths are finite and leave state / camera untouched', points.concat(arcs).every(function (p) { return Number.isFinite(p[0]) && Number.isFinite(p[1]); }) && S.hash() === stateBeforePaint && JSON.stringify(P.view) === viewBefore);
var sx = centre[0], at = sx | 0, stretch = (R.profY[at] - R.mohoY[at]) / S.hDraw[c];
check.near('the glyph depth matches the body raster\'s actual column stretch', centre[1], GEO.sy(R.profY[at] - ORE.depth(S, record) * stretch), 1e-12);
R.updateProbe(sx, centre[1]);
check.ok('hovering the glyph reads its host and current finite resource in the geology probe', R.probe.indexOf('basin #' + id) >= 0 && /Mt\/m/.test(R.probe) && /grade/.test(R.probe));
ORE.extract(S, id, S.depVol[record]); draw(); points.length = 0; arcs.length = 0; R.overlayDeposits(); R.updateProbe(sx, centre[1]);
check.ok('a fully mined resource vanishes from symbols and the live probe', arcs.length === 0 && R.probe.indexOf('basin #' + id) < 0);
resources(); record = add(S.nCol - 1, cls.bas, 0.8); GEO.lookAt(0); draw();
points.length = 0; arcs.length = 0; R.overlayDeposits();
check.ok('the wrapped last-column resource draws beside the seam without a false long segment', arcs.some(function (a) { return a[2] === 3 && a[0] > 0 && a[0] < P.cw; }) && points.every(function (p) { return p[0] >= 0 && p[0] <= P.cw; }));
var bodyHash = S.hash(); GEO.setPreset('cru'); draw(); R.overlayDeposits();
check.ok('zoom changes geometry but never resource state or depletion history', S.hash() === bodyHash);
resources(); record = add(c, cls.bas, 0.8); id = S.depId[record];
els.orePick.value = String(id); els.orePick.fire('change');
var checkpoint = sb.COLCHECKPOINT.save();
ORE.extract(S, id, S.depVol[record]); sb.COLCHECKPOINT.load(checkpoint);
check.ok('restore returns budgets but requires a fresh explicit selection', ORE.byId(S, id) >= 0 && UI.selectedDepId === 0 && R.selectedDepId === 0 && els.oreMine.disabled);
UI.selectedDepId = id; UI.updateOre(); SIM.reset();
check.ok('reset clears old selection before the new world can reuse ids', UI.selectedDepId === 0 && R.selectedDepId === 0 && els.oreMine.disabled && els.oreMineAll.disabled && els.orePick.children.length === 0);

check.section('M3 UI.4 reconstructed / raw cuts and lifecycle');
SIM.stop(); sb.location.search = '?start=section';
SIM.start(doc);
check.ok('an empty raw section has no extraction domain', !UI.oreAvailable() && els.bDeposits.disabled);
var packId = Object.keys(sb.SECTION_PACKS)[0]; SEC.loadPack(sb.SECTION_PACKS[packId], packId);
check.ok('a file:// bundled cut shares the same live resource UI after reconstruction', SEC.world && UI.host === doc && UI.oreAvailable() && SIM.dG === 0);
if (!R.showDeposits) key('d');
SEC.toggleRaw();
var rawHash = S.hash(); els.oreMine.fire('click');
check.ok('raw-cut mode disables mining and cannot mutate a hidden reconstructed world', !UI.oreAvailable() && els.oreMine.disabled && els.oreMineAll.disabled && S.hash() === rawHash && /not the raw cut/.test(els.oreInfo.textContent));
SEC.toggleRaw();
check.ok('returning from raw mode re-enables the same live ranked instrument', UI.oreAvailable() && !els.orePick.disabled);
SIM.stop(); sb.location.search = '';
var scoped = scope(); SIM.start(scoped);
check.ok('an element host scopes new ore controls instead of the old document', UI.orePick === scoped.els.orePick && scoped.els.bDeposits.listeners.click.length === 1 && els.bDeposits.listeners.click.length === 0);
var bindings = UI._listeners.length; SIM.start(scoped);
check.ok('starting the same host twice does not duplicate mining handlers', UI._listeners.length === bindings && scoped.els.oreMine.listeners.click.length === 1);
SIM.stop();
check.ok('stop releases deposit, selection and extraction listeners', scoped.els.bDeposits.listeners.click.length === 0 && scoped.els.oreMine.listeners.click.length === 0 && scoped.els.orePick.listeners.change.length === 0);
sb.location.search = '?start=section'; SIM.start(scoped);
check.ok('a reused host disables deposits while an empty cut is waiting', scoped.els.bDeposits.disabled);
SIM.stop(); sb.location.search = ''; SIM.start(scoped);
check.ok('returning that same host to a planet re-enables its deposit button', !scoped.els.bDeposits.disabled && UI.oreAvailable());
SIM.stop();
check.done();
