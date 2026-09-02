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

## Agent and tooling access — currently none

There is **no MCP server, connector or programmatic tenant access configured** in any development
session to date. Verified 2026-09-02: the connector registry returns nothing for `microsoft`,
`dataverse`, `power platform`, `sharepoint`, `microsoft 365`, `azure`, `excel`, `outlook`, `teams`,
`onedrive` or `office`.

Every "needs the tenant" item in `docs/09-build-report.md` and
`specs/REMAINING-WORK.md` is premised on that. The sanctioned path is the `pac` CLI run by a human
with `pac auth create`, per `CLAUDE.md`.

**If programmatic tenant access is ever granted to an agent**, it needs written guardrails first,
because it is a write path to production data and two constitutional principles are at risk:

- Read-only by default; Prod never; no schema change without the System Owner's sign-off.
- **Never write an `eng_transactionline` directly.** It must go through the app or a flow, or
  Principle I's "state is derived, never typed" is dead and the history stops being trustworthy.
- Never update or delete a transaction line (Principle II) — corrections are compensating
  transactions.
- Every write reported, with counts, in the session's build report.

That is a decision for `docs/08-decisions.md`, not a convenience toggle.

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
