// log-hygiene.js — the experiments/logs/ verdict: what a checker reads, what a report quotes,
// what is one more bank of a world that already has its survivor, and what is scratch.
// The AGENTS.md §experiments/logs policy as one command instead of a manual md5 + grep pass,
// and the whole-directory generalization of the inventory verdict m3-log-plot.js prints for
// 0.3.2-M3-* only. It changes nothing without --apply, and --apply deletes only the set the
// policy decides without a judgement call: a file no harness opens, no document names, and
// whose whole content another kept file already carries (same bytes, or same world — a world is
// its fingerprint — with no recorded field the keepers of that world lack).
//
// Run: node experiments/log-hygiene.js               the verdict, nothing written
//      node experiments/log-hygiene.js --apply       prune the `go` set, print the identity map
//      node experiments/log-hygiene.js --why NAME    every reason behind one file's verdict
//      node experiments/log-hygiene.js --worlds      the same-world banks and what each records
//      node experiments/log-hygiene.js --review      the judgement-call list in full
//      node experiments/log-hygiene.js --compact     the trace-bank summary verdict
//      node experiments/log-hygiene.js --compact --apply   rewrite the candidates
//
// --compact is the one place the tool changes a bank instead of deleting it. A trace bank's
// `rows` are per-frame samples, and a 20 MB bank is mostly the same handful of ids held and
// heated frame after frame. The quantities those rows are read for are kept: every per-id
// scalar (first/last, maxT/maxGap with their frames and depth, capped/withheld, routed/held,
// delivered/deliveredFrame), the 200-frame stride spine (why 0), every delivery (why 5),
// phase change (6) and last frame (7), and the `caps` array. What goes is why 1 (at/above
// solidus), why 2 (molten) and why 4 (held) -- repeated per-frame readings whose maxima and
// counts are already scalars -- and why 3 when caps[] is not full, because a cap row is a
// duplicate of a caps[] record. A bank under 4 MB is left alone: M5's checker reads raw
// consecutive-frame rows to find the repair's relocations, and compacting that would be a
// re-measurement, not hygiene. A compacted bank says so in `trace.history[*].compacted`.
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');

var ROOT = path.join(__dirname, '..'), LOGS = path.join(__dirname, 'logs');
var APPLY = process.argv.indexOf('--apply') >= 0;
var WHY = process.argv.indexOf('--why') >= 0 ? process.argv[process.argv.indexOf('--why') + 1] : null;
var SHOW_REVIEW = process.argv.indexOf('--review') >= 0;
var COMPACT = process.argv.indexOf('--compact') >= 0;

function walk(dir, base) {
	var out = [];
	fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
		var full = path.join(dir, e.name), rel = base ? base + '/' + e.name : e.name;
		if (e.isDirectory()) out = out.concat(walk(full, rel));
		else out.push({ rel: rel, base: e.name, dir: base || '', full: full, bytes: fs.statSync(full).size });
	});
	return out;
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); }
function mb(n) { return (n / 1048576).toFixed(2) + ' MB'; }
function kb(n) { return (n / 1024).toFixed(0) + 'K'; }

// --- the one transform: a trace bank's per-frame rows ----------------------------------------
// Every quantity the rows are read for is kept (see the header). The drop rule is a property
// of the row's `why`, not of a file's name, so a new trace bank is compacted the same way; the
// 4 MB floor is what keeps the M5 banks -- whose checker reads consecutive-frame rows for the
// repair's relocations -- untouched, and a bank that did not shrink is not rewritten.
var COMPACT_MIN = 4 * 1048576;
function compactTrace(d) {
	if (!d.trace || !Array.isArray(d.trace.history)) return null;
	var before = 0, after = 0, dropWhy = {};
	d.trace.history.forEach(function (h) {
		if (!Array.isArray(h.rows)) return;
		// caps[] holds every cap event unless it overflowed its own cap (4000): then the
		// why-3 rows past it are the only record of the rest
		var full = h.caps && h.capped > 0 && h.caps.length >= h.capped;
		var keep = [], dw = {};
		before += h.rows.length;
		h.rows.forEach(function (r) {
			if (r.why === 1 || r.why === 2 || r.why === 4 || (r.why === 3 && full)) {
				dw[r.why] = (dw[r.why] || 0) + 1;
				dropWhy[r.why] = (dropWhy[r.why] || 0) + 1;
				return;
			}
			keep.push(r);
		});
		if (!Object.keys(dw).length) return;
		after += keep.length;
		h.compacted = { rows: h.rows.length, kept: keep.length, dropped: dw,
			rule: 'why 1/2/4 are per-frame readings whose maxima and counts are the id scalars; why 3 duplicates caps[] when not full' };
		h.rows = keep;
	});
	if (before === after) return null;
	return { before: before, after: after, dropWhy: dropWhy };
}
if (COMPACT) {
	var cBefore = 0, cAfter = 0, rBefore = 0, rAfter = 0, rewrote = 0, traces = 0;
	var cands = walk(LOGS, '').filter(function (f) { return /\.json$/.test(f.base) && f.bytes > COMPACT_MIN; });
	cands.forEach(function (f) {
		var d, c, text;
		try { d = JSON.parse(fs.readFileSync(f.full, 'utf8')); } catch (e) { return; }
		c = compactTrace(d);
		if (!c) return;
		traces++;
		text = JSON.stringify(d, null, '\t') + '\n';
		cBefore += f.bytes; cAfter += Buffer.byteLength(text); rBefore += c.before; rAfter += c.after;
		console.log('  ' + f.base + '  ' + mb(f.bytes) + ' -> ' + mb(Buffer.byteLength(text))
			+ '   rows ' + c.before + ' -> ' + c.after + '   dropped ' + Object.keys(c.dropWhy).map(function (w) {
				return 'why ' + w + ':' + c.dropWhy[w];
			}).join(', '));
		if (APPLY) { fs.writeFileSync(f.full, text); rewrote++; }
	});
	console.log('trace compaction: ' + traces + ' trace banks over ' + mb(COMPACT_MIN) + ', ' + mb(cBefore) + ' -> '
		+ mb(cAfter) + ', rows ' + rBefore + ' -> ' + rAfter + (APPLY ? '; rewrote ' + rewrote : '; dry run, pass --apply to rewrite'));
	process.exit(0);
}

// --- the corpus: every file under logs/, its bytes, its content hash, its world -------------
var files = walk(LOGS, '');
files.forEach(function (f) { f.hash = sha(f.full); });
var byHash = {};
files.forEach(function (f) { (byHash[f.hash] = byHash[f.hash] || []).push(f); });

// --- what a harness reads -------------------------------------------------------------------
// Three ways a reader names a log, all of them in this tree: a whole path in a literal
// (pt-heat-tail-trace.js), a directory prefix composed with a call-site literal
// (pt-heat-tail-check.js's read3('timed-subgrid1dep-watch')), a readdir filter (m3-log-plot.js)
// and a name built out of table legs (k5-*-table.js's tag/kind/seed/rate). The last has no
// single literal to find, so it is answered by coverage: how much of a basename the file's own
// literals spell, in order, allowing the variable slots between them.
function codeFiles() {
	var out = [];
	['js', 'experiments', 'port', 'tools'].forEach(function (d) {
		var full = path.join(ROOT, d);
		if (fs.existsSync(full)) walk(full, d).forEach(function (f) { if (/\.(js|py)$/.test(f.base)) out.push(f); });
	});
	fs.readdirSync(ROOT).forEach(function (f) { if (/\.html$/.test(f)) out.push({ rel: f, base: f, full: path.join(ROOT, f) }); });
	// this file lists names to classify them, not to read them: its own literals are not evidence
	return out.filter(function (f) { return f.base !== 'log-hygiene.js'; });
}
function literalsOf(text) {
	var out = [], m, re = /'([^'\\\n]*)'|"([^"\\\n]*)"/g;
	while ((m = re.exec(text))) out.push(m[1] === undefined ? m[2] : m[1]);
	return out;
}
// fraction of `name` the literal set spells left to right, one char at a time for the slots.
// Both sides are folded first: a table leg's seed and rate are numbers in the source, not
// literals, so a digit run counts as one slot the literal set carries too.
var SLOT = '\u0001';
function fold(s) { return s.replace(/\d+/g, SLOT); }
function coverage(name, lits) {
	var i = 0, hit = 0;
	while (i < name.length) {
		var best = 0;
		for (var k = 0; k < lits.length; k++) {
			var l = lits[k];
			if (l.length > best && l.length <= name.length - i && name.indexOf(l, i) === i) best = l.length;
		}
		if (!best) { i++; continue; }
		hit += best; i += best;
	}
	return hit / name.length;
}

var onDisk = {};
files.forEach(function (f) { onDisk[f.base] = f; });
var harness = {};   // basename -> [reason]
function mark(base, reason) { if (onDisk[base]) (harness[base] = harness[base] || []).push(reason); }

// a reader may open its logs through a lib (k5-hold-table.js names the files, k5-table-lib.js
// reads them), so the read test looks one require deep rather than at the file alone
var textCache = {};
function textOf(p) {
	if (textCache[p] === undefined) textCache[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
	return textCache[p];
}
function readsLogs(full) {
	var text = textOf(full), m, re = /require\('\.\/([^']+)'\)/g, seen = 0;
	if (/readFileSync|readdirSync|existsSync/.test(text)) return true;
	while ((m = re.exec(text)) && seen < 8) {
		seen++;
		if (/readFileSync|readdirSync|existsSync/.test(textOf(path.join(path.dirname(full), m[1])))) return true;
	}
	return false;
}

codeFiles().forEach(function (cf) {
	var text = textOf(cf.full), lits = literalsOf(text), reads = readsLogs(cf.full);
	lits.forEach(function (l) {
		if (l.length < 6) return;
		files.forEach(function (f) { if (l.indexOf(f.base) >= 0) mark(f.base, cf.rel + ' names it'); });
	});
	// prefix + call-site literal, resolved by whether the composition exists
	lits.forEach(function (p) {
		var m = /logs\/([A-Za-z0-9._-]+-)$/.exec(p);
		if (!m) return;
		lits.forEach(function (l) {
			if (!l || l === p || /[\s\/]/.test(l) || l.length < 3) return;
			['', '.json', '.txt'].forEach(function (x) { mark(m[1] + l + x, cf.rel + ' reads ' + m[1] + ' + ' + l + x); });
		});
	});
	if (!reads) return;
	// a readdir filter: every name it matches is a name the tool reads
	var rm, rre = /\/\^([^\/\n]+)\$\/[gim]*/g, scans = /readdirSync/.test(text);
	while (scans && (rm = rre.exec(text))) {
		var re;
		try { re = new RegExp('^' + rm[1] + '$'); } catch (e) { continue; }
		files.forEach(function (f) { if (re.test(f.base)) mark(f.base, cf.rel + ' scans it (readdir filter)'); });
	}
	// table-leg names: the literals spell most of the basename, the legs' own variables the rest.
	// The era prefix has to be one of them, so a file this reader cannot address is not claimed.
	// Only for readers that do not spell their directory as a literal prefix (those are resolved
	// exactly above) and that open files rather than only write them, so a harness that banks a
	// cell is not read as a claim on every log its own report strings happen to spell.
	if (!reads || !/LOGS|logs/.test(text)) return;
	if (/'logs\/[A-Za-z0-9._-]+-'|"logs\/[A-Za-z0-9._-]+-"/.test(text)) return;
	var spell = lits.filter(function (l) { return l && l.length >= 2 && !/[\s\/]/.test(l); }).map(fold).concat(SLOT);
	var version = SLOT + '.' + SLOT + '.' + SLOT + '-';
	var eras = spell.filter(function (l) { return l.indexOf(version) === 0; });
	if (spell.length < 4 || !eras.length) return;
	files.forEach(function (f) {
		if (harness[f.base]) return;
		var name = fold(f.base);
		if (!eras.some(function (e) { return name.indexOf(e) === 0; })) return;
		if (coverage(name, spell) >= 0.9) mark(f.base, cf.rel + ' composes its name out of table legs');
	});
});

// --- what a document names ------------------------------------------------------------------
var docs = [];
fs.readdirSync(ROOT).forEach(function (f) { if (/\.md$/.test(f)) docs.push(path.join(ROOT, f)); });
walk(path.join(ROOT, 'archive'), 'archive').forEach(function (f) { if (/\.md$/.test(f.base)) docs.push(f.full); });
var docText = docs.map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n');
var quoted = {};
files.forEach(function (f) { if (docText.indexOf(f.base) >= 0) (quoted[f.base] = quoted[f.base] || []).push('named in a document'); });
// the ellipsis form a worklog uses for a family (`...-drift.txt`) is a suffix, not a name
var em, ere = /\.\.\.([A-Za-z0-9._-]{4,}\.(?:txt|json))/g;
var suffixes = [];
while ((em = ere.exec(docText))) suffixes.push(em[1]);
files.forEach(function (f) {
	suffixes.forEach(function (s) {
		if (f.base.length > s.length && f.base.slice(-s.length) === s) (quoted[f.base] = quoted[f.base] || []).push('cited as ...' + s);
	});
});
// and the glob form a worklog uses for a whole pass (`experiments/logs/0.3.0-p3.4-*.txt`,
// `0.3.2-tail-*`), which names every file of a milestone's run without naming one
var gm, gre = /(?:logs\/|`)(0\.\d+\.\d+[A-Za-z0-9._{},?/*-]*[*{][A-Za-z0-9._{},?/*-]*)/g, globs = [];
while ((gm = gre.exec(docText))) globs.push(gm[1]);
function globRe(g) {
	var src = g.replace(/[.+^$()|[\]\\]/g, '\\$&')
		.replace(/\{([^}]*)\}/g, function (all, list) { return '(?:' + list.split(',').join('|') + ')'; })
		.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
	return new RegExp('^' + src + '$');
}
var globRes = globs.map(function (g) { return { g: g, re: globRe(g) }; });
files.forEach(function (f) {
	globRes.forEach(function (e) {
		if (e.re.test(f.rel) || e.re.test(f.base)) (quoted[f.base] = quoted[f.base] || []).push('cited by the glob ' + e.g);
	});
});

// --- worlds and what each bank records ------------------------------------------------------
// A world is its fingerprint, so the survivor of a world is the bank with the most recorded
// fields — and richness is the field paths, not the top-level key count: 0.3.2-M3-subgrid1dep-comp
// has fewer keys than the --watch bank of the same world and is the only one carrying the cF/cW
// per-event composition its report's percentile table is read from.
function fieldPaths(v, p, out) {
	if (Array.isArray(v)) {
		out[p + '[]'] = 1;
		for (var i = 0; i < v.length; i++) {
			var e = v[i];
			if (e && typeof e === 'object' && !Array.isArray(e)) Object.keys(e).forEach(function (k) { out[p + '[].' + k] = 1; });
			else if (Array.isArray(e)) out[p + '[][]'] = 1;
		}
		return;
	}
	if (v && typeof v === 'object') { Object.keys(v).forEach(function (k) { fieldPaths(v[k], p ? p + '.' + k : k, out); }); return; }
	out[p] = 1;
}
var worlds = {};
files.forEach(function (f) {
	if (!/\.json$/.test(f.base)) return;
	var d;
	try { d = JSON.parse(fs.readFileSync(f.full, 'utf8')); } catch (e) { return; }
	if (!d || typeof d !== 'object' || d.fingerprint === undefined) return;
	f.parsed = d;
	f.paths = {};
	fieldPaths(d, '', f.paths);
	f.msFrame = d.msFrame;
	(worlds[String(d.fingerprint)] = worlds[String(d.fingerprint)] || []).push(f);
});
function covers(keeperPaths, f) {
	var missing = [];
	Object.keys(f.paths).forEach(function (p) { if (!keeperPaths[p]) missing.push(p); });
	return missing;
}

// --- the verdict ----------------------------------------------------------------------------
// keep first (snapshot, harness, report); then the two sets the policy decides on its own:
// same bytes as a keeper, or same world as a keeper that records everything this one records.
// What is left is the judgement call the tool refuses to make: unreferenced and unique is
// scratch by the policy, except when its runner cannot reproduce it on the current tree
// (0.3.2-trace-latent.json), and only a reader knows which of the two a file is.
files.forEach(function (f) {
	f.reasons = [];
	if (f.dir) { f.verdict = 'keep'; f.why = 'frozen snapshot directory ' + f.dir + '/ stays whole'; return; }
	if (harness[f.base]) { f.verdict = 'keep'; f.why = 'a harness reads it: ' + harness[f.base][0]; f.reasons = harness[f.base]; return; }
	if (quoted[f.base]) { f.verdict = 'keep'; f.why = 'a document names it'; f.reasons = quoted[f.base]; return; }
	f.verdict = 'open';
});
// one content per directory: with no keeper in the group the earliest name survives, so the
// series still shows where a behaviour first appeared
Object.keys(byHash).forEach(function (h) {
	var g = byHash[h];
	if (g.length < 2) return;
	var kept = g.filter(function (f) { return f.verdict === 'keep'; });
	var survivor = kept[0] || g.slice().sort(function (a, b) { return a.base < b.base ? -1 : 1; })[0];
	if (!survivor.verdict || survivor.verdict === 'open') { survivor.verdict = 'keep'; survivor.why = 'the only content of its kind kept under its earliest name'; }
	g.forEach(function (f) {
		if (f === survivor || f.verdict === 'keep') return;
		f.verdict = 'go'; f.why = 'byte-identical to ' + survivor.rel; f.mapTo = survivor.rel;
	});
});
Object.keys(worlds).forEach(function (fp) {
	var g = worlds[fp], kept = g.filter(function (f) { return f.verdict === 'keep'; });
	if (!kept.length) return;
	var keeperPaths = {};
	kept.forEach(function (k) { Object.keys(k.paths).forEach(function (p) { keeperPaths[p] = 1; }); });
	g.forEach(function (f) {
		if (f.verdict === 'keep') return;
		var missing = covers(keeperPaths, f);
		if (missing.length) {
			f.verdict = 'review';
			f.why = 'one more bank of world ' + fp + ' and it records what its keepers do not: ' + missing.slice(0, 4).join(', ')
				+ (missing.length > 4 ? ' +' + (missing.length - 4) : '');
			return;
		}
		var rich = kept.slice().sort(function (a, b) { return Object.keys(b.paths).length - Object.keys(a.paths).length || b.bytes - a.bytes; })[0];
		f.verdict = 'go';
		f.why = 'world ' + fp + ' already keeps ' + rich.rel + ', which records every field this bank records';
		f.mapTo = rich.rel;
	});
});
// The older .txt era is one file per run and no document names most of them: where two runs
// differ, the difference is the history (gate numbers, fingerprints, probe verdicts), so
// distinct content stays. The one thing that is not history is the wall clock — a re-run that
// differs from a kept run *only* in its timings is scratch — so the fold below blanks the
// numbers a time unit follows and nothing else: a fingerprint, a gate or a count still
// separates two runs, and only `0.340 ms per pass` / `total 55.6 s` / `17.084 ms/frame` do not.
function timeFold(text) {
	return text.replace(/(\d+(?:\.\d+)?(?:e[-+]?\d+)?)\s*(ms|s|sec|secs|seconds|min|mins|h)\b/gi, '# $2');
}
var byShape = {};
files.forEach(function (f) {
	if (/\.json$/.test(f.base) || f.bytes > 2097152) return;
	f.shape = crypto.createHash('sha256').update(timeFold(fs.readFileSync(f.full, 'utf8'))).digest('hex').slice(0, 16);
	(byShape[f.shape] = byShape[f.shape] || []).push(f);
});
// fixed before the pass below, so the verdict does not depend on the order files come in
var shapeKeeper = {};
Object.keys(byShape).forEach(function (s) {
	var g = byShape[s], k = g.filter(function (f) { return f.verdict === 'keep'; })[0];
	shapeKeeper[s] = k || g.slice().sort(function (a, b) { return a.rel < b.rel ? -1 : 1; })[0];
});
files.forEach(function (f) {
	if (f.verdict !== 'open') return;
	var keeper = f.shape ? shapeKeeper[f.shape] : null;
	if (keeper && keeper !== f) {
		f.verdict = 'go';
		f.why = 'differs from ' + keeper.rel + ' only in its wall clock, and a wall-clock-only re-run is scratch';
		f.mapTo = keeper.rel;
		return;
	}
	if (keeper === f && byShape[f.shape].length > 1) {
		f.verdict = 'keep';
		f.why = 'the earliest of ' + byShape[f.shape].length + ' runs that differ only in their wall clock';
		return;
	}
	if (!/\.json$/.test(f.base)) { f.verdict = 'keep'; f.why = 'a run of its own: distinct content, and the difference between runs is the history'; return; }
	f.verdict = 'review';
	f.why = f.parsed ? 'an unreferenced bank of world ' + f.parsed.fingerprint + ': scratch unless its runner cannot reproduce it on this tree'
		: 'unreferenced json no harness parses and no document names';
});
// The one lever the policy itself holds: a file kept because a document *names* it (a worklog's
// command line) while a keeper of the same world already records every field it records, or a
// keeper holds its exact bytes. The policy keeps it ("what a document names"), so this is
// reported, not pruned: it is what letting the identity map stand in for the name would reclaim.
files.forEach(function (f) {
	if (f.verdict !== 'keep' || harness[f.base] || !quoted[f.base]) return;
	var twin = byHash[f.hash].filter(function (o) { return o !== f && o.verdict === 'keep'; })[0];
	var world = f.parsed ? (worlds[String(f.parsed.fingerprint)] || []).filter(function (o) {
		return o !== f && o.verdict === 'keep' && !covers(o.paths, f).length;
	})[0] : null;
	if (!twin && !world) return;
	f.weak = twin ? twin.rel : world.rel;
});

// --- the report -----------------------------------------------------------------------------
function sel(v) { return files.filter(function (f) { return f.verdict === v; }); }
function sum(list) { return list.reduce(function (a, f) { return a + f.bytes; }, 0); }
var keep = sel('keep'), go = sel('go'), review = sel('review');

// what the directory is made of: the field classes the banks spend their bytes on
var fieldBytes = {}, bankBytes = 0;
files.forEach(function (f) {
	if (!f.parsed) return;
	bankBytes += f.bytes;
	Object.keys(f.parsed).forEach(function (k) {
		var v = f.parsed[k];
		fieldBytes[k] = (fieldBytes[k] || 0) + (Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v).length + 2 : 16);
	});
});
var topFields = Object.keys(fieldBytes).sort(function (a, b) { return fieldBytes[b] - fieldBytes[a]; }).slice(0, 6);

if (WHY) {
	var f = files.filter(function (x) { return x.rel === WHY || x.base === WHY; })[0];
	if (!f) { console.log('no such file: ' + WHY); process.exit(1); }
	console.log('\n' + f.rel + '  ' + kb(f.bytes) + '  hash ' + f.hash
		+ (f.parsed ? '  world ' + f.parsed.fingerprint : '') + '\n  verdict: ' + f.verdict + ' — ' + f.why);
	(f.reasons || []).forEach(function (r) { console.log('  · ' + r); });
	var dupes = byHash[f.hash].filter(function (o) { return o !== f; });
	if (dupes.length) console.log('  byte-identical to: ' + dupes.map(function (o) { return o.rel; }).join(', '));
	if (f.parsed) {
		(worlds[String(f.parsed.fingerprint)] || []).filter(function (o) { return o !== f; }).forEach(function (o) {
			console.log('  same world: ' + o.rel + ' (' + kb(o.bytes) + ', ' + o.verdict + '), missing from its keepers: '
				+ (covers(o.paths, f).length || 'nothing'));
		});
	}
	process.exit(0);
}

console.log('experiments/logs/: ' + files.length + ' files, ' + mb(sum(files)));
console.log('  keep    ' + String(keep.length).padStart(4) + ' files  ' + mb(sum(keep)) + '   a harness reads it, a document names it, or it is the survivor of its content/world');
console.log('  go      ' + String(go.length).padStart(4) + ' files  ' + mb(sum(go)) + '   redundant under the policy, no judgement call');
console.log('  review  ' + String(review.length).padStart(4) + ' files  ' + mb(sum(review)) + '   unreferenced; scratch or non-regenerable is a reader\'s call');
console.log('  of the ' + mb(bankBytes) + ' in json banks, the field classes are: '
	+ topFields.map(function (k) { return k + ' ' + mb(fieldBytes[k]); }).join(', '));
console.log('  worlds (fingerprints) ' + Object.keys(worlds).length + ' over '
	+ files.filter(function (f) { return f.parsed; }).length + ' banks');
var weak = files.filter(function (f) { return f.weak; });
if (weak.length) {
	console.log('  kept only because a document names them, while a keeper already carries their content: '
		+ weak.length + ' files, ' + mb(sum(weak)) + ' -- reclaimable only by letting the identity map');
	console.log('  stand in for the name (a policy call, not this tool\'s): '
		+ weak.sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, 6)
			.map(function (f) { return f.rel + ' -> ' + f.weak; }).join(', '));
}

if (process.argv.indexOf('--worlds') >= 0) {
	// the "one bank per world" decision data: a world is its fingerprint, its survivor is the
	// bank with the most recorded fields, and a bank that records a field its world's richest
	// lacks is not a duplicate of it -- that is what keeps 0.3.2-M3-subgrid1dep-comp beside the
	// --watch bank of the same world (only comp carries the cF/cW its percentile table reads).
	console.log('\n--- worlds with more than one bank ---');
	Object.keys(worlds).forEach(function (fp) {
		var g = worlds[fp];
		if (g.length < 2) return;
		var rich = g.slice().sort(function (a, b) { return Object.keys(b.paths).length - Object.keys(a.paths).length || b.bytes - a.bytes; })[0];
		console.log('\nworld ' + fp + '  ' + g.length + ' banks  ' + mb(sum(g)) + '   richest: ' + rich.rel);
		g.sort(function (a, b) { return b.bytes - a.bytes; }).forEach(function (f) {
			var extra = covers(rich.paths, f);
			console.log('  ' + (f === rich ? 'rich  ' : '      ') + kb(f.bytes).padStart(6) + '  ' + f.rel
				+ '\n          ' + f.verdict + ': ' + f.why
				+ (extra.length ? '\n          records what the richest does not: ' + extra.join(', ') : ''));
		});
	});
}

if (go.length) {
	console.log('\n--- go: prune these, the identity map keeps every name resolvable ---');
	go.sort(function (a, b) { return b.bytes - a.bytes; }).forEach(function (f) {
		console.log('  ' + kb(f.bytes).padStart(6) + '  ' + f.rel + '\n              -> ' + f.mapTo + '  (' + f.why + ')');
	});
	console.log('\nmarkdown identity map for the worklog:\n');
	console.log('| deleted | kept | why |');
	console.log('| --- | --- | --- |');
	go.sort(function (a, b) { return a.rel < b.rel ? -1 : 1; }).forEach(function (f) {
		console.log('| `' + f.rel + '` | `' + f.mapTo + '` | ' + f.why + ' |');
	});
}
if (SHOW_REVIEW && review.length) {
	console.log('\n--- review: unreferenced, decide per file (scratch vs non-regenerable) ---');
	review.sort(function (a, b) { return b.bytes - a.bytes; }).forEach(function (f) {
		console.log('  ' + kb(f.bytes).padStart(6) + '  ' + f.rel + '\n              ' + f.why);
	});
}

if (!APPLY) {
	if (go.length) console.log('\nnothing written. --apply prunes the ' + go.length + ' go files (' + mb(sum(go)) + '); --why NAME explains one verdict.');
	process.exit(0);
}
go.forEach(function (f) { fs.unlinkSync(f.full); });
console.log('\npruned ' + go.length + ' files, ' + mb(sum(go)) + '; experiments/logs/ is now '
	+ files.length + ' - ' + go.length + ' = ' + (files.length - go.length) + ' files, ' + mb(sum(files) - sum(go)));
console.log('validate: node experiments/pt-heat-tail-check.js && node experiments/m3-log-plot.js'
	+ ' && node experiments/k5-variant-table.js && node experiments/k5-hold-table.js && node experiments/k5-donor-floor-table.js');
