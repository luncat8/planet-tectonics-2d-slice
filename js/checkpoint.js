// Column checkpoint: upstream's 64-byte header and padded records, slice-local magic.
// This stores runtime state, not a cut or a deposit catalogue. Bump VERSION for schema changes.
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
	return {
		MAGIC: 0x31435450, VERSION: 1,
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
			// Copy also accepts an unaligned file view and prevents aliasing live buffers.
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
		}
	};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Checkpoint;
