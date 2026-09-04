import type { Location, LocationType, PowerSource } from "../../api/types";
import { t } from "../../i18n";

const LOCATION_TYPES: LocationType[] = ["Site", "Region", "Office", "Vehicle", "CalLab", "Client", "Storage"];
const POWER_SOURCES: PowerSource[] = ["Battery", "Solar", "AC", "External"];
const NEW_SITE_VALUE = "__new__";

export interface SiteFieldsValue {
  site: string;
  locationtype: LocationType;
  sitename: string;
  position: string;
  latitude: string;
  longitude: string;
  coordinatesource: "Manual" | "Device" | null;
  powersource: PowerSource | "";
}

export function emptySiteFields(): SiteFieldsValue {
  return {
    site: "",
    locationtype: "Site",
    sitename: "",
    position: "",
    latitude: "",
    longitude: "",
    coordinatesource: null,
    powersource: "",
  };
}

export function SiteFields({
  value,
  onChange,
  existingSites,
}: {
  value: SiteFieldsValue;
  onChange: (next: SiteFieldsValue) => void;
  existingSites: Location[];
}) {
  const isNewSite = value.site === "" || !existingSites.some((s) => s.name === value.site);

  function set<K extends keyof SiteFieldsValue>(key: K, val: SiteFieldsValue[K]) {
    onChange({ ...value, [key]: val });
  }

  function pickSite(raw: string) {
    if (raw === NEW_SITE_VALUE) {
      onChange({ ...value, site: "" });
      return;
    }
    const existing = existingSites.find((s) => s.name === raw);
    onChange({ ...value, site: raw, sitename: value.sitename || existing?.name || raw });
  }

  // ASSUMPTION: FR-006 — site coordinates are entered by hand, with this optional device-capture
  // button as a convenience where the browser's Geolocation API is available. Automatic capture
  // is unreliable underground and indoors, which is where much of this fleet lives, so hand entry
  // is always the fallback, never blocked while a capture is pending.
  function useDeviceLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
          coordinatesource: "Device",
        });
      },
      () => {
        // capture failed (no signal, permission denied) — hand entry remains available, no error
        // surfaced here since this button is a convenience, not a required step.
      }
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label className="ams-field">
        {t("deploy.site")}
        <select value={isNewSite ? NEW_SITE_VALUE : value.site} onChange={(e) => pickSite(e.target.value)}>
          <option value={NEW_SITE_VALUE}>{t("deploy.siteNew")}</option>
          {existingSites.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {isNewSite && (
        <label className="ams-field">
          {t("deploy.siteNew")}
          <input value={value.site} onChange={(e) => set("site", e.target.value)} />
        </label>
      )}

      <label className="ams-field">
        {t("deploy.locationType")}
        <select value={value.locationtype} onChange={(e) => set("locationtype", e.target.value as LocationType)}>
          {LOCATION_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {lt}
            </option>
          ))}
        </select>
      </label>

      <label className="ams-field">
        {t("deploy.siteName")}
        <input value={value.sitename} onChange={(e) => set("sitename", e.target.value)} />
      </label>

      <label className="ams-field">
        {t("deploy.position")}
        <input value={value.position} onChange={(e) => set("position", e.target.value)} placeholder="POR-403, Pier 3, …" />
      </label>

      <div className="ams-field-row">
        <label className="ams-field">
          {t("deploy.latitude")}
          <input
            value={value.latitude}
            onChange={(e) => onChange({ ...value, latitude: e.target.value, coordinatesource: "Manual" })}
            type="number"
          />
        </label>
        <label className="ams-field">
          {t("deploy.longitude")}
          <input
            value={value.longitude}
            onChange={(e) => onChange({ ...value, longitude: e.target.value, coordinatesource: "Manual" })}
            type="number"
          />
        </label>
      </div>
      <button type="button" className="ams-btn" onClick={useDeviceLocation}>
        {t("deploy.useDevice")}
      </button>
      {value.coordinatesource && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {value.coordinatesource === "Device" ? t("deploy.coordinateSource.device") : t("deploy.coordinateSource.manual")}
        </p>
      )}

      <label className="ams-field">
        {t("deploy.powerSource")}
        <select value={value.powersource} onChange={(e) => set("powersource", e.target.value as PowerSource)}>
          <option value="" disabled>
            —
          </option>
          {POWER_SOURCES.map((ps) => (
            <option key={ps} value={ps}>
              {ps}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
