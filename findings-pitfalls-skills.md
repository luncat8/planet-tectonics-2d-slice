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
- fan merges at round(k*N/9) for k=1..9: k=9 is always exactly N (the bottom edge), so the
  9th halving never takes effect — the bottom row is 2 cells, 7186 cells total. Don't "fix"
  this to 1 cell: it changes every fanCells number the design cites.
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
