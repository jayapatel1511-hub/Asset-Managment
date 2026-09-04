import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, AssetRelationship, CalibrationRecord, HistoryEntry, Installation, KitRole, Orientation } from "../../api/types";
import { STATE_MACHINE, type TransactionType } from "../../domain/stateMachine";
import { isIncompleteAssetId } from "../../domain/assetId";
import { StatusPill } from "../../components/StatusPill";
import { Banner } from "../../components/Banner";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { usePendingSync } from "../../hooks/usePendingSync";
import { usePageChrome } from "../../chrome/PageChrome";
import { t } from "../../i18n";
import { equipmentTypeLabel, statusLabel } from "../../i18n/humanise";
import { RecordCalibrationDialog } from "../calibration/RecordCalibrationDialog";
import { RetireDialog } from "../admin/RetireDialog";
import { SendToCalibrationDialog } from "../calibration/SendToCalibrationDialog";
import { FaultDialog } from "./FaultDialog";

function isOverdue(a: Asset): boolean {
  return !!a.nextcaldue && a.nextcaldue < new Date().toISOString().slice(0, 10);
}

const ACTION_TXN: Record<string, TransactionType> = {
  checkout: "Checkout",
  return: "Return",
  reportFault: "ReportFault",
  markMissing: "MarkMissing",
  markFound: "Found",
  completeRepair: "RepairComplete",
  sendToCalibration: "SendToCalibration",
  retire: "Retire",
};

function allowed(status: Asset["status"], action: keyof typeof ACTION_TXN): boolean {
  return Boolean(STATE_MACHINE[status][ACTION_TXN[action]]);
}

export function AssetDetailPage() {
  const { assetId = "" } = useParams();
  const navigate = useNavigate();
  const { admin } = useCurrentUser();
  const pendingSync = usePendingSync(assetId);
  const [asset, setAsset] = useState<Asset | null | undefined>(undefined);
  const [tab, setTab] = useState<"history" | "calibration">("history");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [calRecords, setCalRecords] = useState<CalibrationRecord[]>([]);
  const [deployments, setDeployments] = useState<Array<{ installation: Installation; kitrole: KitRole | null; orientation: Orientation | null }>>([]);
  const [dialog, setDialog] = useState<null | "calibration" | "retire" | "sendToCal" | "fault" | "missing">(null);
  const [children, setChildren] = useState<AssetRelationship[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  usePageChrome({
    title: asset?.assetid ?? decodeURIComponent(assetId),
    subtitle: asset ? `${asset.equipmentmodel.manufacturer} ${asset.equipmentmodel.model}` : undefined,
  });

  async function refresh() {
    const a = await backend.getAsset(assetId);
    setAsset(a);
    if (a) {
      setHistory(await backend.getAssetHistory(a.assetid));
      setCalRecords(await backend.getCalibrationHistory(a.assetid));
      const installations = await backend.getAssetInstallations(a.assetid);
      const withRole = await Promise.all(
        installations.map(async (installation) => {
          const snapshot = await backend.getInstallationSnapshot(installation.id, installation.end ?? new Date().toISOString());
          const mine = snapshot?.components.find((c) => c.asset === a.assetid);
          return { installation, kitrole: mine?.kitrole ?? null, orientation: mine?.orientation ?? null };
        }),
      );
      setDeployments(withRole);
      const relationships = await backend.getAssetRelationships(a.assetid);
      setChildren(relationships.filter((r) => r.parentasset === a.assetid && r.end === null));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  async function runSimpleAction(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setActionError(null);
    try {
      const result = await fn();
      if (!result.ok) setActionError(result.reason ?? t("common.actionFailed"));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("common.actionFailed"));
    }
    try {
      await refresh();
    } catch {
      // The action may well have succeeded; only the re-read failed.
    }
  }

  if (asset === undefined) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;
  if (asset === null) {
    return (
      <Page>
        <Banner intent="info">{t("asset.notFound", { query: assetId })}</Banner>
      </Page>
    );
  }

  const clientSubmissionId = () => `${asset.assetid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="t-id-lg">{asset.assetid}</span>
        <StatusPill status={asset.status} />
        {pendingSync && <span className="ams-pill ams-pill-pending">{t("offline.pendingBadge")}</span>}
        {asset.lifecycle === "Retired" && <span className="ams-pill ams-pill-Retired">{t("asset.retired")}</span>}
        {isIncompleteAssetId(asset.assetid) && <span className="ams-pill ams-pill-warn">{t("asset.temporaryTag")}</span>}
        {isOverdue(asset) && <span className="ams-pill ams-pill-NeedsRepair">{t("asset.overdue")}</span>}
      </div>
      <p className="muted" style={{ margin: "-8px 0 0", fontSize: 14 }}>
        {asset.equipmentmodel.manufacturer} {asset.equipmentmodel.model} · {equipmentTypeLabel(asset.equipmentmodel.equipmenttype)}
      </p>

      <section>
        <SectionLabel>{t("asset.now")}</SectionLabel>
        <div className="ams-card">
          <div className="ams-now-grid">
            <NowField label={t("asset.location")} value={asset.currentlocation ?? "—"} />
            <NowField label={t("asset.homeOffice")} value={asset.homeoffice ?? "—"} />
            <NowField
              label={t("asset.custodian")}
              value={asset.custodian ?? (asset.status === "CheckedOut" ? t("asset.noCustodian") : "—")}
            />
            <NowField label={t("asset.project")} value={asset.currentproject ?? "—"} />
            <NowField label={t("asset.parent")} value={asset.parentasset ?? "—"} />
            <NowField label={t("asset.nextCalDue")} value={asset.nextcaldue ?? t("common.unknown")} danger={isOverdue(asset)} />
            <NowField label={t("asset.lastCalDate")} value={asset.lastcaldate ?? "—"} />
          </div>
        </div>
      </section>

      {actionError && <Banner intent="err">{actionError}</Banner>}

      {(asset.carrier || asset.identifiervalue || asset.phonenumber || asset.staticip) && (
        <section>
          <SectionLabel>{t("asset.sim.title")}</SectionLabel>
          <div className="ams-card">
            <div className="ams-now-grid">
              {asset.carrier && <NowField label={t("asset.sim.carrier")} value={asset.carrier} />}
              {asset.identifiervalue && <NowField label={t("asset.sim.iccid")} value={asset.identifiervalue} />}
              {asset.phonenumber && <NowField label={t("asset.sim.phone")} value={asset.phonenumber} />}
              {asset.staticip && <NowField label={t("asset.sim.staticIp")} value={asset.staticip} />}
            </div>
          </div>
        </section>
      )}

      {children.length > 0 && (
        <section>
          <SectionLabel>{t("asset.children")}</SectionLabel>
          <div className="ams-list">
            {children.map((rel) => (
              <button
                key={rel.id}
                type="button"
                className="ams-attn"
                onClick={() => navigate(`/asset/${encodeURIComponent(rel.childasset)}`)}
              >
                <span className="t-id">{rel.childasset}</span>
                <span className="ams-pill ams-pill-CheckedOut">{rel.relationshiptype}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {deployments.length > 0 && (
        <section>
          <SectionLabel>{t("site.title")}</SectionLabel>
          <div className="ams-list">
            {deployments.map(({ installation, kitrole, orientation }) => (
              <button
                key={installation.id}
                type="button"
                className="ams-attn"
                onClick={() => navigate(`/site/${encodeURIComponent(installation.site)}`)}
              >
                <span className="ams-attn-body">
                  <div className="l">
                    {installation.sitename} — {installation.project}
                    {!installation.end && (
                      <span className="ams-pill ams-pill-Deployed" style={{ marginLeft: 6 }}>
                        {t("site.detail.current")}
                      </span>
                    )}
                  </div>
                  <div className="s">
                    {kitrole ?? "—"}
                    {orientation ? ` · ${orientation}` : ""} · {installation.start.slice(0, 10)}
                    {installation.end ? ` → ${installation.end.slice(0, 10)}` : ""}
                  </div>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="ams-actions">
        <ActionButton visible={asset.status === "Available"} onClick={() => navigate(`/checkout?asset=${encodeURIComponent(asset.assetid)}`)}>
          {t("asset.actions.checkout")}
        </ActionButton>
        <ActionButton visible={["CheckedOut", "Deployed"].includes(asset.status)} onClick={() => navigate(`/return?asset=${encodeURIComponent(asset.assetid)}`)}>
          {t("asset.actions.return")}
        </ActionButton>
        <ActionButton visible={["Available", "CheckedOut", "Deployed"].includes(asset.status)} onClick={() => navigate(`/transfer?asset=${encodeURIComponent(asset.assetid)}`)}>
          {t("asset.actions.transfer")}
        </ActionButton>
        <ActionButton visible={allowed(asset.status, "reportFault")} onClick={() => setDialog("fault")}>
          {t("asset.actions.reportFault")}
        </ActionButton>
        <ActionButton visible={allowed(asset.status, "markMissing")} onClick={() => setDialog("missing")}>
          {t("asset.actions.markMissing")}
        </ActionButton>
        <ActionButton visible={asset.status === "Missing"} onClick={() => runSimpleAction(() => backend.markFound(asset.assetid, clientSubmissionId()))}>
          {t("asset.actions.markFound")}
        </ActionButton>
        <ActionButton visible={asset.status === "NeedsRepair"} onClick={() => runSimpleAction(() => backend.completeRepair(asset.assetid, clientSubmissionId()))}>
          {t("asset.actions.completeRepair")}
        </ActionButton>
        {admin && (
          <>
            <ActionButton visible={allowed(asset.status, "sendToCalibration")} onClick={() => setDialog("sendToCal")}>
              {t("asset.actions.sendToCalibration")}
            </ActionButton>
            <ActionButton visible={asset.lifecycle === "Active"} onClick={() => setDialog("calibration")}>
              {t("asset.actions.recordCalibration")}
            </ActionButton>
            <ActionButton visible={allowed(asset.status, "retire")} onClick={() => setDialog("retire")} danger>
              {t("asset.actions.retire")}
            </ActionButton>
          </>
        )}
      </div>

      <div className="ams-tabs">
        <button type="button" className={`ams-tab${tab === "history" ? " on" : ""}`} onClick={() => setTab("history")}>
          {t("asset.tabs.history")}
        </button>
        <button type="button" className={`ams-tab${tab === "calibration" ? " on" : ""}`} onClick={() => setTab("calibration")}>
          {t("asset.tabs.calibration")}
        </button>
      </div>

      {tab === "history" && (
        <ul className="ams-tl">
          {history.length === 0 && <li className="muted">{t("asset.history.empty")}</li>}
          {history.map((h) => (
            <li key={h.id}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {h.transactiontype} · {statusLabel(h.statusbefore)} → {statusLabel(h.statusafter)}
              </div>
              <div className="when">
                {new Date(h.transactiondate).toLocaleString()}
                {h.touser ? ` · to ${h.touser}` : ""}
                {h.tolocation ? ` · to ${h.tolocation}` : ""}
                {h.toproject ? ` · project ${h.toproject}` : ""}
                {" · "}
                by {h.performedby}
              </div>
            </li>
          ))}
        </ul>
      )}

      {tab === "calibration" && (
        <ul className="ams-tl">
          {calRecords.length === 0 && <li className="muted">{t("common.none")}</li>}
          {calRecords.map((r, i) => (
            <li key={i}>
              <div style={{ fontSize: 14 }}>
                {r.calibrationdate} → next due {r.nextduedate} {r.lab ? `· ${r.lab}` : ""}
              </div>
              {r.certificateurl && (
                <a href={r.certificateurl} target="_blank" rel="noreferrer">
                  {t("asset.history.openCertificate")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {asset.notes && (
        <section>
          <SectionLabel>{t("asset.notes")}</SectionLabel>
          <div className="ams-card" style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>
            {asset.notes}
          </div>
        </section>
      )}

      {dialog === "calibration" && (
        <RecordCalibrationDialog asset={asset} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === "retire" && <RetireDialog asset={asset} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "sendToCal" && <SendToCalibrationDialog asset={asset} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "fault" && (
        <FaultDialog
          title={t("asset.actions.reportFault")}
          onClose={() => setDialog(null)}
          onSubmit={async (notes) => {
            await runSimpleAction(() => backend.reportFault({ assetId: asset.assetid, notes, clientSubmissionId: clientSubmissionId() }));
            setDialog(null);
          }}
        />
      )}
      {dialog === "missing" && (
        <FaultDialog
          title={t("asset.actions.markMissing")}
          onClose={() => setDialog(null)}
          onSubmit={async (notes) => {
            await runSimpleAction(() => backend.markMissing(asset.assetid, notes, clientSubmissionId()));
            setDialog(null);
          }}
        />
      )}
    </Page>
  );
}

function NowField({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="lab">{label}</div>
      <div className={`val${danger ? " danger" : ""}`}>{value}</div>
    </div>
  );
}

function ActionButton({
  visible,
  onClick,
  children,
  danger,
}: {
  visible: boolean;
  onClick: () => void;
  children: string;
  danger?: boolean;
}) {
  if (!visible) return null;
  return (
    <button type="button" className={`ams-btn${danger ? " ams-btn-danger" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
