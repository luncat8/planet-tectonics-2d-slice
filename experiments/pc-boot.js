// pc-boot.js — 0.5.0 M1's boot gate (0.5.0-plan.md §9 M1): both pages load their real
// classic scripts in their declared order into a DOM built from the page itself, one frame
// runs, and the page's own controls drive the engine.
//
// What is gated here, in the order the plan lists it: the scripts load, a frame runs, one
// frame loop exists (pc/page.js refuses a second start), the engine reads no page name off
// its environment, and the bar is wired — a range input changes the option set, a toggle
// flips aria-pressed, a scenario button applies the preset, and pause/step/reset/new behave.
//
// This is a VM rehearsal, not a browser smoke: there is no rasteriser, so "drew something"
// means the draw path was reached with a finite state. The Chromium pass is M6's.
//
// Run: node experiments/pc-boot.js
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var check = require('./lib.js').check;
var root = path.join(__dirname, '..');

// ------------------------------------------------------------------ the page's own DOM

function attrsOf(src) {
	var out = {}, re = /([a-z-]+)(?:="([^"]*)")?/gi, m;
	while ((m = re.exec(src)) !== null) out[m[1].toLowerCase()] = m[2] === undefined ? '' : m[2];
	return out;
}

function element(tag, attrs) {
	var el = {
		tagName: tag.toUpperCase(),
		listeners: {},
		attrs: attrs || {},
		options: null,
		value: (attrs && attrs.value !== undefined) ? attrs.value : '',
		textContent: '',
		parent: null,
		getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
		setAttribute: function (n, v) { this.attrs[n] = String(v); },
		addEventListener: function (type, fn) {
			(this.listeners[type] = this.listeners[type] || []).push(fn);
		},
		removeEventListener: function (type, fn) {
			var list = this.listeners[type] || [], i = list.indexOf(fn);
			if (i >= 0) list.splice(i, 1);
		},
		dispatch: function (type) {
			var list = (this.listeners[type] || []).slice(), i;
			var ev = { type: type, target: this, currentTarget: this };
			for (i = 0; i < list.length; i++) list[i].call(this, ev);
			return true;
		},
		click: function () { return this.dispatch('click'); },
		querySelectorAll: function (selector) { return select(this.all || [], selector, this); },
		querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; },
		getContext: null
	};
	el.all = [];
	return el;
}

function matches(el, selector) {
	var m;
	if (selector.charAt(0) === '#') return el.attrs.id === selector.slice(1);
	if (selector.charAt(0) === '[') {
		m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
		if (!m) return false;
		if (!(m[1] in el.attrs)) return false;
		return m[2] === undefined || el.attrs[m[1]] === m[2];
	}
	return el.tagName === selector.toUpperCase();
}

function select(all, selector, within) {
	var out = [], i, node, ok;
	for (i = 0; i < all.length; i++) {
		node = all[i];
		if (!matches(node, selector)) continue;
		if (within) {
			ok = false;
			for (node = node.parent; node; node = node.parent) if (node === within) { ok = true; break; }
			if (!ok) continue;
		}
		out.push(all[i]);
	}
	return out;
}

function ctx2d(counter) {
	return new Proxy({
		createImageData: function (w, h) {
			return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
		},
		measureText: function (s) { return { width: String(s).length * 6 }; },
		imageSmoothingEnabled: false,
		fillStyle: '', strokeStyle: '', font: '', lineWidth: 1
	}, {
		get: function (target, key) {
			if (key in target) return target[key];
			return function () { counter.calls++; };
		},
		set: function (target, key, value) { target[key] = value; return true; }
	});
}

// Build the document a page describes: the bar's controls (each naming its registry entry),
// the canvas, the HUD and the pause/step/reset/new buttons.
function buildDom(html) {
	var counter = { calls: 0 };
	var all = [], ids = {};
	var doc = {
		all: all,
		ids: ids,
		getElementById: function (id) { return ids[id] || null; },
		querySelectorAll: function (sel) { return select(all, sel, null); },
		querySelector: function (sel) { return select(all, sel, null)[0] || null; },
		createElement: function (tag) {
			var el = element(tag, {});
			el.getContext = function () { return ctx2d(counter); };
			return el;
		},
		_counter: counter
	};

	// #bar and everything in it
	var barHtml = /<div id="bar">([\s\S]*?)<\/div>/.exec(html);
	var bar = element('div', { id: 'bar' });
	bar.parent = null;
	all.push(bar); ids.bar = bar;

	if (barHtml) {
		var re = /<(\/?)(input|button|select|option|span|label)\b([^>]*)>/gi, m, cur = null, opt = null, el;
		while ((m = re.exec(barHtml[1])) !== null) {
			if (m[1] === '/') { if (m[2].toLowerCase() === 'select') cur = null; continue; }
			if (m[2].toLowerCase() === 'option') {
				if (!cur) continue;
				opt = { value: m[3] && /value="([^"]*)"/.test(m[3]) ? /value="([^"]*)"/.exec(m[3])[1] : '',
					selected: /\bselected\b/.test(m[3]), label: '' };
				cur.options.push(opt);
				continue;
			}
			el = element(m[2], attrsOf(m[3]));
			el.parent = bar;
			all.push(el);
			if (el.attrs.id) ids[el.attrs.id] = el;
			if (m[2].toLowerCase() === 'select') { el.options = []; cur = el; }
		}
	}

	// every element's own list is the document's, and the parent chain decides whose
	// descendants it sees — which is what #bar.querySelectorAll has to mean
	all.forEach(function (el) { el.all = all; });

	// the canvas and the HUD
	var canvasHtml = /<canvas\b([^>]*)>/.exec(html);
	var canvas = element('canvas', attrsOf(canvasHtml ? canvasHtml[1] : ''));
	canvas.getContext = function () { return ctx2d(counter); };
	canvas.parent = null;
	all.push(canvas); ids.c = canvas;
	canvas.all = all;
	canvas.width = Number(canvas.attrs.width || 0);
	canvas.height = Number(canvas.attrs.height || 0);

	var hud = element('div', { id: 'hud' });
	all.push(hud); ids.hud = hud;

	// the buttons outside the bar (pause/step/reset/new are inside it, but a page may move them)
	['bPause', 'bStep', 'bReset', 'bNew'].forEach(function (id) {
		if (!ids[id]) {
			var b = element('button', { id: id, 'aria-pressed': 'false' });
			b.parent = bar;
			all.push(b); ids[id] = b;
		}
	});
	return doc;
}

// ------------------------------------------------------------------ the VM

function loadPage(page) {
	var html = fs.readFileSync(path.join(root, page), 'utf8');
	var doc = buildDom(html);
	var clock = 0, frames = [];
	var sandbox = {
		document: doc,
		console: console,
		performance: { now: function () { return clock; } },
		requestAnimationFrame: function (fn) { frames.push(fn); return frames.length; },
		cancelAnimationFrame: function () {}
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;
	var ctx = vm.createContext(sandbox);
	sandbox.addEventListener = function (type, fn) {
		(sandbox.listeners = sandbox.listeners || {});
		(sandbox.listeners[type] = sandbox.listeners[type] || []).push(fn);
	};
	var scripts = [], re = /<script\b[^>]*\bsrc="([^"]+)"/gi, m;
	while ((m = re.exec(html)) !== null) scripts.push(m[1]);
	scripts.forEach(function (src) {
		var file = path.join(root, src);
		if (!fs.existsSync(file)) throw new Error('page names a missing script: ' + src);
		vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: src });
	});
	var inline = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
	while ((m = inline.exec(html)) !== null) {
		vm.runInContext(m[1], ctx, { filename: page + ' inline' });
	}
	return {
		html: html, doc: doc, ctx: ctx, sandbox: sandbox,
		frames: frames,
		clock: function () { return clock; },
		tick: function (ms) {
			clock += ms;
			var q = frames.splice(0, frames.length), i;
			for (i = 0; i < q.length; i++) q[i](clock);
			return q.length;
		},
		pending: function () { return frames.length; },
		key: function (k) {
			var list = (sandbox.listeners && sandbox.listeners.keydown) || [], i;
			var ev = { type: 'keydown', key: k };
			for (i = 0; i < list.length; i++) list[i](ev);
		}
	};
}

// ------------------------------------------------------------------ the gates

function bootPage(page, engineName) {
	var which = engineName === 'HY' ? 'hybrid' : 'soup';
	check.section('Page ' + page + ' (' + which + ')');

	var html = fs.readFileSync(path.join(root, page), 'utf8');
	var scripts = [], re = /<script\b[^>]*\bsrc="([^"]+)"/gi, m;
	while ((m = re.exec(html)) !== null) scripts.push(m[1]);
	var engineFile = engineName === 'HY' ? 'js/hy/hy.js' : 'js/sp/sp.js';
	var engineAt = scripts.indexOf(engineFile);
	var late = scripts.filter(function (f, i) {
		return f.indexOf('js/pc/') === 0 && i > engineAt;
	});
	check.ok('the page names its shared substrate before its engine',
		scripts.indexOf('js/pc/params.js') === 0 + 1 && late.length === 0 &&
		scripts.indexOf('js/pc/page.js') === engineAt - 1,
		scripts.length + ' scripts, engine at ' + engineAt);
	check.ok('the engine file is last and the shared page shell precedes it',
		scripts[scripts.length - 1] === (engineName === 'HY' ? 'js/hy/hy.js' : 'js/sp/sp.js') &&
		scripts.indexOf('js/pc/page.js') === scripts.length - 2, scripts.slice(-3).join(', '));

	var p = loadPage(page), engine = p.sandbox[engineName];
	check.ok('the engine global exists after load',
		!!engine && engine.id === (engineName === 'HY' ? 'hy' : 'sp'),
		engine ? engine.id : 'missing');
	check.ok('one frame loop is scheduled', p.pending() === 1, p.pending() + ' callbacks');
	check.ok('the page has already reset the engine', engine.read('time') === 0 &&
		engine.opts.get('clock') === 50, 'clock ' + engine.opts.get('clock'));
	check.ok('the HUD was written before the first frame',
		/hud/.test(p.doc.ids.hud.textContent) === false && p.doc.ids.hud.textContent.length > 0,
		p.doc.ids.hud.textContent.split('\n')[0]);

	var t0 = engine.read('time');
	var ran = p.tick(16);
	check.ok('one frame runs exactly one loop iteration', ran === 1 && p.pending() === 1,
		ran + ' ran, ' + p.pending() + ' queued');
	check.ok('the clock advanced by one frame of geology',
		Math.abs(engine.read('time') - t0 - 0.05) < 1e-12, engine.read('time') + ' Myr');
	check.ok('the frame drew something', p.doc._counter.calls > 0,
		p.doc._counter.calls + ' context calls');
	check.ok('the HUD was refreshed on the 2 Hz pulse',
		/Myr/.test(p.doc.ids.hud.textContent) && /ms\/frame/.test(p.doc.ids.hud.textContent),
		p.doc.ids.hud.textContent.split('\n')[1]);

	// a second start must not open a second loop
	var start = p.sandbox.PCPAGE.start(engine);
	check.ok('a second PCPAGE.start is refused', start === p.sandbox.PCPAGE && p.pending() === 1,
		p.pending() + ' callbacks');

	// pause, step, reset, new planet
	p.doc.ids.bPause.click();
	var tPaused = engine.read('time');
	p.tick(16);
	check.ok('pause stops the clock and lights the button',
		engine.read('time') === tPaused && p.doc.ids.bPause.getAttribute('aria-pressed') === 'true',
		'aria-pressed ' + p.doc.ids.bPause.getAttribute('aria-pressed'));
	p.doc.ids.bStep.click();
	p.tick(16);
	check.ok('step advances exactly one frame while paused',
		Math.abs(engine.read('time') - tPaused - 0.05) < 1e-12,
		(engine.read('time') - tPaused) + ' Myr');
	p.doc.ids.bPause.click();
	check.ok('unpause releases the clock', p.doc.ids.bPause.getAttribute('aria-pressed') === 'false');

	var seed0 = engine.seed;
	p.doc.ids.bNew.click();
	check.ok('new planet builds a fresh state at the next seed',
		engine.read('time') === 0 && engine.seed === seed0 + 1,
		'seed ' + engine.seed + ', t ' + engine.read('time'));
	p.doc.ids.bReset.click();
	check.ok('reset rebuilds at the same seed', engine.read('time') === 0 && engine.seed === seed0 + 1);

	// the bar: a range input is live, an enum and a toggle too
	var clockEl = p.doc.querySelector('[data-pc-opt="clock"]');
	clockEl.value = '250';
	clockEl.dispatch('input');
	check.ok('a range control sets its option and the readout follows',
		engine.opts.get('clock') === 250 &&
		p.doc.querySelector('[data-pc-val="clock"]').textContent === '250',
		'clock ' + engine.opts.get('clock'));

	var linksEl = p.doc.querySelector('[data-pc-opt="links"]');
	linksEl.click();
	check.ok('a reset-scope toggle shows its staged value without changing the engine yet',
		linksEl.getAttribute('aria-pressed') === 'false' && engine.opts.get('links') === true &&
		engine.opts.pending.links === false,
		'aria ' + linksEl.getAttribute('aria-pressed') + ', engine ' + engine.opts.get('links'));
	p.doc.ids.bNew.click();
	check.ok('the next planet commits it', engine.opts.get('links') === false &&
		linksEl.getAttribute('aria-pressed') === 'false');

	var spaceEl = p.doc.querySelector('[data-pc-opt="space"]');
	if (spaceEl) {
		spaceEl.options[1].selected = true;
		spaceEl.value = spaceEl.options[1].value;
		spaceEl.dispatch('change');
		check.ok('an enum control sets its option (space stays a reset-scope change)',
			engine.opts.get('space') === 'screen', 'staged ' + JSON.stringify(engine.opts.pending));
	}

	// a scenario button applies the preset through the same path the harness runs
	var s4 = p.doc.querySelector('[data-pc-scenario="S4"]');
	s4.click();
	check.ok('a scenario button applies the preset',
		engine.opts.get('scenario') === 'S4' && engine.opts.get('clock') === 50 &&
		engine.tool === 'unload', 'clock ' + engine.opts.get('clock') + ', tool ' + engine.tool);
	check.ok('the preset rewrote the bar from the registry',
		p.doc.querySelector('[data-pc-opt="clock"]').value === '50',
		p.doc.querySelector('[data-pc-opt="clock"]').value);

	p.key(' ');
	var tKey = engine.read('time');
	p.tick(16);
	check.ok('the space key pauses', engine.read('time') === tKey &&
		p.sandbox.PCPAGE.paused === true);
	p.key(' ');
	p.key('1');
	check.ok('the 1-4 keys select a scenario', engine.opts.get('scenario') === 'S1');

	// a long run must not produce a non-finite reading anywhere the HUD prints
	var i, bad = 0;
	p.sandbox.PCPAGE.paused = false;
	for (i = 0; i < 240; i++) {
		p.tick(16);
		if (!isFinite(engine.read('time')) || !isFinite(engine.read('mass'))) bad++;
	}
	check.ok('240 frames leave a finite state', bad === 0, bad + ' non-finite frames');
	check.ok('the population survived the run',
		engine.id === 'hy' ? engine.read('cells') === 6144 : engine.read('population') === 6656,
		'population ' + engine.read('population') + ', cells ' + engine.read('cells'));

	return p;
}

check.section('A. no engine reads a page name off its environment');
['js/hy/hy.js', 'js/sp/sp.js', 'js/pc/params.js', 'js/pc/phase.js', 'js/pc/pool.js',
	'js/pc/bond.js', 'js/pc/opt.js', 'js/pc/scenario.js', 'js/pc/page.js'].forEach(function (f) {
	var src = fs.readFileSync(path.join(root, f), 'utf8');
	var hits = [];
	if (/\blocation\b/.test(src)) hits.push('location');
	if (/document\.title/.test(src)) hits.push('document.title');
	if (/window\.name/.test(src)) hits.push('window.name');
	if (/pathname/.test(src)) hits.push('pathname');
	check.ok(f + ' reads no page name', hits.length === 0, hits.join(',') || 'clean');
});

bootPage('hybrid.html', 'HY');
bootPage('soup.html', 'SP');

check.section('C. the two pages differ only where the engine differs');
var hy = fs.readFileSync(path.join(root, 'hybrid.html'), 'utf8');
var sp = fs.readFileSync(path.join(root, 'soup.html'), 'utf8');
function ids(src) {
	var out = [], re = /data-pc-opt="([^"]+)"/g, m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out.join(',');
}
check.ok('each page carries only its own engine\'s knobs',
	ids(hy).indexOf('projIters') >= 0 && ids(hy).indexOf('pbfIters') < 0 &&
	ids(sp).indexOf('projIters') < 0 && ids(sp).indexOf('pbfIters') >= 0);
check.ok('both pages boot the same shell',
	/PCPAGE\.start\(HY\)/.test(hy) && /PCPAGE\.start\(SP\)/.test(sp));

check.done();
