import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useScan } from "../chrome/ScanContext";
import { usePendingSyncIds } from "../hooks/usePendingSync";
import { t } from "../i18n";

interface NavItem {
  to?: string;
  label: string;
  icon: ReactNode;
  action?: "scan";
  badge?: boolean;
}

const ITEMS: NavItem[] = [
  { to: "/", label: t("nav.home"), icon: <HomeIcon /> },
  { to: "/search", label: t("nav.assets"), icon: <AssetsIcon /> },
  { action: "scan", label: t("nav.scan"), icon: <ScanIcon /> },
  { to: "/calibration", label: t("nav.dueSoon"), icon: <CalIcon /> },
  { to: "/more", label: t("nav.more"), icon: <MoreIcon />, badge: true },
];

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 8 8 2.8 13.5 8V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.2 14V9.4h3.6V14" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function AssetsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.2h10v8.2H3zM3 7.2h10M8 4.2v8.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2.6 5.6V3.4a.8.8 0 0 1 .8-.8h2.2M13.4 5.6V3.4a.8.8 0 0 0-.8-.8h-2.2M2.6 10.4v2.2a.8.8 0 0 0 .8.8h2.2M13.4 10.4v2.2a.8.8 0 0 1-.8.8h-2.2M4 8h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.4 6.4h11.2M5.2 2.4v2.2M10.8 2.4v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="8" r="1.15" fill="currentColor" />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
      <circle cx="12" cy="8" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function BottomNav() {
  const { openScan } = useScan();
  const pending = usePendingSyncIds().size;

  return (
    <nav className="ams-nav" aria-label="Primary">
      {ITEMS.map((item) =>
        item.action === "scan" ? (
          <button key="scan" type="button" className="ams-nav-item" onClick={openScan}>
            {item.icon}
            {item.label}
          </button>
        ) : (
          <NavLink
            key={item.to}
            to={item.to!}
            end={item.to === "/"}
            className={({ isActive }) =>
              `ams-nav-item${isActive ? " on" : ""}${item.badge && pending > 0 ? " ams-nav-badge" : ""}`
            }
            {...(item.badge && pending > 0 ? { "data-n": pending > 9 ? "9+" : String(pending) } : {})}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}
