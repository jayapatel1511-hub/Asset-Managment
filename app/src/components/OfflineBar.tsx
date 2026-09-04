import { useEffect, useState } from "react";
import { t } from "../i18n";
import { cacheFreshness, getOfflineRuntime } from "../offline";
import { cacheStatusParts } from "../offline/cacheStatus";

const POLL_MS = 4000;

export function OfflineBar() {
  const [online, setOnline] = useState(navigator.onLine);
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const db = getOfflineRuntime()?.db;
      if (!db) {
        if (!cancelled) {
          setAgeMs(null);
          setLastSyncIso(null);
        }
        return;
      }
      const freshness = await cacheFreshness(db);
      if (cancelled) return;
      setAgeMs(freshness?.ageMs ?? null);
      setLastSyncIso(freshness?.lastSyncIso ?? null);
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online]);

  const line = cacheStatusParts({
    online,
    ageMs,
    lastSyncIso,
    offlineLabel: t("home.offline"),
    cacheAgeLabel: (age) => t("home.cacheAge", { age }),
    lastSyncLabel: (when) => t("home.lastSync", { when }),
  });

  if (!line) return null;
  return (
    <div className={online ? "ams-banner ams-banner-info" : "ams-offline"} role="status">
      {line}
    </div>
  );
}
