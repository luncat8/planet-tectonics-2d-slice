// Optional native Canvas2D diagnostic; not a page or a production dependency.
// npm install --prefix scratch/canvas --no-save --no-package-lock @napi-rs/canvas
// node experiments/edifice-visual.js [path-to-canvas-module]
'use strict';
var L = require('./lib.js'), M = L.mods;
var F = require('./erupt-fixture.js');
var canvas = require(require('path').resolve(process.argv[2] || 'scratch/canvas/node_modules/@napi-rs/canvas'));
var fs = require('fs');
var R = M.render, P = M.params, S = M.state, G = M.geom;
fs.mkdirSync('scratch', { recursive: true });
F.active16();
var hash = S.hash();
var surface = canvas.createCanvas(P.cw, P.ch);
R.init(surface); R.redraw();
fs.writeFileSync('scratch/m2-active16.png', surface.toBuffer('image/png'));
var crop = canvas.createCanvas(768, 270), cc = crop.getContext('2d');
cc.imageSmoothingEnabled = false;
cc.drawImage(surface, 450, 85, 256, 90, 0, 0, 768, 270);
fs.writeFileSync('scratch/m2-closeup.png', crop.toBuffer('image/png'));
var ms = [], n, i, t;
for (n = 0; n < 5; n++) {
	t = process.hrtime.bigint();
	for (i = 0; i < 100; i++) R.overlayVents();
	ms.push(Number(process.hrtime.bigint() - t) / 1e6 / 100);
}
console.log('Actual Canvas2D overlay, 16 domains: best ' + Math.min.apply(null, ms).toFixed(3) + ' ms; ' + ms.map(function (x) { return x.toFixed(3); }).join(', '));
// The cone fill may only replace pixels above the body's profile, never below it.
var base = canvas.createCanvas(P.cw, P.ch), bc = base.getContext('2d');
R.init(base); G.buildColLUT(S); R.body(R.px, R.w, R.h); R.present();
var before = bc.getImageData(0, 0, P.cw, P.ch).data;
R.overlayVents();
var after = bc.getImageData(0, 0, P.cw, P.ch).data, changes = 0, leaked = 0, row, x, off;
for (row = 0; row < P.ch; row++) for (x = 0; x < P.cw; x++) {
	off = 4 * (row * P.cw + x);
	if (before[off] === after[off] && before[off + 1] === after[off + 1] && before[off + 2] === after[off + 2]) continue;
	changes++;
	if (row > G.sy(R.profY[x]) + 1) leaked++;
}
console.log('Overlay changed ' + changes + ' pixels; ' + leaked + ' changes more than 1 px below the profile.');
L.check.ok('native Canvas2D paints the actual 16-domain overlay', changes > 100);
L.check.ok('the clip prevents any changes more than 1 px below the profile', leaked === 0);
L.check.ok('native rendering cannot mutate the world', S.hash() === hash);
L.check.done();
