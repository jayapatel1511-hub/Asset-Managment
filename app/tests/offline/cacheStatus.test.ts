import { describe, expect, it } from "vitest";
import { cacheStatusParts, formatCacheAge, formatLastSyncClock } from "../../src/offline/cacheStatus";

describe("FR-027 cache status copy", () => {
  it("formats ages a technician can read at a glance", () => {
    expect(formatCacheAge(1_000)).toBe("just now");
    expect(formatCacheAge(5 * 60_000)).toBe("5 min");
    expect(formatCacheAge(3 * 60 * 60_000)).toBe("3h");
    expect(formatCacheAge(2 * 24 * 60 * 60_000)).toBe("2d");
  });

  it("prints last sync as a UTC clock, not a locale-dependent string", () => {
    expect(formatLastSyncClock("2026-09-03T14:32:00.000Z")).toBe("14:32 UTC");
  });

  it("shows cache age and last sync when online, and prefixes the offline banner when not", () => {
    const online = cacheStatusParts({
      online: true,
      ageMs: 5 * 60_000,
      lastSyncIso: "2026-09-03T14:32:00.000Z",
      offlineLabel: "Offline",
      cacheAgeLabel: (age) => `Cached ${age} ago`,
      lastSyncLabel: (when) => `Last sync ${when}`,
    });
    expect(online).toBe("Cached 5 min ago · Last sync 14:32 UTC");

    const offline = cacheStatusParts({
      online: false,
      ageMs: 5 * 60_000,
      lastSyncIso: "2026-09-03T14:32:00.000Z",
      offlineLabel: "Offline — showing the last data this device cached",
      cacheAgeLabel: (age) => `Cached ${age} ago`,
      lastSyncLabel: (when) => `Last sync ${when}`,
    });
    expect(offline).toContain("Offline");
    expect(offline).toContain("Cached 5 min ago");
    expect(offline).toContain("Last sync 14:32 UTC");
  });

  it("stays silent when online with nothing cached, so the bar does not invent a sync", () => {
    expect(
      cacheStatusParts({
        online: true,
        ageMs: null,
        lastSyncIso: null,
        offlineLabel: "Offline",
        cacheAgeLabel: (age) => age,
        lastSyncLabel: (when) => when,
      }),
    ).toBeNull();
  });
});
