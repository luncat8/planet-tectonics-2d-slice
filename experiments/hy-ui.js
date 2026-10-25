// hy-ui.js — 0.5.0 M3 gate (0.5.0-plan.md §6.6, §9.1): every button, key, registry
// option, render overlay toggle and the S4 click-to-unload tool on hybrid.html.
//
// Run: node experiments/hy-ui.js
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var check = require('./lib.js').check;

var ROOT = path.resolve(__dirname, '..');

function parseControls(html) {
	var out = [], tagRe = /<(button|input|select|span)\b([^>]*)>/g, attrRe = /([\w-]+)="([^"]*)"/g;
	var m, a, attrs;
	while ((m = tagRe.exec(html))) {
		attrs = { tag: m[1].toUpperCase() };
		while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
		out.push(attrs);
	}
	return out;
}

function makeEl(spec) {
	var attrs = {}, listeners = {};
	var el = {
		tagName: spec.tag || 'DIV',
		id: spec.id || '',
		type: spec.type || '',
		value: spec.value !== undefined ? String(spec.value) : '',
		textContent: '',
		options: [],
		style: {},
		dataset: {},
		setAttribute: function (k, v) { attrs[k] = String(v); },
		getAttribute: function (k) { return attrs[k] !== undefined ? attrs[k] : null; },
		addEventListener: function (ev, fn) {
			(listeners[ev] = listeners[ev] || []).push(fn);
		},
		dispatch: function (ev, extra) {
			var list = listeners[ev] || [], i;
			var e = extra || {};
			if (!e.preventDefault) e.preventDefault = function () {};
			for (i = 0; i < list.length; i++) list[i].call(el, e);
		},
		click: function () { this.dispatch('click', {}); },
		getBoundingClientRect: function () { return { left: 0, top: 0, width: 1200, height: 420 }; }
	};
	var k;
	for (k in spec) {
		if (k === 'tag' || k === 'id' || k === 'type' || k === 'value') continue;
		attrs[k] = spec[k];
	}
	return el;
}

function bootHybrid() {
	var html = fs.readFileSync(path.join(ROOT, 'hybrid.html'), 'utf8');
	var specs = parseControls(html);
	var byId = {}, byOpt = {}, byVal = {}, byScen = [], all = [];
	var i, el, s;
	for (i = 0; i < specs.length; i++) {
		s = specs[i];
		el = makeEl(s);
		all.push(el);
		if (s.id) byId[s.id] = el;
		if (s['data-pc-opt']) byOpt[s['data-pc-opt']] = el;
		if (s['data-pc-val']) byVal[s['data-pc-val']] = el;
		if (s['data-pc-scenario']) byScen.push(el);
	}
	var ctx = {
		calls: [],
		fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, imageSmoothingEnabled: true, globalAlpha: 1, lineCap: 'butt',
		fillRect: function (x, y, w, h) { this.calls.push(['fillRect', x, y, w, h]); },
		beginPath: function () { this.calls.push(['beginPath']); },
		moveTo: function (x, y) { this.calls.push(['moveTo', x, y]); },
		lineTo: function (x, y) { this.calls.push(['lineTo', x, y]); },
		closePath: function () { this.calls.push(['closePath']); },
		arc: function (x, y, r) { this.calls.push(['arc', x, y, r]); },
		ellipse: function (x, y, rx, ry) { this.calls.push(['ellipse', x, y, rx, ry]); },
		fill: function () { this.calls.push(['fill']); },
		stroke: function () { this.calls.push(['stroke']); },
		save: function () { this.calls.push(['save']); },
		restore: function () { this.calls.push(['restore']); },
		createLinearGradient: function () { return { addColorStop: function () {} }; },
		createRadialGradient: function () { return { addColorStop: function () {} }; },
		fillText: function (t, x, y) { this.calls.push(['fillText', t, x, y]); },
		drawImage: function () { this.calls.push(['drawImage']); }
	};
	var canvas = makeEl({ tag: 'CANVAS', id: 'c' });
	canvas.width = 1200; canvas.height = 420;
	canvas.getContext = function () { return ctx; };
	byId.c = canvas;
	byId.hud = makeEl({ tag: 'PRE', id: 'hud' });
	byId.bar = {
		querySelectorAll: function (sel) {
			if (sel === '[data-pc-opt]') {
				return Object.keys(byOpt).map(function (k) { return byOpt[k]; });
			}
			return [];
		},
		querySelector: function (sel) {
			var m = sel.match(/^\[data-pc-val="([^"]+)"\]$/);
			return m ? (byVal[m[1]] || null) : null;
		}
	};

	var raf = [], winListeners = {}, nowMs = 1000;
	var sandbox = {
		console: console, Math: Math, Number: Number, String: String, Object: Object, Array: Array,
		Float64Array: Float64Array, Float32Array: Float32Array, Int32Array: Int32Array,
		Uint32Array: Uint32Array, Uint8Array: Uint8Array,
		isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt, JSON: JSON, Error: Error,
		performance: { now: function () { return nowMs; } },
		requestAnimationFrame: function (fn) { raf.push(fn); return raf.length; },
		document: {
			getElementById: function (id) { return byId[id] || null; },
			querySelectorAll: function (sel) {
				if (sel === '[data-pc-scenario]') return byScen;
				return [];
			},
			createElement: function (tag) {
				if (tag === 'canvas') {
					var c = { width: 0, height: 0 };
					c.getContext = function () {
						return {
							createImageData: function (w, h) {
								return { width: w, height: h, data: new Uint8Array(w * h * 4) };
							},
							putImageData: function () {}
						};
					};
					return c;
				}
				return makeEl({ tag: tag.toUpperCase() });
			}
		},
		window: null
	};
	sandbox.window = sandbox;
	sandbox.addEventListener = function (ev, fn) {
		(winListeners[ev] = winListeners[ev] || []).push(fn);
	};

	var scriptRe = /<script\s+src="([^"]+)"><\/script>/g, sm, scripts = [];
	while ((sm = scriptRe.exec(html))) scripts.push(sm[1]);
	vm.createContext(sandbox);
	for (i = 0; i < scripts.length; i++) {
		var code = fs.readFileSync(path.join(ROOT, scripts[i]), 'utf8');
		vm.runInContext(code, sandbox, { filename: scripts[i] });
	}
	var inlineRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
	while ((sm = inlineRe.exec(html))) {
		vm.runInContext(sm[1], sandbox, { filename: 'hybrid.html inline' });
	}
	return {
		sb: sandbox, byId: byId, byOpt: byOpt, byVal: byVal, byScen: byScen,
		canvas: canvas, ctx: ctx,
		tick: function (dtMs) {
			nowMs += dtMs === undefined ? 16.67 : dtMs;
			var fn = raf.shift();
			if (fn) fn(nowMs);
		},
		key: function (k) {
			var list = winListeners.keydown || [], j;
			for (j = 0; j < list.length; j++) {
				list[j]({ key: k, target: { tagName: 'BODY' }, preventDefault: function () {} });
			}
		}
	};
}

var H = bootHybrid();
var HY = H.sb.HY;

check.section('A. hybrid.html boots M3 with liquid cells and crust skin');
check.ok('HUD announces M3 liquid + crust',
	/HY hybrid — M3 liquid \+ crust/.test(H.byId.hud.textContent),
	H.byId.hud.textContent.split('\n')[0]);
check.ok('both cell and parcel populations are present at boot',
	HY.read('cells') === 6144 && HY.read('population') === 1536,
	'cells ' + HY.read('cells') + ', parcels ' + HY.read('population'));

check.section('B. live range & enum options update the engine and readouts immediately');
var ranges = [
	['clock', 100],
	['mobContrast', 5.5],
	['projIters', 16],
	['substepCap', 0.4],
	['inertia', 0.3],
	['sizeByHeat', 0.25],
	['tauHeal', 1.5],
	['yieldRate', 1.2],
	['kDamage', 1.4]
];
for (var r = 0; r < ranges.length; r++) {
	var id = ranges[r][0], val = ranges[r][1];
	var el = H.byOpt[id];
	el.value = String(val);
	el.dispatch('input');
	check.ok('live range "' + id + '" updates engine option to ' + val,
		Math.abs(HY.opts.get(id) - val) <= 1e-9 && H.byVal[id].textContent.length > 0,
		id + ' = ' + HY.opts.get(id) + ' (readout "' + H.byVal[id].textContent + '")');
}

H.byOpt.advect.value = 'maccormack';
H.byOpt.advect.dispatch('change');
H.byOpt.solidusOf.value = 'depth';
H.byOpt.solidusOf.dispatch('change');
H.tick(16.67);
check.ok('live enum controls (advect, solidusOf) take effect on the next frame',
	HY.opts.get('advect') === 'maccormack' && HY.opts.get('solidusOf') === 'depth' &&
	H.sb.PCP.solidusOf === 'depth',
	'advect = ' + HY.opts.get('advect') + ', solidusOf = ' + H.sb.PCP.solidusOf);

check.section('C. reset-scope options stage until New planet / Reset commits them');
H.byOpt.links.click();
H.byOpt.sizeByMaterial.click();
H.byOpt.partSize.value = '1.5';
H.byOpt.partSize.dispatch('input');
check.ok('links, sizeByMaterial and partSize stage in pending before reset',
	HY.opts.get('links') === true && HY.opts.pending.links === false &&
	HY.opts.pending.sizeByMaterial === false && HY.opts.pending.partSize === 1.5,
	'pending ' + JSON.stringify(HY.opts.pending));
H.byId.bReset.click();
check.ok('clicking Reset commits all staged reset-scope options and rebuilds the skin',
	HY.opts.get('links') === false && HY.opts.get('sizeByMaterial') === false &&
	HY.opts.get('partSize') === 1.5 && HY.read('population') === 1024,
	'population ' + HY.read('population'));
// Restore defaults
H.byOpt.links.click();
H.byOpt.sizeByMaterial.click();
H.byOpt.partSize.value = '1';
H.byOpt.partSize.dispatch('input');
H.byId.bNew.click();
check.ok('clicking New planet advances seed and commits restored defaults',
	HY.seed === 2 && HY.opts.get('links') === true && HY.read('population') === 1536,
	'seed ' + HY.seed + ', pop ' + HY.read('population'));

check.section('D. render overlay toggles (markers, bonds, relief, ruler, crust, melt)');
H.ctx.calls.length = 0;
H.tick(16.67);
var callsAllOn = H.ctx.calls.length;

H.byOpt.markers.click();
H.ctx.calls.length = 0;
H.tick(16.67);
var callsNoMarkers = H.ctx.calls.length;
H.byOpt.markers.click();
check.ok('toggling markers off skips the 1,536 parcel fillRect calls',
	callsAllOn - callsNoMarkers >= 1500,
	'all on ' + callsAllOn + ' vs markers off ' + callsNoMarkers);

H.byOpt.ruler.click();
H.ctx.calls.length = 0;
H.tick(16.67);
var hasTextOff = H.ctx.calls.some(function (c) { return c[0] === 'fillText'; });
H.byOpt.ruler.click();
check.ok('toggling ruler off suppresses depth ruler labels', !hasTextOff);

H.byOpt.relief.click();
H.byOpt.bonds.click();
H.byOpt.crust.click();
H.byOpt.melt.click();
H.ctx.calls.length = 0;
H.tick(16.67);
check.ok('toggling relief, bonds, crust and melt renders cleanly', H.ctx.calls.length > 0);
H.byOpt.relief.click();
H.byOpt.bonds.click();
H.byOpt.crust.click();
H.byOpt.melt.click();

check.section('E. S4 scenario & click-to-unload tool on the canvas');
// Select S4 via keyboard shortcut '4'
H.key('4');
check.ok('pressing key "4" selects scenario S4, sets solidusOf = load, and arms the unload tool',
	HY.opts.get('scenario') === 'S4' && HY.opts.get('solidusOf') === 'load' &&
	HY.tool === 'unload' && HY.camera === 'lid',
	'tool = ' + HY.tool + ', camera = ' + HY.camera);

// Reset to a fresh planet and click the canvas at x = 25% of width (4,000 km)
H.key('r');
var unloadsBefore = HY.M.unload.count;
H.canvas.dispatch('click', { clientX: 300 });
check.ok('clicking the canvas while tool === "unload" excavates the clicked column patch',
	HY.M.unload.count === unloadsBefore + 1 &&
	Math.abs(HY.M.unload.x - 4000) <= 1e-9 &&
	HY.read('unloadMass') > 0 && HY.read('solidusDrop') > 0.01 &&
	HY.read('meltMass') > 0,
	'unload x = ' + HY.M.unload.x + ' km, mass = ' + HY.read('unloadMass').toFixed(1) +
	', drop = ' + HY.read('solidusDrop').toFixed(4) + ', melt = ' + HY.read('meltMass').toFixed(1));

// Switch to S1 ('1') so tool is null, then click the canvas: unload count must not change
H.key('1');
var countAfterS1 = HY.M.unload.count;
H.canvas.dispatch('click', { clientX: 600 });
check.ok('clicking the canvas when tool is null (S1) is a no-op',
	HY.tool === null && HY.M.unload.count === countAfterS1,
	'unload count ' + HY.M.unload.count);

check.done();
