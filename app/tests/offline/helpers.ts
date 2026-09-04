/**
 * Shared fixtures for the WS-W6 offline tests.
 *
 * Not a `.test.ts`, so vitest's `include` glob does not collect it.
 *
 * Every test opens its own partition (a unique objectId) so that the databases `fake-indexeddb`
 * creates cannot bleed between tests within a file. That is the same discipline
 * tests/api/queue.test.ts applies to its localStorage keys, and for the same reason: a shared
 * durable store is the one thing that makes a passing suite lie.
 */
import type { CheckoutInput, SubmissionOutcome, TransferInput } from "../../src/api/AmsBackend";
import type { Asset } from "../../src/api/types";
import type { SubmissionTransport } from "../../src/api/queue/types";
import { openOfflineDb, type OfflineDb } from "../../src/offline/db";
import { resolvePartition, type CachePartition } from "../../src/offline/partition";

let counter = 0;

/** A fresh, isolated partition. */
export function testPartition(label = "user"): CachePartition {
  counter += 1;
  return resolvePartition({ upn: `${label}${counter}@englobecorp.com`, objectId: `oid-${label}-${counter}` }, { tenant: "englobe.test", environment: "test" });
}

export async function openTestDb(partition: CachePartition = testPartition()): Promise<{ db: OfflineDb; partition: CachePartition }> {
  const db = await openOfflineDb(partition);
  return { db, partition };
}

/** An `Asset` carrying every restricted attribute populated, so a projection test proves the
 * narrowing actually drops them rather than merely happening to receive nulls. */
export function assetWithSecrets(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "0000-guid",
    assetid: "SEIS-INS-MIC-0001",
    equipmentmodel: { manufacturer: "Instantel", model: "Micromate", equipmenttype: "Data Logger" },
    serialnumber: "UM12345",
    homeoffice: "Ottawa",
    lifecycle: "Active",
    status: "Available",
    currentlocation: "Ottawa Warehouse",
    custodian: null,
    currentproject: null,
    parentasset: null,
    lastcaldate: "2026-01-15",
    nextcaldue: "2027-01-15",
    retirementreason: null,
    notes: "Do not cache this free text",
    carrier: "Rogers",
    identifiervalue: "8912230000000123456",
    phonenumber: "+1-613-555-0142",
    staticip: "10.20.30.40",
    ...overrides,
  } as Asset;
}

export function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    lines: [{ assetId: "SEIS-INS-MIC-0001" }],
    project: "P-2026-014",
    clientSubmissionId: "sub-0001",
    ...overrides,
  };
}

export function transferInput(overrides: Partial<TransferInput> = {}): TransferInput {
  return {
    assetIds: ["SEIS-INS-MIC-0001"],
    reason: "Site handover",
    clientSubmissionId: "sub-transfer-0001",
    ...overrides,
  };
}

export const accepted: SubmissionOutcome = { ok: true, transactionId: "t-1", transactionName: "TRX-0001" };

export interface RecordingTransport extends SubmissionTransport {
  readonly calls: Array<{ kind: string; clientSubmissionId: string }>;
}

/**
 * A transport driven by a queue of scripted responses. `"network"` throws (indistinguishable from
 * offline), `"auth"` throws the shape api/http/index.ts produces for a 401, an outcome resolves.
 */
export function scriptedTransport(script: Array<SubmissionOutcome | "network" | "auth">): RecordingTransport {
  const calls: Array<{ kind: string; clientSubmissionId: string }> = [];
  let index = 0;

  const next = (kind: string, clientSubmissionId: string): Promise<SubmissionOutcome> => {
    calls.push({ kind, clientSubmissionId });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (step === "network") return Promise.reject(new Error("Failed to fetch"));
    if (step === "auth") return Promise.reject(new Error("POST /api/commands/Checkout failed: 401 Unauthorized"));
    return Promise.resolve(step ?? accepted);
  };

  return {
    calls,
    submitCheckout: (input) => next("Checkout", input.clientSubmissionId),
    submitReturn: (input) => next("Return", input.clientSubmissionId),
    submitTransfer: (input) => next("Transfer", input.clientSubmissionId),
  };
}
