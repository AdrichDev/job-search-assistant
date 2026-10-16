import { DEFAULT_BOARD_CONCURRENCY, DEFAULT_BOARD_TIMEOUT_MS } from '../adapters/boards/board-http.js';
import { NEWSLETTER_PARSERS } from '../adapters/newsletter/newsletter-job-source.js';
import {
  DEFAULT_APPLICATION_LOG_PATH,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_QUEUE_PATH,
} from '../config/paths.js';
import { DEFAULT_LIVENESS_CACHE_PATH } from '../config/liveness.js';
import { DEFAULT_NEWSLETTER_DIR, DEFAULT_NEWSLETTER_LINK_CACHE } from '../config/newsletter.js';
import { parseSourceSelection, type SelectableSourceId } from './source-selection.js';

/**
 * COMMAND-LINE OPTIONS, as a pure function of `argv`.
 *
 * This used to live inside `main.ts`, which calls `main(process.argv)` at
 * import time. That one detail made every default in this file untestable -
 * importing the module to check a default would have run the whole pipeline -
 * and an untested default is how link resolution stayed OFF while the
 * documented command shipped 212 shortener URLs to the apply buttons.
 *
 * So parsing is a module of its own with no side effects, `main.ts` is
 * composition only, and `tests/cli/options.test.ts` asserts the defaults
 * directly.
 */

export interface CliOptions {
  readonly sources: readonly SelectableSourceId[];
  /**
   * Absent by default. Every offer that passed the two filters is shown, which
   * is what the candidate asked for; `--limit` exists only to keep an
   * exploratory terminal run readable.
   */
  readonly limit: number | undefined;
  readonly outputPath: string;
  readonly fixturePath: string;
  readonly applicationLogPath: string;
  readonly explain: number;
  /** Simultaneous company-board requests. Small: these endpoints are free. */
  readonly concurrency: number;
  readonly timeoutMs: number;
  /** Folder of saved job-alert emails read by `--source=newsletter`. */
  readonly newsletterDir: string;
  /**
   * Follow each newsletter tracking link to the employer's real posting.
   *
   * ON by default, and that default is a fix rather than a preference.
   *
   * The newsletter links to itself: every entry in the real digest points at
   * `juniorjobs.short.gy/<token>`, which 301s to the employer's posting. With
   * resolution off, the queue's apply buttons are somebody else's tracking
   * redirects - one of which was already observed answering 404 - and the run
   * reported "212 unique, 0 resolved" while looking perfectly healthy.
   *
   * The reasons it was originally opt-in have not disappeared; they were just
   * outweighed. It is still the only traffic this source generates, so the
   * safeguards all stay (one HEAD per unique link, GET retry, bounded
   * concurrency, hard timeout, disk cache, failure keeps the original) and
   * `--no-resolve-links` turns it off for an offline or quota-conscious run.
   * What changed is which way the default leans: towards the address the user
   * can actually apply at.
   */
  readonly resolveLinks: boolean;
  readonly linkCachePath: string;
  /**
   * Ask every surfaced posting's address whether it is still serving something,
   * and REMOVE the ones that answer 404 or 410.
   *
   * ON by default. The reason it can be on by default without endangering
   * anything is the narrowness of the removal rule, not a judgement call about
   * risk appetite: `domain/link-liveness.ts` deletes on exactly two status
   * codes and keeps everything else - 403, 401, 429, every 3xx, every 5xx,
   * timeouts, connection resets, DNS failures and anything unchecked. A run
   * with no network removes nothing at all.
   *
   * This is a different question from `resolveLinks`, and the two are
   * deliberately independent flags. Resolution asks "which address do we show?"
   * and applies only to the newsletter. Liveness asks "is that address still
   * serving?" and applies to every source, because a Greenhouse posting closes
   * as often as a shortened one and does it more quietly.
   *
   * `--no-check-links` turns it off for an offline run or to spend no requests.
   * With it off, nothing is ever removed and every posting is marked
   * "unchecked" rather than "reachable".
   */
  readonly checkLinks: boolean;
  readonly livenessCachePath: string;
}

export const USAGE = `
Job queue - tech offers open to juniors, newest first.

Two hard filters and nothing else: the posting must be software work, and it
must carry no explicit signal that a first-job candidate is disqualified. Every
offer that passes both is shown. The score is still computed and persisted, but
it neither orders nor filters this list.

Usage:
  npm run start:offline                       Run against the committed SAMPLE data (no API key)
  npm start -- --source=boards                Run the three company boards (no API key needed)
  npm start -- --source=greenhouse,ashby      Run a subset of providers
  npm start -- --source=newsletter            Read saved job-alert emails
  npm start -- --source=all                   Every supported real source

Options:
  --source=LIST                 Comma-separated. One or more of:
                                  fixture         committed SAMPLE data, fully offline.
                                                  Invented postings; the links point at
                                                  example-board.test and do not resolve.
                                  manfred         getmanfred.com, the Spanish tech market.
                                                  Spanish-language, and the ONLY source that
                                                  publishes a salary range. Small: the API
                                                  returns 1645 offers but only ~18 are open,
                                                  the rest are a closed archive.
                                  greenhouse      Greenhouse company boards
                                  lever           Lever company boards
                                  ashby           Ashby company boards
                                  smartrecruiters SmartRecruiters company boards
                                  landingjobs     landing.jobs, European tech. Measured
                                                  2026-09-10: 54 postings total, none in
                                                  Spain, none junior. Kept because boards
                                                  change; do not expect much from it.
                                  arbeitnow       arbeitnow.com, European. Berlin/London/
                                                  Paris dominated: 2 of 800 postings were
                                                  located in Spain. Remote roles are kept.
                                  newsletter      saved job-alert emails in data/newsletters/
                                Shortcuts: 'boards' = greenhouse,lever,ashby,smartrecruiters
                                           'all'    = every REAL source above (manfred,greenhouse,
                                             lever,ashby,smartrecruiters,landingjobs,
                                             arbeitnow,newsletter)
                                'fixture' is NEVER included in a shortcut and may not
                                share a run with a real source: demo postings competing
                                for position in a list you act on is the defect this
                                rule exists to prevent. Ask for it alone.
                                Default: fixture.
  --limit=N                     Truncate the list to N rows. OFF by default: every
                                offer that passed both filters is shown.
  --explain=N                   How many entries get a full score breakdown. Default: 3.
  --concurrency=N               Simultaneous company-board requests. Default: 4.
  --timeout=MS                  Per-request timeout for company boards. Default: 15000.
  --out=PATH                    Where to write the queue. Default: output/queue.json.
  --fixture=PATH                Sample data file. Default: data/sample-jobs.json.
  --applications=PATH           Application log. Default: data/applications.json.
  --newsletters=PATH            Folder of saved job-alert emails.
                                Default: data/newsletters.
  --no-resolve-links            Do NOT follow newsletter tracking links (e.g. short.gy)
                                to the employer's real posting. Resolution is ON by
                                default because the shortener is not an address the
                                candidate can apply at. Turn it off for an offline run
                                or to spend no requests at all. One HEAD request per
                                unique link, cached to disk, so a repeat run is free.
                                A failed lookup keeps the original link - it never
                                invents one.
  --resolve-links               Accepted and now a no-op: this is the default.
  --link-cache=PATH             Where resolved links are remembered, and the
                                record of which URL was original and which was
                                resolved. Default: data/newsletters/.link-cache.json.
  --no-check-links              Do NOT check whether the postings still exist.
                                Checking is ON by default and applies to EVERY
                                source, not just the newsletter. One HEAD request
                                per unique apply URL, bounded and cached to disk
                                with a TTL, so a repeat run is nearly free.

                                A posting is REMOVED only when its address answers
                                HTTP 404 or 410. Nothing else removes anything:
                                403 and 401 (bot protection, login walls), 429
                                (we asked too often), every 3xx, every 5xx,
                                timeouts, connection resets and DNS failures all
                                KEEP the posting and mark it as unverified. A run
                                with no network therefore removes nothing at all.

                                That asymmetry is deliberate. A dead link you
                                click past costs five seconds; a real vacancy
                                deleted here is invisible and unrecoverable.
  --check-links                 Accepted and a no-op: this is the default.
  --liveness-cache=PATH         Where liveness verdicts are remembered, and the
                                evidence for every posting this pipeline removed.
                                Default: data/.link-liveness.json.
  --help                        Show this message.

Company-board coverage comes from src/config/company-boards.ts - see the notes
there for how to add an employer.

Newsletter coverage comes from the parsers registered in
src/adapters/newsletter/newsletter-job-source.ts - see newsletter-parser.ts for
what you must supply to add a sender. Supported today:
${NEWSLETTER_PARSERS.map((parser) => `  - ${parser.senderDescription}`).join('\n')}
`.trim();

function readOption(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function readNumber(argv: readonly string[], name: string, fallback: number): number {
  const raw = readOption(argv, name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, received "${raw}"`);
  }
  return parsed;
}

/**
 * Whether this run follows newsletter tracking links.
 *
 * The negative wins when both forms are present. Someone who typed the opt-out
 * meant it, and silently preferring the affirmative would send requests a human
 * explicitly asked us not to send.
 */
function resolveLinksFrom(argv: readonly string[]): boolean {
  return !argv.includes('--no-resolve-links');
}

/**
 * Whether this run checks that the postings it is about to show still exist.
 *
 * Same shape and same precedence as the resolution flag above: the negative
 * wins, because somebody who typed the opt-out meant it and silently sending
 * requests a human asked us not to send is not a defensible default.
 */
function checkLinksFrom(argv: readonly string[]): boolean {
  return !argv.includes('--no-check-links');
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  // No default. A default limit is a silent deletion of offers the candidate
  // asked to see, which is exactly the behaviour that was removed.
  const rawLimit = readOption(argv, 'limit');

  return {
    sources: parseSourceSelection(readOption(argv, 'source')),
    limit: rawLimit === undefined ? undefined : readNumber(argv, 'limit', 0),
    explain: readNumber(argv, 'explain', 3),
    concurrency: readNumber(argv, 'concurrency', DEFAULT_BOARD_CONCURRENCY),
    timeoutMs: readNumber(argv, 'timeout', DEFAULT_BOARD_TIMEOUT_MS),
    outputPath: readOption(argv, 'out') ?? DEFAULT_QUEUE_PATH,
    fixturePath: readOption(argv, 'fixture') ?? DEFAULT_FIXTURE_PATH,
    applicationLogPath: readOption(argv, 'applications') ?? DEFAULT_APPLICATION_LOG_PATH,
    newsletterDir: readOption(argv, 'newsletters') ?? DEFAULT_NEWSLETTER_DIR,
    resolveLinks: resolveLinksFrom(argv),
    linkCachePath: readOption(argv, 'link-cache') ?? DEFAULT_NEWSLETTER_LINK_CACHE,
    checkLinks: checkLinksFrom(argv),
    livenessCachePath: readOption(argv, 'liveness-cache') ?? DEFAULT_LIVENESS_CACHE_PATH,
  };
}
