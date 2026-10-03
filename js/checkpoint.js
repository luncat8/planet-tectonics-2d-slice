// Column checkpoint: upstream's 64-byte header and padded records, slice-local magic.
// Stores runtime state and full section session envelopes. Bump VERSION for schema changes.
'use strict';
var Checkpoint = (function () {
	var node = typeof module !== 'undefined' && module.exports;
	var S = node ? require('./state.js') : window.S;
	var P = node ? require('./params.js') : window.P;
	var RNG = node ? require('./rng.js') : window.RNG;
	var MNT = node ? require('./mantle.js') : window.MNT;
	var SLAB = node ? require('./slab.js') : window.SLAB;
	var arrays = [], scalars = [], recon = Object.keys(S.recon);
	var clocks = 'dG t tErupt Tm frame evT event'.split(' ');
	var dtypes = 'Float64Array Float32Array Int32Array Uint32Array Uint16Array Uint8Array Int8Array'.split(' ');
	Object.keys(S).forEach(function (k) {
		if (ArrayBuffer.isView(S[k])) arrays.push(k);
		else if (typeof S[k] === 'number') scalars.push(k);
	});
	var count = scalars.length + recon.length + clocks.length + 9;
	var table = 64 + count * 8, data = table + arrays.length * 16;
	var total = data;
	arrays.forEach(function (k) { total += pad(S[k].byteLength); });
	function pad(n) { return Math.ceil(n / 8) * 8; }
	function sim() { return node ? require('./sim.js') : window.SIM; }
	function secPack() { return node ? require('./section-pack.js') : window.SectionPack; }
	function secSeed() { return node ? require('./section-seed.js') : window.SEED; }
	function sliceFormat() { return node ? require('../port/slice-format.js') : window.SlicePack; }

	function code(a) {
		var i = dtypes.indexOf(a.constructor.name);
		if (i < 0) throw new TypeError('unsupported checkpoint array ' + a.constructor.name);
		return i + 1;
	}
	function values(runtime) {
		var v = scalars.map(function (k) { return S[k]; });
		recon.forEach(function (k) { v.push(S.recon[k]); });
		clocks.forEach(function (k) { v.push(runtime[k]); });
		return v.concat([P.seed, P.sl.geo, P.sl.erupt], RNG.state(), [RNG.gs, +RNG.gh]);
	}

	function b64enc(bytes) {
		if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
		var s = '', len = bytes.length;
		for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[i]);
		return btoa(s);
	}
	function b64dec(str) {
		if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
		var s = atob(str), len = s.length, out = new Uint8Array(len);
		for (var i = 0; i < len; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	return {
		MAGIC: 0x31435450,
		VERSION: 1,
		SESSION_FORMAT: 'pgt-slice-session',
		SESSION_VERSION: 1,
		b64enc: b64enc,
		b64dec: b64dec,

		save: function () {
			var runtime = sim();
			if (!runtime) throw new Error('simulation is not ready');
			var b = new ArrayBuffer(total), h = new Uint32Array(b, 0, 16), at = data;
			h.set([this.MAGIC, this.VERSION, P.nCols, P.seed >>> 0, P.layerCap, P.colCap, P.plateCap, count, arrays.length, total - data]);
			new Float64Array(b, 64, count).set(values(runtime));
			var records = new Uint32Array(b, table, arrays.length * 4);
			arrays.forEach(function (k, i) {
				var a = S[k];
				records.set([i, code(a), a.length, a.byteLength], i * 4);
				new Uint8Array(b, at, a.byteLength).set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
				at += pad(a.byteLength);
			});
			return new Uint8Array(b);
		},

		load: function (bytes) {
			var src = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
			if (!(src instanceof Uint8Array) || src.byteLength !== total) throw new RangeError('checkpoint data length');
			var b = new Uint8Array(src).buffer, h = new Uint32Array(b, 0, 16);
			if (h[0] !== this.MAGIC) throw new RangeError('not a column checkpoint');
			if (h[1] !== this.VERSION) throw new RangeError('checkpoint version ' + h[1]);
			if (h[2] !== P.nCols || h[4] !== P.layerCap || h[5] !== P.colCap || h[6] !== P.plateCap) throw new RangeError('checkpoint capacity mismatch');
			if (h[7] !== count || h[8] !== arrays.length || h[9] !== total - data) throw new RangeError('checkpoint table mismatch');
			var records = new Uint32Array(b, table, arrays.length * 4);
			arrays.forEach(function (k, i) {
				var a = S[k], j = i * 4;
				if (records[j] !== i || records[j + 1] !== code(a) || records[j + 2] !== a.length || records[j + 3] !== a.byteLength) throw new RangeError('checkpoint record ' + k);
			});
			var runtime = sim();
			if (!runtime) throw new Error('simulation is not ready');
			var v = new Float64Array(b, 64, count), i = 0, at = data;
			for (var j = 0; j < count; j++) if (!Number.isFinite(v[j])) throw new RangeError('checkpoint scalar ' + j);
			var clockAt = scalars.length + recon.length;
			if (v[clockAt] < 0 || v[clockAt + 1] < 0 || v[clockAt + 2] < 0
				|| v[clockAt + 3] < P.Tfloor || v[clockAt + 3] > P.Tm0
				|| v[clockAt + 5] < 0 || v[clockAt + 5] >= P.eventCadence
				|| !Number.isInteger(v[clockAt + 6]) || v[clockAt + 6] < 0) throw new RangeError('checkpoint clock');
			var paramAt = clockAt + clocks.length;
			var rngAt = paramAt + 3, seed = v[paramAt];
			if (!Number.isInteger(seed) || seed < -2147483648 || seed > 4294967295 || (seed >>> 0) !== h[3]) throw new RangeError('checkpoint seed');
			if (v[paramAt + 1] < 0 || v[paramAt + 1] > P.geoMax
				|| v[paramAt + 2] < 0 || v[paramAt + 2] > P.eruptMax) throw new RangeError('checkpoint slider');
			for (j = 0; j < 4; j++) {
				if (!Number.isInteger(v[rngAt + j]) || v[rngAt + j] < 0 || v[rngAt + j] > 4294967295) {
					throw new RangeError('checkpoint RNG word ' + j);
				}
			}
			if (!(v[rngAt] || v[rngAt + 1] || v[rngAt + 2] || v[rngAt + 3])) throw new RangeError('checkpoint RNG state');
			if (v[rngAt + 5] !== 0 && v[rngAt + 5] !== 1) throw new RangeError('checkpoint RNG spare flag');
			var counts = [['nCol', P.colCap], ['nPl', P.plateCap], ['nRib', P.ribCap],
				['nPlm', P.plumeCap], ['nVen', P.maxVents], ['nDep', P.depCap]];
			for (j = 0; j < counts.length; j++) {
				var ci = scalars.indexOf(counts[j][0]), cv = v[ci];
				if (!Number.isInteger(cv) || cv < 0 || cv > counts[j][1]) throw new RangeError('checkpoint ' + counts[j][0]);
			}
			var frameAt = scalars.length + recon.length + clocks.indexOf('frame');
			if (!Number.isInteger(v[frameAt]) || v[frameAt] < 0) throw new RangeError('checkpoint frame');
			scalars.forEach(function (k) { S[k] = v[i++]; });
			recon.forEach(function (k) { S.recon[k] = v[i++]; });
			clocks.forEach(function (k) { runtime[k] = v[i++]; });
			P.seed = v[i++]; P.sl.geo = v[i++]; P.sl.erupt = v[i++];
			RNG.setState(v.subarray(i, i + 4)); i += 4;
			RNG.gs = v[i++]; RNG.gh = !!v[i++];
			arrays.forEach(function (k) {
				var a = S[k];
				new Uint8Array(a.buffer, a.byteOffset, a.byteLength).set(new Uint8Array(b, at, a.byteLength));
				at += pad(a.byteLength);
			});
			MNT.init(P.seed); MNT.setTime(runtime.t, runtime.Tm);
			SLAB.reset();
			return S;
		},

		saveSession: function () {
			var sec = secPack(), seed = secSeed(), sp = sliceFormat();
			var runtimeBytes = this.save();
			var platesFrom = [];
			if (seed && seed.platesFrom) {
				for (var p = 0; p < S.nPl; p++) platesFrom.push(seed.platesFrom[p]);
			}
			var packCopy = null;
			if (sec && sec.pack) {
				try { packCopy = JSON.parse(sp.encode(sec.pack)); }
				catch (e) { packCopy = sec.pack; }
			}
			return {
				format: this.SESSION_FORMAT,
				version: this.SESSION_VERSION,
				created: new Date().toISOString(),
				session: {
					mode: !!(sec && sec.mode),
					origin: (sec && sec.origin) || '',
					world: !!(sec && sec.world),
					raw: !!(sec && sec.raw),
					overlay: sec ? !!sec.overlay : true,
					running: !!(sec && sec.running),
					t0: (sec && sec.t0) || 0,
					spin: (sec && sec.spin) || null
				},
				mapper: {
					MAP: (seed && seed.MAP) || 1,
					scale: (seed && seed.scale) || 1,
					window: !!(seed && seed.window),
					nCut: (seed && seed.nCut) || 0,
					tailKm: (seed && seed.tailKm) || 0,
					mapEquiv: (seed && seed.mapEquiv) || 1,
					runs: (seed && seed.runs) || 0,
					merges: (seed && seed.merges) || 0,
					platesFrom: platesFrom
				},
				pack: packCopy,
				runtime: b64enc(runtimeBytes)
			};
		},

		loadSession: function (sessionInput) {
			var obj = sessionInput;
			if (typeof sessionInput === 'string') {
				try { obj = JSON.parse(sessionInput); }
				catch (e) { throw new RangeError('session not JSON: ' + e.message); }
			}
			if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new RangeError('session must be an object');
			if (obj.format !== this.SESSION_FORMAT) throw new RangeError('not a slice session (' + obj.format + ')');
			if (obj.version !== this.SESSION_VERSION) throw new RangeError('session version ' + obj.version);
			if (!obj.runtime || typeof obj.runtime !== 'string') throw new RangeError('session missing runtime payload');

			var sp = sliceFormat();
			if (obj.pack) {
				for (var k = 0; k < sp.FIELDS.length; k++) {
					var fn = sp.FIELDS[k].name, val = obj.pack[fn];
					if (val && typeof val === 'object' && !Array.isArray(val) && !ArrayBuffer.isView(val)) {
						var arr = [];
						for (var idx = 0; idx in val; idx++) arr.push(val[idx]);
						obj.pack[fn] = arr;
					}
				}
				sp.normalize(obj.pack);
				sp.quantize(obj.pack);
				var badPack = sp.validate(obj.pack) || sp.verify(obj.pack);
				if (badPack) throw new RangeError('session pack invalid: ' + badPack);
			}

			var bytes = b64dec(obj.runtime);
			this.load(bytes);

			var seed = secSeed(), sec = secPack();
			if (seed && obj.mapper) {
				seed.MAP = obj.mapper.MAP || 1;
				seed.scale = obj.mapper.scale || 1;
				seed.window = !!obj.mapper.window;
				seed.nCut = obj.mapper.nCut || P.nCols;
				seed.tailKm = obj.mapper.tailKm || 0;
				seed.mapEquiv = obj.mapper.mapEquiv || 1;
				seed.runs = obj.mapper.runs || 0;
				seed.merges = obj.mapper.merges || 0;
				if (obj.mapper.platesFrom && seed.platesFrom) {
					for (var p = 0; p < obj.mapper.platesFrom.length && p < P.plateCap; p++) {
						seed.platesFrom[p] = obj.mapper.platesFrom[p];
					}
				}
				seed.pack = obj.pack || null;
			}
			if (sec && obj.session) {
				sec.mode = !!obj.session.mode;
				sec.origin = obj.session.origin || 'checkpoint';
				sec.world = !!obj.session.world;
				sec.raw = !!obj.session.raw;
				sec.overlay = obj.session.overlay !== false;
				sec.running = !!obj.session.running;
				sec.t0 = obj.session.t0 || 0;
				sec.spin = obj.session.spin || null;
				sec.pack = obj.pack || null;
				sec.cache = null;
				sec.msg = 'restored session ' + (obj.pack ? sec.describe(obj.pack) : 'planet');
				sec.bad = false;
				if (sec.paintMsg) sec.paintMsg();
				if (sec.syncButtons) sec.syncButtons();
				if (sec.hud) sec.hud();
			}
			return obj;
		}
	};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Checkpoint;
