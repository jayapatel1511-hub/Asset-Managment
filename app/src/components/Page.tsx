import type { ReactNode } from "react";

/** Shared 16 px page inset from the accepted Field mockup. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="ams-page">{children}</div>;
}
