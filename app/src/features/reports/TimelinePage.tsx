/**
 * Feature 006, User Story 3 — acceptance question 7: an asset's complete timeline, reconstructed
 * purely from its transaction history and relationships (domain/pointInTime.ts), with a
 * date-range filter that states the asset's state at the range's start (FR-020) and a CSV export
 * (FR-021). Read-only — this feature writes nothing (plan.md's Constitution Check).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, Spinner, Text, Title2, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, AssetRelationship, HistoryEntry } from "../../api/types";
import { buildTimeline, stateAsOf, type TimelineEvent } from "../../domain/pointInTime";
import { StatusPill } from "../../components/StatusPill";
import { t } from "../../i18n";
import { statusLabel } from "../../i18n/humanise";

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** FR-021: a client-side blob download. This is the app, not a published Artifact viewer (which
 * blocks page-initiated downloads — see tasks.md T014's own note) — a blob download here works. */
function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function TimelinePage() {
  const { assetId = "" } = useParams();
  const navigate = useNavigate();
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [relationships, setRelationships] = useState<AssetRelationship[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
      <div style={{ padding: 16 }}>
        <Text>{t("asset.notFound", { query: assetId })}</Text>
      </div>
    );
  }

  function exportCsv() {
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
    downloadCsv(`${asset!.assetid}-timeline.csv`, rows);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <Button appearance="transparent" onClick={() => navigate(-1)} style={{ alignSelf: "flex-start", padding: 0 }}>
        {t("common.back")}
      </Button>

      <div>
        <Title2 style={{ fontFamily: tokens.fontFamilyMonospace }}>{asset.assetid}</Title2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <StatusPill status={asset.status} />
          {asset.lifecycle === "Retired" && <Badge color="subtle">{t("asset.retired")}</Badge>}
        </div>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: 4 }}>
          {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
        </Text>
      </div>

      <Card style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input type="date" value={from} onChange={(_, d) => setFrom(d.value)} />
          <Text>–</Text>
          <Input type="date" value={to} onChange={(_, d) => setTo(d.value)} />
          {(from || to) && (
            <Button
              appearance="transparent"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              {t("common.all")}
            </Button>
          )}
          <Button appearance="primary" onClick={exportCsv} style={{ marginLeft: "auto" }}>
            {t("reports.timeline.export")}
          </Button>
        </div>

        {rangeStartState && (
          <div style={{ background: tokens.colorNeutralBackground3, borderRadius: 6, padding: 8 }}>
            <Text size={200} weight="semibold" style={{ display: "block" }}>
              {t("reports.timeline.rangeStart")}
            </Text>
            <Text size={200}>
              {rangeStartState.status} · {t("asset.location")}: {rangeStartState.currentlocation ?? t("common.unknown")} ·{" "}
              {t("asset.custodian")}: {rangeStartState.custodian ?? t("common.unknown")} · {t("asset.project")}:{" "}
              {rangeStartState.currentproject ?? t("common.none")}
            </Text>
          </div>
        )}
      </Card>

      <div>
        {filtered.length === 0 && <Text>{t("asset.history.empty")}</Text>}
        {filtered.map((ev) => (
          <TimelineRow key={ev.entry.id} event={ev} />
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const h = event.entry;
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
      <Text weight="semibold" size={200} style={{ display: "block" }}>
        {new Date(h.transactiondate).toLocaleString()} — {h.transactiontype}
      </Text>
      <Text size={200} style={{ display: "block" }}>
        {statusLabel(h.statusbefore)} → {statusLabel(h.statusafter)}
        {h.tolocation ? ` · ${h.tolocation}` : ""}
        {h.touser ? ` · ${h.touser}` : ""}
        {h.toproject ? ` · ${h.toproject}` : ""}
      </Text>
      {event.attachments.map((a, i) => (
        <Text key={i} size={200} style={{ display: "block", color: tokens.colorBrandForeground1 }}>
          {a.kind === "attach" ? "+" : "−"} {a.assetId}
          {a.role ? ` (${a.role})` : ""}
        </Text>
      ))}
      <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
        {h.performedby}
        {h.notes ? ` · ${h.notes}` : ""}
      </Text>
    </div>
  );
}
