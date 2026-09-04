import { useEffect, useState } from "react";
import { backend } from "../../api";
import type { Asset, Location } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n";

export function SendToCalibrationDialog({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [labs, setLabs] = useState<Location[]>([]);
  const [lab, setLab] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.listLocations().then((all) => {
      const cal = all.filter((l) => l.locationtype === "CalLab");
      setLabs(cal);
      if (cal.length === 1) setLab(cal[0].name);
    });
  }, []);

  async function submit() {
    if (!lab) {
      setError("Pick a calibration lab.");
      return;
    }
    setBusy(true);
    const result = await backend.sendToCalibration([asset.assetid], lab, `sendtocal-${asset.assetid}-${Date.now()}`);
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
      title={t("asset.actions.sendToCalibration")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ams-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="ams-btn ams-btn-primary" disabled={busy} onClick={submit}>
            {t("common.confirm")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <Banner intent="err">{error}</Banner>}
        <label className="ams-field">
          {t("calibration.record.lab")}
          <select value={lab} onChange={(e) => setLab(e.target.value)}>
            <option value="" disabled>
              —
            </option>
            {labs.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Sheet>
  );
}
