// smoke.js — the browser wiring check. Loads js/* in index.html order inside a vm
// context whose DOM is parsed *from index.html* (so a missing id or a renamed preset
// button fails here, not in the browser), then exercises every control and checks the
// clocks, the view, the probe and run determinism.
// Run: node experiments/smoke.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var lib = require('./lib.js');
var check = lib.check;

var root = lib.root;
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var order = lib.scriptOrder();

// --- a DOM derived from index.html ---------------------------------------------

function idsIn(src) {
	var re = /id="([^"]+)"/g, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}

function presetButtons(src) {
	var span = src.match(/<span id="presets">([\s\S]*?)<\/span>/);
	if (!span) return [];
	var re = /<button data-v="([^"]+)"/g, out = [], m;
	while ((m = re.exec(span[1])) !== null) out.push(m[1]);
	return out;
}

// a no-op 2d context with a real ImageData behind it, so the body pass writes pixels
var ctx2d = new Proxy({
	createImageData: function (w, h) {
		return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
	}
}, {
	get: function (t, k) { return k in t ? t[k] : function () {}; },
	set: function (t, k, v) { t[k] = v; return true; }
});

function makeEl(id, dataV) {
	return {
		id: id, value: '0', textContent: '', dataset: dataV ? { v: dataV } : null,
		listeners: {},
		clientLeft: id === 'c' ? 1 : 0, clientTop: id === 'c' ? 1 : 0,
		clientWidth: id === 'c' ? 1280 : 0, clientHeight: id === 'c' ? 560 : 0,
		addEventListener: function (t, f) { this.listeners[t] = f; },
		getBoundingClientRect: function () {
			return id === 'c'
				? { left: 0, top: 0, width: 1282, height: 562 }
				: { left: 0, top: 0, width: 1280, height: 560 };
		},
		getContext: function () { return ctx2d; },
		getAttribute: function (n) {
			if (n === 'data-v') return this.dataset ? this.dataset.v : null;
			return null;
		}
	};
}

var IDS = idsIn(html);
var BUTTONS = presetButtons(html);

function load(t0) {
	var els = {}, i;
	for (i = 0; i < IDS.length; i++) els[IDS[i]] = makeEl(IDS[i]);
	var btns = BUTTONS.map(function (v) { return makeEl('preset-' + v, v); });
	var t = t0 || 0;
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
		querySelectorAll: function (sel) { return sel === '#presets button' ? btns : []; }
	};
	vm.createContext(sb);
	for (i = 0; i < order.length; i++) {
		vm.runInContext(fs.readFileSync(path.join(root, order[i]), 'utf8'), sb,
			{ filename: order[i] });
	}
	return { sb: sb, els: els, btns: btns };
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

check.section('A. page load (index.html order, ' + order.length + ' scripts)');
var onDisk = fs.readdirSync(path.join(root, 'js')).filter(function (f) { return /\.js$/.test(f); });
check.ok('index.html loads every js/*.js file exactly once', onDisk.length === order.length &&
	onDisk.every(function (f) { return order.indexOf('js/' + f) >= 0; }), order.join(' '));
check.ok('the DOM stub found every id in index.html', IDS.length >= 8, IDS.join(','));
check.ok('the preset buttons come from index.html', BUTTONS.length === 4, BUTTONS.join(','));
var L = load();
check.ok('page loaded and started the frame loop', typeof L.sb.__next === 'function');
check.ok('SIM ran a planet reset', L.sb.SIM.t === 0 && L.sb.S.nCol === 512,
	't=' + L.sb.SIM.t + ' nCol=' + L.sb.S.nCol);
check.ok('render built its palettes', L.sb.RNDR.palLith.length === 96,
	'palLith ' + L.sb.RNDR.palLith.length);
var canvasTopLeft = L.sb.UI.pos(ev('mousemove', { clientX: 1, clientY: 1 }));
var canvasMid = L.sb.UI.pos(ev('mousemove', { clientX: 641, clientY: 281 }));
check.ok('canvas pointer mapping excludes its CSS border',
	canvasTopLeft.x === 0 && canvasTopLeft.y === 0 && canvasMid.x === 640 && canvasMid.y === 280,
	canvasTopLeft.x + ',' + canvasTopLeft.y + ' / ' + canvasMid.x + ',' + canvasMid.y);

check.section('B. clocks and sliders');
frames(L, 300);
check.near('300 frames at 50 kyr/f = 15 Myr', L.sb.SIM.t, 15, 1e-9, 'Myr');
check.near('Tm(15 Myr)', L.sb.SIM.Tm, 1.592522, 1e-5);
check.near('eruptive clock = 300 x 1800 s', L.sb.SIM.tErupt, 300 * 1800, 1e-6, 's');
var geo = L.els.sGeo.listeners.input;
L.els.sGeo.value = '0'; geo.call(L.els.sGeo);
check.ok('geo slider 0 = pause', L.sb.P.sl.geo === 0 && L.sb.SIM.dG === 0,
	'sl.geo=' + L.sb.P.sl.geo);
L.els.sGeo.value = '1000'; geo.call(L.els.sGeo);
check.near('geo slider max = 200 kyr/f', L.sb.P.sl.geo, 200e3, 1e-6, 'yr');
L.els.sGeo.value = '738'; geo.call(L.els.sGeo);
check.near('geo slider 738 ~ 50 kyr/f', L.sb.P.sl.geo, 50e3, 200, 'yr');
var er = L.els.sErupt.listeners.input;
L.els.sErupt.value = '1000'; er.call(L.els.sErupt);
check.near('erupt slider max = 240 min/f', L.sb.P.sl.erupt, 14400, 1e-6, 's');
L.els.sErupt.value = '0'; er.call(L.els.sErupt);
check.ok('erupt slider 0 = pause', L.sb.P.sl.erupt === 0);

check.section('C. view: presets, wheel, drag, keys');
L.sb.UI.preset('ovw');
check.near('overview keeps the default horizontal scale', L.sb.GEO.kx, L.sb.P.winW / L.sb.P.cw, 1e-12);
check.near('overview fits the full depth', L.sb.GEO.y(L.sb.GEO.uB), -L.sb.P.R, 1, 'm');
L.sb.UI.preset('bas');
check.near('basin preset x40', L.sb.GEO.kx, L.sb.P.winW / L.sb.P.cw / 40, 1e-12);
L.sb.UI.preset('cru');
check.near('crust preset x10', L.sb.GEO.kx, L.sb.P.winW / L.sb.P.cw / 10, 1e-12);
L.sb.UI.preset('def');
check.near('default preset round trip', L.sb.GEO.kx, L.sb.P.winW / L.sb.P.cw, 1e-12);

// the world point under the cursor must survive a wheel zoom and a drag pan
L.sb.UI.move(ev('mousemove', { clientX: 412, clientY: 234 }));
var wx = L.sb.GEO.xAt(411), wy = L.sb.GEO.yAt(233);
L.sb.UI.wheel(ev('wheel', { deltaY: -400, clientX: 412, clientY: 234 }));
check.near('wheel keeps the cursor world x fixed',
	L.sb.GEO.wrapX(L.sb.GEO.xAt(411) - wx + L.sb.P.wrap / 2) - L.sb.P.wrap / 2, 0, 1e-6, 'm');
check.near('wheel keeps the cursor world y fixed', L.sb.GEO.yAt(233) - wy, 0, 1e-9, 'm');
check.ok('wheel zoomed in', L.sb.GEO.kx < L.sb.P.winW / L.sb.P.cw, 'kx=' + L.sb.GEO.kx);
wx = L.sb.GEO.xAt(411); wy = L.sb.GEO.yAt(233);
L.sb.UI.down(ev('mousedown', { clientX: 412, clientY: 234 }));
L.sb.UI.move(ev('mousemove', { clientX: 462, clientY: 184 }));
L.sb.__win.mouseup(ev('mouseup', {}));
check.near('drag keeps the grabbed world x fixed',
	L.sb.GEO.wrapX(L.sb.GEO.xAt(461) - wx + L.sb.P.wrap / 2) - L.sb.P.wrap / 2, 0, 1e-6, 'm');
check.near('drag keeps the grabbed world y fixed', L.sb.GEO.yAt(183) - wy, 0, 1e-9, 'm');
// wheel clamps
var kx0 = L.sb.GEO.kx;
for (var i = 0; i < 400; i++) L.sb.UI.wheel(ev('wheel', { deltaY: -120, clientX: 10, clientY: 10 }));
check.ok('wheel clamps at zoomMax', L.sb.GEO.kx >= L.sb.GEO.kxMin * (1 - 1e-12),
	'kx=' + L.sb.GEO.kx + ' min=' + L.sb.GEO.kxMin);
for (i = 0; i < 900; i++) L.sb.UI.wheel(ev('wheel', { deltaY: 120, clientX: 10, clientY: 10 }));
check.ok('wheel clamps at zoomMin', L.sb.GEO.kx <= L.sb.GEO.kxMax * (1 + 1e-12),
	'kx=' + L.sb.GEO.kx + ' max=' + L.sb.GEO.kxMax);
check.ok('zoom clamped and came back', L.sb.GEO.kx > kx0 * 0.1, 'kx=' + L.sb.GEO.kx);

check.section('D. probe, mesh, keys');
L.sb.UI.preset('def');
L.sb.UI.move(ev('mousemove', { clientX: 640, clientY: 400 }));
check.ok('cursor readout built', L.sb.UI.cursor.length > 10, JSON.stringify(L.sb.UI.cursor));
check.ok('geology probe built', L.sb.RNDR.probe.indexOf('col ') === 0,
	JSON.stringify(L.sb.RNDR.probe.split('\n')[0]));
check.ok('probe names a layer or the mantle',
	/layer \d+\/\d+/.test(L.sb.RNDR.probe) || /mantle/.test(L.sb.RNDR.probe),
	L.sb.RNDR.probe.split('\n')[3]);
L.sb.UI.move(ev('mousemove', { clientX: 640, clientY: 2 }));
check.ok('probe in the sky reads air/water', /air|water/.test(L.sb.RNDR.probe),
	L.sb.RNDR.probe.split('\n')[3]);
var key = L.sb.__win.keydown;
key(ev('keydown', { key: 'm' }));
check.ok('m toggles the mesh overlay', L.sb.RNDR.mesh === true);
key(ev('keydown', { key: 'm' }));
check.ok('m toggles it back', L.sb.RNDR.mesh === false);
L.btns[2].listeners.click(ev('click', {}));
check.near('preset button 3 = crust x10', L.sb.GEO.kx, L.sb.P.winW / L.sb.P.cw / 10, 1e-12);
var g1 = L.sb.P.sl.geo;
key(ev('keydown', { key: ' ' }));
check.ok('space pauses the geologic clock', L.sb.P.sl.geo === 0 && L.sb.SIM.dG === 0);
key(ev('keydown', { key: ' ' }));
check.near('space resumes it', L.sb.P.sl.geo, g1, 1e-12, 'yr/f');
var meshBtn = L.els.bMesh;
check.ok('the mesh button is wired in index.html', typeof meshBtn.listeners.click === 'function');

check.section('E. determinism');
function runFresh(seed, n) {
	var A = load();
	A.sb.P.seed = seed;
	A.sb.SIM.reset();
	return A.sb.SIM.run(n) + '|' + A.sb.RNG.state().join(',');
}
var h1 = runFresh(7, 1000), h2 = runFresh(7, 1000), h3 = runFresh(8, 1000);
check.ok('two fresh 1000-frame runs are bit-identical', h1 === h2, h1 + ' vs ' + h2);
check.ok('a different seed diverges', h1 !== h3, h3);
check.ok('the state hash is not degenerate', h1.split('|')[0] !== '0', h1);

check.done();
