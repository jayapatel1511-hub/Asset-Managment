# Contract: Device evidence (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: 010 PWA/offline behavior and command queue semantics (WS-W6 build); idempotency + auth-session
contracts for replay rules (consumes 010 contracts)  
**Workstream**: WS-W6 implements; **WS-W12** records evidence  
**Spec mapping**: US5; FR-033–FR-035, FR-029–FR-030; SC-011

## Purpose

Evidence **record shape** for hosted iOS/Android (and approved desktop browsers if claimed). Local mock
queue tests do not satisfy Device Verified. Unverified behavior must be removed from pilot claims or
marked unsupported (FR-034).

## Device matrix row (one per device × OS version × browser/WebView)

| Field | Required content |
|---|---|
| `device_id` | Inventory tag or descriptive id |
| `platform` | iOS \| Android \| other approved |
| `os_version` | Exact |
| `client` | Safari / Chrome / Edge / installed PWA WebView as applicable |
| `app_revision` | Commit / container image / build number of **published** client under test |
| `api_environment` | Dev / UAT |
| `tester` | Named owner |
| `tested_at` | ISO date |
| `result` | pass \| fail \| unsupported |
| `notes` | Short; no secrets |

## Scenario checklist (record each)

| ID | Scenario | Pass criteria |
|---|---|---|
| D1 | Online → airplane mode; search + supported submit | Matches documented supported offline behavior |
| D2 | Cold reopen while offline | Works as specified **or** explicit unsupported message (not silent blank/corrupt) |
| D3 | Device reboot; reopen offline | Queued work persists **only if** that behavior is claimed and tested |
| D4 | Queue checkout/return/transfer (or claimed set) | Commands durable with submission IDs; shown as pending not accepted |
| D5 | Conflict from second device; reconnect | Conflict visible in Needs Attention; never silently discarded |
| D6 | Accepted response lost; retry | Idempotent; no duplicate business event |
| D7 | Auth expiry before replay | Reauthentication occurs; no replay under expired/foreign identity |
| D8 | Same-device user change | Prior user’s cache/queue inaccessible; no replay under new identity |
| D9 | Secured SIM/network fields | Absent from Field User local storage / IndexedDB projections |
| D10 | Camera permission denied / granted / interrupted | Documented behavior; no crash/data loss beyond policy |
| D11 | PWA update with queued commands | Queue preserved across update (if claimed) |
| D12 | Storage eviction / quota pressure | Documented degradation; no silent accept |

## Aggregate evidence pack

| Field | Content |
|---|---|
| `contract` | `device-evidence` |
| `supported_matrix` | List of device rows with all D-scenarios |
| `pilot_claims` | Only behaviors with pass on every required device class |
| `unsupported_carved_out` | Explicit list removed from pilot acceptance |
| `owner` / `ran_at` / `result` | Device Verified eligibility |

## Non-claims

- Desktop Chrome + DevTools offline is not a substitute for managed phone evidence when phone is claimed.
- “Works on my emulator once” without dated matrix row is fail for SC-011.
