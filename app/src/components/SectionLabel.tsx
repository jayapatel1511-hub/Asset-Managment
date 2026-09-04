import type { ReactNode } from "react";

export function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="ams-sec">
      <span className="ams-sec-label">{children}</span>
      {count != null && <span className="ams-sec-count">{count}</span>}
      <span className="ams-sec-rule" />
    </div>
  );
}
