// MIRROR of apps/englobe-ams-field/src/screens/SearchScreen.tsx — see zite/README.md.
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { searchAssets, SearchAssetsOutputType } from 'zitejs/api';
import { AssetRow } from '../components/AssetRow';
import { t } from '../strings';

type Groups = SearchAssetsOutputType['groups'];

/** S01 Search / Home — docs/12 5.1. Debounced 250 ms, searches from 3 characters. */
export function SearchScreen({ onOpenAsset }: { onOpenAsset: (assetId: string) => void }) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<Groups>([]);
  const [state, setState] = useState<'idle' | 'hint' | 'loading' | 'results' | 'empty'>('idle');
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) { setState('idle'); setGroups([]); return; }
    if (q.length < 3) { setState('hint'); setGroups([]); return; }

    setState('loading');
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      searchAssets({ query: q })
        .then(r => {
          // Ignore a response that a newer keystroke has already superseded.
          if (mine !== seq.current) return;
          setGroups(r.groups);
          setState(r.total === 0 ? 'empty' : 'results');
        })
        .catch(() => { if (mine === seq.current) { setGroups([]); setState('empty'); } });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="h-9 w-full rounded border border-neutral-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-neutral-500"
            autoComplete="off"
            aria-label={t('search.placeholder')}
          />
        </div>
      </div>

      {state === 'hint' && (
        <p className="px-3 pb-3 text-sm text-neutral-500">{t('search.minChars')}</p>
      )}

      {state === 'idle' && (
        <p className="px-3 pb-3 text-sm text-neutral-500">
          Search the fleet by Asset ID, serial number, or model name.
        </p>
      )}

      {state === 'loading' && (
        <p className="px-3 pb-3 text-sm text-neutral-500">{t('common.loading')}</p>
      )}

      {state === 'empty' && (
        <div className="px-3 pb-3">
          <p className="text-sm text-neutral-700">{t('search.noResults', { query: query.trim() })}</p>
          <button
            type="button"
            onClick={() => setQuery(query.trim().split(/\s+/)[0])}
            className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-sm active:bg-neutral-100"
          >
            {t('search.searchByModelInstead')}
          </button>
        </div>
      )}

      {state === 'results' && groups.map(g => (
        <div key={g.label}>
          {/* Group label is the equipment type — the raw enum name, per the design note in 5.1. */}
          <div className="flex items-center justify-between bg-neutral-100 px-3 py-1.5">
            <span className="text-xs font-semibold">{g.label}</span>
            <span className="text-xs text-neutral-600">{g.count}</span>
          </div>
          {g.assets.map(a => (
            <AssetRow key={a.id} a={a} onOpen={() => onOpenAsset(a.assetId)} />
          ))}
        </div>
      ))}
    </div>
  );
}
