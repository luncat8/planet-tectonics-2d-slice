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
experiments/smoke.js + view-check.js (column engine), plus the per-milestone pt-*.js checks.
Each prints PASS/FAIL and exits non-zero on failure.

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
