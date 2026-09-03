// MIRROR of apps/englobe-ams-field/src/components/StatusPill.tsx — see zite/README.md.
import { STATUS_LABEL } from '../strings';

// docs/12 2.5 — the exact light-mode background/text pairs from StatusPill.tsx.
// Checked out and Deployed are the same grey, and Needs repair and Missing the same
// red, in the specified design. Kept identical here rather than "improved": the audit
// raises distinguishing them as G-04, an open design invitation, not a defect to fix
// unilaterally in a test environment.
const STYLE: Record<string, { bg: string; fg: string; border?: string }> = {
  Available: { bg: '#107c10', fg: '#ffffff' },
  CheckedOut: { bg: '#f0f0f0', fg: '#616161' },
  Deployed: { bg: '#f0f0f0', fg: '#616161' },
  InCalibration: { bg: '#fde300', fg: '#242424' },
  NeedsRepair: { bg: '#d13438', fg: '#ffffff' },
  Missing: { bg: '#d13438', fg: '#ffffff' },
  Retired: { bg: '#ffffff', fg: '#242424', border: '#d1d1d1' },
};

export function StatusPill({ status }: { status: string }) {
  const s = STYLE[status] ?? { bg: '#f0f0f0', fg: '#616161' };
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        border: s.border ? `1px solid ${s.border}` : '1px solid transparent',
      }}
      className="inline-flex h-5 shrink-0 items-center rounded px-2 text-xs font-semibold leading-none"
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
