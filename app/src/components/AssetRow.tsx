import { useNavigate } from "react-router-dom";
import type { Asset } from "../api/types";
import { isIncompleteAssetId } from "../domain/assetId";
import { usePendingSync } from "../hooks/usePendingSync";
import { t } from "../i18n";
import { equipmentTypeLabel } from "../i18n/humanise";
import { StatusPill } from "./StatusPill";

function isOverdue(asset: Asset): boolean {
  if (!asset.nextcaldue) return false;
  return asset.nextcaldue < new Date().toISOString().slice(0, 10);
}

export function AssetRow({ asset, overdueDetail }: { asset: Asset; overdueDetail?: string }) {
  const navigate = useNavigate();
  const overdue = isOverdue(asset);
  const pending = usePendingSync(asset.assetid);
  const go = () => navigate(`/asset/${encodeURIComponent(asset.assetid)}`);
  const where = asset.currentlocation ?? asset.homeoffice ?? "—";

  return (
    <button type="button" className="ams-asset-row" onClick={go}>
      <span className="meta">
        <span className="t-id">
          {asset.assetid}
          {isIncompleteAssetId(asset.assetid) && (
            <span className="ams-pill ams-pill-warn" style={{ marginLeft: 6, verticalAlign: "middle" }}>
              TMP
            </span>
          )}
          {pending && (
            <span className="ams-pill ams-pill-pending" style={{ marginLeft: 6, verticalAlign: "middle" }}>
              {t("offline.pendingBadge")}
            </span>
          )}
        </span>
        <div className="sub">
          {asset.equipmentmodel.manufacturer} {asset.equipmentmodel.model} · {equipmentTypeLabel(asset.equipmentmodel.equipmenttype)}
        </div>
      </span>
      <span className="end">
        <StatusPill status={asset.status} />
        <div className="sub">
          {where}
          {asset.custodian ? ` · ${asset.custodian}` : ""}
        </div>
        {overdue && <div className="sub" style={{ color: "var(--danger)" }}>{overdueDetail ?? t("asset.calOverdue")}</div>}
      </span>
    </button>
  );
}
