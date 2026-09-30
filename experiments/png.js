// png.js — the minimal PNG encoder every headless snapshot shares (RGBA, no interlace).
// This is a library for experiments/: encode a Uint32Array of RGBA words to a file.
'use strict';
var fs = require('fs');
var zlib = require('zlib');

function crc32(buf) {
	var crc = 0xffffffff, n, k;
	for (n = 0; n < buf.length; n++) {
		crc ^= buf[n];
		for (k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	var len = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]), cs = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	cs.writeUInt32BE(crc32(td));
	return Buffer.concat([len, td, cs]);
}

// px is a Uint32Array of w * h words, little-endian RGBA (the canvas ImageData layout)
function write(path, w, h, px) {
	var raw = Buffer.alloc((w * 4 + 1) * h), bytes = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
	for (var y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		bytes.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
	}
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

module.exports = { write: write, crc32: crc32 };
