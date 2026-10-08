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
| 0.2.x | column engine: eruptives, deposits, extraction; page chrome (pause/step/reset) uses E1/E3 | `0.2.0-plan.md` | — |
| 0.3.x | particle engine P3+ (melt, eruptions, contact) | `0.3.0-plan.md`, `0.3.0-p3-plan.md` | — |
| 0.4.0 | sync/exchange: provenance, deposits core, water, checkpoint, section pack | `0.4.0-sync-plan.md` | — |
| 0.4.1 | the cut: draw a line on the globe, copy/save, paste/load, reconstruct a section | `0.4.1-plan.md` | 0.4.0's format (`port/slice-format.js`, M0 done) |
| 0.9.0 | globe page hosts the section as a library; live sync is C3+C4 | `0.9.0-draft-sync.md`, `0.4.1-plan.md` §8 | 0.4.1 M1–M2; C1 on the column engine |

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
- **K5 closing-kind drain (0.1.9 evaluation §7): settled as far as the narrow hold goes.**
  `archive/0.1.10-narrow-hold-worklog.md`: the narrow variant cuts drain-caused reclassification
  (1006 to 67 pairs over 16 runs) and fails six strict runs the base passes, so it is not
  adopted. Decided: the base is accepted. Hysteresis on the closing kind is the only remaining
  option and needs its own plan.

## 4. Not planned

- No climate, no eustasy-coupled erosion, no elastic flexure: the globe models those and this
  project reads the result.
- No spherical 2D physics: the section stays a flattened arc-length / radial-depth cut.
- No bidirectional coupling of physics fields: only observation logs cross back.
- No legacy readers: an exchange token this project does not recognise is an error naming the
  token.
