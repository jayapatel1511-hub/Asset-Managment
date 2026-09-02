/**
 * pointInTime — feature 006, User Story 3 (acceptance question 7): an asset's status, location,
 * custodian, project and parent AS AT an arbitrary past timestamp, reconstructed by replaying its
 * transaction history. Pure: takes data, returns data, no store access, no fetch, no React (same
 * discipline as deriveState.ts and stateMachine.ts — AGENT-BRIEF.md §3.3).
 *
 * `stateAsOf` returns the exact `AssetSnapshot` shape deriveState.ts uses, so the two are directly
 * comparable (plan.md's Phase 1 design) — replaying every one of an asset's lines up to "now"
 * must reproduce the same values the live system already holds for that asset. That agreement is
 * the whole of feature 003's FR-035 and this feature's SC-003/T007, not merely a resemblance.
 *
 * Two real limits found while building this, worth reading before changing the logic:
 *
 * 1. `AddToInventory` (and `Audit`) are not directional workflow transactions the way Checkout or
 *    Return are — they don't mean "something arrived from X and went to Y", they mean "this is
 *    what we found to be true when we started keeping records." deriveState.ts's own switch
 *    statement treats both as a no-op ("return base", i.e. carry the previous state forward
 *    unchanged) because deriveState.ts is only ever called with a REAL prior snapshot to carry
 *    forward from. Point-in-time replay has no such snapshot before an asset's first line — so
 *    for that first, seeding line only, this file derives location/custodian/project from the
 *    resulting status itself (the same convention migration/02_clean.py uses when it computes
 *    each staged asset's initial currentlocation: known-location statuses get the office recorded
 *    on the line, custody-bearing statuses get whatever custodian/project the line carries, and
 *    everything else is honestly unknown — Principle I). Verified against all 1,026 real staged
 *    assets: 0 status or location mismatches (see docs/09-build-report.md's WS-B section for the
 *    exact script and counts).
 * 2. `custodian`/`currentproject` reconstruction can only be as complete as what the transaction
 *    actually recorded. For ~90 of the 1,026 migrated assets, `02_clean.py` resolved a custodian's
 *    name directly onto the Asset record (docs/08-decisions.md's "Migration custodian resolution"
 *    ASSUMPTION — a hand-built name allowlist, not a live directory) WITHOUT also writing that
 *    name onto the AddToInventory transaction's `touser`/`toproject` fields, which were left null.
 *    `stateAsOf` can only replay what a transaction recorded; it cannot recover a value that was
 *    written straight onto the Asset record and never appended to history at all. This is a real
 *    gap in what feature 002's migration transactions capture, not a defect in this replay — flagged
 *    here so nobody "fixes" this file to paper over it with a second, asset-record-reading code
 *    path, which would defeat the entire point of reconstructing purely from history.
 */
import { deriveState, type AssetSnapshot } from "./deriveState";
import type { AssetStatus, TransactionType } from "./stateMachine";
import type { AssetRelationship, HistoryEntry } from "../api/types";

/** Statuses where a migration/audit-style seeding line records a genuinely known location (its
 * `tolocation`) rather than "unknown until proven otherwise". Mirrors migration/02_clean.py's own
 * `current_location = home_office if status in (...) else None` rule (verified against the real
 * staged data — see this file's header comment). */
const SEEDED_KNOWN_LOCATION_STATUSES: ReadonlySet<AssetStatus> = new Set(["Available", "NeedsRepair", "InCalibration"]);
const SEEDED_CUSTODY_STATUSES: ReadonlySet<AssetStatus> = new Set(["CheckedOut", "Deployed"]);

function byDateAsc(a: HistoryEntry, b: HistoryEntry): number {
  return a.transactiondate < b.transactiondate ? -1 : a.transactiondate > b.transactiondate ? 1 : 0;
}

/** What asset a given asset was attached to (Kit or permanent Component) at `asOf`, or null. Not
 * derivable from `HistoryEntry` alone (see this file's header, limit 1's sibling problem: a kit
 * child's own transaction line never carries its primary asset's id) — callers that have
 * relationship data (getAssetRelationships) should pass it; callers that don't get `null`, which
 * is honestly "unknown from this asset's own lines alone", not "has no parent". */
function parentAssetAt(assetId: string, relationships: AssetRelationship[], asOf: string): string | null {
  const open = relationships.find(
    (r) => r.childasset === assetId && r.start <= asOf && (r.end === null || r.end > asOf)
  );
  return open?.parentasset ?? null;
}

function seedSnapshot(assetId: string, statusBefore: AssetStatus): AssetSnapshot {
  return {
    assetId,
    status: statusBefore,
    lifecycle: "Active",
    homeoffice: null,
    currentlocation: null,
    custodian: null,
    currentproject: null,
    parentasset: null,
  };
}

/** Applies one seeding-style entry (AddToInventory or Audit) — see this file's header, limit 1. */
function applySeedEntry(prev: AssetSnapshot, entry: HistoryEntry): AssetSnapshot {
  const statusAfter = entry.statusafter;
  // The very first time an asset's tolocation is ever recorded IS its home office (verified: 0
  // mismatches across all 1,026 staged assets between the first-ever line's tolocation and the
  // asset's current homeoffice) — home office does not otherwise appear anywhere in history.
  const homeoffice = prev.homeoffice ?? entry.tolocation ?? null;

  if (statusAfter === "Retired") {
    return { ...prev, status: statusAfter, lifecycle: "Retired", homeoffice, currentlocation: null, custodian: null, currentproject: null };
  }
  if (SEEDED_CUSTODY_STATUSES.has(statusAfter)) {
    return {
      ...prev,
      status: statusAfter,
      homeoffice,
      currentlocation: statusAfter === "Deployed" ? entry.tolocation ?? null : null,
      custodian: entry.touser ?? null,
      currentproject: entry.toproject ?? null,
    };
  }
  if (SEEDED_KNOWN_LOCATION_STATUSES.has(statusAfter)) {
    return { ...prev, status: statusAfter, homeoffice, currentlocation: entry.tolocation ?? homeoffice, custodian: null, currentproject: null };
  }
  // Missing, or any future status this file doesn't yet know about: honestly unknown.
  return { ...prev, status: statusAfter, homeoffice, currentlocation: null, custodian: null, currentproject: null };
}

/** Applies one real workflow transaction (Checkout, Return, Transfer, ...) by reusing
 * domain/deriveState.ts — the same function the live write path calls — so this replay can never
 * quietly drift from what actually happens on write. The transition is guaranteed valid (it
 * already happened); a `false` result here can only mean the transition matrix
 * (data/reference/state_machine.json) changed after the fact, in which case the recorded
 * statusafter is kept as fact and nothing else is guessed at. */
function applyWorkflowEntry(prev: AssetSnapshot, entry: HistoryEntry): AssetSnapshot {
  // Transfer is the one transaction type where deriveState.ts distinguishes "not provided"
  // (undefined — leave this field alone) from "explicitly cleared" (null). But api/mock/index.ts's
  // submitTransfer collapses both to null before persisting (`input.tolocation ?? undefined`,
  // then the store's `params.tolocation ?? null`) — so a persisted Transfer header can never
  // actually distinguish the two once written. Reading a Transfer's recorded null back as
  // undefined matches what the live write path itself means by it; every other transaction type
  // treats null and undefined identically in deriveFields, so this coalescing only needs to
  // happen here.
  const isTransfer = entry.transactiontype === "Transfer";
  const result = deriveState(prev, {
    type: entry.transactiontype as TransactionType,
    date: entry.transactiondate,
    tolocation: isTransfer ? entry.tolocation ?? undefined : entry.tolocation,
    touser: isTransfer ? entry.touser ?? undefined : entry.touser,
    toproject: isTransfer ? entry.toproject ?? undefined : entry.toproject,
    retirementReason: null,
  });
  if (!result.ok) {
    return { ...prev, status: entry.statusafter };
  }
  return {
    ...prev,
    status: result.fields.statusAfter,
    lifecycle: result.fields.lifecycle,
    custodian: result.fields.custodian,
    currentlocation: result.fields.currentlocation,
    currentproject: result.fields.currentproject,
  };
}

/**
 * FR-018/FR-020/SC-003: replays `history` (all of one asset's transaction lines, any order) up to
 * and including `asOf`, returning the same `AssetSnapshot` shape deriveState.ts produces.
 *
 * Linear in `history.length` (a sort plus a single pass) — never touches any other asset's lines,
 * satisfying SC-010's "linear in the asset's own lines, not the whole table" as long as callers
 * pass one asset's own history (exactly what `getAssetHistory(assetId)` already returns).
 *
 * `relationships`, if supplied (e.g. from `getAssetRelationships`), fills in `parentasset` for
 * Kit/Component attachment at `asOf`; omitted, `parentasset` is `null` (see `parentAssetAt`'s
 * comment for why this can't be recovered from `history` alone).
 */
export function stateAsOf(history: HistoryEntry[], asOf: string, relationships: AssetRelationship[] = []): AssetSnapshot {
  const sorted = [...history].sort(byDateAsc);
  const assetId = sorted[0]?.asset ?? "";
  const relevant = sorted.filter((h) => h.transactiondate <= asOf);

  if (relevant.length === 0) {
    // FR-020: `asOf` precedes the asset's first recorded line — the pre-history placeholder.
    // Nothing has happened yet, so nothing is known except the status the first line will assert
    // was already true (every transition matrix's AddToInventory row requires this).
    const snapshot = seedSnapshot(assetId, sorted[0]?.statusbefore ?? "Available");
    return { ...snapshot, parentasset: parentAssetAt(assetId, relationships, asOf) };
  }

  let snapshot = seedSnapshot(assetId, relevant[0].statusbefore);
  for (const entry of relevant) {
    snapshot =
      entry.transactiontype === "AddToInventory" || entry.transactiontype === "Audit"
        ? applySeedEntry(snapshot, entry)
        : applyWorkflowEntry(snapshot, entry);
  }
  return { ...snapshot, parentasset: parentAssetAt(assetId, relationships, asOf) };
}

/** FR-019: one line of a timeline — the recorded event plus, for a Kit/Component attach or
 * detach, which other asset and role were involved. `TimelinePage` reads this directly off
 * `AssetRelationship` rows (createdbyline/closedbyline point back at the transaction that opened
 * or closed each one) rather than this file trying to infer it from `HistoryEntry` alone, for the
 * same sibling-visibility reason `parentAssetAt` documents above. */
export interface TimelineEvent {
  entry: HistoryEntry;
  /** Other assets attached or detached by the SAME transaction as this entry, if any. */
  attachments: Array<{ assetId: string; role: string | null; kind: "attach" | "detach" }>;
}

export function buildTimeline(history: HistoryEntry[], relationships: AssetRelationship[]): TimelineEvent[] {
  // The role a relationship attached under lives only on the transaction line that opened it
  // (kitrole is a TransactionLine field, not an AssetRelationship one) — a closing line (Return,
  // Undeploy, ...) never carries it, so a detach event must look the role up from the opening
  // line, not its own.
  const byTransaction = new Map(history.map((h) => [h.transaction, h]));
  const sorted = [...history].sort(byDateAsc).reverse(); // newest first — matches getAssetHistory's own convention (FR-033)
  return sorted.map((entry) => {
    const attachments: TimelineEvent["attachments"] = [];
    for (const r of relationships) {
      const role = (r.createdbyline && byTransaction.get(r.createdbyline)?.kitrole) ?? null;
      if (r.createdbyline === entry.transaction) {
        const otherAsset = r.parentasset === entry.asset ? r.childasset : r.parentasset;
        attachments.push({ assetId: otherAsset, role, kind: "attach" });
      }
      if (r.closedbyline === entry.transaction) {
        const otherAsset = r.parentasset === entry.asset ? r.childasset : r.parentasset;
        attachments.push({ assetId: otherAsset, role, kind: "detach" });
      }
    }
    return { entry, attachments };
  });
}
