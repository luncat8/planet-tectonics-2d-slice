Your 50-kyr gaps are real physics, not budget leaks — now untangling what 15 sessions built and what's left before geotectonics.

Checked the quoted result — it holds up, but chasing it further is the trap. Mapping the actual geotectonics blocker before I write the way out.

Verified the tally exactly from the logs, and found the real integration blocker. Writing the plain-language decision and the bounded next plan now — no new measurement matrix.

## In simple words

**What this project is:** Your other project, `planet-geotectonics`, is a planet seen **from above** — plates moving on a globe. This project is the same planet seen **from the side** — a vertical slice showing what the crust looks like *underneath* a line you draw on that globe.

**The end goal (0.9):** Draw a line on the globe → the cross-section under that line runs live next to the map. The globe drives the plates; the slice shows the underground. That's it. Everything else is preparation for that moment.

**What the last ~15 sessions actually did:** They weren't random. A section that will be *driven by another program's planet* has to be trustworthy first:

1. **No fake jumps** (0.1.5–0.1.13): the surface couldn't teleport kilometres in one frame. The worst offender — a dying column silently dumping its land on a neighbour — was just fixed in 0.1.13.
2. **Books that balance** (0.3.x): rock and heat are neither created nor destroyed.
3. **A shared file format** (0.4.2): both projects now read the exact same "cut" file, byte for byte.
4. **The cut itself** (0.4.1): draw line → copy → paste here → section rebuilds. **This already works today.**
5. **Coupling** (0.4.1 §8): the globe can send plate speeds + crust thickness, and the section obeys. Also works, tested (138 checks, green today).

The megabytes of logs are the receipts for those claims — proof, not product. You should never need to read them; that's what I wrote the new summary for.

## My decision on the suggested next step: **don't do it**

I re-checked its numbers against the saved logs — they're exactly right (16 worlds over budget: 10 births, 6 accretions, **0 retirements**; 13 of them at 50 kyr). But it's a trap, for three reasons:

- **0.1.13 already passed the test it was opened under.** Its plan required the 4 strict legs green + 0 bad retirements in 32 worlds. Both hold. The "all 32 under 1.25" was never a gate — chasing it now is moving the goalpost after scoring.
- **The metric can't be "finished."** R1 = *loudest event ÷ loudest quiet frame*. Something is always loudest. Each of the last 8 releases removed the loudest event and promoted the next one. The retirement had to die because it was *fake* (invisible, unaudited). A birth or a collision is *real geology happening in one frame* — that's the simulation working, not lying.
- **The 50 kyr cluster is mostly the clock.** Halve the frame step and quiet frames move half as much, while a birth still happens in one frame — so the ratio doubles without any physics changing (13/16 fail at 50 kyr vs 3/16 at 100 kyr, same engine).

## Where we move instead: `0.4.3-draft.md` (written this session)

There is exactly **one real blocker** left before live sync, and it has nothing to do with smoothness:

> When the globe says *"this plate boundary has moved,"* the section redraws the boundary in the right place — but the columns under it **still belong to their old plate**, so from the next frame they're dragged at the wrong speed. (`COUP.apply` repaints edges in `js/coupling.js` but never touches `S.colPlate`.)

The draft scopes that one job — rebuild plate membership at import, reusing the seed's existing rule — with a prove-it fixture first, acceptance written in advance, and explicit non-goals (no live channel, no format change, no R1 work). It's linked from `Roadmap.md` as the next release, and the 0.1.x line is marked **frozen at 0.1.13**. After it, the remaining road is short: agree the return channel with the globe, then the one-page integration. No code was changed this session — only the decision, the plain-language map, and the bounded next plan.