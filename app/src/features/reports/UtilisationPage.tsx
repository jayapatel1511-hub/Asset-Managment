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
import { Spinner } from "@fluentui/react-components";
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
import { Banner } from "../../components/Banner";
import { Chip } from "../../components/Chip";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
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
    <div style={{ marginBottom: 8 }}>
      <div className="ams-breakdown-row">
        <span className="k">{label || t("common.unknown")}</span>
        {pct && <span className="n muted">{pct.available}%</span>}
      </div>
      {pct ? (
        <div className="ams-chart-row">
          <span style={{ width: `${pct.available}%`, background: "var(--avail)" }} title="Available" />
          <span style={{ width: `${pct.inUse}%`, background: "var(--out)" }} title="InUse" />
          <span style={{ width: `${pct.outOfService}%`, background: "var(--repair)" }} title="OutOfService" />
        </div>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t("reports.utilisation.insufficientHistory")}
        </p>
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
    <Page>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t("reports.dataAsOf", { time: loadedAt.toLocaleString() })}
      </p>
      <div className="ams-chips">
        <Chip on={period === 30} onClick={() => setPeriod(30)}>
          {t("calibration.horizon30")}
        </Chip>
        <Chip on={period === 90} onClick={() => setPeriod(90)}>
          {t("calibration.horizon90")}
        </Chip>
        <Chip on={period === 365} onClick={() => setPeriod(365)}>
          {t("reports.utilisation.period365")}
        </Chip>
      </div>

      {!rows && <Spinner style={{ margin: 24 }} label={t("common.loading")} />}

      {rows && !anySufficient && (
        <Banner intent="info">{t("reports.utilisation.insufficientHistory")}</Banner>
      )}

      {rows && anySufficient && (clippedCount > 0 || notYetOwnedCount > 0) && (
        <Banner intent="info">
          {clippedCount > 0 && <div>{t("reports.utilisation.clippedToAcquisition", { count: clippedCount })}</div>}
          {notYetOwnedCount > 0 && <div>{t("reports.utilisation.notYetOwned", { count: notYetOwnedCount })}</div>}
        </Banner>
      )}

      {rows && anySufficient && (
        <>
          <section>
            <SectionLabel>{t("reports.fleet.byType")}</SectionLabel>
            <div className="ams-card">
              {[...byType.entries()].map(([key, cat]) => (
                <ProportionRow key={key} label={key} byCategory={cat} />
              ))}
              <div className="ams-legend">
                <span><i style={{ background: "var(--avail)" }} />Available</span>
                <span><i style={{ background: "var(--out)" }} />In use</span>
                <span><i style={{ background: "var(--repair)" }} />Out of service</span>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel>{t("reports.fleet.byOffice")}</SectionLabel>
            <div className="ams-card">
              {[...byOffice.entries()].map(([key, cat]) => (
                <ProportionRow key={key} label={key} byCategory={cat} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>{t("reports.utilisation.lowestAvailability")}</SectionLabel>
            <div className="ams-list">
              {lowestAvailability.length === 0 && <div className="ams-empty">{t("common.none")}</div>}
              {lowestAvailability.map((r) => (
                <div key={r.key} className="ams-attn">
                  <span className="ams-attn-body">
                    <div className="l">{r.key}</div>
                  </span>
                  <span className={`ams-pill ${r.pct !== null && r.pct < 20 ? "ams-pill-NeedsRepair" : "ams-pill-warn"}`}>
                    {r.pct}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section>
        <SectionLabel count={idle.length}>{t("reports.utilisation.idle")}</SectionLabel>
        <ListFrame>
          {idle.length === 0 && <div className="ams-empty">{t("common.none")}</div>}
          {idle.slice(0, 100).map((a) => (
            <AssetRow key={a.id} asset={a} />
          ))}
        </ListFrame>
      </section>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {t("reports.notPublished")}
      </p>
    </Page>
  );
}
