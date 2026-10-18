# findings, pitfalls, skills

notes and pitfalls for LLM agents. write here if found good way to do something.

## scales (0.1.0 planning, see experiments/scale-check.js)

- do not mix the sim row mesh with the display transform. geometric graded rows
  (20 m -> 1000 km) distributed uniformly over screen pixels draw volcanos as needles
  (4:1+, measured) because the grading over-weights the top band. rows are a sim mesh;
  the display is `u = asinh(y / 40 km)` (smooth vertical log anchored at 0 m: linear in
  the crust band, log in the mantle) — a real 40 km x 4 km cone then lands at 17 x 16 px
  at the default window and stays square-ish at every band zoom.
- thin beds cannot live in rows (10 m beds at the center of the scale budget would need
  millions of rows). keep stratigraphy in Lagrangian column layer stacks and paint them
  through the display map: sharp at any zoom, zero advection smear.
- "volcano 10-30 px" is a screen statement: run the eruptive toy sim in screen-anchored
  cells (1 cell = 1 px at default zoom) so the edifice is literally 10-30 toy cells.
  square world cells are 9:2 bricks on the default pixel (2.34 km x 0.25 km) — avoid.
- two time sliders (10-100 kyr/frame geology, minutes-hours/frame lava) must couple only
  through a buffered quantity (chamber volume), never by scaling each other — otherwise
  fast geology turns eruptions into strobe lights.

## 0.1.0 implementation (M0)

- the design's own overview numbers (465 m/px at 0, cone still 17.1 px wide) require
  ANISOTROPIC zoom: a single zoom scalar cannot fit full depth and keep the 2.34 km/px
  horizontal. view = {cx, cy, zx, zy}; the wheel scales both together, presets set them
  separately (overview: zx 1, zy 0.052). Found by re-deriving §1.4 before coding.
- fan merge row formula — SUPERSEDED, kept so the flip is on record. An early note said
  "keep round(k*N/9); don't fix the bottom row to 1 cell because it changes the cited
  fanCells." That rationale was backwards: the draft explicitly wants "a single cell at the
  center" (§1.1), and round(k*N/9) is exactly the bug that prevents it (the 9th merge lands
  past the last row, leaving 2 half-wrap cells). The correct rule is
  round(k*(N-1)/9) for k=1..9 → bottom band 1 cell, N=64 → 7155 cells. When a cited number
  conflicts with a stated intent, fix the number and update the table (now 5247/7155/9063/
  10903/14341), not the intent. A sibling branch measured both and chose 7155; we agree.
- reference design (planet-geotectonics §6.4) writes Tm(t) = Tfloor + (1-Tfloor)*exp(...),
  which would give Tm(0)=1, not its stated 1.6. The slice design already uses the correct
  Tfloor + (Tm0-Tfloor)*exp(-t/tau). Keep that; don't port the typo.
- file:// + node dual runtime: every js file declares its own top-level var and ends with a
  guarded module.exports; files that need others `require()` them only in the node branch
  (browser gets shared window vars by script order). Browser-only files (ui/render/sim)
  must not touch P/GEO/etc at load time — keep preset objects and such inside functions,
  so node require/load never needs the missing globals. experiments/smoke.js runs all eight
  files in a vm context with a DOM shim to prove page-order wiring.
- xorshift128 in 32-bit halves (Marsaglia tuple (11,19,8)) is the right size for JS: no
  64-bit ops needed, period 2^128-1, and 4 words fit the save file (RNG.state/setState).
- reference §8 oArc/trenchDist is 1-2; the slice design deliberately uses 1..3 (wider arc
  factory in a section view). The slice design wins when the two differ.
- w0 = 2*pi*R/512 is 78.184 km, NOT 78.36 km (78.36 implies R = 6385 km). Derive it from
  wrap/nCols in params.js so it cannot drift; a comment is not a source of truth.
- mixed time units in one constants table is a silent 1e6 bug. epsHi 2e-3 m/yr sitting next
  to vRef 5e4 m/Myr, and extRef 1e-8 /yr next to kDam 0.05 /Myr, are a trap. One unit system:
  m, Myr, m/Myr, 1/Myr; the eruptive clock is the only seconds quantity. Convert the
  reference's per-year rates on import (epsHi 2e3, vSuture 3e3, extRef 1e-2).
- a test reference that assumes colX[0] >= 0 is WRONG for a periodic world: an unwrapped or
  perturbed column set can have a negative first position, and the brute-force owner must be
  "the column whose position is the nearest predecessor of x going backwards around the
  circle". Build the reference from the definition, not from the LUT's assumptions — a
  shared assumption makes the test vacuous.


## 0.1.0 implementation (M1)

- the fan stencil must be face/dist and symmetric BY CONSTRUCTION: 6 slots (left, right,
  down x2, up x2), each carrying the shared face width and the true centre-to-centre
  distance; the coarse-fine face is the FINE cell's width on both sides and the up/down face
  widths of any cell sum to its own pitch. view-check asserts all three, so a later diffusion
  kernel needs no special case at a coarse-fine interface. The single-cell bottom row must
  NOT link to itself (zero flux around the wrap) — leave those slots empty.
- per-screen-row fan lookup is one multiply if lutX is stored wrapped into [0, wrap) and the
  LUT carries (rowBase, rowCnt, 1/pitch): cell = base + (lutX * invP)|0. Keep lutX unwrapped
  only if something needs continuity; nothing does.
- the "crust x10"/"basin x40" presets are a UNIFORM zoom (divisor on both axes) about a depth,
  so the design's bed-pixel table (50 m = 2.0 px at x10) holds in the preset itself. A preset
  that scales only the horizontal axis is misnamed and breaks that table (measured 0.92 px).
  The only anisotropic preset is overview (default width x full depth).
- headless body pass: render.body(st, px, w, h) writes into a caller-supplied buffer and
  touches no DOM; render.present()/ui.js are the only DOM code. Palettes allocate their own
  tables so the bench runs without init(). Measured ~3.4-4.1 ms at 1280x560 across all four
  presets, well under the 6 ms budget, with buildColLUT ~5 us/frame and rebuild ~19 us on
  view change only.
- on this throttled shared CPU the same body pass measures 3.9 ms and 6.5 ms minutes apart
  with no code change, so a timing gate must use the MIN of runs (least-contended sample),
  not the median; print the median for information. A mean/median gate flaps.
- hash-based value noise (pure function of (x, y, seed)) instead of a permutation table: the
  terrain field survives column motion, spawn and consume with no stored field, and two runs
  with the same seed agree everywhere. Keep it separate from the run-order xorshift stream.
- the initial planet is not believable without isostasy: move the STATIC half of surface.js
  (elevation + wrapped slope) into M1, and do profile -> sediment fill -> profile again so the
  basins respond. Sediments need the basin shape; a "bedrock proxy" reads as wrong.
- to make bedding visible at x10/x40 the initial stacks need a handful of thin beds: split the
  felsic core into ~4-10 beds and basin sediment into 2-6, scaling bed count with total. M3
  deposition will add the thin rhythmic beds; the initial planet just needs to read as
  stratigraphy.
- canvas y increases downward while altitude and `u=asinh(y/yLin)` increase upward. Use
  `screenY=(uTop-u(y))/duPx` for overlays, exactly matching the raster LUT and `yAt`; the
  tempting `(u(y)-uBottom)/duPx` reflects every overlay around the viewport. Grid levels
  stored in ascending world altitude then have descending screen y, so label collision
  checks must traverse them in reverse (or compare absolute screen gaps). Test top/bottom,
  `yAt(sy(y))`, sea-level alignment and rendered label order—not only grid-array sorting.

## Section geometry vs axis regressions

A correct screen-y map can still show block-like crust if only the surface is interpolated:
interpolate the rendered Moho with the same column fraction, use it for both raster and
overlay, and invert any display-only stack stretch in the probe. Never write interpolated
thicknesses back to geological state. Separately, quantile land selection needs a coastal
thickness taper; a binary 0→35 km felsic jump creates artificial continent walls.

## 0.1.0 implementation (M2.1)

- integer mantle harmonics + two half-wrap plates = motionless plates: the mean of
  cos(n x / R) over half the wrap is exactly 0 for every even n (6, 10, 16), so only the odd
  mode drives and plates crawl at ~2 mm/yr. Start with several unequal plates (plates0 8,
  jittered boundaries); then the mean fit sees different flow under each plate.
- a coarse fan cell must not take a column property from the column at its centre: at 50 km
  depth a cell is 2500 km (32 columns) wide, and one young-ocean column at the centre warmed a
  whole cell under a continent (a hard vertical step at x = 0 in the render). Spread each
  column over the cells it overlaps and blend by covered fraction. Same rule for any future
  column -> fan write (slab cold, plume heat).
- a semi-Lagrangian step along a fan row does not need Math.cos per cell: the centre phases
  step by kap*pitch, so a rotation recurrence gives the flow (5x faster, 1.9 -> 0.36 ms).
  m2-check re-traces every cell with the closed-form flow() to prove the recurrence equal
  (1e-14). Keep a slow closed-form reference beside every optimized kernel.
- every kernel returns at dtGeo = 0. "u relaxes by dt/tau = 0" is not enough: derived fields
  (ext, edge ages) would still be rewritten and the paused hash would change.
- python str.replace(old, new) with an empty `old` inserts `new` between every character
  (a 130k-line render.js). When patching by slicing between two anchors, assert start < end
  and old non-empty before replacing.
- a test calling GEO.setPreset('overview') silently no-ops (keys are 'ovw'/'cru'/'bas') and
  re-tests the default window. Assert that the fixtures really differ (distinct kx/duPx).
- no browser installs in this sandbox (CDN/apt blocked): experiments/snapshot.js runs the sim
  in node and writes the real body raster to a PNG with zlib, plus boundary bars.

## 0.1.0 UI (axis sliders, scale rulers)

- ruling an asinh axis needs two rules, not one. A fixed step is wrong everywhere: picked at
  the surface it draws thousands of coincident lines in the compressed deep half, picked at
  the deepest interval it leaves the detailed surface half with one line per 190 px. Use a
  round `1..9 x 10^d` ladder (the log part of the map) plus a 1-2-5 subdivision of any band
  still wider than ~3 labels (the linear core). Ladder alone leaves a blank 280 px strip
  between 10 and 20 km at crust zoom; subdivision alone is the old failure.
- anchor the ladder greedy at 0 and run it over the whole world, then clip to the window.
  Selecting from the visible range instead makes the lines reshuffle while you pan.
- greedy "first rung that clears the gap" picks -9 km over -10 km. Choose the *set* per
  decade first (1..9, else 1,2,5, else 1) and the values stay round.
- a label cache keyed on "the value this string was built for" needs a sentinel that is not
  a legal value. 0 is a legal x-ruler value, so a zero-filled Float64Array reported
  "unchanged" and the lap-origin label stayed null. Fill the cache with NaN.
- a wrapped x axis: count the step from x = 0 *inside each lap*, not across the seam.
  Continuing k*step past the wrap gives labels like 40500 -> 470 km and the round numbers
  are lost after one lap.
- vertical range input, no transform hacks: `writing-mode: vertical-lr; direction: rtl`
  (rtl is what puts the minimum at the bottom). Lay the canvas and both sliders out in one
  CSS grid so each slider is exactly as long as the axis it scales.
- two-way controls drift unless there is one funnel. Every camera move (wheel, drag, preset,
  key) ends in UI.afterView(), which syncs the LUTs and writes the axis factors back into
  the sliders; the sliders hold no state of their own.
- a canvas polyline that `continue`s over unowned columns must track whether the path is
  open: `if (px === 0) moveTo else lineTo` draws a wrong first segment whenever column 0 is
  the one skipped (canvas promotes a leading lineTo to a moveTo, silently).
- the column smoke DOM stub reads `checked` straight out of columns.html, so the shipped
  default of a checkbox is what the headless run exercises — a flipped default fails the test,
  not the user.

## M2.2 gather / mass bookkeeping

- Transport gathers the *entire* column record and layer stack by the sorted permutation;
  remap vent/deposit owners through its inverse and validate reciprocal indices. Widths
  change even for mass-neutral plate movement: store old widths **with** their columns,
  convert thickness × old width to volume, and divide by final width only after K4.
- Newborns created while K4 uses layer volumes must have `colW=1` before `COL.push` can
  compact their stacks; otherwise mixed-lithology ledger entries have zero volume.
- A fixed-capacity scratch mark array must be cleared to capacity before appending
  newborns. Clearing only the former `nCol` leaves stale marks at append slots after a
  consume, causing an intermittent unaccounted birth in long runs. A 700 Myr ledger
  fixture catches this whereas a 100 Myr fixture does not.
- SIM invokes kernel/event function references without a receiver, so `this` is undefined in
  strict mode. Kernels and event hooks that call helpers must address their module explicitly
  (`CRU.zDyn(...)`, `COL.splitScan(...)`), not rely on `this` — hit twice, in M2.2 events and
  again in M2.3 K5/K6.

## M2.3 stencils on variable-width columns

- Write every neighbour stencil as a **face flux**, never as a per-column Laplacian: one number
  per face `F_i = k*dt*w0^2*(v[i+1]-v[i])/gap`, applied as `v[i] += (F_i - F[i-1])/colW[i]`.
  At uniform spacing it collapses to the reference's `k*dt*SUM(v_j - v_i)` so the constant keeps
  its 1/Myr meaning, the fluxes telescope so `SUM(colW*v)` is conserved by the diffusion alone,
  and it stays bounded when a contact squeezes two columns together. A true Laplacian with a
  `1/gap^2` coefficient goes unstable as soon as columns close.
- Floor the face gap (`max(gap, faceGapMin*w0)`). Without it an overlap of 0.05*w0 asks for a
  200x smaller step than the frame provides, and the explicit stencil explodes.
- Pick a sign convention and write it down at the flux site: `F_i > 0` = inflow into column `i`
  across its **right** face. A collapse diffusion that moves material from `i` to `i+1` when
  `F_i > 0` feeds thick -> thick and runs away exponentially (measured 2.87e6 km of crust in
  1200 frames). The bug is invisible in a conservation check — it conserves mass perfectly while
  it blows up.
- A flux between columns of different widths is a **volume** (m^2 of section); a stack push takes
  a **thickness**. Convert at both ends (`peel = volume/colW[from]`,
  `grow = peel*colW[from]/colW[to]`) or the receiver gains kilometres per frame.
- Relaxation + explicit diffusion are not jointly frame-rate independent: the exact exponential
  pull has effective rate `(1-e^-dt/tau)/dt = 1/tau - dt/2tau^2`, so the steady state of a running
  source drifts with dt (0.49% between 50 and 200 kyr/frame here). Measure it, assert it inside
  the tolerance the plan already allows, and say why in the fixture — don't chase bitwise.
- Transport that changes a thickness cache (`hFel`) must move **real beds**, or the cache and the
  stack disagree at the next `sums()`. Peel the donor's topmost beds of that lithology (beds above
  ride down, deposits follow their horizon) and thicken the receiver's top bed if it is the same
  lithology instead of pushing a new one — otherwise the stack fills with metre-scale beds and
  compaction churns.

## M2.3 1D degeneracies of 2D rules

- A plate-split rule that reads "the damaged cells form a corridor; split if removing them leaves
  two bodies" is self-limiting in 2D (a wide damaged zone disconnects nothing) and **not** in 1D,
  where every single cell is a cut. Ported literally it fragments the planet to `plateCap` as soon
  as damage saturates: 8 -> 32 plates, 449 of 583 columns above threshold, 1000 km orogens. The
  1D reading is the contiguous **intact** runs; both must be >= `minPlateCells`. A plate that owns
  the whole wrap is a closed ring and can never be split by a corridor.
- All shortening at a 1D boundary lands on one column (no out-of-plane spread), so gravitational
  collapse diffusion — the reference's height cap — can only spread it to neighbours that are
  themselves above the threshold. It helps a lot (946 -> 142 km peak crust over 1 Gyr) but it is
  not the cap; the erosion knee law is (~3 km/Myr at 17 km of relief, ~620 km/Myr at 100 km).
  When a 1D port exaggerates orogens, look for the missing sink, don't clamp thickness.
- Fixed-area birth mechanics don't port either: the reference fills an *empty* grid cell from
  2K donors at `1/(K+1)` each; with variable-width columns the gap is already owned and stretched,
  so the newborn must inherit the material of the territory it takes. The donor share packs 1.5
  columns of crust into a half-width cell — a spike where the design asks for a rift valley.

## M2.3 harness and measurement

- Restore a kernel slot **by saved value**. `SIM.add(5, null)` was correct when K5 was empty and
  silently disabled the column update for every fixture below it once K5 shipped; the only clue
  was a long-run printout that matched the no-K5 numbers exactly. Print a physical number (peak
  relief, plate count) from every long-run fixture — a green check on a disabled kernel still
  passes its own assertions.
- Bench two variants **interleaved in one process** (`a,b,a,b,...`, min of N). Separate runs in
  this sandbox differ by 2x from CPU contention alone (the same code measured 3.9 ms and 7.2 ms
  minutes apart); interleaving cancels it and made a +8% cost visible as +8% instead of +30%.
- Give every new rendering/physics fixture a **negative control**: revert the implementation,
  re-run, and confirm the fixture fails. The bilinear-sampling fixture reports 3-bin steps and
  0 lit pixels past half a pitch under nearest-node, 1 bin and 267 px under bilinear — without
  that run it was only an assertion, not evidence.
- Hoist anything constant across a contiguous run: the fan is a radial mesh, so one ring owns a
  run of 3-27 screen rows and its sampled colour at a given x is the same for all of them.
  Sampling and shading the ring once per screen column and stamping the run paid for adding
  bilinear interpolation several times over (default window 3.90 -> 2.94 ms). Look for the run
  structure before optimising the inner arithmetic.

## M4 ribbons and source ledgers

- A slab polyline is resampled geometry, not a conservation grid: interpolate node water
  for the new spacing, then renormalize its sum. Otherwise a visually harmless respacing
  step silently drains the dehydration ledger.
- When a ribbon tail passes the dissolution depth and its node count is shortened, sink
  the discarded node water before decrementing `ribN`; `S.mass()` only sees active nodes.
- Keep ribbon and chamber volumes in the same cross-section volume units as K4 (`m2` per
  unit depth). `S.mass()` can then include them directly, while stack additions divide by
  `colW` only at the column boundary. This made subduction, chamber overflow and width
  changes close to machine precision.
- A cooling curve can reach a cold mantle while stale plate ids retain an unused high
  velocity. Rebuild `plN` and zero velocities of empty plate records after every topology
  gather before measuring stagnant-lid speed.

## 0.1.6 plate forces, ledgers and gates

- **A gate that skips on a NaN input passes.** `P.beltFeed` went missing (a sweep restored
  `js/params.js` from a snapshot taken before the parameter was added), so the belt flank
  was NaN, the audit's `beltScan` did `if (!(flank > 0)) continue`, counted 0 collisions,
  and both R2 checks passed vacuously — `--strict` printed ALL PASS. Read the *report*
  line, not just the exit code: "0 collisions measured" is not a pass. And restore a
  sweep's parameters from a snapshot taken after the last real edit.
- **A plate's drive is the mean of the flow under it.** Modes shorter than a plate cancel
  in that mean, so raising the flow amplitude does nothing. Measure the retention
  (plate-mean / column-mean) before touching a force constant: it went 22% → 41% by
  doubling the wavelength scale, and mean plate speed tripled.
- **A boundary force is a line force.** Written as a per-column velocity it is averaged
  over the whole plate by the solve, so one boundary column brakes a 50-column plate —
  a factor of 50 lost. Sum it per plate (`PLT.fP`) and divide once.
- **The separation floor sets the model's time resolution.** A pair that closes more than
  one floor gap per frame is inside the floor every frame, so the consuming edge fires
  every frame and the trench runs at the frame rate. Check
  `max|edgeRelN|·dt < gFloor·w0` before believing any event rate: 2291 deaths in 3000
  frames became 65 by widening the floor, with no other change.
- **Retiring a record must book what it holds.** A "draining" record is not empty: a plume
  head arriving over a trench parked 1.35e4 m³ of melt in two slivers' chambers, and the
  gather dropped the slots. One 700 Myr residual of rel 6e-8 was that and nothing else.
  Fix the invariant (book at retirement), not just the caller that leaked.
- **Bisect a ledger residual to a single frame before reading code.** Frame-by-frame
  balance marks around one kernel, printed as *delta from a baseline* (a balance printed
  as `toExponential(6)` cannot resolve a 1e-8 relative change), localised −1.354e4 m³ to
  the interval between two marks with three statements in it.
- **A probe loop bounded by `st.nCol` is not comparable across a gather** — `nCol` changes
  there and dead slots enter or leave the range. Bound it by the pre-gather count and
  classify by the dead flag; that is exactly the interval where the leak was.
- **Rigid plates make the floor useless inside a plate.** A zero-crust marker on a plate
  moves with the column beside it, so no position correction can ever separate them; it
  steals that column's width for as long as the plate lives. Retire the marker instead.

## 0.3.0 P1 — particles, deposits and the heat ledger

- **A Lagrangian cloud folds, and the deposit kernel is what saves the field.** A convecting
  flow at Ra >= 1e6 squeezes the marker sample along its strain lines: measured, half the nodes
  ended up with one or two markers and a quarter with six or more. CIC (a one-cell kernel) then
  leaves fields of nodes without any sample, and patching those from stale values is a buoyancy
  source that does not exist. A 3x3 quadratic B-spline deposit reaches 1.5 cells, so every node
  is fed by whatever is near it; `fillHoles` (three Gauss-Seidel sweeps over the holes only)
  covers what is left, and the hole count is reported rather than hidden.
- **Never re-deal a Lagrangian cloud onto its lattice to fix coverage.** It is a resampling of
  the *field*, i.e. diffusion: re-dealing every 16 frames held a convecting box at Nu = 1.00
  (pure conduction), and every 64 or 10^6 frames was no better once the local repair ran often
  enough to matter. Fix the deposition and the field's own holes; only move markers the flow
  misplaced, and only when the deposit says so.
- **The marker<->grid heat exchange needs the adjoint of the deposit.** If a node's value is
  `sum_p W_pk T_p / W_k`, the markers must be handed back `d_pk * mu_k / W_k` (mu the node's own
  measure), or `sum_p m_p a_pk != mu_k` and the intake is not the integral the operator charged.
  The error is not small: a 4% occupancy hole read as 360x the wall flux, because a convection
  cell's increment is ~100x larger gross than net. With the adjoint pairing the conduction-only
  ledger closes to 1.7e-7 and a live convecting run to 1-8%.
- **Cap the renormalisation factor, or the *state* is read through an amplification.** A node
  reached by a sliver of marker weight has `cw = mu/W` in the thousands; feeding that back into
  the temperature (flip < 1, or any sync) diverges (T to 5e4 in 100 Myr). Trust a node's deposit
  only above a sixteenth of its measure (or a quarter), and report the rest.
- **A wall that clamps particles is a wall that collects them.** Pinning an out-of-bounds marker
  at the boundary looks conservative and is not: near-wall velocities are ~0, so the marker never
  comes back, and the near-wall flow is *convergent* in the upwelling/downwelling cells. One
  convection cell swept 60% of a 24k cloud onto the two wall rows in 60 Myr. Reflect the normal
  step instead (measure preserving, orientation reversing -- exclude the wall rows from any
  Jacobian check).
- **The conserved measure of a marker must be the measure of the operator's stencil.** The
  conduction operator conserves `dEta * JN * dx` (the node metric); handing markers the *cell*
  measure `dEta * JC * dx` puts a constant 2.62% offset between the two heats and every ledger
  reading is then off by that. One number, and it looks exactly like a physics bug.
- **A one-sided flux estimate belongs to the cell, not the node.** The boundary gradient across
  the first cell must be divided by that cell's face metric (`dEta * JC`), not by the wall node's
  own (`dEta * JN`): the two differ by the 2.6% above and it shows up as a phantom wall flux in
  an otherwise exact conduction test.
- **Interpolate the streamfunction, not the two velocity components.** One interpolant cannot
  disagree with itself about a cell's circulation, so the marker map is area preserving to the
  interpolation error (measured 1.3e-4 of the mean Jacobian) instead of the divergence error of
  two separately interpolated staggered fields. And check the map with finite differences: an
  accidental doubled `x += vx*dt` is invisible in a screenshot and obvious as a Jacobian of
  1 + dt du/dx.
- **A reference fixture's low-Ra end can be the fixture's own artifact.** `pt-conv.js` reports
  Nu 125 with 9 upwellings at Ra 1e5, which no Ra 1e5 convection does; its semi-Lagrangian
  advection at Courant 6 is the suspect. The engine, whose advection is Lagrangian, reads Nu 1.00
  there. Agreeing with a reference is only meaningful where the reference is physical -- gate at
  Ra >= 1e6 and flag the rest.

## 0.3.0 P2.1 — the crust: config, fixtures and calibrated failure

- **One live source per config value, or the dead copy will be the one you edit.** `params.js`
  carried the mesh twice: top-level `nx/ny` and the `mesh:{nx,ny}` block that `SIM.init` and
  the UI actually read. The top-level pair was edited for the map change and every run kept
  silently using the old mesh. The fix is deletion (one source), not a comment warning.
- **A pipeline stage bound at module load ignores its switch.** `SIM.k[4] = SC.crust`
  unconditionally meant `P.solid = false` did nothing: three fixtures ran a lid they had
  pinned off (and the numbers moved). Read the switch where the work happens
  (`if (P.solid) SC.crust(...)`) and make the fixtures' pins actually take effect.
- **A fixture must pin every parameter it depends on, including the ones the demo owns.**
  The demo's `icMode 1 -> 4` leaked into pt-melt-check (blob melt* 0.116 -> 0.090 against a
  0.10 gate) and into pt-eng-conv (4-well draw instead of 1-well, velocity gate flipped).
  Anything a fixture measures is a fixture setting, whatever params.js says.
- **Comparing a transient to a reference's steady state passes and fails on the initial
  planform.** pt-eng-conv's 2400-frame snapshot peaked and decayed through the reference's
  gate band; the draw decided the verdict. Compare at matched nondimensional time or pin
  and replay the exact recorded state. Measured the honest delta separately: at the engine's
  own settled state the one-phase box runs ~2x weak (Nu ~15 vs 27.45) and mpc 16 does not
  close it — the deficit is boundary-layer transport, not marker count. Printed as a caveat,
  not buried.
- **Hysteresis bands in a phase-adjacent state variable are load-bearing.** Age that accrued
  at any T below the reset point clustered the whole mantle; age accrues at T <= TLock,
  resets at T >= TSoft, holds between, and the T=0.4 age=10 band legitimately reads
  mu = 0.383 (strong rock the hysteresis is holding) — assert against the law, not intuition.
- **A healing gate on pristine markers passes trivially.** The anneal test must re-open the
  seam (work it above yield for a while) right before the quiet period, or it only proves
  `1 - dt/tau > 1 - dt/tau`. Likewise, a rigid-correction pass is only testable after the
  flow's own advection has run: `SC.crust` applies `x += w*(vRigid - vFlow)*dt` on top of
  G3, and unit tests that skip the pre-advect measure the mismatch as a "position gap".
- **Failure constants belong to the engine's own load distribution, not to dimension
  analysis.** The pair load `|(v_rel . r)|/d^2` is a strain-rate sample of a smooth field:
  measure its percentiles on an intact lid (`pt-load-check.js`), put the yield above the
  body (p80) and below the tail (p99), and note that loads grow ~3x with lid age — a
  constant calibrated at one age is wrong at the next. 0.003-0.02/Myr body vs 0.03-0.5 tail
  at 256x24 is what 0.06 sits between.
- **Percentage-of-surface metrics are mesh-row-count dependent.** lid% 9% at 256x24 is the
  same physical crust as 15-17% at 128x48. Compare crust thickness in km (the isotherm
  depth it tracks), not percentages, across mesh changes.
- **An overlay's onset must sit at the classification threshold.** `crustLevel` starting at
  mug 0.12 painted half-strength rock grey over warm material and hid the plates the
  overlay exists to show; onset at `clusterMin` (0.25), where a marker stops being fluid.
- **Pair walks scale with candidate density, and young lids are the dense case.** The
  cluster pair scan measured 1 ms at 231 strong markers, 3.5 ms at 4.2k, 14 ms at 8.5k
  (both walls lidded). Budget gates should time the shipped configuration at the shipped
  clock and the worst case should be printed, not averaged away.

## 0.3.0 P2.2a — the x wrap

- **An FFT in x is a periodic boundary condition, so wrap is not optional.** Test it as
  shift equivariance: translate the state by whole cells, run, translate back, compare
  marker-by-marker (`pt-wrap.js`). Round-off agreement (1e-10 km) proves no stage treats
  x = 0 as an edge; a seam bug shows up as tens of km and flipped plate memberships.
- **The physics can wrap while the view does not.** The raster sampled modulo wrap and the
  marker stipple did not: invisible at the default camera (one period, seam at the canvas
  edges), broken as soon as the user pans. Gate the view headlessly (camera on the seam,
  count lit pixels per half).
- **On a periodic map a single-mode initial perturbation is N copies of one box.** Only
  numerical noise breaks the symmetry and it takes hundreds of Myr. Seed a band of modes;
  keep the single mode as a pinned fixture draw. And make the seed change more than a phase
  — on a periodic map a phase shift is the same planet rotated.
- **Per-pair damage makes the failure rate scale with marker density.** A marker with 37
  partners accrues ~2x the damage of one with 20 under the same strain rate. Normalise by
  the partner count before tuning or thinning the pair walk. Done in P2.2 (worklog
  `0.3.0-p2.2-damage-worklog.md`): accumulate the pair integral and the pair count during
  the walk, apply `kDamage * sum/count * dt` in one pass after it.
- **Accumulate-then-apply is what makes a pair walk order-independent.** Adding damage to a
  marker *during* the walk means its own later bond decisions read a fraction of this
  frame's charge, and the cluster partition depends on bucket order. Splitting the pass costs
  one loop over candidates (~0.1 ms of G4's 1.9 ms) and buys a read-only scan.
- **To rescale a changed rate law, measure both laws on the same intact state.** Convert
  the old law into a per-marker quantity computable from the same run (here: the pair
  integral), then take the ratio of the means over the population the law acts on —
  `3 x 24.6..33.9 = 90`. The band is not a single number (the load tail crowds as the lid
  ages), so the gate holds the constant inside the band and the behaviour fixture picks the
  place inside it.

## 0.3.0 P2.2 — the switch bar and its fixture

- **A page with no headless harness accumulates dead controls.** `particles.html` loaded
  fine in a browser and every key worked, but the quality *button* called
  `cycleMesh(SIM)` — which re-applied the level it was already on — so clicking it rebuilt
  the same mesh, and `SIM.mesh()` rebuilds by re-initialising and **resetting the planet**:
  a control that silently threw the run away. `experiments/pt-ui.js` (DOM parsed from the
  page, scripts loaded in page order in `vm`) caught it on its first run. Any page whose
  buttons call engine functions needs the equivalent of `smoke.js`.
- **Put toggle state in one attribute and derive the styling from it.** `aria-pressed` set
  from the renderer's own flag (never a parallel copy) + one CSS rule gives the switch, the
  screen reader and the style the same source; the harness then asserts the attribute after
  every path that can flip a flag (click, key, cycle).
- **Radio groups need an explicit "unspecified".** Camera presets stop describing the view
  the moment the user pans or zooms, so the highlight is cleared by the *camera* events, not
  by the next preset click; otherwise the bar lies about the view.

## 0.3.0 P2.2 — slab pull, welding depth ceiling, and why the surface is flat

- **Plates break at trenches (`du/dx < 0`), not over broad upwellings (`du/dx > 0`), so flow
  traction cancels beneath them.** On the 256x24 convecting mesh, compressive strain rate at
  narrow downwellings (`~-0.065 /Myr` over 150 km) exceeds `yieldRate = 0.06` while tensile
  strain rate over broad upwellings (`~+0.013 /Myr` over 1,500 km) is ~5x smaller. Plates
  therefore span across upwellings from trench to trench, and the leftward and rightward
  branches of the cell cancel in `csVX` (`0.31 cm/yr` net vs `1.5-2.3 cm/yr` peak surface
  flow). A rigid cluster `(csVX, csVY, csW)` has no hinge at the trench to turn vertical root
  sinking into horizontal plate translation; an explicit horizontal slab-pull drive is
  required.
- **Sum the slab-pull depth moment over `ry > 0` only, or the trench roof cancels the root.**
  At the trench end of a plate (`rx > 0`), the shallow lid markers sit above the cluster's
  vertical centroid (`ry = y - csY < 0`) while the attached slab root hangs below it (`ry >
  0`). Summing `m * (rx / |r|) * ry` over all cluster members lets the shallow trench roof
  cancel half the root's moment; summing over `ry > 0` isolates the hanging root, preserves
  zero pull for any flat plate (`ry = 0`), and raises mean plate drift `5.2x` (`0.31 -> 1.60
  cm/yr`, with slab-bearing plates at `2.03-6.28 cm/yr`).
- **Bound welding by depth (`yWeldMax`), or an unheated CMB cold pool becomes a bottom
  plate.** In `'rb'` (no internal heating, `T_top = 0, T_bot = 1`), cold plumes pool along the
  CMB at `T ≈ 0.25 < TLock = 0.35`. Without `S.y[p] <= P.yWeldMax` (`300 km`), 11,252 of
  11,958 strong candidates sit in rows 14..23 (`364..2357 km`) by 150 Myr, costing `34
  ms/frame` in the pair walk. Confining welding to `y <= 300 km` cuts the `'rb'` Ra 1e6 frame
  time from `18.78 ms` to `9.38 ms`.
- **A separable FFT + Thomas Stokes solver forces a flat coordinate top (`eta = 0`), so
  surface relief must be a coupled 1D field (`zh[i]`) rather than raw marker tops.** Because
  `psi = 0` (`v = 0`) at `eta = 0`, `keepInside` reflects markers at `yMin = 4.14 km`, and
  `render.js` paints `SKY` for `eta < 0`, the raw particle top is ruler-flat. Deriving a
  periodic zero-mean 1D elevation `zh[i]` from upper-column thermal isostasy, dynamic trench
  normal stress, and crustal thickness / rift necking — and using it to warp the shallow
  raster and marker screen depths while feeding `-dzh/dx` (ridge push) back into `csVX` —
  gives realistic ridges, grabens, abyssal plains, and deep trenches without sacrificing the
  separable `O(nx ny log nx)` Stokes solve.

## 0.3.0 P2.3 — the surface profile, and two bugs a "verify the values" gate caught

- **Number the cluster ids from the strength test `pair()` uses, not from the candidate list.**
  `solid.js`'s pair walk needs two kinds of candidate: the plate markers it bonds, and the
  sub-threshold markers whose load it still has to integrate (they carry the damage that
  eventually lets them fail). Numbering every candidate as a cluster made a lone soft marker a
  one-marker "plate": measured at 240 Myr, **214 of 250 clusters were singletons of markers
  below `clusterMin`**, and since `d.lid` counts `S.cl[p] >= 0` the HUD's lid fraction read ~1/8
  high (4% really was 18%). The fix is three sentinels -- `-1` below the near threshold, `-3`
  load-only, `-2` plate-capable -- with the `-3`s returned to `-1` after the pass. Any change
  to `clusterMin`, `near`, or the failure law has to keep membership and bonding on the *same*
  test, or the picture and the physics disagree.
- **A flexure term is the flexural response: never filter it twice.** The crust term is
  `kLid * (hLid - flex(hLid))`. The first version put the whole profile through the `[1,2,1]/4`
  filter afterwards, which applied the plate's stiffness twice and cancelled the load: a 14 km
  welded band read as a `-0.13 km` ripple with `+-1.3 km` side lobes. The kernel now filters
  only the thermal and dynamic part, and adds the crust anomaly (already flexed) afterwards.
- **A helper that writes through a caller's scratch must say so.** The same bug class bit twice
  in one function: `flex(nx, a, tmp, passes)` leaves `tmp` equal to `a` after its last pass
  (the stencil is in-place), so "the anomaly" `a - tmp` was **exactly zero** -- every welded
  plateau read flat, and the whole term was dead while every check that only compared the
  kernel against a copy of itself still passed. Rule: a kernel that consumes a scratch must
  copy the value it needs *before* the call (`hRaw.set(hLid)`), and the fixture must recompute
  the *physical* value (a band stands `+1 km` and its seam notches `-1.2 km`), not the formula
  -- a value gate catches a dead term, a formula gate cannot.
- **Pin the term's *value*, and the fixture will find the bugs above.** `pt-surface.js` writes
  the three-term law out independently (thermal isostasy against each node row's own mean,
  convergence times the compensation depth, `hLid - flex(hLid)`), then compares column by
  column. Both bugs above survived `pt-check`, `pt-crust` and `pt-wrap` because those fixtures
  only asked whether the pipeline ran and stayed periodic; a `check.near` against an
  independent spelling of the definition is what exposed them.
- **The plan's dynamic term on the *vertical* velocity at node row 1 is unusable: that row is
  inside the welded lid.** Measured, `v` at row 1 is `0.03-0.4 km/Myr` against `uMax 20` --
  the lid is rigid, which is the whole point of P2 -- so `z_dyn = -kDyn * v` would leave every
  trench flat. Read the *shallowest cell row's* horizontal convergence instead: by
  incompressibility the vertical flow at the compensation depth is `v = -(du/dx) * y`, so the
  term is `kDyn * yIso * du/dx`, which measures `5-50x` larger and has the right sign pattern.
- **Two isostasy terms at a convergent margin correlate, so calibrate the sum and not each
  term.** At `kDyn = 1.0` the deepest column read `-16 km` (double the plan's band) because the
  thermal term had already charged the same column `-6.1 km` while the dynamic term added
  `-10.1 km`. `kDyn = 0.3` puts the deepest trench at `-8.7 km` and the deepest 5% at `-7.9`.
  When a per-term "physical" constant is not available, say so in `params.js` and cite the
  measurement that set it.
- **Relative isostasy is the whole trick for a zero-mean horizon.** Every term subtracts the
  same field's horizontal mean (each node row for the thermal part, the flexural average for
  the crustal part), so a uniformly warm planet, a uniformly thick lid, and a uniformly moving
  column read **zero relief** and the sea level cannot random-walk. The plan's `sum_i zh == 0`
  is then not an extra correction but a property, and the only residual is round-off.
- **Warp the view, not the solver.** The Stokes solve stays on the flat `(x, eta)` domain
  (`0.6 ms`, `7e-17` divergence); the horizon is drawn by shifting each pixel's lookup row by
  `zVis * exp(-y / yTaper) / J(y)`. Two details matter: the *markers* must get the identical
  shift (`pt-surface.js` checks a single marker against the law to 0.12 px) and a physical clip
  (`zVisMax`) plus a matching `kRelief` is needed, because `kRelief = 3` with a `-10 km` profile
  floods a third of the `lid` preset with ocean. The `lid`/`mantle` presets also have to start
  above `kRelief * zVisMax`, not above `y = 0`, or a swell leaves the frame.
- **`a ? b : c` inside a `for` condition is a trap.** `for (jj = 0; jj < best || best < 0 ? h : best; jj++)`
  parses as `((jj < best || best < 0) ? h : best)` and returns a *truthy* `best`, so the loop
  never exits -- a 900 s fixture hang from one missing pair of parentheses. Floor division,
  ternaries and `||` in a loop head: use a block.

## 0.4.1 — the cut: a line on the globe's map (see experiments/slice-cut.js)

- **A line crossing a lattice meets a new cell every ~0.8 of a cell spacing, not every full
  one.** "Cells crossed = circumference / mean neighbour distance" undercounts by ~20 %; measured
  on the counterpart's own grid (L5 198 not 166, L6 400 not 333, **L7 811 not 665**). The
  difference is what puts L7 over the section's `colCap` of 768 and L6 comfortably under it, so
  the estimate would have shipped a broken fit. Measure a count, never divide for it.
- **A lat/lon bucket grid cannot find a point's neighbours near a pole**: there, points far apart
  in longitude are a few hundred metres apart on the sphere, so a 3x3 window in (lat, lon) misses
  them and cells come out with zero neighbours. A spatial hash on the unit cube with a cell of
  one neighbour radius costs one pass and is correct everywhere; radius ~1.8 x the nominal
  spacing catches the first ring plus a margin, which is also what a nearest-centre hill climb
  needs to be exact (too tight a ring and the climb cannot reach the cell it should jump to).
- **`JSON.stringify` of a typed array is an object, not an array** (`{"0":1.5,...}`): three times
  the bytes, and `new Float32Array(obj)` silently yields length 0, which looks like a validation
  bug downstream. One replacer in the encoder
  (`v && v.BYTES_PER_ELEMENT ? Array.prototype.slice.call(v) : v`) fixes both directions.
- **An arc-length box filter is mass-exact in both directions**, which is the only reason a
  reader may keep its own resolution instead of adopting the writer's: give every source sample
  the span it covers, tile `[0, total]` with the output columns, weight each source value by the
  overlap, and `sum(out * dOut) == sum(src * span)` to double precision (checked at 128, 512 and
  1024 columns). It works upsampling and downsampling because a thickness is intensive: the
  widths, not the values, carry the mass. The bug to avoid is consuming the *absolute* position
  of each output centre instead of the delta to the previous one.
- **Six significant digits is a format rule, not a rounding habit** (the upstream
  `Deposits.round`): it makes a JSON round trip bit-exact and two machines hash the same bytes.
  Adopt the counterpart's rounding and checksum rather than inventing a second pair — the point
  of a checksum on a shared file is that both sides compute the same one.
- **Two `file://` documents have no reliable channel.** `postMessage` between null origins,
  `localStorage` shared across all file pages and `BroadcastChannel` on an opaque origin are each
  browser-dependent, and `navigator.clipboard.readText` needs a permission a file page will not
  get. Ladder: `postMessage` if the handshake answers, `localStorage` if it is shared, and
  **paste into a textarea / a file input always** — the manual rung is the contract, not the
  fallback, because it is the one that works everywhere.
- **A shared file needs a home the page-scanning harness does not own.** `experiments/smoke.js`
  asserts `columns.html` loads every `js/*.js` exactly once, so anything shared-identical with
  the counterpart goes in `port/`; then the manifest has one directory to list and the gate keeps
  its meaning.
- **Two engines that share `var P` / `var S` / `var SIM` cannot share a page.** A classic
  script's top-level `var` is a global; loading the second engine silently rewires the first.
  The `PT*` export names are already correct — the leak is the unexported `var`s. One global per
  file (the name it exports, everything else inside an IIFE) is the fix; it is a prerequisite of
  a one-page 0.9, not of the cut, and wrapping every existing file while P3 is being written is
  the expensive version of it. New files do not add a second global.
- **The two crust engines already share an isostasy law, so a seeded `z` is an identity test.**
  `SURF.elev` here and `Surface.elevation` there are the same expression with the same constants.
  `|z − zM| ≤ 1e-3 m` at frame 0 is then a mapping check, not a modelling tolerance; a larger
  error is a bug in the import, not a choice about flexure. The residual still belongs in `zDyn`.
- **Do not vendor the other engine in order to get one page.** The globe owns the map, the grid
  and the picker; this repository owns the section. A pinned copy of a 6 k-line engine inverts
  that. The smaller one-page path is C1 on the column engine here and `start(host)` so the
  globe's page can host it. Two documents plus clipboard remain the path that always works on
  `file://`.
- **A variable column count is not a resample.** `w0` (gap floor, flexure `kf ∝ w0²`, collapse)
  is calibrated at 512. Following the source level (`n = records`) changes what those constants
  mean, and at L7 the measured cell count (811) already exceeds `colCap` 768. Keep the section's
  columns and box-filter the cut onto them.
- **An open window must not invent crust.** Repeating the end columns to fill `[length, wrap)`
  is a clamp that looks imported. Clock-off is the honest answer until the engine has end
  boundary conditions.

## 0.4.1 M2 (the reconstruction)

- **A wide hole is not a sliver.** The engine's `colGhost` record is a trench that has *closed*: a
  run of columns owning no mass whose gaps are already at the floor, which is why retiring one hands
  back a hundredth of a column. Data you import can be a hole that is several full-width columns
  wide, and the same retirement then moves 50 km of crust into one neighbour in a single frame
  (measured, L5, 10 kyr/f). Import the hole as *data* — a zero in the box filter thins the columns
  it covers, conserves mass by construction, and leaves every elevation identity intact — and keep
  the sliver record for what the model itself drains.
- **A rate law's comment is a test you can write.** `P.kBelt` multiplies a metre-valued
  `hTot` excess by `1/Myr`; the old `kBelt * excess * 1000 * dt` made the unclamped flow 1000×
  too fast. The corrected metre law is `kBelt * excess * dt` — remove the extra factor; do not
  replace it with `1e-3`. Delamination had a separate typo in its half-excess cap
  (`over * 500` instead of `over * 0.5`). Measure a hand-computed frame for each law and keep
  the cap error distinct from the linear-rate error. Fixed and gated in 0.1.7
  (`0.1.7-plan.md`, `m2-check`).
- **Feed a corruption through the transport that can carry it.** A `NaN` in a pack cannot survive
  JSON (`stringify` writes `null`, the decoder reads 0), so a harness that mutates a `NaN` and
  encodes is testing the *checksum*, not the field check — and it passes for the wrong reason until
  the mutated value happens to be one the format already stores as 0. Test non-finiteness on the
  object path (`loadPack`), which is also the path a bundled pack really takes.
- **Bound a spin-up against the engine's own norm, not against zero.** "The first frame must move no
  column more than a few hundred metres" is unfalsifiable in the useful direction: a freshly reset
  planet of the same model moves 3.4 km on its first frame, because `zDyn` relaxes and the fan cools.
  The claim that means something is "the seeded state costs the view no more than the state the
  model makes for itself", measured in the same run, with the mechanism named (frame 0 the identity,
  frame 1 nothing re-signed, `edgeAge` 0 keeping the topology shut for `P.evAge`).
- **`S.recon` is a plain object on purpose.** `S.hash()` walks the numeric fields and the typed
  arrays, so a `Float64Array` of assumption counters would move the state hash of every column
  fixture in the repo. Counters belong to the *capture*, not to the world: keep them off the hash and
  assert it (write to them, compare the hash) rather than trusting the shape.
- **Typed arrays in JSON session objects need plain conversion.** `JSON.stringify` on a TypedArray
  produces an object map `{"0": v0, "1": v1, ...}` rather than an Array `[v0, v1, ...]`. Passing such
  an object to `new Float64Array(plainObj)` yields an empty array of length 0. When embedding slice packs
  into JSON session checkpoints, encode via `SlicePack.encode()` or convert typed arrays to standard
  plain arrays; deserialize with a fallback `Array.from(plainObj.length ? plainObj : Object.values(plainObj))`
  to ensure round-trip integrity across JSON transports.
- **Continuous box filter round-trips are exact to cell coordinate quantization.** When exporting
  a 2D column state to a slice pack and re-importing via the SEED box filter, cell boundaries `sKm`
  rounded to 6 significant digits cause sub-metre edge interpolations. The volume ledger closes to
  $< 10^{-15}$ relative and frame-0 isostasy identity $|z - z_{\text{M}}| \le 10^{-3}$ m holds, confirming
  that mass and profile are conserved across self round-trips without artificial spin-up drift.
- **3D to 2D deposit catalogue reduction via out-of-plane support projection.** For deposits generated
  from 3D geological potentials intersecting a 2D section plane, the effective 2D radius is
  $R_{2\text{D}} = \sqrt{R_{3\text{D}}^2 - y_{\text{out}}^2}$ when $|y_{\text{out}}| \le R_{3\text{D}}$,
  and empty otherwise. Deterministic hashing combining world seed, pack checksum, cell position, and
  deposit family ensures identical catalogue generation across sessions and transports.


## 0.4.1 M5 (ages and the observation log)

- **A harness is a module too, and `require('./sibling.js')` runs the harness.** A check inside
  `experiments/coupling.js` needed the core-log codec and wrote `require('./core-log.js')` — from
  `experiments/` that is the *gate*, which shares `check.js` (its 33 checks printed inline and
  inflated the running count) and ends in `process.exit(0)` (the outer suite silently never
  finished). The suite briefly shipped an honest-looking "ALL PASS (134 checks)" whose number was
  101 outer + 33 inner, with six outer checks never run. Load codecs the way every other harness
  does — through `lib.mods` or the real `../js/` path — and trust a green run only when its total
  equals the suite's own check count.
- **A foundered bed is removed, not kept as a zero-thickness slot.** The earlier
  `CRU.delaminate` wrote `layTh = 0` but left `colNL` unchanged, which let empty hosts consume
  layer capacity and left deposits anchored to rock that no longer existed. Full basal-bed removal
  now goes through `COL.removeAt`: the host deposit is invalidated and the surviving beds' indices
  move with them; a partially foundered bed remains in place. Imported records should still reject
  zero-thickness beds — that validation rule does not make holes a useful live-stack representation.
- **An import never dates a bed into the past, and a zero-delta test proves nothing about dates.**
  A message older than a pinned section clock (`tNow` ahead of `msg.tMyr`, which the lead rule
  creates by design) would stamp growth beds below the age of the beds above them; one rule —
  `tBed = max(msg.tMyr, tNow)` — reaching fresh stacks and all three growth paths fixes it, and
  the flag says the contact is an injection. The check that verifies it must carry a real
  thickness delta: a zero-delta message writes no beds, so the dating path never runs and the
  assertion passes vacuously.
- **Write cross-structure oracles from the engine's public join, not from index identity.** A
  rebuilt column's row is not `rows[col]`: the table spans arcs, `joinTo` decides matches, and
  wrap maps out-of-table columns onto the interval they actually read. The check that indexes
  `rows2[jj]` fails for correct behavior; the check that asks the engine (`joinTo(mid) >= 0` to
  skip matched columns, wrap + scan for the rest) fails only for wrong dates — and as a side
  effect counts exactly, since its tally must equal the ledger's `freshColumns`.

## 0.1.7 (crust flow units, and what a fix re-measures)

- **A gate must measure its mechanism's promise, not a nearby quantity.** `COL.floor` is a
  *cross-plate* bound; a draining record's same-plate territory is soft by design and bounded
  by its retirement rule instead. The m2 long-run gate measured every adjacent gap and passed
  only while a ×1000 flow bug kept every overage column empty within a frame of forming one.
  After the fix it failed on a 7 km sliver gap no promise was ever broken about. Re-reading
  the mechanism, not "fixing" the number, is what closed it.
- **A rate-implemented ceiling is an equilibrium, so say it in the gate.** `crustMax` held by
  a sink of rate k settles at `crustMax + influx·dt`: frame-dependent by construction, and
  no stiffness escapes it (even peel-everything leaves one frame of influx). The audit's R3
  now prints its allowance (`35 km/Myr × dt`) instead of a fixed percent that silently tests
  the frame rate. Making the peel the *last* pass of K5 is what makes the statement about
  end-of-frame values instead of mid-frame ones.
- **Calibration constants measured on top of a bug are measurements *of* the bug.** 0.1.5's
  "peak over flanks 1.3–1.44x" was only reachable with the orogenic flow running ~1000x too
  fast, and a kBelt sweep {0.12..40}/Myr cannot reproduce it honestly: the needle ratio falls
  5.06x to 2.97x monotonically without crossing its gate. The sweep's event-memory conclusion
  is invalid because the audit site detector was broken; rerun it with the corrected harness.
  When a fix invalidates acceptance numbers, re-measure and hand the calibration decision to its
  own plan — do not chase the old number with new constants.
- **A page global must be resolved as the page resolves it.** `js/perf.js` keeps `PERF`
  private to its IIFE and publishes `COLPERF`; the particle engine's `sim.js` and `ui.js`
  then referenced a bare `PERF` — fine for no one, since the module-global name is the only
  name the browser has. It died in `experiments/pt-ui.js` only because that harness runs the
  *bootstrap* (the preset HUD call), not just the kernels. Keep page harnesses on bootstrap
  paths: a VM that loads the real script order and calls into the real globals is a browser
  stand-in, and a shared file's consumers must look up its published name, per file.
- **`Set.prototype.values()` is an iterator, not an indexable array.** `values()[i]` returns
  `undefined`, collapsing every event into one bogus site and feeding `NaN` into the site's
  surface window. Materialize it with `Array.from` (or iterate) before indexing. A time-gap
  check must also use the current frame minus the previous event frame, not the run's total
  frame count; the contact audit now self-tests both rules before trusting R1 or event memory.

## 0.1.8 M2 landing (a per-boundary scalar outside the gather)

- **A column field that is not in `COL.fields` is not moved by the gather.** `COL.gather`
  permutes exactly that list; `S.edgeShort` stays out of it on purpose (the frozen v1 pack is
  the reason), so `COL.transport` must carry it by hand with the *same* neighbour test it
  uses to reset edge history, and `COL.k4` must snapshot it with the other `hist*` arrays
  before the gather and hand it back through the plate-identity branches. Forgetting the
  transport carry leaves the value on the old index while the column moves — silent, and
  invisible to a fixture that never sorts. Gate it with an ownership invariant (the value
  sits only on inter-plate boundaries) in every `invariants()` pass, not with one fixture.
- **Memory tied to a boundary belongs to the pair of records, not to the boundary's state.**
  Resetting an orogen's absorbed shortening on `collide → neutral` would release the brake
  the moment it works (below `epsLo`) and restart the collision from zero: an oscillation
  the classifier's hysteresis cannot see. Clear it where the pair stops existing (sort,
  K4 hand-off, birth, suture) and nowhere else.
- **A new typed array in `S` is a new checkpoint record by construction.** `js/checkpoint.js`
  enumerates `S`, so the table grows without an edit — which is exactly why the VERSION must
  be bumped by hand and the previous version's refusal asserted, or an old file would be
  rejected by a confusing length/table error instead of its version word.
- **A harness that "keeps the engine's own term" stops meaning that when the engine moves.**
  `orogen-measure`'s `instant` row was `P.vColl = k` with nothing added; after D landed that
  is the new brake, not the old one. Re-create the historical term explicitly in the hook and
  add a named mode for the engine, so the old table stays reproducible and the new engine is
  measured through the same gates (`engine` reads the identical closing numbers as
  `r4-check`, which is the drift check between the two).
- **`var` hoisting makes "configured before declared" read as unconfigured.** `if
  (isFinite(KFIX)) SWEEP = [KFIX]` placed above `var KFIX = …` is always false; the "frozen"
  M2 runs swept the full list and happened to select the first row. A constant that gates a
  sweep must be declared before the sweep is built — and a frozen run should print one row.
- **R1's site window is anchored at the event bucket's left edge, not at the event.** The
  window is `bucket × 2.5 w0 ± 1.5 w0`; a conveyor retirement whose merged column spans
  ~80 km can put its own footprint 2–3 km outside it, and the gate then compares the event
  with itself (both extremes on the same frame, 20 km apart). The `event site` line now prints
  frame and x for both extremes so this is visible without a probe.

## 0.1.9 evaluation of a K5 donor floor (35816d1, see archive/0.1.9-k5-donor-floor-evaluation-worklog.md)

- **A donor-side clamp on lateral felsic flow strands collision roots.** `flowAvail = hFel - floor`
  on every column stops the felsic of a thick collision column at the floor; the local flow
  cannot move it, the mafic root keeps the column thick, and R2 needles return (immediate-slot
  failures 0 to 202 on one leg). Measure any flow-law change on the strict legs with the same
  harness. The m2 trajectory check cannot see it.
- **m2's trajectory check reads the state right after `SIM.step()`.** A classification fix can
  pass it and still move the next frame: a frozen contact kind is cleared at the next transport,
  so a pair can change kind again in the next K3. Measure next-frame effects with
  `experiments/k5-reclass-probe.js`.
- **Name the cause before naming the operator.** Most next-frame flips in this model are
  velocity-driven (the K2 solve changes between frames), and no K5 change prevents them. Only the
  drain-caused share belongs to K5.
- **Per-slot history past `nCol` goes stale when a topology hand-off shrinks the column count.**
  The freed slots keep old values unless cleared. Readers stop at `nCol`, so it is inert, but the
  m2 invariant checks it. Clear freed slots whenever `nCol` falls.
- **Frozen per-slot state survives transport only if nothing reorders the slots in between.**
  The floor runs before the transport sort, and both freeze sites run after K4's own reorder.
  Keep that order if the call sequence changes.

## 0.1.10 evaluation of the narrow crush hold (archive/0.1.10-narrow-hold-worklog.md)

- **A three-thousand-frame leg can hide the effect a recommendation rests on.** The narrow hold
  read clean on seed 1 at 50 kyr over 3000 frames; over 5000 frames the same seed had 232
  drain events against 1 and failed R3. Test a recommendation at the run length where its
  effect appears, and count the events, not only the verdict.
- **One seed does not carry a verdict.** Over eight seeds at two rates the variant passed
  5 of 16 strict runs against the base's 11, and fixed none of the base's failures. Use the
  full seed sweep before a recommendation, and print the base and the variant side by side.
- **A variant rebuilt from prose must reproduce the logged numbers before it is measured.**
  Seed 1 at 100 kyr, the mixed schedule and seeds 2 and 5 matched the old log exactly, which is
  what made the new sweep comparable. Keep the patch in `experiments/logs/` as the artifact.
- **A checkpoint spin-up check catches a trajectory change the gates do not.** The variant's
  imported run diverged from its fresh run by 3.4e-3 (bound 1e-3) while every strict gate
  it was judged on still stood. Run the whole suite on a candidate, not only its own harness.

## 0.1.11 evaluation of closing-kind hysteresis (archive/0.1.11-hysteresis-worklog.md)

- **A hold on a state is not a hold on its inputs.** The classifier's boundary state already has
  hysteresis, but the floor predicate re-read the raw velocity sign. Holding the state fixed
  removed every velocity-caused reclassification, and the crush floor then stayed on pairs that
  had turned to open at 75 mm/yr, eleven of them within 120 km of a 126 km column. Before holding a state, ask what the
  state permits once the input has reversed, and bound it at the threshold the owner uses.
- **Removing one cause can be the same event as another.** The velocity flips and the opening
  holds were the same pairs. A bound that removed the breach left the flips, and a rule without
  the bound removed the flips and produced the breach. Count both causes on the same run before
  choosing a threshold.
- **A gate written before a measurement can miss the effect it was meant to catch.** The
  acceptance gate on strict verdicts tied for the candidate (17 against 17) while it breached the
  crust ceiling on one run. Name each physical bound (the ceiling, the needle, the spin-up) as its
  own gate, and say which were added after the measurement.
- **A measurement switch in `js/` breaks the page harnesses.** `process.env` in `columns.js` loads
  fine in node and throws in the VM page harness (`smoke.js`), which has no `process`. Keep
  variant switches in a scratch copy and check the candidate's own tree with the full suite.
- **Trace the mechanism at the frame, not only the run.** The breach frame's column was traced to
  eleven held-opening pairs within 120 km and 25 frames; the run-level counts did not show it.
  Co-location is not cause: the per-step view (which operations ran in the jump's frame) and
  the hold applied at one site at a time (K4 freeze only, transport floor only) separated them.
- **A volume-conserving rescale turns a width change into a thickness spike.** A record that
  swapped order with its neighbour went from 2.70 to 0.32 w0 in one transport step, and K4's
  `oldW / colW` multiplied its 60 km stack by 8.4. Any width change that comes from a reorder,
  not from a topology event, can do this. Check the width history of a spike before the stack.

## 0.1.11 landing: closing-kind hysteresis and transport floor crossing resolution

- **A wrap distance check without direction mistakes crossing for clearance.** In `COL.floor`,
  when two columns cross during transport (relative advance exceeds the gap), the forward
  distance wrapped around the circle is `wrap - overlap`. Converting this via `wrap - d` yields
  a positive scalar `overlap`. If `overlap >= min` (e.g. 9.6 km >= 3.91 km), `COL.floor` skipped
  the pair, mistaking the crossing for valid separation, allowing `sort` to swap their order and
  K4 volume conservation to spike thickness (the 126.1 km breach). If `overlap < min`, moving by
  `0.5 * (min - d)` moved them by less than `min`, leaving them still crossed.
- **Pushing crossed pairs back across each other restores proper floor separation.** Detecting
  crossed pairs (`d > wrap - 2 * w0`) and applying `a = 0.5 * (min + overlap)` pushes plate `p`
  left and plate `q` right across each other by `min + overlap`, restoring them to the proper
  ordering separated by `+min`.
- **Bound crossing detection to physical advance limits, not `wrap * 0.5`.** Sparse fixtures
  (e.g. 12 columns in a 512-column wrap) legitimately have empty gaps `> wrap * 0.5` across the
  seam that must not be treated as crossed pairs. Bounding the crossing overlap to physical
  advance limits (`2 * w0`, far exceeding `2 * vMax * dt = 40..80 km`) protects sparse fixtures
  while catching every real transport crossing.

## 0.2.0 M1 — vents and the second clock (archive/0.2.0-m1-worklog.md)

- **A k-slot kernel is invoked unbound.** `SIM.step` calls `this.k[i](S, dG, t, Tm)` with no
  owner, so a slot that writes `this.ownHelper()` throws only through `SIM.run` — direct
  `MAG.k7(st, ...)` calls in a bench bind `this` and hide it. Address the module object inside
  a slot kernel (as `CRU.k5` does), and put at least one check through `SIM.run` in the
  harness.
- **Anything in transit between reservoirs must sit in `S.mass()`.** The measured ledger
  identity compares `S.mass()` against `ledProd - ledCons + ...`; melt parked in a vent
  chamber or in a toy box (cells^2 x the jacobian) is real mass with a production entry and no
  stack yet. Count it where it waits, or every run with one live vent reads as a leak the
  frame it drains. Give the in-transit store one jacobian (`P.toyCellM2`) and let the writer
  (schedule, later write-back) reuse it — two conversions are a silent mass bug.
- **A threshold that plugs instead of draining makes its own death rule unreachable.** A
  design that says "erupts above 1.3 P0" and "dies below Vdie" needs the drain to reach zero:
  if the pressure gate simply stops the eruption at the threshold, the vent parks above Vdie
  forever. When two rules of one lifecycle disagree, a fallback regime (here: effusive below
  blast pressure) beats inventing a timer.
- **Units of a caricature need one stated boundary constant, and a probe to pick it.** The
  design quotes chamber sizes in km3; the engine's volume unit is section m2. Converting at
  the kernel boundary (`venKm3M2`) with the constant chosen from a measured supply probe
  (chamber plateau 5e5 m2 in 500 Myr) keeps the design's table intact and the lifecycle live;
  the strict 1e9 reading would never birth a vent in a run.


## 0.2.0 M2 — write-back and the edifice (archive/0.2.0-m2-worklog.md)

- **A retained shape is not a second reservoir.** Keep `toyFz` for drawing, but count only
  molten height, packets and unwritten outputs as melt. Freeze / landing enqueues once;
  write-back reclassifies the original mafic production into lava / tephra. Slump must
  transport the solid fraction and molten ash separately or it will re-freeze written rock.
- **Do not share names or random draws across clocks.** `toyCoolSec` is seconds;
  `tauCool` stays Myr. Packet velocities use a checkpointed per-vent RNG, not the plate /
  plume stream: changing an FX timestep must not consume a future geological draw.
- **Consumed ownership is bidirectional.** Clear the old `volc` inverse before redirecting
  `venCol`; do not reconstruct it from a stale inverse after sorting. Remap dormant
  `venEdCol` too. A redirected vent carries transit, not its source column's written rock.
- **Retirement must not wait for the other slider.** Fill before testing `Vdie`, then use
  `tauVent` alone. Settle / write the residual, return the chamber dribble, and retain the
  cold shape; an invalid orphan books only its still-untransferred melt as consumed.
- **Do not hide a red by changing its scope.** Contact-audit's default still runs both
  clocks and uses unchanged gates. `--tectonic-only` explicitly pauses eruptions; compare
  both modes and reproduce the original HEAD before naming a regression. The 40-frame R5
  gate is not the same interval as `P.evAge` at 100 kyr/frame.
- **An overlay recording test is not a pixel test.** `edifice-bench` captures paths and
  proves that the toy, not record scalars, controls them. Optional `edifice-visual` uses a
  real native Canvas2D to check below-profile leaks and make inspectable images in ignored
  `scratch/`; it adds no browser runtime dependency.


## 0.2.0 M3 — live resources (archive/0.2.0-m3-worklog.md)

- **A delineated envelope is part of its host, not another mass reservoir.** Keep resource
  area accounting separate from `S.mass()`: live + extracted + retired = produced per
  class. Mining removes actual area / width and credits the original lithology in
  `ledCons`; erosion retires resource share without inventing another crust sink.
  Quote slice tonnage as Mt/m and a grade index as an index, not a commodity assay.
- **Bed history and table identity solve different problems.** Carry `layOre` through every
  stack copy / compaction / split so unchanged potentials cannot refill an exhausted bed.
  Address actions by stable `depId`, not a dense slot. A reset or restore may reuse ids
  from another world, so clear the UI selection at that boundary, not merely at the next HUD.
- **Partial transport needs a resource split, not the old whole-record redirect.** Fractional
  host transfer conserves resource area; a new receiver gets a fresh id, an existing one a
  volume-weighted merge. Use the insertion's actual receiver slot and base, not the top bed
  under a sediment cap. Relative marker positions must be rebased on growth / compaction.
  K4's volume-mode beds do not change the resource's stored section-area unit.
- **A pulse before inheritance can be silently overwritten.** Seed newborn ore after the
  parents' potential mean is applied. Exact saturation / decay gives a clock-independent
  fixed-factory result. Remove old arc / LIP / sill additive writes when K8 becomes the
  factory owner; actual birth and routed deposition remain separate material-event pulses.
- **Blur ties can put placer uphill even with correct routing.** Require a raw potential as
  well as a blurred maximum; among equal placer maxima prefer the lower ground before the
  deterministic index tie-break. Gate it with actual K6 erosion / deposition, not a manually
  painted potential on the intended sink.
- **Paused metadata is not an advancing geological clock.** First K8 can record a new host
  while dtGeo is zero; later calls must be idempotent and consume no RNG. A historical paused
  hash fixture must settle that initial metadata, and zero-budget topology markers belong to
  an explicitly isolated K0–K6 test. Keep full-pipeline mining and resource lifecycle gates
  separate rather than disabling real reaping to preserve a stale fixture.
- **UI tests need the page's actual classic-script branch and cadence.** CommonJS loading
  alone misses browser globals, scoped host controls and listener cleanup. A recording DOM /
  canvas harness checks the d toggle, real extraction, host-aligned symbols / probe and two
  list rebuilds in a 60-frame second. It is still not a real-browser pixel or fps claim.
  Raw / missing cuts must reject mining even if a prior reconstructed state is still stored.

## 0.2.0 M4 (save/load and diagnostics)

- **Triage a failing gate before blaming the diff: `git stash`, run, `git stash pop`.**
  The M2 review found m2-check at 323/324 and section-pack in a load crash *at HEAD* —
  both M3-era drift hidden by a milestone that never invoked previous harnesses. A red
  that reproduces on the clean tree is a review finding, not a regression; fix it and say
  which it was.
- **Deposits markers are two kinds after 0.2.0 M3, and fixtures must pick deliberately.**
  `depVol > 0` keeps the horizon on its own bed through every peel (`moveDeposits`: "only
  the volume moves"); `depVol == 0` is a tombstone that rides the moved rock and will
  leave a retiring record before the retirement witness runs. A fixture asserting the
  retirement redirect needs the first kind; a fixture asserting resource split needs the
  second.
- **Bitwise resume claims die on module-level run state.** The checkpoint enumerates
  `S`, the clocks, the RNG and the sliders — anything else a kernel branches on
  (`SLAB.ready`, `COL.floorClassValid`) must be restored, invalidated to a pure function
  of `S`, or proven unreachable by the kernel order. Include a paused-geology leg in any
  save/load done protocol: the eruptive-clock-only continuation is where such state
  surfaces (and the plan's own eruption-watching use case).
- **A diagnostic that writes the hashed state is not a diagnostic.** The HUD repaint must
  be `S.hash()`-neutral (ore-ui gates it). Give the measurer its own buffer
  (`S.massInto`) instead of the state's scratch (`S.mass`), and keep the 2 Hz sweep
  read-only down to `isClosingCC`'s cache.

## 0.2.0 M5 (acceptance and tuning, archive/0.2.0-m5-worklog.md)

- **Sample an invariant every frame, not at the HUD's cadence.** The K9 sweep was read at
  2 Hz on the page and every 100 frames in save-bench, and two real reds lived entirely
  inside one-frame windows (a column-death frame, the frame a collision ended). An
  acceptance harness that samples every frame found both in a 3000-frame leg; the same legs
  look clean at any coarser cadence. Long-run invariant checks belong in a harness, not in
  a page timer.
- **A per-slot classification snapshot must be taken where the geometry is settled, and
  after the gather renumbers the slots.** Freezing the C-C contact class after the
  classifier ran meant the frame's settled gap was judged against a floor no solve ever
  used; freezing it before the sort meant `floorClass[i]` described the pre-sort column.
  The working position is the end of `COL.transport` (post-gather, pre-classify), with
  `COL.finalFloor` re-freezing after any topology change.
- **Split the live rule from the snapshot, or a freeze cannot replace a freeze.**
  `freezeFloorClass` calling `isClosingCC` while a snapshot is valid copies the old values
  onto themselves — a silent no-op. `COL.closingCC` (live) and `COL.isClosingCC` (snapshot)
  are now two functions, and the one topology-deciding caller uses the live one on purpose.
- **A buffer with two contracts is a trap; leave the boring value behind.** `S.sortOrder`
  is a position permutation after K3's transport and a list of surviving *source* indices
  after K4's compaction. The first reader to assume the permutation (the M4 diag) reported
  an unsorted world on every column death. Since nothing reads the source list once
  `COL.map` is built, K4 now leaves the identity.
- **Prove a fix geometry-neutral instead of asserting it.** Both engine fixes above were
  checked by re-running `contact-audit 5000 5 100 --strict` and diffing against the
  pre-fix log: byte-identical apart from `ms/frame`. That is what let the tuning table
  stand without a re-sweep.
- **Re-run a tuning sweep after the gate it was measured against changes.** The first
  `kBeltGradient` table was taken against the single-frame needle gate; M5 replaced that
  gate with the standing-needle clause, and on the new gate *every* candidate passes, so
  the old table could not choose. The re-run keeps a tag in its log names so both tables
  stay on the record. When the gate stops discriminating, choose on the reported metric
  behind it (here: the worst single-frame ratio, 1.40 at 12 vs 1.61–2.11 elsewhere).
- **A gate bound that was never measured is a coin flip, and a metric that cannot witness
  the bad case is not a gate.** checkpoint D2's 1e-3 bound sat on a metric whose own spread
  is 1.3e-3–7.8e-3 (nine constants, both directions), and the deliberately mis-registered
  cut lands *inside* that noise — so the bound was widened to four times the measured worst
  and paired with a non-chaotic gate (the K9 invariants over the same 1000 frames). Also
  check which world a harness left in the state: D2 was measuring the previous check's
  shifted cut, not the round-trip it was named for.
- **`e3b0c44298fc…` is the sha256 of nothing at all.** A `git show <commit>:<path>` that
  fails prints an error and nothing on stdout, so piping it into `sha256sum` hashes the
  empty string and reports a *hash* for a file that does not exist — which reads as
  "drifted" instead of "absent". Two of three shared files looked drifted that way. Make
  the absent case a distinct value (`null`) and let the report say which it was.
- **Measure a checkout against the branch tip, not against `HEAD`.** The drift harness first
  reported "0 commits behind, everything byte-identical" because the upstream clone was
  still sitting on the pinned commit it had just checked out for the isomorphism leg — the
  comparison was the pin against itself. Resolve `origin/HEAD` (then `origin/main`,
  `origin/master`, then `HEAD` for a tarball) and name the ref in the output.
- **A SKIP is a state, not a verdict — and it may be closable.** `isomorphism.js` link 2
  reported SKIP for a whole milestone because no upstream tree was present; cloning the
  counterpart and checking out the pinned commit closed it in one command and immediately
  produced the drift measurement 0.4.0 needs. Before recording a SKIP as an open item,
  check whether the thing it waits for can be fetched.
- **When one harness quotes another's total, read the owner's *last* summary line.**
  `acceptance.js` delegates §2.3 to `isomorphism.js`, which itself spawns `deposits.js`; a
  first-match `/ALL PASS \((\d+) checks\)/` quoted the child's 76 as the owner's own 8.
  The verdict was still right (`status === 0` is the gate), but the number a reader would
  check was wrong — the kind of detail that makes a green log untrustworthy.
- **"No constant moved" is a legitimate tuning result, if it is measured.** The chamber
  scale sweep shows the live edifice is supply-limited (the whole section makes ~5 toy
  cells of melt per 150 Myr against the ~50–450 cells² a design-scale cone needs), so no
  value of `Vch`/`Vbirth`/`Vdie` can reach it. Record the table, name the constant that
  *would* (`kMelt`/`kPlumeMelt`), and defer it to the release that owns the crust budget.

## 0.2.1 melt supply (archive/0.2.1-melt-supply-worklog.md)

- **A solver and its checker must share one tolerance.** `COL.floor` settled on exact
  equality (`d >= min`) while `SIM.diag` judged the result against `min × (1 − floorTol)` —
  the constant's own comment even said "see COL.floor", but only the diagnostic read it. So
  the solver spun on a residual no reader cared about (69.9% of 10 954 calls burned a lifted
  1024-pass cap with nothing left to fix) and, because that spin ate the budget, a genuine
  squeeze ran out of passes inside its own floor for 90–118 frames at a time. One comparison
  fixed both halves and made the step faster.
- **Before blaming the constant you just changed, reproduce the red without it.** The
  acceptance red appeared the moment `kPlumeMelt` moved, and it was not the melt: the same
  `gap` red reproduces at the old value on a different seed (90 frames, same 9.15 km
  signature). Changing a constant changes a trajectory, and a trajectory can walk into a
  defect that was always there. Two legs at the old value on other seeds settled it in a
  minute; reasoning about mass budgets would not have.
- **Measure an iteration's pass requirement; do not guess its cap.** A max-push Jacobi
  sweep over plates converges geometrically (ratio ~0.87 per pass here), so the cap is a
  statement about the worst ring, not a safety margin. Have the kernel report its own pass
  count (`COL.floorPasses`) and gate it (`floor-bench.js`: worst 27, cap 64, no call
  exhausted) — then raising or lowering the cap is arithmetic, not judgement.
- **A probe that patches a kernel and then calls the original measures neither.** The first
  pass-count probe ran its own instrumented solve *and* `orig` afterwards, so every frame did
  double work on a trajectory the engine never takes, and reported "70% of calls need 129+
  passes" with a residual of exactly zero in the same line. Replace the kernel or wrap it —
  never both — and check that the two numbers in a report can be true at the same time.
- **The toy box is drained every frame, so it measures a rate, not a monument.** `writeBack`
  moves solidified material into the column each K7, so the pile a viewer sees is what is
  still molten; an explosive vent (tephra lands solid) shows almost none. Any edifice-size
  gate that drives `ERUPT.step` without `writeBack` — `erupt-bench.js` does — is measuring
  the box alone, and the two must not be quoted as the same number.
- **If K6 can see a volcanic top, it will shave the drawing.** 0.2.2: hook `erode`/`bury`/
  `reset`/`rehome` on a live arc (kPlumeMelt = 0) before changing a constant. The 1.2 px
  apron was 144 cells² of `erode` + 43 of `bury` per 800 frames, not a missing melt
  multiplier. Write-back now waits for `venDeath`; `erupt-bench` is still the box alone
  and `tephra-pile.js` is the live arc with geology running.

## 0.2.3 melt contact (archive/0.2.3-melt-contact-worklog.md)

- **A committed verdict may have been measured against a rule that is not in the tree.**
  0.2.2 declined `kMelt` 20 on two contact numbers (R2 2438/2724, R3 81.9 km). Both
  reproduce to the frame once `writeBack` is suppressed outside death — lava delayed as
  well as tephra, which is what the params comment called "a trial that also delayed
  lava" — and neither exists under the rule that landed (3590/3814, 80.4 km). Before
  inheriting a "this is red" note, spend the two minutes reproducing it, and reproduce
  the *number*, not just the colour: a match says the variant is the difference.
- **A volume counter is not a lithology.** `venEdV` is the edifice's written volume, so a
  "no live write-back" gate read off it also sees the lava writes the rule still allows
  (measured 63.8 cells² of lava placed live against 0.000 of tephra) and a slot a later
  birth reuses inheriting its predecessor's edifice. Wrap the kernel call that performs
  the named action — `ERUPT.place`, the way contact-audit wraps `COL.k4` — and count the
  named thing. A counter that aggregates several causes cannot falsify a claim about one.
- **When the safety gate is flat across a sweep, say so and let the design number
  decide.** The four strict contact legs passed at 2e-3, 6, 10 and 20 with worst margins
  0.2% apart. That is the gate doing its job — it bounds the blast radius — but it
  cannot pick the value; the cone column (1.43 / 4.03 / 8.24 px) did. Print both columns
  side by side so the next reader sees which one the decision came from.
- **Tuning-table candidates should be absolute values when the base is what moves.** A
  multiplier sweep silently redefines its own base the moment the constant lands, so the
  control row disappears. `melt-contact-sweep.js` takes absolute `kMelt` values; the
  multiplier sweeps (`melt-tune-sweep.js`) stay comparable only within one base, which is
  why its header now says the arc base moved at 0.2.3.

## 0.3.0 P3.2 review and P3.3 (archive/0.3.0-p3.2-review-worklog.md, archive/0.3.0-p3.3-worklog.md)

- A closure over a state that is zero in the shipped run is `0 = 0`. Seed the state the claim is
  about (a band of parcels with the composition in question) and gate the closure there. The
  P3.2 composition gate was vacuous until the seed.
- A gate that multiplies by zero (`x * 0`) is a tautology. Check the per-unit-mass ratio of each
  field instead.
- A book that closes only because a transition never fires proves nothing about that transition.
  Give each phase change its own mass term in the book, and gate the term on a fixture that fires
  it, since the live run may not.
- A decaying overpressure never reaches its threshold. Cap the drain at the spent overpressure
  explicitly, or the conduit never seals and the reservoir drains without limit.
- A check label must name what is printed. `check.near` printed an absolute difference under a
  `rel` label across the suite; fix the helper, then regenerate the logs.
- A report line that prints two runs' numbers side by side misleads. Print each run under its
  own label.
- A harness copied to /tmp for a mutant must copy the whole tree (harnesses read root files such
  as `columns.html`). Copy with `tar --exclude=.git`, not only `js/` and `experiments/`.
- A frame-time gate on a shared 2-core host is a host measurement. Before blaming the change,
  time the base commit (`git archive <commit>`) and the tree interleaved on the same host
  (`experiments/pt-p3-frame-ab.js`).

## 0.3.0 P3.4 flight (archive/0.3.0-p3.4-worklog.md)

- **A dual-clock regression must say which clock it fixes.** Fluid-step invariance cannot also
  demand equal airborne state when one geological run has ten times as many rendered wall
  frames. Pass explicit zero wall time when gating geology; gate wall trajectories separately
  with a fixed interval sequence.
- **Collision and drawing use different horizons.** Land against physical `-zh(x)`, never the
  relief-exaggerated raster. Air/deposits already carry that 1x height, so rendering adds only
  the remaining visual factor; applying the full warp lifts them twice.
- **A hot deposit cannot reuse mantle detachment unchanged.** The next G5 pass reintrudes it
  before it can cool. Keep landed material in its phase, apply a named surface-wall exchange,
  and let the existing age/strength law weld it only after crystallisation.
- **Dense compaction changes a merge's return slot.** If survivor `a` is the tail and `b` is a
  hole, `remove(b)` moves `a` into `b`; return `b`, not the now-cleared tail index.
- **A short tuning probe is not a long-run stability gate.** The first conduit geometry closed
  perfectly at 20 Myr but drove the 150 Myr field below its existing bound. Sweep against the
  longest owning regression before shipping the geometric default.

## 0.3.0 P4.3 erosion (archive/0.3.0-p4.3-review-worklog.md)

- **Stream power slope is the drop to the receiver, never a stored right-face.** `E = k * sqrt(A)
  * S` with `S = (z_i - z_receiver) / dx`. A right-face `|zh[i+1] - zh[i]|` is the *uphill* side
  of every left-draining column. Half the live profile drains left; the two faces differ at every
  non-linear column (24% of live demand, 46 depositional disagreements after 10 Myr). A piecewise-
  linear fixture hides it (equal faces on each flank) and a by-hand check that samples two
  right-draining columns cannot see it. The hillslope candidate already used the drop; the shipped
  law has to.
- **A demand check that restates `|erS|` cannot catch a wrong `erS`.** Recompute
  `(zh[i] - zh[erR[i]]) / dx` from the profile. Same trap as a book that closes on `0 = 0`.
- **JS typed arrays silently discard `arr[-1] = x`.** A drainage peel that pushes sinks indexes
  `erA[-1]`; `(new Float64Array(4))[-1] = 3` does not stick, so `erA[-1] === undefined` after
  `route` is not a gate. Do not push a node with `erR < 0`. The sink's area is already complete
  when its last tributary is processed.
- **The deposit seat is the shallowest in-band deposit, slot as tiebreak** — the same total order
  the donor scan uses. Lowest slot is pool order, not the pile. Do not reuse `depositMerge` as a
  seat radius: by 20 Myr the crust has buried the typical deposit ~8 km below `-zh`, and a
  "must sit on the horizon" test would admit a fresh parcel every frame.
- **A `share > 0.25` gate on the top decile was 0.4 points under the measured 25.4%** — a
  restatement, not a concentration claim. Twice uniform (0.20) still has teeth; gate sqrt(A)
  itself on a linear flank where the slope is shared and only area ranks the demand.

## 0.3.0 P4.4 acceptance/freeze (archive/0.3.0-p4.4-worklog.md)

- **When a new pass ships, re-isolate every earlier owner harness's live legs.** Each P4 owner
  sets the later passes off (`P.slab = false`, then `P.arc = false`, then `P.ero = false`) so
  its live numbers stay its own report's. P4.3 shipped without adding `P.ero = false` to the
  P4.0/P4.1/P4.2 owners, and `pt-p4-contact`'s zero-residue gate rotted: sediment welds into
  the lid, the fragment population shifts, and a marginal pair lands one ulp inside the hard
  radius once in 6,000 frames. A pass that changes the planet invalidates every live number
  measured before it; the integration census belongs to the acceptance pass, not to the
  owners.
- **A phase-stock identity must enumerate every pass that debits it, and passes that move
  material are phase-blind by design.** The deposit identity P4.3 wrote (`land + ero - eroDep`)
  was true only while nothing subducted: the slab pass recycles detached cold lithosphere
  whatever its phase, and subducted sediment is exactly that (1,242 km2 of 353,677 in 300 Myr,
  22 parcels). Fix is a named counter per pass/phase pair (`thr.deepDep`), read BEFORE
  `remove()` compacts the tail into the slot. When a phase identity fails at long horizons,
  wrap the suspect transaction and diff the gap before touching anything else.
- **Cumulative counters in `hash()` move every published fingerprint.** Adding a diagnostic
  counter is right (the plan's rule) but it makes all pre-change fingerprints stop
  reproducing. Record the cross-check in the worklog (same leg, old tree, old hash) so the
  lineage stays verifiable, and keep in-repo gates within-run replays only.
- **Module-level sim state poisons later sections of a harness.** `S` is one object: after
  the slider matrix re-runs the sim, `S.thr.*` is the last cell's, not the integrated leg's.
  Capture the readings into the accumulator before moving to the next leg.
- **A kernel's decisions can be re-derived from its own snapshots without touching it.**
  `contact.detect` stores per-column `(ctV, ctT)` before the brake and its site walk is one
  comparison over adjacent columns, so a harness re-running the walk at frame end reproduces
  the decisions bitwise and reads what the kernel never recorded (contrast, cluster sizes) --
  no engine change, no fingerprint move, and the census-vs-`S.d.contact` cross-check gives it
  teeth.

## 0.3.1 M2 — the field term, and how to measure an adjoint pairing's tail
(archive/0.3.1-M2-acceptance-worklog.md, experiments/pt-buried-deposit-melt.js)

- **Read a gate's intake at the moment the kernel decides, per source.** M1 could only compare
  an exposure integral (a resident population) with an intake (a flow), and the two are not
  comparable, so "the intake is small" stayed unread. Sampling every routing candidate at the
  G5 boundary — its own T, its own solidus, the node field, the pairing's gain and its mass
  share of the stencil — turned it into "the intake is the light tail", which is what decided
  M2. The wrapper costs nothing: it is the same O(n) scan the exposure reading already made.
- **The adjoint renormalization is exact in total and unbounded per parcel.** `cw = mu_k / W_k`
  keeps `sum_p m_p a_pk = mu_k`, so the intake/wall gate cannot see the distribution at all: a
  parcel carrying 0.5% of its stencil's marker mass took a 1.2x amplified specific increment and
  sat 0.24 of T above the field it was embedded in, while the domain's whole intake still closed
  at 5e-5. Gate the total *and* report the per-parcel tail; only the tail says whether a phase
  change is physics or quadrature.
- **Compare the suspect population against the shipped one, in the same leg.** Mantle
  segregation routes 3221 parcels at a mean T-field gap of +0.004 (94% of its mass within
  0..0.05); the deposit gate took 6 at +0.244. Same boundary, same threshold, same run — the
  contrast is the evidence, and neither number means much alone.
- **A fixture that reads a field has to own the field.** Section A places probes by hand while
  `S.Tg` still holds scatterT's initial condition, so the field-support fixtures would have been
  judged by a planet they were never part of. `S.Tg.fill(t)` makes the term testable, and the
  section's default has to sit above every solidus in the domain (1.5 does) so the older
  fixtures keep testing exactly their own terms.
- **A term that closes a live intake is a decision, not a failure — if the population it holds
  back stays measured.** The held-back accumulator reports precisely M0's exposure (seed 6:
  1.361e4 km2 Myr, field 0.13..0.29 below the parcels' solidus), so the zero is documented with
  the mass-time it declined instead of with a count of zero. A resident population has to be
  integrated over `dt`; an event population must not be, or the same parcel is counted on every
  frame it stays eligible.
- **`===` on a phase-law round-trip fails.** `PHASE.byT(ts + 0.5 * meltGap)` returns melt
  0.4999999999999997, and a split books `m * xi`, so both the fraction and the transferred mass
  need a tolerance. Assert the *shape* exactly (phase, slot count, counters) and the arithmetic
  to 1e-9.
- **A "nothing moves" gate rots the day a later release adds a mover.** `pt-p3-enthalpy.js`
  asserted that 100 quiescent frames leave every parcel's H and m alone; it was green through
  P4.2 and read 472 parcels moved on the M2 tree. Nothing in `melt.js` could be implicated
  (`SIM.k[5]` is null in that configuration) — P4.3's weathering moves mass into sediment and
  P3.4's flight cooling then takes that sediment's heat. Isolate a mover by disabling passes
  through their own params, one at a time: `P.ero = false` alone took the count to 0, and no
  other combination of `P.slab`, `P.contact`, `P.arc`, `k[6]` or `k[7]` changed it. Then fix the
  measurement rather than the pass — the gate runs the mover off, and a second gate runs it on
  and books what it moves (472 of 23780 parcels, none below `P.eroBand`, parcel mass conserved
  to 5.4e-16 relative, dH −2.350110e+0 against the −2.350110e+0 `flight.js` wrote into
  `S.hLedger`). An assumption that went stale becomes a gate that cannot.
- **A route that is silent at one horizon is not a dead route.** All seven 300 Myr cells take
  zero transfers, and the same engine on M0's 600 Myr cell takes three: 9.730 km2 of melt at a
  field support of +0.0005..+0.0419, a T-field gap of +0.020..+0.063 and an adjoint gain of
  0.683..1.878 — the mantle's own routed signature. Before writing "the mechanism never fires"
  into a plan, run the longest cell the bank already has; the acceptance of a filter needs both
  of its populations in view, and the shorter horizon only showed one.
- **Scope a new term to the population whose measurement produced it.** The field-support term
  reads on deposits as a filter with a decisive contrast, but the mantle branch's own routed
  samples run −0.7714..+0.3625 of field support at a mean of +0.0017: the same condition there
  would veto part of the frozen P3.2 segregation law rather than refine it. The harness gates the
  scoping claim by reading the mantle's T-field gap beside the deposits' (+0.0150 against
  +0.2152 on the 600 Myr cell), so a future reader can see why the term is deposit-only and what
  re-scoping it would cost.

## 0.3.2 M1 — latent localization and bounded redistribution (archive/0.3.2-M1-localization-worklog.md)

- **A conserved stock and a booked flux can differ by a whole phase nobody books.** The P3.1
  identity `hLedger − ledger = L·(invLTot − invL0)` closes on every grid-coupled path to
  under 4e-7 cumulative over 12,000 frames, yet drifts −167.41 km²·H on the 600 Myr cell.
  `invLTot` spans the whole pool; the sensible ledger books grid-coupled phases only; and
  `FLIGHT.launch` creates air parcels with T from the equilibrium reading of the batch
  enthalpy but melt from the vent stock's *aggregate* fraction. The next `PHASE.equil`
  remaps the whole pool onto the manifold and books nothing for air, so each mushy-stock
  launch steps `invLTot` by `m·(xiEq − xiStock)` unbooked. Every significant snap reads
  xiEq = 1 against xiStock 0.901..0.999 — the surface solidus always reads the batch fully
  molten. Localize a two-book gap by tracing the residual across *every* kernel boundary
  (fast naive latent in the inventory's own order against a ~1e-8 noise floor) and
  decomposing the suspect pass per phase: the boundary table said "equil keeps what gather
  cancels, minus air", and the per-launch prediction then matched the measured drift to
  2.0e-8 with the 6.1e-3 gap accounted for by the five final-frame launches whose re-read
  never followed.
- **A green short-horizon gate can be a horizon fact, not a correctness fact.** The seed-1
  300 Myr owner leg runs 75,979 launches and still reads 1.09e-13 on the identity — every
  batch left on-manifold *inside that horizon*. The seed-5 cell first vents a mushy stock
  at 346 Myr. Before trusting an end-of-leg gate, ask what event class it never reached;
  the same asymmetry found the deposit route (silent at 300 Myr, live at 600).
- **When wrapping engine methods in a harness, `fn.apply(this, arguments)` is not
  optional.** `FLIGHT.launch` reads `this.surfaceY`; a wrapper calling `launch0(Mx, Sx, k,
  dt)` detached the receiver and died on the first eruption. The generic wrapper had it
  right; the four hand-written ones did not.
- **A conservative probe's giveback must be capped per parcel, and its two violation sides
  placed separately.** Dividing an infeasible remainder by the bucket's *net* withheld
  excess amplifies one parcel's giveback without bound when a mixed-sign bucket nearly
  cancels; place the hot and cold sides against their own headrooms and never return more
  than each capped parcel's own withholding. On this cell the two cuts ran bitwise
  identical (no mixed-sign bucket occurred) — keep the fix as hygiene and say so; a
  silently repaired probe would have misdiagnosed the −2.44 tail as the bug instead of
  what it is: feasible-set exhaustion.
- **Conserving the integral does not remedy a distribution whose constraint is local
  capacity.** The spread probe held the wall to 1.309e-3 (better than baseline) and still
  failed: 3,118 of its bounded placements found zero headroom in a ~4-parcel nearest-node
  bucket, and its out-of-bound sample count equals its giveback count exactly — every
  violation is a parcel taking its full uncapped delivery back. The light-parcel increment
  (gains to 11.9) exceeds what three neighbours can absorb inside the bounds; the remedy
  family that remains is a wider feasible set or a wall-booked correction, not a tighter
  local split.

## 0.3.2 M2 — the tail family on a green identity (archive/0.3.2-M2-tail-matrix-worklog.md)

- **A remedy that passes the gate list can still be a clip.** Stencil-scale bounded placement
  was the first probe to hold T, wall, books and frame together on the 600 Myr cell (0
  infeasible placements against node scale's 3,118) — by parking the light deposits *at*
  T = 1.500 while they stayed 0.72 above their field, and the held-back concentration grew 38%.
  When a gate is a bound, also read the population's distance from what it should track (here
  T − field and the held-back census); a bound that a pile of parcels sits exactly on is
  measuring the remedy's own cap.
- **A booking makes a source visible, not conservative.** The relaxation booked as an
  explicit source beside the wall read 2.1e-3 on the operator-only ratio and −7.48% of the
  wall as its own term; folding it into `S.wall` would have "passed" P4 at 2e-3. Keep a
  non-operator term separate, gate the uncompensated ratio, and print the source's share.
- **Restoring light parcels reaches physics pure FLIP never exercised.** The zero-sum
  sub-grid relaxation removed the held-back concentration (0 samples against 30,906) and then
  found that P3.2's split residue is undepleted: in a supporting field it re-melts every frame
  (8,559 transfers from 40 parcels, hosts down to 5e-324 km²; over the whole mantle 850,098
  routings and a saturated pool). Grid conduction had been rate-limiting the reheating, which hid the missing depletion
  law. Before adopting any faster parcel–field coupling, check what each kernel downstream
  assumed about the old rate.
- **A margin of 0.011 is not a pass, it is the next failure.** The baseline's coldest mantle
  parcel is −0.489 against a −0.5 bound; the M0 floor, relaxation and merge probes and the M2
  wall-booked relaxation crossed it, and the zero-sum one crossed or did not depending on
  round-off. Report the closest approach to a bound beside the violation count, per phase.
- **Commit probe code before banking from it, and treat a "pure" refactor of it as a new
  measurement.** Folding two stencil loops into one helper reassociated a few floating-point
  sums; on a leg whose route bleeds (a residue re-split every frame) that moved 521 transfers
  to 8,559 and a 21-sample bound violation to none. The pre-refactor code had never been
  committed, so its banks could not be reproduced and were re-measured. A chaotic reading
  that a reassociation moves by an order of magnitude is itself evidence of the degeneracy;
  but only conclusions that survive both banks may stand in the report.
- **A per-phase gate across a matrix finds what one cell's whole-cloud reading cannot.** The
  M2 matrix found mobile melt above 1.5 on seed 2 at three clocks; the only prior T gate on a
  300 Myr leg read seed 1 (melt peak 1.388) and the tail probes excluded mobile melt by design.
- **Editing a runner while a matrix spawns children from it changes later cells.** Each
  matrix cell is a fresh process that reads the runner file at spawn time; hold edits until
  the matrix is done (or copy the runner to a frozen path first).
- **Verify a booking remedy by bitwise invariance of everything it should not touch.** The
  launch/air re-bank reproduced every grid-coupled reading of the M0 bank bitwise — held
  census, extrema, wall, books, the three protected events — while only the latent residual
  and the hash moved. That is survival by identity, a stronger claim than any event
  correspondence argument, and the checker now asserts it.

## 0.4.2 — verifying a counterpart across two repositories (archive/0.4.2-counterpart-audit-response.md)

- **Byte equality beats identity equality, and a length is not an identity.** The globe's audit
  compared canonical byte *counts* with its own fresh bake; the stronger reading costs nothing —
  re-run the counterpart's writer in a fresh checkout of its tree (codeload tarball, 0.7 s per
  bake) and `sha256` the payload text on both sides. Three hashes
  (`a0e3afad…`, `34dc4b24…`, `0ec3a4e8…`) now say more than six checksums plus three lengths,
  because a future re-bake that agrees on them agrees on every byte.
- **`git hash-object` on both sides is stronger than `sha256sum` of a working copy** for a shared
  file: a blob match also pins line endings and the absence of a BOM, and it is comparable
  through the GitHub API (the contents endpoint returns the blob sha) without downloading a tree.
- **A manifest pin is a claim about a repository, and only that repository's own history can
  check it.** Their `PORT.json` pins `globe-writer ee43f647…`, which does not exist in their repo
  (`git cat-file -e <sha>^{commit}` → fatal; the API → HTTP 422). Their port test is offline by
  design and asserts file *bytes*, so it cannot fail on a dangling pin; our `upstream-drift.js`
  resolves the pin and is green only because ours points at a real commit. Neither suite reads
  the other's manifest — so a one-line `cat-file -e` is the only gate that sees it, and the fix
  belongs in the coordinated manifest touch, not in a new harness.
- **Resolve the handoff by hash, not by branch or by pin** (`0.4.2-plan.md` D1). It is why a
  dangling upstream pin cost this repository nothing: the bytes were the authority from the start.
- **"Frozen, do not extend" is not the same as "still runs".** `tools/earth/stamp.js` calls
  `SP.normalize`/`SP.quantize`, which the v2 codec keeps internal and does not export, so the
  retired Python bake's stamp step throws `TypeError` against `port/slice-format.js`. A retirement
  note that says only "frozen" leaves a future session two tempting repairs, both wrong: porting
  the tool to `make → seal` resurrects the private re-bake A3 forbids, and exporting the two
  functions is a unilateral edit to a shared file. The third move is a header line saying the tool
  is dead and why.
- **A grep claim in a report must name its scope.** "no `normalize`/`quantize` call outside the
  codec" was true of the shipping read/write path and false of the tree. Either say "outside the
  codec in `js/`, `experiments/` and the page" or run the grep over everything and report what it
  finds — including the retired tool.

## 0.3.2 M5 — material identity across diverging runs, and the mover nobody had counted (archive/0.3.2-M5-correspondence-worklog.md)

- **A material id is not a material identity across two runs that diverge.** Ids come from
  `S.nextId` (`js/pt/pool.js:96`), a split's child is a new id, a merge survivor takes the smaller
  one (`js/pt/pool.js:349`), and `nextId` is mixed into the fingerprint (`js/pt/state.js:527`).
  Measured on one cell (seed 5, 50 kyr/frame, 600 Myr), control against `frb 0.25 --scope dep`: all
  five ids the two runs share are admitted at a different site — 3,537 to 7,928 km apart circularly
  on the 16,000 km wrap, three of the five in a different phase, one as 55 frames of airborne
  material in the control against 884 frames of buried deposit in the candidate — while the
  admission *frames* stay within 34, because the counter keeps step with the eruption cadence and
  the material it names does not. A cross-run id match therefore looks available exactly when it is
  not, and a gate written as "the same material ids route" can only be met by a candidate that
  changes nothing. Compare per-run histories and admission records instead, and say so in the gate.
- **Within one run, a traced id is a lineage, not a fixed body of material.** The merge survivor
  takes the smaller id, so one traced id's mass runs 0.075 → 0.603 km² and another's 3.076 →
  50.000 km² (the pool's own cap). Read a trace's admission, delivery, cap and routing counts; do
  not read its position or mass sequence as one parcel's.
- **The mesh repair moves material non-locally, and it is routine.** `F.transfer` calls `G.reseed`
  when a node's deposited weight falls below `M.cover` (1/16); `pull` searches square rings of
  radius 2, 8 then 32 nodes (`dx` is 62.5 km, so the widest ring is 2,000 km) and `donor()`
  (`js/pt/grid.js`) assigns the hole's coordinates to a marker from a bucket that has a spare — id,
  mass, composition and heat untouched, position replaced — with `G.redeal`'s global lattice
  permutation behind it. Counted over 600 Myr: 13,234 relocations in the control and 13,439 in the
  candidate, in 5,209 and 5,126 of 12,000 frames, at most 12 and 17 in one frame, and zero global
  re-deals in either world. One traced deposit was moved ten times, by up to 737 km in depth and 376
  km laterally, and its widest departure from its own field (T − field 0.862 at y 49.3 km, in a
  field of 0.175) came three frames after a move that lifted it 156 km. So a parcel's position
  history is not advective, and hot material dropped into a cold neighbourhood keeps its heat and
  only afterwards relaxes toward the field it landed in. `movedSum`/`movedMax`/`movedFrames`/
  `redeals` are banked by `pt-heat-tail.js` from M5 on: read them before believing a trajectory, and
  remember the repair is not a defect — a node no marker reaches keeps its last frame's value, and
  leaving holes stale drove a run at Ra 1e6 into a grid-scale instability.
- **A banked `ms/frame` belongs to its instrument set.** The same cell read 21.589 ms/frame with
  `--watch` on (cold path, band table, per-sample gain and share) and 15.768 with `--trace-id`
  instead; the trace's own cost on the control is 0.004 ms/frame (11.696 untraced, 11.700 traced).
  M4 recorded the frame-time gate as failed on the watch-inflated number. Before rejecting a row on
  frame time, check which instruments its bank was made with — and run a quoted cell alone.
- **Verify an observation hook with a large target list, not with debug output.** `trCap` fires only
  where the bound actually caps, so a short smoke run with two or three arbitrary ids records zero
  caps and looks broken when it is working. Four thousand traced ids on `frb 0.25 20 --scope solid`
  gave 72 cap rows with the fingerprint unchanged. The same run priced the instrument: 8.23 MB of
  bank for 4,000 ids over 400 frames — trace five ids, not a population.
- **Neutrality is a fingerprint plus a field-for-field diff.** Keeping its world's fingerprint
  (6191250240167390, 1808048552219233) proves an instrument left the engine state alone; matching
  the world's already-banked transfers down to `cF`/`cW`, its held census, spread counters,
  `mantleRoutes`, `minT`/`maxT` and census proves it left the observation alone too. Assert both and
  the new bank can be read as the same run rather than as a new one.

## 0.3.2 M11 — kinematic drive attribution on the slow late plate, and the continuous slow-episode census (archive/0.3.2-M11-drift-attribution-worklog.md)

- **A slow plate is not necessarily an un-driven plate: boundary mechanics can hold active drives.**
  The unbound s1 slow plate at 500 Myr ($v_{\text{drift}} = 0.011$ cm/yr) has a pre-brake drive of
  $-3.49$ cm/yr from $-6.74$ cm/yr slab pull and $+2.43$ cm/yr mantle traction. It sits still because
  it meets two subduction boundaries where it acts as the overriding plate, and `contact.js`'s subduction
  hold rule explicitly injects an impulse $\Delta v = -v_B = +3.49$ cm/yr canceling its approach into
  the trench. Always decompose kinematic drives, contact boundary conditions and brake impulses on a
  slow plate's own frame before inferring missing mantle traction or proposing a drift fix.
- **Snapshot sampling vs continuous census: point samples amplify episodic variance.**
  Sampling plate speeds every 100 Myr samples arbitrary phase points of an episodic cycle, yielding
  divergent snapshot readings (0.01 to 5.08 cm/yr). A continuous frame-by-frame census across 600 Myr
  reveals that all worlds (bound and unbound, across seeds 1, 3, 5, 7) cycle between mobile drift
  (1..5+ cm/yr) and stationary override episodes (<0.5 cm/yr), with late mass-weighted drift averaging
  1.11 cm/yr bound vs 1.14 cm/yr unbound. Slow episodes account for 35–60% of late plate-time, with
  subduction override braking responsible for 30–77% of all slow-plate instances.
- **Do not tune physical constants or bounds from late drift counts without cross-seed attribution.**
  The deposit bound `P.depBound = 0.25` does not cause systematic late plate arrest; bound worlds are
  faster than unbound on seed 3 (1.125 vs 0.808 cm/yr) and equivalent on seeds 1, 5, 7. Tuning
  `depBound` from a single-seed snapshot would have corrupted a verified heat remedy to solve a
  non-existent drift defect.

## 0.3.2 M12 — repair-adjacent minority (`null >= 0` coercion), non-deposit thermal faces, and contact guard residue (`archive/0.3.2-M12-faces-repair-guard-worklog.md`)

- **Never test nullable sentinel ages with bare `<` / `<=` / `>=` in JS (`null >= 0` is `true`).**
  In `experiments/pt-heat-tail.js`, `movedAge(S, p)` returned `null` for parcels never relocated by
  `G.reseed`, and `hjAdd` tested `age >= 0` and `age <= JOIN_WIN[i]`. Because JavaScript relational
  operators coerce `null` to `+0`, every M6/M7/M8 bank recorded `heldJoin.never.n = 0` and folded all
  never-relocated held deposit mass-time into `heldJoin.ever` and `win[0..4]` ($\le 1\text{f}$). On
  `dep-s1`, a single never-relocated deposit (`id = 25109`, `movedAgo: null` in the M7 trace bank)
  accounted for $2,927.79$ of the $2,930.05\text{ km}^2\cdot\text{Myr}$ reported as "within 1 frame of
  a move", inflating a true $0.0117\%$ ($2.26\text{ km}^2\cdot\text{Myr}$) 1-frame share to $15.19\%$;
  on `base-s5`, $22,592.10$ of $22,713.57\text{ km}^2\cdot\text{Myr}$ was never-relocated, inflating a
  true $0.1783\%$ share to $33.33\%$. Always guard nullable ages with `age !== null && age >= 0`.
- **Match the kernel's exact B-spline stencil when attributing FLIP gather gain and mass share.**
  `G.gatherDT(M, S, inc, Tg, flip)` (`js/pt/grid.js`) uses the 3$\times$3 quadratic B-spline stencil
  `spl(u, c0, w)` over `M.cw` and `M.w` (with vertical coordinate $\eta = \log((y + y_0)/y_0)$ and step
  `M.dEta`), not a 2$\times$2 bilinear stencil over `S.W`. An attribution harness that computes stencil
  share or placement giveback on `S.W` will misattribute both the parcel's mass share and the exact
  `depBound` 3$\times$3 placement increments.
- **Attribute non-deposit thermal extremes and guard residues by provenance and topology before touching frozen kernels.**
  Across the 8-world 600 Myr distribution:
  - `mantle-cold` ($T < -0.5$) is $100\%$ confined to $0$–$50\text{ km}$ depth and $m \le 200\text{ km}^2$
    ($80.1\%$ of bound samples sitting at the `P.eroMinM = 50` $\text{km}^2$ weathering floor after
    `ERODE.run`, $11.1\%$ reduced below $50\text{ km}^2$ by P3.2 `POOL.separate` melt splits), cooled by
    raw surface conduction (`negRawDi < 0`) while `depBound` placement is non-negative (`negBdGiven >= 0`).
  - Shipped `mobile-melt-hot` ($T > 1.5$, $\max T \le 1.5955$) is $100\%$ never-relocated deep
    `mantle-split` melt parcels ($m = 12$–$43\text{ km}^2$, stencil share $< 0.024$) warmed by raw
    conduction ($\Delta T = \Delta H$ at $\xi = 1$) during buoyant ascent to `P.yCham = 37.5 km`, while
    `depBound = 0.25` already eliminates `base-s3`'s deposit-born `dep-whole` excursion ($38 \to 0$).
  - `CONTACT.guard` residue after `P.ctSweep = 3` is $100\%$ (`381/381` bound pairs, `641/641` unbound
    pairs) multi-pair sandwiched markers (`deg >= 2`), holding $\ge 97.58\%$ of `contactHard` across all
    48,000 shipped frames and clearing $100\%$ in finite scratch sweeps ($4..40$).

## 0.1.12 — quiet-frame material identity, and the background that was the event (`archive/0.1.12-quiet-identity-worklog.md`)

- **A gate's background has to be certified against the event definition, not assumed quiet.**
  R1 reads "the largest drawn move on a quiet frame away from every event footprint", and the audit's
  event set (`dSites`) counts births and consumes only — `COL.intents` has four intents, and intent 3
  (the sliver retirement, `COL.drain`) is geometry, not a boundary state, so it never enters `dSites`.
  1,887 of 152,233 "quiet" frames (1.24%) changed their record set behind that definition, carrying
  2,882 of 0.1.9's 2,883 censored observations, and the "record set changed" bucket **equalled R1's
  yardstick in all 32 worlds**: the background was the event, the same false-green shape 0.1.9 §1.1
  fixed for the site. When a gate measures against "everything else", enumerate what its event
  definition does not count before trusting the number.
- **Conservation buys identity for free, and both identities must be asserted, not assumed.** K4's
  quiet branch rescales beds by `oldW/newW`, so volume is exactly conserved on a quiet frame and the
  material change is `dhId = |hNew − hOld·wOld/wNew|` with no flow model. `S.widths()` is the Voronoi
  cell (`0.5·(dl + dr)` wrapped), so with neighbour continuity (C1) held the territory change is
  exactly half the difference of the two neighbours' displacements, each split into advection
  (`colU·dt`) and floor push. Both closed to **0 m / 0.0000 m** over 79,400,392 certified pairs —
  which is what made the residual readable as felsic flow (13.4 km of felsic, 0 m mafic, 19 m sediment
  in one frame) rather than as a correspondence artifact.
- **Print the absolute companion of every relative maximum.** C2's worst volume change was 164.5%, on
  a column drawn 0.1 km → 0.2 km: metres of rock. A relative conservation check on a near-empty
  record says nothing without the row's own thickness beside it.
- **A ghost-count delta is not evidence of a missed consume.** The drained record *is* the ghost, so a
  retirement frame removes one; 1,790 of the 1,801 drain frames did. Assert `ghostChanges <= drains`,
  and read `SIM.onEvent` **calls** (the cadence may call and do nothing) apart from floor solves.
- **One log can carry two counts with the same word.** `contact-audit.js` prints its own
  `re-partitioned` (every frame) and the identity book's censored (certified frames only, 0..1 here);
  a table that asserts they are equal throws on the first world. Name the population in the assertion.
- **A definition change that turns a gate red cannot land alone.** `experiments/acceptance.js` runs the
  four strict legs and requires exit 0, so `--drain-event` stays a flag: measure it, report the red
  (ratio 1.29..5.89 against a 1.25 budget on 32 of 32 worlds), and land it with the engine remedy.
  Do not widen the budget to clear it — 1.25 is 0.1.5 §1's own wording, and the pop is the artifact.
- **Diff against the current baseline, not the nearest filename.** `experiments/logs/0.1.9-contact-audit-*.txt`
  are pre-matcher-fix 12-check runs; the 13-check baseline is `0.1.9-quiet-strict-*.txt`, and those have
  no `--detail` block, so only lines 1–21 and the gate lines compare.

## 0.1.13 — the sliver-retirement ramp: why `zDyn` fails on vertex deletion and why `S.oldW` belongs to `COL.k4` (`archive/0.1.13-retirement-ramp-worklog.md`)

- **A birth inserts a vertex on an existing line; a retirement deletes a vertex from a bent one.**
  `COL.rampZ` works in one frame for a birth because the newborn is placed on the straight chord
  between its two parents and their widths keep their thicknesses unchanged. When a ghost `G` is
  deleted in one frame while sitting `9.4 km` from a continental margin `B` (`z_B ≈ +6.5 km`) and
  `78 km` from an oceanic column `A` (`z_A ≈ −4.6 km`) with `z_G ≈ −1.2..−2.7 km` (`5–7 km` below
  the chord `AB`, because `edgeRelN` crosses zero 2–3 frames after `COL.consume` resets the new
  boundary and turns off slab pull), the 2-segment polyline `A → G → B` collapses in one frame to a
  single segment `A → B`. At the two adjacent 2048-raster samples bracketing `G` and `B`, both
  post-deletion elevations are linear functions of the single surviving margin elevation `z_new`:
  holding `z_new = +6.5 km` via `zDyn` (`--retire-ramp`) snaps the chord at `G` upward by `+5.9 to
  +6.4 km`, and even the minimax optimum over all real `z_new` moves both samples by `>= 3.2 km`
  (`> 1.25 · quietDz`). Handing the ghost's Voronoi territory (`rel·dr/span`, `rel·dl/span`) back
  over frames while `SURF.morph` walks `z_G` onto the chord solves both endpoints at once (`4/4`
  strict legs ALL PASS, `0/32` worlds with an over-budget retirement).
- **Never repurpose `S.oldW[i]` on a ghost to carry across-frame state.** For an ordinary ghost
  created by `COL.consume`, `S.colNL[i]` is `0`, so overwriting `S.oldW[i]` after `COL.transport`
  appears harmless on standalone planet runs. A C4 import (`COUP.apply`, tested in
  `experiments/coupling.js` Section L) writes beds onto every column in the cut *including* ghosts
  (`S.colNL[i] = 1`), and `COL.k4` / `COL.drain` multiply `S.layTh` by `S.oldW[i]` to conserve and
  book that imported rock volume. Overwriting `S.oldW[i]` with the stepped-down `wKeep` leaked
  `5.33e6 m³` (`1.11e-4` relative) of `fel` when the ghost drained; storing `wKeep` in the ghost's
  unused top layer-age slot `S.layAg[(i + 1)·P.layerCap − 1]` (`colNL <= 1` vs `layerCap = 96`,
  moved by `COL.gather` and saved in `Checkpoint` v9) keeps `S.oldW[i]` intact and closes the
  post-import ledger to `2.50e-14`.
- **`CRU.zDyn`'s explicit flexure stencil divides by `S.colW[i]`, so a retiring ghost's width needs a
  floor.** `CRU.faceGap` floors the face gap at `0.5·w0`, which bounds the explicit diffusion rate
  only while `colW` stays above `2·kFlex·dt·w0 / faceGapMin ≈ 1.6 km` at `100 kyr/frame`. Letting a
  retiring ghost's `wKeep` shrink to `100 m` before draining puts the Courant number at `7.8` and
  drives `zDyn` to `Infinity` in ~200 frames; a `2 km` floor on `COL.retireStep` finishes the
  hand-back in 6–8 frames while staying well above the stability bound.

## 0.4.4 — writing plans against a counterpart's current commit, and the prerequisite that expired (`archive/0.4.4-agreement-worklog.md`)

- **Re-measure a plan's own "prerequisite" clauses before scoping the work.** `0.4.1-plan.md`
  §8.6 wrote C1 as future work (one global per file, IIFEs, `start(host)/stop()`), and three
  release cycles of coupling work landed it piecemeal without anyone updating the clause. The
  0.9.0 plan was about to schedule a refactor that did not exist to do. Before scoping, run the
  clause against the tree: a 25-file grep for `else root.` settled it in one command.
- **A negotiation plan is written from the counterpart's tip, freshly cloned, same session** —
  never from the last session's memory of it. Their tip was unchanged since the 0.8.3 audit
  (11 days), but "unchanged" is a measurement (`git log -1` on a fresh clone), not an
  assumption; the plan pins the hash and the date it was read.
- **Name the exact sentences each proposal implements.** A P-item that cites the counterpart's
  own §2.1/§2.2/§5 line it carries out cannot drift into re-litigation; the one deliberate
  deviation from their sketch (positional beds under a named schema vs named bed objects) is
  flagged as *the* yes/no question instead of hiding inside a shared shape.
- **A hold's own re-open clause tells you what to write.** Both 2026-10-16 dispositions said
  "re-open on a scheduled import or a plan for gate 4". Gate 4 was closed by 0.4.3, so the
  operative trigger was the schedule — the deliverable is therefore a decision document, not
  code, and the plan says explicitly which of its milestones are gated on the mirrored record.
- **Proxy measurements are fine in a plan if the harness that replaces them is a milestone.**
  The globe's page-global inventory was taken by grepping top-level declarations (a proxy that
  can miss assignment-shaped exports); the plan's M0 harness (bare-VM load, read the real
  global set) is named as the authority, and the plan says the proxy is the input, not the
  proof.

## 0.4.4 M1 — a shared codec's three local couplings (`archive/0.4.4-M1-core-log-codec-worklog.md`)

- **`port/*.js` is a page module by smoke's own rule, so a port bump has two halves.** `experiments/smoke.js`
  asserts the directory is the page's load set (`portOnDisk.length === portScripts.length`, manifest membership)
  and that `portScripts[0]` stays `port/slice-format.js`. Adding a shared `.js` file therefore means a
  `<script>` tag after the pack codec in the same commit — the manifest and the page are one artifact.
- **Two contract fixtures can lock to each other, and the lock belongs in the port gate.** The core-log fixture
  carries the pack fixture's own `pathChecksum`/full checksum; `port-check.js` B3 re-derives both. A re-baked pack
  with a stale log fixture is then a port-gate red at the desk, not a pair-run surprise on the owner rig.
- **"Self-contained" is testable, so test it.** Strip comments from the shared bytes and refuse `require(`,
  `SlicePack` and `slice-format`; that is what keeps the file copyable byte-identically into a tree with a
  different module layout. The pack's `fnvText` is not exported, so a v2 log codec that borrowed it would be
  reaching through a closed surface.
- **`parse` quantises before it judges** (the v1 rule): the wire may carry more digits than the six-significant-digit
  rule, the record may not. A checksum taken over off-grid numbers is then a mismatch — the refusal, not silence —
  and `encode(parse(text))` is the canonical text for every accepted log.
- **A corpus generated by mutation must restamp after each mutation**, or the stale checksum refuses first and the
  rule under test is never exercised. The one case that must keep its broken checksum (the checksum case) needs an
  explicit `keepChecksum` path; every other case stamps through the codec before it is judged.

## 0.9.0 M0 — reading a page's real global set (`archive/0.9.0-M0-namespace-worklog.md`)

- **A proxy's scope is what it can see, on both sides at once.** The 0.4.4 grep covered the globe's
  `js/*.js` against our 25 `COL*` names and found no collision. Both pages also load `js/data/`,
  and both define `DepositEconomics` there, from two different files (our frozen v1, their v2).
  A bare-VM load of each page's own `<script>` list found it on the first run. Measure the load
  set a page declares; never a directory guessed to be the load set.
- **A global set is two sets.** `Object.getOwnPropertyNames(globalThis)` sees var, function and
  `root.X =`. It cannot see top-level `let`/`const`/`class`, yet a second script declaring one of
  those names throws. The inspector lists them: an in-process `inspector.Session`, plus
  `Runtime.enable` to learn the context ids (name each with `vm.createContext(sb, { name })`),
  then `Runtime.globalLexicalScopeNames`. It answers synchronously. Refuse a null answer, or
  "nothing in the lexical scope" passes vacuously.
- **A script that throws still declares.** Its var, function and lexical declarations are
  instantiated before its first statement runs, so they are in the measured set. Only a root
  write past the throw can be missing. The globe's `js/ui.js` stops on `document` at line 2;
  scanning its text for `window.`/`globalThis.`/`self.` writes (none) is what makes their
  144-name set complete.
- **A plan's load-set wording can be stale while every per-file claim stays true.** "The 25
  files plus `port/slice-format.js`" stops three of them at load: `DepositModels` and
  `CoreLogFormat` are read at load. Load what the page loads minus its optional content. Print
  the plan's literal set as INFO, so the reason for the widening is measured rather than argued.
- **VM realm details that change a check's meaning.** An error thrown inside a context fails
  `instanceof Error` outside it, so compare `name` and `message`. The context's global, seen
  from outside, is not the sandbox object (`sb.window !== sb`), so a window host is passed as
  `sb.window` or from inside. An accessor defined on the sandbox keeps `typeof` honest
  (`'undefined'`) and books every read. The vm `filename` turns up in the getter's stack, which
  is how a read is booked as `document @ js/section-pack.js:23`.
- **Mutation-test a new gate before quoting it, and again after editing a gate line.** Eight
  scratch mutations each turned the intended lines red with a named cause: a top-level `let`,
  an alias export, a frame requested at load, `start` without its early return, `stop` without
  `cancelAnimationFrame`, a colliding global at a moved globe tip, strict D, and a shortened
  refusal message. A ninth, no tree, is the SKIP path, still green. A harness that has never
  failed has not shown that it can.
- **"Absent from their tree" needs a file-type scope too.** `git grep SECTION_PACKS` at the pin
  hits five of the globe's markdown plans, which quote our name in prose. A quotation defines
  nothing; the claim is about code (`*.js`, `*.mjs`, `*.html`), and the check says so.
