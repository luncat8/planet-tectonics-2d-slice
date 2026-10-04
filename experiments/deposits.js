// deposits.js — the section deposit catalogue: what it is pinned to and what it promises.
//
//   A. the shared core, replayed against the counterpart's own fixture
//      (experiments/fixtures/deposits-draws.json, generated from planet-geotectonics
//      js/deposits.js @ d909476 by experiments/make-deposits-fixture.js)
//   B. the plane reduction: the body frame in the plane's basis is the globe's frame, and
//      the projected ellipse is a superset of the true intersection
//   C. the snapshot on the ring: upstream's one-cell blur, the ghost rule, the checksum
//   D. the catalogue: determinism, a tile vs a scan, identity includes the pack checksum,
//      the rejection ledger, JSON round trip
//   E. the instruments: drill intersects vertically, probe keeps its reach in s and depth
//   F. the section's own gate: the same cut and seed give the same catalogue from a click, a
//      whole-section scan and a re-import; the economics scenario only screens
//
// Run: node experiments/deposits.js
'use strict';
var lib = require('./lib.js'), M = lib.mods, check = lib.check;
var DEP = M.deposits, Core = require('../js/deposit-core.js'), SP = require('../port/slice-format.js');
var DM = require('../port/deposit-models.js'), DE = require('../port/deposit-economics.js');
var S = M.state, P = M.params, SEED = M['section-seed'], CP = M.checkpoint, SEC = M['section-pack'];
var FIX = require('./pack-fixture.js');
var FIXTURE = require('./fixtures/deposits-draws.json');
var KM = 1000;

function same(a, b) { return Math.abs(a - b) <= 0; }
function allSame(got, want) {
	for (var i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
	return got.length === want.length;
}

// the packed pack, laid at its own time, is the fixture the section harnesses share
function lay(pack, seed) {
	var bad = SEED.layout(pack, { seed: seed, t: pack.source.tMyr, Tm: P.Tm0 });
	if (bad) throw new Error(bad);
	return pack;
}

check.section('A. the shared core against the counterpart fixture');
check.ok('the fixture records the counterpart file it came from',
	FIXTURE.provenance.file === 'js/deposits.js' && FIXTURE.provenance.commit === 'd909476' &&
	/^[0-9a-f]{64}$/.test(FIXTURE.provenance.sha256), FIXTURE.provenance.sha256.slice(0, 12));
FIXTURE.mix32.forEach(function (c) {
	check.ok('mix32(' + c.h + ') is the counterpart\'s', Core.mix32(c.h) === c.out);
});
FIXTURE.combine.forEach(function (c) {
	check.ok('combine(' + c.h + ', ' + c.key + ') is the counterpart\'s', Core.combine(c.h, c.key) === c.out);
});
FIXTURE.text.forEach(function (c) {
	check.ok('fnvText(' + JSON.stringify(c.text) + ') is the counterpart\'s', Core.fnvText(c.text) === c.out);
});
FIXTURE.fnvBytes.forEach(function (c, i) {
	var lanes = Core.fnvBytes(new Uint8Array(c.bytes), [c.lanes[0], c.lanes[1]]);
	check.ok('fnvBytes case ' + i + ' (' + c.bytes.length + ' bytes) is the counterpart\'s',
		lanes[0] === c.out[0] && lanes[1] === c.out[1], lanes[0] + '/' + lanes[1]);
});
var drawOk = 0;
FIXTURE.draws.forEach(function (c) {
	var got = new Float64Array(Core.MAX_DRAWS);
	Core.drawCandidate({ seed: c.seed, version: c.version }, c.tile, c.family, c.ordinal, got);
	if (allSame(Array.prototype.slice.call(got), c.out)) drawOk++;
});
check.ok('every key sequence draws the counterpart\'s 40 uniforms', drawOk === FIXTURE.draws.length,
	drawOk + '/' + FIXTURE.draws.length + ' sequences');
FIXTURE.truncatedNormal.forEach(function (c, i) {
	check.ok('truncatedNormal case ' + i + ' is the counterpart\'s', Core.truncatedNormal(c.u1, c.u2) === c.out);
});
FIXTURE.round.forEach(function (c) {
	check.ok('round(' + c.v + ') is the counterpart\'s', Core.round(c.v) === c.out);
});
var axisOk = 0, bodyOk = 0;
FIXTURE.axisUnits.forEach(function (c) {
	var out = new Float64Array(9);
	Core.axisUnits(c.strike, c.dip, out);
	if (allSame(Array.prototype.slice.call(out), c.out)) axisOk++;
});
check.ok('axisUnits is the counterpart\'s', axisOk === FIXTURE.axisUnits.length);
FIXTURE.body.forEach(function (c) {
	var u = new Float64Array(9);
	Core.axisUnits(c.strike, c.dip, u);
	if (Core.verticalHalfExtent(c.axes, u) === c.verticalHalfExtent &&
		Core.volumeOf(c.axes) === c.volume && Core.metalTonnes(c.volume * 2.7 * 0.25, 0.45, '%') === c.metalPct &&
		Core.metalTonnes(c.volume * 2.7 * 0.25, 0.3, 'g/t') === c.metalGt) bodyOk++;
});
check.ok('the body geometry (extent, volume, metal) is the counterpart\'s', bodyOk === FIXTURE.body.length);
var hostOk = 0;
FIXTURE.host.forEach(function (c) {
	if (SP.HOSTS[DEP.hostCode(c.hFel, c.hMaf, c.hSed, 0)] === c.out) hostOk++;
});
check.ok('the host law is the counterpart\'s Extract.host on its fixtures', hostOk === FIXTURE.host.length,
	hostOk + '/' + FIXTURE.host.length);
check.ok('a column with no crust at all is none, not an ocean floor', DEP.hostCode(0, 0, 0, 0) === 0);

check.section('B. the declared plane reduction');
// The plane's basis from the cut's azimuth az: t = (sin az, cos az, 0), u = (0, 0, 1),
// n = (cos az, -sin az, 0) in east-north-up. A body's axis in the plane's basis is the
// upstream axis dotted with those three, and planeFrame must be exactly that.
var AZ = [0, 35, 90, 180, 271.5], STRIKE = [0, 210, 45, 359], DIP = [0, 25, 60, 90];
var worst = 0;
AZ.forEach(function (az) {
	var rad = az * Math.PI / 180;
	var T = [Math.sin(rad), Math.cos(rad), 0], U = [0, 0, 1], N = [Math.cos(rad), -Math.sin(rad), 0];
	STRIKE.forEach(function (st) {
		DIP.forEach(function (dp) {
			var globe = new Float64Array(9), plane = new Float64Array(9);
			Core.axisUnits(st, dp, globe);
			DEP.planeFrame(st - az, dp, plane);
			for (var k = 0; k < 3; k++) {
				var e = [globe[k * 3], globe[k * 3 + 1], globe[k * 3 + 2]];
				var want = [e[0] * T[0] + e[1] * T[1] + e[2] * T[2],
					e[0] * U[0] + e[1] * U[1] + e[2] * U[2],
					e[0] * N[0] + e[1] * N[1] + e[2] * N[2]];
				for (var j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(plane[k * 3 + j] - want[j]));
			}
		});
	});
});
check.ok('the body frame in the plane is the globe frame after the change of basis',
	worst < 1e-12, 'worst component ' + worst.toExponential(2));

// the projected ellipse contains the true plane section: sample the ellipsoid's boundary
// with its own plane section points? Instead check the defining property — for any point
// on the ellipsoid, its (t, u) projection satisfies the quadratic form. Sampled.
var ex = [[300, 200, 80], [1000, 900, 150], [50, 40, 30]], worstForm = 0, samples = 0;
ex.forEach(function (axes) {
	var plane = new Float64Array(9);
	DEP.planeFrame(33, 61, plane);
	var fp = { t: 0, u: 0, n: 0, t2: 0, tu: 0, u2: 0, det: 0 };
	// use the module's own footprint through a body-shaped record
	var b = { fp: { t2: 0, tu: 0, u2: 0, n2: 0 } };
	var t0 = axes[0] * plane[0], t1 = axes[1] * plane[3], t2 = axes[2] * plane[6];
	var u0 = axes[0] * plane[1], u1 = axes[1] * plane[4], u2 = axes[2] * plane[7];
	b.fp.t2 = t0 * t0 + t1 * t1 + t2 * t2;
	b.fp.tu = t0 * u0 + t1 * u1 + t2 * u2;
	b.fp.u2 = u0 * u0 + u1 * u1 + u2 * u2;
	for (var a = 0; a <= 40; a++) {
		for (var c = 0; c <= 40; c++) {
			var th = a / 40 * Math.PI, ph = c / 40 * Math.PI * 2;
			var x = [axes[0] * Math.sin(th) * Math.cos(ph), axes[1] * Math.sin(th) * Math.sin(ph), axes[2] * Math.cos(th)];
			var dt = x[0] * plane[0] + x[1] * plane[3] + x[2] * plane[6];
			var du = x[0] * plane[1] + x[1] * plane[4] + x[2] * plane[7];
			var det = b.fp.t2 * b.fp.u2 - b.fp.tu * b.fp.tu;
			var q = b.fp.u2 * dt * dt - 2 * b.fp.tu * dt * du + b.fp.t2 * du * du;
			worstForm = Math.max(worstForm, q - det);
			samples++;
		}
	}
});
check.ok('every projected ellipsoid point is inside the stored footprint', worstForm <= 1e-9 * 1e6,
	samples + ' samples, worst overshoot ' + worstForm.toExponential(2));

check.section('C. the snapshot on the ring');
// a fake ring of six columns, so the blur and the ghost rule can be pinned exactly
function fakeState() {
	var n = 6, st = { nCol: n, colX: new Float64Array(n), colW: new Float64Array(n),
		hFel: new Float64Array(n), hMaf: new Float64Array(n), hSed: new Float64Array(n),
		hTot: new Float64Array(n), colAge: new Float64Array(n), z: new Float64Array(n),
		colGhost: new Uint8Array(n), oVms: null };
	for (var j = 0; j < n; j++) {
		st.colX[j] = j * 100 * KM; st.colW[j] = 100 * KM;
		st.hFel[j] = 30000; st.hTot[j] = 30000; st.colAge[j] = 100; st.z[j] = 500;
	}
	var fields = ['oVms', 'oMaf', 'oArc', 'oOro', 'oBas', 'oPla'];
	fields.forEach(function (f) {
		st[f] = new Float64Array(n);
		for (var j = 0; j < n; j++) st[f][j] = 0.5;
	});
	st.oVms[1] = 0.9;
	st.colGhost[3] = 1;
	return st;
}
var fs1 = fakeState();
var snapF = DEP.snapshotSection(fs1, { seed: 7, packChecksum: 'abc' });
check.ok('a ghost column carries no potential and host none',
	snapF.pot[3 * 6 + 0] === 0 && snapF.host[3] === 0);
// column 2's neighbours are 1 (0.9) and the ghost 3: excluding the hole gives 0.7, and
// including it as a zero value would give 0.4667 — the two rules are distinguishable
check.near('the blur of a covered column beside a ghost excludes the hole',
	snapF.pot[2 * 6 + 0], 0.7, 1e-6);
check.near('a column between two covered neighbours averages three values',
	snapF.pot[4 * 6 + 0], 0.5, 1e-6);
check.ok('a covered column that samples a high potential keeps it',
	Math.abs(snapF.pot[1 * 6 + 0] - 0.633333) < 1e-6, String(snapF.pot[1 * 6 + 0]));
check.ok('the snapshot is self-describing and checksummed',
	snapF.format === 'pgt-section-snapshot' && /^[0-9a-f]{16}$/.test(snapF.checksum) &&
	snapF.nCol === 6 && snapF.pot.length === 36);
var snapG = DEP.snapshotSection(fakeState(), { seed: 7, packChecksum: 'abc' });
check.ok('the same state, seed and pack checksum give the same snapshot',
	snapG.checksum === snapF.checksum);
var snapH = DEP.snapshotSection(fakeState(), { seed: 7, packChecksum: 'def' });
check.ok('a different pack checksum is a different snapshot', snapH.checksum !== snapF.checksum);

check.section('D. the catalogue');
check.planet(11);
lay(FIX.pinned(), 11);
// the section's clocks, as the page sets them: a checkpoint of a world with Tm below the
// floor is refused by design (js/checkpoint.js), so a harness that saves one must cool it
M.sim.t = FIX.pinned().source.tMyr; M.sim.cool();
M.sim.dG = 0.01; M.sim.tErupt = 29; M.sim.frame = 3; M.sim.evT = 0.25;
var snap = DEP.snapshotSection(S, { seed: P.seed, packChecksum: FIX.pinned().checksum, pack: FIX.pinned() });
var cat1 = DEP.generateCatalogue(snap), cat2 = DEP.generateCatalogue(snap);
check.ok('the scan is deterministic', cat1.checksum === cat2.checksum &&
	JSON.stringify(cat1.bodies) === JSON.stringify(cat2.bodies),
	cat1.inPlane + ' bodies in plane');
check.ok('the rejection ledger adds up',
	cat1.accepted === cat1.inPlane + cat1.outOfPlane + cat1.tooDeep + cat1.tooLarge,
	cat1.candidates + ' candidates, ' + cat1.accepted + ' accepted');
check.ok('the catalogue says where it came from',
	cat1.format === 'pgt-section-catalogue' && cat1.packChecksum === FIX.pinned().checksum &&
	cat1.snapshot === snap.checksum && cat1.tiles === snap.subtile * snap.nCol);
check.ok('every body passes the model\'s own validation',
	cat1.bodies.every(function (b) { return DEP.validate(b) === ''; }));
check.ok('bodies are sorted along the cut', cat1.bodies.every(function (b, i) {
	return i === 0 || cat1.bodies[i - 1].sKm <= b.sKm;
}));
check.ok('every body is inside the plane it claims',
	cat1.bodies.every(function (b) {
		return Math.abs(b.outOfPlaneKm) * KM <= Math.sqrt(b.fp.n2) + 1e-6;
	}));
var tileWith = cat1.bodies.length ? cat1.bodies[0].tile : 0;
var click = DEP.tileBodies(snap, tileWith);
var scanSubset = cat1.bodies.filter(function (b) { return b.tile === tileWith; });
check.ok('a click\'s tile returns exactly the scan\'s bodies for it',
	JSON.stringify(click) === JSON.stringify(scanSubset),
	click.length + ' of ' + cat1.bodies.length + ' bodies in tile ' + tileWith);
var snap2 = DEP.snapshotSection(S, { seed: P.seed, packChecksum: '0000000000000000', pack: FIX.pinned() });
var catOther = DEP.generateCatalogue(snap2);
check.ok('the pack checksum is part of the body identity',
	catOther.checksum !== cat1.checksum &&
	(cat1.bodies.length === 0 || catOther.bodies.every(function (b) {
		return b.id.indexOf('00000000') === 1 && b.packChecksum === '0000000000000000';
	})));
var round = DEP.parse(DEP.json(cat1));
check.ok('a catalogue round-trips through JSON exactly',
	JSON.stringify(round.bodies) === JSON.stringify(cat1.bodies) && round.checksum === cat1.checksum);
var tampered = JSON.parse(DEP.json(cat1));
tampered.bodies[0].oreTonnes *= 2;
var refused = false;
try { DEP.parse(JSON.stringify(tampered)); } catch (e) { refused = true; }
check.ok('an edited body is refused by the checksum', refused);
check.info('families', cat1.bodies.map(function (b) { return b.family; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(',') || 'none');

check.section('E. the instruments');
if (cat1.bodies.length) {
	var body = cat1.bodies[0];
	var log = DEP.drill(S, body.sKm, 20000, cat1);
	check.ok('a drill at a body\'s arc returns beds and the body',
		log && log.beds.length > 0 && log.deposits.some(function (d) { return d.id === body.id; }),
		log ? log.beds.length + ' beds, ' + log.deposits.length + ' bodies' : 'no log');
	var hit = log.deposits.filter(function (d) { return d.id === body.id; })[0];
	check.ok('the intersection brackets the body\'s centre depth',
		hit && hit.topM <= body.yM && hit.botM >= body.yM, hit ? hit.topM + '..' + hit.botM + ' m' : 'none');
	var shallow = DEP.drill(S, body.sKm, Math.max(1, Math.floor(body.yM - Math.sqrt(body.fp.u2) - 1)), cat1);
	check.ok('a drill that stops above the body does not report it',
		shallow && !shallow.deposits.some(function (d) { return d.id === body.id; }));
	var at = DEP.probe(cat1, body.sKm, body.yM, 0.1);
	check.ok('a probe at a body\'s centre finds it', at.some(function (b) { return b.id === body.id; }));
	var away = DEP.probe(cat1, body.sKm, body.yM + 4 * Math.sqrt(body.fp.u2) + 100 * KM, 5);
	check.ok('a probe outside the footprint does not', !away.some(function (b) { return b.id === body.id; }));
	var far = DEP.probe(cat1, body.sKm + 1000, body.yM, 5);
	check.ok('a probe far along the cut does not', !far.some(function (b) { return b.id === body.id; }));
} else {
	check.ok('the fixture catalogue has bodies to instrument', false, 'none in plane');
}
var col = 3;
var colLog = DEP.drill(S, DEP.columnKm(S, col), 5000, cat1);
check.ok('a drill at a column\'s own arc finds its beds', colLog && colLog.col === col,
	colLog ? 'column ' + colLog.col : 'none');

check.section('F. the section\'s own gate: click, scan, re-import');
// the session round trip must not change the catalogue: the identity is the pack checksum
// and the seed, and the world it read is restored by the checkpoint, not re-laid
var session = CP.saveSession();
var jsonSession = JSON.stringify(session);
var selfExport = SEED.exportSection({ pack: 'deposits-check' });
SEC.pack = FIX.pinned();
SEC.origin = 'paste';
SEC.world = true;
SEC.running = true;
SEC.t0 = FIX.pinned().source.tMyr;
M.sim.run(3);
CP.loadSession(jsonSession);
var catAfter = DEP.generateCatalogue(DEP.snapshotSection(S, {
	seed: P.seed, packChecksum: FIX.pinned().checksum, pack: FIX.pinned()
}));
check.ok('a session restore reproduces the catalogue bit for bit',
	catAfter.checksum === cat1.checksum, catAfter.inPlane + ' bodies');
check.ok('the self-exported pack carries the section\'s own host codes and a valid checksum',
	SP.validate(selfExport) === '' && SP.verify(selfExport) === '' &&
	selfExport.host.every(function (h) { return h < SP.HOSTS.length; }));
var relaid = SP.decode(SP.encode(selfExport));
check.ok('the self-export round-trips through the shared codec',
	relaid.checksum === selfExport.checksum && SP.validate(relaid) === '');
lay(FIX.pinned(), 11);
var snapBack = DEP.snapshotSection(S, { seed: P.seed, packChecksum: FIX.pinned().checksum, pack: FIX.pinned() });
var catBack = DEP.generateCatalogue(snapBack);
check.ok('the same pack and seed give the same catalogue from a re-import',
	catBack.checksum === cat1.checksum && JSON.stringify(catBack.bodies) === JSON.stringify(cat1.bodies));

check.section('G. the economics scenario screens, it does not generate');
var pos = 0, screened = 0;
cat1.bodies.forEach(function (b) {
	var s1 = DE.screen(b), s2 = DE.screen(b);
	if (s1.positive !== s2.positive || s1.net !== s2.net) screened++;
	if (s1.positive) pos++;
});
check.ok('screening a body twice is the same answer', screened === 0,
	pos + ' of ' + cat1.bodies.length + ' scenario-positive');
check.ok('the scenario reports value, opex, capex and a reason',
	cat1.bodies.every(function (b) {
		var s = DE.screen(b);
		return isFinite(s.value) && isFinite(s.opex || 0) && isFinite(s.capex) && typeof s.reason === 'string';
	}));
check.ok('the priors and the scenario are the shared versions', DM.version === 1 && DE.version === 1 &&
	DE.prices.Au === 65000000 && DM.slots === 2);

check.done();
