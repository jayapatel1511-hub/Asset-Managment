# 04 — Migration

Inputs (read-only): `data/source/registry_2026-09-02.csv` (1,053 rows), `data/source/calibration_history_2026-09-02.csv` (253 rows).
Output: reference CSVs loaded first, then `eng_asset` rows, then one `AddToInventory` transaction per office
with a line per asset (so day-one state has a history entry), then calibration records.

Python 3.11 + pandas. One script per step, each idempotent, each writes `migration/reports/<step>_report.md`.

## 01_profile.py
Re-run the profile in `00-brief.md` and fail loudly if counts differ from the committed baseline
(protects against someone re-exporting a changed sheet mid-migration).

## 02_clean.py — registry

Column map (source → target):

| Source | Target | Rule |
|---|---|---|
| Asset ID | eng_assetid | trim, upper. Blank or ends with `-` → `TMP-{seq}`; keep original in eng_migrationsource |
| Asset Group | model.assetgroup → **`eng_category` root** | fix `Air Quailty Monitroing` → AirQuality. *(See the note below — 2026-09-03)* |
| Equipment Type | model.equipmenttype → **`eng_category` leaf** | fix `Geohpone` → Geophone; `Microphone, Sound Level Meter` → split by model (S50/C50 → SoundLevelMeter; SLM/Micromate mic → Microphone) |

> **Categories became rows on 2026-09-03** (`docs/01-data-model.md` § eng_category). Asset group and
> equipment type are no longer option sets, so `eng_equipmentmodel` carries **one lookup to the leaf
> category** instead of two Choice columns.
>
> **The cleaning stages do not change.** `02_clean.py` and `03_models.py` keep emitting flat
> `assetgroup` / `equipmenttype` strings into the staged CSVs — that shape is what the mock backend and
> 1,459 synthetic assets already read, and breaking it would break the local build for no gain. What
> changes is one **new step** that derives the two-level category tree from the distinct staged values
> and resolves each model to its leaf, plus the loader writing the lookup instead of two choices.
> Idempotent and reporting counts, like every other step. This is WS-L work, not done yet.
| Manufacturer / Model | model lookup | via `data/reference/equipment_models.csv` `source_manufacturer`,`source_model` → canonical. Rows with manufacturer ∈ {Minimate Pro, Series IV, Settop M1, Instantel(as model)} are swapped columns — handled by the mapping file, not code |
| Serial Number | eng_serialnumber | trim; strip embedded prefix letters into a check: `UM16984` → serial `UM16984` (keep as-is; ID minting strips) |
| Current Office | eng_homeoffice AND eng_currentlocation | map via `data/reference/locations.csv`. `SWO` stays SWO (office) — see open Q1 |
| Availability Status | eng_status | `Available`→Available; `Deployed or NOT Available`/`Deployed`→**CheckedOut** (we do not know the site; Deploy later); `Needs Repair / Calibration`→NeedsRepair; blank→Available if lifecycle Active, else Retired |
| Lifecycle Status | eng_lifecycle | blank → Active |
| Staff | eng_custodian | resolve by display name against systemuser; unresolved → note, leave null, list in report |
| Project ID / Project Name | eng_currentproject | create eng_project rows for distinct IDs |
| Carrier, SIM ICCID, Phone Number, Static IP | carrier, identifiervalue, phonenumber, staticip | SIMs only |
| Notes | eng_notes | |
| Login, Password | — | **dropped** at export; must not appear anywhere |
| Location Type…Element Serial (100% empty) | — | dropped |

Duplicate handling:
1. Exact duplicate rows (same Asset ID, same office) → keep one.
2. Same Asset ID, different office (8 pairs) → keep one row; homeoffice = the office with the more recent
   calibration row if any, else the first listed; write both to `reports/02_conflicts.md` for Jay to confirm.
3. Same serial + same type + different Asset ID → flag, do not auto-merge.
4. DST IDs reused (11) → keep row with ICCID; the other gets `TMP-`.
5. Shared serial across types (132) → **not a duplicate**; expected.

## 03_models.py
Build `eng_equipmentmodel` rows from `data/reference/equipment_models.csv`. Fail if any registry row has no mapping.

## 04_load.py --env dev|prod
Order: locations → models → projects → assets → AddToInventory transactions+lines (one txn per office,
performedby = svc-ams, date = migration date) → calibration records. Use Dataverse Web API `$batch`, 100 per batch,
upsert on alternate keys so re-runs are safe. Write ids back to `reports/04_loaded_ids.csv`.

## 05_calibrations.py
Match calibration rows to assets: the unlabelled column is the serial. Join on serial + model family
(`Micromate`→DL-UM or GEO-UM — **ambiguous**; default to the Data Logger, flag in report; `S50`→SLM-S50; `V12`/`C22`→GEO-…; `D10`/`D10 Micro`→DL-D10).
Rows with `N/A`, `#VALUE!`, 1900 dates → skip with reason. Unmatched → `reports/05_unmatched_calibrations.md`.
For matched: create eng_calibrationrecord (lab = Montreal Calibration unless noted), let F2 set asset dates —
or, during bulk load, set lastcaldate/nextcaldue directly with flows paused, then re-enable.

## Acceptance
- 0 blank Asset IDs; 0 duplicate Asset IDs; every asset has a model, home office, lifecycle, status.
- `reports/` lists every judgement call. Jay signs off on `02_conflicts.md` before Prod load.
