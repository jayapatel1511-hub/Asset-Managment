/**
 * The public surface of the shared contract. Import from here, never from a file inside.
 *
 * Modules, in dependency order:
 *
 *   stateMachine  the axis transition machine, GENERATED from
 *                 specs/010-web-application-platform/contracts/transition-table.md by
 *                 app/scripts/generate-state-machine.mjs. STATE_MACHINE is a pill projection;
 *                 TRANSITION_RULES is the allow/deny authority. It lives here rather than in the client
 *                 because `AssetStatus` is part of the wire contract — the server's transaction
 *                 service validates against the same matrix the browser greys buttons out with,
 *                 and constitution Principle V ("invalid transitions refused at every layer")
 *                 only means anything if both layers refuse the *same* transitions.
 *   types         every entity shape crossing the boundary.
 *   backend       the AmsBackend interface: one method per operation the client can perform.
 *   platform      health probe and error-envelope contracts (FR-046).
 *   dataManagement feature 011 dictionary / quality / job shapes.
 */
export * from "./stateMachine";
export * from "./types";
export * from "./backend";
export * from "./platform";
export * from "./dataManagement";
