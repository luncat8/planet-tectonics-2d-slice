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
