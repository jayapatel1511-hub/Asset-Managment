// MIRROR of apps/englobe-ams-field/src/screens/AssetDetailScreen.tsx — see zite/README.md.
import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { getAsset, GetAssetOutputType } from 'zitejs/api';
import { StatusPill } from '../components/StatusPill';
import { t } from '../strings';

type Loaded = GetAssetOutputType;

function Field({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`truncate text-sm font-semibold ${danger ? 'text-red-600' : ''}`}>{value || '—'}</div>
    </div>
  );
}

/** S03 Asset detail — docs/12 5.3. */
export function AssetDetailScreen({
  assetId, onBack, onCheckout,
}: { assetId: string; onBack: () => void; onCheckout: (assetId: string) => void }) {
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    setData(null);
    getAsset({ assetId }).then(setData).catch(() => setData({ found: false, canCheckout: false, children: [] }));
  }, [assetId]);

  if (!data) return <p className="p-3 text-sm text-neutral-500">{t('common.loading')}</p>;

  if (!data.found || !data.asset) {
    return (
      <div className="p-3">
        <button onClick={onBack} className="mb-3 flex items-center text-sm text-neutral-600">
          <ChevronLeft className="h-4 w-4" />{t('common.back')}
        </button>
        <p className="text-sm">{t('asset.notFound', { query: assetId })}</p>
      </div>
    );
  }

  const a = data.asset;

  return (
    <div className="flex flex-col gap-3 p-3">
      <button onClick={onBack} className="flex items-center self-start text-sm text-neutral-600">
        <ChevronLeft className="h-4 w-4" />{t('common.back')}
      </button>

      {/* Header: Asset ID mono, status pill, lifecycle badge, temporary-tag warning */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-xl font-bold">{a.assetId}</h1>
        <StatusPill status={a.status} />
        {a.lifecycle === 'Retired' && (
          <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs">{t('asset.retired')}</span>
        )}
        {a.temporaryTag && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t('asset.temporaryTag')}</span>
        )}
      </div>
      <div className="-mt-2 text-sm text-neutral-700">
        {a.modelLabel} · {a.equipmentType}
      </div>

      {/* Now card — docs/12 C5, two columns */}
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-neutral-50 p-3">
        <Field label={t('asset.location')} value={a.currentLocation} />
        <Field label={t('asset.homeOffice')} value={a.homeOffice} />
        <Field
          label={t('asset.custodian')}
          value={a.custodian || (a.status === 'CheckedOut' ? t('asset.noCustodian') : '')}
        />
        <Field label={t('asset.project')} value={a.currentProject} />
        <Field label={t('asset.parent')} value={a.parentAsset} />
        <Field label={t('asset.nextCalDue')} value={a.nextCalDue || t('common.unknown')} danger={a.overdue} />
      </div>

      {a.overdue && (
        <span className="self-start rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
          {t('asset.overdue')}
        </span>
      )}

      {data.children.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-neutral-600">Attached items</div>
          <div className="mt-1 flex flex-col gap-1">
            {data.children.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="font-mono">{c.assetId}</span>
                <StatusPill status={c.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions. docs/12 5.3 renders only the actions valid from the current status;
          the Field slice implements Checkout only. When Checkout is not valid the
          button is shown DISABLED with the specified reason, which is what
          docs/02-app.md asked for and G-12 records the build as having missed. */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!data.canCheckout}
          title={data.canCheckout ? t('asset.actions.checkout') : t('asset.actions.notAllowed', { status: a.status })}
          onClick={() => onCheckout(a.assetId)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40 active:bg-neutral-100"
        >
          {t('asset.actions.checkout')}
        </button>
        {!data.canCheckout && (
          <span className="self-center text-xs text-neutral-500">
            {t('asset.actions.notAllowed', { status: a.status })}
          </span>
        )}
      </div>

      {a.notes && (
        <div>
          <div className="text-xs font-semibold text-neutral-600">{t('asset.notes')}</div>
          <p className="whitespace-pre-wrap text-sm">{a.notes}</p>
        </div>
      )}

      <div className="mt-2 border-t border-neutral-200 pt-2 text-[11px] text-neutral-400">
        {a.dataOrigin}
      </div>
    </div>
  );
}
