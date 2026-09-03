/**
 * Feature 007 FR-007: while a synthetic dataset is loaded, every screen says so, naming the seed
 * and as-of date. Rendered once in the app shell, which is what makes it true of every screen.
 *
 * The real migrated data carries no manifest, and its absence is what identifies it as real — the
 * safe direction: a dataset that fails to declare itself synthetic is treated as real and gets no
 * banner, but nothing can be silently mistaken for real data while claiming to be synthetic.
 */
import { Text, tokens } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { backend, type DatasetInfo } from "../api";
import { t } from "../i18n";

export function DatasetBanner() {
  const [info, setInfo] = useState<DatasetInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    backend
      .getDatasetInfo()
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {
        // A backend that cannot answer (the Dataverse stub) gets no banner — never a false
        // "this is real data" claim, and never a crash in the app shell.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.synthetic) return null;

  const unverified = info.verified === false;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: 8,
        padding: "4px 12px",
        background: unverified ? tokens.colorPaletteRedBackground2 : tokens.colorPaletteYellowBackground2,
        color: tokens.colorNeutralForeground1,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      }}
    >
      <Text weight="semibold" size={200}>
        {t("dataset.synthetic")}
      </Text>
      <Text size={200}>
        {t("dataset.syntheticDetail", { seed: info.seed ?? "—", profile: info.profile ?? "—", asOf: info.asOf ?? "—" })}
      </Text>
      {unverified && (
        <Text size={200} weight="semibold">
          {t("dataset.unverified")}
        </Text>
      )}
    </div>
  );
}
