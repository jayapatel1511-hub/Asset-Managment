/**
 * The public surface of the shared contract. Import from here, never from a file inside.
 *
 * Three modules, in dependency order:
 *
 *   stateMachine  the transition matrix, GENERATED from data/reference/state_machine.json by
 *                 app/scripts/generate-state-machine.mjs. It lives here rather than in the client
 *                 because `AssetStatus` is part of the wire contract — the server's transaction
 *                 service validates against the same matrix the browser greys buttons out with,
 *                 and constitution Principle V ("invalid transitions refused at every layer")
 *                 only means anything if both layers refuse the *same* transitions.
 *   types         every entity shape crossing the boundary.
 *   backend       the AmsBackend interface: one method per operation the client can perform.
 */
export * from "./stateMachine";
export * from "./types";
export * from "./backend";
