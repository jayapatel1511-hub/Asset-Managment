import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Field, Input, MessageBar, MessageBarBody, Select, Spinner, Switch, Text, Title2, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Condition, Installation, InstallationSnapshot, KitRole, Orientation } from "../../api/types";
import { t } from "../../i18n";
import { describeRefusal } from "../deploy/refusals";

interface Row {
  assetId: string;
  kitrole: KitRole;
  orientation: Orientation | null;
  included: boolean; // false = leave on site (needs a reason if the primary is being recovered)
  disposition: "Recovered" | "Missing";
  condition: Condition;
  leaveBehindReason: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecoverPage() {
  const { installationId = "" } = useParams();
  const navigate = useNavigate();
  const [installation, setInstallation] = useState<Installation | null | undefined>(undefined);
  const [rows, setRows] = useState<Row[]>([]);
  const [recoveryDate, setRecoveryDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.getInstallationSnapshot(installationId, new Date().toISOString()).then((snap: InstallationSnapshot | null) => {
      setInstallation(snap?.installation ?? null);
      if (snap) {
        setRows(
          snap.components.map((c) => ({
            assetId: c.asset,
            kitrole: c.kitrole,
            orientation: c.orientation,
            included: true,
            disposition: "Recovered",
            condition: "Good",
            leaveBehindReason: "",
          }))
        );
      }
    });
  }, [installationId]);

  function updateRow(assetId: string, patch: Partial<Row>) {
    setRows(rows.map((r) => (r.assetId === assetId ? { ...r, ...patch } : r)));
  }

  const primaryIncluded = installation ? rows.find((r) => r.assetId === installation.primaryasset)?.included : false;
  const excludedRows = rows.filter((r) => !r.included);
  // FR-018: recovering the primary while other components stay behind requires a reason for each.
  const needsLeaveBehindReasons = Boolean(primaryIncluded) && excludedRows.length > 0;

  async function submit() {
    setError(null);
    if (!installation) return;
    if (needsLeaveBehindReasons && excludedRows.some((r) => !r.leaveBehindReason.trim())) {
      setError(t("recover.leaveBehindPrompt"));
      return;
    }
    const included = rows.filter((r) => r.included);
    if (included.length === 0) {
      setError("Select at least one component to recover.");
      return;
    }
    setSubmitting(true);
    const result = await backend.submitRecovery({
      installationId: installation.id,
      components: included.map((r) => ({
        assetId: r.assetId,
        disposition: r.disposition,
        condition: r.disposition === "Recovered" ? r.condition : undefined,
      })),
      leaveBehind: excludedRows.map((r) => ({ assetId: r.assetId, reason: r.leaveBehindReason })),
      recoveryDate: new Date(recoveryDate).toISOString(),
      notes: notes || null,
      clientSubmissionId: `recover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(await describeRefusal(result.reason, result.offendingAssetId));
      return;
    }
    setConfirmation(t("recover.confirmation", { txn: result.transactionName }));
  }

  if (installation === undefined) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;
  if (installation === null) {
    return (
      <div style={{ padding: 16 }}>
        <Text>{t("common.unknown")}</Text>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <MessageBar intent="success">
          <MessageBarBody>{confirmation}</MessageBarBody>
        </MessageBar>
        <Button appearance="primary" onClick={() => navigate(`/site/${encodeURIComponent(installation.site)}`)}>
          {t("site.title")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("recover.title")}</Title2>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {installation.sitename} · {installation.project}
      </Text>

      {rows.map((r) => (
        <div key={r.assetId} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <Text font="monospace" weight="semibold">
                {r.assetId}
              </Text>
              <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
                {r.kitrole}
                {r.orientation ? ` · ${r.orientation}` : ""}
              </Text>
            </div>
            <Switch checked={r.included} onChange={(_, d) => updateRow(r.assetId, { included: d.checked })} label={r.included ? t("recover.disposition.recovered") : "—"} />
          </div>

          {r.included && (
            <div style={{ display: "flex", gap: 8 }}>
              <Field label={t("recover.disposition")}>
                <Select style={{ minWidth: 0, width: "100%" }} value={r.disposition} onChange={(_, d) => updateRow(r.assetId, { disposition: d.value as Row["disposition"] })}>
                  <option value="Recovered">{t("recover.disposition.recovered")}</option>
                  <option value="Missing">{t("recover.disposition.missing")}</option>
                </Select>
              </Field>
              {r.disposition === "Recovered" && (
                <Field label={t("recover.condition")}>
                  <Select style={{ minWidth: 0, width: "100%" }} value={r.condition} onChange={(_, d) => updateRow(r.assetId, { condition: d.value as Condition })}>
                    <option value="Good">{t("return.condition.good")}</option>
                    <option value="Damaged">{t("return.condition.damaged")}</option>
                    <option value="NeedsService">{t("return.condition.needsService")}</option>
                  </Select>
                </Field>
              )}
            </div>
          )}

          {!r.included && needsLeaveBehindReasons && (
            <Field label={t("recover.leaveBehindReason")} required>
              <Input value={r.leaveBehindReason} onChange={(_, d) => updateRow(r.assetId, { leaveBehindReason: d.value })} />
            </Field>
          )}
        </div>
      ))}

      {needsLeaveBehindReasons && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("recover.leaveBehindPrompt")}</MessageBarBody>
        </MessageBar>
      )}

      <Field label={t("deploy.deploymentDate")} required>
        <Input type="date" value={recoveryDate} onChange={(_, d) => setRecoveryDate(d.value)} />
      </Field>
      <Field label={t("deploy.notes")}>
        <Input value={notes} onChange={(_, d) => setNotes(d.value)} />
      </Field>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <Button appearance="primary" size="large" disabled={submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </Button>
    </div>
  );
}
