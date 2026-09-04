/**
 * Reading and writing the approved projections — WS-W6's "asset/reference cache projections",
 * and the thing that makes an airplane-mode cold start show something other than a spinner.
 *
 * Everything here goes through projections.ts: `toAssetProjection` narrows, `assertCacheSafe`
 * refuses. This file adds only the storage and the offline query.
 *
 * WHY THERE IS AN OFFLINE SEARCH AT ALL:
 *   WS-W6's required device tests include "offline search". Online search is a server query
 *   (`GET /api/assets?query=`); offline it has to be answered locally or the phone slice's first
 *   step — find the asset — has no offline story, and every later step depends on it. The match
 *   rules deliberately mirror api/mock/index.ts's `matchesQuery` (asset ID, serial, model name) so
 *   a technician does not get different results depending on connectivity — minus the ICCID
 *   branch, because the ICCID is not cached and never will be (rule 10).
 *
 * SIZE: the cache is capped at CACHE_LIMIT rows and trimmed oldest-first. A full 5,000-asset fleet
 * at roughly 300 bytes a projection is ~1.5 MB, comfortably inside any device budget, but an
 * unbounded cache is how a device ends up evicted — and eviction is the failure mode this whole
 * layer exists to survive. A bound we chose beats a bound the browser chooses for us.
 */
import { STORE, type OfflineDb } from "./db";
import { partitionKey, type CachePartition } from "./partition";
import { assertCacheSafe, toAssetProjection, type AssetProjection, type ProjectionKind, type ProjectionRow } from "./projections";
import type { Asset } from "../api/types";

/** Roughly a 5,000-asset fleet plus headroom (REMAINING-WORK.md's load target). */
export const CACHE_LIMIT = 6000;

export interface CacheWriteOptions {
  readonly now?: () => string;
  readonly limit?: number;
}

function rowFor<T>(kind: ProjectionKind, id: string, partition: CachePartition, value: T, now: () => string): ProjectionRow<T> {
  return { kind, id, partition: partitionKey(partition), cachedAt: now(), value };
}

/** Replace the cached asset projections for this partition. Atomic per batch (db.putAll). */
export async function cacheAssets(
  db: OfflineDb,
  partition: CachePartition,
  assets: readonly Asset[],
  options: CacheWriteOptions = {},
): Promise<number> {
  const now = options.now ?? (() => new Date().toISOString());
  const limit = options.limit ?? CACHE_LIMIT;

  const rows = assets.slice(0, limit).map((asset) => {
    const projection = toAssetProjection(asset);
    // Both halves matter: the narrowing above decides what we meant to store, this decides what
    // we are actually allowed to store. See projections.ts's header.
    assertCacheSafe(projection, `asset[${asset.assetid}]`);
    return rowFor("asset", projection.assetid, partition, projection, now);
  });

  await db.putAll(STORE.PROJECTIONS, rows);
  await trimProjections(db, limit);
  return rows.length;
}

/** Cache a reference-data projection (location, project, equipment model). Values are curated
 * reference records (rule 7), so they are stored as given — after the same safety assertion. */
export async function cacheReference<T extends Record<string, unknown>>(
  db: OfflineDb,
  partition: CachePartition,
  kind: Exclude<ProjectionKind, "asset">,
  entries: ReadonlyArray<{ id: string; value: T }>,
  options: CacheWriteOptions = {},
): Promise<number> {
  const now = options.now ?? (() => new Date().toISOString());
  const rows = entries.map(({ id, value }) => {
    assertCacheSafe(value, `${kind}[${id}]`);
    return rowFor(kind, id, partition, value, now);
  });
  await db.putAll(STORE.PROJECTIONS, rows);
  return rows.length;
}

export async function getCachedAsset(db: OfflineDb, assetId: string): Promise<AssetProjection | undefined> {
  const row = await db.get<ProjectionRow<AssetProjection>>(STORE.PROJECTIONS, ["asset", assetId]);
  return row?.value;
}

export async function listCachedAssets(db: OfflineDb): Promise<AssetProjection[]> {
  const rows = await db.getAllFromIndex<ProjectionRow<AssetProjection>>(STORE.PROJECTIONS, "by-kind", "asset");
  return rows.map((row) => row.value);
}

export async function listCachedReference<T>(db: OfflineDb, kind: Exclude<ProjectionKind, "asset">): Promise<T[]> {
  const rows = await db.getAllFromIndex<ProjectionRow<T>>(STORE.PROJECTIONS, "by-kind", kind);
  return rows.map((row) => row.value);
}

/**
 * Offline asset search. Mirrors api/mock/index.ts's `matchesQuery` minus its ICCID branch, which
 * has nothing to match against here by design.
 */
export function matchesCachedAsset(projection: AssetProjection, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (projection.assetid.toLowerCase().includes(needle)) return true;
  if (projection.serialnumber?.toLowerCase().includes(needle)) return true;
  return `${projection.manufacturer} ${projection.model}`.toLowerCase().includes(needle);
}

export async function searchCachedAssets(db: OfflineDb, query: string, limit = 50): Promise<AssetProjection[]> {
  if (!query.trim()) return [];
  const all = await listCachedAssets(db);
  return all.filter((projection) => matchesCachedAsset(projection, query)).slice(0, limit);
}

/** How stale the cache is, for the "last synced" line the UI should show rather than implying the
 * cached view is live. */
export async function cacheAgeMs(db: OfflineDb, nowMs = Date.now()): Promise<number | null> {
  const rows = await db.getAllFromIndex<ProjectionRow>(STORE.PROJECTIONS, "by-kind", "asset");
  if (rows.length === 0) return null;
  let newest = 0;
  for (const row of rows) newest = Math.max(newest, Date.parse(row.cachedAt) || 0);
  return newest === 0 ? null : nowMs - newest;
}

/** Drop the oldest projections once the cache exceeds `limit`. Commands and drafts are never
 * touched — a technician's queued work is not cache. */
async function trimProjections(db: OfflineDb, limit: number): Promise<void> {
  const total = await db.count(STORE.PROJECTIONS);
  if (total <= limit) return;
  const rows = await db.getAll<ProjectionRow>(STORE.PROJECTIONS);
  rows.sort((a, b) => (a.cachedAt < b.cachedAt ? -1 : a.cachedAt > b.cachedAt ? 1 : 0));
  const excess = rows.slice(0, total - limit);
  await db.deleteAll(
    STORE.PROJECTIONS,
    excess.map((row) => [row.kind, row.id]),
  );
}

/**
 * Wipe cached projections. Used on sign-out and on a partition change — the *data* goes, queued
 * commands and drafts stay, because those belong to the person who made them and are recovered by
 * queueStore.ts under the right identity, not discarded because a session ended.
 */
export async function clearProjections(db: OfflineDb): Promise<void> {
  await db.clear(STORE.PROJECTIONS);
}
