import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  ToggleButton,
  tokens,
} from "@fluentui/react-components";
import { CameraRegular, SearchRegular } from "@fluentui/react-icons";
import { useNavigate } from "react-router-dom";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { AssetRow } from "../../components/AssetRow";
import { t } from "../../i18n";
// Feature 008 T012: the typed-code stand-in for the SDK camera is excluded from a release
// bundle by src/devStandins.tsx's build-time gate.
import { DevScanDialog, MOCK_STANDINS_INCLUDED } from "../../devStandins";

type QuickFilter = "mine" | "availableHere" | "calDue30" | null;

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<QuickFilter>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { user } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (filter) {
        setLoading(true);
        let assets: Asset[];
        if (filter === "mine" && user) {
          assets = await backend.listAssets({ custodian: user.upn });
        } else if (filter === "availableHere" && user) {
          assets = await backend.listAssets({ office: user.homeoffice ?? undefined, status: ["Available"] });
        } else {
          assets = await backend.listCalibrationDue(30);
        }
        if (!cancelled) {
          setResults(assets);
          setLoading(false);
        }
        return;
      }
      if (query.trim().length < 3) {
        setResults(null);
        return;
      }
      setLoading(true);
      const debounce = setTimeout(async () => {
        const assets = await backend.searchAssets(query);
        if (!cancelled) {
          setResults(assets);
          setLoading(false);
        }
      }, 250);
      return () => clearTimeout(debounce);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, filter, user]);

  const grouped = useMemo(() => {
    if (!results) return null;
    const byType = new Map<string, Asset[]>();
    for (const a of results) {
      const key = a.equipmentmodel.equipmenttype;
      byType.set(key, [...(byType.get(key) ?? []), a]);
    }
    return byType;
  }, [results]);

  async function handleScanned(code: string) {
    setScanOpen(false);
    const exact = await backend.getAsset(code);
    if (exact) {
      navigate(`/asset/${encodeURIComponent(exact.assetid)}`);
      return;
    }
    const matches = await backend.searchAssets(code);
    const bySerial = matches.filter((m) => m.serialnumber?.toLowerCase() === code.toLowerCase());
    if (bySerial.length === 1) {
      navigate(`/asset/${encodeURIComponent(bySerial[0].assetid)}`);
    } else if (bySerial.length > 1) {
      setResults(bySerial); // FR-021: present a choice rather than a guess
      setQuery(code);
    } else {
      setQuery(code); // unknown tag — fall back to a prefilled search, per FR-021 / US6 scenario 3
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {!isOnline && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("search.cached", { time: new Date().toLocaleTimeString() })}</MessageBarBody>
        </MessageBar>
      )}
      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <Input
          style={{ flex: 1 }}
          contentBefore={<SearchRegular />}
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(_, data) => {
            setQuery(data.value);
            setFilter(null);
          }}
        />
        {/* The button goes with the dialog: in a release bundle there is no scanner behind it
            yet (the SDK barcode scanner needs a Code App running inside Power Apps), and a
            button that does nothing is worse than no button. Returns with the real camera. */}
        {MOCK_STANDINS_INCLUDED && (
          <Button icon={<CameraRegular />} onClick={() => setScanOpen(true)}>
            {t("search.scan")}
          </Button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "0 12px 8px", flexWrap: "wrap" }}>
        <ToggleButton size="small" checked={filter === "mine"} onClick={() => setFilter(filter === "mine" ? null : "mine")}>
          {t("search.filter.myEquipment")}
        </ToggleButton>
        <ToggleButton
          size="small"
          checked={filter === "availableHere"}
          onClick={() => setFilter(filter === "availableHere" ? null : "availableHere")}
        >
          {t("search.filter.availableHere")}
        </ToggleButton>
        <ToggleButton
          size="small"
          checked={filter === "calDue30"}
          onClick={() => setFilter(filter === "calDue30" ? null : "calDue30")}
        >
          {t("search.filter.calDue30")}
        </ToggleButton>
      </div>

      {loading && (
        <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
          <Spinner label={t("common.loading")} />
        </div>
      )}

      {!loading && !filter && query.trim().length > 0 && query.trim().length < 3 && (
        <Text style={{ padding: 12, color: tokens.colorNeutralForeground3 }}>{t("search.minChars")}</Text>
      )}

      {!loading && results && results.length === 0 && (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <Text>{t("search.noResults", { query })}</Text>
          <Button appearance="secondary" onClick={() => setQuery(query.split(/\s+/)[0] ?? "")}>
            {t("search.searchByModelInstead")}
          </Button>
        </div>
      )}

      {!loading && grouped && results && results.length > 0 && (
        <div>
          {[...grouped.entries()].map(([type, assets]) => (
            <div key={type}>
              <div style={{ padding: "6px 12px", background: tokens.colorNeutralBackground3, display: "flex", justifyContent: "space-between" }}>
                <Text weight="semibold" size={200}>
                  {type}
                </Text>
                <Text size={200}>{assets.length}</Text>
              </div>
              {assets.map((a) => (
                <AssetRow key={a.id} asset={a} />
              ))}
            </div>
          ))}
        </div>
      )}

      <DevScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onSubmit={handleScanned} />
    </div>
  );
}
