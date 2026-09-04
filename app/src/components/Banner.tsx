import type { ReactNode } from "react";

export function Banner({
  intent,
  children,
}: {
  intent: "warn" | "ok" | "err" | "info";
  children: ReactNode;
}) {
  return (
    <div className={`ams-banner ams-banner-${intent}`} role="status">
      {children}
    </div>
  );
}
