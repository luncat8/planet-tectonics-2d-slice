// pt-drift-census.js — 0.3.2 M11: continuous slow-episode census and late-drift distribution
//
// Measures continuous plate kinematics, drift speed distributions, slow-plate episodes,
// and physical attribution (kinematic drive vs subduction override hold vs arrest brake)
// across a seed distribution over 600 Myr at 50 kyr/frame.
//
// Run: node experiments/pt-drift-census.js [--seed N] [--unbound] [--kyr 50] [--myr 600] [--out file.json]
//      node experiments/pt-drift-census.js --batch (runs seeds 1,3,5,7 bound & unbound)
'use strict';

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');
var check = require('./lib.js').check;
var B = path.join(__dirname, '..', 'js', 'pt') + path.sep;
var P = require(B + 'params.js'), S = require(B + 'state.js');
var SIM = require(B + 'sim.js'), G = require(B + 'grid.js');
var CONTACT = require(B + 'contact.js'), SC = require(B + 'solid.js');

function option(name) {
	var i = process.argv.indexOf(name);
	return i < 0 ? null : process.argv[i + 1];
}

if (process.argv.includes('--batch')) {
	runBatch();
} else {
	runSingle();
}

function runSingle() {
	var UNBOUND = process.argv.includes('--unbound');
	var SEED = option('--seed') ? +option('--seed') : 1;
	var KYR = option('--kyr') ? +option('--kyr') : 50;
	var MYR = option('--myr') ? +option('--myr') : 600;
	var OUT = option('--out');

	P.ic = 'cool'; P.icMode = 4; P.icAmp = 0.02; P.icBand = 0.6; P.icBandMax = 12; P.seed = SEED;
	P.solid = true; P.sl.kyr = KYR;
	P.ero = true;
	P.depBound = UNBOUND ? 0 : 0.25;

	SIM.init(); SIM.reset(); SIM.dt = KYR / 1000;
	var M = SIM.M;

	var preBrakeVX = new Float64Array(1024);
	var postBrakeVX = new Float64Array(1024);
	var brakeDV = new Float64Array(1024);
	var holdCount = new Int32Array(1024);
	var arrestCount = new Int32Array(1024);

	var origDetect = CONTACT.detect;
	var origBrake = CONTACT.brake;

	CONTACT.detect = function (M, S, dt) {
		for (var c = 0; c < S.csN; c++) {
			preBrakeVX[c] = S.csVX[c];
			holdCount[c] = 0;
			arrestCount[c] = 0;
		}
		origDetect.call(CONTACT, M, S, dt);
		var nx = M.nx, dx = M.dx, K = P.ctTop;
		for (var i = 0; i < nx; i++) {
			var ip = i + 1 === nx ? 0 : i + 1;
			for (var a = 0; a < S.ctN[i]; a++) {
				for (var b = 0; b < S.ctN[ip]; b++) {
					var ca = S.ctCl[i * K + a], cb = S.ctCl[ip * K + b];
					if (ca === cb) continue;
					var closing = (S.ctV[i * K + a] - S.ctV[ip * K + b]) / dx;
					if (closing <= P.contactYield) continue;
					var dT = S.ctT[i * K + a] - S.ctT[ip * K + b];
					if (Math.abs(dT) < P.contactdT) {
						arrestCount[ca]++; arrestCount[cb]++;
					} else {
						var sub = dT >= 0 ? 1 : 0;
						if (sub === 0) holdCount[cb]++;
						else holdCount[ca]++;
					}
				}
			}
		}
	};

	CONTACT.brake = function (M, S) {
		for (var c = 0; c < S.csN; c++) {
			if (S.csBN[c]) brakeDV[c] = S.csBX[c] / S.csBN[c];
			else brakeDV[c] = 0;
		}
		origBrake.call(CONTACT, M, S);
		for (var c = 0; c < S.csN; c++) {
			postBrakeVX[c] = S.csVX[c];
		}
	};

	var totalFrames = Math.round(MYR / SIM.dt);
	var framesWithPlates = 0;
	var lateFrames = 0, lateFramesWithPlates = 0;
	var lateMassWeightedSpeedSum = 0, lateMassSum = 0;
	var allMassWeightedSpeedSum = 0, allMassSum = 0;

	// Bins: [ <0.1, 0.1..0.5, 0.5..1.0, 1.0..2.0, 2.0..5.0, >=5.0 ]
	var speedBins = [0, 0, 0, 0, 0, 0];
	var speedBinMass = [0, 0, 0, 0, 0, 0];
	var lateSpeedBins = [0, 0, 0, 0, 0, 0];
	var lateSpeedBinMass = [0, 0, 0, 0, 0, 0];

	var slowAttribution = { holdBrake: 0, arrestBrake: 0, kinematicLow: 0 };
	var lateSlowAttribution = { holdBrake: 0, arrestBrake: 0, kinematicLow: 0 };

	// Episodes of slow plate (< 0.5 cm/yr)
	var curSlowEpisode = 0, maxSlowEpisode = 0, totalSlowEpisodeFrames = 0, slowEpisodeCount = 0;
	var inSlowEpisode = false;

	// Snapshots at 100, 200, 300, 400, 500, 600 Myr
	var snapMarks = [100, 200, 300, 400, 500, 600];
	var nextSnap = 0;
	var snapshots = [];

	var ringR2 = P.ringMax * M.wrap * M.wrap;
	var t0 = Date.now();

	for (var f = 1; f <= totalFrames; f++) {
		SIM.step();
		var t = SIM.t;
		var isLate = (t > 300);
		if (isLate) lateFrames++;

		var qualPlates = 0;
		var fMass = 0, fMassV = 0;
		var fHasSlow = false;
		var snapPlateRows = [];

		for (var c = 0; c < S.csN; c++) {
			if (S.csCnt[c] < P.plateMin) continue;
			qualPlates++;
			var pull = (P.kSlab > 0 && S.csR2[c] < ringR2 * S.csM[c]) ? P.kSlab * (S.csS[c] / S.csM[c]) : 0;
			var push = (P.kPush > 0) ? P.kPush * (S.csP[c] / S.csM[c]) : 0;
			var raw = preBrakeVX[c] - pull - push;
			var preSp = Math.hypot(preBrakeVX[c], S.csVY[c]) * P.cmYr;
			var postSp = Math.hypot(postBrakeVX[c], S.csVY[c]) * P.cmYr;
			var m = S.csM[c];

			fMass += m;
			fMassV += m * postSp;

			var b = postSp < 0.1 ? 0 : (postSp < 0.5 ? 1 : (postSp < 1.0 ? 2 : (postSp < 2.0 ? 3 : (postSp < 5.0 ? 4 : 5))));
			speedBins[b]++; speedBinMass[b] += m * SIM.dt;
			if (isLate) { lateSpeedBins[b]++; lateSpeedBinMass[b] += m * SIM.dt; }

			if (postSp < 0.5) {
				fHasSlow = true;
				var attr = 'kinematicLow';
				if (holdCount[c] > 0 && preSp >= 0.5) attr = 'holdBrake';
				else if (arrestCount[c] > 0 && preSp >= 0.5) attr = 'arrestBrake';
				slowAttribution[attr]++;
				if (isLate) lateSlowAttribution[attr]++;
			}

			if (nextSnap < snapMarks.length && t >= snapMarks[nextSnap]) {
				snapPlateRows.push({
					c: c, cnt: S.csCnt[c], mass: m,
					rawFlow: raw * P.cmYr, slabPull: pull * P.cmYr, ridgePush: push * P.cmYr,
					preBrake: preBrakeVX[c] * P.cmYr, brakeDV: brakeDV[c] * P.cmYr,
					postBrake: postBrakeVX[c] * P.cmYr, csVY: S.csVY[c] * P.cmYr,
					drift: postSp, holds: holdCount[c], arrests: arrestCount[c]
				});
			}
		}

		if (qualPlates > 0) {
			framesWithPlates++;
			allMassWeightedSpeedSum += fMassV;
			allMassSum += fMass;
			if (isLate) {
				lateFramesWithPlates++;
				lateMassWeightedSpeedSum += fMassV;
				lateMassSum += fMass;
			}
		}

		if (fHasSlow) {
			if (!inSlowEpisode) {
				inSlowEpisode = true;
				slowEpisodeCount++;
				curSlowEpisode = 1;
			} else {
				curSlowEpisode++;
			}
			totalSlowEpisodeFrames++;
			if (curSlowEpisode > maxSlowEpisode) maxSlowEpisode = curSlowEpisode;
		} else {
			inSlowEpisode = false;
			curSlowEpisode = 0;
		}

		if (nextSnap < snapMarks.length && t >= snapMarks[nextSnap]) {
			var snapMass = snapPlateRows.reduce(function (s, r) { return s + r.mass; }, 0);
			var snapMassV = snapPlateRows.reduce(function (s, r) { return s + r.mass * r.drift; }, 0);
			snapshots.push({
				nominalMyr: snapMarks[nextSnap],
				t: t, frame: f,
				plateCount: qualPlates,
				massWeightedDrift: snapMass > 0 ? (snapMassV / snapMass) : 0,
				plates: snapPlateRows
			});
			nextSnap++;
		}
	}

	var elapsed = (Date.now() - t0) / 1000;
	var lateMassDrift = lateMassSum > 0 ? (lateMassWeightedSpeedSum / lateMassSum) : 0;
	var allMassDrift = allMassSum > 0 ? (allMassWeightedSpeedSum / allMassSum) : 0;

	var result = {
		seed: SEED, kyr: KYR, myr: MYR,
		unbound: UNBOUND, depBound: P.depBound, erosion: P.ero,
		fingerprint: S.hash(),
		elapsed_s: elapsed,
		ms_per_frame: elapsed / totalFrames * 1000,
		totalFrames: totalFrames,
		framesWithPlates: framesWithPlates,
		plateFraction: framesWithPlates / totalFrames,
		lateFrames: lateFrames,
		lateFramesWithPlates: lateFramesWithPlates,
		latePlateFraction: lateFramesWithPlates / lateFrames,
		allMassDrift: allMassDrift,
		lateMassDrift: lateMassDrift,
		speedBins: speedBins,
		speedBinMass_km2Myr: speedBinMass,
		lateSpeedBins: lateSpeedBins,
		lateSpeedBinMass_km2Myr: lateSpeedBinMass,
		slowAttribution: slowAttribution,
		lateSlowAttribution: lateSlowAttribution,
		slowEpisodes: {
			count: slowEpisodeCount,
			totalFrames: totalSlowEpisodeFrames,
			totalMyr: totalSlowEpisodeFrames * SIM.dt,
			fractionOfPlateFrames: framesWithPlates > 0 ? totalSlowEpisodeFrames / framesWithPlates : 0,
			maxContinuousFrames: maxSlowEpisode,
			maxContinuousMyr: maxSlowEpisode * SIM.dt
		},
		snapshots: snapshots
	};

	console.log('\n--- pt-drift-census: s' + SEED + ' (' + (UNBOUND ? 'unbound' : 'bound') + ') ---');
	console.log('Fingerprint: ' + result.fingerprint + ' (elapsed ' + elapsed.toFixed(1) + 's, ' + result.ms_per_frame.toFixed(2) + ' ms/frame)');
	console.log('Frames with plates: ' + framesWithPlates + '/' + totalFrames + ' (' + (result.plateFraction * 100).toFixed(1) + '%), late ' + lateFramesWithPlates + '/' + lateFrames + ' (' + (result.latePlateFraction * 100).toFixed(1) + '%)');
	console.log('Mass-weighted drift: all ' + allMassDrift.toFixed(3) + ' cm/yr, late (>300 Myr) ' + lateMassDrift.toFixed(3) + ' cm/yr');
	console.log('Late plate speed bins: <0.1: ' + lateSpeedBins[0] + ', 0.1..0.5: ' + lateSpeedBins[1] + ', 0.5..1: ' + lateSpeedBins[2] + ', 1..2: ' + lateSpeedBins[3] + ', 2..5: ' + lateSpeedBins[4] + ', >5: ' + lateSpeedBins[5]);
	console.log('Late slow-plate attribution (<0.5 cm/yr): holdBrake ' + lateSlowAttribution.holdBrake + ', arrestBrake ' + lateSlowAttribution.arrestBrake + ', kinematicLow ' + lateSlowAttribution.kinematicLow);
	console.log('Slow episodes: ' + slowEpisodeCount + ' episodes, total ' + (totalSlowEpisodeFrames * SIM.dt).toFixed(1) + ' Myr, max continuous ' + (maxSlowEpisode * SIM.dt).toFixed(1) + ' Myr');

	if (OUT) {
		fs.writeFileSync(OUT, JSON.stringify(result, null, '\t') + '\n');
		console.log('Saved bank to ' + OUT);
	}
}

function runBatch() {
	var seeds = [1, 3, 5, 7];
	var modes = [false, true]; // bound, unbound
	var tasks = [];
	seeds.forEach(function (s) {
		modes.forEach(function (unb) {
			var out = path.join(__dirname, 'logs', '0.3.2-M11-census-' + (unb ? 'unbound' : 'bound') + '-s' + s + '.json');
			tasks.push({ seed: s, unbound: unb, out: out });
		});
	});

	console.log('Running batch of ' + tasks.length + ' census tasks (2 parallel workers)...');
	var idx = 0;
	var running = 0;
	var maxWorkers = 2;

	function next() {
		if (idx >= tasks.length && running === 0) {
			console.log('\nAll batch tasks completed!');
			return;
		}
		while (running < maxWorkers && idx < tasks.length) {
			var t = tasks[idx++];
			running++;
			(function (task) {
				var args = [__filename, '--seed', task.seed, '--kyr', '50', '--myr', '600', '--out', task.out];
				if (task.unbound) args.push('--unbound');
				console.log('Starting: seed ' + task.seed + ' (' + (task.unbound ? 'unbound' : 'bound') + ')...');
				var p = child_process.spawn(process.execPath, args, { stdio: 'inherit' });
				p.on('exit', function (code) {
					running--;
					if (code !== 0) console.error('Task failed for seed ' + task.seed + ' unbound=' + task.unbound);
					next();
				});
			})(t);
		}
	}
	next();
}
