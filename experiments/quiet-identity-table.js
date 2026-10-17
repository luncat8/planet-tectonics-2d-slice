'use strict';
// quiet-identity-table.js — reads the 0.1.12 quiet-frame identity matrix and prints the
// numbers `archive/0.1.12-quiet-identity-report.md` quotes, asserting the claims that make
// them a measurement rather than a description: no pair sits beside a different record, the
// territory decomposition closes exactly, the raster split recombines to the gate's own
// yardstick, every censored pair sits on a frame that changed its record set, and every such
// frame is either the kernel's own drain intent or an event-cadence plate split/suture.
//
//   node experiments/quiet-identity-table.js
//
// Reads experiments/logs/0.1.12-quiet-identity-<seed>-<kyr>.txt (the instrument under the
// committed event definition) and experiments/logs/0.1.12-drain-event-<seed>-<kyr>.txt (the
// same with a sliver retirement counted as the event it is).

var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, 'logs');
var rates = [50, 100];
var FRAMES = 5000;
var EX = ['>10 m', '>100 m', '>500 m', '>1 km', '>2 km', '>5 km', '>10 km'];

function read(kind, seed, rate) {
	var name = '0.1.12-' + kind + '-' + seed + '-' + rate + '.txt';
	var p = path.join(root, name);
	if (!fs.existsSync(p)) throw new Error('missing log ' + name);
	return { name: name, text: fs.readFileSync(p, 'utf8') };
}

function need(re, text, name, what) {
	var m = re.exec(text);
	if (!m) throw new Error(name + ': no ' + what + ' line');
	return m;
}

function parse(file, seed, rate) {
	var text = file.text;
	if (/^FAIL\s/m.test(text)) throw new Error('failed check in ' + file.name);
	var run = need(/contact audit — seed (\d+), (\d+) kyr\/frame, (\d+) frames/, text, file.name, 'run');
	if (+run[1] !== seed || +run[2] !== rate || +run[3] !== FRAMES) {
		throw new Error('mismatched run row in ' + file.name);
	}
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
	var intent = need(/their own kernel intents: birth (\d+), consume (\d+), drain (\d+), accrete (\d+); (\d+) had the event cadence called on them and (\d+) removed a ghost/,
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

	var row = {
		seed: seed, rate: rate,
		site: +r1[1], kind: r1[2], yardstick: +r1[5], ratio: +r1[8], budget: +r1[9],
		quietDh: +quiet[1], quietDw: +quiet[2], unmatched: +quiet[3], censored: +quiet[4],
		pairs: +pairs[1], quietFrames: +pairs[2], retained: +pairs[3], cen: +pairs[4],
		c1Hold: +c1[1], c1Ghost: +c1[2], c1Swap: +c1[3],
		badFrames: +integ[1], badHits: +integ[3], badCount: +integ[4], badPairs: +integ[5],
		badCen: +integ[6], badDraw: +integ[7], badId: +integ[8],
		birth: +intent[1], consume: +intent[2], drain: +intent[3], accrete: +intent[4],
		badEvent: +intent[5], badGhost: +intent[6],
		volPct: +vol[1], volH: +vol[5], volUncPct: +vol[7],
		decompM: +decomp[1], decompN: +decomp[2], advLawM: +decomp[3],
		idMax: +idm[1], idRet: +idm[2], idCen: +idm[3], idUnc: +idm[4],
		drawRet: +idm[5], drawCen: +idm[6],
		rzNone: +raster[1], rzRet: +raster[2], rzCen: +raster[3], rzUnc: +raster[4],
		rzBad: +raster[5], rzGate: +raster[6],
		exId: exceedance(ex[2], file.name), exDraw: exceedance(ex[3], file.name)
	};
	assert(row, file.name);
	return row;
}

function exceedance(text, name) {
	var out = [], re = />[\d.]+ (?:m|km) (\d+)/g, m;
	while ((m = re.exec(text)) !== null) out.push(+m[1]);
	if (out.length !== EX.length) throw new Error(name + ': exceedance row has ' + out.length + ' of ' + EX.length);
	return out;
}

function assert(r, name) {
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
	if (r.rzCen >= r.rzGate) {
		throw new Error(name + ': the censored population sets the gate background (' + r.rzCen +
			' m of ' + r.rzGate + ' m)');
	}
	if (r.birth !== 0 || r.consume !== 0 || r.accrete !== 0) {
		throw new Error(name + ': a quiet frame the detector missed carried a birth, a consume or an accretion');
	}
	if (r.badFrames > r.drain + r.badEvent) {
		throw new Error(name + ': ' + r.badFrames + ' missed frames against ' + r.drain + ' drains and ' +
			r.badEvent + ' cadence events');
	}
	if (r.badFrames > 0 && r.badHits !== r.badFrames && r.badCount !== r.badFrames) {
		throw new Error(name + ': ' + r.badFrames + ' missed frames, ' + r.badHits +
			' of them without one floor solve and ' + r.badCount + ' with a different record count');
	}
	if (r.badGhost > r.drain) {
		throw new Error(name + ': ' + r.badGhost + ' missed frames removed a ghost against ' + r.drain + ' drains');
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

function instrumentRow(r) {
	return String(r.seed).padStart(2) + ' ' + String(r.rate).padStart(3) + ' ' +
		String(r.quietFrames).padStart(6) + ' ' + String(r.pairs).padStart(8) + ' ' +
		String(r.c1Ghost).padStart(6) + ' ' + String(r.censored).padStart(5) + ' ' +
		String(r.badFrames).padStart(4) + ' ' + String(r.drain).padStart(5) + ' ' +
		String(r.badEvent).padStart(4) + ' ' + String(r.idMax).padStart(6) + ' ' +
		String(r.idUnc).padStart(6) + ' ' + r.volPct.toFixed(1).padStart(6) + ' ' +
		r.volH.toFixed(1).padStart(5) + ' ' + String(r.yardstick).padStart(9) + ' ' +
		String(r.rzBad).padStart(6);
}

function eventRow(r) {
	return String(r.seed).padStart(2) + ' ' + String(r.rate).padStart(3) + ' ' +
		r.kind.slice(0, 17).padEnd(17) + ' ' + String(r.site).padStart(5) + ' ' +
		String(r.yardstick).padStart(9) + ' ' + r.ratio.toFixed(2).padStart(5) + ' ' +
		(r.ratio > r.budget ? 'RED ' : 'pass') + ' ' + r.quietDh.toFixed(1).padStart(7) + ' ' +
		r.quietDw.toFixed(1).padStart(5) + ' ' + String(r.censored).padStart(5) + ' ' +
		String(r.badFrames).padStart(4) + ' ' + String(r.rzBad).padStart(6);
}

var A = [], B = [], seed, i;
for (seed = 1; seed <= 16; seed++) {
	for (i = 0; i < rates.length; i++) {
		A.push(parse(read('quiet-identity', seed, rates[i]), seed, rates[i]));
		B.push(parse(read('drain-event', seed, rates[i]), seed, rates[i]));
	}
}

console.log('A — the instrument under the committed event definition (--quiet-identity)');
console.log('seed kyr quietF    pairs ghostUnc   cen badF drain cadence  idMax idUnc   vol%  volH  yardstick   rzBad');
for (i = 0; i < A.length; i++) console.log(instrumentRow(A[i]));
console.log('');
console.log('B — the corrected event definition (--quiet-identity --drain-event)');
console.log('seed kyr site kind          site yardstick ratio       quietDh quietDw   cen badF  rzBad');
for (i = 0; i < B.length; i++) console.log(eventRow(B[i]));

console.log('');
console.log('censored observations ' + sum(A, 'censored') + ', of them ' + sum(A, 'badCen') +
	' on a frame that changed its record set and ' + (sum(A, 'censored') - sum(A, 'badCen')) +
	' on a certified quiet frame (' + A.filter(function (r) { return r.cen > 0; }).length +
	' worlds, ' + range(col(A, 'rzCen'), 0) + ' m of the yardstick, the gate reading ' +
	range(col(A, 'rzGate'), 0) + ' m); certified quiet pairs ' + sum(A, 'c1Hold') + ' of ' +
	sum(A, 'pairs') + ', beside a draining record ' + sum(A, 'c1Ghost') +
	', beside a different record ' + sum(A, 'c1Swap'));
console.log('missed frames ' + sum(A, 'badFrames') + ' of ' + sum(A, 'quietFrames') + ' quiet frames: drain intents ' +
	sum(A, 'drain') + ', event-cadence plate splits/sutures ' + sum(A, 'badEvent') +
	', births/consumes/accretions ' + sum(A, 'birth') + '/' + sum(A, 'consume') + '/' + sum(A, 'accrete') +
	', ghost-count changes ' + sum(A, 'badGhost'));
console.log('the width decomposition closes to ' + range(col(A, 'decompM'), 0) + ' m over ' + sum(A, 'decompN') +
	' certified pairs; the advection law to ' + range(col(A, 'advLawM'), 4) + ' m');
console.log('identity-corrected drawn change, certified ' + range(col(A, 'idMax'), 0) + ' m (median ' +
	median(col(A, 'idMax')).toFixed(0) + '), uncertified ' + range(col(A, 'idUnc'), 0) + ' m (median ' +
	median(col(A, 'idUnc')).toFixed(0) + ')');
console.log('C2 worst relative volume change ' + range(col(A, 'volPct'), 1) + '% on columns drawn ' +
	range(col(A, 'volH'), 1) + ' km; beside a draining record ' + range(col(A, 'volUncPct'), 1) + '%');
console.log('the drawn change the audit reports on certified quiet pairs: inside the exclusion ' +
	range(col(A, 'drawRet'), 1) + ' km (median ' + median(col(A, 'drawRet')).toFixed(1) + '), censored ' +
	range(col(A, 'drawCen'), 1) + ' km');
console.log('the drawn surface per record, committed definition: territory unchanged ' +
	range(col(A, 'rzNone'), 0) + ' m, inside the exclusion ' + range(col(A, 'rzRet'), 0) +
	' m, censored ' + range(col(A, 'rzCen'), 0) + ' m, uncertified ' + range(col(A, 'rzUnc'), 0) +
	' m, record set changed ' + range(col(A, 'rzBad'), 0) + ' m (the gate reads ' +
	range(col(A, 'rzGate'), 0) + ' m)');
console.log('the same split with a retirement counted: territory unchanged ' +
	range(col(B, 'rzNone'), 0) + ' m, inside the exclusion ' + range(col(B, 'rzRet'), 0) +
	' m, censored ' + range(col(B, 'rzCen'), 0) + ' m, uncertified ' + range(col(B, 'rzUnc'), 0) +
	' m, record set changed ' + range(col(B, 'rzBad'), 0) + ' m (the gate reads ' +
	range(col(B, 'rzGate'), 0) + ' m)');
console.log('the audit\'s own quiet reading, committed definition: thickness ' +
	range(col(A, 'quietDh'), 1) + ' km (median ' + median(col(A, 'quietDh')).toFixed(1) + '), width ' +
	range(col(A, 'quietDw'), 1) + '% (median ' + median(col(A, 'quietDw')).toFixed(1) + ')');
console.log('R1 yardstick, committed definition ' + range(col(A, 'yardstick'), 0) + ' m (median ' +
	median(col(A, 'yardstick')).toFixed(0) + '), of which on a missed frame ' + range(col(A, 'rzBad'), 0) +
	' m (median ' + median(col(A, 'rzBad')).toFixed(0) + ')');
console.log('R1 with a retirement counted: site ' + range(col(B, 'site'), 0) + ' m, yardstick ' +
	range(col(B, 'yardstick'), 0) + ' m (median ' + median(col(B, 'yardstick')).toFixed(0) + '), ratio ' +
	range(col(B, 'ratio'), 2) + ' against a budget of ' + B[0].budget);
console.log('R1 over budget on ' + B.filter(function (r) { return r.ratio > r.budget; }).length + ' of ' +
	B.length + ' worlds; the retirement is the loudest site on ' +
	B.filter(function (r) { return r.kind === 'sliver retirement'; }).length + ' of them');
console.log('quiet drawn thickness with a retirement counted ' + range(col(B, 'quietDh'), 1) + ' km (median ' +
	median(col(B, 'quietDh')).toFixed(1) + '), width ' + range(col(B, 'quietDw'), 1) + '% (median ' +
	median(col(B, 'quietDw')).toFixed(1) + '), censored pairs left ' + sum(B, 'censored') + ' in ' +
	B.filter(function (r) { return r.cen > 0; }).length + ' worlds, missed frames left ' +
	sum(B, 'badFrames') + ' (cadence calls ' + sum(B, 'badEvent') + ') carrying ' +
	range(col(B, 'rzBad'), 0) + ' m of the yardstick');
for (i = 0; i < EX.length; i++) {
	console.log('certified exceedance ' + EX[i].padEnd(7) + ' ' +
		String(A.reduce(function (a, r) { return a + r.exId[i]; }, 0)).padStart(9) +
		' pairs identity-corrected, ' +
		String(A.reduce(function (a, r) { return a + r.exDraw[i]; }, 0)).padStart(9) + ' drawn');
}
