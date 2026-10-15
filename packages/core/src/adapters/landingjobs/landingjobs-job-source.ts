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
 * LANDING.JOBS - European tech postings, no key.
 *
 * ## What was verified, 2026-09-10
 *
 *   GET /api/v1/jobs?limit=50            -> HTTP 200, 50 rows
 *   GET /api/v1/jobs?limit=50&offset=50  -> HTTP 200, 4 rows
 *   GET /api/v1/jobs?limit=50&offset=100 -> empty
 *
 * Three parameters do NOT work, and each was tried:
 *   - `limit=200` still returns 50. Fifty is the ceiling.
 *   - `page=2` returns page one again. There is no page parameter.
 *   - `country_code=ES` is ignored entirely.
 *
 * Only `offset` moves. That is why this pages the way it does.
 *
 * ## What this source is actually worth, stated plainly
 *
 * The whole corpus was **54 postings**: 65 location entries in Portugal, four
 * in Germany, two in Brazil, one in Poland, and **zero in Spain**. Not one
 * title contained junior, trainee, graduate, becario or intern.
 *
 * It is wired up because it was asked for and because a job board's contents
 * change, not because it is currently earning its request. Anyone reviewing the
 * source list later should re-measure before assuming it does.
 *
 * ## Company
 *
 * There is no company field. The employer is still in the payload - it is the
 * `/at/<employer>/` segment of the posting's own URL - so it is read from
 * there. That is a derivation from a reported field, not an invention, and it
 * is the same posture the newsletter adapter takes with resolved links. When
 * the URL does not have that shape the company stays EMPTY, which `dedupe.ts`
 * already handles by refusing to merge on it.
 */

export const LANDINGJOBS_SOURCE_ID = 'landingjobs';
export const LANDINGJOBS_BASE_URL = 'https://landing.jobs/api/v1/jobs';
export const LANDINGJOBS_SWEEP_LABEL = '(all Landing.jobs postings)';

/** The API's ceiling, not a preference. */
const PAGE_SIZE = 50;

/**
 * Enough for six times the corpus that existed at verification time, and a hard
 * stop if the API ever stops returning an empty page at the end.
 */
const MAX_PAGES = 8;

const MILLIS_PER_DAY = 86_400_000;

const locationSchema = z.object({
  city: z.string().nullish(),
  country_code: z.string().nullish(),
});

const landingJobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1),
  url: z.string().url(),
  published_at: z.string().min(1),
  locations: z.array(locationSchema).default([]),
  remote: z.boolean().nullish(),
  type: z.string().nullish(),
  gross_salary_low: z.number().nullish(),
  gross_salary_high: z.number().nullish(),
  currency_code: z.string().nullish(),
  role_description: z.string().nullish(),
  main_requirements: z.string().nullish(),
  nice_to_have: z.string().nullish(),
  perks: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

type LandingJob = z.infer<typeof landingJobSchema>;

const landingEnvelopeSchema = z.array(z.unknown());

export interface LandingJobsSourceOptions {
  readonly logger: Logger;
  readonly fetchImpl?: BoardFetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly maxPages?: number;
}

function pageUrl(offset: number): string {
  return `${LANDINGJOBS_BASE_URL}?limit=${PAGE_SIZE}&offset=${offset}`;
}

/** `https://landing.jobs/at/damia-group-portugal/x` -> `Damia Group Portugal`. */
export function employerFromLandingUrl(url: string): string {
  const slug = /\/at\/([^/]+)\//.exec(url)?.[1];
  if (slug === undefined || slug.length === 0) {
    return '';
  }

  return decodeURIComponent(slug)
    .split('-')
    .filter((word) => word.length > 0)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

/** `Lisbon, PT`, or `PT`, or `''`. Never a city the payload did not state. */
function locationOf(job: LandingJob): string {
  const first = job.locations[0];
  if (first === undefined) {
    return '';
  }
  return [first.city ?? '', (first.country_code ?? '').toUpperCase()]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
}

function descriptionOf(job: LandingJob): string {
  return [job.role_description, job.main_requirements, job.nice_to_have, job.perks]
    .map((section) => htmlToPlainText(section ?? ''))
    .filter((section) => section.length > 0)
    .concat(job.tags.length > 0 ? [`Stack: ${job.tags.join(', ')}`] : [])
    .join('\n');
}

/** Only when the figure exists AND is quoted in euros - `Job` has no currency. */
function salaryOf(job: LandingJob): { min: number | null; max: number | null } {
  const currency = (job.currency_code ?? '').trim().toUpperCase();
  if (currency !== 'EUR') {
    return { min: null, max: null };
  }
  const clean = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  return { min: clean(job.gross_salary_low), max: clean(job.gross_salary_high) };
}

export function createLandingJobsSource(options: LandingJobsSourceOptions): JobSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const now = options.now ?? (() => new Date());

  const httpOptions = {
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    timeoutMs,
  };

  return {
    id: LANDINGJOBS_SOURCE_ID,
    queryMode: 'per-run',
    sweepLabel: LANDINGJOBS_SWEEP_LABEL,

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      const oldestAllowed = now().getTime() - query.maxDaysOld * MILLIS_PER_DAY;
      // Spain terms plus whatever city the plan asked for - same rule the
      // company boards use, and for the same reason.
      const filter = withExtraCityTerms(DEFAULT_BOARD_LOCATION_FILTER, query.where);

      const jobs: Job[] = [];
      let malformed = 0;

      for (let page = 0; page < maxPages; page += 1) {
        const payload = await fetchBoardJson(pageUrl(page * PAGE_SIZE), httpOptions);

        const envelope = landingEnvelopeSchema.safeParse(payload);
        if (!envelope.success) {
          throw new Error(
            'landing.jobs returned an unrecognized payload: the jobs list was not an array',
          );
        }
        if (envelope.data.length === 0) {
          break;
        }

        for (const raw of envelope.data) {
          const parsed = landingJobSchema.safeParse(raw);
          if (!parsed.success) {
            malformed += 1;
            continue;
          }

          const job = parsed.data;
          const postedAt = new Date(job.published_at);
          if (Number.isNaN(postedAt.getTime()) || postedAt.getTime() < oldestAllowed) {
            continue;
          }

          const location = locationOf(job);
          /*
           * Spain, or explicitly remote.
           *
           * The remote branch is not a loophole - `remote` is a field this API
           * reports, and a remote European role is one a Madrid-based candidate
           * can genuinely take. The brief is explicit that he wants volume and
           * judges relevance himself, so a remote posting is surfaced and left
           * to him rather than deleted here where he could never argue with it.
           */
          if (job.remote !== true && !matchesBoardLocation([location], filter)) {
            continue;
          }

          const salary = salaryOf(job);

          try {
            jobs.push(
              createJob({
                sourceId: LANDINGJOBS_SOURCE_ID,
                externalId: job.id,
                title: job.title,
                company: employerFromLandingUrl(job.url),
                location,
                description: descriptionOf(job),
                url: job.url,
                postedAt,
                salaryMin: salary.min,
                salaryMax: salary.max,
                contractType: job.type ?? null,
              }),
            );
          } catch (cause: unknown) {
            options.logger.warn(
              `[${LANDINGJOBS_SOURCE_ID}] skipped a posting: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            );
          }
        }

        if (envelope.data.length < PAGE_SIZE) {
          break;
        }
      }

      if (malformed > 0) {
        options.logger.warn(
          `[${LANDINGJOBS_SOURCE_ID}] skipped ${malformed} posting(s) whose shape the schema did not recognize`,
        );
      }

      return jobs;
    },
  };
}
