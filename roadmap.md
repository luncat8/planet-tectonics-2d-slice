# Roadmap — 0.3 to 0.9

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
| 0.3.0 | particle engine P3+ (melt, eruptions, contact). **P3 closed at P3.5**: conserved pool/routing, phase and enthalpy, segregation/storage, conduits, conserved wall-clock flight through landing/cooling/welding, and the integrated acceptance pass with the reserve frozen — `archive/0.3.0-p3.5-report.md`. **P4 closed at P4.4**: contact/underthrusting, slab sinking and deep recycling, arc melt from the slab, particle erosion/deposition, and the integrated acceptance pass with the P4 constants frozen — `archive/0.3.0-p4.4-report.md` | `0.3.0-plan.md`, `0.3.0-p3-plan.md`, `0.3.0-p4-plan.md` | — |
| 0.3.1 | buried-deposit remelting: **closed at M2** — the shallow-quench certificate, the G5 deposit gate (depth, threshold, certificate and M2's field support), the source-aware equilibrium split and the `thr.depMelt`/`tx.depMelt` books. Every cell closes both identities at zero refusals. At 300 Myr the field term holds the whole intake back — the deposits that reach `meltHold` there get there by the pairing's own concentration, 0.21–0.31 of T above the field they sit in; at 600 Myr it admits 9.730 km² in 3 transfers, at a field support of +0.0005..+0.0419 and a gain of 0.68–1.88, which is sediment the interior warmed | `0.3.1-plan.md`, `archive/0.3.1-M2-acceptance-report.md` | 0.3.0 P4.4 baseline |
| 0.3.2 | the light-parcel heat concentration: a parcel carrying a small share of its stencil's marker mass takes an amplified specific increment from the adjoint gather, so buried deposits reach T 2.267 in a field of 0.288 — outside the engine's own −0.5..1.5 wall — and 0.3.1's 300 Myr intake stays held back until that is answered | `0.3.2-draft.md` | 0.3.1 M2's routing-event columns |
| 0.4.0 | sync/exchange: provenance, deposits core, water, checkpoint, section pack | `0.4.0-sync-plan.md` | — |
| 0.4.1 | the cut: draw a line on the globe, copy/save, paste/load, reconstruct a section | `0.4.1-plan.md` | 0.4.0's format (`port/slice-format.js`, M0 done) |
| 0.4.2 | the `pgt-slice-pack` v2 cutover: Phase A (staleness ledger, one decode entry, bake retirement), Phase B (one coordinated port bump, no v1 reader), Phase C gated/not started (core-log return, live bridge — topology-rebuild gate open) | `0.4.2-plan.md` | globe 0.8.0–0.8.2 handoff (`port/` v2 codec + fixture); globe 0.8.3 gates for Phase C |
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
which is why the legs are 5 Myr and isothermal.

0.3.0 P4.1 (`archive/0.3.0-p4.1-report.md`) lands slab sinking and deep recycling (`js/pt/slab.js`,
`PTSLAB`: `run`/`background`/`sink` at G4's tail, plus `recycle()` in `js/pt/pool.js` and the
fixed-capacity deep record set `dpX..dpW` in `js/pt/state.js`). A detached cold slab segment below
`P.yCrust` (`T <= P.slabT = 0.45` and `Trow[j] - T >= P.slabdT = 0.05`, excluding clusters of size
`>= P.plateMin`) descends at `min(kSink * dT, vSinkMax)` and transfers into a deep record at
`P.yDeep` (`2,400 km`), counted once in both inventories (`invDpM`/`invDpL`/`invDpW`) and deferring
at capacity (`deepCap 32`). `experiments/pt-p4-slab.js` (27 checks) gates the drive, the three
exclusions, the single-call debit/credit transfer, the deferral path, a live arrival, the
hand-over from P4.0, and the 300 Myr live planet (439 transfers into 6 records holding 86,272.6 km²
= 0.207% of the world).

0.3.0 P4.2 (`archive/0.3.0-p4.2-report.md`) lands arc melt from the slab (`js/pt/arc.js`, `PTARC`:
`run`/`wedge`/`release` at the head of G5 ahead of `melt.js`). The shallowest cold surface skin of
the `'cool'` start (`M.yN[j] <= P.yWet = 20 km`) carries bound water `P.slabW = 0.005`, which
leaves a cold lid or slab (`T <= P.slabT = 0.45`) completely solid (`Ts >= 0.68`) at every depth.
When a detached cold slab segment sinks through `(P.yArcMin, P.yArcMax]` (`250..600 km`), it
releases `min(P.kArc * dt, P.arcFrac)` of its water into the warm, unsegregated mantle wedge above
it (`P.yCham..P.yArcMin` within `P.arcSpan = 125 km`, up to `P.arcTop = 4` candidates per column
ordered by solidus gap `Ts - T`), depressing the wedge's solidus through `meltWW` (`20`) and
re-reading `(T, melt)` from `H` via `PHASE.byH` while booking `m * dT` in `S.ledger` so the P3.1
latent-heat identity holds. The P3.2 segregation, P3.3 conduits (including explosive opening when
`chW / chM > wBlast`) and P3.4 ballistic flight/landing path then run unchanged, and whatever water
remains in the slab below `P.yArcMax` rides it down to `P.yDeep` for P4.1's deep records.
`experiments/pt-p4-arc.js` (26 checks) gates the release law, its five exclusions, the dipping-slab
calibration under a fixed wedge, the full P3 arc eruption path, and the 300 Myr live planet
(112,774 dehydration transfers releasing 478.03 km² of water, 320.1 km² of wedge melt, 7.26 km² of
chamber water against 0.00 km² with the pass off, and 7.25 km² of deep-record water against 42.28
km² with the pass off; 18 processes, 693 quoted checks / 685 distinct, all green).

0.3.0 P4.3 (`archive/0.3.0-p4.3-report.md`) lands particle weathering, erosion and sedimentation
(`js/pt/erode.js`, `PTERODE`): the runoff/stream-power law `pt-p4-transport-sweep.js` chose over a
conservative hillslope rule (basin capture 100.0% against 4.9%, transport reach 96.3% against 0.0%
at equal work) moves the 120 km weathering band's material down `zh`'s own drainage into P3.4's
deposit stock — 1,432,033 transfers moved 99,231 km² in 300 Myr, the world ends with 352,435 km²
of sediment in 763 parcels, the profile `zh` itself untouched, unmet demand 0.01% of throughput,
0.446 ms/frame of the pass's own work.

0.3.0 P4.4 (`archive/0.3.0-p4.4-report.md`) closes P4: `experiments/pt-p4-check.js` runs the four
P4 legs together — the configuration no owner harness runs — over 300 Myr at the demonstration
clock and a slider matrix, delegates the six owners with counts quoted, and freezes the P4
constants each above its own measured worst case. The integrated leg decided the two open §4
questions (no plate-size threshold on the contact table — 99.6% of the answered pairs are sub-plate
fragments the pass answers; the brake stays translation-only), found the deposit book's missing
third debit (`thr.deepDep`: subducted sediment is recycled by the slab pass like any detached cold
lithosphere), and its first full run caught the earlier P4 owners' live legs having drifted off
their own planets when P4.3 shipped without isolating `P.ero` in them.

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
- **Remelting buried deposits (`0.3.1-plan.md`): closed at M2, with the intake filtered rather
  than closed.** G5 routes a deposit only when it is past the 30 km cooling mask, carries the
  shallow-quench certificate (`depQ`, earned by a positive-time pass that leaves the parcel
  below `meltHold`, conjunctive through merges and carries), is at the threshold, and — M2 —
  sits in a node field that reaches its own solidus; the transfer is the existing equilibrium
  split with its own `thr.depMelt`/`tx.depMelt` books. The first four terms ran on two of eight
  seeds (35.2 km² in 6 transfers on seed 6, 5.08 km² in 7 on seed 8) and the fifth holds all of
  that back, because every crossing the four-term gate took was the pairing's light tail rather
  than sediment the interior had warmed: 0.222–0.305 of T above the local field, at 0.5% of the
  stencil's marker mass and an adjoint gain of 1.12–1.29 — against a mantle segregation that
  routes 3221 parcels at a mean gap of +0.004 in the same leg, and a buried-deposit population
  that sits 0.126 *below* its field. On the 600 Myr cell (seed 5) the same term lets the route
  run: 9.730 km² in 3 transfers at a field support of +0.0005..+0.0419, a T-field gap of
  +0.020..+0.063 and a gain of 0.683..1.878, which is the mantle's own routed signature, while
  it holds back 6.814e4 km²·Myr of the other population at gaps up to +1.328 and gains up to
  11.880. What the term holds back at 300 Myr is exactly M0's exposure (seed 6:
  1.361e4 km²·Myr of certified, buried, threshold-molten host mass-time, its field 0.127–0.291
  of T below the parcels' own solidus), so the population is measured rather than lost. Both
  identities close on every cell at zero refusals and no constant moved
  (`archive/0.3.1-M2-acceptance-report.md`, `archive/0.3.1-M1-remelt-worklog.md`).
- **The light-parcel heat concentration (0.3.2, `0.3.2-draft.md`): open, and it is what closed
  0.3.1's intake.** `grid.js` renormalizes the gather by `cw = mu_k / W_k` so the domain's whole
  intake equals the operator's own wall flux, which `pt-p4-check.js` gates at
  |intake/wall − 1| < 5e-5; the distributional price is that a parcel's *specific* increment
  scales with that same `cw`, so the light tail of the cloud is heated past the field it sits
  in. Measured: a buried deposit reaches T 2.267, H ≈ 2.5 at 74 km in a field of 0.288 on the
  600 Myr matrix leg — outside the engine's own −0.5..1.5 temperature wall — and the crossings
  0.3.1's four-term gate took carried gains of 1.12–1.29 at 0.5% of their stencil's mass, while
  the mantle population's own gain is 1.05 mean at 9% share. On that same 600 Myr cell the
  population 0.3.1's field term holds back runs to a gain of 11.880 and a T-field gap of +1.328
  over 6.814e4 km²·Myr, beside the 3 transfers it admits at a gain of 0.683..1.878 and a
  positive field support. A remedy is measured against the intake gates and not against a
  routing count, and it has to leave those three transfers alone; the candidates are a
  mass-share floor on the
  gather, a phase-scoped relaxation toward the field (`flip < 1` for deposits only), and a
  minimum parcel mass below which a deposit is merged rather than carried
  (`archive/0.3.1-buried-deposit-matrix-worklog.md`, `experiments/pt-buried-deposit-melt.js`'s
  routing-event columns). **Status: M0 measured a gain cap, a mass-share floor, a deposit
  relaxation and a local minimum-mass merge on the 600 Myr seed-5 cell and selected none —
  each still violates the −0.5..1.5 wall or loses the intake/wall gate
  (`archive/0.3.2-M0-heat-tail-report.md`).** M0 also exposed a latent-identity failure on
  the *unmodified* baseline at this horizon (9.66e-3 relative, 167.36 km²·H at frame
  11992) that the short owner legs never reach. **M1 localized it and measured the plan's
  bounded redistribution (`archive/0.3.2-M1-localization-report.md`):** the drift is
  entirely the unbooked equilibrium snap of airborne batches `FLIGHT.launch` creates
  off-manifold (T from the batch enthalpy, melt from the vent stock's aggregate), which
  `PHASE.equil` remaps without booking because air is the one phase no ledger covers —
  203,592 launches, 34,826 off-manifold, every significant snap reading xiEq 1 against
  xiStock 0.901..0.999, onset at 346 Myr, closing against the −167.41 km²·H drift to
  2.0e-8, while every grid-coupled path closes to under 4e-7 over 12,000 frames (the
  seed-1 300 Myr owner leg runs 75,979 launches at 1.09e-13 because none leaves
  off-manifold inside its horizon). The node-wise conservative bounded redistribution
  preserves the wall (1.309e-3) but is rejected: 3,118 of its placements find no local
  capacity in a ~4-parcel bucket and its out-of-bound count equals its giveback count —
  the constraint is local heat capacity, not local energy. **M2 remedied the launch/air
  booking (`archive/0.3.2-M2-launch-air-report.md`)** — the identity closes to 9.63e-9 km²·H on
  the extended cell, every grid-coupled reading of which is bitwise unchanged — **and
  re-measured the tail on that green identity, selecting nothing
  (`archive/0.3.2-M2-tail-matrix-report.md`):** stencil-scale bounded placement is feasible
  but clips the light deposits at T = 1.500 while they stay 0.72 above their field, and the
  held-back concentration grows; a zero-sum sub-grid relaxation toward the field removes the
  concentration and holds the bound, wall and books on deposits, but re-melts P3.2's
  undepleted residue every frame (8,559 transfers from 40 parcels, hosts to 5e-324 km²; over
  the mantle, a saturated pool); booked against the wall instead, it is −7.5% of the wall
  flux. The M2 clock/seed matrix holds the latent identity at ≤ 3.3e-12 of its books on all
  21 cells and finds the concentration in mobile melt too (seed 2 above 1.5 at three of four
  clocks). The shipped tree passes every owner harness serially (15 legs, 617 checks; 14.78
  and 16.82 ms/frame at 50 kyr) and stays red on that per-phase bound. **M3 measured the melt
  depletion the sub-grid row was missing, and read both faces with instruments of their own
  (`archive/0.3.2-M3-depletion-report.md`); it selects nothing, and no row would be eligible.**
  Water-flux depletion of the split (`--dpart 0.01`, the residue's solidus rising by what the melt
  took) closes the degenerate route at its source — that row goes from 8,559 transfers / 7,876
  bleeding / smallest host 5e-324 km² to **75 / 3 / 1.2e-4**, and its frozen P3.2 census from
  13,273 splits back to **5,017** against the bank cell's own 5,086 — with every book, the wall
  (2.680e-3), zero refusals and 15.002 ms/frame serially intact. What rejects it is the other end
  of the same bound: **no M3 row holds −0.5..1.5**, the crossings move to the cold side in the
  mantle (814 samples at −1.069 for `--dpart`, 217 at −0.872 for a refractory `--cap 0.25`, 3,484
  and −1.137..1.519 for both together, i.e. both ends in one phase), and they are carried by 1–3
  individual parcels of 36–154 km² at 4–23 km — at or near `eroMinM` 50, the weathering front's
  own floor — sitting 0.55–1.26 of T *below* the field they are in. The bank cell's own global
  mantle minimum is already that signature without crossing (a 191 km² parcel at 4.2 km, 0.548
  below its field, 0.011 inside the wall), so **the concentration is two-sided and one mechanism:
  the adjoint gain amplifies whatever increment a light parcel's stencil carries, and the
  increment is not always positive.** Drying alone closes less than half the row (4,509 of 8,559
  candidates still above the fully dry solidus; median excess over a parcel's own solidus
  +0.0217), which is what the refractory budget is for, and the cap does stop the bleed by force
  (50 delivered of 6,604 candidates, zero bleed) at 178,181 blocked candidates and 176,087 mantle
  re-presentations. The mobile-melt face is one excursion per clock: a 16–21 km² fully molten
  parcel *rising* through a field 1.4–1.7 of T below itself with `dT = dH` exactly, born inside
  the bound (its own dry liquidus at 186–314 km is 1.08–1.12) and overshooting by 0.011 / 0.016 /
  0.027 at 50 / 100 / 500 kyr — a per-frame gather intake, not a transit law. The cold-side band
  table also reads the deposit quench's reaction path: quenched deposits are the coldest material
  in every band of the bank cell, one holding −0.2941 → −0.2925 while it sinks from the 250–500 km
  band to the 1,000–2,000 km band over 36 Myr (0.0016 of T), the same no-restoring-force effect on
  the cold side; the
  deposit-scope relaxation removes it and **inverts** the ordering (deep deposit minima +0.317 and
  +0.399 against the same bands' mantle −0.086 and −0.075), a scope consequence no gate currently
  reads. Next: bound the distribution on both sides at once, on top of depletion, with the bound
  the parcel's own field rather than a constant; measure the adjoint gain at the excursion samples
  and the cold minima (`pt-buried-deposit-melt.js` already has the reader) so §3's mechanism is
  measured rather than inferred; split the per-phase outside count into its two ends; and decide
  whether a descending cold anomaly is geology to protect, the way the route protects its three
  transfers, or the same artifact as the hot tail.
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
