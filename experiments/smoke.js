// smoke.js — loads the page scripts in page order inside a vm context with a minimal
// DOM shim, runs frames, and checks clocks/sliders/view/renderer held up. The wiring
// check for every phase. Run: node experiments/smoke.js
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');
var src = {};
var files = ['params', 'rng', 'geom', 'state', 'perf', 'ui', 'render', 'sim'];
var i;
for (i = 0; i < files.length; i++)
	src[files[i]] = fs.readFileSync(path.join(__dirname, '..', 'js', files[i] + '.js'), 'utf8');

// a no-op 2d context: any method call is a no-op, property sets are stored
var ctx2d = new Proxy({}, {
	get: function (t, k) {
		if (k in t) return t[k];
		return function () {};
	},
	set: function (t, k, v) { t[k] = v; return true; }
});

function makeEl() {
	return {
		value: '0', textContent: '',
		listeners: {},
		addEventListener: function (t, f) { this.listeners[t] = f; },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 560 }; },
		getContext: function () { return ctx2d; },
		getAttribute: function (n) {
			if (!this.dataset) return null;
			return n.indexOf('data-') === 0 ? this.dataset[n.slice(5)] : null;
		}
	};
}

// one context with its own clock, loaded in page order
function load(t0) {
	var els = { c: makeEl(), hud: makeEl(), sGeo: makeEl(), sErupt: makeEl(), vGeo: makeEl(), vErupt: makeEl() };
	var btns = ['def', 'ovw', 'cru', 'bas'].map(function (v) {
		var b = makeEl(); b.dataset = { v: v }; return b;
	});
	var t = t0 || 0;
	var sb = {
		console: console,
		performance: { now: function () { return t; } },
		requestAnimationFrame: function (f) { sb.__next = f; return 1; },
		addEventListener: function () {},
		__next: null, _t: function () { return t; }, _setT: function (x) { t = x; }
	};
	sb.window = sb;
	sb.document = {
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function (sel) { return sel === '#presets button' ? btns : []; }
	};
	vm.createContext(sb);
	for (var j = 0; j < files.length; j++)
		vm.runInContext(src[files[j]], sb, { filename: files[j] + '.js' });
	return { sb: sb, els: els, btns: btns };
}

function frames(w, n) {
	for (var k = 0; k < n; k++) {
		w.sb._setT(w.sb._t() + 16.67);
		var f = w.sb.__next;
		w.sb.__next = null;
		if (!f) return false;
		f(w.sb._t());
	}
	return true;
}

var fails = 0;
function check(name, ok, extra) {
	if (!ok) fails++;
	console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : ''));
}

var w = load();
frames(w, 300);

check('300 frames ran', w.sb.SIM.frame === 300, 'frame=' + w.sb.SIM.frame);
check('geo clock 15 Myr', Math.abs(w.sb.SIM.t - 300 * 50e3) < 1, 't=' + w.sb.SIM.t);
check('erupt clock 9 h', Math.abs(w.sb.SIM.tErupt - 300 * 1800) < 1, 'tErupt=' + w.sb.SIM.tErupt);
var tm = 0.35 + (1.6 - 0.35) * Math.exp(-300 * 50e3 / 2500e6);
check('Tm decay', Math.abs(w.sb.SIM.Tm - tm) < 1e-9, 'Tm=' + w.sb.SIM.Tm + ' want ' + tm);
check('K0 1-Myr event slot fired 15x (no-op)', w.sb.SIM.evT < 1e6, 'evT=' + w.sb.SIM.evT);
check('grid built', w.sb.GEO.grid.length > 0, 'lines=' + w.sb.GEO.grid.length);
check('hud populated (2 Hz)', w.els.hud.textContent.length > 0, 'len=' + w.els.hud.textContent.length);
check('view finite', isFinite(w.sb.GEO.kx) && isFinite(w.sb.GEO.duPx), 'kx=' + w.sb.GEO.kx);
check('fan cells 7186', w.sb.GEO.fanOff[64] === 7186, 'cells=' + w.sb.GEO.fanOff[64]);

// sliders: 0 = pause, 1000 = max of the log range, 535 ~= default 50 kyr/f
w.els.sGeo.value = '0';
w.els.sGeo.listeners.input.call(w.els.sGeo, {});
check('geo slider 0 = pause', w.sb.P.sl.geo === 0, 'sl.geo=' + w.sb.P.sl.geo);
w.els.sGeo.value = '1000';
w.els.sGeo.listeners.input.call(w.els.sGeo, {});
check('geo slider max = 200 kyr/f', Math.abs(w.sb.P.sl.geo - 200e3) < 1, 'sl.geo=' + w.sb.P.sl.geo);
w.els.sErupt.value = '1000';
w.els.sErupt.listeners.input.call(w.els.sErupt, {});
check('erupt slider max = 240 min/f', Math.abs(w.sb.P.sl.erupt - 14400) < 0.1, 'sl.erupt=' + w.sb.P.sl.erupt);
w.els.sGeo.value = '738';
w.els.sGeo.listeners.input.call(w.els.sGeo, {});
check('geo slider 738 ~ 50 kyr/f', Math.abs(w.sb.P.sl.geo - 50e3) / 50e3 < 0.01, 'sl.geo=' + w.sb.P.sl.geo);

// presets (display-space window {cx, kx, uT, uB}): the overview keeps the horizontal
// scale and fits the full depth; basin is x40 on both axes
var kx0 = 3000e3 / 1280;
w.btns[1].listeners.click.call(w.btns[1]);
check('overview preset (kx default, full depth)',
	Math.abs(w.sb.P.view.kx - kx0) < 1e-9 && Math.abs(w.sb.P.view.uB - w.sb.GEO.u(-w.sb.P.R)) < 1e-9,
	'kx=' + w.sb.P.view.kx + ' uB=' + w.sb.P.view.uB);
w.btns[3].listeners.click.call(w.btns[3]);
check('basin preset (x40)', Math.abs(w.sb.P.view.kx - kx0 / 40) < 1e-9, 'kx=' + w.sb.P.view.kx);
w.btns[0].listeners.click.call(w.btns[0]);
check('default preset back (1x1)',
	Math.abs(w.sb.P.view.kx - kx0) < 1e-9 &&
	Math.abs(w.sb.P.view.uT - w.sb.GEO.u(33e3)) < 1e-9 &&
	Math.abs(w.sb.P.view.uB - w.sb.GEO.u(-300e3)) < 1e-9,
	'kx=' + w.sb.P.view.kx);

// wheel: the world point under the cursor stays under the cursor
var evt = { clientX: 100, clientY: 100, deltaY: -460.62, preventDefault: function () {} };
var wxB = w.sb.GEO.x0 + 100 * w.sb.GEO.kx;
var ucB = w.sb.GEO.uT - 100 * w.sb.GEO.duPx;
w.els.c.listeners.wheel.call(w.els.c, evt);
var wxA = w.sb.GEO.x0 + 100 * w.sb.GEO.kx;
var ucA = w.sb.GEO.uT - 100 * w.sb.GEO.duPx;
check('wheel anchored x', Math.abs(wxA - wxB) < 1e-2, 'dx=' + (wxA - wxB));
check('wheel anchored y', Math.abs(ucA - ucB) < 1e-9, 'du=' + (ucA - ucB));
check('wheel zoomed in (kx halved-ish)', w.sb.P.view.kx < 3000e3 / 1280 / 1.9, 'kx=' + w.sb.P.view.kx);

// drag: the world point under the cursor follows the cursor
var dbx = w.sb.GEO.x0 + 200 * w.sb.GEO.kx;
var dbu = w.sb.GEO.uT - 200 * w.sb.GEO.duPx;
w.els.c.listeners.mousedown.call(w.els.c, { clientX: 200, clientY: 200 });
w.els.c.listeners.mousemove.call(w.els.c, { clientX: 210, clientY: 215 });
check('drag anchored x', Math.abs((w.sb.GEO.x0 + 210 * w.sb.GEO.kx) - dbx) < 1e-2, 'dx=' + ((w.sb.GEO.x0 + 210 * w.sb.GEO.kx) - dbx));
check('drag anchored y', Math.abs((w.sb.GEO.uT - 215 * w.sb.GEO.duPx) - dbu) < 1e-9, 'du=' + ((w.sb.GEO.uT - 215 * w.sb.GEO.duPx) - dbu));

// determinism: same seed, two fresh loads, 1000 frames each -> identical state
function hash1000() {
	var x = load();
	frames(x, 1000);
	var h = 0, j, a = x.sb.S.Tf;
	for (j = 0; j < a.length; j++) h = (Math.imul(h, 31) + (a[j] * 1e6 | 0)) | 0;
	return h + '|' + x.sb.SIM.t + '|' + x.sb.SIM.Tm + '|' + x.sb.RNG.state().join(',');
}
var h1 = hash1000(), h2 = hash1000();
check('determinism: identical 1000-frame state', h1 === h2, h1);

console.log(fails ? 'FAIL (' + fails + ')' : 'PASS (all)');
process.exit(fails ? 1 : 0);
