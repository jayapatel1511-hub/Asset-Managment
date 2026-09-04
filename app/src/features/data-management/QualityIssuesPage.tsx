import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import type { DataQualityIssue, QualityIssuePage } from "../../../../packages/contracts/src/dataManagement";
import { usePageChrome } from "../../chrome/PageChrome";
import { Banner } from "../../components/Banner";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { t } from "../../i18n";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { dataManagementApi, newSubmissionId } from "./api";

export function QualityIssuesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, admin } = useCurrentUser();
  const ruleKey = params.get("ruleKey") ?? "";
  const severity = params.get("severity") ?? "";
  const selectedId = params.get("id") ?? "";
  const [page, setPage] = useState<QualityIssuePage | null>(null);
  const [selected, setSelected] = useState<DataQualityIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subtitle = useMemo(() => {
    if (ruleKey === "DQ-CAL-OVERDUE") return t("dm.issues.overdue");
    if (ruleKey === "DQ-CAL-UNKNOWN-DUE") return t("dm.issues.unknownDue");
    if (ruleKey) return ruleKey;
    return t("dm.issues.subtitle");
  }, [ruleKey]);

  usePageChrome({ title: t("dm.issues.title"), subtitle });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    dataManagementApi
      .issues({ ruleKey: ruleKey || undefined, severity: severity || undefined, status: "Open,Assigned,InProgress,Blocked,Reopened", page: 1, pageSize: 50 })
      .then((d) => {
        if (!cancelled) setPage(d);
      })
      .catch(() => {
        if (!cancelled) setError(t("dm.error"));
      });
    return () => {
      cancelled = true;
    };
  }, [ruleKey, severity]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    dataManagementApi
      .issue(selectedId)
      .then((d) => {
        if (!cancelled) setSelected(d);
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function openIssue(id: string) {
    const next = new URLSearchParams(params);
    if (id) next.set("id", id);
    else next.delete("id");
    setParams(next, { replace: true });
  }

  async function act(run: () => Promise<{ ok: boolean; reason?: string; issue?: DataQualityIssue }>) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await run();
      if (!result.ok) setError(result.reason ?? t("dm.error"));
      else {
        if (result.issue) setSelected(result.issue);
        setPage(await dataManagementApi.issues({ ruleKey: ruleKey || undefined, severity: severity || undefined, status: "Open,Assigned,InProgress,Blocked,Reopened", page: 1, pageSize: 50 }));
      }
    } catch {
      setError(t("dm.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      {error && <Banner intent="err">{error}</Banner>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Chip on={!ruleKey && !severity} onClick={() => navigate("/data-management/quality/issues")}>
          {t("dm.issues.all")}
        </Chip>
        <Chip on={ruleKey === "DQ-CAL-OVERDUE"} onClick={() => navigate("/data-management/quality/issues?ruleKey=DQ-CAL-OVERDUE")}>
          {t("dm.issues.overdue")}
        </Chip>
        <Chip on={ruleKey === "DQ-CAL-UNKNOWN-DUE"} onClick={() => navigate("/data-management/quality/issues?ruleKey=DQ-CAL-UNKNOWN-DUE")}>
          {t("dm.issues.unknownDue")}
        </Chip>
        <button type="button" className="ams-btn" onClick={() => navigate("/data-management")}>
          {t("dm.overview.back")}
        </button>
      </div>
      {!page && !error && <Spinner label="…" />}
      {page && page.items.length === 0 && <EmptyState>{t("dm.issues.empty")}</EmptyState>}
      {page && page.items.length > 0 && !selected && (
        <ListFrame>
          {page.items.map((issue) => (
            <button key={issue.id} type="button" className="ams-attn" onClick={() => openIssue(issue.id)}>
              <span className={`ams-attn-n${issue.severity === "High" || issue.severity === "Critical" ? " bad" : ""}`}>{issue.severity[0]}</span>
              <span className="ams-attn-body">
                <div className="l">{String(issue.evidence.assetid ?? issue.entityId)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {issue.ruleKey} · {issue.status}
                </div>
              </span>
            </button>
          ))}
        </ListFrame>
      )}
      {selected && (
        <section>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            {selected.ruleKey} · {selected.severity} · {selected.status}
          </p>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{String(selected.evidence.assetid ?? selected.entityId)}</h3>
          <p style={{ fontSize: 13, margin: "0 0 8px" }}>{t("dm.issues.office")}: {selected.officeLocationId ?? t("common.unknown")}</p>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("dm.issues.first")}: {selected.firstDetectedAt.slice(0, 10)} · {t("dm.issues.last")}: {selected.lastDetectedAt.slice(0, 10)}
          </p>
          {typeof selected.evidence.note === "string" && selected.evidence.note.length > 0 && (
            <Banner intent="info">{selected.evidence.note}</Banner>
          )}
          {selected.entityType === "asset" && (
            <button type="button" className="ams-btn" style={{ marginTop: 8 }} onClick={() => navigate(`/asset/${encodeURIComponent(String(selected.evidence.assetid ?? selected.entityId))}`)}>
              {t("dm.issues.openAsset")}
            </button>
          )}
          {admin && user && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="ams-btn"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    dataManagementApi.assign({
                      issueId: selected.id,
                      ownerUserId: user.upn,
                      clientSubmissionId: newSubmissionId(),
                      expectedRowVersion: selected.rowVersion,
                    })
                  )
                }
              >
                {t("dm.issues.assignMe")}
              </button>
              <button
                type="button"
                className="ams-btn"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    dataManagementApi.verify({
                      issueId: selected.id,
                      verificationType: "RuleReevaluation",
                      clientSubmissionId: newSubmissionId(),
                      expectedRowVersion: selected.rowVersion,
                    })
                  )
                }
              >
                {t("dm.issues.reEvaluate")}
              </button>
              <button
                type="button"
                className="ams-btn"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    dataManagementApi.verify({
                      issueId: selected.id,
                      verificationType: "ManualApproved",
                      approverUserId: user.upn === "svc-ams@englobecorp.com" ? "admin@englobecorp.com" : "svc-ams@englobecorp.com",
                      note: "Manual verification recorded from the issue queue.",
                      clientSubmissionId: newSubmissionId(),
                      expectedRowVersion: selected.rowVersion,
                    })
                  )
                }
              >
                {t("dm.issues.manualVerify")}
              </button>
            </div>
          )}
          <button type="button" className="ams-btn" style={{ marginTop: 8 }} onClick={() => openIssue("")}>
            {t("dm.issues.backToList")}
          </button>
        </section>
      )}
    </Page>
  );
}
