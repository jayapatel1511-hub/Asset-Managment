# 00 — Brief

## Problem

Equipment is tracked in SharePoint Lists and Excel that were designed for static data but are edited
continuously to reflect status, location and assignment. Result: duplicates, missing records, no movement
history, calibration data that cannot be joined to assets.

Measured on the 2026-09-02 export (`data/source/registry_2026-09-02.csv`, 1,053 rows):

| Finding | Count |
|---|---|
| Duplicated Asset IDs | 29 (8 are the same asset listed in two offices) |
| Blank / prefix-only Asset IDs (`GEO-`, `DL-`) | 27 |
| Serial shared across different equipment types (logger + sensor) | 132 serials |
| Same serial, same type, two rows (true duplicates) | 9 |
| Rows without serial | 26% |
| Rows without manufacturer | 22% (and column contains model names) |
| Calibration rows in registry | 2% populated; separate sheet has 253 rows with **no Asset ID** |
| Availability status blank | 121; "Deployed or NOT Available" used as a catch-all for 644 |
| Office values | 10 (SWO coexists with London/Kitchener/Waterloo/Stoney Creek) |

## Goal

A single source of truth that answers, in under 10 seconds, from a phone or a browser:

1. What do we own?
2. Where is asset X right now?
3. Who has asset X?
4. What is available at office Y?
5. What needs calibration in the next N days?
6. What is assigned to project Z?
7. Where was asset X on date D, and what was attached to it?

These seven questions are the acceptance tests. Each must be answerable from the app (1–6) or from a
single Power BI page (1–7) using only data the system captured through transactions.

## Users

| Role | Count (est.) | Does |
|---|---|---|
| Field technician | 25–45 | search, checkout, return, transfer, deploy kit, view history — often on a phone, sometimes offline |
| Office admin | 4–8 (1–2 per office) | everything above + add/retire assets, record calibrations, run audits, edit reference data |
| System owner | 1–2 | everything + roles, flows, solution |
| Manager / PM | many | reads Power BI only; no app licence |

## Scope

**In (Phase 1 — MVP):** reference tables, Asset, Transaction + Lines, Asset Relationship, Calibration Record;
Code App with Search, Asset detail + history, Checkout, Return, Transfer, Calibration Due list;
flows that derive current state; migration of the existing inventory; Power BI page answering questions 1–7.

**In (Phase 2):** Deploy/Undeploy kit screen with site details, Calibration record screen + certificate
upload to SharePoint, Audit screen (verify/complete untagged assets), Teams/email notifications.

**Out (separate initiative — "Ontario Instrumentation Hub"):** vendors, POs, quotes, SOP library,
PCS forms, vehicle booking, purchasing/budget, regional comms pages.

## Constraints

- Microsoft 365 tenant only. No external hosting, no custom database.
- Data residency: Canada.
- Must be maintainable by a successor who is a competent Power Platform admin, not a developer:
  everything ships in one solution, every flow has a README, the app has a `docs/` folder.
- Bilingual labels are a Phase 3 consideration; design string tables so French can be added.

## Success criteria for Phase 1 go-live (pilot: Ottawa)

- 100% of Ottawa assets migrated with a valid Asset ID (no blanks, no duplicates).
- Every calibration record from the old sheet either linked to an asset or listed in `migration/unmatched_calibrations.md`.
- 20 real checkouts/returns performed by technicians in the pilot month with zero manual edits to `eng_asset`.
- Questions 1–7 answered live in a review meeting.
