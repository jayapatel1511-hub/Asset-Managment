import { useState } from "react";
import { backend } from "../../api";
import type { Asset, RetirementReason } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n";

const REASONS: RetirementReason[] = ["Sold", "Lost", "Damaged", "Obsolete"]; // FR-024: fixed list only

export function RetireDialog({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<RetirementReason | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // UI spec G-15: retirement is the one action here with no undo in the app (only a
  // compensating transaction by a System Owner), and it was one tap from a dropdown. The
  // `admin.retire.confirm` string already existed for this and was unused.
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    if (!reason) {
      setError(t("admin.retire.reasonRequired"));
      return;
    }
    if (!confirming) {
      setError(null);
      setConfirming(true);
      return;
    }
    setBusy(true);
    const result = await backend.retireAsset(asset.assetid, reason, `retire-${asset.assetid}-${Date.now()}`);
    setBusy(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Sheet
      title={t("admin.retire.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ams-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`ams-btn ${confirming ? "ams-btn-danger" : "ams-btn-primary"}`}
            disabled={busy}
            onClick={submit}
          >
            {confirming ? t("common.confirm") : t("asset.actions.retire")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <Banner intent="err">{error}</Banner>}
        {confirming && <Banner intent="warn">{t("admin.retire.confirm", { assetId: asset.assetid })}</Banner>}
        <label className="ams-field">
          {t("admin.retire.reason")}
          <select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as RetirementReason);
              setConfirming(false); // a changed reason is a changed decision — confirm it again
            }}
          >
            <option value="" disabled>
              —
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Sheet>
  );
}
