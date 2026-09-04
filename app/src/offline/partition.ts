/**
 * The offline cache partition key — WS-W6's first rule, and CLAUDE.md's offline non-negotiable
 * "Partition IndexedDB by tenant + environment + user object ID".
 *
 * WHY ALL THREE, and why this file is the only place that decides:
 *
 *   tenant       Two Entra tenants must never share a cache. Nothing else in the client knows
 *                which tenant it is talking to, so a bug elsewhere cannot widen the partition.
 *   environment  Dev, UAT and Prod are three different fleets with three different sets of real
 *                serial numbers. A technician who opens UAT on a phone that has Prod cached must
 *                see UAT, and a synthetic UAT asset must never be able to answer a Prod lookup
 *                (CLAUDE.md rule 12 is about loads, but the same reasoning applies to a cache
 *                that outlives the tab).
 *   object ID    NOT the UPN. Entra's objectId is the stable identity key (BUILD-FREEZE.md's
 *                app_user.object_id); a UPN is renameable, so partitioning by it would silently
 *                merge two people's queues the day someone changes their name. This is also what
 *                makes "no replay under another identity" enforceable: a command is stamped with
 *                the objectId that queued it, and replay.ts refuses to send it under any other.
 *
 * A-TENANT (specs/_planning/BUILD-FREEZE.md) fixes the local values: tenant `englobe.local`,
 * environment from `import.meta.env.MODE`, object ID from `/api/me`. This file is the named
 * reversal point in that table — when Entra lands, `DEFAULT_TENANT` becomes the real tenant ID
 * and `resolveObjectId` stops needing its fallback, and nothing else changes.
 */

/** A-TENANT: the local stand-in for an Entra tenant ID. */
export const DEFAULT_TENANT = "englobe.local";

/** IndexedDB database-name prefix. Everything this feature stores lives under it. */
export const DB_NAME_PREFIX = "ams-offline";

export interface CachePartition {
  /** Entra tenant ID in production; `englobe.local` until then (A-TENANT). */
  readonly tenant: string;
  /** Vite mode — `development`, `localapi`, `release`, `test`, … */
  readonly environment: string;
  /** Entra objectId of the signed-in user. Never a UPN, never a display name. */
  readonly objectId: string;
}

/**
 * The subset of `CurrentUser` this module needs. Declared structurally rather than imported so
 * `packages/contracts` can add `objectId` (BUILD-FREEZE.md's frozen `CurrentUser`) without this
 * file having to change, and so a test can pass a two-field literal.
 */
export interface PartitionIdentity {
  readonly upn: string;
  readonly objectId?: string | null;
}

const SEPARATOR = "|";

/**
 * Partition components end up in an IndexedDB *database name*, which is an arbitrary string —
 * so nothing stops `tenant = "a|b"` colliding with `tenant = "a", environment = "b"`. Percent
 * encoding the separator removes the ambiguity rather than documenting it away.
 */
function encodeComponent(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`CachePartition: ${name} must not be empty — refusing to open a shared cache.`);
  }
  return encodeURIComponent(trimmed);
}

/**
 * Deterministic, collision-resistant stand-in for an objectId when the API has not supplied one.
 *
 * This exists because `CurrentUser.objectId` is optional in the frozen contract and the mock
 * backend's DEMO_USERS carry no objectId at all — so without it the whole offline layer would be
 * unusable against the mock, which is where the UI is developed. It is deliberately NOT a hash
 * that could be confused for a real objectId: the `upn:` prefix makes every partition name say
 * out loud which identity source it came from, so a cache written under the fallback can never be
 * silently read as if it had been written under a real Entra identity.
 */
export function fallbackObjectId(upn: string): string {
  const normalised = upn.trim().toLowerCase();
  if (!normalised) throw new Error("CachePartition: cannot derive an object ID from an empty UPN.");
  return `upn:${normalised}`;
}

/** The object ID a partition should use for this identity — real one if present, fallback if not. */
export function resolveObjectId(identity: PartitionIdentity): string {
  const objectId = identity.objectId?.trim();
  return objectId ? objectId : fallbackObjectId(identity.upn);
}

export interface ResolvePartitionOptions {
  readonly tenant?: string;
  readonly environment?: string;
}

/** Build the partition for a signed-in identity. The only supported way to construct one. */
export function resolvePartition(identity: PartitionIdentity, options: ResolvePartitionOptions = {}): CachePartition {
  return {
    tenant: (options.tenant ?? DEFAULT_TENANT).trim(),
    // `import.meta.env.MODE` is always defined under Vite and under Vitest; the `?? "unknown"`
    // covers a plain-Node import (a script, a codemod) rather than papering over a real gap.
    environment: (options.environment ?? import.meta.env?.MODE ?? "unknown").trim(),
    objectId: resolveObjectId(identity),
  };
}

/** Stable string form. Used as a row-level partition stamp and as the DB-name suffix. */
export function partitionKey(partition: CachePartition): string {
  return [
    encodeComponent("tenant", partition.tenant),
    encodeComponent("environment", partition.environment),
    encodeComponent("objectId", partition.objectId),
  ].join(SEPARATOR);
}

/** IndexedDB database name for a partition. Two partitions never share a database. */
export function databaseNameFor(partition: CachePartition): string {
  return `${DB_NAME_PREFIX}${SEPARATOR}${partitionKey(partition)}`;
}

/** True when two partitions are the same cache. Compared on the encoded key, not field-by-field. */
export function samePartition(a: CachePartition, b: CachePartition): boolean {
  return partitionKey(a) === partitionKey(b);
}

/**
 * Every `ams-offline|…` database currently on this device, whether or not it belongs to the
 * signed-in user. `indexedDB.databases()` is unavailable on Firefox and on Safari before 14, so
 * the caller gets `null` — meaning "cannot tell", which is different from "none" and must not be
 * treated as a licence to assume the device is clean.
 */
export async function listPartitionDatabases(factory: IDBFactory = indexedDB): Promise<string[] | null> {
  const withDatabases = factory as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (typeof withDatabases.databases !== "function") return null;
  const all = await withDatabases.databases();
  return all.map((d) => d.name ?? "").filter((n) => n.startsWith(`${DB_NAME_PREFIX}${SEPARATOR}`));
}
