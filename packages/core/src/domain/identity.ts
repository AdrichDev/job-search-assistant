import { normalizeText } from './text.js';

/**
 * Cross-source identity: recognizing ONE vacancy behind two spellings.
 *
 * THE GOVERNING ASYMMETRY - everything in this file follows from it:
 *
 *   A false merge is worse than a missed duplicate.
 *
 * A missed duplicate costs the candidate ten seconds of scrolling past the same
 * job twice. A false merge DELETES a real, applyable vacancy from the queue and
 * leaves nothing behind saying it ever existed. The two errors are not
 * symmetric, so the rules here are not balanced: they are biased hard towards
 * refusing to merge.
 *
 * Concretely, that rules out the obvious approach. No edit distance, no
 * token-overlap ratio, no cosine similarity, no "80% of the words match"
 * threshold. Every one of those merges `Backend Engineer` into
 * `Backend Engineering Manager` at some tuning, and no threshold exists that
 * separates decoration from seniority - because that difference is semantic,
 * not lexical.
 *
 * What is left is deliberately dumber and safer: strip the decoration boards
 * are KNOWN to add, then demand an EXACT match on what remains. Anything this
 * misses stays in the queue as a duplicate, which is the cheap failure.
 */

/**
 * Legal-form suffixes the same employer is spelled with on different boards.
 *
 * Adzuna reports `CABIFY ESPAÑA S.L.`; Greenhouse reports `Cabify`. Without
 * this, the company anchor never lines up and the cross-source key never fires.
 */
const LEGAL_SUFFIXES = new Set([
  's.l.',
  's.l',
  'sl',
  'slu',
  's.l.u.',
  's.a.',
  's.a',
  'sa',
  'sau',
  's.a.u.',
  'sociedad',
  'limitada',
  'inc',
  'inc.',
  'llc',
  'l.l.c.',
  'ltd',
  'ltd.',
  'limited',
  'gmbh',
  'ag',
  'bv',
  'b.v.',
  'nv',
  'n.v.',
  'plc',
  'srl',
  's.r.l.',
  'spa',
  's.p.a.',
  'oy',
  'ab',
  'as',
  'aps',
  'corp',
  'corp.',
  'co',
  'co.',
  'group',
]);

/**
 * Decoration that carries no information about WHICH vacancy this is.
 *
 * Everything here is a place, a work arrangement, or a gender marker. Note what
 * is absent and must stay absent: seniority words (`senior`, `junior`, `lead`),
 * level markers (`ii`, `iii`), and any technology name. Those distinguish two
 * genuinely different openings at the same company.
 */
const TITLE_NOISE = new Set([
  'madrid',
  'barcelona',
  'valencia',
  'sevilla',
  'malaga',
  'bilbao',
  'zaragoza',
  'spain',
  'espana',
  'es',
  'remote',
  'remoto',
  'hybrid',
  'hibrido',
  'onsite',
  'on-site',
  'presencial',
  'teletrabajo',
  'emea',
  'europe',
  'europa',
  'm',
  'f',
  'w',
  'd',
  'h',
  'x',
  'a',
  'o',
  'mfd',
  'mwd',
]);

/** `(m/f/d)`, `(M/W/D)`, `(h/f)`, `(m/f)` and friends, with or without parentheses. */
const GENDER_MARKER = /\(?\s*\b[mfwdhaox](?:\s*[/|·-]\s*[mfwdhaox]){1,3}\b\s*\)?/gi;

/** `Desarrollador/a`, `Programador/es`, `Técnico/a`. */
const GENDERED_SUFFIX = /([a-z]{3,})\/(?:a|as|o|os|es|e)\b/gi;

function foldCase(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * A parenthetical is decoration only when EVERY word inside it is known noise.
 *
 * `(m/f/d)` and `(Madrid)` go. `(React)` and `(German Market)` stay, because
 * they are the only thing distinguishing two otherwise identical titles.
 */
function isNoiseFragment(fragment: string): boolean {
  const words = normalizeText(fragment)
    .split(' ')
    .filter((word) => word.length > 0);

  return words.length > 0 && words.every((word) => TITLE_NOISE.has(word));
}

/**
 * Employer identity, tolerant of how boards spell a legal name.
 *
 * Returns `''` for a blank company - and callers MUST treat that as "no anchor,
 * do not merge". Without a company, a title alone would collapse every
 * anonymous "Junior Developer" in the queue into one entry.
 */
export function canonicalCompany(company: string): string {
  const tokens = normalizeText(company)
    .split(' ')
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return '';
  }

  // Trailing only: `Inc` at the end is a legal form, `Inc` at the front is part
  // of the name. Never strip everything - a company literally named "SL" must
  // keep an identity of its own rather than becoming the empty anchor.
  const trimmed = [...tokens];
  while (trimmed.length > 1 && LEGAL_SUFFIXES.has(trimmed[trimmed.length - 1] ?? '')) {
    trimmed.pop();
  }

  return trimmed.join(' ');
}

/**
 * Job-title identity with board decoration removed and NOTHING else.
 *
 * Removed: gender markers, gendered word endings, and trailing or parenthetical
 * fragments made entirely of place/remote noise.
 * Kept: every other word, including seniority, level and stack - see the
 * asymmetry note at the top of this file.
 *
 * Never returns `''` for a non-blank title: if stripping would empty it, the
 * plain normalized title is used instead, because an empty key would merge
 * unrelated postings.
 */
export function canonicalTitle(title: string): string {
  const folded = foldCase(title);

  let working = folded.replace(GENDERED_SUFFIX, '$1').replace(GENDER_MARKER, ' ');

  // Drop bracketed decoration, keeping bracketed information.
  working = working.replace(/[([{]([^)\]}]*)[)\]}]/g, (match, inner: string) =>
    isNoiseFragment(inner) ? ' ' : match,
  );

  // Drop trailing " - Madrid", " | Remote", " , Spain" tails, repeatedly:
  // "Backend Developer - Madrid - Remote" has two of them.
  for (;;) {
    const trimmed = working.replace(/\s*[-–—|·,:]\s*([^-–—|·,:]+)\s*$/, (match, tail: string) =>
      isNoiseFragment(tail) ? '' : match,
    );
    if (trimmed === working) {
      break;
    }
    working = trimmed;
  }

  const canonical = normalizeText(working);
  return canonical.length > 0 ? canonical : normalizeText(title);
}

/**
 * The cross-source dedupe key, or `null` when there is no safe anchor.
 *
 * `null` is returned - rather than a degraded key - whenever the company is
 * unknown. Refusing to answer is the correct behaviour: this key exists to
 * merge, and merging without an employer anchor is precisely the false merge
 * the whole module is built to avoid.
 */
export function crossSourceKey(job: {
  readonly title: string;
  readonly company: string;
  readonly locationKey: string;
}): string | null {
  const company = canonicalCompany(job.company);
  if (company.length === 0) {
    return null;
  }

  const title = canonicalTitle(job.title);
  if (title.length === 0) {
    return null;
  }

  return `xs:${company}::${title}::${job.locationKey}`;
}
