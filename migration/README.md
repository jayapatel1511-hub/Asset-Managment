# migration

Python 3.12 + pandas (CLAUDE.md specifies 3.11; only 3.12 was available in this environment — no
behavioural difference for what these scripts use). One script per step, each idempotent, each
writing `reports/<step>_*.md`.

```bash
python 01_profile.py                 # verify the source export against the committed baseline
python 02_clean.py                   # clean, dedupe, resolve — writes staged/assets_clean.json
python 03_models.py                  # build the equipment-model catalogue, gate on FR-009/FR-010
python 04_load.py --env dev|prod     # assemble locations/projects/assets/transactions/lines
python 05_calibrations.py            # match the 253 calibration rows, set lastcaldate/nextcaldue
```

Run in order; each reads the previous step's `staged/` output. All five are re-run-safe — see
`reports/01_profile_report.md` onward, and each report states its own idempotency where relevant.

**Output**: `migration/staged/*.json`, one file per `eng_*` table (plain field names, matching
`app/src/api/types.ts` — not Dataverse's `eng_` column names; see `03_models.py`'s header for why
that distinction matters). This is what `app/src/api/mock/store.ts` loads; there is no Dataverse
in this build to load it into instead (see `docs/09-build-report.md`).

**Reports** (`migration/reports/`): every judgement call this run made, per FR-024. Read
`02_conflicts.md` before any production load — it is the FR-026 sign-off gate — and
`02_sweep_checklist.md` for the Q3 pilot return sweep. `03_models_review.md` is a one-time
artifact: the full old→new diff of the Q4 equipment-model catalogue correction, not part of the
repeatable pipeline.
