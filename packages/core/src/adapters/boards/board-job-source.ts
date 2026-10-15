import { createJob, type Job, type JobDraft } from '../../domain/job.js';
import { DEFAULT_BOARD_LOCATION_FILTER, type CompanyBoard } from '../../config/company-boards.js';
import type { JobSource, JobSourceQuery, SourceTargetFailure } from '../../ports/job-source.js';
import type { Logger } from '../../ports/logger.js';
import {
  DEFAULT_BOARD_CONCURRENCY,
  DEFAULT_BOARD_TIMEOUT_MS,
  fetchBoardJson,
  mapWithConcurrency,
  type BoardFetch,
} from './board-http.js';
import {
  matchesBoardLocation,
  withExtraCityTerms,
  type BoardLocationFilter,
} from './board-location.js';

/**
 * One `JobSource` over MANY company boards.
 *
 * Greenhouse, Lever and Ashby differ only in their URL and their payload shape;
 * everything that actually matters - fan-out, concurrency, timeouts, location
 * narrowing, age filtering, per-company failure isolation - is identical, so it
 * lives here once instead of three times.
 *
 * THE FAILURE MODEL, which is the whole reason this file is not three files:
 *
 *   one company board fails  -> absorbed. Logged, recorded as a degraded
 *                               target, and the other boards' postings are
 *                               kept. With ~28 boards, something is 404ing
 *                               most days; letting that fail the source would
 *                               make "degraded run" permanent and therefore
 *                               meaningless.
 *
 *   EVERY company board fails -> thrown. This is the only case where "we found
 *                               nothing" is a statement about the network
 *                               rather than about the job market, and it is
 *                               exactly the statement the degraded-write guard
 *                               in `persist-queue.ts` needs to protect real
 *                               postings from being overwritten.
 */

/** A posting parsed off a board, plus every location string the board attached. */
export interface BoardPosting {
  readonly draft: JobDraft;
  /**
   * Used only by the location filter, never shown.
   *
   * Separate from `draft.location` because Ashby publishes pan-European roles
   * with `location: "Berlin Office"` and Spain buried in `secondaryLocations`.
   * Filtering on the displayed string alone would drop precisely the remote
   * roles this candidate is most likely to get.
   */
  readonly locationCandidates: readonly string[];
}

export interface BoardParseContext {
  readonly company: CompanyBoard;
  /** Report a single unusable posting. Never throws: one bad row is not a bad board. */
  readonly skip: (reason: string) => void;
}

/**
 * What a provider needs in order to make a SECOND request per posting.
 *
 * Fetching is handed over rather than left to the provider so the politeness
 * rules stay in one place: the same User-Agent, the same timeout and the same
 * concurrency bound apply whether a provider makes one request or eighty.
 */
export interface BoardHydrateContext extends BoardParseContext {
  /** Already carries the shared User-Agent and timeout. */
  readonly fetchJson: (url: string) => Promise<unknown>;
  /** Runs `worker` over `items` with the source's configured bound in flight. */
  readonly mapBounded: <T, R>(
    items: readonly T[],
    worker: (item: T) => Promise<R>,
  ) => Promise<R[]>;
}

/** What a provider must know how to do. Everything else is shared. */
export interface BoardProvider {
  readonly id: string;
  boardUrl(company: CompanyBoard): string;
  /** Throws when the ENVELOPE is unusable; calls `skip` for individual bad rows. */
  parseBoard(payload: unknown, context: BoardParseContext): readonly BoardPosting[];
  /**
   * Optional second pass over the postings that SURVIVED the filters.
   *
   * Exists for one reason: SmartRecruiters' list payload contains no public
   * apply URL and no description. Both live on a per-posting detail endpoint,
   * so that provider has to ask again - and `domain/job.ts` is unambiguous that
   * asking is the only alternative to inventing an address.
   *
   * It runs AFTER location and age filtering, never before. That ordering is
   * the difference between one request per posting a human might actually click
   * and one request per posting on a worldwide board. A provider may return
   * fewer postings than it was given: one whose detail lookup failed has no
   * address, and a posting with no address is not a posting.
   */
  hydrate?(
    postings: readonly BoardPosting[],
    context: BoardHydrateContext,
  ): Promise<readonly BoardPosting[]>;
}

export interface BoardJobSourceOptions {
  readonly companies: readonly CompanyBoard[];
  readonly logger: Logger;
  readonly fetchImpl?: BoardFetch;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly locationFilter?: BoardLocationFilter;
  readonly now?: () => Date;
}

export type BoardSourceFactoryOptions = BoardJobSourceOptions;

const MILLIS_PER_DAY = 86_400_000;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createBoardJobSource(
  provider: BoardProvider,
  options: BoardJobSourceOptions,
): JobSource {
  const concurrency = options.concurrency ?? DEFAULT_BOARD_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;
  const baseFilter = options.locationFilter ?? DEFAULT_BOARD_LOCATION_FILTER;
  const now = options.now ?? (() => new Date());

  /** Drained by the app layer onto the source report after each run. */
  let degradedTargets: SourceTargetFailure[] = [];

  async function fetchCompany(company: CompanyBoard): Promise<readonly BoardPosting[] | null> {
    try {
      const payload = await fetchBoardJson(provider.boardUrl(company), {
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        timeoutMs,
      });

      return provider.parseBoard(payload, {
        company,
        skip: (reason) => {
          options.logger.warn(
            `[${provider.id}] ${company.slug}: skipped a posting (${reason})`,
          );
        },
      });
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      // Absorbed, not swallowed: it is logged here AND surfaced on the source
      // report, so a board that quietly dies is still visible in the output.
      options.logger.warn(`[${provider.id}] board "${company.slug}" failed: ${message}`);
      degradedTargets.push({ target: company.slug, error: message });
      return null;
    }
  }

  return {
    id: provider.id,

    /*
     * A company board is not a search engine - it returns the whole board no
     * matter what is asked. Running the seven-query search plan against it
     * would be seven identical requests per company against a free endpoint,
     * and seven duplicate source reports saying the same thing.
     */
    queryMode: 'per-run',

    takeDegradedTargets(): readonly SourceTargetFailure[] {
      const drained = degradedTargets;
      degradedTargets = [];
      return drained;
    },

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      if (options.companies.length === 0) {
        return [];
      }

      degradedTargets = [];

      const results = await mapWithConcurrency(options.companies, concurrency, fetchCompany);

      const reachedBoards = results.filter((entry) => entry !== null).length;
      if (reachedBoards === 0) {
        throw new Error(
          `all ${options.companies.length} ${provider.id} boards failed ` +
            `(${degradedTargets.map((entry) => `${entry.target}: ${entry.error}`).join('; ')})`,
        );
      }

      // The plan's own city is added to the standing filter rather than
      // replacing it: dropping the country terms would discard every
      // "Spain (Remote)" posting on every board.
      const filter = withExtraCityTerms(baseFilter, query.where);
      const oldestAllowed = now().getTime() - query.maxDaysOld * MILLIS_PER_DAY;

      const jobs: Job[] = [];

      for (const [index, postings] of results.entries()) {
        if (postings === null) {
          continue;
        }

        const company = options.companies[index];
        if (company === undefined) {
          continue;
        }

        const surviving = postings.filter(
          (posting) =>
            matchesBoardLocation(posting.locationCandidates, filter) &&
            posting.draft.postedAt.getTime() >= oldestAllowed,
        );

        /*
         * Hydration runs here - after the filters, before minting.
         *
         * A provider that needs a second request per posting only pays for the
         * postings that could still be shown. A failure inside it is absorbed
         * exactly like a bad row: the provider drops that posting and the rest
         * of the board is unaffected.
         */
        let ready: readonly BoardPosting[] = surviving;
        if (provider.hydrate !== undefined && surviving.length > 0) {
          try {
            ready = await provider.hydrate(surviving, {
              company,
              skip: (reason) => {
                options.logger.warn(`[${provider.id}] ${company.slug}: skipped a posting (${reason})`);
              },
              fetchJson: (url) =>
                fetchBoardJson(url, {
                  ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
                  timeoutMs,
                }),
              mapBounded: (items, worker) =>
                mapWithConcurrency(items, concurrency, (item) => worker(item)),
            });
          } catch (cause: unknown) {
            options.logger.warn(
              `[${provider.id}] ${company.slug}: could not load posting details ` +
                `(${errorMessage(cause)}); its postings were skipped rather than shown ` +
                'with an address nobody reported',
            );
            ready = [];
          }
        }

        for (const posting of ready) {
          try {
            jobs.push(createJob(posting.draft));
          } catch (cause: unknown) {
            // The domain refused the draft - in practice, a board that returned
            // a posting with no usable URL. Skipped loudly, never repaired.
            options.logger.warn(
              `[${provider.id}] skipped a posting: ${errorMessage(cause)}`,
            );
          }
        }
      }

      return jobs;
    },
  };
}
