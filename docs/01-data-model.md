# 01 — Data model

Twelve custom tables plus `eng_idsequence` (thirteen in the solution), publisher prefix `eng`. Users (custodian, performed by) are the built-in
`systemuser` table — do **not** create a staff table.

Column types use Dataverse names. "Req" = business required. `[auto]` = written only by flows.

## eng_equipmentmodel — Equipment Model (reference)

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(100) | ✓ | primary. `"{Manufacturer} {Model}"`, e.g. `Instantel Micromate` |
| eng_manufacturer | Text(100) | ✓ | |
| eng_model | Text(100) | ✓ | |
| eng_category | Lookup → eng_category | ✓ | the **leaf** category (what `eng_equipmenttype` used to hold). The asset group is derived by walking up to the root — not stored twice. *(Replaced two Choice columns 2026-09-03; see `eng_category` below)* |
| eng_idprefix | Text(20) | ✓ | e.g. `DL-UM`, `GEO-V12`, `DST`, `AC`. Used to mint Asset IDs |
| eng_isserialised | Yes/No | ✓ | No → sequence-based IDs |
| eng_identifiertype | Choice `eng_identifiertype` | ✓ | Serial / ICCID / IMEI / None |
| eng_defaultcalintervalmonths | Whole number | | null = no calibration |
| eng_isreservable | Yes/No | ✓ | default **No**. Yes → assets of this model can be booked ahead (`eng_reservation`). Admin-managed, so a total station becomes bookable without a schema change. Seeded Yes for the Vehicles group only *(added 2026-09-03)* |
| eng_manualurl | URL | | |

Alternate key: `eng_manufacturer + eng_model + eng_category`. *(Was `+ eng_equipmenttype` until
2026-09-03, when equipment type became a lookup. The correction below still applies verbatim — the key
needs the third component either way, and a Dataverse alternate key may include a lookup.)* *(Corrected 2026-09-02 — manufacturer + model
alone silently merges three real catalogue rows in which one product is classified under different equipment
types; `eng_name` carries the type in parentheses where needed to stay distinct. See `docs/08-decisions.md` and
feature 001 FR-010.)*
Seed: `data/reference/equipment_models.csv` (derived draft in `equipment_models_draft.csv` — needs Jay's cleanup, see open questions).

## eng_category — Category (reference, hierarchical) *(added 2026-09-03)*

Replaces the `eng_assetgroup` and `eng_equipmenttype` global option sets. **Categories are rows, so an
administrator can add one on a screen** — adding an option-set value was a solution deployment, which is
what made Jay's "ability to add that category" impossible. Same shape as `eng_location`: one
self-referential table, N levels, admin-managed.

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(100) | ✓ | primary |
| eng_parentcategory | Lookup → eng_category | | null = a root. Roots are what `eng_assetgroup` held |
| eng_isactive | Yes/No | ✓ | deactivate, never delete — see § Reference-data rules |
| eng_sortorder | Whole number | | display order within a parent; ties break on name |

Seed: the 9 former asset groups as roots (Seismographs, Communications, Acoustics,
GeotechnicalMonitoring, Geomatics, Imaging, AirQuality, General, Vehicles) and the 26 former equipment
types as their children. `migration/` maps each `eng_equipmentmodel` row to its leaf.

**Two levels today, not two levels forever.** A third level needs no schema change, which is the reason
for choosing the hierarchy over two flat tables.

**Reporting consequence, accepted deliberately.** `getFleetCounts` returns `byAssetGroup` and
`byEquipmentType` as flat `Record<string, number>` (`app/src/api/types.ts:235-236`). Against a hierarchy
these become *count by level-1 ancestor* and *count by leaf*. That is a real change to the reporting
domain and its tests, taken now because it is cheaper than after Power BI is authored against the flat
shape.

## eng_carrier — Carrier (reference) *(added 2026-09-03)*

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(60) | ✓ | primary. Seed: Bell, Rogers |
| eng_isactive | Yes/No | ✓ | |

Was a two-value option set (Bell / Rogers). Telus, Freedom and Videotron all sell M2M SIMs, so this is a
list that changes with a procurement decision rather than a release.

## eng_retirementreason — Retirement reason (reference) *(added 2026-09-03)*

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Text(60) | ✓ | primary. Seed: Sold, Lost, Damaged, Obsolete |
| eng_isactive | Yes/No | ✓ | |

Was an option set with no value for *Stolen* or *Written off*. Stolen and Lost are a genuine distinction
for an insurance claim.

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
| eng_retirementreason | Lookup → eng_retirementreason | | *(was a Choice until 2026-09-03)* |
| eng_notes | Multiline | | |
| eng_carrier | Lookup → eng_carrier | | SIMs only. *(was a Choice until 2026-09-03)* |
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
| eng_kitrole | Choice `eng_kitrole` | | Primary / Sensor / Microphone / Modem / Cellular / Router / Accessory. **The role *type*, which stays a fixed choice** — F1 branches on `Primary`, and `domain/installation.ts` branches on "is a sensor" |
| eng_kitroleindex | Whole number | | **1..N, unbounded.** Which sensor this is. `Sensor1…Sensor4` used to be four separate choice values, capping an array at four geophones *(decomposed 2026-09-03)* |
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

## eng_reservation — Reservation *(added 2026-09-03)*

A **future claim** on an asset. Not a status, not a transaction, not append-only.

| Column | Type | Req | Notes |
|---|---|---|---|
| eng_name | Autonumber `RSV-{SEQNUM:6}` | ✓ | primary |
| eng_asset | Lookup → eng_asset | ✓ | model's `eng_isreservable` must be Yes |
| eng_requestedby | Lookup → systemuser | ✓ | defaults current user |
| eng_starttime | DateTime | ✓ | UTC in store, `America/Toronto` on screen |
| eng_endtime | DateTime | ✓ | must be > starttime |
| eng_status | Choice `eng_reservationstatus` | ✓ | Requested / Confirmed / Cancelled / Fulfilled / Expired |
| eng_project | Lookup → eng_project | | |
| eng_pickuplocation | Lookup → eng_location | | defaults the asset's home office |
| eng_fulfilledby | Lookup → eng_transaction | | `[auto]` the Checkout that consumed it (F6) |
| eng_cancelledby | Lookup → systemuser | | |
| eng_cancelreason | Text(200) | | required when cancelled by anyone other than `eng_requestedby` |
| eng_notes | Multiline | | |

Enable: auditing, change tracking.

### Why this is not a status

`eng_assetstatus` is derived from append-only transaction lines and answers exactly one question:
*where is this asset now.* A reservation answers a different one: *who has a claim on it later.* The two
are orthogonal — an asset booked for next Tuesday is **Available today**, and may legitimately be
checked out this morning and returned Monday afternoon. Adding `Reserved` to `eng_assetstatus` would:

1. collide with the state machine (what does Checkout do from `Reserved`? what does Return do?);
2. require someone to *write* that status, which CLAUDE.md rule 1 forbids for `eng_asset`;
3. make an asset with a booking three weeks out look unavailable for three weeks.

So reservations sit beside the state machine and **advise** it. The one place they bite is checkout:
a Confirmed reservation held by *someone else* over an overlapping window refuses the checkout, in the
app and in the flow both (CLAUDE.md rule 5). Your own reservation does not refuse — it is Fulfilled.

Reservations are the one table where users edit rows rather than appending them (confirm, cancel).
That does not breach rule 1, which is about `eng_asset`'s current state; auditing is on so the edits
are recoverable.

### Overlap rule

> No two reservations for the same asset, both with status **Confirmed**, may overlap on `[starttime, endtime)`.

**Dataverse cannot declare this.** There is no exclusion constraint, so the guarantee is built in two
places, the same shape as the existing checkout concurrency check:

- **App**, on submit: re-query Confirmed reservations for the asset in the window; if any, abort and name
  the conflicting `RSV-` number and who holds it. Never silently queue.
- **Flow F6**, as arbiter: re-checks on create/confirm and rejects the loser when two confirmations land in
  the same second. The app's check is a courtesy; F6's is the guarantee.

Open: who may override or cancel someone else's booking, and what happens to a no-show —
`docs/07-open-questions.md` Q20.

## Choice sets (global)

~~`eng_assetgroup`~~ and ~~`eng_equipmenttype`~~ **are no longer option sets** — they became rows in
`eng_category` on 2026-09-03. ~~`eng_carrier`~~ and ~~`eng_retirementreason`~~ became their own reference
tables the same day. Their former values are the seeds listed with each table above.

- `eng_identifiertype`: Serial / ICCID / IMEI / None / **Plate** *(added 2026-09-03 — vehicles: VIN goes in `eng_serialnumber`, licence plate in `eng_identifiervalue`)*
- `eng_reservationstatus`: Requested, Confirmed, Cancelled, Fulfilled, Expired *(added 2026-09-03)*
- `eng_kitrole`: Primary, Sensor, Microphone, Modem, Cellular, Router, Accessory — the role **type**. The sensor *number* moved to `eng_transactionline.eng_kitroleindex` (1..N) *(2026-09-03)*
- `eng_assetstatus`: Available, CheckedOut, Deployed, InTransit, InCalibration, NeedsRepair, Missing, Retired
- `eng_transactiontype`: Checkout, Return, Transfer, Deploy, Undeploy, SendToCalibration, ReturnFromCalibration, ReportFault, RepairComplete, MarkMissing, Found, Retire, Audit, AddToInventory
- `eng_lifecycle`: Active, Retired
- others as listed inline above.

## Reference-data rules *(added 2026-09-03)*

Reference tables — `eng_category`, `eng_carrier`, `eng_retirementreason`, `eng_location`,
`eng_equipmentmodel`, `eng_project` — are **maintained in the app by an administrator**, not loaded from
a CSV and frozen. `data/reference/*.csv` are seeds for the initial load only (CLAUDE.md rule 4).

Three rules the Console surface must enforce, because the store cannot:

1. **Deactivate, never delete.** Every reference table carries `eng_isactive` (or `eng_status` for
   projects). A deleted row orphans every asset, transaction line and calibration record pointing at it;
   a deactivated one keeps history readable and simply stops appearing in pickers. **No role except
   System Owner gets Delete on a reference table.**
2. **Show the usage count first.** Before deactivating or renaming, the screen states how many rows
   reference it ("312 assets are in this category"). This is what CLAUDE.md's "ask before changing a
   choice value that is already referenced by data" becomes once the values are rows.
3. **Audit the reference tables.** Auditing was specified for `eng_asset`, `eng_assetrelationship` and
   `eng_calibrationrecord` only. Extend it to all six above: once an admin can re-parent an office or
   rename a category, "who changed this, when" has to be answerable. See `docs/17-ux-audit.md` E4.

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

**Vehicles use this table unchanged.** A pickup truck signs out, returns and transfers exactly like a data
logger — nothing in the transaction model knows what kind of thing it is moving. Vehicles add no columns and
no statuses; they add choice values and, if their model is flagged reservable, bookings.

`*` Transfer changes location/custodian/project but not status. `Audit` and `AddToInventory` never change status.
Return from **Deployed** must also close all Kit relationships where this asset is parent.

## Asset ID minting

```
serialised:     {model.idprefix}-{serial}          DL-UM-16984, GEO-V12-30220, SLM-S50-13595
non-serialised: {model.idprefix}-{seq:04}          DST-0246, AC-0012, SRV-0016
untagged/tmp:   TMP-{seq:04}                       converted via Audit transaction, TMP id kept in eng_migrationsource
```
Sequence per prefix is stored in `eng_idsequence` (prefix, nextvalue) — a 10th tiny table, System Owner only.
Manufacturer serials that already embed the code (`UM16984`, `BE18794`) keep the digits only after the prefix:
`DL-UM-16984` not `DL-UM-UM16984`. Sigicom serials are plain numbers and are used as-is.

## Indexes

eng_asset: assetid (key), serialnumber, status, homeoffice, currentlocation, custodian, nextcaldue.
eng_transactionline: asset + createdon; transaction. eng_assetrelationship: childasset + end; parentasset + end.
