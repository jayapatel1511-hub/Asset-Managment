import { Badge, Text, tokens } from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import type { Asset } from "../api/types";
import { isIncompleteAssetId } from "../domain/assetId";
import { usePendingSync } from "../hooks/usePendingSync";
import { t } from "../i18n";
import { StatusPill } from "./StatusPill";
import { CalendarClockRegular, WarningRegular } from "@fluentui/react-icons";

function isOverdue(asset: Asset): boolean {
  if (!asset.nextcaldue) return false;
  return asset.nextcaldue < new Date().toISOString().slice(0, 10);
}

export function AssetRow({ asset, overdueDetail }: { asset: Asset; overdueDetail?: string }) {
  const navigate = useNavigate();
  const overdue = isOverdue(asset);
  // FR-040 / UI spec C10: a submission touching this asset has not been confirmed yet.
  const pending = usePendingSync(asset.assetid);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/asset/${encodeURIComponent(asset.assetid)}`)}
      onKeyDown={(e) => e.key === "Enter" && navigate(`/asset/${encodeURIComponent(asset.assetid)}`)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text font="monospace" weight="bold">
          {asset.assetid}
          {isIncompleteAssetId(asset.assetid) && (
            <WarningRegular fontSize={14} style={{ marginLeft: 6, color: tokens.colorPaletteMarigoldForeground1, verticalAlign: "text-bottom" }} />
          )}
        </Text>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {pending && <Badge color="warning" size="small">{t("offline.pendingBadge")}</Badge>}
          <StatusPill status={asset.status} />
        </div>
      </div>
      <Text size={200}>
        {asset.equipmentmodel.manufacturer} {asset.equipmentmodel.model}
      </Text>
      <div style={{ display: "flex", justifyContent: "space-between", color: tokens.colorNeutralForeground3 }}>
        <Text size={200}>{asset.currentlocation ?? asset.homeoffice ?? "—"}</Text>
        <Text size={200}>{asset.custodian ?? ""}</Text>
      </div>
      {overdue && (
        <Text size={200} style={{ color: tokens.colorPaletteRedForeground1, display: "flex", alignItems: "center", gap: 4 }}>
          <CalendarClockRegular fontSize={14} /> {overdueDetail ?? t("asset.calOverdue")}
        </Text>
      )}
    </div>
  );
}
