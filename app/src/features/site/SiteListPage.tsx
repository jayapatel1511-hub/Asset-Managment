import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Checkbox, Spinner, Text, Title2, tokens } from "@fluentui/react-components";
import { LocationRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import type { Location } from "../../api/types";
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
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("site.title")}</Title2>
      <Button appearance="primary" icon={<LocationRegular />} onClick={() => navigate("/deploy")}>
        {t("deploy.title")}
      </Button>
      <Checkbox label={t("site.filterCurrentOnly")} checked={currentOnly} onChange={(_, d) => setCurrentOnly(Boolean(d.checked))} />

      {visible.length === 0 && <Text style={{ color: tokens.colorNeutralForeground3 }}>{t("site.listEmpty")}</Text>}

      {visible.map((r) => (
        <div
          key={r.location.id}
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/site/${encodeURIComponent(r.location.name)}`)}
          onKeyDown={(e) => e.key === "Enter" && navigate(`/site/${encodeURIComponent(r.location.name)}`)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 4px",
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
            cursor: "pointer",
          }}
        >
          <Text weight="semibold">{r.location.name}</Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {r.currentCount > 0 ? `${r.currentCount} current` : `${r.totalCount} past`}
          </Text>
        </div>
      ))}
    </div>
  );
}
