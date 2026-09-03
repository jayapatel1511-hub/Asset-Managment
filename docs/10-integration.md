# 10 — Microsoft 365 integration surface

**Created**: 2026-09-02. **Why this file exists**: integration *is* specified, but it was scattered
across five documents, five flow READMEs, `CLAUDE.md` and a source-file docstring. Nobody could
answer "how does this system use SharePoint?" without reading four files and inferring the rest.
This is the map, and it names the gaps rather than papering over them.

**Not in `specs/`, deliberately.** The spec-kit feature specs under `specs/` are
technology-agnostic by design — their own requirements checklists forbid naming a product
(CHK022). Which Microsoft service satisfies a requirement is a *plan*-layer concern. So `specs/`
says "users must be able to attach a certificate"; this file says that lands in a SharePoint
document library at a given path with given permissions.

---

## The seven surfaces

| Surface | Role | Specified in | Status |
|---|---|---|---|
| **Dataverse** | System of record — 9 tables, choice sets, alternate keys, field security | `docs/01-data-model.md`, `docs/05-security.md` | Fully specified, **nothing created** |
| **Power Apps Code App** | The app itself — React/TS/Fluent, hosted in Power Apps | `docs/02-app.md`, `CLAUDE.md` commands | Built; **not registered or pushed** |
| **Power Automate** | F1–F5; F1 derives all current state | `docs/03-automation.md`, `solution/flows/F1..F5/README.md` | Specified as files, **not published** |
| **SharePoint Online** | Calibration certificate storage, library `AMS Documents` | 4 scattered lines — see § SharePoint | **Thinnest area.** See gaps |
| **Teams** | `AMS-Alerts` channel for flow failures; reminder cards; overdue DMs | `docs/03-automation.md`, F1/F2/F3/F4 READMEs | Partially specified. See gaps |
| **Entra ID** | Identity; 3 roles via `SG-AMS-*` security groups | `docs/05-security.md` | Specified, **groups not created** |
| **Power BI** | DirectQuery reporting for licence-free readers | `specs/006-fleet-reporting/`, `docs/06-delivery-plan.md` Step 6 | Specified + planned; PBIP authoring is WS-B T032 |

Fabric is explicitly out of scope (`docs/08-decisions.md`, 2026-09-02).

---

## Where the app meets Dataverse

This is the one integration point that is **already well specified**, and not in a doc — it is the
95-line docstring at the top of `app/src/api/dataverse/index.ts`. Read that file before
implementing WS-E. It fixes the four decisions that matter:

1. **One file per table** wrapping the SDK's typed client, per `docs/02-app.md`'s structure.
2. **Every write is one `$batch`** containing one `eng_transaction` plus N `eng_transactionline`
   rows — atomicity, FR-003.
3. **It stops there.** It does *not* compute `eng_asset.status`/`location`/`custodian`. Flow F1
   does that, asynchronously. Calling `deriveState()` here to write `eng_asset` directly would give
   the app a second, unaudited write path to derived fields and break Principle V's requirement
   that the automation enforces independently. This is the single easiest way to get WS-E wrong.
4. **`eng_idsequence`** uses `If-Match` etag optimistic concurrency with up to 3 retries
   (`docs/01-data-model.md`). The mock needs none of this — single-threaded JS.

Field security (FR-030) is enforced by the Dataverse profile `AMS Sensitive`, not by app code.

---

## SharePoint — the thinnest area

**Decided**: library `AMS Documents` on the Ontario Instrumentation Hub site (`CLAUDE.md`);
certificates filed under `AMS Documents/{AssetID}/` (`docs/02-app.md`); the URL stored in
`eng_certificateurl` (`docs/01-data-model.md`); permissions inherit the site and the library is
readable by all AMS groups (`docs/05-security.md`).

**Not decided, and each of these will be hit in the first month of real use:**

| Gap | Why it matters |
|---|---|
| Upload failure semantics | A calibration record saves but the PDF upload fails. Is the record kept with no certificate, or rolled back? Feature 004's FR-017/FR-020 assume a certificate can be attached later, which argues for keeping it — but that must be stated, not inferred. |
| File naming inside the asset folder | Two calibrations for one asset in one year collide on any date-only name. |
| Size and type limits | Nothing says PDF-only. A 200 MB scan will be uploaded eventually. |
| Behaviour on retirement | `eng_certificateurl` must survive retirement — FR-019 requires certificates for the life of the asset **and beyond**. Nothing states that the folder is not cleaned up. |
| Authentication path | Whether the Code App uploads directly or a flow does. Different licensing, different failure surface, different audit trail. |
| Retention | Q13 settled indefinite retention for assets and history. Certificates were not explicitly included. |

**Recommendation**: keep the calibration record on upload failure, surface "certificate missing"
on the asset, and let FR-020's replace-or-re-associate path fix it. Name files
`{AssetID}_{calibrationdate}_{certificatenumber}.pdf`. PDF and image only, 25 MB cap. Never delete
a certificate folder. All of this needs Jay's confirmation before Step 5.

---

## Teams

**Decided**: every flow retries transient failures exponentially ×4, then posts to channel
`AMS-Alerts` and leaves `eng_processed = false` so F5 retries (`docs/03-automation.md`). F3 sends
one adaptive card plus one email per office admin. F4 DMs the custodian about an overdue return.

**Not decided:**

- **Adaptive card content and schema.** F3's README names the card but not its fields.
- **Who is in `AMS-Alerts`.** A channel that alerts nobody is a log file with extra steps.
- **What a failed Teams post does.** If F3 cannot reach Teams, does the flow fail, or is
  notification best-effort? Feature 004's FR-032 says notification must be disableable without
  affecting the due list, which implies best-effort — so a Teams failure should not fail the flow.
  Currently unstated.
- **Throttling.** F3's cadence is `// ASSUMPTION` (once per threshold crossing). At 107 assets
  currently overdue, the first real run sends a large card.

---

## Licensing — what must be bought

Verified against Microsoft Learn 2026-08-14 (`admin/pricing-billing-skus`,
`admin/power-automate-licensing/types`) and `code-apps/overview` 2026-08-19. **Confirm final SKUs
and pricing with the reseller** — entitlements change, and this is a budget commitment.

| Who / what | Licence | Notes |
|---|---|---|
| **Every technician and admin who opens the app** | **Power Apps Premium**, per user | `code-apps/overview`: *"End users that run code apps need a Power Apps Premium license."* Not just makers. ~25–45 technicians plus 4–8 admins. **This is the dominant cost of the programme** |
| Dataverse storage and access | Included with Power Apps Premium | Premium Power Apps / Power Automate licences *"include access to Dataverse to store and manage data"*, with a per-licence storage entitlement plus a tenant base allocation |
| **The five flows (F1–F5)**, owned by `svc-ams` | **Either** a Power Automate Premium user licence on `svc-ams`, **or** a **Power Automate Process** licence per flow | A Process licence *"entitles it to higher action limits and allows use of premium and custom connectors **regardless of the owning or triggering user's license**"*, and *"flows must be in a solution"* — ours already are (`CLAUDE.md` ALM row), so this route is open. Dataverse is a premium connector, so one of the two is required |
| Power BI **report authors** | Power BI Pro | Publishing always needs Pro or PPU |
| Power BI **report readers** (managers, PMs) | **Free** — *if* the workspace sits on **Fabric F64 or larger** capacity. Otherwise Pro each | This is where a Fabric capacity actually pays for itself here |

### Tenant reality check, 2026-09-02

Run against the live tenant with `pac` (v2.11.2), authenticated as `Jay.Patel@englobecorp.com`.

| Finding | Detail |
|---|---|
| **`pac` is installed and authenticated** | `C:\Users\patjay\.dotnet\tools\pac.exe`. Not on the Git Bash PATH, which is why an earlier check reported it missing — call it by full path, or add `.dotnet\tools` to PATH |
| **Jay holds Power Platform admin** | `pac admin list-tenant-settings` succeeds, which requires it |
| **Three environments exist** | `EnGlobe Corp. (default)` — `org4b5b2c68.crm.dynamics.com`; `Englobe UAT Env` — `orgd2bfd754.crm3.dynamics.com`; `Jay Patel` — `orgdd188c52.crm3.dynamics.com`, type **Developer**, in environment group *Quebec* |
| **Neither AMS environment exists** | `CLAUDE.md` assumes `Englobe-AMS-Dev` / `Englobe-AMS-Prod` at `englobe-ams-dev.crm3.dynamics.com`. Neither is provisioned. `pac admin create` can make them — Jay has the rights |
| **Region mismatch worth checking** | The default environment is on `crm.dynamics.com`; UAT and Jay's developer environment are on `crm3.dynamics.com` — different regional clusters. The Canada data-residency requirement means the AMS environments must be created in Canada explicitly. **Confirm each environment's region in the admin centre rather than inferring it from the URL** |
| **`pac code` subcommands are present** | `init`, `push`, `run`, `add-data-source`, `list`, `list-tables`. These coexist with the newer `pa app *` CLI |

### You can build the whole thing today, for free

**Jay has a Developer environment.** The Power Apps Developer Plan is free and grants full Dataverse
with premium connectors — for **individual use only; it cannot be shared**.

That is enough to unblock nearly everything currently listed as "needs the tenant":

- Create the 9 tables, choice sets, alternate keys, relationships and security roles (WS-F)
- Run `migration/04_load.py` against real Dataverse instead of staged JSON
- Implement and actually **test** `api/dataverse/` (WS-E), which today can only be compiled
- Build and publish flows F1-F5 and verify F1 against `deriveState.ts`
- `pa app init` / `pa app push` the code app, and answer feature 008's two open questions — does it
  run in the mobile player, and does it work offline

None of that needs a purchased licence. Licensing only becomes blocking at the point technicians
need to open the app, because a Developer environment cannot be shared.

**Caveats**: developer environments have smaller capacity, are individual, and can be reset or
reclaimed if unused. Treat it as a proving ground, not as Dev — the real `Englobe-AMS-Dev` still
gets created properly. But it converts "blocked on IT and procurement" into "start now, buy later".

### Who needs a Power Apps licence, and who does not

Two audiences, and conflating them is easy:

| Audience | Count | Uses | Power Apps licence? |
|---|---|---|---|
| Field technicians | 25–45 | The app — search, checkout, return, transfer, deploy | **Yes** |
| Office admins | 4–8 | The app — everything above plus registration, calibration, retirement | **Yes** |
| Managers, PMs | many | **Power BI reports only.** Never opens the app | **No** — this is what feature 006 means by *"without an app licence"* |
| `svc-ams` | 1 | Owns and runs the flows | Power Automate, not Power Apps |

### The licence is for Dataverse, not for Power Apps hosting

This matters if anyone asks whether the cost could be avoided by hosting the React app somewhere
else — Azure Static Web Apps, a SharePoint page, anywhere. It could not:

> *"Accessing an environment with Dataverse requires **all users** to have a corresponding
> standalone Power Platform license for each service being utilized. For example, a user accessing
> an app running on Dataverse needs to be licensed by either the Power Apps per app or per user
> plan."* — Power Platform licensing FAQs

Move the hosting and the per-user Dataverse licence follows the user anyway. Power Apps hosting is
therefore close to free in licensing terms, and it brings Entra SSO, DLP, Conditional Access,
sharing and admin telemetry that a self-hosted SPA would have to reimplement. **Keep it.**

### The one question worth asking the reseller — it is worth roughly 4×

The code apps documentation says end users need **Power Apps Premium** (the per-user plan, list
~$20/user/month). The general Dataverse licensing guidance says a user accessing a Dataverse app
needs *"either the Power Apps per app or per user plan"*, and **per app** lists at roughly
$5/user/app/month.

If a **per-app** plan covers a code app, the licensing cost of this programme drops by about
three-quarters. If code apps genuinely require Premium specifically, it does not. The two Microsoft
sources do not settle it, and the difference across 45 users is material.

**Ask exactly this**: *"Does a Power Apps per-app plan entitle an end user to run a Power Apps
**code app** backed by Dataverse, or is Power Apps Premium (per user) required?"*

### If premium licensing is refused entirely

The constitution already anticipates this: *"Fallback if premium licensing is denied: SharePoint
Lists as the store."* That is the genuine escape hatch — SharePoint Lists are covered by the
existing Microsoft 365 licences, with no premium Power Platform seat at all.

The entity design in `docs/01-data-model.md` was written to be re-targetable, and the app talks only
to `AmsBackend`, so the seam exists at both layers. It costs the transactional guarantees, the field
security profile and the audit trail — a real downgrade, not a free swap — but it is a coherent
fallback rather than a rewrite.

**Not an option**: server-to-server authentication. It genuinely avoids per-user licensing (*"there
is no license fee for the special application user account"*), but it makes the *application* the
trust boundary instead of Dataverse. Field-level security on ICCID, phone and static IP would stop
being enforced by the platform, which breaks FR-030 and Principle VII, and every user would appear
in the audit trail as one service account, which breaks Principle II's attribution. It solves a
budget problem by dismantling the security model.

### What Microsoft 365 licences do *not* cover

E3/E5 include a limited Dataverse service plan, and it explicitly does not help:

> *"the capabilities of Dataverse included with select Microsoft 365 licenses don't allow customers
> to create custom apps with Power Apps or use the premium connectors with Power Automate"*

and creating a Dataverse instance in a production or sandbox environment — which is exactly what
`Englobe-AMS-Dev` and `-Prod` are — *"still requires a premium Power Apps or Power Automate
license."*

### Where a Fabric capacity does and does not help

**It does not touch the app.** Fabric is analytics capacity. It grants no Power Apps entitlement, no
Dataverse app entitlement, and no Power Automate entitlement. Feature 006 aside, a Fabric licence
moves nothing in this programme.

**It does help feature 006**, and materially: on **F64 or larger**, users holding only a Free licence
can view Power BI content in a viewer role. That is the difference between buying Power BI Pro for
every manager and PM who reads a report, and buying none. Below F64, every reader needs Pro.

Two cautions before counting on it:

- **A Fabric *trial* is not a purchased capacity.** Trials are time-boxed and their free-viewer
  behaviour should not be assumed to match a paid F64. Verify with the reseller before planning the
  reporting rollout around one.
- **Fabric remains out of scope as a platform** (`docs/08-decisions.md`, 2026-09-02 — *"Fabric is an
  analytics platform, not an app store"*). Using Fabric *capacity to host Power BI* is a different
  thing from building on Fabric, and only the former is in play.

### Cheapest honest path

1. Power Apps Premium for the Ottawa pilot users only — the pilot is one office, so this is the
   smallest commitment that proves the system.
2. One Power Automate Process licence per scheduled flow, or Premium on `svc-ams` — compare the two
   once the flow count and daily action volume are known.
3. Decide Power BI reader licensing only after the pilot, when the reader list is real (Q11 is still
   open). If the Fabric capacity is F64+ and permanent, readers are free.

## Entra ID and licensing

Three Dataverse roles (`AMS Field User`, `AMS Office Admin`, `AMS System Owner`) assigned via
`SG-AMS-FieldUsers`, `SG-AMS-OfficeAdmins-{office}`, `SG-AMS-Owners` (`docs/05-security.md`).

**Two consequences of the N-offices decision** (2026-09-02) that `docs/05-security.md` does not
yet reflect:

1. `SG-AMS-OfficeAdmins-{Ottawa|Toronto|Sudbury|SWO}` is a **fixed four-group list**. Under N
   offices, adding an eleventh office would need a new group created by hand or its admins get
   nothing. Either the groups become one group with office scoping derived from the location table,
   or group creation becomes part of the office-creation procedure. This is the same defect that
   superseded `office_admins.csv`.
2. Office-scoped admin filtering is done in the app by home office, not by Dataverse business
   units. That stays correct and stays simple.

Service account `svc-ams@englobecorp.com` owns flows and connections and needs an MFA exemption
scoped to Power Automate via conditional access — an IT ticket, listed in `docs/06-delivery-plan.md`
Step 0.

---

## Agent and tooling access — MCP

### Installed: Microsoft Learn MCP *(safe, free, no tenant)*

```
.mcp.json → microsoft-learn → https://learn.microsoft.com/api/mcp   (HTTP, project scope)
```

Official Microsoft server ([docs](https://learn.microsoft.com/en-us/training/support/mcp),
[repo](https://github.com/microsoftdocs/mcp)). Read-only access to current Microsoft documentation
and code samples, publicly available at no charge, no authentication. Committed at **project**
scope so every session and every agent on this repo gets it.

Why it earns its place: the code-apps CLI we had documented (`pac code push`) had already been
deprecated and nobody noticed. This server makes "check the current documentation" a tool call
rather than a web search, which is how that class of staleness gets caught.

**It needs one-time approval** — run `claude` interactively and approve `microsoft-learn`. A
non-interactive session cannot approve it.

### Not installed: Dataverse MCP *(real, official, blocked on the tenant)*

Microsoft ships a Dataverse MCP server ([overview](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp),
[non-Microsoft clients](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-mcp-other-clients)).
It is an **environment-side capability**, not a package you install — you enable it on a Power
Platform environment and point a client at it. We have no environment, so it cannot be enabled.

When the environment exists, the whole setup is:

1. **Tenant admin consent**, once per tenant:
   `https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id=0c412cc3-0dd6-449b-987f-05b053db9457`
2. **Enable the MCP server on the environment**: Power Platform admin center → Manage →
   Environments → *env* → Settings → Product → Features → **Dataverse Model Context Protocol**.
3. **Allow the client**: same screen → Advanced Settings → **Dataverse CLI**
   (app ID `0c412cc3-0dd6-449b-987f-05b053db9457`) → *Is Enabled* = Yes. Add it manually if absent.
4. **Register it in Claude Code** (Node 18+ required; we have 22.14):

```bash
claude mcp add dataverse -t stdio -- npx -y @microsoft/dataverse mcp https://englobe-ams-dev.crm3.dynamics.com
```

A remote-endpoint alternative exists (`https://<org>/api/mcp`) if you would rather register your
own Entra app with the `Dynamics CRM → mcp.tools` permission than use the Dataverse CLI app.

**Cost**: since 15 December 2025, Dataverse MCP tools are **charged** when used by agents created
outside Copilot Studio, unless the tenant holds qualifying Dynamics 365 Premium or Microsoft 365
Copilot licences. Confirm before enabling.

### ⚠️ Guardrails required before Dataverse MCP is enabled

Its tools are `search_data`, `search`, `create_record`, **`update_record`** and
**`delete_record`** — direct, unmediated write access to Dataverse rows. Two constitutional
principles are one tool call away from being broken:

| Tool use | Breaks |
|---|---|
| `update_record` on `eng_asset` status / location / custodian / project / parent | **Principle I** — current state is derived, never typed. This is precisely the failure that killed the spreadsheet |
| `update_record` or `delete_record` on `eng_transactionline` | **Principle II** — history is append-only. An edited log cannot settle a damage claim |
| `create_record` on `eng_transactionline` outside the app or a flow | Bypasses the transition matrix — **Principle V**, refused at both layers |

So before it is enabled, write these down and agree them:

- **Read-only by default.** `search_data` and `search` yes; the three write tools disabled unless a
  specific task needs them and the System Owner has said so.
- **Never Production.** Development environment only.
- **Never write `eng_asset` derived fields, and never write, update or delete
  `eng_transactionline`.** Corrections are compensating transactions through the app or a flow.
- **No schema changes** without the System Owner's sign-off.
- **Every write reported** — count and table — in the session's build report.

None of this is hypothetical caution: the tool names are `update_record` and `delete_record`, and
the principles they threaten are the two the whole design rests on.

### Deliberately not installed: third-party Power Platform MCP servers

A community server advertising 228 tools for Power Platform authoring, debugging, data and
**administration** exists on GitHub. It is not published by Microsoft. A third-party server with
administrative reach over the tenant is not something to add on a one-line instruction — if it is
ever wanted, it needs its own review and its own decision entry.

### What MCP does *not* solve

Nothing that remains buildable needs MCP. WS-G (synthetic data) and WS-H (release safety) are
TypeScript, Python and markdown — local file work, fully tooled today. MCP matters only for tenant
work, and the sanctioned path there stays the `pac` / `pa` CLI run by a human with `pac auth create`
(`CLAUDE.md`).

---

## What to fix, in order

1. **SharePoint gaps** — six unanswered questions above, needed before `docs/06-delivery-plan.md`
   Step 5. Cheapest to settle, and the first month of use will otherwise settle them by accident.
2. **`SG-AMS-OfficeAdmins-*` under N offices** — same class of defect as `office_admins.csv`, and
   it silently denies a new office its admin rights.
3. **Teams failure semantics** — one sentence: notification is best-effort and never fails a flow.
4. **`solution/README.md`** is three lines and describes no table or role artefact. WS-F owns this.

---

## Hosting the Code App in Power Apps

Verified against Microsoft Learn 2026-08-19 (`code-apps/overview`,
`code-apps/how-to/create-an-app-from-scratch`, `code-apps/system-limits-configuration`).

### The model

`pa app push` compiles the Vite bundle and uploads the assets to Power Platform. The app then runs
at:

```
https://apps.powerapps.com/play/e/{environment id}/a/{app id}
```

Append `?hideNavBar=true` to suppress the Power Apps header — worth doing for a phone-first field
app, where the chrome costs a fifth of the viewport.

Identity comes from the host: Entra SSO, no auth code in the app. Managed-platform policies apply
automatically — canvas-app sharing limits, DLP enforced at launch, per-app Conditional Access,
tenant isolation, health metrics in the admin centre.

### How you and your users actually open the app

Verified against Microsoft Learn 2026-08-19 plus the code-apps CLI reference.

**The address.** Once published, the app lives at:

```
https://apps.powerapps.com/play/e/{environment id}/a/{app id}?hideNavBar=true
```

`pa app push` returns it. It is also reachable from [make.powerapps.com](https://make.powerapps.com)
→ **Apps** → play, which is how most people will find it the first time.

**Granting access.** Two separate things must both be true, and this is the classic first-day
support call:

1. **The app is shared with them** — `pa app share --principal <emails or Entra object IDs> --access play`
   (`play` is the default; `edit` only for co-owners and the service principal that runs
   `pa app push`). Or share from make.powerapps.com. Code apps follow canvas-app sharing limits.
2. **They hold a Dataverse security role** — `AMS Field User`, `AMS Office Admin` or
   `AMS System Owner`, via the `SG-AMS-*` groups. Sharing the app does **not** grant data access.
   A user with the app shared but no role opens it successfully and sees nothing, which looks like
   a broken app rather than a permissions problem.

Plus the licence: **Power Apps Premium**, or it will not open at all.

**Where users find the link.** Nobody remembers a GUID URL. Put it where they already are:

- The **Ontario Instrumentation Hub** SharePoint site — the *Equipment Hub* page is the natural
  home, and the source spreadsheet's own site map already anticipated it.
- A **QR code** on the storage-room wall and inside the truck — the fastest path for a technician
  holding a phone.
- **Add to Home Screen** on iOS/Android, which gives a browser-launched app an icon and full-screen
  chrome. Combined with `?hideNavBar=true` this is the closest thing to a native feel.

**Which clients work:**

| Client | Status |
|---|---|
| Desktop browser (Edge, Chrome, Firefox, Safari) | ✅ The primary path for office admins |
| Mobile browser on iOS/Android | ✅ Expected — the app is a hosted SPA and is designed for 390 px |
| **Power Apps for Windows** | ❌ **Explicitly unsupported** for code apps |
| Power Apps mobile app (iOS/Android) | ⚠️ **Undocumented for code apps.** See below |

### Mobile and offline — what the documentation actually says

Neither is stated for code apps. What *is* documented, and worth reading as a signal rather than an
answer:

- Every offline capability in the Power Apps ecosystem — canvas and model-driven — is a feature of
  the **native Power Apps Mobile player**, not the browser. Microsoft is explicit that *"canvas apps
  running in web browsers can't run offline, even when using a web browser on a mobile device."*
- Code apps are hosted SPAs served from `apps.powerapps.com`, and the only client the documentation
  rules out by name is Power Apps for Windows.

So the honest position: **assume mobile browser, and assume no platform-provided offline**, until
tested. Feature 003 US5's queue is built against an injectable transport and a browser
`localStorage`, so it does not depend on a platform offline feature — but whether the app *loads
at all* with no connectivity is the thing to test, and it is the difference between a technician in
a basement being able to work or not.

Both are day-one verification tasks in `specs/008-release-and-operations/spec.md`, not assumptions
to carry into a pilot.

### The CLI changed — our documented command was wrong

`pac code init` / `pac code push` is the **deprecated** CLI. From `@microsoft/power-apps` v1.0.4 an
npm-based CLI replaces it, and we are on **v1.3.1**. The current sequence is:

```bash
npm install --global @microsoft/power-apps-cli
npm install --global @microsoft/power-apps
npm install

pa app init --display-name "Englobe AMS" --environment-id <environment-id>
pa app run          # local play
npm run build
pa app push         # publish
```

`CLAUDE.md` has been corrected. `docs/09-build-report.md` and `specs/REMAINING-WORK.md` still name
the old commands in their "needs the tenant" lists — harmless as descriptions, but do not copy them.

### Two admin prerequisites not currently in the delivery plan

1. **Code apps must be enabled per environment.** Power Platform admin center → Manage →
   Environments → *the environment* → Settings → Product → Features → **Power Apps code apps** →
   *Enable code apps* → Save. Configurable across environments via environment groups and rules.
   This is missing from `docs/06-delivery-plan.md` Step 0 and blocks everything.
2. **Every end user needs a Power Apps Premium licence** to *run* a code app — not just makers.
   That is 25–45 field technicians plus admins, and it is a harder licensing ask than the delivery
   plan's "premium licences confirmed for pilot users" implies. Confirm the count and the SKU.

### ⚠️ Never push with the mock backend

> "Don't store sensitive user or organizational data in the app. Store this kind of data in a data
> source so the content is retrieved after end-users playing the app go through authentication and
> authorization checks." — Microsoft Learn, code apps system configuration

The compiled assets are served from a **publicly accessible endpoint** with no IP-based
restriction. Our mock backend loads `migration/staged/*.json` from `app/public/data/` — 1,026 real
Englobe assets **including `identifiervalue` (SIM ICCID), `phonenumber` and `staticip`**, the three
fields the `AMS Sensitive` field security profile exists to protect (FR-030, Principle VII).

Those files are bundled by `npm run build`. **A `pa app push` with `VITE_AMS_BACKEND=mock` would
publish the fleet's SIM and IP data to a public endpoint.** The mock is a local development
substitute only.

Required before the first push:

- `scripts/copy-staged-data.mjs` must not run in the Power Apps build path, and `public/data/`
  must be excluded from the published bundle.
- The push build must set `VITE_AMS_BACKEND=dataverse` and fail loudly if it is unset or `mock`.
- Add this as a pre-push check, not a convention someone has to remember.

To restrict access by IP or location, use Entra **Conditional Access — block access by location**.
The environment's SAS IP Binding and firewall setting does not apply to code apps.

### Repo readiness

| Item | State |
|---|---|
| `@microsoft/power-apps` dependency | ✅ present, `^1.3.1` |
| Vite dev port 3000 (SDK requirement) | ✅ set in `vite.config.ts` |
| App config from `pa app init` | ❌ absent — no app/environment id recorded |
| `initialize()` from `@microsoft/power-apps` at startup | ❌ `src/main.tsx` does not call it |
| `PowerProvider` wrapper | ❌ absent |
| `vite.config.ts` `base` | ❌ unset. The app is served from a `/play/e/…/a/…` path; the official Vite template sets a relative base. Verify against the template before pushing |
| Routing | ⚠️ `App.tsx` uses `BrowserRouter` with absolute paths (`/asset/:assetId`). Under a hosted sub-path a deep-link reload will not resolve. Expect to need a `basename` or `HashRouter` — verify with `pa app run` |
| Data sources | ❌ none added. `pa app add-data-source` generates the typed Dataverse clients `api/dataverse/` needs |

### Limitations that touch this project

| Limitation | Consequence here |
|---|---|
| **Code apps are not supported in Power Apps for Windows** | Technicians and admins reach the app through a browser or the web player, not the Windows client. If a Windows-client rollout was assumed, it is not available. |
| No Power Platform Git integration | Our ALM is `pac solution export` → managed import, so no change — but do not plan on Git integration later. |
| No Power BI data integration (`PowerBIIntegration`) | Feature 006 is unaffected: it reads Dataverse via DirectQuery, not through the app. Note the app *can* be embedded in a Power BI report via the Power Apps visual if that is ever wanted. |
| No SharePoint forms integration | Not used. |
| Public asset endpoint, no IP restriction | See the warning above. Conditional Access is the control. |

### Two limits the documentation does not state — verify before committing to them

1. **Offline.** Nothing in the code-apps documentation states offline support either way. Feature
   003 US5 (queue while offline, replay on reconnect) is built against an injectable transport, so
   the *logic* is portable — but whether the Power Apps host permits a service worker, and whether
   the app loads at all without connectivity, is unverified. This matters: technicians work in
   basements, piers and mine access. **Test it on day one of tenant access**, before the pilot
   depends on it.
2. **Mobile player.** "Not supported in Power Apps for Windows" is stated; iOS and Android are not
   mentioned. The app is designed phone-first at 390 px. Confirm whether it runs in the Power Apps
   mobile app or only in a mobile browser — it changes how the pilot is rolled out and whether
   camera barcode scanning (`ScanDialog.tsx`, currently `MOCK-ONLY`) is available at all.

Both are Step 0 verification tasks, not assumptions to carry into a pilot.
