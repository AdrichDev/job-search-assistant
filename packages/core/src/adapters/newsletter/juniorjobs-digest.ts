import type {
  NewsletterParseContext,
  NewsletterParser,
  NewsletterPosting,
} from './newsletter-parser.js';

/**
 * The JuniorJobs weekly digest - the ONLY format a real saved sample exists for.
 *
 * The original sample was a real saved email with 222 numbered entries. It is
 * kept out of the repository; `tests/fixtures/juniorjobs-digest.synthetic.txt`
 * mirrors its structure. Every rule below was derived from reading that sample
 * rather than from imagining what a job newsletter looks like. A representative
 * line:
 *
 *   2. 🚨🧑‍💻 *Idealista necesita encontrar a un Android Product Engineer,
 *      100% en remoto: https://juniorjobs.short.gy/tok0002*
 *
 * which carries, in order: an entry number, optional emoji, an optional country
 * flag, an employer, a Spanish verb phrase, an article, the job title, an
 * optional remote marker, and a shortener link.
 *
 * PROVENANCE OF THIS CODE: the sentence-splitting heuristics (the verb, lead
 * and article expressions) were tuned against that sample by an earlier
 * standalone script, since removed. They are kept because they already work on
 * the real data. What was deliberately NOT carried over is that script's second
 * half - fetching each job page and stripping HTML with regexes to read years
 * of experience. Seniority is decided downstream by the existing
 * junior filter from title and description; this adapter never opens a job page.
 */

export const JUNIORJOBS_DIGEST_FORMAT = 'juniorjobs-digest';

/** A pair of regional-indicator symbols, i.e. a flag emoji. */
const FLAG_PATTERN = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}\uFFFD]/gu;

/** `1. <body>` - the digest's only structural commitment. */
const ENTRY_PATTERN = /^(\d+)\.\s*(.+)$/;

/** Bare URL, stopping before the closing `*` the digest wraps entries in. */
const URL_PATTERN = /https?:\/\/[^\s*]+/;

/**
 * The sender's own signature.
 *
 * Every link in the sample goes through `juniorjobs.short.gy`, so requiring the
 * sender's name is what stops this parser claiming a stranger's numbered list
 * and mangling a format nobody has verified. If JuniorJobs ever changes its
 * shortener, this parser stops claiming the file and the adapter reports it as
 * unrecognised - which is the correct, loud failure.
 */
const SENDER_PATTERN = /juniorjobs/i;

/**
 * The Spanish verb phrases the digest uses to join an employer to a vacancy.
 * "Factorial BUSCA a un GTM Engineer", "Revolut TIENE DISPONIBLE su Internship".
 */
const VERB_PATTERN =
  /\b(?:busca(?:ndo)?|necesita(?:\s+incorporar|\s+contratar)?|quiere(?:\s+incorporar|\s+contratar)?|tiene(?:\s+disponibles?|\s+abierto|\s+una?)?|est[áa]\s+(?:buscando|interesada\s+en)|ha\s+(?:abierto|publicado)|ofrece(?:n)?|vuelve\s+a\s+buscar|y\s+su)\b/i;

/** Editorial filler the digest opens entries with: "Y", "Sigue", "Empieza las novedades". */
const LEAD_PATTERN =
  /^(?:y\s+|adem[áa]s\s+|tambi[ée]n\s+|sigue(?:\s+con\s+las\s+que\s+(?:est[áa]n\s+todav[íi]a\s+activas|llevan\s+abiertas\s+desde\s+la\s+semana\s+pasada))?\s+|empieza\s+las\s+novedades\s+|los\s+de\s+|el\s+|la\s+)+/i;

/**
 * The article that introduces the title.
 *
 * `un[oa]?s?` rather than `unos?`: plain "un" must match, and so must
 * "una"/"unos"/"unas".
 */
const ARTICLE_PATTERN = /\b(?:a\s+)?(?:un[oa]?s?|otr[oa]|aun|sus?|personal\s+para\s+su)\s+(.+)$/i;

/**
 * "una oferta de", "un puesto para", "ofrerta para" (the sender's typo, present
 * in the real sample). Noise wrapping the actual job title.
 */
const TITLE_LEAD_PATTERN =
  /^(?:(?:un[oa]?s?\s+)?(?:oferta|ofrerta|puesto|vacante|plaza)s?\s+(?:de|para|en)\s+)+/i;

/**
 * The remote marker, captured as a FIELD rather than left inside the title.
 *
 * The digest writes "…, 100% en remoto" as a suffix on the sentence, which the
 * article split then drags into the title. It is real information, so it is
 * kept - just not as part of the job's name.
 */
const REMOTE_PATTERN = /100\s*%\s*(?:en\s+)?remot/i;
const REMOTE_TAIL_PATTERN = /\s*[,;·|—–-]?\s*(?:en\s+)?100\s*%\s*(?:en\s+)?remot[oa]s?\.?\s*$/i;

/**
 * Trailing filler the sentence split leaves on an employer name.
 *
 * Applied REPEATEDLY, because the sender chains it: entry 218 of the real
 * sample reads "Sigue CaixaBank Tech, ahora con un Software Engineer …", which
 * leaves "CaixaBank Tech, ahora con" - three separate pieces of glue. Stripping
 * once produced "CaixaBank Tech, ahora", a name that then failed to dedupe
 * against entry 217's "CaixaBank Tech" even though it is the same employer.
 *
 * Leading `[,\s]` rather than `\s`, so the comma goes with the clause it
 * introduced instead of being left behind for the punctuation trim.
 */
const COMPANY_TAIL_PATTERN =
  /[,\s]+(?:que|con|para|y|ahora|tambi[ée]n|adem[áa]s(?:\s+de)?)$/i;

/**
 * Country display names for the flags the real sample actually contains.
 *
 * English, deliberately, and for a mechanical reason rather than a stylistic
 * one: the board adapters emit English place names ("Madrid, Spain"), and
 * cross-source dedupe compares a normalized location token. Writing "España"
 * here would give the same vacancy two different location keys depending on
 * which source saw it, and the duplicate would never collapse.
 *
 * An unlisted code falls through to the code itself rather than to a guess.
 */
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  AT: 'Austria',
  BE: 'Belgium',
  CH: 'Switzerland',
  CZ: 'Czechia',
  DE: 'Germany',
  DK: 'Denmark',
  EE: 'Estonia',
  ES: 'Spain',
  FI: 'Finland',
  FR: 'France',
  GB: 'United Kingdom',
  GR: 'Greece',
  HR: 'Croatia',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SE: 'Sweden',
  SI: 'Slovenia',
  SK: 'Slovakia',
  UK: 'United Kingdom',
};

/**
 * The section this digest ships is titled "España y resto de Europa", and an
 * entry with no flag is a Spanish one. That is a fact about THIS sender's
 * layout, read off the sample - not a general assumption about newsletters.
 */
const DEFAULT_COUNTRY = 'ES';

/** Regional-indicator pair -> ISO 3166 alpha-2. */
function flagToCountryCode(flag: string): string {
  const letters = [...flag].map((character) => (character.codePointAt(0) ?? 0) - 0x1f1e6 + 65);
  return String.fromCharCode(...letters);
}

export function countryDisplayName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/**
 * The location string, built ONLY from what the email stated.
 *
 * A country and, when the digest said so, remoteness. Never a city: the digest
 * does not carry one, and inventing "Madrid" because the employer is Spanish is
 * the same class of mistake as inventing a URL.
 */
function locationFor(countryCode: string, remote: boolean): string {
  const country = countryDisplayName(countryCode);
  return remote ? `${country} (Remote)` : country;
}

function countNumberedEntries(text: string): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (ENTRY_PATTERN.test(line.trim())) {
      count += 1;
    }
  }
  return count;
}

interface SplitResult {
  readonly company: string;
  readonly title: string;
}

/**
 * Splits "Factorial busca a un GTM Engineer" into employer and vacancy.
 *
 * Three strategies, in descending confidence: the verb phrase, then the bare
 * article, then a colon. Each one is a shape observed in the real sample.
 */
function splitCompanyAndTitle(sentence: string): SplitResult {
  let company = sentence;
  let title = sentence;

  const verb = VERB_PATTERN.exec(sentence);
  if (verb !== null) {
    company = sentence.slice(0, verb.index).replace(/[,\s]+$/, '').trim();
    const rest = sentence.slice(verb.index + verb[0].length).trim();
    const article = ARTICLE_PATTERN.exec(rest);
    title = (article?.[1] ?? rest).replace(/^[:,\s]+/, '').trim();
  } else {
    const article = ARTICLE_PATTERN.exec(sentence);
    if (article !== null) {
      company = sentence.slice(0, article.index).replace(/\s+(?:con|para|y)$/i, '').trim();
      title = (article[1] ?? '').trim();
    } else if (sentence.includes(':')) {
      const colon = sentence.indexOf(':');
      company = sentence.slice(0, colon).trim();
      title = sentence.slice(colon + 1).trim();
    }
  }

  company = company.replace(/^(?:sigue|y|con)\s+/i, '').trim();
  for (;;) {
    const trimmed = company.replace(COMPANY_TAIL_PATTERN, '').replace(/[,;:.\s]+$/, '').trim();
    if (trimmed === company) {
      break;
    }
    company = trimmed;
  }

  title = title.replace(TITLE_LEAD_PATTERN, '').replace(REMOTE_TAIL_PATTERN, '').trim();

  return {
    company: company.length > 0 ? company : sentence,
    title: title.length > 0 ? title : sentence,
  };
}

function parseEntry(
  line: string,
  context: NewsletterParseContext,
): NewsletterPosting | null {
  const matched = ENTRY_PATTERN.exec(line.trim());
  if (matched === null) {
    return null;
  }

  const body = matched[2] ?? '';

  const flags = body.match(FLAG_PATTERN) ?? [];
  const foreign = flags.map(flagToCountryCode).filter((code) => code !== DEFAULT_COUNTRY);
  const countryCode = foreign[0] ?? DEFAULT_COUNTRY;

  /*
   * THE LINK, taken verbatim and from nowhere else.
   *
   * `null` when the entry has none - and the sample really does contain one
   * such entry, where the sender pasted the job title over the link. It is
   * dropped by the adapter, never repaired here.
   */
  const urlMatch = URL_PATTERN.exec(body);
  const url = urlMatch === null ? null : urlMatch[0].replace(/[.,*]+$/, '');

  const remote = REMOTE_PATTERN.test(body);

  const sentence = body
    .replace(FLAG_PATTERN, ' ')
    .replace(EMOJI_PATTERN, ' ')
    .replace(/\*/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:,\-–\s]+$/, '');

  if (sentence.length === 0) {
    context.skip(`entry ${matched[1] ?? '?'} in ${context.fileName} carried no readable text`);
    return null;
  }

  const { company, title } = splitCompanyAndTitle(sentence.replace(LEAD_PATTERN, ''));

  return {
    // Identity comes from the link the sender supplied. When there is no link
    // there is no id either - and the adapter drops the posting rather than
    // manufacture one out of the title.
    externalId: url ?? `${context.fileName}#${matched[1] ?? '?'}`,
    title,
    company,
    location: locationFor(countryCode, remote),
    // The sender's own sentence, kept whole. It is the only description this
    // format offers, and the junior filter reads it.
    description: sentence,
    url,
    postedAt: context.receivedAt,
    countryCode,
    remote,
  };
}

export const juniorJobsDigestParser: NewsletterParser = {
  format: JUNIORJOBS_DIGEST_FORMAT,

  senderDescription:
    'JuniorJobs weekly digest (juniorjobs.short.gy links, numbered Spanish entries)',

  detect(text: string): boolean {
    return SENDER_PATTERN.test(text) && countNumberedEntries(text) >= 1;
  },

  parse(text: string, context: NewsletterParseContext): readonly NewsletterPosting[] {
    const postings: NewsletterPosting[] = [];

    for (const line of text.split(/\r?\n/)) {
      const posting = parseEntry(line, context);
      if (posting !== null) {
        postings.push(posting);
      }
    }

    return postings;
  },
};
