/**
 * S01 — the Field home.
 *
 * Replaces the search-first home under decision **D2** (`docs/08-decisions.md` § UI decisions,
 * 2026-09-03), which accepted `docs/mockups/review-ref/Assets Console Mobile.dc.html` as the new
 * S01. What changed is the premise: search *was* the home, so a technician who opened the app on
 * site had to know what they were looking for before the app could tell them anything. The
 * question they actually arrive with is "what have I got, and what needs doing?" — so the home now
 * answers that first and offers search as one action among several.
 *
 * The mockup's LAYOUT is adopted; its palette is not. Decision **G-24 = A** settles that Fluent v9
 * + Englobe green wins and the mockup's teal / Inter / warm-stone system does not become the app's
 * design system, so every colour below is a Fluent token and every string comes from the table
 * (FR-031). Nothing here is a hardcoded hex.
 *
 * Read-only by construction. This screen renders four server-owned figures and navigates; it takes
 * no business decision and writes nothing (CLAUDE.md rule 1). The quick actions are links to the
 * screens that own those commands, not shortcuts around them.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text, tokens } from "@fluentui/react-components";
import {
  ArrowExportRegular,
  ArrowImportRegular,
  CameraRegular,
  SearchRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { backend } from "../../api";
import type { Asset, HistoryEntry } from "../../api/types";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";
import { humaniseEnum } from "../../i18n/humanise";
import { DevScanDialog, MOCK_STANDINS_INCLUDED } from "../../devStandins";
import { greetingKey, firstName, initials, isoDay, splitCalibration } from "./homeModel";

interface HomeData {
  custody: Asset[];
  dueSoon: number;
  overdue: number;
  unknown: number;
  activity: HistoryEntry[];
}

export function FieldHomePage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setFailed(false);
      try {
        // Four reads, in parallel. The calibration horizon is the same 30 days the compliance
        // screen uses, so the number here and the number there can never disagree.
        const [custody, due] = await Promise.all([
          backend.listAssets({ custodian: user!.upn }),
          backend.listCalibrationDue(30),
        ]);
        const { dueSoon, overdue, unknown } = splitCalibration(due, isoDay(new Date()));

        // Recent activity is this user's own most recent lines, newest first. Read from history
        // rather than from a notification feed, so it reflects what was actually accepted.
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

  const subtitle = useMemo(() => {
    if (!user) return "";
    if (!user.homeoffice) return t("home.subtitle.noOffice");
    const count = data?.custody.length ?? 0;
    return count === 0
      ? t("home.subtitle.custody.none", { office: user.homeoffice })
      : t("home.subtitle.custody", { count, office: user.homeoffice });
  }, [user, data]);

  if (!user) return <Spinner label="…" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL }}>
      {/* ---- greeting ---------------------------------------------------------------- */}
      <header style={{ display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text as="h1" size={600} weight="semibold" block>
            {t(greetingKey(new Date().getHours()), { name: firstName(user.displayName) })}
          </Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {subtitle}
          </Text>
        </div>
        <div
          aria-hidden
          style={{
            width: 40,
            height: 40,
            flexShrink: 0,
            borderRadius: tokens.borderRadiusCircular,
            background: tokens.colorBrandBackground2,
            color: tokens.colorBrandForeground2,
            display: "grid",
            placeItems: "center",
            fontWeight: 600,
          }}
        >
          {initials(user.displayName)}
        </div>
      </header>

      {!isOnline && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {t("home.offline")}
        </Text>
      )}

      {/* ---- quick actions ------------------------------------------------------------
          Three, because three is what fits at 390 px without wrapping and what the mockup
          proposed. They are the three things a technician does standing in front of a shelf. */}
      <nav style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: tokens.spacingHorizontalS }}>
        {MOCK_STANDINS_INCLUDED && (
          <QuickAction icon={<CameraRegular fontSize={22} />} label={t("home.action.scan")} onClick={() => setScanOpen(true)} />
        )}
        <QuickAction
          icon={<ArrowExportRegular fontSize={22} />}
          label={t("home.action.checkout")}
          onClick={() => navigate("/checkout")}
        />
        <QuickAction
          icon={<ArrowImportRegular fontSize={22} />}
          label={t("home.action.return")}
          onClick={() => navigate("/return")}
        />
      </nav>

      <Button appearance="subtle" icon={<SearchRegular />} onClick={() => navigate("/search")} style={{ justifyContent: "flex-start" }}>
        {t("home.search.open")}
      </Button>

      {loading && <Spinner label="…" />}
      {failed && (
        <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
          {t("home.error")}
        </Text>
      )}

      {data && (
        <>
          {/* ---- calibration ---------------------------------------------------------- */}
          <section>
            <SectionHeading>{t("home.section.calibration")}</SectionHeading>
            {data.dueSoon === 0 && data.overdue === 0 ? (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {t("home.calibration.clear")}
              </Text>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: tokens.spacingHorizontalS }}>
                <CountTile value={data.dueSoon} label={t("home.calibration.dueSoon")} onClick={() => navigate("/calibration")} />
                <CountTile
                  value={data.overdue}
                  label={t("home.calibration.overdue")}
                  tone="warning"
                  onClick={() => navigate("/calibration")}
                />
              </div>
            )}
            {/* FR-017: unknown is stated, never omitted. On the migrated fleet it is the majority
                of assets, so leaving it out would make two honest tiles tell a dishonest story. */}
            {data.unknown > 0 && (
              <Button
                appearance="transparent"
                size="small"
                onClick={() => navigate("/reports/compliance")}
                style={{ marginTop: tokens.spacingVerticalXS, paddingLeft: 0, justifyContent: "flex-start" }}
              >
                {t("home.calibration.unknown", { count: data.unknown })}
              </Button>
            )}
          </section>

          {/* ---- recent activity ------------------------------------------------------ */}
          <section>
            <SectionHeading>{t("home.section.activity")}</SectionHeading>
            {data.activity.length === 0 ? (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {t("home.section.activity.empty")}
              </Text>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {data.activity.map((entry) => (
                  <li
                    key={entry.id}
                    style={{
                      display: "flex",
                      gap: tokens.spacingHorizontalS,
                      padding: `${tokens.spacingVerticalS} 0`,
                      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size={300} weight="semibold">
                        {humaniseEnum(entry.transactiontype)}
                      </Text>{" "}
                      <Text size={300} style={{ fontFamily: tokens.fontFamilyMonospace }}>
                        {entry.asset}
                      </Text>
                    </div>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" }}>
                      {entry.transactiondate.slice(0, 10)}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- custody -------------------------------------------------------------- */}
          <section>
            <SectionHeading>{t("home.section.custody")}</SectionHeading>
            {data.custody.length === 0 ? (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {t("home.custody.empty")}
              </Text>
            ) : (
              <>
                {data.custody.slice(0, 5).map((asset) => (
                  <AssetRow key={asset.assetid} asset={asset} />
                ))}
                {data.custody.length > 5 && (
                  <Button appearance="subtle" onClick={() => navigate("/search")}>
                    {t("home.custody.viewAll", { count: data.custody.length })}
                  </Button>
                )}
              </>
            )}
          </section>
        </>
      )}

      {MOCK_STANDINS_INCLUDED && scanOpen && (
        <DevScanDialog
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onSubmit={(code) => {
            setScanOpen(false);
            navigate(`/search?q=${encodeURIComponent(code)}`);
          }}
        />
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="h2"
      size={200}
      weight="semibold"
      block
      style={{
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: tokens.colorNeutralForeground3,
        marginBottom: tokens.spacingVerticalXS,
      }}
    >
      {children}
    </Text>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button
      appearance="outline"
      onClick={onClick}
      style={{
        height: 76,
        flexDirection: "column",
        gap: tokens.spacingVerticalXXS,
        // 44 px is the documented minimum touch target; 76 gives icon + label room above it.
        minWidth: 0,
      }}
    >
      {icon}
      <Text size={200}>{label}</Text>
    </Button>
  );
}

function CountTile({
  value,
  label,
  tone,
  onClick,
}: {
  value: number;
  label: string;
  tone?: "warning";
  onClick: () => void;
}) {
  const warn = tone === "warning" && value > 0;
  return (
    <Button
      appearance="outline"
      onClick={onClick}
      style={{
        height: 72,
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 0,
        minWidth: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {warn && <WarningRegular fontSize={16} style={{ color: tokens.colorPaletteRedForeground1 }} />}
        <Text size={600} weight="semibold" style={{ color: warn ? tokens.colorPaletteRedForeground1 : undefined }}>
          {value}
        </Text>
      </span>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        {label}
      </Text>
    </Button>
  );
}
