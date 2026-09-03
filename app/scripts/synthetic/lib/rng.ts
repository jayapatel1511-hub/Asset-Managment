/// <reference types="node" />
/**
 * Seeded pseudo-random source for the synthetic fleet generator (feature 007, FR-052: the same
 * seed and parameters must produce a byte-identical dataset). sfc32, seeded from a SHA-256 of the
 * seed string — small, fast, and deterministic across Node versions because it uses only 32-bit
 * integer arithmetic and no platform Math.random.
 *
 * `fork(label)` derives an independent stream so that adding a new random decision in one part of
 * the simulation does not shift every decision made elsewhere — it keeps regenerations stable
 * under small generator changes as far as possible.
 */
import { createHash } from "node:crypto";

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
    const h = createHash("sha256").update(seed).digest();
    this.a = h.readUInt32LE(0);
    this.b = h.readUInt32LE(4);
    this.c = h.readUInt32LE(8);
    this.d = h.readUInt32LE(12);
    for (let i = 0; i < 12; i++) this.next(); // warm up
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  fork(label: string): Rng {
    return new Rng(`${this.seed}/${label}`);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty array");
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted choice over [item, weight] pairs. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }

  /** Weighted choice over a {key: weight} record. */
  weightedKey(weights: Record<string, number>): string {
    return this.weighted(Object.entries(weights));
  }

  normal(mu = 0, sigma = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Lognormal with the given median and log-sigma; clipped to [min, max] when given. */
  lognormal(median: number, sigma: number, min = 0, max = Number.POSITIVE_INFINITY): number {
    const x = median * Math.exp(sigma * this.normal());
    return Math.min(max, Math.max(min, x));
  }

  /** Exponential with the given mean. */
  exp(mean: number): number {
    let u = 0;
    while (u === 0) u = this.next();
    return -Math.log(u) * mean;
  }

  /** Poisson-distributed count for a small expectation (Knuth). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }

  /** Stochastic rounding: 2.3 -> 2 with p=0.7, 3 with p=0.3. Keeps expectations exact. */
  round(x: number): number {
    const f = Math.floor(x);
    return f + (this.chance(x - f) ? 1 : 0);
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
