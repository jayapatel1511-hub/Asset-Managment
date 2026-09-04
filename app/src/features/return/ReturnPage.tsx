import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { Asset, Condition } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { t, type StringKey } from "../../i18n";

interface Line {
  asset: Asset;
  condition: Condition;
}

const CONDITIONS: Array<{ value: Condition; label: StringKey }> = [
  { value: "Good", label: "return.condition.good" },
  { value: "Damaged", label: "return.condition.damaged" },
  { value: "NeedsService", label: "return.condition.needsService" },
];

export function ReturnPage() {
  const [params] = useSearchParams();
  const { user } = useCurrentUser();
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    async function load() {
      const preset = params.get("asset");
      const mine = await backend.listAssets({ custodian: user!.upn });
      let assets = mine;
      if (preset && !mine.some((a) => a.assetid === preset)) {
        const one = await backend.getAsset(preset);
        if (one) assets = [...mine, one];
      }
      setLines(assets.map((asset) => ({ asset, condition: "Good" as Condition })));
      setLoading(false);
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function remove(assetId: string) {
    setLines(lines.filter((l) => l.asset.assetid !== assetId));
  }

  function setCondition(assetId: string, condition: Condition) {
    setLines(lines.map((l) => (l.asset.assetid === assetId ? { ...l, condition } : l)));
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    // FR-036: routed through the offline queue — see CheckoutPage.tsx's identical comment.
    const outcome = await getSubmissionQueue(backend).submit("Return", {
      lines: lines.map((l) => ({ assetId: l.asset.assetid, condition: l.condition })),
      clientSubmissionId: `return-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    setSubmitting(false);
    if (!outcome.delivered) {
      setQueued(true);
      setLines([]);
      return;
    }
    if (!outcome.outcome.ok) {
      setError(outcome.outcome.reason);
      return;
    }
    setConfirmation(t("return.confirmation", { txn: outcome.outcome.transactionName }));
    setLines([]);
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
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t("return.prefilledFromCustody")}
      </p>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t("return.location")}: {user?.homeoffice ?? "—"}
      </p>

      <SectionLabel count={lines.length}>{t("cart.title")}</SectionLabel>
      {loading && <p className="muted">{t("common.loading")}</p>}
      {!loading && lines.length === 0 && <EmptyState icon="box">{t("cart.empty")}</EmptyState>}

      {lines.length > 0 && (
        <div className="ams-list">
          {lines.map((line) => (
            <div key={line.asset.assetid} className="ams-cart">
              <div className="meta">
                <span className="t-id">{line.asset.assetid}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {line.asset.equipmentmodel.manufacturer} {line.asset.equipmentmodel.model}
                </div>
                <div className="cond" role="group" aria-label={t("return.condition")}>
                  {CONDITIONS.map((c) => (
                    <Chip key={c.value} on={line.condition === c.value} onClick={() => setCondition(line.asset.assetid, c.value)}>
                      {t(c.label)}
                    </Chip>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="ams-btn ams-btn-sm ams-btn-ghost"
                onClick={() => remove(line.asset.assetid)}
                aria-label={t("cart.remove")}
              >
                {t("cart.remove")}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <Banner intent="err">{error}</Banner>}

      <button
        type="button"
        className="ams-btn ams-btn-primary ams-btn-block"
        disabled={lines.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </button>
    </Page>
  );
}
