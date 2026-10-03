// port-check.js — the shared-identical drift gate (0.4.0-sync-plan.md §1.2). Every file in
// port/PORT.json must be byte-identical with the counterpart: the sha256 is asserted here,
// and a matching test asserts it on that side, so a byte that drifts on either side fails
// a harness instead of a review. Also asserted: LF endings (a CRLF byte is a drift byte)
// and purity (a shared file knows no grid, page, canvas or DOM — that is the only reason
// it can be the one file both sides read the same way).
// Run: node experiments/port-check.js
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var lib = require('./lib.js'), check = lib.check;

var root = lib.root;
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'port', 'PORT.json'), 'utf8'));

check.section('A. the manifest');
check.ok('the manifest pins the upstream commit the plan was read against',
	manifest.upstream && manifest.upstream.commit === 'd909476', manifest.upstream && manifest.upstream.commit);
check.ok('the manifest lists at least the slice format', manifest.files.length >= 1, manifest.files.length + ' files');

check.section('B. the shared files');
manifest.files.forEach(function (entry) {
	var full = path.join(root, entry.path);
	var buf = fs.readFileSync(full);
	var sha = crypto.createHash('sha256').update(buf).digest('hex');
	check.ok(entry.path + ': the sha256 is the manifest\'s (byte-identical, both sides)',
		sha === entry.sha256, sha);
	check.ok(entry.path + ': LF endings (a CRLF byte is a drift byte)',
		buf.indexOf(0x0d) < 0, (buf.length / 1024).toFixed(1) + ' KB');
	var src = buf.toString('utf8');
	var dom = ['document', 'window', 'navigator', 'localStorage', 'location', 'canvas'];
	var dirty = dom.filter(function (name) {
		return new RegExp('\\b' + name + '\\b').test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
	});
	check.ok(entry.path + ': pure (no grid, page or DOM reference)', dirty.length === 0,
		dirty.length ? 'found: ' + dirty.join(', ') : 'no DOM globals');
	var mod = require(full);
	check.ok(entry.path + ': loads under node and exports one namespace',
		!!mod && typeof mod === 'object', Object.keys(mod).slice(0, 8).join(' '));
});

check.section('C. the directory is the manifest');
var listed = manifest.files.map(function (f) { return f.path; });
var onDisk = fs.readdirSync(path.join(root, 'port')).filter(function (f) {
	return f !== 'PORT.json' && /\.(js|json)$/.test(f);
}).map(function (f) { return 'port/' + f; });
check.ok('every shared file on disk is in the manifest (nothing unlisted, nothing stale)',
	listed.length === onDisk.length && onDisk.every(function (f) { return listed.indexOf(f) >= 0; }),
	onDisk.join(' '));

check.done();
