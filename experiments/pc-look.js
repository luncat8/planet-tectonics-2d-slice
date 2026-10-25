// pc-look.js — 0.5.0 M1, extended at M2: render both pages through their own draw path into
// PNGs (the soup's skeleton lattice; the hybrid's cell field after 100 Myr of convection).
//
// The pages cannot be screenshotted from node, so this fixture supplies a tiny software 2D
// context (fillRect, paths, text, putImageData, scaled drawImage) and calls the engines' real
// draw functions plus pc/page.js's chrome. That makes the image evidence of the shipped code
// rather than of a parallel drawing routine, which is what 0.5.0 M0 used its SVG snapshots for.
//
// Run: node experiments/pc-look.js [--out experiments/logs]
'use strict';

var fs = require('fs');
var path = require('path');
var png = require('./png.js');
var PCPAGE = require('../js/pc/page.js');
var HY = require('../js/hy/hy.js');
var SP = require('../js/sp/sp.js');
var check = require('./lib.js').check;

var W = 1280, H = 560;
var args = process.argv.slice(2), at = args.indexOf('--out');
var outDir = at >= 0 ? args[at + 1] : path.join(__dirname, 'logs');

function parseColor(style) {
	var m, r = 0, g = 0, b = 0, a = 1;
	if (typeof style !== 'string') return [0, 0, 0, 1];
	m = /^#([0-9a-f]{6})$/i.exec(style);
	if (m) {
		r = parseInt(m[1].slice(0, 2), 16);
		g = parseInt(m[1].slice(2, 4), 16);
		b = parseInt(m[1].slice(4, 6), 16);
		return [r, g, b, 1];
	}
	m = /^rgba?\(([^)]+)\)$/.exec(style);
	if (m) {
		var parts = m[1].split(',').map(function (s) { return Number(s.trim()); });
		return [parts[0] | 0, parts[1] | 0, parts[2] | 0,
			parts.length > 3 ? parts[3] : 1];
	}
	return [0, 0, 0, 1];
}

function Surface(w, h) {
	this.width = w; this.height = h;
	this.px = new Uint32Array(w * h);
	this.img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
	this.calls = 0;
	this.texts = [];
}

Surface.prototype._blend = function (x, y, c) {
	var i, d = this.img.data, o;
	x = Math.round(x); y = Math.round(y);
	if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
	i = (y * this.width + x) * 4; o = i;
	var a = c[3];
	if (a >= 1) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; return; }
	d[i] = d[i] + (c[0] - d[i]) * a;
	d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a;
	d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a;
	d[i + 3] = 255;
};

Surface.prototype._flush = function () {
	var i, d = this.img.data, p = this.px;
	for (i = 0; i < p.length; i++) {
		p[i] = (255 << 24) | (d[4 * i + 2] << 16) | (d[4 * i + 1] << 8) | d[4 * i];
	}
};

// the subset of CanvasRenderingContext2D the two engines and pc/page.js use
Surface.prototype.context = function () {
	var self = this, cur = [255, 255, 255, 1], style = '#ffffff', stroke = [255, 255, 255, 1];
	var pathPts = [];
	var ctx = {
		canvas: { width: self.width, height: self.height },
		createImageData: function (w, h) {
			return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
		},
		putImageData: function (img) {
			var i, n = Math.min(img.data.length, self.img.data.length);
			for (i = 0; i < n; i++) self.img.data[i] = img.data[i];
			self.calls++;
		},
		drawImage: function (src, dx, dy, dw, dh) {
			var sw = src.width, sh = src.height, sx, sy, px = src._imgdata;
			if (!px || !sw || !sh) return;
			dw = dw === undefined ? sw : dw; dh = dh === undefined ? sh : dh;
			for (sy = 0; sy < dh; sy++) for (sx = 0; sx < dw; sx++) {
				var ux = Math.floor(sx * sw / dw), uy = Math.floor(sy * sh / dh);
				var o = (uy * sw + ux) * 4;
				self._blend(dx + sx, dy + sy, [px[o], px[o + 1], px[o + 2], px[o + 3] / 255]);
			}
			self.calls++;
		},
		fillRect: function (x, y, w, h) {
			var i, j;
			for (j = 0; j < Math.max(1, Math.round(h)); j++) {
				for (i = 0; i < Math.max(1, Math.round(w)); i++) self._blend(x + i, y + j, cur);
			}
			self.calls++;
		},
		beginPath: function () { pathPts.length = 0; },
		moveTo: function (x, y) { pathPts.push([x, y, 0]); },
		lineTo: function (x, y) { pathPts.push([x, y, 1]); },
		stroke: function () {
			var i, a, b, n;
			for (i = 1; i < pathPts.length; i++) {
				a = pathPts[i - 1]; b = pathPts[i];
				if (!b[2]) continue;
				n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
				for (var k = 0; k <= n; k++) {
					self._blend(a[0] + (b[0] - a[0]) * k / (n || 1),
						a[1] + (b[1] - a[1]) * k / (n || 1), stroke);
				}
			}
			self.calls++;
		},
		fillText: function (text) { self.texts.push(String(text)); self.calls++; },
		measureText: function (t) { return { width: String(t).length * 6 }; },
		save: function () {}, restore: function () {},
		setTransform: function () {}, translate: function () {}, scale: function () {},
		clearRect: function () { self.img.data.fill(0); },
		imageSmoothingEnabled: false
	};
	Object.defineProperty(ctx, 'fillStyle', {
		get: function () { return style; },
		set: function (v) { style = v; cur = parseColor(v); }
	});
	Object.defineProperty(ctx, 'strokeStyle', {
		get: function () { return style; },
		set: function (v) { stroke = parseColor(v); }
	});
	return ctx;
};

// a canvas element stub: HY's field renderer asks document.createElement('canvas') for one
function canvasStub(surface) {
	var el = { width: surface.width, height: surface.height, _imgdata: null };
	var sctx = surface.context();
	var put = sctx.putImageData;
	sctx.putImageData = function (img) {
		put(img);
		el._imgdata = surface.img.data;
		el.width = img.width; el.height = img.height;
		el._own = img.data;
	};
	sctx.drawImage = function () {};
	sctx.fillRect = function () {};
	sctx.fillText = function () {};
	sctx.stroke = function () {};
	// the engine reads back the ImageData it just wrote, which is the field itself
	sctx.putImageData = function (img) {
		el._imgdata = img.data; el.width = img.width; el.height = img.height;
	};
	el.getContext = function () { return sctx; };
	return el;
}

function render(engine, ctx, frames) {
	var i;
	engine.init();
	engine.reset(1);
	for (i = 0; i < (frames || 1); i++) engine.step(0);
	engine.draw(ctx, W, H);
	PCPAGE.chrome(ctx, W, H);
}

function stats(surface) {
	var i, seen = {}, d = surface.img.data, nonBg = 0, cols = 0;
	for (i = 0; i < d.length; i += 4) {
		if (d[i] || d[i + 1] || d[i + 2]) nonBg++;
		var key = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
		if (!seen[key]) { seen[key] = 1; cols++; }
	}
	return { nonBg: nonBg, colors: cols };
}

fs.mkdirSync(outDir, { recursive: true });

check.section('A. the soup skeleton draws its lattice through the page\'s own path');
var s1 = new Surface(W, H);
render(SP, s1.context());
s1._flush();
var st = stats(s1);
check.ok('the canvas is not empty', st.nonBg > 100000, st.nonBg + ' lit pixels');
check.ok('the field is coloured, not flat', st.colors > 20, st.colors + ' distinct colours');
check.ok('the ruler drew its kilometre labels', s1.texts.some(function (t) {
	return /km/.test(t);
}), s1.texts.slice(0, 4).join(' | '));
png.write(path.join(outDir, '0.5.0-M1-soup.png'), W, H, s1.px);
console.log('INFO  wrote ' + path.join(outDir, '0.5.0-M1-soup.png'));

check.section('B. the hybrid draws its convecting cell field at 100 Myr');
var s2 = new Surface(W, H);
global.document = { createElement: function () { return canvasStub(s2); } };
render(HY, s2.context(), 2000);
s2._flush();
var st2 = stats(s2);
check.ok('the raster covers the box', st2.nonBg > 100000, st2.nonBg + ' lit pixels');
check.ok('the cells span the palette', st2.colors > 10, st2.colors + ' distinct colours');
check.ok('the picture is a convecting state, not the initial condition',
	Math.abs(HY.read('time') - 100) < 1e-6 && HY.read('wells') >= 2 && HY.read('peakV') > 10,
	HY.read('wells') + ' wells at ' + HY.read('peakV').toFixed(1) + ' km/Myr');
check.ok('the hybrid drew no parcels and says so in its hud',
	HY.read('population') === 0 && /parcels 0/.test(HY.hud()));
png.write(path.join(outDir, '0.5.0-M2-hybrid.png'), W, H, s2.px);
console.log('INFO  wrote ' + path.join(outDir, '0.5.0-M2-hybrid.png'));

check.section('C. the two images are not the same picture');
var i, diff = 0;
for (i = 0; i < s1.px.length; i++) if (s1.px[i] !== s2.px[i]) diff++;
check.ok('the engines render different views', diff > s1.px.length * 0.2,
	(100 * diff / s1.px.length).toFixed(1) + '% of pixels differ');

check.done();
