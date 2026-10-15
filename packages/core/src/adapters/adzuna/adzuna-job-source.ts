import { createJob, type Job } from '../../domain/job.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';
import type { Logger } from '../../ports/logger.js';
import { adzunaEnvelopeSchema, adzunaResultSchema } from './adzuna-schema.js';

export const ADZUNA_SOURCE_ID = 'adzuna';
export const ADZUNA_DEFAULT_BASE_URL = 'https://api.adzuna.com/v1/api/jobs/es/search';

/** Minimal `fetch` surface, so tests can substitute it without a Response polyfill. */
export interface HttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type HttpFetch = (url: string) => Promise<HttpResponseLike>;

export interface AdzunaJobSourceOptions {
  readonly appId: string;
  readonly appKey: string;
  readonly logger: Logger;
  readonly baseUrl?: string;
  readonly fetchImpl?: HttpFetch;
}

function buildUrl(
  baseUrl: string,
  page: number,
  query: JobSourceQuery,
  appId: string,
  appKey: string,
): string {
  const url = new URL(`${baseUrl}/${page}`);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', query.what);
  url.searchParams.set('where', query.where);
  url.searchParams.set('results_per_page', String(query.resultsPerPage));
  url.searchParams.set('max_days_old', String(query.maxDaysOld));
  // Documented Adzuna parameter: "The category tag, as returned by the
  // 'category' endpoint". Sent only when the plan asks for it, so an omitted
  // category means an unfiltered search rather than an empty one.
  if (query.category !== undefined) {
    url.searchParams.set('category', query.category);
  }
  url.searchParams.set('content-type', 'application/json');
  return url.toString();
}

function toJob(raw: unknown, logger: Logger): Job | null {
  const parsed = adzunaResultSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn(`[adzuna] skipped a malformed result: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    return null;
  }

  const result = parsed.data;
  const postedAt = new Date(result.created);
  if (Number.isNaN(postedAt.getTime())) {
    logger.warn(`[adzuna] skipped result ${result.id}: unparsable created date "${result.created}"`);
    return null;
  }

  try {
    return createJob({
      sourceId: ADZUNA_SOURCE_ID,
      externalId: result.id,
      title: result.title,
      // `redirect_url` verbatim. It carries Adzuna's own tracking parameters and
      // they are not ours to strip: the URL we show must be the URL they gave.
      url: result.redirect_url,
      company: result.company.display_name,
      location: result.location.display_name,
      description: result.description,
      postedAt,
      salaryMin: result.salary_min ?? null,
      salaryMax: result.salary_max ?? null,
      contractType: result.contract_type ?? null,
    });
  } catch (cause: unknown) {
    // The domain refused the draft - in practice, an unusable URL. One bad row
    // is skipped loudly; it is not allowed to fail the whole source.
    logger.warn(
      `[adzuna] skipped result ${result.id}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }
}

/**
 * Adzuna Spain adapter.
 *
 * It applies NO stack filtering - it returns whatever the query brought back,
 * senior roles included. Which lane a posting belongs to is decided later, by
 * ranking. The one narrowing it does perform is the board's own employment
 * SECTOR filter (`category`), and only when the search plan asks for it.
 *
 * A malformed individual offer is skipped and logged. A broken envelope or a
 * non-2xx response throws, and the app layer degrades to the other sources.
 */
export function createAdzunaJobSource(options: AdzunaJobSourceOptions): JobSource {
  const baseUrl = options.baseUrl ?? ADZUNA_DEFAULT_BASE_URL;
  const doFetch: HttpFetch =
    options.fetchImpl ?? ((url) => fetch(url).then((response) => response as HttpResponseLike));

  return {
    id: ADZUNA_SOURCE_ID,

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      const jobs: Job[] = [];

      for (let page = 1; page <= query.maxPages; page += 1) {
        const url = buildUrl(baseUrl, page, query, options.appId, options.appKey);
        const response = await doFetch(url);

        if (!response.ok) {
          throw new Error(`Adzuna request failed with HTTP ${response.status} (page ${page})`);
        }

        const envelope = adzunaEnvelopeSchema.safeParse(await response.json());
        if (!envelope.success) {
          throw new Error('Adzuna returned an unrecognized payload: no "results" array');
        }

        for (const raw of envelope.data.results) {
          const job = toJob(raw, options.logger);
          if (job !== null) {
            jobs.push(job);
          }
        }

        // A page that is not full means there is nothing left to paginate.
        if (envelope.data.results.length < query.resultsPerPage) {
          break;
        }
      }

      return jobs;
    },
  };
}
