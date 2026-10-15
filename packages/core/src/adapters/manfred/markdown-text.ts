import { htmlToPlainText } from '../boards/html-text.js';

/**
 * Turns Manfred's Markdown description fields into scorable plain text.
 *
 * Same scope note as `boards/html-text.ts`: the input is a JSON string handed
 * over by a documented API, not a fetched web page. Nothing here walks a DOM
 * and nothing fetches anything.
 *
 * Why a separate decoder at all: Manfred's prose is Markdown, and the board
 * decoder only knows tags and entities. Left alone, `**Diseñarás e
 * implementarás APIs**` reaches the scorer with its asterisks attached, which
 * turns a keyword the stack dimension is looking for into a token it has never
 * seen. Some offers also mix in real HTML and `&#x20;` escapes, so the two
 * decoders run in sequence rather than as alternatives.
 */

/** `# Heading`, `> quote`, `- item`, `* item`, `1. item` - the marker only. */
const BLOCK_MARKERS = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm;

/** `**bold**`, `__bold__`, `*italic*`, `_italic_`, `~~struck~~`, `` `code` ``. */
const EMPHASIS = /(\*\*|__|~~|[*_`])/g;

/** `[Ver oferta](https://…)` keeps the words, drops the address. */
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

/** `![alt](src)` is an image; neither half is prose. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

/** `---` / `***` horizontal rules. */
const RULE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;

export function markdownToPlainText(input: string): string {
  if (input.length === 0) {
    return '';
  }

  const withoutMarkup = input
    .replace(MARKDOWN_IMAGE, ' ')
    // The link TEXT is kept: "envíanos tu CV" is signal, the href is not.
    .replace(MARKDOWN_LINK, '$1')
    .replace(RULE, '\n')
    .replace(BLOCK_MARKERS, '')
    .replace(EMPHASIS, '');

  // Reused rather than reimplemented: entity decoding, tag stripping and the
  // whitespace collapse are identical problems and already solved once.
  return htmlToPlainText(withoutMarkup);
}

/**
 * Joins the several prose fields Manfred splits an offer across.
 *
 * A section may be a string, an array of strings, or absent - all three occur
 * in the same payload. Absent sections contribute nothing rather than a blank
 * line, so an offer that filled in two fields does not read as though it filled
 * in eight.
 */
export function joinManfredSections(
  sections: readonly (string | readonly string[] | null | undefined)[],
): string {
  const parts: string[] = [];

  for (const section of sections) {
    if (section === null || section === undefined) {
      continue;
    }
    const text = Array.isArray(section) ? section.join('\n') : String(section);
    const plain = markdownToPlainText(text);
    if (plain.length > 0) {
      parts.push(plain);
    }
  }

  return parts.join('\n');
}
