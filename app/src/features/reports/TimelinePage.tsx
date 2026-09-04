/**
 * Feature 006, User Story 3 — acceptance question 7: an asset's complete timeline, reconstructed
 * purely from its transaction history and relationships (domain/pointInTime.ts), with a
 * date-range filter that states the asset's state at the range's start (FR-020) and a CSV export
 * (FR-021). Read-only — this feature writes nothing (plan.md's Constitution Check).
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, AssetRelationship, HistoryEntry } from "../../api/types";
import { buildTimeline, stateAsOf, type TimelineEvent } from "../../domain/pointInTime";
import { Banner } from "../../components/Banner";
import { Page } from "../../components/Page";
import { StatusPill } from "../../components/StatusPill";
import { t } from "../../i18n";
import { statusLabel } from "../../i18n/humanise";
import { governedExportsAvailable, runGovernedExport, saveTextFile, toCsv } from "./governedExport";

export function TimelinePage() {
  const { assetId = "" } = useParams();
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [relationships, setRelationships] = useState<AssetRelationship[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const loadedAt = useMemo(() => new Date(), [asset]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [a, h, r] = await Promise.all([
        backend.getAsset(assetId),
        backend.getAssetHistory(assetId),
        backend.getAssetRelationships(assetId),
      ]);
      if (cancelled) return;
      setAsset(a);
      setHistory(h);
      setRelationships(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const timeline = useMemo(() => buildTimeline(history, relationships), [history, relationships]);
  const filtered = useMemo(() => {
    if (!from && !to) return timeline;
    return timeline.filter((ev) => (!from || ev.entry.transactiondate >= from) && (!to || ev.entry.transactiondate <= to));
  }, [timeline, from, to]);

  // FR-020: the asset's state AT the range's start, so a filtered timeline never reads as if
  // nothing existed before it — reuses the exact replay this feature's US1/US4 also depend on.
  const rangeStartState = useMemo(() => (from ? stateAsOf(history, from, relationships) : null), [history, relationships, from]);

  if (asset === undefined) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;
  if (asset === null) {
    return (
      <Page>
        <p className="muted">{t("asset.notFound", { query: assetId })}</p>
      </Page>
    );
  }

  /**
   * FR-021. Against a real API the artifact is produced server-side under the approved
   * `asset-timeline` template, so the columns, the row scope and the audit entry are the server's
   * — see ./governedExport.ts. The in-browser assembly below is the mock-backend path only, and is
   * unchanged from what this screen always did.
   */
  async function exportCsv() {
    setExportError(null);
    if (governedExportsAvailable()) {
      setExporting(true);
      const result = await runGovernedExport(
        "asset-timeline",
        { assetId: asset!.assetid, ...(from ? { from } : {}), ...(to ? { to } : {}) },
        `Asset timeline for ${asset!.assetid}`
      );
      setExporting(false);
      if (!result.ok) setExportError(t("common.error", { message: `${result.code} — ${result.message}` }));
      return;
    }

    const rows: string[][] = [
      ["Date", "Type", "Status before", "Status after", "Location", "Custodian", "Project", "Performed by", "Notes", "Attachments"],
    ];
    for (const ev of filtered) {
      rows.push([
        ev.entry.transactiondate,
        ev.entry.transactiontype,
        ev.entry.statusbefore,
        ev.entry.statusafter,
        ev.entry.tolocation ?? "",
        ev.entry.touser ?? "",
        ev.entry.toproject ?? "",
        ev.entry.performedby,
        ev.entry.notes ?? "",
        ev.attachments.map((a) => `${a.kind}:${a.assetId}${a.role ? ` (${a.role})` : ""}`).join("; "),
      ]);
    }
    saveTextFile(`${asset!.assetid}-timeline.csv`, toCsv(rows));
  }

  return (
    <Page>
      <div>
        <span className="t-id-lg">{asset.assetid}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
          <StatusPill status={asset.status} />
          {asset.lifecycle === "Retired" && <span className="ams-pill ams-pill-Retired">{t("asset.retired")}</span>}
        </div>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
        </p>
      </div>

      <div className="ams-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="ams-field-row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <div className="ams-field">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("reports.timeline.rangeStart")} />
          </div>
          <span className="muted">–</span>
          <div className="ams-field">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("reports.timeline.title")} />
          </div>
        </div>
        <div className="ams-actions">
          {(from || to) && (
            <button
              type="button"
              className="ams-btn"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              {t("common.all")}
            </button>
          )}
          <button type="button" className="ams-btn ams-btn-primary" onClick={() => void exportCsv()} disabled={exporting}>
            {t("reports.timeline.export")}
          </button>
        </div>

        {exportError && <Banner intent="err">{exportError}</Banner>}

        {rangeStartState && (
          <div className="ams-banner ams-banner-info">
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("reports.timeline.rangeStart")}</div>
              {rangeStartState.status} · {t("asset.location")}: {rangeStartState.currentlocation ?? t("common.unknown")} ·{" "}
              {t("asset.custodian")}: {rangeStartState.custodian ?? t("common.unknown")} · {t("asset.project")}:{" "}
              {rangeStartState.currentproject ?? t("common.none")}
            </div>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{t("asset.history.empty")}</p>
      ) : (
        <ul className="ams-tl">
          {filtered.map((ev) => (
            <TimelineRow key={ev.entry.id} event={ev} />
          ))}
        </ul>
      )}
    </Page>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const h = event.entry;
  return (
    <li>
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        {new Date(h.transactiondate).toLocaleString()} — {h.transactiontype}
      </div>
      <div style={{ fontSize: 13 }}>
        {statusLabel(h.statusbefore)} → {statusLabel(h.statusafter)}
        {h.tolocation ? ` · ${h.tolocation}` : ""}
        {h.touser ? ` · ${h.touser}` : ""}
        {h.toproject ? ` · ${h.toproject}` : ""}
      </div>
      {event.attachments.map((a, i) => (
        <div key={i} style={{ fontSize: 13, color: "var(--brandFg)" }}>
          {a.kind === "attach" ? "+" : "−"} {a.assetId}
          {a.role ? ` (${a.role})` : ""}
        </div>
      ))}
      <div className="when">
        {h.performedby}
        {h.notes ? ` · ${h.notes}` : ""}
      </div>
    </li>
  );
}
