# Clarifications — decisions needed before planning

**Created**: 2026-09-02
**Owner**: Jay Patel (System Owner)
**Status**: 5 resolved 2026-09-02, 8 open. **Q4 is the critical path.**

Per the constitution's Development Workflow, a `plan.md` is not written for a feature while a blocking
`[NEEDS CLARIFICATION]` marker in its spec is open. That is why `specs/001-*` through `specs/004-*`
currently hold `spec.md` and a requirements checklist but no plan — the specs are complete and
reviewable, the plans are gated.

Each question below states what is actually at stake, gives a recommended answer, and names what
changes if the answer differs.

**Resolved on 2026-09-02** — Q1, Q2, Q3, Q5, Q7 and Q13. Their sections below are retained with the
decision recorded, because the reasoning matters later. Q1 is worth reading even though it is closed:
it was answered with a requirement rather than a placement, which dissolved the blocker instead of
resolving it.

**Q4 is now the only thing on the critical path.** Feature 002 fails its entire migration run on an
unresolved equipment model — deliberately, so nothing loads with a guessed classification. Nothing
migrates until the catalogue is corrected, and unlike the rest of this list it is data work rather
than a decision, so it takes elapsed time.

---

## Critical path — blocks migration and schema

### Q1. Is SWO an office or a region? — RESOLVED

**Evidence**: 113 asset rows record `SWO` as their office. A further 155 record London (56), Kitchener
(51), Stoney Creek (35) or Waterloo (13). All five values coexist in the same column.

**At stake**: The home office of 268 assets — a quarter of the fleet. Migration cannot map offices
until this is settled (`FR-006` fails the run on an unmapped value), and availability lists are wrong
in either direction if this is guessed.

**Recommendation**: SWO is a **region** containing London, Kitchener, Waterloo and Stoney Creek. The
113 rows recording only `SWO` get home office **London** as the largest of the four, and appear on the
completion queue so a technician can correct any that are actually elsewhere.

**If it is instead an office**: London, Kitchener, Waterloo and Stoney Creek become sibling offices
under Ontario, the four-office admin structure in `data/reference/office_admins.csv` grows to eight,
and calibration reminders fan out accordingly.

**DECIDED**: Neither option. Jay: *"we need ability to add offices that we need, it can be n numbers."*
The hierarchy supports an unbounded number of offices at any level, added and re-parented by
administrators in the app, with no fixed office list anywhere — not in the schema, the automation, or
the notification configuration. Migration therefore seeds all ten distinct source office values as
offices under Ontario, one for one with no inference, and SWO is re-parented on a screen afterwards.
This is better than either option offered: no asset receives a guessed home office, and the structure
stays changeable as the business changes. See FR-011a to FR-011c in feature 001.

~~**Blocks**: 001 (CHK001), 002 (CHK001)~~ — no longer blocking.

---

### Q3. How do the 644 unknown-state assets migrate? — RESOLVED

**Evidence**: 644 of 1,053 rows carry `Deployed or NOT Available` — 61% of the fleet. The row tells us
the asset is not in the office. It does not tell us where it is, who has it, or since when. Only 87
rows name any staff member at all.

**At stake**: The credibility of day one. Migrating these as Available claims 644 assets are on the
shelf when they are not, and the first technician to pack from that list loses confidence in the
system. Migrating them as CheckedOut is honest but leaves 61% of the fleet with a custodian of
"unknown", and — because `FR-025` restricts returns to the custodian or an administrator — an
administrator must perform those returns as they come back.

**Recommendation**: Migrate as **CheckedOut with no custodian**, and run a one-week "return anything
you are not holding" sweep during the Ottawa pilot. The sweep is the point: it converts an unknown
inherited from the spreadsheet into a known, recorded fact, and it does so through the normal return
path rather than through a data fix.

**If Available instead**: Day-one availability lists are wrong by up to 644 assets, and each error is
discovered by a technician in a storage room rather than by an administrator at a desk.

**DECIDED**: CheckedOut with no custodian, plus the one-week pilot sweep. The consequence is accepted:
because FR-025 restricts returns to the custodian or an administrator, and these assets have no
custodian, an administrator performs the sweep's returns. Feature 002's FR-015a supplies the checklist.

~~**Blocks**: 002 (CHK002), 003 (CHK004)~~ — no longer blocking.

---

### Q4. Correct the equipment model catalogue — OPEN, CRITICAL PATH

**Evidence**: `data/reference/equipment_models_draft.csv` holds 65 rows derived directly from the
source data, including its errors:

| Row | Problem |
|---|---|
| Larson Davis 831C | Prefixed `DST-LD` — the SIM prefix. It is a sound level meter |
| `Series IV`, `Minimate Pro`, `Settop M1`, `Instantel` | Model names sitting in the Manufacturer column |
| Sigicom V12 | Typed as Data Logger in 4 rows; it is a geophone |
| `Air Quailty Monitroing` | Misspelled asset group |
| `Geohpone` | Misspelled equipment type, 6 rows |
| Every row | No default calibration interval set |

**At stake**: The single largest dependency in the programme. `FR-005` in feature 002 fails the entire
migration run on any asset that cannot be resolved to a curated model — deliberately, so that nothing
loads with a guessed classification. Nothing can be migrated until this file is right. And with no
calibration intervals, feature 004 cannot prefill a due date, so every calibration record needs one
typed by hand.

**Recommendation**: Correct the file in place. Two things are needed per row: the correct manufacturer,
model, type, group and prefix; and a default calibration interval in months, or an explicit "not
calibrated". A first guess for the intervals — 12 months for Instantel and Sigicom loggers and sensors
— needs confirming, and sound level meters, acoustic calibrators and total stations may each follow a
different regime.

**This is data work, not a decision.** It is also the one item on this list that cannot be answered in
a sentence, so it should start first.

**Blocks**: 001 (CHK003), 002 (CHK003), 004

---

## Secondary — blocks specific features

### Q2. Where do Mississauga and Thunder Bay sit? — RESOLVED

**Evidence**: Mississauga 22 rows, Thunder Bay 3 rows. `data/reference/locations.csv` currently guesses
Mississauga under Toronto and Thunder Bay under Sudbury, both flagged.

**Recommendation**: Confirm Mississauga under Toronto. Thunder Bay, at 3 assets, is likely served by
Sudbury — confirm or move.

**DECIDED**: Dissolved by Q1's answer. Both are seeded flat under Ontario and re-parented by an admin
whenever the right structure is known.

~~**Blocks**: 001 (CHK002)~~ — no longer blocking.

---

### Q5. Is a sound level meter one asset or three? — RESOLVED

**Evidence**: A pre-amp and a microphone element are calibrated separately from the meter body and
carry their own certificates. The source data has `Pre Amp Serial` and `Element Serial` columns —
populated in 3 rows out of 1,053.

**At stake**: Whether the fleet holds roughly 1,050 or roughly 1,150 assets, and whether acoustic
calibration compliance is fully trackable or partly invisible. If pre-amps and elements are not
separate assets, their calibration cannot be recorded against anything.

**Recommendation**: Give them their own Asset IDs, attached to the meter as permanent **components**.
They move with the meter automatically and never appear in a checkout cart, but they can hold their
own calibration records and certificates.

**If one asset instead**: Acoustic calibration is tracked at the meter level only, and a separately
calibrated element's certificate has nowhere to live.

**DECIDED**: Separate Asset IDs, attached as permanent Components. Fleet is roughly 1,150 assets.
Note the consequence for feature 004: a due list will show a pre-amp due while its meter is not, and
the admin must be able to see that the two travel together. Note also for feature 002: only 3 source
rows carry a pre-amp or element serial, so most of these assets will be created by field completion
under US4 rather than by the load — migration creates what the source records, not what it lacks.

~~**Blocks**: 001 (CHK005), 004~~ — no longer blocking.

---

### Q6. Are the servers assets or configuration?

**Evidence**: 16 rows across `Azure` (13), `THOR`, `Vision`, `INFRANet`. No serials. One is
manufactured by "Microsoft".

**At stake**: Whether an asset registry contains cloud services. `Azure` is not equipment.

**Recommendation**: Keep them as assets of type Server, non-serialised, never checked out, referenced
only as a kit role on a deployment — *if* they are physical machines or appliances. If `Azure` denotes
a hosted endpoint rather than a box, exclude those 13 rows from the registry entirely and record them
wherever infrastructure is documented.

**Blocks**: 001 (CHK004)

---

### Q7. Does a SIM live in one modem, or move between them? — RESOLVED

**Evidence**: 232 SIM records, 248 communications assets. 171 carry a carrier, 127 an ICCID, 129 a
phone number.

**At stake**: Whether a SIM is a permanent **component** of a modem — moving with it automatically,
never separately transacted — or a **kit member** issued per deployment and recorded on every
deployment form. This changes the data model, the deployment screen, and whether a technician ever sees
a SIM in a picker.

**Recommendation**: If a SIM is fitted once and stays, make it a component. If it is swapped between
modems as projects need, make it a kit member. The current data cannot distinguish these, and the
answer is operational knowledge.

**DECIDED**: Permanent Component of its modem. It moves with the modem automatically, is never
separately transacted, never appears in a checkout cart (FR-026), and leaves the deployment form
entirely. A deliberate swap remains possible as an administrative attach/detach under FR-032a.

~~**Blocks**: 003 (CHK001), 005~~ — no longer blocking.

---

### Q8. Is expected return required on checkout?

**At stake**: Overdue-return notification only covers checkouts that carry a date. Requiring it makes
the notification reliable and adds a field to the most frequent operation in the business; making it
optional means the notification covers part of the fleet.

**Recommendation**: **Optional**, with a default of 14 days offered but skippable. A required field on
the highest-frequency screen will be filled with whatever dismisses the keyboard fastest, which is
worse than an honest blank.

**Blocks**: 003 (CHK002)

---

### Q9. May administrators backdate a transaction?

**At stake**: Entering last Friday's return on Monday is a real need. But backdating across an existing
later transaction produces a history that does not replay cleanly, which breaks the past-state
reconstruction that acceptance question 7 depends on.

**Recommendation**: Permit, **administrators only, up to 30 days**, and **refuse** a backdated
transaction that would land before an existing transaction for the same asset. The refusal message
should name the conflicting transaction so the administrator can record a compensating entry instead.

**Blocks**: 003 (CHK003)

---

### Q10. Is there a project master to sync from?

**Evidence**: 79 rows carry a Project ID. `Project Name` is empty in all 1,053 rows.

**At stake**: Whether feature 001's project screens are create-and-edit or read-only-plus-refresh. Also
whether `FR-027`'s inactive-project rule can be trusted — it needs a reliable project status from
somewhere.

**Recommendation**: Seed from the 79 distinct IDs and let administrators add, unless an ERP or project
system can export active project numbers, in which case sync and make the table read-only.

**Blocks**: 001 (CHK006)

---

## Later

### Q11. Who needs report access?

Feature 006 serves managers and project managers who will not have an application licence. The
recipient list determines the distribution mechanism and the licence cost. Needed before feature 006,
not before planning starts.

**Blocks**: 006

---

### Q12. French labels — now or later?

Ontario-only for Phase 1. The constitution requires strings to live in string tables from the first
screen so that adding French later is not a rewrite, which means no decision is needed now — only
confirmation that Phase 1 ships in English.

---

### Q13. How long are retired assets kept? — RESOLVED

**Recommendation**: Indefinitely. The fleet is small, the history is text, and a damage claim can
arrive years after an instrument is sold. An archive policy is a decision to make when storage or
retention policy demands it, not a default to build in now.

**DECIDED**: Indefinite.

~~**Blocks**: 001 (CHK007), 002 (CHK004)~~ — no longer blocking.

---

## What happens when these are answered

| Still needed | Unblocks |
|---|---|
| **Q4**, Q6, Q10 | `specs/001-asset-registry/plan.md` |
| **Q4** *(only)* | `specs/002-inventory-migration/plan.md` |
| Q8, Q9, inactive-project rule | `specs/003-asset-transactions/plan.md` |
| **Q4**, reminder cadence | `specs/004-calibration-management/plan.md` |
| Site-coordinate scope | `specs/005-deployment-and-kits/plan.md` |
| Q11 | `specs/006-fleet-reporting/plan.md` |

Q4 alone unblocks feature 002 completely, and it is the programme's critical path. Q8, Q9 and the
inactive-project rule are one short conversation and unblock feature 003.

Answers are recorded in `docs/08-decisions.md` with date and rationale, the corresponding
`[NEEDS CLARIFICATION]` markers are removed from the specs, and the checklist gates are checked.
