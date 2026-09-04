/**
 * Feature 007 FR-007: while a synthetic dataset is loaded, every screen says so, naming the seed
 * and as-of date. Rendered once in the app shell, which is what makes it true of every screen.
 */
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
        // A backend that cannot answer gets no banner — never a false "this is real data" claim.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.synthetic) return null;

  const unverified = info.verified === false;
  return (
    <div className={`ams-dataset${unverified ? " warn" : ""}`} role="status">
      <strong>{t("dataset.synthetic")}</strong>
      <span>
        {t("dataset.syntheticDetail", { seed: info.seed ?? "—", profile: info.profile ?? "—", asOf: info.asOf ?? "—" })}
      </span>
      {unverified && <strong>{t("dataset.unverified")}</strong>}
    </div>
  );
}
