# Particle page real-browser smoke — 2026-10-17

**Result: pass.** This resolves the outstanding browser-smoke item noted in
`archive/0.1.9-worklog.md` and the 0.4.1 review follow-up, for the current tree.

## Method

Ran both `index.html` and its `particles.html` mirror directly as `file://` URLs in headless
Chromium 153.0.8010.0 on Linux, at a 1400 × 900 viewport. The temporary Playwright driver and
Chromium package were installed outside the project runtime; they are not application
requirements. The automated pass waited for the page to animate, read the canvas and HUD, and
used actual browser clicks and keyboard input. No server or network access was involved.

## Results

| Entry | Canvas | Live clock after load | HUD | Browser errors |
| --- | --- | --- | --- | --- |
| `index.html` | 1280 × 560, painted | 0.85 Myr | 16 lines | 0 |
| `particles.html` | 1280 × 560, painted | 0.45 Myr | 16 lines | 0 |

On both entries:

- the button and `m` key toggle markers and keep `aria-pressed` in sync;
- quality advances from 1/3 to 2/3;
- pause holds geological time over a 350 ms wait;
- step advances exactly one configured simulation frame;
- reset returns the clock to zero; and new planet increments the seed.
- no uncaught page error, console error, or failed resource request was observed.

`experiments/pt-ui.js` also passes **53 checks**, and `index.html` / `particles.html` compare
byte-identical.

This is a real browser-runtime smoke on the current files, not a desktop-user acceptance test or
a GPU/frame-rate benchmark. It does not make a cross-browser claim or validate narrow viewports;
the tested viewport was wider than the page's fixed 1282 px content width. No application code
change was needed.
