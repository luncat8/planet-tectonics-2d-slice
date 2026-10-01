# Roadmap — the shell, the transect and the merged page (0.4 -> 0.9)

This file is the review of the existing plan set and the release table that ties the three
engines together. Each release still has exactly one plan file and that plan is the
authoritative document for its own milestones; this roadmap only says what belongs to which
release, what every release must obey, and what is deliberately deferred.

The review below was made against the tree at `25daf36` ("0.3.0-P3 — Plan") and against
`luncat8/planet-geotectonics` at `1e45126` (2026-10-01). Findings that changed a plan are
listed with the edit that was applied. The request that opened this line of work is the
`## >0.3` section of `draft.txt`, kept there in the words it was asked in.

## 1. Where the project stands

### 1.1 Three engines in two repositories

| engine | page here | state | domain | clock |
|--------|-----------|-------|--------|-------|
| column engine | `index.html` | 0.1.x done, 0.2.x planned, not started | 1D columns on the full circumference, 512 columns x 96 beds, log depth scale | Myr (10 kyr..200 kyr/frame) + an eruptive seconds clock |
| particle engine | `particles.html` | 0.3.0 P0..P2.3b done, P3 planned | 2D `x`-periodic slab, 16 000 km x 2900 km, markers + FFT/Thomas grid | Myr (5..500 kyr/frame) |
| map engine | `planet-geotectonics`, `index.html` | 0.5.x shipped (CPU + WebGPU + 3D globe + Earth packs); 0.6.x deposits and 0.7.0 live resolution planned | sphere, icosphere L5-L7 (10 242..163 842 cells) + equirectangular Earth packs | Myr (10..100 kyr/frame) |

The map engine is the reference for physics and deposits (project `AGENTS.md`), and at 0.9 it
becomes one of the views of this project rather than a separate page.

### 1.2 Two plan tracks and one release train

- the **particle track** (`0.3.0-plan.md`, `0.3.0-p3-plan.md`) is the active development line;
- the **column track** (`0.2.0-plan.md`) is the unfinished remainder of 0.1.0: the toy
  eruptive box, depth-resolved deposits and extraction, and save/load;
- the **releases** below add the page, the exchange and the cross-section. A release may pull
  a milestone out of either track when it is the piece that makes a page usable; it never
  re-specifies a kernel.

## 2. Review of the existing plan set

### F1 — two engines cannot share one page today (blocking for 0.9, cheap to fix now)

In a classic script every top-level `var` creates a global property, so the two engines do not
have separate namespaces at all. `js/params.js:11` declares `var P`; `js/pt/state.js:11`
declares `var P` again and assigns `window.PTP` to it. `js/state.js` declares `var S`;
`js/pt/state.js` and `js/pt/sim.js` declare `var S` and assign the particle state. `js/sim.js`
and `js/pt/sim.js` both declare `var SIM`. After loading the particle engine into a page that
already has the column engine, `window.P` is `PTP` and `window.S` is `PTS`; the column engine's
kernels look `P` and `S` up at call time, so they silently read particle parameters. The
`PT*` export names are already correct — the leak is only the unexported `var`s (`P`, `S`, `G`,
`F`, `SC`, `SIM`, `UI`, `RNDR`, `GEO`).

**Action.** New rule C1 (one file, one global) and milestone 0.4.0-M0, gated by a new
`experiments/globals.js` that loads both engines into one vm context and steps both. Also
added to `0.3.0-plan.md` §12 so the P3 files are written under the rule from the start.

### F2 — `index.html` is behind `particles.html`, and behind its own 0.2.0 plan

Missing against the particle page: pause/step/reset/new-planet buttons (`space . r n`), the
quality cycle, the preset radio semantics, the overlay bus, the ledger lines in the HUD, and
the 2 Hz rebuild rule. Missing against its own plan: save/load and the seed field (0.2.0-M4),
the vent and deposit readouts (0.2.0-M1..M3), and any way to reach the ore overlays.

**Action.** `0.4.0-plan.md` re-homes the page-level items (transport, quality, presets, overlay
bus, instrument panel, captures, save/load) and `0.2.0-plan.md` keeps its kernels; the plan
files cross-reference so nothing is specified twice.

### F3 — no shared chrome, two control vocabularies

The two pages duplicate their CSS (`body`, `button`, the `aria-pressed` lit rule, `canvas`,
`#hud`) and use incompatible control idioms: the particle page has `quality 1/3` and
`lid / deep / mantle`, the column page has four presets `def / ovw / cru / bas` and no
transport buttons at all. A shell cannot present both without a shared vocabulary.

**Action.** `0.4.0-plan.md` §3: `style.css`, one preset vocabulary (overview / section /
mantle / detail), one keymap table, one overlay-bus convention, one HUD field set.

### F4 — both engines self-start, so no page can host them

`js/sim.js` and `js/pt/sim.js` end with a `document`-guarded bootstrap that builds the engine,
starts the rAF loop and stores the timer globally. That is why the two pages cannot be
composed, and why a fixture has to load them in a fake DOM.

**Action.** 0.4.0-M1 turns each engine into a library with `COL.start(host)` / `PT.start(host)`
and moves the bootstrap into the page markup; the harnesses keep driving the pages, not the
libraries, so they still pin the real wiring.

### F5 — the fixtures pin the pages by id

`experiments/pt-ui.js` parses `particles.html`, reads a fixed id list (`bMark`, `bMesh`,
`bFull`, `hud`, ...) and asserts behaviour through it; `experiments/smoke.js` does the same for
`index.html`. Any id change must move the page and its fixture together, and the shell must not
invent a third id convention.

**Action.** 0.4.0-M1 defines the id-prefix rule and the ids table per engine; 0.4.0-M7 extends
both fixtures and adds `experiments/ui-parity.js` so the two pages cannot drift apart again.

### F6 — three unit systems meet in the exchange

The column engine uses m, Myr, m/Myr; the particle engine uses km, km/Myr and a normalised
temperature; the map engine uses m, Myr, m/Myr, degrees and a normalised `Tm`. The particle
engine's own header calls unit mixing "a silent 1e6 bug".

**Action.** Rule C3: every field of the exchange carries its unit in its name, the exchange's
canonical units are the map engine's (m, Myr, m/Myr, degrees), and each engine converts at
exactly one boundary (for the particle engine, the import kernel; for the column engine, none).

### F7 — the two crust engines already share an isostasy law (a test, not an assumption)

`SURF.elev` here and `Surface.elevation` there are the same expression with the same constants:
`-3342 + hFel/6 + (hMaf*350 + hSed*900)/3300 - therm + zDyn`, `therm =
(1-ci)*350*sqrt(min(age,80)) + ci*2091`, `ci = smoothstep(hFel, 5000, 20000)` (rhoM 3300,
rhoFel 2750, rhoMaf 2950, rhoSed 2400, zRef -3342 here in `js/params.js:204`).

**Action.** The 0.6.0 reconstruction gate is an identity, not a tolerance on appearance:
a column built from an imported `(hFel, hMaf, hSed, age, zDyn)` must reproduce the map's `z`
to `1e-3 m` before any evolution step. Any larger error is a mapping bug, not a modelling
choice.

### F8 — no capture format yet, and P3 is about to widen the state

`0.2.0-M4` planned save/load for the column engine; nothing plans one for the particle engine,
while P3 adds phase, id, enthalpy, composition and melt to every parcel. The base project's
`Checkpoint` (magic + version word, validated before live state is touched) is the model worth
copying, and P3's own fingerprint requirement is the right gate.

**Action.** 0.4.0-M6 states the capture contract for both engines and the P3 addendum requires
the version word to be the only compatibility contract and the fingerprint to cover every new
field.

### F9 — the exchange has a second customer, which is why it will be accepted

The map engine's own roadmap reserves 0.6.x for deposits and prospecting, and `0.6.1`
explicitly wants "instruments and synthetic core logs". A transect export plus a section that
returns bed-by-bed logs for the crossed cells is a feature that project wants for itself, not
only a favour to this one.

**Action.** 0.5.0 and 0.9.0 describe the return path (strata logs per crossed cell) as part of
the exchange contract, marked display/prospecting-side so it can never feed back into the map's
physics.

### F10 — the plans had no shared vocabulary for authority

Nothing in the two plan tracks said who owns which quantity when both simulate the same planet,
which is exactly the question 0.7 and 0.9 have to answer.

**Action.** §5 below is normative for 0.6.0 and later: the map owns the globe, the section owns
its strip, neither rewrites the other's physics.

## 3. The release table

| release | deliverable | plan | depends on | release gate |
|---------|-------------|------|-----------|--------------|
| 0.3.x | particle engine P0..P5 (melt, eruptions, contact) | `0.3.0-plan.md`, `0.3.0-p3-plan.md` | — | 0.3.0-plan §10, every fixture cited there |
| 0.4.0 | `index.html` is the shell; one instrument contract; captures and save/load | `0.4.0-plan.md` | — | `globals.js`, `ui-parity.js`, `smoke.js`, `pt-ui.js`, a resume-identical save/load run |
| 0.5.0 | the transect exchange: the `SLICE1` pack, the producer, the paste/import path | `0.5.0-plan.md` | 0.4.0-M1 (a panel to paste into) | `slicepack.js`, `slicepack-cross.js` with a recorded golden pack |
| 0.6.0 | the line picker and the reconstruction: an imported section is a real cross-section | `0.6.0-plan.md` | 0.5.0 | `slice-recon.js`: the F7 identity, volume preservation, a legal state, 1000 frames without NaN |
| 0.7.0 | live sync of the map and one section, one clock, the resample ledger | `0.7.0-plan.md` | 0.6.0 | `sync-check.js`: 1000 frames with a fixed line and with a dragged line; ledgers close; fps measured |
| 0.8.0 | reserved: the map engine as a pinned library here (the vendoring, the parity contract, the update tool) | decided in `0.7.0-plan.md` §2 and `0.9.0-plan.md` §2 | 0.7.0 | the pin update tool, the parity fixture, both engines' own suites green |
| 0.9.0 | one page: globe + top view + section, one clock, one capture, the strata-log return path | `0.9.0-plan.md` | 0.7.0/0.8.0 | `page0.9.js`: the three views on one file:// page for a recorded minute, ledgers within their tolerances, measured fps |
| parallel | column engine's remaining 0.1.0 features (eruptives, deposits, extraction) | `0.2.0-plan.md` | the page slots land in 0.4.0 | 0.2.0-plan §2 |

0.8.0 is deliberately a buffer: if 0.7.0 decides that two views are enough and the merge can
wait, the vendoring slips into 0.9.0 and 0.8.0 stays empty. A release number is a bookmark, not
a promise of scope.

## 4. Cross-cutting contracts

These are normative for every plan from 0.4.0 on. A plan that needs to break one says so and
records why.

- **C1 — one global per file.** A script may create exactly one global, the name it exports
  (`window.COLP`, `window.PTP`, ...). Every other top-level name lives inside the file's IIFE.
  No engine writes a name the other engine reads. Node guards (`module.exports`) stay inside
  the IIFE.
- **C2 — one id per view, scoped by engine.** Elements are `col-*` or `pt-*`; each engine has
  one ids table; the harnesses read the page's prefix instead of hardcoding a name. `#hud`,
  `#c` and friends do not survive as unprefixed ids.
- **C3 — units are in the name.** Exchange fields carry `_m`, `_myr`, `_mmyr`, `_deg` or `_1`;
  canonical exchange units are metres, Myr, m/Myr, degrees and normalised temperature. Each
  engine converts once at the boundary, never inside a rate constant.
- **C4 — one codec, three transports.** The same parse/build code serves the clipboard text,
  the `.slice.txt` file and the in-page sync. A second implementation of the sampling or the
  mapping rules is a bug waiting to be found in a fixture, so there is only one.
- **C5 — a run is reproducible from its capture.** A capture records the page, the engine
  version, the seed, every non-default setting, the step sequence, the pack fold (when a
  transect was imported) and the state hash at the moment of writing. `?seed=&dt=&...` prefills
  the same run from a URL, as the map engine already does.
- **C6 — a ledger is never silent.** Material or enthalpy that a re-sampling, a capacity cap or
  a merging step cannot account for goes to a named ledger line and is reported in the HUD and
  in the fixture. A reconstruction residual is a number, not a comment.
- **C7 — no build, no modules, no internet.** file:// friendly, classic scripts, local vendor
  files only, `module.exports` guards. A vendored engine is a pinned copy with a version file,
  not a package.
- **C8 — every number comes from a script.** Any constant a plan turns into a default cites the
  experiment that set it, re-runnable under `experiments/`. This already holds for the two
  existing tracks and it is what makes the cross-repo contract testable.

## 5. Ownership: who is authoritative for what

| quantity | owner | the other side may |
|----------|-------|--------------------|
| plate kinematics, plate topology, sutures/splits | map engine | follow it, never edit it |
| crustal inventory (hFel/hMaf/hSed), isostasy, sea level | map engine | read it, never rewrite it |
| ore potentials, deposit catalogue, fertility | map engine | instantiate its own deposits from the imported potentials, reported separately |
| vertical structure inside the section's strip: beds, bedding, porosity, local sediment routing | section engine | report it back as an observation log |
| stratigraphic logs for a crossed cell | section engine | be stored by the map engine as a display/prospecting record |
| clock `t` | map engine when synced | substep between map steps, never run ahead |
| the particle engine's small-scale mechanism demo | particle engine | remain a separate view; it consumes a pack only as scenery |

The rule behind the table: the side with the coarse, global, conserved field keeps physics
authority; the side with the fine, local field may only return *observations*, so a section can
never invent mass in the globe and a globe can never silently overwrite a bed.

## 6. Decisions deferred to their own plan

- **Where the picker lives** (0.5.0 M3, 0.9.0 §3.3): v1 is "draw in the map project, copy, paste
  here" because that is the smallest thing that works and it survives file://; the same codec
  then serves the in-page picker when the map engine is vendored. The criteria for the later
  choice are recorded once, in `0.9.0-plan.md` §3.
- **The 0.9 architecture** (vendored library vs iframe/postMessage vs two pages): both are
  costed in `0.7.0-plan.md` §2 and decided in `0.9.0-plan.md`. The deciding evidence is the
  transport experiment in `0.7.0-plan.md` M0, because a live link between two local pages is
  only real if a browser under file:// allows it.
- **The resample cadence** (0.7.0 §3, §4 and M4): a number, not a preference; it comes from the
  import-cost measurement and is stored in `params.js` like every other calibrated constant.
- **Whether the particle engine becomes a third view** of the shell: not planned before 1.0.
  It keeps `particles.html`, which is the page its own fixtures read.

## 7. Not planned

- No climate, no eustasy-coupled erosion, no elastic flexure: the map engine's 0.7.2 reserves
  those and this project reads their result, it does not model them.
- No spherical 2D physics: the section stays a flattened arc-length/radial-depth cut (0.6.0 §2
  states the projection and its error).
- No bidirectional coupling of *physics* fields: only observation logs cross back (see §5).
- No legacy readers: an exchange token this project does not recognise is an error with the
  token in the message, never a best-effort parse.
