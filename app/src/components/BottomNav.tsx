import { tokens } from "@fluentui/react-components";
import {
  ArrowExportRegular,
  ArrowImportRegular,
  CalendarClockRegular,
  SearchRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { t } from "../i18n";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { to: "/", label: t("nav.search"), icon: <SearchRegular /> },
  { to: "/calibration", label: t("nav.calibration"), icon: <CalendarClockRegular /> },
  { to: "/checkout", label: t("nav.checkout"), icon: <ArrowExportRegular /> },
  { to: "/return", label: t("nav.return"), icon: <ArrowImportRegular /> },
  { to: "/admin", label: t("nav.admin"), icon: <SettingsRegular />, adminOnly: true },
];

export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);
  return (
    <nav
      style={{
        position: "sticky",
        bottom: 0,
        display: "flex",
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        background: tokens.colorNeutralBackground1,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          style={({ isActive }) => ({
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            padding: "8px 0",
            textDecoration: "none",
            color: isActive ? tokens.colorBrandForeground1 : tokens.colorNeutralForeground3,
            fontSize: 11,
          })}
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
