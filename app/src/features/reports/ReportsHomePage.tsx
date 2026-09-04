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
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, FleetCounts, Location, Project } from "../../api/types";
import type { AssetFilter } from "../../api/AmsBackend";
import { AssetRow } from "../../components/AssetRow";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";
import { humaniseEnum } from "../../i18n/humanise";

const ALL = "";

function BreakdownList({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("common.none")}</p>;
  return (
    <div className="ams-breakdown">
      {entries.map(([key, count]) => (
        <div key={key || "—"} className="ams-breakdown-row">
          <span className="k">{key ? humaniseEnum(key) : t("common.unknown")}</span>
          <span className="n">{count}</span>
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
    <Page>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t("reports.dataAsOf", { time: loadedAt.toLocaleTimeString() })}
      </p>

      <div className="ams-cat-grid">
        <button type="button" className="ams-report-card" onClick={() => navigate("/reports/compliance")}>
          <h3>{t("reports.compliance.title")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>{t("reports.compliance.byOffice")}</span>
        </button>
        <button type="button" className="ams-report-card" onClick={() => navigate("/reports/utilisation")}>
          <h3>{t("reports.utilisation.title")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>{t("reports.utilisation.idle")}</span>
        </button>
      </div>

      <div className="ams-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label className="ams-field">
          {t("asset.homeOffice")}
          <select value={office} onChange={(e) => setOffice(e.target.value)}>
            <option value={ALL}>{t("common.all")}</option>
            {locations
              .filter((l) => l.locationtype === "Office")
              .map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
        <label className="ams-field">
          {t("reports.fleet.byType")}
          <select value={equipmenttype} onChange={(e) => setEquipmenttype(e.target.value)}>
            <option value={ALL}>{t("common.all")}</option>
            {equipmentTypes.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section>
        <SectionLabel count={fleetCounts?.total}>{t("reports.fleet.title")}</SectionLabel>
        <div className="ams-card">
          {!fleetCounts && <Spinner size="tiny" />}
          {fleetCounts && (
            <>
              <div className="ams-stat-strip" style={{ marginBottom: 12 }}>
                <div className="ams-stat">
                  <div className="n">{fleetCounts.total}</div>
                  <div className="l">{t("reports.fleet.title")}</div>
                </div>
                <div className="ams-stat">
                  <div className="n">{fleetCounts.temporaryTags}</div>
                  <div className="l">{t("reports.fleet.temporaryTags")}</div>
                </div>
                <div className="ams-stat">
                  <div className="n">{fleetCounts.thirdPartyOwned}</div>
                  <div className="l">{t("reports.fleet.thirdPartyOwned")}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <section>
                  <div className="ams-sec-label" style={{ marginBottom: 6 }}>{t("reports.fleet.byOffice")}</div>
                  <BreakdownList counts={fleetCounts.byOffice} />
                </section>
                <section>
                  <div className="ams-sec-label" style={{ marginBottom: 6 }}>{t("reports.fleet.byGroup")}</div>
                  <BreakdownList counts={fleetCounts.byAssetGroup} />
                </section>
                <section style={{ gridColumn: "1 / -1" }}>
                  <div className="ams-sec-label" style={{ marginBottom: 6 }}>{t("reports.fleet.byType")}</div>
                  <BreakdownList counts={fleetCounts.byEquipmentType} />
                </section>
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <SectionLabel count={availableCounts?.total}>{t("reports.availability.title")}</SectionLabel>
        <div className="ams-card">
          {!availableCounts && <Spinner size="tiny" />}
          {availableCounts && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <section>
                <div className="ams-sec-label" style={{ marginBottom: 6 }}>{t("reports.fleet.byOffice")}</div>
                <BreakdownList counts={availableCounts.byOffice} />
              </section>
              <section>
                <div className="ams-sec-label" style={{ marginBottom: 6 }}>{t("reports.fleet.byType")}</div>
                <BreakdownList counts={availableCounts.byEquipmentType} />
              </section>
            </div>
          )}
        </div>
      </section>

      <section>
        <SectionLabel>{t("reports.byProject.title")}</SectionLabel>
        <div className="ams-field">
          <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} aria-label={t("reports.byProject.title")}>
            <option value={ALL}>{t("common.all")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.projectnumber}>
                {p.name} ({p.projectnumber})
              </option>
            ))}
          </select>
        </div>
        {projectAssets && (
          <ListFrame>
            {projectAssets.length === 0 && (
              <div className="ams-empty">{t("common.none")}</div>
            )}
            {projectAssets.map((a) => (
              <AssetRow key={a.id} asset={a} />
            ))}
          </ListFrame>
        )}
      </section>

      <section>
        <SectionLabel>{t("reports.timeline.title")}</SectionLabel>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchField
              value={lookup}
              placeholder={t("search.placeholder")}
              onChange={setLookup}
              onSubmit={goToTimeline}
            />
          </div>
          <button type="button" className="ams-btn ams-btn-primary" onClick={goToTimeline}>
            {t("common.confirm")}
          </button>
        </div>
      </section>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t("reports.notPublished")}
      </p>
    </Page>
  );
}
