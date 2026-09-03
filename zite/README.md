# `zite/` — the Zite test environment

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

Everything this directory holds was added for the **Zite test environment** built on
2026-09-03. It writes nothing into `app/`, `server/` or `migration/`, which were read
as references only.

> **This is a test environment. It is not a production candidate.**
> `docs/14-webapp-architecture.md` § 4.6 requires a Canadian region for production data
> and documents. Zite offers **US or EU only** — blocker **B1** in
> `docs/18-hosting-alternatives.md` § 4. Nothing here becomes production without Jay and
> Englobe IT/security. **Only synthetic data has ever been loaded** (see the guard below).

---

## What exists, and where

| Thing | Where |
|---|---|
| Database `Englobe AMS — Zite test` | baseId **`85b7c453b34bbf86`** · https://build.fillout.com/database/85b7c453b34bbf86 |
| App **Englobe AMS Field** (internal) | appId **`6uh1adzxfc`** · https://build.fillout.com/workspace/85b7c453b34bbf86/6uh1adzxfc/edit |
| Loader and id maps | `zite/load/` (this directory) |
| App source, mirrored for review | `zite/app/` |
| The atomicity finding | `docs/18-hosting-alternatives.md` § 2b |
| Decisions and assumptions | `docs/08-decisions.md`, ten rows dated 2026-09-03 |

The Zite build-tools trial runs until **2026-09-17**. Zite's own note: *"Building apps over
MCP is a Business-plan feature after that; everything you create stays yours either way."*

---

## The headline finding

**Zite has no transaction, and a failing multi-write does not roll back.** Tested, not
inferred — three successive writes where the third failed left the first two committed.
Full evidence in `docs/18` § 2b.

That makes `CLAUDE.md` rule 2 — *one business event is one atomic database commit* —
**unsatisfiable** on Zite's record API. A five-asset checkout can half-succeed. Zite is
credible as a test/demo environment and as a read model; it is not credible as the
authoritative store.

---

## The five tables

Per `docs/18` § 7a. Categories is the hierarchical one — 8 roots (asset groups), 18 leaves
(equipment types); Equipment Models take one lookup to a leaf and the group is derived by
walking up.

```
Categories        Name · Active · Sort Order · Parent Category → Categories
Locations         Name · Location Type · Active · Note · Parent Location → Locations
Projects          Project Number · Project Name · Status · Office → Locations
Equipment Models  Name · Manufacturer · Model · ID Prefix · Serialised · Identifier Type
                  · Default Cal Interval Months · Reservable · Category → Categories
Assets            Asset ID · Serial Number · Lifecycle · Status · Custodian · Last Cal Date
                  · Next Cal Due · Carrier · Retirement Reason · Notes · Data Origin
                  · Equipment Model, Home Office, Current Location, Current Project, Parent Asset
```

### Three fields are deliberately absent

**ICCID (`identifiervalue`), phone number and static IP have no columns.** 74 of the 371
synthetic rows carry them; they were dropped at load. `SELECT "identifiervalue" FROM
"Assets"` returns *column does not exist*.

Zite's RBAC is workspace-level and per-column masking is not a stated feature, so the
`AMS Sensitive` field-security profile cannot be reproduced. Omitting the columns makes the
environment structurally unable to hold that shape — a stronger control than a hidden
field, because there is no value to leak through devtools, a copied URL, an export or a
careless later query. **This is deliberate. Do not "fix" it by adding them.**

---

## Loading

Source is `migration/synthetic/demo/` — 371 fictional assets, seed `englobe-ams-007`.
**Never `migration/staged/`**, which is 1,026 real Englobe assets. `build_payloads.py`
refuses any dataset whose manifest is not the verified synthetic demo profile:

```python
if m.get("seed") != "englobe-ams-007" or m.get("profile") != "demo": sys.exit("REFUSED: ...")
if m.get("verified") is not True: sys.exit("REFUSED: manifest.verified is not true")
```

```bash
python zite/load/build_payloads.py      # emits batches to zite/load/out/
python zite/load/idmap.py show          # what ids are recorded so far
python zite/load/emit.py locations_top 400 100   # print one 100-row slice, ready to paste
```

Load order is **Categories → Locations → Projects → Equipment Models → Assets**, because
Zite's `linked_record` fields take record UUIDs and *validate* them — a primary-field value
like `"Acoustics"` is rejected outright, so nothing is ever silently auto-created. Parents
must therefore exist before children. `idmap.py` keeps the name → UUID map; `bulk_create_records`
returns `recordIds` in input order, which is what makes the positional zip safe.

Two things that cost time and are worth knowing:

- **`bulk_create_records` accepts 100 records per call, not 150.** 150 returns a bare
  `Invalid request body`.
- **Self-links cannot be set on the create pass.** `Parent Asset` is applied afterwards
  from `08_asset_parents.json` (91 links), because the parent row does not exist while its
  children are being created.

### Verification

```sql
SELECT COUNT(*) FROM "Assets"                     -- 371
SELECT COUNT(*) FROM "Categories" c WHERE NOT EXISTS (
  SELECT 1 FROM "Categories__Categories" l WHERE l.source_record_id = c.id)   -- 8 roots
SELECT "Status", COUNT(*) FROM "Assets" GROUP BY "Status"
-- Deployed 165 · Retired 87 · Available 76 · CheckedOut 28
-- InCalibration 10 · NeedsRepair 4 · Missing 1   (identical to the source)
```

> Note the two namespaces: the **`execute_sql` data tool** speaks display names
> (`"Asset ID"`, `"Categories__Categories"`); **`zite.sql()` inside app code** speaks SDK
> names (`"assetId"`, `"CategoriesCategories"`). They are not interchangeable, and
> cross-validating one through the other produces false "column does not exist" errors.

---

## The app

`zite/app/` mirrors `apps/englobe-ams-field/src/` from the Zite workspace repo, so the rules
stay reviewable in this repository after the trial lapses. **The Zite copy is the one that
runs**; this is a read-only mirror.

Three screens, the Field surface only (`docs/17` § G) — Deploy, recover, reports, admin,
reservations and calibration are Desk and Console surfaces and are absent.

```
strings.ts              UI copy, verbatim from app/src/i18n/en.json and docs/12
lib/assetRead.ts        reference-map loading and asset shaping
lib/checkoutRules.ts    the checkout decision, as pure functions
lib/schemas.ts          shared zod shapes
api/searchAssets.ts     S01 — by Asset ID, serial or model name, min 3 chars
api/getAsset.ts         S03 — location, custodian, status, next calibration due
api/checkoutRefData.ts  active projects + assignable people
api/resolveForCheckout  refusal layer 1 — adding to the cart
api/submitCheckout.ts   refusal layer 2 — authoritative, re-reads and re-checks
screens/, components/   the React surface
```

### The refusal, in two layers

A checkout of a non-Available asset is refused **twice**, because the browser owns no
business authority (`CLAUDE.md` rule 1):

1. `resolveForCheckout` — when the technician adds it to the cart. A convenience.
2. `submitCheckout` — re-reads **every** asset and re-checks before writing anything.
   This is the control: between adding and submitting, someone else may have taken it.

Both return `{ ok: false, reason, offendingAssetId }` with HTTP 200 rather than throwing —
the refusal contract from `server/README.md`, which is what lets an offline queue tell *"the
server said no"* from *"the request never arrived"*.

Verified live against the loaded data: Deployed, Retired, InCalibration, Missing, NeedsRepair
and an unknown ID all refused; Available accepted; then the same asset checked out, refused
on a second attempt by both layers, and restored.

---

## What does **not** work, and what was not verified

- **No atomicity.** The finding above. A multi-asset checkout applies one record at a time
  and can half-succeed; `submitCheckout` validates everything first to shrink the window and,
  if a write still fails midway, reports exactly which assets were changed.
- **No event log.** `docs/18` § 7a deferred transactions and transaction lines, so checkout
  **assigns** derived state instead of deriving it from an appended line — a real deviation
  from `CLAUDE.md` rules 4 and 5, recorded in `docs/08`.
- **No idempotency.** `clientSubmissionId` is accepted and used only as a display reference.
  There is no `command_idempotency` table, and no transaction to write one atomically with.
- **`expectedReturn` is captured but not stored** — nowhere to put it without a header.
- **The React screens were never opened in a browser.** The app is `accessMode: internal`
  and sits behind Zite sign-in, which this session must not perform. Endpoint logic was
  exercised against the live database instead, and typecheck plus endpoint bundling are
  clean — but that is not the same as seeing it render. **Someone with an Englobe Zite
  login should open it once and confirm.**
- **No offline, no PWA, no auth model of our own, no field-level security, no scheduled
  jobs.** None of that was in scope.

---

## Picking this up again

1. Open the app: https://build.fillout.com/workspace/85b7c453b34bbf86/6uh1adzxfc/edit
2. The MCP flow is `create_sandbox` (workspaceId = the baseId) → `edit_file` →
   `check_app` → `commit`. Read the framework guide returned by `create_sandbox` first —
   zitejs is proprietary and not in model training data.
3. `check_app` regenerates the typed SDK from the live database, so schema changes made with
   the data tools flow through automatically.
4. Endpoint client types are inferred from what `execute` **returns**, not from
   `outputSchema` — annotate the return type or optional fields silently vanish from the
   caller's view.
