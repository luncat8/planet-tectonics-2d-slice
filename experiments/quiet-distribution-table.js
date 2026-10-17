'use strict';

var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, 'logs');
var rates = [50, 100];
var rows = [];
var seed, r, p, text, run, quiet, match;

for (seed = 1; seed <= 16; seed++) {
	for (r = 0; r < rates.length; r++) {
		p = path.join(root, '0.1.9-quiet-distribution-' + seed + '-' + rates[r] + '.txt');
		text = fs.readFileSync(p, 'utf8');
		run = /contact audit — seed (\d+), (\d+) kyr\/frame, (\d+) frames/.exec(text);
		quiet = /quiet-frame drawn thickness ([\d.]+) km and width ([\d.]+)%, (\d+) quiet records with no counterpart, (\d+) re-partitioned/.exec(text);
		if (!run || +run[1] !== seed || +run[2] !== rates[r] || +run[3] !== 5000 || !quiet) {
			throw new Error('missing or mismatched report row: ' + path.basename(p));
		}
		if (/^FAIL\s/m.test(text)) throw new Error('failed check in ' + path.basename(p));
		if (+quiet[3] !== 0) throw new Error('unmatched quiet records in ' + path.basename(p));
		rows.push({
			seed: seed,
			rate: rates[r],
			dh: +quiet[1],
			dw: +quiet[2],
			unmatched: +quiet[3],
			repartitioned: +quiet[4]
		});
	}
}

function values(rate, key) {
	var out = [], i;
	for (i = 0; i < rows.length; i++) if (rate === 0 || rows[i].rate === rate) out.push(rows[i][key]);
	return out;
}

function median(a) {
	a.sort(function (x, y) { return x - y; });
	var mid = a.length >> 1;
	return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function extrema(a) {
	var lo = Infinity, hi = -Infinity, i;
	for (i = 0; i < a.length; i++) {
		if (a[i] < lo) lo = a[i];
		if (a[i] > hi) hi = a[i];
	}
	return lo.toFixed(1) + '..' + hi.toFixed(1);
}

function rowSummary(row) {
	return String(row.seed).padStart(2) + ' ' + String(row.rate).padStart(3) + ' ' +
		row.dh.toFixed(1).padStart(7) + ' ' + row.dw.toFixed(1).padStart(7) + ' ' +
		String(row.unmatched).padStart(9) + ' ' + String(row.repartitioned).padStart(13);
}

console.log('seed kyr quiet_dh_km quiet_dw_pct unmatched repartitioned');
for (seed = 0; seed < rows.length; seed++) console.log(rowSummary(rows[seed]));
console.log('50 kyr: dh ' + extrema(values(50, 'dh')) + ' km; median ' + median(values(50, 'dh')).toFixed(1));
console.log('100 kyr: dh ' + extrema(values(100, 'dh')) + ' km; median ' + median(values(100, 'dh')).toFixed(1));
console.log('all rows: dh ' + extrema(values(0, 'dh')) + ' km; median ' + median(values(0, 'dh')).toFixed(1));
console.log('all rows: reported width ' + extrema(values(0, 'dw')) + '%; unmatched ' +
	rows.reduce(function (sum, row) { return sum + row.unmatched; }, 0) +
	'; re-partitioned ' + rows.reduce(function (sum, row) { return sum + row.repartitioned; }, 0));
