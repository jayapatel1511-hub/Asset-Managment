/**
 * S01 — the Field home.
 *
 * Layout follows `docs/mockups/ams-ui/` (hero, quick-action tiles, attention rows, my equipment)
 * and decision D2. Read-only: this screen renders server-owned figures and navigates.
 */
import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@fluentui/react-components";
import { useNavigate } from "react-router-dom";
import { backend } from "../../api";
import type { Asset, HistoryEntry } from "../../api/types";
import { useScan } from "../../chrome/ScanContext";
import { usePageChrome } from "../../chrome/PageChrome";
import { AssetRow } from "../../components/AssetRow";
import { Banner } from "../../components/Banner";
import { Glyph } from "../../components/Glyph";
import { ListFrame } from "../../components/ListFrame";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { t } from "../../i18n";
import { humaniseEnum } from "../../i18n/humanise";
import { greetingKey, firstName, isoDay, splitCalibration, qualityIssuesPath, QUALITY_RULE_OVERDUE, QUALITY_RULE_UNKNOWN_DUE } from "./homeModel";

interface HomeData {
  custody: Asset[];
  dueSoon: number;
  overdue: number;
  unknown: number;
  activity: HistoryEntry[];
}

function relativeLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso.slice(0, 10);
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return t("home.activity.justNow");
  if (mins < 60) return t("home.activity.minutes", { count: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("home.activity.hours", { count: hours });
  if (hours < 48) return t("home.activity.yesterday");
  return t("home.activity.days", { count: Math.round(hours / 24) });
}

export function FieldHomePage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { openScan } = useScan();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const subtitle = useMemo(() => {
    if (!user) return "";
    if (!user.homeoffice) return t("home.subtitle.noOffice");
    const count = data?.custody.length ?? 0;
    return count === 0
      ? t("home.subtitle.custody.none", { office: user.homeoffice })
      : t("home.subtitle.custody", { count, office: user.homeoffice });
  }, [user, data]);

  usePageChrome({ title: t("app.title"), subtitle: user?.homeoffice ?? subtitle });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setFailed(false);
      try {
        const [custody, due] = await Promise.all([
          backend.listAssets({ custodian: user!.upn }),
          backend.listCalibrationDue(30),
        ]);
        const { dueSoon, overdue, unknown } = splitCalibration(due, isoDay(new Date()));
        const histories = await Promise.all(custody.slice(0, 6).map((a) => backend.getAssetHistory(a.assetid)));
        const activity = histories
          .flat()
          .filter((h) => h.performedby === user!.upn)
          .sort((a, b) => b.transactiondate.localeCompare(a.transactiondate))
          .slice(0, 5);
        if (!cancelled) setData({ custody, dueSoon, overdue, unknown, activity });
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return <Spinner label="…" />;

  return (
    <Page>
      <section className="ams-hero">
        <h2>{t(greetingKey(new Date().getHours()), { name: firstName(user.displayName) })}</h2>
        <p>{subtitle}</p>
      </section>

      <nav className="ams-qa-grid" aria-label={t("nav.home")}>
        <button type="button" className="ams-qa primary" onClick={openScan}>
          <span className="ams-qa-ico" aria-hidden>
            <Glyph name="scan" />
          </span>
          {t("home.action.scan")}
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/checkout")}>
          <span className="ams-qa-ico" aria-hidden>
            <Glyph name="out" />
          </span>
          {t("home.action.checkout")}
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/return")}>
          <span className="ams-qa-ico" aria-hidden>
            <Glyph name="back" />
          </span>
          {t("home.action.return")}
        </button>
        <button type="button" className="ams-qa" onClick={() => navigate("/search")}>
          <span className="ams-qa-ico" aria-hidden>
            <Glyph name="search" />
          </span>
          {t("home.search.open")}
        </button>
      </nav>

      {loading && <Spinner label="…" />}
      {failed && <Banner intent="err">{t("home.error")}</Banner>}

      {data && (
        <>
          <section>
            <SectionLabel>{t("home.section.calibration")}</SectionLabel>
            {data.dueSoon === 0 && data.overdue === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t("home.calibration.clear")}
              </p>
            ) : (
              <ListFrame>
                <button type="button" className="ams-attn" onClick={() => navigate(qualityIssuesPath(QUALITY_RULE_OVERDUE))}>
                  <span className={`ams-attn-n${data.overdue > 0 ? " bad" : ""}`}>{data.overdue}</span>
                  <span className="ams-attn-body">
                    <div className="l">{t("home.calibration.overdue")}</div>
                  </span>
                </button>
                <button type="button" className="ams-attn" onClick={() => navigate("/calibration")}>
                  <span className={`ams-attn-n${data.dueSoon > 0 ? " warn" : ""}`}>{data.dueSoon}</span>
                  <span className="ams-attn-body">
                    <div className="l">{t("home.calibration.dueSoon")}</div>
                  </span>
                </button>
              </ListFrame>
            )}
            {data.unknown > 0 && (
              <button
                type="button"
                className="ams-btn"
                style={{ marginTop: 8 }}
                onClick={() => navigate(qualityIssuesPath(QUALITY_RULE_UNKNOWN_DUE))}
              >
                {t("home.calibration.unknown", { count: data.unknown })}
              </button>
            )}
          </section>

          <section>
            <SectionLabel>{t("home.section.activity")}</SectionLabel>
            {data.activity.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t("home.section.activity.empty")}
              </p>
            ) : (
              <ListFrame>
                {data.activity.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="ams-attn"
                    onClick={() => navigate(`/asset/${encodeURIComponent(entry.asset)}`)}
                  >
                    <span className="ams-attn-body">
                      <div className="l">
                        {humaniseEnum(entry.transactiontype)}{" "}
                        <span className="t-id">{entry.asset}</span>
                      </div>
                    </span>
                    <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {relativeLabel(entry.transactiondate)}
                    </span>
                  </button>
                ))}
              </ListFrame>
            )}
          </section>

          <section>
            <SectionLabel count={data.custody.length}>{t("home.section.custody")}</SectionLabel>
            {data.custody.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t("home.custody.empty")}
              </p>
            ) : (
              <>
                <ListFrame>
                  {data.custody.slice(0, 5).map((asset) => (
                    <AssetRow key={asset.assetid} asset={asset} />
                  ))}
                </ListFrame>
                {data.custody.length > 5 && (
                  <button type="button" className="ams-btn" onClick={() => navigate("/search")}>
                    {t("home.custody.viewAll", { count: data.custody.length })}
                  </button>
                )}
              </>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
