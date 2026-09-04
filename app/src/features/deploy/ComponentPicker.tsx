import { useState } from "react";
import { backend } from "../../api";
import type { Asset, KitRole, Orientation } from "../../api/types";
import { Banner } from "../../components/Banner";
import { SearchField } from "../../components/SearchField";
import { requiresOrientation } from "../../domain/installation";
import { t } from "../../i18n";

export interface ComponentEntry {
  asset: Asset;
  kitRole: KitRole;
  orientation?: Orientation;
}

const ORIENTATIONS: Orientation[] = ["H", "V", "BH", "N", "E", "S", "W"];
const COMPONENT_ROLES: KitRole[] = ["Sensor1", "Sensor2", "Sensor3", "Sensor4", "Microphone", "Modem", "Cellular", "Router", "Accessory"];

export function ComponentPicker({
  components,
  onChange,
  excludeAssetIds,
}: {
  components: ComponentEntry[];
  onChange: (next: ComponentEntry[]) => void;
  excludeAssetIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const q = query.trim();
    if (!q) return;
    const asset = await backend.getAsset(q);
    if (!asset) {
      setError(t("asset.notFound", { query: q }));
      return;
    }
    if (excludeAssetIds.includes(asset.assetid) || components.some((c) => c.asset.assetid === asset.assetid)) {
      setError(`${asset.assetid} is already in this deployment.`);
      return;
    }
    // Client-side mirror of deploy.error.componentAlone (Principle V: refused at both layers) —
    // a permanent Component (the SIM-in-a-modem case) never appears on this form directly; it
    // follows its parent automatically once the parent is deployed.
    const rels = await backend.getAssetRelationships(asset.assetid);
    const isPermanentComponent = rels.some(
      (r) => r.childasset === asset.assetid && r.relationshiptype === "Component" && r.end === null
    );
    if (isPermanentComponent) {
      setError(t("deploy.error.componentAlone", { assetId: asset.assetid }));
      return;
    }
    onChange([...components, { asset, kitRole: "Sensor1" }]);
    setQuery("");
  }

  function remove(assetId: string) {
    onChange(components.filter((c) => c.asset.assetid !== assetId));
  }

  function setRole(assetId: string, kitRole: KitRole) {
    onChange(
      components.map((c) =>
        c.asset.assetid === assetId ? { ...c, kitRole, orientation: requiresOrientation(kitRole) ? c.orientation : undefined } : c
      )
    );
  }

  function setOrientation(assetId: string, orientation: Orientation) {
    onChange(components.map((c) => (c.asset.assetid === assetId ? { ...c, orientation } : c)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SearchField
            value={query}
            placeholder={t("search.placeholder")}
            onChange={setQuery}
            onSubmit={() => query.trim() && add()}
          />
        </div>
        <button type="button" className="ams-btn ams-btn-primary" onClick={add}>
          {t("deploy.addComponent")}
        </button>
      </div>
      {error && <Banner intent="err">{error}</Banner>}

      {components.length > 0 && (
        <div className="ams-list">
          {components.map((c) => (
            <div key={c.asset.assetid} className="ams-cart" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="t-id">{c.asset.assetid}</span>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {c.asset.equipmentmodel.manufacturer} {c.asset.equipmentmodel.model}
                </div>
              </div>
              <label className="ams-field" style={{ minWidth: 110 }}>
                {t("deploy.kitRole")}
                <select value={c.kitRole} onChange={(e) => setRole(c.asset.assetid, e.target.value as KitRole)}>
                  {COMPONENT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {requiresOrientation(c.kitRole) && (
                <label className="ams-field" style={{ minWidth: 90 }}>
                  {t("deploy.orientation")}
                  <select
                    value={c.orientation ?? ""}
                    onChange={(e) => setOrientation(c.asset.assetid, e.target.value as Orientation)}
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {ORIENTATIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="ams-icon-btn" onClick={() => remove(c.asset.assetid)} aria-label={t("cart.remove")}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
