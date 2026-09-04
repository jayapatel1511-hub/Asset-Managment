# 21 — Specification conformance audit

**Date:** 2026-09-03. **Scope:** the working tree as it stands (HEAD `2c4eaaa` plus 27 modified and
13 new untracked paths), audited against `.specify/memory/constitution.md` 2.0.0, `CLAUDE.md`'s
twenty non-negotiable rules, and the approved artifacts under `specs/009`, `specs/010`, `specs/011`
and `docs/12`/`docs/15`/`docs/16`.

**Method:** `scripts/verify.sh` run to completion, then the code read against the requirement that
claims it. Every finding below cites the file and line that shows it. Nothing here is inferred from
a status document — where a status document and the code disagree, that disagreement is itself a
finding.

---

## 0. Verdict

The system does what the hard requirements say, and does it in the database rather than by
convention. `scripts/verify.sh` exits 0: container up, migrations from empty, an idempotent second
run, typecheck, **386** server tests against PostgreSQL 17, **374** against PGlite, **479** client
tests, and a client build. That is not a small thing and the rest of this document should be read
against it.

The gaps are of three kinds, and only the first is urgent:

1. **One approved decision is implemented backwards, and the cost of that grows with every commit** (§ 1).
2. **Whole features are unstarted in an order the plan did not intend** — feature 011, reference-data
   stewardship, corrections (§ 2). These are known; what is new is that the sequence was inverted.
3. **The written record has fallen behind the code** — task ledgers, the UI spec, and one production
   gate that has no gate in it (§ 4). Cheap to fix, and the reason an audit was needed at all.
   **Follow-up 2026-09-03 (docs/ledger agent):** § 4.1 (010/011 `tasks.md`), § 4.2 (`03_models_review.md`
   sign-off section, still unchecked), and § 5 (`docs/12` + D3 in `docs/08`) are amended. Checklists
   (009/010/011 `checklists/`) and § 4.3 cross-references were not in this pass. DC-22, the data
   dictionary, and Rule 7 reference commands are **not** claimed here.

---

## 1. The one that is time-sensitive

### 1.1 DC-22 is implemented in reverse, and transaction lines cannot be backfilled

**The requirement.** `specs/010-web-application-platform/contracts/transition-table.md` § 8.3 and
`specs/010-web-application-platform/data-model.md:117` carry the same decision:

> **DEMO CALL 2026-09-03 (DC-22)** — Option 1 of `docs/19` § 8.3. The three axes are the stored truth
> from the first `server/` write against networked PostgreSQL; the single `status` survives only as a
> derived projection.

Four numbered items follow. Item 1: `asset` carries `lifecycle`, `disposition`, `serviceability`, and
any compatibility `status` is a generated column or a view, **never written directly, by anything**.
Item 2: `asset_transaction_line` carries **all six** axis columns from its first row.

**The build.** The opposite, in both places.

| DC-22 item | Built | Evidence |
|---|---|---|
| 1 — axes stored, `status` generated | **Inverted.** `asset.status` is the stored, written column; the three axes are `GENERATED ALWAYS AS` expressions computed *from* it | `db/migrations/0008_state_axes.sql:46-70` |
| 2 — six columns on every line | **Not met.** Two: `statusbefore`, `statusafter` | `db/migrations/0001_initial_schema.sql:148-149` |
| 3 — `deriveState` returns three axes | **Not met.** `DerivedFields` returns `statusAfter` + `lifecycle` | `app/src/domain/deriveState.ts:53-60` |
| 4 — `state_machine.json` becomes a generated projection of `transition-table.md` | **Not met.** The JSON is still hand-maintained and is the *source* the generator reads | `app/scripts/generate-state-machine.mjs:18` |

**Why this is the urgent one.** Transaction history is append-only and the database enforces it
(`db/migrations/0003_history_append_only.sql`). DC-22's own text states the consequence:

> a line written with two state columns can never be backfilled to six. The values were never captured.

The first networked writes have already happened — `REMAINING-WORK.md` records a checkout committed
through the real UI as `TXN-000015` — and `server/src/db/seed.ts` loads from `migration/staged/`,
i.e. real migrated fleet data. That is precisely why DC-22 rejected the alternative: declaring the
window's lines disposable would be declaring real history disposable. Every additional commit adds
rows that can never be split into the approved model.

**Status of the conflict.** The build follows assumption **A-STATE**, recorded at
`docs/08-decisions.md:127` as *pending Jay's confirmation*, whose own row says: *"This is the row most
likely to need revisiting."* `db/migrations/0008_state_axes.sql:1-45` argues the case honestly and
explicitly concedes the line half — "Nothing below touches `asset_transaction_line`."

So the recording half of rule 13 was done properly. The amending half was not: **DC-22 still stands
unamended in an approved contract, and the constitution says specifications win over code.** This
needs a decision, not more evidence — either DC-22 is formally amended and the deferral is dated and
bounded, or the six columns land before more lines accrue.

### 1.2 Two tables from the approved first-proof subset were never created

`specs/010-web-application-platform/data-model.md:44-70` lists the first-proof tables and, separately,
what is deferred. Two tables that are **in** the first-proof list are absent from `db/migrations/`:

- **`asset_identifier`** — the table that makes rule 6 and FR-020 work ("temporary and legacy tags
  remain aliases"). Without it, the only identity an asset has is `asset.assetid`, `istemporarytag` is
  a regex over the tag text (`db/migrations/0012_reporting_views.sql:124` —
  `btrim(a.assetid) ~ '^TMP-[^-]+$'`), and completing a temporary tag would require renaming the
  asset — which `db/migrations/0004_asset_identity.sql` correctly refuses. **The "complete a temporary
  tag and keep the old one as a searchable alias" path is currently unimplementable**, and 0004 is the
  thing making it so, which is the right trade but means the alias table is now load-bearing.
- **`user_office_scope`** — office scope is carried on `app_user_role.office` instead, per assumption
  A-R5. Defensible substitution; the data-model document was not amended to say so.

Naming also drifted from `docs/15`: `app_user_role` vs `user_role`, `id_sequence` vs
`asset_id_sequence`. Cosmetic, except that `data-model.md:101-104` says migrations must match the
document or the document must be amended first.

`audit_event` is correctly absent — it is on the deferred list (`data-model.md:73-76`).

---

## 2. Unstarted work, in an order the plan did not intend

### 2.1 Feature 011 is at zero, and it was supposed to come first

`CLAUDE.md` § Development sequence puts step **6** — "read-only data dictionary, data-quality rule
engine, dashboard and issue queue" — *before* step 7 (HTTP adapter), step 8 (PWA), step 9 (documents)
and step 15 (reports).

Steps 7, 8, 9 and 15 are built. **Step 6 is untouched.** Feature 011 has 83 functional requirements,
90 tasks (0 checked), 218 checklist items (0 reviewed) and eight written contract documents
(`field-dictionary.md`, `quality-issue.md`, `data-job.md`, `duplicate-redirect.md`,
`static-correction.md`, `governed-export.md`, `retention-legal-hold.md`, `reference-command.md`) —
of which only governed exports has any implementation.

This is visible in the running application: the Field home reports **107 overdue** calibrations and
**608 assets with no calibration due date**, with no mechanism to own, route, or close any of it as a
quality issue. The data-quality problem that motivated the whole programme is on screen and has
nowhere to go.

### 2.2 Rule 7's second clause is unimplemented

Rule 7 was amended on 2026-09-03 on Jay's instruction — *"everything should not be static"* — to read:
reference data is *"maintained in the app, not in a CSV. An administrator creates, edits and
**deactivates** (never deletes) those records through the app; `data/reference/*.csv` are seeds for
the initial load, not the ongoing source."*

The `AmsBackend` contract has `listLocations`, `listEquipmentModels`, `listProjects` and **no create,
edit or deactivate method for any reference entity** (`packages/contracts/src/backend.ts:216-218`).
The API matches: `/api/locations`, `/api/equipment-models`, `/api/projects` are GET-only
(`server/src/routes/read.ts:162-164`). No admin screen offers one.

Constitution Principle IV's own Test — *"A new value for any of these attributes can only be created
by a user holding an approved administrative role, in the entity that owns it"* — is currently
vacuous: nobody can create one at all, so reference data can only change by re-seeding from the CSVs.
That is exactly the state rule 7 was amended to end.

The one exception is the pattern to follow: `PUT /api/office-admins/:office`
(`server/src/routes/commands.ts:318`) is a named, office-scoped, idempotent administrative command,
and its comment already says so — *"the shape every later administrative command follows."*

### 2.3 Corrections have no implementation

FR-017 and rule 5 require corrections to be compensating events linked to the original. `Correction`
is not a transaction type in `data/reference/state_machine.json`, not in the generated state machine,
and not a command. DC-16 assigns the workflow to feature 011, and `audit_event` — the table `docs/15`
§ 11 designates for non-transaction edits — does not exist.

Today an accepted-but-wrong event has no route back. That is safe (nothing can quietly rewrite
history) and incomplete (nothing can correct it either).

---

## 3. Requirements partially met

Naming these so they are not read as done.

| Req | State | Detail |
|---|---|---|
| **FR-027** — show cache age, last sync, pending count, conflict count | **2 of 4** | Pending count shows on the nav badge (`app/src/components/BottomNav.tsx:90-92`) and Needs attention; conflicts appear as Rejected rows. **Cache age and last successful sync are displayed nowhere**, although `cacheAgeMs()` already exists (`app/src/offline/index.ts:334`). `OfflineBar.tsx` renders only an online/offline banner |
| **FR-046** — logs, metrics, traces, correlation IDs, health | **partial** | Structured logs (Fastify) and a liveness `/api/health` exist. Correlation IDs exist on outbox rows only (`server/src/outbox/enqueue.ts:153`). No metrics, no traces, no request-scoped correlation ID |
| **Rule 19** — governed exports | **local shape, documented** | Templates, server-side scope, classification, expiry headers, office refusal and idempotency are real (`server/src/routes/reports.ts:305-370`). Artifacts and audit rows live in a process-local `Map`, and a restart loses them — stated deliberately at `server/src/services/reportService.ts:594-602`, with the production shape named (`export_artifact` table + `DocumentStore`). Not a defect; not yet an audit trail either |
| **FR-056/057** — PostgreSQL migration load, rehearsal, delta, rollback | **not started** | `migration/04_load.py` still writes JSON for the mock backend and still describes Dataverse as its target (`04_load.py:1-22`). On-plan per `CLAUDE.md` ("rewritten for PostgreSQL before Dev/UAT rehearsal") but no artifact exists yet |
| **SC-015 / FR-052** — Report Reader | **API only** | The server has the role, a demo identity (`reader@englobecorp.com`, `server/src/auth/devAuth.ts:53`) and a tested matrix. The client's mock users and role switcher offer only Field User / Office Admin / System Owner (`app/src/api/mock/index.ts:37-39`), so the Report Reader experience cannot be reviewed on screen |
| **FR-039 … FR-043** — Azure hosting, IaC, environment isolation | **not started** | No `infra/`. Correctly gated on R6, an Englobe IT dependency, not on Jay |

---

## 4. The written record has fallen behind the code

### 4.1 Task ledgers are stale in both directions

| File | Checked | Reality |
|---|---|---|
| `specs/009-…/tasks.md` | 1 of 55 | Race, registration-concurrency and security-matrix contracts have real evidence in `server/tests/` |
| `specs/010-…/tasks.md` | 2 of 86 | Most of the platform is built |
| `specs/011-…/tasks.md` | 0 of 90 | Accurate |
| `specs/010-…/checklists/requirements.md` | 5 of 112 | Unchanged since written |
| `specs/009-…/checklists/requirements.md` | 1 of 55 | Unchanged |
| `specs/011-…/checklists/requirements.md` | 0 of 218 | Unchanged |

`REMAINING-WORK.md` carries the true status in prose and says so honestly. But anyone opening
`tasks.md` first — which `specs/README.md` tells them to do — gets the wrong picture.

**Follow-up 2026-09-03:** `specs/010-…/tasks.md` **67 of 86** checked (was 2); six remaining items
T087–T092 added, unchecked. `specs/011-…/tasks.md` **2 of 90** (T002, T089 confirmations only; was 0).
Checklists unchanged (Jay gate). Feature 009 `tasks.md` was not in this pass.

### 4.2 A named production gate has no gate in it

`specs/README.md` and `REMAINING-WORK.md` both name two hard sign-offs before production migration:

- `migration/reports/02_conflicts.md` — has a Sign-off section, **unchecked**. Correct.
- `migration/reports/03_models_review.md` — **has no sign-off section at all.** No checkbox, no
  approver line, no date. It is a 64-row review with 35 corrections and several `ASSUMPTION: Q6`
  rows awaiting Jay, and nothing in the file records that a decision is owed.

**Follow-up 2026-09-03:** a Production gate section is in `migration/reports/03_models_review.md`
(scope, review checkboxes, approver table, date). **All boxes remain unchecked; no sign-off is
recorded.**

### 4.3 Stale cross-references

- `specs/010-…/data-model.md` cites `server/src/db/schema.sql:127-139`; that file no longer exists —
  it became `db/migrations/`.
- `app/scripts/generate-state-machine.mjs:8` still names `solution/flows/F1/definition.json` as a
  consumer. `solution/` is parked.
- `REMAINING-WORK.md` says 478 client tests; the suite runs 479.

---

## 5. The UI in the working tree has run ahead of the UI spec

The uncommitted change is substantial: 27 modified files (911 insertions, 1,072 deletions) plus
~1,070 new lines across `app/src/theme.ts`, `app/src/styles/ams.css` (664 lines), `app/src/chrome/`,
nine new components and `app/src/features/more/`, and a new mockup at `docs/mockups/ams-ui/`.

**It works.** It typechecks, it builds, the 479 client tests pass, it renders correctly at 390 px
against the real API, and there are zero console errors. The Field home is the D2-accepted layout in
Englobe green.

**It is not in the spec, and the deviation is not recorded.**

| Built | `docs/12-ui-spec.md` says |
|---|---|
| Five-item bottom nav: Home, Assets, Scan, Due soon, More | § 3.1: **six** items — Search, Cal Due, Checkout, Return, Sites, Admin |
| `/more` (MorePage) | Not mentioned anywhere in the document; no ID in the § 3.2 screen inventory |
| Search at `/search` | § 3.2 still lists `S01 \| Search / Home \| /` |
| `styles/ams.css`: ~40 tokens including a full neutral and status palette; `theme.ts` overrides Fluent's `colorNeutral*` ramp | G-24/D1 (`docs/08-decisions.md:312`): stock Fluent v9, brand *"isolated to the four `--brandFg/Bg/Tint/FgOn` variables (G-03)"* |

D2 — the new Field home — *was* recorded (`docs/08-decisions.md:313`). The nav change, the new screen
and the widened token layer were not, and `docs/12` was not amended for any of them. That is the
second half of rule 13 left undone. No test covers any of the new components.

**Follow-up 2026-09-03 (rule 13):** `docs/12` § 3.1 / § 3.2 / § 2.4 / § 5.22 and `docs/08` **D3**
record the five-item nav (Home, Assets, Scan, Due soon, More), S21 `/more`, and the ~40-token layer.
`docs/mockups/ams-ui/` GOVERN and the 1440×900 / 232 px rail remain a **proposal** (`docs/12` § 13),
not an adopted shell. New-component tests are still absent.

**Separately, the new mockup proposes scope that no spec carries.** `docs/mockups/ams-ui/README.md`
advertises a **GOVERN** section (Data quality, Imports, Duplicates, Reference, Corrections, Exports,
Retention, People) and a **desktop 1440×900 shell with a 232 px left rail**. GOVERN is feature 011,
which is at zero. The desktop shell is not in `docs/12`. Worth deciding explicitly whether that
mockup is a proposal or a spec amendment **before** more screens are built from it — G-24 is the
precedent for what happens when that question is left open.

---

## 6. What is solid, stated plainly

Most of the system. Recorded here because an audit that only lists gaps misrepresents the build.

- **Rule 2 / Principle VIII.** The idempotency claim is the *first* statement inside the transaction,
  so two copies of one submission can never both run the command
  (`server/src/services/transactionService.ts:112-126`). The outbox row commits with the business
  event. A refusal after a partial write rolls back through a `Refusal` class rather than returning —
  which is the bug that returning `{ ok: false }` out of a transaction callback would have caused.
- **Concurrency is exercised, not asserted.** `server/tests/concurrency.test.ts` holds 34 tests
  including 100 simultaneous commands for an overlapping asset (exactly one winner each), a 100-way
  registration burst minting 100 unique canonical IDs, and a deliberate opposite-lock-order **control**
  that deadlocks with SQLSTATE 40P01 — the control is what proves the ordered path is doing the work
  rather than getting lucky.
- **Rules 1 and 4.** zod strips unknown keys at the boundary, so a body carrying `role`, `upn` or
  `performedby` loses them before any service sees it; server-owned fields come from the resolved
  caller (`server/src/routes/commands.ts:26-33`).
- **Rules 5 and 6 are enforced by the database.** Append-only history including TRUNCATE (0003) and
  canonical-ID immutability with the escape hatch deliberately withheld (0004).
- **Rule 12** lives in a `meta` table trigger, not the loader — so `psql`, a restored dump and a future
  import job all have to pass it (0007).
- **Rule 14.** No generic `PATCH /table/{id}`, no SQL endpoint. Every write is a named command.
- **Offline.** Partitioned by tenant + environment + user object ID, durable queue, and replay that
  refuses to send a command queued under a different `objectId` — checked per command, not once per
  flush (`app/src/offline/replay.ts:8-13`).
- **Migrations.** Twelve forward-only files with a ledger; drift refused three ways (changed checksum,
  vanished file, a new migration numbered underneath an applied one); second run is a no-op.

---

## 7. What I would do next

In order, and only the first is time-sensitive.

1. **Settle DC-22 (§ 1.1).** A decision, not more analysis. Either amend DC-22 with a dated, bounded
   deferral, or add the four line columns and one asset column now. Every commit in between adds
   history that cannot be migrated.
2. **Add `asset_identifier` (§ 1.2)** — it is in the approved first-proof subset, and rule 6's alias
   behaviour has no other home.
3. **~~Fix `03_models_review.md` (§ 4.2)~~** — **done 2026-09-03 as a gate, not as an approval.**
   Sign-off section added; boxes unchecked; awaiting Jay / Data Owner.
4. **~~Reconcile the task ledgers and checklists (§ 4.1)~~** — **ledgers 2026-09-03:** 010 is 67 of 86
   (was 2); 011 is 2 of 90 (was 0). Checklists not touched (Jay gate). 009 `tasks.md` not in this pass.
5. **~~Decide the UI question before building more screens (§ 5)~~** — **specified 2026-09-03 (D3).**
   `docs/12` amended for the built five-item nav and `/more`; token widening recorded against G-24/D1;
   GOVERN + desktop rail ruled **out** of the spec (proposal only).
6. **Start feature 011 at step 6** — read-only dictionary and quality rules. The 608 assets with no
   calibration due date are the first rule, and they are already on screen. **Not claimed.**
7. **Reference-data commands (§ 2.2)**, following the `PUT /api/office-admins/:office` shape. **Not claimed.**

---

*Generated by reading the code against the requirement that claims it. `scripts/verify.sh` was run to
completion for this audit and exited 0.*
