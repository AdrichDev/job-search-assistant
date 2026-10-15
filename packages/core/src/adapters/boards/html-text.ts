/**
 * Turns an API-provided description FIELD into scorable plain text.
 *
 * Scope, stated precisely because it is easy to misread this file as scraping:
 * every input here is a JSON string handed over by a documented job-board API
 * (`greenhouse.content`, `ashby.descriptionHtml`, `lever.description`). Nothing
 * fetches a web page and nothing walks a DOM. That is why this is a decoder of
 * a few hundred lines and not an HTML parser dependency - and adding one would
 * be both unnecessary and, on this machine, unbuildable (native install scripts
 * are blocked).
 *
 * Two escaping styles have to survive:
 *   - Ashby / Lever send real HTML:      `<p>hola</p>`
 *   - Greenhouse sends ESCAPED HTML:     `&lt;p&gt;hola&lt;/p&gt;`
 *
 * The Greenhouse case is why the entity decoder runs twice - but only when the
 * payload actually looks escaped, never unconditionally. Blind double-decoding
 * would corrupt a description that legitimately writes `&amp;lt;div&amp;gt;`
 * to show a reader an angle bracket.
 */

/**
 * The named entities that actually appear in job descriptions.
 *
 * A full HTML5 entity table is ~2000 names; carrying it here would be dead
 * weight. Anything outside this set falls through to the numeric decoder or is
 * left verbatim, which degrades to "slightly ugly text", never to a crash.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Decoded to a PLAIN space on purpose: a non-breaking space would survive the
  // whitespace collapse below and leave invisible junk in the scoring haystack.
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  laquo: '\u00ab',
  raquo: '\u00bb',
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
  bull: '\u2022',
  middot: '\u00b7',
  deg: '\u00b0',
  euro: '\u20ac',
  pound: '\u00a3',
  aacute: '\u00e1',
  eacute: '\u00e9',
  iacute: '\u00ed',
  oacute: '\u00f3',
  uacute: '\u00fa',
  ntilde: '\u00f1',
  uuml: '\u00fc',
  Aacute: '\u00c1',
  Eacute: '\u00c9',
  Iacute: '\u00cd',
  Oacute: '\u00d3',
  Uacute: '\u00da',
  Ntilde: '\u00d1',
};

const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});/gi;

/** Tags whose ENTIRE body is machine noise, not prose. */
const DROPPED_BLOCKS = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * Tags that mean "a new line starts here".
 *
 * Without this, `<p>Requisitos</p><p>React</p>` becomes "Requisitos React" and
 * the requirements extractor loses every line boundary it works from.
 */
const LINE_BREAKING_TAGS =
  /<\s*\/?\s*(p|div|br|li|tr|h[1-6]|ul|ol|table|section|article|header|footer|blockquote|pre|hr)\b[^>]*>/gi;

const ANY_TAG = /<[^>]*>/g;

/** True when the payload is HTML that has itself been entity-escaped. */
function looksEscaped(input: string): boolean {
  return /&lt;\/?[a-z]/i.test(input);
}

function decodeEntities(input: string): string {
  return input.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body.startsWith('#')) {
      const codePoint = body.startsWith('#x') || body.startsWith('#X')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);

      // Reject anything outside the Unicode range instead of throwing from
      // `fromCodePoint`; a malformed entity must not take the run down.
      if (!Number.isFinite(codePoint) || codePoint < 1 || codePoint > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(codePoint);
    }

    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Collapses whitespace to exactly what the scorer needs: single spaces inside a
 * line, single newlines between lines, no leading or trailing padding.
 */
function collapse(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    // A tag sitting between a word and its punctuation ("React</strong>.")
    // otherwise leaves an orphaned " ." behind.
    .replace(/ +([.,;:!?%)\]])/g, '$1')
    .trim();
}

/** Converts a board-provided description field into plain, scorable text. */
export function htmlToPlainText(input: string): string {
  if (input.length === 0) {
    return '';
  }

  // Only unwrap the outer escaping layer when one is actually present.
  const markup = looksEscaped(input) ? decodeEntities(input) : input;

  const withoutNoise = markup.replace(DROPPED_BLOCKS, ' ');
  const withBreaks = withoutNoise.replace(LINE_BREAKING_TAGS, '\n');
  // Remaining inline tags become a SPACE, never nothing: `<span>Java</span><span>Script</span>`
  // must not turn into "JavaScript".
  const stripped = withBreaks.replace(ANY_TAG, ' ');

  return collapse(decodeEntities(stripped));
}
