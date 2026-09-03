# Agent brief — orientation for anyone (or anything) writing code here

**Read this before touching a file.** It exists because most of this system is already built, and
the fastest way to waste a session is to rebuild something that works or to collide with another
agent on a shared file.

Authoritative companions, in this order: `.specify/memory/constitution.md` (governs),
`docs/09-build-report.md` (what exists — **read fresh, it is the maintained artifact**),
`specs/REMAINING-WORK.md` (what is left, sliced into parallel workstreams),
`docs/10-integration.md` (which Microsoft service satisfies which requirement, and its open gaps),
then the feature spec you are implementing.

---

## 1. Environment — do this first or every command fails

This machine has no system Node and sits behind a Zscaler TLS proxy that Node does not trust.
`npm install` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` even though `curl` works.

```bash
export PATH="/c/Files/Asset Managment/.tools/node-v22.14.0-win-x64:$PATH"
export NODE_EXTRA_CA_CERTS="C:/Files/Asset Managment/.tools/zscaler-root.pem"
```

**The `/c/…` form for `PATH` is required and is not interchangeable with `C:/…`.** Git Bash's
`which` will not find `node` on a `C:/…` PATH entry — it fails with `node: command not found`
while looking like a correct export. `NODE_EXTRA_CA_CERTS` is the opposite: Node reads it itself,
so it takes the `C:/…` Windows form. Verified 2026-09-02; getting this wrong costs ten minutes and
looks like a broken toolchain.

Run both in **every** shell before any `npm` or `node` command. `python` and `pip` need neither.
If `.tools/` is missing, re-create it per `docs/09-build-report.md` — portable Node zip (no
installer, no UAC) plus the Zscaler root CA exported from `Cert:\LocalMachine\Root`.

The always-works fallback, independent of `PATH` entirely:

```bash
NODE="/c/Files/Asset Managment/.tools/node-v22.14.0-win-x64/node.exe"
"$NODE" node_modules/vitest/vitest.mjs run     # from app/ — verified, 281 passing
```

`npm run dev` from a preview launcher does **not** work: npm lifecycle scripts do not inherit the
portable Node PATH entry. Invoke `node.exe` on `vite/bin/vite.js` directly, and run the two
`predev` steps by hand first:

```bash
node scripts/generate-state-machine.mjs && node scripts/copy-staged-data.mjs
```

## 1b. MCP servers

`.mcp.json` (project scope) registers **`microsoft-learn`** — the official Microsoft Learn MCP
server, read-only, free, no auth. Use it to check current Microsoft documentation instead of
trusting memory or a stale doc; the `pac code push` command in `CLAUDE.md` was deprecated and
nobody noticed until it was checked. Needs one-time approval in an interactive `claude` session.

**Dataverse MCP is not installed and must not be added without the guardrails in
`docs/10-integration.md` § Agent and tooling access.** Its tools include `update_record` and
`delete_record`, which are one call away from breaking Principle I and Principle II.

## 2. What already exists — do not rebuild

| Layer | Status | Location |
|---|---|---|
| Migration pipeline | **Done.** 1,053 source rows → 1,026 staged assets, idempotent, 9 reports | `migration/01_profile.py`…`05_calibrations.py` |
| Domain layer | **Done.** 179 tests across 6 modules | `app/src/domain/` |
| Backend seam | **Done.** `mock/` fully working, `dataverse/` typed stub that throws | `app/src/api/` |
| Screens for 001–006, incl. 003 US5 offline queue and 004 US4 admin assignment | **Done**; 001/003/004 verified live at 390px against real data, 005/006 per `docs/09-build-report.md` § Phase 0–2 | `app/src/features/`, `app/src/api/queue/` |
| Flow specifications F1–F5 | **Done** as files, not published | `solution/flows/` |
| Tests | **281 passing** across 12 files, `npm run build` clean | `app/tests/` |

Features **005** and **006**, plus 003 US5 and 004 US4, were built in the multi-agent session
recorded in `docs/09-build-report.md` § "Phase 0–2 — multi-agent extension" (WS-A to WS-D, complete).
What remains is WS-E, WS-F, WS-G (in progress) and WS-H (US1 built; US2–US5 tenant-bound) — see
`specs/REMAINING-WORK.md`. The still-stubbed items are the tenant-bound ones in `docs/09-build-report.md`
§ "What is stubbed", as amended by its "Superseding" note.

## 3. Architecture invariants — breaking one is a defect, not a style choice

1. **`AmsBackend` is the only seam.** No screen imports `api/mock` or `api/dataverse` directly —
   only `api/index.ts` does. Add a capability by adding a method to the interface and implementing
   it in both. A screen that reaches past the interface breaks the SharePoint-Lists fallback the
   constitution requires.
2. **`domain/stateMachine.ts` is generated**, from `data/reference/state_machine.json`, by
   `scripts/generate-state-machine.mjs`, wired into `predev`/`prebuild`/`pretest`. **Never edit
   it.** Change the JSON. It is the single definition the app and flow F1 both consume
   (Principle V).
3. **`domain/` is pure.** `assetId.ts`, `deriveState.ts` and `stateMachine.ts` take arguments and
   return values. No store access, no fetch, no React. This is what makes them testable and what
   lets flow F1 be verified against them.
4. **Current state is derived, never assigned.** Every write goes through a transaction and
   `deriveState`. If you find yourself setting `asset.status = …`, stop — you are violating
   Principle I. `MockStore.applyTransaction` is the only place state changes.
5. **History is append-only.** Never update or delete a transaction line. Corrections are
   compensating transactions (Principle II).
6. **Every user-facing string comes from `i18n/en.json`.** No literals in JSX (FR-031).
7. **Validate in both layers.** The screen refuses with an explanation *and* the backend refuses
   independently. The UI is not a security boundary.

## 4. Comment markers — use them, they are load-bearing

| Marker | Means |
|---|---|
| `// DATAVERSE-ONLY` | Depends on a Dataverse-only capability. Greppable blast radius if premium licensing is refused. |
| `// ASSUMPTION: Q<n>` | Rests on an unconfirmed answer from `specs/clarifications.md`. Must also appear in `docs/08-decisions.md`. |
| `// MOCK-ONLY` | Stands in for something needing a tenant. Deleted when `api/dataverse/` goes live. |

## 5. Multi-agent execution — the part that actually matters

**Four files are touched by every feature and will be clobbered if agents edit them
concurrently:**

```
app/src/api/AmsBackend.ts     interface — every workstream adds methods
app/src/api/types.ts          entity types — every workstream adds shapes
app/src/i18n/en.json          strings — every screen adds keys
app/src/App.tsx               routes — every screen adds one
```

### The rule: one serial Phase 0, then parallel fan-out

**Phase 0 — orchestrator only, no subagents.** Add *every* new signature, type, i18n key and
route for *all* workstreams in one pass, with method bodies throwing
`new Error("not implemented")`. Commit. Run `npx tsc -b` — it must compile.

**Phase 1 — fan out.** Each agent now owns strictly disjoint files and never edits a shared one.

Before fanning out, **split `api/mock/index.ts` into per-domain modules** so two agents cannot
land in one file:

```
app/src/api/mock/index.ts        thin composition root — Phase 0 only, then frozen
app/src/api/mock/store.ts        existing, shared — Phase 0 only, then frozen
app/src/api/mock/deployment.ts   owned by WS-A
app/src/api/mock/reporting.ts    owned by WS-B
app/src/api/mock/offline.ts      owned by WS-C
app/src/api/mock/admin.ts        owned by WS-D
```

### Ownership map

| WS | Scope | Owns exclusively | May read | Must not touch |
|---|---|---|---|---|
| **A** | 005 Deployment & Kits | `features/deploy/**`, `features/recover/**`, `features/site/**`, `api/mock/deployment.ts`, `domain/installation.ts`, `tests/domain/installation*`, `tests/features/deploy*` | everything | any other WS's files |
| **B** | 006 Fleet Reporting | `features/reports/**`, `api/mock/reporting.ts`, `domain/pointInTime.ts`, `domain/utilisation.ts`, `tests/domain/pointInTime*`, `tests/domain/utilisation*` | everything | — |
| **C** | 003 US5 offline queue | `api/mock/offline.ts`, `api/queue/**`, `tests/api/offline*` | everything | — |
| **D** | 004 US4 admin assignment + reminder logic | `features/admin/OfficeAdminsPage.tsx`, `api/mock/admin.ts`, `tests/features/admin*` | everything | — |
| **E** | `api/dataverse/` implementation | `api/dataverse/**` | everything | — |
| **F** | Schema + solution artefacts | `solution/**` | everything | — |
| **G** | 007 Synthetic fleet history | `data/synthetic/**`, `app/scripts/synthetic/**` (the generator, TypeScript), its outputs beside `migration/staged/`, its verification report, the synthetic-data indicator component | everything | `App.tsx` and the app shell (the FR-007 indicator mounts there — coordinate, as WS-H does for T016); `api/mock/store.ts` (FR-060's persistence change is orchestrator work) |
| **H** | 008 Release & Operations | `app/scripts/**` **except** `app/scripts/synthetic/**`, `app/vite.config.ts`, `app/package.json` scripts, `docs/11-runbook.md`, `tests/build/**` | everything | `App.tsx` (T012 and T016 must coordinate) |

Agents A–H are independent after Phase 0 and can run concurrently; A–D are complete. **E cannot be
verified** without a tenant — it must compile and be reviewed, not tested. *(Update 2026-09-02:
`docs/08-decisions.md` records Jay's free Developer environment as a proving ground, which would let
E and F be exercised for real. It is individual-use only and does not replace `Englobe-AMS-Dev`.)*

### Never parallelise these

- Anything under `data/source/` — read-only inputs, full stop.
- `migration/*.py` — one agent at a time; the scripts share `staged/` output and reports.
- `data/reference/*.csv` — changing these changes every downstream artefact.
- `domain/stateMachine.ts` — generated.

### Concurrent sessions are real

Three interactive `claude` sessions were writing to this repo at once on 2026-09-02 — WS-G, WS-H
and a spec review — not subagents under one orchestrator, but separate windows. The ownership map
still applies, and three habits make it hold: run `ListAgents` and tell peers with `SendMessage`
which files you are about to edit; re-read any shared file immediately before editing it; and
**append** to `docs/08-decisions.md` rather than rewriting it, because it is the one file every
session writes.

### Definition of done, per agent

An agent's work is not done until, from `app/`:

```bash
npx tsc -b && npm run test && npm run build
```

all pass, and the agent reports the **actual** output.

**The baseline is 281 passing across 12 files** — re-verified 2026-09-02 by running it, not
quoted from a report: `stateMachine` 100, `deploy` 29, `mockBackend` 27, `assetId` 21, `deriveState`
18, `queue` 17, `pointInTime` 15, `utilisation` 14, `reporting` 12, `installation` 11, `admin` 10,
`offline` 7. A run showing fewer than 281 plus your own additions is a regression, not a success.
Do not report anything as verified that you did not run.

## 6. Data you can rely on

`migration/staged/` holds the loaded dataset, copied to `app/public/data/` by
`scripts/copy-staged-data.mjs`. It is real Englobe data, not fixtures:

| File | Contents |
|---|---|
| `assets.json` | 1,026 assets with derived state |
| `equipment_models.json` | 51 canonical models |
| `locations.json` | 12 locations, flat under Ontario |
| `projects.json` | deduplicated project list |
| `transactions.json` / `transactionlines.json` | 11 `AddToInventory` headers, 1,026 lines |
| `calibrationrecords.json` | 164 matched calibrations |
| `assetrelationships.json` / `components_seed.json` | permanent Component links |
| `idsequence.json` | next value per prefix |
| `profile_baseline.json` | the frozen counts `01_profile.py` asserts against |

**Useful real values for tests and manual verification** — these are load-bearing examples from
the specs, reproduced in the actual data:

- `DL-UM-16984` and `GEO-UM-16984` — one serial, two physically distinct assets (Principle III).
- `UM21999` + *Instantel Micromate (DataLogger)* → mints `DL-UM-21999`, not `DL-UM-UM16984`.
- 592 assets are `CheckedOut` with no custodian (the Q3 sweep set).
- 44 records are in the field-completion queue; 107 assets are overdue for calibration at a
  30-day horizon.

## 7. Ask before

- Deleting anything.
- Editing `data/source/` or `data/reference/`.
- Adding a table or entity not in `docs/01-data-model.md`.
- Changing a choice value already referenced by staged data.
- Re-litigating the stack in `CLAUDE.md`.

## 8. When you finish

Update `docs/09-build-report.md` — it is the artifact the next session reads instead of trusting
memory. State what you built, what you verified with real output, what you stubbed, and every new
`// ASSUMPTION` marker and where it lives. Record any deviation from a spec in
`docs/08-decisions.md` with date, decision, reason and who agreed.
