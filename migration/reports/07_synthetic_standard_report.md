# 07 — Synthetic fleet history: standard profile

Generated 2026-09-03T03:11:06.821Z by `app/scripts/synthetic/generate.ts` v0.1.0 in 37.2 s. Spec: `specs/007-synthetic-data/spec.md`.

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
| scale | 1 |
| profile | standard |
| inputs hash (data/synthetic) | 4676d3426fcd4cb9 |
| output | `migration/synthetic/standard/` |

## Counts

| Table | Rows |
|---|---|
| assets | 1,459 |
| activeAssets | 1,138 |
| transactions | 62,969 |
| transactionLines | 91,616 |
| relationships | 5,331 |
| installations | 8,062 |
| installationComponents | 13,246 |
| calibrationRecords | 7,567 |
| projects | 625 |
| sites | 2,542 |
| roster | 123 |

## Checks

| Id | Check | Result | Measured | Detail |
|---|---|---|---|---|
| counts | Row counts | info | assets 1459 (active 1138, retired 321); headers 62969; lines 91616; relationships 5331; installations 8062; installation components 13246; calibration records 7567; projects 625; sites 2542; roster 123 |  |
| mix | Transactions by type | info | Return 12558, Checkout 10501, Deploy 8081, Undeploy 8043, ReturnFromCalibration 6430, Audit 6378, SendToCalibration 4797, ReportFault 2023, AddToInventory 1459, RepairComplete 1429, Transfer 796, Retire 321, MarkMissing 92, Found 61 |  |
| years | Lines per year | info | 2006:54 2007:461 2008:784 2009:1195 2010:1547 2011:1980 2012:2576 2013:3416 2014:4199 2015:3967 2016:4561 2017:5060 2018:5378 2019:6054 2020:6775 2021:7146 2022:7702 2023:7716 2024:7796 2025:7783 2026:5466 |  |
| FR-024a | Earliest transaction at least the history horizon before as-of | PASS | 2006-08-02 | target ≤ 2006-09-02 |
| FR-024b | Every calendar quarter in the horizon has transactions | PASS | 81 quarters with activity | expected about 81 |
| FR-017 | Every timestamp in the uniform UTC form | PASS | 0 malformed |  |
| FR-012 | Every line is an allowed transition for the status chronologically before it | PASS | 0 disallowed, 0 chain breaks |  |
| FR-015 | First line is AddToInventory to the home office, resulting Available | PASS | 0 assets otherwise |  |
| FR-016 | Consecutive lines for one asset at least 60 s apart | PASS | 0 violations |  |
| FR-013 | Replaying every asset's lines through domain/pointInTime reproduces its state (components via their parent) | PASS | 0 field mismatches across 1459 assets | {"status":0,"currentlocation":0,"custodian":0,"currentproject":0,"parentasset":0}  |
| FR-019a | A child has at most one open attachment at any instant | PASS | 0 overlapping attachments |  |
| FR-019b | Permanent components carry no line of their own after registration | PASS | 0 components with extra lines |  |
| FR-020a | Asset last/next calibration dates agree with the most recent record | PASS | 0 disagreements |  |
| FR-020b | A Failed calibration never advances the next-due date | PASS | 0 advanced |  |
| FR-021 | Installations: one primary logger, oriented sensors, consistent component spans | PASS | 0 primary, 0 orientation, 0 double-open, 0 span, 0 closed-with-open-rows |  |
| FR-022 | Every non-serialised sequence exceeds its highest issued tag | PASS | 0 at or beyond next value |  |
| FR-018 | Transactions dated in Toronto working hours (06:00–21:00) for the vast majority | PASS | 100.0% |  |
| FR-025 | Active assets acquired before the detail window have lines in every year of it | PASS | 772 of 772 |  |
| FR-026 | ≥90% of Active transactable assets have ≥8 lines in the detail window (the rest is idle stock) | PASS | 96.5% | 31 idle |
| FR-029 | Active assets at as-of near the real fleet's size (±10% of 1,150 × scale) | PASS | 1138 | target 1150 |
| FR-030 | Distribution by type, group and home office within 10 pp of the real fleet | PASS | type 5.9pp (Modem), group 5.9pp (Communications), office 3.5pp (Sudbury) |  |
| FR-033 | Shared-serial logger/sensor pairs in proportion (≥100 × scale) | PASS | 106 |  |
| FR-049 | Every allowed transition cell occurs at least 10 times (incl. the five Audit cells FR-049 exempts) | PASS | 33 of 33 cells |  |
| FR-002 | Asset IDs, serials, project numbers/names disjoint from the real migrated data | PASS | 0 ids, 0 serials, 0 projects collide |  |
| FR-003 | No fictional person matches a real Staff name or family name | PASS | 0 collisions |  |
| FR-042 | No site name matches a real site from the registry | PASS | 0 collisions |  |
| FR-004 | Secured attributes only from fiction/documentation ranges (ICCID 89999…, 555-01xx, RFC 5737) | PASS | 305 SIM identifier sets; 0 ICCID, 0 phone, 0 IP outside range |  |
| FR-005 | Every asset, transaction, project, site and certificate carries the synthetic marker | PASS | 0 assets, 0 transactions, 0 certificates, 0 projects, 0 sites unmarked |  |
| FR-038 | Everyone who left returned what they held (except the planted exception) | PASS | 0 leavers still holding |  |
| FR-041 | Every checkout/deploy/transfer names a project active at that instant | PASS | 0 references outside the project's dates |  |
| FR-048 | Expected return on a realistic majority of checkouts, some past due at as-of | PASS | 64.8% set; 96 past due with the asset still out |  |
| FR-050 | Every planted scenario present at as-of | PASS | 16 of 16 |  \| overdue-calibration-per-office: 9/9 offices with calibrated assets; expected-return-overdue: AQDS-900002; retired-after-15-years: DST-5007; failed-calibration-then-repair: GEO-UM-40142; temporary-tag: 9; third-party-owned: 6; leaver-holding-assets: elodie.mensah@englobecorp.com; site-on-two-projects: 215 |
| SC-003 | Volume minimums at this scale | PASS | assets 1459/1400, lines 91616/85000, installations 8062/6000, cal records 7567/7000, projects 625/150, sites 2542/300 |  |
| SC-007 | Answer key reconciles with the app's own point-in-time, installation and reporting logic | PASS | 0 discrepancies |  \| calibration counts not reconciled: as-of is not today |

## Planted scenarios (FR-050)

Stable for this seed. Open each identifier in the app to find the situation described.

| Scenario | Description | Identifiers |
|---|---|---|
| temporary-tag | Temporary-tagged asset never completed (feature 006 FR-011) | assetId: TMP-5001 |
| third-party-owned | Asset whose notes record third-party ownership (feature 006 FR-012) | assetId: GEO-BG-30003 |
| overdue-calibration-per-office | An overdue calibration at every active office (feature 004 US1) | assetIds: DL-UM-40085, DL-BE-30011, DL-BE-30085, DL-BE-30227, GEO-UM-40099, GEO-UM-40105, DL-UM-40077, DL-D10-350013, DL-UM-40071 |
| leaver-holding-assets | A person who left the company while still holding equipment (feature 006 edge case) | upn: elodie.mensah@englobecorp.com; leftOn: 2025-11-20; assetIds: DL-BE-30219, AT-5006 |
| failed-calibration-then-repair | A Failed calibration (next-due not advanced, feature 004 FR-016) followed by repair and a passing re-calibration | assetId: GEO-UM-40142 |
| expected-return-overdue | A checkout whose expected return is more than 90 days past (flow F4's case) | assetId: AQDS-900002; custodian: mathilde.pellerin@englobecorp.com; expectedReturn: 2026-03-16 |
| deployed-and-overdue | A deployed asset that is overdue for calibration (feature 004 FR-030) | loggerId: DL-BE-30156; site: 2559 Erie Shore Drive |
| partial-recovery | An installation partially recovered — sensors back, logger still on site (feature 005 FR-015) | loggerId: DL-BE-30047; site: 4295 Bellamy Ridge Road |
| retired-after-15-years | An asset retired after at least fifteen years, with its full history (feature 006 FR-022/FR-029) | assetId: DST-5007; acquired: 2008-06-04 |
| missing | An asset currently Missing (feature 003 US6) | assetId: FC-8100000 |
| closed-project-with-station | A project closed while a station remained deployed on it (feature 006 edge case) | project: 09000004; installationId: 579b5d1b-76b8-5e0a-a6d8-62a59be83710; site: 2818 Kettle Creek Road |
| site-on-two-projects | A site with installations on two different projects (feature 005 FR-019) | site: 100 Danforth Ridge Road; projects: 09000179, 09000615 |
| at-foreign-office | An asset currently at an office other than its home office (feature 006 edge case) | assetId: AQDS-900003; homeOffice: SWO; currentLocation: Ottawa |
| shared-serial-pair-apart | A logger and its same-serial geophone currently at different locations (Principle III) | loggerId: DL-UM-40030; geophoneId: GEO-UM-40030; site: 1051 Frood Extension Road |
| office-without-admin | An office with no administrator assigned (feature 004 FR-027a) | office: Thunder Bay |

## Catalogue extensions (FR-031)

- Sierra Wireless AirLink RV50X (Modem) — synthetic-only; not in `data/reference/equipment_models.csv`.

## Markers (FR-005)

- asset: migrationsource starts with "SYNTHETIC seed=englobe-ams-007"
- transaction: notes start with "[SYNTHETIC s=englobe-ams-007]"
- projectNumberPrefix: 09
- certificatePrefix: SYN-
- siteNote: note starts with "SYNTHETIC seed=englobe-ams-007"
