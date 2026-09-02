import { useEffect, useMemo, useState } from "react";
import { Badge, Dropdown, Option, Spinner, Text, Title2, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";

type Horizon = 30 | 60 | 90;

function daysOverdue(nextcaldue: string): number {
  const due = new Date(nextcaldue);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

export function CalibrationDuePage() {
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [assets, setAssets] = useState<Asset[] | null>(null);

  useEffect(() => {
    setAssets(null);
    backend.listCalibrationDue(horizon).then(setAssets);
  }, [horizon]);

  const groups = useMemo(() => {
    if (!assets) return null;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = assets.filter((a) => a.nextcaldue && a.nextcaldue < today);
    const due = assets.filter((a) => a.nextcaldue && a.nextcaldue >= today);
    const unknown = assets.filter((a) => !a.nextcaldue);
    const byOffice = (list: Asset[]) => {
      const map = new Map<string, Asset[]>();
      for (const a of list) {
        const key = a.homeoffice ?? t("common.unknown");
        map.set(key, [...(map.get(key) ?? []), a]);
      }
      return map;
    };
    return { overdue: byOffice(overdue), due: byOffice(due), unknown: byOffice(unknown) };
  }, [assets]);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title2>{t("calibration.title")}</Title2>
        <Dropdown
          size="small"
          value={t(`calibration.horizon${horizon}` as "calibration.horizon30")}
          selectedOptions={[String(horizon)]}
          onOptionSelect={(_, d) => setHorizon(Number(d.optionValue) as Horizon)}
        >
          <Option value="30">{t("calibration.horizon30")}</Option>
          <Option value="60">{t("calibration.horizon60")}</Option>
          <Option value="90">{t("calibration.horizon90")}</Option>
        </Dropdown>
      </div>

      {!groups && <Spinner style={{ margin: 24 }} label={t("common.loading")} />}

      {groups && (
        <>
          <GroupSection title={t("calibration.overdueGroup")} byOffice={groups.overdue} tone="danger" />
          <GroupSection title={t("calibration.dueGroup", { days: horizon })} byOffice={groups.due} tone="warning" />
          <GroupSection title={t("calibration.unknownGroup")} byOffice={groups.unknown} tone="subtle" />
        </>
      )}
    </div>
  );
}

function GroupSection({ title, byOffice, tone }: { title: string; byOffice: Map<string, Asset[]>; tone: "danger" | "warning" | "subtle" }) {
  const total = [...byOffice.values()].reduce((n, l) => n + l.length, 0);
  if (total === 0) return null;
  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 16px", background: tokens.colorNeutralBackground3 }}>
        <Text weight="semibold">{title}</Text>
        <Badge color={tone}>{total}</Badge>
      </div>
      {[...byOffice.entries()].map(([office, assets]) => (
        <div key={office}>
          <Text size={200} style={{ display: "block", padding: "4px 16px", color: tokens.colorNeutralForeground3 }}>
            {office} ({assets.length})
          </Text>
          {assets.map((a) => (
            <AssetRow
              key={a.id}
              asset={a}
              overdueDetail={a.nextcaldue && daysOverdue(a.nextcaldue) > 0 ? t("calibration.overdueBy", { days: daysOverdue(a.nextcaldue) }) : undefined}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
