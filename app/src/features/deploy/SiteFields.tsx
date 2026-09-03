import { Button, Field, Input, Select, Text } from "@fluentui/react-components";
import { LocationRegular } from "@fluentui/react-icons";
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
      <Field label={t("deploy.site")} required>
        <Select style={{ minWidth: 0, width: "100%" }} value={isNewSite ? NEW_SITE_VALUE : value.site} onChange={(_, d) => pickSite(d.value)}>
          <option value={NEW_SITE_VALUE}>{t("deploy.siteNew")}</option>
          {existingSites.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      {isNewSite && (
        <Field label={t("deploy.siteNew")} required>
          <Input value={value.site} onChange={(_, d) => set("site", d.value)} />
        </Field>
      )}

      <Field label={t("deploy.locationType")} required>
        <Select style={{ minWidth: 0, width: "100%" }} value={value.locationtype} onChange={(_, d) => set("locationtype", d.value as LocationType)}>
          {LOCATION_TYPES.map((lt) => (
            <option key={lt} value={lt}>
              {lt}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("deploy.siteName")} required>
        <Input value={value.sitename} onChange={(_, d) => set("sitename", d.value)} />
      </Field>

      <Field label={t("deploy.position")}>
        <Input value={value.position} onChange={(_, d) => set("position", d.value)} placeholder="POR-403, Pier 3, …" />
      </Field>

      {/* minWidth: 0 on each half — a flex item defaults to min-width: auto, so a Fluent Input
          cannot shrink below its own min-content width and the pair overflowed a 390px
          viewport (measured: right edge 402px). */}
      <div style={{ display: "flex", gap: 8 }}>
        <Field label={t("deploy.latitude")} style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={value.latitude}
            onChange={(_, d) => onChange({ ...value, latitude: d.value, coordinatesource: "Manual" })}
            type="number"
          />
        </Field>
        <Field label={t("deploy.longitude")} style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={value.longitude}
            onChange={(_, d) => onChange({ ...value, longitude: d.value, coordinatesource: "Manual" })}
            type="number"
          />
        </Field>
      </div>
      <Button appearance="subtle" icon={<LocationRegular />} onClick={useDeviceLocation}>
        {t("deploy.useDevice")}
      </Button>
      {value.coordinatesource && (
        <Text size={200}>
          {value.coordinatesource === "Device" ? t("deploy.coordinateSource.device") : t("deploy.coordinateSource.manual")}
        </Text>
      )}

      <Field label={t("deploy.powerSource")} required>
        <Select style={{ minWidth: 0, width: "100%" }} value={value.powersource} onChange={(_, d) => set("powersource", d.value as PowerSource)}>
          <option value="" disabled>
            —
          </option>
          {POWER_SOURCES.map((ps) => (
            <option key={ps} value={ps}>
              {ps}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
