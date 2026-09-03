# app

The Englobe AMS front end: Vite + React 18 + TypeScript, Fluent UI v9, mobile-first at 390px.
Becomes the PWA client of the Azure web application — see `docs/14-webapp-architecture.md`.

Runs against `mock` (bundled staged data, no server) or `http` (the TypeScript API in `server/`
over in-process PostgreSQL).

> **LEGACY-POWER-PLATFORM — parked 2026-09-03.** This was originally a Power Apps Code App.
> Power Apps publishing, Dataverse and the `pac code` workflow are no longer the delivery path;
> `src/api/dataverse/` is retained unimported as a record only, and `power.config.json` is kept
> unmodified for the same reason. See `CLAUDE.md`, *Parked — Power Platform*.

## Run it

```bash
npm install
npm run dev       # http://localhost:3000, mock backend, phone-first at 390px
npm test          # vitest — 317 tests
npm run build     # type-check (tsc -b) + production build to dist/
```

`predev`/`prebuild`/`pretest` regenerate `src/domain/stateMachine.ts` from
`data/reference/state_machine.json` and copy `migration/staged/*.json` into `public/data/` —
never edit either of those by hand.

## Structure

```
src/
  api/            AmsBackend interface + two implementations
    mock/         loads migration/staged/ (via public/data/), applies deriveState on write,
                  persists to localStorage. Default backend.
    http/         talks to server/ over /api — the shape the production adapter takes
    dataverse/    LEGACY-POWER-PLATFORM, parked and no longer imported; kept as a record
  domain/         stateMachine.ts (GENERATED), assetId.ts, deriveState.ts — the state machine
                  and ID rules, pure functions, no store access
  features/       search/ asset/ checkout/ return/ transfer/ calibration/ admin/
  components/     StatusPill, AssetRow, BottomNav, RoleSwitcher (MOCK-ONLY)
  i18n/           en.json — every user-facing string (FR-031)
tests/            vitest — see tests/README.md at the repo root for the full breakdown
scripts/          generate-state-machine.mjs, copy-staged-data.mjs
```

## Choosing a backend

`src/api/index.ts` is the only place that picks one, from `VITE_AMS_BACKEND` (`app/.env.local`,
gitignored, default `mock`):

| Value | Backend |
|---|---|
| `mock` *(default)* | `src/api/mock/` — staged data in memory, persisted to localStorage |
| `http` | `src/api/http/` — the API in `server/`; `vite --mode localapi` sets it |
| `dataverse` | **Parked.** Selecting it now throws rather than silently falling back to mock |

The production adapter is the `http` one, pointed at the Azure API instead of `server/`. Screens
never import a backend directly, so swapping the target needs no screen changes.
