# Production Readiness Requirements Checklist

**Feature:** `009-production-readiness`  
**Purpose:** Review gate before a plan, tenant implementation or pilot approval is accepted.

## Transaction integrity

- [ ] CHK001 One authoritative synchronous operation owns each state-changing business event.
- [ ] CHK002 Multi-asset header, lines, derived fields and relationships commit together or not at all.
- [ ] CHK003 The server reloads every affected asset and open relationship at submission time.
- [ ] CHK004 One invalid asset refuses the complete multi-asset request.
- [ ] CHK005 Before/after snapshots and side effects are server-computed.
- [ ] CHK006 Concurrent incompatible requests are arbitrated at the server.
- [ ] CHK007 A unique client submission identifier is enforced.
- [ ] CHK008 Same identifier/same payload returns the original result; changed payload is refused.
- [ ] CHK009 Accepted transaction headers and lines are immutable.
- [ ] CHK010 Corrections are compensating events that reference the original.
- [ ] CHK011 Asynchronous flows are reconciliation/alerting paths, not normal partial application.

## State and identity

- [ ] CHK012 Lifecycle, disposition, serviceability and calibration currency are independently representable.
- [ ] CHK013 Fault/repair actions preserve valid custody, project and location facts.
- [ ] CHK014 Availability uses all required dimensions rather than one catch-all status.
- [ ] CHK015 Every disposition, including transit and missing/found, has complete entry and exit paths.
- [ ] CHK016 Asset ID sequence allocation and asset creation occur in one server operation.
- [ ] CHK017 No browser path uses elevated service identity to update the sequence.
- [ ] CHK018 Temporary and legacy tags are searchable aliases.
- [ ] CHK019 Canonical Asset ID is immutable after assignment.

## Calibration and components

- [ ] CHK020 Current calibration dates use the latest qualifying record by calibration date.
- [ ] CHK021 Failed calibration does not advance due date or return equipment to service.
- [ ] CHK022 Correction, reassociation, replacement and voiding recalculate current dates.
- [ ] CHK023 Legacy due-only records are represented without an invented calibration date.
- [ ] CHK024 Physical receipt from the lab is distinguished from recording evidence unless one action confirms both.
- [ ] CHK025 Q18 permanent-component calibration behavior is approved and reflected consistently.
- [ ] CHK026 Damage, missing, retirement, replacement and overdue behavior are defined for permanent components.

## Security, cache and reporting

- [ ] CHK027 All authorization rules pass direct API tests independent of the app.
- [ ] CHK028 Administrator scope is explicitly global or enforced by office at the data/server layer.
- [ ] CHK029 Relationship cycles, self-parenting, second open parent and historical edits are refused server-side.
- [ ] CHK030 Routine automation uses a least-privilege role.
- [ ] CHK031 Cache and queues are partitioned by environment and signed-in user.
- [ ] CHK032 Identity change prevents access to and replay of the prior user's data.
- [ ] CHK033 Field-user local storage contains no secured SIM/network attributes.
- [ ] CHK034 Ordinary manager reporting contains no secured SIM/network columns.
- [ ] CHK035 Manager reporting works without opening the Code App.
- [ ] CHK036 Report identity, authorization, recipients and licensing are approved and tested.

## Hosted device verification

- [ ] CHK037 Published iOS online-to-offline behavior is recorded.
- [ ] CHK038 Published Android online-to-offline behavior is recorded.
- [ ] CHK039 Cold reopen and device restart behavior are recorded.
- [ ] CHK040 Authentication expiry and identity-change cases pass.
- [ ] CHK041 Camera permission denied/granted/interrupted cases pass.
- [ ] CHK042 Conflict replay remains visible and is never silently discarded.
- [ ] CHK043 Any unsupported offline behavior is removed from pilot acceptance criteria.

## Migration, release and recovery

- [ ] CHK044 Rehearsal snapshot, final delta, freeze time and legacy read-only transition are documented.
- [ ] CHK045 Every post-rehearsal source change is loaded or reported.
- [ ] CHK046 Ambiguous calibration evidence remains unmatched until confirmed.
- [ ] CHK047 Model-review and conflict-report sign-offs block production load when absent.
- [ ] CHK048 Final source/staged/target reconciliation accounts for every difference.
- [ ] CHK049 App rollback, platform recovery and data recovery are separate procedures.
- [ ] CHK050 Recovery objectives, backup ownership and restore tests are approved.
- [ ] CHK051 Calibration certificate retention and restore pass a rehearsal.

## Status and evidence

- [ ] CHK052 Feature status uses the approved maturity vocabulary.
- [ ] CHK053 No feature is called production-built while tenant or verification work is stubbed.
- [ ] CHK054 Every gate has a named owner, date, evidence link and pass/fail result.
- [ ] CHK055 All seven programme acceptance questions are answered from tenant data before Production Accepted.