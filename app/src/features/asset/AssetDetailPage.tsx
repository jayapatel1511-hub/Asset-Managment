import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  Title2,
  Tooltip,
  tokens,
} from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, AssetRelationship, CalibrationRecord, HistoryEntry, Installation, KitRole, Orientation } from "../../api/types";
import { STATE_MACHINE, type TransactionType } from "../../domain/stateMachine";
import { isIncompleteAssetId } from "../../domain/assetId";
import { StatusPill } from "../../components/StatusPill";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { usePendingSync } from "../../hooks/usePendingSync";
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
  // Feature 005 (WS-A T021 recommendation) — this asset's deployments, with its own role in
  // each. getAssetInstallations doesn't carry role/orientation (that's per-installation, shared
  // across every component), so each is paired with a getInstallationSnapshot lookup as WS-A's
  // report recommended.
  const [deployments, setDeployments] = useState<Array<{ installation: Installation; kitrole: KitRole | null; orientation: Orientation | null }>>([]);
  const [dialog, setDialog] = useState<null | "calibration" | "retire" | "sendToCal" | "fault" | "missing">(null);
  // UI spec G-11: the asset's own open Component/Kit children, listed as "Attached items".
  const [children, setChildren] = useState<AssetRelationship[]>([]);
  // G-13: a refusal from one of the one-tap actions used to be a browser alert(), which on a
  // phone is a modal nobody can copy text out of. It is an inline error MessageBar now.
  const [actionError, setActionError] = useState<string | null>(null);

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
        })
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
      // A REFUSAL arrives as { ok: false } and is handled above; landing here means the request
      // never completed — the http backend throws on a transport failure, by contract, so the
      // offline queue can tell the two apart. Without this catch the rejection was unhandled: no
      // message, no reset, and the user tapped again. These one-tap actions do not go through
      // the queue (only Checkout/Return/Transfer do), so telling them plainly is all we can do.
      setActionError(err instanceof Error ? err.message : t("common.actionFailed"));
    }
    try {
      await refresh();
    } catch {
      // The action may well have succeeded; only the re-read failed. Leave what is on screen.
    }
  }

  if (asset === undefined) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;
  if (asset === null) {
    return (
      <div style={{ padding: 16 }}>
        <Text>{t("asset.notFound", { query: assetId })}</Text>
      </div>
    );
  }

  const clientSubmissionId = () => `${asset.assetid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Title2 style={{ fontFamily: tokens.fontFamilyMonospace }}>{asset.assetid}</Title2>
          <StatusPill status={asset.status} />
          {pendingSync && <Badge color="warning">{t("offline.pendingBadge")}</Badge>}
          {asset.lifecycle === "Retired" && <Badge color="subtle">{t("asset.retired")}</Badge>}
          {isIncompleteAssetId(asset.assetid) && <Badge color="warning">{t("asset.temporaryTag")}</Badge>}
        </div>
        <Text size={300}>
          {asset.equipmentmodel.manufacturer} {asset.equipmentmodel.model} · {equipmentTypeLabel(asset.equipmentmodel.equipmenttype)}
        </Text>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: tokens.colorNeutralBackground1, padding: 12, borderRadius: 8 }}>
        <Field label={t("asset.location")} value={asset.currentlocation ?? "—"} />
        <Field label={t("asset.homeOffice")} value={asset.homeoffice ?? "—"} />
        <Field label={t("asset.custodian")} value={asset.custodian ?? (asset.status === "CheckedOut" ? t("asset.noCustodian") : "—")} />
        <Field label={t("asset.project")} value={asset.currentproject ?? "—"} />
        <Field label={t("asset.parent")} value={asset.parentasset ?? "—"} />
        <Field
          label={t("asset.nextCalDue")}
          value={asset.nextcaldue ?? t("common.unknown")}
          danger={isOverdue(asset)}
        />
        {/* UI spec G-11: specified for the Now card and not rendered until now. */}
        <Field label={t("asset.lastCalDate")} value={asset.lastcaldate ?? "—"} />
      </section>

      {isOverdue(asset) && <Badge color="danger">{t("asset.overdue")}</Badge>}

      {actionError && (
        <MessageBar intent="error">
          <MessageBarBody>{actionError}</MessageBarBody>
        </MessageBar>
      )}

      {/* docs/12-ui-spec.md G-11: the SIM fields, specified for Office Admin and above and not
          rendered until now. There is deliberately NO role check here — FR-030 is enforced in the
          data layer (server/src/services/readModel.ts, api/mock/index.ts), which sends a Field
          User nulls for all three. So the card simply has nothing to show them, and the UI cannot
          disagree with the security rule because it never re-states it. `carrier` is not a
          secured field and shows for everyone. */}
      {(asset.carrier || asset.identifiervalue || asset.phonenumber || asset.staticip) && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            background: tokens.colorNeutralBackground1,
            padding: 12,
            borderRadius: 8,
          }}
        >
          <Text weight="semibold" size={200} style={{ gridColumn: "1 / -1" }}>
            {t("asset.sim.title")}
          </Text>
          {asset.carrier && <Field label={t("asset.sim.carrier")} value={asset.carrier} />}
          {asset.identifiervalue && <Field label={t("asset.sim.iccid")} value={asset.identifiervalue} />}
          {asset.phonenumber && <Field label={t("asset.sim.phone")} value={asset.phonenumber} />}
          {asset.staticip && <Field label={t("asset.sim.staticIp")} value={asset.staticip} />}
        </section>
      )}

      {/* UI spec G-11: an asset's open Component and Kit children — the SLM's pre-amp and
          element, a modem's SIM, or whatever is checked out under this logger right now.
          A permanent Component carries no transaction line of its own, so without this list
          there was nowhere on screen showing what travels with the asset. */}
      {children.length > 0 && (
        <section>
          <Text weight="semibold" size={200} style={{ display: "block", marginBottom: 4 }}>
            {t("asset.children")}
          </Text>
          {children.map((rel) => (
            <div
              key={rel.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/asset/${encodeURIComponent(rel.childasset)}`)}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/asset/${encodeURIComponent(rel.childasset)}`)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, cursor: "pointer" }}
            >
              <Text font="monospace" weight="semibold" size={200}>
                {rel.childasset}
              </Text>
              <Badge color={rel.relationshiptype === "Component" ? "informative" : "subtle"}>
                {rel.relationshiptype}
              </Badge>
            </div>
          ))}
        </section>
      )}

      {deployments.length > 0 && (
        <section>
          <Text weight="semibold" size={200} style={{ display: "block", marginBottom: 4 }}>
            {t("site.title")}
          </Text>
          {deployments.map(({ installation, kitrole, orientation }) => (
            <div
              key={installation.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/site/${encodeURIComponent(installation.site)}`)}
              onKeyDown={(e) => e.key === "Enter" && navigate(`/site/${encodeURIComponent(installation.site)}`)}
              style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, cursor: "pointer" }}
            >
              <Text weight="semibold" size={200}>
                {installation.sitename} — {installation.project}
                {!installation.end && (
                  <Badge color="informative" style={{ marginLeft: 6 }}>
                    {t("site.detail.current")}
                  </Badge>
                )}
              </Text>
              <br />
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {kitrole ?? "—"}
                {orientation ? ` · ${orientation}` : ""} · {installation.start.slice(0, 10)}
                {installation.end ? ` → ${installation.end.slice(0, 10)}` : ""}
              </Text>
            </div>
          ))}
        </section>
      )}

      <section style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
      </section>

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "history" | "calibration")}>
        <Tab value="history">{t("asset.tabs.history")}</Tab>
        <Tab value="calibration">{t("asset.tabs.calibration")}</Tab>
      </TabList>

      {tab === "history" && (
        <div>
          {history.length === 0 && <Text>{t("asset.history.empty")}</Text>}
          {history.map((h) => (
            <div key={h.id} style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
              <Text weight="semibold" size={200}>
                {new Date(h.transactiondate).toLocaleString()} — {h.transactiontype}
              </Text>
              <br />
              <Text size={200}>
                {statusLabel(h.statusbefore)} → {statusLabel(h.statusafter)}
                {h.touser ? ` · to ${h.touser}` : ""}
                {h.tolocation ? ` · to ${h.tolocation}` : ""}
                {h.toproject ? ` · project ${h.toproject}` : ""}
              </Text>
              <br />
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                by {h.performedby}
              </Text>
            </div>
          ))}
        </div>
      )}

      {tab === "calibration" && (
        <div>
          {calRecords.length === 0 && <Text>{t("common.none")}</Text>}
          {calRecords.map((r, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
              <Text size={200}>
                {r.calibrationdate} → next due {r.nextduedate} {r.lab ? `· ${r.lab}` : ""}
              </Text>
              {r.certificateurl && (
                <>
                  <br />
                  <a href={r.certificateurl} target="_blank" rel="noreferrer">
                    {t("asset.history.openCertificate")}
                  </a>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {asset.notes && (
        <section>
          <Text weight="semibold" size={200} style={{ display: "block" }}>
            {t("asset.notes")}
          </Text>
          <Text size={200} style={{ whiteSpace: "pre-wrap", display: "block" }}>
            {asset.notes}
          </Text>
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
    </div>
  );
}

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {label}
      </Text>
      <br />
      <Text weight="semibold" style={danger ? { color: tokens.colorPaletteRedForeground1 } : undefined}>
        {value}
      </Text>
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
    <Tooltip content={children} relationship="label">
      <Button appearance={danger ? "outline" : "secondary"} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}
