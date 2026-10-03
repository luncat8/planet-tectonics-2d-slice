// section-pack.js — 0.4.1 M1: the reader half of the cut. One entry point for every
// transport: a pasted blob, a loaded .json file and a bundled ?pack= id all run through
// the same normalize → quantise → validate → verify path on the shared port/slice-format.js
// (0.4.1-plan.md §4.1), so none of them can be a second format and a pasted pack and a
// file pack of the same bytes cannot behave differently.
//
// This file owns the page's section mode (?start=section): the Slice panel, the raw
// strip — what the paste says, before any seeding, the "did the paste work" view — and
// the HUD. Both run modes start stopped (plan §4.4): until M2 seeds the engine from the
// pack there is no clock to start, and the page says so.
'use strict';
var SP = (typeof module !== 'undefined' && module.exports) ? require('../port/slice-format.js') : window.SlicePack;

// raw-strip layout (the canvas is fixed size, so these are constants, not state)
var ML = 48, MR = 10, LEG = 16, POT0 = LEG + 4, POT_H = 6, POT_G = 1, POTN = 6;
var TOP = POT0 + POTN * (POT_H + POT_G) + 4, BAND_H = 16, RULER_H = 34, MGAP = 6;

// lith colours: the section's stack order, top-down (sediment on felsic on mafic), the
// same families RNDR.LITH_RGB draws for the engine (sed / fel / maf).
var LITHE = ['#cbb591', '#dca58c', '#464b52'];
// boundary tick colours: the map's legend (open yellow, subduct red, transform white,
// collide purple) so a cut reads the same on both pages.
var BND_RGB = { 2: '#e8c84a', 3: '#e05555', 4: '#b06ae0', 1: '#c8c8c8' };
// twelve hues for the plate band; a plate id only needs a stable colour, not its own.
var PLATE_RGB = [];
for (var _i = 0; _i < 12; _i++) PLATE_RGB.push('hsl(' + Math.round(_i * 30 + 8) + ',46%,44%)');
var POT_NAM = ['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'];

// 40030 -> '40 030': groups of three from the right, thin space as the separator
function fmtKm(v) {
	var s = String(Math.round(v)), out = '', i;
	for (i = s.length; i > 0; i--) {
		var sep = (s.length - i > 0 && (s.length - i) % 3 === 0) ? ' ' : '';
		out = s.charAt(i - 1) + sep + out;
	}
	return out;
}
function fmtLatLon(ll) {
	var lat = ll[0], lon = ll[1];
	return (lat >= 0 ? lat.toFixed(1) + '°N' : (-lat).toFixed(1) + '°S') + ' ' +
		(lon >= 0 ? lon.toFixed(1) + '°E' : (-lon).toFixed(1) + '°W');
}
// potential heat: dark slate at 0, amber mid, red at 1
function potRGB(v) {
	var t = Math.max(0, Math.min(1, v));
	if (t < 0.5) {
		var a = t / 0.5;
		return 'rgb(' + Math.round(38 + 178 * a) + ',' + Math.round(44 + 136 * a) + ',' + Math.round(58 - 18 * a) + ')';
	}
	var b = (t - 0.5) / 0.5;
	return 'rgb(' + Math.round(216 + 8 * b) + ',' + Math.round(180 - 100 * b) + ',' + Math.round(40 - 20 * b) + ')';
}
var LL = [0, 0];

var SectionPack = {
	mode: false,            // the page is showing a cut, not the engine's world
	pack: null,             // the loaded pack, decoded and verified
	origin: '',             // 'paste' | 'file' | the bundled pack id
	start: null,            // the ?start=section URL params
	msg: '', bad: false,    // the panel line; bad = a refusal
	cvs: null, ctx: null, hudEl: null, sliceEl: null, msgEl: null,
	textEl: null, fileEl: null, pickEl: null,
	cache: null,            // raw-strip geometry for the current pack + size

	// ---------------------------------------------------------------- the URL
	sectionStart: function () {
		if (typeof location === 'undefined' || !location || !location.search) return false;
		return /[?&]start=section\b/.test(location.search);
	},
	urlParams: function () {
		var q = {}, s = (typeof location !== 'undefined' && location && location.search)
			? location.search.replace(/^\?/, '') : '';
		if (!s) return q;
		var pairs = s.split('&'), i, kv, k, v;
		for (i = 0; i < pairs.length; i++) {
			kv = pairs[i].split('=');
			if (!kv[0]) continue;
			k = kv[0];
			v = kv[1] === undefined ? '' : kv[1].replace(/\+/g, '%20');
			try { q[decodeURIComponent(k)] = decodeURIComponent(v); }
			catch (e) { q[k] = v; }
		}
		return q;
	},

	// bundled packs: M4's generated js/data/section-*.js set window.SECTION_PACKS; until
	// then the resolver is there and finds nothing, which is the honest answer.
	bundled: function (id) {
		return (typeof SECTION_PACKS !== 'undefined' && SECTION_PACKS && SECTION_PACKS[id]) || null;
	},

	// ---------------------------------------------------------------- loading
	// The one verify path (plan §4.1): a rejected pack is an error with the reason, the
	// currently shown cut is not touched, and there is no partial load.
	loadPack: function (pack, origin) {
		SP.normalize(pack);
		SP.quantize(pack);
		var bad = SP.validate(pack) || SP.verify(pack);
		if (bad) { this.refuse(bad); throw new Error(bad); }
		this.pack = pack;
		this.origin = origin || 'text';
		this.cache = null;
		this.msg = 'loaded ' + this.describe(pack);
		this.bad = false;
		this.paintMsg();
		return pack;
	},
	load: function (text, origin) {
		var obj;
		try { obj = JSON.parse(String(text)); }
		catch (e) { this.refuse('not JSON: ' + e.message); throw e; }
		return this.loadPack(obj, origin);
	},
	// the page shows the reason in one line; the load itself threw
	refuse: function (reason) {
		this.msg = reason;
		this.bad = true;
		this.paintMsg();
	},

	// the panel readout and the HUD share it (plan §4.2)
	describe: function (pack) {
		var p = pack.path, s = pack.source;
		return 'L' + s.level + ' · ' + p.cellKm.toFixed(0) + ' km cells · ' +
			fmtKm(p.arcKm) + ' km ' + (p.closes ? 'circle' : 'window') +
			' · t ' + s.tMyr + ' Myr' + (s.pack ? ' · ' + s.pack : '') +
			' · checksum ' + pack.checksum;
	},

	// ---------------------------------------------------------------- section mode
	init: function () {
		this.mode = true;
		var body = document.body;
		if (body && body.classList) body.classList.add('section-mode');
		this.cvs = document.getElementById('c');
		this.ctx = this.cvs.getContext('2d');
		this.hudEl = document.getElementById('hud');
		this.sliceEl = document.getElementById('slice');
		this.msgEl = document.getElementById('sMsg');
		this.textEl = document.getElementById('sText');
		this.fileEl = document.getElementById('sFile');
		this.pickEl = document.getElementById('sPick');
		var self = this;
		// the bundled ids: whatever exists when the page boots (M4 generates them)
		if (typeof SECTION_PACKS !== 'undefined' && SECTION_PACKS) {
			for (var id in SECTION_PACKS) {
				var o = document.createElement('option');
				o.value = id; o.textContent = id;
				this.pickEl.appendChild(o);
			}
		}
		this.start = this.urlParams();
		// a paste into the textarea runs the load at once; the button is for typed text
		this.textEl.addEventListener('paste', function (e) {
			var t = e.clipboardData ? e.clipboardData.getData('text') : this.value;
			if (t) self.load(t, 'paste');
		});
		this.textEl.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' && this.value) self.load(this.value, 'paste');
		});
		document.getElementById('sPaste').addEventListener('click', function () {
			if (self.textEl.value) self.load(self.textEl.value, 'paste');
		});
		// a loaded file goes through the same bytes: read the text, run load()
		this.fileEl.addEventListener('change', function () {
			var f = this.files && this.files[0];
			if (!f) return;
			var r = new FileReader();
			r.onload = function () { self.load(r.result, 'file'); };
			r.readAsText(f);
		});
		this.pickEl.addEventListener('change', function () {
			var p = self.bundled(this.value);
			if (p) self.loadPack(p, this.value);
		});
		// ?pack=<id>: a bundled cut from the URL; an id with no bundle is a message, not a guess
		if (this.start.pack) {
			var bp = this.bundled(this.start.pack);
			if (bp) this.loadPack(bp, this.start.pack);
			else this.refuse("no bundled pack '" + this.start.pack + "' (the bake lands in M4) — paste a cut");
		}
		this.msg = this.msg || 'paste a cut, load a .json, or open ?start=section&pack=<id>';
		this.bad = false;
		this.paintMsg();
		this.hud();
	},

	paintMsg: function () {
		if (this.msgEl) {
			this.msgEl.textContent = this.msg;
			if (this.msgEl.classList) {
				this.msgEl.classList.remove('bad');
				if (this.bad) this.msgEl.classList.add('bad');
			}
		}
	},

	clear: function () {
		this.pack = null;
		this.origin = '';
		this.cache = null;
		this.msg = 'cut cleared';
		this.bad = false;
		this.paintMsg();
	},

	// M2 runs the seeded engine here; until then the cut is a still image and the clock is off
	frame: function () {},

	// ---------------------------------------------------------------- the HUD
	hud: function () {
		if (!this.hudEl) return;
		var p = this.pack;
		if (!p) {
			this.hudEl.textContent = 'section mode · cut · plate clock off\n' + this.msg;
			return;
		}
		var s = p.source, vpMax = 0, i;
		for (i = 0; i < p.n; i++) if (p.vp[i] > vpMax) vpMax = p.vp[i];
		this.hudEl.textContent =
			'cut · plate clock off · t ' + s.tMyr + ' Myr   ' + this.origin + '\n' +
			this.describe(p) + '\n' +
			'arc scale 1.00   out-of-plane ' + (vpMax / 1e4).toFixed(2) +
			' cm/yr   seed ' + s.simSeed;
	},

	// ---------------------------------------------------------------- the raw strip
	// What the paste says, before any seeding: zM as a step line (nothing is interpolated
	// between cells — the section shows a gap where the cut crossed one), the three
	// thicknesses as a stacked fill, plates as a colour band, bnd ticks, the six potentials
	// as heat strips, and the lat/lon ruler from the pack's own path block.
	geom: function (w, h) {
		if (this.cache && this.cache.w === w && this.cache.h === h && this.cache.pack === this.pack) return;
		var p = this.pack, n = p.n, i;
		var xs = new Float64Array(n + 1), ys = new Float64Array(n), ySed = new Float64Array(n),
			yFel = new Float64Array(n), yMoho = new Float64Array(n);
		for (i = 0; i < n; i++) xs[i] = p.sKm[i];
		xs[n] = p.path.arcKm;
		var zMax = p.sea.levelM, zMin = 0;
		for (i = 0; i < n; i++) {
			var tot = p.hSedM[i] + p.hFelM[i] + p.hMafM[i];
			if (p.zM[i] > zMax) zMax = p.zM[i];
			var bot = p.zM[i] - tot;
			if (bot < zMin) zMin = bot;
		}
		zMax += 700; zMin -= 700;
		var plotH = h - TOP - MGAP - BAND_H - MGAP - RULER_H;
		var yOf = function (z) { return TOP + (zMax - z) / (zMax - zMin) * plotH; };
		var plotW = w - ML - MR;
		var arc = p.path.arcKm;
		var xOf = function (s) { return ML + s / arc * plotW; };
		var plateC = new Uint8Array(n);
		for (i = 0; i < n; i++) {
			ys[i] = yOf(p.zM[i]);
			ySed[i] = yOf(p.zM[i] - p.hSedM[i]);
			yFel[i] = yOf(p.zM[i] - p.hSedM[i] - p.hFelM[i]);
			yMoho[i] = yOf(p.zM[i] - p.hSedM[i] - p.hFelM[i] - p.hMafM[i]);
			plateC[i] = p.plate[i] % PLATE_RGB.length;
		}
		// ruler: eleven ticks, the lat/lon labels come from the shared path block
		var ticks = [], j;
		for (j = 0; j <= 10; j++) {
			var s = j * arc / 10;
			SP.latLonAt(p, s, LL);
			ticks.push({ x: xOf(s), km: fmtKm(s), ll: fmtLatLon(LL) });
		}
		this.cache = {
			w: w, h: h, pack: p, xs: xs, ys: ys, ySed: ySed, yFel: yFel, yMoho: yMoho,
			plateC: plateC, seaY: yOf(p.sea.levelM), zTop: zMax, zBot: zMin, plotH: plotH,
			plotW: plotW, ticks: ticks, bandY: h - RULER_H - MGAP - BAND_H,
			rulerY: h - RULER_H, legend: 'raw cut · zM m · hSed/hFel/hMaf m · plates · bnd · potentials',
			describe: this.describe(p),
			seaLabel: 'sea ' + (p.sea.levelM / 1000).toFixed(1) + ' km'
		};
	},

	draw: function () {
		var ctx = this.ctx, w = this.cvs.width, h = this.cvs.height;
		if (!ctx) return;
		ctx.fillStyle = '#05070c';
		ctx.fillRect(0, 0, w, h);
		if (!this.pack) {
			ctx.fillStyle = '#9aa7bd';
			ctx.font = '12px monospace';
			ctx.fillText('section mode · paste a cut in the Slice panel, or open ?start=section&pack=<id>', ML, h / 2);
			ctx.fillStyle = this.bad ? '#e08585' : '#55637d';
			ctx.fillText(this.msg, ML, h / 2 + 20);
			return;
		}
		this.geom(w, h);
		var c = this.cache, p = this.pack, n = p.n, i, k;
		// legend and the pack's own readout, right-aligned on the same line
		ctx.font = '10px monospace';
		ctx.fillStyle = '#55637d';
		ctx.fillText(c.legend, ML, 11);
		var dw = ctx.measureText ? (ctx.measureText(c.describe).width || 0) : 0;
		ctx.fillStyle = '#7f8ea8';
		ctx.fillText(c.describe, w - MR - dw, 11);
		// the six potentials, one strip each; runs of equal 1/32 colour merged so the
		// strip cost is the number of colour changes, not the number of cells
		ctx.font = '9px monospace';
		for (k = 0; k < POTN; k++) {
			var y = POT0 + k * (POT_H + POT_G);
			ctx.fillStyle = '#55637d';
			ctx.fillText(POT_NAM[k], 2, y + POT_H - 1);
			var last = -1, runStart = ML;
			for (i = 0; i <= n; i++) {
				var bin = i < n ? Math.min(31, Math.max(0, Math.round(p.pot[i * 6 + k] * 31))) : -1;
				if (bin === last) continue;
				if (i > 0) {
					var xe = c.xs[i];
					ctx.fillStyle = last < 0 ? '#0a0f18' : potRGB(last / 31);
					ctx.fillRect(runStart, y, xe - runStart, POT_H);
					runStart = xe;
				}
				last = bin;
			}
		}
		// water between sea level and the surface, per sample (the cut's own wet flag)
		ctx.fillStyle = 'rgba(34,86,130,0.35)';
		for (i = 0; i < n; i++) {
			if (!p.wet[i]) continue;
			var wx = c.xs[i], we2 = i + 1 < n ? c.xs[i + 1] : w - MR;
			ctx.fillRect(wx, c.seaY, we2 - wx, c.ys[i] - c.seaY);
		}
		// the crust: three stacked fills per sample, top-down sediment / felsic / mafic.
		// A gap sample (alive = 0) owns no mass and the strip shows the hole.
		for (i = 0; i < n; i++) {
			if (!p.alive[i]) continue;
			var xa = c.xs[i], xb = i + 1 < n ? c.xs[i + 1] : w - MR;
			if (p.hSedM[i] > 0) { ctx.fillStyle = LITHE[0]; ctx.fillRect(xa, c.ys[i], xb - xa, c.ySed[i] - c.ys[i]); }
			if (p.hFelM[i] > 0) { ctx.fillStyle = LITHE[1]; ctx.fillRect(xa, c.ySed[i], xb - xa, c.yFel[i] - c.ySed[i]); }
			if (p.hMafM[i] > 0) { ctx.fillStyle = LITHE[2]; ctx.fillRect(xa, c.yFel[i], xb - xa, c.yMoho[i] - c.yFel[i]); }
		}
		// the surface as a step line: horizontal at each sample's zM, vertical at the
		// crossing — the data's own shape, nothing interpolated between cells
		ctx.strokeStyle = '#dfe7f5';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (i = 0; i < n; i++) {
			var x2 = i + 1 < n ? c.xs[i + 1] : w - MR;
			if (i === 0) ctx.moveTo(c.xs[0], c.ys[0]);
			ctx.lineTo(x2, c.ys[i]);
			if (i + 1 < n && c.ys[i + 1] !== c.ys[i]) ctx.lineTo(x2, c.ys[i + 1]);
		}
		ctx.stroke();
		ctx.lineWidth = 1;
		// the sea level the cut's wet flag was solved against
		if (c.seaY > TOP && c.seaY < TOP + c.plotH) {
			ctx.strokeStyle = '#3f7f9f';
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(ML, c.seaY);
			ctx.lineTo(w - MR, c.seaY);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#3f7f9f';
			ctx.fillText(c.seaLabel, w - MR - 70, c.seaY - 3);
		}
		// the plate band and the boundary ticks: the bnd of sample i is the crossing to
		// sample i+1, so it is drawn at the end of i's span (a closed cut wraps at the edge)
		for (i = 0; i < n; i++) {
			var px = c.xs[i], pe = i + 1 < n ? c.xs[i + 1] : w - MR;
			ctx.fillStyle = p.alive[i] ? PLATE_RGB[c.plateC[i]] : '#10141c';
			ctx.fillRect(px, c.bandY, pe - px, BAND_H);
		}
		for (i = 0; i < n; i++) {
			if (p.bnd[i] === 0) continue;
			var bx = i + 1 < n ? c.xs[i + 1] : w - MR;
			ctx.fillStyle = BND_RGB[p.bnd[i]] || BND_RGB[1];
			ctx.fillRect(bx - 1, c.bandY, 2, BAND_H);
		}
		// the elevation axis, right-aligned in the left margin
		ctx.fillStyle = '#55637d';
		ctx.textAlign = 'right';
		for (k = 0; k <= 4; k++) {
			var z = c.zTop - (c.zTop - c.zBot) * k / 4;
			var zy = TOP + (c.zTop - z) / (c.zTop - c.zBot) * c.plotH;
			ctx.fillRect(ML - 4, zy, 4, 1);
			ctx.fillText((z / 1000).toFixed(1) + ' km', ML - 6, zy + 3);
		}
		ctx.textAlign = 'left';
		// the ruler: arc distance and the lat/lon the path block gives for it
		ctx.strokeStyle = '#2a3550';
		for (i = 0; i < c.ticks.length; i++) {
			var t = c.ticks[i];
			ctx.fillStyle = '#2a3550';
			ctx.fillRect(t.x, c.rulerY, 1, 5);
			ctx.fillStyle = '#7f8ea8';
			ctx.fillText(t.km + ' km', t.x + 3, c.rulerY + 8);
			ctx.fillStyle = '#55637d';
			ctx.fillText(t.ll, t.x + 3, c.rulerY + 20);
		}
	}
};

if (typeof module !== 'undefined' && module.exports) module.exports = SectionPack;
