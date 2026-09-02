// Phase 0 placeholder — owned by WS-C. See specs/REMAINING-WORK.md § WS-C.
//
// ORCHESTRATOR NOTE: specs/REMAINING-WORK.md's ownership row for WS-C ("api/mock/offline.ts,
// api/queue/**, tests/api/offline*") does not list a features/ path, but FR-039 needs a UI
// surface ("surface a rejected replay for human resolution... never discard it") and leaving
// that homeless would just move the collision to whichever screen WS-C picked ad hoc. This file
// and the /needs-attention route are a Phase-0 amendment granting WS-C exactly this one screen —
// recorded in docs/09-build-report.md, not a silent scope change.
import { ComingSoon } from "../../components/ComingSoon";

export function NeedsAttentionPage() {
  return <ComingSoon title="Needs attention" workstream="WS-C" spec="specs/REMAINING-WORK.md § WS-C" />;
}
