import { useState } from "react";
import { Button, Field, Input, MessageBar, MessageBarBody, Select, Text, tokens } from "@fluentui/react-components";
import { DeleteRegular } from "@fluentui/react-icons";
import { backend } from "../../api";
import type { Asset, KitRole, Orientation } from "../../api/types";
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
      <div style={{ display: "flex", gap: 8 }}>
        <Input
          style={{ flex: 1 }}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button appearance="primary" onClick={add}>
          {t("deploy.addComponent")}
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {components.map((c) => (
        <div
          key={c.asset.assetid}
          style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}
        >
          <div style={{ flex: 1 }}>
            <Text font="monospace" weight="semibold" style={{ display: "block" }}>
              {c.asset.assetid}
            </Text>
            <Text size={200}>
              {c.asset.equipmentmodel.manufacturer} {c.asset.equipmentmodel.model}
            </Text>
          </div>
          <Field label={t("deploy.kitRole")}>
            <Select style={{ minWidth: 0, width: "100%" }} value={c.kitRole} onChange={(_, d) => setRole(c.asset.assetid, d.value as KitRole)}>
              {COMPONENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          {requiresOrientation(c.kitRole) && (
            <Field label={t("deploy.orientation")} required>
              <Select style={{ minWidth: 0, width: "100%" }} value={c.orientation ?? ""} onChange={(_, d) => setOrientation(c.asset.assetid, d.value as Orientation)}>
                <option value="" disabled>
                  —
                </option>
                {ORIENTATIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => remove(c.asset.assetid)} aria-label={t("cart.remove")} />
        </div>
      ))}
    </div>
  );
}
