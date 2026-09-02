// MOCK-ONLY (partial): real camera capture is the Power Apps SDK's barcode scanner
// (docs/02-app.md, "Scan button → barcode scanner (SDK camera)"), which needs a Code App running
// inside Power Apps and is not available in this local browser build. This dialog accepts a
// typed/pasted code instead so the resolution logic FR-021 requires — exact match, bare-serial
// disambiguation, unknown-tag fallback — is fully exercised and testable today. Swapping in the
// real camera view means replacing this dialog's body only; SearchPage.handleScanned already
// implements the resolution rule this camera would feed into.
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
  Text,
} from "@fluentui/react-components";

export function ScanDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (code: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Scan a tag</DialogTitle>
          <DialogContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Text size={200}>
              Camera scanning needs the Power Apps SDK, not available outside Power Apps. Type or paste a
              scanned code to test the same resolution logic.
            </Text>
            <Field label="Asset ID or serial">
              <Input
                autoFocus
                value={value}
                onChange={(_, data) => setValue(data.value)}
                onKeyDown={(e) => e.key === "Enter" && value.trim() && onSubmit(value.trim())}
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">Cancel</Button>
            </DialogTrigger>
            <Button appearance="primary" disabled={!value.trim()} onClick={() => onSubmit(value.trim())}>
              Resolve
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
