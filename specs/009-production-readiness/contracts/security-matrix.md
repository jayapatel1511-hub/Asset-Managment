# Contract: Security matrix (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: `specs/010-web-application-platform/contracts/auth-session.md`,
`error-codes.md`, `document-upload.md`, plus export/report authorization from 010/011 as applicable
(consumes 010 contracts; 011 export contracts when present)  
**Workstream**: WS-W12 security  
**Spec mapping**: US4; FR-025–FR-032c; SC-009, SC-010, SC-016–SC-018
**Gate**: R5 is decided (OfficeAdmin assigned-office scoped; SystemOwner global ceiling). D18
workspace/purpose/capability/projection enforcement and the full Entra matrix still require Azure
Integrated evidence.

## Purpose

Define **direct API** (and export/report) authorization proof — not UI filtering. Interface checks are
faster feedback only and **never** count as Security Verified evidence.

## Decided scope ceiling and D18 intersection

| Assignment | Matrix implication |
|---|---|
| **OfficeAdmin** | Assigned-office maximum; every read/write still requires the active workspace, purpose, named capability, row scope, and field projection |
| **SystemOwner** | Global row-scope ceiling only; no automatic Work, Reports, evidence, financial, stewardship, or document capability |
| **ReportReader** | Assigned-office, read-only Reports ceiling; no Work, Scan, Administration, or Data Management inheritance |

## Assignment × workspace × purpose × capability × path matrix (minimum)

Fill pass/fail per cell with dated run. Paths: **App** (sanity only), **Direct API** (required), **Export**, **Report/view**.

| Action / data | Field User | Office Admin | System Owner | Report Reader | Automation worker |
|---|---|---|---|---|---|
| Read secured SIM/ICCID/phone/static IP | Deny Work/Reports/cache/export | Only named Administration projection + `network.asset.read` + own-office scope | Only named Administration projection + `network.asset.read`; global row scope is not the capability | **Deny** general Reports | Least privilege only |
| Write asset in other office | Deny | Deny | Exact global action capability required | Deny | Deny unless approved job |
| Write derived state directly (lifecycle/disposition/…) | Deny | Deny | Deny | Deny | Deny (commands only) |
| Edit accepted transaction line | Deny | Deny | Deny | Deny | Deny |
| Create relationship cycle / self-parent / second open parent | Deny | Deny | Deny | Deny | Deny |
| Download calibration document without evidence purpose/capability/ACL | Deny | Deny | Deny | Deny | Deny |
| Run governed export beyond workspace/purpose/capability/template/projection | Deny | Deny | Deny | Deny | Deny |
| Open wrong-workspace/direct route | Zero protected fetch; safe handoff/deny | Same | Same | Same | N/A |
| Reuse cached privileged response after workspace/capability change | Deny; purge/partition | Same | Same | Same | N/A |

**SC-009**: Every forbidden action above fails on **Direct API**, **Export** and **Report** — not App alone.

**SC-010**: Field Work responses/local storage and general Reports responses/exports contain exactly
their versioned allowlisted keys and **zero** calibration/evidence records or links, maintenance
history, costs, performer identities, data-quality entities, audit detail, secured SIM/network
attributes, unrestricted free text, internal identifiers or other non-purpose fields.

For every permitted route, compare the returned keys to its versioned projection allowlist. For
every forbidden/wrong-surface route, prove zero protected-data requests. Repeat after workspace
switch, role/capability revocation, and browser Back restoration. Role × path alone is insufficient.

## Reporting wording (FR-031 amendment)

Reporting must be a separate read-only **Reports workspace** in the same hosted application and work
without the Power Apps runtime (optional Power BI may consume approved report views). Its identity,
purpose, capability, row-scope and projection model must be stated in the evidence pack. A
ReportReader-only identity receives no Work, Scan, Administration or Data Management navigation/data.

## Relationship / history refusals (server-side)

Harnesses must prove refusal of:

1. relationship cycles  
2. self-parenting  
3. second open parent  
4. direct historical span/line edits  

## Automation least privilege (FR-028)

Worker identity — `// ASSUMPTION` on exact role name from 010: automation must not be System Owner /
broad data-plane owner. Evidence: token claims + attempted excess write refused.

## Evidence record (required)

| Field | Content |
|---|---|
| `contract` | `security-matrix` |
| `scope_model` | `OfficeAdmin=assigned-office; SystemOwner=global-ceiling` |
| `environment` | Dev / UAT (Entra) |
| `matrix_artifact` | link to filled table |
| `direct_api_tooling` | how calls were made (no browser-only) |
| `secured_field_scan` | Field User cache + report column scan result |
| `d18_matrix` | workspace + purpose + capability + row scope + projection + direct-route/cache result |
| `owner` / `ran_at` / `result` | required |
| `r5_status` | `decided` |

## Non-claims

- Hiding a column in the UI is not authorization.
- Mock role flags in localStorage are not Security Verified.
- A matching role, hidden navigation, or browser-side key deletion is not authorization.
- A screenshot proves visible composition only; D18 requires direct API, forbidden-key, cache,
  revocation, and Entra/document-ACL evidence before Security Verified.
