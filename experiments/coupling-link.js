// coupling-link.js — M5 §8.2 transport-ladder handshake, without a browser or server.
// Run: node experiments/coupling-link.js
'use strict';
var lib = require('./lib.js'), check = lib.check;
var LINK = lib.mods['coupling-link'];

function fakeHost() {
	var next = 1;
	var h = {
		listeners: {}, timers: [], cancelled: {},
		addEventListener: function (type, fn) { this.listeners[type] = fn; },
		removeEventListener: function (type, fn) {
			if (this.listeners[type] === fn) delete this.listeners[type];
		},
		setTimeout: function (fn) {
			var id = next++;
			this.timers.push({ id: id, fn: fn });
			return id;
		},
		clearTimeout: function (id) { this.cancelled[id] = true; },
		run: function () {
			while (this.timers.length) {
				var t = this.timers.shift();
				if (this.cancelled[t.id]) continue;
				t.fn();
				return true;
			}
			return false;
		},
		runAll: function () { while (this.run()) {} }
	};
	h.parent = h;
	return h;
}

function ackingPeer(host) {
	var peer = { sent: [] };
	peer.postMessage = function (wire) {
		peer.sent.push(wire);
		if (wire.type !== 'probe') return;
		host.setTimeout(function () {
			host.listeners.message({
				data: {
					format: LINK.FORMAT, version: LINK.VERSION,
					sender: 'globe-post', type: 'ack', replyTo: wire.sender,
					payload: null, nonce: 1
				},
				source: peer
			});
		});
	};
	return peer;
}

function silentPeer() { return { sent: [], postMessage: function (wire) { this.sent.push(wire); } }; }

check.section('A. postMessage is the first rung');
var hp = fakeHost(), peer = ackingPeer(hp), rungs = [], received = [];
var post = LINK.create(hp, {
	onRung: function (rung, stage) { rungs.push(rung + '/' + stage); },
	onMessage: function (type, payload, rung) { received.push([type, payload, rung]); }
}, { id: 'section-post', target: peer, waitMs: 1 });
post.start();
hp.runAll();
check.ok('the first probe is a postMessage handshake',
	peer.sent.length === 1 && peer.sent[0].type === 'probe' && peer.sent[0].format === LINK.FORMAT);
check.ok('an acknowledgement selects postMessage and announces it',
	post.rung === 'postMessage' && post.stage === 'ready' && rungs.indexOf('postMessage/ready') >= 0,
	rungs.join(' -> '));
hp.listeners.message({
	data: { format: LINK.FORMAT, version: LINK.VERSION, sender: 'globe-post', type: 'clock',
		payload: { paused: true }, replyTo: '', nonce: 2 },
	source: peer
});
check.ok('a selected postMessage rung delivers typed payloads',
	received.length === 1 && received[0][0] === 'clock' && received[0][1].paused && received[0][2] === 'postMessage');
check.ok('outbound payloads use the selected rung',
	post.send('observation', { checksum: 'feed' }) && peer.sent[peer.sent.length - 1].type === 'observation');

check.section('B. a silent postMessage peer falls through to localStorage');
var hs = fakeHost(), quiet = silentPeer(), storageWrites = [], storageRungs = [];
hs.localStorage = {
	setItem: function (key, value) {
		storageWrites.push([key, value]);
		var wire = JSON.parse(value);
		if (wire.type !== 'probe') return;
		hs.setTimeout(function () {
			hs.listeners.storage({
				key: LINK.KEY,
				newValue: JSON.stringify({
					format: LINK.FORMAT, version: LINK.VERSION,
					sender: 'globe-storage', type: 'ack', replyTo: wire.sender,
					payload: null, nonce: 1
				})
			});
		});
	}
};
var storage = LINK.create(hs, {
	onRung: function (rung, stage) { storageRungs.push(rung + '/' + stage); }
}, { id: 'section-storage', target: quiet, waitMs: 1 });
storage.start();
hs.runAll();
check.ok('no postMessage answer starts a localStorage probe',
	quiet.sent.length === 1 && storageWrites.length >= 1 && JSON.parse(storageWrites[0][1]).type === 'probe');
check.ok('the storage acknowledgement selects and announces the second rung',
	storage.rung === 'localStorage' && storageRungs.indexOf('localStorage/ready') >= 0,
	storageRungs.join(' -> '));
check.ok('outbound payloads use the storage event bus',
	storage.send('coupling', { format: 'pgt-coupling' }) &&
	JSON.parse(storageWrites[storageWrites.length - 1][1]).type === 'coupling');

check.section('C. no automated answer settles on the manual contract');
var hm = fakeHost(), none = silentPeer(), manualRungs = [], manual = [];
var fallback = LINK.create(hm, {
	onRung: function (rung, stage) { manualRungs.push(rung + '/' + stage); },
	onManual: function (type, payload) { manual.push([type, payload]); }
}, { id: 'section-manual', target: none, waitMs: 1 });
fallback.start();
hm.runAll();
check.ok('the complete probe order is postMessage, localStorage, clipboard/file',
	manualRungs[0] === 'idle/probing postMessage' &&
	manualRungs.indexOf('idle/probing localStorage') >= 0 &&
	manualRungs[manualRungs.length - 1] === 'clipboard/file/ready', manualRungs.join(' -> '));
check.ok('manual is a declared rung, not a send failure disguised as live',
	fallback.rung === 'clipboard/file' && !fallback.send('observation', { id: 7 }) &&
	manual.length === 1 && manual[0][0] === 'observation');
fallback.stop();
check.ok('stop removes both listeners and returns the channel to idle',
	fallback.rung === 'idle' && !hm.listeners.message && !hm.listeners.storage);

check.section('D. restricted file storage is a normal fallback');
var hr = fakeHost();
Object.defineProperty(hr, 'localStorage', {
	get: function () { throw new Error('blocked'); }
});
var restricted = LINK.create(hr, {}, { id: 'section-restricted', waitMs: 1 });
restricted.start();
check.ok('a throwing localStorage getter selects the manual rung without throwing',
	restricted.rung === 'clipboard/file');

check.done();
