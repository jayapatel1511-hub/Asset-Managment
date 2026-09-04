# Contract: Structured API Error Codes

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Consumers**: `packages/contracts/`, `app/src/api/http/`, offline queue disposition, i18n keys,
WS-W4/W12 tests.

## Transport vs business

| Class | HTTP (draft) | Client queue behaviour |
|---|---|---|
| Accepted | 200 | `{ ok: true, … }` — done |
| Business refusal / conflict | 200 with `{ ok: false, code }` **or** 409 with same body | Mark answered; surface reason; do **not** infinite-retry |
| Idempotency payload mismatch | 409 or 422 | Client defect; do not retry as-is |
| Auth | 401 / 403 | Re-auth or Needs attention; never replay under other user |
| Validation (schema) | 400 | Fix client; do not retry same bytes |
| Server / network fault | 5xx / network error | Retry with same submission ID |

Align exact HTTP status for business refusal with the existing POC preference (200 + `ok: false`)
unless freeze decides 409 — **one** choice must be frozen with R2. Offline queue depends on it.

## Envelope

```ts
export interface ApiErrorBody {
  ok: false;
  code: string;           // stable machine code below
  messageKey: string;     // i18n
  message?: string;       // optional English diagnostic for logs/tests — no secrets
  offendingAssetId?: string;
  details?: Record<string, unknown>; // non-sensitive only
  correlationId: string;
}
```

## Code catalogue (010 platform)

### Auth — `auth.*`

| Code | When |
|---|---|
| `auth.error.unauthenticated` | No/invalid session |
| `auth.error.forbidden` | Authenticated but not permitted |
| `auth.error.inactiveUser` | `app_user.is_active = false` |
| `auth.error.clientAuthorityForbidden` | Browser sent role/state authority |
| `auth.error.identityMismatch` | Offline replay identity ≠ session |
| `auth.error.officeScope` | Cross-office action refused (**ASSUMPTION: R5**) |

### Command / idempotency — `command.*`

| Code | When |
|---|---|
| `command.error.validation` | Schema / required field |
| `command.error.idempotencyPayloadMismatch` | Same ID, different hash |
| `command.error.clientOwnedStateForbidden` | Before/after or sequence in body |
| `command.error.unsupportedType` | Unknown `type` |
| `command.error.processingTimeout` | Stuck `Processing` (ops alert) |
| `command.error.serializationRetryExhausted` | Deadlock retries exhausted |

### Conflict / transition — `conflict.*` / `transition.*`

Precondition sources and the rule each code belongs to: **`transition-table.md` §5**.

| Code | When |
|---|---|
| `conflict.error.assetNotEligible` | A **`disposition`** precondition fails — including the race-loser case. Renamed 2026-09-03, see DC-17 below |
| `conflict.error.rowVersion` | Optimistic read stale (non-lock path) |
| `transition.error.serviceability` | **new** — a `serviceability` precondition fails (e.g. `Checkout`/`Deploy` of a `NeedsRepair` asset; `RepairComplete` from `OutOfService`) |
| `transition.error.lifecycleRetired` | **new** — asset is `Retired` and the type is not `Audit` / `Correction` |
| `transition.error.openObligation` | **new** — `Retire` while custody, an installation or a parent relationship is open |
| `transition.error.destinationRequired` | **new** — `Found` / `Return` / `DetachComponent` with no determinable destination |
| `transition.error.invalid` | The transaction type has **no rule at all** from this state — **R1 APPROVED 2026-09-03** |
| `transition.error.projectInactive` | Checkout/deploy to closed project |
| `transition.error.componentRule` | Kit/component invariant |

### Registration — `registration.*`

| Code | When |
|---|---|
| `registration.error.duplicateAssetId` | Unique constraint |
| `registration.error.sequenceConflict` | Unexpected; should be rare with row lock |

### Document — `document.*`

| Code | When |
|---|---|
| `document.error.forbidden` | Not authorized |
| `document.error.typeOrSize` | Policy refuse |
| `document.error.hashMismatch` | Integrity fail |
| `document.error.quarantined` | Scan not clean |
| `document.error.notFound` | Missing or hidden |

### Platform — `platform.*`

| Code | When |
|---|---|
| `platform.error.notImplemented` | Route stub |
| `platform.error.syntheticForbidden` | Synthetic marker in production |
| `platform.error.dependency` | DB/blob unavailable |

## i18n

Every `messageKey` is added under `app/src/i18n/en.json` when the HTTP adapter surfaces it. Tests
assert **codes**, not localized English prose.

## Extension

Feature 011 adds `data.*` / `job.*` / `export.*` codes in its own contracts. Feature 009 may
reference these codes in proof expectations but must not redefine them.

---

## Amendments made 2026-09-03 (demo-scoped, reversible)

> **DEMO CALL 2026-09-03 (DC-17)** — **`conflict.error.assetNotAvailable` is renamed
> `conflict.error.assetNotEligible`** and redefined as *"a `disposition` precondition failed"*.
>
> **Reason:** `docs/19-state-model-decision.md` §9.4. `Available` is **no longer a stored value** under R1 — it
> is a display pill (`docs/15-postgres-data-model.md:124`) produced by a precedence order
> (`transition-table.md` §7.1). The code named a concept that no longer exists as state, and this file's own
> header lists **i18n keys** among its consumers, so the obsolete vocabulary would have surfaced in user-facing
> English. "Eligible" states the real question — *does this asset satisfy this command's preconditions* —
> without naming a value that is gone.
>
> **Why it is bound to `disposition` specifically.** The old entry meant two different things at once ("race
> loser / wrong disposition"). Disposition is the only axis that races: two simultaneous checkouts contend over
> `AtOffice`; nobody races a `ReportFault`. Binding the conflict code to the racing axis keeps
> `specs/009-production-readiness/contracts/five-asset-race.md` S4's *"loser receives structured conflict"*
> mapped to exactly one code, while lifecycle and serviceability failures get their own `transition.error.*`
> codes above. `TransactionRefused` carries `failedAxis` so one code can still explain itself.
>
> **Call sites:** none in `app/`. `conflict.error.assetNotAvailable` appeared only in this file and in
> `docs/19`. Adjacent single-status wording that *does* exist in `app/src/i18n/en.json` is listed in
> `transition-table.md` §10 and is deliberately **not** changed by this pass. `delete.notAvailable`
> (`specs/011-data-management/contracts/retention-legal-hold.md:121`) is a different namespace and is
> untouched.
>
> **Reversal cost:** one line, while `packages/contracts/` does not yet exist. After it exists and the i18n key
> ships, reversing costs a key migration — which is precisely why it was done now.

> **DEMO CALL 2026-09-03 (DC-25)** — four new `transition.error.*` codes are added so a refusal can name the
> axis that failed. **Reason:** with three axes, one generic `transition.error.invalid` cannot tell a field user
> whether the instrument is broken, retired, or someone else has it — and tests assert codes, not prose.
> **Reversal cost:** collapsing them back into `transition.error.invalid` is a mapping table.

Feature 011's `data.*` / `job.*` / `export.*` codes are unaffected.
