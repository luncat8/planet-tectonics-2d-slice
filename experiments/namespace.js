// namespace.js — 0.9.0 M0, the C1 audit (0.9.0-plan.md §1 and §2 M0). Each "already true"
// claim of §1 gets a measured line: the scripts are loaded the way a page loads them — classic
// scripts sharing one global — into VM contexts, and the global set is read back, never
// inferred from source text.
//
//   A. the engine's global set: the 25 engine files and the four non-engine files they read, in
//      columns.html order. Per file exactly its one name, together exactly the expectation,
//      nothing in the global lexical scope, one object per name (no second spelling).
//   B. no DOM: loading throws nothing and reaches for no page name; COLSIM.start() refuses
//      with its one named error and changes nothing.
//   C. start/stop with columns.html's DOM handed in as the host: two starts with one host are
//      one frame loop, stop() releases the loop and every listener, and a start after stop is
//      a clean restart (the same frames hash the same).
//   D. the collision half: the globe's page scripts at the 0.9.0 pin, and at its branch tip once
//      that moves, loaded the same way. Their set meets ours only where both pages load one
//      shared file (SlicePack at the pin) and in the collisions recorded below; SECTION_PACKS
//      stays ours alone.
//
// A global set is two sets. The global object's own properties (var, function, root.X = …) are
// what Object.keys sees. The global lexical scope (top-level let/const/class) is invisible to
// it, yet a second script declaring one of its names throws; the inspector protocol's
// Runtime.globalLexicalScopeNames is the one API that lists it.
//
//   node experiments/namespace.js [path-to-planet-geotectonics]
//
// The globe tree defaults to $UPSTREAM or /tmp/up and is read through `git show <rev>:<path>`,
// so where its checkout stands never matters. Without a tree D reports SKIP; nothing here
// touches the network.
'use strict';

var cp = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var inspector = require('inspector');
var path = require('path');
var vm = require('vm');
var lib = require('./lib.js');
var check = lib.check;

var root = lib.root;
var html = fs.readFileSync(path.join(root, 'columns.html'), 'utf8');
var order = lib.scriptOrder();
var PORT = require('../port/PORT.json');

// the globe commit 0.9.0-plan.md pins its claims about their tree to (main tip, 2026-10-16)
var PIN = '3c960e7d924a6ca61b9609bd3c865988ce522ddd';

// §1's table, byte-named: the one global each engine file exports
var ENGINE = {
	'js/params.js': 'COLP', 'js/rng.js': 'COLRNG', 'js/geom.js': 'COLGEO', 'js/state.js': 'COLS',
	'js/surface.js': 'COLSURF', 'js/columns.js': 'COLCOLUMNS', 'js/mantle.js': 'COLMANTLE',
	'js/slab.js': 'COLSLAB', 'js/plates.js': 'COLPLATES', 'js/magma.js': 'COLMAGMA',
	'js/erupt.js': 'COLERUPT', 'js/crust.js': 'COLCRUST', 'js/ore.js': 'COLORE', 'js/perf.js': 'COLPERF',
	'js/ui.js': 'COLUI', 'js/deposit-core.js': 'COLDEPOSITCORE', 'js/deposits.js': 'COLDEPOSITS',
	'js/section-seed.js': 'COLSEED', 'js/checkpoint.js': 'COLCHECKPOINT',
	'js/section-pack.js': 'COLSECTION', 'js/coupling.js': 'COLCOUPLING', 'js/coupling-link.js': 'COLLINK',
	'js/core-log.js': 'COLCORELOG', 'js/render.js': 'COLRENDER', 'js/sim.js': 'COLSIM'
};
// the rest of the engine's load set, one name each: the two shared formats (a host page loads
// each once) and the two deposit modules 0.4.2 D2 moved out of port/ under their old names
var READS = {
	'port/slice-format.js': 'SlicePack', 'port/core-log-format.js': 'CoreLogFormat',
	'js/data/deposit-models.js': 'DepositModels', 'js/data/deposit-economics.js': 'DepositEconomics'
};
// every section bundle registers on this one object
var BUNDLES = 'SECTION_PACKS';

// names both pages define from different files, recorded in the open (0.9.0-plan.md §2 M0): the
// negotiation input M3 carries. Each is re-measured — still these two files, still different
// bytes — so a resolution on either side turns D red until this record moves with it.
var RECORDED = {
	DepositEconomics: { ours: 'js/data/deposit-economics.js', theirs: 'js/data/deposit-economics.js' }
};

var NAMED = 'COLSIM.start needs a DOM host and requestAnimationFrame';

function sorted(a) { return a.slice().sort(); }
function same(a, b) { return sorted(a).join(' ') === sorted(b).join(' '); }
function minus(a, b) { return a.filter(function (x) { return b.indexOf(x) < 0; }); }
function meet(a, b) { return a.filter(function (x) { return b.indexOf(x) >= 0; }); }
function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function thrown(e) { return e ? e.name + ': ' + e.message : ''; }
function refusal(fn) {
	try { fn(); } catch (e) { return thrown(e); }
	return 'no refusal';
}
function tally(list) {
	var n = {};
	list.forEach(function (x) { n[x] = (n[x] || 0) + 1; });
	return Object.keys(n).map(function (k) { return k + (n[k] > 1 ? ' ×' + n[k] : ''); }).join(', ');
}

// --- contexts and their global sets -------------------------------------------------------
// The inspector finds a VM context by the name it was created with.
var session = new inspector.Session(), contextIds = {}, contextN = 0;
session.connect();
session.on('Runtime.executionContextCreated', function (e) {
	contextIds[e.params.context.name] = e.params.context.id;
});
session.post('Runtime.enable');

function lexicalNames(ctx) {
	var names = null;
	session.post('Runtime.globalLexicalScopeNames', { executionContextId: contextIds[ctx.name] },
		function (err, res) { if (!err) names = res.names; });
	if (!names) throw new Error('the inspector listed no lexical scope for ' + ctx.name);
	return names;
}

function globalNames(ctx) {
	return { own: vm.runInContext('Object.getOwnPropertyNames(globalThis)', ctx.sb), lex: lexicalNames(ctx) };
}

// a browser realm without a DOM: the global calls itself window — the global object, not a DOM
// API, and the name every script here reads its dependencies through — and holds nothing else
function bareContext() {
	var ctx = { name: 'namespace-' + (++contextN), sb: {}, reads: [] };
	vm.createContext(ctx.sb, { name: ctx.name });
	vm.runInContext('globalThis.window = globalThis;', ctx.sb);
	return ctx;
}

// the names a script reaches a page through: its document, frame clock and timers, event bus
// and storage. Each becomes an accessor that books the read with the file and line reading it
// and answers undefined, so the engine still sees no DOM (typeof says 'undefined') while every
// touch is counted.
var PAGE_NAMES = ['document', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame',
	'setTimeout', 'setInterval', 'addEventListener', 'removeEventListener', 'postMessage'];
function trappedContext() {
	var ctx = bareContext();
	PAGE_NAMES.forEach(function (name) {
		Object.defineProperty(ctx.sb, name, { configurable: true, get: function () {
			var at = /((?:js|port)\/[\w./-]+\.js:\d+)/.exec(new Error().stack.split('\n').slice(2).join('\n'));
			ctx.reads.push(name + (at ? ' @ ' + at[1] : ''));
			return undefined;
		} });
	});
	return ctx;
}

function ours(file) {
	var buf = fs.readFileSync(path.join(root, file));
	return { name: file, text: buf.toString('utf8'), sha: sha256(buf) };
}

// classic scripts one after another into one global; per script, the names it added and what
// it threw (a page goes on to its next script after a throw, and so does this)
function loadInto(ctx, scripts) {
	var before = globalNames(ctx);
	return scripts.map(function (s) {
		var error = null, after, row;
		try { vm.runInContext(s.text, ctx.sb, { filename: s.name }); } catch (e) { error = e; }
		after = globalNames(ctx);
		row = { script: s, name: s.name, error: error, own: minus(after.own, before.own), lex: minus(after.lex, before.lex) };
		before = after;
		return row;
	});
}
function namesOf(rows) { return [].concat.apply([], rows.map(function (r) { return r.own.concat(r.lex); })); }
function stops(rows) { return rows.filter(function (r) { return r.error; }); }
function rowOf(rows, name) { return rows.filter(function (r) { return r.name === name; })[0] || null; }
function pageScripts(src) {
	var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, out = [], m, s;
	while ((m = re.exec(src)) !== null) {
		s = /\bsrc="([^"]+)"/.exec(m[1]);
		out.push(s ? { src: s[1] } : { inline: m[2] });
	}
	return out;
}

var engineFiles = order.filter(function (f) { return /^js\/[^/]+\.js$/.test(f); });
var bundleFiles = order.filter(function (f) { return /^js\/data\/section-/.test(f); });
// the page minus its bundles: every file the engine reads, at load or at call
var engineLoad = minus(order, bundleFiles);

check.section('A. the engine\'s global set (bare VM context, columns.html order)');
var onDisk = fs.readdirSync(path.join(root, 'js')).filter(function (f) { return /\.js$/.test(f); })
	.map(function (f) { return 'js/' + f; });
check.ok('the engine is §1\'s 25 files: every js/*.js on disk, each loaded once by columns.html',
	engineFiles.length === 25 && same(engineFiles, Object.keys(ENGINE)) && same(onDisk, engineFiles),
	engineFiles.length + ' loaded, ' + onDisk.length + ' on disk, ' + Object.keys(ENGINE).length + ' in the table');
check.ok('the rest of the page is the four files the engine reads and the section bundles',
	same(minus(engineLoad, engineFiles), Object.keys(READS)) && bundleFiles.length > 0,
	Object.keys(READS).join(', ') + ' + ' + bundleFiles.length + ' bundles');

var ctxA = bareContext();
var rowsA = loadInto(ctxA, engineLoad.map(ours));
function offTable(table) {
	return rowsA.filter(function (r) { return r.name in table && r.own.concat(r.lex).join(' ') !== table[r.name]; })
		.map(function (r) { return r.name + ' → [' + r.own.concat(r.lex).join(', ') + ']' + (r.error ? ' ' + thrown(r.error) : ''); });
}
check.ok('each engine file adds exactly its one §1 name, byte for byte', offTable(ENGINE).length === 0,
	offTable(ENGINE).join('; ') || '25 files, 25 names');
check.ok('each of the four adds exactly its one name: ' + values(READS).join(', '), offTable(READS).length === 0,
	offTable(READS).join('; ') || 'the shared formats and the deposit modules');
var namesA = namesOf(rowsA), expectA = values(ENGINE).concat(values(READS));
check.ok('the engine\'s global set is exactly those 29 names: no leak', same(namesA, expectA),
	namesA.length + ' names' + (same(namesA, expectA) ? '' : '; extra [' + minus(namesA, expectA) + '] missing [' + minus(expectA, namesA) + ']'));
var lexA = lexicalNames(ctxA);
check.ok('nothing lands in the global lexical scope (every other top-level name sits inside an IIFE)',
	lexA.length === 0, '[' + lexA.join(', ') + ']');
var objects = namesA.map(function (n) { return ctxA.sb[n]; });
var distinct = objects.filter(function (o, i) { return !!o && objects.indexOf(o) === i; });
check.ok('one object per name: no export is reachable under a second spelling', distinct.length === namesA.length,
	distinct.length + ' objects for ' + namesA.length + ' names');

var IIFE_HEAD = '(function (root) {\n';
var IIFE_TAIL = /\nif \([^\n]+\) module\.exports = ([A-Za-z_$][\w$]*);\nelse root\.([A-Za-z_$][\w$]*) = \1;\n\}\)\(typeof window !== 'undefined' \? window : \(typeof global !== 'undefined' \? global : this\)\);\n$/;
var unshaped = engineFiles.filter(function (f) {
	var text = rowOf(rowsA, f).script.text, m = IIFE_TAIL.exec(text);
	return text.indexOf(IIFE_HEAD) !== 0 || !m || m[2] !== ENGINE[f];
});
check.ok('each engine file is one IIFE over root, ending `else root.<its name> = …` behind the module.exports guard',
	unshaped.length === 0, unshaped.join(', ') || '25 of 25');
// the guard's other branch: lib.js required every page script under CommonJS
var leaked = engineFiles.filter(function (f) {
	var mod = lib.mods[path.basename(f, '.js')];
	return !mod || typeof mod !== 'object' || ENGINE[f] in global;
});
check.ok('under CommonJS each engine file exports through module.exports and writes none of the 25 names',
	leaked.length === 0, leaked.join(', ') || '25 modules, node\'s global untouched');

var plain = stops(loadInto(bareContext(), ['port/slice-format.js'].concat(engineFiles).map(ours)));
check.info('the plan\'s wording, the 25 files with port/slice-format.js alone, stops ' + plain.length + ' files at load',
	plain.map(function (r) { return r.name + ' (' + thrown(r.error) + ')'; }).join('; '));

var ctxPage = bareContext();
var rowsPage = loadInto(ctxPage, order.map(ours));
var namesPage = namesOf(rowsPage);
check.ok('with the bundles, the page\'s set is the engine\'s plus ' + BUNDLES + ' alone',
	same(namesPage, namesA.concat([BUNDLES])) && stops(rowsPage).length === 0,
	namesPage.length + ' names; ' + bundleFiles.length + ' bundles, one object');

check.section('B. no DOM: loading starts nothing and throws nothing; start() refuses by name');
check.ok('loading the engine and the whole page into a context with no DOM throws nothing',
	stops(rowsA).length === 0 && stops(rowsPage).length === 0,
	stops(rowsA).concat(stops(rowsPage)).map(function (r) { return r.name + ' ' + thrown(r.error); }).join('; ') ||
	(rowsA.length + rowsPage.length) + ' scripts ran to their end');
var ctxB = trappedContext();
var rowsB = loadInto(ctxB, order.map(ours));
check.ok('loading reaches for no page name: no document, no frame clock, no timer, no event bus, no storage',
	ctxB.reads.length === 0 && stops(rowsB).length === 0,
	tally(ctxB.reads) || 'zero reads of ' + PAGE_NAMES.length + ' booked names');
check.ok('nothing started itself: COLSIM is not running and no control is bound',
	ctxB.sb.COLSIM.started === false && ctxB.sb.COLUI._listeners.length === 0);
var SIMA = ctxA.sb.COLSIM, UIA = ctxA.sb.COLUI;
var noDom = [
	['start()', function () { SIMA.start(); }],
	['start(window)', function () { SIMA.start(ctxA.sb.window); }],
	['start(a document whose window has no frame clock)', function () { SIMA.start({ nodeType: 9, defaultView: {} }); }]
].map(function (c) { return c[0] + ' → ' + refusal(c[1]); });
check.ok('COLSIM.start() throws its one named error', noDom[0] === 'start() → Error: ' + NAMED, noDom[0]);
check.ok('a host with no DOM or no frame clock gets that same error',
	noDom.every(function (r) { return r.endsWith(' → Error: ' + NAMED); }), noDom.slice(1).join('; '));
check.ok('a refused start changes nothing: not running, nothing bound, no host kept',
	SIMA.started === false && UIA._listeners.length === 0 && UIA.host === null);
var inline = pageScripts(html).filter(function (s) { return s.inline !== undefined; })
	.map(function (s) { return s.inline.trim(); });
check.ok('columns.html\'s one inline script is the host\'s explicit COLSIM.start(document)',
	inline.length === 1 && inline[0] === 'COLSIM.start(document);', JSON.stringify(inline));

// --- C's host: columns.html's DOM ---------------------------------------------------------
function idsIn(src) {
	var re = /\sid="([^"]+)"/g, out = [], m;
	while ((m = re.exec(src)) !== null) out.push(m[1]);
	return out;
}
function attrsOf(id) {
	var tag = new RegExp('<\\w+\\b[^>]*\\sid="' + id + '"[^>]*>').exec(html), re = /([\w-]+)="([^"]*)"/g, out = {}, m;
	while (tag && (m = re.exec(tag[0])) !== null) out[m[1]] = m[2];
	return out;
}
var IDS = idsIn(html);
var PRESETS = (function () {
	var block = /\sid="presets"[^>]*>([\s\S]*?)<\/span>/.exec(html), re = /data-v="([^"]+)"/g, out = [], m;
	while (block && (m = re.exec(block[1])) !== null) out.push(m[1]);
	return out;
})();

// a document with a window of its own, handed to start(): the context's global holds no DOM, so
// whatever the engine reaches it reaches through the host. Listeners are booked per target and
// frames per id, so a leftover binding or a second loop is a count, not a guess.
function makeHost() {
	var targets = [], frames = new Map(), seq = 0, clock = 0;
	var ctx2d = new Proxy({
		createImageData: function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
		measureText: function (s) { return { width: String(s).length * 6 }; }
	}, {
		get: function (t, k) { return k in t ? t[k] : function () {}; },
		set: function (t, k, v) { t[k] = v; return true; }
	});
	function target(o) {
		var on = {};
		o.addEventListener = function (type, fn) { (on[type] = on[type] || new Set()).add(fn); };
		o.removeEventListener = function (type, fn) { if (on[type]) on[type].delete(fn); };
		o.listening = function () { return Object.keys(on).reduce(function (n, k) { return n + on[k].size; }, 0); };
		targets.push(o);
		return o;
	}
	function element(attrs) {
		return target({
			attrs: attrs, value: '0', textContent: '', checked: false, hidden: false, disabled: false,
			width: Number(attrs.width) || 0, height: Number(attrs.height) || 0,
			getAttribute: function (n) { return n in this.attrs ? this.attrs[n] : null; },
			setAttribute: function (n, v) { this.attrs[n] = String(v); },
			appendChild: function () {},
			getContext: function () { return ctx2d; },
			getBoundingClientRect: function () { return { left: 0, top: 0, width: this.width, height: this.height }; }
		});
	}
	var els = {};
	IDS.forEach(function (id) { els[id] = element(attrsOf(id)); });
	var presets = PRESETS.map(function (v) { return element({ 'data-v': v }); });
	var doc = {
		nodeType: 9,
		getElementById: function (id) { return els[id] || null; },
		querySelectorAll: function (sel) { return sel === '#presets button' ? presets : []; },
		createElement: function () { return element({}); }
	};
	var win = target({
		document: doc,
		performance: { now: function () { return clock; } },
		requestAnimationFrame: function (fn) { frames.set(++seq, fn); return seq; },
		cancelAnimationFrame: function (id) { frames.delete(id); }
	});
	win.window = win;
	doc.defaultView = win;
	return {
		doc: doc, win: win, frames: frames,
		now: function () { return clock; },
		listening: function () { return targets.reduce(function (n, t) { return n + t.listening(); }, 0); },
		tick: function (n) {
			for (var i = 0; i < n; i++) {
				clock += 16.7;
				var due = Array.from(frames.values());
				frames.clear();
				due.forEach(function (fn) { fn(clock); });
			}
		}
	};
}
function fingerprint(sb) { return sb.COLS.hash() + ' rng ' + sb.COLRNG.state().join(',') + ' t ' + sb.COLSIM.t; }

check.section('C. start/stop: one host, one loop (columns.html\'s DOM handed in as the host)');
var ctxC = trappedContext();
var rowsC = loadInto(ctxC, order.map(ours));
var SIMC = ctxC.sb.COLSIM, UIC = ctxC.sb.COLUI, host = makeHost();
check.ok('the host is columns.html\'s DOM, and the context\'s own global still has none',
	IDS.length > 0 && PRESETS.length === 4 && stops(rowsC).length === 0 && ctxC.reads.length === 0,
	IDS.length + ' ids, presets ' + PRESETS.join('/') + ', canvas ' + attrsOf('c').width + '×' + attrsOf('c').height);
SIMC.start(host.doc);
var bound = host.listening();
check.ok('start(host) runs one frame loop and binds the page\'s controls',
	SIMC.started && host.frames.size === 1 && bound > 0 && bound === UIC._listeners.length,
	host.frames.size + ' frame pending, ' + bound + ' listeners');
host.tick(2);
var again = SIMC.start(host.doc);
check.ok('a second start with the same host is the same loop: nothing re-bound, nothing reset',
	again === SIMC && SIMC.started && host.frames.size === 1 && host.listening() === bound && SIMC.frame === 2,
	host.frames.size + ' frame pending, ' + host.listening() + ' listeners, frame ' + SIMC.frame);
host.tick(2);
check.ok('the frames advance once per tick: one loop, not two', SIMC.frame === 4 && host.frames.size === 1,
	'frame ' + SIMC.frame + ' after 4 ticks');
var first = fingerprint(ctxC.sb);
var inFlight = Array.from(host.frames.values())[0];
SIMC.stop();
check.ok('stop() cancels the pending frame and releases every listener it bound',
	!SIMC.started && host.frames.size === 0 && host.listening() === 0 && UIC._listeners.length === 0,
	host.frames.size + ' frames, ' + host.listening() + ' listeners');
inFlight(host.now() + 16.7);
check.ok('a frame already in flight when stop() ran does nothing', SIMC.frame === 4 && host.frames.size === 0,
	'frame ' + SIMC.frame + ', ' + host.frames.size + ' pending');
check.ok('a second stop() is a no-op',
	SIMC.stop() === SIMC && !SIMC.started && host.frames.size === 0 && host.listening() === 0);
SIMC.start(host.doc);
check.ok('a start after stop is a clean restart: one loop, the same bindings, a fresh world',
	SIMC.started && host.frames.size === 1 && host.listening() === bound && SIMC.frame === 0 && SIMC.t === 0,
	host.frames.size + ' frame pending, ' + host.listening() + ' listeners, frame ' + SIMC.frame + ', t ' + SIMC.t);
host.tick(4);
var second = fingerprint(ctxC.sb);
check.ok('the restart replays the first start bit for bit: 4 frames, one state', second === first, second);
SIMC.stop();
// js/section-pack.js page() reads root.document to learn whether it runs in a page, then uses
// root, never the document: the one read M2's in-page "never touched document" has to allow
check.info('page names the engine read off its own global, with the host handed in',
	tally(ctxC.reads) || 'none');
// hostDocument() finds a document through nodeType/ownerDocument only, and a window has neither:
// §1's "a document, a window or an element" does not hold for the window, and M1's contract decides
var winHost = makeHost(), asWindow = refusal(function () { SIMC.start(winHost.win); });
SIMC.stop();
check.info('a window host, its document and frame clock in place', asWindow);

// --- D: the globe's page ------------------------------------------------------------------
var up = process.argv[2] || process.env.UPSTREAM || '/tmp/up';
function git(args, buffer) {
	return cp.spawnSync('git', ['-C', up].concat(args), { encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 1 << 28 });
}
function show(rev, file) {
	var r = git(['show', rev + ':' + file], true);
	return r.status === 0 ? r.stdout : null;
}
function resolve(ref) {
	var r = git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
	return r.status === 0 ? r.stdout.trim() : null;
}
function branchTip() {
	var refs = ['origin/HEAD', 'origin/main', 'origin/master', 'HEAD'], i, sha;
	for (i = 0; i < refs.length; i++) {
		sha = resolve(refs[i]);
		if (sha) return { ref: refs[i], sha: sha };
	}
	return null;
}
// code only: their plans quote our names in prose, and a quotation defines nothing
function inCode(rev, word) {
	var r = git(['grep', '-l', '-F', word, rev, '--', '*.js', '*.mjs', '*.html']);
	return r.status === 0 ? r.stdout.trim().split('\n') : [];
}

// a script that stops at a throw keeps its declarations (they are instantiated before its first
// statement runs) but not a root write past the throw: finding no such write in its text is
// what makes the set measured around it complete
var ROOT_WRITE = /\b(?:window|globalThis|self)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)/g;
function rootWrites(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').match(ROOT_WRITE) || [];
}

function globePage(rev) {
	var page = show(rev, 'index.html');
	if (!page) return null;
	var scripts = pageScripts(page.toString('utf8')).map(function (s, i) {
		if (s.src === undefined) return { name: 'index.html inline #' + (i + 1), text: s.inline };
		var buf = show(rev, s.src);
		return { name: s.src, text: buf ? buf.toString('utf8') : '', sha: buf ? sha256(buf) : null };
	});
	var rows = loadInto(bareContext(), scripts);
	return { rev: rev, rows: rows, names: namesOf(rows) };
}

// a port/ file both pages load byte for byte is one file, which a host page loads once: its
// names are the one kind of collision there must be
function sharedNames(g) {
	return [].concat.apply([], PORT.files.filter(function (f) { return order.indexOf(f.path) >= 0; }).map(function (f) {
		var row = rowOf(g.rows, f.path);
		return row && row.script.sha === f.sha256 ? row.own.concat(row.lex) : [];
	}));
}

function judge(g, label) {
	var cut = stops(g.rows), shared = sharedNames(g), clash = meet(namesPage, g.names);
	var recorded = Object.keys(RECORDED), hiding = cut.filter(function (r) { return rootWrites(r.script.text).length > 0; });
	check.info(label + ': ' + g.rows.length + ' page scripts define ' + g.names.length + ' globals',
		cut.map(function (r) { return r.name + ' stops at ' + thrown(r.error); }).join('; ') || 'every script runs to its end');
	check.ok(label + ': their set is complete — no script that stops early writes to the global past its stop',
		hiding.length === 0, hiding.map(function (r) { return r.name + ': ' + rootWrites(r.script.text).join(' '); }).join('; ') ||
		cut.length + ' stopped early, no root write in ' + (cut.length === 1 ? 'it' : 'them'));
	check.ok(label + ': none of the 25 COL* names is theirs', meet(values(ENGINE), g.names).length === 0,
		'[' + meet(values(ENGINE), g.names).join(', ') + ']');
	check.ok(label + ': our page meets theirs exactly in the shared files\' names and the recorded collisions',
		same(clash, shared.concat(recorded)),
		'meet [' + sorted(clash).join(', ') + '], shared [' + shared.join(', ') + '], recorded [' + recorded.join(', ') + ']');
	recorded.forEach(function (n) {
		var mine = rowOf(rowsPage, RECORDED[n].ours), theirs = rowOf(g.rows, RECORDED[n].theirs);
		check.ok(label + ': ' + n + ' is still the recorded collision, two different files under one name',
			!!mine && !!theirs && mine.own.indexOf(n) >= 0 && theirs.own.concat(theirs.lex).indexOf(n) >= 0 &&
			mine.script.sha !== theirs.script.sha,
			'ours ' + RECORDED[n].ours + ' ' + (mine ? mine.script.sha.slice(0, 8) : '—') +
			', theirs ' + RECORDED[n].theirs + ' ' + (theirs && theirs.script.sha ? theirs.script.sha.slice(0, 8) : '—'));
	});
	var named = inCode(g.rev, BUNDLES);
	check.ok(label + ': ' + BUNDLES + ' stays ours alone — not on their page, in no script or page of their tree',
		g.names.indexOf(BUNDLES) < 0 && named.length === 0, named.join(', ') || 'absent from *.js, *.mjs, *.html');
	return shared;
}

function finish() {
	session.disconnect();
	check.done();
}

check.section('D. the collision half: the globe\'s page, loaded the same way');
if (!fs.existsSync(path.join(up, '.git'))) {
	check.info('SKIP no planet-geotectonics checkout at ' + up, 'pass a path or set $UPSTREAM');
	return finish();
}
check.ok('the 0.9.0 pin is in the counterpart\'s history', resolve(PIN) === PIN, PIN.slice(0, 7) + ' in ' + up);
var atPin = resolve(PIN) === PIN ? globePage(PIN) : null;
check.ok('their page is index.html at the pin', !!atPin, atPin ? atPin.rows.length + ' scripts' : 'absent');
if (!atPin) return finish();
var sharedPin = judge(atPin, 'pin ' + PIN.slice(0, 7));
check.ok('at the pin the one shared name is SlicePack: port/slice-format.js, byte for byte on both pages',
	same(sharedPin, ['SlicePack']), '[' + sharedPin.join(', ') + ']');
var tip = branchTip();
if (!tip || tip.sha === PIN) {
	check.info('their branch tip is the pin', tip ? tip.ref : 'no branch ref');
	return finish();
}
var atTip = globePage(tip.sha);
check.ok('their page is index.html at the tip', !!atTip, tip.ref + ' ' + tip.sha.slice(0, 7));
if (atTip) judge(atTip, 'tip ' + tip.sha.slice(0, 7));
finish();
