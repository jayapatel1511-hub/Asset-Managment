/**
 * Feature 006, User Story 4 — what the fleet is actually doing: proportion of time in each status
 * by equipment type and office (FR-023), idle stock (FR-024), lowest-availability types per
 * office (FR-025), repair/calibration downtime distinguished from productive use (FR-026) — and,
 * ahead of all of that, the honest refusal to present a figure that would cross the migration
 * boundary (FR-027/FR-028). That guard lives in domain/utilisation.ts's `computeUtilisation`
 * itself, not here, specifically so this page cannot forget to check it (spec.md's own framing:
 * "the honesty guard is the feature, not a caveat on it").
 *
 * Read-only, no separate reporting copy (FR-030). Every asset's own history is read once via the
 * same `getAssetHistory` the rest of the app calls.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Dropdown, Option, Spinner, Text, Title2, Title3, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, HistoryEntry } from "../../api/types";
import {
  categorize,
  computeUtilisation,
  isIdleSince,
  recordsBeganAt,
  type InsufficientReason,
  type UtilisationCategory,
} from "../../domain/utilisation";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";

type PeriodDays = 30 | 90 | 365;

interface AssetUtilisation {
  asset: Asset;
  history: HistoryEntry[];
  sufficient: boolean;
  /** Set only when `sufficient` is false — why this asset carries no figure (FR-028). */
  reason?: InsufficientReason;
  /** True when the asset was acquired inside the period, so its window was shortened rather
   * than the figure refused (FR-028 as clarified). */
  clipped: boolean;
  byCategory: Record<UtilisationCategory, number>; // ms, only when sufficient
}

function periodStartIso(days: PeriodDays): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function emptyCategoryTotals(): Record<UtilisationCategory, number> {
  return { Available: 0, InUse: 0, OutOfService: 0, Retired: 0 };
}

function proportionBar(byCategory: Record<UtilisationCategory, number>) {
  const total = byCategory.Available + byCategory.InUse + byCategory.OutOfService + byCategory.Retired;
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  return { available: pct(byCategory.Available), inUse: pct(byCategory.InUse), outOfService: pct(byCategory.OutOfService) };
}

function ProportionRow({ label, byCategory }: { label: string; byCategory: Record<UtilisationCategory, number> }) {
  const pct = proportionBar(byCategory);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Text size={200}>{label || t("common.unknown")}</Text>
        {pct && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {pct.available}%
          </Text>
        )}
      </div>
      {pct ? (
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: tokens.colorNeutralBackground3 }}>
          <div style={{ width: `${pct.available}%`, background: tokens.colorPaletteGreenBackground3 }} title="Available" />
          <div style={{ width: `${pct.inUse}%`, background: tokens.colorPaletteBlueBackground2 }} title="InUse" />
          <div style={{ width: `${pct.outOfService}%`, background: tokens.colorPaletteRedBackground2 }} title="OutOfService" />
        </div>
      ) : (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("reports.utilisation.insufficientHistory")}
        </Text>
      )}
    </div>
  );
}

export function UtilisationPage() {
  const loadedAt = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState<PeriodDays>(90);
  const [rows, setRows] = useState<AssetUtilisation[] | null>(null);

  useEffect(() => {
    setRows(null);
    (async () => {
      const assets = await backend.listAssets({ includeRetired: true }); // FR-029: historical view includes retired
      const from = periodStartIso(period);
      const to = loadedAt.toISOString();

      // Two passes, and it has to be two: FR-028's boundary is the date the FLEET's records
      // began, which is not knowable from one asset's history. Every history is read once and
      // reused for both passes, so this costs no extra backend calls.
      const histories = await Promise.all(
        assets.map(async (asset) => ({ asset, history: await backend.getAssetHistory(asset.assetid) }))
      );
      const recordsBegan = recordsBeganAt(histories.map((h) => h.history));

      const computed = histories.map(({ asset, history }): AssetUtilisation => {
        const result = computeUtilisation(history, from, to, { recordsBegan });
        if (!result.sufficient) {
          return { asset, history, sufficient: false, reason: result.reason, clipped: false, byCategory: emptyCategoryTotals() };
        }
        const byCategory = emptyCategoryTotals();
        for (const span of result.spans) byCategory[categorize(span.status)] += span.durationMs;
        return { asset, history, sufficient: true, clipped: result.clippedToAcquisition, byCategory };
      });
      setRows(computed);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [period]);

  const sufficientRows = rows?.filter((r) => r.sufficient) ?? [];
  const anySufficient = sufficientRows.length > 0;
  // Said out loud rather than folded into the totals silently: how many assets contributed a
  // shortened window because they were bought inside the period, and how many were left out
  // because they were not owned during it at all (FR-028, FR-027).
  const clippedCount = sufficientRows.filter((r) => r.clipped).length;
  const notYetOwnedCount = rows?.filter((r) => r.reason === "notYetAcquired").length ?? 0;

  const byType = useMemo(() => {
    const map = new Map<string, Record<UtilisationCategory, number>>();
    for (const r of sufficientRows) {
      const key = r.asset.equipmentmodel.equipmenttype;
      const acc = map.get(key) ?? emptyCategoryTotals();
      for (const c of Object.keys(acc) as UtilisationCategory[]) acc[c] += r.byCategory[c];
      map.set(key, acc);
    }
    return map;
  }, [sufficientRows]);

  const byOffice = useMemo(() => {
    const map = new Map<string, Record<UtilisationCategory, number>>();
    for (const r of sufficientRows) {
      const key = r.asset.homeoffice ?? "";
      const acc = map.get(key) ?? emptyCategoryTotals();
      for (const c of Object.keys(acc) as UtilisationCategory[]) acc[c] += r.byCategory[c];
      map.set(key, acc);
    }
    return map;
  }, [sufficientRows]);

  // FR-025: equipment types with the lowest availability, per office.
  const lowestAvailability = useMemo(() => {
    const map = new Map<string, Record<UtilisationCategory, number>>();
    for (const r of sufficientRows) {
      const key = `${r.asset.homeoffice ?? t("common.unknown")} · ${r.asset.equipmentmodel.equipmenttype}`;
      const acc = map.get(key) ?? emptyCategoryTotals();
      for (const c of Object.keys(acc) as UtilisationCategory[]) acc[c] += r.byCategory[c];
      map.set(key, acc);
    }
    return [...map.entries()]
      .map(([key, byCategory]) => ({ key, pct: proportionBar(byCategory)?.available ?? null }))
      .filter((r) => r.pct !== null)
      .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
      .slice(0, 5);
  }, [sufficientRows]);

  // FR-024: not transacted within the selected period — idle regardless of whether the period
  // itself is long enough for a proportion figure (idleness only needs a last-activity date, not
  // a full window, so it is not gated by hasSufficientHistory the way statusSpans is).
  const idle = useMemo(() => {
    if (!rows) return [];
    const cutoff = periodStartIso(period);
    return rows.filter((r) => r.asset.lifecycle === "Active" && isIdleSince(r.history, cutoff)).map((r) => r.asset);
  }, [rows, period]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Title2>{t("reports.utilisation.title")}</Title2>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block", marginTop: 4 }}>
            {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
          </Text>
        </div>
        <Dropdown
          size="small"
          value={period === 30 ? t("calibration.horizon30") : period === 90 ? t("calibration.horizon90") : t("reports.utilisation.period365")}
          selectedOptions={[String(period)]}
          onOptionSelect={(_, d) => setPeriod(Number(d.optionValue) as PeriodDays)}
        >
          <Option value="30">{t("calibration.horizon30")}</Option>
          <Option value="90">{t("calibration.horizon90")}</Option>
          <Option value="365">{t("reports.utilisation.period365")}</Option>
        </Dropdown>
      </div>

      {!rows && <Spinner style={{ margin: 24 }} label={t("common.loading")} />}

      {rows && !anySufficient && (
        <Card style={{ padding: 12 }}>
          <Text>{t("reports.utilisation.insufficientHistory")}</Text>
        </Card>
      )}

      {rows && anySufficient && (clippedCount > 0 || notYetOwnedCount > 0) && (
        <Card style={{ padding: 12 }}>
          <Text size={200} style={{ display: "block" }}>
            {clippedCount > 0 && t("reports.utilisation.clippedToAcquisition", { count: clippedCount })}
          </Text>
          <Text size={200} style={{ display: "block" }}>
            {notYetOwnedCount > 0 && t("reports.utilisation.notYetOwned", { count: notYetOwnedCount })}
          </Text>
        </Card>
      )}

      {rows && anySufficient && (
        <>
          <Card style={{ padding: 12 }}>
            <Title3>{t("reports.fleet.byType")}</Title3>
            <div style={{ marginTop: 8 }}>
              {[...byType.entries()].map(([key, cat]) => (
                <ProportionRow key={key} label={key} byCategory={cat} />
              ))}
            </div>
          </Card>

          <Card style={{ padding: 12 }}>
            <Title3>{t("reports.fleet.byOffice")}</Title3>
            <div style={{ marginTop: 8 }}>
              {[...byOffice.entries()].map(([key, cat]) => (
                <ProportionRow key={key} label={key} byCategory={cat} />
              ))}
            </div>
          </Card>

          <Card style={{ padding: 12 }}>
            <Title3>{t("reports.utilisation.lowestAvailability")}</Title3>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {lowestAvailability.length === 0 && <Text size={200}>{t("common.none")}</Text>}
              {lowestAvailability.map((r) => (
                <div key={r.key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text size={200}>{r.key}</Text>
                  <Badge color={r.pct !== null && r.pct < 20 ? "danger" : "warning"}>{r.pct}%</Badge>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Title3>{t("reports.utilisation.idle")}</Title3>
          <Badge>{idle.length}</Badge>
        </div>
        <div style={{ marginTop: 8, maxHeight: 300, overflowY: "auto", border: `1px solid ${tokens.colorNeutralStroke2}` }}>
          {idle.length === 0 && (
            <Text size={200} style={{ padding: 12, display: "block" }}>
              {t("common.none")}
            </Text>
          )}
          {idle.slice(0, 100).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </div>
      </Card>

      <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
        {t("reports.notPublished")}
      </Text>
    </div>
  );
}
