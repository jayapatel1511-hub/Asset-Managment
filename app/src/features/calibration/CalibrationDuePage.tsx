import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { AssetRow } from "../../components/AssetRow";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { t } from "../../i18n";

type Horizon = 30 | 60 | 90;
type OfficeGroups = Map<string, Asset[]>;

function daysOverdue(nextcaldue: string): number {
  const due = new Date(nextcaldue);
  const today = new Date(new Date().toISOString().slice(0, 10));
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

function totalAcross(groups: { overdue: OfficeGroups; due: OfficeGroups; unknown: OfficeGroups }): number {
  return [...groups.overdue.values(), ...groups.due.values(), ...groups.unknown.values()].reduce((n, list) => n + list.length, 0);
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
    <Page>
      <div className="ams-chips">
        <Chip on={horizon === 30} onClick={() => setHorizon(30)}>
          {t("calibration.horizon30")}
        </Chip>
        <Chip on={horizon === 60} onClick={() => setHorizon(60)}>
          {t("calibration.horizon60")}
        </Chip>
        <Chip on={horizon === 90} onClick={() => setHorizon(90)}>
          {t("calibration.horizon90")}
        </Chip>
      </div>

      {!groups && <Spinner style={{ margin: 24 }} label={t("common.loading")} />}

      {groups && (
        <>
          <GroupSection title={t("calibration.overdueGroup")} byOffice={groups.overdue} tone="bad" />
          <GroupSection title={t("calibration.dueGroup", { days: horizon })} byOffice={groups.due} tone="warn" />
          <GroupSection title={t("calibration.unknownGroup")} byOffice={groups.unknown} tone="" />
          {totalAcross(groups) === 0 && <EmptyState icon="cal" title={t("common.none")} />}
        </>
      )}
    </Page>
  );
}

function GroupSection({ title, byOffice, tone }: { title: string; byOffice: Map<string, Asset[]>; tone: "bad" | "warn" | "" }) {
  const total = [...byOffice.values()].reduce((n, l) => n + l.length, 0);
  if (total === 0) return null;
  return (
    <section>
      <SectionLabel count={total}>{title}</SectionLabel>
      {[...byOffice.entries()].map(([office, assets]) => (
        <div key={office} className="ams-list" style={{ marginBottom: 10 }}>
          <div className="ams-group-head">
            <span>{office}</span>
            <span className={tone ? `ams-attn-n ${tone}` : undefined}>{assets.length}</span>
          </div>
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
