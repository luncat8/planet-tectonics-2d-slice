'use strict';
// M3 log-plot extractor. Reads experiments/logs/0.3.2-M3-*.json (+ their .txt twins) and
// writes experiments/logs/m3-plot-data.json for m3-log-plot.html, and prints the inventory
// verdict the plot's first panel shows: bytes, byte-identical twins, same-trajectory re-runs.
//
// Run: node experiments/m3-log-plot.js
var fs = require('fs'), path = require('path'), crypto = require('crypto');

var LOGS = path.join(__dirname, 'logs');
var names = fs.readdirSync(LOGS).filter(function (f) { return /^0\.3\.2-M3-.*\.(json|txt)$/.test(f); }).sort();

function md5(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12); }

var raw = [], byMd5 = {}, byFp = {};
names.forEach(function (f) {
	var file = path.join(LOGS, f), full = path.join(LOGS, f.replace(/\.txt$/, '.json'));
	var d = null;
	if (/\.json$/.test(f)) d = JSON.parse(fs.readFileSync(full, 'utf8'));
	var e = { name: f, bytes: fs.statSync(file).size, ext: path.extname(f), md5: md5(file),
		fp: d ? String(d.fingerprint) : null, d: d };
	raw.push(e);
	(byMd5[e.md5] = byMd5[e.md5] || []).push(e);
	if (d) (byFp[e.fp] = byFp[e.fp] || []).push(e);
});

function rerunWhy(name) {
	return /-timed-/.test(name) ? 'serial timing re-run'
		: /-final/.test(name) ? 'assert re-run'
		: /-comp/.test(name) ? 'composition re-run'
		: /-watch/.test(name) ? 'pre-fix observer re-run'
		: 're-run, same trajectory';
}

// the richest file per trajectory: watch data if any, else events
var richByFp = {}, sortedByFp = {};
Object.keys(byFp).forEach(function (fp) {
	var g = byFp[fp].slice().sort(function (a, b) {
		var wa = a.d.bands ? 2 : 0, wb = b.d.bands ? 2 : 0;
		var ea = a.d.events && a.d.events.length && a.d.events[0].cW !== undefined ? 1 : 0;
		var eb = b.d.events && b.d.events.length && b.d.events[0].cW !== undefined ? 1 : 0;
		return (wb + eb) - (wa + ea) || (a.name < b.name ? -1 : 1);
	});
	richByFp[fp] = g[0];
	sortedByFp[fp] = g;
});

// role: the richest json of a trajectory is what a log policy keeps; every byte-identical
// copy is a twin (the harness writes one file, the worklog re-ran each command under a
// second name); every other file of the same trajectory is a re-run labelled by its purpose
var role = {};
Object.keys(byFp).forEach(function (fp) {
	byFp[fp].forEach(function (e) {
		if (e === richByFp[fp]) { role[e.name] = { role: 'kept', note: 'richest json of fingerprint ' + fp }; return; }
		if (e.ext === '.txt' && byMd5[e.md5].length > 1) {
			role[e.name] = { role: 'twin', note: 'byte-identical to ' + byMd5[e.md5].filter(function (o) { return o !== e; })[0].name };
			return;
		}
		role[e.name] = { role: 'rerun', note: rerunWhy(e.name) + ', fingerprint ' + fp };
	});
});
raw.forEach(function (e) {
	if (role[e.name]) return;
	var twin = byMd5[e.md5].filter(function (o) { return o !== e; })[0];
	role[e.name] = { role: 'twin', note: 'byte-identical to ' + (twin ? twin.name : '?') };
});

function cellKey(d) {
	return [d.kind, d.value, d.scope || '', d.seed, d.kyr, d.myr,
		d.depletion ? d.depletion.dpart : 0, d.depletion ? d.depletion.cap : 0].join(' ');
}
function cellLabel(d) {
	var kind = d.kind === 'baseline' ? 'baseline' : 'subgrid ' + d.value + ' (' + d.scope + ')';
	var s = kind + ', ' + d.myr + ' Myr, seed ' + d.seed + ', ' + d.kyr + ' kyr';
	if (d.depletion && d.depletion.dpart) s += ' +dpart ' + d.depletion.dpart;
	if (d.depletion && d.depletion.cap) s += ' +cap ' + d.depletion.cap;
	return s;
}

// one cell per trajectory; the serial timing the worklog quotes is the timed re-run's,
// when the cell has one
var cells = [];
Object.keys(byFp).forEach(function (fp) {
	var timed = byFp[fp].filter(function (e) { return /-timed-/.test(e.name); })[0];
	var d = richByFp[fp].d, ms = timed ? timed.d.msFrame : d.msFrame;
	cells.push({ key: cellKey(d), label: cellLabel(d), kind: d.kind, value: d.value, scope: d.scope,
		seed: d.seed, kyr: d.kyr, myr: d.myr, frames: d.frames, fp: +d.fingerprint,
		msFrame: ms, timed: !!timed, depTx: d.depTx, depMelt: d.depMelt, mantleRoutes: d.mantleRoutes,
		census: d.census, depletion: d.depletion, gates: d.gates,
		hottest: d.hottest, minT: d.minT, maxT: d.maxT,
		watch: !!d.bands, eventN: d.events ? d.events.length : 0,
		files: sortedByFp[fp].map(function (e) { return e.name; }) });
});

var myrPerFrame = {};
cells.forEach(function (c) { myrPerFrame[c.key] = c.myr / c.frames; });

// cold-tail path and the mobile-melt face, downsampled; the full arrays are in the logs
var watch = {};
cells.forEach(function (c) {
	var d = richByFp[String(c.fp)].d;
	if (!d.bands) return;
	var stride = Math.max(1, Math.ceil(d.coldPath.length / 900));
	var cold = [], i;
	for (i = 0; i < d.coldPath.length; i += stride) {
		cold.push([+(d.coldPath[i].frame * myrPerFrame[c.key]).toFixed(4), +d.coldPath[i].T.toFixed(6)]);
	}
	var ex = (d.exSampleLog || []).map(function (s) {
		return [+(s.frame * myrPerFrame[c.key]).toFixed(4), +s.T.toFixed(6), +s.y.toFixed(2), +s.m.toFixed(3), +s.melt.toFixed(4)];
	});
	watch[c.key] = { cold: cold, coldMeta: { T: d.cold.T, frame: d.cold.frame, y: d.cold.y, m: d.cold.m, id: d.cold.id },
		bands: d.bands, excursions: d.excursions || [], exlog: ex, exSamples: d.exSamples || 0 };
});

// G5 transfer events: frame, position, temperature, the routing margin and the parcel
var events = {};
cells.forEach(function (c) {
	var g = byFp[String(c.fp)];
	var best = null;
	g.forEach(function (e) {
		if (!e.d.events || !e.d.events.length) return;
		var rich = e.d.events[0].cW !== undefined ? 1 : 0;
		if (!best || rich > best.rich || (rich === best.rich && e.d.events.length > best.d.events.length)) best = { d: e.d, rich: rich };
	});
	if (best) {
		var ev = { frame: [], x: [], y: [], T: [], margin: [], melt: [], cF: [], cW: [] };
		best.d.events.forEach(function (e) {
			ev.frame.push(e.frame);
			ev.x.push(+e.x.toFixed(2));
			ev.y.push(+e.y.toFixed(2));
			ev.T.push(+e.T.toFixed(6));
			ev.margin.push(+(e.field - e.solidus).toFixed(6));
			ev.melt.push(+e.melt.toFixed(4));
			ev.cF.push(e.cF === undefined ? 0 : e.cF);
			ev.cW.push(e.cW === undefined ? 0 : e.cW);
		});
		events[c.key] = ev;
	}
});

var bytes = raw.reduce(function (a, e) { return a + e.bytes; }, 0);
var jsonBytes = raw.filter(function (e) { return e.ext === '.json'; }).reduce(function (a, e) { return a + e.bytes; }, 0);
var keep = Object.keys(richByFp).map(function (fp) { return richByFp[fp]; });
var out = {
	meta: { generated: new Date().toISOString(), files: raw.length, bytes: bytes, jsonBytes: jsonBytes,
		txtBytes: bytes - jsonBytes, contents: Object.keys(byMd5).length, trajectories: Object.keys(byFp).length,
		phases: ['mantle', 'melt', 'air', 'dep'] },
	inventory: raw.map(function (e) {
		return { name: e.name, bytes: e.bytes, ext: e.ext, role: role[e.name].role, note: role[e.name].note };
	}).sort(function (a, b) { return b.bytes - a.bytes; }),
	cells: cells.sort(function (a, b) { return a.label < b.label ? -1 : 1; }),
	watch: watch, events: events
};
fs.writeFileSync(path.join(LOGS, 'm3-plot-data.json'), JSON.stringify(out));

// --- the printed verdict -------------------------------------------------------
var kept = keep;
function mb(n) { return (n / 1048576).toFixed(2) + ' MB'; }
console.log('M3 logs: ' + raw.length + ' files, ' + mb(bytes) + ' (' + mb(jsonBytes) + ' json, ' + mb(bytes - jsonBytes) + ' txt twins)');
console.log('  distinct trajectories ' + Object.keys(byFp).length + '   (fingerprint; md5 gives ' +
	Object.keys(byMd5).length + ' because every re-run re-stamps its own wall-clock msFrame)');
console.log('  distinct cells        ' + cells.length);
console.log('  byte-identical twins: ' + raw.filter(function (e) { return role[e.name].role === 'twin'; }).length +
	' files, ' + mb(raw.filter(function (e) { return role[e.name].role === 'twin'; }).reduce(function (a, e) { return a + e.bytes; }, 0)));
console.log('  same-trajectory re-runs: ' + raw.filter(function (e) { return role[e.name].role === 'rerun'; }).length +
	' files, ' + mb(raw.filter(function (e) { return role[e.name].role === 'rerun'; }).reduce(function (a, e) { return a + e.bytes; }, 0)));
console.log('  the richest json per trajectory: ' + mb(kept.reduce(function (a, e) { return a + e.bytes; }, 0)) +
	' (' + kept.length + ' files) — all signal the banks hold');
console.log('wrote logs/m3-plot-data.json (' + mb(fs.statSync(path.join(LOGS, 'm3-plot-data.json')).size) + ')');
