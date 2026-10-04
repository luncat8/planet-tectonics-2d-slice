// coupling-link.js — 0.4.1 M5 transport ladder (plan §8.2).
//
// The protocol is transport-neutral. A channel probes postMessage, falls through to a
// localStorage event bus, then settles on the clipboard/file contract. Payloads still pass
// their own checksum and path guards; this handshake chooses a carrier, not a trust boundary.
'use strict';
var LINK = (function () {
	var FORMAT = 'pgt-link';
	var VERSION = 1;
	var KEY = 'pgt-coupling-link-v1';
	var WAIT_MS = 250;
	var serial = 0;

	function Channel(host, handlers, opts) {
		this.host = host || null;
		this.handlers = handlers || {};
		this.opts = opts || {};
		this.id = this.opts.id || ('section-' + (++serial) + '-' + Date.now().toString(36));
		this.rung = 'idle';
		this.stage = 'idle';
		this.target = this.opts.target || null;
		this.timer = 0;
		this.nonce = 0;
		this.started = false;
		var self = this;
		this.onWindowMessage = function (e) { self.windowMessage(e); };
		this.onStorage = function (e) { self.storageMessage(e); };
	}

	Channel.prototype.notify = function () {
		if (this.handlers.onRung) this.handlers.onRung(this.rung, this.stage);
	};

	Channel.prototype.setStage = function (stage) {
		this.stage = stage;
		this.notify();
	};

	Channel.prototype.clearTimer = function () {
		if (!this.timer || !this.host || !this.host.clearTimeout) return;
		this.host.clearTimeout(this.timer);
		this.timer = 0;
	};

	Channel.prototype.wait = function (next) {
		this.clearTimer();
		if (!this.host || !this.host.setTimeout) { next(); return; }
		this.timer = this.host.setTimeout(next, this.opts.waitMs || WAIT_MS);
	};

	Channel.prototype.select = function (rung, target) {
		this.clearTimer();
		if (target) this.target = target;
		this.rung = rung;
		this.stage = 'ready';
		this.notify();
	};

	Channel.prototype.peerWindow = function () {
		if (this.target) return this.target;
		var h = this.host;
		if (!h) return null;
		if (h.opener && !h.opener.closed) return h.opener;
		if (h.parent && h.parent !== h) return h.parent;
		return null;
	};

	Channel.prototype.wire = function (type, payload, replyTo) {
		return {
			format: FORMAT, version: VERSION, sender: this.id,
			type: type, replyTo: replyTo || '', payload: payload === undefined ? null : payload,
			nonce: ++this.nonce
		};
	};

	Channel.prototype.valid = function (wire) {
		return !!wire && wire.format === FORMAT && wire.version === VERSION &&
			typeof wire.sender === 'string' && typeof wire.type === 'string';
	};

	Channel.prototype.post = function (target, wire) {
		if (!target || !target.postMessage) return false;
		try { target.postMessage(wire, '*'); }
		catch (e) { return false; }
		return true;
	};

	Channel.prototype.store = function (wire) {
		var storage;
		try { storage = this.host && this.host.localStorage; }
		catch (e) { return false; }
		if (!storage || !storage.setItem) return false;
		try { storage.setItem(KEY, JSON.stringify(wire)); }
		catch (e2) { return false; }
		return true;
	};

	Channel.prototype.start = function () {
		if (this.started) return this;
		this.started = true;
		var h = this.host;
		if (h && h.addEventListener) {
			h.addEventListener('message', this.onWindowMessage);
			h.addEventListener('storage', this.onStorage);
		}
		this.probePost();
		return this;
	};

	Channel.prototype.probePost = function () {
		this.setStage('probing postMessage');
		var peer = this.peerWindow(), self = this;
		if (!this.post(peer, this.wire('probe'))) { this.probeStorage(); return; }
		this.wait(function () { self.probeStorage(); });
	};

	Channel.prototype.probeStorage = function () {
		this.setStage('probing localStorage');
		var self = this;
		if (!this.store(this.wire('probe'))) { this.select('clipboard/file'); return; }
		this.wait(function () { self.select('clipboard/file'); });
	};

	Channel.prototype.answer = function (rung, wire, source) {
		var ack = this.wire('ack', null, wire.sender);
		if (rung === 'postMessage') {
			if (!this.post(source, ack)) return;
			this.select(rung, source);
			return;
		}
		if (!this.store(ack)) return;
		this.select(rung);
	};

	Channel.prototype.deliver = function (wire) {
		if (wire.type === 'probe' || wire.type === 'ack') return;
		if (this.handlers.onMessage) this.handlers.onMessage(wire.type, wire.payload, this.rung);
	};

	Channel.prototype.windowMessage = function (event) {
		var wire = event && event.data;
		if (!this.valid(wire) || wire.sender === this.id) return;
		if (wire.type === 'probe') { this.answer('postMessage', wire, event.source); return; }
		if (wire.type === 'ack') {
			if (wire.replyTo === this.id) this.select('postMessage', event.source);
			return;
		}
		if (this.rung !== 'postMessage') return;
		if (this.target && event.source && event.source !== this.target) return;
		this.deliver(wire);
	};

	Channel.prototype.storageMessage = function (event) {
		if (!event || event.key !== KEY || !event.newValue) return;
		var wire;
		try { wire = JSON.parse(event.newValue); }
		catch (e) { return; }
		if (!this.valid(wire) || wire.sender === this.id) return;
		if (wire.type === 'probe') { this.answer('localStorage', wire); return; }
		if (wire.type === 'ack') {
			if (wire.replyTo === this.id) this.select('localStorage');
			return;
		}
		if (this.rung === 'localStorage') this.deliver(wire);
	};

	Channel.prototype.send = function (type, payload) {
		var wire = this.wire(type, payload);
		if (this.rung === 'postMessage') return this.post(this.target, wire);
		if (this.rung === 'localStorage') return this.store(wire);
		if (this.handlers.onManual) this.handlers.onManual(type, payload);
		return false;
	};

	Channel.prototype.stop = function () {
		this.clearTimer();
		var h = this.host;
		if (h && h.removeEventListener) {
			h.removeEventListener('message', this.onWindowMessage);
			h.removeEventListener('storage', this.onStorage);
		}
		this.started = false;
		this.rung = 'idle';
		this.stage = 'idle';
	};

	return {
		FORMAT: FORMAT,
		VERSION: VERSION,
		KEY: KEY,
		WAIT_MS: WAIT_MS,
		create: function (host, handlers, opts) { return new Channel(host, handlers, opts); }
	};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LINK;
