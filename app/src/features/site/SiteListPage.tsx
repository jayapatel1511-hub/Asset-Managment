import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Location } from "../../api/types";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { t } from "../../i18n";

interface SiteRow {
  location: Location;
  currentCount: number;
  totalCount: number;
}

export function SiteListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [currentOnly, setCurrentOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sites = await backend.listSites();
      const withCounts = await Promise.all(
        sites.map(async (location) => {
          const installations = await backend.getSiteInstallations(location.name);
          return { location, currentCount: installations.filter((i) => i.end === null).length, totalCount: installations.length };
        })
      );
      if (!cancelled) setRows(withCounts);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;

  const visible = currentOnly ? rows.filter((r) => r.currentCount > 0) : rows;

  return (
    <Page>
      <button type="button" className="ams-btn ams-btn-primary" onClick={() => navigate("/deploy")}>
        {t("deploy.title")}
      </button>
      <div className="ams-chips">
        <Chip on={!currentOnly} onClick={() => setCurrentOnly(false)}>
          {t("common.all")}
        </Chip>
        <Chip on={currentOnly} onClick={() => setCurrentOnly(true)}>
          {t("site.filterCurrentOnly")}
        </Chip>
      </div>

      {visible.length === 0 ? (
        <EmptyState>{t("site.listEmpty")}</EmptyState>
      ) : (
        <ListFrame>
          {visible.map((r) => (
            <button
              key={r.location.id}
              type="button"
              className="ams-asset-row"
              onClick={() => navigate(`/site/${encodeURIComponent(r.location.name)}`)}
            >
              <span className="meta">
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {r.location.name}
                </span>
                <div className="sub">{r.currentCount > 0 ? `${r.currentCount} current` : `${r.totalCount} past`}</div>
              </span>
            </button>
          ))}
        </ListFrame>
      )}
    </Page>
  );
}
