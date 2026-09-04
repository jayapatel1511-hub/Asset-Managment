# Research: Feature 011 Data Management

**Date**: 2026-09-03  
**Status**: Planning notes for Agent 011. Not product decisions.

---

## R-01 Delivery order

**Question**: What can ship before high-impact writes?  
**Decision for plan**: Read-only field dictionary, quality rule engine, issue queue and overview dashboard first — after schema/auth stabilize (CLAUDE.md sequence step 6; docs/16 §17 items 1–4).  
**Rationale**: Trust measurement does not require mutating production; it unblocks stewardship SLAs and migration cleanup visibility.  
**Alternatives rejected**: Building import/apply before a dictionary — would invent field authority ad hoc.

---

## R-02 Schema gap

**Question**: Are 011 entities in `docs/15-postgres-data-model.md`?  
**Finding**: docs/16 §14 lists `data_job`, `data_job_item`, `data_quality_rule`, `data_quality_issue`, `data_change_request`, `record_redirect`, `legal_hold`, `retention_policy`, `data_source_record`. Grep of docs/15 finds **no** matches yet.  
**Plan treatment**: `ASSUMPTION: R3` — tasks include a gate for docs/15 approval **including** these additions (or equivalent). [data-model.md](data-model.md) drafts shapes for that approval; Agent 011 does not edit docs/15.

---

## R-03 No generic editor

**Question**: Can stewards get a spreadsheet-like admin grid?  
**Decision**: No. Named commands only (constitution I/II/VIII; CLAUDE rules 14–15; FR-008).  
**Evidence**: Legacy failure mode was typing current state into static rows.

---

## R-04 Duplicate serials

**Question**: Can shared serial auto-merge?  
**Decision**: Never. Candidates only (FR-044; CLAUDE 16). Fleet has valid instrument/sensor shared serials (e.g. UM16984 pattern in constitution III).  
**Open**: OD-11 conflicting post-go-live histories — STOP gate for merge apply.

---

## R-05 Data Steward capability bundle

**Question**: Distinct role or permission set?  
**Status**: Decided (OD-2, 2026-09-04): capability bundle, not a fifth application role. R5 is also
decided: OfficeAdmin is assigned-office scoped and SystemOwner has a global row ceiling.
**Plan treatment**: Contracts speak of named stewardship capabilities inside Administration. Neither
OfficeAdmin nor SystemOwner receives the bundle automatically; D18 purpose and projection rules still
apply.

---

## R-06 Surfaces split

**Question**: Who owns admin console vs data admin?  
**Finding**: REMAINING-WORK — 011 owns data-admin capability; WS-W5 owns Console shell (docs/17 § E1–E7 gap).  
**Plan treatment**: Explicit ownership table in plan.md; UI tasks depend on Console routes.

---

## R-07 Categories and people

**Question**: Reference model for types/groups and staff?  
**Finding**: REMAINING-WORK G0.1 — categories are hierarchical curated rows; no staff table (“Add an employee” = attributes of existing Entra users).  
**Impact**: US2 reference commands include category hierarchy; US6 people sync is Entra-linked `app_user`, not a parallel HR table.

---

## R-08 Parked platforms

Power Platform and Zite are parked. 011 plans PostgreSQL + HTTP API + private Blob only.

---

## R-09 First proof relationship

011’s first **Data Management** proof is read-only dictionary + rule-driven issue queue (CLAUDE.md testing gates). The five-asset checkout race remains 009/010’s first production proof — 011 must not dilute or redefine it.
