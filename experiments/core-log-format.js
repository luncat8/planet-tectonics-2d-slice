// core-log-format.js — the pgt-core-log v2 contract read the way a receiver reads it: the
// fixture round trip, the identities that lock it to the pack fixture, the ported v1
// validation law class by class on a generated corpus, the seal/encode/parse seam, the
// stale-never-current identity rule, and node/classic-script parity.
//
// The corpus is generated from the fixture by mutation: every case is restamped before it is
// judged, so the rule under test is the one that refuses — not a stale checksum standing in
// front of it. The one case that must keep a stale checksum is the checksum case itself.
//
// Run: node experiments/core-log-format.js
'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var lib = require('./lib.js'), check = lib.check, P = lib.mods.params;
var SP = require('../port/slice-format.js');
var CF = require('../port/core-log-format.js');

var root = lib.root;
var fixtureText = fs.readFileSync(path.join(root, 'port', 'fixtures', 'core-log-v2.json'), 'utf8');
var codecText = fs.readFileSync(path.join(root, 'port', 'core-log-format.js'), 'utf8');
var fixture = CF.parse(fixtureText);
var pack = SP.decode(fs.readFileSync(path.join(root, 'port', 'fixtures', 'slice-pack-v2.json'), 'utf8'));

function clone() { return JSON.parse(JSON.stringify(fixture)); }
function restamp(m) { m.checksum = CF.checksum(m); return m; }
function reasonOf(m) {
	try { return CF.validate(m); } catch (e) { return 'threw: ' + e.message; }
}
function refuses(tag, mutate, want, keepChecksum) {
	var m = clone();
	mutate(m);
	if (!keepChecksum && m.checksum !== undefined) restamp(m);
	var why = reasonOf(m);
	check.ok('refuses ' + tag, why !== '' && why.indexOf(want) >= 0, why || 'accepted');
}
function accepts(tag, mutate) {
	var m = clone();
	mutate(m);
	restamp(m);
	var why = reasonOf(m);
	check.ok('accepts ' + tag, why === '', why || 'accepted');
}
function parseRefuses(tag, mutate, want) {
	var m = clone();
	mutate(m);
	if (m.checksum !== undefined) restamp(m);
	var why = '';
	try { CF.parse(JSON.stringify(m)); } catch (e) { why = e.message; }
	check.ok('parse refuses ' + tag, why.indexOf(want) >= 0, why || 'accepted');
}

check.section('A. the fixture: one log, two identities, every named word');
check.ok('the fixture parses and its checksum verifies',
	CF.validate(fixture) === '' && CF.verify(fixture) === '', fixture.checksum);
check.ok('it is a v2 log under the named schema',
	fixture.format === 'pgt-core-log' && fixture.version === 2 &&
	fixture.lithologySchema === 'section-lith-1',
	fixture.format + ' v' + fixture.version + ' ' + fixture.lithologySchema);
check.ok('its path and full-pack identities are the pack fixture\'s own (the fixtures lock)',
	fixture.pathChecksum === SP.pathChecksum(pack.path) && fixture.packChecksum === pack.checksum,
	fixture.pathChecksum + ' / ' + fixture.packChecksum);
check.ok('its arc is the cut it names',
	fixture.arcKm === SP.round(pack.path.arcKm) && fixture.tMyr === pack.source.tMyr &&
	fixture.epochMa === pack.source.epochMa, fixture.arcKm + ' km at ' + fixture.tMyr + ' Myr');
check.ok('its records are ordered and on the cut',
	fixture.records.every(function (r, i) {
		return r.sKm >= 0 && r.sKm < fixture.arcKm &&
			(i === 0 || r.sKm > fixture.records[i - 1].sKm);
	}), fixture.records.length + ' records');
check.ok('every number carries the codec\'s six digits (one spelling in the fixture)',
	fixture.records.every(function (r) {
		if (r.sKm !== CF.round(r.sKm) || r.div !== CF.round(r.div) || r.hTotM !== CF.round(r.hTotM)) return false;
		return r.beds.every(function (b) { return b[1] === CF.round(b[1]) && b[2] === CF.round(b[2]); });
	}), 'arc, clock and every bed');
check.ok('the fixture exercises every lithology and every flag bit',
	(function () {
		var li = {}, fl = 0, i, k, b;
		for (i = 0; i < fixture.records.length; i++) {
			for (k = 0; k < fixture.records[i].beds.length; k++) {
				b = fixture.records[i].beds[k];
				li[b[0]] = true;
				fl |= b[3];
			}
		}
		for (i = 0; i < CF.LITH.length; i++) if (!li[i]) return false;
		return (fl & 15) === 15;
	})(), 'lithologies ' + CF.LITH.join('/') + '; flags ' + CF.FLAGS.join('/'));
check.ok('the fixture carries an intrusive inversion (the exemption is exercised, not assumed)',
	(function () {
		var r = fixture.records[2];
		return r.beds[1][3] === 0 && (r.beds[2][3] & CF.FLAG.intr) &&
			r.beds[2][2] < r.beds[1][2];
	})(), 'an old sill injected into a young stack');
check.ok('the canonical text is stable: encode(parse(text)) is the fixture minus its newline',
	CF.encode(fixture) === fixtureText.replace(/\n$/, ''),
	CF.encode(fixture).length + ' of ' + fixtureText.length + ' chars');
check.ok('the identity rule reads the fixture current against its own pack',
	CF.identity(fixture, { pathChecksum: fixture.pathChecksum,
		packChecksum: fixture.packChecksum, arcKm: fixture.arcKm }).status === 'current');

check.section('B. the sealed seam: quantise, close the sum, stamp, one text');
var raw = {
	format: CF.FORMAT, version: CF.VERSION,
	pathChecksum: fixture.pathChecksum, packChecksum: fixture.packChecksum,
	arcKm: 40030.23456789, tMyr: 12.3456789, epochMa: 65,
	lithologySchema: CF.LITHOLOGY_SCHEMA,
	records: [{ sKm: 1000.123456789, div: 0.000123456789, hTotM: 0,
		beds: [[2, 4000.123456789, 0.5, 0], [0, 600.987654321, 11.5, 1]] }]
};
CF.seal(raw);
check.ok('seal closes hTotM as the sum of the rounded beds',
	raw.records[0].hTotM === CF.round(raw.records[0].beds[0][1] + raw.records[0].beds[1][1]),
	raw.records[0].hTotM + ' m from ' + raw.records[0].beds[0][1] + ' + ' + raw.records[0].beds[1][1]);
check.ok('seal quantises every number to six digits and stamps its checksum',
	raw.arcKm === 40030.2 && raw.tMyr === 12.3457 && raw.records[0].sKm === 1000.12 &&
	raw.records[0].div === 0.000123457 && /^[0-9a-f]{16}$/.test(raw.checksum),
	raw.arcKm + ' / ' + raw.records[0].div + ' / ' + raw.checksum);
check.ok('the sealed message passes the receiver\'s law unchanged', CF.validate(raw) === '');
check.ok('encode(decode) is one spelling: the text round-trips',
	CF.encode(CF.parse(CF.encode(raw))) === CF.encode(raw));
check.ok('encode refuses an unsealed message',
	(function () {
		var m = clone();
		delete m.checksum;
		try { CF.encode(m); return false; } catch (e) { return /sealed log/.test(e.message); }
	})());
check.ok('seal refuses a message whose law fails, before it can leave the build',
	(function () {
		var m = clone();
		m.records[0].beds[0][1] = 0;
		try { CF.seal(m); return false; } catch (e) { return /thicker than zero/.test(e.message); }
	})());
check.ok('round is the pack\'s six-significant-digit rule, owned here',
	CF.round(0) === 0 && CF.round(-0) === 0 && CF.round(1.23456789) === 1.23457 &&
	CF.round(1234567) === 1234570 && CF.round(0.000123456789) === 0.000123457 &&
	CF.round(Infinity) === Infinity && isNaN(CF.round(NaN)),
	CF.round(1.23456789) + ' / ' + CF.round(1234567));
check.ok('quantise is idempotent (a second pass cannot move the checksum)',
	(function () {
		var m = clone();
		var once = CF.checksum(CF.quantize(m));
		var twice = CF.checksum(CF.quantize(m));
		return once === twice && once === fixture.checksum;
	})());

check.section('C. the ported v1 law, class by class (P5)');
check.ok('refuses a body that is not an object', /must be an object/.test(CF.validate('x')),
	CF.validate('x'));
refuses('a foreign format', function (m) { m.format = 'pgt-coupling'; }, 'not a pgt-core-log');
refuses('a foreign version', function (m) { m.version = 1; }, 'log version 1');
refuses('a missing lithology schema', function (m) { delete m.lithologySchema; }, 'missing lithologySchema');
refuses('an unknown lithology schema', function (m) { m.lithologySchema = 'section-lith-2'; }, 'unknown lithology schema');
refuses('a malformed pathChecksum', function (m) { m.pathChecksum = 'abc'; }, 'pathChecksum must be 16 hex');
refuses('a missing packChecksum', function (m) { delete m.packChecksum; }, 'missing packChecksum');
refuses('a malformed packChecksum', function (m) { m.packChecksum = 'XYZ'; }, 'packChecksum must be 16 hex');
refuses('an arc that is not positive', function (m) { m.arcKm = 0; }, 'arcKm is not positive');
refuses('a negative clock', function (m) { m.tMyr = -1; }, 'tMyr out of range');
refuses('a non-finite epoch', function (m) { m.epochMa = null; }, 'epochMa is not finite');
refuses('an empty record set', function (m) { m.records = []; }, 'at least one record');
refuses('a record off the cut', function (m) { m.records[3].sKm = m.arcKm + 1; }, 'off the cut');
refuses('unsorted records', function (m) { var t = m.records[0]; m.records[0] = m.records[1]; m.records[1] = t; }, 'ascending arc');
refuses('a duplicate arc position', function (m) { m.records[1].sKm = m.records[0].sKm; }, 'ascending arc');
refuses('a negative divergence', function (m) { m.records[0].div = -0.1; }, 'diverged fraction');
refuses('a record with no crust', function (m) { m.records[3].hTotM = 0; }, 'carries no crust');
refuses('a record with no beds', function (m) { m.records[3].beds = []; }, 'has no beds');
refuses('a stack over the layer cap', function (m) {
	var beds = [], k;
	for (k = 0; k <= CF.LAYER_CAP; k++) beds.push([2, 10, k * 0.001, 0]);
	m.records[3].beds = beds;
	m.records[3].hTotM = 10 * beds.length;
}, 'exceeds the layer cap');
refuses('a bed that is not a four-item array', function (m) { m.records[0].beds[0] = [1, 2]; }, 'is not [lith');
refuses('a bed with a fifth item', function (m) { m.records[0].beds[0].push(9); }, 'is not [lith');
refuses('a lithology outside the table', function (m) { m.records[0].beds[0][0] = CF.LITH.length; }, 'not a lithology');
refuses('a fractional lithology', function (m) { m.records[0].beds[0][0] = 1.5; }, 'not a lithology');
refuses('a zero-thickness bed', function (m) { m.records[0].beds[0][1] = 0; }, 'thicker than zero');
refuses('a negative-thickness bed', function (m) { m.records[0].beds[0][1] = -5; }, 'thicker than zero');
refuses('a bed with no formation time', function (m) { m.records[0].beds[0][2] = null; }, 'no formation time');
refuses('a flag word wider than four bits', function (m) { m.records[0].beds[0][3] = 16; }, 'four bits');
refuses('fractional flags', function (m) { m.records[0].beds[0][3] = 1.5; }, 'four bits');
refuses('thicknesses that do not sum', function (m) { m.records[0].beds[0][1] += 9000; }, 'do not sum');
refuses('an age inversion without an intrusive contact', function (m) {
	m.records[2].beds[2][3] &= ~CF.FLAG.intr;
	m.records[2].beds[1][2] = 12.1;
	m.records[2].beds[2][2] = 2.0;
}, 'not monotone');
refuses('an unknown top-level field', function (m) { m.extra = 1; }, 'unknown field extra');
refuses('an unknown record field', function (m) { m.records[0].note = 'x'; }, 'unknown field note');
refuses('a checksum that is not sixteen hex digits', function (m) { m.checksum = 'xyz'; },
	'checksum must be 16 hex', true);
check.ok('refuses an edited body under a stale checksum',
	(function () {
		var m = clone();
		m.tMyr = CF.round(m.tMyr + 1);
		return reasonOf(m) === 'checksum mismatch';
	})());
accepts('an inversion whose two contacts are each flagged by the neighbouring bed',
	function (m) {
		m.records[2].beds[2][3] &= ~CF.FLAG.intr;   // the sill stops speaking for itself
		m.records[2].beds[1][3] |= CF.FLAG.intr;    // the lava below says its top contact is an injection
		m.records[2].beds[3][3] |= CF.FLAG.intr;    // the fel above says its floor contact is one too
	});
accepts('a bed at the layer cap', function (m) {
	var beds = [], k;
	for (k = 0; k < CF.LAYER_CAP; k++) beds.push([2, 10, k * 0.001, 0]);
	m.records[3].beds = beds;
	m.records[3].hTotM = 10 * CF.LAYER_CAP;
});

check.section('D. parse: the wire carries its checksum, or it is not a log');
check.ok('parse refuses a text with no checksum',
	(function () {
		var m = clone();
		delete m.checksum;
		try { CF.parse(JSON.stringify(m)); return false; } catch (e) { return /must carry its 16-hex checksum/.test(e.message); }
	})());
check.ok('parse refuses a malformed checksum',
	(function () {
		var m = clone();
		m.checksum = 'xyz';
		try { CF.parse(JSON.stringify(m)); return false; } catch (e) { return /must carry its 16-hex checksum/.test(e.message); }
	})());
check.ok('parse refuses a truncated text',
	(function () {
		try { CF.parse(fixtureText.slice(0, 100)); return false; } catch (e) { return /not valid JSON/.test(e.message); }
	})());
check.ok('parse refuses a non-text input',
	(function () {
		try { CF.parse({}); return false; } catch (e) { return /must be JSON text/.test(e.message); }
	})());
check.ok('parse quantises before it judges (the v1 rule): extra digits cannot survive',
	(function () {
		var m = clone();
		m.records[0].div = 0.01234567;   // one digit past the six-significant-digit rule
		return CF.parse(JSON.stringify(m)).records[0].div === 0.0123457;
	})(), 'the record carries the six-digit reading, not the text');
check.ok('parse refuses a text whose checksum was taken off the six-digit grid',
	(function () {
		var m = clone();
		m.records[0].div = 0.01234567;
		m.checksum = CF.checksum(m);
		try { CF.parse(JSON.stringify(m)); return false; } catch (e) { return /checksum mismatch/.test(e.message); }
	})());
parseRefuses('an unknown schema', function (m) { m.lithologySchema = 'section-lith-2'; }, 'unknown lithology schema');
parseRefuses('a thickness sum that does not close', function (m) { m.records[0].beds[0][1] += 9000; }, 'do not sum');
parseRefuses('a record off the cut', function (m) { m.records[3].sKm = m.arcKm + 1; }, 'off the cut');

check.section('E. identity: current, stale, foreign (never a guess)');
var artifact = { pathChecksum: fixture.pathChecksum, packChecksum: fixture.packChecksum, arcKm: fixture.arcKm };
check.ok('an exact identity is current',
	CF.identity(fixture, artifact).status === 'current' && CF.identity(fixture, artifact).reason === '');
check.ok('the same cut over a different full pack is stale, and still a valid log',
	(function () {
		var m = clone();
		m.packChecksum = '0123456789abcdef';
		restamp(m);
		var id = CF.identity(m, artifact);
		return id.status === 'stale' && CF.validate(m) === '' && /source pack/.test(id.reason);
	})());
check.ok('a different path is foreign, whatever its pack says',
	(function () {
		var m = clone();
		m.pathChecksum = '0123456789abcdef';
		restamp(m);
		return CF.identity(m, artifact).status === 'foreign';
	})());
check.ok('a different arc on the same path is foreign',
	(function () {
		var m = clone();
		m.arcKm = CF.round(m.arcKm + 1);
		restamp(m);
		return CF.identity(m, artifact).status === 'foreign';
	})());
check.ok('no artifact to compare against is foreign, not current',
	CF.identity(fixture, null).status === 'foreign');

check.section('F. node and classic script read one fixture the same way');
var classic = null, classicBad = '';
try {
	var context = vm.createContext({});
	vm.runInContext(codecText, context, { filename: 'port/core-log-format.js' });
	classic = context.CoreLogFormat;
} catch (e) { classicBad = e.message; }
check.ok('the classic load exposes exactly one namespace and no module machinery',
	!!classic && typeof classic === 'object' && !!classic.parse, classicBad || 'CoreLogFormat');
if (classic) {
	check.ok('classic and node agree on the fixture checksum',
		classic.parse(fixtureText).checksum === fixture.checksum, fixture.checksum);
	check.ok('classic and node agree on the canonical text',
		classic.encode(classic.parse(fixtureText)) === CF.encode(fixture));
	check.ok('classic and node agree on a refusal',
		(function () {
			var m = clone();
			m.version = 1;
			return classic.validate(m) === CF.validate(m) && /log version 1/.test(classic.validate(m));
		})());
}
var bare = codecText.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
check.ok('the codec is deterministic: no clock, no randomness, no platform read',
	!/Math\.random|Date|performance|require\s*\(/.test(bare),
	'one text, one checksum, on either side');
check.ok('the hash domain is the agreed one, and it is not the pack\'s',
	CF.HASH_DOMAIN === 'pgt-core-log-v2' && SP.FORMAT !== CF.HASH_DOMAIN, CF.HASH_DOMAIN);

check.section('G. the section\'s vocabulary is the codec\'s (the local side of one law)');
check.ok('the lithology table matches index for index',
	P.LITH.sed === 0 && P.LITH.fel === 1 && P.LITH.maf === 2 && P.LITH.tephra === 3 &&
	P.LITH.lava === 4 && P.LITH.sill === 5 && P.LITH.n === CF.LITH.length &&
	CF.LITH.every(function (name, i) { return P.LITH[name] === i; }),
	CF.LITH.map(function (n, i) { return i + '=' + n; }).join(' '));
check.ok('the flag bits match bit for bit',
	P.FLAG.wet === CF.FLAG.wet && P.FLAG.ore === CF.FLAG.ore &&
	P.FLAG.unconf === CF.FLAG.unconf && P.FLAG.intr === CF.FLAG.intr,
	'wet 1, ore 2, unconf 4, intr 8');
check.ok('the section\'s stack bound fits inside the protocol\'s',
	P.layerCap <= CF.LAYER_CAP, 'P.layerCap ' + P.layerCap + ' <= ' + CF.LAYER_CAP);

check.done();
