/**
 * Feature 006, User Story 2 — acceptance question 5: calibration compliance evidence for a
 * project, a client, or an auditor. Counts by office (FR-013/FR-017), a per-project view
 * (FR-014), overdue detail (FR-015), certificate links (FR-016), and a CSV export that stands
 * alone as a document (spec.md's Assumption: "the compliance pack's audience... must stand alone
 * as a document rather than requiring the recipient to have access to anything").
 *
 * Read-only, no separate reporting copy (FR-030) — counts come from `getCalibrationCounts`, rows
 * come from `listAssets`/`getCalibrationHistory`, the same calls the rest of the app uses.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Dropdown, Option, Spinner, Text, Title2, Title3, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, CalibrationCounts, CalibrationRecord, Project } from "../../api/types";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";

const ALL = "";
const HORIZON_DAYS = 30;

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

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

function daysOverdue(nextcaldue: string): number {
  const due = new Date(nextcaldue);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

export function CompliancePage() {
  const loadedAt = useMemo(() => new Date(), []);
  const [counts, setCounts] = useState<CalibrationCounts | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState(ALL);
  const [projectAssets, setProjectAssets] = useState<Asset[] | null>(null);
  const [certByAsset, setCertByAsset] = useState<Map<string, CalibrationRecord | null>>(new Map());

  useEffect(() => {
    backend.getCalibrationCounts(HORIZON_DAYS).then(setCounts);
    backend.listProjects().then(setProjects);
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setProjectAssets(null);
      return;
    }
    (async () => {
      const assets = await backend.listAssets({ project: selectedProject }); // FR-014
      setProjectAssets(assets);
      const entries = await Promise.all(
        assets.map(async (a) => {
          const records = await backend.getCalibrationHistory(a.assetid);
          return [a.assetid, records[0] ?? null] as const; // newest first — getCalibrationHistory's own sort
        })
      );
      setCertByAsset(new Map(entries));
    })();
  }, [selectedProject]);

  function exportPack() {
    if (!projectAssets) return;
    const rows: string[][] = [["Asset ID", "Manufacturer", "Model", "Status", "Custodian", "Location", "Last calibrated", "Next due", "Days overdue", "Certificate"]];
    for (const a of projectAssets) {
      const overdue = a.nextcaldue && a.nextcaldue < loadedAt.toISOString().slice(0, 10) ? daysOverdue(a.nextcaldue) : "";
      const cert = certByAsset.get(a.assetid);
      rows.push([
        a.assetid,
        a.equipmentmodel.manufacturer,
        a.equipmentmodel.model,
        a.status,
        a.custodian ?? "",
        a.currentlocation ?? "",
        a.lastcaldate ?? "",
        a.nextcaldue ?? t("reports.compliance.unknownCount"),
        String(overdue),
        cert?.certificateurl ?? cert?.certificatenumber ?? "",
      ]);
    }
    downloadCsv(`compliance-${selectedProject || "fleet"}.csv`, rows);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div>
        <Title2>{t("reports.compliance.title")}</Title2>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: 4 }}>
          {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
        </Text>
      </div>

      <Card style={{ padding: 12 }}>
        <Title3>{t("reports.compliance.byOffice")}</Title3>
        {!counts && <Spinner size="tiny" style={{ marginTop: 8 }} />}
        {counts && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {Object.entries(counts.byOffice).map(([office, c]) => (
              <div key={office || "—"} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <Text size={200} weight="semibold">
                  {office || t("common.unknown")}
                </Text>
                <div style={{ display: "flex", gap: 8 }}>
                  <Badge color="warning">{t("calibration.overdueGroup")}: {c.overdue}</Badge>
                  <Badge color="informative">{t("calibration.dueGroup", { days: HORIZON_DAYS })}: {c.dueSoon}</Badge>
                  <Badge>{t("calibration.record.title")}: {c.inCalibration}</Badge>
                  <Badge color="subtle">{t("reports.compliance.unknownCount")}: {c.unknown}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding: 12 }}>
        <Title3>{t("reports.byProject.title")}</Title3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <Dropdown
            style={{ minWidth: 220 }}
            placeholder={t("common.all")}
            value={selectedProject ? projects.find((p) => p.projectnumber === selectedProject)?.name ?? selectedProject : t("common.all")}
            selectedOptions={[selectedProject]}
            onOptionSelect={(_, d) => setSelectedProject(d.optionValue ?? ALL)}
          >
            <Option value={ALL}>{t("common.all")}</Option>
            {projects.map((p) => (
              <Option key={p.id} value={p.projectnumber} text={`${p.name} (${p.projectnumber})`}>
                {p.name} ({p.projectnumber})
              </Option>
            ))}
          </Dropdown>
          {projectAssets && projectAssets.length > 0 && (
            <Button appearance="primary" onClick={exportPack}>
              {t("reports.timeline.export")}
            </Button>
          )}
        </div>

        {projectAssets && (
          <div style={{ marginTop: 8, border: `1px solid ${tokens.colorNeutralStroke2}` }}>
            {projectAssets.length === 0 && (
              <Text size={200} style={{ padding: 12, display: "block" }}>
                {t("common.none")}
              </Text>
            )}
            {projectAssets.map((a) => {
              const cert = certByAsset.get(a.assetid);
              const overdue = a.nextcaldue && a.nextcaldue < loadedAt.toISOString().slice(0, 10);
              return (
                <div key={a.id}>
                  <AssetRow asset={a} overdueDetail={overdue && a.nextcaldue ? t("reports.compliance.overdueBy", { days: daysOverdue(a.nextcaldue) }) : undefined} />
                  {cert?.certificateurl && (
                    <div style={{ padding: "0 12px 8px" }}>
                      <a href={cert.certificateurl} target="_blank" rel="noreferrer">
                        {t("asset.history.openCertificate")}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
        {t("reports.notPublished")}
      </Text>
    </div>
  );
}
