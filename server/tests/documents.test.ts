/**
 * WS-W7's proof: private calibration documents, and the truthfulness of a calibration record
 * that has no file behind it.
 *
 * Every one of WS-W7's ten required tests is here, named in place:
 *
 *   successful upload ................................... § A1
 *   upload failure AFTER the calibration fact is accepted  § B1  ← the headline
 *   later attachment .................................... § B2
 *   replacement / reissue ............................... § C1, C2
 *   failed calibration .................................. § D1
 *   older historical record entry ....................... § D2
 *   correction / supersession / void .................... § C1, C3
 *   retired asset retrieval ............................. § D3
 *   unauthorized direct document access refused ......... § E1–E4
 *   database restore / document mismatch report ......... § F1–F4
 *
 * WHY SOME TESTS GO THROUGH HTTP AND SOME THROUGH THE SERVICE. The authorization, transport and
 * header behaviour can only be proved through `app.inject()`, so § A and § E do that. The store
 * FAULT cases cannot: injecting a failing store through HTTP would need a test-only backdoor in
 * `routes/documents.ts`, and a production file that can be told to break on request is a worse
 * outcome than a test that constructs its own service. So § B, § C and § F build a
 * `DocumentService` over the same database and a deliberately broken `DocumentStore` — the real
 * service, the real SQL, the real transactions, only the bytes' destination swapped. That is the
 * same reasoning `concurrencyHelpers.ts` gives for its fault-injection trigger.
 *
 * THE FIXTURE PDF is four real bytes of PDF magic plus filler, because
 * `policy.contentMatchesDeclaredType` checks the magic number and a test that declared
 * `application/pdf` over arbitrary bytes would be testing a check it had disabled.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CalibrationRecord } from "../../app/src/api/types";
import { createTestApp, get, getJson, newSubmissionId, post, submit, type DevUser, type TestApp } from "./helpers";
import { DEMO_USERS } from "../src/auth/devAuth";
import {
  DOCUMENT_LIMITS,
  DOCUMENT_REFERENCE_PREFIX,
  DocumentService,
  LocalDocumentStore,
  MarkerScanner,
  ensureDocumentSchema,
  reconcileDocuments,
  sha256Of,
  type ClientDocumentMetadata,
  type DocumentStore,
  type StoredObject,
} from "../src/documents";
import { DocumentStoreError } from "../src/documents/store";
import { ensureOutboxSchema } from "../src/outbox";

let t: TestApp;
let documentRoot: string;
let store: LocalDocumentStore;
/** The service the fault tests drive directly — same database, swappable store. */
let service: DocumentService;

const ADMIN = DEMO_USERS.admin; // Office Admin, homeoffice Ottawa
const OWNER = DEMO_USERS.owner; // System Owner — global (assumption A-R5)
const FIELD = DEMO_USERS.field; // Field User — never receives certificate bytes

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("englobe-ams calibration certificate fixture\n")]);
const PDF_SHA = sha256Of(PDF);

/**
 * Calibration dates are RELATIVE, never literal.
 *
 * `commandService.recordCalibration` refuses a future calibration date (feature 004 FR-011), so
 * a hard-coded date is a test that passes until the wall clock catches up with it and then
 * starts failing for a reason that has nothing to do with documents. Every fixture below is
 * anchored to today. Next-due dates may legitimately be in the future and are anchored the same
 * way.
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysAhead(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One calibration, `n` days ago, due a year after that. */
function calDates(daysBack: number): { calibrationdate: string; nextduedate: string } {
  return { calibrationdate: daysAgo(daysBack), nextduedate: daysAhead(365 - daysBack) };
}

function pdfSession(linkedEntityId: string, label: string, extra: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: newSubmissionId(label),
    linkedEntityType: "Calibration" as const,
    linkedEntityId,
    mediaType: "application/pdf",
    byteSize: PDF.byteLength,
    originalFileName: "certificate.pdf",
    ...extra,
  };
}

/** A store whose writes always fail — the FR-033 fault. */
class BrokenDocumentStore implements DocumentStore {
  readonly kind = "broken";
  readonly container = "broken:test";
  puts = 0;
  async put(_p: string, _b: Buffer): Promise<StoredObject> {
    this.puts += 1;
    throw new DocumentStoreError("the document store is unreachable (injected)");
  }
  async get(): Promise<Buffer> {
    throw new DocumentStoreError("the document store is unreachable (injected)");
  }
  async head() {
    return null;
  }
  async delete(): Promise<void> {}
  async list(): Promise<string[]> {
    return [];
  }
}

let assetPool: string[] = [];
let cursor = 0;
function takeAsset(): string {
  const next = assetPool[cursor];
  cursor += 1;
  if (!next) throw new Error("Test asset pool exhausted.");
  return next;
}

beforeAll(async () => {
  documentRoot = await mkdtemp(path.join(tmpdir(), "ams-documents-"));
  // Read by `createDocumentStore()` when routes/documents.ts constructs its service, so the HTTP
  // tests write into the temp directory rather than into server/data/documents.
  process.env.AMS_DOCUMENT_DIR = documentRoot;

  t = await createTestApp();
  await ensureOutboxSchema(t.db);
  await ensureDocumentSchema(t.db);

  store = new LocalDocumentStore(documentRoot);
  service = new DocumentService(t.db, store, { scanner: new MarkerScanner() });

  // Ottawa assets with no calibration history of their own, so every assertion below is about
  // records this file created.
  const res = await t.db.query<{ assetid: string }>(
    `SELECT a.assetid FROM asset a
      WHERE a.lifecycle = 'Active' AND a.homeoffice = 'Ottawa' AND a.status = 'Available'
        AND NOT EXISTS (SELECT 1 FROM calibration_record c WHERE c.asset = a.assetid)
      ORDER BY a.assetid`
  );
  assetPool = res.rows.map((r) => r.assetid);
  expect(assetPool.length).toBeGreaterThan(10);
}, 120_000);

afterAll(async () => {
  await t?.close();
  delete process.env.AMS_DOCUMENT_DIR;
  await rm(documentRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------- helpers

/** Records a calibration through the real command route and returns the stored record. */
async function recordCalibration(
  assetId: string,
  fields: { calibrationdate: string; nextduedate: string; result?: "Pass" | "Fail" | "Adjusted"; certificatenumber?: string },
  as: DevUser = "admin"
): Promise<CalibrationRecord & { id: string }> {
  const outcome = await submit(
    t.app,
    "/api/calibrations",
    { assetId, lab: "Test Lab", clientSubmissionId: newSubmissionId("cal"), ...fields },
    as
  );
  expect(outcome.ok).toBe(true);
  const records = await getJson<CalibrationRecord[]>(t.app, `/api/assets/${assetId}/calibrations`, "admin");
  const found = records.find((r) => r.calibrationdate === fields.calibrationdate);
  expect(found?.id).toBeTruthy();
  return found as CalibrationRecord & { id: string };
}

async function uploadThroughHttp(
  linkedEntityId: string,
  label: string,
  as: DevUser = "admin"
): Promise<{ documentId: string; metadata: ClientDocumentMetadata }> {
  const sessionRes = await post(t.app, "/api/documents/upload-sessions", pdfSession(linkedEntityId, label), as);
  expect(sessionRes.statusCode).toBe(200);
  const session = sessionRes.json() as { ok: boolean; documentId: string; uploadMode: string };
  expect(session.ok).toBe(true);
  expect(session.uploadMode).toBe("proxyPut");

  const putRes = await t.app.inject({
    method: "POST",
    url: `/api/documents/${session.documentId}/content`,
    headers: { "x-ams-dev-user": as, "content-type": "application/pdf" },
    payload: PDF,
  });
  expect(putRes.statusCode).toBe(200);
  const put = putRes.json() as { ok: boolean; metadata: ClientDocumentMetadata };
  expect(put.ok).toBe(true);
  return { documentId: session.documentId, metadata: put.metadata };
}

async function summaryOf(assetId: string, as: DevUser = "admin") {
  const res = await get(t.app, `/api/documents/calibration-summary?assetId=${assetId}`, as);
  expect(res.statusCode).toBe(200);
  return (res.json() as { summary: Record<string, unknown> }).summary;
}

async function certificateUrlOf(calibrationRecordId: string): Promise<string | null> {
  const res = await t.db.query<{ certificateurl: string | null }>(
    "SELECT certificateurl FROM calibration_record WHERE id = $1",
    [calibrationRecordId]
  );
  return res.rows[0].certificateurl;
}

// ============================================================================
// § A — the happy path, over HTTP
// ============================================================================

describe("A — successful upload and private retrieval", () => {
  it("A1 — an administrator uploads a certificate, and it becomes the calibration's current certificate", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, {
      ...calDates(30),
      certificatenumber: "CERT-A1",
    });

    const { documentId, metadata } = await uploadThroughHttp(record.id, "a1");
    expect(metadata.uploadState).toBe("Stored");
    expect(metadata.sha256).toBe(PDF_SHA);
    expect(metadata.byteSize).toBe(PDF.byteLength);
    expect(metadata.isCurrent).toBe(true);

    // The certificate reference is INTERNAL — never a URL a browser could follow (rule 11).
    expect(await certificateUrlOf(record.id)).toBe(`${DOCUMENT_REFERENCE_PREFIX}${documentId}`);

    const summary = await summaryOf(assetId);
    expect(summary).toMatchObject({
      assetId,
      calibrationRecordId: record.id,
      certificateDocumentId: documentId,
      certificateMissing: false,
      reason: null,
    });

    const download = await post(t.app, `/api/documents/${documentId}/download-authorization`, {}, "admin");
    expect(download.statusCode).toBe(200);
    const auth = download.json() as { mode: string; downloadPath: string; sha256: string };
    expect(auth.mode).toBe("proxyGet");
    expect(auth.downloadPath).toBe(`/api/documents/${documentId}/content`);
    expect(auth.sha256).toBe(PDF_SHA);

    const content = await get(t.app, `/api/documents/${documentId}/content`, "admin");
    expect(content.statusCode).toBe(200);
    expect(Buffer.from(content.rawPayload).equals(PDF)).toBe(true);
    expect(content.headers["cache-control"]).toContain("no-store");
    expect(content.headers["content-disposition"]).toContain("attachment");
  });

  it("A2 — no response anywhere carries the container, the blob path, or any storage credential", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(10) });
    const { documentId } = await uploadThroughHttp(record.id, "a2");

    for (const url of [`/api/documents/${documentId}`, `/api/documents?linkedEntityType=Calibration&linkedEntityId=${record.id}`]) {
      const res = await get(t.app, url, "admin");
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("blobPath");
      expect(res.body).not.toContain("container");
      expect(res.body).not.toContain(documentRoot);
      expect(res.body.toLowerCase()).not.toContain("sig=");
    }
  });

  it("A3 — type and size are enforced by the server, not by the picker", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(11) });

    const wrongType = await post(
      t.app,
      "/api/documents/upload-sessions",
      pdfSession(record.id, "a3-type", { mediaType: "application/zip" }),
      "admin"
    );
    expect((wrongType.json() as { code: string }).code).toBe("document.error.typeOrSize");

    const tooBig = await post(
      t.app,
      "/api/documents/upload-sessions",
      pdfSession(record.id, "a3-size", { byteSize: DOCUMENT_LIMITS.maxBytes + 1 }),
      "admin"
    );
    expect((tooBig.json() as { code: string }).code).toBe("document.error.typeOrSize");

    // A session that declares PDF but sends something else is refused at the content step, from
    // the bytes themselves.
    const session = (
      await post(t.app, "/api/documents/upload-sessions", pdfSession(record.id, "a3-content"), "admin")
    ).json() as { documentId: string };
    const put = await t.app.inject({
      method: "POST",
      url: `/api/documents/${session.documentId}/content`,
      headers: { "x-ams-dev-user": "admin", "content-type": "application/pdf" },
      payload: Buffer.concat([Buffer.from("MZ  "), Buffer.alloc(PDF.byteLength - 4)]),
    });
    expect((put.json() as { code: string }).code).toBe("document.error.typeOrSize");
  });

  it("A4 — a declared hash that does not match the bytes is refused before anything is stored", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(12) });
    const session = (
      await post(t.app, "/api/documents/upload-sessions", pdfSession(record.id, "a4", { sha256: "0".repeat(64) }), "admin")
    ).json() as { documentId: string };

    const put = await t.app.inject({
      method: "POST",
      url: `/api/documents/${session.documentId}/content`,
      headers: { "x-ams-dev-user": "admin", "content-type": "application/pdf" },
      payload: PDF,
    });
    expect((put.json() as { code: string }).code).toBe("document.error.hashMismatch");
    expect(await store.list()).not.toContain(
      (await t.db.query<{ blob_path: string }>("SELECT blob_path FROM document WHERE id = $1", [session.documentId])).rows[0]
        .blob_path
    );
  });

  it("A5 — a quarantined file is stored as evidence but never becomes a certificate and never downloads", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(13) });
    const infected = Buffer.concat([Buffer.from("%PDF-1.7\nEICAR-signature-here\n")]);

    const session = await service.createUploadSession(ADMIN, {
      ...pdfSession(record.id, "a5"),
      byteSize: infected.byteLength,
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const stored = await service.putContent(ADMIN, session.documentId, infected);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.metadata.scanState).toBe("Quarantined");
    expect(stored.metadata.uploadState).toBe("Stored"); // the bytes ARE kept — rule 20

    expect(await certificateUrlOf(record.id)).toBeNull();
    const summary = await summaryOf(assetId);
    expect(summary).toMatchObject({ certificateMissing: true, reason: "Quarantined" });

    const download = await service.getContent(ADMIN, session.documentId);
    expect(download.ok).toBe(false);
    if (download.ok) return;
    expect(download.code).toBe("document.error.quarantined");

    // ...and the gap was announced through the outbox, in the same commit as the state change.
    const events = await t.db.query<{ payload: { reason: string } }>(
      "SELECT payload FROM outbox_event WHERE event_type = 'calibration.certificate_missing' AND aggregate_id = $1",
      [record.id]
    );
    expect(events.rows.map((r) => r.payload.reason)).toContain("Quarantined");
  });
});

// ============================================================================
// § B — FR-033: the calibration FACT survives the file (the headline requirement)
// ============================================================================

describe("B — a truthful calibration record survives a file failure", () => {
  it("B1 — the store fails after the calibration is accepted; the record stands and says why", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, {
      ...calDates(31),
      certificatenumber: "CERT-B1",
    });

    // Snapshot the accepted fact BEFORE anything touches a file.
    const before = (
      await t.db.query<Record<string, unknown>>("SELECT * FROM calibration_record WHERE id = $1", [record.id])
    ).rows[0];
    const assetBefore = (await t.db.query<Record<string, unknown>>("SELECT * FROM asset WHERE assetid = $1", [assetId]))
      .rows[0];

    const broken = new BrokenDocumentStore();
    const brokenService = new DocumentService(t.db, broken);
    const session = await brokenService.createUploadSession(ADMIN, pdfSession(record.id, "b1"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const attempt = await brokenService.putContent(ADMIN, session.documentId, PDF);
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.code).toBe("platform.error.dependency");
    expect(broken.puts).toBe(1);

    // THE ASSERTION THIS WHOLE LANE EXISTS FOR: the calibration record is byte-for-byte what it
    // was, and the asset's derived calibration summary is untouched.
    const after = (await t.db.query<Record<string, unknown>>("SELECT * FROM calibration_record WHERE id = $1", [record.id]))
      .rows[0];
    expect(after).toEqual(before);
    expect((await t.db.query<Record<string, unknown>>("SELECT * FROM asset WHERE assetid = $1", [assetId])).rows[0]).toEqual(
      assetBefore
    );

    // The failure is recorded, not hidden.
    const doc = (
      await t.db.query<{ upload_state: string; scan_detail: string }>("SELECT * FROM document WHERE id = $1", [
        session.documentId,
      ])
    ).rows[0];
    expect(doc.upload_state).toBe("Failed");
    expect(doc.scan_detail).toContain("store failure");

    const summary = await summaryOf(assetId);
    expect(summary).toMatchObject({
      calibrationRecordId: record.id,
      certificateNumber: "CERT-B1",
      certificateMissing: true,
      reason: "UploadFailed",
    });

    // ...and the gap was queued for somebody to chase, atomically with the state change.
    const events = await t.db.query<{ payload: { reason: string } }>(
      "SELECT payload FROM outbox_event WHERE event_type = 'calibration.certificate_missing' AND aggregate_id = $1",
      [record.id]
    );
    expect(events.rows.map((r) => r.payload.reason)).toContain("UploadFailed");
  });

  it("B1b — two simultaneous PUTs of one session leave a STORED document, never a false failure", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(29) });
    const session = await service.createUploadSession(ADMIN, pdfSession(record.id, "b1b"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    // The store refuses to overwrite, so exactly one of these wins the object. The loser must
    // recognise the winner's commit rather than marking a good upload `Failed` — which would
    // report a certificate that is sitting right there as missing.
    const [a, b] = await Promise.all([
      service.putContent(ADMIN, session.documentId, PDF),
      service.putContent(ADMIN, session.documentId, PDF),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const row = (
      await t.db.query<{ upload_state: string; sha256: string }>("SELECT * FROM document WHERE id = $1", [
        session.documentId,
      ])
    ).rows[0];
    expect(row.upload_state).toBe("Stored");
    expect(row.sha256).toBe(PDF_SHA);
    expect(await certificateUrlOf(record.id)).toBe(`${DOCUMENT_REFERENCE_PREFIX}${session.documentId}`);
  });

  it("B2 — the certificate is attached later, and the summary clears", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(14) });

    // Day one: no certificate at all.
    expect(await summaryOf(assetId)).toMatchObject({ certificateMissing: true, reason: "NeverAttached" });

    // Day three: the lab sends the PDF.
    const { documentId } = await uploadThroughHttp(record.id, "b2");
    expect(await summaryOf(assetId)).toMatchObject({ certificateMissing: false, certificateDocumentId: documentId });
  });

  it("B3 — a document uploaded against one calibration can be attached to another later", async () => {
    const assetId = takeAsset();
    const first = await recordCalibration(assetId, { ...calDates(15) });
    const { documentId } = await uploadThroughHttp(first.id, "b3");

    const second = await recordCalibration(assetId, { ...calDates(16) });
    const attached = await post(t.app, `/api/documents/${documentId}/attach`, { calibrationRecordId: second.id }, "admin");
    expect(attached.statusCode).toBe(200);
    expect(await certificateUrlOf(second.id)).toBe(`${DOCUMENT_REFERENCE_PREFIX}${documentId}`);
  });
});

// ============================================================================
// § C — replacement, supersession and voiding: history is preserved, never overwritten
// ============================================================================

describe("C — replacement history", () => {
  it("C1 — a reissued certificate supersedes the original; both rows and both objects survive", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(17) });
    const original = await uploadThroughHttp(record.id, "c1-original");

    const reissuedBytes = Buffer.concat([Buffer.from("%PDF-1.7\nreissued certificate\n")]);
    const session = await service.createUploadSession(ADMIN, {
      ...pdfSession(record.id, "c1-reissue"),
      byteSize: reissuedBytes.byteLength,
      replacesDocumentId: original.documentId,
      supersededReason: "Lab reissued with a corrected serial number",
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const put = await service.putContent(ADMIN, session.documentId, reissuedBytes);
    expect(put.ok).toBe(true);

    const completed = await post(
      t.app,
      `/api/documents/${session.documentId}/complete-replacement`,
      { reason: "Lab reissued with a corrected serial number" },
      "admin"
    );
    expect(completed.statusCode).toBe(200);

    const rows = await t.db.query<{ id: string; is_current: boolean; replaced_by_document_id: string | null }>(
      "SELECT id, is_current, replaced_by_document_id FROM document WHERE id = ANY($1) ORDER BY created_at",
      [[original.documentId, session.documentId]]
    );
    const old = rows.rows.find((r) => r.id === original.documentId)!;
    const next = rows.rows.find((r) => r.id === session.documentId)!;
    expect(old.is_current).toBe(false);
    expect(old.replaced_by_document_id).toBe(session.documentId);
    expect(next.is_current).toBe(true);

    // The certificate now points at the reissue...
    expect(await certificateUrlOf(record.id)).toBe(`${DOCUMENT_REFERENCE_PREFIX}${session.documentId}`);
    // ...and the superseded BYTES are still there, unchanged. Superseded, not overwritten.
    const originalPath = (
      await t.db.query<{ blob_path: string }>("SELECT blob_path FROM document WHERE id = $1", [original.documentId])
    ).rows[0].blob_path;
    expect((await store.get(originalPath)).equals(PDF)).toBe(true);

    const chain = (
      await get(t.app, `/api/documents/${session.documentId}/history`, "admin")
    ).json() as { chain: ClientDocumentMetadata[] };
    expect(chain.chain.map((d) => d.id)).toEqual([original.documentId, session.documentId]);
  });

  it("C2 — the database refuses two current certificates for one calibration record", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(18) });
    const first = await uploadThroughHttp(record.id, "c2-a");

    // A second upload against the same record demotes the first rather than colliding.
    const second = await uploadThroughHttp(record.id, "c2-b");
    const current = await t.db.query<{ document_id: string }>(
      `SELECT document_id FROM calibration_document
        WHERE calibration_record_id = $1 AND is_current AND relationship_type = 'Certificate'`,
      [record.id]
    );
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0].document_id).toBe(second.documentId);

    // The partial unique index, asserted directly: forcing a second current row is refused.
    await expect(
      t.db.query("UPDATE calibration_document SET is_current = true WHERE calibration_record_id = $1 AND document_id = $2", [
        record.id,
        first.documentId,
      ])
    ).rejects.toThrow();
  });

  it("C3 — voiding a certificate keeps the row and the bytes, and the summary tells the truth", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(19) });
    const { documentId } = await uploadThroughHttp(record.id, "c3");
    const blobPath = (
      await t.db.query<{ blob_path: string }>("SELECT blob_path FROM document WHERE id = $1", [documentId])
    ).rows[0].blob_path;

    const voided = await post(
      t.app,
      `/api/documents/${documentId}/void`,
      { reason: "Attached to the wrong asset" },
      "admin"
    );
    expect(voided.statusCode).toBe(200);

    const row = (
      await t.db.query<{ is_current: boolean; void_reason: string; voided_by: string }>(
        "SELECT is_current, void_reason, voided_by FROM document WHERE id = $1",
        [documentId]
      )
    ).rows[0];
    expect(row.is_current).toBe(false);
    expect(row.void_reason).toBe("Attached to the wrong asset");
    expect(row.voided_by).toBe(ADMIN.upn);
    expect((await store.head(blobPath))?.byteSize).toBe(PDF.byteLength); // bytes preserved

    expect(await certificateUrlOf(record.id)).toBeNull();
    expect(await summaryOf(assetId)).toMatchObject({ certificateMissing: true, reason: "Voided" });
    // Voiding is never silent.
    const events = await t.db.query<{ payload: { reason: string } }>(
      "SELECT payload FROM outbox_event WHERE event_type = 'calibration.certificate_missing' AND aggregate_id = $1",
      [record.id]
    );
    expect(events.rows.map((r) => r.payload.reason)).toContain("Voided");

    // A voided document is not a second time voidable, and a reissue must replace the current one.
    const again = await post(t.app, `/api/documents/${documentId}/void`, { reason: "again" }, "admin");
    expect((again.json() as { code: string }).code).toBe("document.error.stateConflict");
  });
});

// ============================================================================
// § D — calibration semantics the documents lane must not disturb
// ============================================================================

describe("D — the record is the truth; the document is evidence about it", () => {
  it("D1 — a FAILED calibration still carries its certificate, and the fail result is preserved", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, {
      ...calDates(32),
      result: "Fail",
      certificatenumber: "CERT-FAIL",
    });
    const statusBefore = (
      await t.db.query<{ status: string }>("SELECT status FROM asset WHERE assetid = $1", [assetId])
    ).rows[0].status;

    const { documentId } = await uploadThroughHttp(record.id, "d1");
    const summary = await summaryOf(assetId);
    expect(summary).toMatchObject({ result: "Fail", certificateMissing: false, certificateDocumentId: documentId });

    // Attaching evidence of a failure changes no asset state — rule 4, rule 9.
    expect((await t.db.query<{ status: string }>("SELECT status FROM asset WHERE assetid = $1", [assetId])).rows[0].status).toBe(
      statusBefore
    );
  });

  it("D2 — back-filling an OLDER historical record does not make it the current calibration", async () => {
    const assetId = takeAsset();
    const current = await recordCalibration(assetId, {
      ...calDates(33),
      certificatenumber: "CERT-CURRENT",
    });
    await uploadThroughHttp(current.id, "d2-current");

    // Somebody now enters a 2019 certificate found in a filing cabinet.
    const historical = await recordCalibration(assetId, {
      ...calDates(2_500), // a certificate found in a filing cabinet, roughly seven years old
      certificatenumber: "CERT-2019",
    });
    await uploadThroughHttp(historical.id, "d2-historical");

    const summary = await summaryOf(assetId);
    expect(summary).toMatchObject({
      calibrationRecordId: current.id,
      calibrationDate: daysAgo(33),
      certificateNumber: "CERT-CURRENT",
      certificateMissing: false,
    });
    // The historical record keeps its own certificate — it is filed, not promoted.
    expect(await certificateUrlOf(historical.id)).not.toBeNull();
  });

  it("D3 — a RETIRED asset's certificates stay retrievable", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(20) });
    const { documentId } = await uploadThroughHttp(record.id, "d3");

    const retired = await submit(
      t.app,
      "/api/commands/Retire",
      { assetId, reason: "Obsolete", clientSubmissionId: newSubmissionId("retire-d3") },
      "admin"
    );
    expect(retired.ok).toBe(true);
    expect(
      (await t.db.query<{ lifecycle: string }>("SELECT lifecycle FROM asset WHERE assetid = $1", [assetId])).rows[0].lifecycle
    ).toBe("Retired");

    // Retirement ends the asset's service life, not the obligation to evidence its calibration.
    const content = await get(t.app, `/api/documents/${documentId}/content`, "admin");
    expect(content.statusCode).toBe(200);
    expect(Buffer.from(content.rawPayload).equals(PDF)).toBe(true);
  });
});

// ============================================================================
// § E — a document id is not a capability (WS-W7 § upload/download authorization)
// ============================================================================

describe("E — authorization on every request", () => {
  it("E1 — a Field User is refused the bytes, and is refused the authorization that precedes them", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(21) });
    const { documentId } = await uploadThroughHttp(record.id, "e1");

    const content = await get(t.app, `/api/documents/${documentId}/content`, "field");
    expect(content.statusCode).toBe(403);
    expect((content.json() as { code: string }).code).toBe("document.error.forbidden");

    const auth = await post(t.app, `/api/documents/${documentId}/download-authorization`, {}, "field");
    expect(auth.statusCode).toBe(403);
  });

  it("E2 — a Field User may know a certificate exists, and is told it cannot download it", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(22) });
    const { documentId } = await uploadThroughHttp(record.id, "e2");

    const res = await get(t.app, `/api/documents/${documentId}`, "field");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { metadata: ClientDocumentMetadata; canDownload: boolean };
    expect(body.canDownload).toBe(false);
    expect(body.metadata.originalFileName).toBe("certificate.pdf");
    expect(res.body).not.toContain("blobPath");
  });

  it("E3 — a Field User cannot open an upload session either", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(23) });
    const res = await post(t.app, "/api/documents/upload-sessions", pdfSession(record.id, "e3"), "field");
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("document.error.forbidden");
  });

  it("E4 — an Office Admin is scoped to its own office; a System Owner is not (assumption A-R5)", async () => {
    const other = await t.db.query<{ assetid: string; homeoffice: string }>(
      `SELECT assetid, homeoffice FROM asset
        WHERE lifecycle = 'Active' AND homeoffice IS NOT NULL AND homeoffice <> 'Ottawa'
          AND NOT EXISTS (SELECT 1 FROM calibration_record c WHERE c.asset = asset.assetid)
        ORDER BY assetid LIMIT 1`
    );
    const away = other.rows[0];
    expect(away?.assetid).toBeTruthy();
    expect(ADMIN.homeoffice).toBe("Ottawa");

    const record = await recordCalibration(away.assetid, { ...calDates(24) }, "owner");

    // The System Owner (global) can create and store it.
    const session = await service.createUploadSession(OWNER, pdfSession(record.id, "e4"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect((await service.putContent(OWNER, session.documentId, PDF)).ok).toBe(true);

    // The Ottawa Office Admin cannot read it...
    const asAdmin = await service.getContent(ADMIN, session.documentId);
    expect(asAdmin.ok).toBe(false);
    if (asAdmin.ok) return;
    expect(asAdmin.code).toBe("document.error.forbidden");

    // ...and the System Owner can.
    expect((await service.getContent(OWNER, session.documentId)).ok).toBe(true);
    // A Field User is refused regardless of office.
    expect((await service.getContent(FIELD, session.documentId)).ok).toBe(false);
  });

  it("E4b — a Field User cannot tell a real document id from an invented one", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(28) });
    const { documentId } = await uploadThroughHttp(record.id, "e4b");

    const real = await get(t.app, `/api/documents/${documentId}/content`, "field");
    const invented = await get(t.app, "/api/documents/00000000-0000-4000-8000-00000000dead/content", "field");

    // Identical status AND identical code. A 403-versus-404 pair would let anyone with a list of
    // guessed ids enumerate which certificates exist.
    expect(real.statusCode).toBe(invented.statusCode);
    expect((real.json() as { code: string }).code).toBe((invented.json() as { code: string }).code);
    expect(real.statusCode).toBe(403);

    // An administrator, who could legitimately be told, still gets the honest answer.
    const adminInvented = await get(t.app, "/api/documents/00000000-0000-4000-8000-00000000dead/content", "admin");
    expect((adminInvented.json() as { code: string }).code).toBe("document.error.notFound");
  });

  it("E5 — reconciliation is a System Owner report", async () => {
    expect((await get(t.app, "/api/documents/reconciliation", "field")).statusCode).toBe(403);
    expect((await get(t.app, "/api/documents/reconciliation", "admin")).statusCode).toBe(403);
    expect((await get(t.app, "/api/documents/reconciliation", "owner")).statusCode).toBe(200);
  });
});

// ============================================================================
// § F — database ↔ object-store reconciliation (the restore-mismatch report)
// ============================================================================

describe("F — reconciliation after a restore mismatch", () => {
  it("F1 — a healthy store and database reconcile clean", async () => {
    const report = await reconcileDocuments(t.db, store, { verifyHashes: true });
    expect(report.metadataWithoutObject).toHaveLength(0);
    expect(report.hashMismatch).toHaveLength(0);
    expect(report.checkedMetadataRows).toBeGreaterThan(0);
    expect(report.clean).toBe(true);
  });

  it("F2 — a document whose object is gone is reported, and its download fails honestly", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(25) });
    const session = await service.createUploadSession(ADMIN, pdfSession(record.id, "f2"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect((await service.putContent(ADMIN, session.documentId, PDF)).ok).toBe(true);

    // The database is restored to a point where the row exists; the object is not in the store.
    const blobPath = (
      await t.db.query<{ blob_path: string }>("SELECT blob_path FROM document WHERE id = $1", [session.documentId])
    ).rows[0].blob_path;
    await store.delete(blobPath);

    const report = await reconcileDocuments(t.db, store);
    expect(report.metadataWithoutObject.map((m) => m.documentId)).toContain(session.documentId);
    expect(report.clean).toBe(false);

    const download = await service.getContent(ADMIN, session.documentId);
    expect(download.ok).toBe(false);
    if (download.ok) return;
    expect(download.code).toBe("platform.error.dependency");
    expect(download.reason).toContain("reconciliation");

    // Restore the object so later assertions are about their own findings.
    await store.put(blobPath, PDF);
  });

  it("F3 — an object nobody has metadata for is reported, and never silently adopted", async () => {
    const strayPath = "Calibration/1999/01/00000000-0000-4000-8000-000000000999.pdf";
    await store.put(strayPath, PDF);

    const report = await reconcileDocuments(t.db, store);
    expect(report.objectWithoutMetadata).toContain(strayPath);
    // Reporting only — nothing was created, deleted or linked.
    expect(
      (await t.db.query<{ c: number }>("SELECT count(*)::int AS c FROM document WHERE blob_path = $1", [strayPath])).rows[0].c
    ).toBe(0);

    await store.delete(strayPath);
  });

  it("F4 — a stored object whose bytes drifted from the recorded hash is reported and refused", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(26) });
    const session = await service.createUploadSession(ADMIN, pdfSession(record.id, "f4"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect((await service.putContent(ADMIN, session.documentId, PDF)).ok).toBe(true);

    const blobPath = (
      await t.db.query<{ blob_path: string }>("SELECT blob_path FROM document WHERE id = $1", [session.documentId])
    ).rows[0].blob_path;
    await writeFile(path.join(documentRoot, blobPath), Buffer.concat([Buffer.from("%PDF-1.7\ntampered\n")]));

    const report = await reconcileDocuments(t.db, store, { verifyHashes: true });
    const finding = report.hashMismatch.find((h) => h.documentId === session.documentId);
    expect(finding?.expectedSha256).toBe(PDF_SHA);
    expect(finding?.actualSha256).not.toBe(PDF_SHA);

    // The one document somebody actually asks for gets the same check.
    const download = await service.getContent(ADMIN, session.documentId);
    expect(download.ok).toBe(false);
    if (download.ok) return;
    expect(download.code).toBe("document.error.hashMismatch");

    await store.delete(blobPath);
    await store.put(blobPath, PDF);
  });

  it("F5 — a failed upload's metadata is NOT a reconciliation finding, because no object was expected", async () => {
    const assetId = takeAsset();
    const record = await recordCalibration(assetId, { ...calDates(27) });
    const brokenService = new DocumentService(t.db, new BrokenDocumentStore());
    const session = await brokenService.createUploadSession(ADMIN, pdfSession(record.id, "f5"));
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect((await brokenService.putContent(ADMIN, session.documentId, PDF)).ok).toBe(false);

    // The Failed row was written against the broken container, so it is out of this store's
    // scope entirely — and even in scope it would not be `metadataWithoutObject`, which only
    // ever names `Stored` rows.
    const report = await reconcileDocuments(t.db, store, { verifyHashes: true });
    expect(report.metadataWithoutObject.map((m) => m.documentId)).not.toContain(session.documentId);
  });
});
