# Clarifications — decisions needed before planning

**Created**: 2026-09-02
**Owner**: Jay Patel (System Owner)
**Status** (refreshed 2026-09-03): Resolved include Q1–Q3, Q5, Q7–Q9, Q13. Q4 done as data work
awaiting Jay's read-through. Still needing confirmation: Q6, reminder cadence, inactive-project rule.
Open: Q10–Q12, Q14–Q16, Q18. Q17 closed by Power Platform parking. **R1–R4 readiness blockers are
closed; Q4/conflict-report sign-offs remain on the production load path.**

Per the constitution's Development Workflow, a `plan.md` is not written for a feature while a blocking
`[NEEDS CLARIFICATION]` marker in its spec is open. **That gate was waived once**, on 2026-09-02, by
the System Owner (see `README.md` § Blocking clarifications): features 001–006 were built on each open
item's recorded recommendation, marked `// ASSUMPTION` in code and logged in `docs/08-decisions.md`.
`specs/001-*` through `specs/004-*` therefore still hold `spec.md` and a requirements checklist but no
plan; 005 and 006 have plans; 008 gained one on 2026-09-02; 007 does not yet have one and the gate
applies to it normally.

Each question below states what is actually at stake, gives a recommended answer, and names what
changes if the answer differs.

**Resolved on 2026-09-02** — Q1, Q2, Q3, Q5, Q7 and Q13. Their sections below are retained with the
decision recorded, because the reasoning matters later. Q1 is worth reading even though it is closed:
it was answered with a requirement rather than a placement, which dissolved the blocker instead of
resolving it.

**Q4 is done.** Feature 002 fails its entire migration run on an unresolved equipment model —
deliberately, so nothing loads with a guessed classification — and that is why the catalogue was
corrected first: 35 of 64 draft rows fixed and calibration intervals set, reviewable in full at
`migration/reports/03_models_review.md`. It is a sign-off now, not a blocker.

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

### Q4. Correct the equipment model catalogue — DONE 2026-09-02, AWAITING SIGN-OFF

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

**DONE**: executed as data work under the System Owner's waiver. 35 of 64 rows corrected (prefixes,
swapped manufacturer/model columns, misspellings, Sigicom V12 retyped as Geophone), intervals set or
explicitly nulled, and the SLM pre-amp and element added as permanent Component models per Q5. The
review file is `migration/reports/03_models_review.md`; the migration ran clean against it. **Jay's
read-through of that file is one of the two hard gates before a production load** (with
`02_conflicts.md`, feature 002 FR-026).

~~**Blocks**: 001 (CHK003), 002 (CHK003), 004~~ — no longer blocking the build; gates production.

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

**Proceeded on** (2026-09-02, `docs/08-decisions.md`): the 13 `Microsoft/Azure` rows excluded from
the registry as configuration; the 3 named appliances (`Vision`, `Vision II`, `INFRANet`) kept as
physical Server assets. Needs Jay's confirmation, not a fresh decision.

**Blocks**: 001 (CHK004) — confirmation only

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

**Proceeded on** (2026-09-02, `docs/08-decisions.md`): optional, prefilled at +14 days, editable and
clearable — the recommendation exactly.

**Confirmed** (2026-09-03, Jay — R4 readiness update): same rule stands for production.

**Blocks**: none — confirmation closed.

---

### Q9. May administrators backdate a transaction?

**At stake**: Entering last Friday's return on Monday is a real need. But backdating across an existing
later transaction produces a history that does not replay cleanly, which breaks the past-state
reconstruction that acceptance question 7 depends on.

**Recommendation**: Permit, **administrators only, up to 30 days**, and **refuse** a backdated
transaction that would land before an existing transaction for the same asset. The refusal message
should name the conflicting transaction so the administrator can record a compensating entry instead.

**Decided** (2026-09-03, Jay — R4): recommendation adopted. `recorded_at` = server receive time;
`effective_at` may be backdated under the rules above.

**Blocks**: none — closed.

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

## Added 2026-09-02

### Q14. May the synthetic dataset be loaded into `Englobe-AMS-Dev`?

**At stake**: Feature 007 US5 — exercising flows F1–F5 and the Power BI model against twenty years
of fictional history before any production history exists. Every synthetic row carries a marker
naming its seed, so bulk removal by marker is mechanical. `CLAUDE.md` requires asking before
anything that deletes data in Dev, which the removal step does. Production is excluded outright by
the spec (FR-009).

**Recommendation**: Yes, with the loader refusing any environment other than a development one, and
removal by marker permitted.

**Blocks**: 007 US5 only. US1–US4 are entirely local.

---

### Q15. Fictional identities under the real e-mail domain, or a placeholder domain?

**At stake**: A placeholder domain reads as broken in a demo; the real domain risks a fictional
name colliding with a real employee outside the registry's Staff column, which is all the generator
can check against.

**Recommendation**: Real domain, following the three demo identities the app already ships with.
*Proceeded on by WS-G.*

**Blocks**: 007 (confirmation only)

---

### Q16. May the synthetic catalogue add one real modem model?

**At stake**: The real catalogue has 232 SIMs and no modem, yet Q7 decided a SIM is a permanent
Component of its modem. Without a modem model the decided pattern cannot exist in the synthetic
fleet.

**Recommendation**: Yes — one real, publicly documented, commonly paired modem, listed in the
manifest as a catalogue extension (007 FR-031). Alternatively an admin adds the real modem models to
`equipment_models.csv` first, which is the better long-term answer anyway. *Proceeded on by WS-G.*

**Blocks**: 007 (confirmation only)

---

### Q17. Per-app or Premium licensing for code apps?

**Evidence**: `docs/08-decisions.md` has carried this as an OPEN row since 2026-09-02 with no owner
and no question number. The code-apps documentation says every end user needs Power Apps Premium;
the Dataverse licensing documentation says "per app or per user". Two Microsoft sources disagree.

**At stake**: Roughly four times the programme's dominant cost — on the order of $5 versus $20 per
user per month across some 45 users.

**Recommendation**: Ask the reseller for a written answer citing the current SKU terms before Step 0
commits to a count. Pilot on Premium for Ottawa only if the answer is slow.

**Blocks**: `docs/06-delivery-plan.md` Step 0 licensing

---

### Q18. How does a permanent component reach the calibration lab without its parent?

**Evidence**: Q5 decided the SLM pre-amp and element are separate assets, calibrated separately,
each with its own due date and certificate. Q7 decided a SIM is a permanent Component of its modem.
Feature 003 FR-032 says a permanent component carries no lines of its own — the parent's line is its
history — and FR-026 keeps it out of checkout. Feature 004 US3 sends instruments to the lab by
transaction. Feature 007 FR-019 hardens this to "no transaction line of its own after registration,
mirrors its parent". Nothing anywhere says how a pre-amp gets to Montreal while its meter stays in
Ottawa.

**At stake**: Every separately calibrated component, every year. Without an answer the admin must
detach the component (003 FR-032a), despatch it, and re-attach it on return — three administrative
actions for a routine event — or the component's lab visit goes unrecorded and the due list lies.
The synthetic generator has to produce whichever sequence is true.

**Recommendation**: Allow exactly one component-level transaction pair, SendToCalibration and
ReturnFromCalibration, on a permanent component: its location becomes the lab and its parent is
unaffected. While a component is InCalibration, the parent-to-component mirroring in 003 FR-032 must
skip it, and its parent's due list must show the component as away. Everything else about
components stays as decided.

**If detach/despatch/re-attach instead**: no state-machine change, but three admin steps per
calibration and a relationship history that ends and restarts annually for reasons that have nothing
to do with the equipment.

**Blocks**: 003 FR-032b, 004 FR-021, 007 FR-019 — all marked `[NEEDS CLARIFICATION: Q18]`

---

## What happens when these are answered

| Still needed | Gates |
|---|---|
| Q4 read-through, `02_conflicts.md` sign-off | The production load (feature 002 FR-026) |
| Q6, reminder cadence, inactive-project rule | Confirming — or reversing — what the build proceeded on |
| ~~Q8~~ / ~~Q9~~ | **Closed 2026-09-03** (R4) |
| Q10–Q12, Q14–Q16, Q18 | Still open; not on five-asset race critical path |
| Q10, Q11, Q12 | Phase 2/3 scope; Q11 also decides Power BI reader licensing |
| Q14 | 007 US5, the Dev load |
| Q15, Q16 | 007 generator inputs — proceeded on the recommendation |
| Q17 | Step 0 licensing purchase |
| Q18 | 003/004 component-despatch rule; what 007 FR-019 generates |

Answers are recorded in `docs/08-decisions.md` with date and rationale, the corresponding
`[NEEDS CLARIFICATION]` markers are removed from the specs, and the checklist gates are checked.
