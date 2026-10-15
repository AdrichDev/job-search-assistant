/**
 * THE PARSER SEAM.
 *
 * Why a seam at all, rather than one function that reads "the newsletter":
 * there is no such thing as "the newsletter". Every sender emits a different
 * shape - a numbered Markdown-ish digest, an HTML table, a plain list of
 * links - and the only honest way to support more than one is to make the
 * format a plugin rather than a branch.
 *
 * THE RULE THAT MATTERS MORE THAN THE DESIGN:
 *
 *   A parser may only be written against a REAL saved sample.
 *
 * This project already shipped thirteen fabricated URLs because code was
 * written against an imagined payload and everything downstream believed it.
 * A parser invented from a guess about how Michael Page or LinkedIn format
 * their alerts is the same defect with a different filename: it will "work",
 * produce plausible-looking rows, and be wrong in a way no type checker and no
 * unit test can see. So this file defines the seam and ships exactly ONE
 * implementation - the JuniorJobs digest - because that is the only format a
 * real sample exists for.
 *
 * HOW TO ADD A SENDER (the whole checklist):
 *
 *   1. Subscribe to the alert and WAIT for a real email to arrive.
 *   2. Save its plain-text body verbatim into the input folder. Do not tidy it
 *      up, do not retype it, do not paraphrase it - the quirks are the spec.
 *   3. Commit that sample as a test fixture.
 *   4. Write a `NewsletterParser` whose `detect` recognises that sender and
 *      NOTHING else, and whose `parse` is asserted against the real fixture.
 *   5. Register it in `NEWSLETTER_PARSERS`.
 *
 * Step 1 is not optional and cannot be skipped by reasoning about what the
 * email "probably" looks like.
 */

/**
 * One vacancy as the newsletter itself described it.
 *
 * Deliberately NOT a `JobDraft`: a parser's job is to read an email, not to
 * know about the domain. Minting the domain object - and enforcing the URL
 * invariant - stays in the adapter, one layer up.
 */
export interface NewsletterPosting {
  /**
   * Stable identity for this posting.
   *
   * MUST be derived from something the payload supplied - in practice, the
   * link. It must NEVER be derived from the title: an id built from a title is
   * the first step of the exact defect this project shipped, because it makes a
   * fabricated address look addressable.
   */
  readonly externalId: string;
  readonly title: string;
  readonly company: string;
  /** Free text as the newsletter stated it. Never guessed from the company. */
  readonly location: string;
  readonly description: string;
  /**
   * The posting's own link, exactly as the email carried it, or `null`.
   *
   * `null` means "this entry had no link", and the adapter will DROP the
   * posting and log it. It must never be a placeholder, a search URL, or an
   * address assembled out of the title.
   */
  readonly url: string | null;
  readonly postedAt: Date;
  /** ISO-3166 alpha-2 when the email stated a country, otherwise the default. */
  readonly countryCode?: string;
  readonly remote?: boolean;
}

export interface NewsletterParseContext {
  /** The saved file this text came from. Used only in messages. */
  readonly fileName: string;
  /**
   * When the digest was received.
   *
   * Newsletters rarely date individual postings, so this is the honest
   * approximation of `postedAt`: the day the email arrived. The adapter derives
   * it from the file name, falling back to the file's modification time.
   */
  readonly receivedAt: Date;
  /** Report one unusable entry. Never throws: one bad line is not a bad file. */
  readonly skip: (reason: string) => void;
}

export interface NewsletterParser {
  /** Registry key, e.g. `juniorjobs-digest`. */
  readonly format: string;
  /** Shown in `--help` and the README so a user knows what is supported today. */
  readonly senderDescription: string;
  /**
   * Does this text come from MY sender?
   *
   * Must be specific enough to refuse a stranger's email. A `detect` that
   * returns true for "any numbered list" is worse than no parser at all,
   * because it will silently mangle a format nobody has ever verified.
   */
  detect(text: string): boolean;
  /** Throws only when the whole file is unusable; calls `skip` for bad rows. */
  parse(text: string, context: NewsletterParseContext): readonly NewsletterPosting[];
}

/**
 * Picks the parser that claims the text, or `null`.
 *
 * `null` is a first-class answer, not a failure to handle. An unrecognised
 * saved email is reported as a degraded target and skipped, which is exactly
 * what should happen the first time the user drops a Michael Page alert into
 * the folder: a clear "nobody here can read this yet", never a guess.
 */
export function selectNewsletterParser(
  text: string,
  parsers: readonly NewsletterParser[],
): NewsletterParser | null {
  for (const parser of parsers) {
    try {
      if (parser.detect(text)) {
        return parser;
      }
    } catch {
      // A detector that throws has disqualified itself, not the file.
      continue;
    }
  }
  return null;
}
