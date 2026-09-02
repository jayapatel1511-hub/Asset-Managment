import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
} from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, CalibrationResult } from "../../api/types";
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
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("calibration.record.title")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("calibration.record.date")} required>
              <Input type="date" value={calibrationdate} max={todayIso()} onChange={(_, d) => setDate(d.value)} />
            </Field>
            <Field label={t("calibration.record.nextDue")} hint="Prefilled from the model's interval if left blank">
              <Input type="date" value={nextduedate} onChange={(_, d) => setNextDue(d.value)} />
            </Field>
            <Field label={t("calibration.record.lab")}>
              <Input value={lab} onChange={(_, d) => setLab(d.value)} />
            </Field>
            <Field label={t("calibration.record.certNumber")}>
              <Input value={certificatenumber} onChange={(_, d) => setCert(d.value)} />
            </Field>
            <Field label={t("calibration.record.cost")}>
              <Input value={cost} onChange={(_, d) => setCost(d.value)} />
            </Field>
            <Field label={t("calibration.record.result")}>
              <Select value={result} onChange={(_, d) => setResult(d.value as CalibrationResult | "")}>
                <option value="">—</option>
                <option value="Pass">Pass</option>
                <option value="Fail">Fail</option>
                <option value="Adjusted">Adjusted</option>
              </Select>
            </Field>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" disabled={busy} onClick={submit}>
              {t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
