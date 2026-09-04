import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Condition, Installation, InstallationSnapshot, KitRole, Orientation } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
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
      <Page>
        <p className="muted">{t("common.unknown")}</p>
      </Page>
    );
  }

  if (confirmation) {
    return (
      <Page>
        <div className="ams-success">
          <Banner intent="ok">{confirmation}</Banner>
          <div className="txn">{confirmation}</div>
        </div>
        <button
          type="button"
          className="ams-btn ams-btn-primary ams-btn-block"
          onClick={() => navigate(`/site/${encodeURIComponent(installation.site)}`)}
        >
          {t("site.title")}
        </button>
      </Page>
    );
  }

  return (
    <Page>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {installation.sitename} · {installation.project}
      </p>

      <section>
        <SectionLabel count={rows.length}>{t("site.detail.components")}</SectionLabel>
        <div className="ams-list">
          {rows.map((r) => (
            <div key={r.assetId} className="ams-cart" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <span className="t-id">{r.assetId}</span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {r.kitrole}
                    {r.orientation ? ` · ${r.orientation}` : ""}
                  </div>
                </div>
                <label className="ams-check" style={{ minHeight: 0 }}>
                  <input
                    type="checkbox"
                    checked={r.included}
                    onChange={(e) => updateRow(r.assetId, { included: e.target.checked })}
                  />
                  {r.included ? t("recover.disposition.recovered") : "—"}
                </label>
              </div>

              {r.included && (
                <div className="ams-field-row">
                  <label className="ams-field">
                    {t("recover.disposition")}
                    <select
                      value={r.disposition}
                      onChange={(e) => updateRow(r.assetId, { disposition: e.target.value as Row["disposition"] })}
                    >
                      <option value="Recovered">{t("recover.disposition.recovered")}</option>
                      <option value="Missing">{t("recover.disposition.missing")}</option>
                    </select>
                  </label>
                  {r.disposition === "Recovered" && (
                    <label className="ams-field">
                      {t("recover.condition")}
                      <select
                        value={r.condition}
                        onChange={(e) => updateRow(r.assetId, { condition: e.target.value as Condition })}
                      >
                        <option value="Good">{t("return.condition.good")}</option>
                        <option value="Damaged">{t("return.condition.damaged")}</option>
                        <option value="NeedsService">{t("return.condition.needsService")}</option>
                      </select>
                    </label>
                  )}
                </div>
              )}

              {!r.included && needsLeaveBehindReasons && (
                <label className="ams-field">
                  {t("recover.leaveBehindReason")}
                  <input value={r.leaveBehindReason} onChange={(e) => updateRow(r.assetId, { leaveBehindReason: e.target.value })} />
                </label>
              )}
            </div>
          ))}
        </div>
      </section>

      {needsLeaveBehindReasons && <Banner intent="warn">{t("recover.leaveBehindPrompt")}</Banner>}

      <label className="ams-field">
        {t("recover.date")}
        <input type="date" value={recoveryDate} onChange={(e) => setRecoveryDate(e.target.value)} />
      </label>
      <label className="ams-field">
        {t("deploy.notes")}
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <Banner intent="err">{error}</Banner>}

      <button type="button" className="ams-btn ams-btn-primary ams-btn-block" disabled={submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </button>
    </Page>
  );
}
