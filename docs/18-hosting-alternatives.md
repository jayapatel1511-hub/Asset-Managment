# 18 — Hosting alternatives: Zite assessment

**Asked** 2026-09-03 by Jay: *"can we write spec so we can use zite to host app"*, with
`https://www.zite.com/help/database/mcp/connection-overview`.

**Short answer.** A spec is writable, and this codebase is better placed for it than almost any
Power Platform project would be — `server/` is already a working PostgreSQL implementation. But Zite
is not a hosting swap. It replaces the *platform*, and four things that are currently platform
features become things we build and maintain. One requirement fails outright today:
**Zite offers US or EU data residency, not Canada.**

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

So the honest technical read: **the data layer is a modest project. The platform layer is the work.**

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

## 8. Needs Jay, or Englobe IT

1. **Is this driven by Q17 cost?** If so, § 5's two reseller questions are cheaper than a platform
   change and could remove the reason entirely.
2. **B1 — Canada residency.** Is it a hard requirement (as written in two documents), or a
   preference? If hard, Zite is out until it offers a Canadian region.
3. **B2 — does Englobe IT/security accept a third party holding this data?** Not a Jay-alone call.
4. **B3 — override the "Microsoft 365 tenant only" constraint?** Answer recorded either way.
5. **Would Zite be the store, or the builder?** Using its hosted PostgreSQL behind our own React app
   is a much smaller step than adopting its app builder — and this repo already has the React app and
   the API. Worth separating, because they carry very different amounts of lock-in.

---

## Sources

- [Zite MCP connection overview](https://www.zite.com/help/database/mcp/connection-overview) — the page Jay linked
- [Zite Database](https://www.zite.com/database) · [Zite Database overview (help)](https://www.zite.com/help/database/overview) · [Zite for Enterprise](https://www.zite.com/enterprise) · [Security at Zite](https://www.zite.com/help/security)
- [How Zite provisions isolated Postgres databases for every user (Neon)](https://neon.com/blog/how-zite-provisions-isolated-postgres-databases-for-every-user)
- [How to check license designation for an app](https://learn.microsoft.com/power-apps/maker/canvas-apps/license-designation) · [Licensing requirements for managed environments](https://learn.microsoft.com/power-platform/admin/managed-environment-licensing) · [Power Apps licensing FAQs](https://learn.microsoft.com/power-platform/admin/powerapps-licensing-faq) · [Power Platform licensing FAQs](https://learn.microsoft.com/power-platform/admin/powerapps-flow-licensing-faq)
