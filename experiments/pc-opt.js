// pc-opt.js — 0.5.0 M1's second gate (0.5.0-plan.md §3.5, §9 M1): the option registry and
// both pages' static bars agree entry for entry — id, kind, range, default — and the
// registry's own invariants hold.
//
// The bar is read from the HTML, not from a script, because the point of the gate is that the
// thing a reader sees before any script runs is the table of record. A range is compared on
// min/max/step/value, a toggle on aria-pressed, an enum on its option list and the selected
// one. The engine-specific defaults M0 measured (inertia 0.98 for the soup, 0 for the hybrid;
// mobility 0 vs 4) are checked on the page that should carry them, so a copy-paste between
// the two pages fails here rather than in a screenshot.
//
// Run: node experiments/pc-opt.js
'use strict';

var fs = require('fs');
var path = require('path');
var PCOPT = require('../js/pc/opt.js');
var PCSCEN = require('../js/pc/scenario.js');
var check = require('./lib.js').check;

var root = path.join(__dirname, '..');

function attrs(tag) {
	var out = {}, re = /([a-z-]+)(?:="([^"]*)")?/gi, m;
	while ((m = re.exec(tag)) !== null) {
		if (m[1] === 'data-pc-opt' || m[1] === 'input' || m[1] === 'button' || m[1] === 'select') {
			out[m[1]] = m[2] === undefined ? '' : m[2];
			continue;
		}
		out[m[1]] = m[2] === undefined ? '' : m[2];
	}
	return out;
}

// Every control that names a registry entry, in document order, as the browser sees it.
function barOf(src) {
	var out = [], m, a, opts, re;

	re = /<input\b([^>]*\bdata-pc-opt="[^"]+"[^>]*)>/gi;
	while ((m = re.exec(src)) !== null) {
		a = attrs(m[1]);
		out.push({ id: a['data-pc-opt'], kind: 'range', min: Number(a.min),
			max: Number(a.max), step: Number(a.step), def: Number(a.value) });
	}
	re = /<button\b([^>]*\bdata-pc-opt="[^"]+"[^>]*)>/gi;
	while ((m = re.exec(src)) !== null) {
		a = attrs(m[1]);
		out.push({ id: a['data-pc-opt'], kind: 'toggle', def: a['aria-pressed'] === 'true' });
	}
	re = /<select\b([^>]*\bdata-pc-opt="[^"]+"[^>]*)>([\s\S]*?)<\/select>/gi;
	while ((m = re.exec(src)) !== null) {
		a = attrs(m[1]);
		opts = [];
		var sel = null, or = /<option\b([^>]*)>([^<]*)<\/option>/gi, om;
		while ((om = or.exec(m[2])) !== null) {
			var oa = attrs(om[1]), v = oa.value === undefined ? om[2].trim() : oa.value;
			opts.push(v);
			if ('selected' in oa) sel = v;
		}
		out.push({ id: a['data-pc-opt'], kind: 'enum', values: opts,
			def: sel === null ? opts[0] : sel });
	}
	return out;
}

var pages = {
	hy: fs.readFileSync(path.join(root, 'hybrid.html'), 'utf8'),
	sp: fs.readFileSync(path.join(root, 'soup.html'), 'utf8')
};

// ------------------------------------------------------------------ A. the table itself

check.section('A. the registry is a consistent table');
var ids = {}, dup = [], missing = [];
PCOPT.REG.forEach(function (e) {
	if (ids[e.id]) dup.push(e.id);
	ids[e.id] = 1;
	if (!e.owner || !e.label || !e.note) missing.push(e.id);
	if (e.engine !== 'both' && e.engine !== 'hy' && e.engine !== 'sp') missing.push(e.id + ':engine');
	if (!e.live && e.live !== false) missing.push(e.id + ':live');
	if (e.kind === 'range' && !(e.max > e.min)) missing.push(e.id + ':range');
	if (e.kind === 'enum' && (!e.values || e.values.length < 2)) missing.push(e.id + ':values');
	if (e.kind === 'range') {
		[e.def].forEach(function (d) {
			if (typeof d === 'object') {
				if (d.hy < e.min || d.hy > e.max || d.sp < e.min || d.sp > e.max) {
					missing.push(e.id + ':def-range');
				}
			} else if (d < e.min || d > e.max) missing.push(e.id + ':def-range');
		});
	}
});
check.ok('every id is unique', dup.length === 0, dup.join(',') || PCOPT.REG.length + ' entries');
check.ok('every entry names its plan section, its label, its note and its scope',
	missing.length === 0, missing.join(',') || 'complete');
check.ok('each engine sees its own subset',
	PCOPT.forEngine('hy').length === PCOPT.REG.filter(function (e) {
		return e.engine !== 'sp';
	}).length &&
	PCOPT.forEngine('sp').length === PCOPT.REG.filter(function (e) {
		return e.engine !== 'hy';
	}).length,
	'hy ' + PCOPT.forEngine('hy').length + ', sp ' + PCOPT.forEngine('sp').length);
check.ok('an entry not on an engine cannot be set through it',
	(function () {
		var o = PCOPT.make('hy');
		try { o.set('space', 'km'); return false; } catch (err) { return true; }
	}()));

// ------------------------------------------------------------------ B. page parity

check.section('B. both pages carry exactly their engine\'s registry');
['hy', 'sp'].forEach(function (engine) {
	var bar = barOf(pages[engine]), seen = {}, i, bad = [], extra = [];
	var reg = PCOPT.forEngine(engine);
	for (i = 0; i < bar.length; i++) {
		if (seen[bar[i].id]) bad.push(bar[i].id + ':duplicate');
		seen[bar[i].id] = 1;
	}
	check.ok(engine + ': every control appears once', bad.length === 0, bad.join(',') || bar.length + ' controls');
	reg.forEach(function (e) { if (!seen[e.id]) extra.push(e.id); });
	check.ok(engine + ': every registry entry is on the page', extra.length === 0,
		extra.join(',') || 'no gaps');
	check.ok(engine + ': no control is on the page that the registry does not know',
		bar.length === reg.length, bar.length + ' controls / ' + reg.length + ' entries');
});

// ------------------------------------------------------------------ C. kind, range, default

check.section('C. every control agrees with its entry, value for value');
['hy', 'sp'].forEach(function (engine) {
	var bar = barOf(pages[engine]), byId = {}, i;
	for (i = 0; i < bar.length; i++) byId[bar[i].id] = bar[i];
	PCOPT.forEngine(engine).forEach(function (e) {
		var c = byId[e.id], d = PCOPT.defaultOf(e, engine), okKind = false;
		if (!c) {
			check.ok(engine + ' ' + e.id + ' is present', false, 'missing');
			return;
		}
		okKind = (e.kind === 'range' && c.kind === 'range') ||
			(e.kind === 'toggle' && c.kind === 'toggle') ||
			(e.kind === 'enum' && c.kind === 'enum');
		var okRange = true, okDef = c.def === d;
		if (e.kind === 'range') {
			okRange = c.min === e.min && c.max === e.max && c.step === e.step;
		}
		if (e.kind === 'enum') {
			okRange = c.values.join(',') === e.values.join(',');
		}
		check.ok(engine + ' ' + e.id + ' matches ' + e.kind +
			(e.kind === 'range' ? ' ' + e.min + '..' + e.max + ' step ' + e.step : '') +
			', default ' + d, okKind && okRange && okDef,
			okKind && okRange && okDef ? '' : 'page says ' + JSON.stringify(c));
	});
});

// ------------------------------------------------------------------ D. M0's amended defaults

check.section('D. the defaults M0 selected are the ones the pages carry');
function defOn(engine, id) { return PCOPT.defaultOf(PCOPT.entry(id), engine); }
[
	['sp', 'inertia', 0.98], ['hy', 'inertia', 0],
	['sp', 'mobContrast', 0], ['hy', 'mobContrast', 4],
	['both', 'pbfIters', 2], ['both', 'substepCap', 0.35], ['both', 'heatMode', 'analytic'],
	['both', 'magmaMode', 'pbf'], ['both', 'space', 'screen'], ['both', 'solidusOf', 'load'],
	['both', 'sizeByHeat', 0], ['both', 'links', true], ['both', 'sizeByMaterial', true],
	['both', 'pbfIters', 2], ['both', 'yieldRate', 1], ['both', 'kDamage', 1],
	['both', 'tauHeal', 1], ['both', 'clock', 50]
].forEach(function (row) {
	var engine = row[0] === 'both' ? 'sp' : row[0];
	check.ok(row[0] + ' ' + row[1] + ' defaults to ' + row[2],
		defOn(engine, row[1]) === row[2], String(defOn(engine, row[1])));
});

// ------------------------------------------------------------------ E. live vs reset

check.section('E. live options apply now, reset options wait for the next planet');
var o = PCOPT.make('sp');
o.set('clock', 100);
check.ok('a live option takes effect immediately', o.get('clock') === 100);
o.set('partSize', 1.8);
check.ok('a reset option is staged, not applied', o.get('partSize') === 1 &&
	o.pendingList().indexOf('partSize') >= 0, 'pending ' + o.pendingList().join(','));
var changed = o.commit();
check.ok('the next planet commits it', o.get('partSize') === 1.8 &&
	changed.indexOf('partSize') >= 0 && o.pendingList().length === 0);
o.set('clock', 100);
check.ok('setting a live option to its current value is a no-op',
	o.set('clock', 100) === true && o.get('clock') === 100);
o.set('clock', 1e6);
check.ok('a range clamps at its maximum', o.get('clock') === PCOPT.entry('clock').max,
	String(o.get('clock')));
o.set('clock', -5);
check.ok('and at its minimum', o.get('clock') === PCOPT.entry('clock').min, String(o.get('clock')));
check.ok('an out-of-range enum is refused without changing the value',
	o.set('space', 'moon') === false && o.get('space') === 'screen', o.get('space'));
o.resetAll();
check.ok('resetAll returns the registry defaults', o.get('clock') === 50 && o.get('inertia') === 0.98);
check.ok('an option change notifies only when it is live',
	(function () {
		var seen = [], p = PCOPT.make('sp', function (id) { seen.push(id); });
		p.set('clock', 120); p.set('partSize', 1.5);
		return seen.length === 1 && seen[0] === 'clock';
	}()));

// ------------------------------------------------------------------ F. the scenario presets

check.section('F. the scenario presets are registry entries, in range');
check.ok('the registry scenario enum and the scenario module agree',
	PCOPT.entry('scenario').values.join(',') === PCSCEN.ids.join(','),
	PCSCEN.ids.join(','));
PCSCEN.ids.forEach(function (id) {
	var p = PCSCEN.preset(id), problems = [];
	if (!(p.clock >= PCOPT.entry('clock').min && p.clock <= PCOPT.entry('clock').max)) {
		problems.push('clock ' + p.clock);
	}
	Object.keys(p.options).forEach(function (key) {
		var e = PCOPT.entry(key);
		if (!e) { problems.push(key + ': unknown'); return; }
		if (e.engine === 'hy' || e.engine === 'sp') problems.push(key + ': engine-specific');
		var v = p.options[key];
		if (e.kind === 'range' && !(v >= e.min && v <= e.max)) problems.push(key + '=' + v);
		if (e.kind === 'enum' && e.values.indexOf(v) < 0) problems.push(key + '=' + v);
	});
	check.ok(id + ' preset names only registry entries, in range', problems.length === 0,
		problems.join(',') || Object.keys(p.options).join(', ') || 'no options');
});
check.ok('S4 arms the unload tool and the others do not',
	PCSCEN.preset('S4').tool === 'unload' &&
	PCSCEN.ids.filter(function (s) { return s !== 'S4'; }).every(function (s) {
		return PCSCEN.preset(s).tool === null;
	}));
check.ok('every scenario defines at least one gate',
	PCSCEN.ids.every(function (s) { return PCSCEN.defs[s].gates.length > 0; }),
	PCSCEN.ids.map(function (s) { return s + ':' + PCSCEN.defs[s].gates.length; }).join(' '));

check.done();
