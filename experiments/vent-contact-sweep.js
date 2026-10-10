// vent-contact-sweep.js — 0.2.4: the Vbirth / tauVent cadence table the 0.2.3 worklog §7
// left open ("Duty cycle 93–98%. If repose matters before 0.3.0-P3, Vbirth / tauVent is
// the knob, and it is its own contact-leg table"). 0.2.3 landed kMelt 20 and the section
// feeds on 97.9 / 92.9% of frames against 0.2.1's 57–69% at the landed plume rate: the
// duty cycle is the one visible thing between the section and the design's eruption
// cadence (0.1.0-design.md §5.2: chambers fill, the vent drains, the toy idles, a vent
// dies and the slot is reused).
//
// One table, three measurements per candidate, all delegated so no gate is implemented
// twice:
//   contact  the four strict contact legs (contact-audit.js --strict), the gate set that
//            decides whether a lifecycle may be committed at all — death timing moves
//            when tephra reaches the stack, which is exactly R1/R3's business;
//   cadence  one leg's eruption cadence (vent-cadence.js) on the same four legs: the
//            decision columns (duty, visible duty, per-life episodes and repose, and the
//            mechanism columns starved% / maxIdle that say whether the death rule fires
//            at all — a vent in the permanent-vent regime cannot be given repose by any
//            tauVent);
//   cone     the live arc cone at the same candidate (tephra-pile.js), the design-scale
//            (10–30 px) gain every candidate is supposed to keep; its band gates judge
//            the chosen row only — a smaller candidate is measured, not judged.
//
// The hook is each owner's VB / TV environment override (contact-audit.js's KG pattern).
// Candidates are absolute design units — Vbirth in km3, tauVent in Myr — and the committed
// default is the first row of each sweep axis, so the table reads as the base plus its
// candidates. Vbirth crosses Vch on purpose: above the vent chamber's cap the column
// batches a whole episode before opening a slot, which is where the repose response lives.
//
//   node experiments/vent-contact-sweep.js [vb=1,4,8,16,32] [tv=0.25,0.5,2] [tag] [coneFrames=3000]
//
// Every run's full log is kept in experiments/logs/0.2.4-<tag->vb<v>-tv<t>-<f>-<s>-<k>.txt
// (contact), .../0.2.4-<tag->cadence-vb<v>-tv<t>-<f>-<s>-<k>.txt and
// .../0.2.4-<tag->cone-vb<v>-tv<t>.txt. The tag names the gate the table was measured
// against, so a table taken before a gate change stays on the record beside one taken
// after it.
// Report only: nothing here edits params.js; the chosen row lands through a normal edit
// and a full-suite re-acceptance.
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var LOGS = path.join(__dirname, 'logs');
var VBS = (process.argv[2] || '1,4,8,16,32').split(',').map(Number);
var TVS = (process.argv[3] || '0.25,0.5,2').split(',').map(Number);
var TAG = process.argv[4] ? process.argv[4] + '-' : '';
var CONE_FRAMES = process.argv[5] || '3000';
// the strict matrix of 0.1.5 §4 / 0.1.9 §0: frames, seed, kyr per frame
var LEGS = [[3000, 1, 50], [3000, 1, 100], [5000, 5, 50], [5000, 5, 100]];

function spawn(file, args, vb, tv) {
	var env = {}, k;
	for (k in process.env) env[k] = process.env[k];
	env.VB = String(vb);
	env.TV = String(tv);
	// spawnSync, not execFileSync: a strict run exits 1 on a gate failure and that is a
	// result to tabulate, not an error to throw on
	return cp.spawnSync(process.execPath, [path.join(__dirname, file)].concat(args),
		{ env: env, encoding: 'utf8', maxBuffer: 1 << 24 });
}

function tagOf(vb, tv) { return 'vb' + vb + '-tv' + tv; }

function run(vb, tv, leg) {
	var r = spawn('contact-audit.js',
		[String(leg[0]), String(leg[1]), String(leg[2]), '--strict'], vb, tv);
	var out = (r.stdout || '') + (r.stderr || '');
	fs.writeFileSync(path.join(LOGS,
		'0.2.4-' + TAG + tagOf(vb, tv) + '-' + leg[0] + '-' + leg[1] + '-' + leg[2] + '.txt'), out);
	function grab(re) { var m = re.exec(out); return m ? m[1] : '-'; }
	var failed = /FAIL  (.*)/g, names = [], m;
	while ((m = failed.exec(out)) !== null) names.push(m[1].split('   ')[0].trim());
	return {
		verdict: /ALL PASS \(\d+ checks\)/.test(out) ? 'pass' : names.join('; ') || '?',
		r1: grab(/ratio ([0-9.]+) \(max 1\.25\)/),
		r2n: grab(/shoulder ([0-9.]+) at/),
		r2w: /(\d+) of (\d+) built collision-frames/.exec(out),
		r3: grab(/R3 the crust has a ceiling\s+([0-9.]+) km/),
		ceil: grab(/\(ceiling ([0-9.]+) km \+ ([0-9.]+) km/),
		allow: grab(/\(ceiling [0-9.]+ km \+ ([0-9.]+) km/),
		flip: grab(/inside the event memory\s+(\d+) of \d+ events/),
		inv: grab(/(\d+) inverted column-frames/),
		ms: grab(/([0-9.]+) ms\/frame/)
	};
}

// The cadence row: vent-cadence.js prints its HEAD, then the ROW, then notes, so the
// sweep reads the row by column name — the table picks what decides and leaves the
// rest in the run's log.
function cadence(vb, tv, leg) {
	var r = spawn('vent-cadence.js', [String(leg[0]), String(leg[1]), String(leg[2])], vb, tv);
	var out = (r.stdout || '') + (r.stderr || '');
	fs.writeFileSync(path.join(LOGS,
		'0.2.4-' + TAG + 'cadence-' + tagOf(vb, tv) + '-' + leg[0] + '-' + leg[1] + '-' + leg[2] + '.txt'), out);
	var lines = out.split('\n'), head = (lines[0] || '').split('\t'), row = (lines[1] || '').split('\t');
	var o = {}, i;
	for (i = 0; i < head.length; i++) o[head[i]] = row[i];
	return o;
}

// The cone row: tephra-pile.js prints its measurement before its own gates, so a candidate
// below the design band still reports the numbers the table needs.
function cone(vb, tv) {
	var r = spawn('tephra-pile.js', [CONE_FRAMES], vb, tv);
	var out = (r.stdout || '') + (r.stderr || '');
	fs.writeFileSync(path.join(LOGS, '0.2.4-' + TAG + 'cone-' + tagOf(vb, tv) + '.txt'), out);
	function grab(re) { var m = re.exec(out); return m ? m[1] : '-'; }
	return {
		wpx: grab(/arc cone\s+([0-9.]+) x/),
		hpx: grab(/arc cone\s+[0-9.]+ x ([0-9.]+) px/),
		pile: grab(/pile ([0-9.]+) cells2/),
		death: grab(/tephra placed ([0-9.]+) cells2 at death/),
		live: grab(/at death \/ ([0-9.]+) live/),
		alive: grab(/alive\/feed frames (\d+)\/(\d+)/),
		feed: grab(/alive\/feed frames \d+\/(\d+)/),
		ledger: grab(/the per-lithology ledger closes.*rel ([0-9.e+-]+)/),
		verdict: /ALL PASS/.test(out) ? 'pass' : 'below band'
	};
}

function width(r) {
	var w = r.r2w;
	return w ? (100 * w[1] / w[2]).toFixed(1) + '% (' + w[1] + '/' + w[2] + ')' : '-';
}

console.log(['Vbirth', 'tauVent', 'leg(f/s/k)', 'verdict', 'R1', 'R2needle', 'R2width',
	'R3 km', 'ceiling+allow', 'margin km', 'R5flip', 'inv', 'ms/f'].join('\t'));
VBS.forEach(function (vb) {
	TVS.forEach(function (tv) {
		LEGS.forEach(function (leg) {
			var r = run(vb, tv, leg);
			console.log([vb, tv, leg.join('/'), r.verdict, r.r1, r.r2n, width(r),
				r.r3, (+r.ceil + +r.allow).toFixed(1), (+r.r3 - +r.ceil - +r.allow).toFixed(2),
				r.flip, r.inv, r.ms].join('\t'));
		});
	});
});
console.log('');
console.log(['Vbirth', 'tauVent', 'leg(f/s/k)', 'births', 'deaths', 'duty%', 'visDuty%',
	'arcDuty%', 'plumeDuty%', 'starved%', 'maxIdle Myr', 'lives', 'medLife f', 'medLifeDuty%',
	'medGap Myr', 'epMax cells2', 'epMean cells2', 'edW px', 'edH px', 'feedRuns', 'maxFeed f',
	'maxQuiet Myr', 'K9 red', 'ledgerErr'].join('\t'));
VBS.forEach(function (vb) {
	TVS.forEach(function (tv) {
		LEGS.forEach(function (leg) {
			var c = cadence(vb, tv, leg);
			console.log([vb, tv, leg.join('/'), c.births, c.deaths, c['duty%'], c['visDuty%'],
				c['arcDuty%'], c['plumeDuty%'], c['starved%'], c['maxIdle Myr'], c.lives,
				c['medLife f'], c['medLifeDuty%'], c['medGap Myr'], c['epMax cells2'],
				c['epMean cells2'], c['edW px'], c['edH px'], c.feedRuns, c['maxFeed f'],
				c['maxQuiet Myr'], c['K9 red'], c.ledgerErr].join('\t'));
		});
	});
});
console.log('');
console.log(['Vbirth', 'tauVent', 'cone W x H px', 'pile cells2', 'tephra death/live cells2',
	'alive/feed frames', 'ledger', 'cone verdict'].join('\t'));
VBS.forEach(function (vb) {
	TVS.forEach(function (tv) {
		var c = cone(vb, tv);
		console.log([vb, tv, c.wpx + ' x ' + c.hpx, c.pile, c.death + '/' + c.live,
			c.alive + '/' + c.feed, c.ledger, c.verdict].join('\t'));
	});
});
