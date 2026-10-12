# Roadmap — 0.4 to 0.9

Which release owns what. Each release still has exactly one plan file and that plan is the
authority for its own milestones; this file only says what belongs where, what every release
must obey, and what is deferred.

The cut itself is `0.4.1-plan.md`. The exchange with `planet-geotectonics` is
`0.4.0-sync-plan.md`. The later request (an integrated globe) is `0.9.0-draft-sync.md`.

## 1. Releases

| release | deliverable | plan | depends on |
| --- | --- | --- | --- |
| 0.1.7 | crust flow units: the two relaxations in metres and Myr, the ceiling made honest; corrected R1/R2/R5 gates and R4 remain open | `0.1.7-plan.md`, `archive/0.1.7-review-followup.md` | — |
| 0.1.8 | collision arrest: the absorbed-shortening brake (`S.edgeShort`, checkpoint v4) closes R4; R1/R2/R5 left open only as measurement definitions on one 100 kyr leg | `archive/0.1.8-plan.md`, `archive/0.1.8-worklog.md` | 0.1.7 flow laws and corrected audit |
| 0.1.9 | the two contact measurements: R1's site window anchored at the event and its background taken from the quiet-frame yardstick, R2's needle shoulder read over the belt's own neighbourhood | `0.1.9-plan.md`, `archive/0.1.9-worklog.md` | 0.1.8's M3 matrix |
| 0.2.x | column engine: eruptives, deposits, extraction; page chrome (pause/step/reset) uses E1/E3 — **closed at M5** | `archive/0.2.0-plan.md` | — |
| 0.3.x | particle engine P3+ (melt, eruptions, contact). **P3 closed at P3.5**: conserved pool/routing, phase and enthalpy, segregation/storage, conduits, conserved wall-clock flight through landing/cooling/welding, and the integrated acceptance pass with the reserve frozen — `archive/0.3.0-p3.5-report.md`. **P4.0 landed**: the inter-plate contact kernel — `archive/0.3.0-p4.0-report.md` | `0.3.0-plan.md`, `0.3.0-p3-plan.md`, `0.3.0-p4-plan.md` | — |
| 0.4.0 | sync/exchange: provenance, deposits core, water, checkpoint, section pack | `0.4.0-sync-plan.md` | — |
| 0.4.1 | the cut: draw a line on the globe, copy/save, paste/load, reconstruct a section | `0.4.1-plan.md` | 0.4.0's format (`port/slice-format.js`, M0 done) |
| 0.9.0 | globe page hosts the section as a library; live sync is C3+C4 | `0.9.0-draft-sync.md`, `0.4.1-plan.md` §8 | 0.4.1 M1–M2; C1 on the column engine |

0.2.0 status: **closed.** M0 (the headless toy box), M1 (vent lifecycle / second clock),
M2 (stack write-back / visible edifice), M3 (bed-anchored deposits / finite extraction),
M4 (save/load and diagnostics under the plan's E1/E3 page ownership) and M5 (acceptance and
tuning) are landed; worklogs are `archive/0.2.0-m0-worklog.md` … `archive/0.2.0-m4-worklog.md`
and `archive/0.2.0-m5-worklog.md`, with `archive/0.2.0-m5-report.md` as the paste-back
report. The series' seven acceptance claims are decided by one harness,
`experiments/acceptance.js` (48 checks, log `experiments/logs/0.2.0-m5-acceptance.txt`),
which delegates to the owning milestone harness and measures the three claims none of them
owned (the two clocks, determinism, 500 Myr stability at 10 and 100 kyr/frame). M5 landed
`P.kBeltGradient` 8 → 12 from a nine-candidate sweep, and its every-frame K9 sweep found and
fixed two engine reds that the 2 Hz HUD sample could not see (a stale sort permutation after
a column death, and a contact-floor snapshot taken after the classifier); both fixes are
provably geometry-neutral. One item is measured and deferred: a design-scale 10–30 px
edifice needs ~50× this section's melt production, which is a `kMelt`/`kPlumeMelt`
(crust-budget) decision, not a chamber constant.

0.2.1 (`archive/0.2.1-melt-supply-worklog.md`) took the one item 0.2.0 M5 measured and
deferred: `P.kPlumeMelt` 2e4 → 2e6, so a live plume shield reaches the design's 10–30 px
band instead of building nothing, with melt still under half a percent of the section's
mafic production. `P.kMelt` stayed put on a measurement — no value of it gives an arc vent
topography, because explosive tephra is written back into the column every frame — and the
landing exposed a latent `COL.floor` defect (a settle test with no tolerance, and a pass
budget sized for the spin) that is now fixed and gated by `experiments/floor-bench.js`.

0.2.2 (`archive/0.2.2-tephra-pile-worklog.md`) takes that tephra question: write-back waits
for vent death, so a live explosive pile is box mass rather than a K6 surface bed.
`P.kMelt` 20 (0.63 melt/water) builds a 27 × 9 px live arc cone against erupt-bench's
27 × 10, but it nicks R2/R3 on two strict legs, so it is measured in
`experiments/tephra-pile.js` and not committed.

0.2.3 (`archive/0.2.3-melt-contact-worklog.md`) re-measures that constant the way 0.2.2 §6
asked, on the four strict contact legs at 2e-3 / 6 / 10 / 20 with the tephra-only rule
(`experiments/melt-contact-sweep.js`): **all sixteen legs pass**, and 20's worst margin is
the old base's own (R2 width 92.7% against 92.5%, R3 80.4 km against 80.1), so
`P.kMelt` 2e-3 → **20** lands and the arc gets its cone — the design's second visible
eruption style. Two corrections fell out: 0.2.2's two reds reproduce exactly only under a
trial that delayed lava as well as tephra, which is not the rule in the tree, and
`tephra-pile.js`'s live-write gate was counting `venEdV` growth (which the permitted lava
writes also cause) instead of tephra cells placed live. Melt stays under half a percent of
mafic production; the visible cost is the duty cycle (93–98% of frames feeding), whose knob
is `Vbirth` / `tauVent`.

0.2.4 (`archive/0.2.4-vent-cadence-worklog.md`) takes that duty item as its own contact-leg
table (`experiments/vent-contact-sweep.js`: `Vbirth` 1/4/8/16/32 × `tauVent` 0.25/0.5/2 on
the same four legs, with `experiments/vent-cadence.js` as the decision column): **`P.Vbirth`
1 → 4** lands and `tauVent` stays the design's 2 Myr. Each edifice now erupts in
design-scale batches (mean episode 11.7–18.8 cells², largest 126–305) with 2.05–5.00 Myr
per-edifice repose (2–4× the base), duty 88.7% → 82.0% mean and visDuty 71.9% → 64.5%
(inside 0.2.1's 57–69%), at the cone 0.2.3 landed kept intact (27.00 × 8.42 px against
27.00 × 8.24). The cone is the ceiling: `(16, 2)` measures the reference duty number
(69.1% mean) but flattens the arc cone to 5.43 px, so the batching region a
pile-before-write-back rule would free (0.3.0-P3's toy physics) is measured and named in
§7; `Vdie` / `tDrain` are the remaining lifecycle constants if the trickle hover must stop
counting as an eruption.

0.2.5 (`archive/0.2.5-pile-before-death-worklog.md`) lands the write-back rule 0.2.4 §7
named: K7 no longer writes lava every frame — `ERUPT.writeBack` runs only at the vent's
death, so both lithologies reach the stack in one batch. At the committed row the arc
cone gains what lava held back (27.00 × 8.42 → **27.00 × 9.18 px**, `tephra-pile.js` 6/6
with its live-write gate now covering both lithologies) and the four strict contact legs
stay 4/4. `P.Vbirth` stays 4: the batching region the rule frees measures worse, not
better — no `(16, ·)` row is landable (cone 7.61 px at best against the 8 px gate, 3 of
12 legs red, duty means 73.7–78.0% still outside 0.2.1's 57–69%) — and stays 0.3.0-P3's
measurement to spend. Acceptance 49/49, `experiments/logs/0.2.5-acceptance.txt`.

0.3.0 P3.0 (`archive/0.3.0-p3.0-worklog.md`) lands the conserved pool: `js/pt/pool.js`
(`PTPOOL`: admit/split/merge/remove, refusals counted never silent), the four transport
phases routed through `PH_GRID` / `PH_ADV` / `PH_SOLID`, the enthalpy and composition
ledgers, and the HUD phase line. Airborne parcels are in no pass. The reserve candidates stayed
in `params.js` unfrozen at that point — `pt-p3-budget.js`'s price was inside the sandbox's own
frame-time noise — and P3.5 later froze them (0.08 / 0.03 / 0.09) against the slider matrix, with
the budget harness's price read as an interleaved pair. Suite 22/22 exit 0.

A release may pull a milestone out of 0.2 or 0.3 when it is the piece that makes a page usable;
it never re-specifies a kernel.

0.3.0 P3.1 (`archive/0.3.0-p3.1-report.md`) lands the phase law and the enthalpy ledger:
`js/pt/phase.js` (`PTPHASE`: `solidus`/`liquidus`/`byT`/`byH`/`equil`), enthalpy `H` and
melt fraction `xi` as per-particle material state, `S.hLedger` as the heat invariant's
`Q_wall`, and the identity `hLedger - ledger = meltLat * (invLTot - invL0)`.

0.3.0 P3.2 (`archive/0.3.0-p3.2-report.md`) lands melt segregation and intrusive storage:
`js/pt/melt.js` (`PTMELT`, G5), the equilibrium melt split (`PTPOOL.separate`) whose children
sit exactly on the law's solidus/liquidus so the P3.1 identity survives it, the buoyant rise
on the flow map plus `vMelt`, and fixed-capacity chamber records (`PTPOOL.intrude`) whose
stock is inventory. The melt-side reserve is measured for the shipped composition (1389-slot burst, 30% of the
shared reserve, zero defers over 100 Myr); a felsic-seeded composition saturates it, and the
freeze still waits for P3.4's airborne populations (`archive/0.3.0-p3.2-review-worklog.md`).

0.3.0 P3.3 (`archive/0.3.0-p3.3-report.md`) lands conduits, vents and eruption scheduling:
`js/pt/vent.js` (`PTVENT`, G6). A conduit opens when the chamber's head exceeds the roof's
lithostatic load plus its tensile strength; an open schedule meters the chamber's melt at a
rate set by the overpressure and seals at the threshold, leaving the rest as intrusive storage.
Vent stock is inventory once, and throughput is reported apart.

0.3.0 P3.4 (`archive/0.3.0-p3.4-report.md`) lands `js/pt/flight.js` (`PTFLIGHT`): geological
vent-to-air supply and deposit cooling, bounded wall-clock ballistic motion (including while
geology is paused), collision with the physical terrain, conservative air-to-deposit landing,
composition-compatible coalescence, and ordinary crust welding from age zero. The shipped
lower-crustal geometry is now `yCham/chJoin/chSpan = 40/250/230 km` and opens at 6.55 Myr in
the default run; the active-load frame remains under the fixed 20 ms host gate.

0.3.0 P3.5 (`archive/0.3.0-p3.5-report.md`) closes P3 with `experiments/pt-p3-check.js`: the
integrated acceptance pass (both books over a 50 Myr live run, the cap, welding, legibility at
every clock, a 1000-frame replay, and the slider matrix) delegating the eight owner harnesses.
It froze `resMelt` 0.08 / `resAir` 0.03 / `resDep` 0.09 — the same 0.20 sum and `partCap`, so
the frame budget and the P3.4 census are untouched — and `flightVyBlast` 27, which bounds the
jittered explosive arc inside §2.4's 0.5-1.5 s. It also re-reads the reserve's marginal price as
an interleaved empty/filled pair (`pt-p3-budget.js`): **1.19x**, where the old two-minute-apart
sweep ratio wandered 1.33-1.56x on the same tree. `pt-p3-budget.js` also runs every supported rung
live for 20 Myr now (§G, `0.3.0-plan.md` §7): the melt band is the initial condition's own at every
mesh (5.94 / 5.55 / 5.55% of the base), no rung refuses or loses a parcel, and the reserve's
lines hold; the finer rungs are much quieter (512x48 emits 223 batches then goes quiet, 1024x96
nothing in 60 Myr) because the post-mush melt supply is of the same order as the chamber opening
threshold's granularity — recorded, not gated, since no cadence is promised across rungs.
Composition (`cF`/`cW`) still has no source,
so every shipped conduit is effusive and the explosive half plus the merge tolerances are
fixture- and 0.4.0-owned; P4's contact kernel is next.

0.3.0 P4.0 (`archive/0.3.0-p4.0-report.md`) lands the contact kernel the P2.3 orogen proxy was
standing in for: `js/pt/contact.js` (`PTCONTACT`: `detect`/`brake`/`hinge`/`guard`) ordered inside
G4 as `detect → brake → project → hinge → guard`, with `solid.js`'s `kinematics()` split into the
fit and `project()`. A contact is a pair of adjacent surface columns held by different clusters
whose velocities close above `contactYield`; the temperature *contrast* across it decides the
regime, because temperature is the only density proxy the material model has. With contrast the
colder plate subducts — it keeps its velocity, its leading band bends down along `contactDip`
beneath the override, whose approach is held; without it the response is arrest, a mass-weighted
balanced impulse pair that cancels the closing and feeds `S.ctConv` to the orogen term. The
position guard is the discrete statement of the plan's gate and is counted.
`experiments/pt-p4-contact.js` (22 checks) runs the two regimes and the kernel-off control on one controlled
two-plate leg, reads the four ledgers bitwise either side of the kernel's own calls, and censuses
the live planet: 20 sites in the worst frame at 300 Myr, 12,821 km of absorbed shortening,
166,112 bending markers, 873 guard pushes on 10.8% of frames, mass residual 0, and the pass at
1.57% of the frame. The whole release re-runs green with the kernel shipped on (15 processes,
596 distinct checks). Three defects were found and fixed on the way: the subduction side was inverted, the hold
clamped the override's speed instead of its approach, and the bending band's velocity blend ran
backwards. The fixture's geometry is forced by the engine's own bond test — two plates sharing a
depth band weld on the first frame, so the legs need a depth offset, and the weak band between the
lids has to be weak for a reason that is not heat (a hot band's upwelling welds them in ~3 Myr) —
which is why the legs are 5 Myr and isothermal. P4.1 (slab sinking, deep recycling) is next;
composition still has no source.

A release may pull a milestone out of 0.2 or 0.3 when it is the piece that makes a page usable;
it never re-specifies a kernel.

## 2. Cross-cutting

Normative for 0.4.0 on. A plan that needs to break one says so.

- **One owner per concept** (`0.4.0-sync-plan.md` §1.1) and **runtime authority** (§1.8): the
  globe owns kinematics, inventory, sea, potentials; the section owns beds and returns
  observations only.
- **One codec, three transports.** `port/slice-format.js` serves the clipboard, the `.json`
  file and (later) the in-page sync. A second implementation of the sampling or the mapping
  rules is a bug.
- **A ledger is never silent.** Material a resample, a cap or a merge cannot account for goes
  to a named line (assumption record, over-collapse, reconciled/diverged). A reconstruction
  residual is a number.
- **No build, no modules, no internet.** file://, classic scripts, local vendor files,
  `module.exports` guards. A vendored engine would be a pinned copy with a version file, and
  this roadmap does not vendor the globe here.
- **Every number comes from a script** in `experiments/`.
- **One global per file** is a prerequisite of a one-page 0.9, not of the cut. New files do not
  add a second global (`0.3.0-p3-plan.md` §6).

## 3. Deferred to their own plan

- **0.9 hosting, settled:** the globe's page hosts the column engine as a library
  (`0.4.1-plan.md` §8.6). Clipboard is the 0.4.1 contract. Vendoring the globe here is rejected.
- **Live coupling, settled:** C3 + C4 (`0.4.1-plan.md` §8.1). Detached mode G is C3 only.
- **Whether the particle engine becomes a third view** of a shell: not before 1.0. It keeps
  `index.html` / `particles.html`, which are the pages its fixtures read.
- **Non-periodic ends** (option B): a window stays clock-off until the engine has end boundary
  conditions.
- **C1 on the column engine** (one global per file, `start(host)`): prerequisite of 0.9, not of
  the cut. New files do not add a second global.
- **The crust kernel's ×1000 (found in 0.4.1 M2): settled by `0.1.7-plan.md`.** Both
  flow laws now read `1/Myr` on metre excesses, in a backward-Euler form that is stable
  at every slider leg, with the belt's receiver capped to the ceiling headroom and the
  peel last in K5; `m2-check` gates the arithmetic of each law. The re-measurement it
  owed (`0.1.6-plan.md` §5, "the belt never widens") came back: with honest rates the
  belt *does* build (root 19.6–29.7 km) and is then consumed, and the collision brake
  fails because it tracks the instantaneous belt width. Closing R4 needs a built-orogen
  measure; whether it is derived from column inventory or persisted as edge memory, and
  whether that requires checkpoint/format changes, is the next engine plan's decision,
  not a constant. The review follow-up (`archive/0.1.7-review-followup.md`) also corrected the
  contact audit's Set-iterator and frame-gap bugs; the original "R2 only" strict result
  was false-green. Corrected runs still fail R2 on all four legs and reveal R1 plus event
  repeats at 100 kyr/frame, so those gates are open alongside R4. (0.1.8 status,
  `archive/0.1.8-diagnosis-worklog.md`: R1 and R3 pass on all four legs; both R2 clauses
  pass on three legs and the needle records a three-frame onset transient on 5000/5/50;
  R5 repeats remain on the two 100 kyr legs, all outside the kernel's `P.evAge` memory.
  0.1.8 M2, `archive/0.1.8-m2-worklog.md`: the brake measure is selected by measurement —
  the accumulated boundary shortening at k 2e5 meets the arrest contract on both seeds at
  50 and 100 kyr/frame. Landed as `S.edgeShort` with checkpoint VERSION 4 and the M3 matrix
  run, `archive/0.1.8-worklog.md`: **R4 MET** on all four seed/rate rows (51/67/33/43%),
  three strict legs 11/11, `5000/5/100` 8/11 on a re-rolled trajectory with each red traced
  to a measurement definition — the R1 site-window anchoring and the R2 inherited-margin
  onset — not to the hand-off. Those two definitions are the next plan's first items.
  0.1.9 (`0.1.9-plan.md`, `archive/0.1.9-worklog.md`) decides both by re-measurement on all
  four legs: R1's site is the event's own footprint and its background is the section's
  quiet-frame yardstick (0.1.5 §1's own wording; the corrected site reads 1848/2179/1286/
  2673 m against 5633/4532/1651/4815 m of quiet-frame background), and R2's needle shoulder
  is the highest real ground in the belt's own neighbourhood (the four failing samples at
  1424.1 km read 2.23 against the notch and 1.26 or less against the neighbourhood; across
  14,586 collision samples the wider shoulder flips exactly those four). After the landing
  the four strict legs read **ALL PASS (12 checks) / ALL PASS / ALL PASS / 1 of 12**, the
  single red being R5's documented frame-window repeat on `5000/5/100` (0 of 211 inside
  `P.evAge`). No engine kernel, constant, checkpoint or slice-format change.)
- **The shared files have drifted upstream (measured in 0.2.0 M5,
  `archive/0.2.0-m5-worklog.md` §9, `experiments/upstream-drift.js`).** `port/PORT.json`
  pins `luncat8/planet-geotectonics` @ `d909476` and the pin holds — at that commit both
  shared data files are byte-identical and `experiments/isomorphism.js` regenerates the
  deposit fixture from the counterpart's own code. But the counterpart's tip is 12 commits
  on (`198cc98`), where `js/data/deposit-models.js` no longer exists, `js/data/deposit-economics.js`
  has been rewritten (+193/−42: units named in `pricePer`/`gradeUnitTo`, and `screen` refuses
  a unit mismatch) and so has the `js/deposits.js` that `js/deposit-core.js` is an extraction
  of. `0.4.0-sync-plan.md` §2.5.2 cites both files, so 0.4.0 decides between re-extracting
  at a new pin and versioning the exchange token; until then the pin is the contract and
  nothing here re-extracts. `port/slice-format.js` is authored here (no `upstreamPath`):
  the counterpart has not adopted it.
- **K5 closing-kind hysteresis (0.1.11, `0.1.11-plan.md`): landed.**
  `archive/0.1.10-narrow-hold-worklog.md`: the narrow variant was not adopted. `0.1.11-plan.md`,
  `archive/0.1.11-hysteresis-worklog.md` and `archive/0.1.11-worklog.md`: candidate V1 removes
  every velocity-caused reclassification (872 to 0 pairs across 32 runs) and ties strict verdicts
  (17/32). The 126.1 km ceiling breach on seed 12 at 100 kyr was traced to a transport crossing
  defect in `COL.floor` (where rapid convergence overshot the gap and was treated as positive
  separation); resolving the crossing math in `COL.floor` restores proper floor separation,
  dropping seed 12's maximum to 81.1 km and holding the 81.7 km ceiling across all 32 runs.
  Landed in `js/columns.js` (`COL.isClosingCC` and `COL.floor`).

## 4. Not planned

- No climate, no eustasy-coupled erosion, no elastic flexure: the globe models those and this
  project reads the result.
- No spherical 2D physics: the section stays a flattened arc-length / radial-depth cut.
- No bidirectional coupling of physics fields: only observation logs cross back.
- No legacy readers: an exchange token this project does not recognise is an error naming the
  token.
