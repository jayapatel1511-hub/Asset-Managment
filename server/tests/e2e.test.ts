/**
 * End-to-end proof over a real network socket.
 *
 * Every other suite in this directory drives the API with `app.inject()`, which is fast and
 * exercises the same hooks, validation and error handler — but it never opens a socket, never
 * serialises a body over the wire, and never proves that the process a developer actually starts
 * with `npm run start` answers anything. This file does: it calls `app.listen()` on an ephemeral
 * port over an isolated PostgreSQL database and then talks to it with `fetch`, exactly as
 * `app/src/api/http/index.ts` does from the browser.
 *
 * What it is for is the *chain*. The other suites each prove one command in depth — the five-asset
 * race, the 100-way registration burst, field-level security. None of them walks a single asset
 * from registration through checkout, transfer, fault, repair, calibration, deployment and
 * recovery and then asks whether the history and the current state still agree. That walk is the
 * thing that breaks when two individually-correct commands disagree about a derived value, and it
 * is the thing a user does on their first day.
 *
 * Covers, in one continuous run:
 *   - the HTTP surface `app/src/api/http/index.ts` binds to, over a socket;
 *   - features 001 (register, checkout, return), 003 (transfer, fault, repair, offline retry),
 *     004 (calibration) and 005 (deploy, recover);
 *   - CLAUDE.md rule 3 — the same submission ID replayed returns the original result, and the
 *     same ID with a *different* body is refused;
 *   - CLAUDE.md rule 5 — history is append-only and reconciles with derived current state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, createContext } from "../src/app";
import { DATASET_DIR } from "../src/config";
import type { Database } from "../src/db/database";
import { openTestDatabase } from "../src/db/open";
import { seedIfNeeded } from "../src/db/seed";
import type { Asset, HistoryEntry } from "../../app/src/api/types";
import type { SubmissionOutcome } from "../../app/src/api/AmsBackend";

let app: FastifyInstance;
let db: Database;
let base: string;

/** Port 0 — the kernel picks a free one, so parallel test files never fight over a number. */
beforeAll(async () => {
  db = await openTestDatabase();
  const seed = await seedIfNeeded(db, DATASET_DIR);
  app = await buildApp(createContext(db, seed.dataset), { logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  await app?.close();
  await db?.close();
});

type DevUser = "field" | "admin" | "owner";

async function api<T>(path: string, as: DevUser = "field"): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: { "x-ams-dev-user": as } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Returns the parsed outcome and the status. A refusal is `{ ok: false }` at HTTP 200 — a
 * business answer, not a failure (see routes/commands.ts's header). */
async function send(
  path: string,
  body: unknown,
  as: DevUser = "field"
): Promise<SubmissionOutcome & { status: number }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ams-dev-user": as },
    body: JSON.stringify(body),
  });
  return { ...((await res.json()) as SubmissionOutcome), status: res.status };
}

let n = 0;
const sid = (label: string) => `e2e-${label}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

describe("end to end over a real socket", () => {
  it("serves health and identity", async () => {
    const health = await api<{ ok: boolean; dataset: unknown }>("/api/health");
    expect(health.ok).toBe(true);

    const me = await api<{ upn: string; roles: string[] }>("/api/me", "admin");
    expect(me.upn).toBe("admin@englobecorp.com");
    expect(me.roles).toContain("OfficeAdmin");
  });

  it("walks one asset through its whole working life and keeps history and state agreeing", async () => {
    // ---- register ------------------------------------------------------------------
    // A model that already exists in the reference data, so the ID prefix resolves.
    const models = await api<Array<{ manufacturer: string; model: string; equipmenttype: string; isserialised: boolean }>>(
      "/api/equipment-models"
    );
    const model = models.find((m) => m.isserialised) ?? models[0];

    const serial = `E2E-${Date.now().toString(36).toUpperCase()}`;
    const registered = await send(
      "/api/assets",
      {
        manufacturer: model.manufacturer,
        model: model.model,
        equipmenttype: model.equipmenttype,
        serial,
        homeoffice: "Ottawa",
        clientSubmissionId: sid("register"),
      },
      "admin"
    );
    expect(registered.status).toBe(200);
    expect(registered.ok, `register refused: ${JSON.stringify(registered)}`).toBe(true);

    const created = await api<Asset[]>(`/api/assets?query=${encodeURIComponent(serial)}`, "admin");
    expect(created.length).toBe(1);
    const id = created[0].assetid;

    // The server minted the canonical ID — the browser never proposed one (rule 1, rule 6).
    expect(id).toBeTruthy();
    expect(created[0].serialnumber).toBe(serial);

    // ---- check out -----------------------------------------------------------------
    const projects = await api<Array<{ projectnumber: string; status: string }>>("/api/projects");
    const project = (projects.find((p) => p.status === "Active") ?? projects[0]).projectnumber;

    const checkoutId = sid("checkout");
    const checkoutBody = {
      lines: [{ assetId: id }],
      project,
      notes: "e2e walk",
      clientSubmissionId: checkoutId,
    };
    const out = await send("/api/commands/Checkout", checkoutBody);
    expect(out.ok, `checkout refused: ${JSON.stringify(out)}`).toBe(true);

    // ---- rule 3: the accepted response is lost, the client retries -------------------
    const replay = await send("/api/commands/Checkout", checkoutBody);
    // Narrowed with an assertion rather than an `&&` chain: `SubmissionOutcome` is a discriminated
    // union, and only a statement-level check teaches TypeScript that `transactionId` exists on
    // both sides below. A chained expression would compile away the narrowing and hide a real
    // mistake behind an `any`.
    if (!out.ok || !replay.ok) throw new Error(`expected both accepted: ${JSON.stringify({ out, replay })}`);
    // The original result, not a second checkout.
    expect(replay.transactionId).toBe(out.transactionId);
    expect(replay.transactionName).toBe(out.transactionName);

    // ---- rule 3: the same key with a different body is refused -----------------------
    const conflicting = await send("/api/commands/Checkout", {
      ...checkoutBody,
      notes: "a different request under the same key",
    });
    expect(conflicting.ok).toBe(false);

    // Exactly one checkout reached history despite three requests.
    const afterCheckout = await api<HistoryEntry[]>(`/api/assets/${encodeURIComponent(id)}/history`);
    expect(afterCheckout.filter((h) => h.transactiontype === "Checkout").length).toBe(1);

    // ---- transfer ------------------------------------------------------------------
    const transferred = await send("/api/commands/Transfer", {
      assetIds: [id],
      touser: "tech@englobecorp.com",
      reason: "e2e handover",
      clientSubmissionId: sid("transfer"),
    });
    expect(transferred.ok, `transfer refused: ${JSON.stringify(transferred)}`).toBe(true);

    // ---- return ---------------------------------------------------------------------
    // Order matters and is not arbitrary: data/reference/state_machine.json allows Return only
    // from CheckedOut or Deployed, so it comes before the fault, not after it. Asserting the
    // walk in an order the state machine forbids would be testing this file's imagination.
    const returned = await send("/api/commands/Return", {
      lines: [{ assetId: id, condition: "Good" }],
      clientSubmissionId: sid("return"),
    });
    expect(returned.ok, `return refused: ${JSON.stringify(returned)}`).toBe(true);

    // ---- fault, then repair ---------------------------------------------------------
    const fault = await send("/api/commands/ReportFault", {
      assetId: id,
      notes: "e2e induced fault",
      clientSubmissionId: sid("fault"),
    });
    expect(fault.ok, `fault refused: ${JSON.stringify(fault)}`).toBe(true);

    // Rule 9: lifecycle, disposition and serviceability are separate axes. Reporting a fault
    // moves serviceability and nothing else — it does not retire the asset or erase where it is.
    const faulted = await api<Asset>(`/api/assets/${encodeURIComponent(id)}`, "admin");
    expect(faulted.status).toBe("NeedsRepair");
    expect(faulted.lifecycle).toBe("Active");
    expect(faulted.currentlocation).toBeTruthy();

    const repaired = await send(
      "/api/commands/RepairComplete",
      { assetId: id, clientSubmissionId: sid("repair") },
      "admin"
    );
    expect(repaired.ok, `repair refused: ${JSON.stringify(repaired)}`).toBe(true);

    // ---- calibration ----------------------------------------------------------------
    const calibrated = await send(
      "/api/calibrations",
      {
        assetId: id,
        calibrationdate: "2026-09-01",
        lab: "E2E Lab",
        certificatenumber: `CERT-${serial}`,
        result: "Pass",
        clientSubmissionId: sid("calibration"),
      },
      "admin"
    );
    expect(calibrated.ok, `calibration refused: ${JSON.stringify(calibrated)}`).toBe(true);

    const certs = await api<Array<{ certificatenumber: string | null }>>(
      `/api/assets/${encodeURIComponent(id)}/calibrations`,
      "admin"
    );
    expect(certs.some((c) => c.certificatenumber === `CERT-${serial}`)).toBe(true);

    // Rule 9 again: calibration currency is a separate axis. Recording one sets the due date
    // without discarding who holds the asset.
    const afterCal = await api<Asset>(`/api/assets/${encodeURIComponent(id)}`, "admin");
    expect(afterCal.lastcaldate).toBeTruthy();
    expect(afterCal.nextcaldue).toBeTruthy();
    // Recording a calibration is not a lifecycle transition: the asset is still exactly where
    // the repair left it (rule 9).
    expect(afterCal.status).toBe("Available");

    // ---- rule 5: history is append-only and reconciles with current state -------------
    const history = await api<HistoryEntry[]>(`/api/assets/${encodeURIComponent(id)}/history`);
    const types = history.map((h) => h.transactiontype);
    for (const expected of ["Checkout", "Transfer", "Return", "ReportFault", "RepairComplete"]) {
      expect(types, `missing ${expected} in ${JSON.stringify(types)}`).toContain(expected);
    }

    // Each line's statusbefore must equal the previous line's statusafter: an unbroken chain.
    // Oldest first — the read model returns newest first for display.
    const chain = [...history].reverse();
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i].statusbefore, `gap between line ${i - 1} and ${i}`).toBe(chain[i - 1].statusafter);
    }

    // And the last accepted line's statusafter is the asset's current status.
    const final = await api<Asset>(`/api/assets/${encodeURIComponent(id)}`, "admin");
    expect(final.status).toBe(chain[chain.length - 1].statusafter);
  }, 60_000);

  it("deploys a logger to a site and recovers it, leaving a dated installation record", async () => {
    // A data logger already in stock, chosen from the seeded fleet rather than fabricated, so
    // this exercises the same reference data the screens do.
    // "Available" and "DataLogger" are the vocabulary the seeded data and
    // data/reference/state_machine.json actually use — feature 005 FR-009 requires the primary
    // asset of an installation to be a data logger.
    const candidates = await api<Asset[]>("/api/assets?status=Available&equipmenttype=DataLogger", "admin");
    const logger = candidates[0];
    if (!logger) {
      // The staged dataset has 375 available assets including loggers; if a future dataset does
      // not, say so rather than silently passing a test that asserted nothing.
      throw new Error("no available DataLogger in the seeded dataset to deploy");
    }

    const projects = await api<Array<{ projectnumber: string; status: string }>>("/api/projects");
    const project = (projects.find((p) => p.status === "Active") ?? projects[0]).projectnumber;
    const site = `E2E Site ${Date.now().toString(36)}`;

    const deployed = await send(
      "/api/deployments",
      {
        project,
        primaryAssetId: logger.assetid,
        components: [],
        site,
        locationtype: "Site",
        sitename: site,
        powersource: "Battery",
        deploymentDate: "2026-09-01T12:00:00.000Z",
        clientSubmissionId: sid("deploy"),
      },
      "admin"
    );
    expect(deployed.ok, `deploy refused: ${JSON.stringify(deployed)}`).toBe(true);

    const installations = await api<Array<{ id: string; end: string | null }>>(
      `/api/assets/${encodeURIComponent(logger.assetid)}/installations`,
      "admin"
    );
    const open = installations.find((i) => i.end === null);
    expect(open, "expected an open installation after deploy").toBeTruthy();

    const recovered = await send(
      "/api/recoveries",
      {
        installationId: open!.id,
        components: [{ assetId: logger.assetid, disposition: "Recovered", condition: "Good" }],
        recoveryDate: "2026-09-02T12:00:00.000Z",
        clientSubmissionId: sid("recover"),
      },
      "admin"
    );
    expect(recovered.ok, `recovery refused: ${JSON.stringify(recovered)}`).toBe(true);

    // The installation is closed, not deleted — the dated record survives recovery, which is the
    // whole reason installation is a table rather than a current-only field.
    const after = await api<Array<{ id: string; end: string | null }>>(
      `/api/assets/${encodeURIComponent(logger.assetid)}/installations`,
      "admin"
    );
    const closed = after.find((i) => i.id === open!.id);
    expect(closed, "the installation row disappeared after recovery").toBeTruthy();
    expect(closed!.end).not.toBeNull();
  }, 60_000);

  it("shows a migrated component attachment on the asset timeline (regression: WS-W9 finding)", async () => {
    // The six component relationships in `migration/staged/assetrelationships.json` used to store
    // a transaction LINE id in `createdbyline`, while every consumer — pointInTime.ts, the mock
    // store, transactionService and v_asset_timeline — compares that column against a
    // TRANSACTION id. The comparison could therefore never match, so not one migrated attachment
    // appeared in any timeline, in the UI or the API or the view. Nothing failed; the events were
    // simply absent, which is why it survived until the reporting lane reconciled the view against
    // the domain module.
    //
    // `migration/04_load.py` now writes the transaction id. This asserts the consequence rather
    // than the column, so it fails again if the two ever drift apart.
    const timeline = await api<{ data: { events: Array<{ attachments?: Array<{ assetId: string; kind: string }> }> } }>(
      "/api/reports/asset-timeline/DST-LD-01",
      "owner"
    );
    const attachments = timeline.data.events.flatMap((e) => e.attachments ?? []);
    expect(
      attachments.some((a) => a.kind === "attach"),
      `DST-LD-01's timeline carried no attach event: ${JSON.stringify(attachments)}`
    ).toBe(true);
  });

  it("refuses an unknown command by name rather than guessing", async () => {
    const res = await fetch(`${base}/api/commands/DefinitelyNotACommand`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ams-dev-user": "admin" },
      body: JSON.stringify({ clientSubmissionId: sid("unknown") }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_command");
  });

  it("keeps restricted SIM and network fields out of a Field User's payload over the wire", async () => {
    // fieldSecurity.test.ts proves this through inject(); this proves the same bytes never leave
    // the socket, which is the claim that actually matters (rule 10).
    const assets = await api<Asset[]>("/api/assets?assetgroup=Communications", "field");
    const sample = assets.slice(0, 25);
    expect(sample.length).toBeGreaterThan(0);
    for (const a of sample) {
      expect(a.identifiervalue ?? null).toBeNull();
      expect(a.phonenumber ?? null).toBeNull();
      expect(a.staticip ?? null).toBeNull();
    }
  });
});
