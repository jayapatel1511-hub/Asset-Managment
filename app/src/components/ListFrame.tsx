import type { ReactNode } from "react";

export function ListFrame({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="ams-list">{children}</div>;
}
