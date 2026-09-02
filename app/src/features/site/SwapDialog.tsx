import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  TabList,
  Tab,
} from "@fluentui/react-components";
import { backend } from "../../api";
import type { Installation, InstallationSnapshot, KitRole, Orientation, PowerSource, Project } from "../../api/types";
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
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("swap.title")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <TabList selectedValue={mode} onTabSelect={(_, d) => setMode(d.value as "swap" | "config")}>
              <Tab value="swap">{t("swap.title")}</Tab>
              <Tab value="config">{t("config.title")}</Tab>
            </TabList>

            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}

            {mode === "swap" && (
              <>
                <Field label={t("swap.outgoing")} required>
                  <Select value={outgoingAssetId} onChange={(_, d) => setOutgoingAssetId(d.value)}>
                    <option value="" disabled>
                      —
                    </option>
                    {swappableComponents.map((c) => (
                      <option key={c.asset} value={c.asset}>
                        {c.asset} ({c.kitrole})
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("swap.incoming")} required>
                  <Input value={incomingQuery} onChange={(_, d) => setIncomingQuery(d.value)} placeholder={t("search.placeholder")} />
                </Field>
                {requiresOrientation(kitRole) && (
                  <Field label={t("deploy.orientation")} required>
                    <Select value={orientation} onChange={(_, d) => setOrientation(d.value as Orientation)}>
                      <option value="" disabled>
                        —
                      </option>
                      {ORIENTATIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label={t("swap.effectiveDate")} required>
                  <Input type="date" value={swapDate} onChange={(_, d) => setSwapDate(d.value)} />
                </Field>
                <Field label={t("swap.reason")} required>
                  <Input value={swapReason} onChange={(_, d) => setSwapReason(d.value)} />
                </Field>
              </>
            )}

            {mode === "config" && (
              <>
                <Field label={t("config.powerSourceChange")}>
                  <Select value={powersource} onChange={(_, d) => setPowersource(d.value as PowerSource)}>
                    <option value="">—</option>
                    {POWER_SOURCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("config.positionChange")}>
                  <Input value={position} onChange={(_, d) => setPosition(d.value)} />
                </Field>
                <Field label={t("config.projectChange")}>
                  <Select value={toproject} onChange={(_, d) => setToproject(d.value)}>
                    <option value="">—</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.projectnumber}>
                        {p.projectnumber} — {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("swap.effectiveDate")} required>
                  <Input type="date" value={configDate} onChange={(_, d) => setConfigDate(d.value)} />
                </Field>
                <Field label={t("config.reason")} required>
                  <Input value={configReason} onChange={(_, d) => setConfigReason(d.value)} />
                </Field>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" disabled={busy} onClick={mode === "swap" ? submitSwap : submitConfig}>
              {t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
