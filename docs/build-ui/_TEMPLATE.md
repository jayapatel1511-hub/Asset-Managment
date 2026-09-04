# Screen build playbook template

Copy this file for each new screen. Keep tables scannable. Cite `docs/12-ui-spec.md` section IDs so docs can be refreshed when that file changes.

**Refresh rule:** Prefer § 5 / § 3 / § 6 in `docs/12-ui-spec.md` + live `app/src/i18n/en.json` + routes in `app/src/App.tsx`. Mockup proposals that Jay has not recorded in `docs/08-decisions.md` stay under **Conflicts / TBD**.

---

# {SCREEN_ID} — {Screen name}

| | |
|---|---|
| **Screen ID** | {Snn / Dnn / Cnn} |
| **Route** | `{path}` |
| **Component** | `app/src/features/...` |
| **Surfaces** | Field / Desk / Console (from `docs/02-app.md` § Surfaces) |
| **Roles** | all / Office Admin / System Owner |
| **One job** | {one sentence} |
| **Source** | `docs/12-ui-spec.md` § {x.y} · refreshed {YYYY-MM-DD} |

## Purpose

{One paragraph. What question this screen answers.}

## Entry points

| From | How |
|---|---|
| | |

## Layout zones

Top → bottom (or left → right on Console):

1. **Header / page header** —
2. **Primary content** —
3. **Actions** —
4. **Empty / loading / error** —

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| | `key` "…" | | | | | | | |

## Data shown

| Field / projection | Source note | Notes |
|---|---|---|
| | Approved read projection / list endpoint — do not invent shapes | |

## States

| State | Treatment |
|---|---|
| Loading | |
| Empty | |
| Error | |
| Offline | |
| Conflict / needs attention | |

## Related dialogs / sheets

### {Dialog ID} — {name}

| Control | Label / i18n | Visible / enabled | On activate | Outcomes |
|---|---|---|---|---|
| | | | | |

## Non-goals

- …

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| | | |

## Governing links

- `docs/12-ui-spec.md` § …
- Feature specs: …
- Mockups: …
- App: `app/src/features/…`
