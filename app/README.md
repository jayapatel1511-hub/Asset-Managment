# app

Power Apps Code App — see `docs/02-app.md`. Runs today as a plain Vite + React 18 + TypeScript app
against the `mock` backend (no tenant needed); `pac code init`/`pac code push` are the remaining
steps to actually register it as a Power Apps Code App, not done in this build (no tenant access
— see `docs/09-build-report.md`).

## Run it

```bash
npm install
npm run dev       # http://localhost:3000, mock backend, phone-first at 390px
npm test          # vitest — 163 tests
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
                  persists to localStorage. Default backend, zero Dataverse code paths reachable.
    dataverse/    // DATAVERSE-ONLY stub — throws until a tenant exists to implement it against
  domain/         stateMachine.ts (GENERATED), assetId.ts, deriveState.ts — the state machine
                  and ID rules, pure functions, no store access
  features/       search/ asset/ checkout/ return/ transfer/ calibration/ admin/
  components/     StatusPill, AssetRow, BottomNav, RoleSwitcher (MOCK-ONLY)
  i18n/           en.json — every user-facing string (FR-031)
tests/            vitest — see tests/README.md at the repo root for the full breakdown
scripts/          generate-state-machine.mjs, copy-staged-data.mjs
```

## Switching to Dataverse later

`src/api/index.ts` picks the backend from `VITE_AMS_BACKEND` (`app/.env.local`, gitignored,
default `mock`). Implement `src/api/dataverse/index.ts` against the same `AmsBackend` interface
and no screen changes — see that file's header comment for what each method needs to do and, just
as importantly, what it must NOT do (write derived `eng_asset` columns directly — that's F1's job,
not the app's, even against a real tenant).
