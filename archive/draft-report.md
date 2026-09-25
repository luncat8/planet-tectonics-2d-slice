**What is better than the raw sketch** (measured in `experiments/scale-check.js`):

- **Vertical — split sim mesh from display map.** Your "20 m → 1000 km" pair is exactly a geometric-graded mesh with **N = 64 rows** (q = 1.18748, bottom row 1006 km) — keep it, but don't render it row-uniform: that draws a real 40×4 km volcano as a 4:1 needle. The display should be `u = asinh(y / 40 km)` — a smooth signed-log anchored at 0 m (linear through the crust, 159:1 mantle compression). Then a realistic cone lands at **17×16 px** at the default window — your "10–30 px good-looking volcano" falls out of the map itself.
- **Thin beds can't live in rows** (a 10 m bed would need millions of rows). Stratigraphy goes in **Lagrangian column layer stacks** (512 columns, 78.4 km each) painted through the display map — crisp beds at any zoom, zero advection smear (the reference project's hard-won rule).
- **Horizontal 512 → 1 confirmed** as a dyadic fan (9 merge rows → single cell at center, 7186 cells vs 32768 uniform) carrying the one Eulerian field (temperature); everything sharp (slabs, plumes, melt, sediments) is Lagrangian.
- **Toy eruptive scale:** run it in screen-anchored cells (1 cell = 1 px at default zoom) so the edifice is *literally* 10–30 toy cells; square world cells render as 9:2 bricks on the default pixel. Toy only runs while erupting; its output becomes geology (stack layers + a sub-column edifice record).
- **Two sliders confirmed and decoupled:** geology 10–100 kyr/frame, lava minutes–hours/frame, coupled **only** through a magma-chamber buffer (fast tectonics fills the chamber — never strobes the eruptions).
- Bonus the slice gives for free: subducted stacks become visible descending ribbons, and deposits are **depth-resolved** (placer on unconformities, porphyry under vents) instead of the surface-only extraction of the top view.

**Written** (committed on the session branch):

- `0.1.0-design.md` — normative spec: scale system with rejected alternatives + numbers, state, frame pipeline, physics adapted from planet-geotectonics (1D plate solve degenerates to a mean fit; streamfunction flow is exactly incompressible), toy model, renderer, param defaults.
- `0.1.0-plan.md` — layout + phases **M0–M6** (scaffolding → section look → tectonics → sediments → slabs/plumes/melts → toy eruptives + second clock → deposits/save/polish), each with done criteria; acceptance suite at the end.
- `experiments/scale-check.js` — reproduces every number in the design.
- `findings-pitfalls-skills.md` — the scale-split pitfalls for future sessions.

Next step: start **M0** (grid/maps/LUTs + two-slider shell + debug section view) — say the word and I'll implement it.