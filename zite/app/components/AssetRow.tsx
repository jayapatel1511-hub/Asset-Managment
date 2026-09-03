// MIRROR of apps/englobe-ams-field/src/components/AssetRow.tsx — see zite/README.md.
import { CalendarClock, TriangleAlert } from 'lucide-react';
import { StatusPill } from './StatusPill';
import { t } from '../strings';

// docs/12 C2 — the universal list item. Four lines, ~74px, 10/12 padding, 1px bottom
// border, no card. Line 4 appears only when calibration is overdue.
export type AssetRowData = {
  assetId: string;
  modelLabel: string;
  currentLocation: string;
  homeOffice: string;
  custodian: string;
  status: string;
  overdue: boolean;
  daysOverdue?: number;
  temporaryTag: boolean;
};

export function AssetRow({ a, onOpen }: { a: AssetRowData; onOpen: () => void }) {
  // "current location (fallback home office, '—')"
  const where = a.currentLocation || a.homeOffice || '—';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 border-b border-neutral-200 px-3 py-2.5 text-left active:bg-neutral-100"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-bold">{a.assetId}</span>
        {a.temporaryTag && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className="ml-auto"><StatusPill status={a.status} /></span>
      </div>
      <div className="text-xs text-neutral-700">{a.modelLabel || '—'}</div>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span className="truncate">{where}</span>
        <span className="truncate text-right">{a.custodian || '—'}</span>
      </div>
      {a.overdue && (
        <div className="flex items-center gap-1 text-xs font-medium text-red-600">
          <CalendarClock className="h-3.5 w-3.5" />
          {a.daysOverdue !== undefined ? `${a.daysOverdue} days overdue` : t('asset.calOverdue')}
        </div>
      )}
    </button>
  );
}
