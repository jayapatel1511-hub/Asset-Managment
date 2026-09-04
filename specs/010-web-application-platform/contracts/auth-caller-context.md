# Contract: Auth Caller Context

**Feature**: 010 | **Date**: 2026-09-03 | **Status**: Draft; D18 read-projection amendment 2026-09-04
**Consumers**: every protected `server/` route, offline replay identity checks, WS-W3, WS-W12
direct API matrix.

## Rule

The browser **never** supplies authoritative role, office scope, or user id. Those come from the
authenticated session after Entra OIDC (production) or an explicit test double (local proof only).
Role is an access ceiling, not a response shape. The server also resolves named capabilities and
intersects them with workspace, route purpose, row scope, and field policy before reading data; see
`docs/25-need-to-know-access-ux.md`.

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
  capabilities: string[];      // server-resolved named claims; never browser authority
  officeScopes: OfficeScopeEntry[];
  /** Correlation for logs; not a security claim. */
  correlationId: string;
  /** D18/R5: fixed by server policy, never browser-selectable. */
  adminScopeMode: "global" | "office"; // OfficeAdmin=office; SystemOwner=global where exact capability permits
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
| Read asset in Work | Work capability + row scope + `field_work_asset_v1` or `desk_work_asset_v1`; no universal Asset response |
| Read asset in Reports | Report purpose/capability + row scope + report projection; no operational actions |
| Read asset in Administration | Exact admin capability + row scope + task projection; admin role alone is insufficient |
| Checkout / Return / Transfer | Exact action capability + actor/row scope + current-state and workflow rules; role alone is insufficient |
| Calibration certificate download | Approved evidence purpose + `maintenance.evidence.read` + row scope + document ACL + audit; asset read is insufficient |
| Reference-data write | Not this contract — feature 011 |
| Cross-office admin | R5: OfficeAdmin refused outside assigned office; SystemOwner only with exact global action capability |

Exact role×action matrix is finalized in WS-W3 tests; this contract forbids trusting the browser.
The D18 test matrix is role × workspace × purpose × capability × row scope × projection. A hidden UI
element, `isAdmin` boolean, or broad `requireAnyRole` read is not an authorization decision.

## Session lifecycle

```ts
export interface SessionIsolationRules {
  /** IndexedDB partition key components */
  partition: {
    environmentId: string;
    tenantId: string;
    entraObjectId: string;
    workspace: "Work" | "Reports" | "Administration";
    dataProjectionId: string;
  };
  onSignOut: "seal-partition-no-replay";
  onUserSwitchSameDevice: "never-replay-prior-queue";
  onDisabledEntraUser: "reject-api-allow-read-only-cached-shell-policy-TBD";
}
```

Offline queue must persist `originatingUserId` / `entraObjectId` and refuse replay when the live
session identity differs (`command.error.identityMismatch`).

## Local / CI test double

Until Entra (R6) is available, the test double mirrors decided R5 scope:

```ts
export interface TestCallerOverrides {
  /** Only enabled when AMS_AUTH_MODE=test and non-production environment. */
  userId: string;
  roles: AppRole[];
  capabilities: string[];
  officeScopes: OfficeScopeEntry[];
  adminScopeMode: "global" | "office";
}
```

Production builds must not compile with a default open test auth path.

## Deep link

After sign-in, return to the originally requested path (asset/installation URL). Unauthorized users
receive no asset payload (FR-002 / US1).
