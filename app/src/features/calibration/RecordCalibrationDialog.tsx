import { useState } from "react";
import { backend } from "../../api";
import type { Asset, CalibrationResult } from "../../api/types";
import { Banner } from "../../components/Banner";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n";

const todayIso = () => new Date().toISOString().slice(0, 10);

export function RecordCalibrationDialog({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [calibrationdate, setDate] = useState(todayIso());
  const [nextduedate, setNextDue] = useState("");
  const [lab, setLab] = useState("Montreal Calibration");
  const [certificatenumber, setCert] = useState("");
  const [cost, setCost] = useState("");
  const [result, setResult] = useState<CalibrationResult | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const outcome = await backend.recordCalibration({
      assetId: asset.assetid,
      calibrationdate,
      nextduedate: nextduedate || null,
      lab: lab || null,
      certificatenumber: certificatenumber || null,
      cost: cost || null,
      result: result || null,
      clientSubmissionId: `cal-${asset.assetid}-${Date.now()}`,
    });
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.reason);
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Sheet
      title={t("calibration.record.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ams-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="ams-btn ams-btn-primary" disabled={busy} onClick={submit}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <Banner intent="err">{error}</Banner>}
        <label className="ams-field">
          {t("calibration.record.date")}
          <input type="date" value={calibrationdate} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="ams-field">
          {t("calibration.record.nextDue")}
          <input type="date" value={nextduedate} onChange={(e) => setNextDue(e.target.value)} />
          <span className="hint">Prefilled from the model's interval if left blank</span>
        </label>
        <label className="ams-field">
          {t("calibration.record.lab")}
          <input value={lab} onChange={(e) => setLab(e.target.value)} />
        </label>
        <label className="ams-field">
          {t("calibration.record.certNumber")}
          <input value={certificatenumber} onChange={(e) => setCert(e.target.value)} />
        </label>
        <label className="ams-field">
          {t("calibration.record.cost")}
          <input value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <label className="ams-field">
          {t("calibration.record.result")}
          <select value={result} onChange={(e) => setResult(e.target.value as CalibrationResult | "")}>
            <option value="">—</option>
            <option value="Pass">Pass</option>
            <option value="Fail">Fail</option>
            <option value="Adjusted">Adjusted</option>
          </select>
        </label>
      </div>
    </Sheet>
  );
}
