/**
 * FR-027 copy: cache age and last successful sync, as a technician reads them.
 * Pure so the OfflineBar does not need a React testing library to pin the wording.
 */
export function formatCacheAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/** Clock fragment of an ISO timestamp, UTC, so the line does not depend on the device locale. */
export function formatLastSyncClock(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return `${new Date(parsed).toISOString().slice(11, 16)} UTC`;
}

export function cacheStatusParts(input: {
  online: boolean;
  ageMs: number | null;
  lastSyncIso: string | null;
  offlineLabel: string;
  cacheAgeLabel: (age: string) => string;
  lastSyncLabel: (when: string) => string;
}): string | null {
  const bits: string[] = [];
  if (!input.online) bits.push(input.offlineLabel);
  if (input.ageMs != null) bits.push(input.cacheAgeLabel(formatCacheAge(input.ageMs)));
  if (input.lastSyncIso) bits.push(input.lastSyncLabel(formatLastSyncClock(input.lastSyncIso)));
  if (bits.length === 0) return null;
  return bits.join(" · ");
}
