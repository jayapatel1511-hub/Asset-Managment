# Contract: Canonical Transition Table (three stored axes)


> **Path note, 2026-09-03 (after this document was written).** Every reference below to
> `server/src/db/schema.sql` describes content that is now in `db/migrations/` — nine numbered,
> forward-only files applied through a `schema_migration` ledger by `server/src/db/migrate.ts`.
> The single `schema.sql` was deleted, not moved, so that two files could not both claim to
> describe the schema. The *content* of every reference below is still accurate; only the
> location has changed. See `docs/08-decisions.md` § "Database lane calls" (D-MIG-1..4).

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft — resolves the R2 deferral
**Mode**: **Prototype / proof of concept** (Jay, 2026-09-03 — *"we are building prototype to do proof of
concept, make any changes in specs we need to make it happen, then we will evaluate at build level"*). Every
rule below is decided, not deferred. There are **no holes**: a hole is what blocked the race proof.
**Maturity**: Spec Draft. Nothing here is implemented; no code has been written against it.
**Authority**: R1 APPROVED 2026-09-03 (`docs/08-decisions.md:88`), `docs/15-postgres-data-model.md` §3 and §7,
constitution Principles I, II, V; `CLAUDE.md` rules 1, 4, 8, 9, 13.
**Consumers**: `server/src/modules/transactions/`, `packages/contracts/`, `packages/domain/`,
`app/src/domain/deriveState.ts`, `data/reference/state_machine.json` (as a *generated projection* — see §7),
feature 009 proof harness (`specs/009-production-readiness/contracts/five-asset-race.md`),
feature 007 coverage targets.

> **D18 authorization amendment, 2026-09-04.** This table decides state preconditions/effects, not
> who receives a command or its data. Every route/command also requires an approved workspace,
> purpose, exact action capability, R5 row scope, and field policy. The historical prototype role
> floors and “everything else is open to FieldUser” call in DC-28 are superseded below; role is only
> an assignment ceiling. See `docs/25-need-to-know-access-ux.md`.

---

## 0. Why this file exists

`docs/15-postgres-data-model.md:461` is the entire published transition specification:

> The canonical transition contract is stored as reviewed data and consumed by server tests. The API remains authoritative.

No such data existed. `specs/010-web-application-platform/contracts/transaction-command.md:172` — inside the
**frozen** R2 contract — defers the central checkout precondition to it:

> Disposition allows checkout (typically `AtOffice` / available pool — exact table in transition contract data, not browser).

"Typically" is not a contract. The five-asset race proof cannot be written against it. **This file is that
table.** It is the reviewed data `docs/15:461` names.

`docs/19-state-model-decision.md` §7.1 listed nine transitions the approved decision left undecided, §7.2–§7.7
listed five further gaps, and §9 found four disagreements between the decision and the contracts written
alongside it. All of them are settled here or explicitly parked in §12.

### How the calls in this file were authorised

Jay (Owner and System Owner) said on 2026-09-03: *"feel free to unblock those, make a call for demo"*. Every
decision below is therefore **made, not deferred**, and marked:

> **DEMO CALL 2026-09-03 (DC-nn)** — the decision, the reason, the cost of reversing it.

`grep -n "DEMO CALL 2026-09-03" specs/010-web-application-platform/contracts/transition-table.md` lists all of
them. §11 is the index. Three calls (DC-03, DC-13, DC-21) require an amendment to a document this file does not
own; each says so on its own line.

---

## 1. Shape of the contract, and why it is not a matrix

**Per-transaction-type rules with per-axis preconditions and effects.** Not a product matrix.

A naive matrix is 2 lifecycle × 6 disposition × 3 serviceability = **36 states** × 22 transaction types =
**792 cells**, almost all meaningless, and it would make feature 007's per-cell coverage requirement
(`specs/007-synthetic-data/spec.md:424-427`, FR-049) unsatisfiable. The old single-status matrix was
7 × 14 = 98 cells with 33 populated (`data/reference/state_machine.json`).

This contract is **25 numbered rules — 27 rule variants — covering all 22 catalogue types**. Three types branch,
because they legitimately depend on the current state or on the calibration result: `Transfer` (R-04/05/06),
`ReturnFromCalibration` (R-10/11) and `Found` (R-17a/b/c). `SwapComponent` (R-22) is composed of two other rules
rather than branching. 19 types × 1 + 3 + 2 + 3 = **27**. It is smaller and more reviewable than today's 33
cells, and it is what `CLAUDE.md` rule 9's second
sentence — *"Reporting a fault does not erase custody or deployment"* — means operationally: most events touch
**one** axis and leave the other two alone.

### How to read a rule

| Column | Meaning |
|---|---|
| **Requires `lifecycle`** | Set of permitted values on entry. `—` means the axis is not constrained. |
| **Requires `disposition`** | Same. |
| **Requires `serviceability`** | Same. |
| **Sets** | Axes written. An axis absent from **Sets** is **not written** — not written to the same value, *not written at all*. |
| **Untouched** | Stated explicitly for readability; it is the complement of **Sets** over the three axes. |
| **Non-axis effects** | Custodian / project / location / relationship consequences. These are *not* state axes but they are server-derived and belong to the same atomic commit. |
| **Refusal** | Code when a precondition fails. §5. |

### This table is the rewrite target for `deriveState`

`app/src/domain/deriveState.ts` is the single highest-leverage seam (`docs/19` §3.4): its `DerivedFields`
interface (`:53-60`) returns one `statusAfter` today and must return three axes. Every rule below is written to
be transcribed directly:

```ts
export interface DerivedFields {
  lifecycleAfter: Lifecycle;
  dispositionAfter: Disposition;
  serviceabilityAfter: Serviceability;
  // non-axis derived facts, unchanged in shape
  custodianUserId: string | null;
  currentLocationId: string | null;
  currentProjectId: string | null;
}
```

The implementation is a lookup of the rule by `(type, current axes)`, a precondition check per axis, and an
assignment of exactly the axes named in **Sets**. §8 is the machine form of that lookup. Nothing here requires
a product matrix, a rules engine, or a new dependency.

Three standing rules apply to every row and are not repeated:

1. **The browser proposes the event type and its business fields. It never proposes an axis value.**
   `transaction-command.md:57-59` marks all six before/after axis fields FORBIDDEN on input;
   `transaction-command.md:105` marks them server-derived (`CLAUDE.md` rules 1 and 4).
2. **A refusal on any line refuses the whole command.** `transaction-command.md:135` step 6.
3. **`lifecycle = Retired` refuses every type except `Audit` and `Correction`**, with
   `transition.error.lifecycleRetired`. Retirement is terminal; a retired asset is corrected, not operated.
   (`data/reference/state_machine.json:57-59` allows only `Audit` from `Retired` today — this preserves it.)

---

## 2. Axis values

| Axis | Values | Source |
|---|---|---|
| `lifecycle` | `Active`, `Retired` | `docs/15:66-71` |
| `disposition` | `AtOffice`, `CheckedOut`, `Deployed`, `InTransit`, `AtCalibrationLab`, `Missing` | `docs/15:73-84` |
| `serviceability` | `Serviceable`, `NeedsRepair`, `OutOfService` | `docs/15:86-94` |
| Calibration currency | **derived, not stored** — see §6 | `docs/15:96-110` |

---

## 3. The rules

### 3.1 Registration

#### R-01 `AddToInventory`

| | |
|---|---|
| Requires `lifecycle` | **the asset does not yet exist** — no before-state precondition of any kind |
| Requires `disposition` | — |
| Requires `serviceability` | — |
| Sets | `lifecycle = Active`, `disposition = AtOffice`, `serviceability = Serviceable` |
| Untouched | none (creation) |
| Non-axis effects | canonical `asset_id` allocated inside this transaction (FR-016 / FR-019); `home_office_location_id` set; `current_location_id = home office` |
| Refusal | `registration.error.duplicateAssetId`, `registration.error.sequenceConflict` |

> **DEMO CALL 2026-09-03 (DC-01)** — `AddToInventory` has **no before-state precondition**, and its
> `*_before` axis columns equal its `*_after` columns *by definition*, because there is no prior state to
> describe. **Reason:** this makes the 651 day-one migration seed lines conformant *by construction* instead of
> by exemption. `migration/04_load.py:173-174` already writes `statusbefore = statusafter = a["status"]`, which
> `data/reference/state_machine.json:22` refuses (`AddToInventory` appears only under `Available`);
> `docs/19` §5.4 and §10 Q9 record that no spec authorised it. Under this rule there is nothing to authorise.
> **Reversal cost:** none for the demo. If a distinct "imported state" marker is later wanted, it is a new
> nullable column on the line, not a rewrite — the values are already correct.

**Note on the migration's day-one values.** DC-01 says the seed line is conformant; it does **not** say the
imported values are right. `docs/19` §5.3 shows `disposition` is unknowable for 651 of 1,026 staged assets and
`serviceability` is an assumption for 1,023 of them. That is `docs/19` §10 Q8 and it belongs to `migration/`,
which this file does not own. See §12.

---

### 3.2 Custody

#### R-02 `Checkout`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice` |
| Requires `serviceability` | **`Serviceable`** |
| Sets | `disposition = CheckedOut` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | `custodian_user_id = toUserId` (default: caller); `current_project_id = projectId` when given; `current_location_id = null`; open kit relationships per `kitRole` lines |
| Refusal | see §5 — disposition → `conflict.error.assetNotEligible`; serviceability → `transition.error.serviceability`; project → `transition.error.projectInactive` |

> **DEMO CALL 2026-09-03 (DC-02)** — `Checkout` requires **all three axes**: `Active` + `AtOffice` +
> `Serviceable`, and `AtOffice` is the **only** permitted disposition. **Reason:** this is verbatim
> `specs/009-production-readiness/spec.md:131` (FR-015) — *"Availability MUST require active lifecycle,
> serviceable condition and physical presence at the selected office"*. `docs/19` §9.2 found the frozen R2
> contract checking only two of the three, which as written permits checking out a broken instrument. **Reversal
> cost:** widening the disposition set later (e.g. permitting checkout of an asset already `InTransit` to the
> caller's office) is additive — one value in one array, no data rewrite. Narrowing after go-live would be the
> expensive direction, so start narrow.

`current_location_id = null` is deliberate: a checked-out asset is *with a person*, not *at a place*. Claiming it
is still at the issuing office is the falsehood that produced the 27 staged `Available`-with-custodian
contradictions (`docs/19` §2.3(c)).

#### R-03 `Return`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `CheckedOut`, `Deployed` |
| Requires `serviceability` | — |
| Sets | `disposition = AtOffice` |
| Untouched | `lifecycle`, **`serviceability`** |
| Non-axis effects | `custodian_user_id = null`; `current_project_id = null`; `current_location_id = toLocationId` (must be an Office; default `home_office_location_id`); **closes any open installation and any open parent relationship** |
| Refusal | `conflict.error.assetNotEligible`; `transition.error.destinationRequired` if `toLocationId` is not an Office |

> **DEMO CALL 2026-09-03 (DC-03)** — `Return` is legal **directly from `Deployed`**, not only from
> `CheckedOut`, and it closes the installation as part of the same commit. **Reason:** preserves today's
> behaviour (`data/reference/state_machine.json:33` allows `Deployed --Return--> Available`), and a crew that
> pulls a station and drives it back in one trip should not have to file two events. **Reversal cost:** removing
> it forces `Undeploy` then `Return`; a one-line change plus a UI step. `docs/19` §7.1 row 4 listed this as
> undecided.

**`serviceability` is untouched.** An instrument that broke in the field and is returned reads
`(Active, AtOffice, NeedsRepair)` — not `Available`. This is the first of the two `CLAUDE.md` rule 9 fixes and it
closes `docs/19` §2.3(a) and the workaround recorded at `app/scripts/synthetic/lib/sim.ts:1429-1434`.

#### R-04 `Transfer` — variant (a), inter-office dispatch

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice` **and** `toLocationId` is an Office **different from** `current_location_id` |
| Requires `serviceability` | — |
| Sets | `disposition = InTransit` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | `current_location_id = toLocationId` (the **intended destination**); custodian and project untouched |
| Refusal | `conflict.error.assetNotEligible`; `transition.error.destinationRequired` |

#### R-05 `Transfer` — variant (b), receipt

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `InTransit` |
| Requires `serviceability` | — |
| Sets | `disposition = AtOffice` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | `current_location_id = toLocationId` (may differ from the dispatch destination — a reroute stays `InTransit` under R-04's rule only if the caller re-dispatches; a receipt at *any* office ends transit) |
| Refusal | `conflict.error.assetNotEligible` |

#### R-06 `Transfer` — variant (c), custody-preserving move

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice` (same location), `CheckedOut`, `Deployed`, `AtCalibrationLab` |
| Requires `serviceability` | — |
| Sets | **nothing** |
| Untouched | all three axes |
| Non-axis effects | `current_location_id = toLocationId` only |
| Refusal | `conflict.error.assetNotEligible` |

> **DEMO CALL 2026-09-03 (DC-04)** — **`InTransit` is kept, and its producing event is an inter-office
> `Transfer` (R-04), ended by a receipt `Transfer` (R-05).** All other transfers preserve disposition (R-06),
> matching today's behaviour at `data/reference/state_machine.json:15,26,35`.
> **Reason:** `docs/13-production-readiness-review.md:126` named "`InTransit` listed without a complete
> transaction path" as a P0 defect in the old Dataverse enum; R1 reintroduced it (`docs/15:79` lists the value,
> and none of the 22 types at `docs/15:422-447` produces it — `docs/19` §7.3). The two ways out are *produce it*
> or *delete it*. Producing it was chosen because deleting it would put this contract in direct contradiction
> with `docs/15:79`, `docs/08-decisions.md:88` and `specs/010-web-application-platform/data-model.md:13` — three
> files, two of which this pass does not own — and `docs/19` §8.2 is explicit that two parallel definitions of the
> same rule diverge by construction. Inter-office shipment is also a real thing for a multi-office Ontario fleet,
> and `RehomeAsset` (permanent home change, R-18) already exists as its permanent counterpart.
> **Reversal cost:** if Englobe never ships between offices, R-04/R-05 are simply never exercised and the value
> is never produced — the same end state as deleting it, with no document contradiction. Deleting it later costs
> one enum value, two rules, one pill row.
> **What would settle it:** watch whether an Ottawa↔Toronto shipment is ever recorded as two events during the
> pilot. If every transfer is same-day and recorded once, delete `InTransit`.

`current_location_id` is set to the **destination** during transit rather than left null, because `InTransit`
already qualifies the value as "en route to", and a null location makes the asset invisible to every
office-scoped report — the failure mode `app/scripts/synthetic/lib/sim.ts:1429-1434` describes.

---

### 3.3 Deployment

#### R-07 `Deploy`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice`, `CheckedOut` |
| Requires `serviceability` | **`Serviceable`** |
| Sets | `disposition = Deployed` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | `current_project_id = projectId` (**required**, must be active); `current_location_id = toLocationId` (the site); `custodian_user_id = toUserId` or preserved; opens the installation |
| Refusal | `conflict.error.assetNotEligible`; `transition.error.serviceability`; `transition.error.projectInactive` |

> **DEMO CALL 2026-09-03 (DC-05)** — **`Deploy` requires `serviceability = Serviceable`.**
> **Reason:** FR-015's principle applied to the stronger case. A known-faulty instrument installed at a
> monitoring station produces plausible-looking bad data for weeks; that is worse than a checkout, not better.
> `docs/19` §7.1 row 9 listed this as undecided. **Reversal cost:** removing the precondition is one line.
> Note this is a *precondition only*: rule 9 still guarantees a deployed asset may **become** `NeedsRepair`
> while staying `Deployed` (R-12).

Disposition set matches today: `Deploy` is legal from `Available` and `CheckedOut`
(`data/reference/state_machine.json:16,27`).

#### R-08 `Undeploy`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `Deployed` |
| Requires `serviceability` | — |
| Sets | `disposition = CheckedOut` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | `custodian_user_id = toUserId` or preserved (the person who pulled it holds it); **`current_project_id` preserved**; `current_location_id = toLocationId` or preserved; closes the installation |
| Refusal | `conflict.error.assetNotEligible` |

> **DEMO CALL 2026-09-03 (DC-06)** — `Undeploy` targets `CheckedOut` and **keeps the project**.
> **Reason:** target matches `data/reference/state_machine.json:34` and `docs/19` §7.1 calls `CheckedOut` "the
> evident intent". Keeping the project is the new part: pulling one sensor mid-job does not end the job, and
> clearing it would lose the association that every utilisation report is built on. **Reversal cost:** one field
> assignment.

---

### 3.4 Calibration

#### R-09 `SendToCalibration`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice`, `CheckedOut` |
| Requires `serviceability` | — (any; a broken instrument may go to the lab) |
| Sets | `disposition = AtCalibrationLab` |
| Untouched | `lifecycle`, **`serviceability`** |
| Non-axis effects | `current_location_id = toLocationId` (a CalibrationLab location); `custodian_user_id = null`; `current_project_id = null` |
| Refusal | `conflict.error.assetNotEligible` |

Serviceability untouched is `docs/15:456` verbatim — *"serviceability and calibration result remain distinct"*.
The disposition set covers both of today's source rows (`Available` and `NeedsRepair` at
`data/reference/state_machine.json:17,47`), which both map to `disposition = AtOffice` under the axes, plus
`CheckedOut` so a field tech can ship an instrument straight to the lab.

#### R-10 `ReturnFromCalibration` — variant (a), `Pass` or accepted `Adjusted`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtCalibrationLab` |
| Requires `serviceability` | — |
| Sets | `disposition = AtOffice` |
| Untouched | `lifecycle`, **`serviceability`** |
| Non-axis effects | `current_location_id = toLocationId` (Office; default home office); calibration summaries recalculated in the same commit (`docs/15:598,601`) |
| Refusal | `conflict.error.assetNotEligible` |

#### R-11 `ReturnFromCalibration` — variant (b), `Fail`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtCalibrationLab` |
| Requires `serviceability` | — |
| Sets | `disposition = AtOffice`, **`serviceability = NeedsRepair`** |
| Untouched | `lifecycle` |
| Non-axis effects | as R-10; summaries **not** advanced (`docs/15:599`) |
| Refusal | `conflict.error.assetNotEligible` |

> **DEMO CALL 2026-09-03 (DC-07)** — a `ReturnFromCalibration` carrying a `Fail` result sets
> `serviceability = NeedsRepair`; `Pass`/`Adjusted` leaves serviceability untouched.
> **Reason:** `docs/15:599` — *"`Fail` does not advance successful calibration summaries and does not return an
> asset to service."* Something has to enforce the second clause. Making it the serviceability axis means the
> already-approved FR-015 preconditions (DC-02, DC-05) refuse checkout and deploy automatically, with no new
> calibration-aware precondition anywhere. **This does not conflate axes:** the calibration *result* is an input
> event; `serviceability` records its operational consequence; the derived `calibrationCurrency = Failed` (§6)
> records the compliance consequence. Both are true and they live in different places.
> **Reversal cost:** low, but the alternative has a real cost of its own — if Englobe's practice is that a
> failed instrument is still usable for non-compliance work, flip this to "serviceability untouched" and add
> `calibrationCurrency ∉ {Failed, Overdue}` as a fourth precondition on R-02 and R-07. That is the more invasive
> shape, which is why it was not chosen first.
> **What would settle it:** ask the calibration lab whether a failed unit is quarantined or returned to the
> shelf.

Both variants are the "physical receipt event, not merely the presence of a certificate" of `docs/15:457`:
the transaction is what moves disposition, not the arrival of a PDF.

---

### 3.5 Serviceability — the rule 9 core

#### R-12 `ReportFault`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice`, `CheckedOut`, `Deployed`, `InTransit`, `AtCalibrationLab` (**everything except `Missing`**) |
| Requires `serviceability` | `Serviceable` |
| Sets | `serviceability = NeedsRepair` |
| Untouched | `lifecycle`, **`disposition`** |
| Non-axis effects | **none.** `custodian_user_id`, `current_project_id`, `current_location_id`, `current_parent_asset_id` and every open installation and relationship are left exactly as they are |
| Refusal | `transition.error.serviceability` (already faulted or out of service); `conflict.error.assetNotEligible` (from `Missing`) |

> **DEMO CALL 2026-09-03 (DC-08)** — `ReportFault` touches **one axis and nothing else**, and is refused from
> `disposition = Missing` and from `serviceability ∈ {NeedsRepair, OutOfService}`.
> **Reason:** the untouched list *is* `CLAUDE.md` rule 9 — *"Reporting a fault does not erase custody or
> deployment"* — and `specs/009-production-readiness/spec.md:130` (FR-014). The `Missing` refusal is because
> nobody can observe a fault on an asset nobody can find. The already-faulted refusal is because a second fault
> report is a note, not a state change. **Reversal cost:** permitting re-report is one value in one array.

**This is the second and most consequential rule 9 fix.** `(Active, Deployed, NeedsRepair)` is now a legal,
representable state. `docs/19` §2.3(b) documents that `app/scripts/synthetic/lib/sim.ts:1237-1238` closes the
installation at the fault *because the single status column had nowhere else to put it* — falsifying the answer
to acceptance question 7 ("Where was asset X on date D, and what was attached to it?",
`specs/README.md:95`) permanently, because lines are append-only.

#### R-13 `RepairComplete`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | — (any) |
| Requires `serviceability` | **`NeedsRepair` only** |
| Sets | `serviceability = Serviceable` |
| Untouched | `lifecycle`, **`disposition`** |
| Non-axis effects | none — no location, custodian or project is invented |
| Refusal | `transition.error.serviceability` |

> **DEMO CALL 2026-09-03 (DC-09)** — `RepairComplete` is legal **only** from `NeedsRepair`, never from
> `OutOfService`, and it invents no physical return. **Reason:** `docs/15:454` — *"changes serviceability and
> does not invent a physical return."* Restricting the source to `NeedsRepair` is what gives `OutOfService` an
> operational identity (DC-10): the two values are distinguished by which event clears them.
> `docs/19` §7.1 row 8 listed this as undecided. **Reversal cost:** one value in one array.

#### R-14 `MarkOutOfService`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | — (any, including `Deployed`) |
| Requires `serviceability` | `Serviceable`, `NeedsRepair` |
| Sets | `serviceability = OutOfService` |
| Untouched | `lifecycle`, `disposition` |
| Non-axis effects | none. `reasonCode` **required** |
| Refusal | `transition.error.serviceability`; `auth.error.forbidden` without the exact capability/scope |
| Capability | `asset.serviceability.withdraw`; Administration-only, inside decided R5 scope |

#### R-15 `ReturnToService`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | — (any) |
| Requires `serviceability` | `OutOfService` |
| Sets | `serviceability = Serviceable` |
| Untouched | `lifecycle`, `disposition` |
| Non-axis effects | none |
| Refusal | `transition.error.serviceability`; `auth.error.forbidden` |
| Capability | `asset.serviceability.restore`; Administration-only, inside decided R5 scope |

> **DEMO CALL 2026-09-03 (DC-10)** — **`NeedsRepair` and `OutOfService` are given this operational
> difference, and both are kept:**
>
> | | `NeedsRepair` | `OutOfService` |
> |---|---|---|
> | Means | a fault has been reported; the asset is **expected back** | an **administrative withdrawal** from the available fleet, whether or not anything is broken |
> | Set by | `ReportFault` (R-12), `asset.issue.report` within Work purpose/scope | `MarkOutOfService` (R-14), `asset.serviceability.withdraw` in Administration, `reasonCode` required |
> | Cleared by | `RepairComplete` (R-13) only | `ReturnToService` (R-15) only |
> | Typical cause | dropped geophone, water ingress, dead channel | parts on back-order with no ETA, manufacturer recall, quarantine pending investigation, leased unit off-hire |
> | Reporting | downtime **with an expected end** — stays in the fleet denominator | **withdrawn capacity** — excluded from the utilisation denominator |
> | Not | retirement — the asset is still owned and still in the fleet | |
>
> `MarkOutOfService` is legal from `NeedsRepair` (an open fault can be superseded by a withdrawal; the fault
> stays in the transaction lines). It is legal from **any** disposition — a recall notice can arrive while the
> instrument is at a station, and rule 9 forbids that from moving it. `ReturnToService` returns to
> `Serviceable` and is an **affirmative statement of fitness** carrying the same weight as `RepairComplete`;
> if the asset is still faulty, a fresh `ReportFault` follows.
> **Reason:** `docs/19` §7.5 and §10 Q6 record that *no document in the repository* defines the difference, and
> that these are the only two of the eight new transaction types with no requirement behind them. Without a
> difference, one of the two values should have been deleted. This gives them one: **fault vs. withdrawal**,
> distinguished by who sets them, what clears them, and how utilisation counts them.
> **Reversal cost:** if `OutOfService` earns no use in the pilot, delete the value and R-14/R-15 with it — three
> rules and one enum value. No data migration while nothing has ever been set to it.
> **What would settle it:** count `MarkOutOfService` events in the first pilot quarter. Zero means delete it.

---

### 3.6 Loss

#### R-16 `MarkMissing`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | anything except `Missing` |
| Requires `serviceability` | — |
| Sets | `disposition = Missing` |
| Untouched | `lifecycle`, `serviceability` |
| Non-axis effects | **none.** Custodian, project, `current_location_id` (last known), parent relationship and any open installation are **all preserved** |
| Refusal | `conflict.error.assetNotEligible` |

> **DEMO CALL 2026-09-03 (DC-11)** — **`MarkMissing` from `Deployed` does *not* close the installation**, and
> clears neither custodian nor project nor last-known location.
> **Reason:** the direct analogue of rule 9. Closing the installation would record the station as *recovered* at
> the moment the instrument was reported *lost* — the same falsification `docs/19` §2.3(b) documents for
> `ReportFault`. The last known location and the open installation are the two most useful facts about a missing
> asset; erasing them is the opposite of what a loss report is for. `docs/19` §7.1 row 6 listed this as
> undecided. Installations are closed by the events that actually end them — `Undeploy` (R-08), `Return` (R-03),
> `Retire` (R-19) — or by `ChangeInstallationConfiguration` (R-22).
> **Reversal cost:** adding a close-installation side effect is one clause.

#### R-17a / R-17b / R-17c `Found` — three variants, destination required

| Variant | Command shape | Sets `disposition` | Non-axis effects |
|---|---|---|---|
| **R-17a** recovered to an office | `toLocationId` is an Office, no `toUserId` | `AtOffice` | `current_location_id = toLocationId` |
| **R-17b** recovered into custody | `toUserId` present | `CheckedOut` | `custodian_user_id = toUserId`; `current_location_id = null` |
| **R-17c** found still installed | `projectId` present **and** `toLocationId` is a Site | `Deployed` | `current_project_id`, `current_location_id` set; installation reopened or confirmed |

All three: requires `lifecycle = Active`, `disposition = Missing`, serviceability unconstrained.
All three: `serviceability` **untouched**, `lifecycle` untouched.
Refusal when none of R-17a/b/c is determinable: **`transition.error.destinationRequired`**.

> **DEMO CALL 2026-09-03 (DC-12)** — `Found` has exactly the legal outcome set `{AtOffice, CheckedOut,
> Deployed}`, selected by fields the command already carries, and is **refused** when the caller names no
> destination. Serviceability is **preserved**, not reset.
> **Reason:** `docs/15:455` — *"`Found` requires a destination/custodian decision rather than always claiming the
> asset is Available at its home office"* — names the requirement but no legal set; `docs/19` §7.1 row 5 records
> the gap. Today's behaviour (`data/reference/state_machine.json:53`, always `Available`) is exactly the claim
> `docs/15:455` forbids. Serviceability is preserved because there is no `Unknown` value on that axis and
> inventing `Serviceable` for an instrument that has been outdoors for six months would be a lie; the finder's
> observation is recorded on the line's existing `condition` field
> (`Good | Damaged | NeedsService`, `transaction-command.md:52`) and a `ReportFault` follows if warranted.
> **Reversal cost:** adding a fourth outcome is one row.

---

### 3.7 Retirement

#### R-18 `RehomeAsset`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | — |
| Requires `serviceability` | — |
| Sets | **nothing** |
| Untouched | all three axes |
| Non-axis effects | `home_office_location_id = toLocationId` only. `current_location_id` unchanged |
| Refusal | `auth.error.forbidden` |
| Capability | `asset.rehome`; Administration-only, inside decided R5 scope |

`docs/15:458` — a permanent home-office change through a recorded administrative event. It changes where the
asset *belongs*, never where it *is*.

#### R-19 `Retire`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `AtOffice`, `AtCalibrationLab`, `Missing` |
| Requires `serviceability` | — |
| Sets | `lifecycle = Retired` |
| Untouched | **`disposition` and `serviceability` are frozen at their last values** |
| Non-axis effects | `custodian_user_id = null`; `current_project_id = null`; `retired_at` set; `retirement_reason` **required** (`Sold`/`Lost`/`Damaged`/`Obsolete`, `docs/15:284`); no open parent relationship or installation may exist |
| Refusal | `conflict.error.assetNotEligible` (from `CheckedOut`, `Deployed`, `InTransit`); `transition.error.openObligation` (open installation or parent relationship); `command.error.validation` (missing reason) |
| Capability | `asset.retire`; Administration-only, inside decided R5 scope |

> **DEMO CALL 2026-09-03 (DC-13)** — **A retired asset keeps its last `disposition` and `serviceability`;
> neither column gets a terminal value.** `Retire` is refused while custody or deployment is open.
> **Reason:** `docs/19` §7.4 and §10 Q4 record that `docs/15:459` names no values while both columns are
> `NOT NULL` (`docs/15:270-271`), so "leave it null" is unavailable. Freezing is chosen because:
> (i) overwriting the other two axes at retirement is precisely the axis-collapsing that R1 exists to stop —
> `CLAUDE.md` rule 9; (ii) it answers *what happened to it* — a retired asset frozen at `(Missing, NeedsRepair)`
> reads "written off after being lost and broken", where a terminal `(AtOffice, OutOfService)` would be a lie
> about a lost asset; (iii) `retirement_reason` already carries the disposal fact, so a terminal disposition
> would be both redundant and contradictory.
> Refusing from `CheckedOut`/`Deployed`/`InTransit` is how `docs/15:459`'s *"explicitly resolves any open
> custody, installation, and relationship obligations"* is satisfied without silently discarding facts — and it
> **is today's behaviour**: `data/reference/state_machine.json:24-39` gives `CheckedOut` and `Deployed` no
> `Retire` key at all, while `Available`, `InCalibration`, `NeedsRepair` and `Missing` all have one
> (`:20,43,49,54`).
> **Reversal cost:** if a terminal pair is later wanted it is one `UPDATE` over retired rows plus a rule change;
> the transaction lines carry the truth either way, so nothing is lost.
> **Amendment needed elsewhere:** `docs/15` §7 "State effects" should gain this sentence. Not this file's to
> make.

Every consumer must therefore test `lifecycle = Retired` **first**. The pill precedence order in §7 does exactly
that.

---

### 3.8 Components and installations

#### R-20 `AttachComponent`

| | |
|---|---|
| Requires `lifecycle` | `Active` (both parent and child) |
| Requires `disposition` | child: `AtOffice`, or equal to the parent's disposition. Parent: unconstrained |
| Requires `serviceability` | child: `Serviceable` |
| Sets | child: `disposition = parent.disposition`. Parent: **nothing** |
| Untouched | parent: all three axes. Child: `lifecycle`, `serviceability` |
| Non-axis effects | opens the parent/child relationship; `current_parent_asset_id` mirrors it; child's `current_location_id` and `current_project_id` follow the parent's |
| Refusal | `transition.error.componentRule`; `conflict.error.assetNotEligible` |

#### R-21 `DetachComponent`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | child: equal to the parent's disposition |
| Requires `serviceability` | — |
| Sets | child: `disposition = AtOffice` (destination is an Office) or `CheckedOut` (`toUserId` named). Parent: **nothing** |
| Untouched | parent: all three axes. Child: `lifecycle`, `serviceability` |
| Non-axis effects | closes the relationship; clears `current_parent_asset_id` |
| Refusal | `transition.error.componentRule`; `transition.error.destinationRequired` |

#### R-22 `SwapComponent`

One `DetachComponent` and one `AttachComponent` **in the same atomic commit** (`CLAUDE.md` rule 2). Preconditions
and effects are R-21's then R-20's, applied to the outgoing and incoming child respectively; the parent's axes are
untouched. A failure on either half refuses both.

#### R-23 `ChangeInstallationConfiguration`

| | |
|---|---|
| Requires `lifecycle` | `Active` |
| Requires `disposition` | `Deployed` |
| Requires `serviceability` | — |
| Sets | **nothing** |
| Untouched | all three axes, on parent and children |
| Non-axis effects | `kit_role`, `orientation`, `power_source` changes only (`transaction-command.md:49-51`) |
| Refusal | `transition.error.componentRule` |

> **DEMO CALL 2026-09-03 (DC-14)** — a child's disposition **follows the parent's on attach**, and thereafter
> the two **may legally diverge**. A pre-amp sent to the lab (R-09) while its parent stays `Deployed` is
> **not an error**.
> **Reason:** rule 9 applied across the relationship — the child has its own operating journey. Coupling them
> permanently would make the "send one component for calibration" case unrepresentable, which is the same class
> of defect the split exists to fix.
> **Placeholder warning:** `docs/19` §10 Q10 records that **Q18 (permanent-component calibration) is ASSUMED,
> not decided** (`docs/08-decisions.md:45`), and that Q18 and R1 interact exactly here. This rule is the
> reversible option: divergence is *permitted*, never *required*, so a later Q18 decision that forbids it is a
> tightening, not a rewrite. **What would settle it:** the Q18 decision.

---

### 3.9 Observation and correction

#### R-24 `Audit`

| | |
|---|---|
| Requires `lifecycle` | — (legal from `Retired`) |
| Requires `disposition` | — |
| Requires `serviceability` | — |
| Sets | **nothing** |
| Untouched | all three axes |
| Non-axis effects | none. Records the observed `condition` on the line |
| Refusal | none on state grounds |

> **DEMO CALL 2026-09-03 (DC-15)** — `Audit` is a pure observation and **never changes any axis or any derived
> field**, including `current_location_id`. **Reason:** it maps state→same-state in all seven of today's rows
> (`data/reference/state_machine.json:21,30,38,44,50,55,58`), including from `Retired`. An audit that finds an
> asset somewhere unexpected produces a `Transfer` (R-06); an audit that finds a *missing* asset produces a
> `Found` (R-17). **Reversal cost:** none — this is today's behaviour.

#### R-25 `Correction`

| | |
|---|---|
| Requires `lifecycle` | — (legal from `Retired`) |
| Requires `disposition` | — |
| Requires `serviceability` | — |
| Sets | the axes the corrected event set, to the corrected values |
| Untouched | axes the corrected event did not touch |
| Non-axis effects | `correctionOfTransactionId` **required** (`transaction-command.md:74`); the original header and lines are **never** modified — the correction is a new compensating event (`CLAUDE.md` rule 5, constitution Principle II) |
| Refusal | `command.error.validation`; `auth.error.forbidden` |
| Capability | `data.correction.apply`, with decided R5 scope and OD-3 separation of duties (Feature 011) |

> **DEMO CALL 2026-09-03 (DC-16)** — a `Correction` may write an axis value the ordinary rule for the corrected
> type would refuse, **provided the resulting combination is one some rule in this table can produce**. It may
> not produce an unreachable state. **Reason:** a correction exists to undo a mis-filed event, so it cannot be
> bound by that event's forward preconditions; but it must not become the generic state editor `CLAUDE.md`
> rule 14 forbids. **Scope note:** the approval workflow, separation of duties and audit trail for corrections
> belong to `specs/011-data-management/` and are **not** specified here. This file specifies only the axis rule.
> **Reversal cost:** tightening to "corrections may only restore a prior recorded state" is one clause.

---

## 4. Coverage check

| | Count |
|---|---:|
| Transaction types in the catalogue (`docs/15:422-447`, `transaction-command.md:25-47`) | **22** |
| Types covered by a rule here | **22** (100%) |
| Numbered rules (R-01 … R-25) | **25** |
| Rule **variants**, counting `Found`'s three separately | **27** |
| Types that branch into variants | 3 — `Transfer` (R-04/05/06), `ReturnFromCalibration` (R-10/11), `Found` (R-17a/b/c) |
| Types composed of other rules | 1 — `SwapComponent` (R-22 = R-21 then R-20, one commit) |
| Variants that touch **no** axis | 4 — R-06, R-18, R-23, R-24 |
| Variants that touch **exactly one** axis | **20** |
| Variants that touch two axes | 1 — R-11 (`ReturnFromCalibration` with `Fail`) |
| Variants that touch three | 1 — R-01 (`AddToInventory`; creation, so there is no prior value to leave alone) |
| Variants whose axis set depends on the corrected event | 1 — R-25 (`Correction`) |
| Types from `data/reference/state_machine.json` not covered | **0** (all 14 are among the 22) |

`R-19 Retire` counts as **one** axis: it sets `lifecycle` only. Freezing `disposition` and `serviceability` is
*not touching them* (DC-13).

**20 of 27 variants touch exactly one axis, and 4 touch none.** That ratio is the point of R1: under the single
`status` column, every one of these events had to write the one state column, which is why
`RepairComplete` produced "Available" and `ReportFault` erased deployment.

---

## 5. Refusal codes

Extends `error-codes.md`. Codes marked **new** are added by this contract.

| Failing thing | Code | Notes |
|---|---|---|
| Asset is `Retired` and the type is not `Audit`/`Correction` | `transition.error.lifecycleRetired` | **new** |
| A `disposition` precondition fails | `conflict.error.assetNotEligible` | **renamed** — see DC-17 |
| A `serviceability` precondition fails | `transition.error.serviceability` | **new** |
| The transaction type has no rule at all from this state | `transition.error.invalid` | existing (`error-codes.md:71`) |
| `Retire` with an open installation or parent relationship | `transition.error.openObligation` | **new** |
| `Found`/`Return`/`DetachComponent` with no determinable destination | `transition.error.destinationRequired` | **new** |
| Project closed or inactive | `transition.error.projectInactive` | existing (`error-codes.md:72`) |
| Kit / component invariant | `transition.error.componentRule` | existing (`error-codes.md:73`) |
| Missing workspace/purpose/action capability/row scope for this type | `auth.error.forbidden` | existing (`error-codes.md:42`) |

> **DEMO CALL 2026-09-03 (DC-17)** — **`conflict.error.assetNotAvailable` is renamed
> `conflict.error.assetNotEligible`**, and it becomes the code for a **disposition** precondition failure
> specifically — including the race-loser case.
> **Reason:** `docs/19` §9.4. `Available` is no longer a stored value; it is a display pill (`docs/15:124`), and
> `error-codes.md:4` lists i18n keys among this catalogue's consumers, so the obsolete vocabulary would surface
> in user-facing English. "Eligible" states the actual question — *does this asset satisfy this command's
> preconditions* — without naming a value that does not exist.
> **Why disposition specifically:** disposition is the only axis that races. Two simultaneous checkouts contend
> over `AtOffice`; nobody races a `ReportFault`. Binding the conflict code to the racing axis keeps
> `five-asset-race.md` S4's *"loser receives structured conflict"* mapped to exactly one code.
> **Reversal cost:** a rename before `packages/contracts/` exists costs one line. After it exists, it costs an
> i18n key migration.
> **No `app/` call site exists today** — `conflict.error.assetNotAvailable` appeared only in `error-codes.md`
> (renamed there on 2026-09-03) and in `docs/19`. Adjacent single-status vocabulary that *does* exist in `app/src/i18n/en.json` is listed in
> §10 and is **not** changed by this contract.

`TransactionRefused` (`transaction-command.md:154-162`) gains `currentLifecycle`, `currentServiceability` and
`failedAxis` alongside the existing `currentDisposition`, so one code can explain itself without a code
explosion. All four remain subject to *"only if caller may see it"* (`transaction-command.md:159`).

---

## 6. Calibration currency — the derivation

Calibration currency is **derived, never stored** (`docs/15:96-110`; `docs/19` §0 warns that "four independent
axes" invites a fourth column and there must not be one).

> **DEMO CALL 2026-09-03 (DC-18)** — **`InCalibration` is removed from the calibration-currency value list.**
> "At the lab" is read off `disposition = AtCalibrationLab`, which already carries it. Currency becomes six
> values: `NotRequired | Unknown | Current | DueSoon | Overdue | Failed`.
> **Reason:** `docs/19` §7.2. Keeping `InCalibration` in currency makes currency a *partial function of
> disposition*, and `specs/009-production-readiness/spec.md:128` (FR-013) requires all four axes to be
> "representable independently". Two axes must not encode the same fact. Worse, the current implementation
> (`app/src/api/mock/reporting.ts:128`) gives `InCalibration` **priority over the date buckets**, so an asset at
> the lab that is overdue is reported as neither overdue nor due-soon — it silently leaves the compliance
> number that feature 006 exists to report.
> **Which document is amended, and why that one:** the **derived enum**, not FR-013. FR-013 is an approved
> requirement of feature 009 and states the principle correctly. The currency value list is a *formula detail* —
> R1's own text calls currency "derived" — and removing one value from a derived enum changes no column, no
> stored row and no migration.
> **Reversal cost:** re-adding it is one value plus one precedence row. No data migration, ever, because it is
> derived.
> **FR-013 has been amended to match** — `specs/009-production-readiness/spec.md`, DC-26 there. FR-013 now
> defines independence as *no axis value duplicates another axis's fact*, which is the reason for this call
> rather than an obstacle to it.
> **Residual:** `docs/15` §3.4 and the R1 row at `docs/08-decisions.md:88` still list seven values. Neither file
> is this pass's to edit; reported to the decision-log owner. Until reconciled they disagree with FR-013 and
> with 010's contracts.

### 6.1 Precedence, evaluated top down — first match wins

> **DEMO CALL 2026-09-03 (DC-19)** — this is the full precedence order, and **`Failed` outranks `Overdue`**.

| # | Value | Condition |
|---:|---|---|
| 1 | `NotRequired` | the model has no calibration interval **and** the asset has no interval override **and** `last_successful_calibration_date` is null **and** `next_calibration_due_date` is null |
| 2 | **`Failed`** | the latest non-void calibration record by `calibration_date` has `result = Fail`, and no later `Pass` or accepted `Adjusted` record exists |
| 3 | `Unknown` | calibration is required but `next_calibration_due_date` is null |
| 4 | `Overdue` | `next_calibration_due_date < today` |
| 5 | `DueSoon` | `next_calibration_due_date <= today + horizon` |
| 6 | `Current` | otherwise |

Rule 1 restates today's `isCalibrated` test at `app/src/api/mock/reporting.ts:122`. Rules 3–5 restate
`reporting.ts:129-136`. Rule 6 makes explicit what today falls out of every bucket (`reporting.ts:137-138`).

> **Why `Failed` outranks `Overdue`.** `docs/15:599` — a `Fail` "does not advance successful calibration
> summaries" — so after a failure `next_calibration_due_date` still holds the *pre-failure* date, which is very
> likely already past. Reporting that asset as merely `Overdue` says "its certificate lapsed". The truth is
> stronger: **it was tested and it failed.** The actionable fact must not be masked by a date that is stale
> *because of* the failure. `docs/19` §7.2 records that the synthetic data already contains this exact case —
> the planted `failed-calibration-then-repair` scenario on `GEO-V12-400001`.
> **Reversal cost:** swap two rows in this table.

> **DEMO CALL 2026-09-03 (DC-20)** — **the default `DueSoon` horizon is 30 days**, and **"today" is the current
> date in `America/Toronto`**.
> **Reason:** the horizon is a caller-supplied parameter today (`app/src/api/mock/reporting.ts:105-112`), not a
> constant, so a *derived field* returned by the read API needs a default when nobody names one. 30 days is one
> month of lead time to book a lab slot. Report endpoints may still pass their own horizon; the
> `calibrationCurrency` field in `AssetSearchHit` uses 30. All Englobe Ontario offices sit in one timezone;
> evaluating "overdue" in UTC would flip assets over up to five hours early, on the wrong calendar day.
> **Honesty note:** `server/README.md:357-358` records that dates are still ISO-8601 text and that `timestamptz`
> is an unresolved migration. This states the rule the derivation must implement; it does **not** claim it is
> implemented. **Reversal cost:** two constants.

---

## 7. Compatibility display status — precedence, and the compatibility window

### 7.1 The pill is a precedence order

> **DEMO CALL 2026-09-03 (DC-21)** — the eight-value list at `docs/15:116-125` **is** a precedence order,
> evaluated top down, first match wins. It was never declared to be one (`docs/19` §7.7).

| # | Pill | Condition |
|---:|---|---|
| 1 | `Retired` | `lifecycle = Retired` |
| 2 | `Missing` | `disposition = Missing` |
| 3 | `In calibration` | `disposition = AtCalibrationLab` |
| 4 | `Needs repair` | `serviceability ∈ {NeedsRepair, OutOfService}` |
| 5 | `Deployed` | `disposition = Deployed` |
| 6 | `Checked out` | `disposition = CheckedOut` |
| 7 | `In transit` | `disposition = InTransit` |
| 8 | `Available` | otherwise — necessarily `(Active, AtOffice, Serviceable)` |

**Total over all 36 combinations**, verified by partition: rule 1 covers all 18 `Retired`; of the 18 `Active`,
rule 2 takes 3, rule 3 takes 3, rule 4 takes 8, and rules 5–8 take 1 each. 3+3+8+1+1+1+1 = 18. ✓

Rule 4 folds `OutOfService` into the existing "Needs repair" badge, so the mapping stays inside the seven badges
`app/src/components/StatusPill.tsx:4-12` already defines — no React screen changes for the collapse.
**Reason for fixing the order now:** `docs/19` §4.3 and §8.3 show the entire compatibility window depends on it,
and without a declaration every consumer — search page, reports, offline projection — encodes its own.
**Reversal cost:** reordering later silently changes what every historical report said. Cheap now, expensive
after the pilot. **Amendment needed elsewhere:** `docs/15` §3.5 should say "in precedence order".

### 7.2 The compatibility window — `docs/19` §8.3

`docs/08-decisions.md:88` and `docs/15:62` let the local mock and the `server/` POC keep a single `status` until
HTTP cutover. That is a reasonable staging choice with one trap: **axes → pill is total and mechanical; pill →
axes is not recoverable per row** (`NeedsRepair` does not say *where* the asset is). Transaction lines are
append-only (`.specify/memory/constitution.md:30-35`, `server/src/db/schema.sql:127-139`), so **any line written
with 2 state columns can never be backfilled to 6** — the values were never captured.

> **DEMO CALL 2026-09-03 (DC-22)** — **Option 1 of `docs/19` §8.3: the three axes are the stored truth from the
> first `server/` write against networked PostgreSQL. The single `status` survives only as a derived
> projection.** Specifically:
>
> 1. `asset` carries `lifecycle`, `disposition`, `serviceability`. The compatibility `status` is a **generated
>    column or a view** computed by §7.1's precedence order — **never written directly, by anything**.
> 2. `asset_transaction_line` carries **all six** axis columns (`docs/15:401-403`) from its first row.
> 3. `app/src/domain/deriveState.ts` is **extended, not forked** — `DerivedFields` returns three axes; the mock
>    projects down to a pill. `docs/19` §8.2 is explicit that a legacy `deriveState` beside an axis-aware one
>    creates two definitions of one business rule and violates constitution Principle VI by construction.
> 4. `data/reference/state_machine.json` becomes a **generated projection** of this file (or is deleted), not a
>    hand-maintained parallel. `app/scripts/generate-state-machine.mjs` is the natural place to enforce it.
>
> **Reason:** Option 2 — "window lines are disposable POC data" — is safe *only if stated*, and it is not
> statable here, because `server/src/db/seed.ts` loads from `migration/staged/`, i.e. from **real migrated asset
> data**. Declaring those lines disposable would be declaring real history disposable.
>
> **What it costs, plainly:**
> - Four columns on `asset_transaction_line` and one on `asset`, landing in WS-W2/W4 instead of at cutover
>   (`docs/19` §3.1). **Pulled forward, not added** — the same delta either way.
> - The `deriveState` rewrite is pulled forward with it. It is the single highest-leverage seam
>   (`docs/19` §3.4) and was going to happen regardless.
> - The two committed line fixtures (`app/public/data/transactionlines.json`,
>   `migration/staged/transactionlines.json`) need re-derivation: 3 of 7 statuses map mechanically per row, the
>   other 4 by replay of the unbroken `statusbefore → statusafter` chain (`docs/19` §4.2). **Lossy for none.**
> - Roughly 26 source files and 15 test files carry a status literal (`docs/19` §3.4); this brings that work
>   forward too.
>
> **What it buys:** no transaction line is ever written whose state cannot be recovered. That is the one cost in
> this whole decision that is genuinely irreversible.
>
> **Reversal cost:** none meaningful — reverting to a stored single `status` after the axes exist is the
> mechanical direction.
>
> **Scope note:** `server/**` is not this file's to edit. This is the contract the server must satisfy;
> reported to the coordinating agent, who owns `server/src/db/schema.sql`, `transactionService.ts` and
> `seed.ts` this pass.

---

## 8. Machine form (normative)

The tables above are the readable form; this block is the checkable one. `packages/domain/` loads it, server
tests assert against it, and `data/reference/state_machine.json` is generated from it (DC-22 item 4).
Abbreviated to the shape and three representative rules — the generator emits all 27 from §3.

```json
{
  "version": "2026-09-03",
  "supersedes": "data/reference/state_machine.json",
  "axes": {
    "lifecycle": ["Active", "Retired"],
    "disposition": ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab", "Missing"],
    "serviceability": ["Serviceable", "NeedsRepair", "OutOfService"]
  },
  "derived": {
    "calibrationCurrency": ["NotRequired", "Failed", "Unknown", "Overdue", "DueSoon", "Current"],
    "calibrationCurrencyPrecedence": ["NotRequired", "Failed", "Unknown", "Overdue", "DueSoon", "Current"],
    "dueSoonHorizonDays": 30,
    "todayTimezone": "America/Toronto",
    "displayPillPrecedence": [
      { "pill": "Retired",        "when": { "lifecycle": ["Retired"] } },
      { "pill": "Missing",        "when": { "disposition": ["Missing"] } },
      { "pill": "In calibration", "when": { "disposition": ["AtCalibrationLab"] } },
      { "pill": "Needs repair",   "when": { "serviceability": ["NeedsRepair", "OutOfService"] } },
      { "pill": "Deployed",       "when": { "disposition": ["Deployed"] } },
      { "pill": "Checked out",    "when": { "disposition": ["CheckedOut"] } },
      { "pill": "In transit",     "when": { "disposition": ["InTransit"] } },
      { "pill": "Available",      "when": {} }
    ]
  },
  "retiredIsTerminal": {
    "allowedTypes": ["Audit", "Correction"],
    "refusal": "transition.error.lifecycleRetired"
  },
  "rules": [
    {
      "id": "R-02",
      "type": "Checkout",
      "requires": {
        "lifecycle": ["Active"],
        "disposition": ["AtOffice"],
        "serviceability": ["Serviceable"]
      },
      "sets": { "disposition": "CheckedOut" },
      "untouched": ["lifecycle", "serviceability"],
      "nonAxis": {
        "custodianUserId": "toUserId|caller",
        "currentProjectId": "projectId",
        "currentLocationId": null
      },
      "refusal": {
        "disposition": "conflict.error.assetNotEligible",
        "serviceability": "transition.error.serviceability",
        "project": "transition.error.projectInactive"
      }
    },
    {
      "id": "R-12",
      "type": "ReportFault",
      "requires": {
        "lifecycle": ["Active"],
        "disposition": ["AtOffice", "CheckedOut", "Deployed", "InTransit", "AtCalibrationLab"],
        "serviceability": ["Serviceable"]
      },
      "sets": { "serviceability": "NeedsRepair" },
      "untouched": ["lifecycle", "disposition"],
      "nonAxis": {},
      "refusal": {
        "disposition": "conflict.error.assetNotEligible",
        "serviceability": "transition.error.serviceability"
      }
    },
    {
      "id": "R-19",
      "type": "Retire",
      "requires": {
        "lifecycle": ["Active"],
        "disposition": ["AtOffice", "AtCalibrationLab", "Missing"],
        "serviceability": null
      },
      "sets": { "lifecycle": "Retired" },
      "untouched": ["disposition", "serviceability"],
      "freeze": ["disposition", "serviceability"],
      "nonAxis": {
        "custodianUserId": null,
        "currentProjectId": null,
        "retiredAt": "effectiveAt",
        "requires": ["retirementReason", "noOpenInstallation", "noOpenParentRelationship"]
      },
      "refusal": {
        "disposition": "conflict.error.assetNotEligible",
        "openObligation": "transition.error.openObligation",
        "missingReason": "command.error.validation"
      }
    }
  ]
}
```

**Invariant the generator must assert**: every value of every axis is reachable by at least one rule's `sets`
(or by `AddToInventory`), and every value is exited by at least one rule. This is the check that would have
caught `InTransit` (DC-04) and would catch the next unreachable value automatically.

---

## 9. What feature 007 must now assert instead of "28 of 33 cells"

`specs/007-synthetic-data/spec.md:551-553` (SC-005) and `:424-427` (FR-049) state coverage against a 7 × 14
matrix that ceases to exist. Replacement target, offered here because this file defines the shape SC-005 has to
count (`docs/19` §4.2 and §10 Q11 record that nobody owns this amendment):

- **every one of the 27 rule variants exercised at least 10 times**, and
- **at least one asset observed in `(Active, Deployed, NeedsRepair)`** — the combination the old model could not
  express and the single clearest proof that R1 landed.

Amending `specs/007-synthetic-data/spec.md` is **not** this file's to do. Reported.

---

## 10. `app/` vocabulary this contract touches but does not change

`app/**` is out of scope for this pass. `conflict.error.assetNotAvailable` has **no `app/` call site** — it
appeared only in `error-codes.md` (renamed there on 2026-09-03) and in `docs/19`. The following existing i18n keys speak the single-status
vocabulary and will need attention at HTTP cutover. **Listed, not edited:**

| Location | Key / text |
|---|---|
| `app/src/i18n/en.json:15` | `search.filter.availableHere` — "Available here" |
| `app/src/i18n/en.json:53` | `asset.actions.notAllowed` — "Not available from {status}" |
| `app/src/i18n/en.json:65` | `cart.refusedNotAvailable` — "{assetId} is {status}, held by {custodian} — can't add it." |
| `app/src/i18n/en.json:125` | `admin.newAsset.confirmation` — "{id} registered and set Available at {office}." |
| `app/src/i18n/en.json:210` | `swap.error.incomingUnavailable` — "{assetId} is not Available and not in your custody." |
| `app/src/components/StatusPill.tsx:4-12` | the 7-badge map — survives unchanged under §7.1 |

Unrelated and **not** affected: `delete.notAvailable`
(`specs/011-data-management/contracts/retention-legal-hold.md:121`, `specs/011-data-management/tasks.md:267`) —
different namespace, different meaning.

---

## 11. Index of demo calls

All reversible unless noted. `grep -n "DEMO CALL 2026-09-03" specs/010-web-application-platform/contracts/transition-table.md`

| ID | Decision | §7.1 item | Amendment needed elsewhere |
|---|---|---|---|
| DC-01 | `AddToInventory` has no before-state precondition; seed lines conformant by construction | §10 Q9 | — |
| DC-02 | `Checkout` requires `Active` + `AtOffice` + `Serviceable`; `AtOffice` only | row 1, §9.2 | also restated in `transaction-command.md` |
| DC-03 | `Return` legal directly from `Deployed`; closes installation; serviceability untouched | row 4 | — |
| DC-04 | `InTransit` kept; produced by inter-office `Transfer`, ended by receipt `Transfer` | row 2, §7.3 | — |
| DC-05 | `Deploy` requires `Serviceable` | row 9 | — |
| DC-06 | `Undeploy` → `CheckedOut`, project preserved | row 3 | — |
| DC-07 | `ReturnFromCalibration` with `Fail` sets `serviceability = NeedsRepair` | §10 Q5 | — |
| DC-08 | `ReportFault` touches one axis and nothing else; refused from `Missing` and when already faulted | §7.1 | — |
| DC-09 | `RepairComplete` legal only from `NeedsRepair` | row 8 | — |
| DC-10 | `NeedsRepair` = fault, expected back; `OutOfService` = administrative withdrawal, admin-only | row 7, §7.5, §10 Q6 | — |
| DC-11 | `MarkMissing` does **not** close the installation or clear custody/location | row 6 | — |
| DC-12 | `Found` legal outcomes `{AtOffice, CheckedOut, Deployed}`; destination required; serviceability preserved | row 5 | — |
| DC-13 | Retired assets **freeze** disposition and serviceability; `Retire` refused with open custody/deployment | §7.4, §10 Q4 | `docs/15` §7 |
| DC-14 | Child disposition follows parent on attach; later divergence is legal | §10 Q10 (Q18) | — |
| DC-15 | `Audit` changes nothing | — | — |
| DC-16 | `Correction` may write otherwise-refused values, but only reachable states | — | feature 011 owns the workflow |
| DC-17 | `conflict.error.assetNotAvailable` → `conflict.error.assetNotEligible`, bound to the disposition axis | §9.4 | — |
| DC-18 | `InCalibration` removed from calibration currency; read it off `disposition` | §7.2, §10 Q7 | **`docs/15` §3.4 and `docs/08-decisions.md:88`** |
| DC-19 | Currency precedence fixed; **`Failed` outranks `Overdue`** | §7.2, §10 Q7 | — |
| DC-20 | `DueSoon` horizon 30 days; "today" is `America/Toronto` | §7.2, §10 Q7 | — |
| DC-21 | The pill list **is** a precedence order; total over all 36 combinations | §7.7 | `docs/15` §3.5 wording |
| DC-22 | Six state columns from the first networked write; `status` becomes a projection | §8.3, §10 Q12 | **`server/**` implementation** |

Three further calls live in the files they amend, and carry the same marker:

| ID | Decision | `docs/19` item | File |
|---|---|---|---|
| DC-23 | `AssetSearchHit` gains `calibrationCurrency` | §9.1 | `health-and-read.md` |
| DC-24 | `GET /api/assets` gains `serviceability` and `calibrationCurrency` filters | §9.3 | `health-and-read.md` |
| DC-25 | Four new `transition.error.*` codes so a refusal names the failing axis | §7.1 | `error-codes.md` |
| DC-26 | **FR-013 amended** — independence means no axis duplicates another's fact; currency drops `InCalibration` | §7.2, §9.1 | `specs/009-production-readiness/spec.md` |

Three more are closed in §12 under prototype mode: **DC-27** (651 unknowable assets import as
`(Active, CheckedOut, Serviceable)`), **DC-28** (prototype role floors), **DC-29** (backdating needs no extra
rule — R4/Q9 already closes it).

---

## 12. What this file does **not** settle

Stated as plainly as the calls above.

1. **`docs/19` §10 Q2 — does a faulted instrument ever stay deployed in Englobe's real practice?** Not recorded
   anywhere in the repository. DC-08 makes `(Active, Deployed, NeedsRepair)` *representable*; whether it is ever
   *observed* is an operating fact. If it never happens, the serviceability axis is precision nobody consumes.
   **What would settle it:** count `ReportFault` events filed against `disposition = Deployed` in the first
   pilot quarter.
2. **Q18 — permanent-component calibration** is ASSUMED, not decided (`docs/08-decisions.md:45`). DC-14 takes
   the reversible side (divergence permitted, never required), so nothing is blocked — but the *product*
   question remains open.
3. **The correction workflow** — approval, separation of duties, audit — belongs to
   `specs/011-data-management/` (`CLAUDE.md` data-management rules). DC-16 specifies the axis rule, which is all
   the prototype needs.
4. **Nothing here is implemented.** Maturity: **Spec Draft**. No code, migration or test has been written
   against this file. The claim of this document is that it *can* be, not that it *has* been.

### Closed under prototype mode

> **DEMO CALL 2026-09-03 (DC-27)** — **the 651 migrated assets whose disposition is unknowable import as
> `(Active, CheckedOut, Serviceable)`. No `Unknown` disposition value is added.**
> **Reason:** `docs/19` §5.3 — `disposition` cannot be derived for 63% of the staged fleet (the source column is
> literally the disjunction "Deployed or NOT Available", `Deployment Date` is blank in all 1,053 rows, `Location`
> is set in 3) and `serviceability` is an assumption for 99.7%. This is **exactly what the migration already
> does** (`migration/02_clean.py:63-68` maps "Deployed or NOT Available" → `CheckedOut`), so it is zero new work
> and it preserves today's honesty rather than minting a permanent seventh production enum value for a one-off
> import problem. The existing 592-row return sweep (`migration/02_clean.py:562-568`,
> `migration/reports/02_sweep_checklist.md`) is the correction path and is unaffected by R1.
> **`Missing` must NOT be reused as "unknown"** (`docs/19` §7.6): conflating "reported lost by a custodian via
> `MarkMissing`" with "the 2026 CSV was ambiguous" would corrupt every loss-rate report the fleet ever runs.
> Nothing in this table permits that conflation and nothing should.
> **Reversal cost:** adding an `Unknown` disposition later means one enum value, one pill row, and a bulk
> correction of the affected assets — the sweep is going to touch them anyway.
> **Scope:** `migration/**` is not this file's to edit. This states what the loader must produce.

> **DEMO CALL 2026-09-03 (DC-28), superseded by R5/D18 on 2026-09-04.** The prototype used
> OfficeAdmin/SystemOwner role floors for `MarkOutOfService`, `ReturnToService`, `RehomeAsset`,
> `Retire`, and `Correction`, and treated other types as FieldUser-capable. That shortcut no longer
> authorizes anything. The administrative commands now require the exact capabilities declared in
> their rows; every other command requires its own manifest/transaction-contract capability and
> purpose. R5 supplies only the maximum office/global row scope. Direct axis writes remain denied to
> every user.

> **DEMO CALL 2026-09-03 (DC-29)** — **backdating cannot retroactively invalidate an already-accepted event's
> precondition, and no extra rule is needed.**
> **Reason:** R4/Q9 (`docs/08-decisions.md:92`) already refuses any backdate that would land **at or before an
> existing transaction line for the same asset**. A backdated event therefore always lands strictly *after*
> every line that asset already has — so there is never a later accepted event whose precondition it could
> falsify. The Q9 rule, which exists for replay honesty (acceptance question 7), closes this on its own. The
> preconditions in this table are evaluated against the asset's **current** axes at lock time, which by Q9 is
> also its state at the backdated instant.
> **Reversal cost:** if Q9 is ever relaxed to permit true insertion between existing lines, this closes again
> and every rule here needs a retroactive-validation pass. **Do not relax Q9 without reopening this.**
