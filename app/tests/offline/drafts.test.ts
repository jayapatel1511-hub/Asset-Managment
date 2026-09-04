/**
 * WS-W6 "draft persistence".
 *
 * The load-bearing assertion here is the negative one: a draft is never a command. It has no
 * clientSubmissionId, it survives a restart as *editing state*, and nothing in the replay path can
 * reach it — which is what keeps "pending is not accepted" true when the app is killed mid-cart.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openOfflineDb } from "../../src/offline/db";
import { DRAFT_TTL_MS, deleteDraft, listDrafts, loadDraft, saveDraft } from "../../src/offline/drafts";
import { resolvePartition } from "../../src/offline/partition";
import { openTestDb, testPartition } from "./helpers";

const cart = { lines: [{ assetId: "SEIS-INS-MIC-0001" }, { assetId: "SEIS-INS-MIC-0002" }], project: null };

describe("drafts", () => {
  it("survives the app being killed and reopened", async () => {
    const partition = testPartition("draft");
    const first = await openOfflineDb(partition);
    await saveDraft(first, partition, "Checkout", cart);
    first.close();

    const second = await openOfflineDb(partition);
    const restored = await loadDraft<typeof cart>(second, partition, "Checkout");
    expect(restored?.payload.lines).toHaveLength(2);
    second.close();
  });

  it("carries no submission identity — a draft cannot become a command by accident", async () => {
    const { db, partition } = await openTestDb();
    const row = await saveDraft(db, partition, "Checkout", cart);
    expect(Object.keys(row)).not.toContain("clientSubmissionId");
    expect(JSON.stringify(row.payload)).not.toContain("clientSubmissionId");
    db.close();
  });

  it("keeps createdAt across edits but moves updatedAt", async () => {
    const { db, partition } = await openTestDb();
    await saveDraft(db, partition, "Checkout", cart, { now: () => "2026-09-01T08:00:00.000Z" });
    const edited = await saveDraft(db, partition, "Checkout", { ...cart, project: "P-1" }, { now: () => "2026-09-01T09:00:00.000Z" });
    expect(edited.createdAt).toBe("2026-09-01T08:00:00.000Z");
    expect(edited.updatedAt).toBe("2026-09-01T09:00:00.000Z");
    db.close();
  });

  it("does not show one technician the previous technician's half-finished cart", async () => {
    const alpha = testPartition("alpha");
    const db = await openOfflineDb(alpha);
    await saveDraft(db, alpha, "Checkout", cart);

    // Same device, same database, different signed-in identity.
    const bravo = resolvePartition({ upn: "bravo@englobecorp.com", objectId: "oid-bravo" }, { tenant: alpha.tenant, environment: alpha.environment });
    await expect(loadDraft(db, bravo, "Checkout")).resolves.toBeUndefined();
    await expect(listDrafts(db, bravo)).resolves.toEqual([]);
    await expect(listDrafts(db, alpha)).resolves.toHaveLength(1);
    db.close();
  });

  it("expires a draft that is older than the fleet's memory, and deletes it as it goes", async () => {
    const { db, partition } = await openTestDb();
    await saveDraft(db, partition, "Checkout", cart, { now: () => "2026-08-01T00:00:00.000Z" });
    const later = () => new Date(Date.parse("2026-08-01T00:00:00.000Z") + DRAFT_TTL_MS + 1000).toISOString();
    await expect(loadDraft(db, partition, "Checkout", { now: later })).resolves.toBeUndefined();
    await expect(db.count("drafts")).resolves.toBe(0);
    db.close();
  });

  it("is deleted explicitly when the cart is submitted or cleared", async () => {
    const { db, partition } = await openTestDb();
    await saveDraft(db, partition, "Transfer", { assetIds: ["A"] });
    await deleteDraft(db, "Transfer");
    await expect(loadDraft(db, partition, "Transfer")).resolves.toBeUndefined();
    db.close();
  });

  it("lists several workflows, newest first", async () => {
    const { db, partition } = await openTestDb();
    await saveDraft(db, partition, "Checkout", cart, { now: () => "2026-09-01T08:00:00.000Z" });
    await saveDraft(db, partition, "Transfer", { assetIds: ["A"] }, { now: () => "2026-09-01T09:00:00.000Z" });
    const drafts = await listDrafts(db, partition);
    expect(drafts.map((d) => d.workflow)).toEqual(["Transfer", "Checkout"]);
    db.close();
  });
});
