# S03 — Asset detail

| | |
|---|---|
| **Screen ID** | S03 (+ D02–D05) |
| **Route** | `/asset/:assetId` |
| **Component** | `app/src/features/asset/AssetDetailPage.tsx` + dialogs |
| **Surfaces** | Field (trimmed history) · Desk (full History/Calibration) |
| **Roles** | all; admin actions Office Admin / System Owner |
| **One job** | Show current facts and offer only state-machine-allowed actions |
| **Source** | `docs/12-ui-spec.md` § 5.3–5.4 · refreshed 2026-09-03 |

## Purpose

One asset: where/who/project/cal, allowed transactions, history and calibration records. Writes go through commands/dialogs — never direct status edit.

## Entry points

| From | How |
|---|---|
| S01 / S07 / reports AssetRow | Tap row |
| D01 | Unique resolve |
| Deep link | `/asset/:assetId` |

## Layout zones

1. Header: Asset ID · StatusPill · lifecycle / temporary badges · pending sync
2. Model · type line
3. Now info card (C5) + optional OVERDUE
4. Sites / deployments (if any)
5. Action button row (wrap)
6. Admin-only SIM card (G-11 closed)
7. Tabs: History · Calibration
8. Inline error MessageBar for immediate actions (G-13 closed)

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Checkout | `asset.actions.checkout` | Actions | See matrix / G-12 | Valid status | → `/checkout?asset=` | — | — | Cart local |
| Return | `asset.actions.return` | Actions | matrix | Valid | → `/return?asset=` | — | — | — |
| Transfer | `asset.actions.transfer` | Actions | matrix | Valid | → `/transfer?asset=` | — | — | — |
| Report fault | `asset.actions.reportFault` | Actions | matrix | Valid | Opens **D02** | Command → refresh | Inline error | Queue / X02 path |
| Mark missing | `asset.actions.markMissing` | Actions | matrix | Valid | Opens **D02** | Same | Inline error | Queue |
| Mark found | `asset.actions.markFound` | Actions | matrix | Valid | Immediate command (no dialog) | Refresh | Inline `error` MessageBar | Queue |
| Repair complete | `asset.actions.completeRepair` | Actions | matrix | Valid | Immediate command | Refresh | Inline error | Queue |
| Send to calibration | `asset.actions.sendToCalibration` | Actions | Admin + matrix | Valid | **D03** | Refresh | Dialog/inline error | Queue |
| Record calibration | `asset.actions.recordCalibration` | Actions | Admin + Active lifecycle | Valid | **D04** | Refresh | Dialog error | Queue |
| Retire | `asset.actions.retire` | Actions | Admin + matrix | Valid | **D05** | Refresh / retired | Dialog error | — |
| Attach component | `asset.actions.attachComponent` | — | **Not built** | — | TBD | — | — | — |
| Deployment row | site name · project | Sites block | Has deployments | always | → `/site/:site` | S09 | — | Cached |
| Tab History | `asset.tabs.history` | Tabs | always | always | Shows history list | — | — | Cached events |
| Tab Calibration | `asset.tabs.calibration` | Tabs | always | always | Shows cal records | — | — | Cached |
| Open certificate | `asset.history.openCertificate` | Cal row | URL present | always | Opens private download URL | Blob/stream | Auth error | May fail offline |

### Action matrix (server is authority; client mirrors for feedback)

From § 5.3 — ✓ = offered when valid. (A) = admin only.

| Status | Checkout | Return | Transfer | Fault | Missing | Found | Repair done | Send cal (A) | Record cal (A) | Retire (A) |
|---|---|---|---|---|---|---|---|---|---|---|
| Available | ✓ | | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| CheckedOut | | ✓ | ✓ | ✓ | ✓ | | | | ✓ | |
| Deployed | | ✓ | ✓ | ✓ | ✓ | | | | ✓ | |
| InCalibration | | | | ✓ | | | | | ✓ | ✓ |
| NeedsRepair | | | | | | | ✓ | ✓ | ✓ | ✓ |
| Missing | | | | | | ✓ | | | | ✓ |
| Retired | | | | | | | | | | |

**G-12 TBD:** build *hides* invalid; `docs/02-app.md` asked *disable* + `asset.actions.notAllowed`.

## Data shown

| Field | i18n / notes |
|---|---|
| Location, Home office, Custodian, Project, Parent, Next cal due | `asset.*` Now card |
| Last calibrated, Attached items | G-11 — expected in build |
| SIM ICCID / phone / static IP / carrier | Admin+ only |
| No custodian migration copy | `asset.noCustodian` |
| History lines | type, before→after, to user/location/project, by performer, notes |
| Calibration lines | date → next due · lab · cert link |

## States

| State | Treatment |
|---|---|
| Loading | Spinner |
| Not found | `asset.notFound` |
| Default / overdue / retired / temporary / admin / field | Badge and action variants |
| Offline | Read cache; writes queue; pending badge |

## Related dialogs / sheets

### D02 — Report fault / Mark missing (§ 5.4)

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Title | Action label | always | — | — |
| Notes | `asset.notes` Textarea 3 rows | always | — | — |
| Cancel | `common.cancel` | always | Close | No write |
| Confirm | `common.confirm` | always | Submit command | Success refresh; failure MessageBar; offline queue |

### D03 — Send to calibration (admin)

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Lab | `calibration.record.lab` Select CalLab | required | — | Error "Pick a calibration lab." if empty |
| Cancel / Confirm | `common.cancel` / `common.confirm` | always | Submit / close | Server refuses invalid transition |

### D04 — Record calibration (admin)

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Calibration date | `calibration.record.date` | required, max today | — | `futureDate` error |
| Next due | `calibration.record.nextDue` | optional w/ model interval | — | `needsDueDate` if no interval |
| Lab | `calibration.record.lab` | text default | — | — |
| Certificate number | `calibration.record.certNumber` | optional | — | — |
| Cost | `calibration.record.cost` | optional | — | — |
| Result | `calibration.record.result` Select | — / Pass / Fail / Adjusted | — | — |
| Duplicate warning | `calibration.record.duplicateWarning` | when same-day exists | — | Informational |
| Certificate PDF | TBD G-14 | **Not in dialog yet** | Upload to private blob | Policy: no broad storage credential in browser |
| Cancel / Save | `common.cancel` / `common.save` | Save enabled when valid | Submit | Refresh; offline queue |

### D05 — Retire asset (admin)

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| Reason | `admin.retire.reason` Select Sold/Lost/Damaged/Obsolete | required | — | `reasonRequired` |
| Continue (step 1) | per G-15 closed build | when reason set | Shows confirm copy | — |
| Confirm copy | `admin.retire.confirm` | step 2 | — | — |
| Retire | `asset.actions.retire` danger-outline (G-05 proposed) | step 2 | Submit retire command | Irreversible from app (no un-retire UI yet — audit A4) |
| Cancel | `common.cancel` | both steps | Close | No write |

## Non-goals

- Editing location/custodian/status as fields
- Full Console bulk ops
- Un-retire (missing — `docs/17-ux-audit.md` A4)

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-12 | Hide vs disable invalid actions | Keep hide (current build) **or** implement disable if Jay picks spec |
| G-05 | Retire styling | Outline today; mockup danger-outline |
| G-14 | Cert upload | Stub control until documents API wired |
| Field trim | Full history on phone vs last N | Desk full; Field last few per Surfaces |

## Governing links

- `docs/12-ui-spec.md` § 5.3–5.4
- Domain state machine / feature specs 001–008 behaviour
- `app/src/features/asset/`, calibration & admin dialogs
