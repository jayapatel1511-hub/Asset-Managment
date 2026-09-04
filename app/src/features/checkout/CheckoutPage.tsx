import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { Asset, Project } from "../../api/types";
import { Banner } from "../../components/Banner";
import { EmptyState } from "../../components/EmptyState";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { SectionLabel } from "../../components/SectionLabel";
import { StatusPill } from "../../components/StatusPill";
import { t } from "../../i18n";

interface CartItem {
  asset: Asset;
  kitRole?: string;
}

export function CheckoutPage() {
  const [params] = useSearchParams();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState("");
  // ASSUMPTION: Q8 (open, specs/clarifications.md) — expected return is optional, per the
  // recommendation, but offered pre-filled at +14 days so the common case takes zero typing;
  // the technician can still clear or change it. If Q8 is answered "required" instead, this
  // field just needs `required` added, no other change.
  const [expectedReturn, setExpectedReturn] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");
  const [primaryAssetId, setPrimaryAssetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    backend.listProjects().then((p) => setProjects(p.filter((x) => x.status === "Active")));
  }, []);

  useEffect(() => {
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
    if (asset.status !== "Available") {
      // FR-021 in the app layer: refuse at the point of adding, naming status and holder
      setAddError(t("cart.refusedNotAvailable", { assetId: asset.assetid, status: asset.status, custodian: asset.custodian ?? "—" }));
      return;
    }
    if (cart.some((c) => c.asset.assetid === asset.assetid)) {
      setAddError(`${asset.assetid} is already in the cart.`);
      return;
    }
    const next = [...cart, { asset }];
    setCart(next);
    if (next.length === 1) setPrimaryAssetId(asset.assetid); // first asset added is Primary by default
    setAddQuery("");
  }

  function removeAsset(assetId: string) {
    setCart(cart.filter((c) => c.asset.assetid !== assetId));
    if (primaryAssetId === assetId) setPrimaryAssetId(null);
  }

  async function submit() {
    setSubmitError(null);
    if (!project) {
      setSubmitError(t("checkout.projectRequired"));
      return;
    }
    setSubmitting(true);
    // FR-023: re-verify every asset's status at submission before committing.
    //
    // Best-effort, and it has to be: this is a freshness check, not a security boundary — the
    // backend refuses an invalid transition independently (Principle V), which the local API was
    // observed doing for this exact case. So a re-check that CANNOT BE PERFORMED must not stop
    // the submission, or FR-036's whole point is lost: with no connectivity the read throws, and
    // an unguarded `await` here left the button on "Submitting…" for ever and never reached the
    // offline queue that exists precisely for this moment. Found against the local API by
    // stopping it mid-submit; impossible to hit with the mock, whose reads cannot fail.
    let reachable = true;
    for (const item of cart) {
      let fresh: Asset | null;
      try {
        fresh = await backend.getAsset(item.asset.assetid);
      } catch {
        reachable = false; // offline — skip the rest of the re-check and let the queue take it
        break;
      }
      if (!fresh || fresh.status !== "Available") {
        setSubmitting(false);
        setSubmitError(t("cart.changedSinceAdded", { assetId: item.asset.assetid }));
        return;
      }
    }
    void reachable;
    // FR-036: routed through the offline queue rather than calling backend.submitCheckout
    // directly — if the transport call throws (no connectivity), the queue accepts it, persists
    // it, and replays it in order on reconnect (FR-037/FR-038); it is never silently lost.
    const outcome = await getSubmissionQueue(backend).submit("Checkout", {
      lines: cart.map((c) => ({ assetId: c.asset.assetid, kitRole: c.kitRole })),
      primaryAssetId: primaryAssetId ?? undefined,
      project,
      expectedReturn: expectedReturn || null,
      notes: notes || null,
      clientSubmissionId: `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!outcome.delivered) {
      setQueued(true);
      setCart([]);
      setProject("");
      setPrimaryAssetId(null);
      return;
    }
    if (!outcome.outcome.ok) {
      setSubmitError(outcome.outcome.reason);
      return;
    }
    setConfirmation(t("checkout.confirmation", { txn: outcome.outcome.transactionName }));
    setCart([]);
    setProject("");
    setPrimaryAssetId(null);
  }

  if (confirmation || queued) {
    return (
      <Page>
        <div className="ams-success">
          <Banner intent={queued ? "warn" : "ok"}>{queued ? t("offline.submissionQueued") : confirmation}</Banner>
          {confirmation && <div className="txn">{confirmation}</div>}
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

      <section>
        <SectionLabel count={cart.length}>{t("cart.title")}</SectionLabel>
        {cart.length === 0 ? (
          <EmptyState icon="box">{t("cart.empty")}</EmptyState>
        ) : (
          <div className="ams-list">
            {cart.map((item) => (
              <div key={item.asset.assetid} className="ams-cart">
                <div className="meta">
                  <span className="t-id">{item.asset.assetid}</span>
                  {primaryAssetId === item.asset.assetid && (
                    <span className="ams-pill ams-pill-ok" style={{ marginLeft: 6 }}>
                      {t("cart.primary")}
                    </span>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {item.asset.equipmentmodel.manufacturer} {item.asset.equipmentmodel.model}
                  </div>
                </div>
                <StatusPill status={item.asset.status} />
                <button
                  type="button"
                  className="ams-btn ams-btn-sm ams-btn-ghost"
                  onClick={() => removeAsset(item.asset.assetid)}
                  aria-label={t("cart.remove")}
                >
                  {t("cart.remove")}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="ams-field">
        <label htmlFor="checkout-project">{t("checkout.project")}</label>
        <select id="checkout-project" value={project} required onChange={(e) => setProject(e.target.value)}>
          <option value="" disabled>
            —
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.projectnumber}>
              {p.projectnumber} — {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="ams-field">
        <label htmlFor="checkout-return">{t("checkout.expectedReturn")}</label>
        <input id="checkout-return" type="date" value={expectedReturn} onChange={(e) => setExpectedReturn(e.target.value)} />
      </div>

      <div className="ams-field">
        <label htmlFor="checkout-notes">{t("checkout.notes")}</label>
        <textarea id="checkout-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </div>

      {submitError && <Banner intent="err">{submitError}</Banner>}

      <button
        type="button"
        className="ams-btn ams-btn-primary ams-btn-block"
        disabled={cart.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </button>
    </Page>
  );
}
