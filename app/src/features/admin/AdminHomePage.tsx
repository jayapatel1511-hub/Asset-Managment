import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Text, Title2, Title3, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { isIncompleteAssetId } from "../../domain/assetId";
import { AssetRow } from "../../components/AssetRow";
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
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <Title2>{t("admin.title")}</Title2>

      <Card style={{ padding: 16 }}>
        <Title3>{t("admin.newAsset")}</Title3>
        <Text size={200} style={{ display: "block", marginBottom: 8 }}>
          Pick a model from the catalogue, get an immutable Asset ID (FR-006), register.
        </Text>
        <Button appearance="primary" onClick={() => navigate("/admin/new-asset")}>
          {t("admin.newAsset")}
        </Button>
      </Card>

      {/* Entry points for features not on the bottom nav (AGENT-BRIEF.md §5: this page is not
          owned by any single workstream — the orchestrator maintains these three links so WS-B/
          C/D don't collide adding their own). */}
      <Card style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button onClick={() => navigate("/reports")}>{t("reports.title")}</Button>
        <Button onClick={() => navigate("/admin/office-admins")}>{t("admin.officeAdmins.title")}</Button>
        <Button onClick={() => navigate("/needs-attention")}>{t("offline.needsAttention.title")}</Button>
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Title3>Field-completion queue</Title3>
          <Badge color="warning">{needsCompletion.length}</Badge>
        </div>
        <Text size={200} style={{ display: "block", margin: "4px 0 8px" }}>
          Temporary tags and assets with no recorded home office (feature 002 FR-032) — not a
          separate table, a live query over the registry.
        </Text>
        <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}` }}>
          {needsCompletion.length === 0 && (
            <Text size={200} style={{ padding: 12, display: "block" }}>
              {t("common.none")}
            </Text>
          )}
          {needsCompletion.slice(0, 50).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Title3>Return sweep (Q3 / pilot week)</Title3>
          <Badge color="informative">{sweep.length}</Badge>
        </div>
        <Text size={200} style={{ display: "block", margin: "4px 0 8px" }}>
          Loaded as CheckedOut with no custodian at migration — return each as it's physically
          located (FR-025 restricts this to an administrator since there's no custodian).
        </Text>
        <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}` }}>
          {sweep.slice(0, 50).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </div>
      </Card>
    </div>
  );
}
