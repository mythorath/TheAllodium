/** Phase 3B: hotline-intent phrases only. Catalog topics (trauma, bpd,
 * suicidality as a search term) must not trip this — they go through
 * NL→facets. Match still runs keyword search; this only skips the GPU. */

const INTENT_PATTERNS: RegExp[] = [
  /\bsuicide\b/i,
  /\bsuicidal\b/i,
  /\bkill(?:ing)? myself\b/i,
  /\bself[-\s]?harm\b/i,
  /\bwant to die\b/i,
  /\bend my life\b/i,
  /\bbetter off dead\b/i,
  /\btake my own life\b/i,
];

export function isCrisisIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}
