import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Bottom sheet from `docs/mockups/ams-ui/` — used in place of Fluent Dialog. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const host = document.querySelector(".ams-app") ?? document.body;
  return createPortal(
    <div className="ams-overlay" onClick={onClose} role="presentation">
      <div
        className="ams-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ams-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ams-sheet-title">{title}</h2>
        {children}
        {footer && <div className="ams-sheet-actions">{footer}</div>}
      </div>
    </div>,
    host,
  );
}
