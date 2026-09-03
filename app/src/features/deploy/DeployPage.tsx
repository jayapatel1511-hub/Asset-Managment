import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input, MessageBar, MessageBarBody, Select, Text, Title2, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, Location, Project } from "../../api/types";
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
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <MessageBar intent="success">
          <MessageBarBody>{confirmation}</MessageBarBody>
        </MessageBar>
        <Button appearance="primary" onClick={() => navigate("/sites")}>
          {t("site.title")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("deploy.title")}</Title2>

      {restoredDraft && (
        <MessageBar intent="info">
          <MessageBarBody>{t("deploy.draftRestored")}</MessageBarBody>
        </MessageBar>
      )}

      <Field label={t("deploy.project")} required>
        <Select style={{ minWidth: 0, width: "100%" }} value={project} onChange={(_, d) => setProject(d.value)}>
          <option value="" disabled>
            —
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("deploy.primaryAsset")} required>
        {primary ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text font="monospace" weight="semibold">
              {primary.assetid}
            </Text>
            <Button size="small" appearance="subtle" onClick={() => setPrimary(null)}>
              {t("cart.remove")}
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              style={{ flex: 1 }}
              placeholder={t("search.placeholder")}
              value={primaryQuery}
              onChange={(_, d) => setPrimaryQuery(d.value)}
              onKeyDown={(e) => e.key === "Enter" && pickPrimary()}
            />
            <Button appearance="primary" onClick={pickPrimary}>
              {t("deploy.addPrimary")}
            </Button>
          </div>
        )}
      </Field>
      {primaryError && (
        <MessageBar intent="error">
          <MessageBarBody>{primaryError}</MessageBarBody>
        </MessageBar>
      )}

      <Text weight="semibold">{t("deploy.addComponent")}</Text>
      <ComponentPicker components={components} onChange={setComponents} excludeAssetIds={primary ? [primary.assetid] : []} />

      <SiteFields value={site} onChange={setSite} existingSites={existingSites} />

      <Field label={t("deploy.deploymentDate")} required>
        <Input type="date" value={deploymentDate} onChange={(_, d) => setDeploymentDate(d.value)} />
      </Field>

      <Field label={t("deploy.notes")}>
        <Input value={notes} onChange={(_, d) => setNotes(d.value)} />
      </Field>

      {submitError && (
        <MessageBar intent="error">
          <MessageBarBody>{submitError}</MessageBarBody>
        </MessageBar>
      )}

      <Button appearance="primary" size="large" disabled={submitting} onClick={submit} style={{ borderColor: tokens.colorNeutralStroke1 }}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </Button>
    </div>
  );
}
