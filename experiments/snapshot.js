// snapshot.js — headless look at the section: runs the sim in node, paints the real body
// raster (render.body) into a PNG, and marks plate boundaries as coloured bars along the
// top edge (the canvas overlay needs a browser). For eyeballing a change without one.
// Run: node experiments/snapshot.js [frames=200] [preset=def] [out=/tmp/snapshot.png] [seed=1] [kyrPerFrame=50]
'use strict';
var fs = require('fs');
var zlib = require('zlib');
var L = require('./lib.js');
var P = L.mods.params, S = L.mods.state, GEO = L.mods.geom, SIM = L.mods.sim, R = L.mods.render;

var frames = +(process.argv[2] || 200), preset = process.argv[3] || 'def';
var out = process.argv[4] || '/tmp/snapshot.png', seed = +(process.argv[5] || 1);
var kyr = +(process.argv[6] || 50);

L.check.planet(seed, preset);
SIM.setGeo(kyr * 1e3);
SIM.run(frames);
GEO.sync();
GEO.buildColLUT(S);
var w = P.cw, h = P.ch, px = new Uint32Array(w * h);
R.body(px, w, h);

// boundary bars: ridge/rift green, trench red, collision orange, neutral grey
var BAR = [0, 0xffb4b4b4, 0xff78eb6e, 0xff4b5fff, 0xff3cafff];
for (var i = 0; i < S.nCol; i++) {
	var e = S.edge[i];
	if (!e) continue;
	var sx = Math.floor(R.screenX(S.colX[(i + 1) % S.nCol]));
	if (sx < 1 || sx >= w - 1) continue;
	for (var y = 0; y < 14; y++) for (var d = -1; d <= 1; d++) px[y * w + sx + d] = BAR[e];
}

function crc32(buf) {
	var c, crc = 0xffffffff, n, k;
	for (n = 0; n < buf.length; n++) {
		c = (crc ^ buf[n]) & 0xff;
		for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	var len = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	crc.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, crc]);
}
var raw = Buffer.alloc((w * 4 + 1) * h), bytes = Buffer.from(px.buffer);
for (y = 0; y < h; y++) {
	raw[y * (w * 4 + 1)] = 0;
	bytes.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
}
var ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote ' + out + '  t ' + SIM.t.toFixed(2) + ' Myr  preset ' + preset + '  plates ' + S.nPl +
	'  u ' + Array.from(S.plU.subarray(0, S.nPl), function (u) { return (u / 1e4).toFixed(2); }).join(' ') + ' cm/yr');
