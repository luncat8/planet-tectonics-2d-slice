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
experiments/smoke.js + view-check.js (column engine), experiments/contact-audit.js (column
contact measurements; a sliver retirement is counted as an event by default with no flag after
0.1.13 landed the territory hand-back; `--quiet-trace` inspects omitted correspondence
candidates, `--quiet-identity` certifies the quiet-frame population (neighbour continuity, exact
width decomposition, volume-identity-corrected thickness, a raster-yardstick split by population)
and `--retire-ramp` probes 0.1.13's rejected Candidate A (`zDyn` ramp on immediate retirement);
`experiments/quiet-distribution-table.js` reads the saved 0.1.9 quiet-frame matrix,
`experiments/quiet-identity-table.js` the saved 0.1.12 one, and
`experiments/retirement-ramp-table.js` the 0.1.13 strict legs and 32-world matrix),
experiments/tephra-pile.js (live arc
cone vs death write-back), plus the per-milestone pt-*.js checks (0.3.0 P3: pt-p3-pool.js, pt-p3-routing.js, pt-p3-enthalpy.js, pt-p3-melt.js, pt-p3-erupt.js, pt-p3-flight.js, pt-p3-budget.js,
the budget is a report whose gates are the plan's own, its price table never edits params.js;
it also prices the reserve as an interleaved empty/filled pair, because the sweep's own window
spread is wider than the price it reads, and runs every supported rung live for 20 Myr (§G) so
0.3.0-plan.md §7's rung obligation is measured rather than assumed; the finer rungs' slower
eruption cadence is reported, not gated, because no cadence is promised across rungs),
and the P3 acceptance pass pt-p3-check.js (the integrated claims of 0.3.0-p3-plan.md §4 P3.5:
the two books over a live run, welding, legibility, the replay and the reserve matrix; it
delegates the eight owner harnesses as children and quotes their counts rather than re-measuring
them),
plus the 0.3.0 P4 owner harnesses (pt-p4-contact.js for inter-plate contact and underthrusting,
pt-p4-slab.js for slab sinking and deep recycling, pt-p4-arc.js for slab dehydration and arc
melt, pt-p4-erosion.js for particle weathering/erosion/sedimentation and
pt-p4-transport-sweep.js for the surface-law comparison, sharing the fixture builder
pt-p4-lib.js; each owner isolates the later P4 passes so its live numbers stay its own
report's -- pt-p4-contact and pt-p4-slab run with `P.arc` and `P.ero` off, pt-p4-arc with
`P.ero` off, and the same convention puts `P.ero` off in pt-drift.js -- because the
integrated census is the acceptance pass's),
and the P4 acceptance pass pt-p4-check.js (the integrated claims of 0.3.0-p4-plan.md §3/§4
P4.4: the four P4 legs together over a 300 Myr live run with everything shipped on, the
contact census re-derived from the kernel's own table that decided the two open §4 questions
(no plate-size threshold; translation-only brake), the slider matrix, and the P4 freeze; it
delegates the five P4 owner harnesses and pt-p3-check.js as children and quotes their counts
rather than re-measuring them),
experiments/pt-buried-deposit-melt.js (the 0.3.1 harness: section A is the routing fixture --
the certificate, the depth, the threshold and M2's field-support terms of the G5 deposit gate
one at a time, both transfer shapes and the capacity rule, all on the kernel and with the node
field the fixtures own; sections B/C are report-only measurement of the buried,
threshold-molten deposit stock, frame-sampled residence, the shallow-cooling boundary, the margin
reading that says how far the buried population sits from the threshold, the live `thr.depMelt`
intake the route takes, and -- per source, at the boundary the kernel decides on -- every routing
candidate's own temperature against its solidus and against the node field, the adjoint pairing's
gain (`cw = mu_k / W_k` over its stencil) and its mass share of that stencil, beside the same
readings for the populations they were drawn from and for the deposits the field term holds back;
it runs one live leg or a cell matrix -- `--cells seed:kyr:myr,...`, each cell a seed with its own
clock and duration, the first repeated for a fingerprint check -- and changes no routing itself),
experiments/pt-drift.js (P2.2 isolated drift by default; `600 --shipped` measures all-pass
late drift with optional `--unbound`, `--seed N`, `--out file.json`; the shipped mode restores
probe velocities and asserts observation neutrality), experiments/pt-drift-terms.js (0.3.2 M11
drive/contact term decomposition on slow plates), experiments/pt-drift-census.js (continuous
frame-by-frame 600 Myr slow-episode and drift speed distribution census across seeds), and
experiments/pt-drift-check.js (validates M10's seed-1 pair and M11's slow-plate attribution and
continuous census distribution across the 8 worlds against the reports, not a universal drift gate),
experiments/pt-heat-tail.js (0.3.2's experiment-only gather cap/share attenuation, deposit
relaxation, conservative local minimum-mass, node-wise and stencil-scale bounded conservative
redistribution (spread, stencil), the field-relative two-sided bound (frb, `--share s0` scales
the bound a parcel gets by its own stencil mass share, `--place mass` hands a withheld increment
out by marker share instead of by headroom, `--scope dep|solid` limits the cap to the deposit
phase or all grid-coupled phases) and sub-grid relaxation toward the field,
wall-booked or zero-sum through the adjoint (relaxw, subgrid; `--scope dep|solid`) probes on
seed 5 at 50 kyr/frame for 600 Myr, or any `--seed`/`--kyr` cell; its `--watch` instruments read
the adjoint gain and stencil mass share at every cold minimum and every mobile-melt excursion
(the mechanism, not only its signature), and its per-phase outside count is split into the two
ends of the bound; its `--trace-id a,b,c` records a material's own history inside the run that
produced it -- the frame and site it first appears, a 200-frame burial spine with every frame that
does something to it in full, every act of the bound on it, and its routing fate -- because a
material id is not a material identity across two diverging runs (a split's child is a new id, a
merge survivor takes the smaller one), so M5's correspondence argument reads histories and sites,
and the first-seen record is what tests whether one id does mean one material in both runs; its
`hottest` record carries the material id, so the outlier can be traced and not only reported;
M6's repair join reads each material id's last relocation frame from a position diff across
`G.reseed` (observation only, `movedSeen` must equal the kernel's own `movedSum` when the
lattice is never re-dealt) and splits the held census by relocation age -- cumulative windows
1/3/10/30/100 frames plus the ever/never totals that partition it, sample count, host
mass-time and worst T-field gap in each -- while delivered events and `hottest` carry the same
age, so the held-back concentration can be crossed with the coverage repair that may be
feeding it; reports every-frame books, per-phase temperature bounds, wall intake, timed kernel frames and
individual G5 deposit transfers; no shipping parameter changes. M3 adds two melt-depletion
probes that wrap the melt path's own kernel text rather than the engine state -- `--dpart D`,
water-flux partitioning of the split (the residue's solidus rises by what the melt took, so it is
left subsolidus and nothing is booked) and `--cap PHI`, a probe-local per-material-id shed budget
that counts a blocked candidate apart from a delivered transfer -- the frozen P3.2 census printed
beside every cell so a rule's cost to the pipeline is read, and `--watch` observation of the two
faces the M2 matrix opened: per-phase temperature extrema by depth band with the frame and
material id that set each one, the path of every new global mantle minimum, and a per-excursion
table for mobile melt above T = 1.5 that closes a run still open at the last frame instead of
dropping it. With HEAT_TAIL_OUT set the bank file keeps the whole record and stdout prints a
summary, so a `> logs/x.txt` redirect is a console record and not a second copy of the bank),
with pt-heat-tail-check.js validating its saved baseline replays and candidate banks -- the M0 bank, the M2 re-bank
whose grid-coupled readings must equal M0's bitwise, the M3 rows, whose fingerprints, books,
census, serial timings, dry-solidus percentiles, excursion tables and cold paths are asserted so
a report cannot drift from its own evidence, and the M7 section: the traced distribution pairs
(s3/s1, both rows) asserted field for field against their M6 worlds, the admission tables (init
ids share their admission exactly; every later id is admitted at a different site in a different
phase or at a different mass scale), the class reading on both worlds, the selection's two
statements (the temperature gate read scoped to the deposit phase applied to every row; frame
time from quiet hosts) and the trace's margin (rejected candidates are outcomes, not
successful remedies; specification 0.3.2-plan.md, reports archive/0.3.2-M0-heat-tail-report.md,
archive/0.3.2-M1-localization-report.md, archive/0.3.2-M2-launch-air-report.md,
archive/0.3.2-M2-tail-matrix-report.md, archive/0.3.2-M3-depletion-report.md,
archive/0.3.2-M4-field-bound-report.md, archive/0.3.2-M5-correspondence-report.md,
archive/0.3.2-M6-distribution-report.md, archive/0.3.2-M7-selection-report.md and
archive/0.3.2-M8-landing-report.md; the M8 section reads the three landed banks and proves the
unprobed kernel reproduces the M7 candidate worlds field for field, the kernel's own bound
counters equal the probe's totals it replaces, and the frozen depBound is the selected 0.25),
experiments/pt-heat-matrix.js (the M2 clock/seed
matrix: seeds 1,2,3,5,7 at 10/50/100/500 kyr over 300 Myr plus the 600 Myr seed-5 cell, each a
fresh pt-heat-tail.js child, gated on every frame's books, the latent identity, the wall and
the per-phase temperature bound; the first cell repeated bitwise; `--cells seed:kyr:myr,...`
and `-j` for a subset), and experiments/pt-heat-tail-trace.js (the M1
latent-book localization: the P3.1 identity residual traced across every kernel boundary of
the *unchanged* pre-M2 banked cell, gated on reproducing its fingerprint, books, census and
protected events exactly, attributing the drift to the boundary that raises it and decomposing
the unbooked phase's steps into individual predicted/measured events; it reproduces only on the
M1 tree, base 705f767, because M2 remedied what it traces),
and the cut in three: experiments/slice-cut.js (the walk, the pack, the resample),
section-pack.js (the section page: transports, refusals, switches, HUD), section-seed.js (the
mapping: the z identity, the ledger, the quiet start, the two run modes), checkpoint.js (the
column-state checkpoint codec and deterministic restore), coupling.js (the envelope, C3/C4,
the 20-import identity and the plate-membership rebuild — sections M and N: a boundary the
globe has walked takes its columns with it, an unchanged import changes nothing, the wrap,
a plate gained and lost, and an open window), coupling-link.js (the postMessage →
localStorage → manual ladder), and
core-log-format.js (the shared `pgt-core-log` v2 contract: the fixture round trip, the two
identities that lock it to the pack fixture, the ported v1 validation law class by class,
seal/encode/parse, stale-never-current identity, and node/classic-script parity), and
core-log.js (the §8.5 return path: build/select/commit and the cadence; since 0.4.4 M2 its
wire half is the shared codec), and
namespace.js (0.9.0 M0–M1, the C1 audit and the host contract: the real global set from a
bare-VM load — one name per engine file, the lexical scope read through the inspector, no
self-start, one frame loop per host, and no page name read off the engine's own global — the
collision check against the globe's page, strict: the two pages meet in the shared port/
names alone, and a new name on either side is a red until its expectation table says so in
the open; and §E, the contract's own gate: every entry 0.9.0-contract.md names exists in the
loaded engine, the chrome COLUI.build writes carries the page's own ids, tags and attributes,
a window is refused by name, and the built chrome is a working host).
Each prints PASS/FAIL and exits non-zero on failure.
experiments/acceptance.js is a release's whole-series pass: one section per numbered
acceptance claim, delegating to the owning harness where one exists (its PASS count is
quoted, never re-measured) and measuring the claims no harness owns. Sampling an invariant
every frame rather than at the HUD's 2 Hz is what found the two 0.2.0 M5 reds, so long-run
checks belong here and not in a page harness.
experiments/isomorphism.js, experiments/upstream-drift.js and namespace.js's section D read
the counterpart tree ($UPSTREAM or a path argument) and report SKIP without one; the drift
harness measures against the counterpart's branch tip, and namespace.js at the 0.9.0 pin and
that tip, never against whatever its checkout sits on.
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
port/PORT.json is the manifest. Since the 0.4.4 M1 bump the directory carries two independently
testable contracts: `pgt-slice-pack-v2` (`slice-format.js` + its fixture) and `pgt-core-log-v2`
(`core-log-format.js` + its fixture, whose path and full-pack identities are the pack fixture's
own). They are not in js/ on purpose: experiments/smoke.js asserts that columns.html loads
every `js/*.js` exactly once, and a shared format is not a page module — but it also asserts
the directory is the page's load set, so a new `port/*.js` file gets its own `<script>` tag
(`slice-format.js` first, `core-log-format.js` second).

plans: 0.1.7-plan.md (crust flow-law units and the honest ceiling), 0.1.9-plan.md (the two
contact measurements: R1's site and background, R2's needle shoulder),
0.1.12-plan.md (quiet-frame material identity), 0.1.13-plan.md (the sliver-retirement ramp),
0.3.1-plan.md (buried-deposit remelting: measurement, cooling eligibility, conservative G5 routing, M2's field-support
term and the ledger gates -- closed at M2, `archive/0.3.1-M2-acceptance-report.md` and
`archive/0.3.1-M2-acceptance-worklog.md`),
0.4.0-sync-plan.md (what is exchanged with the reference project, in which direction), 0.4.1-plan.md (the cut: a line on
the globe's map -> a section here), 0.4.2-plan.md (the pgt-slice-pack v2 cutover, slice side of the globe's
0.8.0-0.8.2 handoff; Phases A, B-a and B-b are landed — port/ carries only the v2 codec and
fixture, and the three Earth bundles are restored through the globe's v2 bake CLI at its
9270039 and audited byte-for-byte on both sides. Phase C's one local block, C-live gate 4, is
satisfied by 0.4.3 — the automatic section plate-topology rebuild, `COUP.replate` at every
`COUP.apply`, `archive/0.4.3-membership-report.md`; the 2026-10-16 negative scheduling
decision is superseded by 0.4.4's positive one —
`archive/0.4.2-counterpart-audit-response.md`),
0.4.4-plan.md (the C-return/C-live agreement — the slice-side scheduling decision both
2026-10-16 holds named as their re-open trigger; proposes P1–P7 to the globe: the manual-run
core-log import per its 0.8.3 §2.1/§2.2, one coordinated port bump with a self-contained
`port/core-log-format.js` v2 and fixture, the pair gates 1/2/3/6 and the gate-7 review.
Globe 0.8.4 (`4efb8fd`, 2026-10-18) accepted P1–P7, P4 an explicit yes to positional beds;
both holds lifted and M1/M2 landed — `archive/0.4.4-M1-core-log-codec-worklog.md`; M3's pair
gates are the next milestone),
0.9.0-plan.md (C1 namespacing found already in place at 47ec7b3 — 25 engine files, one `COL*`
global each, `COLSIM.start(host)/stop()`, no self-start — so the release is the M0 namespace
audit harness, the M1 host contract, the M2 `library.html` dry-run host (implemented and
Node-VM checked; headless-Chromium acceptance still pending), the M3 adapter request to the
globe, and M4's §8.4 acceptance; written against globe `3c960e7`, whose 0.9.0 is climate
integration, so the adapter queues on their ladder. M2's record is
`archive/0.9.0-M2-library-host-worklog.md`),
0.9.0-contract.md (the host contract: what a host page may do with the column engine — the
shape, document/element host and named window refusal, ShadowRoot-compatible scoped IDs,
17 named entries, mount, `data-start="section"`/`data-pack` element-host setup,
start/stop/step, coupling in, observations out, mode and staleness, and what the host must
not do. The namespace harness reads its entry list, so the contract and the code cannot
drift),
0.9.0-draft-sync.md (the integrated globe, later). The
completed 0.1.8 plan is `archive/0.1.8-plan.md` (collision arrest and orogen memory) and the
completed 0.2.0 plan is `archive/0.2.0-plan.md` (eruptives, deposits, save/load; the series
is accepted at M5, `archive/0.2.0-m5-worklog.md`). Drafts are
0.3.0-draft.md, 0.3.2-draft.md (the light-parcel heat concentration 0.3.1 M2 measured, which
holds that release's 300 Myr intake back and is what its 600 Myr cell separates),
0.4.1-draft.md, 0.4.3-draft.md (the decision to freeze the 0.1.x smoothness line at 0.1.13
and to spend that release on rebuilding the section's plate membership at import instead;
landed, `archive/0.4.3-membership-worklog.md` and `archive/0.4.3-membership-report.md`) and
0.4.4-draft.md (the road to the globe is negotiation, not measurement — the reference for the
two agreement plans, both written against the globe's then-current commit).
roadmap.md — which release owns what, the runtime-authority table, what is deferred; each
release's own plan is still the authority for its milestones.

findings-pitfalls-skills.md - notes and pitfalls for LLM agents. write here if found good way to do something.

archive/ - for implemented plans

experiments/ - measurement scripts (node), not loaded by the page.
experiments/logs/ - keep useful. A bank is written once, to the harness's own output variable
(HEAT_TAIL_OUT and friends), and its `.txt` neighbour is the console record, not a copy of it:
0.3.2 M3 spent 21 MB on `.txt` files byte-identical to the `.json` beside them before
pt-heat-tail.js started printing a summary when the bank file carries the detail. One bank per
world -- a world is its fingerprint, so a batch, a `--watch` and a serially timed re-run of one
cell are one world and the survivor is the bank with the most recorded fields (and the serial one
where a report quotes a frame time). What stays is what a checker reads or a report quotes, and
`pt-heat-tail-check.js` naming a bank is what makes deleting it fail loudly; a bank no harness
reads and no report cites is scratch, and `0.3.2-trace-latent.json` is the counterexample that
settles it -- its runner reproduces only on the M1 tree, so it cannot be regenerated at all.
One file per content across the whole directory, banks or older `.txt` runs: a re-run that
reproduces a log byte for byte is recorded in the identity map
(`archive/log-hygiene-worklog.md`), not on disk -- but a sweep a table tool parses keeps one
file per tag and leg even where the bytes repeat (each name is a row's source), a frozen
snapshot directory like `0.3.0-p3.4-review/` stays whole, and a wall-clock-only re-run is
scratch. Prune at the end of a milestone and say what went and why in that milestone's worklog.
The pass is one command, `experiments/log-hygiene.js`: it resolves the four ways a harness names
a log (a path literal, a directory prefix composed with a call-site literal, a readdir filter, a
name built out of table legs) and the three ways a document does (the exact basename, `...-drift.txt`,
a glob), groups the banks by world and compares them by field paths rather than by key count,
folds wall-clock timings and nothing else, and prints keep/go/review with the identity map ready
to paste into the worklog. `--apply` prunes only what the policy decides without a judgement call,
`--worlds` prints the same-world decision data, `--why NAME` one file's reasons. It cannot decide
whether a bank's raw arrays are worth their bytes -- that is a question about what a future
re-analysis will ask, and the checkers re-derive the reports' percentiles, bleed counts and
protected ids from those arrays, so thinning them is a re-measurement, not hygiene -- with one
exception it owns, `--compact`: a trace bank over 4 MB is summarised, not deleted. The per-id
scalars, the 200-frame stride spine, deliveries, phase changes, the last frame and the `caps[]`
record stay; what goes is why 1/2/4 (per-frame readings whose maxima and counts are already
scalars) and why 3 when `caps[]` is not full. The 4 MB floor keeps the M5 banks whole because
their checker reads raw consecutive-frame rows for the repair's relocations. M8 compacted the
three M7 s1/s3 banks 45.26 -> 3.76 MB and `pt-heat-tail-check.js` still passes 17 lines, so the
checker is the proof of the transform, not the sizes.

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
