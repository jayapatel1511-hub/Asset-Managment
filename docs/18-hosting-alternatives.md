# 18 — Hosting alternatives: Zite assessment

**Asked** 2026-09-03 by Jay: *"can we write spec so we can use zite to host app"*, with
`https://www.zite.com/help/database/mcp/connection-overview`.

**Short answer.** A spec is writable, and this codebase is better placed for it than almost any
Power Platform project would be — `server/` is already a working PostgreSQL implementation. But Zite
is not a hosting swap. It replaces the *platform*, and four things that are currently platform
features become things we build and maintain. One requirement fails outright today:
**Zite offers US or EU data residency, not Canada.**

**Status: PARKED, 2026-09-03.** The question was answered — see § 2b — and the answer rules Zite
out as the authoritative store. The assessment is retained as the evidence for that decision. The
active direction is the Azure web application (`docs/14-webapp-architecture.md`). Reopen only if Jay
asks.

This document is a decision input, not a decision. It does not change `CLAUDE.md`'s stack table.

---

## 1. What Zite is

From Zite's own documentation and marketing, September 2026:

| | |
|---|---|
| Product | An AI app builder with a hosted database. Hosting is included — no separate server or deploy pipeline |
| Database | A dedicated PostgreSQL instance per organisation, provisioned on **Neon** |
| Access | REST API (up to ~30 req/s per database), plus an **MCP** endpoint at `https://mcp.zite.com/mcp` for AI tools, OAuth-authenticated |
| Compliance | SOC 2 Type II |
| Identity | SAML 2.0 SSO; published apps can sit behind SSO. Okta named as a partner; **Entra/Azure AD is not named** |
| Residency | **US or EU.** No Canada option stated |
| Other | Workspace-level RBAC, audit logs ("every edit, view, action, access"), 20+ field types, Airtable migration, bulk operations, unlimited seats on every plan including free |

The page Jay linked is specifically about the MCP connector — how an AI tool authorises against a
Zite database. It is not a hosting or architecture document, and it states nothing about residency
or pricing.

---

## 2. Why this codebase is unusually ready

This is the genuine argument in favour, and it is stronger than it looks.

- **The swap seam already exists by design.** Every screen calls `AmsBackend` (`app/src/api/`), and
  there are already two implementations behind it — `mock/` and the `dataverse/` stub. Replacing the
  store has always been an interface-level change, not a screen-level one.
- **`server/` is already PostgreSQL.** WS-I built a Fastify API over PGlite with **every write
  implemented and 64 tests passing**. `server/src/db/schema.sql` is *ordinary* PostgreSQL — no PGlite
  extension, no WASM dependency. Zite's database is PostgreSQL. The store side is close to solved.
- **The migration path is already written down.** `server/README.md` § "Swapping in networked
  PostgreSQL" is a five-step plan, authored for the premium-licensing fallback: swap `openDatabase()`
  for a `pg` Pool (`Queryable` is the whole surface node-postgres has to satisfy), run `schema.sql`
  unchanged behind a migration tool, let the `FOR UPDATE` ordering start doing real work, replace
  `devAuth.ts` with OIDC, and decide about `timestamptz`.
- **The entity design was written to be re-targetable.** `CLAUDE.md`: *"do not build anything
  Dataverse-only into the app layer without a comment `// DATAVERSE-ONLY`."*

So the honest technical read *was*: the data layer is a modest project, the platform layer is the
work. **§ 2a corrects that** — it was written from Zite's marketing and help pages, before the MCP
tools were connected and the real interface could be inspected.

## 2a. Correction — Zite's database is not a PostgreSQL you own *(2026-09-03, after inspecting the API)*

Zite runs on PostgreSQL (Neon provisions it), but **the interface it exposes is a typed-field record
API, Airtable-shaped — not a SQL schema under our control.** Verified against the connected MCP tool
surface:

| What we need | What Zite exposes |
|---|---|
| Apply `server/src/db/schema.sql` | **Not possible.** `execute_sql` is documented as "a single SELECT statement", read-only. There is no DDL path. Tables and columns are created through `create_table` / `create_field` with a fixed set of field types |
| Transactions — constitution rule 2, *"one business event is one atomic database commit"* | **No transaction primitive, confirmed by test (§ 2b).** The atomic unit is at most one `bulkCreate`: one table, ≤100 records. A five-asset checkout spans several tables and cannot be one commit |
| `FOR UPDATE` row-lock ordering (`server/README.md` swap step 3) | Not expressible |
| `ON CONFLICT` sequence increment for Asset ID minting | Not expressible. Minting would race, and Asset ID uniqueness is rule 6 |
| CHECK constraints, enums, unique indexes | `single_select` approximates an enum. No unique constraint is exposed, so `(manufacturer, model, category)` and Asset ID uniqueness become application conventions |
| Append-only transaction lines — rule 5 | Convention only. `update_record` and `delete_record` are available on every table; there is no per-table privilege model to withhold them |

One thing softens this. Records carry a `deleted_at` and deletion is soft by default, which actually
suits the deactivate-never-delete rule.

The other hope was `run_one_off_script`, which runs TypeScript against the live database importing
`zitejs/db` — *if that exposed a real transaction API, most of the table above would change.* **It
does not. That was tested against the live runtime on 2026-09-03; see § 2b for the evidence.**

**Revised conclusion.** Zite is credible as a **test and demo environment**, and as a **read model**
for reporting. It is **not** credible as the authoritative store for a system whose first
architectural rule is atomic multi-row commits. This is no longer a matter of inference from the
documentation — the failing multi-write was run, and the earlier writes survived.


## 2b. Answered — `zitejs/db` has no transaction, and a failing multi-write does not roll back *(tested 2026-09-03)*

§ 2a called this "the single highest-value thing to verify". It was verified against the live
runtime through `run_one_off_script`, in the same isolated worker that serves app endpoints. Three
probes, in order of how much they prove.

**1. The client surface — no transaction exists, under any spelling.**
`zitejs/db` exports exactly one symbol, `zite`, whose own keys are:

```
["assets", "auth", "categories", "equipmentModels", "locations", "projects", "sql"]
```

Its prototype adds nothing but `Object.prototype`. Every plausible entry point was probed by name
and each returned `undefined`: `transaction`, `tx`, `begin`, `beginTransaction`, `withTransaction`,
`batch`, `atomic`, `runInTransaction`, `unitOfWork`, `pool`, `client`, `connect`.

**2. The SQL channel refuses transaction control.**

| Statement | Result |
|---|---|
| `BEGIN` | `REFUSED — Only SELECT statements are supported (read-only)` |
| `START TRANSACTION` | `REFUSED — Only SELECT statements are supported (read-only)` |
| `COMMIT` | `REFUSED — Only SELECT statements are supported (read-only)` |
| `SELECT 1 AS ok` | accepted |

So a transaction cannot be opened through the escape hatch either. `zite.sql()` is read-only by
design, and writes must go through `.create` / `.update` / `.delete` / `.bulkCreate`.

**3. The decisive test — successive writes, where the last one fails.**

A scratch table (`Tx Probe`, since deleted) was given a `linked_record` field. The forced failure is
a **well-formed but non-existent** UUID, so the rejection is referential rather than a cheap
string-format complaint. Three writes were issued in the shape rule 2 governs — a header, a line,
then a state change:

```
create { label: 'B1-header' }  ->  COMMITTED  id=461f7506-32a7-4006-be93-3fe97d4c2515
create { label: 'B2-line'   }  ->  COMMITTED  id=fc5834d0-b5a2-4278-a2e5-c874320034d6
create { label: 'B3-state', ref: [<ghost uuid>] }
                               ->  THREW  "Invalid linked record IDs in field(s) [Ref]"
```

Re-querying the table afterwards returned **both earlier rows still present**:

```
SELECT "label","ordinal" FROM "TxProbe" ORDER BY "ordinal"
  ->  [ { label: "B1-header", ordinal: 11 }, { label: "B2-line", ordinal: 12 } ]
```

`rowCount` went 0 → 0 → **2**. Nothing rolled back. **A five-asset checkout on Zite's record API can
half-succeed**, leaving a transaction header and some lines committed with the asset state changes
missing — precisely the outcome `CLAUDE.md` rule 2 exists to make impossible.

**A narrower finding, stated carefully.** A *single* `bulkCreate` of three records, whose middle
record carried the ghost UUID, wrote **nothing** (`rowCount` stayed 0). That is real, but it is
weaker evidence than it looks: the batch was rejected by validation *before* any row was written, so
it demonstrates pre-flight validation, not a proven transactional rollback. Zite exposes no unique
constraints or CHECK constraints, so there is no way from this interface to force a failure that
only surfaces mid-write and settle the question. **What can be said is: the largest unit that is
known not to write partially is one `bulkCreate` — one table, at most 100 records.** A business
event that spans two tables has no atomic unit at all.

### What this settles

| Question | Answer |
|---|---|
| Can Zite be the authoritative store for AMS? | **No.** Rule 2 is unsatisfiable on this interface |
| Can Zite be a test and demo environment? | **Yes** — and it now is; see § 7a |
| Can Zite be a read model for reporting? | **Yes.** `zite.sql()` is a capable read-only SELECT surface |
| Would an application-level compensating-write layer fix it? | It would have to reimplement rollback over a store with no transaction, no unique constraint and no row lock. That is the kind of thing `server/` already gets from PostgreSQL for free (`server/README.md` § Three invariants) |

This also settles § 8's question 5 — "would Zite be the store, or the builder?" — against Zite as
the store. Its own app builder can sit on it perfectly well for a test environment, which is what
was built.

---

## 3. What Zite does not replace

Four things are Power Platform *features* today. On Zite each becomes our code, our tests and our
on-call.

### 3.1 Identity and authorisation — S1

Today: Entra SSO comes from the host, and there is **no auth code in the app at all**
(`docs/10-integration.md`). Authorisation is three Dataverse security roles assigned via `SG-AMS-*`
Entra groups.

On Zite: SAML 2.0 and workspace RBAC exist, but Entra is not a named integration and Zite's own
help centre points customers at `support@zite.com` to enable providers beyond G Suite. `server/`'s
`devAuth.ts` is explicitly a loopback-only stand-in — step 4 of the swap plan says replace it with
OIDC *before it is reachable from anything but loopback*. That work has not started.

### 3.2 Field-level security — S1, and the one I would worry about most

`AMS Sensitive` is a Dataverse **field security profile** covering `eng_phonenumber`, `eng_staticip`
and the ICCID. It returns `null` to a Field User at the data layer.

A decision recorded 2026-09-03 leans on exactly this: `AssetDetailPage` renders the SIM fields with
**no role check in the component**, deliberately, because *"FR-030 is enforced in the data layer,
which sends a Field User `null` for all three, so the UI cannot disagree with the security rule
because it never re-states it."*

Move platforms and that enforcement has to be rebuilt server-side in `server/`, per column, with
tests — or that decision gets revisited and the check moves into the UI, which is the weaker design
it was written to avoid. Zite's RBAC is described as workspace-level; **per-column masking is not a
stated feature.**

### 3.3 The seven flows — S1

`docs/03-automation.md` specifies seven Power Automate flows. **F1 (derive asset state) is
load-bearing**: `CLAUDE.md` rule 1 ("users never write current state") is true *because* F1 is the
only writer.

Partly mitigated: `server/` already reimplements F1's logic — `server/README.md` has a "what maps to
which Dataverse flow" section, and the same `domain/deriveState.ts` is shared. But F3 (calibration
reminders), F4 (overdue returns) and F7 (reservation expiry and reminders) are **scheduled** flows,
and F6 is a concurrency arbiter. Zite is not documented as providing a scheduler or a queue. That is
either a cron host we run, or those features do not ship.

### 3.4 File storage — S2

Calibration certificates go to SharePoint `AMS Documents/{AssetID}/`, inheriting site permissions.
Off-platform, files and data live in different tenancies with different access models.

---

## 4. Hard blockers

| # | Blocker | Status |
|---|---|---|
| **B1** | **Data residency.** `CLAUDE.md` and `docs/00-brief.md` both state *"Data residency: Canada."* Zite states **US or EU** | **Fails today.** Needs Zite to confirm a Canadian region, or Englobe to relax the requirement in writing |
| **B2** | **Third-party custody of secured data.** ~1,050 real assets including ICCID, phone numbers and static IPs. Feature 008 built a *release guard that refuses to publish* real data to a public endpoint, because this data is sensitive. Moving it to a third-party SaaS is the same class of decision, done deliberately | **Englobe IT/security sign-off, not Jay alone** |
| **B3** | **A decided constraint says no.** *"Microsoft 365 tenant only. No external hosting, no custom database"* — `CLAUDE.md` and the brief. Zite is both external hosting and a custom database | Overridable by Jay, but must be **explicit and recorded**, not drifted into |
| **B4** | **Entra integration unverified.** SAML 2.0 is stated; Entra is not named. ~45 users would need whatever Zite actually supports | Needs Zite in writing |
| **B5** | **Rate limit.** ~30 req/s per database. Probably ample for 45 users, but the utilisation report reads history for every asset — measured at 221 ms for 1,459 assets *locally*. Over HTTP against a shared Postgres, that shape needs re-measuring | Needs a load test, not an opinion |

---

## 5. What this is probably really about — and a licensing finding

Zite advertises **unlimited seats on every plan, including free**. `Q17` has been open since the spec
review: per-app vs Premium licensing for code apps, *roughly four times the programme's dominant
cost* across ~45 users. If Q17 is what is driving this, the comparison Jay wants is not
Dataverse-vs-Zite; it is **what actually forces Premium**.

Checked against Microsoft Learn, 2026-09-03:

1. **License designation follows connectors.** *"Premium — an app that uses at least one premium
   connector, a custom connector, or an on-premises gateway."* Dataverse is premium; **SharePoint is
   a standard connector**. So the already-designed fallback (`CLAUDE.md`: *"Fallback if premium
   licensing is denied: SharePoint Lists as the store"*) may genuinely drop the app to Standard —
   which is exactly what it was designed to do.
2. **But a Managed Environment forces Premium regardless of connector.** *"Every user running an app
   in a managed environment must have… Power Apps Premium…"* And `docs/05-security.md` specifies Prod
   as *"Managed Environment if available"*. **Part of Q17's cost is a choice we made, not a
   constraint we inherited.** That is worth re-examining before concluding Premium is unavoidable.
3. **Enforcement tightens February 2027.** Microsoft: *"Starting February 2027, areas where the
   licensing requirement was applied leniently… require users to have an appropriate premium
   license. Users who don't have one can't open and use the app."* That is roughly five months out,
   and this system goes live before then.
4. **Code apps specifically remain unresolved.** `docs/10-integration.md` asserts Premium is required
   to open a code app at all, from the code-apps documentation. Q17 exists because that contradicts
   the Dataverse licensing guidance. **Nothing above resolves it** — it still needs the reseller in
   writing.

So there are two cheaper questions to ask before adopting a new platform: *does dropping the Managed
Environment remove the Premium requirement,* and *does a code app on SharePoint Lists count as
Standard?* Both are answerable by the reseller in a single email, and either could make this whole
question moot.

---

## 6. The three options side by side

| | **Dataverse** (decided) | **SharePoint Lists** (designed fallback) | **Zite** |
|---|---|---|---|
| Canada residency | ✅ | ✅ | ❌ US/EU only |
| Entra SSO, zero auth code | ✅ | ✅ | ⚠️ SAML; Entra unnamed |
| Per-column field security | ✅ platform feature | ⚠️ weaker; needs app-layer work | ❌ not a stated feature |
| State-derivation flows | ✅ Power Automate | ✅ Power Automate | ❌ we build and host it |
| Scheduled reminders (F3/F4/F7) | ✅ | ✅ | ❌ we build and host it |
| Certificate storage | ✅ SharePoint | ✅ SharePoint | ❌ separate tenancy |
| Store already implemented | ⚠️ typed stub | ❌ not started | ✅ **`server/` is PostgreSQL, 64 tests** |
| Premium licence needed | ⚠️ Q17 | ⚠️ Q17 — but SharePoint is a standard connector | ✅ unlimited seats |
| Breaks a decided constraint | — | — | ❌ B3 |

---

## 7. If we proceed, what the spec has to cover

Not written yet, deliberately — B1 alone makes it premature. When it is, it is a feature spec on the
pattern of `specs/001`–`008`, and it must cover:

1. **Residency and DPA** — written confirmation of region, sub-processors (Neon is one), breach
   notification, deletion on termination.
2. **Identity** — Entra via SAML or OIDC; group-to-role mapping; what happens to the three Dataverse
   roles as application-level roles.
3. **Field-level security in `server/`** — per-column masking by role, tested per column, replacing
   the `AMS Sensitive` profile. This is where the FR-030 decision gets re-decided.
4. **The flows** — F1 as server-side logic (largely done), F3/F4/F6/F7 as scheduled jobs with a
   named host, retry semantics and an alert path replacing the `AMS-Alerts` Teams channel.
5. **Files** — where certificates live and how permissions are enforced.
6. **Networked PostgreSQL** — `server/README.md`'s five steps, plus a migration tool and the
   `timestamptz` decision.
7. **ALM** — what replaces `pac solution export` / managed-import, and how Dev and Prod stay separate.
8. **Exit** — how we get the data back out. A third-party store needs an export path specified up
   front, not discovered later.
9. **Retargeting the migration** — `migration/04_load.py` targets Dataverse; the staged CSVs and
   `schema.sql` are already the neutral middle.

---

## 7a. The test environment, as designed *(prepared 2026-09-03, not yet created)*

Jay approved the Zite route "for testing". The database below was designed and the creation call was
**blocked by this session's permission policy** — creating a resource on a third-party service needs
Jay's explicit allowance, which is the correct gate. It is recorded here so it can be reviewed before
it exists rather than after.

**Name:** `Englobe AMS — Zite test`. **Data:** the `demo` synthetic profile only —
371 fictional assets, 699 locations, 52 models, 260 projects, seed `englobe-ams-007`. **Never
`migration/staged/`**, which is the 1,026 real rows.

| Table | Fields |
|---|---|
| **Categories** | Name · Active · Sort Order · *Parent Category* → Categories |
| **Locations** | Name · Location Type (Region/Office/Site/Vehicle/CalLab/Client/Storage) · Active · Note · *Parent Location* → Locations |
| **Projects** | Project Number · Project Name · Status (Active/Closed/OnHold) · *Office* → Locations |
| **Equipment Models** | Name · Manufacturer · Model · ID Prefix · Serialised · Identifier Type (Serial/ICCID/IMEI/**Plate**/None) · Default Cal Interval Months · **Reservable** · *Category* → Categories |
| **Assets** | Asset ID · Serial Number · Lifecycle · Status · Custodian · Last Cal Date · Next Cal Due · Carrier (Bell/Rogers/**Telus**) · Retirement Reason (+**Stolen**) · Notes · Data Origin · *Equipment Model*, *Home Office*, *Current Location*, *Current Project*, *Parent Asset* |

It carries today's decisions forward: **Categories is the hierarchical table** (roots = the 8 asset
groups in the demo data, children = its 18 equipment types), `Reservable` is on the model, and the
new choice values — `Plate`, `Telus`, `Stolen` — are present.

**Three fields are deliberately absent: ICCID (`identifiervalue`), phone number and static IP.**
74 of the 371 synthetic rows carry them. They are fictional and therefore safe, but omitting the
columns makes the environment *structurally incapable* of holding that shape, which is the honest
mirror of the `AMS Sensitive` posture and costs nothing in a test environment.

**Not included in the first pass:** transactions and transaction lines. The demo profile has 16,836
and 23,022 of them — roughly 80 `bulk_create_records` calls, and the point of a first environment is
whether Zite can hold the *model*, not to import 20 years of history. Current state is already in the
asset rows. History is a deliberate second pass, and it is also where the atomicity question in § 2a
actually bites.

## 8. Needs Jay, or Englobe IT

1. **Is this driven by Q17 cost?** If so, § 5's two reseller questions are cheaper than a platform
   change and could remove the reason entirely.
2. **B1 — Canada residency.** Is it a hard requirement (as written in two documents), or a
   preference? If hard, Zite is out until it offers a Canadian region.
3. **B2 — does Englobe IT/security accept a third party holding this data?** Not a Jay-alone call.
4. **B3 — override the "Microsoft 365 tenant only" constraint?** Answer recorded either way.
5. **Would Zite be the store, or the builder?** Using its hosted PostgreSQL behind our own React app
   is a much smaller step than adopting its app builder — and this repo already has the React app and
   the API. Worth separating, because they carry very different amounts of lock-in. **§ 2a sharpens
   this**: the record API is not a PostgreSQL we can point `server/` at, so "Zite as the store behind
   our own API" is a much weaker option than it looked.

## 9. To create the test environment, two permissions are needed

Both are Jay's to give, and neither should be worked around:

1. **Allow this session to create Zite resources.** The `create_database` call was blocked by policy.
2. **A sandbox, if the `zitejs/db` transaction question is to be answered** — `run_one_off_script`
   requires a `sandboxId`, and the first `create_sandbox` call **starts a free 14-day trial on the
   organisation** (no card, per Zite's own connection notes). Worth it only to answer the § 2a
   question, which is the one that decides whether Zite can be more than a test environment.

---

## Sources

- [Zite MCP connection overview](https://www.zite.com/help/database/mcp/connection-overview) — the page Jay linked
- [Zite Database](https://www.zite.com/database) · [Zite Database overview (help)](https://www.zite.com/help/database/overview) · [Zite for Enterprise](https://www.zite.com/enterprise) · [Security at Zite](https://www.zite.com/help/security)
- [How Zite provisions isolated Postgres databases for every user (Neon)](https://neon.com/blog/how-zite-provisions-isolated-postgres-databases-for-every-user)
- [How to check license designation for an app](https://learn.microsoft.com/power-apps/maker/canvas-apps/license-designation) · [Licensing requirements for managed environments](https://learn.microsoft.com/power-platform/admin/managed-environment-licensing) · [Power Apps licensing FAQs](https://learn.microsoft.com/power-platform/admin/powerapps-licensing-faq) · [Power Platform licensing FAQs](https://learn.microsoft.com/power-platform/admin/powerapps-flow-licensing-faq)
