# C-REF — Reference data stewardship (stub)

| | |
|---|---|
| **Screen ID** | C-REF family |
| **Route** | TBD Console rail entities |
| **Component** | Not built |
| **Surfaces** | Console |
| **Roles** | Office Admin, System Owner (+ Data Owner where separated) |
| **One job** | Create / edit / **deactivate** (never delete) curated references in-app |
| **Source** | `docs/17-ux-audit.md` § A · `docs/16-data-management.md` · CLAUDE.md rule 7 · **STUB** |
| **Status** | STUB — required capability; screens not designed button-by-button |

## Purpose

Jay: nothing should be static. Locations/offices, manufacturers/models/types/groups, projects, carriers/retirement reasons (per closed B decisions), staff home office — maintained via **named commands**, not CSV edits or generic table PATCH.

## Intended screens (from audit / Surfaces — not yet specified)

| Entity | Intended actions | Notes |
|---|---|---|
| Locations / offices | Create, edit, deactivate, reparent | A1 — no UI today |
| Equipment models / types / groups | Create, edit, deactivate | Categories as rows not option-set releases |
| Projects | Create, edit, status Active/Inactive | Inactive picker rules on Deploy |
| Users / staff attributes | Home office, administered offices | Partial via S15 |
| Un-retire asset | Compensating path | Missing entirely (A4) |

## Interactive controls

**Not enough approved UI to list buttons.** When designed, each screen must use the playbook template and data-management rules: deactivate not delete; usage counts; audited commands; no free-text where reference required.

## Non-goals

- CSV as ongoing source of truth
- Generic data-grid editor
- Auto-delete of referenced rows

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Console IA | Mockup rail labels vs final entity list | Confirm rail with G-22 |
| Separation of duties | Who approves high-impact reference changes | `docs/16` / open decisions |
| Build priority vs Field | — | After Phase 0–2 custody screens unless Jay reprioritises |

## Governing links

- `docs/17-ux-audit.md` § A, F
- `docs/16-data-management.md`
- `docs/02-app.md` Console bullet list
- Specs 011 data-management
