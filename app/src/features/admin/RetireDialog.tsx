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
  MessageBar,
  MessageBarBody,
  Select,
} from "@fluentui/react-components";
import { backend } from "../../api";
import type { Asset, RetirementReason } from "../../api/types";
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
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("admin.retire.title")}</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
            {confirming && (
              <MessageBar intent="warning">
                <MessageBarBody>{t("admin.retire.confirm", { assetId: asset.assetid })}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("admin.retire.reason")} required>
              <Select style={{ minWidth: 0, width: "100%" }} value={reason} onChange={(_, d) => {
                  setReason(d.value as RetirementReason);
                  setConfirming(false); // a changed reason is a changed decision — confirm it again
                }}>
                <option value="" disabled>
                  —
                </option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
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
              {confirming ? t("common.confirm") : t("asset.actions.retire")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
