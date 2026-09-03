// MIRROR of apps/englobe-ams-field/src/App.tsx — see zite/README.md.
import { useState } from 'react';
import { ArrowLeftRight, Search as SearchIcon } from 'lucide-react';
import { SearchScreen } from './screens/SearchScreen';
import { AssetDetailScreen } from './screens/AssetDetailScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';

// The Field surface (docs/17 G) — the mobile slice only: find it, look at it, take it.
// Deploy, recover, reports, admin, reservations and calibration are Desk and Console
// surfaces and are deliberately absent.
//
// Navigation is local state rather than a router: three screens, one back path. The
// routes in docs/12 (/, /asset/:assetId, /checkout) are the design reference; this test
// environment does not reproduce the URL scheme.
type View =
  | { name: 'search' }
  | { name: 'asset'; assetId: string }
  | { name: 'checkout'; seedAssetId?: string };

export default function App() {
  const [view, setView] = useState<View>({ name: 'search' });

  return (
    // 390px is the specified design width (docs/12 2.1); centred so it is legible on a
    // desktop browser without pretending to be the Desk surface.
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-white text-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <div>
          <div className="text-sm font-bold">Englobe AMS · Field</div>
          <div className="text-[11px] text-neutral-500">Zite test environment — synthetic data only</div>
        </div>
      </header>

      <main className="pb-16">
        {view.name === 'search' && (
          <SearchScreen onOpenAsset={assetId => setView({ name: 'asset', assetId })} />
        )}
        {view.name === 'asset' && (
          <AssetDetailScreen
            assetId={view.assetId}
            onBack={() => setView({ name: 'search' })}
            onCheckout={assetId => setView({ name: 'checkout', seedAssetId: assetId })}
          />
        )}
        {view.name === 'checkout' && (
          <CheckoutScreen
            seedAssetId={view.seedAssetId}
            onBack={() => setView({ name: 'search' })}
            onOpenAsset={assetId => setView({ name: 'asset', assetId })}
          />
        )}
      </main>

      {/* Two of the five bottom-nav destinations in docs/12 3.1 — the three this slice
          does not build (Cal Due, Return, Sites) are omitted rather than stubbed. */}
      <nav className="fixed bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 border-t border-neutral-200 bg-white">
        <button
          onClick={() => setView({ name: 'search' })}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${view.name === 'search' ? 'text-neutral-900' : 'text-neutral-500'}`}
        >
          <SearchIcon className="h-5 w-5" />Search
        </button>
        <button
          onClick={() => setView({ name: 'checkout' })}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${view.name === 'checkout' ? 'text-neutral-900' : 'text-neutral-500'}`}
        >
          <ArrowLeftRight className="h-5 w-5" />Checkout
        </button>
      </nav>
    </div>
  );
}
