# 06 — Delivery plan

Work in this order. Each step has a definition of done (DoD). Do not start the app before the schema is loaded
in Dev with real migrated data — every screen should be built against actual Ottawa assets.

## Step 0 — Human prerequisites (Jay / IT) — blocks everything
- [ ] **Power Apps Premium licence for every END USER who runs the app** — not just makers. Code apps
      require it to *play*, so that is all 25–45 technicians plus admins. Confirm count and SKU.
      **Dominant cost of the programme** — see `docs/10-integration.md` § Licensing
- [ ] **Flow licensing for `svc-ams`**: either Power Automate Premium on the account, or a Power
      Automate Process licence per flow (our flows are solution-aware, so Process is available).
      Dataverse is a premium connector, so one of the two is mandatory
- [ ] **Power BI reader licensing decided**: Pro per reader, or free readers on a Fabric F64+
      capacity. Depends on Q11 (who needs access) and on whether any Fabric capacity is permanent
      rather than a trial
- [ ] **Code apps enabled on both environments**: Power Platform admin center → Manage → Environments
      → *env* → Settings → Product → Features → "Power Apps code apps" → Enable → Save. Blocks
      `pa app init` entirely (docs/10-integration.md § Hosting)
- [ ] **Verify offline behaviour and mobile-player support on day one** — neither is stated in the
      code-apps documentation, and the pilot's field use depends on both (docs/10-integration.md)
- [ ] Dev + Prod environments created, Canada region; Jay = System Administrator on both
- [ ] `svc-ams` account + Entra groups from `05-security.md`
- [ ] `pac auth create` done on the build machine
- [ ] Answers to `07-open-questions.md` Q1–Q4 (others can wait)

## Step 1 — Reference data & schema (est. 2–3 days)
- Finalise `data/reference/equipment_models.csv` and `locations.csv` from the drafts
- `pac solution init`; create the 9 tables, choice sets, keys, relationships, indexes per `01-data-model.md`
- Security roles + field security profile
- DoD: `pac solution export` succeeds; a test asset can be created via Web API; a Field User cannot update `eng_transactionline`

## Step 2 — Migration to Dev (est. 3–4 days)
- Scripts 01–05 per `04-migration.md`
- DoD: acceptance list in `04-migration.md`; `reports/02_conflicts.md` reviewed by Jay

## Step 3 — F1 state flow (est. 2 days)
- Build F1 + F5 first. Unit-test by inserting lines via API and asserting asset state.
- DoD: every cell of the transition matrix exercised by a test script (`tests/flows/f1_matrix_test.py`), rejected transitions logged

## Step 4 — Code App MVP (est. 2–3 weeks)
- Order: api/ + domain/ + tests → Search → Asset detail + history → Checkout → Return → Transfer → Cal due → Admin: New asset, Record calibration, Retire
- DoD: Test Engine plan per screen passes; questions 1–6 from the brief demonstrable on a phone; works offline for Search + Checkout queueing

## Step 5 — F2–F4 flows, SharePoint library (est. 2 days)

## Step 6 — Power BI page (est. 2 days)
- One report, pages: Fleet, Where/Who, Availability by office, Calibration due, By project, Asset timeline (question 7).

## Step 7 — Pilot: Ottawa (4 weeks)
- Load Prod with Ottawa only (other offices stay in old lists, read-only). Fix, then load remaining offices.

## Phase 2 backlog (after pilot)
Deploy/Undeploy kit screen with site + orientation + power; Audit screen for TMP assets; QR label print export;
Teams notifications polish; French strings; Fabric link if analytics demand it.

## Definition of done — whole project
- All acceptance questions answered live from Prod data
- Solution imports cleanly to a fresh environment from `solution/export` + `data/reference` + `migration/` alone
- `docs/` updated to match what was built; every deviation from this spec recorded in `docs/08-decisions.md`
