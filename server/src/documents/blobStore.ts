/**
 * `BlobDocumentStore` — the Azure implementation of the same interface, written now, wired
 * later, and adding **no dependency** to `server/package.json`.
 *
 * WHY IT EXISTS BEFORE AZURE DOES. A-DOC (specs/_planning/BUILD-FREEZE.md) says Blob is "a second
 * implementation of the same interface", and the value of that claim is zero until somebody has
 * actually written the second implementation and found out whether the interface survives it.
 * It does — with one honest consequence, recorded below in § The SAS question. Writing it now
 * also proves the negative that matters most: nothing outside this directory needs to change
 * when the store changes, because nothing outside this directory ever sees a path, a container
 * or a credential.
 *
 * WHY NO SDK. CLAUDE.md § Ask before doing: "Creating production Azure resources or incurring
 * material cloud cost", and the brief for this lane is explicit — no Azure resource, no Azure
 * SDK dependency. So this class talks to a PORT, `BlobContainerClient`, which is a five-method
 * interface describing the subset of `@azure/storage-blob`'s `ContainerClient` that a document
 * store needs. Adapting the real SDK to it is a dozen lines in the composition root the day a
 * container exists:
 *
 *   const container = new ContainerClient(url, new DefaultAzureCredential());
 *   const port: BlobContainerClient = {
 *     upload: (p, b) => container.getBlockBlobClient(p).upload(b, b.byteLength, {
 *       conditions: { ifNoneMatch: "*" } }).then(() => undefined),
 *     download: (p) => container.getBlockBlobClient(p).downloadToBuffer(),
 *     properties: (p) => container.getBlockBlobClient(p).getProperties()
 *       .then(r => ({ contentLength: r.contentLength ?? 0 }), e => (e.statusCode === 404 ? null : Promise.reject(e))),
 *     remove: (p) => container.getBlockBlobClient(p).deleteIfExists().then(() => undefined),
 *     listPaths: async (prefix) => { … for await (const b of container.listBlobsFlat({ prefix })) … },
 *   };
 *
 * § THE SAS QUESTION — the one place the interface deliberately does NOT stretch.
 * `contracts/document-blob.md` § Upload initiation prefers a "user-delegation SAS scoped to one
 * blob path, minted with managed identity", and offers `proxyPut` as the alternative "to keep
 * keys off the client entirely". This lane implements **proxy only**, for both stores, because:
 *   - a SAS is a credential, and `DocumentStore` has no method that returns one *by design*
 *     (store.ts § What is absent from the interface);
 *   - a user-delegation SAS needs a managed identity and a real storage account, which is
 *     exactly the Azure resource this pass must not create;
 *   - proxying is what the local store does anyway, so one code path serves both and the
 *     authorization check sits in front of every single byte (contract § Rules 4).
 * Adding SAS later is a `mintUploadUrl` method on a NARROWER, Azure-only interface plus an
 * authorization decision in `service.ts` — not a change to `DocumentStore`. Recorded so the
 * choice is visible rather than discovered.
 *
 * § IMMUTABILITY. `upload` is called with an if-none-match precondition in the adapter sketch
 * above, giving the same refuse-to-overwrite guarantee `LocalDocumentStore` gets from `wx`.
 * A store that silently overwrites would break WS-W7's "supersedes rather than overwrites"
 * requirement at the storage layer, underneath every check the service makes.
 */
import { sha256Of } from "./localStore";
import {
  assertSafePath,
  DocumentStoreError,
  ObjectNotFoundError,
  type DocumentStore,
  type ObjectHead,
  type StoredObject,
} from "./store";

/**
 * The subset of an Azure `ContainerClient` a document store needs. Deliberately smaller than the
 * SDK's surface: nothing here can enumerate containers, rotate keys, change access level or mint
 * a token, so an adapter cannot accidentally hand this class more authority than it should have.
 */
export interface BlobContainerClient {
  /** Must refuse to overwrite an existing blob — see § IMMUTABILITY. */
  upload(blobPath: string, bytes: Buffer): Promise<void>;
  download(blobPath: string): Promise<Buffer>;
  /** `null` when the blob does not exist; never throws for absence. */
  properties(blobPath: string): Promise<{ contentLength: number } | null>;
  remove(blobPath: string): Promise<void>;
  listPaths(prefix?: string): Promise<string[]>;
}

export class BlobDocumentStore implements DocumentStore {
  readonly kind = "azure-blob";

  constructor(
    readonly container: string,
    private readonly client: BlobContainerClient
  ) {}

  async put(objectPath: string, bytes: Buffer): Promise<StoredObject> {
    assertSafePath(objectPath);
    try {
      await this.client.upload(objectPath, bytes);
    } catch (err) {
      throw new DocumentStoreError(`Uploading "${objectPath}" to ${this.container} failed: ${message(err)}`, err);
    }
    // Hashed from the bytes we sent, exactly as the local store does, so `sha256` means the same
    // thing in both implementations and reconciliation compares like with like.
    return { container: this.container, path: objectPath, byteSize: bytes.byteLength, sha256: sha256Of(bytes) };
  }

  async get(objectPath: string): Promise<Buffer> {
    assertSafePath(objectPath);
    try {
      return await this.client.download(objectPath);
    } catch (err) {
      if (isBlobNotFound(err)) throw new ObjectNotFoundError(objectPath);
      throw new DocumentStoreError(`Downloading "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async head(objectPath: string): Promise<ObjectHead | null> {
    assertSafePath(objectPath);
    try {
      const props = await this.client.properties(objectPath);
      return props ? { path: objectPath, byteSize: props.contentLength } : null;
    } catch (err) {
      if (isBlobNotFound(err)) return null;
      throw new DocumentStoreError(`Reading properties of "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async delete(objectPath: string): Promise<void> {
    assertSafePath(objectPath);
    try {
      await this.client.remove(objectPath);
    } catch (err) {
      if (isBlobNotFound(err)) return;
      throw new DocumentStoreError(`Deleting "${objectPath}" failed: ${message(err)}`, err);
    }
  }

  async list(prefix?: string): Promise<string[]> {
    if (prefix) assertSafePath(prefix);
    try {
      return (await this.client.listPaths(prefix)).sort();
    } catch (err) {
      throw new DocumentStoreError(`Listing ${this.container} failed: ${message(err)}`, err);
    }
  }
}

/**
 * The store the server gets when `AMS_DOCUMENT_STORE=blob` but no container client has been
 * composed — i.e. right now, on every machine.
 *
 * It fails LOUDLY on the first call rather than silently falling back to local storage. Silent
 * fallback is how a production certificate ends up on a container app's ephemeral disk; the
 * parked Power Platform adapter made exactly this mistake once and CLAUDE.md records the fix
 * ("`VITE_AMS_BACKEND=dataverse` now throws instead of silently falling back to mock").
 */
export function unconfiguredBlobClient(reason = "no Azure Blob container is configured"): BlobContainerClient {
  const fail = (): never => {
    throw new DocumentStoreError(
      `Azure Blob document store selected but ${reason}. Compose a BlobContainerClient, or use ` +
        `AMS_DOCUMENT_STORE=local (assumption A-DOC).`
    );
  };
  return {
    upload: async () => fail(),
    download: async () => fail(),
    properties: async () => fail(),
    remove: async () => fail(),
    listPaths: async () => fail(),
  };
}

/** Azure returns 404 with `statusCode`/`code`; adapters may surface either. */
function isBlobNotFound(err: unknown): boolean {
  const e = err as { statusCode?: number; code?: string };
  return e?.statusCode === 404 || e?.code === "BlobNotFound";
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
