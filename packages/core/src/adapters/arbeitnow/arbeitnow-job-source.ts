import { z } from 'zod';
import {
  DEFAULT_BOARD_TIMEOUT_MS,
  fetchBoardJson,
  type BoardFetch,
} from '../boards/board-http.js';
import { htmlToPlainText } from '../boards/html-text.js';
import { matchesBoardLocation, withExtraCityTerms } from '../boards/board-location.js';
import { DEFAULT_BOARD_LOCATION_FILTER } from '../../config/company-boards.js';
import { createJob, type Job } from '../../domain/job.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';
import type { Logger } from '../../ports/logger.js';

/**
 * ARBEITNOW - a free, key-less European job board API.
 *
 * ## What was verified, 2026-09-10
 *
 *   GET /api/job-board-api          -> HTTP 200, 250 rows, `links.next` present
 *   GET /api/job-board-api?page=N   -> the same, paged
 *
 * The payload states its own terms in `meta.terms`: "This is a free public API
 * for jobs, please do not abuse." That sentence is the reason the page bound
 * below is small and hard rather than "keep going until it stops".
 *
 * ## What this source is actually worth, stated plainly
 *
 * 800 postings were pulled across five pages. **Two** had Spain in the location
 * field. The board is Berlin (94), London (59), Paris (50) and Hamburg (42).
 *
 * A note on the "~32 postings mentioning Spain/Madrid" figure that motivated
 * adding this source: 57 of the 800 mention Spain, Madrid or Barcelona
 * SOMEWHERE in the payload, but 55 of those mentions are in the description
 * body - "our offices in Berlin, Madrid and Paris", "clients across Spain". A
 * description-body mention is not a location, and treating it as one would put
 * Berlin-only vacancies in a Madrid candidate's list. Only the `location` field
 * and the `remote` flag are used here.
 *
 * ## Why remote postings are kept
 *
 * `remote` is a field this API reports. A remote European role is one a
 * Madrid-based candidate can genuinely take, and the brief is explicit that he
 * wants volume and judges relevance himself. Spain-located plus remote came to
 * 53 of 800 - a real intake, and still a narrow one.
 */

export const ARBEITNOW_SOURCE_ID = 'arbeitnow';
export const ARBEITNOW_BASE_URL = 'https://www.arbeitnow.com/api/job-board-api';
export const ARBEITNOW_SWEEP_LABEL = '(all Arbeitnow pages)';

/**
 * 250 postings a page, so five pages is 1250 - already more than the board
 * holds in a useful window, and a hard ceiling either way. The API says "please
 * do not abuse"; this is what taking that seriously looks like.
 */
const MAX_PAGES = 5;

const MILLIS_PER_DAY = 86_400_000;

const arbeitnowJobSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  company_name: z.string().default(''),
  location: z.string().default(''),
  description: z.string().default(''),
  remote: z.boolean().nullish(),
  tags: z.array(z.string()).default([]),
  job_types: z.array(z.string()).default([]),
  /** SECONDS since the epoch, not milliseconds and not an ISO string. */
  created_at: z.number(),
});

const arbeitnowEnvelopeSchema = z.object({ data: z.array(z.unknown()) });

export interface ArbeitnowJobSourceOptions {
  readonly logger: Logger;
  readonly fetchImpl?: BoardFetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly maxPages?: number;
}

export function createArbeitnowJobSource(options: ArbeitnowJobSourceOptions): JobSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const now = options.now ?? (() => new Date());

  const httpOptions = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    timeoutMs,
  };

  return {
    id: ARBEITNOW_SOURCE_ID,
    queryMode: 'per-run',
    sweepLabel: ARBEITNOW_SWEEP_LABEL,

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      const oldestAllowed = now().getTime() - query.maxDaysOld * MILLIS_PER_DAY;
      const filter = withExtraCityTerms(DEFAULT_BOARD_LOCATION_FILTER, query.where);

      const jobs: Job[] = [];
      let malformed = 0;

      for (let page = 1; page <= maxPages; page += 1) {
        const payload = await fetchBoardJson(`${ARBEITNOW_BASE_URL}?page=${page}`, httpOptions);

        const envelope = arbeitnowEnvelopeSchema.safeParse(payload);
        if (!envelope.success) {
          throw new Error('arbeitnow returned an unrecognized payload: no "data" array');
        }
        if (envelope.data.data.length === 0) {
          break;
        }

        for (const raw of envelope.data.data) {
          const parsed = arbeitnowJobSchema.safeParse(raw);
          if (!parsed.success) {
            malformed += 1;
            continue;
          }

          const job = parsed.data;

          // Seconds, not milliseconds. Feeding the raw number to `new Date()`
          // dates every posting to 1970 and flattens the recency dimension to a
          // uniform zero - a bug that looks like a working adapter.
          const postedAt = new Date(job.created_at * 1000);
          if (Number.isNaN(postedAt.getTime()) || postedAt.getTime() < oldestAllowed) {
            continue;
          }

          // The LOCATION field and the `remote` flag only. See the header note
          // on why description-body mentions of Madrid are not a location.
          if (job.remote !== true && !matchesBoardLocation([job.location], filter)) {
            continue;
          }

          try {
            jobs.push(
              createJob({
                sourceId: ARBEITNOW_SOURCE_ID,
                externalId: job.slug,
                title: job.title,
                company: job.company_name,
                location: job.location,
                description: [
                  htmlToPlainText(job.description),
                  job.tags.length > 0 ? `Stack: ${job.tags.join(', ')}` : '',
                ]
                  .filter((part) => part.length > 0)
                  .join('\n'),
                url: job.url,
                postedAt,
                // Arbeitnow's board API exposes no compensation field.
                salaryMin: null,
                salaryMax: null,
                contractType: job.job_types[0] ?? null,
              }),
            );
          } catch (cause: unknown) {
            options.logger.warn(
              `[${ARBEITNOW_SOURCE_ID}] skipped a posting: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          }
        }
      }

      if (malformed > 0) {
        options.logger.warn(
          `[${ARBEITNOW_SOURCE_ID}] skipped ${malformed} posting(s) whose shape the schema did not recognize`,
        );
      }

      return jobs;
    },
  };
}
