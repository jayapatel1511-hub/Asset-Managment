import type { ReactNode } from "react";

export function Chip({
  on,
  onClick,
  children,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`ams-chip${on ? " on" : ""}`} aria-pressed={on ?? false} onClick={onClick}>
      {children}
    </button>
  );
}
