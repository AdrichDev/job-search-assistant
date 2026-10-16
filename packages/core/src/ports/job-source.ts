import type { Job } from '../domain/job.js';

/** A single wide-intake search request issued against a job board. */
export interface JobSourceQuery {
  readonly what: string;
  readonly where: string;
  readonly maxDaysOld: number;
  readonly resultsPerPage: number;
  readonly maxPages: number;
}

/**
 * How often the pipeline should ask a source in a single run.
 *
 * - `per-query` (the default): a SEARCH ENGINE. Each search term is a different
 *   question, so it is asked once per query in the plan.
 * - `per-run`: a COMPANY BOARD. Greenhouse, Lever and Ashby have no search
 *   endpoint - they return the whole board regardless of what is asked. Running
 *   a seven-term plan against them would be seven identical requests per
 *   company against a free, unauthenticated endpoint, and seven duplicate
 *   source reports all restating the same fetch.
 */
export type JobSourceQueryMode = 'per-query' | 'per-run';

/**
 * A sub-fetch that failed while its siblings succeeded.
 *
 * Exists because a source is no longer always one request. A provider fanning
 * out over ~14 company boards will routinely lose one of them, and that fact
 * has to be reportable WITHOUT declaring the whole source failed - otherwise
 * every run is "degraded" and the word stops carrying information.
 */
export interface SourceTargetFailure {
  /** Which sub-fetch died, e.g. a company slug. */
  readonly target: string;
  readonly error: string;
}

/**
 * Driven port: anything that can hand the pipeline normalized vacancies.
 *
 * Implementations MUST return domain `Job` objects (built via `createJob`) and
 * MUST NOT apply stack filtering - filtering is the ranker's job, not the
 * adapter's. Narrowing by LOCATION is allowed and expected, because that is
 * what a search engine's `where` parameter does server-side and what a company
 * board leaves for the adapter to do.
 */
export interface JobSource {
  readonly id: string;
  /** Defaults to `per-query` when omitted, which is what every search API is. */
  readonly queryMode?: JobSourceQueryMode;
  /**
   * What the source report calls a `per-run` fetch.
   *
   * A per-run source is never asked a search term, so the report cannot print
   * one - it has to print what actually happened instead. That sentence is
   * different per source ("all company boards" vs "all saved greenhouses"), and
   * getting it wrong is not cosmetic: the run summary is where the user reads
   * WHY a source failed, and a label naming a thing that was never touched
   * sends them to debug the wrong system.
   *
   * Ignored for `per-query` sources, which report the term they were given.
   */
  readonly sweepLabel?: string;
  fetchJobs(query: JobSourceQuery): Promise<readonly Job[]>;
  /**
   * Hands over (and clears) the sub-fetch failures from the last `fetchJobs`.
   *
   * Draining rather than reading, so a later run cannot inherit and re-report a
   * previous run's dead boards.
   */
  takeDegradedTargets?(): readonly SourceTargetFailure[];
}
