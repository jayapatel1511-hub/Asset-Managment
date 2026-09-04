import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { Asset, Location, Project } from "../../api/types";
import { Banner } from "../../components/Banner";
import { EmptyState } from "../../components/EmptyState";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";

export function TransferPage() {
  const [params] = useSearchParams();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [touser, setTouser] = useState("");
  const [tolocation, setTolocation] = useState("");
  const [toproject, setToproject] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.listLocations().then(setLocations);
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
    const preset = params.get("asset");
    if (preset) void addAsset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addAsset(query: string) {
    setAddError(null);
    const asset = await backend.getAsset(query);
    if (!asset) {
      setAddError(t("asset.notFound", { query }));
      return;
    }
    if (assets.some((a) => a.assetid === asset.assetid)) return;
    setAssets([...assets, asset]);
    setAddQuery("");
  }

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError(t("transfer.reasonRequired"));
      return;
    }
    setSubmitting(true);
    // FR-036: routed through the offline queue — see CheckoutPage.tsx's identical comment.
    const outcome = await getSubmissionQueue(backend).submit("Transfer", {
      assetIds: assets.map((a) => a.assetid),
      touser: touser || null,
      tolocation: tolocation || null,
      toproject: toproject || null,
      reason,
      clientSubmissionId: `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!outcome.delivered) {
      setQueued(true);
      setAssets([]);
      setReason("");
      return;
    }
    if (!outcome.outcome.ok) {
      setError(outcome.outcome.reason);
      return;
    }
    setConfirmation(t("transfer.confirmation", { txn: outcome.outcome.transactionName }));
    setAssets([]);
    setReason("");
  }

  if (confirmation || queued) {
    return (
      <Page>
        <div className="ams-success">
          <Banner intent={queued ? "warn" : "ok"}>{queued ? t("offline.submissionQueued") : confirmation}</Banner>
        </div>
        <button
          type="button"
          className="ams-btn ams-btn-primary ams-btn-block"
          onClick={() => {
            setConfirmation(null);
            setQueued(false);
          }}
        >
          {t("common.back")}
        </button>
      </Page>
    );
  }

  return (
    <Page>
      <div className="ams-search-row">
        <SearchField
          value={addQuery}
          placeholder={t("search.placeholder")}
          onChange={setAddQuery}
          onSubmit={() => addQuery.trim() && addAsset(addQuery.trim())}
        />
        <button type="button" className="ams-btn ams-btn-primary" onClick={() => addQuery.trim() && addAsset(addQuery.trim())}>
          {t("cart.add")}
        </button>
      </div>
      {addError && <Banner intent="err">{addError}</Banner>}

      <SectionLabel count={assets.length}>{t("cart.title")}</SectionLabel>
      {assets.length === 0 ? (
        <EmptyState icon="xfer">{t("cart.empty")}</EmptyState>
      ) : (
        <div className="ams-list">
          {assets.map((a) => (
            <div key={a.assetid} className="ams-cart">
              <span className="t-id meta">
                {a.assetid}
              </span>
              <button
                type="button"
                className="ams-btn ams-btn-sm ams-btn-ghost"
                onClick={() => setAssets(assets.filter((x) => x.assetid !== a.assetid))}
                aria-label={t("cart.remove")}
              >
                {t("cart.remove")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ams-field">
        <label htmlFor="transfer-custodian">{t("transfer.newCustodian")}</label>
        <input
          id="transfer-custodian"
          value={touser}
          onChange={(e) => setTouser(e.target.value)}
          placeholder="name@englobecorp.com"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="hint">{t("transfer.custodianHint")}</div>
      </div>
      <div className="ams-field">
        <label htmlFor="transfer-location">{t("transfer.newLocation")}</label>
        <select id="transfer-location" value={tolocation} onChange={(e) => setTolocation(e.target.value)}>
          <option value="">—</option>
          {locations.map((l) => (
            <option key={l.id} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ams-field">
        <label htmlFor="transfer-project">{t("transfer.newProject")}</label>
        <select id="transfer-project" value={toproject} onChange={(e) => setToproject(e.target.value)}>
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ams-field">
        <label htmlFor="transfer-reason">{t("transfer.reason")}</label>
        <textarea id="transfer-reason" value={reason} required onChange={(e) => setReason(e.target.value)} rows={3} />
      </div>

      {error && <Banner intent="err">{error}</Banner>}

      <button
        type="button"
        className="ams-btn ams-btn-primary ams-btn-block"
        disabled={assets.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </button>
    </Page>
  );
}
