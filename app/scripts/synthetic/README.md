# Synthetic fleet history generator (feature 007)

Spec: [`specs/007-synthetic-data/spec.md`](../../../specs/007-synthetic-data/spec.md). Inputs:
[`data/synthetic/`](../../../data/synthetic/README.md). Output: `migration/synthetic/<profile>/`
plus `migration/reports/07_synthetic_<profile>_report.md`.

Everything generated is fictional and marked as such in every row (FR-005). The real migrated
dataset in `migration/staged/` stays the app's default (FR-008).

## Run

From `app/`, with the portable Node set up per `specs/AGENT-BRIEF.md` §1:

```bash
npm run synthetic                       # standard profile: ~1,150 active assets, 20 years, 5 years detail
npm run synthetic -- --profile demo     # quarter-size fleet for a browser session
npm run synthetic -- --profile large    # 4.5x — 5,000+ active assets, for 006's SC-010
npm run synthetic -- --check-determinism   # generates twice, compares every file (FR-052)
```

Parameters (FR-053): `--seed`, `--as-of YYYY-MM-DD` (default: today), `--history-years 20`,
`--detail-years 5`, `--deep-rate 0.4`, `--scale`, `--out`.

Then load it into the app instead of the real data:

```bash
AMS_DATASET=synthetic/standard node scripts/copy-staged-data.mjs
```

and start the dev server as usual. The app shows a persistent "synthetic data" banner while a
dataset with a manifest is loaded (FR-007). Run the copy step without the variable to go back to
the real migrated data.

## How it works

| File | Role |
|---|---|
| `generate.ts` | CLI: run the simulation, build the answer key, verify, write, report |
| `lib/sim.ts` | The event model: a day loop that enqueues what the fictional company does (buy, audit, calibrate, start jobs, retire, plant scenarios) and drains events in timestamp order |
| `lib/ledger.ts` | Every row, written only through `domain/deriveState` — a re-statement of `api/mock/store.ts`'s write path with indexed relationships and deterministic ids |
| `lib/answerKey.ts` | Expected answers to the seven acceptance questions from the sim's own account |
| `lib/verify.ts` | Every spec invariant, plus reconciliation of the answer key through `domain/pointInTime`, `domain/installation` and `api/mock/reporting` |
| `lib/output.ts` | Staged-shape JSON, Power BI CSVs, manifest, report |
| `lib/rng.ts`, `lib/ids.ts`, `lib/time.ts`, `lib/config.ts` | Seeded randomness, uuid5 ids, Toronto↔UTC with DST, inputs and parameters |
| `authoring/make-roster.ts` | Regenerates `data/synthetic/roster.json` from the name pools |

The generator never decides what a status becomes: it decides that a technician checks a kit out,
and `deriveState` — the same function the app calls — decides the consequences (Principle I). The
verifier then replays every asset through `pointInTime.stateAsOf` and requires the replay to
reproduce the generated state for 100% of assets (SC-004). A failed check exits non-zero and marks
the manifest `verified: false`; the copy step refuses such a dataset.
