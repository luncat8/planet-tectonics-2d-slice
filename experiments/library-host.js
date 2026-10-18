// library-host.js — M2 integration rehearsal. It loads library.html's real classic scripts
// in their declared order into a browser-like VM/DOM, mounts the actual host bootstrap, and
// drives the same controls a browser rig will use. It is not the Chromium visual acceptance.
// Run: node experiments/library-host.js
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var check = require('./lib.js').check;
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'library.html'), 'utf8');
var columns = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
var PRIMARY_ID = 'earth-gc0', SNAPSHOT_ID = 'earth-100Ma-gc0';

function scriptOrder(src) {
	var re = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}
function inlineScripts(src) {
	var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, out = [], m;
	while ((m = re.exec(src)) !== null) if (!/\bsrc=/.test(m[1])) out.push(m[2]);
	return out;
}
function hasId(src, id) { return new RegExp('\\bid="' + id + '"').test(src); }
function eventTarget(obj) {
	obj.listeners = {};
	obj.addEventListener = function (type, fn) {
		(this.listeners[type] = this.listeners[type] || []).push(fn);
	};
	obj.removeEventListener = function (type, fn) {
		var list = this.listeners[type] || [], i = list.indexOf(fn);
		if (i >= 0) list.splice(i, 1);
	};
	obj.dispatchEvent = function (event) {
		event = event || {};
		event.type = event.type || 'click';
		if (!event.target) event.target = this;
		var list = (this.listeners[event.type] || []).slice(), i;
		for (i = 0; i < list.length; i++) list[i].call(this, event);
		return true;
	};
	obj.click = function () { return this.dispatchEvent({ type: 'click' }); };
	return obj;
}

function fakeBrowser() {
	var now = 0, nextFrame = 0, frames = new Map(), runtimeErrors = [], targets = [];
	function makeContext() {
		var calls = 0;
		var base = {
			createImageData: function (w, h) {
				return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
			},
			measureText: function (text) { return { width: String(text).length * 6 }; },
			_callCount: function () { return calls; }
		};
		return new Proxy(base, {
			get: function (target, key) {
				if (key in target) return target[key];
				return function () { calls++; };
			},
			set: function (target, key, value) { target[key] = value; return true; }
		});
	}
	function match(node, selector) {
		if (selector.charAt(0) === '#') return node.id === selector.slice(1);
		return node.tagName && node.tagName.toLowerCase() === selector.toLowerCase();
	}
	function descendants(node, selector, out) {
		var kids = node.children || [], i;
		for (i = 0; i < kids.length; i++) {
			if (match(kids[i], selector)) out.push(kids[i]);
			descendants(kids[i], selector, out);
		}
		return out;
	}
	function query(node, selector) {
		var parts = selector.trim().split(/\s+/), found = descendants(node, parts[0], []), i, j, next;
		for (i = 1; i < parts.length; i++) {
			next = [];
			for (j = 0; j < found.length; j++) descendants(found[j], parts[i], next);
			found = next;
		}
		return found.length ? found[0] : null;
	}
	function queryAll(node, selector) {
		var parts = selector.trim().split(/\s+/), found = descendants(node, parts[0], []), i, j, next;
		for (i = 1; i < parts.length; i++) {
			next = [];
			for (j = 0; j < found.length; j++) descendants(found[j], parts[i], next);
			found = next;
		}
		return found;
	}
	function makeElement(tag, ownerDocument) {
		var el;
		el = eventTarget({
			nodeType: 1,
			tagName: String(tag || 'div').toUpperCase(),
			ownerDocument: ownerDocument || null,
			attrs: {}, dataset: {}, children: [], parentNode: null,
			id: '', value: '', textContent: '', className: '',
			checked: false, hidden: false, disabled: false,
			width: 0, height: 0, clientWidth: 0, clientHeight: 0,
			clientLeft: 0, clientTop: 0,
			classList: {
				_items: {},
				add: function (name) { this._items[name] = true; },
				remove: function (name) { delete this._items[name]; },
				contains: function (name) { return !!this._items[name]; }
			},
			setAttribute: function (name, value) {
				value = String(value);
				this.attrs[name] = value;
				if (name === 'id') this.id = value;
				if (name === 'value') this.value = value;
				if (name === 'width') { this.width = Number(value); this.clientWidth = this.width; }
				if (name === 'height') { this.height = Number(value); this.clientHeight = this.height; }
				if (name === 'checked') this.checked = true;
				if (name === 'hidden') this.hidden = true;
				if (name === 'disabled') this.disabled = true;
			},
			getAttribute: function (name) {
				return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
			},
			appendChild: function (child) {
				child.parentNode = this;
				if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
				this.children.push(child);
				return child;
			},
			querySelector: function (selector) { return query(el, selector); },
			querySelectorAll: function (selector) { return queryAll(el, selector); },
			getContext: function () {
				if (!this._context) this._context = makeContext();
				return this._context;
			},
			getBoundingClientRect: function () {
				var w = this.clientWidth || this.width || 1280, h = this.clientHeight || this.height || 560;
				return { left: 0, top: 0, width: w, height: h };
			},
			select: function () {}
		});
		targets.push(el);
		return el;
	}

	var win = eventTarget({
		window: null,
		parent: null,
		location: { search: '' },
		performance: { now: function () { return now; } },
		requestAnimationFrame: function (fn) { var id = ++nextFrame; frames.set(id, fn); return id; },
		cancelAnimationFrame: function (id) { frames.delete(id); },
		Event: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
	});
	win.window = win;
	win.parent = win;
	win.console = console;
	var doc = {
		nodeType: 9,
		defaultView: win,
		createElement: function (tag) { return makeElement(tag, doc); },
		createTextNode: function (text) { return { nodeType: 3, textContent: text, ownerDocument: doc }; }
	};
	win.document = doc;
	doc.body = makeElement('body', doc);
	var foreignCanvas = makeElement('canvas', doc);
	foreignCanvas.setAttribute('id', 'c');
	foreignCanvas.setAttribute('width', '280');
	foreignCanvas.setAttribute('height', '82');
	var shell = makeElement('div', doc);
	shell.setAttribute('id', 'library-shell');
	shell.attachShadow = function (init) {
		var shadow = makeElement('#shadow-root', doc);
		shadow.nodeType = 11;
		shadow.mode = init && init.mode;
		return shadow;
	};
	var status = makeElement('output', doc);
	status.setAttribute('id', 'm2-status');
	status.dataset = {};
	var controls = {};
	['m2-pause', 'm2-step', 'm2-couple', 'm2-log', 'm2-stop', 'm2-restart'].forEach(function (id) {
		var el = makeElement('button', doc);
		el.setAttribute('id', id);
		controls[id] = el;
	});
	var outer = { c: foreignCanvas, 'library-shell': shell, 'm2-status': status };
	Object.keys(controls).forEach(function (id) { outer[id] = controls[id]; });
	doc.getElementById = function (id) { return outer[id] || null; };

	return {
		win: win, doc: doc, outer: outer, controls: controls, status: status,
		foreignCanvas: foreignCanvas, runtimeErrors: runtimeErrors, frames: frames,
		pendingFrames: function () { return frames.size; },
		advanceFrame: function () {
			var jobs = Array.from(frames.values());
			frames.clear();
			now += 16.7;
			for (var i = 0; i < jobs.length; i++) {
				try { jobs[i](now); }
				catch (e) {
					runtimeErrors.push(e.name + ': ' + e.message);
					win.dispatchEvent({ type: 'error', message: e.message });
				}
			}
		},
		contextCallCount: function (el) { return el._context ? el._context._callCount() : 0; }
	};
}

check.section('A. standalone file page and classic-script order');
var pageScripts = scriptOrder(html), canonicalScripts = scriptOrder(columns);
check.ok('library.html loads all 32 page scripts once, in columns.html order',
	pageScripts.length === 32 && pageScripts.join('\n') === canonicalScripts.join('\n'),
	pageScripts.length + ' scripts; ' + (pageScripts.join(' ') === canonicalScripts.join(' ') ? 'exact match' : 'order drift'));
check.ok('no build, module loader, network resource, or columns.html reference',
	!/<script\b[^>]*\bsrc="(?:https?:)?\/\//i.test(html) && !/\btype="module"/i.test(html) &&
	html.indexOf('columns.html') < 0, 'local relative classic scripts');
check.ok('the ShadowRoot host, light-DOM #c probe and per-mount section settings are present',
	/attachShadow\(\{ mode: 'open' \}\)/.test(html) &&
	/<canvas id="c" width="280" height="82"/.test(html) &&
	/mount\.dataset\.start = 'section'/.test(html) && /mount\.dataset\.pack = PRIMARY_ID/.test(html) &&
	/mount\.dataset\.geo = '1000'/.test(html),
	'engine ids stay scoped; direct file:// launch uses SECTION_PACKS through the mount');
check.ok('the bootstrap builds and starts the engine only through the host entries',
	/COLUI\.build\(mount\)/.test(html) && /COLSIM\.start\(mount\)/.test(html) &&
	/COLSIM\.step\(\)/.test(html) && /COLCOUPLING\.apply\(message\)/.test(html),
	'build, start, one step and one-argument coupling apply');
var inline = inlineScripts(html);
check.ok('one inline host adapter follows the classic scripts', inline.length === 1, inline.length + ' inline script');

check.section('B. browser-branch scripts in a nested ShadowRoot host');
var B = fakeBrowser(), scriptErrors = [];
vm.createContext(B.win);
for (var i = 0; i < pageScripts.length; i++) {
	try {
		vm.runInContext(fs.readFileSync(path.join(root, pageScripts[i]), 'utf8'), B.win,
			{ filename: pageScripts[i] });
	} catch (e) { scriptErrors.push(pageScripts[i] + ': ' + e.name + ': ' + e.message); }
}
var inlineError = '';
try { vm.runInContext(inline[0], B.win, { filename: 'library.html inline bootstrap' }); }
catch (e2) { inlineError = e2.name + ': ' + e2.message; }
var app = B.win.M2_LIBRARY;
check.ok('all classic scripts and the page bootstrap execute without a load error',
	!scriptErrors.length && !inlineError && !!app && B.status.dataset.state === 'pass',
	(scriptErrors.join(' | ') || inlineError || B.status.textContent));
var innerCanvas = app && app.mount.querySelector('#c');
var foreignCallsAfterBoot = B.contextCallCount(B.foreignCanvas);
check.ok('the engine #c is inside its mount; the document-level #c remains host-owned',
	!!innerCanvas && innerCanvas !== B.foreignCanvas && B.doc.getElementById('c') === B.foreignCanvas,
	'host and engine canvas are distinct');
check.ok('COLSIM.start loaded the primary Earth cut through SECTION_PACKS from a queryless file page',
	B.win.location.search === '' && B.win.COLSIM.started && B.win.COLSECTION.mode && B.win.COLSECTION.world &&
	B.win.COLSECTION.origin === PRIMARY_ID && B.win.COLP.sl.geo === 1000 &&
	B.win.COLSECTION.pack.checksum === B.win.SECTION_PACKS[PRIMARY_ID].checksum && B.pendingFrames() === 1,
	B.win.COLSECTION.origin + ' · geo ' + B.win.COLP.sl.geo + ' · no URL query · ' + B.pendingFrames() + ' frame pending');

if (app) {
	check.section('C. pause, single frame, baked coupling, core-log placement');
	B.advanceFrame();
	var pauseTime = B.win.COLSIM.t;
	B.controls['m2-pause'].click();
	check.ok('the host delivers a paused globe-clock message',
		B.win.COLSECTION.syncPaused && B.status.dataset.state === 'pass', B.status.textContent);
	B.advanceFrame();
	check.ok('the paused geological clock holds across a browser-style frame',
		B.win.COLSIM.t === pauseTime && B.pendingFrames() === 1 && !B.runtimeErrors.length,
		't ' + B.win.COLSIM.t.toFixed(3) + ' Myr held');
	var beforeStepFrame = B.win.COLSIM.frame, beforeStepTime = B.win.COLSIM.t;
	B.controls['m2-step'].click();
	check.ok('one configured step advances exactly one small simulation frame and pauses the rate',
		B.win.COLSIM.frame === beforeStepFrame + 1 && B.win.COLSIM.t > beforeStepTime &&
		B.win.COLSIM.dG === 0 && B.win.COLSECTION.syncPaused,
		'frame ' + beforeStepFrame + ' → ' + B.win.COLSIM.frame + ', t ' + beforeStepTime + ' → ' + B.win.COLSIM.t + ' Myr · ' + B.status.textContent);
	B.controls['m2-couple'].click();
	check.ok('the second Earth bake is applied by the one-argument host API',
		B.win.COLCOUPLING.last.matched > 0 && B.win.COLSECTION.origin === PRIMARY_ID &&
		!B.win.COLSECTION.bad && B.status.dataset.state === 'pass',
		SNAPSHOT_ID + ' · ' + B.win.COLCOUPLING.last.matched + ' matched columns');
	B.controls['m2-log'].click();
	var outField = app.mount.querySelector('#sObsOut'), parsed = null, parseError = '';
	try { parsed = B.win.CoreLogFormat.parse(outField.value); }
	catch (e3) { parseError = e3.message; }
	check.ok('the core log is built, placed in its host textarea and parses as v2',
		!!parsed && parsed.records.length > 0 && B.status.dataset.state === 'pass',
		parseError || (parsed ? parsed.records.length + ' records · ' + parsed.checksum : B.status.textContent));

	check.section('D. stop and restart');
	B.controls['m2-stop'].click();
	check.ok('stop cancels the pending frame and marks the page host stopped',
		!B.win.COLSIM.started && B.pendingFrames() === 0 && B.status.dataset.state === 'pass', B.status.textContent);
	B.controls['m2-restart'].click();
	check.ok('restart restores the same bundled cut in one nested frame loop',
		B.win.COLSIM.started && B.win.COLSECTION.mode && B.win.COLSECTION.origin === PRIMARY_ID &&
		B.win.COLSECTION.pack.checksum === B.win.SECTION_PACKS[PRIMARY_ID].checksum &&
		B.pendingFrames() === 1 && B.status.dataset.state === 'pass', B.status.textContent);
	B.win.COLSIM.stop();
	check.ok('no engine draw ever used the host-owned light-DOM canvas',
		B.contextCallCount(B.foreignCanvas) === foreignCallsAfterBoot,
		'host-canvas calls ' + foreignCallsAfterBoot + ' → ' + B.contextCallCount(B.foreignCanvas));
}
check.ok('the scripted run produced no uncaught page or frame errors',
	!inlineError && !scriptErrors.length && !B.runtimeErrors.length && B.status.dataset.state === 'pass',
	B.runtimeErrors.join(' | ') || B.status.textContent);

check.done();
