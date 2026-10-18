'use strict';
// retirement-ramp-table.js — reads the 0.1.13 strict legs and 32-world quiet-identity
// matrix alongside the 0.1.12 --drain-event baseline, prints the numbers
// `archive/0.1.13-retirement-ramp-report.md` quotes, and asserts the acceptance gates of
// `0.1.13-plan.md` §4:
//   - all four strict legs pass 13/13 checks with R1 <= 1.25 and R3 <= crustMax + influx;
//   - Candidate A (--retire-ramp, zDyn ramp on the absorbing record) fails R1 on all four
//     strict legs and breaches R3 on 5000/5/50;
//   - across the 32-world matrix (5000 frames, seeds 1..16 x 50/100 kyr/frame) with a
//     sliver retirement counted as an event by default: 0 unmatched quiet records, 0 pairs
//     beside a different record, 0 censored observations, 0 missed drain frames, width
//     decomposition closing to 0 m, advection law to <1 m, raster split recombining to the
//     gate's yardstick, and R3 maxH inside the 0.1.12 baseline's 82.8 km.
//
//   node experiments/retirement-ramp-table.js

var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, 'logs');
var rates = [50, 100];
var STRICT_LEGS = [[3000, 1, 50], [3000, 1, 100], [5000, 5, 50], [5000, 5, 100]];
var EX = ['>10 m', '>100 m', '>500 m', '>1 km', '>2 km', '>5 km', '>10 km'];

function read(name) {
	var p = path.join(root, name);
	if (!fs.existsSync(p)) throw new Error('missing log ' + name);
	return { name: name, text: fs.readFileSync(p, 'utf8') };
}

function need(re, text, name, what) {
	var m = re.exec(text);
	if (!m) throw new Error(name + ': no ' + what + ' line');
	return m;
}

function exceedance(text, name) {
	var out = [], re = />[\d.]+ (?:m|km) (\d+)/g, m;
	while ((m = re.exec(text)) !== null) out.push(+m[1]);
	if (out.length !== EX.length) throw new Error(name + ': exceedance row has ' + out.length + ' of ' + EX.length);
	return out;
}

function parse(file, frames, seed, rate, allowFail) {
	var text = file.text;
	var failed = /^FAIL\s/m.test(text);
	if (failed && !allowFail) throw new Error('failed check in ' + file.name);
	var run = need(/contact audit — seed (\d+), (\d+) kyr\/frame, (\d+) frames/, text, file.name, 'run');
	if (+run[1] !== seed || +run[2] !== rate || +run[3] !== frames) {
		throw new Error('mismatched run row in ' + file.name);
	}
	var crust = need(/crust\s+max ([\d.]+) km\s+thickest at a contact ([\d.]+) km.*contiguous 4-of-6 ([\d.]+)% of (\d+) built samples/,
		text, file.name, 'crust');
	var needle = need(/R2 local needle frame (-?\d+), edge (-?\d+), pair [\d.]+ km \/ highest belt-neighbourhood shoulder [\d.]+ km \(([\d.]+)x; max ([\d.]+)\)/,
		text, file.name, 'R2 needle');
	var r1 = need(/R1 event site\s+(\d+) m in an event footprint \(([^,]+), frame (-?\d+) x ([\d.]+) km\) against the quiet-frame yardstick (\d+) m \(frame (-?\d+) x ([\d.]+) km\), ratio ([\d.]+) \(max ([\d.]+)\)/,
		text, file.name, 'R1');
	var quiet = need(/quiet-frame drawn thickness ([\d.]+) km and width ([\d.]+)%, (\d+) quiet records with no counterpart, (\d+) re-partitioned/,
		text, file.name, 'quiet');
	var pairs = need(/quiet-identity (\d+) quiet pairs over (\d+) quiet frames \((\d+) inside the 10% width exclusion, (\d+) censored by it\)/,
		text, file.name, 'quiet-identity');
	var c1 = need(/C1 neighbour continuity: (\d+) held, (\d+) flanked by a draining record or a sliver, (\d+) beside a different record/,
		text, file.name, 'C1');
	var integ = need(/frame integrity: (\d+) of (\d+) quiet frames changed their record set behind the event detector \((\d+) without one floor solve, (\d+) with a different record count\) carrying (\d+) pairs, (\d+) of them censored, drawn max ([\d.]+) km, identity-corrected max (\d+) m/,
		text, file.name, 'frame integrity');
	var intent = need(/their own kernel intents: birth (\d+), consume (\d+), drain (\d+), accrete (\d+)(?:; (\d+) had the event cadence called on them and (\d+) removed a ghost)?/,
		text, file.name, 'kernel intents');
	var vol = need(/C2 volume kept to ([\d.]+)% worst on the (\d+) certified pairs \(frame (-?\d+) x ([\d.]+) km, a column drawn ([\d.]+) km -> ([\d.]+) km\), to ([\d.]+)% on the (\d+) beside a draining record/,
		text, file.name, 'C2');
	var decomp = need(/the width decomposition closes to (\d+) m over (\d+) pairs, the advection law to ([\d.]+) m/,
		text, file.name, 'decomposition');
	var idm = need(/identity-corrected drawn thickness max (\d+) m certified \(inside the exclusion (\d+) m, censored (\d+) m\), (\d+) m uncertified.*the drawn change the audit reports: ([\d.]+) km \/ ([\d.]+) km/,
		text, file.name, 'identity-corrected');
	var raster = need(/raster yardstick split: territory unchanged (\d+) m, inside the exclusion (\d+) m, censored (\d+) m, uncertified (\d+) m, record set changed (\d+) m \(the gate reads (\d+) m\)/,
		text, file.name, 'raster split');
	var ex = need(/exceedance over the (\d+) certified pairs: (.*?) identity-corrected; (.*?) drawn/,
		text, file.name, 'exceedance');
	var verdictMatch = /(ALL PASS \(\d+ checks\)|\d+ \/ \d+ FAILURES)/.exec(text);

	var row = {
		frames: frames, seed: seed, rate: rate,
		maxH: +crust[1], contactMax: +crust[2], r2WidthPct: +crust[3], r2Needle: +needle[3],
		site: +r1[1], kind: r1[2], siteFrame: +r1[3], siteX: +r1[4],
		yardstick: +r1[5], quietFrame: +r1[6], quietX: +r1[7], ratio: +r1[8], budget: +r1[9],
		quietDh: +quiet[1], quietDw: +quiet[2], unmatched: +quiet[3], censored: +quiet[4],
		pairs: +pairs[1], quietFrames: +pairs[2], retained: +pairs[3], cen: +pairs[4],
		c1Hold: +c1[1], c1Ghost: +c1[2], c1Swap: +c1[3],
		badFrames: +integ[1], badHits: +integ[3], badCount: +integ[4], badPairs: +integ[5],
		badCen: +integ[6], badDraw: +integ[7], badId: +integ[8],
		birth: +intent[1], consume: +intent[2], drain: +intent[3], accrete: +intent[4],
		badEvent: intent[5] !== undefined ? +intent[5] : +integ[1],
		badGhost: intent[6] !== undefined ? +intent[6] : 0,
		volPct: +vol[1], volH: +vol[5], volUncPct: +vol[7],
		decompM: +decomp[1], decompN: +decomp[2], advLawM: +decomp[3],
		idMax: +idm[1], idRet: +idm[2], idCen: +idm[3], idUnc: +idm[4],
		drawRet: +idm[5], drawCen: +idm[6],
		rzNone: +raster[1], rzRet: +raster[2], rzCen: +raster[3], rzUnc: +raster[4],
		rzBad: +raster[5], rzGate: +raster[6],
		exId: exceedance(ex[2], file.name), exDraw: exceedance(ex[3], file.name),
		verdict: verdictMatch ? verdictMatch[1] : 'report',
		failed: failed
	};
	assertInstrument(row, file.name);
	return row;
}

function assertInstrument(r, name) {
	if (r.unmatched !== 0) throw new Error(name + ': ' + r.unmatched + ' unmatched quiet records');
	if (r.c1Swap !== 0) throw new Error(name + ': ' + r.c1Swap + ' pairs beside a different record');
	if (r.decompM !== 0) throw new Error(name + ': the width decomposition leaves ' + r.decompM + ' m');
	if (r.advLawM >= 1) throw new Error(name + ': the advection law leaves ' + r.advLawM + ' m');
	if (r.decompN !== r.c1Hold) throw new Error(name + ': the decomposition ran on ' + r.decompN + ' of ' + r.c1Hold);
	var split = Math.max(r.rzNone, r.rzRet, r.rzCen, r.rzUnc, r.rzBad);
	if (split !== r.rzGate) {
		throw new Error(name + ': the raster split recombines to ' + split + ' m, the gate reads ' + r.rzGate + ' m');
	}
	if (r.pairs !== r.retained + r.cen) throw new Error(name + ': the pair populations do not partition');
	if (r.c1Hold + r.c1Ghost + r.c1Swap !== r.pairs) throw new Error(name + ': C1 does not partition the pairs');
	if (r.badCen > r.censored) {
		throw new Error(name + ': ' + r.badCen + ' censored pairs on record-set frames of ' + r.censored + ' censored');
	}
	if (r.birth !== 0 || r.consume !== 0 || r.accrete !== 0) {
		throw new Error(name + ': a quiet frame the detector missed carried a birth, a consume or an accretion');
	}
	if (r.badFrames > r.drain + r.badEvent) {
		throw new Error(name + ': ' + r.badFrames + ' missed frames against ' + r.drain + ' drains and ' +
			r.badEvent + ' cadence events');
	}
	if (r.badGhost > r.drain) {
		throw new Error(name + ': ' + r.badGhost + ' missed frames removed a ghost against ' + r.drain + ' drains');
	}
}

function assertLanded(r, name, isStrict) {
	if (r.drain !== 0 || r.badGhost !== 0 || r.badCount !== 0 || r.badCen !== 0) {
		throw new Error(name + ': missed record-set change on a quiet frame (drain=' + r.drain +
			', badGhost=' + r.badGhost + ', badCount=' + r.badCount + ', badCen=' + r.badCen + ')');
	}
	if (r.kind === 'sliver retirement' && r.ratio > r.budget) {
		throw new Error(name + ': sliver retirement exceeds R1 budget (' + r.ratio + ' > ' + r.budget + ')');
	}
	if (isStrict && (r.censored !== 0 || r.cen !== 0)) {
		throw new Error(name + ': ' + r.censored + ' censored observations on strict leg');
	}
	if (r.maxH > 82.8) {
		throw new Error(name + ': maxH ' + r.maxH + ' km exceeds 0.1.12 baseline max (82.8 km)');
	}
}

function median(a) {
	var s = a.slice().sort(function (x, y) { return x - y; }), mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function range(a, fix) {
	var lo = Infinity, hi = -Infinity, i;
	for (i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
	return lo.toFixed(fix) + '..' + hi.toFixed(fix);
}

function col(rows, key) { return rows.map(function (r) { return r[key]; }); }

function sum(rows, key) { return col(rows, key).reduce(function (a, b) { return a + b; }, 0); }

function strictLine(tag, r) {
	var leg = r.frames + '/' + r.seed + '/' + r.rate;
	var r3Lim = (80 + 35 * r.rate / 1000).toFixed(1);
	return tag.padEnd(14) + ' ' + leg.padEnd(10) + ' ' +
		r.kind.slice(0, 17).padEnd(17) + ' ' + String(r.site).padStart(5) + ' ' +
		String(r.yardstick).padStart(9) + ' ' + r.ratio.toFixed(2).padStart(5) + ' ' +
		r.maxH.toFixed(1).padStart(5) + '/' + r3Lim + ' ' +
		r.r2WidthPct.toFixed(1).padStart(5) + '% ' + String(r.censored).padStart(4) + '  ' + r.verdict;
}

function matrixLine(b, c) {
	return String(c.seed).padStart(2) + ' ' + String(c.rate).padStart(3) + ' | ' +
		b.kind.slice(0, 17).padEnd(17) + ' ' + String(b.site).padStart(5) + ' ' +
		String(b.yardstick).padStart(5) + ' ' + b.ratio.toFixed(2).padStart(5) + ' ' +
		b.maxH.toFixed(1).padStart(5) + ' | ' +
		c.kind.slice(0, 17).padEnd(17) + ' ' + String(c.site).padStart(5) + ' ' +
		String(c.yardstick).padStart(5) + ' ' + c.ratio.toFixed(2).padStart(5) + ' ' +
		(c.ratio > c.budget ? 'RED ' : 'pass') + ' ' + c.maxH.toFixed(1).padStart(5) + ' ' +
		c.quietDh.toFixed(1).padStart(6) + ' ' + c.quietDw.toFixed(1).padStart(5) + ' ' +
		String(c.censored).padStart(3);
}

function parseStrict(file, frames, seed, rate, allowFail) {
	var text = file.text;
	var failed = /^FAIL\s/m.test(text);
	if (failed && !allowFail) throw new Error('failed check in ' + file.name);
	var run = need(/contact audit — seed (\d+), (\d+) kyr\/frame, (\d+) frames/, text, file.name, 'run');
	if (+run[1] !== seed || +run[2] !== rate || +run[3] !== frames) {
		throw new Error('mismatched run row in ' + file.name);
	}
	var crust = need(/crust\s+max ([\d.]+) km\s+thickest at a contact ([\d.]+) km.*contiguous 4-of-6 ([\d.]+)% of (\d+) built samples/,
		text, file.name, 'crust');
	var needle = need(/R2 local needle frame (-?\d+), edge (-?\d+), pair [\d.]+ km \/ highest belt-neighbourhood shoulder [\d.]+ km \(([\d.]+)x; max ([\d.]+)\)/,
		text, file.name, 'R2 needle');
	var r1 = need(/R1 event site\s+(\d+) m in an event footprint \(([^,]+), frame (-?\d+) x ([\d.]+) km\) against the quiet-frame yardstick (\d+) m \(frame (-?\d+) x ([\d.]+) km\), ratio ([\d.]+) \(max ([\d.]+)\)/,
		text, file.name, 'R1');
	var quiet = need(/quiet-frame drawn thickness ([\d.]+) km and width ([\d.]+)%, (\d+) quiet records with no counterpart, (\d+) re-partitioned/,
		text, file.name, 'quiet');
	var verdictMatch = /(ALL PASS \(\d+ checks\)|\d+ \/ \d+ FAILURES)/.exec(text);
	return {
		frames: frames, seed: seed, rate: rate,
		maxH: +crust[1], contactMax: +crust[2], r2WidthPct: +crust[3], r2Needle: +needle[3],
		site: +r1[1], kind: r1[2], siteFrame: +r1[3], siteX: +r1[4],
		yardstick: +r1[5], quietFrame: +r1[6], quietX: +r1[7], ratio: +r1[8], budget: +r1[9],
		quietDh: +quiet[1], quietDw: +quiet[2], unmatched: +quiet[3], censored: +quiet[4],
		verdict: verdictMatch ? verdictMatch[1] : 'report',
		failed: failed
	};
}

var S0 = [], SA = [], SB = [], i, leg;
for (i = 0; i < STRICT_LEGS.length; i++) {
	leg = STRICT_LEGS[i];
	S0.push(parseStrict(read('0.1.12-drain-event-strict-' + leg[1] + '-' + leg[2] + '.txt'), leg[0], leg[1], leg[2], true));
	SA.push(parse(read('0.1.13-retire-ramp-strict-' + leg[1] + '-' + leg[2] + '.txt'), leg[0], leg[1], leg[2], true));
	SB.push(parse(read('0.1.13-strict-' + leg[1] + '-' + leg[2] + '.txt'), leg[0], leg[1], leg[2], false));
	assertLanded(SB[i], '0.1.13-strict-' + leg[1] + '-' + leg[2] + '.txt', true);
	if (SB[i].verdict !== 'ALL PASS (13 checks)' || SB[i].ratio > SB[i].budget) {
		throw new Error('strict leg ' + leg.join('/') + ' did not pass: ' + SB[i].verdict + ', ratio ' + SB[i].ratio);
	}
}
if (!SA.every(function (r) { return r.failed && r.ratio > r.budget; })) {
	throw new Error('expected Candidate A (--retire-ramp) to fail R1 on all four strict legs');
}

var M0 = [], MB = [], seed;
for (seed = 1; seed <= 16; seed++) {
	for (i = 0; i < rates.length; i++) {
		M0.push(parse(read('0.1.12-drain-event-' + seed + '-' + rates[i] + '.txt'), 5000, seed, rates[i], false));
		MB.push(parse(read('0.1.13-quiet-identity-' + seed + '-' + rates[i] + '.txt'), 5000, seed, rates[i], false));
		assertLanded(MB[MB.length - 1], '0.1.13-quiet-identity-' + seed + '-' + rates[i] + '.txt');
	}
}

console.log('1 — the four strict contact legs (base 0.1.12 --drain-event vs Candidate A zDyn ramp vs Candidate B territory hand-back)');
console.log('variant        leg        site kind          site yardstick ratio    R3/lim  R2w%  cen  verdict');
for (i = 0; i < STRICT_LEGS.length; i++) console.log(strictLine('0.1.12 base', S0[i]));
for (i = 0; i < STRICT_LEGS.length; i++) console.log(strictLine('A zDyn ramp', SA[i]));
for (i = 0; i < STRICT_LEGS.length; i++) console.log(strictLine('B hand-back', SB[i]));

console.log('');
console.log('2 — 32-world matrix (5000 frames, seeds 1..16 x 50/100 kyr/frame): 0.1.12 --drain-event vs 0.1.13 landed');
console.log('sd kyr | 0.1.12 kind        site  yard ratio  maxH | 0.1.13 kind        site  yard ratio      maxH    qDh   qDw cen');
for (i = 0; i < MB.length; i++) console.log(matrixLine(M0[i], MB[i]));

console.log('');
console.log('strict legs: 0.1.12 base 0/4 pass (R1 ' + S0.map(function (r) { return r.ratio.toFixed(2); }).join('/') +
	', R3 ' + range(col(S0, 'maxH'), 1) + ' km); Candidate A zDyn ramp 0/4 pass (R1 ' +
	SA.map(function (r) { return r.ratio.toFixed(2); }).join('/') + ', R3 ' + range(col(SA, 'maxH'), 1) +
	' km, R2 width ' + range(col(SA, 'r2WidthPct'), 1) + '%); Candidate B territory hand-back 4/4 ALL PASS (R1 ' +
	SB.map(function (r) { return r.ratio.toFixed(2); }).join('/') + ', R3 ' + range(col(SB, 'maxH'), 1) +
	' km, R2 width ' + range(col(SB, 'r2WidthPct'), 1) + '%, censored ' + sum(SB, 'censored') + ')');
console.log('32-world matrix (5000 frames):');
console.log('  R1 site: 0.1.12 ' + range(col(M0, 'site'), 0) + ' m (median ' + median(col(M0, 'site')).toFixed(0) +
	') -> 0.1.13 ' + range(col(MB, 'site'), 0) + ' m (median ' + median(col(MB, 'site')).toFixed(0) + ')');
console.log('  R1 yardstick: 0.1.12 ' + range(col(M0, 'yardstick'), 0) + ' m (median ' +
	median(col(M0, 'yardstick')).toFixed(0) + ') -> 0.1.13 ' + range(col(MB, 'yardstick'), 0) +
	' m (median ' + median(col(MB, 'yardstick')).toFixed(0) + ')');
console.log('  R1 ratio: 0.1.12 ' + range(col(M0, 'ratio'), 2) + ' (median ' + median(col(M0, 'ratio')).toFixed(2) +
	', pass ' + M0.filter(function (r) { return r.ratio <= r.budget; }).length + '/32, retirement loudest on ' +
	M0.filter(function (r) { return r.kind === 'sliver retirement'; }).length + ') -> 0.1.13 ' +
	range(col(MB, 'ratio'), 2) + ' (median ' + median(col(MB, 'ratio')).toFixed(2) +
	', pass ' + MB.filter(function (r) { return r.ratio <= r.budget; }).length + '/32, retirement loudest on ' +
	MB.filter(function (r) { return r.kind === 'sliver retirement'; }).length + ', retirement over budget on ' +
	MB.filter(function (r) { return r.kind === 'sliver retirement' && r.ratio > r.budget; }).length + ')');
console.log('  R3 maxH: 0.1.12 ' + range(col(M0, 'maxH'), 1) + ' km (median ' + median(col(M0, 'maxH')).toFixed(1) +
	') -> 0.1.13 ' + range(col(MB, 'maxH'), 1) + ' km (median ' + median(col(MB, 'maxH')).toFixed(1) + ')');
console.log('  quiet pairs ' + sum(MB, 'pairs') + ' over ' + sum(MB, 'quietFrames') + ' quiet frames: C1 held ' +
	sum(MB, 'c1Hold') + ', flanked by a draining record ' + sum(MB, 'c1Ghost') + ', beside a different record ' +
	sum(MB, 'c1Swap') + ', unmatched ' + sum(MB, 'unmatched'));
console.log('  width decomposition closes to ' + range(col(MB, 'decompM'), 0) + ' m over ' + sum(MB, 'decompN') +
	' certified pairs; advection law to ' + range(col(MB, 'advLawM'), 4) + ' m');
console.log('  censored observations: 0.1.12 ' + sum(M0, 'censored') + ' -> 0.1.13 ' + sum(MB, 'censored') +
	' across 32 worlds');
console.log('  missed frames: ' + sum(MB, 'badFrames') + ' (all event-cadence calls ' + sum(MB, 'badEvent') +
	', drain ' + sum(MB, 'drain') + ', birth ' + sum(MB, 'birth') + ', consume ' + sum(MB, 'consume') +
	', accrete ' + sum(MB, 'accrete') + ', ghost changes ' + sum(MB, 'badGhost') + '), carrying ' +
	range(col(MB, 'rzBad'), 0) + ' m of the yardstick');
console.log('  quiet drawn thickness ' + range(col(MB, 'quietDh'), 1) + ' km (median ' +
	median(col(MB, 'quietDh')).toFixed(1) + '), width ' + range(col(MB, 'quietDw'), 1) + '% (median ' +
	median(col(MB, 'quietDw')).toFixed(1) + '); identity-corrected certified ' + range(col(MB, 'idMax'), 0) +
	' m (median ' + median(col(MB, 'idMax')).toFixed(0) + '), uncertified ' + range(col(MB, 'idUnc'), 0) +
	' m (median ' + median(col(MB, 'idUnc')).toFixed(0) + ')');
console.log('  raster yardstick split: territory unchanged ' + range(col(MB, 'rzNone'), 0) +
	' m, inside the exclusion ' + range(col(MB, 'rzRet'), 0) + ' m, censored ' + range(col(MB, 'rzCen'), 0) +
	' m, uncertified ' + range(col(MB, 'rzUnc'), 0) + ' m, record set changed ' + range(col(MB, 'rzBad'), 0) +
	' m (gate reads ' + range(col(MB, 'rzGate'), 0) + ' m)');
for (i = 0; i < EX.length; i++) {
	console.log('  certified exceedance ' + EX[i].padEnd(7) + ' ' +
		String(MB.reduce(function (a, r) { return a + r.exId[i]; }, 0)).padStart(9) +
		' pairs identity-corrected, ' +
		String(MB.reduce(function (a, r) { return a + r.exDraw[i]; }, 0)).padStart(9) + ' drawn');
}
