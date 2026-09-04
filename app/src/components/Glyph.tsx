/**
 * Stroke icons from `docs/mockups/ams-ui/js/app.js` (`ICO` / `CAT_ICON`).
 * Not a third-party set — the mockup already draws these, and the app had ad-hoc copies.
 */
import type { ReactNode } from "react";

const ICONS = {
  home: (
    <>
      <path d="M4 11 12 4l8 7v9H4z" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  out: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M10 5H5v14h14v-5" />
    </>
  ),
  back: <path d="M8 7v10l8-5z" />,
  xfer: (
    <>
      <path d="M7 8h12M15 4l4 4-4 4" />
      <path d="M17 16H5m4 4-4-4 4-4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 3 19h18z" />
      <path d="M12 9v5" />
      <path d="M12 16.5h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
  cam: (
    <>
      <path d="M4 8h4l1.5-2h5L16 8h4v11H4z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </>
  ),
  box: (
    <>
      <path d="M4 8 12 4l8 4-8 4z" />
      <path d="M4 8v8l8 4 8-4V8" />
      <path d="M12 12v8" />
    </>
  ),
  wave: <path d="M4 14c2-6 4 6 6 0s4 6 6 0 4 6 6 0" />,
  mic: (
    <>
      <rect x="9" y="4" width="6" height="10" rx="3" />
      <path d="M6 12a6 6 0 0 0 12 0M12 18v3" />
    </>
  ),
  drill: (
    <>
      <path d="M4 10h10l3 3v4H4z" />
      <path d="M17 13h3" />
    </>
  ),
  tri: <path d="M12 4 4 19h16z" />,
  radio: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M8 8V5m8 8h.01" />
    </>
  ),
  cam2: (
    <>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  wind: (
    <>
      <path d="M4 10h11a3 3 0 1 0-3-3" />
      <path d="M4 14h14a3 3 0 1 1-3 3" />
    </>
  ),
  crate: (
    <>
      <rect x="4" y="6" width="16" height="13" rx="1" />
      <path d="M4 10h16" />
    </>
  ),
  cal: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 11h16" />
    </>
  ),
  chev: <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5 9.5 17 19 7" />,
  scan: (
    <>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20H8" />
      <path d="M16 20h2.5a1.5 1.5 0 0 0 1.5-1.5V16" />
      <path d="M6 12h12" />
    </>
  ),
  x: <path d="M7 7l10 10M17 7 7 17" />,
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof ICONS;

export function Glyph({
  name,
  size = 20,
  className,
}: {
  name: GlyphName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`ams-ico${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
