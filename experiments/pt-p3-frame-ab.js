// pt-p3-frame-ab.js — one frame-cost sample of a js/pt tree, for an A/B on the same host.
//
// pt-check's frame gate and pt-p3-budget both read absolute milliseconds, and an absolute
// millisecond count carries the host (the P3.1 and P3.2 worklogs say so). A change's cost is
// therefore read as a pair: the same frame loop on two trees, interleaved, so host drift hits
// both. This script times one tree and prints one number (ms per frame, shipped config, default
// clock, after a 60-frame warm-up). The caller interleaves the runs.
//
// Usage:
//   node experiments/pt-p3-frame-ab.js                 the working tree
//   node experiments/pt-p3-frame-ab.js /path/to/tree   another tree (e.g. git archive <commit>)
//
// The P3.3 A/B used the P3.2 commit (e0aebbc) extracted with `git archive` into a temp dir.
'use strict';

var path = require('path');
var root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..');
var B = path.join(root, 'js', 'pt') + path.sep;
var P = require(B + 'params.js');
var SIM = require(B + 'sim.js');

P.sl.kyr = 50;
P.ic = 'cool';
SIM.init(); SIM.reset();
SIM.run(60);
var t0 = Date.now();
SIM.run(400);
console.log(((Date.now() - t0) / 400).toFixed(2));
