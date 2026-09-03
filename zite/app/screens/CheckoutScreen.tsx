// MIRROR of apps/englobe-ams-field/src/screens/CheckoutScreen.tsx — see zite/README.md.
import { useEffect, useState } from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import {
  checkoutRefData, CheckoutRefDataOutputType,
  resolveForCheckout, submitCheckout,
} from 'zitejs/api';
import { StatusPill } from '../components/StatusPill';
import { t } from '../strings';

type CartLine = { id: string; assetId: string; modelLabel: string; status: string };
type Ref = CheckoutRefDataOutputType;

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** S04 Checkout — docs/12 5.5. */
export function CheckoutScreen({
  seedAssetId, onBack, onOpenAsset,
}: { seedAssetId?: string; onBack: () => void; onOpenAsset: (assetId: string) => void }) {
  const [refs, setRefs] = useState<Ref | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [expectedReturn, setExpectedReturn] = useState(plusDays(14));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; count: number } | null>(null);

  useEffect(() => {
    checkoutRefData({}).then(r => {
      setRefs(r);
      if (r.people.length && !assignedTo) setAssignedTo(r.people[0]);
    });
  }, []);

  // Arriving from S03 pre-adds that asset (docs/12 5.5, "?asset=").
  useEffect(() => { if (seedAssetId) void add(seedAssetId); }, [seedAssetId]);

  async function add(raw: string) {
    const wanted = raw.trim();
    if (!wanted) return;
    if (cart.some(c => c.assetId.toLowerCase() === wanted.toLowerCase())) {
      setError(`${wanted} is already in the cart.`);
      return;
    }
    // REFUSAL LAYER 1 (client-facing, server-decided): the server says whether this
    // asset may be added. The browser never inspects status to make that call itself.
    const r = await resolveForCheckout({ assetId: wanted });
    if (!r.ok || !r.asset) { setError(r.reason ?? 'Could not add that asset.'); return; }
    setError('');
    setEntry('');
    setCart(c => [...c, {
      id: r.asset!.id, assetId: r.asset!.assetId,
      modelLabel: r.asset!.modelLabel, status: r.asset!.status,
    }]);
  }

  async function submit() {
    setError('');
    if (!projectId) { setError(t('checkout.projectRequired')); return; }
    setBusy(true);
    try {
      // REFUSAL LAYER 2 (authoritative): the server re-reads every asset and re-checks
      // the transition. Anything that moved since it was added stops the whole submit.
      const r = await submitCheckout({
        assetIds: cart.map(c => c.assetId),
        projectId, assignedTo,
        expectedReturn: expectedReturn || undefined,
        notes: notes || undefined,
        clientSubmissionId: crypto.randomUUID(),
      });
      if (!r.ok) { setError(r.reason ?? 'Refused.'); return; }
      setDone({ reference: r.reference ?? '', count: r.appliedAssetIds.length });
    } catch {
      setError('That didn’t work. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    // X01 confirmation (docs/12 C8).
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Checkout {done.reference} recorded — {done.count} asset{done.count === 1 ? '' : 's'} now checked out.
        </div>
        <p className="text-xs text-neutral-500">
          This environment has no transaction table, so the reference above is a display
          reference only — the asset rows hold the new state, but no append-only event was
          written. See docs/18 &sect; 7a.
        </p>
        <button
          onClick={() => { setDone(null); setCart([]); setNotes(''); }}
          className="self-start rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          {t('checkout.title')} — {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <button onClick={onBack} className="flex items-center self-start text-sm text-neutral-600">
        <ChevronLeft className="h-4 w-4" />{t('common.back')}
      </button>
      <h1 className="text-xl font-bold">{t('checkout.title')}</h1>

      {/* C11 add-by-ID row. Exact Asset ID only, not fuzzy. */}
      <div className="flex gap-2">
        <input
          value={entry}
          onChange={e => setEntry(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add(entry); }}
          placeholder={t('search.placeholder')}
          className="h-9 flex-1 rounded border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-500"
          aria-label={t('search.placeholder')}
        />
        <button
          type="button"
          onClick={() => void add(entry)}
          className="rounded bg-neutral-900 px-4 text-sm font-medium text-white"
        >
          Add
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="text-sm font-semibold">{t('cart.title')}</div>
      {cart.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('cart.empty')}</p>
      ) : (
        <div className="flex flex-col">
          {cart.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 border-b border-neutral-200 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onOpenAsset(c.assetId)}
                    className="font-mono text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    {c.assetId}
                  </button>
                  {i === 0 && (
                    <span className="rounded bg-[#0f6cbd] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {t('cart.primary')}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-neutral-600">{c.modelLabel}</div>
              </div>
              <StatusPill status={c.status} />
              <button
                aria-label={t('cart.remove')}
                title={t('cart.remove')}
                onClick={() => setCart(x => x.filter(y => y.id !== c.id))}
                className="p-1 text-neutral-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="text-sm font-medium">
        {t('checkout.project')} <span className="text-red-600">*</span>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="mt-1 h-9 w-full rounded border border-neutral-300 bg-white px-2 text-sm"
        >
          <option value="">—</option>
          {refs?.projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>

      <label className="text-sm font-medium">
        {t('checkout.assignedTo')}
        <select
          value={assignedTo}
          onChange={e => setAssignedTo(e.target.value)}
          className="mt-1 h-9 w-full rounded border border-neutral-300 bg-white px-2 text-sm"
        >
          {refs?.people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <label className="text-sm font-medium">
        {t('checkout.expectedReturn')}
        <input
          type="date"
          value={expectedReturn}
          onChange={e => setExpectedReturn(e.target.value)}
          className="mt-1 h-9 w-full rounded border border-neutral-300 px-2 text-sm"
        />
      </label>

      <label className="text-sm font-medium">
        {t('checkout.notes')}
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="mt-1 h-9 w-full rounded border border-neutral-300 px-2 text-sm"
        />
      </label>

      <button
        type="button"
        disabled={cart.length === 0 || busy}
        onClick={() => void submit()}
        className="h-10 w-full rounded bg-neutral-900 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? t('cart.submitting') : t('cart.submit')}
      </button>

      <p className="text-xs text-neutral-500">
        Expected return is captured on the form but not stored — this environment has no
        transaction table to hold it (docs/18 &sect; 7a).
      </p>
    </div>
  );
}
