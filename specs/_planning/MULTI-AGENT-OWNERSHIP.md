# Multi-agent planning — 009 / 010 / 011

**Date**: 2026-09-03  
**Branch**: master  
**Status**: **Complete** — plan/tasks/contracts written; **R1–R4 closed 2026-09-03** (Jay: *"okay update all"*). Index in `specs/README.md` and `specs/REMAINING-WORK.md`.

**Orchestrator rule** (for any follow-on edits): each agent owns only the paths listed below. First code lands via `010/tasks.md` foundational → WS-W4 against networked Postgres.

## Stack (authoritative)

Azure web app: React PWA + Node/TS API + PostgreSQL + private Blob + Entra OIDC + Container Apps.  
Power Platform and Zite are **parked**. Do not plan Dataverse or Zite work.

## Gates

| ID | Status | How to treat |
|---|---|---|
| **R1** four-axis state | **APPROVED** | Encode lifecycle / disposition / serviceability / derived calibration currency |
| **R2** atomic command | **FROZEN** for first proof | `010/contracts/transaction-command.md` |
| **R3** schema | First-proof subset **APPROVED** | `010/data-model.md`; full docs/15+16 review still open |
| **R4** Q8 / Q9 | **APPROVED** | Optional expected return; admin backdate ≤30d with refuse-on-cross |
| **R5** admin scope | Open | Auth tasks / production OfficeAdmin |
| **R6** Azure enterprise | Open | Does **not** block local Postgres proof |

## File ownership

| Agent | Owns exclusively | Delivered |
|---|---|---|
| **010** | `specs/010-web-application-platform/plan.md`, `tasks.md`, `contracts/**`, `research.md`, `data-model.md` | Yes |
| **011** | `specs/011-data-management/plan.md`, `tasks.md`, `contracts/**`, `research.md`, `data-model.md` | Yes |
| **009** | `specs/009-production-readiness/plan.md`, `tasks.md`, `contracts/**` | Yes |

## Contract split

- **010**: transaction command, idempotency, auth/session caller context, health, document upload metadata, outbox event envelope, error/refusal codes.
- **011**: field dictionary, quality issue, reference/correction/job/merge/export/retention.
- **009**: proof harness outcomes that **consume** 010 contracts.
