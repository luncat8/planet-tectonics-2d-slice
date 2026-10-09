// 0.2.0 M4 UI: the E1/E3 chrome (seed field, save / load state), the diagnostic HUD
// (fps, sim ms, toy step cost, the 2 Hz invariant sweep with the ledDelam line) and the
// fault-injection proof that each invariant actually fires. Classic scripts in a vm with
// a lightweight DOM and recording canvas, like experiments/ore-ui.js. Not a browser
// pixel / end-to-end fps test.
// Run: node experiments/diag-ui.js
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var L = require('./lib.js'), check = L.check, html = fs.readFileSync(path.join(L.root, 'columns.html'), 'utf8');
var noop = function () {}, clicked = null, savedBlob = null;
var context = new Proxy({
	createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
	measureText: function (s) { return { width: s.length * 7 }; }
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
	e.click = function () { clicked = this; };
	e.checked = 'checked' in e.attrs; e.hidden = 'hidden' in e.attrs; e.disabled = 'disabled' in e.attrs;
	e.width = +(e.attrs.width || 1280); e.height = +(e.attrs.height || 560);
	e.getContext = function () { return context; };
	e.clientLeft = 1; e.clientTop = 1; e.clientWidth = 1280; e.clientHeight = 560;
	e.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1282, height: 562 }; };
	return e;
}
var clockMs = 0;
var sb = events({ console: console, location: { search: '' }, performance: { now: function () { return (clockMs += 0.37); } } });
sb.window = sb; sb.requestAnimationFrame = function (fn) { sb.nextFrame = fn; return 1; };
sb.btoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
sb.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
sb.cancelAnimationFrame = function () { sb.nextFrame = null; };
sb.Blob = function (parts, opts) { this.parts = parts; this.type = opts && opts.type; };
sb.URL = { createObjectURL: function (blob) { savedBlob = blob; return 'blob:stub'; } };
sb.FileReader = function () {
	var self = this;
	this.readAsText = function (file) { self.result = file.text; if (self.onload) self.onload(); };
};
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
L.scriptOrder().forEach(function (file) {
	vm.runInContext(fs.readFileSync(path.join(L.root, file), 'utf8'), sb, { filename: file });
});
vm.runInContext('COLSIM.start(document);', sb);
var P = sb.COLP, S = sb.COLS, UI = sb.COLUI, SIM = sb.COLSIM, GEO = sb.COLGEO;
var CP = sb.COLCHECKPOINT, PERF = sb.COLPERF, els = main.els;

function frames(n, t0) {
	for (var i = 1; i <= n; i++) sb.nextFrame(((t0 || 0) + i) * 1000 / 60);
}
function key(k, target, repeat) { sb.fire('keydown', { key: k, target: target || doc.body, repeat: !!repeat }); }
function hud() { return UI.hudText(); }

check.section('M4 UI.1 the seed field is the new-planet control');
check.ok('the planet bar carries seed, save and load controls', els.sSeed && els.bSave && els.bLoad &&
	els.bLoad.attrs.accept.indexOf('json') >= 0);
check.ok('the seed field shows the run seed at init', els.sSeed.value === String(P.seed),
	'value ' + els.sSeed.value);
P.sl.geo = 50e3; P.sl.erupt = 14400; SIM.setGeo(P.sl.geo);
els.sSeed.value = '77'; els.sSeed.fire('keydown', { key: 'Enter' });
check.ok('Enter rebuilds the planet from the typed seed', P.seed === 77 && SIM.t === 0 && SIM.frame === 0,
	'seed ' + P.seed);
check.ok('the field keeps the canonical seed text', els.sSeed.value === '77');
var seedHash;
SIM.reset(); frames(60); seedHash = S.hash();
els.sSeed.value = '3'; els.sSeed.fire('keydown', { key: 'Enter' });
frames(20);
els.sSeed.value = '77'; els.sSeed.fire('keydown', { key: 'Enter' });
frames(60);
check.ok('the same seed replays the same world bitwise', S.hash() === seedHash, 'hash ' + S.hash());
els.sSeed.fire('keydown', { key: 'm' });
check.ok('typing in the seed field cannot toggle page keys', !sb.COLRENDER.mesh);
key('m', els.sSeed);
check.ok('the global key handler ignores inputs', !sb.COLRENDER.mesh);
key('m');
check.ok('the page key works on the body', sb.COLRENDER.mesh); key('m');

check.section('M4 UI.2 save state / load state through the buttons');
els.sSeed.value = '7'; els.sSeed.fire('keydown', { key: 'Enter' });
frames(30);
var hSaved = S.hash();
clicked = null; savedBlob = null;
els.bSave.fire('click');
check.ok('save state downloads a session JSON', savedBlob && clicked && clicked.download &&
	savedBlob.type === 'application/json', savedBlob ? savedBlob.parts[0].length + ' chars' : 'no blob');
var session = JSON.parse(savedBlob.parts[0]);
check.ok('the file is the one session codec with every array inside',
	session.format === CP.SESSION_FORMAT && typeof session.runtime === 'string' && session.version === CP.SESSION_VERSION);
check.ok('a save records the seed in its file name', /session-seed7-/.test(clicked.download), clicked.download);
frames(17);
check.ok('the live run moved on from the save', S.hash() !== hSaved);
els.sGeo.value = '900'; els.sGeo.fire('input');
check.ok('a slider move changes the clock widget', els.vGeo.textContent === UI.fmtGeo(P.sl.geo) &&
	P.sl.geo !== 50e3);
els.bLoad.files = [{ text: savedBlob.parts[0] }];
els.bLoad.fire('change');
check.ok('load state restores the save bitwise', S.hash() === hSaved, 'hash ' + S.hash());
check.ok('the seed field follows the restored world', els.sSeed.value === '7');
check.ok('the two clock widgets re-read the restored sliders',
	els.vGeo.textContent === UI.fmtGeo(P.sl.geo) && els.vErupt.textContent === UI.fmtErupt(P.sl.erupt) &&
	+els.sGeo.value === Math.round(1000 * UI.gToS(P.sl.geo)) &&
	+els.sErupt.value === Math.round(1000 * UI.eToS(P.sl.erupt)));

check.section('M4 UI.3 the diagnostic HUD at 2 Hz');
var text = hud();
check.ok('the HUD shows fps, sim ms and the toy step cost', /fps /.test(text) && /sim /.test(text) &&
	/toy \d/.test(text), text.split('\n')[2]);
check.ok('the invariant line names every gate', /invariants/.test(text) && /sorted ok/.test(text) &&
	/widths ok/.test(text) && /plates ok/.test(text) && /ledger ok/.test(text) && /gap ok/.test(text));
check.ok('the per-lithology ledger line closes and shows the delam sink',
	/sed ok/.test(text) && /fel ok/.test(text) && /maf ok/.test(text) && /tephra ok/.test(text) &&
	/lava ok/.test(text) && /sill ok/.test(text) && /delam /.test(text));
var displayHash = S.hash();
hud();
check.ok('a HUD repaint is read-only against the model', S.hash() === displayHash);
var diagCalls = 0, diagText = SIM.diagText;
SIM.diagText = function () { diagCalls++; return diagText.call(this); };
PERF.last = 0; PERF.hudAt = 0;
frames(60);
check.ok('the real 60-frame loop runs the sweep at 2 Hz, not every frame', diagCalls === 2,
	diagCalls + ' sweeps');
SIM.diagText = diagText;

check.section('M4 UI.4 each invariant fires on its own fault');
function expectFail(name, re) {
	var t = hud();
	check.ok(name + ' is reported FAIL', re.test(t), t.split('\n')[0]);
}
function healed(label) {
	var t = hud();
	check.ok(label + ' clears back to all-ok', /sorted ok/.test(t) && /widths ok/.test(t) &&
		/plates ok/.test(t) && /ledger ok/.test(t) && /gap ok/.test(t));
}
var keep = S.sortOrder[0];
S.sortOrder[0] = S.sortOrder[1];
expectFail('a broken sort permutation', /sorted FAIL/);
S.sortOrder[0] = keep;
healed('the sort table');
keep = S.colW[5]; S.colW[5] += P.w0;
expectFail('a width table that no longer sums to the wrap', /widths FAIL/);
S.colW[5] = keep;
healed('the widths');
keep = S.plN[0]; S.plN[0] += 1;
expectFail('a plate census that disagrees with colPlate', /plates FAIL/);
S.plN[0] = keep;
healed('the plate counts');
keep = S.ledProd[P.LITH.fel]; S.ledProd[P.LITH.fel] += 1e9;
expectFail('a ledger line out of balance', /ledger FAIL/);
S.ledProd[P.LITH.fel] = keep;
healed('the ledger');
var pair = -1, i;
for (i = 0; i < S.nCol - 1 && pair < 0; i++) if (S.colPlate[i] !== S.colPlate[i + 1]) pair = i;
var j = (pair + 1) % S.nCol, keepX = S.colX[j];
S.colX[j] = S.colX[pair] + 0.01 * P.w0;
expectFail('an inter-plate gap under the contact floor', /gap FAIL/);
S.colX[j] = keepX;
healed('the gap');
els.sSeed.value = '7'; els.sSeed.fire('keydown', { key: 'Enter' });
healed('a rebuilt planet');

check.section('M4 UI.5 the done protocol through the page loop at two zooms');
P.sl.geo = 50e3; P.sl.erupt = 14400; SIM.setGeo(P.sl.geo);
SIM.reset();
frames(40);
var snap = CP.save(), hSnap = S.hash();
GEO.setPreset('def');
frames(120);
var hDef = S.hash();
CP.load(snap);
check.ok('the loop-level reload is bit-identical', S.hash() === hSnap, 'hash ' + S.hash());
GEO.setPreset('ovw');
frames(120);
check.ok('120 redrawn frames at overview match the same run at default zoom',
	S.hash() === hDef, 'hash ' + S.hash());
GEO.setPreset('cru');
CP.load(snap);
frames(120);
check.ok('and at crust x10', S.hash() === hDef, 'hash ' + S.hash());
check.ok('the invariants hold through the redrawn loop', /sorted ok/.test(hud()) && /gap ok/.test(hud()));

check.done();
