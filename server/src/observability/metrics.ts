/**
 * In-process request counters (FR-046). A collector and Azure Monitor come with hosting (FR-039);
 * until then the running process exposes a JSON snapshot with no row data and no secrets.
 */
export interface MetricsSnapshot {
  requests: number;
  errors: number;
  byStatus: Record<string, number>;
  uptimeSeconds: number;
}

export class ProcessMetrics {
  private requests = 0;
  private errors = 0;
  private readonly byStatus: Record<string, number> = {};

  note(statusCode: number): void {
    this.requests += 1;
    if (statusCode >= 500) this.errors += 1;
    const bucket = `${Math.floor(statusCode / 100)}xx`;
    this.byStatus[bucket] = (this.byStatus[bucket] ?? 0) + 1;
  }

  snapshot(now = process.uptime()): MetricsSnapshot {
    return {
      requests: this.requests,
      errors: this.errors,
      byStatus: { ...this.byStatus },
      uptimeSeconds: Math.round(now),
    };
  }

  reset(): void {
    this.requests = 0;
    this.errors = 0;
    for (const key of Object.keys(this.byStatus)) delete this.byStatus[key];
  }
}

export const processMetrics = new ProcessMetrics();
