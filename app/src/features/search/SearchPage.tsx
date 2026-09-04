import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@fluentui/react-components";
import { useNavigate, useSearchParams } from "react-router-dom";
import { backend } from "../../api";
import type { Asset } from "../../api/types";
import { useScan } from "../../chrome/ScanContext";
import { AssetRow } from "../../components/AssetRow";
import { Banner } from "../../components/Banner";
import { categoryGlyph } from "../../components/categoryGlyph";
import { Chip } from "../../components/Chip";
import { EmptyState } from "../../components/EmptyState";
import { Glyph } from "../../components/Glyph";
import { Page } from "../../components/Page";
import { SearchField } from "../../components/SearchField";
import { SectionLabel } from "../../components/SectionLabel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { t } from "../../i18n";
import { equipmentTypeLabel, humaniseEnum } from "../../i18n/humanise";
import { MOCK_STANDINS_INCLUDED } from "../../devStandins";

type QuickFilter = "mine" | "availableHere" | "calDue30" | null;

interface GroupTile {
  name: string;
  total: number;
  available: number;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [disambiguating, setDisambiguating] = useState(false);
  const [results, setResults] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<QuickFilter>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupTile[] | null>(null);
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { openScan } = useScan();
  const [params] = useSearchParams();
  const scanned = params.get("q");

  useEffect(() => {
    let cancelled = false;
    Promise.all([backend.getFleetCounts(), backend.getFleetCounts({ status: ["Available"] })]).then(([all, avail]) => {
      if (cancelled) return;
      setGroups(
        Object.entries(all.byAssetGroup)
          .map(([name, total]) => ({ name, total, available: avail.byAssetGroup[name] ?? 0 }))
          .sort((a, b) => b.total - a.total),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (scanned) {
      void resolveCode(scanned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

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
      if (group) {
        setLoading(true);
        const assets = await backend.listAssets({ assetgroup: group });
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
  }, [query, filter, group, user]);

  const grouped = useMemo(() => {
    if (!results) return null;
    const byType = new Map<string, Asset[]>();
    for (const a of results) {
      const key = a.equipmentmodel.equipmenttype;
      byType.set(key, [...(byType.get(key) ?? []), a]);
    }
    return byType;
  }, [results]);

  async function resolveCode(code: string) {
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
      setResults(bySerial);
      setDisambiguating(true);
      setQuery(code);
      setFilter(null);
      setGroup(null);
    } else {
      setQuery(code);
      setFilter(null);
      setGroup(null);
    }
  }

  function setQuick(next: QuickFilter) {
    setFilter(next);
    setGroup(null);
    setDisambiguating(false);
    if (next) setQuery("");
  }

  const idle = !filter && !group && query.trim().length < 3 && !disambiguating;

  return (
    <Page>
      <SearchField
        hero
        value={query}
        placeholder={t("search.placeholder")}
        onScan={MOCK_STANDINS_INCLUDED ? openScan : undefined}
        onChange={(value) => {
          setQuery(value);
          setFilter(null);
          setGroup(null);
          setDisambiguating(false);
        }}
      />

      <div className="ams-chips">
        <Chip on={filter === "mine"} onClick={() => setQuick(filter === "mine" ? null : "mine")}>
          {t("search.filter.myEquipment")}
        </Chip>
        <Chip on={filter === "availableHere"} onClick={() => setQuick(filter === "availableHere" ? null : "availableHere")}>
          {t("search.filter.availableHere")}
        </Chip>
        <Chip on={filter === "calDue30"} onClick={() => setQuick(filter === "calDue30" ? null : "calDue30")}>
          {t("search.filter.calDue30")}
        </Chip>
      </div>

      {group && (
        <button type="button" className="ams-btn" onClick={() => setGroup(null)}>
          {t("assets.backToCategories")}
        </button>
      )}

      {idle && groups && groups.length > 0 && (
        <section>
          <SectionLabel>{t("assets.subtitle")}</SectionLabel>
          <div className="ams-cat-grid">
            {groups.map((g) => (
              <button key={g.name} type="button" className="ams-cat" onClick={() => setGroup(g.name)}>
                <Glyph name={categoryGlyph(g.name)} />
                <span className="name">{humaniseEnum(g.name)}</span>
                <span className="nums">
                  {g.total} · <b>{t("assets.category.available", { available: g.available })}</b>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <div style={{ padding: 24, display: "flex", justifyContent: "center" }}>
          <Spinner label={t("common.loading")} />
        </div>
      )}

      {!loading && !filter && !group && query.trim().length > 0 && query.trim().length < 3 && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("search.minChars")}
        </p>
      )}

      {!loading && results && results.length === 0 && (
        <EmptyState icon="search" title={t("search.noResults", { query })}>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="ams-btn ams-btn-sm" onClick={() => setQuery(query.split(/\s+/)[0] ?? "")}>
              {t("search.searchByModelInstead")}
            </button>
          </div>
        </EmptyState>
      )}

      {disambiguating && results && results.length > 1 && <Banner intent="warn">{t("asset.disambiguate")}</Banner>}

      {!loading && grouped && results && results.length > 0 && (
        <div>
          {[...grouped.entries()].map(([type, assets]) => (
            <div key={type} className="ams-list" style={{ marginBottom: 12 }}>
              <div className="ams-group-head">
                <span>{equipmentTypeLabel(type)}</span>
                <span>{assets.length}</span>
              </div>
              {assets.map((a) => (
                <AssetRow key={a.id} asset={a} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
