# Contract: Security matrix (proof / acceptance)

**Feature**: 009-production-readiness  
**Consumes**: `specs/010-web-application-platform/contracts/auth-session.md`,
`error-codes.md`, `document-upload.md`, plus export/report authorization from 010/011 as applicable
(consumes 010 contracts; 011 export contracts when present)  
**Workstream**: WS-W12 security  
**Spec mapping**: US4; FR-025–FR-032; SC-009, SC-010  
**Gate**: R5 (admin scope) must be decided before office-scope rows are claimed; full Entra matrix expected on Azure Integrated

## Purpose

Define **direct API** (and export/report) authorization proof — not UI filtering. Interface checks are
faster feedback only and **never** count as Security Verified evidence.

## Admin model (choose one; document honestly)

| Model | Matrix implication |
|---|---|
| **Office-scoped Administrator** | Admin of office A must receive refusal on writes (and restricted reads if policy says so) for office B |
| **Global AMS Administrator** | Office columns marked N/A; role name and docs must state global scope (FR-026) — do not pretend office isolation exists |

## Role × path matrix (minimum)

Fill pass/fail per cell with dated run. Paths: **App** (sanity only), **Direct API** (required), **Export**, **Report/view**.

| Action / data | Field User | Office Admin | Global Admin | Manager / Report Reader | Automation worker |
|---|---|---|---|---|---|
| Read secured SIM/ICCID/phone/static IP | Deny all paths | Per policy (usually allow own office) | Per policy | **Deny** ordinary reports | Least privilege only |
| Write asset in other office | Deny | Deny if office-scoped; allow if global | Allow | Deny | Deny unless approved job |
| Write derived state directly (lifecycle/disposition/…) | Deny | Deny | Deny | Deny | Deny (commands only) |
| Edit accepted transaction line | Deny | Deny | Deny | Deny | Deny |
| Create relationship cycle / self-parent / second open parent | Deny | Deny | Deny | Deny | Deny |
| Download calibration document (unauthorized) | Deny | Deny cross-scope | Per policy | Deny | Deny |
| Run governed export beyond template/role | Deny | Per 011 | Per 011 | Deny | Deny |

**SC-009**: Every forbidden action above fails on **Direct API**, **Export** and **Report** — not App alone.

**SC-010**: Field-user local storage inspection and ordinary manager reporting contain **zero** secured SIM/network attributes.

## Reporting wording (FR-031 amendment)

Manager reporting must work **without the Power Apps runtime**, via in-app read-only reports and/or an
approved reporting path (optional Power BI over approved views). Identity and authorization model of
that path must be stated in the evidence pack.

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
| `admin_model` | `office-scoped` \| `global` |
| `environment` | Dev / UAT (Entra) |
| `matrix_artifact` | link to filled table |
| `direct_api_tooling` | how calls were made (no browser-only) |
| `secured_field_scan` | Field User cache + report column scan result |
| `owner` / `ran_at` / `result` | required |
| `r5_status` | decided \| blocked |

## Non-claims

- Hiding a column in the UI is not authorization.
- Mock role flags in localStorage are not Security Verified.
