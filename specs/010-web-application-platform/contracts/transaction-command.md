# Contract: Atomic Transaction Command (R2 FROZEN for first proof)

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: **Frozen for first proof** (Jay, 2026-09-03 — R2)  
**Gate**: WS-W4 may implement against this contract. Later event types may extend fields; they must not silently rewrite locking, idempotency, or server-owned field rules.  
**Consumers**: `server/src/modules/transactions/`, `packages/contracts/`, `app/src/api/http/`,
feature 009 proof harness, offline queue.

Authority: `docs/14` §5, `docs/15` §7–8, constitution Principles I, II, V, VIII.  
State columns: **`R1 APPROVED 2026-09-03`**.  
**Transition rules: `transition-table.md`** — the "transition contract data" this file deferred to below. It
fills the hole the freeze left open; it rewrites no locking, idempotency or server-owned-field rule, so the R2
freeze (`docs/08-decisions.md:89`) holds.  
Checkout fields: **`R4 APPROVED 2026-09-03`** (Q8 optional expected return; Q9 admin backdate rules).

## Endpoint

```http
POST /api/transactions
Content-Type: application/json
Idempotency-Key: <uuid>   ; preferred header; body.clientSubmissionId must match if both sent
```

One origin with the PWA. Session cookie / BFF auth required (see `auth-caller-context.md`).

## Request

```ts
/** Client-proposed business event. Server owns all derived state. */
export type TransactionCommandType =
  | "Checkout"
  | "Return"
  | "Transfer"
  | "Deploy"
  | "Undeploy"
  | "SendToCalibration"
  | "ReturnFromCalibration"
  | "ReportFault"
  | "RepairComplete"
  | "MarkOutOfService"
  | "ReturnToService"
  | "MarkMissing"
  | "Found"
  | "RehomeAsset"
  | "AttachComponent"
  | "DetachComponent"
  | "SwapComponent"
  | "ChangeInstallationConfiguration"
  | "Retire"
  | "Audit"
  | "Correction"
  | "AddToInventory"; // registration may use a dedicated route; catalogue includes it

export interface TransactionLineInput {
  assetId: string; // canonical Asset ID or UUID — server resolves; prefer UUID in API v1
  kitRole?: string | null;
  orientation?: string | null;
  powerSource?: string | null;
  condition?: "Good" | "Damaged" | "NeedsService" | null;
  notes?: string | null;
  // FORBIDDEN on input (server-owned):
  // lifecycleBefore/After, dispositionBefore/After, serviceabilityBefore/After,
  // location/custodian/project/parent before/after, lineNumber, sequence values
}

export interface TransactionCommandRequest {
  type: TransactionCommandType;
  clientSubmissionId: string; // UUID; must equal Idempotency-Key when header present
  /** Business-effective time. R4 APPROVED 2026-09-03 (Q9) — backdating policy undecided. */
  effectiveAt?: string; // ISO timestamptz; omit = server now
  projectId?: string | null;
  toUserId?: string | null;
  fromUserId?: string | null; // ignored for authority; server may validate against custody
  toLocationId?: string | null;
  fromLocationId?: string | null;
  primaryAssetId?: string | null;
  /** R4 APPROVED 2026-09-03 (Q8) — expected-return product rule undecided. */
  expectedReturnDate?: string | null; // date-only YYYY-MM-DD
  reasonCode?: string | null;
  notes?: string | null;
  correctionOfTransactionId?: string | null; // required when type === "Correction"
  lines: TransactionLineInput[];
  /**
   * If present, MUST be ignored for authority or refused with
   * `command.error.clientOwnedStateForbidden`. Never trusted.
   */
  clientStateHints?: unknown;
}
```

### Canonical request hash

1. Take the parsed body after schema validation.
2. Remove transport-only fields; normalize UUID casing; sort object keys; omit `undefined`.
3. Exclude raw `Idempotency-Key` header (already mirrored as `clientSubmissionId`).
4. SHA-256 hex of UTF-8 stable JSON.
5. Store on `command_idempotency.request_hash` and `asset_transaction.request_hash`.

Same ID + same hash → replay original HTTP status + body.  
Same ID + different hash → `command.error.idempotencyPayloadMismatch` (client defect).

## Server-owned fields (never accepted from browser as authority)

| Field | Source |
|---|---|
| Caller user id, roles, office scope | Session / Entra (`auth-caller-context.md`) |
| `recorded_at` | Server clock at accept |
| `transaction_number` | DB sequence |
| Line `lifecycle_*`, `disposition_*`, `serviceability_*` | Server derivation — **R1 APPROVED 2026-09-03** |
| Location / custodian / project / parent before & after | Server derivation |
| Asset ID sequence values | Locked `asset_id_sequence` row |
| Outbox payloads | Server |

## Processing sequence (one PostgreSQL transaction)

1. Resolve `CallerContext`; refuse unauthenticated / inactive.
2. Claim idempotency row (`Processing`) or return stored outcome.
3. Collect distinct asset UUIDs; `SELECT … FOR UPDATE` in ascending UUID order.
4. Load related project/location/user/relationship rows as needed.
5. Validate role, office scope, transitions, kit rules, required fields, backdating (**R4 APPROVED 2026-09-03**).
6. On any line failure → rollback entire command; structured refusal (HTTP 200 `{ ok: false }` or
   agreed 409 — see `error-codes.md`; offline queue treats business refusal as answered).
7. Insert header + lines; apply derived asset updates; open/close relationships; insert outbox;
   set idempotency `Applied` + response body; commit.
8. Bounded retry only for serialization/deadlock failures (same submission ID).

## Success response

```ts
export interface TransactionLineResult {
  assetId: string;
  assetUuid: string;
  lineNumber: number;
  lifecycleAfter: string;      // R1 APPROVED 2026-09-03
  dispositionAfter: string;    // R1 APPROVED 2026-09-03
  serviceabilityAfter: string; // R1 APPROVED 2026-09-03
  locationId: string | null;
  custodianUserId: string | null;
  projectId: string | null;
  rowVersion: number;
}

export interface TransactionAccepted {
  ok: true;
  transactionId: string;
  transactionNumber: string; // e.g. TXN-000123
  type: TransactionCommandType;
  recordedAt: string;
  effectiveAt: string;
  lines: TransactionLineResult[];
  replayed?: boolean; // true when idempotent replay
}
```

## Refusal / conflict (business)

```ts
export interface TransactionRefused {
  ok: false;
  code: string; // from error-codes.md
  messageKey: string; // i18n key; stable for tests
  offendingAssetId?: string;
  /** Which axis failed the precondition — `transition-table.md` §5 */
  failedAxis?: "lifecycle" | "disposition" | "serviceability";
  currentLifecycle?: string;      // R1 APPROVED 2026-09-03 — only if caller may see it
  currentDisposition?: string;    // R1 APPROVED 2026-09-03 — only if caller may see it
  currentServiceability?: string; // R1 APPROVED 2026-09-03 — only if caller may see it
  currentCustodianDisplay?: string | null;
  conflictTransactionId?: string;
}
```

## First-proof command: Checkout

MVP tests (WS-W4) implement `type: "Checkout"` first with ≥1 and ≤N lines (five-asset cases).

Checkout validation — **rule R-02 in `transition-table.md` §3.2 is normative**; this is its restatement:

- `lifecycle === "Active"` (**R1 APPROVED 2026-09-03**).
- `disposition === "AtOffice"` — the **only** permitted disposition. Refusal
  `conflict.error.assetNotEligible`.
- `serviceability === "Serviceable"`. Refusal `transition.error.serviceability`.
- Project active when `projectId` required.
- Authorization: caller is within the decided R5 row ceiling and the active workspace, route purpose
  and exact command capability all permit Checkout. SystemOwner's global row ceiling is not a command
  capability.
- Invalid fifth line → zero writes.
- Overlap race → one `Applied`, one conflict code.

## Invariants reviewers verify

1. No partial line set committed.
2. Lock order is UUID ascending regardless of input order.
3. 100 replays of accepted key → one transaction.
4. Header/lines immutable to every principal, including SystemOwner; corrections are new linked events.
5. `ReportFault` does not clear disposition/project/custody — `transition-table.md` R-12.
6. Outbox rows exist only inside the same commit as acceptance.
7. Checkout of a `NeedsRepair` or `OutOfService` asset is refused — `transition-table.md` R-02 / DC-02.
8. Every accepted line writes **only** the axes its rule's `sets` names; an axis absent from `sets` is not
   written at all. `transition-table.md` §1.

---

## Amendments made 2026-09-03 (demo-scoped, reversible)

> **DEMO CALL 2026-09-03 (DC-02, restated here)** — **the checkout precondition gains
> `serviceability === "Serviceable"`, and disposition is narrowed from "typically `AtOffice` / available pool"
> to `AtOffice` exactly.**
>
> **Reason:** `specs/009-production-readiness/spec.md:131` (FR-015) — *"Availability MUST require active
> lifecycle, serviceable condition and physical presence at the selected office"* — names all three axes. This
> contract checked two. `docs/19-state-model-decision.md` §9.2 found it: **as written, the frozen contract
> permitted checking out a broken instrument.**
>
> **Why it was missing.** Under the old single-status matrix the check was *implicit* — `NeedsRepair` was a
> value of the one `status` column and `data/reference/state_machine.json:46-51` gives `NeedsRepair` no
> `Checkout` key at all, so the matrix refused it without anyone naming serviceability. **Under the three axes
> it is no longer implicit.** `disposition` and `serviceability` are separate columns, and an asset can be
> `(Active, AtOffice, NeedsRepair)` — the exact state R1 exists to make representable. Nothing refuses that
> checkout unless a rule says so. This is the general shape of the risk the split creates: *every precondition
> that used to fall out of the single enum has to be restated per axis, or it silently disappears.*
>
> **Relationship to the R2 freeze.** The freeze (`docs/08-decisions.md:89`) permits extension and forbids
> silently rewriting locking, idempotency, or server-owned field rules. This changes none of those. It supplies
> the "exact table in transition contract data" that the frozen text itself deferred to, and it *narrows* what
> the server accepts — it never widens authority.
>
> **Reversal cost:** removing the precondition is one line and one test. Note the asymmetry: adding it later,
> after assets have been checked out broken, means the history contains checkouts this rule would refuse.
