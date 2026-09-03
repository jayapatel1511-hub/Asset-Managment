# 07 — Synthetic fleet history: demo profile

Generated 2026-09-03T00:17:41.687Z by `app/scripts/synthetic/generate.ts` v0.1.0 in 2.1 s. Spec: `specs/007-synthetic-data/spec.md`.

**Result: FAIL — 4 check(s) failed.** The manifest records `verified: false`; `scripts/copy-staged-data.mjs` refuses it.

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
| activeAssets | 301 |
| transactions | 13,677 |
| transactionLines | 18,792 |
| relationships | 1,184 |
| installations | 1,879 |
| installationComponents | 3,027 |
| calibrationRecords | 1,730 |
| projects | 249 |
| sites | 646 |
| roster | 123 |

## Checks

| Id | Check | Result | Measured | Detail |
|---|---|---|---|---|
| counts | Row counts | info | assets 371 (active 301, retired 70); headers 13677; lines 18792; relationships 1184; installations 1879; installation components 3027; calibration records 1730; projects 249; sites 646; roster 123 |  |
| mix | Transactions by type | info | Return 2938, Checkout 2505, Undeploy 1882, Deploy 1879, ReturnFromCalibration 1429, SendToCalibration 1180, Audit 455, ReportFault 425, AddToInventory 371, RepairComplete 318, Transfer 186, Retire 70, MarkMissing 22, Found 17 |  |
| years | Lines per year | info | 2006:11 2007:110 2008:136 2009:160 2010:280 2011:417 2012:461 2013:594 2014:698 2015:665 2016:732 2017:862 2018:1110 2019:1240 2020:1407 2021:1429 2022:1740 2023:1846 2024:1714 2025:1890 2026:1290 |  |
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
| FR-025 | Active assets acquired before the detail window have lines in every year of it | **FAIL** | 212 of 215 | SLM-S50-500004 (CheckedOut) no line in 2025-09-03..2026-09-02; SLM-S50-500004 (CheckedOut) no line in 2024-09-03..2025-09-02; MDM-3000000000 (Available) no line in 2024-09-03..2025-09-02; SLM-S50-500006 (Available) no line in 2024-09-03..2025-09-02 |
| FR-026 | ≥90% of Active transactable assets have ≥8 lines in the detail window (the rest is idle stock) | PASS | 95.3% | 11 idle |
| FR-029 | Active assets at as-of near the real fleet's size (±10% of 1,150 × scale) | PASS | 301 | target 288 |
| FR-030 | Distribution by type, group and home office within 10 pp of the real fleet | PASS | type 5.0pp (Modem), group 3.0pp (Communications), office 6.4pp (Sudbury) |  |
| FR-033 | Shared-serial logger/sensor pairs in proportion (≥100 × scale) | PASS | 33 |  |
| FR-049 | Every allowed transition cell occurs at least 3 times | PASS | 33 of 33 cells |  |
| FR-002 | Asset IDs, serials, project numbers/names disjoint from the real migrated data | PASS | 0 ids, 0 serials, 0 projects collide |  |
| FR-003 | No fictional person matches a real Staff name or family name | PASS | 0 collisions |  |
| FR-042 | No site name matches a real site from the registry | PASS | 0 collisions |  |
| FR-004 | Secured attributes only from fiction/documentation ranges (ICCID 89999…, 555-01xx, RFC 5737) | PASS | 74 SIM identifier sets; 0 ICCID, 0 phone, 0 IP outside range |  |
| FR-005 | Every asset, transaction, project, site and certificate carries the synthetic marker | PASS | 0 assets, 0 transactions, 0 certificates, 0 projects, 0 sites unmarked |  |
| FR-038 | Everyone who left returned what they held (except the planted exception) | **FAIL** | 1 leavers still holding | priya.halvorsen@englobecorp.com |
| FR-041 | Every checkout/deploy/transfer names a project active at that instant | PASS | 0 references outside the project's dates |  |
| FR-048 | Expected return on a realistic majority of checkouts, some past due at as-of | PASS | 64.9% set; 25 past due with the asset still out |  |
| FR-050 | Every planted scenario present at as-of | **FAIL** | 13 of 16 | overdue-calibration-per-office, component-swap, leaver-holding-assets \| overdue-calibration-per-office: 7/8 offices with calibrated assets; expected-return-overdue: AC-5002; retired-after-15-years: GEO-SE-30000; failed-calibration-then-repair: GEO-SE-30000; temporary-tag: 2; third-party-owned: 2; leaver-holding-assets: not planted; site-on-two-projects: 52 |
| SC-003 | Volume minimums at this scale | **FAIL** | assets 371/350, lines 18792/25000, installations 1879/1500, cal records 1730/2000, projects 249/38, sites 646/75 |  |
| SC-007 | Answer key reconciles with the app's own point-in-time, installation and reporting logic | PASS | 0 discrepancies |  \| calibration counts not reconciled: as-of is not today |

## Planted scenarios (FR-050)

Stable for this seed. Open each identifier in the app to find the situation described.

| Scenario | Description | Identifiers |
|---|---|---|
| temporary-tag | Temporary-tagged asset never completed (feature 006 FR-011) | assetId: TMP-5001 |
| third-party-owned | Asset whose notes record third-party ownership (feature 006 FR-012) | assetId: DL-BE-30025 |
| overdue-calibration-per-office | An overdue calibration at every active office (feature 004 US1) | assetIds: GEO-SE-30000, GEO-SE-30001, SLM-S50-500000, GEO-BG-30026, GEO-C22-450004 |
| failed-calibration-then-repair | A Failed calibration (next-due not advanced, feature 004 FR-016) followed by repair and a passing re-calibration | assetId: GEO-SE-30000 |
| expected-return-overdue | A checkout whose expected return is more than 90 days past (flow F4's case) | assetId: AC-5002; custodian: fergus.jorgensen@englobecorp.com; expectedReturn: 2026-03-16 |
| deployed-and-overdue | A deployed asset that is overdue for calibration (feature 004 FR-030) | loggerId: DL-D10-350000; site: 253 Fenwick Street |
| retired-after-15-years | An asset retired after at least fifteen years, with its full history (feature 006 FR-022/FR-029) | assetId: GEO-SE-30000; acquired: 2011-05-03 |
| partial-recovery | An installation partially recovered — sensors back, logger still on site (feature 005 FR-015) | loggerId: DL-UM-40028; site: 1231 Stonebridge Court |
| missing | An asset currently Missing (feature 003 US6) | assetId: CAM-7000001 |
| closed-project-with-station | A project closed while a station remained deployed on it (feature 006 edge case) | project: 09000016; installationId: fda854b1-778c-58ce-a1aa-3c572ced2e61; site: 4036 Bellamy Ridge Road |
| site-on-two-projects | A site with installations on two different projects (feature 005 FR-019) | site: 100 Danforth Ridge Road; projects: 09000188, 09000243 |
| at-foreign-office | An asset currently at an office other than its home office (feature 006 edge case) | assetId: CAM-7100000; homeOffice: Ottawa; currentLocation: Toronto |
| shared-serial-pair-apart | A logger and its same-serial geophone currently at different locations (Principle III) | loggerId: DL-UM-40023; geophoneId: GEO-UM-40023; site: 472 Fanshawe Ridge |
| office-without-admin | An office with no administrator assigned (feature 004 FR-027a) | office: Thunder Bay |

## Catalogue extensions (FR-031)

- Sierra Wireless AirLink RV50X (Modem) — synthetic-only; not in `data/reference/equipment_models.csv`.

## Markers (FR-005)

- asset: migrationsource starts with "SYNTHETIC seed=englobe-ams-007"
- transaction: notes start with "[SYNTHETIC s=englobe-ams-007]"
- projectNumberPrefix: 09
- certificatePrefix: SYN-
- siteNote: note starts with "SYNTHETIC seed=englobe-ams-007"
