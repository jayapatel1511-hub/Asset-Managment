# 07 — Synthetic fleet history: demo profile

Generated 2026-09-03T22:57:57.207Z by `app/scripts/synthetic/generate.ts` v0.1.0 in 3.3 s. Spec: `specs/007-synthetic-data/spec.md`.

**Result: PASS.** The manifest records `verified: true`; the dataset may be copied into the app.

Every row in this dataset is fictional. Nothing in it describes a real asset, person, project or site. See `data/synthetic/README.md`.

## Parameters

| Parameter | Value |
|---|---|
| seed | englobe-ams-007 |
| asOf | 2026-09-02 |
| historyYears | 20 |
| detailYears | 5 |
| deepRate | 0.4 |
| scale | 0.25 |
| profile | demo |
| inputs hash (data/synthetic) | 4676d3426fcd4cb9 |
| output | `migration/synthetic/demo/` |

## Counts

| Table | Rows |
|---|---|
| assets | 371 |
| activeAssets | 285 |
| transactions | 16,836 |
| transactionLines | 23,022 |
| relationships | 1,152 |
| installations | 2,022 |
| installationComponents | 3,138 |
| calibrationRecords | 1,877 |
| projects | 260 |
| sites | 686 |
| roster | 123 |

## Checks

| Id | Check | Result | Measured | Detail |
|---|---|---|---|---|
| counts | Row counts | info | assets 371 (active 285, retired 86); headers 16836; lines 23022; relationships 1152; installations 2022; installation components 3138; calibration records 1877; projects 260; sites 686; roster 123 |  |
| mix | Transactions by type | info | Return 3590, Checkout 3100, Deploy 2025, Undeploy 1983, Audit 1679, ReturnFromCalibration 1565, SendToCalibration 1339, ReportFault 500, AddToInventory 371, RepairComplete 339, Transfer 227, Retire 86, MarkMissing 21, Found 11 |  |
| years | Lines per year | info | 2006:12 2007:126 2008:233 2009:299 2010:409 2011:464 2012:564 2013:775 2014:816 2015:731 2016:943 2017:1226 2018:1344 2019:1607 2020:1751 2021:1834 2022:2275 2023:2153 2024:2057 2025:2029 2026:1374 |  |
| FR-024a | Earliest transaction at least the history horizon before as-of | PASS | 2006-08-25 | target ≤ 2006-09-02 |
| FR-024b | Every calendar quarter in the horizon has transactions | PASS | 81 quarters with activity | expected about 81 |
| FR-017 | Every timestamp in the uniform UTC form | PASS | 0 malformed |  |
| FR-012 | Every line is an allowed transition for the status chronologically before it | PASS | 0 disallowed, 0 chain breaks |  |
| FR-015 | First line is AddToInventory to the home office, resulting Available | PASS | 0 assets otherwise |  |
| FR-016 | Consecutive lines for one asset at least 60 s apart | PASS | 0 violations |  |
| FR-013 | Replaying every asset's lines through domain/pointInTime reproduces its state (components via their parent) | PASS | 0 field mismatches across 371 assets | {"status":0,"currentlocation":0,"custodian":0,"currentproject":0,"parentasset":0}  |
| FR-019a | A child has at most one open attachment at any instant | PASS | 0 overlapping attachments |  |
| FR-019b | Permanent components carry no line of their own after registration | PASS | 0 components with extra lines |  |
| FR-020a | Asset last/next calibration dates agree with the most recent record | PASS | 0 disagreements |  |
| FR-020b | A Failed calibration never advances the next-due date | PASS | 0 advanced |  |
| FR-021 | Installations: one primary logger, oriented sensors, consistent component spans | PASS | 0 primary, 0 orientation, 0 double-open, 0 span, 0 closed-with-open-rows |  |
| FR-022 | Every non-serialised sequence exceeds its highest issued tag | PASS | 0 at or beyond next value |  |
| FR-018 | Transactions dated in Toronto working hours (06:00–21:00) for the vast majority | PASS | 100.0% |  |
| FR-025 | Active assets acquired before the detail window have lines in every year of it | PASS | 198 of 198 |  |
| FR-026 | ≥90% of Active transactable assets have ≥8 lines in the detail window (the rest is idle stock) | PASS | 93.6% | 14 idle |
| FR-029 | Active assets at as-of near the real fleet's size (±10% of 1,150 × scale) | PASS | 285 | target 288 |
| FR-030 | Distribution by type, group and home office within 10 pp of the real fleet | PASS | type 5.3pp (Modem), group 4.8pp (Communications), office 5.9pp (Sudbury) |  |
| FR-033 | Shared-serial logger/sensor pairs in proportion (≥100 × scale) | PASS | 32 |  |
| FR-049 | Every allowed transition cell occurs at least 3 times (incl. the five Audit cells FR-049 exempts) | PASS | 33 of 33 cells |  |
| FR-002 | Asset IDs, serials, project numbers/names disjoint from the real migrated data | PASS | 0 ids, 0 serials, 0 projects collide |  |
| FR-003 | No fictional person matches a real Staff name or family name | PASS | 0 collisions |  |
| FR-042 | No site name matches a real site from the registry | PASS | 0 collisions |  |
| FR-004 | Secured attributes only from fiction/documentation ranges (ICCID 89999…, 555-01xx, RFC 5737) | PASS | 74 SIM identifier sets; 0 ICCID, 0 phone, 0 IP outside range |  |
| FR-005 | Every asset, transaction, project, site and certificate carries the synthetic marker | PASS | 0 assets, 0 transactions, 0 certificates, 0 projects, 0 sites unmarked |  |
| FR-038 | Everyone who left returned what they held (except the planted exception) | PASS | 0 leavers still holding |  |
| FR-041 | Every checkout/deploy/transfer names a project active at that instant | PASS | 0 references outside the project's dates |  |
| FR-048 | Expected return on a realistic majority of checkouts, some past due at as-of | PASS | 65.5% set; 41 past due with the asset still out |  |
| FR-050 | Every planted scenario present at as-of | PASS | 16 of 16 |  \| overdue-calibration-per-office: 8/8 offices with calibrated assets; expected-return-overdue: AC-5001; retired-after-15-years: DST-5003; failed-calibration-then-repair: GEO-V12-400001; temporary-tag: 1; third-party-owned: 1; leaver-holding-assets: rohan.marchetti@englobecorp.com; site-on-two-projects: 63 |
| SC-003 | Volume minimums at this scale | PASS | assets 371/350, lines 23022/21250, installations 2022/1500, cal records 1877/1750, projects 260/38, sites 686/75 |  |
| SC-007 | Answer key reconciles with the app's own point-in-time, installation and reporting logic | PASS | 0 discrepancies |  \| calibration counts not reconciled: as-of is not today |
| FR-052 | Two generations with the same seed and parameters are byte-identical | PASS | all 13 files identical |  (1.4 s) |

## Planted scenarios (FR-050)

Stable for this seed. Open each identifier in the app to find the situation described.

| Scenario | Description | Identifiers |
|---|---|---|
| temporary-tag | Temporary-tagged asset never completed (feature 006 FR-011) | assetId: TMP-5001 |
| third-party-owned | Asset whose notes record third-party ownership (feature 006 FR-012) | assetId: DL-BE-30025 |
| overdue-calibration-per-office | An overdue calibration at every active office (feature 004 US1) | assetIds: DL-UM-40010, GEO-UM-40000, GEO-BG-30029, DL-D10-350004, DL-BE-30051, DL-UM-40023, DL-UM-40007, GEO-UM-40019 |
| leaver-holding-assets | A person who left the company while still holding equipment (feature 006 edge case) | upn: rohan.marchetti@englobecorp.com; leftOn: 2026-01-15; assetIds: SB-600000 |
| failed-calibration-then-repair | A Failed calibration (next-due not advanced, feature 004 FR-016) followed by repair and a passing re-calibration | assetId: GEO-V12-400001 |
| expected-return-overdue | A checkout whose expected return is more than 90 days past (flow F4's case) | assetId: AC-5001; custodian: emeka.eriksen@englobecorp.com; expectedReturn: 2026-03-16 |
| deployed-and-overdue | A deployed asset that is overdue for calibration (feature 004 FR-030) | loggerId: DL-UM-40003; site: 2307 Stonebridge Court |
| component-swap | Installation with a component swapped mid-life, still on site (feature 005 US4) | installationId: 900f852b-f648-558c-b575-64da7c67b492; outgoing: GEO-V12-400003; incoming: GEO-C22-450003; site: 2287 Lakeshore Viaduct Road |
| partial-recovery | An installation partially recovered — sensors back, logger still on site (feature 005 FR-015) | loggerId: DL-UM-40040; site: 1086 Kettle Creek Road |
| retired-after-15-years | An asset retired after at least fifteen years, with its full history (feature 006 FR-022/FR-029) | assetId: DST-5003; acquired: 2008-09-10 |
| missing | An asset currently Missing (feature 003 US6) | assetId: AC-5002 |
| closed-project-with-station | A project closed while a station remained deployed on it (feature 006 edge case) | project: 09000010; installationId: 2697ae8b-aa6b-5fbc-aec7-4ee43d5e0e5e; site: 4025 Humberline Court |
| site-on-two-projects | A site with installations on two different projects (feature 005 FR-019) | site: 1007 Greyrock Mine Road; projects: 09000212, 09000257 |
| at-foreign-office | An asset currently at an office other than its home office (feature 006 edge case) | assetId: MEMS-DP6000; homeOffice: Toronto; currentLocation: Ottawa |
| office-without-admin | An office with no administrator assigned (feature 004 FR-027a) | office: Thunder Bay |

## Catalogue extensions (FR-031)

- Sierra Wireless AirLink RV50X (Modem) — synthetic-only; not in `data/reference/equipment_models.csv`.

## Markers (FR-005)

- asset: migrationsource starts with "SYNTHETIC seed=englobe-ams-007"
- transaction: notes start with "[SYNTHETIC s=englobe-ams-007]"
- projectNumberPrefix: 09
- certificatePrefix: SYN-
- siteNote: note starts with "SYNTHETIC seed=englobe-ams-007"
