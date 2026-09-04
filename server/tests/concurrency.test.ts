/**
 * WS-W4's first proof — the five-asset race, the fault-injection rollback, the idempotency
 * retries, the lock ordering and the 100-concurrent-registration proof, run against a real
 * networked PostgreSQL server (docker-compose.yml, `postgres:17.11-alpine` on 127.0.0.1:5433).
 *
 * WHY THIS FILE EXISTS. Until 2026-09-03 `server/` ran on PGlite, which is single-connection, so
 * `db.transaction()` serialised the entire command path for free. `server/README.md`'s own words
 * for the `SELECT … FOR UPDATE` ordering and the `ON CONFLICT … RETURNING` sequence increment
 * were that they were "documenting intent". The existing 64 tests were written for that
 * serialised database and never attempt an overlap: they prove the transport, not the races.
 * This file is the exercise that finds out whether the guarantees actually hold.
 *
 * Requirements proved here (see specs/REMAINING-WORK.md § WS-W4, and the acceptance contracts
 * specs/009-production-readiness/contracts/five-asset-race.md and …/registration-concurrency.md):
 *
 *   S1  five valid assets commit completely ............................. holds (outbox clause
 *       unprovable: no outbox table)
 *   S2  an invalid fifth asset writes nothing ........................... holds, incl. the
 *       contract's 100-deliberate-failure batch
 *   S3  an exception after the third material step rolls back everything  holds
 *   S4  two users race for an overlapping asset and exactly one wins .... holds, incl. the
 *       contract's 100-concurrent-race batch
 *   S5  an accepted response is lost and the retry returns the original result — holds for a
 *       SEQUENTIAL retry (100 of them, plus 25 simultaneous replays of an ALREADY-ACCEPTED
 *       command); does NOT hold for a genuinely simultaneous FIRST duplicate — findings F2/F3
 *   S6  the same idempotency key with a different payload is refused .... DOES NOT HOLD —
 *       finding F1
 *   S7  reversed input order does not deadlock .......................... holds
 *   S8  browser-supplied before/after state cannot alter the result ..... holds
 *   S9  accepted headers and lines cannot be edited normally ............ holds
 *   R   100 concurrent registrations mint 100 unique canonical IDs, and the browser never
 *       reserves the sequence ........................................... holds (alias clause
 *       unprovable: no alias table)
 *
 * FINDINGS — implemented behaviour that contradicts a requirement. Each is asserted in place,
 * against the requirement rather than against the code, and none of them is fixed here:
 * `transactionService.ts` is not this file's to change, and CLAUDE.md rule 13 makes the
 * specification the thing that wins, so the tests below say what the specification says.
 *
 *   F1  same key + DIFFERENT payload returns the original outcome and logs a warning. CLAUDE.md
 *       rule 3, WS-W4 item 6 and the frozen R2 contract all say REFUSE
 *       (`command.error.idempotencyPayloadMismatch`). CORRECTED 2026-09-03 — now asserted, not pinned.
 *   F2  the idempotency check is read-then-insert, not the contract's claim-then-process, so two
 *       copies of the same submission that are in flight together BOTH run the command. One
 *       commits; the other is refused rather than answered from the store.
 *       CORRECTED 2026-09-03 by claiming the idempotency key first — now asserted, not pinned.
 *   F3  the same race on a self-permitting transition (Transfer, legal from CheckedOut to
 *       CheckedOut) reaches `command_idempotency`'s primary key and returns HTTP 500. The
 *       database still prevents a duplicate business event, and a later retry is answered
 *       correctly, so this is an availability defect, not a data one.
 *
 * HOW OVERLAP IS PROVED, not assumed. `app.inject()` is in-process, so "concurrent" is a claim
 * that has to be demonstrated. Three independent mechanisms do it, all in
 * tests/concurrencyHelpers.ts and none of them touching a file outside tests/:
 *
 *   - a dedicated observer connection reads `pg_stat_activity` while requests are in flight and
 *     reports how many backends are inside a transaction and how many are blocked on a lock;
 *   - a row-lock barrier holds `FOR UPDATE` on the contested rows so racers provably stall at the
 *     same point before the race is started;
 *   - negative controls run the SAME harness against the UNPROTECTED version of each mechanism
 *     (a read-then-write with no `FOR UPDATE`; a read-then-increment on `id_sequence` instead of
 *     one `ON CONFLICT` statement) and demonstrate it losing the update / issuing duplicates. If
 *     the harness could not produce a race, the controls would pass too — and they do not.
 *
 * SCOPE, stated up front so nothing here is over-read. This is a proof about LOCKING, ATOMICITY
 * and IDEMPOTENCY against the schema that exists — `server/src/db/schema.sql`, which its own
 * header now calls a compatibility schema: one `status` column driven by
 * `data/reference/state_machine.json`, not the four-axis lifecycle / disposition / serviceability
 * / derived-calibration-currency model approved as R1 on 2026-09-03. The mechanism proved here
 * survives that change; the eligibility rule it protects does not, because
 * `010/contracts/transaction-command.md` defers checkout's central precondition to a transition
 * table that does not yet exist in the repository. So: "exactly one contender wins the row" is
 * settled below. "Which contenders were eligible in the first place" is not, and is not this
 * file's to settle. Anything that needs the canonical schema — an outbox table, an asset-alias
 * table, three state columns on a line — is marked in place with an assertion that FAILS the day
 * the schema catches up, rather than being silently skipped.
 *
 * DRIVERS. Everything that needs two connections is `it.skipIf(!IS_POSTGRES)`, resolved from
 * AMS_DB at collection time. On `AMS_DB=pglite` those tests report as SKIPPED, not as passes:
 * a single-connection driver cannot exhibit the race, and a green tick there would be evidence
 * of nothing — which is worse than no test. Everything that does not need a second connection
 * (S1, S2, S3, the S5 replays, S6, S8, S9 and the registration preview) runs on both drivers.
 */

// Concurrency needs more than one client, and the default pool is 10. Set before the module's
// `createTestApp()` runs, and only when the caller has not chosen a size themselves. The
// container is configured with max_connections=200.
if (!process.env.AMS_DB_POOL_MAX) process.env.AMS_DB_POOL_MAX = "25";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SubmissionOutcome } from "../../app/src/api/AmsBackend";
import { resolveDriver } from "../src/db/database";
import { createTestApp, get, newSubmissionId, post, submit, type TestApp } from "./helpers";
import {
  FAULT_MARKER,
  Observer,
  injectLineFault,
  latch,
  removeLineFault,
} from "./concurrencyHelpers";

let t: TestApp;
let observer: Observer | null = null;
let available: string[] = [];
let cursor = 0;

const ACTIVE_PROJECT = "01937805"; // Vale M-Dam Vibration Monitoring — Active in the staged data
const FIELD_UPN = "tech@englobecorp.com";
const ADMIN_UPN = "admin@englobecorp.com";
const AIRTAG = { manufacturer: "Apple", model: "AirTag", equipmenttype: "AssetTracker" }; // non-serialised, prefix AT

/** Hands out assets no other test in this file has touched, so one scenario can never explain
 * another's result. Drawn from the real migrated dataset, not fixtures. */
function take(n: number): string[] {
  const slice = available.slice(cursor, cursor + n);
  if (slice.length < n) throw new Error(`Test pool exhausted: wanted ${n}, ${available.length - cursor} left.`);
  cursor += n;
  return slice;
}

/** Resolved from AMS_DB at collection time, before `beforeAll` opens anything, so the
 * postgres-only proofs below report as SKIPPED on pglite rather than as vacuous passes. */
const IS_POSTGRES = resolveDriver() === "postgres";
/** The observer exists whenever the driver is postgres; this turns that into a checked fact. */
function obs(): Observer {
  if (!observer) throw new Error("The observer connection is postgres-only and was not opened.");
  return observer;
}

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.db.query<{ assetid: string }>(
    `SELECT a.assetid
       FROM asset a
      WHERE a.status = 'Available' AND a.lifecycle = 'Active'
        AND NOT EXISTS (SELECT 1 FROM asset_relationship r
                         WHERE r.childasset = a.assetid AND r.end_at IS NULL
                           AND r.relationshiptype = 'Component')
      ORDER BY a.assetid`
  );
  available = res.rows.map((r) => r.assetid);
  if (t.db.driver === "postgres") observer = await Observer.open(t.db);
}, 120_000);

afterAll(async () => {
  await observer?.close();
  await t?.close();
});

// ---------------------------------------------------------------- shared queries

async function headersFor(clientSubmissionId: string): Promise<Array<{ id: string; name: string; performedby: string }>> {
  const res = await t.db.query<{ id: string; name: string; performedby: string }>(
    "SELECT id, name, performedby FROM asset_transaction WHERE client_submission_id = $1",
    [clientSubmissionId]
  );
  return res.rows;
}

async function linesOf(transactionId: string) {
  const res = await t.db.query<{
    asset: string;
    statusbefore: string;
    statusafter: string;
    line_number: number;
  }>(
    "SELECT asset, statusbefore, statusafter, line_number FROM asset_transaction_line WHERE transaction_id = $1 ORDER BY line_number",
    [transactionId]
  );
  return res.rows;
}

async function assetRow(assetId: string) {
  const res = await t.db.query<{
    assetid: string;
    status: string;
    disposition: string;
    custodian: string | null;
    currentlocation: string | null;
    currentproject: string | null;
    row_version: number;
  }>(
    "SELECT assetid, status, disposition, custodian, currentlocation, currentproject, row_version FROM asset WHERE assetid = $1",
    [assetId]
  );
  return res.rows[0];
}

/**
 * Every mutable column of the named assets, for a before/after comparison.
 *
 * Asserting "the custodian is null" would have been wrong: 27 of the 375 Available assets in
 * migration/staged/ carry a stale custodian name from the legacy export (a data-quality matter
 * for feature 011, not for the command path). "Nothing changed" is both the property these
 * scenarios actually require and a stricter check, because it covers every column at once.
 */
async function snapshot(assetIds: string[]) {
  const res = await t.db.query<Record<string, unknown>>(
    `SELECT assetid, status, custodian, currentlocation, currentproject, parentasset, retirementreason, row_version
       FROM asset WHERE assetid = ANY($1) ORDER BY assetid`,
    [assetIds]
  );
  return res.rows;
}

async function counts(): Promise<{ headers: number; lines: number; idempotency: number }> {
  const res = await t.db.query<{ headers: number; lines: number; idem: number }>(
    `SELECT (SELECT count(*)::int FROM asset_transaction)      AS headers,
            (SELECT count(*)::int FROM asset_transaction_line) AS lines,
            (SELECT count(*)::int FROM command_idempotency)    AS idem`
  );
  const r = res.rows[0];
  return { headers: Number(r.headers), lines: Number(r.lines), idempotency: Number(r.idem) };
}

async function idempotencyRow(clientSubmissionId: string) {
  const res = await t.db.query<{ client_submission_id: string; request_hash: string; response: SubmissionOutcome }>(
    "SELECT client_submission_id, request_hash, response FROM command_idempotency WHERE client_submission_id = $1",
    [clientSubmissionId]
  );
  return res.rows[0];
}

function checkoutBody(assetIds: string[], clientSubmissionId: string, extra: Record<string, unknown> = {}) {
  return {
    lines: assetIds.map((assetId) => ({ assetId })),
    project: ACTIVE_PROJECT,
    clientSubmissionId,
    ...extra,
  };
}

// ================================================================ S1

describe("S1 — five valid assets commit completely", () => {
  const id = newSubmissionId("s1");
  let assets: string[] = [];

  it("commits one header, five immutable lines and five server-derived asset states", async () => {
    assets = take(5);
    const before = await counts();

    const outcome = await submit(t.app, "/api/commands/Checkout", checkoutBody(assets, id));
    expect(outcome.status).toBe(200);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transactionName).toMatch(/^TXN-\d{6}$/);

    const headers = await headersFor(id);
    expect(headers).toHaveLength(1);
    expect(headers[0].performedby).toBe(FIELD_UPN);

    const lines = await linesOf(headers[0].id);
    expect(lines.map((l) => l.asset)).toEqual(assets); // one line per asset, in the submitted order
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3, 4, 5]);
    expect(lines.every((l) => l.statusbefore === "Available" && l.statusafter === "CheckedOut")).toBe(true);

    for (const a of assets) {
      const row = await assetRow(a);
      expect(row.status).toBe("CheckedOut");
      expect(row.custodian).toBe(FIELD_UPN);
      expect(row.currentproject).toBe(ACTIVE_PROJECT);
      expect(row.currentlocation).toBeNull(); // Principle I: it has left, so location is unknown
    }

    const after = await counts();
    expect(after.headers - before.headers).toBe(1);
    expect(after.lines - before.lines).toBe(5);
    expect(after.idempotency - before.idempotency).toBe(1);
  });

  /**
   * BLOCKED, not skipped. five-asset-race.md S1 also requires "outbox row(s) committed in the
   * same database transaction", and transaction-command.md invariant 6 requires outbox rows to
   * exist only inside the accepting commit. The compatibility schema has no outbox table at all
   * (WS-W2 deliverable "outbox and audit tables", not implemented), so that clause of S1 is
   * unprovable here. This assertion is the tripwire: it FAILS the day an outbox table lands,
   * which is the day this proof must be extended rather than re-read as complete.
   */
  it("S1 outbox clause is BLOCKED on the schema — no outbox table exists to commit into", async () => {
    const res = await t.db.query<{ t: string | null }>("SELECT to_regclass('public.outbox') AS t");
    expect(res.rows[0].t).toBeNull();
  });
});

// ================================================================ S2

describe("S2 — an invalid fifth asset writes nothing", () => {
  it("refuses the whole command and leaves the four valid assets untouched", async () => {
    const valid = take(4);
    const checkedOut = (
      await t.db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE status = 'CheckedOut' ORDER BY assetid LIMIT 1")
    ).rows[0].assetid;

    const before = await counts();
    const assetsBefore = await snapshot(valid);
    const id = newSubmissionId("s2");

    // The illegal line is LAST, so four legal lines are validated before it is reached.
    const outcome = await submit(t.app, "/api/commands/Checkout", checkoutBody([...valid, checkedOut], id));
    expect(outcome.status).toBe(200); // a refusal is an answer, not a transport failure
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Checkout is not a valid transition from CheckedOut/);
    expect(outcome.offendingAssetId).toBe(checkedOut);

    expect(await headersFor(id)).toHaveLength(0);
    expect(await idempotencyRow(id)).toBeUndefined(); // refusals are re-evaluated, never replayed
    expect(await counts()).toEqual(before);
    expect(await snapshot(valid)).toEqual(assetsBefore); // not one column of the four moved
  });

  /**
   * five-asset-race.md batch target SC-001: "100 deliberate multi-asset failure tests, ZERO
   * partials". The same four valid assets are reused every round on purpose — if any round
   * leaked a partial write they would stop being Available and every later round would fail for
   * a different reason, so the four survivors at the end are themselves part of the evidence.
   */
  it("BATCH: 100 deliberate multi-asset failures leave zero partial writes", async () => {
    const valid = take(4);
    const checkedOut = (
      await t.db.query<{ assetid: string }>("SELECT assetid FROM asset WHERE status = 'CheckedOut' ORDER BY assetid LIMIT 1")
    ).rows[0].assetid;
    const before = await counts();
    const assetsBefore = await snapshot(valid);

    for (let i = 0; i < 100; i += 1) {
      const outcome = await submit(
        t.app,
        "/api/commands/Checkout",
        checkoutBody([...valid, checkedOut], newSubmissionId(`s2batch-${i}`))
      );
      expect(outcome.ok, `round ${i}: ${JSON.stringify(outcome)}`).toBe(false);
    }

    expect(await counts()).toEqual(before);
    expect(await snapshot(valid)).toEqual(assetsBefore); // zero partials across 100 failures
  }, 120_000);

  it("refuses an unknown fifth asset the same way", async () => {
    const valid = take(4);
    const before = await counts();
    const id = newSubmissionId("s2b");
    const outcome = await submit(t.app, "/api/commands/Checkout", checkoutBody([...valid, "NO-SUCH-ASSET-0001"], id));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/Unknown asset NO-SUCH-ASSET-0001/);
    expect(await counts()).toEqual(before);
    expect((await assetRow(valid[0])).status).toBe("Available");
  });
});

// ================================================================ S3

describe("S3 — an exception after the third material step rolls back everything", () => {
  it("leaves no header, no lines, no derived state and no idempotency claim", async () => {
    const assets = take(5);
    const id = newSubmissionId("s3");
    const body = checkoutBody(assets, id);
    const before = await counts();
    const assetsBefore = await snapshot(assets);

    // Fires AFTER the third line insert: header + lines 1-3 + asset updates 1-2 are already
    // written inside the open transaction when it raises. There is genuinely something to lose.
    await injectLineFault(t.db, 3);
    try {
      const res = await post(t.app, "/api/commands/Checkout", body);
      expect(res.statusCode).toBe(500); // a real fault, not a refusal — the queue should retry it
      expect(res.json().message).toContain(FAULT_MARKER);
      // Line 3 specifically: the trigger is AFTER INSERT, so by the time it raised, the header,
      // three lines and the first two derived asset updates were all already written inside the
      // open transaction. That is what makes the rollback assertions below non-trivial.
      expect(res.json().message).toMatch(/while writing line 3/);
    } finally {
      await removeLineFault(t.db);
    }

    expect(await headersFor(id)).toHaveLength(0);
    expect(await idempotencyRow(id)).toBeUndefined();
    expect(await counts()).toEqual(before);
    // Including assets 1 and 2, whose derived columns and row_version HAD already been written
    // inside the transaction when the fault fired.
    expect(await snapshot(assets)).toEqual(assetsBefore);

    // And because the failed attempt claimed no idempotency row, the offline queue's retry of the
    // very same submission is free to succeed — contract step 8, "bounded retry".
    const retry = await submit(t.app, "/api/commands/Checkout", body);
    expect(retry.ok).toBe(true);
    expect(await headersFor(id)).toHaveLength(1);
    expect((await linesOf((await headersFor(id))[0].id))).toHaveLength(5);
  }, 60_000);
});

// ================================================================ S4

describe("S4 — two users race for an overlapping asset and exactly one wins", () => {
  /**
   * The negative control, and the reason to believe anything below. It runs the UNPROTECTED
   * pattern — read the status, decide, write — through the same harness, with a latch that makes
   * both transactions finish reading before either writes. Both see Available, both write, and
   * the asset is double-booked. This is what `SELECT … FOR UPDATE` is preventing; if the harness
   * could not produce a race, this test would pass and it does not.
   */
  it.skipIf(!IS_POSTGRES)("CONTROL: without FOR UPDATE, two transactions both see Available and both write", async () => {
    const [contested] = take(1);
    const original = await assetRow(contested);
    const l = latch(2);

    const attempt = (tag: string) =>
      t.db.transaction(async (tx) => {
        const r = await tx.query<{ status: string }>("SELECT status FROM asset WHERE assetid = $1", [contested]);
        const seen = r.rows[0].status;
        l.arrive();
        await l.all; // both reads are now complete; neither has written
        if (seen !== "Available") return { wrote: false, seen };
        await tx.query("UPDATE asset SET disposition = 'CheckedOut', custodian = $2 WHERE assetid = $1", [contested, tag]);
        return { wrote: true, seen };
      });

    const [a, b] = await Promise.all([attempt("racer-a"), attempt("racer-b")]);
    expect(a.seen).toBe("Available");
    expect(b.seen).toBe("Available");
    expect([a.wrote, b.wrote]).toEqual([true, true]); // DOUBLE BOOKED — the bug the lock prevents

    await t.db.query("UPDATE asset SET disposition = $2, custodian = $3 WHERE assetid = $1", [
      contested,
      original.disposition,
      original.custodian,
    ]);
  });

  it.skipIf(!IS_POSTGRES)("CONTROL: with FOR UPDATE, the second transaction blocks and then sees the committed truth", async () => {
    const [contested] = take(1);
    const original = await assetRow(contested);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = t.db.transaction(async (tx) => {
      await tx.query("SELECT status FROM asset WHERE assetid = $1 FOR UPDATE", [contested]);
      await gate;
      await tx.query("UPDATE asset SET disposition = 'CheckedOut', custodian = 'racer-a' WHERE assetid = $1", [contested]);
    });
    // Give the first transaction its lock before the second one asks for it.
    await new Promise((r) => setTimeout(r, 50));
    let secondSaw = "";
    const second = t.db.transaction(async (tx) => {
      const r = await tx.query<{ status: string }>("SELECT status FROM asset WHERE assetid = $1 FOR UPDATE", [contested]);
      secondSaw = r.rows[0].status;
    });

    // MEASURED, not assumed: the second backend really is blocked on a row lock right now.
    const waiters = await obs().waitForLockWaiters(1);
    expect(waiters).toBeGreaterThanOrEqual(1);

    release();
    await Promise.all([first, second]);
    expect(secondSaw).toBe("CheckedOut"); // re-read after the lock, not the stale snapshot

    await t.db.query("UPDATE asset SET disposition = $2, custodian = $3 WHERE assetid = $1", [
      contested,
      original.disposition,
      original.custodian,
    ]);
  }, 60_000);

  it.skipIf(!IS_POSTGRES)("DETERMINISTIC: both commands provably in flight, exactly one is applied", async () => {
    const aSet = take(5);
    const bSet = [aSet[2], ...take(2)]; // partial overlap on one asset
    const aId = newSubmissionId("s4-a");
    const bId = newSubmissionId("s4-b");

    const releaseBarrier = await obs().holdRowLocks([...new Set([...aSet, ...bSet])]);
    const pa = submit(t.app, "/api/commands/Checkout", checkoutBody(aSet, aId), "field");
    const pb = submit(t.app, "/api/commands/Checkout", checkoutBody(bSet, bId), "admin");

    // Both requests are now inside their own PostgreSQL transactions, blocked on the barrier.
    const waiters = await obs().waitForLockWaiters(2);
    expect(waiters).toBeGreaterThanOrEqual(2);

    await releaseBarrier();
    const [ra, rb] = await Promise.all([pa, pb]);

    const winners = [ra, rb].filter((r) => r.ok);
    const losers = [ra, rb].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = losers[0] as Extract<SubmissionOutcome, { ok: false }>;
    expect(loser.reason).toMatch(/Checkout is not a valid transition from CheckedOut/);
    expect(loser.offendingAssetId).toBe(aSet[2]);

    // The contested asset carries exactly one custody claim, and it is the winner's.
    const contested = await assetRow(aSet[2]);
    const winnerIsA = ra.ok;
    expect(contested.status).toBe("CheckedOut");
    expect(contested.custodian).toBe(winnerIsA ? FIELD_UPN : ADMIN_UPN);
    const contestedLines = await t.db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM asset_transaction_line l
         JOIN asset_transaction h ON h.id = l.transaction_id
        WHERE l.asset = $1 AND h.client_submission_id IN ($2, $3)`,
      [aSet[2], aId, bId]
    );
    expect(Number(contestedLines.rows[0].c)).toBe(1);

    // And the loser wrote NOTHING — not even for the assets it did not contest.
    expect(await headersFor(winnerIsA ? bId : aId)).toHaveLength(0);
    for (const a of (winnerIsA ? bSet : aSet).filter((x) => x !== aSet[2])) {
      expect((await assetRow(a)).status).toBe("Available");
    }
  }, 60_000);

  it.skipIf(!IS_POSTGRES)("BATCH: 100 concurrent races, all fired at once, exactly one success each", async () => {
    // five-asset-race.md batch target SC-002: "100 concurrent races, exactly one success each".
    const ROUNDS = 100;
    const contested = take(ROUNDS);
    const sampler = obs().startSampler();

    const calls = contested.flatMap((assetId, i) => [
      submit(t.app, "/api/commands/Checkout", checkoutBody([assetId], newSubmissionId(`s4r${i}a`)), "field"),
      submit(t.app, "/api/commands/Checkout", checkoutBody([assetId], newSubmissionId(`s4r${i}b`)), "admin"),
    ]);
    const results = await Promise.all(calls);
    const peak = await sampler.stop();

    for (let i = 0; i < ROUNDS; i += 1) {
      const pair = [results[i * 2], results[i * 2 + 1]];
      const ok = pair.filter((r) => r.ok);
      expect(
        ok.length,
        `round ${i} on ${contested[i]} produced ${ok.length} successes: ${JSON.stringify(pair)}`
      ).toBe(1);
      const row = await assetRow(contested[i]);
      expect(row.status).toBe("CheckedOut");
      expect([FIELD_UPN, ADMIN_UPN]).toContain(row.custodian);
    }
    expect(results.filter((r) => r.status !== 200)).toHaveLength(0);

    // The measurement that makes the batch meaningful rather than 100 sequential requests.
    // eslint-disable-next-line no-console
    console.log(
      `[S4 batch] peak backends in transaction: ${peak.maxInTransaction}, peak blocked on a lock: ${peak.maxLockWaiters}, samples: ${peak.samples}`
    );
    expect(peak.maxInTransaction).toBeGreaterThan(1);
    expect(peak.maxLockWaiters).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

// ================================================================ S5

describe("S5 — a lost response is retried and returns the original result", () => {
  const id = newSubmissionId("s5");
  let first: SubmissionOutcome & { status: number };
  let body: ReturnType<typeof checkoutBody>;

  it("accepts once", async () => {
    body = checkoutBody(take(5), id);
    first = await submit(t.app, "/api/commands/Checkout", body);
    expect(first.ok).toBe(true);
  });

  it("returns byte-identical results for 100 sequential replays, writing nothing", async () => {
    const before = await counts();
    for (let i = 0; i < 100; i += 1) {
      const replay = await submit(t.app, "/api/commands/Checkout", body);
      expect(replay).toEqual(first);
    }
    expect(await counts()).toEqual(before);
    expect(await headersFor(id)).toHaveLength(1);
  }, 120_000);

  it("returns the same result for 25 SIMULTANEOUS replays of an already-accepted command", async () => {
    const before = await counts();
    const replays = await Promise.all(
      Array.from({ length: 25 }, () => submit(t.app, "/api/commands/Checkout", body))
    );
    for (const r of replays) expect(r).toEqual(first);
    expect(await counts()).toEqual(before);
  }, 60_000);

  /**
   * FINDING WS-W4-F2 — the idempotency check is read-then-insert, not claim-then-process.
   *
   * `transactionService.runCommand` SELECTs `command_idempotency` at the top of the transaction
   * and INSERTs at the bottom. Two copies of the SAME submission that are in flight at the same
   * time — precisely what an offline queue replaying while the original is still travelling
   * produces — both find no row, and both run the command. This test pins what actually happens
   * so that a change to it is noticed; the requirement it violates is asserted immediately below.
   *
   * `010/contracts/transaction-command.md` step 2 says "Claim idempotency row (`Processing`) or
   * return stored outcome" — a claim, not a read.
   */
  it.skipIf(!IS_POSTGRES)("S5 — a simultaneous duplicate runs the command exactly once", async () => {
    const assets = take(3);
    const dupId = newSubmissionId("s5-dup");
    const dupBody = checkoutBody(assets, dupId);

    const releaseBarrier = await obs().holdRowLocks(assets);
    const p1 = submit(t.app, "/api/commands/Checkout", dupBody);
    const p2 = submit(t.app, "/api/commands/Checkout", dupBody);
    await obs().waitForLockWaiters(2);
    await releaseBarrier();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Before the claim-then-process correction this asserted the opposite: exactly ONE caller
    // succeeded and the other was refused "Checkout is not a valid transition from CheckedOut",
    // because both copies ran the command. Now the loser never runs it at all — it blocks on the
    // idempotency key and is answered from the winner's committed row.
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(await headersFor(dupId)).toHaveLength(1);
  }, 60_000);

  it.skipIf(!IS_POSTGRES)(
    "S5 — a simultaneous duplicate returns the ORIGINAL result (was finding WS-W4-F2)",
    async () => {
      const assets = take(3);
      const dupId = newSubmissionId("s5-dup-req");
      const dupBody = checkoutBody(assets, dupId);

      const releaseBarrier = await obs().holdRowLocks(assets);
      const p1 = submit(t.app, "/api/commands/Checkout", dupBody);
      const p2 = submit(t.app, "/api/commands/Checkout", dupBody);
      await obs().waitForLockWaiters(2);
      await releaseBarrier();
      const [r1, r2] = await Promise.all([p1, p2]);

      // Rule 3: "Same submission ID + same request returns the original result." Both callers
      // sent the same ID and the same request, so both must be told the same thing.
      expect(r1).toEqual(r2);
    },
    60_000
  );

  /**
   * Was finding WS-W4-F3. `Transfer` is legal from `CheckedOut` to `CheckedOut`, so unlike
   * Checkout the second copy of a simultaneous duplicate used to pass validation, write a second
   * header, and only then collide with `command_idempotency`'s primary key — surfacing as HTTP
   * 500. Atomicity always held (the collision forced the rollback, exactly one event survived);
   * what failed was availability.
   *
   * Claiming the key first removes the whole class: the loser never reaches validation. This test
   * is kept on the self-permitting transition precisely because it is the case that could hide a
   * regression — a Checkout duplicate would be refused by the state machine even if idempotency
   * were broken, and a Transfer duplicate would not.
   */
  it.skipIf(!IS_POSTGRES)("S5 — a self-permitting duplicate (Transfer) is answered, not collided (was finding WS-W4-F3)", async () => {
    const assets = take(2);
    await submit(t.app, "/api/commands/Checkout", checkoutBody(assets, newSubmissionId("s5-pre")));

    const dupId = newSubmissionId("s5-transfer-dup");
    const transferBody = {
      assetIds: assets,
      toproject: ACTIVE_PROJECT,
      reason: "concurrent duplicate probe",
      clientSubmissionId: dupId,
    };
    const beforeHeaders = (await counts()).headers;

    const releaseBarrier = await obs().holdRowLocks(assets);
    const p1 = post(t.app, "/api/commands/Transfer", transferBody);
    const p2 = post(t.app, "/api/commands/Transfer", transferBody);
    await obs().waitForLockWaiters(2);
    await releaseBarrier();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Was [200, 500]. Both callers are now answered, and with the same answer.
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(r1.json()).toEqual(r2.json());
    expect((r1.json() as SubmissionOutcome).ok).toBe(true);

    // Unchanged, and always was: no duplicate business event survived.
    expect(await headersFor(dupId)).toHaveLength(1);
    expect((await counts()).headers - beforeHeaders).toBe(1);

    // And a later retry of the same key is answered from the store, so it does self-heal.
    const retry = await submit(t.app, "/api/commands/Transfer", transferBody);
    expect(retry.ok).toBe(true);
    expect(await headersFor(dupId)).toHaveLength(1);
  }, 60_000);
});

// ================================================================ S6

describe("S6 — the same idempotency key with a different payload", () => {
  const id = newSubmissionId("s6");
  let original: SubmissionOutcome & { status: number };
  let firstAssets: string[] = [];
  let secondAssets: string[] = [];

  it("accepts the first payload", async () => {
    firstAssets = take(2);
    secondAssets = take(2);
    original = await submit(t.app, "/api/commands/Checkout", checkoutBody(firstAssets, id));
    expect(original.ok).toBe(true);
  });

  it("S6 — the second, different payload is REFUSED and writes nothing", async () => {
    const before = await counts();
    const outcome = await submit(t.app, "/api/commands/Checkout", checkoutBody(secondAssets, id));
    // Was `toEqual(original)` — the first command's answer handed to a different request, which
    // silently dropped the second request and hid the client bug that caused it.
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/idempotencyPayloadMismatch/);
    expect(outcome.status).toBe(200); // a refusal is an answer, not a transport error
    expect(await counts()).toEqual(before);
    for (const a of secondAssets) expect((await assetRow(a)).status).toBe("Available");
    // The stored hash is the FIRST request's, so the server did notice the difference.
    const stored = await idempotencyRow(id);
    expect(stored.request_hash).toHaveLength(64);
  });

  /**
   * FINDING WS-W4-F1 — implemented behaviour contradicts a non-negotiable rule.
   *
   * CLAUDE.md rule 3: "Same submission ID + same request returns the original result; same ID +
   * different request is refused."
   * specs/010-web-application-platform/contracts/transaction-command.md (FROZEN R2):
   * "Same ID + different hash → `command.error.idempotencyPayloadMismatch` (client defect)."
   * specs/REMAINING-WORK.md § WS-W4 first proof, item 6: "same key with different payload is refused".
   *
   * `transactionService.runCommand` instead returns the original outcome and logs a warning, and
   * `server/README.md` § Idempotency argues for that ("refusing would make a replay fail after a
   * success the caller may already have seen"). CLAUDE.md rule 13 settles the disagreement:
   * specifications win over code. The service is NOT changed here — that is a decision for the
   * owner of `transactionService.ts` — so this test is marked `.fails` and will itself FAIL the
   * moment the service is corrected, which is the signal to delete `.fails`.
   */
  it("S6 — rule 3 and the frozen R2 contract require a REFUSAL, not a replay (was finding WS-W4-F1)", async () => {
    const mismatchId = newSubmissionId("s6-req");
    const a = take(2);
    const b = take(2);
    const accepted = await submit(t.app, "/api/commands/Checkout", checkoutBody(a, mismatchId));
    expect(accepted.ok).toBe(true);

    const mismatched = await submit(t.app, "/api/commands/Checkout", checkoutBody(b, mismatchId));
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.reason).toMatch(/idempotenc|payload|mismatch/i);
  });

  it("treats a payload that differs only in fields the schema strips as the SAME request", async () => {
    // zod strips unknown keys before the hash is taken, so a client adding junk does not turn a
    // replay into a mismatch. Recorded because it is the reason S8's fabricated fields cannot
    // change a hash either.
    const sameId = newSubmissionId("s6-strip");
    const a = take(2);
    const accepted = await submit(t.app, "/api/commands/Checkout", checkoutBody(a, sameId));
    expect(accepted.ok).toBe(true);
    const withJunk = await submit(
      t.app,
      "/api/commands/Checkout",
      checkoutBody(a, sameId, { statusAfter: "Retired", performedby: "someone-else@example.com" })
    );
    expect(withJunk).toEqual(accepted);
    expect(await headersFor(sameId)).toHaveLength(1);
  });
});

// ================================================================ S7

describe("S7 — reversed input order does not deadlock", () => {
  /**
   * The negative control again. Two transactions that take their locks in OPPOSITE order, with a
   * latch guaranteeing each holds its first before either asks for its second, deadlock — and
   * PostgreSQL breaks the tie by killing one with SQLSTATE 40P01. That is what
   * `lockAssets`'s `[...new Set(ids)].sort()` exists to prevent, and it is why the batch below
   * finding zero deadlocks across 45 contended multi-asset commands means something.
   */
  it.skipIf(!IS_POSTGRES)("CONTROL: opposite lock order deadlocks (SQLSTATE 40P01)", async () => {
    const [x, y] = take(2);
    const l = latch(2);
    const lockBoth = (first: string, second: string) =>
      t.db.transaction(async (tx) => {
        await tx.query("SELECT assetid FROM asset WHERE assetid = $1 FOR UPDATE", [first]);
        l.arrive();
        await l.all;
        await tx.query("SELECT assetid FROM asset WHERE assetid = $1 FOR UPDATE", [second]);
      });

    const settled = await Promise.allSettled([lockBoth(x, y), lockBoth(y, x)]);
    const rejected = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { code?: string }).code).toBe("40P01");
  }, 60_000);

  it.skipIf(!IS_POSTGRES)("BATCH: 15 rounds x 3 concurrent commands over the same four assets in three different orders", async () => {
    const ROUNDS = 15;
    const rounds = Array.from({ length: ROUNDS }, () => take(4));
    const sampler = obs().startSampler();

    const calls = rounds.flatMap((set, i) => {
      const forward = set;
      const reversed = [...set].reverse();
      const rotated = [set[2], set[0], set[3], set[1]];
      return [
        submit(t.app, "/api/commands/Checkout", checkoutBody(forward, newSubmissionId(`s7r${i}f`)), "field"),
        submit(t.app, "/api/commands/Checkout", checkoutBody(reversed, newSubmissionId(`s7r${i}r`)), "admin"),
        submit(t.app, "/api/commands/Checkout", checkoutBody(rotated, newSubmissionId(`s7r${i}o`)), "owner"),
      ];
    });
    const results = await Promise.all(calls);
    const peak = await sampler.stop();

    // No deadlock reached a caller, and nothing hung: every request answered with HTTP 200.
    expect(results.filter((r) => r.status !== 200)).toHaveLength(0);
    expect(JSON.stringify(results)).not.toMatch(/deadlock/i);

    for (let i = 0; i < ROUNDS; i += 1) {
      const trio = results.slice(i * 3, i * 3 + 3);
      expect(trio.filter((r) => r.ok), `round ${i}: ${JSON.stringify(trio)}`).toHaveLength(1);
      for (const a of rounds[i]) expect((await assetRow(a)).status).toBe("CheckedOut");
    }
    // eslint-disable-next-line no-console
    console.log(
      `[S7 batch] peak backends in transaction: ${peak.maxInTransaction}, peak blocked on a lock: ${peak.maxLockWaiters}`
    );
    expect(peak.maxLockWaiters).toBeGreaterThanOrEqual(1);
  }, 120_000);

  /**
   * The direct evidence, rather than the statistical kind above: while a command is blocked on
   * the barrier, the observer reads that backend's own SQL out of `pg_stat_activity`. It is ONE
   * statement, `… ORDER BY assetid … FOR UPDATE`, so every asset in the command is locked in one
   * ordered sweep — which is what makes two commands with different input orders take their locks
   * in the same order, and is exactly the property the 40P01 control above shows is load-bearing.
   */
  it.skipIf(!IS_POSTGRES)("takes every row lock in one ORDER BY assetid FOR UPDATE statement, whatever order the client sent", async () => {
    const set = take(4);
    const reversed = [...set].reverse();
    const id = newSubmissionId("s7-order");

    const releaseBarrier = await obs().holdRowLocks(set);
    const pending = submit(t.app, "/api/commands/Checkout", checkoutBody(reversed, id));
    await obs().waitForLockWaiters(1);
    const blocked = await obs().blockedQueries();
    await releaseBarrier();
    expect(await pending).toMatchObject({ ok: true });

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/FROM asset a[\s\S]*ORDER BY a\.assetid\s+FOR UPDATE/);
  }, 60_000);

  /**
   * Recorded because the first draft of this file assumed the opposite and was wrong. Lines are
   * written in the order the CLIENT sent them (`applyTransaction` iterates `params.lines`);
   * only the LOCK sweep is sorted. Both are correct and they are different things: line order is
   * presentation (line 1 is the primary asset the technician chose), lock order is deadlock
   * safety. Pinned so a future change to either is deliberate.
   */
  it("writes lines in the order the client sent — line order is presentation, lock order is safety", async () => {
    const set = take(4);
    const reversed = [...set].reverse();
    const id = newSubmissionId("s7-lineorder");
    const outcome = await submit(t.app, "/api/commands/Checkout", checkoutBody(reversed, id));
    expect(outcome.ok).toBe(true);
    const [header] = await headersFor(id);
    const lines = await linesOf(header.id);
    expect(lines.map((l) => l.asset)).toEqual(reversed);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3, 4]);
  });
});

// ================================================================ S8

describe("S8 — browser-supplied state cannot alter the result", () => {
  it("ignores fabricated before/after, custodian, performer and line numbers", async () => {
    const assets = take(3);
    const id = newSubmissionId("s8");
    const outcome = await submit(t.app, "/api/commands/Checkout", {
      lines: assets.map((assetId) => ({
        assetId,
        statusBefore: "Retired",
        statusAfter: "Available",
        lineNumber: 99,
        custodian: "attacker@example.com",
      })),
      project: ACTIVE_PROJECT,
      clientSubmissionId: id,
      // Top-level fabrications, including a claim about who is performing the command.
      performedby: "svc-ams@englobecorp.com",
      statusBefore: "Retired",
      statusAfter: "Available",
      custodian: "attacker@example.com",
      currentlocation: "Somewhere Else",
      transactionName: "TXN-000001",
      clientStateHints: { lifecycle: "Retired", disposition: "AtOffice" },
      roles: ["SystemOwner"],
    });
    expect(outcome.ok).toBe(true);

    const [header] = await headersFor(id);
    expect(header.performedby).toBe(FIELD_UPN); // from the session, never from the body
    expect(header.name).not.toBe("TXN-000001");

    const lines = await linesOf(header.id);
    expect(lines.map((l) => l.line_number)).toEqual([1, 2, 3]);
    expect(lines.every((l) => l.statusbefore === "Available")).toBe(true); // server-read, not client-claimed
    expect(lines.every((l) => l.statusafter === "CheckedOut")).toBe(true); // server-derived
    for (const a of assets) {
      const row = await assetRow(a);
      expect(row.custodian).toBe(FIELD_UPN);
      expect(row.currentlocation).toBeNull();
      expect(row.status).toBe("CheckedOut");
    }
  });

  it("does not let a body-supplied role escalate an authorization refusal", async () => {
    const heldByAnother = (
      await t.db.query<{ assetid: string }>(
        `SELECT assetid FROM asset
          WHERE status = 'CheckedOut' AND (custodian IS NULL OR custodian <> $1)
          ORDER BY assetid LIMIT 1`,
        [FIELD_UPN]
      )
    ).rows[0].assetid;

    const refused = await submit(
      t.app,
      "/api/commands/Return",
      {
        lines: [{ assetId: heldByAnother }],
        clientSubmissionId: newSubmissionId("s8-role"),
        roles: ["OfficeAdmin", "SystemOwner"],
        user: { upn: ADMIN_UPN, roles: ["SystemOwner"] },
      },
      "field"
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toMatch(/only its custodian or an administrator can return it/);
    expect((await assetRow(heldByAnother)).status).toBe("CheckedOut");

    // The same request from a genuinely privileged session succeeds — so the refusal above was
    // about the caller's real role, not about the request being malformed.
    const allowed = await submit(
      t.app,
      "/api/commands/Return",
      { lines: [{ assetId: heldByAnother }], clientSubmissionId: newSubmissionId("s8-role-ok") },
      "admin"
    );
    expect(allowed.ok).toBe(true);
  });
});

// ================================================================ S9

describe("S9 — accepted headers and lines cannot be edited normally", () => {
  /**
   * `tests/transactions.test.ts` already covers UPDATE-on-line and DELETE-on-header. The two
   * mirror cases were not covered, and neither was the absence of an HTTP edit path, so both are
   * added here rather than duplicating what exists.
   */
  it("refuses an UPDATE on an accepted header", async () => {
    await expect(t.db.query("UPDATE asset_transaction SET notes = 'tampered'")).rejects.toThrow(/append-only/);
  });

  it("refuses a DELETE on an accepted line", async () => {
    await expect(t.db.query("DELETE FROM asset_transaction_line")).rejects.toThrow(/append-only/);
  });

  it("exposes no HTTP verb that could edit one — no PATCH, no DELETE, and one narrow PUT", () => {
    const routes = t.app.printRoutes({ commonPrefix: false });
    expect(routes).toMatch(/GET/); // the listing really does carry methods, so the negatives below mean something
    expect(routes).toMatch(/POST/);
    expect(routes).not.toMatch(/PATCH/);
    expect(routes).not.toMatch(/DELETE/);
    const puts = routes.split("\n").filter((line) => line.includes("PUT"));
    expect(puts).toHaveLength(1); // the only PUT in the server
    expect(routes).toMatch(/office-admins/); // and it is the office-admin assignment, not a row editor
  });
});

// ================================================================ Registration proof

describe("R — registration: the server allocates, the browser never reserves", () => {
  async function sequenceValue(prefix: string): Promise<number> {
    const res = await t.db.query<{ nextvalue: number }>("SELECT nextvalue FROM id_sequence WHERE prefix = $1", [prefix]);
    return Number(res.rows[0].nextvalue);
  }

  it("R2 — previewing the next ID does not consume it, and five previews agree", async () => {
    const before = await sequenceValue("AT");
    const previews: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await get(
        t.app,
        `/api/assets/next-id?manufacturer=${encodeURIComponent(AIRTAG.manufacturer)}&model=${encodeURIComponent(AIRTAG.model)}&equipmenttype=${AIRTAG.equipmenttype}`,
        "admin"
      );
      expect(res.statusCode).toBe(200);
      previews.push(res.json().assetId);
    }
    expect(new Set(previews).size).toBe(1); // a preview is a display, not a reservation
    expect(await sequenceValue("AT")).toBe(before);
    expect(previews[0]).toBe(`AT-${String(before).padStart(4, "0")}`);
  });

  it("R2 — a client-supplied canonical ID or sequence value is ignored; the server allocates", async () => {
    const expected = await sequenceValue("AT");
    const outcome = await submit(
      t.app,
      "/api/assets",
      {
        ...AIRTAG,
        homeoffice: "Ottawa",
        clientSubmissionId: newSubmissionId("r2"),
        // Every one of these is a browser trying to own identity. All are stripped at the boundary.
        assetid: "AT-9999",
        id: "00000000-0000-0000-0000-000000000000",
        sequenceValue: 500,
        nextvalue: 500,
        status: "CheckedOut",
        lifecycle: "Retired",
      },
      "admin"
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transactionName).toBe(`AT-${String(expected).padStart(4, "0")}`);
    expect(await sequenceValue("AT")).toBe(expected + 1);

    const created = await assetRow(outcome.transactionName);
    expect(created.status).toBe("Available"); // not the client's "CheckedOut"
    const clash = await t.db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset WHERE assetid = 'AT-9999'");
    expect(Number(clash.rows[0].c)).toBe(0);
  });

  /**
   * The negative control for the sequence, mirroring S4's. `consumeSequence` is ONE statement —
   * `INSERT … ON CONFLICT DO UPDATE … RETURNING` — so there is no window between reading and
   * incrementing and no latch can be inserted into it. The read-then-increment version it
   * replaced does have that window, and this proves the window is real: eight transactions that
   * all read before any writes all mint the same number.
   */
  it.skipIf(!IS_POSTGRES)("CONTROL: read-then-increment on id_sequence hands the same number to eight callers", async () => {
    const prefix = "ZZTEST";
    await t.db.query("INSERT INTO id_sequence (prefix, nextvalue) VALUES ($1, 1) ON CONFLICT (prefix) DO NOTHING", [prefix]);
    const l = latch(8);
    const naive = () =>
      t.db.transaction(async (tx) => {
        const r = await tx.query<{ nextvalue: number }>("SELECT nextvalue FROM id_sequence WHERE prefix = $1", [prefix]);
        const v = Number(r.rows[0].nextvalue);
        l.arrive();
        await l.all;
        await tx.query("UPDATE id_sequence SET nextvalue = $2 WHERE prefix = $1", [prefix, v + 1]);
        return v;
      });
    const issued = await Promise.all(Array.from({ length: 8 }, naive));
    expect(new Set(issued).size).toBeLessThan(8); // duplicates — the bug ON CONFLICT prevents
    await t.db.query("DELETE FROM id_sequence WHERE prefix = $1", [prefix]);
  }, 60_000);

  it.skipIf(!IS_POSTGRES)("R1 — 100 concurrent registrations under one prefix mint 100 unique canonical IDs", async () => {
    const N = 100;
    const start = await sequenceValue("AT");
    const beforeAssets = Number(
      (await t.db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset")).rows[0].c
    );
    const sampler = obs().startSampler();

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        submit(
          t.app,
          "/api/assets",
          { ...AIRTAG, homeoffice: "Ottawa", clientSubmissionId: newSubmissionId(`reg-${i}`) },
          "admin"
        )
      )
    );
    const peak = await sampler.stop();
    // eslint-disable-next-line no-console
    console.log(
      `[R1 burst] peak backends in transaction: ${peak.maxInTransaction}, peak blocked on a lock: ${peak.maxLockWaiters}, samples: ${peak.samples}`
    );

    expect(results.filter((r) => !r.ok)).toHaveLength(0);
    const minted = results.map((r) => (r.ok ? r.transactionName : "")).sort();
    expect(new Set(minted).size).toBe(N); // 100 UNIQUE canonical IDs

    // Contiguous, so no value was consumed and lost, and none was issued twice.
    const expectedTags = Array.from({ length: N }, (_, i) => `AT-${String(start + i).padStart(4, "0")}`).sort();
    expect(minted).toEqual(expectedTags);
    expect(await sequenceValue("AT")).toBe(start + N);

    // Each ID was returned only after its own asset row and AddToInventory line committed.
    const committed = await t.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM asset WHERE assetid = ANY($1)",
      [minted]
    );
    expect(Number(committed.rows[0].c)).toBe(N);
    const afterAssets = Number(
      (await t.db.query<{ c: number }>("SELECT count(*)::int AS c FROM asset")).rows[0].c
    );
    expect(afterAssets - beforeAssets).toBe(N);
    const inventoryLines = await t.db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM asset_transaction_line l
         JOIN asset_transaction h ON h.id = l.transaction_id
        WHERE h.transactiontype = 'AddToInventory' AND l.asset = ANY($1)`,
      [minted]
    );
    expect(Number(inventoryLines.rows[0].c)).toBe(N);

    // The burst genuinely overlapped: many backends were inside a transaction at once, and the
    // id_sequence row made them queue.
    expect(peak.maxInTransaction).toBeGreaterThan(1);
    expect(peak.maxLockWaiters).toBeGreaterThanOrEqual(1);
  }, 180_000);

  /**
   * R3: a TMP-* value survives as a searchable alias on the same asset UUID
   * (`009/contracts/registration-concurrency.md`). `asset_identifier` is the table; there is
   * no `asset_alias` synonym.
   */
  it("R3 — temporary tags are retained as aliases on asset_identifier", async () => {
    const res = await t.db.query<{ a: string | null; b: string | null }>(
      "SELECT to_regclass('public.asset_alias') AS a, to_regclass('public.asset_identifier') AS b"
    );
    expect(res.rows[0].a).toBeNull();
    expect(res.rows[0].b).not.toBeNull();

    const tagged = await t.db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM asset_identifier
        WHERE is_current AND identifier_type = 'TemporaryTag' AND identifier_value ~ '^TMP-'`
    );
    expect(tagged.rows[0].c).toBeGreaterThan(0);
  });
});
