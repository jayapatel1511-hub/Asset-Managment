# Zite build prompt

Paste the block below into a fresh Claude Code session in `C:\Files\Asset Managment`, with the
`zite` MCP server connected. It is written to be self-contained — the session it lands in will not
have the conversation that produced it.

Two gates it will hit, both Jay's to open: creating Zite resources is blocked by default permission
policy, and the first `create_sandbox` call starts a **free 14-day trial** on the organisation.

---

```text
You are building a TEST environment for Englobe AMS on Zite, via the zite MCP server.

READ FIRST, in this order. Do not guess at any of it:
  1. CLAUDE.md                        — the 20 non-negotiable rules and the current stack
  2. docs/18-hosting-alternatives.md  — the Zite assessment. Sections 2a, 7a and 9 are the brief
                                        for this task: 2a is what Zite's API can and cannot do,
                                        7a is the database design already agreed, 9 is the gates
  3. docs/17-ux-audit.md § G          — the three surfaces. You are building "Field" only
  4. docs/12-ui-spec.md §§ 5.1, 5.3, 5.5 — S01 Search, S03 Asset detail, S04 Checkout, with exact
                                        copy. Reuse the strings; do not invent UI text
  5. server/README.md                 — how the existing API enforces the invariants, and the
                                        refusal contract (HTTP 200 with ok:false, not 422)

THE ONE THING PEOPLE GET WRONG HERE
  app/ is a complete React 18 + Fluent UI v9 + Vite application with 317 passing tests. Zite's app
  builder uses its own proprietary zitejs framework, which is NOT in your training data. So this is
  NOT a port or a deploy of app/. Do not attempt to move 20 Fluent UI screens into zitejs.
  Read the framework guide returned in the create_sandbox response before writing any app code.
  Treat app/ as the design reference and the source of copy and domain logic, nothing more.

HARD CONSTRAINTS — these are not preferences
  1. SYNTHETIC DATA ONLY. Use migration/synthetic/demo/ (371 fictional assets, seed
     englobe-ams-007). NEVER migration/staged/ — those are 1,026 real Englobe assets.
  2. NEVER create columns for ICCID (identifiervalue), phone number, or static IP. 74 synthetic
     rows carry them. Omitting the columns makes the environment structurally unable to hold that
     shape, which mirrors the AMS Sensitive field-security posture. This is deliberate; do not
     "fix" it by adding them.
  3. This is a TEST environment. Zite offers US/EU data residency only, and
     docs/14-webapp-architecture.md § 4.6 makes a Canadian region mandatory for PRODUCTION data
     and documents. Nothing here becomes production without Jay and Englobe IT/security.
  4. Do not modify app/, server/, or migration/. Read them. If you need somewhere to write,
     use a new top-level directory and say so.
  5. Checkout of a non-Available asset must be refused — in the UI and in whatever server-side
     path you build. Both layers, every time. This is CLAUDE.md's rule, and the reason the whole
     system exists.

BUILD THIS, AND ONLY THIS
  The Field slice — the smallest thing that proves the model holds on Zite:
    a. Search / lookup    — by Asset ID, serial, or model name. Min 3 characters.
    b. Asset detail       — where it is, who has it, status, next calibration due.
    c. Checkout           — pick assets, assign to a project and a person, submit.
  Deploy, recover, reports, admin, reservations and calibration are all OUT of scope. They are
  Desk and Console surfaces (docs/17 § G) and some are not specified yet.

ORDER OF WORK
  1. list_databases. If "Englobe AMS — Zite test" exists, use it; do not create a second.
  2. Create it per docs/18 § 7a if absent — five tables: Categories (hierarchical, self-linked),
     Locations (hierarchical), Projects, Equipment Models, Assets. Scalar fields first, then add
     the linked_record fields, since a self-link needs its own table id to exist.
  3. Load in dependency order: Categories -> Locations -> Projects -> Equipment Models -> Assets.
     Use bulk_create_records. Build an id map as you go; the synthetic JSON references parents by
     NAME (homeoffice: "Sudbury") and Zite linked_record fields need record ids.
  4. Verify with execute_sql before building any UI: 371 assets, 8 root categories, 18 leaf
     categories, and a status breakdown. If those numbers are wrong, stop and fix the load.
  5. THEN answer the open question below.
  6. THEN build the three screens.

ANSWER THIS EARLY — it decides whether Zite is only ever a test environment
  docs/18 § 2a establishes that Zite's record API has no transaction primitive, while CLAUDE.md
  rule 2 requires one business event to be one atomic commit. A five-asset checkout writes a
  transaction header, five lines and five asset state changes; if that can half-succeed, the
  system's core guarantee is gone.
  run_one_off_script executes TypeScript against the live database importing zitejs/db. Find out
  whether zitejs/db exposes a real transaction (BEGIN/COMMIT, or a tx callback) and whether a
  deliberately failing multi-write rolls back. Write the answer into
  docs/18-hosting-alternatives.md § 2a with the evidence. A clear negative is a valuable result —
  do not soften it.

DEFINITION OF DONE
  - The database exists, loaded from the demo profile, and execute_sql reproduces the counts above.
  - The zitejs/db transaction question is answered in docs/18 with evidence either way.
  - Search, asset detail and checkout work against real Zite data, with a checkout of a
    non-Available asset visibly refused.
  - docs/08-decisions.md records what was built and every assumption you made.
  - You have said plainly what does NOT work and what you could not verify.

DO NOT
  - Push to origin, or merge anything, without being asked.
  - Call create_sandbox without telling Jay first — the first call starts a 14-day trial.
  - Put real asset data on Zite under any circumstances.
  - Claim the atomicity question is resolved unless you actually tested a failing write.
```

---

## Why the scope is this narrow

The Field slice is Jay's own 2026-09-03 decision (`docs/08-decisions.md`): the phone carries finding,
checkout, return, transfer, fault reporting, deploy/recover and reservations, and nothing else. Search
→ detail → checkout is the front half of that, and it exercises every layer — reference lookups,
linked records, state validation and a multi-row write — without needing a screen that has not been
specified.

It also puts the atomicity question in front of the build rather than behind it. Checkout is the first
multi-row write, so if `zitejs/db` cannot hold five writes together, that surfaces on day one instead
of after twenty screens exist.
