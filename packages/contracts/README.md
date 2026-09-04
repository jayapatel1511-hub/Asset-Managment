# `@ams/contracts`

The wire contract shared by `app/` and `server/`.

Before this package existed, `server/` reached across the repository with relative paths like
`../../../app/src/api/types` — twenty-three of them. That worked, but it said something untrue about
the architecture: it made the API a dependent of the browser application, so `server/` could not be
built, typechecked or containerised without `app/` source next to it, and the CI workflow had to
check out the whole repository and explain why in a comment.

The contract is the thing both sides implement. It belongs to neither of them.

## What lives here

- **`src/stateMachine.ts`** — the transition matrix, **generated** from
  `data/reference/state_machine.json` by `app/scripts/generate-state-machine.mjs`. Never edit it by
  hand; edit the JSON. It lives here rather than in the client because `AssetStatus` is part of the
  wire contract, and constitution Principle V — "invalid transitions refused at every layer" —
  only means anything if both layers refuse the *same* transitions. The generator's output path
  moved with the file; `predev`, `prebuild` and `pretest` still run it.
- **`src/types.ts`** — every entity shape crossing the boundary.
- **`src/backend.ts`** — the `AmsBackend` interface: one method per operation the client can perform,
  implemented by `app/src/api/mock/` (deterministic tests and UI development) and by
  `app/src/api/http/` (the real API), and *served* by `server/src/routes/`.
- **`src/index.ts`** — the public surface. Import from `@ams/contracts`, never from a file inside it.

## What does not live here

Anything with a runtime dependency. No React, no Fastify, no `pg`, no zod schemas that pull a
validator into the browser bundle. If a thing cannot be imported by both a service worker and a
database service without dragging something unwanted along, it is not a contract — it is an
implementation detail of one side.

Pure domain *rules* — `deriveState`, `assetId`, `installation`, `pointInTime`, `utilisation` —
stay in `app/src/domain/` and are still imported by the server from there. They are behaviour, not
contract: two implementations do not have to agree on them, they have to *share* them. CLAUDE.md's
planned `packages/domain/` is where they belong, and moving them is a separate change with its own
risk; it is deliberately not attempted here.

So `server/` is **not yet** free of `app/`. The contract no longer lives there, which was the part
that made the API a dependent of the browser application; the shared domain rules still do.

## Compatibility

Three one-line re-export shims stay behind, so nothing else in the repository had to move:

| Shim | Re-exports |
|---|---|
| `app/src/api/types.ts` | `packages/contracts/src/types.ts` |
| `app/src/api/AmsBackend.ts` | `packages/contracts/src/backend.ts` |
| `app/src/domain/stateMachine.ts` | `packages/contracts/src/stateMachine.ts` |

No screen, hook, adapter or test changed an import path. New code should import from
`packages/contracts/src/...` directly.

## Why not `@ams/contracts`?

Because resolving that name means npm workspaces at the repository root, which means regenerating
`app/package-lock.json` and `server/package-lock.json` and rewriting both CI workflows' `npm ci`
steps — to gain a shorter import specifier. This package is type-only and installs nothing, so a
relative path costs nothing and breaks nothing. The `name` and `exports` fields are already correct
for the day a package here needs real dependencies; that is the day to do it.
