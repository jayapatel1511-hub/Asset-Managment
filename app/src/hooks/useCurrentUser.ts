import { useEffect, useState } from "react";
import { backend, isAdmin, type CurrentUser } from "../api";

/** Re-reads on every mount so the dev-only role switcher (see components/RoleSwitcher.tsx)
 * takes effect without a full page reload. */
export function useCurrentUser(): { user: CurrentUser | null; admin: boolean; reload: () => void } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    backend.getCurrentUser().then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { user, admin: user ? isAdmin(user) : false, reload: () => setTick((n) => n + 1) };
}
