# AGENTS.md


## style

- use a single tab indentation. LF end

- avoid deep nesting of braces { } and long if-else.
- flatten with early returns, helper functions, or flat data tables.

- avoid duplication of code.

- avoid allocations in the hot path (per-frame loop, sim, render).
- no new {}, [], object literals, closures, or string concat
- inside the frame loop.
- reuse preallocated buffers / typed arrays / scratch objects.
- allocate once at setup, mutate in place per frame.
- these are not strict rules, use best.

- plan*.md is NOT the implementation log. if need - update/improve plan, but keep final plan as artifact for possible fork or reimplementation without referring of what was and what done, without referring chat, etc.

- only essential concise comments in code that really helpful i.e. explain why and decision. prefer descriptive naming.

- no legacy support, no old versions, no outdated browsers, no leftovers and no over protecting from unreal edge cases. we need clean architecture.


## runtime

- file:// friendly, classic <script> tags, no modules, no build.
- guard module.exports so files also run under node.
- no internet links: vendor any lib as a local js file.

## concepts

use 
https://github.com/luncat8/planet-geotectonics
as reference for physics and deposits formation.but that project is top planet surface view, but current is 2d side-view.

- double time scale:
plates movement: frame step 10k..100k years;
volcano formation: lave fluid time is more like minutes or hours per frame, to be possible visible eruptions

- log height scale related to 0m : so surface more detailed, deep layers is less detailed.




## files

pages (one engine per page, no build, file:// safe):
- index.html - primary entry, the particle engine (js/pt/*); particles.html is a byte-identical
mirror of it, so a descriptive URL cannot go stale. experiments/pt-ui.js gates the parity.
- columns.html - the column engine (js/*), the earlier work; its own plans are 0.1.x and 0.2.x.
The pages cross-link each other; keep the mirror in sync when editing index.html.

harnesses (node, no runner script): experiments/pt-ui.js (page wiring, particle),
experiments/smoke.js + view-check.js (column engine), experiments/tephra-pile.js (live arc
cone vs death write-back), plus the per-milestone pt-*.js checks,
and the cut in three: experiments/slice-cut.js (the walk, the pack, the resample),
section-pack.js (the section page: transports, refusals, switches, HUD), section-seed.js (the
mapping: the z identity, the ledger, the quiet start, the two run modes), checkpoint.js (the
column-state checkpoint codec and deterministic restore), coupling.js (the envelope, C3/C4 and
20-import identity), coupling-link.js (the postMessage → localStorage → manual ladder), and
core-log.js (the §8.5 return path: the one age convention, the acceptance rules, the cadence).
Each prints PASS/FAIL and exits non-zero on failure.
experiments/acceptance.js is a release's whole-series pass: one section per numbered
acceptance claim, delegating to the owning harness where one exists (its PASS count is
quoted, never re-measured) and measuring the claims no harness owns. Sampling an invariant
every frame rather than at the HUD's 2 Hz is what found the two 0.2.0 M5 reds, so long-run
checks belong here and not in a page harness.
experiments/isomorphism.js and experiments/upstream-drift.js read the counterpart tree
($UPSTREAM or a path argument) and report SKIP without one; the drift harness measures
against the counterpart's branch tip, never against whatever its checkout sits on.
experiments/melt-tune-sweep.js (the two melt sources against the crust budget),
experiments/melt-contact-sweep.js (a melt candidate against the four strict contact legs,
with the live arc cone beside it — 0.2.3 landed `kMelt` from it),
experiments/vent-contact-sweep.js (a Vbirth/tauVent candidate against the same four legs,
its cadence beside it — 0.2.4 landed `Vbirth` 4 from it) and
experiments/floor-bench.js (the contact floor's settle: pass budget used, worst gap left)
join the same rule.
experiments/belt-tune-sweep.js and experiments/vent-tune-sweep.js are tuning tables: report
only, they never edit params.js — a chosen value lands through a normal edit and a
full-suite re-acceptance, and a table keeps a tag naming the gate it was measured against.
experiments/vent-cadence.js (one live leg's eruption cadence: duty, per-life episodes and
repose, the starved/maxIdle mechanism columns) is report only the same way.

port/ - files shared byte-identical with planet-geotectonics (0.4.0-sync-plan.md §1.2);
port/PORT.json is the manifest. They are not in js/ on purpose: experiments/smoke.js asserts
that columns.html loads every js/*.js exactly once, and a shared format is not a page module.

plans: 0.1.7-plan.md (crust flow-law units and the honest ceiling), 0.1.9-plan.md (the two
contact measurements: R1's site and background, R2's needle shoulder), 0.4.0-sync-plan.md (what
is exchanged with the reference project, in which direction), 0.4.1-plan.md (the cut: a line on
the globe's map -> a section here), 0.9.0-draft-sync.md (the integrated globe, later). The
completed 0.1.8 plan is `archive/0.1.8-plan.md` (collision arrest and orogen memory) and the
completed 0.2.0 plan is `archive/0.2.0-plan.md` (eruptives, deposits, save/load; the series
is accepted at M5, `archive/0.2.0-m5-worklog.md`). Drafts are
0.3.0-draft.md and 0.4.1-draft.md.
roadmap.md — which release owns what, the runtime-authority table, what is deferred; each
release's own plan is still the authority for its milestones.

findings-pitfalls-skills.md - notes and pitfalls for LLM agents. write here if found good way to do something.

archive/ - for implemented plans

experiments/ - measurement scripts (node), not loaded by the page.
experiments/logs/ - keep useful;

## sandbox

git push returns "Invalid username or token" is ok, no need to investigate or report - i will apply manually

## Workflow
- **Worklog**: record development steps and its validation in `archive/*.md`, end job with a next step suggestion. Better don't grow it as very big file but split to easy find tasks.
example:
draft (basic idea as reference of what user initially want):
0.1.x-draft.md
dev plan (LLM write how to implement it and split tasks to steps):
archive/0.1.0-plan.md
worklog:
archive/0.1.M2-speed-slider.md
report (user can copy LLM answer as report to better connect context of previous session):
archive/0.1.M2-speed-slider-report.md
0.1.1-plan.md
0.1.3-draft.md - you may also write user prompts as draft files to store reference of global task
0.1.2-plan.md
