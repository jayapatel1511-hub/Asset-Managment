# Englobe AMS — specification and working prototype

## Current status

> **Functional specification and mock prototype complete; production architecture approval pending.**

The local app, migration pipeline, domain logic and mock-backed user journeys are valuable evidence,
but they are not proof of tenant transaction integrity, production authorization, report security,
hosted scanning or offline behavior.

Before creating the production schema or approving an Ottawa pilot, read
[`docs/13-production-readiness-review.md`](docs/13-production-readiness-review.md) and complete
[`specs/009-production-readiness/`](specs/009-production-readiness/).

## Read order

1. [`CLAUDE.md`](CLAUDE.md) — operating rules, stack and commands
2. [`.specify/memory/constitution.md`](.specify/memory/constitution.md) — non-negotiable principles
3. [`docs/13-production-readiness-review.md`](docs/13-production-readiness-review.md) — production blockers and approval gates
4. [`specs/README.md`](specs/README.md) — feature index and acceptance-question traceability
5. [`specs/009-production-readiness/spec.md`](specs/009-production-readiness/spec.md) — cross-cutting production requirements
6. [`docs/06-delivery-plan.md`](docs/06-delivery-plan.md) — revised execution order
7. [`docs/09-build-report.md`](docs/09-build-report.md) — what the local implementation actually proved

## Repository map

```text
CLAUDE.md                              project rules, stack, commands
.specify/memory/constitution.md        governing principles
docs/00-brief.md                       problem, goals, acceptance tests, scope
docs/01-data-model.md                  current draft schema and state model
docs/02-app.md                         Code App screens, validation, offline target
docs/03-automation.md                  current flow design; subject to production-integrity gate
docs/04-migration.md                   column map, dedupe rules, load order, acceptance
docs/05-security.md                    environments, roles, field security, groups
docs/06-delivery-plan.md               ordered implementation and approval gates
docs/07-open-questions.md              product questions requiring Jay
docs/08-decisions.md                   decision log
docs/09-build-report.md                measured local/mock implementation evidence
docs/10-integration.md                 Microsoft 365 integration surface
docs/12-ui-spec.md                     design-system and screen specification
docs/13-production-readiness-review.md architecture review and mandatory gates
specs/001-* ... 008-*                  existing feature specifications
specs/009-production-readiness/        atomicity, tenant, security, device and cutover proof
data/source/                            frozen registry and calibration exports
data/reference/                         curated mappings and state-machine inputs
migration/                              repeatable cleaning, staging and reporting pipeline
app/                                    React/TypeScript Code App and mock backend
solution/                               flow and Power BI source artefacts
```

## Do not do yet

Do not create the production Dataverse schema directly from `docs/01-data-model.md`. The production
review requires an approved canonical schema, an authoritative atomic multi-asset command, server-side
Asset ID allocation, corrected state semantics and the permanent-component calibration decision first.

## Suggested next implementation task

> Read the constitution, `docs/13-production-readiness-review.md`, and feature 009. Design and prove one
> authoritative five-asset checkout operation against a development Dataverse environment: server-side
> revalidation, concurrency arbitration, idempotency, immutable history, derived-state updates and full
> rollback on a deliberate mid-operation exception. Do not add more screens until that proof passes.
