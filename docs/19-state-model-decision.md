# 19 — The approved asset state model (R1): consequence analysis

**Written:** 2026-09-03
**Subject:** decision R1 — the canonical asset state model.
**Status of the decision:** **APPROVED**, recorded at `docs/08-decisions.md:88`, attributed to Jay.

> **Path note, 2026-09-03 (after this document was written).** Every reference below to
> `server/src/db/schema.sql` describes content that is now in `db/migrations/` — nine numbered,
> forward-only files applied through a `schema_migration` ledger by `server/src/db/migrate.ts`.
> The single `schema.sql` was deleted, not moved, so that two files could not both claim to
> describe the schema. The *content* of every reference below is still accurate; only the
> location has changed. See `docs/08-decisions.md` § "Database lane calls" (D-MIG-1..4).

> ### Read this first — what this document is, and is not
>
> **R1 was already approved when this document was written.** It was commissioned as a
> pre-decision brief; the decision landed during the pass. It is therefore **not** a request for a
> decision and contains no recommendation about which model to adopt. It is the **consequence
> analysis**: what the approved model costs to implement, where the decision as recorded is
> under-specified, and what has to change to honour it.
>
> **The approval is uncommitted working-tree state at the time of writing.**
> `git show HEAD:docs/08-decisions.md | grep -c "R1 APPROVED"` returns `0`; the working copy returns
> `2`. `docs/08-decisions.md`, `docs/15-postgres-data-model.md`, `specs/REMAINING-WORK.md`,
> `specs/README.md` and `CLAUDE.md` are all modified-and-unstaged; `specs/{009,010,011}/plan.md`,
> `tasks.md`, `contracts/`, `data-model.md`, `research.md` and `specs/_planning/` are untracked.
> Anyone reading this after those changes are committed, amended or discarded should re-verify
> before relying on it.
>
> This document does not modify `docs/08-decisions.md` — that file is owned elsewhere this pass —
> and commits nothing.
>
> **The most valuable sections are 7, 8 and 9**: the ambiguity register, the compatibility-window
> analysis, and a cross-check that found four disagreements between the approved decision and the
> planning artifacts written alongside it.

Everything below is drawn from files in this repository and cited by `path:line`. Line numbers for
`docs/15-postgres-data-model.md` refer to the **modified working copy**, which is shifted by +2 after
line 62 relative to `HEAD`.

---

## 0. What was approved, and the one word to be careful about

`docs/08-decisions.md:88` records:

> **R1 APPROVED — canonical asset state is four independent axes:** `lifecycle` (Active / Retired),
> `disposition` (AtOffice / CheckedOut / Deployed / InTransit / AtCalibrationLab / Missing),
> `serviceability` (Serviceable / NeedsRepair / OutOfService), and **derived** `calibration currency`
> (NotRequired / Unknown / Current / DueSoon / Overdue / InCalibration / Failed). Display pills are
> views only. Compatibility single-`status` remains only in the local mock/`server/` POC until HTTP
> cutover.

`docs/15-postgres-data-model.md:4` now reads "**§3 State model APPROVED** (Jay, 2026-09-03 — R1)",
and `docs/15-postgres-data-model.md:62` adds "The local mock and `server/` POC may keep a
compatibility single `status` until the HTTP cutover; production schema and new transaction
derivation use the axes below." `specs/REMAINING-WORK.md:72` strikes R1 out as APPROVED.

### Four axes, three columns

| # | Axis | Stored or derived | Where |
|---|---|---|---|
| 1 | **Lifecycle** | **stored column** `asset.lifecycle` | `docs/15-postgres-data-model.md:269` |
| 2 | **Physical disposition** | **stored column** `asset.disposition` | `docs/15-postgres-data-model.md:270` |
| 3 | **Serviceability** | **stored column** `asset.serviceability` | `docs/15-postgres-data-model.md:271` |
| 4 | **Calibration currency** | **derived — no column** | `docs/15-postgres-data-model.md:96-110` |
| — | Compatibility display status | **derived (a view)** | `docs/15-postgres-data-model.md:112-127` |

> **Naming caution for whoever writes the first migration.** `docs/08-decisions.md:88` and
> `specs/REMAINING-WORK.md:72` say "**four** independent axes". The row's own text is correct — it
> calls calibration currency "**derived**" — but "four independent axes" read quickly invites a
> fourth *column*. There is no `asset.calibration_currency` in
> `docs/15-postgres-data-model.md:262-289`, and there must not be one: a stored copy would be a
> second writable source of truth for a value computed from `next_calibration_due_date`, the model's
> requirement and the current disposition. **Three columns, one view.**
>
> The planning layer written the same day uses the other label — `specs/010-web-application-platform/research.md:26`,
> `specs/011-data-management/plan.md:80` and `specs/009-production-readiness/plan.md:53` all say
> "**three-axis** state". Both labels describe the same model. The repository should settle on one
> phrase; "three stored axes plus derived calibration currency" is unambiguous and neither current
> label is.

Calibration currency being derived is **not a change from today.** It is already computed at read
time in the implemented code — `app/src/api/mock/reporting.ts:116-140` builds the `inCalibration` /
`dueSoon` / `overdue` / `unknown` buckets from `asset.nextcaldue` and `asset.status`. R1 renames it,
gives it seven explicit values instead of four implicit buckets, and changes the one input it takes
from the state model, from `asset.status === "InCalibration"` (`app/src/api/mock/reporting.ts:128`)
to `disposition === "AtCalibrationLab"`. § 7.2 shows that this apparently cosmetic change is where
the model's largest internal tension sits.

**So the physical change R1 mandates is one column becoming two.** `asset.lifecycle` already exists
on both sides. Everything else follows from `asset.status` (one column, seven values) becoming
`asset.disposition` + `asset.serviceability` (two columns, six and three values).

---

## 1. The approved model in full

### 1.1 Axes and permitted values

**Lifecycle** — `docs/15-postgres-data-model.md:66-71`, 2 values: `Active`, `Retired`.

**Physical disposition** — `docs/15-postgres-data-model.md:73-84`, 6 values. "Answers where the
system believes the asset is in its operating journey."

```text
AtOffice   CheckedOut   Deployed   InTransit   AtCalibrationLab   Missing
```

**Serviceability** — `docs/15-postgres-data-model.md:86-94`, 3 values. "A checked-out or deployed
asset can also need repair."

```text
Serviceable   NeedsRepair   OutOfService
```

**Calibration currency (derived)** — `docs/15-postgres-data-model.md:96-110`, 7 values:

```text
NotRequired   Unknown   Current   DueSoon   Overdue   InCalibration   Failed
```

**Compatibility display status (a view)** — `docs/15-postgres-data-model.md:112-127`, 8 values:
`Retired`, `Missing`, `In calibration`, `Needs repair`, `Deployed`, `Checked out`, `In transit`,
`Available`. The document is explicit: "the view is presentation logic. It is not the authoritative
state model" (`docs/15-postgres-data-model.md:127`).

### 1.2 The transaction catalogue

`docs/15-postgres-data-model.md:422-447` lists **22 types**. `specs/010-web-application-platform/contracts/transaction-command.md:25-47`
lists the same 22 as `TransactionCommandType` — **no disagreement**. Eight do not exist in the
implemented model (§ 2.2): `MarkOutOfService`, `ReturnToService`, `RehomeAsset`, `AttachComponent`,
`DetachComponent`, `SwapComponent`, `ChangeInstallationConfiguration`, `Correction`.

### 1.3 The seven state effects

`docs/15-postgres-data-model.md:449-459` — each is a correction to something the single-status model
gets wrong:

| Effect | Cited at |
|---|---|
| `ReportFault` changes serviceability and does not erase custody, project, deployment or location | `docs/15:453` |
| `RepairComplete` changes serviceability and does not invent a physical return | `docs/15:454` |
| `Found` requires a destination/custodian decision rather than always claiming Available at the home office | `docs/15:455` |
| `SendToCalibration` changes disposition to `AtCalibrationLab`; serviceability and calibration result remain distinct | `docs/15:456` |
| `ReturnFromCalibration` is a physical receipt event, not merely the presence of a certificate | `docs/15:457` |
| `RehomeAsset` changes permanent home office through a recorded administrative event | `docs/15:458` |
| `Retire` changes lifecycle and explicitly resolves open custody, installation and relationship obligations | `docs/15:459` |

**Seven sentences are the entire transition specification.** The only other statement on the subject
is `docs/15-postgres-data-model.md:461`: "The canonical transition contract is stored as reviewed
data and consumed by server tests. The API remains authoritative." That gap is § 7.1.

### 1.4 Why the split was made

`docs/13-production-readiness-review.md:118-137`, "P0 — State model correction". One status
"combines physical disposition, serviceability, calibration process and lifecycle"; "an item can be
checked out and broken at the same time, but one status cannot express both"; "repair completion can
incorrectly make an item Available without resolving custody or location"; "`InTransit` is listed
without a complete transaction path".

The decision was also, in substance, already the specification before it was approved — which is why
approving it changed no requirement anywhere:

| Document | Says |
|---|---|
| `CLAUDE.md:58` | **Rule 9 (non-negotiable):** "Lifecycle, disposition, serviceability and calibration currency are separate. Reporting a fault does not erase custody or deployment." |
| `CLAUDE.md:53` | Rule 4 names "lifecycle, disposition, serviceability" as derived fields no ordinary endpoint may write |
| `.specify/memory/constitution.md:14` | Principle I: current "lifecycle, physical disposition, serviceability, location, custodian, project and parent" are **outputs** |
| `.specify/memory/constitution.md:30` | Principle II names "lifecycle, serviceability, calibration journey" among changes that create an immutable line |
| `specs/009-production-readiness/spec.md:128,130,131` | FR-013 independently representable; FR-014 fault/repair must not overwrite custody, project or location; FR-015 availability requires active lifecycle, **serviceable condition** and physical presence |
| `specs/010-web-application-platform/spec.md:172` | FR-018: keep the four logically separate |
| `specs/010-web-application-platform/spec.md:58-59` | Acceptance scenarios 8 and 9 |
| `specs/011-data-management/spec.md:275` | FR-027: route lifecycle and serviceability changes through approved business events |

`docs/08-decisions.md:73` (the PROPOSED row) is now marked "**Superseded same day** — see R1 APPROVED
row". The earlier deviation record at `docs/08-decisions.md:49` — the `server/` POC keeping one
`status` — remains valid and is now explicitly extended by the approval's own compatibility clause
(§ 8).

---

## 2. What `server/` and `app/` implement today

### 2.1 Two state columns, not one

| Column | Values | Cited at |
|---|---|---|
| `asset.lifecycle` | `Active` / `Retired` | `server/src/db/schema.sql:63`, `app/src/api/types.ts:9,62`, `app/src/domain/deriveState.ts:26` |
| `asset.status` | 7 values | `server/src/db/schema.sql:64`, `app/src/api/types.ts:63`, `app/src/domain/stateMachine.ts:15` |

`server/src/db/schema.sql:1-6` says so in its own header — it "mirrors app/src/api/types.ts one for
one so the existing React screens run unchanged", and the split "is a product decision still PROPOSED
in docs/08-decisions.md and is deliberately out of scope for the POC". This was a scoping choice,
recorded once at `docs/08-decisions.md:49`, and is not an endorsement of the single-status model.

**That header comment is now stale** and should be corrected when the file is next touched: R1 is no
longer PROPOSED. `server/README.md:364-370` has already been updated and now reads "**Production
target is the four-axis model approved 2026-09-03 (R1)** … Replacing this POC column is in-scope for
WS-W2/W4, not for keeping the POC as the schema of record." `server/src/db/schema.sql:1-6` still says
PROPOSED. This document does not edit `server/`.

`Retired` is already duplicated across the two columns: `app/src/domain/deriveState.ts:165-173` sets
`lifecycle: "Retired"` while `data/reference/state_machine.json:20` sets `status: "Retired"` for the
same event. R1 does not say which survives (§ 7.4).

### 2.2 Seven statuses, 14 transaction types, 33 cells

`data/reference/state_machine.json:3-11` — `Available`, `CheckedOut`, `Deployed`, `InCalibration`,
`NeedsRepair`, `Missing`, `Retired`. `data/reference/state_machine.json:12-60` — 14 types across
**33 allowed cells**, counted from the file:

| From status | Allowed transactions | Count |
|---|---|---:|
| `Available` | Checkout→CheckedOut, Transfer→Available, Deploy→Deployed, SendToCalibration→InCalibration, ReportFault→NeedsRepair, MarkMissing→Missing, Retire→Retired, Audit→Available, AddToInventory→Available | 9 |
| `CheckedOut` | Return→Available, Transfer→CheckedOut, Deploy→Deployed, ReportFault→NeedsRepair, MarkMissing→Missing, Audit→CheckedOut | 6 |
| `Deployed` | Return→Available, Undeploy→CheckedOut, Transfer→Deployed, ReportFault→NeedsRepair, MarkMissing→Missing, Audit→Deployed | 6 |
| `InCalibration` | ReturnFromCalibration→Available, ReportFault→NeedsRepair, Retire→Retired, Audit→InCalibration | 4 |
| `NeedsRepair` | SendToCalibration→InCalibration, RepairComplete→Available, Retire→Retired, Audit→NeedsRepair | 4 |
| `Missing` | Found→Available, Retire→Retired, Audit→Missing | 3 |
| `Retired` | Audit→Retired | 1 |
| | | **33** |

`app/src/domain/stateMachine.ts` is generated from that file by
`app/scripts/generate-state-machine.mjs` (`app/src/domain/stateMachine.ts:1-13`).
`docs/17-ux-audit.md:111` records the deliberate decision that the enumeration stays closed: "The
state machine is **code and flow logic**, not data … Adding a status is a design change to the state
machine, correctly."

### 2.3 The three defects the approved model fixes — all demonstrated, none hypothetical

**(a) `RepairComplete` produces "Available" while custody, location and project survive.**
`app/src/domain/deriveState.ts:175-180` returns `base` unchanged for `ReportFault`, `MarkMissing`,
`RepairComplete` and `Found` — "status changes only; custodian/location/project are whatever they
already were". With `NeedsRepair --RepairComplete--> Available`
(`data/reference/state_machine.json:48`), an asset that broke in the field comes out of repair
reading `status = Available` with `currentlocation = null`, and `custodian` still set if it was
checked out.

The synthetic simulator had to work around exactly this and recorded why —
`app/scripts/synthetic/lib/sim.ts:1429-1434`:

> RepairComplete carries no location (deriveState returns the fields unchanged), so an item that
> broke in the field comes out of repair Available with an unknown location. It is physically on the
> shelf, and the admin records that the same way the app would — a Transfer. Without this the asset
> is invisible to every later routine, which is what stranded seven modems for years in the first
> standard run (FR-025).

**(b) "Deployed and broken" cannot be recorded, so the *history* is falsified.**
`app/scripts/synthetic/lib/sim.ts:1230-1244` is the generator's only `Deployed → ReportFault` path.
Because `ReportFault` moves `status` off `Deployed`, the simulator must close the installation at the
same instant (`sim.ts:1237-1238`, `closeInstallationComponents`). The station is recorded as
recovered because the status column had nowhere else to put the fault. Acceptance question 7 — "Where
was asset X on date D, and what was attached to it?" (`specs/README.md:95`) — is answered incorrectly
for that span, permanently, because transaction lines are append-only
(`.specify/memory/constitution.md:30-35`, `server/src/db/schema.sql:127-139`).

**(c) The staged real data already contains 27 contradictions.** 27 of the 375 assets staged as
`Available` carry a named custodian (computed from `migration/staged/assets.json`). `Available` and
"held by someone" are mutually exclusive under the implemented model, and nothing flags it, because
there is only one axis to check against.

---

## 3. Exactly what changes — countable

### 3.1 Database: `server/src/db/schema.sql` versus the approved `docs/15`

| Object | Today | Approved | Delta |
|---|---|---|---|
| `asset.lifecycle` | `text NOT NULL` (`schema.sql:63`) | unchanged (`docs/15:269`) | 0 |
| `asset.status` | `text NOT NULL` (`schema.sql:64`) | **removed from production** | −1 |
| `asset.disposition` | — | `text/enum NOT NULL`, 6 values (`docs/15:270`) | +1 |
| `asset.serviceability` | — | `text/enum NOT NULL`, 3 values (`docs/15:271`) | +1 |
| index on state | `asset_status_idx ON asset (status)` (`schema.sql:79`) | `(lifecycle, disposition, serviceability)` (`docs/15:297`) | replaced |
| `asset_transaction_line` state columns | `statusbefore`, `statusafter` (`schema.sql:111-112`) | `lifecycle_before/after`, `disposition_before/after`, `serviceability_before/after` (`docs/15:401-403`) | **2 → 6 (+4)** |

**Net: one column added to `asset`, four added to `asset_transaction_line`.** That is the entire
physical footprint. The cost is not in the columns — it is in the transition contract (§ 7.1) and the
26 files that carry a status literal (§ 3.4).

Separately, and **not** part of R1: the approved `asset_transaction_line` also gains
`location_before_id/after_id`, `custodian_before_id/after_id`, `project_before_id/after_id` and
`parent_before_id/after_id` (`docs/15:404-407`) — eight more columns today's line does not carry
(`server/src/db/schema.sql:107-121`). Those are independent of the state model and can be decided on
their own.

### 3.2 Constraints and database tests

`docs/15-postgres-data-model.md:758-781` lists 20 required schema tests. **Three cannot be written at
all under the single-status model** and become writable now (`docs/15:775-777`):

- "report fault preserves custody, location, and project";
- "repair complete does not invent a physical return";
- "found requires an explicit resulting physical state".

`specs/009-production-readiness/contracts/security-matrix.md:31` already denies direct writes to
"lifecycle/disposition/…" for every role; `specs/011-data-management/tasks.md:133` (T031) already
requires a correction touching "disposition/location/custodian/lifecycle" to be refused.

### 3.3 Transition rules

| | Today | Approved |
|---|---|---|
| Transaction types | 14 (`data/reference/state_machine.json`) | 22 (`docs/15:422-447`) — **8 new** |
| Distinct states | 7 statuses (+ redundant 2-value `lifecycle`) | 2 × 6 × 3 = **36 combinations** |
| Contract shape | one 7 × 14 matrix, 33 populated cells | **unspecified** (`docs/15:461`) |
| Naive matrix size | 98 cells (33 used) | **792 cells** |

Of the 8 new types, five (`RehomeAsset`, `AttachComponent`, `DetachComponent`, `SwapComponent`,
`ChangeInstallationConfiguration`) are business capabilities the repository wanted regardless of R1 —
`RehomeAsset` is an open item at `specs/README.md:169`, component attach/detach is required by
`docs/15:517`. Only `MarkOutOfService` and `ReturnToService` are creatures of the split itself.

### 3.4 Application code and shared contracts

Counted by grep across the repository:

- **26 source files carry a hard-coded asset-status literal** (`"Available"`, `"CheckedOut"`,
  `"Deployed"`, `"InCalibration"`, `"NeedsRepair"`, `"Missing"`) — 4 in `app/scripts/synthetic/lib/`,
  17 in `app/src/`, 3 in `server/src/`, plus `data/reference/state_machine.json`.
- **11 files import or annotate `AssetStatus`**: `app/scripts/generate-state-machine.mjs`,
  `app/scripts/synthetic/lib/{ledger,sim,verify}.ts`, `app/src/api/mock/store.ts`,
  `app/src/api/types.ts`, `app/src/components/StatusPill.tsx`,
  `app/src/domain/{deriveState,pointInTime,stateMachine,utilisation}.ts`, `server/src/db/rows.ts`.
- **20 files reference `statusbefore` / `statusafter`**, including two committed data files
  (`app/public/data/transactionlines.json`, `migration/staged/transactionlines.json`) and
  `migration/04_load.py`.
- **11 of 15 `app/tests/*` files and 4 of 5 `server/tests/*` files assert on a status literal.**
  (Totals of 318 `app` / 64 `server` tests come from `specs/REMAINING-WORK.md:28-29` and
  `specs/BUILD-PROMPT.md`; they were not re-run for this document.)

The single highest-leverage seam is `app/src/domain/deriveState.ts`. Its `DerivedFields` interface
(`:53-60`) returns one `statusAfter`; under R1 it returns three. Everything downstream —
`server/src/services/transactionService.ts` (the one place asset state is written) and
`app/src/api/mock/store.ts` — follows from that one type.

The user-facing surface is smaller than it looks. `app/src/components/StatusPill.tsx:4-12` maps 7
statuses to 7 badges, and `docs/15:112-127` keeps exactly that pill as a view. **The React screens
need not change** if the compatibility view ships with the schema — an assumption this document did
not test (Appendix).

---

## 4. The synthetic generator (feature 007)

### 4.1 What exists

Three profiles from `app/scripts/synthetic/generate.ts`, seed `englobe-ams-007`, as-of 2026-09-02.
Counts from committed reports and manifests:

| Profile | Assets (active) | Transactions | Transaction lines | Calibration records | Source |
|---|---|---|---|---|---|
| `demo` (0.25) | 371 (285) | 16,836 | 23,022 | 1,877 | `migration/synthetic/demo/manifest.json` |
| `standard` (1.0) | 1,459 (1,138) | 62,969 | 91,616 | 7,567 | `specs/007-synthetic-data/spec.md:523-526` |
| `large` (4.5) | 6,626 (5,312) | 295,355 | 438,619 | 34,914 | `migration/reports/07_synthetic_large_report.md:26-38` |

Only manifests are committed. Regeneration is deterministic and byte-identical (feature 007 SC-008)
and costs 3 s / 37 s / ~20 min (`specs/007-synthetic-data/spec.md:530`).

The generator is bound to the single-status model at three points: `lib/ledger.ts:18` imports
`deriveState`; `lib/verify.ts:11,119-120` validates every line against `STATE_MACHINE`;
`lib/sim.ts:1966` reads `statusOf`. Feature 007's requirements encode it —
`specs/007-synthetic-data/spec.md:300-301` (FR-012, every line an allowed matrix transition), `:302`
(FR-013, state reproducible by replay), `:424-427` (FR-049, every allowed cell ≥10 times), `:548-553`
(SC-004 zero replay mismatches, SC-005 "28 of 33 cells").

### 4.2 Mapping existing output onto the axes — mechanical for 3 of 7, replay-recoverable for 4, lossy for none

| Today's status | → (lifecycle, disposition, serviceability) | Mechanical? |
|---|---|---|
| `Available` | (Active, AtOffice, Serviceable) | **Yes, per row** |
| `CheckedOut` | (Active, CheckedOut, Serviceable) | **Yes, per row** |
| `Deployed` | (Active, Deployed, Serviceable) | **Yes, per row** |
| `NeedsRepair` | (Active, **?**, NeedsRepair) | **No** — disposition destroyed; recoverable from the `statusbefore` of the `ReportFault` line |
| `InCalibration` | (Active, AtCalibrationLab, **?**) | **No** — serviceability destroyed; recoverable from whether the preceding line was `ReportFault` |
| `Missing` | (Active, Missing, **prior**) | **No** — recoverable by replay |
| `Retired` | (Retired, **?**, **prior**) | **No** — and the target values are undefined (§ 7.4) |

The four non-mechanical cases are recoverable **because feature 007 guarantees an unbroken
`statusbefore → statusafter` chain per asset**: required at `specs/007-synthetic-data/spec.md:300-301`,
checked at `app/scripts/synthetic/lib/verify.ts:115-120`, and reported as "0 disallowed, 0 chain
breaks" across 438,619 lines at `migration/reports/07_synthetic_large_report.md:47`. **The existing
datasets can be upgraded to three axes by replay, without regeneration.**

That should not be overstated:

- **Correctness under R1: preserved by replay. No regeneration required.**
- **Coverage of the new expressiveness: zero.** The simulation never produces "Deployed and
  NeedsRepair" — `sim.ts:1237-1238` closes the installation at the fault precisely because it cannot.
  Replay recovers what the simulation *intended*, and the simulation was written against a model
  where the combination is inexpressible. Getting coverage means changing `lib/sim.ts` (fault
  routines at `:1040`, `:1116`, `:1171`, `:1237`, `:1359`, `:1385`, `:1478`, `:1514`, `:1784`) and
  re-running all three profiles.
- **Feature 007 SC-005 must be restated.** "28 of 33 cells at least ten times"
  (`specs/007-synthetic-data/spec.md:551-553`) is stated against a 7 × 14 matrix that will not exist.
  A coverage target for a per-axis contract has to be defined. This is a spec amendment, not a code
  change, and nobody owns it yet.

### 4.3 The reverse mapping — total and mechanical, *given a precedence order that is not written down*

Three axes → one pill is exactly `docs/15:112-127`, and it is a view. All 36 combinations map to
exactly one of the 8 pills **provided a precedence order is stated**. The list at `docs/15:116-125`
reads like one (Retired, Missing, In calibration, Needs repair, Deployed, Checked out, In transit,
Available) but the document never says it is. This matters more than it looks: § 8 shows the
compatibility window depends entirely on this ordering, and every React screen and report will
silently encode whatever the first implementer picks.

---

## 5. Migration consequence for the 1,026 staged real assets

### 5.1 What the staged data holds

Computed from `migration/staged/assets.json` (1,026 rows):

| | Count |
|---|---:|
| `status = CheckedOut` | 648 |
| — of which **no custodian** | 592 |
| — of which with custodian | 56 |
| — of which with a project | 64 |
| `status = Available` | 375 |
| — of which **with a custodian** (an existing contradiction) | 27 |
| `status = NeedsRepair` | 3 |
| `lifecycle = Active` | **1,026 (all)** |
| `lifecycle = Retired` | **0** |
| `currentlocation` set | 378 |
| `nextcaldue` set | 163 |
| `parentasset` set | 6 |

`migration/reports/02_clean_report.md` records why there are no retirements: all 5 source rows with
`Lifecycle Status = Retired` are Azure/server rows excluded under Q6, so "0 of the 1026 loaded assets
are Retired".

### 5.2 What the source can and cannot support

Profiled directly from `data/source/registry_2026-09-02.csv` (1,053 rows):

| Column | Distribution |
|---|---|
| `Availability Status` | `Deployed or NOT Available` **644**; `Available` 283; **blank 121**; `Needs Repair / Calibration` 3; `Deployed` 2 |
| `Lifecycle Status` | `Active` 876; **blank 172**; `Retired` 5 |
| `Location Type` | **blank in all 1,053 rows** |
| `Deployment Date` | **blank in all 1,053 rows** |
| `Location` | non-blank in **3** rows |
| `Retirement Reason` | `Decommissioned` 5; blank 1,048 |

The mapping in force is `migration/02_clean.py:63-68`: `Deployed or NOT Available → CheckedOut`,
`Deployed → CheckedOut`, `Needs Repair / Calibration → NeedsRepair`, blank →
`Available`-if-Active-else-`Retired` (`migration/02_clean.py:376-382`), anything unrecognised →
`NeedsRepair` ("conservative, never silently Available").

### 5.3 What R1 forces the migration to infer, and what it cannot

| Axis | 375 `Available` | 648 `CheckedOut` | 3 `NeedsRepair` |
|---|---|---|---|
| `lifecycle` | Active — **known** | Active — **known** | Active — **known** |
| `disposition` | `AtOffice` — **known** (`02_clean.py:429-432` already sets `currentlocation = home office` for exactly these) | **NOT KNOWABLE**: `CheckedOut` or `Deployed`? The source value is literally the disjunction "Deployed or NOT Available"; `Deployment Date` is blank in every row; `Location` is set in 3 rows of 1,053 | **NOT KNOWABLE**: `AtOffice` or `AtCalibrationLab`? "Needs Repair / Calibration" conflates them |
| `serviceability` | `Serviceable` — **inferred**; the source says nothing about condition | `Serviceable` — **inferred**, same | `NeedsRepair` — **known** |

**Of the three stored axes across 1,026 assets: `lifecycle` is fully known; `disposition` is
unknowable for 651 assets (63%); `serviceability` is an assumption for 1,023 assets (99.7%).**

Two consequences, pulling opposite ways:

1. **R1 does not create this ambiguity — it exposes it.** Today the same 648 rows are collapsed to
   `CheckedOut` by choosing one arm of the disjunction. The constitution's own rationale for
   Principle I quotes the figure: "644 of 1,053 rows say 'Deployed or NOT Available', which means
   nobody knows where those assets are" (`.specify/memory/constitution.md:19-21`). The existing
   remedy is the 592-row return sweep (`migration/02_clean.py:562-568`,
   `migration/reports/02_sweep_checklist.md`) — a human process during the Ottawa pilot, unaffected
   by R1.
2. **R1 needs a decision the single-status model did not.** With one column, "we don't know" was
   expressible as `CheckedOut` with a null custodian. With `disposition`, the choice is between (a)
   picking `CheckedOut` for all 651 and treating the sweep as the correction, exactly as today, or
   (b) adding an `Unknown` disposition value — which the approved list does **not** include. Option
   (a) preserves today's honesty and avoids a permanent seventh production value existing for a
   one-off import problem. **The approved decision does not say which; see § 10, question 8.**

### 5.4 A migration defect R1 makes visible

`migration/04_load.py:173-174` writes `statusbefore = statusafter = a["status"]` on every day-one
`AddToInventory` line, commented "migration establishes day-one state directly". **651 of the 1,026
staged lines therefore describe an `AddToInventory` from `CheckedOut` or `NeedsRepair`** — a
transition `data/reference/state_machine.json` does not allow (`AddToInventory` appears only under
`Available`, line 22). Nothing rejects them because the staged lines are loaded as data, not replayed
through `deriveState`.

The repository records no exemption. `specs/002-inventory-migration/spec.md:88` requires the entry to
exist and `:275` (FR-015) requires each source value to map to a defined status; neither authorises
the transition. **Under R1 the seed line becomes six columns rather than two, so it gets no worse —
and it does not fix itself.** The seed rule needs writing down.

---

## 6. What the decision commits the project to

R1 was the critical path (`HEAD:specs/REMAINING-WORK.md:103`, before that line was rewritten: "The critical path is
R1"). Approving it commits to five things, in rough order of cost:

1. **A transition contract that does not exist yet** (§ 7.1) — the largest single piece of undone
   design work R1 creates.
2. **Rewriting `deriveState`** so `DerivedFields` returns three axes instead of one
   (`app/src/domain/deriveState.ts:53-60`), and with it the generated
   `app/src/domain/stateMachine.ts` and its source `data/reference/state_machine.json` (§ 8).
3. **Amending feature 007** — SC-005 and FR-049 (§ 4.2) — and eventually regenerating three profiles.
4. **A migration mapping decision** for 651 assets whose disposition is unknowable (§ 5.3).
5. **Touching ~31 source files and 15 test files** carrying status literals (§ 3.4).

It also makes one thing permanently cheaper, which is the reason the timing mattered: every
transaction line written from the cutover forward carries six state columns instead of two. Because
lines are append-only (`.specify/memory/constitution.md:30-35`, enforced at
`server/src/db/schema.sql:127-139` and required at `docs/15:420`), **state resolution lost at write
time is not recoverable by any later migration** — the values were never captured. Deciding R1 before
the first production migration is what avoids that; deciding it after would not have been a
refactor.

The inverse risk is bounded and worth stating for the record: if the axes turn out to be more
precision than Englobe consumes, backing out is a view change plus a column drop — the compatibility
view (`docs/15:112-127`) already produces the single pill by design, so no React screen changes, and
the four extra columns remain on historical rows as harmless detail.

---

## 7. Is the approved model implementable as written? — the ambiguity register

**Assessment: the axes and their value lists are implementable as written. The transition semantics
are not.** A competent implementer can create the `asset` and `asset_transaction_line` columns today
from `docs/15:269-271` and `:401-403` without ambiguity. They cannot write the transaction service,
because the rules that move values between those columns exist only as seven prose sentences
(`docs/15:449-459`) and one deferral (`docs/15:461`).

The seven items below are the places the decision as recorded is under-specified. Each is a choice
that will otherwise be made silently, once, by whoever writes the first migration or the first
command handler.

### 7.1 The transition contract has no shape, and R2 is frozen around the hole

`docs/15-postgres-data-model.md:461` is the whole specification: "The canonical transition contract
is stored as reviewed data and consumed by server tests."

This is not a documentation gap; it is load-bearing. **R2 — the atomic command contract — is recorded
FROZEN for the first proof (`docs/08-decisions.md:89`), and its central precondition is deferred to
an artifact that does not exist.** `specs/010-web-application-platform/contracts/transaction-command.md:171-173`:

```text
- Every asset `lifecycle === Active` (R1 APPROVED 2026-09-03).
- Disposition allows checkout (typically `AtOffice` / available pool — exact table in transition
  contract data, not browser).
```

"Typically" and "available pool" are not a contract, and no "transition contract data" exists
anywhere in the repository. The five-asset race proof
(`specs/009-production-readiness/contracts/five-asset-race.md`) cannot be written against a
precondition that has not been decided.

**Specific undecided transitions** — every one of these is expressible today and unspecified now:

| Question | Today's answer | Approved model |
|---|---|---|
| Which dispositions permit `Checkout`? | `Available` only (`state_machine.json:14`) | "typically AtOffice / available pool" — **undecided** |
| What does `Transfer` do to disposition? | Preserves status (`state_machine.json:15,26,35`) | **undecided** — and this is the obvious producer for `InTransit` (§ 7.3) |
| `Undeploy` target disposition | `CheckedOut` (`state_machine.json:34`) | **undecided**, though `CheckedOut` is the evident intent |
| `Return` from `Deployed` | permitted, → `Available` (`state_machine.json:33`) | **undecided** |
| Legal outcomes of `Found` | always `Available` (`state_machine.json:53`) | `docs/15:455` says it "requires a destination/custodian decision" but names no legal set |
| Does `MarkMissing` from `Deployed` close the installation? | it must — status leaves `Deployed` | **undecided**, and under axes it need not |
| Is `OutOfService` reachable from `Serviceable`, `NeedsRepair`, or both? | value does not exist | **undecided** |
| Is `RepairComplete` legal from `OutOfService`? | n/a | **undecided** |
| Does `Deploy` require `Serviceable`? | n/a — one axis | **undecided** (see § 9.2) |

**Recommendation for the shape** (offered as design input, not as a decision): express the contract
as **per-axis preconditions and effects per transaction type**, not as a product matrix. A naive
matrix is 36 states × 22 types = **792 cells**, mostly meaningless, and it would make feature 007's
coverage requirement unsatisfiable. Per-axis, `Checkout` becomes: *requires* `lifecycle = Active`,
`disposition = AtOffice`, `serviceability = Serviceable`; *sets* `disposition = CheckedOut`; *touches
nothing else*. That is 22 rules of roughly three clauses — **smaller and more reviewable than
today's 33 cells** — and it is what `CLAUDE.md` rule 9's second sentence ("Reporting a fault does not
erase custody or deployment") means operationally.

### 7.2 Calibration currency: four named inputs, no formula — and one internal tension

`docs/15-postgres-data-model.md:110`: "It is derived from model/asset requirements, calibration
records, due dates, and current disposition." Four inputs, seven output values, no rule. Undefined:

| Value | Today's implicit rule | Undefined under R1 |
|---|---|---|
| `NotRequired` | model interval null **and** no `nextcaldue` **and** no `lastcaldate` (`app/src/api/mock/reporting.ts:122`) | is that the approved rule? |
| `Unknown` | calibrated model, no `nextcaldue` (`reporting.ts:129-130`) | — |
| `Current` | not a bucket today — "due beyond the horizon" falls out of every bucket (`reporting.ts:137-138`) | now an explicit value; boundary undefined |
| `DueSoon` | `nextcaldue <= horizon` (`reporting.ts:134`) | **the horizon is a caller-supplied parameter today** (`reporting.ts:105-112`), not a constant. R1 gives no default |
| `Overdue` | `nextcaldue < today` (`reporting.ts:132`) | **whose "today"?** Dates are ISO text and `server/README.md:359` records that timezone handling is unresolved |
| `InCalibration` | `asset.status === "InCalibration"` (`reporting.ts:128`) | see the tension below |
| `Failed` | does not exist | derived from the latest qualifying record's `result = Fail`? Precedence undefined — see below |

**The tension.** `reporting.ts:128` gives `InCalibration` priority over the date buckets, with the
comment "FR-013: already at the lab — not also 'overdue'/'due soon'". Carried into R1, that means
calibration currency reads `disposition = AtCalibrationLab` and *suppresses* `Overdue`. But
`disposition` and calibration currency are supposed to be independent axes. **Either currency is
independent of disposition — in which case an asset at the lab can and should read `Overdue`, and
`InCalibration` should not be one of currency's values at all — or it is not independent, in which
case the fourth axis is partly a function of the second and the word "independent" in
`docs/08-decisions.md:88` is wrong.** The approved value list contains `InCalibration`, so the
recorded decision implies the second reading. This needs saying out loud, because
`specs/009-production-readiness/spec.md:128` (FR-013) says all four "MUST be representable
independently" and the approved value list quietly is not.

**The `Failed` precedence problem is concrete.** `docs/15:599` says a `Fail` result "does not advance
successful calibration summaries". So after a failed calibration, `next_calibration_due_date` still
holds the *old* date, which is very likely in the past. Is currency then `Failed` or `Overdue`? Both
are true. Nothing states the precedence. The synthetic data already contains this exact case — the
planted scenario `failed-calibration-then-repair` on asset `GEO-V12-400001`
(`migration/synthetic/demo/manifest.json`).

**Precedence among all seven values is undefined**, not only for these two pairs.

### 7.3 `InTransit` still has no producing transaction

`InTransit` is an approved disposition value (`docs/15:79`) and a display pill (`docs/15:123`), and
**none of the 22 catalogue types produces it** (`docs/15:422-447`). `SendToCalibration` goes straight
to `AtCalibrationLab` (`docs/15:456`).

This is the same defect being reintroduced that `docs/13-production-readiness-review.md:126` named in
the old Dataverse enum — `docs/01-data-model.md:271` listed `InTransit` among 8 statuses, the
implementation dropped it (`data/reference/state_machine.json:3-11` has 7), and the approved model
brings it back with still no path to it. Either name the producing events (`Transfer` between offices
is the obvious candidate, and `SendToCalibration` before receipt is another) or drop the value. **A
state nothing can reach is a permanent source of "why is this empty?" questions and an untestable
branch in every report.**

### 7.4 `Retired` — two representations, and no defined axis values

Today `Retired` exists in both `asset.lifecycle` and `asset.status`
(`app/src/domain/deriveState.ts:165-173` versus `data/reference/state_machine.json:20`). Under R1 it
must live in `lifecycle` only.

**`docs/15` does not say what `disposition` and `serviceability` are for a retired asset.**
`docs/15:459` says `Retire` "explicitly resolves any open custody, installation, and relationship
obligations" but names no resulting values. The choices are: freeze last-known values, or define a
terminal pair. Both are defensible; neither is written. Note the columns are `NOT NULL`
(`docs/15:270-271`), so "leave it null" is not available.

### 7.5 `OutOfService` versus `NeedsRepair` is undefined operationally

`docs/15:88-92` lists both. `docs/15:435-436` adds `MarkOutOfService` and `ReturnToService`. **No
document in the repository says how the two differ, who may set `OutOfService`, or whether it is
reachable from `Serviceable` directly.** These are the only two of the eight new transaction types
created purely by the split (§ 3.3), and they are the two with no requirement behind them.

### 7.6 Is `Missing` a disposition, or a statement about knowledge?

`Missing` is approved as a disposition value (`docs/15:81`). It does not describe where an asset is;
it describes that nobody knows. That is defensible — but § 5.3 shows the migration has 651 assets
whose disposition is *also* unknown, for an entirely different reason (a bad source export, not a
lost instrument). **The repository does not say whether `Missing` is allowed to double as "unknown".
It should not** — conflating "reported lost by a custodian via `MarkMissing`" with "the 2026 CSV was
ambiguous" would corrupt every loss-rate report the fleet ever runs. § 10 question 8 is the same
decision seen from the migration side.

### 7.7 The compatibility pill list is probably a precedence order and does not say so

§ 4.3. `docs/15:116-125` lists 8 pills in an order that behaves exactly like precedence. Until it is
declared to be one, every consumer — the search page, the reports, the offline cache projection —
encodes its own.

---

## 8. The compatibility window: what "single-`status` remains in the mock/POC until HTTP cutover" implies

`docs/08-decisions.md:88` and `docs/15-postgres-data-model.md:62` both permit the local mock and
`server/` POC to keep the single `status` column until the HTTP cutover. This is a reasonable staging
decision — the same reasoning as `docs/08-decisions.md:49` — but it means **the repository will hold
two live state models simultaneously**, and the decision does not say how they stay in step.

### 8.1 File by file

| File | Today | During the window | Cutover |
|---|---|---|---|
| `server/src/db/schema.sql:64` | `status text NOT NULL` | may keep it (`schema.sql:1-6` already says why) | replaced by `disposition` + `serviceability`; index `:79` → `(lifecycle, disposition, serviceability)` |
| `server/src/db/schema.sql:111-112` | `statusbefore`, `statusafter` on lines | **the risk — see § 8.3** | 6 columns (`docs/15:401-403`) |
| `app/src/domain/deriveState.ts:53-60` | `DerivedFields.statusAfter`, one value | **must not be forked** — see § 8.2 | returns three axis values |
| `app/src/domain/stateMachine.ts` | **generated** (`:1-13`) from the JSON | regenerated, not hand-edited | generated from the axis contract |
| `data/reference/state_machine.json` | source of truth, 7 × 14 | **must become derived, not parallel** | replaced by, or projected from, the axis contract |

### 8.2 `deriveState` must be extended, not forked

`app/src/domain/deriveState.ts` is imported by the mock, by `server/src/services/transactionService.ts`
(`:38`) and by the synthetic generator (`app/scripts/synthetic/lib/ledger.ts:18`) — one definition,
three consumers, which is the arrangement `.specify/memory/constitution.md:93` (Principle VI,
"Shared business rules have one reviewed definition and independently verified consumers") exists to
protect.

The only safe shape for the window is: **`deriveState` returns all three axes, and the POC projects
down to a pill.** The alternative — a legacy `deriveState` beside an axis-aware one — creates two
definitions of the same business rule and guarantees they diverge. The same argument applies to
`data/reference/state_machine.json`: it must become a *generated projection* of the axis contract, or
be deleted. If it is hand-maintained alongside the axis contract, Principle VI is violated by
construction, and `app/scripts/generate-state-machine.mjs` is the natural place to enforce it.

### 8.3 The mapping is lossy in one direction, so the window has a trap

From § 4.2 and § 4.3:

- **axes → single `status`: total and mechanical**, given the § 7.7 precedence order. Safe.
- **single `status` → axes: not recoverable per row.** `NeedsRepair` does not say where the asset is;
  `InCalibration` does not say whether it is broken. Recovery needs full-history replay, and replay
  only works where an unbroken `statusbefore → statusafter` chain exists.

**The trap:** every transaction line `server/` writes during the compatibility window has 2 state
columns, not 6. Lines are append-only. If any of those lines are later treated as production
history, the four missing columns can be added but **not backfilled** — exactly the failure § 6
describes, in miniature.

Two safe options; the decision names neither:

1. **`server/` writes all six columns from day one**, deriving them even while the app reads only the
   projected pill. Costs the schema change early, removes the trap entirely.
2. **Every line written during the window is explicitly disposable POC data**, never migrated. Safe
   *only if stated* — and it is currently not stated anywhere, while
   `server/src/db/seed.ts` loads from `migration/staged/`, i.e. from real migrated asset data.

**Option 1 is the safer default and costs little**, because § 3.1 shows the schema delta is one
column on `asset` and four on `asset_transaction_line`. Whichever is chosen, it should be recorded
before the first `server/` write lands against networked PostgreSQL.

---

## 9. Cross-check: the decision against the artifacts written alongside it

Checked `docs/08-decisions.md:88` against `docs/15-postgres-data-model.md` (modified),
`specs/010-web-application-platform/data-model.md` and
`specs/010-web-application-platform/contracts/` (both untracked and new).

**Agreements.** The axis names and all four value lists match exactly across
`docs/08-decisions.md:88`, `docs/15:66-110` and
`specs/010-web-application-platform/data-model.md:8-17`. The 22-type catalogue matches between
`docs/15:422-447` and `specs/010-web-application-platform/contracts/transaction-command.md:25-47`.
`transaction-command.md:57-59` correctly marks all six before/after axis fields FORBIDDEN on input,
and `:105` marks them server-derived — consistent with `CLAUDE.md` rule 4 and `docs/15:307`.

**Four disagreements or gaps:**

### 9.1 The read contract exposes 3 of the 4 approved axes

`specs/010-web-application-platform/contracts/health-and-read.md:74-84` defines `AssetSearchHit` with
`lifecycle`, `disposition`, `serviceability` and `displayStatus` — **and no calibration currency
field.** Calibration currency is an approved axis and the input to feature 004's entire due/overdue
workflow and feature 006's compliance report. Across all three features' contracts,
`calibrationCurrency` appears exactly once, at
`specs/011-data-management/contracts/duplicate-redirect.md:63`. Every screen that needs it gets it
from the read API, and the read API does not carry it.

### 9.2 The frozen checkout precondition omits serviceability, which an approved FR requires

`specs/009-production-readiness/spec.md:131` (FR-015): "Availability MUST require active lifecycle,
**serviceable condition** and physical presence at the selected office."

`specs/010-web-application-platform/contracts/transaction-command.md:171-176` — the frozen R2
checkout validation — checks `lifecycle === Active`, disposition, project and office scope. **It does
not check serviceability.** Under the old single status this was implicit (`NeedsRepair` was not
`Available`, so the matrix refused it — `data/reference/state_machine.json:46-51`). Under the axes it
is no longer implicit and must be an explicit precondition. As written, the frozen contract permits
checking out a broken instrument.

### 9.3 The search API cannot filter on serviceability

`specs/010-web-application-platform/contracts/health-and-read.md:62`:
`GET /api/assets?q=&officeId=&disposition=&limit=&cursor=`. `disposition` is a filter;
`serviceability` and calibration currency are not. "Show me everything broken" and "show me
everything overdue" are the two queries the split exists to enable, and neither is expressible.
Minor and easily fixed, but it suggests the read contract was written by projecting the old single
`status` filter onto one axis rather than from the new model.

### 9.4 A refusal code still speaks the single-status vocabulary

`specs/010-web-application-platform/contracts/error-codes.md:63`:
`conflict.error.assetNotAvailable` — "Race loser / wrong disposition". `Available` is no longer a
stored value in the approved model; it is a display pill (`docs/15:124`). The code names a concept
that no longer exists as state. `error-codes.md:4` lists `i18n keys` among the consumers, so this
name will surface in user-facing strings. Cosmetic, but cheapest to fix before
`packages/contracts/` exists.

**One further inconsistency, in labelling rather than substance:** `docs/08-decisions.md:88` and
`specs/REMAINING-WORK.md:72` say "four independent axes"; `specs/010-web-application-platform/research.md:26`,
`specs/011-data-management/plan.md:80` and `specs/009-production-readiness/plan.md:53` say
"three-axis state". Both are the same model (§ 0).

---

## 10. Questions the repository still cannot answer

Each is a real gap, not a rhetorical device. Where the repository is silent, this says so.

| # | Question | Why the repository cannot answer it |
|---|---|---|
| 1 | **What shape is the transition contract?** | `docs/15:461` says only "stored as reviewed data" (§ 7.1). Blocks the transaction service and the five-asset race proof |
| 2 | **Does a faulted instrument ever stay deployed in Englobe's real practice?** | Not recorded anywhere. If it never does, the second axis is precision nobody consumes — `app/scripts/synthetic/lib/sim.ts:1236` assumes "pulled for service" |
| 3 | **Is `InTransit` a real Englobe operating step, and what starts and ends it?** | § 7.3 — no producing transaction in the approved catalogue |
| 4 | **What are `disposition` and `serviceability` for a `Retired` asset?** | § 7.4 — `docs/15:459` names no values, and both columns are `NOT NULL` |
| 5 | **What is `serviceability` for an asset at the calibration lab?** | `docs/15:456` says "serviceability and calibration result remain distinct" without giving a value. Routine calibration and post-fault repair both end at `AtCalibrationLab` |
| 6 | **How does `OutOfService` differ from `NeedsRepair`, and who may set it?** | § 7.5 — no requirement anywhere defines the difference |
| 7 | **What is the exact derivation of calibration currency, including the `DueSoon` horizon, the timezone for "overdue", and the precedence among all seven values?** | § 7.2 — four named inputs, no formula |
| 8 | **For the 651 migrated assets whose disposition is unknowable — pick `CheckedOut`, or add an `Unknown` value?** | § 5.3. The approved list has no `Unknown`. § 7.6 is the same question from the other side |
| 9 | **Is the day-one `AddToInventory` seed line exempt from the transition contract?** | § 5.4 — 651 staged lines already violate the matrix and no spec records an exemption |
| 10 | **Q18 — permanent-component calibration** | Recorded ASSUMED, not decided (`docs/08-decisions.md:45`). A pre-amp at the lab while its parent is deployed is *precisely* a parent/child disposition disagreement, so Q18 and R1 interact directly |
| 11 | **What replaces feature 007's SC-005 coverage target?** | § 4.2 — "28 of 33 cells" (`specs/007-synthetic-data/spec.md:551-553`) is stated against a matrix that will cease to exist |
| 12 | **Does the compatibility window write 2 state columns or 6?** | § 8.3 — the decision permits the POC to keep `status` but does not say what its transaction lines carry |

---

## 11. What has to happen next

Steps 1–3 landed on 2026-09-03, during this document's own pass, and are uncommitted.

1. ~~Record the decision in `docs/08-decisions.md`.~~ **Done** — `docs/08-decisions.md:88`; the
   PROPOSED row at `:73` is marked superseded. *This document does not touch that file.* **The § 7
   ambiguities were not recorded with it and still need decisions.**
2. ~~`docs/15-postgres-data-model.md` §3 approved.~~ **Done** — `docs/15:4`, `:62`. Note it is
   approved **with** the § 7.3, § 7.4 and § 7.7 gaps in it.
3. ~~`specs/REMAINING-WORK.md:72` R1 closes.~~ **Done**. G0.3 (`specs/REMAINING-WORK.md:163-170`) is
   **partly** closed — the state-axes bullet is struck through, but four items in the same gate
   remain open: canonical Asset ID and aliases, stable Entra user identity, the role and office-scope
   model (R5), and component exceptions (Q18). G0.3 as a whole does not close on R1 alone.
4. **Decide § 7.1 — the transition contract shape and its content.** This is the critical path now,
   in the same way R1 was before it. R2 is recorded FROZEN with this hole in it (§ 9.2, § 7.1).
5. **Fix the four cross-check findings in § 9** while the contracts are still untracked and cheap:
   add calibration currency to `AssetSearchHit`, add the serviceability precondition to checkout, add
   the missing search filters, rename `conflict.error.assetNotAvailable`.
6. **Decide § 8.3** — six columns from day one, or explicitly disposable POC lines — before the first
   `server/` write lands against networked PostgreSQL.
7. Replace `data/reference/state_machine.json` with a generated projection of the axis contract
   (§ 8.2), and regenerate `app/src/domain/stateMachine.ts`.
8. Amend `specs/007-synthetic-data/spec.md` SC-005 and FR-049 (§ 4.2), add a deployed-and-faulted path
   to `lib/sim.ts`, regenerate the three profiles.
9. `migration/02_clean.py` gains the § 5.3 mapping; `migration/04_load.py` gains the § 5.4 seed rule.
10. Remove the remaining `ASSUMPTION: R1` markers (§ 3.5 of the planning artifacts) — partly done;
    `specs/010-…/contracts/` were updated to `R1 APPROVED 2026-09-03` inline.

---

## Appendix — what this document did not establish

Stated as plainly as the findings.

- **The approval itself was not verified beyond the repository.** `docs/08-decisions.md:88`
  attributes it to Jay and quotes *"okay update all"*. This document read the decision log; it did
  not confirm the approval with Jay, and it notes that the row is **uncommitted working-tree state**
  (`git show HEAD:docs/08-decisions.md | grep -c "R1 APPROVED"` → `0`).
- **Test counts were not re-run.** 318 `app` and 64 `server` tests are quoted from
  `specs/REMAINING-WORK.md:28-29` and `specs/BUILD-PROMPT.md`. The per-file counts in § 3.4 (11 of 15
  and 4 of 5 test files referencing a status literal) were measured directly.
- **The synthetic datasets were not regenerated or inspected.** Only committed manifests and reports
  were read. The replay-recoverability claim in § 4.2 rests on
  `specs/007-synthetic-data/spec.md:300-301`, `app/scripts/synthetic/lib/verify.ts:115-120` and the
  reported "0 disallowed, 0 chain breaks" — it was not independently executed.
- **The compatibility view was not built or tested.** § 3.4's claim that the React screens need not
  change rests on reading `app/src/components/StatusPill.tsx:4-12` against `docs/15:112-127`.
- **Effort was not estimated in time.** § 3 counts files, columns and cells; it does not say how long
  the work takes.
- **`specs/011-data-management/data-model.md` was checked for axis references and contains none** —
  so § 9's cross-check covers 009 and 010 contracts and `docs/15`, not 011's physical model.
- **No judgement is offered on the eight new transaction types** beyond noting that five were wanted
  regardless of R1 (§ 3.3) and two have no requirement behind them (§ 7.5).
- **`specs/README.md:77` records feature 007 as "Built 2026-09-02"**, a term `specs/README.md:50`
  itself disallows. This document uses the maturity vocabulary throughout and treats feature 007 as
  Mock Implemented. Correcting `specs/README.md` is out of scope here.
