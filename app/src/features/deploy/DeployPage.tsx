import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { backend } from "../../api";
import type { Asset, Location, Project } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { SectionLabel } from "../../components/SectionLabel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { t } from "../../i18n";
import { ComponentPicker, type ComponentEntry } from "./ComponentPicker";
import { clearDraft, loadDraft, saveDraft, type DeployDraft } from "./DraftStore";
import { describeRefusal } from "./refusals";
import { emptySiteFields, SiteFields, type SiteFieldsValue } from "./SiteFields";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DeployPage() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [existingSites, setExistingSites] = useState<Location[]>([]);

  const [project, setProject] = useState("");
  const [primaryQuery, setPrimaryQuery] = useState("");
  const [primary, setPrimary] = useState<Asset | null>(null);
  const [primaryError, setPrimaryError] = useState<string | null>(null);
  const [components, setComponents] = useState<ComponentEntry[]>([]);
  const [site, setSite] = useState<SiteFieldsValue>(emptySiteFields());
  const [deploymentDate, setDeploymentDate] = useState(todayIso());
  const [notes, setNotes] = useState("");

  const [restoredDraft, setRestoredDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
    backend.listSites().then(setExistingSites);
  }, []);

  // FR-028: restore an interrupted form on reopen.
  useEffect(() => {
    const draft = loadDraft();
    if (!draft) return;
    setProject(draft.project);
    setSite({
      site: draft.site,
      locationtype: draft.locationtype as SiteFieldsValue["locationtype"],
      sitename: draft.sitename,
      position: draft.position,
      latitude: draft.latitude,
      longitude: draft.longitude,
      coordinatesource: draft.coordinatesource as SiteFieldsValue["coordinatesource"],
      powersource: draft.powersource as SiteFieldsValue["powersource"],
    });
    setDeploymentDate(draft.deploymentDate || todayIso());
    setNotes(draft.notes);
    if (draft.primaryAssetId) {
      backend.getAsset(draft.primaryAssetId).then((a) => a && setPrimary(a));
    }
    if (draft.components.length > 0) {
      Promise.all(draft.components.map((c) => backend.getAsset(c.assetId))).then((assets) => {
        const restored: ComponentEntry[] = [];
        assets.forEach((a, i) => {
          if (a) {
            restored.push({
              asset: a,
              kitRole: draft.components[i].kitRole as ComponentEntry["kitRole"],
              orientation: draft.components[i].orientation as ComponentEntry["orientation"],
            });
          }
        });
        setComponents(restored);
      });
    }
    setRestoredDraft(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FR-028: persist on every change so an interruption on site doesn't lose the form.
  useEffect(() => {
    if (!primary && components.length === 0 && !project && !site.site) return; // nothing worth saving yet
    const draft: DeployDraft = {
      primaryAssetId: primary?.assetid ?? "",
      project,
      components: components.map((c) => ({ assetId: c.asset.assetid, kitRole: c.kitRole, orientation: c.orientation })),
      site: site.site,
      locationtype: site.locationtype,
      sitename: site.sitename,
      position: site.position,
      latitude: site.latitude,
      longitude: site.longitude,
      coordinatesource: site.coordinatesource,
      powersource: site.powersource,
      deploymentDate,
      notes,
    };
    saveDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary, components, project, site, deploymentDate, notes]);

  async function pickPrimary() {
    setPrimaryError(null);
    const q = primaryQuery.trim();
    if (!q) return;
    const asset = await backend.getAsset(q);
    if (!asset) {
      setPrimaryError(t("asset.notFound", { query: q }));
      return;
    }
    if (asset.equipmentmodel.equipmenttype !== "DataLogger") {
      // client-side mirror of deploy.error.primaryNotLogger (Principle V)
      setPrimaryError(t("deploy.error.primaryNotLogger", { assetId: asset.assetid }));
      return;
    }
    if (asset.status === "Deployed") {
      setPrimaryError(t("deploy.error.alreadyDeployed", { assetId: asset.assetid }));
      return;
    }
    if (asset.status === "CheckedOut" && asset.custodian !== user?.upn) {
      setPrimaryError(t("deploy.error.notHeld", { assetId: asset.assetid, custodian: asset.custodian ?? "—" }));
      return;
    }
    setPrimary(asset);
    setPrimaryQuery("");
  }

  function clientSideValidation(): string | null {
    if (!primary) return t("deploy.error.noPrimary");
    if (!project) return "A project is required to deploy a station.";
    if (!site.site.trim() || !site.sitename.trim()) return "A site, its location type and name are required.";
    if (!site.powersource) return "A power source is required.";
    for (const c of components) {
      if ((c.kitRole === "Sensor1" || c.kitRole === "Sensor2" || c.kitRole === "Sensor3" || c.kitRole === "Sensor4") && !c.orientation) {
        return t("deploy.error.orientationRequired", { assetId: c.asset.assetid });
      }
    }
    return null;
  }

  async function submit() {
    setSubmitError(null);
    const clientError = clientSideValidation();
    if (clientError) {
      setSubmitError(clientError);
      return;
    }
    setSubmitting(true);
    const result = await backend.submitDeployment({
      project,
      primaryAssetId: primary!.assetid,
      components: components.map((c) => ({ assetId: c.asset.assetid, kitRole: c.kitRole, orientation: c.orientation ?? null })),
      site: site.site.trim(),
      locationtype: site.locationtype,
      sitename: site.sitename.trim(),
      position: site.position || null,
      latitude: site.latitude ? Number(site.latitude) : null,
      longitude: site.longitude ? Number(site.longitude) : null,
      coordinatesource: site.coordinatesource,
      powersource: site.powersource || "Battery",
      deploymentDate: new Date(deploymentDate).toISOString(),
      notes: notes || null,
      clientSubmissionId: `deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(await describeRefusal(result.reason, result.offendingAssetId, project));
      return;
    }
    clearDraft();
    setConfirmation(t("deploy.confirmation", { txn: result.transactionName, site: site.sitename }));
  }

  if (confirmation) {
    return (
      <Page>
        <div className="ams-success">
          <Banner intent="ok">{confirmation}</Banner>
          <div className="txn">{confirmation}</div>
        </div>
        <button type="button" className="ams-btn ams-btn-primary ams-btn-block" onClick={() => navigate("/sites")}>
          {t("site.title")}
        </button>
      </Page>
    );
  }

  return (
    <Page>
      {restoredDraft && <Banner intent="info">{t("deploy.draftRestored")}</Banner>}

      <label className="ams-field">
        {t("deploy.project")}
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="" disabled>
            —
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </select>
      </label>

      <section>
        <SectionLabel>{t("deploy.primaryAsset")}</SectionLabel>
        {primary ? (
          <div className="ams-list">
            <div className="ams-cart">
              <span className="t-id" style={{ flex: 1 }}>
                {primary.assetid}
              </span>
              <button type="button" className="ams-btn" onClick={() => setPrimary(null)}>
                {t("cart.remove")}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchField
                value={primaryQuery}
                placeholder={t("search.placeholder")}
                onChange={setPrimaryQuery}
                onSubmit={() => primaryQuery.trim() && pickPrimary()}
              />
            </div>
            <button type="button" className="ams-btn ams-btn-primary" onClick={pickPrimary}>
              {t("deploy.addPrimary")}
            </button>
          </div>
        )}
      </section>
      {primaryError && <Banner intent="err">{primaryError}</Banner>}

      <section>
        <SectionLabel>{t("deploy.addComponent")}</SectionLabel>
        <ComponentPicker components={components} onChange={setComponents} excludeAssetIds={primary ? [primary.assetid] : []} />
      </section>

      <SiteFields value={site} onChange={setSite} existingSites={existingSites} />

      <label className="ams-field">
        {t("deploy.deploymentDate")}
        <input type="date" value={deploymentDate} onChange={(e) => setDeploymentDate(e.target.value)} />
      </label>

      <label className="ams-field">
        {t("deploy.notes")}
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {submitError && <Banner intent="err">{submitError}</Banner>}

      <button type="button" className="ams-btn ams-btn-primary ams-btn-block" disabled={submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </button>
    </Page>
  );
}
