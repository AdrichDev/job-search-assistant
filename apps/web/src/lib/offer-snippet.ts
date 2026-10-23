/**
 * The short description a card shows before anyone opens the dialog.
 *
 * One or two lines, cut on a word boundary, marked with an ellipsis. The FULL
 * description is the dialog's job; the card snippet exists so the reader can
 * skim, never to hold the whole text.
 */
export function offerSnippet(description: string, maxChars = 160): string {
  if (description.length <= maxChars) {
    return description;
  }
  // `slice` alone could cut a word (or a code point) in half; the last space is
  // where the sentence can end honestly.
  const cut = description.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
