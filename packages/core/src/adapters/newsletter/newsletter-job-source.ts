import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createJob, type Job } from '../../domain/job.js';
import type { JobSource, JobSourceQuery, SourceTargetFailure } from '../../ports/job-source.js';
import type { Logger } from '../../ports/logger.js';
import { juniorJobsDigestParser } from './juniorjobs-digest.js';
import {
  createPassthroughLinkResolver,
  type LinkResolution,
  type LinkResolver,
} from './link-resolver.js';
import {
  selectNewsletterParser,
  type NewsletterParser,
  type NewsletterPosting,
} from './newsletter-parser.js';

/**
 * JOB ALERTS AS A SOURCE.
 *
 * The reasoning that put this adapter in the codebase, stated once:
 *
 *   Job sites either forbid scraping or hide their listings behind JavaScript.
 *   But nearly every one of them will EMAIL you the same listings if you
 *   subscribe to an alert. Reading an email the user asked to receive is
 *   legitimate, stable, and immune to a markup change on a Tuesday.
 *
 * So the pipeline does not visit michaelpage.es. It reads the folder where the
 * user drops the alerts michaelpage.es sent him. That is a smaller technical
 * idea and a much larger practical one, because it works for every sender at
 * once and stops working for none of them.
 *
 * WHAT THIS ADAPTER DOES NOT DO, deliberately:
 *   - it never fetches a job page;
 *   - it never reads seniority off a posting's HTML (the junior filter already
 *     judges that from title and description, downstream);
 *   - it never invents a URL. See the link handling below.
 *
 * FAILURE MODEL, mirroring the company-board source:
 *   one unreadable FILE   -> absorbed. Logged, reported as a degraded target,
 *                            every other file's postings survive.
 *   a missing INPUT FOLDER -> thrown. That is a configuration fact, not a fact
 *                            about the job market, and the degraded-write guard
 *                            in `persist-queue.ts` needs to hear about it before
 *                            an empty result replaces real postings.
 */

export const NEWSLETTER_SOURCE_ID = 'newsletter';

/** Extensions a saved email body plausibly has. Anything else is ignored. */
const READABLE_EXTENSIONS = new Set(['.txt', '.eml', '.text']);

/** `newsletter-2026-09-06.txt` -> the day the digest arrived. */
const FILE_DATE_PATTERN = /(\d{4})-(\d{2})-(\d{2})/;

const MILLIS_PER_DAY = 86_400_000;

/**
 * Every parser with a REAL saved sample behind it.
 *
 * One entry. That is not an oversight and it is not a stub - it is the whole
 * policy. See the header of `newsletter-parser.ts`: a parser written against an
 * imagined format is how thirteen fabricated URLs shipped, and adding
 * `michael-page` or `linkedin` here without an email to read would repeat it
 * with better intentions.
 */
export const NEWSLETTER_PARSERS: readonly NewsletterParser[] = [juniorJobsDigestParser];

/** One link, as the newsletter wrote it and as the queue will show it. */
export interface LinkProvenance extends LinkResolution {
  readonly sourceFile: string;
}

export interface NewsletterJobSourceOptions {
  /** Folder of saved alert bodies. */
  readonly directory: string;
  readonly logger: Logger;
  readonly now: () => Date;
  /**
   * Defaults to the passthrough resolver, which makes no requests.
   * Redirect following is opt-in; see `link-resolver.ts`.
   */
  readonly linkResolver?: LinkResolver;
  /**
   * Parsers registered IN ADDITION to `NEWSLETTER_PARSERS`, tried first.
   * Exists so a test - or a user with a sample of their own - can add a sender
   * without editing this file.
   */
  readonly extraParsers?: readonly NewsletterParser[];
}

export interface NewsletterJobSource extends JobSource {
  /**
   * Hands over (and clears) the link provenance from the last `fetchJobs`.
   *
   * Drained rather than read, exactly like `takeDegradedTargets`, so a later
   * run cannot re-report an earlier run's resolutions.
   */
  takeLinkProvenance(): readonly LinkProvenance[];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isMissingDirectory(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * When the digest arrived.
 *
 * The file name first, because that is what the user controls and what he named
 * deliberately; the file's modification time second. Newsletters do not date
 * individual postings, so this is an approximation - and it is the honest one,
 * as opposed to stamping everything `now` and letting a three-month-old saved
 * email masquerade as today's market.
 */
async function receivedAtFor(path: string, fileName: string): Promise<Date> {
  const matched = FILE_DATE_PATTERN.exec(fileName);
  if (matched !== null) {
    const parsed = Date.parse(`${matched[1]}-${matched[2]}-${matched[3]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }

  try {
    return (await stat(path)).mtime;
  } catch {
    return new Date();
  }
}

interface ParsedFile {
  readonly fileName: string;
  readonly postings: readonly NewsletterPosting[];
}

export function createNewsletterJobSource(
  options: NewsletterJobSourceOptions,
): NewsletterJobSource {
  const linkResolver = options.linkResolver ?? createPassthroughLinkResolver();
  const parsers = [...(options.extraParsers ?? []), ...NEWSLETTER_PARSERS];

  let degradedTargets: SourceTargetFailure[] = [];
  let linkProvenance: LinkProvenance[] = [];

  async function listSavedEmails(): Promise<readonly string[]> {
    let entries;
    try {
      entries = await readdir(options.directory, { withFileTypes: true });
    } catch (cause: unknown) {
      if (isMissingDirectory(cause)) {
        throw new Error(
          `the newsletter input folder "${options.directory}" does not exist. ` +
            'Create it and save your job-alert emails into it as .txt files, ' +
            'or point the run somewhere else with --newsletters=PATH.',
        );
      }
      throw new Error(
        `could not read the newsletter input folder "${options.directory}": ${errorMessage(cause)}`,
      );
    }

    return entries
      .filter((entry) => entry.isFile() && READABLE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      // Sorted so two runs over the same folder produce the same order, which
      // is what keeps first-seen dedupe from shuffling the morning list.
      .sort();
  }

  async function parseFile(fileName: string): Promise<ParsedFile | null> {
    const path = join(options.directory, fileName);

    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      options.logger.warn(`[${NEWSLETTER_SOURCE_ID}] could not read ${fileName}: ${message}`);
      degradedTargets.push({ target: fileName, error: message });
      return null;
    }

    if (text.trim().length === 0) {
      // Not a degraded target: the file is readable and says nothing. That is a
      // saved email the user has not pasted into yet, not a parser failure.
      options.logger.warn(`[${NEWSLETTER_SOURCE_ID}] ${fileName} is empty; nothing to read`);
      return null;
    }

    const parser = selectNewsletterParser(text, parsers);
    if (parser === null) {
      /*
       * THE SEAM, doing its job out loud.
       *
       * This is what the user sees the first time he saves a Michael Page or
       * LinkedIn alert: a named file, a clear "nobody here can read this yet",
       * and every other file still processed. What he must NEVER see is this
       * adapter guessing at an unknown layout and producing plausible rows.
       */
      const message =
        `no registered parser recognised this file. Supported senders today: ` +
        `${parsers.map((entry) => entry.senderDescription).join('; ')}. ` +
        'To add one, save a real sample and follow the checklist in newsletter-parser.ts.';
      options.logger.warn(`[${NEWSLETTER_SOURCE_ID}] ${fileName}: ${message}`);
      degradedTargets.push({ target: fileName, error: message });
      return null;
    }

    const receivedAt = await receivedAtFor(path, fileName);

    try {
      const postings = parser.parse(text, {
        fileName,
        receivedAt,
        skip: (reason) => {
          options.logger.warn(`[${NEWSLETTER_SOURCE_ID}] skipped an entry (${reason})`);
        },
      });
      return { fileName, postings };
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      options.logger.warn(
        `[${NEWSLETTER_SOURCE_ID}] parser "${parser.format}" failed on ${fileName}: ${message}`,
      );
      degradedTargets.push({ target: fileName, error: message });
      return null;
    }
  }

  return {
    id: NEWSLETTER_SOURCE_ID,

    /*
     * A saved email answers no query. Running the seven-term search plan against
     * this folder would be seven identical reads of the same files and seven
     * duplicate rows in the source report, all restating one fetch.
     */
    queryMode: 'per-run',

    /*
     * What the run summary calls this fetch. Without it a failed newsletter read
     * printed `newsletter "(all company boards)": ...`, pointing the reader at a
     * subsystem that was never involved.
     */
    sweepLabel: '(all saved newsletters)',

    takeDegradedTargets(): readonly SourceTargetFailure[] {
      const drained = degradedTargets;
      degradedTargets = [];
      return drained;
    },

    takeLinkProvenance(): readonly LinkProvenance[] {
      const drained = linkProvenance;
      linkProvenance = [];
      return drained;
    },

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      degradedTargets = [];
      linkProvenance = [];

      const files = await listSavedEmails();
      if (files.length === 0) {
        options.logger.warn(
          `[${NEWSLETTER_SOURCE_ID}] no saved emails in "${options.directory}". ` +
            'Subscribe to a job alert and save its text into that folder.',
        );
        return [];
      }

      const parsed = (await Promise.all(files.map(parseFile))).filter(
        (entry): entry is ParsedFile => entry !== null,
      );

      const oldestAllowed = options.now().getTime() - query.maxDaysOld * MILLIS_PER_DAY;

      /*
       * Everything that could disqualify a posting happens BEFORE resolution.
       * Following a redirect for a posting we are about to drop is a request
       * somebody else's server did not need to serve.
       */
      const usable: { readonly file: string; readonly posting: NewsletterPosting }[] = [];

      for (const { fileName, postings } of parsed) {
        for (const posting of postings) {
          if (posting.url === null) {
            /*
             * NO LINK, NO POSTING.
             *
             * The real sample contains one of these: the sender pasted the job
             * title where the link belonged. The only correct response is to
             * drop it and say so. A search URL, a company homepage or an address
             * built from the title would all be a lie that looks like a link,
             * which is precisely the defect this codebase already shipped once.
             */
            options.logger.warn(
              `[${NEWSLETTER_SOURCE_ID}] ${fileName}: dropped "${posting.title}" ` +
                `(${posting.company}) - the newsletter entry carried no link, and a posting ` +
                'without one is not a posting.',
            );
            continue;
          }

          if (posting.postedAt.getTime() < oldestAllowed) {
            continue;
          }

          usable.push({ file: fileName, posting });
        }
      }

      const resolutions = await linkResolver.resolve(
        usable.map((entry) => entry.posting.url as string),
      );

      const seenLinks = new Set<string>();
      const jobs: Job[] = [];

      for (const { file, posting } of usable) {
        const original = posting.url as string;
        const resolution = resolutions.get(original) ?? {
          originalUrl: original,
          finalUrl: original,
          resolved: false,
          status: null,
          error: null,
        };

        if (!seenLinks.has(original)) {
          seenLinks.add(original);
          linkProvenance.push({ ...resolution, sourceFile: file });
        }

        try {
          jobs.push(
            createJob({
              sourceId: NEWSLETTER_SOURCE_ID,
              /*
               * Identity is the link the SENDER supplied, never the resolved
               * one and never the title. The original is what stays stable
               * across runs: resolution is opt-in, so an id built from the
               * destination would change the moment the user passed
               * `--resolve-links`, and every previously applied job would look
               * new again.
               */
              externalId: original,
              title: posting.title,
              company: posting.company,
              location: posting.location,
              description: posting.description,
              // The domain re-validates this and throws if it is unusable.
              url: resolution.finalUrl,
              postedAt: posting.postedAt,
            }),
          );
        } catch (cause: unknown) {
          // The domain refused the draft - in practice a link that is not an
          // absolute http(s) address. Skipped loudly, never repaired.
          options.logger.warn(
            `[${NEWSLETTER_SOURCE_ID}] ${file}: skipped a posting: ${errorMessage(cause)}`,
          );
        }
      }

      return jobs;
    },
  };
}
