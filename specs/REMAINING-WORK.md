# Remaining work — production-readiness workstream map

**As of 2026-09-02**, after the local/mock build and independent production review.

Read, in order:

1. `specs/AGENT-BRIEF.md`
2. `.specify/memory/constitution.md`
3. `docs/13-production-readiness-review.md`
4. `specs/009-production-readiness/spec.md`
5. `specs/009-production-readiness/checklists/requirements.md`
6. `docs/06-delivery-plan.md`

The previous workstream map optimized parallel local feature construction. That phase produced useful
mock implementation and is preserved in `docs/09-build-report.md`. The remaining critical work is not
more local screens; it is proving the production architecture in a real development tenant.

## Current status

- Features 001–006: **Mock Implemented**
- Feature 007: re-check the branch and tests before claiming its current state
- Feature 008 US1: **Mock Implemented** release guard
- Feature 009: **Spec Draft** and production gate
- Real data-platform backend: stub/incomplete
- Real schema and security roles: not approved or created from the canonical post-review model
- Hosted scanner/offline behavior: not verified
- Power BI manager report: not published or security-verified
- Pilot: not approved

## The serial gate — do this first

Do not run schema, backend and flow agents in parallel until the following architecture contract is
approved. They all otherwise encode different assumptions into the most expensive-to-change layer.

### G0.1 Product decisions

Record in `docs/08-decisions.md`:

- Q6 server/configuration treatment
- Q8 expected return
- Q9 backdating
- Q10 project source
- Q11 reporting audience/licensing
- Q18 permanent-component calibration
- global versus office-scoped administrator
- permanent home-office rehome workflow
- failed calibration versus physical lab receipt
- structured ownership categories

### G0.2 State model

Approve how the system independently represents:

- lifecycle;
- physical disposition;
- serviceability; and
- calibration currency.

Re-run every current transition and report rule against that model. Do not create the real Asset table
with the old catch-all status before this is settled.

### G0.3 Authoritative command contract

Create the technology-neutral contract for one state-changing event:

- caller and authorization context;
- client submission identifier;
- event type and effective time;
- complete asset/item inputs;
- server-loaded current state;
- required validation;
- calculated before/after snapshots;
- relationship effects;
- all-or-nothing result;
- refusal codes;
- retry/idempotency behavior; and
- correction/reversal behavior.

The first proof is a five-asset checkout. Feature 009 SC-001 to SC-005 must pass before any other
production write path is accepted.

### G0.4 Canonical schema

Produce one versioned data model covering all features, including:

- Asset Identifier/Alias;
- whole-event transaction status and idempotency fields;
- Installation and Installation Component;
- Office Administrator Assignment;
- notification state/history if threshold suppression needs persistence;
- structured ownership;
- permanent rehome history; and
- synthetic-run provenance if tenant loading remains in scope.

**Serial gate DoD:** approved command contract, approved state model, approved canonical schema and all
blocking product decisions recorded.

---

## WS-P1 — Authoritative transaction proof

**Runs after:** serial gate  
**Blocks:** every production write path

Implement one synchronous, server-authoritative five-asset checkout against a development data
platform.

Required tests:

1. five valid assets commit as one event;
2. one invalid asset writes nothing;
3. deliberate exception after the third item rolls everything back;
4. two devices compete for one asset and exactly one succeeds;
5. response is lost, request is retried, one event exists;
6. same submission ID with changed payload is refused;
7. client-supplied before/after state cannot alter the result; and
8. accepted header and lines cannot be edited by normal roles.

**Owned areas:** authoritative server command, transaction contract, idempotency, concurrency tests.  
**Do not own:** UI redesign, reminder flows, Power BI visuals.

---

## WS-P2 — Canonical Dataverse solution

**Runs after:** serial gate and command contract  
**Can run with:** WS-P3 after shared schema/security boundaries are frozen

Create the approved tables, fields, choices, alternate keys, indexes, relationships and solution
packaging. Include environment variables and connection references without embedded secrets.

Required proof:

- clean solution export/import into a fresh development environment;
- canonical IDs and aliases behave as specified;
- relationship constraints cannot be bypassed;
- sequence state is isolated by environment; and
- schema documentation matches the export.

**Owned areas:** solution schema and ALM artefacts.  
**Do not own:** role matrix implementation unless explicitly coordinated with WS-P3.

---

## WS-P3 — Authorization and identity

**Runs after:** administrator scope decision and schema boundary freeze  
**Can run with:** WS-P2, WS-P4

Implement and test:

- Field User, Administrator and Owner roles;
- global or office-scoped administration at the data/server layer;
- secured SIM/network fields;
- least-privilege automation identity;
- app-sharing versus data-role error behavior;
- direct API authorization matrix;
- relationship-write authority; and
- device cache/queue isolation by user and environment.

Test through app, direct API, export and reporting routes. Interface visibility alone is not evidence.

---

## WS-P4 — Real migration, delta and cutover

**Runs after:** WS-P2 schema and WS-P3 identity resolution are available  
**Can run with:** hosted-app and reporting work after first Development load

Keep the existing cleaning/reporting logic. Add:

- real target writer;
- real directory resolution;
- corrected calibration export as the only calibration input;
- ambiguous compliance records left unmatched pending confirmation;
- source/staged/target reconciliation;
- second-run idempotency against the real platform;
- rehearsal snapshot and final delta;
- freeze/read-only procedure; and
- per-office cutover and rollback criteria.

Production load remains blocked by:

- `migration/reports/03_models_review.md` sign-off; and
- `migration/reports/02_conflicts.md` sign-off.

---

## WS-P5 — Real backend, hosted app and device evidence

**Runs after:** WS-P1 command and sufficient WS-P2 schema  
**Can run with:** WS-P4, WS-P6, WS-P7

Implement the real `AmsBackend` adapter. Every state-changing write calls the authoritative command.
Remove mock-only role switching and scanner substitutes from release builds.

Hosted-device matrix:

- managed iOS and Android;
- online-to-offline transition;
- full close/reopen offline;
- device restart;
- queued writes and conflict replay;
- expired authentication;
- signed-in user change;
- scanner permission denied/granted/interrupted; and
- inspection proving secured fields are absent from Field User local storage.

Any failed offline capability is removed from pilot acceptance or marked unsupported. Local queue tests
do not substitute for this evidence.

---

## WS-P6 — Power BI manager reporting

**Runs after:** first real Development data load and security-model decision  
**Can run with:** WS-P5, WS-P7

Implement the manager report outside the Code App. Select and document either per-viewer data identity
or a shared semantic-model identity with tested row/object security.

Requirements:

- ordinary manager model excludes ICCID, phone and static IP entirely;
- all seven acceptance questions are answerable;
- every page states data currency;
- every measure reconciles with operational queries;
- report works as every intended recipient role; and
- reader licensing and distribution are confirmed.

The in-app Reports surface remains useful for app users but does not complete this workstream.

---

## WS-P7 — Automation, SharePoint and operations

**Runs after:** WS-P1 authoritative event behavior is fixed  
**Can run with:** WS-P5 and WS-P6

Build flows for reconciliation, calibration recalculation, reminders and overdue returns without
reintroducing a second business-state write path.

Complete:

- calibration create/correct/reassociate/replace/void recalculation;
- failed-result behavior;
- physical lab-receipt behavior;
- certificate upload, attach-later, naming, type/size, attribution and retention;
- best-effort notification delivery and bounded messages;
- owned alert destination;
- app rollback;
- solution recovery;
- business-data restore;
- certificate restore; and
- RPO/RTO and restore-test procedure.

Every flow and procedure gets a successor-readable README.

---

## WS-L1 — Local synthetic/release cleanup

This work is lower priority than WS-P1. Before continuing, re-run:

```bash
cd app
npm install
npx tsc -b
npm test
npm run build
npm run build:release
```

Then inspect the current state of features 007 and 008 rather than relying on the old concurrent-agent
summary. Preserve the release-data guard. Do not load large synthetic history into a shared Development
environment until Q14 and the environment strategy are approved.

---

## Integration order

```text
Serial gate
   ↓
WS-P1 atomic command proof
   ↓
WS-P2 schema ─────┐
WS-P3 security ───┼─ freeze shared contracts
   ↓              │
WS-P4 real load   │
   ↓              │
WS-P5 hosted app  │
WS-P6 reporting   │  may run in parallel after first load
WS-P7 automation  │
   └──────────────┘
   ↓
Feature 009 checklist
   ↓
Ottawa pilot
```

## Pilot gate

Do not approve the Ottawa pilot until:

- feature 009 SC-001 to SC-010 pass;
- hosted iOS/Android behavior is recorded;
- all unsupported offline claims are removed;
- the two migration sign-offs exist;
- direct API and reporting security tests pass;
- alert and recovery procedures have owners; and
- the seven questions are answerable from tenant data.

## Reporting progress

Use these labels in commits, PRs and status notes:

- Spec Draft
- Spec Approved
- Mock Implemented
- Tenant Implemented
- Security Verified
- Device Verified
- Pilot Accepted
- Production Accepted

Do not label a feature **Built** without the qualifier that states which level was actually proved.
