/**
 * The one place that chooses a backend. Every screen imports `backend` from here — never
 * api/mock or api/dataverse directly (build-order Phase C DoD: the app runs end to end on mock
 * with zero Dataverse code paths reachable, which this file is what makes true: importing
 * "./dataverse" is the only way that module's code ever executes, and it only happens when
 * VITE_AMS_BACKEND=dataverse).
 *
 * Default is mock. Set VITE_AMS_BACKEND=dataverse in app/.env.local to switch — that file does
 * not exist in this repo (no tenant to point it at yet) and is gitignored if created.
 */
import type { AmsBackend } from "./AmsBackend";
// DATAVERSE-ONLY import — the class body only throws until a real implementation is written
// (see api/dataverse/index.ts's header), so importing it is safe; only *constructing* and
// *calling* it is gated on VITE_AMS_BACKEND below, which is what keeps it unreachable by default.
import { DataverseAmsBackend } from "./dataverse";
// Local POC: the TypeScript API in server/ over in-process PostgreSQL. Selected with
// VITE_AMS_BACKEND=http — app/.env.localapi sets it for `vite --mode localapi`.
import { HttpAmsBackend } from "./http";
import { MockAmsBackend } from "./mock";

const selected = import.meta.env.VITE_AMS_BACKEND ?? "mock";

export const backend: AmsBackend =
  selected === "dataverse" ? new DataverseAmsBackend() : selected === "http" ? new HttpAmsBackend() : new MockAmsBackend();
export * from "./types";
export * from "./AmsBackend";
