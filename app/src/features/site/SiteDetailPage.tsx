import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Field, Input, Spinner, Text, Title2, tokens } from "@fluentui/react-components";
import { backend } from "../../api";
import type { Installation, InstallationSnapshot } from "../../api/types";
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
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Title2 style={{ fontFamily: tokens.fontFamilyMonospace }}>{site}</Title2>
      <Button appearance="primary" onClick={() => navigate("/deploy")}>
        {t("site.deployAction")}
      </Button>

      <Text weight="semibold">{t("site.detail.current")}</Text>
      {current.length === 0 && <Text style={{ color: tokens.colorNeutralForeground3 }}>{t("common.none")}</Text>}
      {current.map((i) => (
        <div
          key={i.id}
          onClick={() => setSelectedId(i.id)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 0",
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
            cursor: "pointer",
            background: selectedId === i.id ? tokens.colorNeutralBackground1 : undefined,
          }}
        >
          <div>
            <Text weight={selectedId === i.id ? "semibold" : "regular"}>
              {i.sitename} · {i.project}
            </Text>
            <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
              since {i.start.slice(0, 10)} · {i.primaryasset}
            </Text>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setSwapFor(i);
              }}
            >
              {t("swap.title")}
            </Button>
            <Button
              size="small"
              appearance="primary"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/recover/${encodeURIComponent(i.id)}`);
              }}
            >
              {t("site.recoverAction")}
            </Button>
          </div>
        </div>
      ))}

      <Text weight="semibold">{t("site.detail.historical")}</Text>
      {historical.length === 0 && <Text style={{ color: tokens.colorNeutralForeground3 }}>{t("common.none")}</Text>}
      {historical.map((i) => (
        <div
          key={i.id}
          onClick={() => setSelectedId(i.id)}
          style={{
            padding: "8px 0",
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
            cursor: "pointer",
            background: selectedId === i.id ? tokens.colorNeutralBackground1 : undefined,
          }}
        >
          <Text weight={selectedId === i.id ? "semibold" : "regular"}>
            {i.sitename} · {i.project}
          </Text>
          <Badge appearance="tint" style={{ marginLeft: 8 }}>
            closed
          </Badge>
          <Text size={200} style={{ display: "block", color: tokens.colorNeutralForeground3 }}>
            {i.start.slice(0, 10)} → {i.end?.slice(0, 10)}
          </Text>
        </div>
      ))}

      {selected && (
        <>
          <Field label={t("site.detail.asOfDate")}>
            <Input type="date" value={asOf} onChange={(_, d) => setAsOf(d.value)} />
          </Field>

          <Text weight="semibold">{t("site.detail.components")}</Text>
          {(snapshot?.components.length ?? 0) === 0 && <Text style={{ color: tokens.colorNeutralForeground3 }}>{t("common.none")}</Text>}
          {snapshot?.components.map((c) => (
            <div key={c.asset} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
              <Text font="monospace">{c.asset}</Text>
              <Text size={200}>
                {c.kitrole}
                {c.orientation ? ` · ${c.orientation}` : ""}
              </Text>
            </div>
          ))}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: tokens.colorNeutralBackground1, padding: 12, borderRadius: 8 }}>
            <InfoField label={t("deploy.powerSource")} value={selected.powersource} />
            <InfoField label={t("deploy.position")} value={selected.position ?? "—"} />
            <InfoField label={t("deploy.locationType")} value={selected.locationtype} />
            <InfoField
              label={`${t("deploy.latitude")}/${t("deploy.longitude")}`}
              value={selected.latitude != null && selected.longitude != null ? `${selected.latitude}, ${selected.longitude}` : "—"}
            />
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
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: "block" }}>
        {label}
      </Text>
      <Text weight="semibold">{value}</Text>
    </div>
  );
}
