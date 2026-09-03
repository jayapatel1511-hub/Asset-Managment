/**
 * Feature 003 write commands over HTTP, against the real migrated data.
 *
 * Fixtures are real Asset IDs from migration/staged/, chosen because of what they ARE, not
 * invented: DL-MP-12708 / GEO-SE-12716 are Available at Ottawa; AT-001 is one of the 648
 * CheckedOut assets; SLM-LD-PA-1712.0 is a permanent Component of the sound-level meter
 * DST-LD-01 (one of the 6 Q5 component links in assetrelationships.json).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Asset, HistoryEntry } from "../../app/src/api/types";
import { createTestApp, get, getJson, newSubmissionId, post, submit, type TestApp } from "./helpers";

let t: TestApp;

const LOGGER = "DL-MP-12708"; // Available, Ottawa, DataLogger
const GEOPHONE = "GEO-SE-12716"; // Available, Ottawa, Geophone
const SPARE = "GEO-SE-12717"; // Available, Ottawa
const SPARE2 = "GEO-SE-13076";
const SPARE3 = "GEO-SE-13077";
const SPARE4 = "GEO-SE-13113";
const CHECKED_OUT = "AT-001"; // CheckedOut, no custodian (the Q3 sweep set)
const COMPONENT_CHILD = "SLM-LD-PA-1712.0"; // permanent Component of DST-LD-01
const COMPONENT_PARENT = "DST-LD-01";
const ACTIVE_PROJECT = "01937805"; // Vale M-Dam Vibration Monitoring

beforeAll(async () => {
  t = await createTestApp();
  // The migrated data has no Closed project (every one of the 25 is Active), so the
  // inactive-project rule needs a fixture. Added to the test database only.
  await t.db.query(
    "INSERT INTO project (id, projectnumber, name, status, office, pm) VALUES ($1,$2,$3,'Closed',NULL,NULL)",
    ["test-closed-project", "09999999", "Closed test project"]
  );
}, 60_000);

afterAll(async () => {
  await t?.close();
});

function asset(assetId: string): Promise<Asset> {
  return getJson<Asset>(t.app, `/api/assets/${assetId}`, "admin");
}

function history(assetId: string): Promise<HistoryEntry[]> {
  return getJson<HistoryEntry[]>(t.app, `/api/assets/${assetId}/history`, "admin");
}

describe("checkout", () => {
  it("checks out a kit and derives status, custodian, project and an unknown location", async () => {
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: LOGGER }, { assetId: GEOPHONE, kitRole: "Sensor1" }],
      primaryAssetId: LOGGER,
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("checkout"),
    });
    expect(outcome.status).toBe(200);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transactionName).toMatch(/^TXN-\d{6}$/);

    const primary = await asset(LOGGER);
    expect(primary.status).toBe("CheckedOut");
    expect(primary.custodian).toBe("tech@englobecorp.com");
    expect(primary.currentproject).toBe(ACTIVE_PROJECT);
    // Principle I honesty: it has left the office, so its location is unknown, not "Ottawa".
    expect(primary.currentlocation).toBeNull();

    // The kit relationship the Checkout opened makes the sensor a child of the logger.
    const child = await asset(GEOPHONE);
    expect(child.parentasset).toBe(LOGGER);

    const lines = await history(LOGGER);
    expect(lines.map((l) => l.transactiontype)).toEqual(["Checkout", "AddToInventory"]); // newest first
    expect(lines[0].statusbefore).toBe("Available");
    expect(lines[0].statusafter).toBe("CheckedOut");
  });

  it("returns the kit, clearing custody and the kit relationship", async () => {
    const outcome = await submit(t.app, "/api/commands/Return", {
      lines: [{ assetId: LOGGER }, { assetId: GEOPHONE }],
      clientSubmissionId: newSubmissionId("return"),
    });
    expect(outcome.ok).toBe(true);

    const primary = await asset(LOGGER);
    expect(primary.status).toBe("Available");
    expect(primary.custodian).toBeNull();
    expect(primary.currentproject).toBeNull();
    expect(primary.currentlocation).toBe("Ottawa"); // FR-010 — the returning user's office

    const child = await asset(GEOPHONE);
    expect(child.parentasset).toBeNull();

    const lines = await history(LOGGER);
    expect(lines.map((l) => l.transactiontype)).toEqual(["Return", "Checkout", "AddToInventory"]);
  });

  it("refuses a checkout of an already CheckedOut asset and names it", async () => {
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE }, { assetId: CHECKED_OUT }],
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("checkout-conflict"),
    });
    expect(outcome.status).toBe(200); // a refusal is an answer, not a transport failure
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.offendingAssetId).toBe(CHECKED_OUT);
    expect(outcome.reason).toContain("not a valid transition from CheckedOut");

    // FR-003 atomicity: the other, valid asset in the same cart was not checked out either.
    expect((await asset(SPARE)).status).toBe("Available");
  });

  it("refuses a checkout of a permanent Component child on its own", async () => {
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: COMPONENT_CHILD }],
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("checkout-component"),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.offendingAssetId).toBe(COMPONENT_CHILD);
    expect(outcome.reason).toContain("permanent component");
  });

  it("refuses a checkout against an inactive project", async () => {
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE }],
      project: "09999999",
      clientSubmissionId: newSubmissionId("checkout-closed"),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("is Closed, not Active");
    expect((await asset(SPARE)).status).toBe("Available");
  });

  it("requires a project (FR-008)", async () => {
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE }],
      project: "",
      clientSubmissionId: newSubmissionId("checkout-noproject"),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("A project is required to check equipment out.");
  });
});

describe("idempotency (FR-007)", () => {
  it("returns the original success and writes nothing on a replay", async () => {
    const clientSubmissionId = newSubmissionId("replay");
    const body = { lines: [{ assetId: SPARE2 }], project: ACTIVE_PROJECT, clientSubmissionId };

    const first = await submit(t.app, "/api/commands/Checkout", body);
    expect(first.ok).toBe(true);
    const linesAfterFirst = (await history(SPARE2)).length;

    const replay = await submit(t.app, "/api/commands/Checkout", body);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.transactionName).toBe(first.transactionName);
    expect((await history(SPARE2)).length).toBe(linesAfterFirst);

    const stored = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM command_idempotency WHERE client_submission_id = $1",
      [clientSubmissionId]
    );
    expect(stored.rows[0].c).toBe(1);
  });

  it("does not record a refusal, so a corrected retry can succeed under the same key", async () => {
    const clientSubmissionId = newSubmissionId("refused-then-fixed");
    const refused = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE3 }],
      project: "09999999",
      clientSubmissionId,
    });
    expect(refused.ok).toBe(false);

    const fixed = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE3 }],
      project: ACTIVE_PROJECT,
      clientSubmissionId,
    });
    expect(fixed.ok).toBe(true);
  });
});

describe("transfer, fault, missing, repair, retire", () => {
  it("requires a reason to transfer (FR-009)", async () => {
    const outcome = await submit(t.app, "/api/commands/Transfer", {
      assetIds: [SPARE4],
      tolocation: "Toronto",
      reason: "",
      clientSubmissionId: newSubmissionId("transfer-noreason"),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("A reason is required to transfer equipment.");
  });

  it("transfers an available asset to another office", async () => {
    const outcome = await submit(t.app, "/api/commands/Transfer", {
      assetIds: [SPARE4],
      tolocation: "Toronto",
      reason: "Rebalancing the geophone pool",
      clientSubmissionId: newSubmissionId("transfer"),
    });
    expect(outcome.ok).toBe(true);
    const moved = await asset(SPARE4);
    expect(moved.status).toBe("Available");
    expect(moved.currentlocation).toBe("Toronto");
    expect(moved.homeoffice).toBe("Ottawa"); // home office is not a derived field and never moves
  });

  it("walks an asset through fault → repair and missing → found", async () => {
    const faulted = await submit(t.app, "/api/commands/ReportFault", {
      assetId: SPARE4,
      notes: "Cable connector cracked",
      clientSubmissionId: newSubmissionId("fault"),
    });
    expect(faulted.ok).toBe(true);
    expect((await asset(SPARE4)).status).toBe("NeedsRepair");

    const repaired = await submit(t.app, "/api/commands/RepairComplete", {
      assetId: SPARE4,
      clientSubmissionId: newSubmissionId("repair"),
    });
    expect(repaired.ok).toBe(true);
    expect((await asset(SPARE4)).status).toBe("Available");

    const missing = await submit(t.app, "/api/commands/MarkMissing", {
      assetId: SPARE4,
      notes: "Not on the truck",
      clientSubmissionId: newSubmissionId("missing"),
    });
    expect(missing.ok).toBe(true);
    expect((await asset(SPARE4)).status).toBe("Missing");

    const found = await submit(t.app, "/api/commands/Found", {
      assetId: SPARE4,
      clientSubmissionId: newSubmissionId("found"),
    });
    expect(found.ok).toBe(true);
    expect((await asset(SPARE4)).status).toBe("Available");
  });

  it("refuses a retirement with no reason, and one outside the choice list (FR-024)", async () => {
    const blank = await submit(t.app, "/api/commands/Retire", {
      assetId: SPARE4,
      reason: "",
      clientSubmissionId: newSubmissionId("retire-blank"),
    });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.reason).toBe("A retirement reason is required.");

    const freeText = await submit(t.app, "/api/commands/Retire", {
      assetId: SPARE4,
      reason: "fell in the lake",
      clientSubmissionId: newSubmissionId("retire-freetext"),
    });
    expect(freeText.ok).toBe(false);
    if (!freeText.ok) expect(freeText.reason).toContain("is not a retirement reason");
  });

  it("retires an asset, clearing its location and marking the lifecycle", async () => {
    const outcome = await submit(t.app, "/api/commands/Retire", {
      assetId: SPARE4,
      reason: "Obsolete",
      clientSubmissionId: newSubmissionId("retire"),
    });
    expect(outcome.ok).toBe(true);
    const retired = await asset(SPARE4);
    expect(retired.status).toBe("Retired");
    expect(retired.lifecycle).toBe("Retired");
    expect(retired.currentlocation).toBeNull();
    expect(retired.retirementreason).toBe("Obsolete");

    // Retired is terminal: the matrix allows only Audit, so a further Checkout is refused.
    const after = await submit(t.app, "/api/commands/Checkout", {
      lines: [{ assetId: SPARE4 }],
      project: ACTIVE_PROJECT,
      clientSubmissionId: newSubmissionId("checkout-retired"),
    });
    expect(after.ok).toBe(false);
  });
});

describe("permanent Component children (F1 step 5)", () => {
  it("mirrors the parent's derived state onto the child without giving it a line", async () => {
    const childBefore = await history(COMPONENT_CHILD);
    expect(childBefore).toHaveLength(1); // its migration line only

    const outcome = await submit(
      t.app,
      "/api/commands/Return",
      { lines: [{ assetId: COMPONENT_PARENT }], clientSubmissionId: newSubmissionId("return-parent") },
      "admin" // the parent has no custodian, so FR-025 needs an administrator
    );
    expect(outcome.ok).toBe(true);

    const parent = await asset(COMPONENT_PARENT);
    const child = await asset(COMPONENT_CHILD);
    expect(parent.status).toBe("Available");
    expect(child.status).toBe("Available");
    expect(child.currentlocation).toBe(parent.currentlocation);
    expect(child.custodian).toBe(parent.custodian);
    // Still one line: the parent's line IS the child's history.
    expect(await history(COMPONENT_CHILD)).toHaveLength(1);
    // And the permanent relationship survived — parentasset is recomputed from open rows, so a
    // kit close never drops a Component parent.
    expect(child.parentasset).toBe(COMPONENT_PARENT);
  });
});

describe("FR-025 — who may return an asset", () => {
  it("refuses a Field User returning an asset held by someone else", async () => {
    const outcome = await submit(
      t.app,
      "/api/commands/Return",
      { lines: [{ assetId: "DL-UM-16984" }], clientSubmissionId: newSubmissionId("return-other") },
      "field"
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.offendingAssetId).toBe("DL-UM-16984");
    expect(outcome.reason).toContain("held by someone else");
  });
});

describe("the transport contract", () => {
  it("rejects a malformed body with 400, not a refusal", async () => {
    const res = await post(t.app, "/api/commands/Checkout", { lines: "not an array", project: 7 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("rejects an unknown command name with 400", async () => {
    const res = await post(t.app, "/api/commands/Teleport", { clientSubmissionId: "x" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("unknown_command");
  });

  it("answers 404 for an asset that does not exist", async () => {
    const res = await get(t.app, "/api/assets/NOPE-0000");
    expect(res.statusCode).toBe(404);
  });
});

describe("Principle II — history is append-only in the database itself", () => {
  it("refuses an UPDATE on a transaction line", async () => {
    await expect(t.db.query("UPDATE asset_transaction_line SET notes = 'tampered'")).rejects.toThrow(
      /append-only/
    );
  });

  it("refuses a DELETE on a transaction header", async () => {
    await expect(t.db.query("DELETE FROM asset_transaction")).rejects.toThrow(/append-only/);
  });
});
