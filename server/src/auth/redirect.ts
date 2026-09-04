/**
 * Open-redirect protection for the post-sign-in deep link.
 *
 * The deep link is a real requirement — WS-W3 lists "deep-link after sign-in", because a
 * technician who taps a link to an asset and is bounced through Entra must land on that asset and
 * not on the home screen. It is also the classic phishing primitive: `/api/auth/sign-in?returnTo=
 * https://englobe-ams.example.evil/` produces a link that starts on the real domain, shows the
 * real Microsoft sign-in, and finishes on an attacker's page that asks for the password again.
 *
 * So the rule is allow-list, not deny-list: a return target is a **same-origin absolute path**
 * and nothing else. No scheme, no host, no protocol-relative form, no backslash (which several
 * browsers normalise to a forward slash), and nothing that survives a decode into one of those.
 * Anything else is refused outright rather than silently rewritten — a caller who sent a bad
 * `returnTo` has a bug or an intent, and both deserve an answer.
 */

const MAX_LENGTH = 512;

/** Characters that must never appear in a Location header. CR/LF is response splitting. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function looksAbsolute(path: string): boolean {
  // "//evil.example" and "/\evil.example" are both protocol-relative in a browser.
  if (path.startsWith("//") || path.startsWith("/\\")) return true;
  // A scheme anywhere before the first slash-that-matters, e.g. "/redirect?to=https://…" is fine,
  // but "javascript:…" or "https://…" as the whole value is not — those do not start with "/"
  // and are already rejected. This catches "/%2F%2Fevil.example" style smuggling.
  return false;
}

/**
 * Returns the safe path, or `null` when the input is not one. `undefined`/absent input yields the
 * fallback, which is how "no deep link requested" is expressed.
 */
export function safeReturnTo(raw: unknown, fallback = "/"): string | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_LENGTH) return null;
  if (CONTROL_CHARACTERS.test(raw)) return null;
  if (!raw.startsWith("/")) return null;
  if (looksAbsolute(raw)) return null;

  // Decode once and re-check: a browser normalises percent-encoding before it navigates, so
  // "/%2f%2fevil.example" must be judged as "//evil.example".
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed encoding — not a path we are willing to reflect
  }
  if (CONTROL_CHARACTERS.test(decoded)) return null;
  if (!decoded.startsWith("/") || looksAbsolute(decoded)) return null;

  // Last defence: parse it against a throwaway origin and confirm it stayed there. `new URL`
  // applies the browser's own normalisation, so anything that would escape shows up as a
  // different origin here.
  try {
    const probe = new URL(raw, "https://ams.invalid");
    if (probe.origin !== "https://ams.invalid") return null;
    return `${probe.pathname}${probe.search}${probe.hash}`;
  } catch {
    return null;
  }
}
