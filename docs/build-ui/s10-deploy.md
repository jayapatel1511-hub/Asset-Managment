# S10 — Deploy

| | |
|---|---|
| **Screen ID** | S10 |
| **Route** | `/deploy` |
| **Component** | `app/src/features/deploy/DeployPage.tsx`, `ComponentPicker.tsx`, `DraftStore.ts` |
| **Surfaces** | Field · Desk |
| **Roles** | all |
| **One job** | Deploy a primary logger + components to a site in one atomic event |
| **Source** | `docs/12-ui-spec.md` § 5.11 · refreshed 2026-09-03 |

## Purpose

Field installation write with draft autosave. Client validations are feedback; server/DB enforce custody, logger type, orientation, inactive project.

## Entry points

| From | How |
|---|---|
| S08 Deploy | Empty/new |
| S09 Deploy here | Ideally prefilled site — TBD |

## Layout zones

Title → draft restored banner → Project* → Primary logger* → Components → Site fields → coords → power → date → notes → error → Submit → X01 (→ Sites) / X02.

## Interactive controls

| Control | Label / i18n | Location | Visible when | Enabled when | On activate | Success | Failure / conflict | Offline |
|---|---|---|---|---|---|---|---|---|
| Project | `deploy.project` | Top | always | always | Select Active | — | required / `inactiveProject` | Cached |
| Primary add | `deploy.addPrimary` / C11 (G-07 closed keys) | Primary block | no primary | always | Add DataLogger | Shows primary + Remove | primaryNotLogger / alreadyDeployed / notHeld / noPrimary | Draft |
| Remove primary | Remove | Primary | has primary | always | Clears primary | — | — | Draft |
| Add component | `deploy.addComponent` | Components | always | always | Add line | Role/orientation selects | componentAlone etc. | Draft |
| Role | `deploy.kitRole` | Line | lines | always | Select | Sensors need orientation | orientationRequired | Draft |
| Orientation | `deploy.orientation` | Line | Sensor roles | always | Select H/V/BH/N/E/S/W | — | — | Draft |
| Remove component | `cart.remove` | Line | lines | always | Remove | — | — | Draft |
| Site | `deploy.site` | Site block | always | always | Existing or `deploy.siteNew` | Shows new site field | required trio | Draft |
| New site key | — | when New site | New site | always | Text | — | — | Draft |
| Location type | `deploy.locationType` | Site | always | always | Select | — | — | Draft |
| Site name | `deploy.siteName` | Site | always | always | Text | — | — | Draft |
| Position | `deploy.position` | Site | always | always | Free text | — | — | Draft |
| Lat / Long | `deploy.latitude` / `longitude` | Coords | always | always | Number inputs | — | — | Draft |
| Use device location | `deploy.useDevice` | Coords | always | geolocation available | Fill coords; caption `.device` | Silent fail → hand entry | Keep both (§ 11 kept) | May fail |
| Power source | `deploy.powerSource` | Form | always | always | Battery/Solar/AC/External | — | required hard-coded | Draft |
| Deployment date | `deploy.deploymentDate` | Form | always | always | Date default today | — | — | Draft |
| Notes | `deploy.notes` | Form | always | always | Text | — | — | Draft |
| Scan (proposed) | Scan | Add rows | G-17 | always | D01 | — | — | — |
| Submit | `cart.submit` | Bottom | always | valid + not busy | Command | X01 `deploy.confirmation`; button Sites | MessageBar errors | X02; draft retained until accepted |

## Data shown

Draft restore: `deploy.draftRestored`. Coordinate source captions.

## States

Draft restored · validating · submitting · X01 · X02 · offline editing.

## Non-goals

- Deploying permanent SIM alone
- Editing closed installations

## Conflicts / TBD (for Jay)

| ID | Conflict | Prefer until decided |
|---|---|---|
| Inactive project | Refuse (current) vs warn | Keep refuse |
| Coordinates primary | Device vs hand | Keep both; device not primary |
| KitRole Sensor1–4 cap | Audit B1 → N sensors | Follow domain decision when code updated |
| Site prefill from S09 | Unclear | TBD |

## Governing links

- `docs/12-ui-spec.md` § 5.11
- `app/src/features/deploy/`
