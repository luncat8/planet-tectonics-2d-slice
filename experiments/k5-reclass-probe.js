'use strict';
// K5 reclassification probe (report only, changes nothing).
//
// K4 freezes each neighbour pair's closing C-C kind (COL.freezeFloorClass) so K5 cannot
// revoke the floor K3/K4 solved. The freeze is cleared by the next K3 transport, which
// re-reads the kind live. This counts the pairs the freeze carried as closing C-C that the
// live classifier calls ordinary while their gap (after this frame's transport) sits inside
// the ordinary floor, so the rigid plate correction has to answer them, and it names the cause: a K5
// stage drained a record below P.hOceanic, or the plate velocities changed between the
// two solves. It also counts frames where a slot at or past nCol still carries absorbed
// shortening (S.edgeShort), which the m2 invariant forbids.
//
// Slots are matched by index. COL.transport floors before it sorts, and nothing reorders
// the columns between the K4 freeze and the next transport, so the frozen kinds line up
// with the slots the floor solve reads.
//
// usage: node experiments/k5-reclass-probe.js [seed=5] [schedule=100e3:5000]
//   schedule: kyrPerFrame:frames, comma separated, e.g. 100e3:1000,200e3:3000

var L = require('./lib.js'), check = L.check;
var P = L.mods.params, S = L.mods.state, COL = L.mods.columns, SIM = L.mods.sim;

var arg = process.argv.slice(2);
var seed = arg.length > 0 ? +arg[0] : 5;
var schedule = parseSchedule(arg.length > 1 ? arg[1] : '100e3:5000');
var ord = P.gFloor * P.w0;
var tally = { floorCalls: 0, reclassFrames: 0, reclassPairs: 0, drained: 0, velocity: 0,
	firstFrame: -1, maxDeficitM: 0, maxShiftM: 0, quietMaxShiftM: 0, staleTailFrames: 0 };
var frame = 0, before = new Float64Array(P.colCap), savedFloor = COL.floor;

function parseSchedule(text) {
	return text.split(',').map(function (part) {
		var p = part.split(':');
		return { rate: +p[0], frames: +p[1] };
	});
}

// the shorter way round the periodic domain
function gapOf(st, i, j) {
	var d = st.colX[j] - st.colX[i];
	if (d < 0) d += P.wrap;
	return d > 0.5 * P.wrap ? P.wrap - d : d;
}

// a pair the freeze holds as closing C-C that the live predicate no longer does, inside the
// ordinary floor; the cause is read off the hFel that K5 can change, and the deficit is how
// far the floor solve must push the pair apart to answer it
function countReclass(st, n) {
	var i, j, gap, pairs = 0;
	for (i = 0; i < n; i++) {
		j = i + 1 < n ? i + 1 : 0;
		if (st.colPlate[i] === st.colPlate[j]) continue;
		if (COL.floorClass[i] !== 1 || COL.isClosingCC(st, i, j)) continue;
		gap = gapOf(st, i, j);
		if (gap >= ord) continue;
		pairs++;
		if (ord - gap > tally.maxDeficitM) tally.maxDeficitM = ord - gap;
		if (st.hFel[i] < P.hOceanic || st.hFel[j] < P.hOceanic) tally.drained++;
		else tally.velocity++;
	}
	return pairs;
}

function staleTail(st) {
	var k;
	for (k = st.nCol; k < P.colCap; k++) if (st.edgeShort[k] !== 0) return true;
	return false;
}

COL.floor = function (st, n) {
	if (COL.floorClassValid) return savedFloor.call(this, st, n);
	var pairs, i, shift, worst = 0;
	tally.floorCalls++;
	pairs = countReclass(st, n);
	for (i = 0; i < n; i++) before[i] = st.colX[i];
	savedFloor.call(this, st, n);
	for (i = 0; i < n; i++) {
		shift = Math.abs(st.colX[i] - before[i]);
		if (shift > 0.5 * P.wrap) shift = P.wrap - shift;
		if (shift > worst) worst = shift;
	}
	if (pairs === 0) {
		if (worst > tally.quietMaxShiftM) tally.quietMaxShiftM = worst;
		return;
	}
	tally.reclassFrames++;
	tally.reclassPairs += pairs;
	if (tally.firstFrame < 0) tally.firstFrame = frame;
	if (worst > tally.maxShiftM) tally.maxShiftM = worst;
};

check.planet(seed);
for (var s = 0; s < schedule.length; s++) {
	SIM.setGeo(schedule[s].rate);
	for (var k = 0; k < schedule[s].frames; k++, frame++) {
		SIM.step();
		if (staleTail(S)) tally.staleTailFrames++;
	}
}
COL.floor = savedFloor;

console.log('K5 reclassification probe: seed ' + seed + ', schedule ' + (arg[1] || '100e3:5000') +
	', ' + frame + ' frames');
console.log('  transport floor solves ' + tally.floorCalls + '; next-frame reclassifications in ' +
	tally.reclassFrames + ' frames (' + tally.reclassPairs + ' pairs): ' + tally.drained +
	' from a K5 drain below P.hOceanic, ' + tally.velocity + ' from a velocity change');
console.log('  largest deficit (ordinary floor minus gap) ' + (tally.maxDeficitM / 1e3).toFixed(2) + ' km');
console.log('  first at frame ' + tally.firstFrame + '; largest column shift by the floor solve in those ' +
	'frames ' + (tally.maxShiftM / 1e3).toFixed(2) + ' km, in all other frames ' +
	(tally.quietMaxShiftM / 1e3).toFixed(2) + ' km');
console.log('  frames with absorbed shortening past nCol ' + tally.staleTailFrames);
