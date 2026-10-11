// pt-ui.js — the primary particle page's browser wiring check. It loads js/pt/* in
// index.html's own order inside a vm context whose DOM is parsed from that page. The
// particles.html entry remains an exact mirror, so a stale secondary URL fails here too.
//
// The part worth gating is the switch bar: every toggle button lights itself from the
// renderer's own flag (aria-pressed, styled by the page) and every path that flips a
// flag -- the button, the keyboard, the quality cycle -- must leave the two in agreement.
// The harness therefore drives every button and every key and reads the attribute back.
//
// Run: node experiments/pt-ui.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var check = require('./lib.js').check;

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var aliasHtml = fs.readFileSync(path.join(root, 'particles.html'), 'utf8');

// --- the page told the truth about its own scripts ------------------------------

function scriptOrder() {
	var re = /<script[^>]+src="([^"]+)"/g, out = [], m;
	while ((m = re.exec(html)) !== null) out.push(m[1]);
	return out;
}

function idsIn(src) {
	var re = /id="([^"]+)"/g, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}

function buttonIds(src) {
	var re = /<button id="([^"]+)"/g, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}

// every attribute the element's own tag carries, so the harness reads the state a browser
// shows before ui.js runs (aria-pressed on the switches)
function attrsIn(id) {
	var tags = html.match(/<[a-z]+[^>]*>/gi) || [], attrs = {}, re = /([a-z-]+)(?:="([^"]*)")?/gi, m, i;
	for (i = 0; i < tags.length; i++) {
		if (tags[i].indexOf('id="' + id + '"') < 0) continue;
		while ((m = re.exec(tags[i])) !== null) attrs[m[1]] = m[2] === undefined ? '' : m[2];
		return attrs;
	}
	return attrs;
}

// --- the DOM stub ---------------------------------------------------------------

var ctx2d = new Proxy({
	createImageData: function (w, h) {
		return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
	}
}, {
	get: function (t, k) { return k in t ? t[k] : function () {}; },
	set: function (t, k, v) { t[k] = v; return true; }
});

function makeCanvas(w, h) {
	return {
		width: w, height: h, clientWidth: w, clientHeight: h, clientLeft: 0, clientTop: 0,
		listeners: {},
		addEventListener: function (t, f) { this.listeners[t] = f; },
		getContext: function () { return ctx2d; },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: w, height: h }; }
	};
}

function makeEl(id) {
	return {
		id: id, value: '0', textContent: '', checked: false,
		attrs: attrsIn(id), listeners: {},
		addEventListener: function (t, f) { this.listeners[t] = f; },
		getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
		setAttribute: function (n, v) { this.attrs[n] = String(v); }
	};
}

var IDS = idsIn(html);
var BUTTONS = buttonIds(html);
var ORDER = scriptOrder();

function load() {
	var els = {}, i, t = 0;
	for (i = 0; i < IDS.length; i++) els[IDS[i]] = IDS[i] === 'c' ? makeCanvas(1280, 560) : makeEl(IDS[i]);
	var sb = {
		console: console,
		performance: { now: function () { return t; } },
		requestAnimationFrame: function (f) { sb.__next = f; return 1; },
		addEventListener: function (ty, f) { (sb.__win = sb.__win || {})[ty] = f; },
		_t: function () { return t; }, _setT: function (x) { t = x; }
	};
	sb.window = sb;
	sb.document = {
		getElementById: function (id) { return els[id] || null; },
		createElement: function (tag) { return tag === 'canvas' ? makeCanvas(1, 1) : makeEl(tag); }
	};
	vm.createContext(sb);
	for (i = 0; i < ORDER.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, ORDER[i]), 'utf8'), sb, { filename: ORDER[i] });
	}
	return { sb: sb, els: els };
}

function frames(L, n) {
	for (var i = 0; i < n; i++) {
		L.sb._setT(L.sb._t() + 16.7);
		L.sb.__next(L.sb._t());
	}
}

function ev(type, o) {
	var e = { preventDefault: function () {} };
	for (var k in o) e[k] = o[k];
	return e;
}

function lit(el) { return el.attrs['aria-pressed'] === 'true'; }

// --- A. the page -----------------------------------------------------------------

check.section('A. page load (index.html order, ' + ORDER.length + ' scripts)');
check.ok('particles.html stays in sync with the primary entry', html === aliasHtml);
var onDisk = fs.readdirSync(path.join(root, 'js', 'pt')).filter(function (f) { return /\.js$/.test(f); })
	.map(function (f) { return 'js/pt/' + f; });
onDisk.push('js/perf.js');
check.ok('index.html loads every js/pt/*.js exactly once',
	onDisk.length === ORDER.length && onDisk.every(function (f) { return ORDER.indexOf(f) >= 0; }),
	ORDER.join(' '));
check.ok('the DOM stub found the bar', IDS.length >= 16, IDS.join(','));
var L = load();
// sim.js exports nothing: it is the page's bootstrap and its SIM is a plain page global
var P = L.sb.PTP, SIM = L.sb.SIM, UI = L.sb.PTUI, R = L.sb.PTRNDR, TS = L.sb.PTS;
check.ok('the page loaded and started the frame loop', typeof L.sb.__next === 'function');
check.ok('the engine built its mesh', SIM.M.nx === 256 && SIM.M.ny === 24,
	SIM.M.nx + 'x' + SIM.M.ny);
check.ok('the markers are placed, and the reserve starts empty', TS.n === P.partBase && P.partBase < P.partCap,
	'n ' + TS.n + '/' + P.partBase + ' base, ' + P.partCap + ' capacity');
frames(L, 20);
check.ok('20 frames advanced the clock', SIM.t > 0.9 && SIM.t < 1.1, 't ' + SIM.t.toFixed(2) + ' Myr');
check.ok('the HUD is built', /^t .*\nNu /m.test(L.els.hud.textContent) || /Nu /.test(L.els.hud.textContent),
	JSON.stringify(L.els.hud.textContent.split('\n')[0]));
// a fresh page is all mantle: no melt, air or deposit yet, and no refusal to report
var phaseLine = /phase mantle (\d+)  melt 0  air 0  dep 0   mass [^\n]* km2   H [^\n]*hLedger/.exec(L.els.hud.textContent);
check.ok('the HUD phase line counts the all-mantle pool', phaseLine !== null && +phaseLine[1] === P.partBase,
	phaseLine ? 'mantle ' + phaseLine[1] : 'no phase line in the HUD');
check.ok('and prints no refusal while the reserve holds', !/refused/.test(L.els.hud.textContent) && TS.tx.refuse === 0,
	'refused ' + TS.tx.refuse);

// --- B. the switch bar -----------------------------------------------------------

check.section('B. the switch bar: every button wired, every state lit');
check.ok('index.html carries the lit rule', /button\[aria-pressed="true"\]/.test(html));
check.ok('every button in the bar is wired',
	BUTTONS.every(function (id) { return typeof L.els[id].listeners.click === 'function'; }),
	BUTTONS.join(','));
check.ok('the markup ships the renderer defaults before ui.js runs',
	attrsIn('bMark')['aria-pressed'] === 'true' && attrsIn('bRuler')['aria-pressed'] === 'true' &&
	attrsIn('bMesh')['aria-pressed'] === 'false' && attrsIn('bFull')['aria-pressed'] === 'true' &&
	attrsIn('bPause')['aria-pressed'] === 'false',
	'mark ' + attrsIn('bMark')['aria-pressed'] + ' mesh ' + attrsIn('bMesh')['aria-pressed']);
frames(L, 1);
check.ok('at load the five overlays are lit and agree with the renderer',
	lit(L.els.bMark) && lit(L.els.bMelt) && lit(L.els.bCrust) && lit(L.els.bRelief) && lit(L.els.bRuler) &&
	R.markers && R.melt && R.crust && R.relief && R.ruler);
L.els.bMark.listeners.click(ev('click', {}));
check.ok('the markers button puts the stipple out', R.markers === false && !lit(L.els.bMark));
L.els.bMark.listeners.click(ev('click', {}));
check.ok('and the second click brings it back', R.markers === true && lit(L.els.bMark));
var key = L.sb.__win.keydown;
key(ev('keydown', { key: 'm' }));
check.ok('m flips the flag and the button together', R.markers === false && !lit(L.els.bMark));
key(ev('keydown', { key: 'm' }));
var keys = [['v', 'melt', 'bMelt'], ['c', 'crust', 'bCrust'], ['w', 'relief', 'bRelief'], ['g', 'ruler', 'bRuler']];
check.ok('v/c/g each own a button', keys.every(function (k) {
	key(ev('keydown', { key: k[0] }));
	var off = R[k[1]] === false && !lit(L.els[k[2]]);
	key(ev('keydown', { key: k[0] }));
	return off && R[k[1]] === true && lit(L.els[k[2]]);
}));

check.section('C. quality, transport and the clock');
check.ok('the quality button names the shipped level', L.els.bMesh.textContent === 'quality 1/3' && !lit(L.els.bMesh),
	JSON.stringify(L.els.bMesh.textContent));
L.els.bMesh.listeners.click(ev('click', {}));
check.ok('cycling the quality button rebuilds the mesh at 512x48',
	P.mesh.nx === 512 && P.mesh.ny === 48 && UI.quality === 1,
	P.mesh.nx + 'x' + P.mesh.ny);
check.ok('the quality button is lit and labelled at 2/3',
	lit(L.els.bMesh) && L.els.bMesh.textContent === 'quality 2/3',
	JSON.stringify(L.els.bMesh.textContent));
key(ev('keydown', { key: '3' }));
check.ok('key 3 selects the 1024x96 mesh', P.mesh.nx === 1024 && P.mesh.ny === 96);
key(ev('keydown', { key: '1' }));
check.ok('key 1 returns to the light mesh and puts the button out',
	P.mesh.nx === 256 && UI.quality === 0 && !lit(L.els.bMesh));
L.els.bPause.listeners.click(ev('click', {}));
check.ok('pause lights the button and renames it to play',
	UI.paused === true && lit(L.els.bPause) && L.els.bPause.textContent === 'play');
var tt = SIM.t;
frames(L, 5);
check.ok('a paused page does not advance', SIM.t === tt, 't ' + SIM.t.toFixed(3));
L.els.bStep.listeners.click(ev('click', {}));
frames(L, 1);
check.ok('step runs exactly one frame while paused', SIM.t > tt && SIM.t < tt + 0.06,
	't ' + SIM.t.toFixed(3) + ' Myr');
key(ev('keydown', { key: ' ' }));
check.ok('space resumes and puts the pause button out',
	UI.paused === false && !lit(L.els.bPause) && L.els.bPause.textContent === 'pause');
key(ev('keydown', { key: ' ' }));
key(ev('keydown', { key: '.' }));
check.ok('the step key pauses too, and the button says so',
	UI.paused === true && lit(L.els.bPause) && L.els.bPause.textContent === 'play');
key(ev('keydown', { key: ' ' }));
L.els.bNew.listeners.click(ev('click', {}));
check.ok('new planet draws the next seed and resets the clock',
	P.seed === 2 && SIM.t === 0, 'seed ' + P.seed);
L.els.bReset.listeners.click(ev('click', {}));
check.ok('reset keeps the seed and the clock at zero', P.seed === 2 && SIM.t === 0);
var clk = L.els.sClock.listeners.input;
L.els.sClock.value = '0'; clk.call(L.els.sClock);
check.ok('the clock slider at zero is a pause', P.sl.kyr === 0 && SIM.dt === 0 && L.els.vClock.textContent === 'pause');
L.els.sClock.value = '500'; clk.call(L.els.sClock);
check.ok('and at the top it is the maximum rate', P.sl.kyr === P.dtMax && SIM.dt === P.dtMax / 1000,
	P.sl.kyr + ' kyr/f');

check.section('D. the camera presets are a radio group');
UI.preset('mantle', SIM);
check.ok('mantle is lit at load, and only it',
	lit(L.els.bFull) && !lit(L.els.bLid) && !lit(L.els.bDeep));
L.els.bLid.listeners.click(ev('click', {}));
check.ok('the lid button lights and frames the lid',
	lit(L.els.bLid) && !lit(L.els.bFull) && Math.abs(P.view.eB - Math.asinh(600 / SIM.M.yLin)) < 1e-12,
	'eB ' + P.view.eB.toFixed(4));
key(ev('keydown', { key: 'd' }));
check.ok('the deep key lights deep', lit(L.els.bDeep) && !lit(L.els.bLid));
key(ev('keydown', { key: 'f' }));
check.ok('the mantle key lights mantle again', lit(L.els.bFull) && !lit(L.els.bDeep));
L.els.c.listeners.wheel(ev('wheel', { deltaY: -120, clientX: 640, clientY: 280 }));
check.ok('a wheel zoom puts the whole group out',
	!lit(L.els.bLid) && !lit(L.els.bDeep) && !lit(L.els.bFull));
UI.preset('deep', SIM);
L.els.c.listeners.mousedown(ev('mousedown', { clientX: 300, clientY: 200 }));
L.sb.__win.mousemove(ev('mousemove', { clientX: 360, clientY: 200 }));
L.sb.__win.mouseup(ev('mouseup', {}));
check.ok('a drag leaves the preset too', !lit(L.els.bDeep), 'cx ' + P.view.cx.toFixed(1));
L.sb.__win.mousemove(ev('mousemove', { clientX: 200, clientY: 150 }));
check.ok('the probe reads the field under the cursor',
	UI.probeOn && /^x -?\d+ km/.test(UI.probe), JSON.stringify(UI.probe));

check.done();
