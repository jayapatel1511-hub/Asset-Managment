import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n";

export function FaultDialog({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ams-btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="ams-btn ams-btn-primary" onClick={() => onSubmit(notes)}>
            {t("common.confirm")}
          </button>
        </>
      }
    >
      <label className="ams-field">
        {t("asset.notes")}
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
    </Sheet>
  );
}
