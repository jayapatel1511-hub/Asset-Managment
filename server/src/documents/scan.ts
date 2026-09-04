/**
 * Malware scan state, its legal transitions, and a pluggable scanner.
 *
 * WHAT IS IN SCOPE AND WHAT IS NOT. The scanner itself is an enterprise dependency — the
 * "certificate malware-scanning route" is an open G0.2 item in `specs/REMAINING-WORK.md`, owned
 * by Englobe IT, and `contracts/document-blob.md` marks the whole scan-state enum
 * `ASSUMPTION: malware-scan route open (010 Open Decision #10)`. So this file models the STATE
 * MACHINE, which is ours to get right, and leaves the scanner behind a one-method interface,
 * which is theirs to supply. Defender for Storage, an ICAP appliance and a queue-triggered
 * function are all the same shape from here.
 *
 * WHY A STATE MACHINE AND NOT A BOOLEAN. Five states exist because five distinct things can be
 * true, and collapsing them loses the one that matters:
 *
 *   Pending      bytes are stored, nothing has looked at them yet. NOT downloadable.
 *   Clean        a scanner looked and passed it. Downloadable.
 *   Quarantined  a scanner looked and REFUSED it. Never downloadable, never deleted — the
 *                object stays as evidence and the metadata row says why (rule 20: no
 *                general-purpose delete path).
 *   Failed       the scan itself broke. This is NOT "clean" and NOT "infected"; it is "we do not
 *                know", and treating it as either is the bug this state exists to prevent.
 *                Re-scannable.
 *   Skipped      no scanner is configured and policy permits proceeding without one. Honest
 *                about the gap in a way that "Clean" would not be — a `Skipped` document has
 *                never been examined and the register says so.
 *
 * THE DOWNLOAD RULE. `isDownloadable` permits `Clean` always, and `Skipped` only while
 * `AMS_DOCUMENT_SCAN_REQUIRED` is unset. That is the local default (there is no scanner to
 * configure), and setting the variable in any shared environment turns `Skipped` into a refusal
 * without a code change. `Pending`, `Quarantined` and `Failed` are never downloadable, which is
 * what `document.error.quarantined` reports.
 */
import type { DocumentScanState } from "./types";

export interface ScanInput {
  documentId: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  /** The bytes, for an in-process scanner. A queue-triggered scanner ignores them and works
   * from the stored object instead. */
  bytes: Buffer;
}

export interface ScanOutcome {
  state: DocumentScanState;
  detail: string | null;
}

export interface MalwareScanner {
  readonly name: string;
  scan(input: ScanInput): Promise<ScanOutcome>;
}

/**
 * The default: records that nothing scanned the file. Not `Clean` — see this file's header.
 */
export class DeferredScanner implements MalwareScanner {
  readonly name = "deferred";

  async scan(_input: ScanInput): Promise<ScanOutcome> {
    return {
      state: "Skipped",
      detail: "No malware scanner is configured (010 Open Decision #10 / G0.2 remains open).",
    };
  }
}

/** Leaves the document `Pending` for an out-of-band scanner to settle later. The shape a
 * queue-triggered Defender integration takes. */
export class ExternalQueueScanner implements MalwareScanner {
  readonly name = "external-queue";

  async scan(_input: ScanInput): Promise<ScanOutcome> {
    return { state: "Pending", detail: "Queued for out-of-band scanning." };
  }
}

/**
 * A scanner that quarantines anything matching a marker. Used to exercise the quarantine path
 * end to end without an enterprise dependency, and kept beside the real implementations so the
 * refusal path is reviewed alongside the acceptance path.
 */
export class MarkerScanner implements MalwareScanner {
  readonly name = "marker";

  constructor(private readonly marker = "EICAR") {}

  async scan(input: ScanInput): Promise<ScanOutcome> {
    const head = input.bytes.subarray(0, 4096).toString("latin1");
    return head.includes(this.marker)
      ? { state: "Quarantined", detail: `Matched test marker "${this.marker}".` }
      : { state: "Clean", detail: `Scanned by ${this.name}; no marker found.` };
  }
}

// ---------------------------------------------------------------- transitions

const LEGAL_TRANSITIONS: Record<DocumentScanState, DocumentScanState[]> = {
  // Nothing has looked at it: any verdict is reachable.
  Pending: ["Clean", "Quarantined", "Failed", "Skipped"],
  // A scanner passed it. Re-scanning may still condemn it (a signature update), which is why
  // Clean -> Quarantined is legal; Clean -> Skipped is not, because you cannot un-know a scan.
  Clean: ["Quarantined", "Failed"],
  // Terminal. Releasing a quarantined document is an approved, audited, separate act — not a
  // state transition an upload path may perform (CLAUDE.md rule 5's "exceptional repair is
  // separate, audited and approved").
  Quarantined: [],
  // "We do not know" — re-scanning is the whole point.
  Failed: ["Pending", "Clean", "Quarantined", "Skipped"],
  // Never examined; a later scan may settle it either way.
  Skipped: ["Pending", "Clean", "Quarantined", "Failed"],
};

export function canTransitionScanState(from: DocumentScanState, to: DocumentScanState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function scanRequired(): boolean {
  return process.env.AMS_DOCUMENT_SCAN_REQUIRED === "1" || process.env.AMS_DOCUMENT_SCAN_REQUIRED === "true";
}

/** The gate every download passes through. See this file's header § THE DOWNLOAD RULE. */
export function isDownloadable(state: DocumentScanState): boolean {
  if (state === "Clean") return true;
  if (state === "Skipped") return !scanRequired();
  return false;
}

export function scanRefusalReason(state: DocumentScanState): string {
  switch (state) {
    case "Quarantined":
      return "This document was quarantined by the malware scanner and cannot be released.";
    case "Pending":
      return "This document has not been scanned yet.";
    case "Failed":
      return "The malware scan for this document did not complete, so it cannot be released.";
    case "Skipped":
      return "This document was never scanned and policy requires a completed scan.";
    default:
      return "This document is not available for download.";
  }
}
