import { useEffect, useState } from "react";
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
  MessageBar,
  MessageBarBody,
  Select,
} from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, Location } from "../../api/types";
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
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("asset.actions.sendToCalibration")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("calibration.record.lab")} required>
              <Select style={{ minWidth: 0, width: "100%" }} value={lab} onChange={(_, d) => setLab(d.value)}>
                <option value="" disabled>
                  —
                </option>
                {labs.map((l) => (
                  <option key={l.id} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button appearance="primary" disabled={busy} onClick={submit}>
              {t("common.confirm")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
