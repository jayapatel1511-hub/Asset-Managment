/**
 * FR-031: every user-facing label comes from a string table, so a second language is a new JSON
 * file, not a rewrite of any screen. Deliberately small — no library, no locale negotiation
 * (Phase 1 ships English only, per Q12) — just a lookup plus {placeholder} substitution.
 */
import en from "./en.json";

type Strings = typeof en;
export type StringKey = keyof Strings;

const strings: Record<string, string> = en;

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const template = strings[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}
