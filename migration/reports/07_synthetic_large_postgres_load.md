# 07 — Synthetic large profile: PostgreSQL scale load

Run 2026-09-03 against the containerised PostgreSQL 17.11 in `docker-compose.yml`. Specs:
`specs/007-synthetic-data/spec.md` (FR-052, FR-056), `specs/REMAINING-WORK.md` § WS-W11 and
§ WS-W12, `CLAUDE.md` rule 12.

**Result: PASS, with one finding against the *real* staged dataset** (§ 8 — it does not reload
reproducibly, and the synthetic profiles hide it).

This is the first measured scale evidence for the PostgreSQL load path. It is evidence for
**API Implemented** only. Nothing here is Azure Integrated: the database is a local container on
loopback, not Azure Database for PostgreSQL Flexible Server.

Every row loaded is fictional. Nothing in it describes a real asset, person, project or site.
See `data/synthetic/README.md`.

## Environment

| Component | Version |
|---|---|
| PostgreSQL | 17.11 on aarch64-unknown-linux-musl (Alpine), `postgres:17.11-alpine` |
| Container | `ams-postgres`, `127.0.0.1:5433`, `max_connections=200` |
| Driver | `server/src/db/postgres.ts` — `pg` 8.23.0 Pool, `AMS_DB=postgres` (default) |
| Node | v26.8.1 · npm 11.19.0 |
| Host | macOS 26.6.2, 14 cores, 36 GB, Docker 29.7.2 |

---

## 1. Regeneration — what "byte-identical" actually covers

FR-052 says the same seed and parameters must produce a byte-identical dataset, answer key and
manifest. The manifest cannot satisfy that literally: `buildManifest` stamps a fresh
`generatedAt` on every run (`app/scripts/synthetic/lib/output.ts`). So the testable claim is:

> **every emitted file is byte-identical run to run, and `manifest.json` is byte-identical except
> for its `generatedAt` timestamp.**

That is the claim tested here, and it holds for all three profiles.

Two things had to be got right before any of this reconciles:

- `--as-of` defaults to *today*, not to the manifest's date. The committed manifests were
  generated with `asOf 2026-09-02`; regenerating on 2026-09-03 without `--as-of 2026-09-02`
  produces a different, equally valid dataset. Every command below passes it explicitly.
- `writeDataset` deletes the output directory before writing, so a regeneration replaces the
  committed `manifest.json` in the working tree.

```bash
cd app
npm run synthetic -- --profile demo     --as-of 2026-09-02 --check-determinism
npm run synthetic -- --profile standard --as-of 2026-09-02 --check-determinism
npm run synthetic -- --profile large    --as-of 2026-09-02
```

### 1a. Run-to-run, two separate processes

Each profile was generated twice — once to `migration/synthetic/<profile>/`, once to a scratch
directory via `--out` — and the two trees compared by `sha256` per file, not by `diff` alone.

| Profile | Files emitted | Byte-identical | Differing | Difference |
|---|---|---|---|---|
| demo | 24 | 23 | `manifest.json` | `generatedAt` only |
| standard | 24 | 23 | `manifest.json` | `generatedAt` only |
| large | 24 | 23 | `manifest.json` | `generatedAt` only |

24 files = 13 dataset/answer-key JSON files + `manifest.json` + 10 Power BI CSVs. The `powerbi/`
CSVs are included in that count and are identical.

The large profile's 23 identical files, by `sha256`:

```text
59196402704403de52ab00a7491d018353a673baa8441b4efa79ee6f32950826  answer_key.json
ea251e5557306a4ade811e8750ab4629f01d74b00cfea80bdc056cd1f35e61e6  assetrelationships.json
9d557f38e101bfab9673ff20abe102af07144e7539efc721fc8e907401254230  assets.json
6e63e764c3956fb0510c09c387531d1a0d2b9659be9b3914afc130505a39bcd1  calibrationrecords.json
1b0a083052a4ebbef848fdaedc740386885df59285efedde9af9a10568243b68  equipment_models.json
82617173a5457223c9070c45d4c75e24488356fa614b8dc3f983a7e0d5e454c9  idsequence.json
4ca6087d4abf4f2fa60c4dc15d2fcd4f1ba2d74847029a63545a06022801c960  installationcomponents.json
4a3cf7cb7d830166146289ca4e141575168cdcb7628561014f74b2d67c47a39f  installations.json
1c11516b542344eb3f121d1640a1af1d97933da5d84cb816e58014b218357b08  locations.json
d68fc6fac091683df76b7dab28e578cf088a6c238b48605e3832032607474854  officeadminassignments.json
b5dc0511fcdacde5e444598ecf3bb9a7f15ea424bda21f5cbf89fe91aa43b7b9  projects.json
d7999e21e5aeda605e67ba569061c86debf790e5a7cc41f220be27d7195cea66  transactionlines.json
b61c12ff8d8e7fa26cf3fcc63e606f34f24e3589fda819f4b20334c73b5bca00  transactions.json
3cab973cfa4771e67747eb9c08559571d2d8f14ee8c4dc07d057232f35446b95  powerbi/Asset.csv
9eee32db328bb44260c6f6829cf8b466526d91a68b026a3e0da8e79518bc5ce0  powerbi/AssetRelationship.csv
d2fe5a4641131361b1f41ee6a6123bc1eeff4dd322aacc78e481a664d3815317  powerbi/CalibrationRecord.csv
76b2ed51739099dcfdf3e88d30144182fe7f62a10414c096e399f8a8c31eee5a  powerbi/EquipmentModel.csv
8906243154a31e53c0ea49488495057b43c79e36292d7029f57a685befb3f769  powerbi/Installation.csv
65fba589722dddffb6481fcc56e5f2cd3dabe610bcf6c86ca1fc97cd18bc0c04  powerbi/InstallationComponent.csv
ee78ac2aa88f870bc5fa6e9899c7b5dc40282591a82ec10e184cd4a957c6cbaa  powerbi/Location.csv
be669ea17a18213d7650420d975a0a13312814828f80b001457fc40ca91a5d45  powerbi/Project.csv
8403dea7cb024d71bd230587763bbd1f6fb4487555c9a1f1143d85ce5f154013  powerbi/Transaction.csv
49f4695cd62e8f17963e6f56107f6645a796503cbf480582fcdc7ac3d6d8790e  powerbi/TransactionLine.csv
```

and the whole of the difference:

```diff
16c16
<   "generatedAt": "2026-09-03T22:51:54.142Z",
---
>   "generatedAt": "2026-09-03T22:56:46.294Z",
```

### 1b. Against the committed manifests

The regenerated manifest was compared with the manifest committed at HEAD (`285f2d6`). For all three
profiles the diff is one line — `generatedAt`. Every `counts` entry, the `inputsHash`
(`4676d3426fcd4cb9`), the `params` block, the `markers`, the 16 `planted` scenarios and the
`files` list are identical. The counts in the task brief reconcile exactly.

### 1c. The generator's own FR-052 check

`--check-determinism` generates twice in-process and compares:

```text
[PASS] FR-052   Two generations with the same seed and parameters are byte-identical — all 13 files identical
```

Note the scope: **13 files**, the serialised dataset only. It does not compare `manifest.json`
or the 10 Power BI CSVs. The 24-file comparison in § 1a is the wider check and is the one this
report relies on.

### 1d. Generation cost on this machine

| Profile | Simulation | Total (generate + verify + write) | Output size |
|---|---|---|---|
| demo | — | 3.3 s (incl. the in-process second run) | 22 MB |
| standard | — | 10.7 s (incl. the in-process second run) | 88 MB |
| large | 18.6 s | 175.8 s | 418 MB |

The committed `07_synthetic_large_report.md` recorded 1174.0 s for the same work. The difference
is hardware, not behaviour: the outputs are byte-identical. Verification, not simulation, is
where the large profile's time goes — 18.6 s to simulate 438,619 lines, ~157 s to check them.

---

## 2. Load into PostgreSQL

`AMS_DATASET` does **not** map to a separate database on PostgreSQL. It selects a directory under
`migration/`; the PGlite driver gives each dataset its own directory under `server/data/`, but
PostgreSQL has one database and the loader **reseeds it in place**, protected only by the dataset
key (`server/src/db/open.ts`, `server/README.md` § Dataset selection and reseeding). The load
below therefore replaces the whole contents of the default `ams` database. It does not touch the
`ams_test_*` databases that `createTestDatabase` makes and drops per test file.

```bash
cd server && AMS_DATASET=synthetic/large npm run reseed
```

| Load | Wall clock | Node CPU | Notes |
|---|---|---|---|
| 1 | **15.465 s** | 2.81 s user | into an empty `ams` |
| 2 | **14.774 s** | 2.50 s user | over load 1 |
| 3 | **15.342 s** | 2.83 s user | over an intervening `staged` load |

**921,924 rows in one database transaction, in ~15 s — about 61,000 rows/second end to end**,
including process start, schema apply and JSON parsing.

Where the 15 s goes: reading and parsing all 12 dataset files — 296.3 MiB of JSON — takes
**0.48 s**, and `tsx` start-up plus the idempotent `schema.sql` apply is well under a second. The
remaining ~13–14 s is the database transaction itself.

Two further timings for scale context:

- `synthetic/standard` (193,497 rows): **4.290 s**.
- The real `staged` dataset (1,026 assets): **0.517 s**.
- A start against an already-seeded database, same dataset key, no `--reseed`: **0.371 s**,
  logging `"seeded":false, "database already seeded — local writes preserved"`. Seed idempotency
  by dataset key holds on PostgreSQL.

### 2a. The loader needed no change

`insertRows` (`server/src/db/rows.ts`) chunks at 200 rows per `INSERT`. Both predicted failure
modes were checked and neither is real at this scale:

**Bind-parameter cap.** PostgreSQL allows 65,535 parameters per statement. The widest table is
`asset` at 22 columns:

| Columns | Bind params per 200-row INSERT | % of the 65,535 cap |
|---|---|---|
| 22 (`asset`) | 4,400 | 6.7% |
| 16 (`asset_transaction`, `installation`) | 3,200 | 4.9% |
| 12 (`asset_transaction_line`) | 2,400 | 3.7% |

At 22 columns the cap would first bite at a chunk size of 2,978. There is a 14.9× margin.

**Round trips.** The large profile needs 4,616 multi-row `INSERT`s — 2,194 of them for
`asset_transaction_line` alone — plus 10 single-row inserts, one `TRUNCATE`, one `setval` and
three `meta` writes, all inside one transaction. That is ~3 ms per statement over loopback,
which is fast enough that raising the chunk size or moving to `COPY` would be optimising
something that is not a problem. **`seed.ts` and `rows.ts` are unchanged by this work.**

The honest caveat: 3 ms per round trip is a loopback figure. Against Azure Database for
PostgreSQL Flexible Server across a network, 4,631 round trips is where this arithmetic stops
being comfortable, and `COPY` or a much larger chunk becomes worth measuring. That measurement
does not exist yet.

### 2b. Row counts reconcile to the manifest

| Manifest count | Manifest | Database | Table |
|---|---|---|---|
| assets | 6,626 | **6,626** | `asset` |
| activeAssets | 5,312 | **5,312** | `asset` where `lifecycle <> 'Retired'` |
| transactions | 295,355 | **295,355** | `asset_transaction` |
| transactionLines | 438,619 | **438,619** | `asset_transaction_line` |
| relationships | 26,372 | **26,372** | `asset_relationship` |
| installations | 39,838 | **39,838** | `installation` |
| installationComponents | 65,550 | **65,550** | `installation_component` |
| calibrationRecords | 34,914 | **34,914** | `calibration_record` |
| projects | 2,501 | **2,501** | `project` |
| sites | 12,069 | **12,069** | `location` where `locationtype = 'Site'` |

Tables the manifest does not count: `equipment_model` 52, `location` 12,082, `id_sequence` 5,
`office_admin_assignment` 10, `command_idempotency` 0. `location` is 12,082 rather than 12,069
because the site rows sit under 10 Office, 1 Region, 1 CalLab and 1 Storage row.
`transaction_name_seq` is left at 295,355, `is_called = true`, so the next human transaction
number continues the history rather than colliding with it.

**WS-W12's scale target is met by this profile alone**: 5,312 active assets against a target of
5,000, and 438,619 transaction lines against a target of 100,000 — 4.4× the line target.

---

## 3. Synthetic provenance survives the loader — `CLAUDE.md` rule 12

The manifest declares five markers. Each was checked by SQL against the loaded rows, counting
marked *and* unmarked so an absent marker could not hide in a percentage.

| Table.column | Marker | Rows | Marked | **Unmarked** |
|---|---|---|---|---|
| `asset.migrationsource` | `SYNTHETIC seed=englobe-ams-007%` | 6,626 | 6,626 | **0** |
| `asset_transaction.notes` | `[SYNTHETIC s=englobe-ams-007]%` | 295,355 | 295,355 | **0** |
| `project.projectnumber` | `09%` | 2,501 | 2,501 | **0** |
| `calibration_record.certificatenumber` | `SYN-%` | 34,914 | 34,914 | **0** |
| `location.note` (`locationtype = 'Site'`) | `SYNTHETIC seed=englobe-ams-007%` | 12,069 | 12,069 | **0** |

**Every marker survives on every row. Nothing was stripped on the way in.** Samples as stored:

```text
asset.migrationsource               SYNTHETIC seed=englobe-ams-007 profile=large
asset_transaction.notes             [SYNTHETIC s=englobe-ams-007] Registered in the as…
location.note                       SYNTHETIC seed=englobe-ams-007
calibration_record.certificate      SYN-FACTORY-000001
project.projectnumber               09000001
```

The dataset's provenance is also recorded in `meta`, independently of the row markers:

```text
dataset_key  = synthetic:englobe-ams-007:large:2026-09-03T22:51:54.142Z
dataset_info = {"synthetic":true,"seed":"englobe-ams-007","profile":"large",…,"verified":true,…}
```

---

## 4. FR-056 — a `verified: false` manifest is refused, against PostgreSQL

Tested on a throwaway copy. `migration/synthetic/fr056-probe/` was created containing **only** a
copy of the demo manifest with `verified` flipped to `false` — no data files, because the refusal
must fire on the manifest alone.

| Probe | `verified` | Exit | Message |
|---|---|---|---|
| refusal | `false` | **1** | `Refusing to load …/fr056-probe: its manifest says verified: false — the generator's own checks failed (feature 007 FR-056).` |
| control | `true` | 1 | `assets.json not found in …/fr056-probe. For the real data run the migration pipeline…` |

The control matters: with the flag flipped back to `true` the loader gets *past* the refusal and
fails later, on the missing data file. The refusal is caused by the flag, not by the empty
directory.

**Neither attempt wrote anything.** The 13-table content hash taken after both attempts is
identical to the hash taken before them, and `meta.seeded_at` is unchanged. The refusal happens
before `db.transaction()` is entered.

The probe directory was deleted and the restore verified: `migration/synthetic/fr056-probe` no
longer exists, all three real manifests still read `verified: true`, and `git status
migration/` shows no untracked file.

---

## 5. Reproducibility — the second-load diff

WS-W11 asks for a "second-run empty business diff". Row counts are weak evidence for that, so
this is a content comparison.

**"Business data" here means:** every row of all 13 business tables — `asset`,
`asset_relationship`, `asset_transaction`, `asset_transaction_line`, `calibration_record`,
`command_idempotency`, `equipment_model`, `id_sequence`, `installation`,
`installation_component`, `location`, `office_admin_assignment`, `project` — with **every
column** included, `row_version` and the loader-derived `line_number` and `recorded_at` among
them. Each row is hashed as `md5(t::text)` and a table's hash is the md5 of its row hashes
concatenated in sorted order, which makes it a multiset hash: order-independent, but sensitive to
any changed, added, dropped or duplicated row.

**Excluded:** the `meta` table, deliberately. It holds `seeded_at` (a wall-clock stamp, different
on every load) and `dataset_key` (which embeds the manifest's `generatedAt`). Neither is business
data. `meta` was inspected separately and behaved exactly as expected — `seeded_at` moved from
`22:52:38.084Z` to `22:53:55.592Z` between loads; `dataset_key` and `dataset_info` did not change.

**Result: empty diff.** All 13 tables, identical row counts and identical content hashes across
three loads — including load 3, which followed an intervening load of a *different* dataset, so
the `TRUNCATE`-and-reload path is covered too.

| Table | Rows | Content md5 (loads 1, 2 and 3) |
|---|---|---|
| `asset` | 6,626 | `3ed35c74377ee1ff7e9417f4ffd375d0` |
| `asset_relationship` | 26,372 | `17dac68ae2db88c089548dfba5c41b22` |
| `asset_transaction` | 295,355 | `61f3437e6a2e6da9b42ad2ff5373dced` |
| `asset_transaction_line` | 438,619 | `9440040ed8ea71212dd198d72f39bd71` |
| `calibration_record` | 34,914 | `ae9bad7d5b9666147c74921e448da13e` |
| `command_idempotency` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `equipment_model` | 52 | `9a8c90156e1cc0cf1d6933d2e58ebe19` |
| `id_sequence` | 5 | `2d6183faedb6b594a9f7cea9e58ae181` |
| `installation` | 39,838 | `629f459697aa3133c6211bb1470ed9e3` |
| `installation_component` | 65,550 | `30d9e62592e7ef888b88b70262a8ae26` |
| `location` | 12,082 | `5435fd1791f10d97dbe75d58cd1b2917` |
| `office_admin_assignment` | 10 | `876dd1dc5c7793a8e52aee90c302ccee` |
| `project` | 2,501 | `b340d2bb3934c07d373b9bedf6f38d38` |

**What this diff does not cover.** It compares the database against itself across loads. It says
nothing about whether the database agrees with the JSON it came from — a loader that consistently
dropped a column would produce a stable hash and pass this test. § 6 is the check for that, and
it is a census, not a full field-by-field comparison. Nor does it cover sequences (checked
separately), server-side defaults not exercised by the seed path, or anything about query results
built on top of these rows.

---

## 6. Fidelity — did the loader keep every field?

A non-null census per column, source JSON versus database, for the three widest tables. A dropped
or mismapped column shows up immediately as a zero or a shifted count.

| Table | Columns compared | Mismatches |
|---|---|---|
| `asset` | 22 | **0** |
| `asset_transaction_line` | 9 | **0** |
| `asset_transaction` | 11 | **0** |

Every count agrees: `asset.custodian` 386, `asset.parentasset` 1,907, `asset.staticip` 528,
`asset.identifiervalue` 1,333, `asset_transaction_line.orientation` 22,692,
`asset_transaction.expectedreturn` 33,745, and so on through all 42 columns.
`asset_transaction.recorded_at` is 295,355 non-null because the loader sets it to
`transactiondate` — by design (`seed.ts`, `headerToValues(h, null, h.transactiondate)`), and the
one column in the census with no source counterpart.

This is a census, not an equality proof. It would not catch two columns swapped between fields
with the same non-null count.

---

## 7. Regression — the existing suite, both drivers

Neither `seed.ts` nor `rows.ts` was changed, so this confirms the tree is green rather than
proving a change safe.

```text
AMS_DB=postgres    Test Files  5 passed (5)    Tests  64 passed (64)    Duration  777ms
AMS_DB=pglite      Test Files  5 passed (5)    Tests  64 passed (64)    Duration  1.93s
```

Those tests seed `migration/staged/` into throwaway databases. **No test exercises the large
profile.** The scale evidence in this report comes from the load path, not from the test suite.

---

## 8. Finding — the *real* staged dataset does not reload reproducibly

WS-W11 requires a "second-run empty business diff" for the migration loader. The synthetic
profiles pass it (§ 5). The real dataset does not, and the synthetic profiles hide the reason.

`server/src/db/seed.ts` mints a calibration-record id when the source has none:

```ts
calibrations.map((c) => calibrationToValues({ ...c, id: c.id ?? randomUUID() }))
```

- All 34,914 synthetic calibration records carry a deterministic uuid5 `id`, so the fallback never
  fires and the hash is stable.
- All 164 records in `migration/staged/calibrationrecords.json` have **no `id` field at all**, so
  the fallback fires for every one of them.

Demonstrated, not inferred. `migration/staged/` was loaded twice into a scratch database
(`ams_repro_probe`, created and dropped for the purpose):

```text
12 of 13 tables      identical content hashes
calibration_record   164 rows both times
                     load 1  a7f099678abe3a10e45b5a0fac0974dd
                     load 2  52710de7b2d0fa62a899954d9d991f0b
```

Every calibration record gets a fresh random primary key on every load. Consequences: the
second-run empty business diff fails on the real data; a document, correction or quality issue
referencing a calibration record by id would be orphaned by a reload; and source-row traceability
does not survive a reseed.

**Not fixed here, deliberately.** Choosing how a calibration record's identity is derived is a
change to the identity model, which `CLAUDE.md` § Ask before doing reserves for Jay. The options
are a deterministic key derived from `(asset, calibrationdate, nextduedate, certificatenumber,
source_row)`, or minting ids once in the migration pipeline and committing them to
`migration/staged/calibrationrecords.json` so the loader has nothing to invent. Either belongs in
`docs/08-decisions.md` before it is applied.

---

## 9. What this does not prove

- **Nothing about Azure.** Local container, loopback, Docker Desktop on Apple Silicon. No Azure
  Database for PostgreSQL Flexible Server, no network latency, no storage tier, no connection
  limit, no failover.
- **Nothing about read performance.** WS-W12 asks for report performance at scale. Not a single
  query was timed against the 438,619 loaded lines, and no `ANALYZE` was run after the bulk load,
  so the planner statistics were left to autovacuum.
- **Nothing about concurrency.** No transaction ran against this data. The five-asset race and
  the overlapping-load target are separate work.
- **Nothing about the real data at scale.** The real migrated dataset is 1,026 assets. This is a
  6,626-asset fiction with the real fleet's shape, not the real fleet.
- **Nothing about PGlite at this scale.** Only the `postgres` driver was loaded with `large`.
- **Byte identity is proven on one machine, one Node version, one day.** Not across operating
  systems, Node versions or architectures — and the committed 1174.0 s versus this run's 175.8 s
  shows the environment does vary, even where the bytes did not.
- **Section 6 is a census, not an equality proof**, and § 5 compares the database with itself.
- **`--check-determinism` was not run for the large profile.** Its byte identity rests on the
  24-file external comparison of two separate processes in § 1a, which is the wider check but not
  the generator's own.

---

## 10. Reproducing this

```bash
docker compose up -d --wait

cd app
npm run synthetic -- --profile demo     --as-of 2026-09-02 --check-determinism
npm run synthetic -- --profile standard --as-of 2026-09-02 --check-determinism
npm run synthetic -- --profile large    --as-of 2026-09-02

cd ../server
time AMS_DATASET=synthetic/large npm run reseed
npm test && npm run test:pglite
```

`--as-of 2026-09-02` is not optional if the counts are to reconcile with the committed manifests.

Files this run touched: the three `migration/synthetic/*/manifest.json` (`generatedAt` only), the
three `migration/reports/07_synthetic_*_report.md` (regenerated by the generator), and this
report. The datasets themselves stay out of git — `migration/synthetic/*/*` is gitignored except
`manifest.json`.
