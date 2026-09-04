import { useLocation, useNavigate } from "react-router-dom";
import { useChrome } from "../chrome/PageChrome";
import { initials } from "../features/home/homeModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { t } from "../i18n";

const ROOTS = new Set(["/", "/search", "/calibration", "/more"]);

function defaultsFor(pathname: string): { title: string; subtitle?: string } {
  if (pathname.startsWith("/asset/")) {
    return { title: decodeURIComponent(pathname.split("/")[2] ?? t("app.title")) };
  }
  if (pathname.startsWith("/search")) return { title: t("nav.assets"), subtitle: t("assets.subtitle") };
  if (pathname.startsWith("/calibration")) return { title: t("nav.dueSoon"), subtitle: t("calibration.subtitle") };
  if (pathname.startsWith("/more")) return { title: t("nav.more"), subtitle: t("more.subtitle") };
  if (pathname.startsWith("/checkout")) return { title: t("checkout.title") };
  if (pathname.startsWith("/return")) return { title: t("return.title") };
  if (pathname.startsWith("/transfer")) return { title: t("transfer.title") };
  if (pathname.startsWith("/deploy")) return { title: t("deploy.title") };
  if (pathname.startsWith("/recover")) return { title: t("recover.title") };
  if (pathname.startsWith("/sites") || pathname.startsWith("/site/")) return { title: t("site.title") };
  if (pathname.startsWith("/admin")) return { title: t("admin.title") };
  if (pathname.startsWith("/reports")) return { title: t("reports.title") };
  if (pathname.startsWith("/needs-attention")) return { title: t("offline.needsAttention.title") };
  return { title: t("app.title") };
}

export function AppHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const override = useChrome();
  const { user } = useCurrentUser();
  const fallback = defaultsFor(pathname);
  const title = override.title ?? fallback.title;
  const subtitle = override.subtitle ?? fallback.subtitle;
  const isRoot = ROOTS.has(pathname);

  return (
    <header className="ams-header">
      {isRoot ? (
        <span className="ams-mark" aria-hidden>
          E
        </span>
      ) : (
        <button type="button" className="ams-back" onClick={() => navigate(-1)} aria-label={t("common.back")}>
          <svg className="ams-ico ams-ico-sm" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6 9 12l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("common.back")}
        </button>
      )}

      <span className="ams-header-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </span>

      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          className="ams-icon-btn"
          aria-label={t("home.search.open")}
          onClick={() => navigate("/search")}
        >
          <svg className="ams-ico ams-ico-sm" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m20 20-3.6-3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <button type="button" className="ams-avatar" aria-label={t("nav.more")} onClick={() => navigate("/more")}>
          {user ? initials(user.displayName) : "—"}
        </button>
      </span>
    </header>
  );
}
