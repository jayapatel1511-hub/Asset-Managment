# Zite test environment — session handoff, 2026-09-03

> ## ⛔ PARKED — 2026-09-03
>
> This work is **closed, not abandoned**, and is **not** the active direction. Zite cannot be the
> authoritative store for AMS: `zitejs/db` exposes no transaction and a failing multi-write does not
> roll back, so `CLAUDE.md` rule 2 — *one business event is one atomic database commit* — is
> unsatisfiable on it (`docs/18-hosting-alternatives.md` § 2b). Data residency is a second,
> independent blocker (US/EU only; Canada required).
>
> The active direction is the **Azure web application**: `README.md`, `CLAUDE.md`,
> `docs/14-webapp-architecture.md`. Everything below is kept as evidence for the decision.
> Do not resume it unless Jay explicitly reopens it.

---

**Read this first if you are resuming this work.** It is the state of play at the moment
the session stopped, written so a fresh session can pick it up from the repository alone.

Read in this order: this file → `zite/README.md` → `docs/18-hosting-alternatives.md` §§ 2a,
2b, 7a → the ten `2026-09-03` rows at the bottom of `docs/08-decisions.md`.

---

## 1. What was asked for, and what got done

The brief (preserved at `specs/ZITE-BUILD-PROMPT.md`) asked for four things. Three are
finished; the fourth is finished but has one unverified edge.

| # | Asked | Status |
|---|---|---|
| 1 | Create the database per `docs/18` § 7a and load the demo profile | **DONE** — verified counts below |
| 2 | Answer whether `zitejs/db` has a real transaction, with evidence | **DONE** — the answer is **no**; `docs/18` § 2b |
| 3 | Build S01 Search, S03 Asset detail, S04 Checkout against real Zite data | **DONE** — endpoints verified live |
| 4 | A checkout of a non-Available asset visibly refused | **DONE server-side and in the UI code; NOT seen rendering in a browser** |

### The one open verification gap

The published app is `accessMode: internal` and sits behind Zite sign-in. This session
must not enter credentials, so **the React screens were never opened in a browser.**

What *was* proven, by invoking the logic against the live database:

- search by Asset ID, serial and model name, including the 3-character floor;
- asset detail shaping — resolved location, home office, custodian, project, calibration
  due, overdue days, and the category rollup derived by walking the hierarchy;
- all six non-Available statuses **and** an unknown ID refused; Available accepted;
- a real checkout applied (status → CheckedOut, custodian set, project set,
  `currentLocation` cleared), the same asset then refused by **both** layers, then restored.

What is **not** proven: that the React components render and wire up correctly. Typecheck
and endpoint bundling are clean, which is not the same thing.

**→ First thing to do on resume:** open
https://build.fillout.com/workspace/85b7c453b34bbf86/6uh1adzxfc
with an Englobe Zite login and click through the three screens.

---

## 2. Live identifiers

| | |
|---|---|
| Database / workspace id | `85b7c453b34bbf86` |
| App id | `6uh1adzxfc` |
| Database URL | https://build.fillout.com/database/85b7c453b34bbf86 |
| App editor | https://build.fillout.com/workspace/85b7c453b34bbf86/6uh1adzxfc/edit |
| Zite commits | `480b2fb` then `c5f1b22` (in Zite's own repo, not this one) |
| Trial expires | **2026-09-17** |

The workspace id and the database id are the same string — Zite's data tools call it
`baseId`, the build tools call it `workspaceId`.

### Table ids (needed for the data tools)

```
Categories        ti5ijgbVuAt
Locations         tftH6fVQCY7
Projects          t31aGZ4pCKy
Equipment Models  tpxCgRvvJbD
Assets            taP1kLTLWTp
```

`zite/load/out/idmap.json` holds the name → UUID map built during the load (categories,
the 88 referenced locations, the 46 referenced projects, all 52 equipment models). It is
**live state and not regenerable** — it is committed for that reason.

---

## 3. Verified state of the data

```
assets            371     categories_root    8
locations         699     categories_leaf   18
projects          260     categories_total  26
equipment_models   52     parent links      91
```

Status breakdown, identical to `migration/synthetic/demo/`:

```
Deployed 165 · Retired 87 · Available 76 · CheckedOut 28
InCalibration 10 · NeedsRepair 4 · Missing 1
```

Only synthetic data has ever been loaded — seed `englobe-ams-007`, profile `demo`.
`migration/staged/` (1,026 real Englobe assets) has **never** been touched, and
`zite/load/build_payloads.py` refuses any dataset whose manifest is not the verified
synthetic demo profile.

---

## 4. The finding that matters most

**Zite has no transaction, and a failing multi-write does not roll back.**

Tested against the live runtime, not inferred from docs:

- `zitejs/db` exposes exactly `{assets, auth, categories, equipmentModels, locations,
  projects, sql}`. Every transaction spelling probed — `transaction`, `tx`, `begin`,
  `beginTransaction`, `withTransaction`, `batch`, `atomic`, `runInTransaction`,
  `unitOfWork`, `pool`, `client`, `connect` — returns `undefined`.
- `zite.sql()` refuses `BEGIN`, `START TRANSACTION` and `COMMIT`: *"Only SELECT statements
  are supported (read-only)"*.
- Three successive writes where the third failed left **the first two committed**
  (`rowCount` 0 → 0 → 2).

So `CLAUDE.md` rule 2 — *one business event is one atomic database commit* — is
**unsatisfiable** on Zite's record API. A five-asset checkout can half-succeed. Zite is
credible as a test/demo environment and as a read model; not as the authoritative store.

Full evidence, including the narrower `bulkCreate` finding and its caveat, is in
`docs/18-hosting-alternatives.md` § 2b. **Do not re-open this as an open question** — it
was tested, and § 2a was rewritten to say so.

---

## 5. Assumptions a resuming session must not silently inherit

All ten are in `docs/08-decisions.md` dated 2026-09-03. The two that most need Jay:

1. **Contested category leaves.** `Microphone` and `SoundLevelMeter` each appear under both
   Acoustics and Seismographs in the source, but the approved shape is 8 roots / 18 leaves
   with leaves unique by name. Rule applied: assign each to the root holding most of its
   assets → Microphone to Acoustics (4 v 3), SoundLevelMeter to Seismographs (25 v 3).
   Cost: 6 assets and 3 models roll up under a different root than the flat `assetgroup`
   column says. The two moves cancel, so **root totals are unchanged** — the aggregate
   looks clean and only per-asset lineage differs. Marked **ASSUMED, pending Jay**.
2. **Checkout assigns derived state directly** instead of deriving it from an appended
   transaction line, because § 7a deferred the event log. A real deviation from rules 4
   and 5, and the atomicity finding is *why* it was not closed — a header + lines + state
   write would span three tables with no transaction.

Also deliberate, and not to be "fixed":

- **ICCID, phone number and static IP have no columns at all.** `SELECT "identifiervalue"
  FROM "Assets"` → *column does not exist*. 74 synthetic rows carried them; dropped at load.
- **Reservable is `false` on all 52 models** — `docs/01` seeds it Yes for the Vehicles group
  only, and the demo profile has no Vehicles group.
- **The "Assigned to" picker is the 16 distinct custodians in the Assets table**, because
  decision Q22 says there is no staff table and identity is Entra.

---

## 6. Platform gotchas that cost real time

Worth reading before writing any more Zite code.

- **`bulk_create_records` takes 100 records per call, not 150.** 150 returns a bare
  `Invalid request body` with no hint.
- **`linked_record` fields require record UUIDs and validate them.** A primary-field value
  like `"Acoustics"` is rejected — nothing is auto-created by name. Load parents first.
- **`bulk_create_records` returns `recordIds` in input order**, which is what makes the
  positional id-mapping in `zite/load/idmap.py` safe.
- **Self-links cannot be set on the create pass** — `Parent Asset` was applied afterwards
  from `08_asset_parents.json`.
- **Link tables are keyed by table PAIR, not by field.** `Home Office` and `Current
  Location` share one `Assets__Locations` table and are separable in SQL only via an
  undocumented internal `field_id` column. **Use the typed client for link reads**, which
  resolves them correctly. Any future reporting built on `zite.sql()` joins would silently
  conflate them.
- **Two namespaces, not interchangeable.** The `execute_sql` data tool speaks display names
  (`"Asset ID"`, `"Categories__Categories"`); `zite.sql()` inside app code speaks SDK names
  (`"assetId"`, `"CategoriesCategories"`). Cross-validating one through the other produces
  false *"column does not exist"* errors.
- **Endpoint client types are inferred from what `execute` RETURNS**, not from
  `outputSchema`. An un-annotated function with several return branches produces a union,
  and optional fields like `reason` vanish from the caller's view. Annotate the return type.
- **An imported spread into `outputSchema` is silently dropped** by the generator. Declare
  fields inline.
- **`run_one_off_script` cannot import endpoint modules** — `zitejs/backend` resolves only
  per-app. That is why the checkout rules were lifted into pure functions in
  `lib/checkoutRules.ts`: so they can be exercised without a transport around them.

---

## 7. Where the code is

- **Runs in Zite:** `apps/englobe-ams-field/src/` in the Zite workspace repo.
- **Mirrored here for review:** `zite/app/` — read-only copy, so the rules stay reviewable
  after the trial lapses. If you change the app, change it in Zite and re-mirror.
- **Loader:** `zite/load/` — `build_payloads.py` (emits batches), `idmap.py` (name → UUID),
  `emit.py` (print an arbitrary slice ready to paste).

Nothing under `app/`, `server/` or `migration/` was modified.

---

## 8. Suggested next steps, in order

1. **Open the app in a browser and confirm the three screens render.** The only real gap.
2. Get Jay's ruling on the contested-category assumption (§ 5.1 above).
3. Decide whether the atomicity finding closes the Zite question entirely. `docs/18` § 8
   still lists B1 (Canadian residency), B2 (third-party custody — Englobe IT, not Jay
   alone) and B3 (the "Microsoft 365 tenant only" constraint) as unresolved, and § 5's two
   reseller questions about Q17 licensing may make the whole comparison moot and are far
   cheaper to answer.
4. If the environment is to stay useful past 2026-09-17, note that MCP app-building becomes
   a Business-plan feature; the data and app remain.
5. Optional, and only if someone wants to *demonstrate* the atomicity problem rather than
   read about it: add Transactions + Transaction Lines tables and watch a five-asset
   checkout half-succeed. That is the one thing this environment could still teach.
