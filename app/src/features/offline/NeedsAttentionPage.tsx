/**
 * Feature 003 US5 (FR-039/FR-040) — owned by WS-C. See specs/REMAINING-WORK.md § WS-C.
 *
 * The one screen a rejected replay is ever visible on (FR-039: never silently discarded). Reads
 * through `backend` (api/index.ts — the single AmsBackend seam every screen uses, per
 * specs/AGENT-BRIEF.md invariant 1) for the list, and hands that same `backend` to the submission
 * queue as its transport so Retry has something to actually resend through — api/queue/index.ts
 * never imports api/index.ts itself, see its header comment for why that matters.
 *
 * GAP (reported to the orchestrator, not fixed here — features/offline/** is this workstream's
 * only owned UI surface): a "pending" badge inline on SearchPage/AssetRow/AssetDetailPage for
 * FR-040 would need a small edit to a shared component (AssetRow.tsx or similar) outside this
 * ownership list. This page is where pending and rejected submissions are visible for now.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Spinner, Text, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import { getSubmissionQueue } from "../../api/queue";
import type { PendingSubmission, PendingSubmissionKind } from "../../api/types";
import { t } from "../../i18n";

function kindLabel(kind: PendingSubmissionKind): string {
  switch (kind) {
    case "Checkout":
      return t("asset.actions.checkout");
    case "Return":
      return t("asset.actions.return");
    case "Transfer":
      return t("asset.actions.transfer");
  }
}

export function NeedsAttentionPage() {
  const [items, setItems] = useState<PendingSubmission[] | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await backend.listPendingSubmissions();
    setItems(list);
  }, []);

  useEffect(() => {
    const queue = getSubmissionQueue(backend);
    const refresh = () => {
      // flush() is reentrant-safe (SubmissionQueue.ts) — safe to call here even if the queue's
      // own 'online' listener fires the same pass at the same moment.
      void queue.flush().finally(() => void load());
    };
    refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [load]);

  async function handleRetry(id: string) {
    setRetryingId(id);
    try {
      await getSubmissionQueue(backend).retry(id);
    } catch (err) {
      console.error("NeedsAttentionPage: retry failed", err);
    } finally {
      setRetryingId(null);
      await load();
    }
  }

  if (!items) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;

  const pending = items.filter((i) => i.status !== "Rejected");
  const rejected = items.filter((i) => i.status === "Rejected");

  return (
    <div className="ams-page">

      {pending.length > 0 && (
        <section>
          <SectionHeader label={t("offline.pendingBadge")} count={pending.length} />
          {pending.map((item) => (
            <SubmissionRow key={item.id} item={item} />
          ))}
        </section>
      )}

      <section>
        {rejected.length === 0 ? (
          pending.length === 0 && <Text style={{ padding: 16, color: tokens.colorNeutralForeground3 }}>{t("offline.needsAttention.empty")}</Text>
        ) : (
          <>
            <SectionHeader label={t("offline.needsAttention.title")} count={rejected.length} tone="danger" />
            {rejected.map((item) => (
              <SubmissionRow key={item.id} item={item} onRetry={() => handleRetry(item.id)} retrying={retryingId === item.id} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ label, count, tone }: { label: string; count: number; tone?: "danger" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", background: tokens.colorNeutralBackground3 }}>
      <Text weight="semibold">{label}</Text>
      <Badge color={tone}>{count}</Badge>
    </div>
  );
}

function SubmissionRow({ item, onRetry, retrying }: { item: PendingSubmission; onRetry?: () => void; retrying?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text weight="semibold">{kindLabel(item.kind)}</Text>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("offline.queuedAt", { time: new Date(item.queuedAt).toLocaleString() })}
        </Text>
      </div>
      <Text size={200} font="monospace">
        {item.affectedAssetIds.join(", ")}
      </Text>
      {item.status === "Rejected" && (
        <>
          {item.rejectionReason && (
            <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
              {item.rejectionReason}
            </Text>
          )}
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {t("offline.discardNotAllowed")}
          </Text>
          <Button size="small" appearance="secondary" onClick={onRetry} disabled={retrying} style={{ alignSelf: "flex-start" }}>
            {retrying ? <Spinner size="tiny" /> : t("offline.retry")}
          </Button>
        </>
      )}
    </div>
  );
}
