import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { isIncompleteAssetId } from "../../domain/assetId";
import { AssetRow } from "../../components/AssetRow";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";

export function AdminHomePage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[] | null>(null);

  useEffect(() => {
    backend.listAssets({ includeRetired: false }).then(setAssets);
  }, []);

  const needsCompletion = assets?.filter((a) => isIncompleteAssetId(a.assetid) || a.homeoffice === "Unassigned") ?? [];
  const sweep = assets?.filter((a) => a.status === "CheckedOut" && !a.custodian) ?? [];

  return (
    <Page>
      <nav className="ams-qa-grid">
        <button type="button" className="ams-qa primary" onClick={() => navigate("/admin/new-asset")}>
          <span>{t("admin.newAsset")}</span>
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/admin/office-admins")}>
          <span>{t("admin.officeAdmins.title")}</span>
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/admin/reference")}>
          <span>{t("admin.reference.title")}</span>
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/data-management")}>
          <span>{t("dm.title")}</span>
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/reports")}>
          <span>{t("reports.title")}</span>
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/needs-attention")}>
          <span>{t("offline.needsAttention.title")}</span>
        </button>
      </nav>

      <section>
        <SectionLabel count={needsCompletion.length}>Field-completion queue</SectionLabel>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
          Temporary tags and assets with no recorded home office — a live query over the registry.
        </p>
        <ListFrame>
          {needsCompletion.length === 0 && <div className="ams-empty">{t("common.none")}</div>}
          {needsCompletion.slice(0, 50).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </ListFrame>
      </section>

      <section>
        <SectionLabel count={sweep.length}>Return sweep</SectionLabel>
        <p className="muted" style={{ margin: "0 0 8px", fontSize: 13 }}>
          Loaded as CheckedOut with no custodian at migration — return each as it is physically located.
        </p>
        <ListFrame>
          {sweep.slice(0, 50).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </ListFrame>
      </section>
    </Page>
  );
}
