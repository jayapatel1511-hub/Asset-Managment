# 07 — Synthetic fleet history: large profile

Generated 2026-09-03T22:51:54.142Z by `app/scripts/synthetic/generate.ts` v0.1.0 in 175.8 s. Spec: `specs/007-synthetic-data/spec.md`.

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
| scale | 4.5 |
| profile | large |
| inputs hash (data/synthetic) | 4676d3426fcd4cb9 |
| output | `migration/synthetic/large/` |

## Counts

| Table | Rows |
|---|---|
| assets | 6,626 |
| activeAssets | 5,312 |
| transactions | 295,355 |
| transactionLines | 438,619 |
| relationships | 26,372 |
| installations | 39,838 |
| installationComponents | 65,550 |
| calibrationRecords | 34,914 |
| projects | 2,501 |
| sites | 12,069 |
| roster | 123 |

## Checks

| Id | Check | Result | Measured | Detail |
|---|---|---|---|---|
| counts | Row counts | info | assets 6626 (active 5312, retired 1314); headers 295355; lines 438619; relationships 26372; installations 39838; installation components 65550; calibration records 34914; projects 2501; sites 12069; roster 123 |  |
| mix | Transactions by type | info | Return 62675, Checkout 51645, Deploy 39922, Undeploy 39841, ReturnFromCalibration 29564, Audit 26821, SendToCalibration 16532, ReportFault 9353, RepairComplete 6668, AddToInventory 6626, Transfer 3808, Retire 1314, MarkMissing 354, Found 232 |  |
| years | Lines per year | info | 2006:295 2007:1969 2008:3881 2009:5969 2010:7648 2011:9895 2012:12477 2013:16440 2014:18787 2015:19649 2016:21661 2017:24100 2018:26957 2019:29236 2020:31045 2021:33677 2022:37849 2023:37651 2024:37261 2025:36788 2026:25384 |  |
| FR-024a | Earliest transaction at least the history horizon before as-of | PASS | 2006-08-02 | target ≤ 2006-09-02 |
| FR-024b | Every calendar quarter in the horizon has transactions | PASS | 81 quarters with activity | expected about 81 |
| FR-017 | Every timestamp in the uniform UTC form | PASS | 0 malformed |  |
| FR-012 | Every line is an allowed transition for the status chronologically before it | PASS | 0 disallowed, 0 chain breaks |  |
| FR-015 | First line is AddToInventory to the home office, resulting Available | PASS | 0 assets otherwise |  |
| FR-016 | Consecutive lines for one asset at least 60 s apart | PASS | 0 violations |  |
| FR-013 | Replaying every asset's lines through domain/pointInTime reproduces its state (components via their parent) | PASS | 0 field mismatches across 6626 assets | {"status":0,"currentlocation":0,"custodian":0,"currentproject":0,"parentasset":0}  |
| FR-019a | A child has at most one open attachment at any instant | PASS | 0 overlapping attachments |  |
| FR-019b | Permanent components carry no line of their own after registration | PASS | 0 components with extra lines |  |
| FR-020a | Asset last/next calibration dates agree with the most recent record | PASS | 0 disagreements |  |
| FR-020b | A Failed calibration never advances the next-due date | PASS | 0 advanced |  |
| FR-021 | Installations: one primary logger, oriented sensors, consistent component spans | PASS | 0 primary, 0 orientation, 0 double-open, 0 span, 0 closed-with-open-rows |  |
| FR-022 | Every non-serialised sequence exceeds its highest issued tag | PASS | 0 at or beyond next value |  |
| FR-018 | Transactions dated in Toronto working hours (06:00–21:00) for the vast majority | PASS | 100.0% |  |
| FR-025 | Active assets acquired before the detail window have lines in every year of it | PASS | 3683 of 3683 |  |
| FR-026 | ≥90% of Active transactable assets have ≥8 lines in the detail window (the rest is idle stock) | PASS | 96.5% | 146 idle |
| FR-029 | Active assets at as-of near the real fleet's size (±10% of 1,150 × scale) | PASS | 5312 | target 5175 |
| FR-030 | Distribution by type, group and home office within 10 pp of the real fleet | PASS | type 5.2pp (Modem), group 4.3pp (Communications), office 3.3pp (Toronto) |  |
| FR-033 | Shared-serial logger/sensor pairs in proportion (≥100 × scale) | PASS | 485 |  |
| FR-049 | Every allowed transition cell occurs at least 10 times (incl. the five Audit cells FR-049 exempts) | PASS | 33 of 33 cells |  |
| FR-002 | Asset IDs, serials, project numbers/names disjoint from the real migrated data | PASS | 0 ids, 0 serials, 0 projects collide |  |
| FR-003 | No fictional person matches a real Staff name or family name | PASS | 0 collisions |  |
| FR-042 | No site name matches a real site from the registry | PASS | 0 collisions |  |
| FR-004 | Secured attributes only from fiction/documentation ranges (ICCID 89999…, 555-01xx, RFC 5737) | PASS | 1333 SIM identifier sets; 0 ICCID, 0 phone, 0 IP outside range |  |
| FR-005 | Every asset, transaction, project, site and certificate carries the synthetic marker | PASS | 0 assets, 0 transactions, 0 certificates, 0 projects, 0 sites unmarked |  |
| FR-038 | Everyone who left returned what they held (except the planted exception) | PASS | 0 leavers still holding |  |
| FR-041 | Every checkout/deploy/transfer names a project active at that instant | PASS | 0 references outside the project's dates |  |
| FR-048 | Expected return on a realistic majority of checkouts, some past due at as-of | PASS | 65.3% set; 600 past due with the asset still out |  |
| FR-050 | Every planted scenario present at as-of | PASS | 16 of 16 |  \| overdue-calibration-per-office: 10/10 offices with calibrated assets; expected-return-overdue: AC-5017; retired-after-15-years: DST-5009; failed-calibration-then-repair: LS-100002; temporary-tag: 35; third-party-owned: 26; leaver-holding-assets: elodie.mensah@englobecorp.com; site-on-two-projects: 997 |
| SC-003 | Volume minimums at this scale | PASS | assets 6626/6300, lines 438619/382500, installations 39838/27000, cal records 34914/31500, projects 2501/675, sites 12069/1350 |  |
| SC-003b | Large profile reaches feature 006 SC-010's own scale (5,000 active assets, 100,000 lines) | PASS | 5312 active assets, 438619 lines |  |
| SC-007 | Answer key reconciles with the app's own point-in-time, installation and reporting logic | PASS | 0 discrepancies |  \| calibration counts not reconciled: as-of is not today |

## Planted scenarios (FR-050)

Stable for this seed. Open each identifier in the app to find the situation described.

| Scenario | Description | Identifiers |
|---|---|---|
| temporary-tag | Temporary-tagged asset never completed (feature 006 FR-011) | assetId: TMP-5001 |
| third-party-owned | Asset whose notes record third-party ownership (feature 006 FR-012) | assetId: DL-BE-30027 |
| overdue-calibration-per-office | An overdue calibration at every active office (feature 004 US1) | assetIds: SLM-S50-500075, GEO-BG-30288, DL-UM-40404, DL-UM-40420, DL-UM-40043, DL-UM-40312, DL-D10-300064, DL-UM-40433, DL-UM-40463, GEO-UM-40549 |
| leaver-holding-assets | A person who left the company while still holding equipment (feature 006 edge case) | upn: elodie.mensah@englobecorp.com; leftOn: 2025-11-20; assetIds: DL-BE-30922, VWR-70001, SLM-S50-500015, SB-600002, SLM-S50-500031, AT-5012, SLM-LD-5000018, AQDS-900007 |
| failed-calibration-then-repair | A Failed calibration (next-due not advanced, feature 004 FR-016) followed by repair and a passing re-calibration | assetId: LS-100002 |
| expected-return-overdue | A checkout whose expected return is more than 90 days past (flow F4's case) | assetId: AC-5017; custodian: mathilde.pellerin@englobecorp.com; expectedReturn: 2026-03-16 |
| deployed-and-overdue | A deployed asset that is overdue for calibration (feature 004 FR-030) | loggerId: DL-D10-350040; site: 4115 Fanshawe Ridge |
| component-swap | Installation with a component swapped mid-life, still on site (feature 005 US4) | installationId: 5c1bac54-d73d-5976-a1f2-b167277ff7e9; outgoing: GEO-UM-40415; incoming: GEO-UM-40142; site: 157 Kelly Lake Line |
| partial-recovery | An installation partially recovered — sensors back, logger still on site (feature 005 FR-015) | loggerId: DL-BE-30720; site: 4295 Erie Shore Drive |
| retired-after-15-years | An asset retired after at least fifteen years, with its full history (feature 006 FR-022/FR-029) | assetId: DST-5009; acquired: 2007-04-24 |
| missing | An asset currently Missing (feature 003 US6) | assetId: CAM-7000020 |
| closed-project-with-station | A project closed while a station remained deployed on it (feature 006 edge case) | project: 09000019; installationId: 19e5105b-2e2f-581b-93c4-cbf713d21621; site: 4100 Danforth Ridge Road |
| site-on-two-projects | A site with installations on two different projects (feature 005 FR-019) | site: 100 Kelly Lake Line; projects: 09000108, 09002466 |
| at-foreign-office | An asset currently at an office other than its home office (feature 006 edge case) | assetId: AC-5016; homeOffice: Kitchener; currentLocation: Ottawa |
| shared-serial-pair-apart | A logger and its same-serial geophone currently at different locations (Principle III) | loggerId: DL-UM-40122; geophoneId: GEO-UM-40122; site: 4448 Pinery Road |
| office-without-admin | An office with no administrator assigned (feature 004 FR-027a) | office: Thunder Bay |

## Catalogue extensions (FR-031)

- Sierra Wireless AirLink RV50X (Modem) — synthetic-only; not in `data/reference/equipment_models.csv`.

## Markers (FR-005)

- asset: migrationsource starts with "SYNTHETIC seed=englobe-ams-007"
- transaction: notes start with "[SYNTHETIC s=englobe-ams-007]"
- projectNumberPrefix: 09
- certificatePrefix: SYN-
- siteNote: note starts with "SYNTHETIC seed=englobe-ams-007"
