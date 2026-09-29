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
- the smoke DOM stub reads `checked` straight out of index.html, so the shipped default of a
  checkbox is what the headless run exercises — a flipped default fails the test, not the user.

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
