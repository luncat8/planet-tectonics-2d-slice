// belt-tune-sweep.js — 0.2.0 M5 contact tuning: sweep P.kBeltGradient (the local
// yield-limited felsic flow that smooths belt shoulders, CRU.beltLocal) over the four
// canonical strict legs and print one row per (candidate, leg) with every gate metric.
// The sweep hook is contact-audit.js's KG environment override; the committed default
// (params.js) is the first row, so the table reads as the base plus its candidates.
//
//   node experiments/belt-tune-sweep.js [candidates=8,12,16,24,32] [tag]
//
// Every run's full log is kept in experiments/logs/0.2.0-m5-sweep-[<tag>-]kg<value>-<f>-<s>-<k>.txt.
// The tag names the gate the table was measured against, so a table taken before a gate
// change stays on the record beside the one taken after it.
// Report only: nothing here edits params.js; the chosen value lands through a normal
// edit and a full-suite re-acceptance.
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var LOGS = path.join(__dirname, 'logs');
var CANDS = (process.argv[2] || '8,12,16,24,32').split(',').map(Number);
var TAG = process.argv[3] ? process.argv[3] + '-' : '';
// the strict matrix of 0.1.5 §4 / 0.1.9 §0: frames, seed, kyr per frame
var LEGS = [[3000, 1, 50], [3000, 1, 100], [5000, 5, 50], [5000, 5, 100]];

function run(kg, leg) {
	var env = {};
	for (var k in process.env) env[k] = process.env[k];
	env.KG = String(kg);
	// spawnSync, not execFileSync: a strict run exits 1 on a gate failure and that is a
	// result to tabulate, not an error to throw on
	var r = cp.spawnSync(process.execPath,
		[path.join(__dirname, 'contact-audit.js'), String(leg[0]), String(leg[1]), String(leg[2]), '--strict'],
		{ env: env, encoding: 'utf8', maxBuffer: 1 << 24 });
	var out = (r.stdout || '') + (r.stderr || '');
	var file = path.join(LOGS, '0.2.0-m5-sweep-' + TAG + 'kg' + kg + '-' + leg[0] + '-' + leg[1] + '-' + leg[2] + '.txt');
	fs.writeFileSync(file, out);
	function grab(re) {
		var m = re.exec(out);
		return m ? m[1] : '-';
	}
	var failed = /FAIL  (.*)/g, names = [], m;
	while ((m = failed.exec(out)) !== null) names.push(m[1].split('   ')[0].trim());
	return {
		verdict: /ALL PASS \(\d+ checks\)/.test(out) ? 'pass' : names.join('; ') || '?',
		r1: grab(/ratio ([0-9.]+) \(max 1\.25\)/),
		r2n: grab(/shoulder ([0-9.]+) at/),
		r2w: grab(/(\d+) of (\d+) built collision-frames/),
		r3: grab(/R3 the crust has a ceiling   ([0-9.]+) km/),
		r5ageN: grab(/inside the event memory   (\d+) of \d+ events/),
		r5frame: grab(/frame window \(P\.evGap 40 frames, report only\)   (\d+) of/),
		maxH: grab(/max ([0-9.]+) km/)
	};
}

console.log(['kg', 'leg(f/s/k)', 'verdict', 'R1', 'R2needle', 'R2width', 'R3', 'R5evAge', 'R5frame', 'maxH'].join('\t'));
CANDS.forEach(function (kg) {
	LEGS.forEach(function (leg) {
		var r = run(kg, leg);
		var w = /(\d+) of (\d+)/.exec(r.r2w);
		console.log([kg, leg.join('/'), r.verdict, r.r1, r.r2n,
			w ? (100 * w[1] / w[2]).toFixed(1) + '% (' + w[1] + '/' + w[2] + ')' : r.r2w,
			r.r3, r.r5ageN, r.r5frame, r.maxH].join('\t'));
	});
});
