// pt-p4-erosion.js — 0.3.0 P4.3: particle weathering, erosion and sedimentation
// (0.3.0-p4-plan.md §3 P4.3). The law is the sweep's pick (experiments/pt-p4-transport-sweep.js):
// stream power E = kStream * sqrt(A) * slope, capped at eroMax, every column's material
// settling at the end of its own flow path. This harness is the pass's own acceptance:
//
//   A. route, law and move by hand on one controlled relief fixture (pt-p4-lib.js `relief()`):
//      the receiver map, the drainage peel and the demand table are recomputed here, a
//      hand-called pass closes mass, enthalpy, felsic, water and melt, books the sensible change
//      the P3.1 latent identity demands, balances its matched throughput books, lands on the
//      phase manifold, takes only from the shallowest in-band solid donor and never writes `zh`;
//   B. a long leg on the frozen fixture: the profile stays bitwise untouched, the high columns
//      lose and the basin floors gain exactly what they lost, the sediment is the P3 deposit
//      phase the inventory already counts, and on a linear flank demand ranks with drainage
//      area (same slope, more A, more E);
//   C. the sediment is P3.4's own deposit stock: a later landing finds the pass's pile and merges
//      into it instead of stacking a second one at the same place;
//   D. the live shipped planet at the demonstration clock, pass on and pass off: both close their
//      books, the pass's own sediment shows against the control, its frozen background attributes
//      the flux to the pass alone (high columns lose, low columns gain), and the pass costs a few
//      percent of the frame it lives in;
//   E. a live leg replays bitwise.
//
// Run: node experiments/pt-p4-erosion.js [liveMyr=300] [fixtureFrames=2000]
'use strict';

var path = require('path');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js'), SIM = require(B + 'sim.js');
var PHASE = require(B + 'phase.js'), POOL = require(B + 'pool.js');
var ERODE = require(B + 'erode.js'), FLIGHT = require(B + 'flight.js');
var L = require('./pt-p4-lib.js');

var LIVE = +(process.argv[2] || 300);
var FIXF = +(process.argv[3] || 2000);
var t0 = Date.now();
var ERO0 = P.ero, BAND0 = P.eroBand, TAKE0 = P.eroTake, FLOOR0 = P.eroMinM;
var K0 = P.kStream, MAX0 = P.eroMax, DEP0 = P.eroSlopeDep;

function restore() {
	P.ero = ERO0; P.eroBand = BAND0; P.eroTake = TAKE0; P.eroMinM = FLOOR0;
	P.kStream = K0; P.eroMax = MAX0; P.eroSlopeDep = DEP0;
}

// the P3.1 latent identity, read as the residual the P3 harnesses read it as
function latent() {
	POOL.inventoryComp(S);
	return (S.hLedger - S.ledger) - P.meltLat * (S.invLTot - S.invL0);
}

// Per-column total mass of every phase: the surface law changes a column's mass by moving it into
// the deposit stock, and the deposit is a phase inside the same column, so this is the reading
// that sees a column lose and its basin gain. A column sums ~1e5 km2 out of parcels of 1e0..1e4,
// so a naive sum's round-off (ulp of the running total) is 1e-8 km2 per column and would drown a
// transfer of 1e-2 km2: the reading is Neumaier-compensated, which puts its own resolution back
// under the arithmetic of the transfer.
var CM_ERR = null;
function colMass(out) {
	var nx = SIM.M.nx, dx = SIM.M.dx, p, i, sum, c;
	if (!out || out.length !== nx) out = new Float64Array(nx); else out.fill(0);
	if (!CM_ERR || CM_ERR.length !== nx) { CM_ERR = new Float64Array(nx); CM_ERR.fill(0); }
	else CM_ERR.fill(0);
	for (p = 0; p < S.n; p++) {
		i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
		sum = out[i] + S.m[p];
		c = CM_ERR[i];
		c += Math.abs(out[i]) >= Math.abs(S.m[p]) ? S.m[p] - (sum - out[i]) : out[i] - (sum - S.m[p]);
		out[i] = sum; CM_ERR[i] = c;
	}
	for (i = 0; i < nx; i++) out[i] += CM_ERR[i];
	return out;
}

// the relative difference between two readings of the same quantity
function scaled(a, b) {
	var s = Math.max(Math.abs(a), Math.abs(b));
	return s > 0 ? Math.abs(a - b) / s : Math.abs(a - b);
}

// the drainage area by walking every column's own path down the receiver map: an independent
// O(n^2) reading of the O(n) peel the pass runs
function areaByWalk() {
	var nx = SIM.M.nx, visits = new Int32Array(nx), out = new Float64Array(nx), w, i, g;
	for (w = 0; w < nx; w++) {
		i = w; g = 0;
		while (i >= 0 && g++ <= nx) { visits[i]++; i = S.erR[i]; }
	}
	for (i = 0; i < nx; i++) out[i] = visits[i] * SIM.M.dx;
	return out;
}

// the two mass-weighted heights a transport reading needs: where the mass came from and where it
// went. `up` is the mass that should not exist at all -- a column that gained while sitting
// higher than the column it drained from
function lift(before, after) {
	var nx = SIM.M.nx, i, d, lost = 0, gained = 0, yLost = 0, yGained = 0;
	for (i = 0; i < nx; i++) {
		d = after[i] - before[i];
		if (d < 0) { lost -= d; yLost -= d * S.zh[i]; }
		else if (d > 0) { gained += d; yGained += d * S.zh[i]; }
	}
	return { lost: lost, gained: gained, yLost: lost ? yLost / lost : 0,
		yGained: gained ? yGained / gained : 0, diff: lost ? yLost / lost - yGained / gained : 0 };
}

function basinCols() {
	var out = [], r, i, basins = L.basins();
	for (r = 0; r < basins.length; r++) for (i = basins[r][0]; i <= basins[r][1]; i++) out.push(i);
	return out;
}

// ------------------------------------------------------------------ A. the pass by hand
check.section('A. route, law and move by hand on the controlled relief fixture');

restore();
var M = L.configure();
L.relief();
var nx = M.nx, dx = M.dx, i, p, q, k;
// The 'cool' initial condition is felsic-free, so a transfer over it would move no felsic and no
// water and the two composition closure checks would close on nothing. Prescribe a pattern over
// the weathering band -- every column a different mix, a third of it water-bearing -- and put
// every parcel back on the phase manifold before the readings start, so the pass is asked to move
// a crust that has something to move. The equilibration is a hand call and books nothing, so the
// books are re-based after it: only the pass's own change is measured.
var masked = 0;
for (p = 0; p < S.n; p++) {
	if (!P.PH_SOLID[S.ph[p]] || S.y[p] > P.eroBand) continue;
	i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
	S.cF[p] = 0.1 + 0.4 * ((i % 5) / 4);
	S.cW[p] = (i % 3 === 0) ? 0.02 : 0.0;
	masked++;
}
PHASE.equil(M, S);
POOL.inventoryComp(S);
S.invL0 = S.invLTot; S.ledger = 0; S.hLedger = 0; S.wall = 0;
var sinks = L.sinks(), flats = L.flats(), basins = L.basins(), bcols = basinCols();
check.ok('the fixture carries a composition the pass can move',
	masked > nx && S.invFTot > 0 && S.invWTot > 0,
	masked + ' band parcels prescribe cF 0.1..0.5 and cW 0 or 0.02: the world holds '
	+ S.invFTot.toExponential(2) + ' km2 of felsic and ' + S.invWTot.toExponential(2) + ' km2 of water');
check.ok('the fixture starts with no sediment at all', S.invN[P.PH.dep] === 0 && S.n > nx,
	S.n + ' parcels, ' + S.invN[P.PH.dep] + ' of them deposits');
console.log('  fixture: ' + nx + ' columns x ' + dx + ' km, zh '
	+ Math.min.apply(null, S.zh).toFixed(2) + '..' + Math.max.apply(null, S.zh).toFixed(2)
	+ ' km, ' + S.n + ' parcels, ' + L.bandMass().reduce(function (a, b) { return a + b; }, 0).toFixed(0)
	+ ' km2 of rock in the ' + P.eroBand + ' km band below the surface');
console.log('  relief: divide at ' + L.RELIEF[2][0] + ', sinks at ' + sinks.join(', ')
	+ ', deposition reaches ' + flats.map(function (r) { return r[0] + '..' + r[1]; }).join(' ')
	+ ', so the basins are ' + basins.map(function (r) { return r[0] + '..' + r[1]; }).join(' '));

ERODE.route(M, S);
var badR = 0, badSink = 0, ip, im, dr, dl, want;
for (i = 0; i < nx; i++) {
	ip = i + 1 === nx ? 0 : i + 1; im = i === 0 ? nx - 1 : i - 1;
	dr = S.zh[i] - S.zh[ip]; dl = S.zh[i] - S.zh[im];
	want = (dr > 0 && dr >= dl) ? ip : (dl > 0 ? im : -1);
	if (S.erR[i] !== want) badR++;
	if ((S.erR[i] < 0) !== (sinks.indexOf(i) >= 0)) badSink++;
}
check.ok('every receiver is the steeper lower neighbour and every sink is one',
	badR === 0 && badSink === 0, badR + ' receiver mismatches, ' + badSink + ' sink mismatches');
var area = areaByWalk(), worstA = 0;
for (i = 0; i < nx; i++) worstA = Math.max(worstA, scaled(S.erA[i], area[i]));
check.ok('the drainage the peel accumulates equals a walk of every column\'s own path',
	worstA <= 1e-12, 'worst relative difference ' + worstA.toExponential(2) + ', mean area '
	+ L.mean(S.erA).toFixed(1) + ' km2, largest ' + Math.max.apply(null, S.erA).toFixed(0) + ' km2');

ERODE.law(M, S, SIM.dt);
var worstD = 0, nErode = 0, e, want0, r, sChan, worstS = 0, nLeft = 0, leftFace = 0;
for (i = 0; i < nx; i++) {
	r = S.erR[i];
	sChan = r < 0 ? 0 : (S.zh[i] - S.zh[r]) / dx;
	e = sChan > 0 ? P.kStream * Math.sqrt(S.erA[i]) * sChan : 0;
	if (e > P.eroMax) e = P.eroMax;
	want0 = e * SIM.dt * dx;
	worstD = Math.max(worstD, scaled(S.erD[i], want0));
	if (want0 > 0) nErode++;
	if (r >= 0) worstS = Math.max(worstS, scaled(S.erS[i], sChan));
	ip = i + 1 === nx ? 0 : i + 1;
	if (r >= 0 && r !== ip) {
		nLeft++;
		if (Math.abs(S.erS[i] - Math.abs(S.zh[ip] - S.zh[i]) / dx) < 1e-12
			&& Math.abs(sChan - Math.abs(S.zh[ip] - S.zh[i]) / dx) > 1e-6) leftFace++;
	}
}
check.ok('the demand table is kStream * sqrt(A) * channel-slope * dt * dx, recomputed from zh, sinks 0',
	worstD <= 1e-12 && nErode > nx / 2, 'worst relative difference ' + worstD.toExponential(2)
	+ ', ' + nErode + ' of ' + nx + ' columns erode, the ' + sinks.length + ' sinks get nothing');
var div = L.RELIEF[2][0], divL = div === 0 ? nx - 1 : div - 1, divR = div + 1 === nx ? 0 : div + 1;
check.ok('the slope the law reads is the drop to the receiver, not the right face',
	worstS <= 1e-12 && nLeft > 0 && leftFace === 0
	&& S.erR[div] === divL
	&& scaled(S.erS[div], (S.zh[div] - S.zh[divL]) / dx) <= 1e-12
	&& Math.abs(S.erS[div] - Math.abs(S.zh[divR] - S.zh[div]) / dx) > 1e-6,
	nLeft + ' left-draining columns, ' + leftFace + ' still on the right face; the divide at '
	+ div + ' drains to ' + S.erR[div] + ' at slope ' + S.erS[div].toExponential(2)
	+ ' against the right face ' + (Math.abs(S.zh[divR] - S.zh[div]) / dx).toExponential(2));
var flankUp = 45, flankDn = 60;
check.ok('on a linear flank demand ranks with drainage area (same slope, more A, more E)',
	scaled(S.erS[flankUp], S.erS[flankDn]) <= 1e-12
	&& S.erA[flankDn] > S.erA[flankUp] && S.erD[flankDn] > S.erD[flankUp],
	'columns ' + flankUp + '/' + flankDn + ' slope ' + S.erS[flankUp].toExponential(2)
	+ '/' + S.erS[flankDn].toExponential(2) + ', A ' + S.erA[flankUp].toFixed(0)
	+ '/' + S.erA[flankDn].toFixed(0) + ' km2, demand ' + S.erD[flankUp].toExponential(2)
	+ '/' + S.erD[flankDn].toExponential(2) + ' km2');

// one hand-called pass: who loses, who gains, and what the receiving parcel is left looking like
var zh0 = Float64Array.from(S.zh), m0 = Float64Array.from(S.m.subarray(0, S.n));
var cm0 = colMass(), site0 = Int32Array.from(S.erSite), dem0 = Float64Array.from(S.erD);
var n0 = S.n, bA = L.books(), idA = latent(), hA = S.hash();
var txA = S.tx.ero, drA = S.thr.eroDr, ledA = S.ledger, depA = S.invM[P.PH.dep];
ERODE.run(M, S, SIM.dt);
var bB = L.books(), idB = latent(), hB = S.hash();
var cm1 = colMass(), lift0 = lift(cm0, cm1);
var moved = S.thr.eroCr - drA, srcMass = lift0.lost, siteMass = lift0.gained;
var zhSame = true, worstTake = 0, donors = 0, badDonor = 0;
var badDeep = 0, shallow = 0, deep = 0, badShallow = 0, m0p = 0;
for (i = 0; i < nx; i++) if (zh0[i] !== S.zh[i]) zhSame = false;
for (p = 0; p < n0; p++) {                                 // only a pre-existing parcel can donate
	var lost = m0[p] - S.m[p];
	if (lost === 0) continue;
	donors++;
	if (!P.PH_SOLID[S.ph[p]] || S.y[p] > P.eroBand || S.m[p] < P.eroMinM - 1e-12
		|| lost > P.eroTake * m0[p] + 1e-12) { badDonor++; continue; }
	i = Math.round(S.x[p] / dx); i -= Math.floor(i / nx) * nx;
	shallow = 0; deep = 0;
	for (q = 0; q < n0; q++) {
		if (q === p || !P.PH_SOLID[S.ph[q]]) continue;
		var j = Math.round(S.x[q] / dx); j -= Math.floor(j / nx) * nx;
		if (j !== i || S.y[q] > P.eroBand) continue;
		if (S.y[q] < S.y[p]) { shallow++; break; }             // a parcel above p in its column
		if (S.y[q] === S.y[p] && q < p) { shallow++; break; }  // the tie the walk breaks by slot
	}
	if (shallow) badShallow++;
	worstTake = Math.max(worstTake, lost / m0[p]);
	badDeep += S.y[p] > P.eroBand ? 1 : 0;
}
// two readings of the same demand table: the mass that crossed a column boundary (the column
// bookkeeping, which cannot see an in-place transfer) and the mass the law takes from columns
// whose material settles inside their own column. The second is what makes the first smaller
// than the throughput, and it is measured before the call so the check is not a tautology.
var demInPlace = 0, uphill = 0, downhill = 0;
for (i = 0; i < nx; i++) {
	if (!(dem0[i] > 0)) continue;
	if (site0[i] === i) { demInPlace += dem0[i]; continue; }
	if (cm1[i] < cm0[i]) {
		if (S.zh[site0[i]] < S.zh[i]) downhill += cm0[i] - cm1[i];
		else uphill += cm0[i] - cm1[i];
	}
}
check.info('one hand-called pass', S.d.ero + ' transfers moved ' + moved.toFixed(6) + ' km2 of '
	+ (moved / S.erD.reduce(function (a, b) { return a + b; }, 0) * 100).toFixed(1)
	+ '% of the demand, from ' + donors + ' donors (worst take ' + (100 * worstTake).toFixed(1)
	+ '% of a parcel) into ' + S.d.eroNew + ' fresh deposit parcels');
check.ok('mass, enthalpy, felsic and water close across the pass',
	scaled(bB.M, bA.M) <= 1e-12 && scaled(bB.H, bA.H) <= 1e-12
	&& scaled(bB.F, bA.F) <= 1e-12 && scaled(bB.W, bA.W) <= 1e-12,
	'mass ' + scaled(bB.M, bA.M).toExponential(2) + ', enthalpy ' + scaled(bB.H, bA.H).toExponential(2)
	+ ', felsic ' + scaled(bB.F, bA.F).toExponential(2) + ', water ' + scaled(bB.W, bA.W).toExponential(2));
check.ok('the P3.1 latent identity holds across the transfer and the sensible ledger moved',
	Math.abs(idB - idA) <= 1e-9 * Math.abs(bA.H) && S.ledger !== ledA,
	'identity shift ' + (idB - idA).toExponential(2) + ' of ' + bA.H.toExponential(2)
	+ ', ledger +' + (S.ledger - ledA).toExponential(2) + ' with ' + S.d.ero + ' transfers');
check.ok('the transferred mass is what left the sources and reached the sites',
	scaled(srcMass, siteMass) <= 1e-8 && srcMass > 0 && siteMass > 0,
	'columns lost ' + srcMass.toFixed(9) + ' km2 and gained ' + siteMass.toFixed(9)
	+ ' km2, and the throughput ' + moved.toFixed(9) + ' km2 is that plus the '
	+ (moved - srcMass).toFixed(9) + ' km2 that settled where it was taken (a column holds 1.6e5'
	+ ' km2, so its own naive sum would resolve only 1e-8 of that)');
check.ok('the sediment is deposit-phase mass the P3 inventory counts once',
	S.thr.eroDr === S.thr.eroCr && scaled(S.invM[P.PH.dep] - depA, moved) <= 1e-12
	&& S.d.eroM === moved,
	'the deposit stock grew by ' + (S.invM[P.PH.dep] - depA).toFixed(6) + ' km2 in '
	+ S.invN[P.PH.dep] + ' parcels against the ' + moved.toFixed(6) + ' km2 booked, '
	+ 'debit = credit = ' + S.thr.eroDr.toFixed(6) + ' km2');
check.ok('every take is from the shallowest in-band solid donor, above the take floor',
	donors > 0 && badDonor === 0 && badShallow === 0 && badDeep === 0,
	donors + ' donors, ' + badDonor + ' breaking the take rule, ' + badShallow
	+ ' not the shallowest in their column, ' + badDeep + ' outside the band');
check.ok('no transfer lands uphill: every column that lost mass drained to a lower column',
	uphill === 0 && downhill > 0 && S.d.eroWant === 0,
	downhill.toFixed(6) + ' km2 left the columns it was taken from and landed below them, '
	+ demInPlace.toFixed(6) + ' km2 settled in place (a reach under the deposition slope), '
	+ uphill.toExponential(2) + ' km2 uphill, ' + S.d.eroWant.toExponential(2) + ' km2 unmet');

// the credited parcels: deposits seated on their site column, on the phase manifold
var seats = 0, seatBad = 0;
for (i = 0; i < nx; i++) {
	q = S.erDep[i];
	if (q < 0) continue;
	seats++;
	if (S.ph[q] !== P.PH.dep || Math.abs(S.x[q] - i * dx) > 1e-9
		|| S.y[q] !== -S.zh[i]) { seatBad++; continue; }
	PHASE.byH(S.H[q], S.y[q], S.cF[q], S.cW[q]);
	if (PHASE.out.t !== S.T[q] || Math.abs(PHASE.out.melt - S.melt[q]) > 1e-12) seatBad++;
}
// the sediment's composition: whatever left the donors is what the credited parcels hold, so the
// pile's cF and cW are the mass-weighted mix of the columns above it -- read from the two sides
// separately (the losers' loss against the winners' stock) rather than restated from the transfer
var depM3 = 0, depF = 0, depW = 0, srcM = 0, srcF = 0, srcW = 0;
for (p = 0; p < S.n; p++) if (S.ph[p] === P.PH.dep) {
	depM3 += S.m[p]; depF += S.m[p] * S.cF[p]; depW += S.m[p] * S.cW[p];
}
for (p = 0; p < n0; p++) {
	m0p = m0[p] - S.m[p];
	if (m0p === 0) continue;
	srcM += m0p; srcF += m0p * S.cF[p]; srcW += m0p * S.cW[p];
}
check.ok('the sediment carries the source rock\'s composition, mass-weighted',
	scaled(depM3, srcM) <= 1e-9 && scaled(depF, srcF) <= 1e-9 && scaled(depW, srcW) <= 1e-9
	&& depM3 > 0,
	'the ' + S.d.eroNew + ' credited parcels hold ' + depM3.toFixed(6) + ' km2 at cF '
	+ (depF / depM3).toFixed(4) + ' and cW ' + (depW / depM3).toFixed(4) + ' against the cF '
	+ (srcF / srcM).toFixed(4) + ' and cW ' + (srcW / srcM).toFixed(4) + ' that left the '
	+ 'donors (the fixture runs cF 0.1..0.5, cW 0 or 0.02)');

check.ok('the credited parcels are deposits seated on their site column, on the manifold',
	seats >= 2 && seatBad === 0, seats + ' site seats, ' + seatBad + ' off-seat or off-manifold');

var hPause = S.hash(), movedOn = S.thr.eroCr, dEro = S.d.ero;
ERODE.run(M, S, 0);
var okPause = S.hash() === hPause;
P.ero = false;
ERODE.run(M, S, SIM.dt);
var okOff = S.hash() === hPause && S.d.ero === 0 && S.thr.eroCr === movedOn;
P.ero = true;
check.ok('dt = 0 leaves the state alone and P.ero off clears the frame diagnostics',
	okPause && okOff && hA !== hB && dEro > 0 && zhSame,
	hA + ' -> ' + hB + ', paused and disabled both leave ' + S.hash()
	+ ' (d.ero 0, throughput still ' + S.thr.eroCr.toFixed(6) + ' km2, zh untouched ' + zhSame + ')');

// two deposits in one site column: the seat is the shallowest, not the first slot, and a
// transfer into that site credits the surface pile, not the buried one.
restore();
M = L.configure();
L.relief();
nx = M.nx; dx = M.dx;
ERODE.route(M, S);
var srcCol = 100, iSeat = S.erSite[srcCol];
var buried = POOL.admit(S, P.PH.dep), surf = POOL.admit(S, P.PH.dep);
S.x[buried] = iSeat * dx; S.y[buried] = 40; S.e[buried] = Math.asinh(40 / M.yLin); S.m[buried] = 80;
S.x[surf] = iSeat * dx; S.y[surf] = -S.zh[iSeat];
S.e[surf] = Math.asinh(S.y[surf] / M.yLin); S.m[surf] = 80;
ERODE.route(M, S);
check.ok('the site seat is the shallowest in-band deposit, not the lowest slot',
	surf > buried && S.erDep[iSeat] === surf && iSeat !== srcCol,
	'slots buried ' + buried + ' then surface ' + surf + ', seat ' + S.erDep[iSeat]
	+ ', source column ' + srcCol + ' deposits at ' + iSeat);
ERODE.law(M, S, SIM.dt);
ERODE.move(M, S);
check.ok('a transfer into that site credits the surface pile and leaves the buried one alone',
	S.m[surf] > 80 && S.m[buried] === 80,
	'surface ' + S.m[surf].toFixed(4) + ' km2, buried ' + S.m[buried].toFixed(4) + ' km2');

// ------------------------------------------------------------------ B. the frozen fixture leg
check.section('B. ' + FIXF + ' frames on the frozen fixture: the profile stands, the basins fill');

function fixtureLeg(frames) {
	restore();
	L.configure();
	L.relief();
	POOL.inventoryComp(S);
	var zh1 = Float64Array.from(S.zh), cmA = colMass(), band0 = L.bandMass();
	var depN0 = S.invN[P.PH.dep], depM0 = S.invM[P.PH.dep];
	var tx0 = S.tx.ero, moved0 = S.thr.eroCr, short0 = S.eroShort, ms = 0, t1, k2;
	var dem = 0;
	for (k2 = 0; k2 < frames; k2++) {
		t1 = Date.now();
		ERODE.run(M, S, SIM.dt);
		ms += Date.now() - t1;
	}
	var cmB = colMass(), L2 = lift(cmA, cmB), band1 = L.bandMass();
	POOL.inventoryComp(S);
	var zhSame2 = true;
	for (i = 0; i < nx; i++) if (zh1[i] !== S.zh[i]) zhSame2 = false;
	// where the legs' material went, against the fixture's own basins
	var basinGain = 0, basinLost = 0, b;
	for (b = 0; b < bcols.length; b++) {
		var d = cmB[bcols[b]] - cmA[bcols[b]];
		if (d > 0) basinGain += d; else basinLost -= d;
	}
	// the drainage table the last frame ran on: how concentrated the work is. A's share is the
	// law's own sqrt(A) saying where the trunk is
	for (i = 0; i < nx; i++) dem += S.erD[i];
	var sorted = Float64Array.from(S.erD).sort();
	var top = 0, cut = Math.round(0.1 * nx);
	for (i = nx - cut; i < nx; i++) top += sorted[i];
	var bandSum0 = 0, bandSum1 = 0, minBand = 1e30;
	for (i = 0; i < nx; i++) { bandSum0 += band0[i]; bandSum1 += band1[i]; minBand = Math.min(minBand, band1[i]); }
	return { ms: ms / frames, zhSame: zhSame2, L: L2, cmA: cmA, cmB: cmB, moved: S.thr.eroCr - moved0,
		tx: S.tx.ero - tx0, short: S.eroShort - short0, depN: S.invN[P.PH.dep] - depN0,
		depM: S.invM[P.PH.dep] - depM0, basinGain: basinGain, basinLost: basinLost,
		share: dem > 0 ? top / dem : 0, dem: dem, divide: S.erD[L.RELIEF[2][0]],
		band0: bandSum0, band1: bandSum1, minBand: minBand, meanBand: bandSum1 / nx,
		hash: S.hash(), n: S.n };
}

var fix1 = fixtureLeg(FIXF), fix2 = fixtureLeg(FIXF);
check.ok('the pass never writes the profile: zh is bitwise unchanged over the whole leg',
	fix1.zhSame, 'zh identical after ' + FIXF + ' frames of erosion');
check.ok('the columns that lose mass lose it to the basins, and the basins gain all of it',
	scaled(fix1.L.lost, fix1.L.gained) <= 1e-8 && fix1.L.lost > 0
	&& scaled(fix1.basinGain, fix1.L.gained) <= 1e-8,
	'columns lost ' + fix1.L.lost.toFixed(6) + ' km2 and gained ' + fix1.L.gained.toFixed(6)
	+ ' km2, of which the basins took +' + fix1.basinGain.toFixed(6) + ' km2');
check.ok('the mass travelled downhill: the columns that lose sit above the columns that gain',
	fix1.L.yLost > fix1.L.yGained && fix1.L.diff > 0.5,
	'sources at ' + fix1.L.yLost.toFixed(3) + ' km above the datum, sites at '
	+ fix1.L.yGained.toFixed(3) + ' km, a mean fall of ' + fix1.L.diff.toFixed(3) + ' km');
check.info('the fixture leg', fix1.tx + ' transfers moved ' + fix1.moved.toFixed(3) + ' km2 in '
	+ FIXF + ' frames (' + (100 * fix1.moved / (fix1.dem * FIXF)).toFixed(1) + '% of the demand), '
	+ fix1.ms.toFixed(3) + ' ms/frame, ' + fix1.short.toExponential(2) + ' km2 unmet');
check.ok('the sediment is the P3 inventory\'s own deposit stock, not a second pool',
	fix1.depN >= 2 && scaled(fix1.depM, fix1.moved) <= 1e-12,
	fix1.depN + ' deposit parcels hold ' + fix1.depM.toFixed(6) + ' km2 against the '
	+ fix1.moved.toFixed(6) + ' km2 the leg moved: the same mass, counted once');
check.ok('the work is concentrated in the trunk: the top decile carries more than twice a uniform share',
	fix1.share > 0.20,
	'the top 10% of columns carry ' + (100 * fix1.share).toFixed(1) + '% of a frame\'s demand, '
	+ 'the divide at column ' + L.RELIEF[2][0] + ' ' + fix1.divide.toExponential(2)
	+ ' km2 against ' + (fix1.dem / nx).toExponential(2) + ' km2 a column on average');
check.ok('the band keeps its own mass and starves no column: rock turns to sediment in place',
	scaled(fix1.band1, fix1.band0) <= 1e-9 && fix1.minBand > 0.5 * fix1.meanBand
	&& fix1.short === 0,
	'the band holds ' + fix1.band1.toFixed(0) + ' km2 against ' + fix1.band0.toFixed(0)
	+ ' km2 before the leg, the lightest column ' + fix1.minBand.toFixed(0)
	+ ' km2 against ' + fix1.meanBand.toFixed(0) + ' km2 on average, nothing unmet');
check.ok('the leg repeats bitwise', fix1.hash === fix2.hash && fix1.tx === fix2.tx,
	'fingerprint ' + fix1.hash + ' both times, ' + fix1.tx + ' transfers against ' + fix2.tx);

// ------------------------------------------------------------------ C. the sediment is P3.4's stock
check.section('C. the sediment is the deposit stock P3.4 lands into');

var big = -1, bigM = -1;
for (i = 0; i < nx; i++) {
	q = S.erDep[i];
	if (q >= 0 && S.m[q] > bigM) { bigM = S.m[q]; big = q; }
}
POOL.inventoryComp(S);
var site = Math.round(S.x[big] / dx) % nx, depN1 = S.invN[P.PH.dep], mergeA = S.tx.merge;
var airM = 10, airCF = S.cF[big], airCW = S.cW[big];
q = POOL.admit(S, P.PH.air);
S.x[q] = site * dx; S.y[q] = -S.zh[site] - 5; S.m[q] = airM; S.cF[q] = airCF; S.cW[q] = airCW;
PHASE.byT(0.3, S.y[q], airCF, airCW); S.H[q] = PHASE.out.h; S.T[q] = PHASE.out.t;
S.melt[q] = PHASE.out.melt;
var airId = S.id[q];                                    // the merge closes this slot
var landed = FLIGHT.land(M, S, q);
check.ok('a later landing finds the erosion\'s pile and merges into it',
	landed && S.tx.merge === mergeA + 1 && S.invN[P.PH.dep] === depN1
	&& Math.abs(S.m[big] - (bigM + airM)) < 1e-9 && S.id[big] < airId,
	'the pile at column ' + site + ' held ' + bigM.toFixed(3) + ' km2 under id ' + S.id[big]
	+ ', a ' + airM + ' km2 batch landed on it: still ' + S.invN[P.PH.dep] + ' deposit parcels, '
	+ 'the pile now holds ' + S.m[big].toFixed(3) + ' km2 and keeps the older id');

// ------------------------------------------------------------------ D. the live planet
check.section('D. the live shipped planet at ' + LIVE + ' Myr, pass on and pass off');

function liveLeg(myr, ero) {
	restore();
	P.ero = ero;
	L.livePlanet();
	POOL.inventoryComp(S);
	S.invL0 = S.invLTot;
	var b0 = L.books(), cmA = colMass(), depN0 = S.invN[P.PH.dep], depM0 = S.invM[P.PH.dep];
	var tx0 = S.tx.ero, moved0 = S.thr.eroCr, short0 = S.eroShort, ref0 = S.tx.refuse;
	var hLed0 = S.hLedger;
	var frames = Math.round(myr / SIM.dt), k3, t2, ms = 0, absZh = 0;
	for (k3 = 0; k3 < frames; k3++) {
		t2 = Date.now();
		SIM.step();
		ms += Date.now() - t2;
	}
	var b1 = L.books(), cmB = colMass(), L2 = lift(cmA, cmB);
	POOL.inventoryComp(S);
	for (i = 0; i < nx; i++) absZh = Math.max(absZh, Math.abs(S.zh[i]));
	return { ms: ms / frames, mErr: b1.M - b0.M, m0: b0.M, hErr: b1.H - b0.H, h0: b0.H,
		hLed: S.hLedger - hLed0, id: latent(), tx: S.tx.ero - tx0, moved: S.thr.eroCr - moved0,
		short: S.eroShort - short0,
		depN: S.invN[P.PH.dep] - depN0, depM: S.invM[P.PH.dep] - depM0, ref: S.tx.refuse - ref0,
		L: L2, hash: S.hash(), n: S.n, zh: absZh, band: L.bandMass().reduce(function (a, b) { return a + b; }, 0) };
}

var on = liveLeg(LIVE, true), off = liveLeg(LIVE, false);
check.info('live, pass on', on.tx + ' transfers moved ' + on.moved.toFixed(1) + ' km2 of the band '
	+ 'in ' + Math.round(LIVE / SIM.dt) + ' frames; the world ends with ' + on.depM.toFixed(0)
	+ ' km2 of sediment in ' + on.depN + ' parcels (none at t = 0), ' + on.short.toExponential(2)
	+ ' km2 unmet, ' + on.ms.toFixed(2) + ' ms/frame, ' + on.n + ' parcels, relief to '
	+ on.zh.toFixed(2) + ' km');
check.info('live, pass off', 'the same planet without the pass: ' + off.depM.toFixed(0)
	+ ' km2 of deposit in ' + off.depN + ' parcels (the flight path\'s own), '
	+ (off.band - on.band).toFixed(0) + ' km2 more band mass, ' + off.ms.toFixed(2) + ' ms/frame, '
	+ off.n + ' parcels, relief to ' + off.zh.toFixed(2) + ' km');
check.ok('mass, enthalpy and the latent identity close on both legs',
	on.mErr === 0 && off.mErr === 0
	&& Math.abs(on.hErr - on.hLed) <= 1e-9 * Math.abs(on.hLed)
	&& Math.abs(off.hErr - off.hLed) <= 1e-9 * Math.abs(off.hLed)
	&& Math.abs(on.id) <= 1e-12 * Math.abs(on.hLed) && Math.abs(off.id) <= 1e-12 * Math.abs(off.hLed),
	'mass ' + on.mErr.toExponential(2) + '/' + off.mErr.toExponential(2) + ' of '
	+ on.m0.toExponential(2) + '; the enthalpy stock moved by what the frames booked in to '
	+ ((on.hErr - on.hLed) / on.hLed).toExponential(2) + '/' + ((off.hErr - off.hLed) / off.hLed).toExponential(2)
	+ '; the latent identity closed to ' + on.id.toExponential(2) + '/' + off.id.toExponential(2)
	+ ' of the ' + on.hLed.toExponential(2) + ' km2*H intake');
check.ok('the pass\'s own sediment shows against the control',
	on.tx > 0 && off.tx === 0 && on.depN >= off.depN && on.depM > off.depM
	&& on.hash !== off.hash,
	'on: ' + on.tx + ' transfers, ' + on.depN + ' parcels, ' + on.depM.toFixed(0) + ' km2 of new '
	+ 'sediment; off: ' + off.tx + ' transfers, ' + off.depN + ' parcels, '
	+ off.depM.toFixed(0) + ' km2; the fingerprints differ (' + on.hash + ' against ' + off.hash + ')');
check.ok('nothing is refused, the starvation stays a bound and the band survives the run',
	on.ref === 0 && off.ref === 0 && on.short < 0.01 * on.moved
	&& on.band > 0.9 * off.band,
	on.ref + '/' + off.ref + ' refusals, ' + on.short.toFixed(1) + ' km2 unmet against '
	+ on.moved.toFixed(0) + ' km2 moved (' + (100 * on.short / on.moved).toFixed(2)
	+ '%), band mass ' + on.band.toFixed(0) + ' against ' + off.band.toFixed(0) + ' km2 off');
// the pass's own attribution, on a live state with the background frozen: every other kernel
// writes to the band too, so only a frozen background attributes the flux to the pass alone
restore();
L.livePlanet();
for (i = 0; i < 100; i++) SIM.step();
P.ero = true;
var cmF = colMass(), zMean = 0, frames = Math.round(LIVE / SIM.dt);
var short1 = S.eroShort, tx1 = S.tx.ero, moved1 = S.thr.eroCr, depF0 = S.invM[P.PH.dep];
for (i = 0; i < nx; i++) zMean += S.zh[i];
zMean /= nx;
var t3, ms1 = 0, k4;
for (k4 = 0; k4 < frames; k4++) {
	t3 = Date.now();
	ERODE.run(M, S, SIM.dt);
	ms1 += Date.now() - t3;
}
var cmG = colMass(), LF = lift(cmF, cmG), high = 0, low = 0;
POOL.inventoryComp(S);
for (i = 0; i < nx; i++) {
	var dz = cmG[i] - cmF[i];
	if (S.zh[i] > zMean) high += dz; else low += dz;
}
check.info('the pass alone on a frozen frame', (S.tx.ero - tx1) + ' transfers moved '
	+ (S.thr.eroCr - moved1).toFixed(1) + ' km2 in ' + frames + ' frames at ' + ms1 / frames
	+ ' ms/frame: the columns above the mean height ' + (high < 0 ? 'lost ' : 'gained ')
	+ Math.abs(high).toFixed(1) + ' km2 and those below it ' + (low > 0 ? 'gained ' : 'lost ')
	+ Math.abs(low).toFixed(1) + ' km2');
check.ok('the pass alone moves material downhill: the losing columns sit above the gaining ones',
	LF.lost > 0 && LF.gained > 0 && scaled(LF.lost, LF.gained) <= 1e-9 && LF.diff > 0,
	'mass out ' + LF.lost.toFixed(3) + ' km2 at ' + LF.yLost.toFixed(3) + ' km mean height, in '
	+ LF.gained.toFixed(3) + ' km2 at ' + LF.yGained.toFixed(3) + ' km: a fall of '
	+ LF.diff.toFixed(3) + ' km');
check.ok('the frozen leg closes its books and banks every gram in the deposit stock',
	scaled(S.invM[P.PH.dep] - depF0, S.thr.eroCr - moved1) <= 1e-9 && S.tx.refuse === 0,
	'the deposit stock grew by ' + (S.invM[P.PH.dep] - depF0).toFixed(3) + ' km2 against the '
	+ (S.thr.eroCr - moved1).toFixed(3) + ' km2 moved (' + (S.eroShort - short1).toExponential(2)
	+ ' km2 unmet), 0 refusals');

// the cost is the pass's own arithmetic, timed on the same state the frame runs on: the frame with
// the pass on is also a different frame (it carries the sediment parcels the pass admitted), so the
// on/off difference is a trajectory, not a stopwatch
check.ok('the pass is a few percent of the frame it lives in',
	ms1 / frames < 0.05 * on.ms && ms1 / frames < 1,
	(ms1 / frames).toFixed(3) + ' ms/frame for the pass alone against ' + on.ms.toFixed(2)
	+ ' ms/frame for the step it lives in (' + (100 * ms1 / frames / on.ms).toFixed(2) + '%)');
check.info('the frame it lives in', on.ms.toFixed(2) + ' ms/frame with the pass against '
	+ off.ms.toFixed(2) + ' ms/frame without it (' + (100 * (on.ms - off.ms) / off.ms).toFixed(2)
	+ '%: the pass admitted ' + on.depN + ' sediment parcels, and the crust pass carries them too,'
	+ ' so the difference is a trajectory and not a stopwatch)');


// ------------------------------------------------------------------ E. the replay
check.section('E. the same planet, twice');

function shortLeg(frames) {
	restore();
	L.livePlanet();
	var k5, h;
	for (k5 = 0; k5 < frames; k5++) SIM.step();
	h = S.hash();
	return { hash: h, tx: S.tx.ero, moved: S.thr.eroCr, n: S.n };
}
var s1 = shortLeg(200), s2 = shortLeg(200);
check.ok('two identical live legs land on the same complete-state fingerprint',
	s1.hash === s2.hash && s1.tx === s2.tx && s1.n === s2.n,
	'fingerprint ' + s1.hash + ' both times, ' + s1.tx + ' transfers, ' + s1.moved.toFixed(3)
	+ ' km2 moved, ' + s1.n + ' parcels');

restore();
check.info('wall time', ((Date.now() - t0) / 1000).toFixed(0) + ' s for '
	+ (2 * LIVE + 400 * SIM.dt + 2 * FIXF * SIM.dt).toFixed(0) + ' Myr of simulation');
check.done();
