// port-check.js — the shared-identical drift gate (0.4.0-sync-plan.md §1.2, 0.4.2-plan.md
// §4 B2, 0.4.4-plan.md §5 M1). Every file in port/PORT.json must be byte-identical with the
// counterpart: the sha256 is asserted here, and a matching test asserts it on that side, so
// a byte that drifts on either side fails a harness instead of a review. Also asserted: LF
// endings (a CRLF byte is a drift byte) and purity (a shared file knows no grid, page, canvas
// or DOM — that is the only reason it can be the one file both sides read the same way).
//
// The manifest now carries two independently testable contracts: pgt-slice-pack-v2 (the cut)
// and pgt-core-log v2 (the observation returned from it). The core-log fixture deliberately
// names the pack fixture's own path and full-pack identities, so a bump that moves one and
// not the other fails here rather than in a pair run.
//
// Run: node experiments/port-check.js
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var lib = require('./lib.js'), check = lib.check;

var root = lib.root;
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'port', 'PORT.json'), 'utf8'));
var SP = require(path.join(root, 'port', 'slice-format.js'));
var CF = require(path.join(root, 'port', 'core-log-format.js'));
var FILES = [
	'port/slice-format.js',
	'port/fixtures/slice-pack-v2.json',
	'port/core-log-format.js',
	'port/fixtures/core-log-v2.json'
];

check.section('A. the manifest');
check.ok('the manifest is the v2 port manifest for the two shared contracts',
	manifest.format === 'pgt-port-manifest' && manifest.version === 2 &&
	manifest.contract === 'pgt-slice-pack-v2',
	manifest.format + ' v' + manifest.version + ' ' + manifest.contract);
var byRole = {};
(manifest.repositories || []).forEach(function (r) { byRole[r.role] = r; });
check.ok('the manifest pins both repository revisions (globe writer, section reader)',
	!!byRole['globe-writer'] && byRole['globe-writer'].repo === 'luncat8/planet-geotectonics' &&
	/^[0-9a-f]{40}$/.test(byRole['globe-writer'].commit) &&
	!!byRole['section-reader'] && byRole['section-reader'].repo === 'luncat8/planet-tectonics-2d-slice' &&
	/^[0-9a-f]{40}$/.test(byRole['section-reader'].commit),
	(manifest.repositories || []).map(function (r) { return r.role + ' ' + String(r.commit).slice(0, 7); }).join(', '));
check.ok('the file list is exactly the pack and the core log, each with its fixture',
	Array.isArray(manifest.files) && manifest.files.length === FILES.length &&
	manifest.files.map(function (e) { return e.path; }).join(' ') === FILES.join(' '),
	(manifest.files || []).map(function (e) { return e.path; }).join(' '));
check.ok('every manifest entry carries its sha256 and a one-line reason',
	(manifest.files || []).every(function (e) {
		return /^[0-9a-f]{64}$/.test(e.sha256) && typeof e.what === 'string' && e.what.length > 0;
	}), manifest.files.length + ' files');

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
	var bare = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
	var dom = ['document', 'window', 'navigator', 'localStorage', 'location', 'canvas'];
	var dirty = dom.filter(function (name) {
		return new RegExp('\\b' + name + '\\b').test(bare);
	});
	check.ok(entry.path + ': pure (no grid, page or DOM reference)', dirty.length === 0,
		dirty.length ? 'found: ' + dirty.join(', ') : 'no DOM globals');
	if (/\.js$/.test(entry.path)) {
		var mod = require(full);
		check.ok(entry.path + ': loads under node and exports one namespace',
			!!mod && typeof mod === 'object', Object.keys(mod).slice(0, 8).join(' '));
		if (/slice-format\.js$/.test(entry.path))
			check.ok(entry.path + ': it is the v2 pack codec this build reads',
				mod.FORMAT === 'pgt-slice-pack' && mod.VERSION === 2, mod.FORMAT + ' v' + mod.VERSION);
		else
			check.ok(entry.path + ': it is the v2 core-log codec this build reads',
				mod.FORMAT === 'pgt-core-log' && mod.VERSION === 2 &&
				mod.LITHOLOGY_SCHEMA === 'section-lith-1', mod.FORMAT + ' v' + mod.VERSION);
	} else {
		var doc = JSON.parse(src);
		if (/slice-pack-v2/.test(entry.path))
			check.ok(entry.path + ': parses as the pack contract fixture',
				!!doc && doc.format === 'pgt-slice-pack' && doc.version === 2,
				doc.format + ' v' + doc.version + ', n=' + doc.n);
		else
			check.ok(entry.path + ': parses as the core-log contract fixture',
				!!doc && doc.format === 'pgt-core-log' && doc.version === 2,
				doc.format + ' v' + doc.version + ', ' + doc.records.length + ' records');
	}
});

check.section('B2. the pack fixture identities (the handoff readings, re-read not assumed)');
var fixtureText = fs.readFileSync(path.join(root, 'port', 'fixtures', 'slice-pack-v2.json'), 'utf8');
var fixture = null, decodeBad = '';
try { fixture = SP.decode(fixtureText); } catch (e) { decodeBad = e.message; }
check.ok('the fixture decodes through the shared codec', !!fixture, decodeBad || 'decoded');
if (fixture) {
	check.ok('the fixture\'s full checksum is its stored checksum (verify is empty)',
		SP.verify(fixture) === '' && SP.checksum(fixture) === fixture.checksum, fixture.checksum);
	check.ok('the fixture\'s path checksum is a 16-hex identity over its path',
		/^[0-9a-f]{16}$/.test(SP.pathChecksum(fixture.path)), SP.pathChecksum(fixture.path));
	var raw = JSON.parse(fixtureText);
	raw.source.built = '2099-01-01T00:00:00.000Z';
	check.ok('neither identity reads source.built (a rebuild is the same cut)',
		SP.checksum(raw) === fixture.checksum && SP.pathChecksum(raw.path) === SP.pathChecksum(fixture.path),
		SP.checksum(raw) + ' / ' + SP.pathChecksum(raw.path));
	check.ok('the canonical text is stable: encode(decode(text)) is the fixture minus its trailing newline',
		SP.encode(fixture) === fixtureText.replace(/\n$/, ''),
		SP.encode(fixture).length + ' of ' + fixtureText.length + ' chars');
}

check.section('B3. the two fixtures lock together (0.4.4 M1)');
var logText = fs.readFileSync(path.join(root, 'port', 'fixtures', 'core-log-v2.json'), 'utf8');
var logFixture = null, logBad = '';
try { logFixture = CF.parse(logText); } catch (e) { logBad = e.message; }
check.ok('the core-log fixture parses through the shared core-log codec', !!logFixture, logBad || 'parsed');
if (logFixture) {
	check.ok('its path identity is the pack fixture\'s path identity',
		logFixture.pathChecksum === SP.pathChecksum(fixture.path), logFixture.pathChecksum);
	check.ok('its full-pack identity is the pack fixture\'s checksum',
		logFixture.packChecksum === fixture.checksum, logFixture.packChecksum);
	check.ok('its arc is the pack fixture\'s cut length',
		logFixture.arcKm === SP.round(fixture.path.arcKm), logFixture.arcKm + ' km');
	check.ok('the canonical text is stable: encode(parse(text)) is the fixture minus its trailing newline',
		CF.encode(logFixture) === logText.replace(/\n$/, ''),
		CF.encode(logFixture).length + ' of ' + logText.length + ' chars');
	check.ok('the identity rule reads the fixture current against its own pack',
		CF.identity(logFixture, { pathChecksum: logFixture.pathChecksum,
			packChecksum: logFixture.packChecksum, arcKm: logFixture.arcKm }).status === 'current');
	check.ok('the codec names the agreed vocabulary',
		CF.LITH.join('/') === 'sed/fel/maf/tephra/lava/sill' &&
		CF.FLAGS.join('/') === 'wet/ore/unconf/intr' &&
		CF.FLAG.wet === 1 && CF.FLAG.intr === 8, CF.LITH.join('/'));
	var codecSrc = fs.readFileSync(path.join(root, 'port', 'core-log-format.js'), 'utf8')
		.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
	check.ok('the core-log codec is self-contained: no slice-format reach (P3)',
		!/SlicePack|slice-format|require\s*\(/.test(codecSrc.replace(/module\.exports\s*=\s*CoreLogFormat;/, '')),
		'own hash, own quantisation, own key order');
}

check.section('C. the directory is the manifest');
var listed = manifest.files.map(function (f) { return f.path; }).sort();
var onDisk = [];
(function walk(dir, rel) {
	fs.readdirSync(dir).forEach(function (f) {
		var full = path.join(dir, f), r = rel ? rel + '/' + f : f;
		if (fs.statSync(full).isDirectory()) walk(full, r);
		else if (/\.(js|json)$/.test(f) && r !== 'PORT.json') onDisk.push('port/' + r);
	});
})(path.join(root, 'port'), '');
onDisk.sort();
check.ok('every shared file on disk is in the manifest (nothing unlisted, nothing stale)',
	listed.length === onDisk.length && onDisk.every(function (f) { return listed.indexOf(f) >= 0; }),
	onDisk.join(' '));

check.done();
