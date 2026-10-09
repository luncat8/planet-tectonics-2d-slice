'use strict';
// Log readers shared by the K5 tables (k5-hold-table.js, k5-variant-table.js). They read the
// text of one strict contact audit or one K5 reclassification probe and return its numbers.

var fs = require('fs');

function lineWith(lines, words) {
	for (var k = 0; k < lines.length; k++) {
		if (/^(PASS|FAIL|INFO)\s/.test(lines[k]) && lines[k].indexOf(words) >= 0) return lines[k];
	}
	return '';
}

function first(re, text) {
	var m = re.exec(text);
	return m ? m[1] : '-';
}

// verdict, the failing gate names, and the gate metrics of one strict audit
function audit(file) {
	var text = fs.readFileSync(file, 'utf8'), lines = text.split('\n'), verdict = '?', failed = [], k, m;
	for (k = 0; k < lines.length; k++) {
		m = /^(\d+) \/ \d+ FAILURES$/.exec(lines[k]);
		if (m) verdict = m[1] + ' fail';
		if (/^ALL PASS \(\d+ checks\)$/.test(lines[k])) verdict = 'pass';
		if (lines[k].indexOf('FAIL  ') === 0) failed.push(lines[k].slice(6).split('   ')[0].trim());
	}
	var r1 = lineWith(lines, 'R1 an event'), r2n = lineWith(lines, 'the pair is not a local needle');
	var r2w = lineWith(lines, 'contiguous four-column run'), r3 = lineWith(lines, 'the crust has a ceiling');
	var r5 = lineWith(lines, 'no site changes its topology twice');
	var w = /(\d+) of (\d+) built/.exec(r2w);
	return {
		verdict: verdict,
		failed: failed,
		r1: first(/ratio ([0-9.]+) \(max/, r1),
		r2needle: first(/shoulder ([0-9.]+) at/, r2n),
		r2width: w ? (100 * w[1] / w[2]).toFixed(1) : '-',
		r3: first(/([0-9.]+) km \(ceiling/, r3),
		r5repeats: +first(/(\d+) of \d+ events/, r5)
	};
}

// next-frame reclassifications of the K5 probe, by cause
function probe(file) {
	var text = fs.readFileSync(file, 'utf8');
	var m = /reclassifications in (\d+) frames \((\d+) pairs\): (\d+) from a K5 drain.*?, (\d+) from a velocity/.exec(text);
	var d = /largest deficit .*? ([0-9.]+) km/.exec(text);
	if (!m) return { frames: 0, drain: 0, velocity: 0, deficitKm: '-' };
	return { frames: +m[1], drain: +m[3], velocity: +m[4], deficitKm: d ? d[1] : '-' };
}

function exists(file) {
	return fs.existsSync(file);
}

module.exports = { audit: audit, probe: probe, exists: exists };
