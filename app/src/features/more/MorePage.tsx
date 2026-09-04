import { useNavigate } from "react-router-dom";
import { Glyph } from "../../components/Glyph";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { usePageChrome } from "../../chrome/PageChrome";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { DevRoleSwitcher } from "../../devStandins";
import { t, type StringKey } from "../../i18n";

interface Row {
  label: StringKey;
  to?: string;
  meta?: string;
  adminOnly?: boolean;
}

const ROWS: Row[] = [
  { label: "site.title", to: "/sites" },
  { label: "offline.needsAttention.title", to: "/needs-attention" },
  { label: "reports.title", to: "/reports" },
  { label: "admin.title", to: "/admin", adminOnly: true },
  { label: "admin.newAsset", to: "/admin/new-asset", adminOnly: true },
  { label: "admin.reference.title", to: "/admin/reference", adminOnly: true },
  { label: "dm.title", to: "/data-management" },
  { label: "more.reservations", meta: t("more.comingSoon") },
  { label: "more.settings", meta: t("more.comingSoon") },
];

export function MorePage() {
  const { admin, reload } = useCurrentUser();
  const navigate = useNavigate();
  usePageChrome({ title: t("nav.more"), subtitle: t("more.subtitle") });

  const rows = ROWS.filter((row) => !row.adminOnly || admin);

  return (
    <Page>
      <div className="ams-list ams-more">
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            className="row"
            disabled={!row.to}
            onClick={() => row.to && navigate(row.to)}
          >
            <span>{t(row.label)}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {row.meta && <span className="muted" style={{ fontSize: 12 }}>{row.meta}</span>}
              {row.to && <Glyph name="chev" size={16} className="ams-ico-sm" />}
            </span>
          </button>
        ))}
      </div>

      <section>
        <SectionLabel>{t("admin.roleSwitcher")}</SectionLabel>
        <DevRoleSwitcher onChange={reload} />
      </section>
    </Page>
  );
}
