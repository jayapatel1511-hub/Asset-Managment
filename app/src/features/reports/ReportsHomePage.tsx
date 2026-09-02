/**
 * Feature 006, User Story 1 — acceptance questions 1, 2, 3, 4 and 6: what the company owns, where
 * it is, who has it, what is free, broken down by office/asset group/equipment type, with one
 * filter applied consistently everywhere on the page (FR-009).
 *
 * Read-only: every figure here comes from `getFleetCounts`/`listAssets`, the same reads the rest
 * of the app already uses — this page adds no separate reporting copy of the data (FR-030) and
 * inherits the same field-level security those calls already enforce for the signed-in role
 * (FR-003) — see this file's own note near the bottom on why that can't be verified this session.
 *
 * This screen is the interim for people who already have app access — NOT the licence-free
 * deliverable FR-001/SC-004 require. That is `solution/powerbi/` (see reports.notPublished's
 * banner below, and solution/powerbi/README.md).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Dropdown, Input, Option, Spinner, Text, Title2, Title3, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, FleetCounts, Location, Project } from "../../api/types";
import type { AssetFilter } from "../../api/AmsBackend";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";

const ALL = "";

function BreakdownList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <Text size={200}>{t("common.none")}</Text>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {entries.map(([key, count]) => (
        <div key={key || "—"} style={{ display: "flex", justifyContent: "space-between" }}>
          <Text size={200}>{key || t("common.unknown")}</Text>
          <Text size={200} weight="semibold">
            {count}
          </Text>
        </div>
      ))}
    </div>
  );
}

export function ReportsHomePage() {
  const navigate = useNavigate();
  const loadedAt = useMemo(() => new Date(), []);

  const [locations, setLocations] = useState<Location[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);

  const [office, setOffice] = useState(ALL);
  const [equipmenttype, setEquipmenttype] = useState(ALL);
  const [selectedProject, setSelectedProject] = useState(ALL);

  const [fleetCounts, setFleetCounts] = useState<FleetCounts | null>(null);
  const [availableCounts, setAvailableCounts] = useState<FleetCounts | null>(null);
  const [projectAssets, setProjectAssets] = useState<Asset[] | null>(null);
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    backend.listLocations().then(setLocations);
    backend.listProjects().then(setProjects);
    backend.listEquipmentModels().then((models) => setEquipmentTypes([...new Set(models.map((m) => m.equipmenttype))].sort()));
  }, []);

  // FR-009: office and equipment type are one filter, applied identically to both the fleet
  // totals and the availability breakdown below — never two independently-filterable views that
  // could disagree about what "here" means.
  const filter: AssetFilter = useMemo(
    () => ({ ...(office ? { office } : {}), ...(equipmenttype ? { equipmenttype } : {}) }),
    [office, equipmenttype]
  );

  useEffect(() => {
    setFleetCounts(null);
    setAvailableCounts(null);
    backend.getFleetCounts(filter).then(setFleetCounts);
    backend.getFleetCounts({ ...filter, status: ["Available"] }).then(setAvailableCounts); // FR-007
  }, [filter]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectAssets(null);
      return;
    }
    backend.listAssets({ project: selectedProject }).then(setProjectAssets); // FR-008
  }, [selectedProject]);

  function goToTimeline() {
    const id = lookup.trim();
    if (id) navigate(`/reports/timeline/${encodeURIComponent(id)}`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div>
        <Title2>{t("reports.title")}</Title2>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: 4 }}>
          {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
        </Text>
      </div>

      <Card style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Dropdown
          placeholder={t("asset.homeOffice")}
          value={office || t("common.all")}
          selectedOptions={[office]}
          onOptionSelect={(_, d) => setOffice(d.optionValue ?? ALL)}
        >
          <Option value={ALL}>{t("common.all")}</Option>
          {locations
            .filter((l) => l.locationtype === "Office")
            .map((l) => (
              <Option key={l.id} value={l.name}>
                {l.name}
              </Option>
            ))}
        </Dropdown>
        <Dropdown
          placeholder={t("reports.fleet.byType")}
          value={equipmenttype || t("common.all")}
          selectedOptions={[equipmenttype]}
          onOptionSelect={(_, d) => setEquipmenttype(d.optionValue ?? ALL)}
        >
          <Option value={ALL}>{t("common.all")}</Option>
          {equipmentTypes.map((et) => (
            <Option key={et} value={et}>
              {et}
            </Option>
          ))}
        </Dropdown>
      </Card>

      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Title3>{t("reports.fleet.title")}</Title3>
          {fleetCounts ? <Badge size="large">{fleetCounts.total}</Badge> : <Spinner size="tiny" />}
        </div>
        {fleetCounts && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <section>
              <Text size={200} weight="semibold" style={{ display: "block" }}>
                {t("reports.fleet.byOffice")}
              </Text>
              <BreakdownList counts={fleetCounts.byOffice} />
            </section>
            <section>
              <Text size={200} weight="semibold" style={{ display: "block" }}>
                {t("reports.fleet.byGroup")}
              </Text>
              <BreakdownList counts={fleetCounts.byAssetGroup} />
            </section>
            <section style={{ gridColumn: "1 / -1" }}>
              <Text size={200} weight="semibold" style={{ display: "block" }}>
                {t("reports.fleet.byType")}
              </Text>
              <BreakdownList counts={fleetCounts.byEquipmentType} />
            </section>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16 }}>
              <Text size={200}>
                {t("reports.fleet.temporaryTags")}: <b>{fleetCounts.temporaryTags}</b>
              </Text>
              <Text size={200}>
                {t("reports.fleet.thirdPartyOwned")}: <b>{fleetCounts.thirdPartyOwned}</b>
              </Text>
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Title3>{t("reports.availability.title")}</Title3>
          {availableCounts ? <Badge size="large" color="success">{availableCounts.total}</Badge> : <Spinner size="tiny" />}
        </div>
        {availableCounts && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
            <section>
              <Text size={200} weight="semibold" style={{ display: "block" }}>
                {t("reports.fleet.byOffice")}
              </Text>
              <BreakdownList counts={availableCounts.byOffice} />
            </section>
            <section>
              <Text size={200} weight="semibold" style={{ display: "block" }}>
                {t("reports.fleet.byType")}
              </Text>
              <BreakdownList counts={availableCounts.byEquipmentType} />
            </section>
          </div>
        )}
      </Card>

      <Card style={{ padding: 12 }}>
        <Title3>{t("reports.byProject.title")}</Title3>
        <Dropdown
          style={{ marginTop: 8, minWidth: 220 }}
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
        {projectAssets && (
          <div style={{ marginTop: 8, border: `1px solid ${tokens.colorNeutralStroke2}` }}>
            {projectAssets.length === 0 && (
              <Text size={200} style={{ padding: 12, display: "block" }}>
                {t("common.none")}
              </Text>
            )}
            {projectAssets.map((a) => (
              <AssetRow key={a.id} asset={a} />
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Title3>{t("reports.timeline.title")}</Title3>
        <div style={{ display: "flex", gap: 8 }}>
          <Input placeholder={t("search.placeholder")} value={lookup} onChange={(_, d) => setLookup(d.value)} style={{ flex: 1 }} />
          <Button appearance="primary" onClick={goToTimeline}>
            {t("common.confirm")}
          </Button>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button onClick={() => navigate("/reports/compliance")}>{t("reports.compliance.title")}</Button>
        <Button onClick={() => navigate("/reports/utilisation")}>{t("reports.utilisation.title")}</Button>
      </div>

      <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
        {t("reports.notPublished")}
      </Text>
    </div>
  );
}
