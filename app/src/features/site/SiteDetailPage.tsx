import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Spinner } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Installation, InstallationSnapshot } from "../../api/types";
import { Page } from "../../components/Page";
import { SectionLabel } from "../../components/SectionLabel";
import { usePageChrome } from "../../chrome/PageChrome";
import { t } from "../../i18n";
import { SwapDialog } from "./SwapDialog";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SiteDetailPage() {
  const { site = "" } = useParams();
  const navigate = useNavigate();
  const [installations, setInstallations] = useState<Installation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [snapshot, setSnapshot] = useState<InstallationSnapshot | null>(null);
  const [swapFor, setSwapFor] = useState<Installation | null>(null);

  usePageChrome({ title: decodeURIComponent(site), subtitle: t("site.title") });

  async function refresh() {
    const list = await backend.getSiteInstallations(site);
    setInstallations(list);
    const current = list.find((i) => i.end === null) ?? list[0] ?? null;
    setSelectedId((prev) => (prev && list.some((i) => i.id === prev) ? prev : current?.id ?? null));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    backend.getInstallationSnapshot(selectedId, new Date(asOf).toISOString()).then(setSnapshot);
  }, [selectedId, asOf]);

  if (installations === null) return <Spinner style={{ margin: 24 }} label={t("common.loading")} />;

  const current = installations.filter((i) => i.end === null);
  const historical = installations.filter((i) => i.end !== null);
  const selected = installations.find((i) => i.id === selectedId) ?? null;

  return (
    <Page>
      <span className="t-id-lg">{site}</span>
      <div className="ams-actions">
        <button type="button" className="ams-btn ams-btn-primary" onClick={() => navigate("/deploy")}>
          {t("site.deployAction")}
        </button>
      </div>

      <section>
        <SectionLabel count={current.length}>{t("site.detail.current")}</SectionLabel>
        {current.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t("common.none")}
          </p>
        ) : (
          <div className="ams-list">
            {current.map((i) => (
              <div
                key={i.id}
                className="ams-attn"
                style={{
                  flexDirection: "column",
                  alignItems: "stretch",
                  background: selectedId === i.id ? "var(--brandTint)" : undefined,
                }}
                onClick={() => setSelectedId(i.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedId(i.id)}
              >
                <span className="ams-attn-body">
                  <div className="l">
                    {i.sitename} · {i.project}
                  </div>
                  <div className="s">
                    since {i.start.slice(0, 10)} · {i.primaryasset}
                  </div>
                </span>
                <span className="ams-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="ams-btn" onClick={() => setSwapFor(i)}>
                    {t("swap.title")}
                  </button>
                  <button
                    type="button"
                    className="ams-btn ams-btn-primary"
                    onClick={() => navigate(`/recover/${encodeURIComponent(i.id)}`)}
                  >
                    {t("site.recoverAction")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionLabel count={historical.length}>{t("site.detail.historical")}</SectionLabel>
        {historical.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t("common.none")}
          </p>
        ) : (
          <div className="ams-list">
            {historical.map((i) => (
              <button
                key={i.id}
                type="button"
                className="ams-attn"
                style={{ background: selectedId === i.id ? "var(--brandTint)" : undefined }}
                onClick={() => setSelectedId(i.id)}
              >
                <span className="ams-attn-body">
                  <div className="l">
                    {i.sitename} · {i.project}{" "}
                    <span className="ams-pill ams-pill-Retired">closed</span>
                  </div>
                  <div className="s">
                    {i.start.slice(0, 10)} → {i.end?.slice(0, 10)}
                  </div>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && (
        <>
          <label className="ams-field">
            {t("site.detail.asOfDate")}
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>

          <section>
            <SectionLabel>{t("site.detail.components")}</SectionLabel>
            {(snapshot?.components.length ?? 0) === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {t("common.none")}
              </p>
            ) : (
              <div className="ams-list">
                {snapshot?.components.map((c) => (
                  <button
                    key={c.asset}
                    type="button"
                    className="ams-attn"
                    onClick={() => navigate(`/asset/${encodeURIComponent(c.asset)}`)}
                  >
                    <span className="t-id">{c.asset}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {c.kitrole}
                      {c.orientation ? ` · ${c.orientation}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="ams-card">
            <div className="ams-now-grid">
              <NowField label={t("deploy.powerSource")} value={selected.powersource} />
              <NowField label={t("deploy.position")} value={selected.position ?? "—"} />
              <NowField label={t("deploy.locationType")} value={selected.locationtype} />
              <NowField
                label={`${t("deploy.latitude")}/${t("deploy.longitude")}`}
                value={selected.latitude != null && selected.longitude != null ? `${selected.latitude}, ${selected.longitude}` : "—"}
              />
            </div>
          </div>
        </>
      )}

      {swapFor && (
        <SwapDialog
          installation={swapFor}
          onClose={() => setSwapFor(null)}
          onDone={() => {
            setSwapFor(null);
            void refresh();
          }}
        />
      )}
    </Page>
  );
}

function NowField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lab">{label}</div>
      <div className="val">{value}</div>
    </div>
  );
}
