import { t } from "../i18n";
import { Glyph } from "./Glyph";

export function SearchField({
  value,
  onChange,
  onScan,
  placeholder,
  onSubmit,
  hero,
}: {
  value: string;
  onChange: (value: string) => void;
  onScan?: () => void;
  placeholder: string;
  onSubmit?: () => void;
  hero?: boolean;
}) {
  return (
    <div className={`ams-search${hero ? " hero" : ""}`}>
      <Glyph name="search" size={18} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
      />
      {value.length > 0 && (
        <button type="button" className="ams-search-clear" onClick={() => onChange("")} aria-label={t("search.clear")}>
          <Glyph name="x" size={16} className="ams-ico-sm" />
        </button>
      )}
      {onScan && (
        <button type="button" className="ams-search-scan" onClick={onScan} aria-label={t("search.scan")}>
          <Glyph name="cam" size={18} />
        </button>
      )}
    </div>
  );
}
