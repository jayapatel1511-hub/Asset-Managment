# Englobe AMS — handover package for Claude Code

Start with `CLAUDE.md`, then `docs/00-brief.md` and `docs/01-data-model.md`.
Answer `docs/07-open-questions.md` Q1–Q4 before any schema or migration work.

```
CLAUDE.md                     project rules, stack, commands
docs/00-brief.md              problem, goals, acceptance tests, scope
docs/01-data-model.md         10 tables, columns, choice sets, state machine, ID minting
docs/02-app.md                Code App screens, validation, offline, structure
docs/03-automation.md         7 Power Automate flows, F1 in detail
docs/04-migration.md          column map, dedupe rules, load order, acceptance
docs/05-security.md           environments, roles, field security, groups
docs/06-delivery-plan.md      steps with definitions of done
docs/07-open-questions.md     things only Jay can answer
docs/08-decisions.md          decision log
docs/09-build-report.md       what was built, verified counts, what is stubbed
docs/10-integration.md        hosting, client support, publish safety
docs/12-ui-spec.md            screen inventory, tokens, components, copy, 23 design gaps
docs/17-ux-audit.md           2026-09-03 audit: what is static and must not be, admin console gaps
docs/18-hosting-alternatives  Zite assessment. NOTE: numbers 13-16 are reserved by origin/pivot/azure-webapp
data/source/                  registry + calibration exports, 2026-09-02 (Login/Password columns removed)
data/reference/               locations.csv, equipment_models_draft.csv (needs cleanup), state_machine.json, office_admins.csv
```
Suggested first prompt to Claude Code:

> Read CLAUDE.md and docs/. Run migration/01_profile.py's job: profile data/source/registry_2026-09-02.csv and confirm the counts in docs/00-brief.md. Then propose the cleaned data/reference/equipment_models.csv for my review, flagging every row where you changed manufacturer/model/type. Do not create any Dataverse objects yet.
