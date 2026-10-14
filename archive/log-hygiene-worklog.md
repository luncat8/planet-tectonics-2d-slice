# Log hygiene: the duplicate pass over all of experiments/logs/

Date: 2026-10-14. Base: f493d60 (the m3-log-plot pick). Task: continue the M3 bank
hygiene (`archive/0.3.2-M3-depletion-worklog.md` §Bank hygiene) across the whole
directory — useless logs and byte-identical duplicates out, every record of a behavior
or performance change stays. 33 files / 0.10 MB went; `experiments/logs/` is 1,040
entries / 28.7 MB (1,039 files plus the `0.3.0-p3.4-review/` snapshot directory).

## Policy

What stays:

- **What a harness reads.** `k5-variant-table.js` parses
  `0.1.11-{base,v1,v1e,v2a,v2b}-*`, `k5-hold-table.js` `0.1.10-{base,narrow}-*`,
  `k5-donor-floor-table.js` the five 0.1.8/0.1.9 trees, `pt-heat-tail-check.js`
  `0.3.2-tail-*` and `0.3.2-M3-*`, `pt-heat-tail-trace.js`
  `0.3.2-tail-baseline-repeat.json`. Their byte-identical cross-tag files are
  load-bearing: each name is one table row's source, and the identical probes are the
  reproduction the 0.1.11 worklog quotes ("probes are byte-identical"). 42 groups stay
  whole for this reason — deleting one makes a report's table stop re-deriving.
- **What a document names** (exact basename, or the ellipsis form `...-drift.txt`).
- **`0.3.0-p3.4-review/` as a whole** — the frozen pre-change verification of the P3.4
  claims (`0.3.0-p3.5-report.md`). Its four files byte-identical to the outer
  `0.3.0-p3.4-*` logs stay as part of the snapshot; the other ten are the P3.5 change
  record itself (they differ from the outer logs).
- **Every other distinct-content log.** The older `.txt` era is one file per run, and
  where two runs differ, the difference is the history: bench ms, gate numbers, probe
  verdicts. `pt-drift` alone records three behavior changes — `0.3.0-p2.3b`/`p3.0`,
  `p3.1`, `p3.2`/`p3.3` and `p3.4`→`p4.0` are four distinct outputs, and all four
  anchors stay.

What goes: byte-identical copies that no harness and no document points at — one
representative per content stays (the name a document cites, else the earliest
milestone name, so the surviving series shows where a behavior first appeared) — plus
one scratch re-run. The identity map below keeps every deleted name resolvable.

## What went and why

| deleted | byte-identical to kept | why that name stays |
| --- | --- | --- |
| `0.1.0-view-check.txt`, `0.1.5-view-check.txt`, `0.1.7-view-check.txt`, `0.4.1-view-check.txt` | `0.2.0-m5-view-check.txt` | the name the m5 suite table quotes |
| `0.1.0-scale-check.txt`, `0.1.5-scale-check.txt` | `0.2.0-m5-scale-check.txt` | m5 suite table |
| `0.1.0-section-check.txt`, `0.1.5-section-check.txt` | `0.2.0-m5-section-check.txt` | m5 suite table |
| `0.1.7-pt-ui.txt`, `0.4.1-pt-ui.txt` | `0.2.0-m5-pt-ui.txt` + `0.3.0-index-entry-ui.txt` | two documents name one copy each; both kept |
| `0.2.0-m2-edifice-bench.txt` | `0.2.0-m5-edifice-bench.txt` | m5 suite table |
| `0.2.0-m2-vent-bench.txt` | `0.2.0-m5-vent-bench.txt` | m5 suite table |
| `0.4.1-coupling-link.txt` | `0.2.0-m5-coupling-link.txt` | m5 suite table |
| `0.4.1-deposits.txt` | `0.2.0-m5-deposits.txt` | m5 suite table |
| `0.4.1-port-check.txt` | `0.2.0-m5-port-check.txt` | m5 suite table |
| `0.3.2-M2-pt-ui.txt` | `0.3.2-pt-ui.txt` | the name the M0 worklog quotes |
| `0.3.2-M2-tail-baseline.txt` | `0.3.2-tail-m2-baseline.json` | the bank `pt-heat-tail-check.js` reads; the `.txt` was a byte-identical stdout twin of the json |
| `0.2.4-cone-vb1-tv2.txt` | `0.2.3-cone-km20.txt` | earliest; the 0.2.4 cadence matrix's control cell reproduces the 0.2.3 km20 baseline bitwise |
| `0.3.0-p3.0-pt-drift.txt` | `0.3.0-p2.3b-drift.txt` | cited as `...-drift.txt` in the p2.3b worklog |
| `0.3.0-p3.1-pt-asymmetry-check.txt`, `0.3.0-p3.2-pt-asymmetry-check.txt` | `0.3.0-p3.0-pt-asymmetry-check.txt` | earliest of that output |
| `0.3.0-p3.3-pt-crust.txt` | `0.3.0-p3.2-pt-crust.txt` | earliest of that output |
| `0.3.0-p3.3-pt-drift.txt` | `0.3.0-p3.2-pt-drift.txt` | earliest of that output |
| `0.3.0-p3.5-pt-crust.txt`, `0.3.0-p4.0-base-pt-crust.txt` | `0.3.0-p3.4-pt-crust.txt` (also in the review snapshot) | earliest of that output |
| `0.3.0-p3.5-pt-drift.txt`, `0.3.0-p4.0-base-pt-drift.txt` | `0.3.0-p3.4-pt-drift.txt` (also in the review snapshot) | earliest of that output |
| `0.3.0-p3.5-pt-stability.txt`, `0.3.0-p4.0-base-pt-stability.txt` | `0.3.0-p3.4-pt-stability.txt` (also in the review snapshot) | earliest of that output |
| `0.3.0-p3.5-pt-ui.txt`, `0.3.0-p4.0-base-pt-ui.txt` | `0.3.0-p3.4-pt-ui.txt` (also in the review snapshot) | earliest of that output |
| `0.1.9-r4-check.txt` | `0.1.8-m3-r4-1-50.txt` | earliest; keeps the m3 R4 four-leg family whole |
| `scratch-flight-verify.txt` | `0.3.2-M2-pt-p3-flight.txt` | scratch re-run; differs only in the harness wall time (7.3 s vs 6.7 s) and an `exit 0` marker |

## Kept despite being byte-identical

- the 42 tool-read sweep groups above (`k5-*table.js`, `pt-heat-tail-check.js`);
- the four `0.3.0-p3.4-review/` copies of the outer p3.4 logs (snapshot integrity);
- three pairs where two documents each name one copy: `0.2.0-m3-ore-ui.txt` +
  `0.2.0-m5-ore-ui.txt` (m3 + m5 worklogs), `0.2.0-m5-slice-cut.txt` +
  `0.4.1-slice-cut.txt` (m5 suite table + the 0.4.1 slice-cut report),
  `0.2.0-m5-pt-ui.txt` + `0.3.0-index-entry-ui.txt` (m5 worklog + the index-entry review).

## Validation

- md5 over the directory: every remaining exact-duplicate group is one of the keepers
  above — nothing redundant is left outside the deliberate keep-whole sets.
- `pt-heat-tail-check.js` passes (M0, M2 and M3 sections all find their banks);
  `k5-variant-table.js`, `k5-hold-table.js` and `k5-donor-floor-table.js` still print
  every row of the tables their worklogs quote.
- No path in `js/`, `experiments/*.js` or `port/` reads a deleted file.
