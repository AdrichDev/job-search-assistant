/**
 * Pure text utilities. No I/O, no node builtins.
 *
 * Everything downstream (keyword matching, fingerprinting, language sniffing)
 * assumes text has already passed through `normalizeText`.
 */

const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Lowercase, strip accents, drop punctuation, collapse whitespace.
 *
 * `+`, `#`, `.` and `-` survive on purpose: the stack keywords include
 * `c#`, `.net`, `next.js` and `3+`.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWordChar(char: string): boolean {
  return char >= 'a' && char <= 'z' ? true : char >= '0' && char <= '9';
}

/**
 * Token-aware match against an already-normalized haystack.
 *
 * Regex `\b` is unusable here because several keywords start or end in `#`, `+`
 * or `.`. The rules are:
 *
 * 1. A keyword only counts when both of its edges land on a token boundary, so
 *    `java` cannot fire inside `javascript` and `sql` cannot fire inside
 *    `mysql`. Two-letter keywords like `ui` are the reason this exists at all.
 * 2. A keyword whose own first character is punctuation carries its left
 *    boundary with it, and likewise on the right. Without this, `.net` never
 *    matched `ASP.NET` - which is how most postings actually spell it - and
 *    `c#` would have failed the moment an ad wrote `C#8`.
 */
export function containsTerm(normalizedHaystack: string, term: string): boolean {
  const needle = normalizeText(term);
  if (needle.length === 0) {
    return false;
  }

  // `.net` is its own left delimiter; `c#` and `3+` are their own right one.
  const selfDelimitedLeft = !isWordChar(needle[0] ?? ' ');
  const selfDelimitedRight = !isWordChar(needle[needle.length - 1] ?? ' ');

  let from = 0;
  for (;;) {
    const index = normalizedHaystack.indexOf(needle, from);
    if (index === -1) {
      return false;
    }

    const before = index === 0 ? ' ' : (normalizedHaystack[index - 1] ?? ' ');
    const afterIndex = index + needle.length;
    const after = afterIndex >= normalizedHaystack.length ? ' ' : (normalizedHaystack[afterIndex] ?? ' ');

    const leftIsBoundary = selfDelimitedLeft || !isWordChar(before);
    const rightIsBoundary = selfDelimitedRight || !isWordChar(after);
    if (leftIsBoundary && rightIsBoundary) {
      return true;
    }
    from = index + 1;
  }
}

/** Every term from `terms` present in the haystack, in config order. */
export function matchedTerms(normalizedHaystack: string, terms: readonly string[]): string[] {
  return terms.filter((term) => containsTerm(normalizedHaystack, term));
}

/** Clamp helper shared by all scoring dimensions. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

const LOCATION_NOISE = new Set([
  'spain',
  'espana',
  'comunidad',
  'de',
  'provincia',
  'area',
  'metropolitana',
  'region',
]);

/**
 * Coarse location token used inside the dedupe fingerprint.
 *
 * "Madrid, Comunidad de Madrid, Spain" and "Madrid" must produce the same key,
 * otherwise the same vacancy from two sources would never collapse.
 */
export function locationKey(location: string): string {
  const tokens = normalizeText(location)
    .split(' ')
    .filter((token) => token.length > 1 && !LOCATION_NOISE.has(token));

  if (tokens.length === 0) {
    return 'unknown';
  }
  return [...new Set(tokens)].sort().join('-');
}

/** Whole-day age of a posting, floored at 0 for future-dated postings. */
export function ageInDays(postedAt: Date, now: Date): number {
  const millisPerDay = 86_400_000;
  const delta = now.getTime() - postedAt.getTime();
  return Math.max(0, delta / millisPerDay);
}
