/// <reference types="node" />
/**
 * Deterministic surrogate identifiers (FR-052: byte-identical regeneration includes every id).
 *
 * RFC 4122 version-5 UUIDs (SHA-1 of namespace + name), the same family the migration uses
 * (`stable_guid` in migration/04_load.py uses uuid5 too), so a synthetic row's id is
 * indistinguishable in form from a migrated one while never colliding with it: the namespace is
 * derived from the seed and the string "ams-synthetic", and the migration's namespace is
 * NAMESPACE_URL with "ams://" names.
 */
import { createHash } from "node:crypto";

const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(b: Buffer): string {
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuid5(namespace: string, name: string): string {
  const hash = createHash("sha1").update(uuidToBytes(namespace)).update(name, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

export class IdFactory {
  private readonly ns: string;
  private counters = new Map<string, number>();

  constructor(seed: string) {
    this.ns = uuid5(NAMESPACE_URL, `ams-synthetic://${seed}`);
  }

  /** Next sequential id in a named series: deterministic given creation order. */
  next(series: string): string {
    const n = (this.counters.get(series) ?? 0) + 1;
    this.counters.set(series, n);
    return uuid5(this.ns, `${series}/${n}`);
  }

  /** Id for a naturally keyed row (asset by tag, project by number, location by name). */
  keyed(series: string, key: string): string {
    return uuid5(this.ns, `${series}:${key}`);
  }

  count(series: string): number {
    return this.counters.get(series) ?? 0;
  }
}

/** Luhn check digit over a numeric string. */
export function luhnCheckDigit(digits: string): string {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}
