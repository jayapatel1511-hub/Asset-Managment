/**
 * The one place that chooses a backend. Every screen imports `backend` from here — never
 * api/mock or api/http directly.
 *
 * Default is mock. Set VITE_AMS_BACKEND=http to talk to the TypeScript API in server/ over
 * in-process PostgreSQL — app/.env.localapi sets it for `vite --mode localapi`.
 *
 * LEGACY-POWER-PLATFORM: `dataverse` was a third option here. It is **parked** (2026-09-03) —
 * Dataverse is no longer the production system of record, so the adapter is no longer imported
 * and no Dataverse code reaches the bundle at all. `api/dataverse/index.ts` is kept on disk as
 * the record of the interface it would have had. Selecting it now fails loudly rather than
 * silently falling back to mock, because a silent fallback to mock data is exactly the kind of
 * thing that would ship.
 */
import type { AmsBackend } from "./AmsBackend";
// Local POC: the TypeScript API in server/ over in-process PostgreSQL. Selected with
// VITE_AMS_BACKEND=http — app/.env.localapi sets it for `vite --mode localapi`.
import { HttpAmsBackend } from "./http";
import { MockAmsBackend } from "./mock";

const selected = import.meta.env.VITE_AMS_BACKEND ?? "mock";

if (selected === "dataverse") {
  throw new Error(
    "VITE_AMS_BACKEND=dataverse is parked: Dataverse is not the production backend " +
      "(see CLAUDE.md, 'Parked — Power Platform'). Use 'mock' or 'http'.",
  );
}

export const backend: AmsBackend = selected === "http" ? new HttpAmsBackend() : new MockAmsBackend();
export * from "./types";
export * from "./AmsBackend";
