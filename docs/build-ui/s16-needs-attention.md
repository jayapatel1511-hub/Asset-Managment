# S16 — Needs attention

| | |
|---|---|
| **Screen ID** | S16 |
| **Route** | `/needs-attention` |
| **Component** | `app/src/features/offline/NeedsAttentionPage.tsx` |
| **Surfaces** | Field · Desk |
| **Roles** | all (linked from S13 only today — G-06) |
| **One job** | Surface queued and rejected offline submissions for retry — never discard |
| **Source** | `docs/12-ui-spec.md` § 5.17 · refreshed 2026-09-03 |

## Purpose

Offline conflict UX. Pending ≠ accepted. Rejected replays stay until resolved/retried.

## Entry points

| From | How |
|---|---|
| S13 Needs attention | Button |
| Future More nav / badge | G-06 proposal |

## Layout zones

Title → Pending sync section (C4 brand) → Needs attention section (C4 danger) → rows with Retry.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Retry | `offline.retry` | Rejected row | rejected | not retrying | Replay command under **same identity** | Leaves list / moves | Stays with reason | No-op if still offline |

## Data shown

Kind label (Checkout/Return/Transfer…) · `offline.queuedAt` · Asset IDs · rejection reason · `offline.discardNotAllowed`. Empty: `offline.needsAttention.empty`.

## States

Empty · pending only · rejected · retrying spinner.

## Non-goals

- Discard / delete rejected submissions
- Replay under a different user
- Silent auto-merge of conflicts

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| G-06 | Field discovery path | Keep S13 link; add More only if approved |

## Governing links

- `docs/12-ui-spec.md` § 5.17, § 6
- Offline rules in `CLAUDE.md`
- `app/src/features/offline/`, `app/src/offline/`
