# Contract: Auth Caller Context

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft  
**Consumers**: every protected `server/` route, offline replay identity checks, WS-W3, WS-W12
direct API matrix.

## Rule

The browser **never** supplies authoritative role, office scope, or user id. Those come from the
authenticated session after Entra OIDC (production) or an explicit test double (local proof only).

## Production identity

- Tenant-scoped Microsoft Entra ID.
- Authorization Code + PKCE; BFF session cookie (httpOnly, Secure, SameSite as approved).
- Stable key: `(tenant_id, entra_object_id)` → `app_user.id`.
- UPN/display name are attributes, not identity keys.
- No AMS password store (FR-003).

## Roles

```ts
export type AppRole =
  | "FieldUser"
  | "OfficeAdmin"
  | "SystemOwner"
  | "ReportReader";
```

Mapping from Entra app roles or groups is an enterprise config concern. Source recorded on
`user_role.source`: `EntraAppRole` | `EntraGroup` | `ManualEmergency`.

## Caller context (server-resolved)

```ts
export interface OfficeScopeEntry {
  officeLocationId: string;
  scopeType: "Member" | "Administer" | "Report";
}

export interface CallerContext {
  userId: string;              // app_user.id UUID
  entraObjectId: string;
  tenantId: string;
  displayName: string;
  upn: string;
  isActive: boolean;
  roles: AppRole[];            // current rows only
  officeScopes: OfficeScopeEntry[];
  /** Correlation for logs; not a security claim. */
  correlationId: string;
  /**
   * ASSUMPTION: R5 — whether OfficeAdmin is global or must match officeScopes.
   * Until decided, SystemOwner is global; OfficeAdmin checks must be written behind
   * a single helper that can flip when R5 closes.
   */
  adminScopeMode: "global" | "office"; // config / feature flag from approved decision
}
```

## Forbidden client claims

If the request body or headers include any of the following as authority, ignore or refuse with
`auth.error.clientAuthorityForbidden`:

- `role`, `roles`, `isAdmin`, `officeIds` as security input
- `performedByUserId` overriding session
- Impersonation fields without a separate audited System Owner path

## Authorization checks (API)

| Action | Minimum |
|---|---|
| Read asset in office | Role permits read + office scope (FieldUser member / Report / Admin per matrix) |
| Checkout / Return / Transfer | FieldUser or OfficeAdmin + custody/office rules |
| Calibration certificate download | Role + document ACL; FieldUser may be denied secured docs |
| Reference-data write | Not this contract — feature 011 |
| Cross-office admin | **ASSUMPTION: R5** |

Exact role×action matrix is finalized in WS-W3 tests; this contract forbids trusting the browser.

## Session lifecycle

```ts
export interface SessionIsolationRules {
  /** IndexedDB partition key components */
  partition: {
    environmentId: string;
    tenantId: string;
    entraObjectId: string;
  };
  onSignOut: "seal-partition-no-replay";
  onUserSwitchSameDevice: "never-replay-prior-queue";
  onDisabledEntraUser: "reject-api-allow-read-only-cached-shell-policy-TBD";
}
```

Offline queue must persist `originatingUserId` / `entraObjectId` and refuse replay when the live
session identity differs (`command.error.identityMismatch`).

## Local / CI test double

Until Entra (R6) and admin scope (R5) are available:

```ts
export interface TestCallerOverrides {
  /** Only enabled when AMS_AUTH_MODE=test and non-production environment. */
  userId: string;
  roles: AppRole[];
  officeScopes: OfficeScopeEntry[];
  adminScopeMode: "global" | "office";
}
```

Production builds must not compile with a default open test auth path.

## Deep link

After sign-in, return to the originally requested path (asset/installation URL). Unauthorized users
receive no asset payload (FR-002 / US1).
