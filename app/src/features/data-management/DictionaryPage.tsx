import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import type { DictionaryCoverageReport, DictionaryPage } from "../../../../packages/contracts/src/dataManagement";
import { usePageChrome } from "../../chrome/PageChrome";
import { Banner } from "../../components/Banner";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";
import { dataManagementApi } from "./api";

export function DictionaryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState<DictionaryPage | null>(null);
  const [coverage, setCoverage] = useState<DictionaryCoverageReport | null>(null);
  const [entity, setEntity] = useState("");
  const [error, setError] = useState<string | null>(null);

  usePageChrome({ title: t("dm.dictionary.title"), subtitle: t("dm.dictionary.subtitle") });

  useEffect(() => {
    let cancelled = false;
    Promise.all([dataManagementApi.dictionary({ entityName: entity || undefined, page: 1, pageSize: 100 }), dataManagementApi.coverage()])
      .then(([d, c]) => {
        if (cancelled) return;
        setPage(d);
        setCoverage(c);
      })
      .catch(() => {
        if (!cancelled) setError(t("dm.dictionary.forbidden"));
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);

  const entities = Array.from(new Set((page?.items ?? []).map((e) => e.entityName))).sort();

  return (
    <Page>
      {error && <Banner intent="err">{error}</Banner>}
      {coverage && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          {t("dm.dictionary.coverage", { have: coverage.withEntry, total: coverage.totalProductionFields })}
        </p>
      )}
      {coverage && coverage.missing.length > 0 && (
        <Banner intent="warn">{t("dm.dictionary.missing", { count: coverage.missing.length })}</Banner>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className="ams-btn" onClick={() => setEntity("")}>
          {t("dm.issues.all")}
        </button>
        {entities.slice(0, 8).map((name) => (
          <button key={name} type="button" className="ams-btn" onClick={() => setEntity(name)}>
            {name}
          </button>
        ))}
      </div>
      {!page && !error && <Spinner label="…" />}
      {page && (
        <>
          <SectionLabel count={page.total}>{entity || t("dm.dictionary.allFields")}</SectionLabel>
          <ListFrame>
            {page.items.map((entry) => (
              <div key={entry.id} className="ams-attn" style={{ alignItems: "flex-start" }}>
                <span className="ams-attn-body">
                  <div className="l">
                    {entry.entityName}.{entry.fieldName}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {entry.authorityMode} · {entry.classification} · {entry.offlineCacheAllowed ? t("dm.dictionary.offlineYes") : t("dm.dictionary.offlineNo")}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>{entry.definition}</div>
                </span>
              </div>
            ))}
          </ListFrame>
        </>
      )}
      <button type="button" className="ams-btn" style={{ marginTop: 12 }} onClick={() => navigate("/data-management")}>
        {t("dm.overview.back")}
      </button>
    </Page>
  );
}
