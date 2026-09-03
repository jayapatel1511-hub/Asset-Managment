# Englobe AMS — Asset Management System

Instrumentation asset tracking for Englobe Ontario (Ottawa, Toronto, Sudbury, SWO).
~1,050 assets today: seismograph data loggers, geophones, microphones/SLMs, SIMs/modems,
total stations, cameras, geotechnical sensors. Growth expected.

Owner: Jay Patel (jay.patel@englobecorp.com). Read `docs/00-brief.md` first, then `docs/01-data-model.md`.
Everything else in `docs/` is derived from those two.

## Stack (decided — do not re-litigate without asking)

| Layer | Choice |
|---|---|
| Data | Microsoft Dataverse, dedicated environment `Englobe-AMS-Dev` / `Englobe-AMS-Prod`, Canada region |
| App | Power Apps **Code App** — React 18 + TypeScript + Vite, Power Apps SDK (`@microsoft/power-apps`), Fluent UI v9 |
| Automation | Power Automate cloud flows, solution-aware, run as service account `svc-ams@englobecorp.com` |
| Files | SharePoint Online document library `AMS Documents` on the Ontario Instrumentation Hub site |
| Identity | Entra ID; three Dataverse security roles (`AMS Field User`, `AMS Office Admin`, `AMS System Owner`) |
| Reporting | Power BI (DirectQuery to Dataverse). Fabric is out of scope. |
| ALM | One Power Platform solution `EnglobeAMS` (publisher prefix `eng`). Dev → export managed → import Prod. |

Fallback if premium licensing is denied: SharePoint Lists as the store. The entity design in
`docs/01-data-model.md` is written so it can be re-targeted; do not build anything Dataverse-only
into the app layer without a comment `// DATAVERSE-ONLY`.

## Non-negotiable rules

1. **Users never write current state.** `eng_asset` status/location/custodian/project/parent are set
   only by the flows in `docs/03-automation.md`, triggered by new `eng_transactionline` rows.
   The app creates Transactions + Lines. Nothing else.
2. **Transaction Lines are append-only.** No update or delete privilege for any role except System Owner.
3. **Asset ID is a tag, not a key.** Primary key is the Dataverse GUID. `eng_assetid` is unique, immutable,
   never encodes office/project/owner. Serial is an attribute; two assets may share one serial.
4. **Reference data is picked, not typed — and maintained in the app, not in a CSV.** Manufacturer,
   model, type, location, project are lookups. No free-text columns for these anywhere. An administrator
   creates, edits and **deactivates** (never deletes) reference rows on a screen; `data/reference/*.csv`
   are seeds for the initial load, not the ongoing source. *(Second clause added 2026-09-03 — Jay:
   "everything should not be static". See `docs/17-ux-audit.md` and `docs/08-decisions.md`.)*
5. **Checkout of a non-Available asset must be refused in the app and in the flow.** Both layers.
6. **No credentials in Dataverse.** SIM ICCID / phone / static IP are allowed (field-level secured).
   Logins/passwords are not stored anywhere in this system.

## Repo layout

```
CLAUDE.md
docs/                 spec — the source of truth
data/source/          exports of the current SharePoint/Excel inventory (read-only inputs)
data/reference/       seed CSVs for reference tables (edit these, they get loaded)
solution/             pac solution: tables, roles, flows, app registration
app/                  Code App (Vite + React + TS)
migration/            Python (pandas) cleanup + load scripts, one step per file
tests/                Test Engine plans + vitest
```

## Conventions

- Dataverse logical names: `eng_` prefix, snake, singular: `eng_asset`, `eng_transactionline`.
- Choice columns are global option sets named `eng_<column>` so flows and app share them.
- All dates UTC in store; display in `America/Toronto`.
- Commit messages: `area: what` (`schema: add eng_assetrelationship`, `app: checkout screen`).
- Every flow has a `README.md` next to its definition explaining trigger, inputs, writes, failure mode.
- Migration scripts are idempotent and write a `*_report.md` with counts of what they changed and what they could not resolve.

## Commands

```bash
# auth once (human does this)
pac auth create --environment https://englobe-ams-dev.crm3.dynamics.com

# schema
pac solution init --publisher-name Englobe --publisher-prefix eng   # once
pac solution export --name EnglobeAMS --path ./solution/export --managed false

# app
cd app && npm install && npm run dev      # local against Dev env
npm run build && pa app push             # publish to environment (see docs/10-integration.md)
# NOTE: `pac code init/push` is the DEPRECATED CLI. From @microsoft/power-apps v1.0.4 the
# npm-based CLI (`pa app init` / `pa app run` / `pa app push`) replaces it. We are on v1.3.1.
# NEVER push with VITE_AMS_BACKEND=mock — it would publish real asset data, including secured
# ICCID/phone/static-IP fields, to a public endpoint. See docs/10-integration.md § Hosting.

# migration
cd migration && python 01_profile.py && python 02_clean.py && python 03_models.py && python 04_load.py --env dev
```

## Ask before doing

- Anything that deletes data in Dev or Prod.
- Changing a choice value that is already referenced by data.
- Adding a table not in `docs/01-data-model.md`.
- Anything in `docs/07-open-questions.md` — those need Jay's answer, not a guess.
