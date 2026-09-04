# Contract: Cutover reconciliation (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: WS-W11 migration outputs; PostgreSQL loader and reconciliation reports (build under 010/migration —
009 does not redefine loader schemas)  
**Workstream**: WS-W11 produces; **WS-W12** accepts evidence  
**Spec mapping**: US6; FR-036–FR-039; SC-012  
**Related**: Migration Rehearsed maturity level

## Purpose

Acceptance checklist for migration rehearsal and final cutover readiness. Ambiguous calibration must stay
unmatched until human confirmation. Missing model-review or conflict-report sign-off **blocks**
production load.

## Checklist

### Before rehearsal

- [ ] C1 Source profile and cleaning reports current; `data/source/` treated read-only
- [ ] C2 Target schema/migrations approved for load subset (R3 awareness)
- [ ] C3 User resolution strategy (Entra / directory id) documented
- [ ] C4 Synthetic data markers verified — synthetic refused in production-bound environments (constitution)

### Rehearsal snapshot

- [ ] C5 Rehearsal snapshot identifier, timestamp and environment recorded
- [ ] C6 Full load into UAT (or approved rehearsal DB) completes with row counts
- [ ] C7 Source → staged → target reconciliation report accounts for every source row (SC-012)
- [ ] C8 Second run produces empty business diff (idempotent load)
- [ ] C9 Ambiguous calibration records listed and **unmatched** pending confirmation (FR-038)
- [ ] C10 Conflict report reviewed; open conflicts owned

### Sign-offs (hard gates)

- [ ] C11 Model-review sign-off recorded (named approver + date) — **absent ⇒ block production load** (FR-039)
- [ ] C12 Conflict-report sign-off recorded — **absent ⇒ block production load**

### Delta and freeze

- [ ] C13 Freeze time and legacy read-only transition procedure named with owner
- [ ] C14 Every post-rehearsal source change included in traceable delta **or** reported with reason (FR-037)
- [ ] C15 Final delta reconciliation differences explained; none silent
- [ ] C16 Rollback criteria written (when to abort cutover)
- [ ] C17 Physical stock-validation sample plan recorded (pilot)

### Post-load honesty

- [ ] C18 App rollback procedure distinct from data restore (see `recovery-drill.md`)
- [ ] C19 No claim of Migration Rehearsed until C5–C15 pass with artifacts retained

## Evidence record (required)

| Field | Content |
|---|---|
| `contract` | `cutover-reconciliation` |
| `rehearsal_id` | Snapshot / run id |
| `counts` | source / staged / target / unmatched calibration |
| `sign_offs` | model-review + conflict-report links |
| `delta_report` | artifact link |
| `freeze_plan` | artifact link |
| `owner` / `ran_at` / `result` | pass \| fail \| blocked |
| `blockers` | missing sign-off or unexplained diffs |

## Non-claims

- A frozen historical staged JSON from an old date is not a future cutover plan by itself.
- Reducing unmatched calibration by auto-attaching ambiguous rows fails this contract.
