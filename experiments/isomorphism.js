// isomorphism.js — 0.2.0 M5: the numerical isomorphism against the reference project
// (planet-geotectonics). The one place this repository's numerics are a verbatim
// extraction of the reference's is the deposit catalogue's deterministic core
// (js/deposit-core.js, extracted from the counterpart's js/deposits.js). The claim this
// harness proves is a three-link chain:
//
//   1. the checked-in fixture (experiments/fixtures/deposits-draws.json) records the
//      counterpart file it came from -- repo, commit, sha256 -- and that commit is the
//      one port/PORT.json pins;
//   2. LIVE, when an upstream tree is available: the fixture regenerates from the
//      counterpart's own code, at the pinned commit, byte-identical (the generator is
//      experiments/make-deposits-fixture.js; the sha256 of the upstream file is checked
//      beside it);
//   3. the local extraction reproduces the counterpart's numbers on every fixture
//      vector -- that replay is experiments/deposits.js section A, run here as a child
//      and required to pass (no second implementation of the replay).
//
//   node experiments/isomorphism.js [path-to-planet-geotectonics]
//
// The upstream path defaults to $UPSTREAM or /tmp/up. Without a tree the live link is
// reported SKIP with the reason: the checked-in fixture is then the pinned statement, and
// link 3 still proves the local core against it. Nothing here touches the network.
'use strict';
var cp = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

var root = path.join(__dirname, '..');
var L = require('./lib.js');
var check = L.check;
var FIXTURE = require('./fixtures/deposits-draws.json');
var PORT = require('../port/PORT.json');

var up = process.argv[2] || process.env.UPSTREAM || '/tmp/up';
var upFile = path.join(up, 'js', 'deposits.js');
var haveUp = fs.existsSync(upFile);

check.section('A. the fixture is pinned to the manifest\'s upstream');
check.ok('the fixture names the counterpart file and the pinned commit',
	FIXTURE.provenance.file === 'js/deposits.js' &&
	FIXTURE.provenance.commit === PORT.upstream.commit.slice(0, FIXTURE.provenance.commit.length) &&
	/^[0-9a-f]{64}$/.test(FIXTURE.provenance.sha256),
	FIXTURE.provenance.file + ' @ ' + FIXTURE.provenance.commit + ' (manifest ' + PORT.upstream.repo +
	' @ ' + PORT.upstream.commit + ')');
check.ok('the manifest pins the same commit for the shared files',
	PORT.upstream.commit.indexOf(FIXTURE.provenance.commit) === 0, PORT.upstream.commit);
var sharedOk = 0;
PORT.files.forEach(function (f) {
	var buf = fs.readFileSync(path.join(root, f.path));
	check.ok('the shared file ' + f.path + ' is byte-identical with the manifest hash',
		crypto.createHash('sha256').update(buf).digest('hex') === f.sha256);
	sharedOk++;
});
check.ok('every shared-identical file matches its manifest sha256', sharedOk === PORT.files.length,
	sharedOk + '/' + PORT.files.length + ' files');

check.section('B. the live regeneration from the counterpart\'s own code');
if (!haveUp) {
	check.info('SKIP the live link: no upstream tree at ' + up +
		' (set $UPSTREAM or pass the path); the checked-in fixture is the pinned statement');
} else {
	var src = fs.readFileSync(upFile);
	var sha = crypto.createHash('sha256').update(src).digest('hex');
	check.ok('the upstream file matches the sha256 the fixture records', sha === FIXTURE.provenance.sha256,
		sha.slice(0, 12) + '…');
	var commit = 'unknown';
	try {
		commit = cp.execSync('git -C ' + JSON.stringify(up) + ' rev-parse --short HEAD',
			{ encoding: 'utf8' }).trim();
	} catch (e) { /* a source tarball has no git: the sha256 is the provenance that matters */ }
	check.ok('the upstream tree is checked out at the pinned commit',
		commit === FIXTURE.provenance.commit, commit);
	var tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pgt-iso-')), 'deposits-draws.json');
	cp.execFileSync(process.execPath,
		[path.join(__dirname, 'make-deposits-fixture.js'), up, tmp],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	var regen = fs.readFileSync(tmp, 'utf8');
	var checkedIn = fs.readFileSync(path.join(root, 'experiments', 'fixtures', 'deposits-draws.json'), 'utf8');
	check.ok('the fixture regenerates from the counterpart byte-identical', regen === checkedIn,
		regen.length + ' bytes, sha256 ' + crypto.createHash('sha256').update(regen).digest('hex').slice(0, 12) + '…');
	fs.unlinkSync(tmp);
}

check.section('C. the local extraction reproduces the counterpart\'s numbers');
var r = cp.spawnSync(process.execPath, [path.join(__dirname, 'deposits.js')], { encoding: 'utf8' });
var m = /ALL PASS \((\d+) checks\)/.exec(r.stdout || '');
check.ok('experiments/deposits.js replays the fixture through js/deposit-core.js',
	r.status === 0 && !!m, m ? m[0] : 'exit ' + r.status);
var failM = /(\d+) \/ \d+ FAILURES/.exec(r.stdout || '');
check.ok('the replay has no failures', !failM, failM ? failM[0] : 'none');

check.done();
