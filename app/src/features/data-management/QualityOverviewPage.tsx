import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import type { QualityOverviewCounts } from "../../../../packages/contracts/src/dataManagement";
import { usePageChrome } from "../../chrome/PageChrome";
import { Banner } from "../../components/Banner";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";
import { dataManagementApi, newSubmissionId } from "./api";
import { QUALITY_RULE_OVERDUE, QUALITY_RULE_UNKNOWN_DUE, qualityIssuesPath } from "../home/homeModel";

export function QualityOverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<QualityOverviewCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  usePageChrome({ title: t("dm.title"), subtitle: t("dm.overview.subtitle") });

  useEffect(() => {
    let cancelled = false;
    dataManagementApi
      .overview()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(t("dm.error"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runRules() {
    setRunning(true);
    setError(null);
    try {
      const result = await dataManagementApi.runRules(newSubmissionId());
      if (!result.ok) setError(result.reason);
      else setData(await dataManagementApi.overview());
    } catch {
      setError(t("dm.error"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Page>
      {error && <Banner intent="err">{error}</Banner>}
      {!data && !error && <Spinner label="…" />}
      {data && (
        <>
          <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
            {t("dm.currency", { time: data.dataCurrency.slice(0, 19).replace("T", " ") })}
          </p>
          <section>
            <SectionLabel>{t("dm.overview.attention")}</SectionLabel>
            <ListFrame>
              <CountRow n={data.calibrationOverdue} tone="bad" label={t("dm.overview.overdue")} onClick={() => navigate(qualityIssuesPath(QUALITY_RULE_OVERDUE))} />
              <CountRow n={data.calibrationUnknown} tone="warn" label={t("dm.overview.unknownDue")} onClick={() => navigate(qualityIssuesPath(QUALITY_RULE_UNKNOWN_DUE))} />
              <CountRow n={data.temporaryTags} label={t("dm.overview.temporaryTags")} onClick={() => navigate("/data-management/quality/issues?ruleKey=DQ-ASSET-TEMPORARY-TAG")} />
              <CountRow n={data.unknownCustodians} label={t("dm.overview.unknownCustodians")} onClick={() => navigate("/data-management/quality/issues?ruleKey=DQ-ASSET-UNKNOWN-CUSTODIAN")} />
              <CountRow n={data.duplicateCandidates} label={t("dm.overview.duplicates")} onClick={() => navigate("/data-management/quality/issues?ruleKey=DQ-DUP-SHARED-SERIAL")} />
            </ListFrame>
          </section>
          <section>
            <SectionLabel>{t("dm.overview.bySeverity")}</SectionLabel>
            <ListFrame>
              {(["Critical", "High", "Medium", "Low"] as const).map((sev) => (
                <CountRow
                  key={sev}
                  n={data.bySeverity[sev] ?? 0}
                  tone={sev === "Critical" || sev === "High" ? "bad" : undefined}
                  label={sev}
                  onClick={() => navigate(`/data-management/quality/issues?severity=${sev}`)}
                />
              ))}
            </ListFrame>
          </section>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="ams-btn" onClick={() => navigate("/data-management/quality/issues")}>
              {t("dm.overview.openQueue")}
            </button>
            <button type="button" className="ams-btn" onClick={() => navigate("/data-management/dictionary")}>
              {t("dm.dictionary.title")}
            </button>
            <button type="button" className="ams-btn" onClick={() => void runRules()} disabled={running}>
              {running ? "…" : t("dm.overview.runRules")}
            </button>
          </div>
        </>
      )}
    </Page>
  );
}

function CountRow({ n, label, onClick, tone }: { n: number; label: string; onClick: () => void; tone?: "bad" | "warn" }) {
  return (
    <button type="button" className="ams-attn" onClick={onClick}>
      <span className={`ams-attn-n${tone === "bad" ? " bad" : tone === "warn" ? " warn" : ""}`}>{n}</span>
      <span className="ams-attn-body">
        <div className="l">{label}</div>
      </span>
    </button>
  );
}
