import { useEffect, useState } from "react";
import { backend } from "../../api";
import type { Installation, InstallationSnapshot, KitRole, Orientation, PowerSource, Project } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Sheet } from "../../components/Sheet";
import { requiresOrientation } from "../../domain/installation";
import { t } from "../../i18n";
import { describeRefusal } from "../deploy/refusals";

const ORIENTATIONS: Orientation[] = ["H", "V", "BH", "N", "E", "S", "W"];
const POWER_SOURCES: PowerSource[] = ["Battery", "Solar", "AC", "External"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SwapDialog({ installation, onClose, onDone }: { installation: Installation; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"swap" | "config">("swap");
  const [snapshot, setSnapshot] = useState<InstallationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // swap fields
  const [outgoingAssetId, setOutgoingAssetId] = useState("");
  const [incomingQuery, setIncomingQuery] = useState("");
  const [kitRole, setKitRole] = useState<KitRole>("Sensor1");
  const [orientation, setOrientation] = useState<Orientation | "">("");
  const [swapReason, setSwapReason] = useState("");
  const [swapDate, setSwapDate] = useState(todayIso());

  // configuration-change fields
  const [projects, setProjects] = useState<Project[]>([]);
  const [powersource, setPowersource] = useState<PowerSource | "">("");
  const [position, setPosition] = useState("");
  const [toproject, setToproject] = useState("");
  const [configReason, setConfigReason] = useState("");
  const [configDate, setConfigDate] = useState(todayIso());

  useEffect(() => {
    backend.getInstallationSnapshot(installation.id, new Date().toISOString()).then(setSnapshot);
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
  }, [installation.id]);

  const swappableComponents = (snapshot?.components ?? []).filter((c) => c.asset !== installation.primaryasset);

  useEffect(() => {
    const row = swappableComponents.find((c) => c.asset === outgoingAssetId);
    if (row) {
      setKitRole(row.kitrole);
      setOrientation(row.orientation ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outgoingAssetId]);

  async function submitSwap() {
    setError(null);
    if (!outgoingAssetId || !incomingQuery.trim()) {
      setError("Pick both the outgoing and incoming asset.");
      return;
    }
    if (requiresOrientation(kitRole) && !orientation) {
      setError(t("deploy.error.orientationRequired", { assetId: incomingQuery.trim() }));
      return;
    }
    if (!swapReason.trim()) {
      setError("A reason is required to swap a component.");
      return;
    }
    setBusy(true);
    const result = await backend.submitComponentSwap({
      installationId: installation.id,
      outgoingAssetId,
      incomingAssetId: incomingQuery.trim(),
      kitRole,
      orientation: orientation || null,
      effectiveDate: new Date(swapDate).toISOString(),
      reason: swapReason,
      clientSubmissionId: `swap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setBusy(false);
    if (!result.ok) {
      setError(await describeRefusal(result.reason, result.offendingAssetId));
      return;
    }
    onDone();
  }

  async function submitConfig() {
    setError(null);
    if (!powersource && !position.trim() && !toproject) {
      setError(t("config.error.noChange"));
      return;
    }
    if (!configReason.trim()) {
      setError("A reason is required to change a live installation's configuration.");
      return;
    }
    setBusy(true);
    const result = await backend.submitConfigurationChange({
      installationId: installation.id,
      powersource: powersource || undefined,
      position: position.trim() ? position.trim() : undefined,
      toproject: toproject || undefined,
      effectiveDate: new Date(configDate).toISOString(),
      reason: configReason,
      clientSubmissionId: `config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setBusy(false);
    if (!result.ok) {
      setError(await describeRefusal(result.reason));
      return;
    }
    onDone();
  }

  return (
    <Sheet
      title={mode === "swap" ? t("swap.title") : t("config.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ams-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="ams-btn ams-btn-primary" disabled={busy} onClick={mode === "swap" ? submitSwap : submitConfig}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="ams-tabs">
          <button type="button" className={`ams-tab${mode === "swap" ? " on" : ""}`} onClick={() => setMode("swap")}>
            {t("swap.title")}
          </button>
          <button type="button" className={`ams-tab${mode === "config" ? " on" : ""}`} onClick={() => setMode("config")}>
            {t("config.title")}
          </button>
        </div>

        {error && <Banner intent="err">{error}</Banner>}

        {mode === "swap" && (
          <>
            <label className="ams-field">
              {t("swap.outgoing")}
              <select value={outgoingAssetId} onChange={(e) => setOutgoingAssetId(e.target.value)}>
                <option value="" disabled>
                  —
                </option>
                {swappableComponents.map((c) => (
                  <option key={c.asset} value={c.asset}>
                    {c.asset} ({c.kitrole})
                  </option>
                ))}
              </select>
            </label>
            <label className="ams-field">
              {t("swap.incoming")}
              <input value={incomingQuery} onChange={(e) => setIncomingQuery(e.target.value)} placeholder={t("search.placeholder")} />
            </label>
            {requiresOrientation(kitRole) && (
              <label className="ams-field">
                {t("deploy.orientation")}
                <select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}>
                  <option value="" disabled>
                    —
                  </option>
                  {ORIENTATIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="ams-field">
              {t("swap.effectiveDate")}
              <input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} />
            </label>
            <label className="ams-field">
              {t("swap.reason")}
              <input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} />
            </label>
          </>
        )}

        {mode === "config" && (
          <>
            <label className="ams-field">
              {t("config.powerSourceChange")}
              <select value={powersource} onChange={(e) => setPowersource(e.target.value as PowerSource)}>
                <option value="">—</option>
                {POWER_SOURCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="ams-field">
              {t("config.positionChange")}
              <input value={position} onChange={(e) => setPosition(e.target.value)} />
            </label>
            <label className="ams-field">
              {t("config.projectChange")}
              <select value={toproject} onChange={(e) => setToproject(e.target.value)}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.projectnumber}>
                    {p.projectnumber} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ams-field">
              {t("swap.effectiveDate")}
              <input type="date" value={configDate} onChange={(e) => setConfigDate(e.target.value)} />
            </label>
            <label className="ams-field">
              {t("config.reason")}
              <input value={configReason} onChange={(e) => setConfigReason(e.target.value)} />
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}
