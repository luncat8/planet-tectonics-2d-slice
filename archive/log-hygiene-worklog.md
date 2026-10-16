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

## Second pass (2026-10-16): the verdict as one command

Date: 2026-10-16. Base: 6b83ae0 (the 0.3.2 M4 continuation). Task: 0.3.2 had grown
`experiments/logs/` to 1,068 entries / 37.70 MB and the question was whether the 0.3.2 mass
belongs in the repo at all. The first pass was a manual md5 + grep sweep over a directory a
milestone had just doubled; this pass is `experiments/log-hygiene.js`, so the policy in
AGENTS.md §experiments/logs is a command rather than a recollection, and the next pass costs
one run instead of one session.

### What the tool resolves

A name is a reference in four ways in this tree, and the tool answers all four: a whole path in
a literal (`pt-heat-tail-trace.js`), a directory prefix composed with a call-site literal
(`pt-heat-tail-check.js`'s `read3('timed-subgrid1dep-watch')` against `'logs/0.3.2-M3-'`), a
readdir filter (`m3-log-plot.js`'s `/^0\.3\.2-M3-.*\.(json|txt)$/`), and a name built out of
table legs (`k5-variant-table.js`'s tag/kind/seed/rate, which no single literal spells — the
literals of the reader are matched against the basename with the digit runs folded to a slot,
because a leg's seed and rate are numbers in the source). Documents name a log exactly, as
`...-drift.txt`, or as a glob (`experiments/logs/0.3.0-p3.4-*.txt`, `0.3.2-tail-*`); all three
count, and the glob form is what the first pass resolved by hand.

Beyond names it groups banks by world (the fingerprint) and compares them by *field paths*, not
by the top-level key count: `0.3.2-M3-subgrid1dep-comp.json` has 53 keys against the `--watch`
bank's 59 and is the only bank of world 3546678272699960 carrying `events[].cF`/`events[].cW`,
which is what the dry-solidus percentile table is read from. By key count it looks the poorer
duplicate and is not.

### The verdict

| | files | bytes |
| --- | --- | --- |
| before the pass | 1068 | 37.70 MB |
| keep — a harness reads it, a document names it, or it survives its content/world | 1058 | 37.66 MB |
| go — redundant with no judgement call | 10 | 0.04 MB |
| review — unreferenced, and scratch vs non-regenerable is a reader's call | 0 | 0 |

The directory packs to **6.94 MiB** of the repo's 11.91 MiB pack (5.4x), so a clone carries
roughly a fifth of what the working tree shows; the 37.66 MB is checkout cost, not history cost.

### Why the 0.3.2 mass stays

40 banks hold 32.71 MB and the bytes are the raw record, not summaries of it: `events` 13.95 MB
(every field-supported routing candidate with its own T, field, solidus, host mass, cF and cW)
and `coldPath` 10.03 MB (every new global mantle minimum), then `launches` 1.51 MB and
`timeline` 0.23 MB in `0.3.2-trace-latent.json`, whose runner reproduces only on the M1 tree.
`pt-heat-tail-check.js` re-derives the reports' numbers *from those arrays* — the percentile
table over all 8559 candidates of `subgrid1dep-comp`, the bleed counts (`host < 1e-3`), the
three protected material ids and their frames, the crossings below −0.5 — so thinning a bank
would not only shrink evidence, it would move the numbers the reports quote. Thinning is not a
hygiene option here; it would be a re-measurement, and a weaker one: a check that re-derives a
percentile from the raw array can disagree with its harness, and a check that asserts a
harness-computed constant cannot.

Five worlds hold more than one bank (`--worlds` prints the decision data). None is prunable:
each extra bank is either read by name by a section of the check that asserts a different face
of the same trajectory — the M2 section reads `0.3.2-tail-m2-subgrid1-dep.json` and the M3
section the `--watch` bank of the same world, and the check already bridges the two harness
revisions (`latentAbsMax === undefined ? latentWorstAbs : latentAbsMax`) — or it records a field
the world's richest does not (`gates`, `msFrame`, `value` in the `0.3.2-tail-baseline*` trio
against `0.3.2-trace-latent.json`; `events[].cF`/`cW` in `comp`). The first pass had no world
rule and did not need one: M3's own section pruned its rows to the survivors it names.

### What went and why

| deleted | kept | why |
| --- | --- | --- |
| `0.1.8-r2-gradient-contact-audit-3000-1-50.txt` | `0.1.8-r2-local-gradient8-contact-audit-3000-1-50.txt` | 4.48 vs 4.30 ms/frame is the only difference |
| `0.1.8-r2-gradient-contact-audit-5000-5-50.txt` | `0.1.8-r2-local-gradient8-contact-audit-5000-5-50.txt` | wall clock only |
| `0.2.3-km0.002-3000-1-50.txt` | `0.2.1-contact-audit-3000-1-50-.txt` | wall clock only; the km→0 melt-contact sweep's control leg is the 0.2.1 audit |
| `0.2.3-km0.002-3000-1-100.txt` | `0.2.1-contact-audit-3000-1-100-.txt` | wall clock only |
| `0.2.3-km0.002-5000-5-50.txt` | `0.2.1-contact-audit-5000-5-50-.txt` | wall clock only |
| `0.2.3-km0.002-5000-5-100.txt` | `0.2.1-contact-audit-5000-5-100-.txt` | wall clock only |
| `0.2.4-vb1-tv2-3000-1-50.txt` | `0.2.3-km20-3000-1-50.txt` | 3.31 vs 3.60 ms/frame; the 0.2.4 cadence matrix's control cell *is* the 0.2.3 km20 baseline |
| `0.2.4-vb1-tv2-3000-1-100.txt` | `0.2.3-km20-3000-1-100.txt` | wall clock only |
| `0.2.4-vb1-tv2-5000-5-50.txt` | `0.2.3-km20-5000-5-50.txt` | wall clock only |
| `0.2.4-vb1-tv2-5000-5-100.txt` | `0.2.3-km20-5000-5-100.txt` | wall clock only |

The class is the one the first pass found once by hand (`scratch-flight-verify.txt`): a re-run
whose only difference from a kept run is its wall clock. The fold that finds them blanks the
numbers a time unit follows (`ms/frame`, `ms per pass`, `total 55.6 s`) and nothing else, so a
fingerprint, a gate or a count still separates two runs and stays as the history —
`0.3.2-M2-remelt-melt.txt` differs from `0.3.1-M2-remelt-melt.txt` in its *fingerprint*
(614310596570131 vs 3272872628553735) and is the record that the M2 tree moved the trajectory.
No harness composes the ten deleted names and no document cites them, by name or by glob.

### Validation

- `node experiments/pt-heat-tail-check.js` — exit 0 (M0, M2, M3, M4 and the M4 continuation).
- `node experiments/k5-variant-table.js`, `k5-hold-table.js`, `k5-donor-floor-table.js` — exit 0,
  every row of the tables their worklogs quote still prints.
- `node experiments/m3-log-plot.js` — regenerates `logs/m3-plot-data.json` byte-identical apart
  from `meta.generated`, so the plot's inventory panel is unchanged by the pass.
- `node experiments/acceptance.js` — **ALL PASS (49 checks)**.
- `node experiments/log-hygiene.js` after the pass: 1058 files, keep 1058, go 0, review 0.

### Next step

The tool decides names, content and worlds; it cannot decide whether a bank's *raw arrays* are
worth their bytes, because that is a question about what future re-analysis will ask. If the
checkout cost ever matters more than the re-derivability, the lever is a harness change (bank
the derived readings and a bounded sample instead of every candidate), and it has to be taken
deliberately, per family, with the reports re-quoted — not as hygiene.
