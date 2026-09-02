import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, Field, MessageBar, MessageBarBody, Select, Text, Title2, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { Asset, Condition } from "../../api/types";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { t } from "../../i18n";

interface Line {
  asset: Asset;
  condition: Condition;
}

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
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <MessageBar intent={queued ? "warning" : "success"}>
          <MessageBarBody>{queued ? t("offline.submissionQueued") : confirmation}</MessageBarBody>
        </MessageBar>
        <Button
          appearance="primary"
          onClick={() => {
            setConfirmation(null);
            setQueued(false);
          }}
        >
          {t("common.back")}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2>{t("return.title")}</Title2>
      <Text size={200}>{t("return.prefilledFromCustody")}</Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {t("return.location")}: {user?.homeoffice ?? "—"}
      </Text>

      {loading && <Text>{t("common.loading")}</Text>}
      {!loading && lines.length === 0 && <Text>{t("cart.empty")}</Text>}

      {lines.map((line) => (
        <div key={line.asset.assetid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
          <div>
            <Text font="monospace" weight="semibold">
              {line.asset.assetid}
            </Text>
            <br />
            <Text size={200}>
              {line.asset.equipmentmodel.manufacturer} {line.asset.equipmentmodel.model}
            </Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Field label={t("return.condition")}>
              <Select value={line.condition} onChange={(_, d) => setCondition(line.asset.assetid, d.value as Condition)}>
                <option value="Good">{t("return.condition.good")}</option>
                <option value="Damaged">{t("return.condition.damaged")}</option>
                <option value="NeedsService">{t("return.condition.needsService")}</option>
              </Select>
            </Field>
            <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => remove(line.asset.assetid)} aria-label={t("cart.remove")} />
          </div>
        </div>
      ))}

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <Button appearance="primary" size="large" disabled={lines.length === 0 || submitting} onClick={submit}>
        {submitting ? t("cart.submitting") : t("cart.submit")}
      </Button>
    </div>
  );
}
