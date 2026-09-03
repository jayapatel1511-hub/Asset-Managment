# 01 — Data model

Eight custom tables, publisher prefix `eng`. Users (custodian, performed by) are the built-in
`systemuser` table — do **not** create a staff table.

Column types use Dataverse names. "Req" = business required. `[auto]` = written only by flows.

## eng_equipmentmodel — Equipment Model (reference)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(100) | ✓ | primary. `"{Manufacturer} {Model}"`, e.g. `Instantel Micromate` |
| eng_manufacturer | Text(100) | ✓ | |
| eng_model | Text(100) | ✓ | |
| eng_equipmenttype | Choice `eng_equipmenttype` | ✓ | see choice sets |
| eng_assetgroup | Choice `eng_assetgroup` | ✓ | |
| eng_idprefix | Text(20) | ✓ | e.g. `DL-UM`, `GEO-V12`, `DST`, `AC`. Used to mint Asset IDs |
| eng_isserialised | Yes/No | ✓ | No → sequence-based IDs |
| eng_identifiertype | Choice `eng_identifiertype` | ✓ | Serial / ICCID / IMEI / None |
| eng_defaultcalintervalmonths | Whole number | | null = no calibration |
| eng_manualurl | URL | | |

Alternate key: `eng_manufacturer + eng_model + eng_equipmenttype`. *(Corrected 2026-09-02 — manufacturer + model
alone silently merges three real catalogue rows in which one product is classified under different equipment
types; `eng_name` carries the type in parentheses where needed to stay distinct. See `docs/08-decisions.md` and
feature 001 FR-010.)*
Seed: `data/reference/equipment_models.csv` (derived draft in `equipment_models_draft.csv` — needs Jay's cleanup, see open questions).

## eng_location — Location (reference, hierarchical)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(100) | ✓ | primary |
| eng_locationtype | Choice `eng_locationtype` | ✓ | Region / Office / Site / Vehicle / CalLab / Client / Storage |
| eng_parentlocation | Lookup → eng_location | | hierarchical relationship, self-referential |
| eng_address | Multiline | | |
| eng_latitude, eng_longitude | Decimal(9,6) | | |
| eng_isactive | Yes/No | ✓ | |

Seed (Phase 1): Region **Ontario** → Offices **Ottawa, Toronto, Sudbury, SWO**; SWO → **London, Kitchener, Waterloo, Stoney Creek**; Toronto → **Mississauga**; Ottawa → **Thunder Bay**(?) — see open questions. CalLab **Montreal Calibration**. Sites are created by the Deploy transaction (Phase 2).

## eng_project — Project (reference)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_projectnumber | Text(30) | ✓ | primary; alternate key |
| eng_name | Text(200) | ✓ | |
| eng_client | Text(200) | | |
| eng_status | Choice `eng_projectstatus` | ✓ | Active / Closed |
| eng_office | Lookup → eng_location | | |
| eng_pm | Lookup → systemuser | | |

Seed: distinct `Project ID` values in the registry export (only ~80 populated). Later: sync from the project system.

## eng_asset — Asset

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_assetid | Text(30) | ✓ | primary name; **alternate key**; immutable after create |
| eng_equipmentmodel | Lookup → eng_equipmentmodel | ✓ | |
| eng_serialnumber | Text(60) | | indexed, **not unique** |
| eng_identifiervalue | Text(60) | | ICCID / IMEI when identifiertype ≠ Serial |
| eng_homeoffice | Lookup → eng_location | ✓ | where it lives when not out |
| eng_lifecycle | Choice `eng_lifecycle` | ✓ | Active / Retired |
| eng_status | Choice `eng_assetstatus` | ✓ | `[auto]` see state machine |
| eng_currentlocation | Lookup → eng_location | | `[auto]` |
| eng_custodian | Lookup → systemuser | | `[auto]` |
| eng_currentproject | Lookup → eng_project | | `[auto]` |
| eng_parentasset | Lookup → eng_asset | | `[auto]` current parent (mirror of open Component/Kit relationship) |
| eng_lastcaldate | Date | | `[auto]` from latest eng_calibrationrecord |
| eng_nextcaldue | Date | | `[auto]` |
| eng_retirementreason | Choice `eng_retirementreason` | | Sold / Lost / Damaged / Obsolete |
| eng_notes | Multiline | | |
| eng_carrier | Choice `eng_carrier` | | Bell / Rogers — SIMs only |
| eng_phonenumber | Text(20) | | field-level security: Office Admin+ |
| eng_staticip | Text(45) | | field-level security: Office Admin+ |
| eng_migrationsource | Text(200) | | original row ref from the 2026-09 export; migration only |

Enable: auditing, change tracking, offline.

## eng_transaction — Transaction (header)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Autonumber `TXN-{SEQNUM:6}` | ✓ | |
| eng_transactiontype | Choice `eng_transactiontype` | ✓ | |
| eng_transactiondate | DateTime | ✓ | defaults now; editable for backdating by Office Admin only |
| eng_performedby | Lookup → systemuser | ✓ | defaults current user |
| eng_fromlocation / eng_tolocation | Lookup → eng_location | | |
| eng_fromuser / eng_touser | Lookup → systemuser | | |
| eng_fromproject / eng_toproject | Lookup → eng_project | | |
| eng_primaryasset | Lookup → eng_asset | | the kit parent, if this transaction defines a kit |
| eng_sitename, eng_locationdetails | Text | | Deploy only (Phase 2) |
| eng_notes | Multiline | | |
| eng_expectedreturn | Date | | Checkout only |

## eng_transactionline — Transaction Line (append-only)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Autonumber | ✓ | |
| eng_transaction | Lookup → eng_transaction | ✓ | cascade delete from header (System Owner only) |
| eng_asset | Lookup → eng_asset | ✓ | |
| eng_statusbefore | Choice `eng_assetstatus` | ✓ | snapshot at submit |
| eng_statusafter | Choice `eng_assetstatus` | ✓ | computed from transition matrix |
| eng_kitrole | Choice `eng_kitrole` | | Primary / Sensor1 / Sensor2 / Sensor3 / Sensor4 / Microphone / Modem / Cellular / Router / Accessory |
| eng_orientation | Choice `eng_orientation` | | H / V / BH / N / E / S / W (Deploy) |
| eng_powersource | Choice `eng_powersource` | | Battery / Solar / AC / External |
| eng_condition | Choice `eng_condition` | | Good / Damaged / NeedsService (Return) |
| eng_processed | Yes/No | ✓ | `[auto]` set true by the state flow; used for retry |
| eng_notes | Multiline | | |

Privileges: Field User = Create + Read. Office Admin = Create + Read. System Owner = all.
**No role has Update/Delete except System Owner.** Enforce in the security role, not just the app.

## eng_assetrelationship — Asset Relationship (dated)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_parentasset | Lookup → eng_asset | ✓ | |
| eng_childasset | Lookup → eng_asset | ✓ | |
| eng_relationshiptype | Choice `eng_relationshiptype` | ✓ | Component / Kit |
| eng_start | DateTime | ✓ | |
| eng_end | DateTime | | null = current |
| eng_createdbyline | Lookup → eng_transactionline | | which line opened it |
| eng_closedbyline | Lookup → eng_transactionline | | which line closed it |

Written only by flows (Kit) or by Office Admin (Component, via app Asset detail → "Attach component").
Business rule: a child may have at most one open relationship at a time.

## eng_calibrationrecord — Calibration Record

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_asset | Lookup → eng_asset | ✓ | |
| eng_calibrationdate | Date | ✓ | |
| eng_nextduedate | Date | ✓ | default = date + model.defaultcalintervalmonths |
| eng_lab | Lookup → eng_location (type CalLab) | | |
| eng_certificatenumber | Text(60) | | |
| eng_certificateurl | URL | | link to SharePoint file |
| eng_cost | Currency | | |
| eng_result | Choice `eng_calresult` | | Pass / Fail / Adjusted |

## Choice sets (global)

- `eng_assetgroup`: Seismographs, Communications, Acoustics, GeotechnicalMonitoring, Geomatics, Imaging, AirQuality, General
- `eng_equipmenttype`: DataLogger, Geophone, Microphone, SoundLevelMeter, AcousticCalibrator, CellularService, Modem, Router, Server, TotalStation, AutomatedTotalStation, FieldController, HDCamera, ActionCamera, Drone, DustMonitor, TiltSensor, VWReadout, MEMSSensor, AssetTracker, Other
- `eng_assetstatus`: Available, CheckedOut, Deployed, InTransit, InCalibration, NeedsRepair, Missing, Retired
- `eng_transactiontype`: Checkout, Return, Transfer, Deploy, Undeploy, SendToCalibration, ReturnFromCalibration, ReportFault, RepairComplete, MarkMissing, Found, Retire, Audit, AddToInventory
- `eng_lifecycle`: Active, Retired
- others as listed inline above.

## Status state machine

Rows = current status, columns = transaction type → new status. Blank = **not allowed** (app disables, flow rejects).

| from ↓ / txn → | Checkout | Return | Transfer | Deploy | Undeploy | SendToCal | ReturnFromCal | ReportFault | RepairComplete | MarkMissing | Found | Retire |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Available** | CheckedOut | | Available* | Deployed | | InCalibration | | NeedsRepair | | Missing | | Retired |
| **CheckedOut** | | Available | CheckedOut* | Deployed | | | | NeedsRepair | | Missing | | |
| **Deployed** | | Available | | | CheckedOut | | | NeedsRepair | | Missing | | |
| **InCalibration** | | | | | | | Available | NeedsRepair | | | | Retired |
| **NeedsRepair** | | | | | | SendToCal→InCalibration | | | Available | | | Retired |
| **Missing** | | | | | | | | | | | Available | Retired |
| **Retired** | | | | | | | | | | | | |

`*` Transfer changes location/custodian/project but not status. `Audit` and `AddToInventory` never change status.
Return from **Deployed** must also close all Kit relationships where this asset is parent.

## Asset ID minting

```
serialised:     {model.idprefix}-{serial}          DL-UM-16984, GEO-V12-30220, SLM-S50-13595
non-serialised: {model.idprefix}-{seq:04}          DST-0246, AC-0012, SRV-0016
untagged/tmp:   TMP-{seq:04}                       converted via Audit transaction, TMP id kept in eng_migrationsource
```
Sequence per prefix is stored in `eng_idsequence` (prefix, nextvalue) — a 9th tiny table, System Owner only.
Manufacturer serials that already embed the code (`UM16984`, `BE18794`) keep the digits only after the prefix:
`DL-UM-16984` not `DL-UM-UM16984`. Sigicom serials are plain numbers and are used as-is.

## Indexes

eng_asset: assetid (key), serialnumber, status, homeoffice, currentlocation, custodian, nextcaldue.
eng_transactionline: asset + createdon; transaction. eng_assetrelationship: childasset + end; parentasset + end.
