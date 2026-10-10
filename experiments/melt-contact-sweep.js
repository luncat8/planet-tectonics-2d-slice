// melt-contact-sweep.js — 0.2.3: the kMelt calibration the 0.2.2 worklog §6 left open.
// 0.2.2 landed the write-back rule (K7 writes lava only; tephra waits for the vent's death)
// and measured at kMelt 20 that a live arc then builds a 27.0 x 9.1 px cone — but did not
// commit it, because 20 nicks R2 on 3000/1/100 (89.5% against 90%) and R3 on 5000/5/50
// (81.9 km against 81.8). So the remaining half of the design's two visible eruption styles
// is a contact-leg number, not a toy-physics one, and this is the table that lands it.
//
// Two measurements per candidate, both delegated so no gate is ever implemented twice:
//   contact  the four strict contact legs (contact-audit.js --strict): the gate set that
//            decides whether a melt rate may be committed at all.
//   cone     the live arc cone at the same candidate (tephra-pile.js): the eruptive gain
//            the constant is being raised for. That harness isolates the arc source
//            (kPlumeMelt 0) so the cone is not the plume shield 0.2.1 landed, and its own
//            band checks gate the 20 row only — a smaller candidate is measured, not judged.
//
// The hook is each owner's KM environment override (the KG pattern contact-audit.js already
// carries). The committed default is the first row, so the table reads as the base plus its
// candidates.
//
//   node experiments/melt-contact-sweep.js [candidates=0.002,6,10,20] [tag] [coneFrames=3000]
//
// Every run's full log is kept in experiments/logs/0.2.3-<tag->km<value>-<f>-<s>-<k>.txt
// and .../0.2.3-<tag->cone-km<value>.txt. The tag names the gate the table was measured
// against, so a table taken before a gate change stays on the record beside the one taken
// after it.
// Report only: nothing here edits params.js; the chosen value lands through a normal edit
// and a full-suite re-acceptance.
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var LOGS = path.join(__dirname, 'logs');
var CANDS = (process.argv[2] || '0.002,6,10,20').split(',').map(Number);
var TAG = process.argv[3] ? process.argv[3] + '-' : '';
var CONE_FRAMES = process.argv[4] || '3000';
// the strict matrix of 0.1.5 §4 / 0.1.9 §0: frames, seed, kyr per frame
var LEGS = [[3000, 1, 50], [3000, 1, 100], [5000, 5, 50], [5000, 5, 100]];

function spawn(file, args, km) {
	var env = {}, k;
	for (k in process.env) env[k] = process.env[k];
	env.KM = String(km);
	// spawnSync, not execFileSync: a strict run exits 1 on a gate failure and that is a
	// result to tabulate, not an error to throw on
	return cp.spawnSync(process.execPath, [path.join(__dirname, file)].concat(args),
		{ env: env, encoding: 'utf8', maxBuffer: 1 << 24 });
}

function run(km, leg) {
	var r = spawn('contact-audit.js',
		[String(leg[0]), String(leg[1]), String(leg[2]), '--strict'], km);
	var out = (r.stdout || '') + (r.stderr || '');
	fs.writeFileSync(path.join(LOGS,
		'0.2.3-' + TAG + 'km' + km + '-' + leg[0] + '-' + leg[1] + '-' + leg[2] + '.txt'), out);
	function grab(re) { var m = re.exec(out); return m ? m[1] : '-'; }
	var failed = /FAIL  (.*)/g, names = [], m;
	while ((m = failed.exec(out)) !== null) names.push(m[1].split('   ')[0].trim());
	return {
		verdict: /ALL PASS \(\d+ checks\)/.test(out) ? 'pass' : names.join('; ') || '?',
		r1: grab(/ratio ([0-9.]+) \(max 1\.25\)/),
		r2n: grab(/shoulder ([0-9.]+) at/),
		r2w: /(\d+) of (\d+) built collision-frames/.exec(out),
		stand: grab(/longest standing run (\d+) frames/),
		stood: grab(/, (\d+) sites? stood/),
		r3: grab(/R3 the crust has a ceiling\s+([0-9.]+) km/),
		ceil: grab(/\(ceiling ([0-9.]+) km \+ ([0-9.]+) km/),
		allow: grab(/\(ceiling [0-9.]+ km \+ ([0-9.]+) km/),
		flip: grab(/inside the event memory\s+(\d+) of \d+ events/),
		inv: grab(/(\d+) inverted column-frames/),
		cap: grab(/the longest stay (\d+) frames/),
		ms: grab(/([0-9.]+) ms\/frame/)
	};
}

// The cone row: tephra-pile.js prints its measurement before its own gates, so a candidate
// below the design band still reports the numbers the table needs.
function cone(km) {
	var r = spawn('tephra-pile.js', [CONE_FRAMES], km);
	var out = (r.stdout || '') + (r.stderr || '');
	fs.writeFileSync(path.join(LOGS, '0.2.3-' + TAG + 'cone-km' + km + '.txt'), out);
	function grab(re) { var m = re.exec(out); return m ? m[1] : '-'; }
	return {
		wpx: grab(/arc cone\s+([0-9.]+) x/),
		hpx: grab(/arc cone\s+[0-9.]+ x ([0-9.]+) px/),
		pile: grab(/pile ([0-9.]+) cells2/),
		toyIn: grab(/toyIn ([0-9.]+)/),
		beds: grab(/tephra beds ([0-9.e+-]+) m2/),
		death: grab(/tephra placed ([0-9.]+) cells2 at death/),
		live: grab(/at death \/ ([0-9.]+) live/),
		alive: grab(/alive\/feed frames (\d+)\/(\d+)/),
		feed: grab(/alive\/feed frames \d+\/(\d+)/),
		ledger: grab(/the per-lithology ledger closes.*rel ([0-9.e+-]+)/),
		verdict: /ALL PASS/.test(out) ? 'pass' : 'below band'
	};
}

var HEAD = ['km', 'leg(f/s/k)', 'verdict', 'R1', 'R2needle', 'R2width', 'stand', 'R3 km',
	'ceiling+allow', 'margin km', 'R5flip', 'inv', 'capStay', 'ms/f'].join('\t');
console.log(HEAD);
CANDS.forEach(function (km) {
	LEGS.forEach(function (leg) {
		var r = run(km, leg), w = r.r2w;
		console.log([km, leg.join('/'), r.verdict, r.r1, r.r2n,
			w ? (100 * w[1] / w[2]).toFixed(1) + '% (' + w[1] + '/' + w[2] + ')' : '-',
			r.stand + 'f/' + r.stood + ' stood',
			r.r3, (+r.ceil + +r.allow).toFixed(1), (+r.r3 - +r.ceil - +r.allow).toFixed(2),
			r.flip, r.inv, r.cap, r.ms].join('\t'));
	});
});
console.log('');
console.log(['km', 'cone W x H px', 'pile cells2', 'toyIn', 'tephra beds m2',
	'tephra death/live cells2', 'alive/feed frames', 'ledger', 'verdict'].join('\t'));
CANDS.forEach(function (km) {
	var c = cone(km);
	console.log([km, c.wpx + ' x ' + c.hpx, c.pile, c.toyIn, c.beds,
		c.death + '/' + c.live, c.alive + '/' + c.feed, c.ledger, c.verdict].join('\t'));
});
