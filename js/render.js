// render.js — M0: the debug section view (the mesh as a measuring tool, design §7).
// M1 swaps the body for a per-pixel ImageData raster; the overlay stays canvas 2D.
// No per-frame allocation or string building: all labels come from view-change or
// mousemove time (GEO.grid, UI.cursor, static constants).
'use strict';

var RNDR = {
	ctx: null,
	colLbl: null,   // static column-grid labels, built once

	init: function () {
		this.ctx = document.getElementById('c').getContext('2d');
		this.colLbl = ['0', '64', '128', '192', '256', '320', '384', '448'];
	},

	redraw: function () {
		var c = this.ctx, i, b, s;
		// air / mantle split at sea level (the body pass proper lands in M1)
		var sy0 = GEO.sy(0);
		var y0 = Math.max(0, Math.min(P.ch, sy0));
		c.fillStyle = '#0a0d15';
		c.fillRect(0, 0, P.cw, P.ch);
		c.fillStyle = '#171008';
		if (y0 < P.ch) c.fillRect(0, y0, P.cw, P.ch - y0);
		// row edges: ground schedule + mirrored sky rows
		c.beginPath();
		for (i = 1; i <= GEO.N; i++) {
			s = GEO.sy(-GEO.hTop[i]);
			if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
		}
		for (i = 1; i <= GEO.skyN; i++) {
			s = GEO.sy(GEO.hTop[i]);
			if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
		}
		c.lineWidth = 1;
		c.strokeStyle = 'rgba(130,120,100,0.28)';
		c.stroke();
		// fan bands + cell boundaries (one batched path)
		c.beginPath();
		for (b = 0; b < GEO.bands; b++) {
			var sT = GEO.sy(-GEO.hTop[GEO.bandRow[b]]);
			var sB = GEO.sy(-GEO.hTop[GEO.bandBot[b]]);
			if (sB < 0 || sT > P.ch) continue;
			if (sT < 0) sT = 0;
			if (sB > P.ch) sB = P.ch;
			c.moveTo(0, sT); c.lineTo(P.cw, sT);
			var Cn = GEO.fanN[GEO.bandRow[b]];
			var pitch = P.wrap / Cn;
			var x1 = GEO.x0 + P.cw * GEO.kx;
			for (i = Math.ceil(GEO.x0 / pitch); i * pitch <= x1; i++) {
				s = GEO.sx(i * pitch);
				c.moveTo(s, sT); c.lineTo(s, sB);
			}
		}
		c.strokeStyle = 'rgba(170,150,110,0.4)';
		c.stroke();
		// nominal column grid (real columns from M1): ticks + labels every 64
		c.beginPath();
		for (i = 0; i < P.nCols; i++) {
			s = GEO.sx(i * P.w0);
			if (s >= 0 && s <= P.cw) { c.moveTo(s, 0); c.lineTo(s, 6); }
		}
		c.strokeStyle = 'rgba(140,170,220,0.5)';
		c.stroke();
		c.font = '10px monospace';
		c.fillStyle = 'rgba(140,170,220,0.7)';
		for (i = 0; i < P.nCols; i += 64) {
			s = GEO.sx(i * P.w0);
			if (s > 2 && s < P.cw - 20) c.fillText(this.colLbl[i / 64], s + 2, 14);
		}
		// adaptive asinh depth grid; labels precomputed on view change
		var g = GEO.grid;
		c.beginPath();
		for (i = 0; i < g.length; i++) {
			s = g[i].s;
			if (s > 0 && s < P.ch) { c.moveTo(0, s); c.lineTo(P.cw, s); }
		}
		c.strokeStyle = 'rgba(130,140,165,0.3)';
		c.stroke();
		c.fillStyle = 'rgba(165,175,200,0.8)';
		var lastL = -1e9;
		for (i = 0; i < g.length; i++) {
			s = g[i].s;
			if (s < 10 || s > P.ch - 6 || s - lastL < 16) continue;
			c.fillText(g[i].t, 4, s - 2);
			lastL = s;
		}
		// sea level
		if (sy0 > -2 && sy0 < P.ch + 2) {
			c.beginPath();
			c.moveTo(0, sy0);
			c.lineTo(P.cw, sy0);
			c.strokeStyle = 'rgba(90,170,230,0.8)';
			c.stroke();
			c.fillStyle = 'rgba(90,170,230,0.95)';
			c.fillText('0 m sea level', 4, sy0 - 3);
		}
		// crosshair + the cursor scale readout (strings from mousemove)
		if (UI.mx >= 0 && UI.mx < P.cw && UI.my >= 0 && UI.my < P.ch) {
			c.beginPath();
			c.moveTo(UI.mx, 0); c.lineTo(UI.mx, P.ch);
			c.moveTo(0, UI.my); c.lineTo(P.cw, UI.my);
			c.strokeStyle = 'rgba(255,255,255,0.22)';
			c.stroke();
			if (UI.cursor) {
				c.fillStyle = 'rgba(255,255,255,0.85)';
				var tx = UI.mx + 8;
				if (tx > P.cw - 230) tx = UI.mx - 230;
				c.fillText(UI.cursor, tx, Math.max(10, UI.my - 8));
			}
		}
	},
};

if (typeof module !== 'undefined' && module.exports) module.exports = RNDR;
