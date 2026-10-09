// upstream-drift.js — 0.2.0 M5 follow-up: what the counterpart did to the shared files
// since port/PORT.json pinned it. port-check.js and isomorphism.js prove the pin holds
// (at the pinned commit the shared files are byte-identical and the deposit fixture
// regenerates from the counterpart's own code); neither says whether the counterpart is
// still there. This harness reads the upstream tree and reports, per manifest file:
//
//   A. at the PINNED commit — the file exists and is byte-identical. This is the repo's
//      own promise, so a red here is a failure and the harness exits non-zero.
//   B. at the upstream HEAD — present or absent, identical or drifted, and how many
//      commits the pin is behind. Information, never a red: a pinned shared file is a
//      pinned shared file, and only 0.4.0's exchange decides what to do about drift.
//
//   node experiments/upstream-drift.js [path-to-planet-geotectonics]
//
// The path defaults to $UPSTREAM or /tmp/up. Without a tree every section reports SKIP:
// nothing here touches the network.
'use strict';
var cp = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var L = require('./lib.js');
var check = L.check;
var PORT = require('../port/PORT.json');

var up = process.argv[2] || process.env.UPSTREAM || '/tmp/up';
var haveUp = fs.existsSync(path.join(up, '.git')) || fs.existsSync(path.join(up, 'js'));

function at(commit, upPath) {
	try {
		var buf = cp.execFileSync('git', ['-C', up, 'show', commit + ':' + upPath],
			{ encoding: 'buffer', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
		return crypto.createHash('sha256').update(buf).digest('hex');
	} catch (e) {
		return null;   // absent at that commit — never an empty buffer, which is a real hash
	}
}
// the counterpart's branch tip, not whatever the checkout happens to sit on: a tree
// checked out at the pin would report zero drift against itself.
function tip() {
	var refs = ['origin/HEAD', 'origin/main', 'origin/master', 'HEAD'];
	for (var i = 0; i < refs.length; i++) {
		try {
			var sha = cp.execFileSync('git', ['-C', up, 'rev-parse', '--verify', refs[i] + '^{commit}'],
				{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
			return { ref: refs[i], sha: sha, short: sha.slice(0, 7) };
		} catch (e) { /* try the next */ }
	}
	return null;
}
function behind(tipSha) {
	try {
		return cp.execFileSync('git', ['-C', up, 'rev-list', '--count', PORT.upstream.commit + '..' + tipSha],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (e) { return '?'; }
}

if (!haveUp) {
	check.section('upstream tree');
	check.info('SKIP no upstream tree at ' + up +
		' (set $UPSTREAM or pass the path); port-check.js and isomorphism.js still prove the pin');
	check.done();
	return;
}

var pin = PORT.upstream.commit;
var tipC = tip();

check.section('A. the pin still holds against the counterpart\'s own history');
check.ok('the pinned commit is in the counterpart\'s history',
	cp.spawnSync('git', ['-C', up, 'cat-file', '-t', pin], { encoding: 'utf8' }).stdout.trim() === 'commit',
	pin + ' in ' + PORT.upstream.repo);
PORT.files.forEach(function (f) {
	if (!f.upstreamPath) {
		check.info(f.path + ' is authored here (' + (f.what || '').slice(0, 60) + '…)',
			'no upstreamPath: the counterpart has not adopted it yet');
		return;
	}
	var sha = at(pin, f.upstreamPath);
	check.ok(f.path + ' is byte-identical with ' + f.upstreamPath + ' at ' + pin,
		sha === f.sha256, (sha ? sha.slice(0, 12) + '…' : 'ABSENT upstream') + ' vs manifest ' + f.sha256.slice(0, 12) + '…');
});

check.section('B. what the counterpart has done since the pin');
if (!tipC) {
	check.info('SKIP no git in ' + up + ': a source tree has no branch tip to compare with',
		'section A already proves the pin');
	check.done();
	return;
}
var at_ = function (upPath) { return at(tipC.sha, upPath); };
check.info('the pin is ' + behind(tipC.sha) + ' commits behind the counterpart\'s tip (' + tipC.ref + ')',
	PORT.upstream.repo + ' ' + pin + ' → ' + tipC.short);
PORT.files.forEach(function (f) {
	if (!f.upstreamPath) return;
	var sha = at_(f.upstreamPath);
	var state = !sha ? 'ABSENT at the tip' : (sha === f.sha256 ? 'still byte-identical' : 'DRIFTED ' + sha.slice(0, 12) + '…');
	check.info(f.path + ' → ' + f.upstreamPath + ': ' + state, f.upstreamPath + ' @ ' + tipC.short);
});
var corePin = require('./fixtures/deposits-draws.json').provenance.sha256;
var coreTip = at_('js/deposits.js');
check.info('js/deposit-core.js was extracted from js/deposits.js @ ' + pin.slice(0, 7) + ': ' +
	(coreTip === corePin ? 'unchanged at the tip' : 'DRIFTED ' + (coreTip || 'ABSENT').slice(0, 12) + '… at the tip'),
	'the fixture and its replay stay pinned to ' + pin.slice(0, 7) + '; re-extracting is 0.4.0\'s decision');

check.done();
