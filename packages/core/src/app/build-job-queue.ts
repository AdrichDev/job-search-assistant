import { indexApplicationsByJobId, type Application } from '../domain/application.js';
import { dedupeJobs } from '../domain/dedupe.js';
import type { Job } from '../domain/job.js';
import { judgeHardEligibility } from '../domain/hard-eligibility.js';
import type { JuniorFilterConfig } from '../domain/junior-eligibility.js';
import {
  describeLivenessRemoval,
  isProvablyGone,
  type LivenessRecord,
} from '../domain/link-liveness.js';
import { orderByRecency, scoreJobs } from '../domain/order.js';
import { extractRequirements } from '../domain/requirements.js';
import type { ScoredJob, ScoringConfig } from '../domain/scoring/types.js';
import type { JobSource, JobSourceQuery } from '../ports/job-source.js';
import type { LinkChecker } from '../ports/link-checker.js';
import type { Logger } from '../ports/logger.js';
import type {
  ExcludedEntry,
  JobQueue,
  LivenessSummary,
  SourceReport,
} from '../ports/queue-writer.js';
import { statusFieldsFor } from './application-status.js';

export interface BuildJobQueueInput {
  readonly queries: readonly JobSourceQuery[];
  /**
   * OPT-IN truncation. Omitted - the default everywhere - means every posting
   * that passed both filters is surfaced.
   *
   * It used to default to 25, which quietly deleted offers the candidate had
   * asked to see. The flag survives only because inspecting a huge run in a
   * terminal is a real need; nothing in the product path sets it.
   */
  readonly limit?: number;
  readonly candidateName?: string;
}

export interface BuildJobQueueDeps {
  readonly sources: readonly JobSource[];
  readonly scoringConfig: ScoringConfig;
  /**
   * Filter B vocabulary. Injected, exactly like `scoringConfig`.
   *
   * Not defaulted from `src/config` here on purpose: the app layer must not
   * reach into configuration, or the dependency arrow
   * `adapters -> app -> ports -> domain` quietly stops being true. The
   * composition roots (the CLI and the web container) own that choice.
   */
  readonly juniorFilterConfig: JuniorFilterConfig;
  readonly logger: Logger;
  readonly now: () => Date;
  /**
   * The application log. Optional so the pipeline still runs headless with no
   * tracking store configured; absent means every job reads as not applied.
   */
  readonly applications?: readonly Application[];
  /**
   * Asks whether each surviving posting's address still serves something.
   *
   * OPTIONAL, and its absence means NO POSTING IS EVER REMOVED. That default is
   * the whole safety posture in one line: a caller who forgets to wire a
   * checker, a test that does not care about liveness, and a user who passed
   * `--no-check-links` all get identical behaviour, and it is the behaviour
   * that cannot destroy anything.
   *
   * Injected as a port rather than called directly so this use case stays
   * runnable with no network - see `tests/app/queue-liveness.test.ts`, where
   * every 403, timeout and connection reset in the rule is exercised without a
   * single request.
   */
  readonly linkChecker?: LinkChecker;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What a `per-run` sweep is called in the source report when the source does
 * not name itself.
 *
 * Reporting the first search term instead would be a lie: the board never saw
 * that term, and the same fetch would look like it answered one query out of
 * seven.
 *
 * A source that is not a company board overrides this with `sweepLabel` - see
 * the port. This constant stays board-specific because the company boards are
 * what it was written for and what its wording is accurate about.
 */
export const BOARD_SWEEP_LABEL = '(all company boards)';

/** One planned call to one source. */
interface Attempt {
  readonly source: JobSource;
  readonly query: JobSourceQuery;
  /** What the source report calls this attempt. */
  readonly label: string;
}

/**
 * Collapses the search plan into the single query a per-run source is asked.
 *
 * `maxDaysOld` takes the WIDEST value in the plan: the sweep answers for every
 * query at once, so narrowing it to the strictest one would silently under-serve
 * the others. The rest come from the first query, which is the plan's primary
 * intent.
 */
function sweepQueryFor(queries: readonly JobSourceQuery[]): JobSourceQuery | null {
  const first = queries[0];
  if (first === undefined) {
    return null;
  }

  return {
    ...first,
    what: BOARD_SWEEP_LABEL,
    maxDaysOld: Math.max(...queries.map((query) => query.maxDaysOld)),
    resultsPerPage: Math.max(...queries.map((query) => query.resultsPerPage)),
    maxPages: Math.max(...queries.map((query) => query.maxPages)),
  };
}

/**
 * Turns (sources x plan) into the calls that will actually be made.
 *
 * A search engine is asked once per term; a company board is asked once, full
 * stop. Keeping that decision here rather than inside the adapters is what lets
 * `sourceReports` stay one honest row per real request.
 */
function planAttempts(
  sources: readonly JobSource[],
  queries: readonly JobSourceQuery[],
): readonly Attempt[] {
  const sweep = sweepQueryFor(queries);

  return sources.flatMap((source): readonly Attempt[] => {
    if (source.queryMode !== 'per-run') {
      return queries.map((query) => ({ source, query, label: query.what }));
    }
    // No plan means no location and no age window to sweep with; asking anyway
    // would be inventing a query the user never wrote.
    if (sweep === null) {
      return [];
    }
    const label = source.sweepLabel ?? BOARD_SWEEP_LABEL;
    return [{ source, query: { ...sweep, what: label }, label }];
  });
}

/** No checker wired in: nothing asked, nothing known, nothing removed. */
const LIVENESS_OFF: LivenessSummary = {
  status: 'off',
  checked: 0,
  alive: 0,
  gone: 0,
  unverified: 0,
  removed: 0,
  requests: 0,
  fromCache: 0,
};

/**
 * Asks the checker about the postings that are actually going to be shown.
 *
 * Two decisions live here, both about restraint:
 *
 * 1. WHAT IS ASKED ABOUT. Only postings that already passed both filters. A
 *    posting excluded as not-software will never be clicked, so spending a
 *    request on somebody's careers server to ask about it is pure waste - and
 *    on a real run that is the difference between ~130 requests and ~300.
 *
 * 2. WHAT A FAILURE MEANS. If the checker throws, this returns NO records at
 *    all, and no record means no removal. That is the degraded case the whole
 *    feature has to get right: an unreachable checker is a fact about the
 *    network, and deleting a candidate's opportunities on the strength of a
 *    fact about the network is precisely the trade this codebase refuses
 *    everywhere else it comes up.
 */
async function checkLiveness(
  eligible: readonly ScoredJob[],
  deps: BuildJobQueueDeps,
): Promise<{
  readonly records: ReadonlyMap<string, LivenessRecord>;
  readonly status: LivenessSummary['status'];
  readonly error?: string;
}> {
  const checker = deps.linkChecker;
  if (checker === undefined || eligible.length === 0) {
    return { records: new Map(), status: 'off' };
  }

  try {
    const records = await checker.check(eligible.map((entry) => entry.job.url));
    return { records, status: 'ran' };
  } catch (cause: unknown) {
    const message = errorMessage(cause);
    deps.logger.warn(
      `link liveness check failed wholesale (${message}); nothing was removed. ` +
        'An unreachable checker is not evidence that any vacancy has closed.',
    );
    return { records: new Map(), status: 'failed', error: message };
  }
}

/** Shapes one rejected posting for the audit trail. */
function excludedEntry(
  entry: ScoredJob,
  excludedBy: ExcludedEntry['excludedBy'],
  reason: string,
): ExcludedEntry {
  return {
    id: entry.job.id,
    title: entry.job.title,
    company: entry.job.company,
    location: entry.job.location,
    url: entry.job.url,
    postedAt: entry.job.postedAt.toISOString(),
    excludedBy,
    scoreBeforeGate: entry.score.totalBeforeGate,
    softwareRelevance: entry.score.softwareRelevance.value,
    reason,
  };
}

/**
 * The whole pipeline: fetch -> normalize -> dedupe -> score -> filter -> order.
 *
 * Resilience contract: every (source, query) pair is attempted independently.
 * One dead source degrades the run, it never aborts it - which is exactly what
 * happens the first time an a search provider key expires mid-search.
 */
export async function buildJobQueue(
  input: BuildJobQueueInput,
  deps: BuildJobQueueDeps,
): Promise<JobQueue> {
  const now = deps.now();
  const attempts = planAttempts(deps.sources, input.queries);

  const settled = await Promise.all(
    attempts.map(async ({ source, query, label }): Promise<{ report: SourceReport; jobs: readonly Job[] }> => {
      try {
        const jobs = await source.fetchJobs(query);
        // Drained even on success, and ESPECIALLY on success: a provider that
        // reached twelve of its fourteen boards is `ok`, and the two it lost
        // must still reach the user.
        const degradedTargets = source.takeDegradedTargets?.() ?? [];

        return {
          jobs,
          report: {
            sourceId: source.id,
            query: label,
            status: 'ok',
            fetched: jobs.length,
            ...(degradedTargets.length === 0 ? {} : { degradedTargets }),
          },
        };
      } catch (cause: unknown) {
        const message = errorMessage(cause);
        deps.logger.error(`[${source.id}] query "${label}" failed: ${message}`);
        // Cleared so the next run starts from a clean slate rather than
        // re-reporting a dead board it never re-attempted.
        source.takeDegradedTargets?.();

        return {
          jobs: [],
          report: {
            sourceId: source.id,
            query: label,
            status: 'failed',
            fetched: 0,
            error: message,
          },
        };
      }
    }),
  );

  const collected = settled.flatMap((entry) => entry.jobs);
  const sourceReports = settled.map((entry) => entry.report);

  const { jobs: unique, duplicatesRemoved } = dedupeJobs(collected);
  deps.logger.info(
    `collected ${collected.length} postings, ${unique.length} unique after dedupe (${duplicatesRemoved} duplicates)`,
  );

  const scored = scoreJobs(unique, deps.scoringConfig, now);

  /*
   * TWO HARD FILTERS, IN ORDER. NO THIRD ONE.
   *
   * The candidate's instruction was explicit: "forget the ratings. I want the
   * offers, I'll decide myself if they interest me. Don't filter by number -
   * but they must be tech offers and for juniors."
   *
   * Filter A - software relevance. A DOMAIN gate, not a stack filter. React,
   * Microsoft and backend postings all stay; a dentist does not. Stack
   * preference still only ranks and still never excludes.
   *
   * Filter B - junior eligibility. Deliberately permissive: it removes a
   * posting only on an explicit disqualifying signal, and treats silence as
   * inclusion. See `domain/junior-eligibility.ts` for why that asymmetry is the
   * whole design.
   *
   * What is NOT here, and must not come back: any score threshold, any top-N
   * cut, any "only show the good ones". The score is computed above and carried
   * to the output because the outcome analysis will need it - it decides
   * nothing.
   *
   * The excluded set is carried out in full, tagged with the filter that fired.
   * Silently dropping postings would make the filters impossible to trust the
   * first time one of them got something wrong.
   */
  const excluded: ExcludedEntry[] = [];
  const relevant: ScoredJob[] = [];
  const eligible: ScoredJob[] = [];

  for (const entry of scored) {
    if (!entry.score.softwareRelevance.isSoftware) {
      excluded.push(
        excludedEntry(entry, 'software_relevance', entry.score.softwareRelevance.reason),
      );
      continue;
    }
    relevant.push(entry);

    // Filter B is the unified hard eligibility filter: locality, experience and
    // seniority, with one stable exclusion code per rule.
    const verdict = judgeHardEligibility(
      entry.job,
      deps.juniorFilterConfig,
      deps.scoringConfig.location,
    );
    if (!verdict.eligible && verdict.code !== null) {
      excluded.push(excludedEntry(entry, verdict.code, verdict.reason));
      continue;
    }
    eligible.push(entry);
  }

  const notSoftware = excluded.filter((entry) => entry.excludedBy === 'software_relevance').length;
  const notJunior = excluded.length - notSoftware;
  const byCode = (code: ExcludedEntry['excludedBy']): number =>
    excluded.filter((entry) => entry.excludedBy === code).length;

  if (notSoftware > 0) {
    deps.logger.info(
      `${notSoftware} posting(s) excluded as not software jobs; ${relevant.length} remain`,
    );
  }
  if (notJunior > 0) {
    deps.logger.info(
      `${notJunior} posting(s) excluded by the hard eligibility filter ` +
        `(${byCode('location_incompatible')} location, ${byCode('experience_over_limit')} experience, ` +
        `${byCode('seniority_excluded')} seniority); ${eligible.length} remain`,
    );
  }

  /*
   * THE THIRD REMOVAL, and the only one that is not about the posting's
   * content.
   *
   * The two filters above ask "is this the kind of job he asked for?". This
   * asks "is this job still there?", and it is deliberately last: it runs over
   * the survivors only, so nobody's server is asked about a posting that was
   * never going to be shown.
   *
   * Its rule lives in `domain/link-liveness.ts` and is far narrower than it
   * looks like it should be: ONLY 404 and 410. 403, 429, 3xx, 5xx, timeouts,
   * connection resets and DNS failures all keep the posting, because none of
   * them is evidence that a vacancy closed - they are evidence that a server
   * was unfriendly, or that our network had a bad second.
   *
   * The asymmetry is not squeamishness. A dead link that survives costs the
   * candidate five seconds and announces itself. A live vacancy deleted here is
   * invisible: it does not appear, it does not warn, and there is no artifact
   * anywhere that would tell him it was ever found. Two real CaixaBank Tech
   * junior roles sat behind an ECONNRESET while this was written.
   */
  const liveness = await checkLiveness(eligible, deps);
  const livenessByUrl = new Map<string, LivenessRecord>();
  const live: ScoredJob[] = [];
  let aliveCount = 0;
  let unverifiedCount = 0;

  for (const entry of eligible) {
    const record = liveness.records.get(entry.job.url) ?? null;
    if (record === null) {
      // Never checked. Kept, and carries no claim either way.
      live.push(entry);
      continue;
    }

    livenessByUrl.set(entry.job.url, record);

    if (isProvablyGone(record)) {
      excluded.push(excludedEntry(entry, 'dead_link', describeLivenessRemoval(record)));
      continue;
    }

    if (record.verdict === 'alive') {
      aliveCount += 1;
    } else {
      unverifiedCount += 1;
    }
    live.push(entry);
  }

  const removed = eligible.length - live.length;
  if (removed > 0) {
    /*
     * Said out loud, always. A deletion the user is not told about is
     * indistinguishable from a bug, and this is the one place in the pipeline
     * that removes something the candidate had already qualified for.
     */
    deps.logger.warn(
      `${removed} posting(s) removed as provably gone (HTTP 404/410); ` +
        `${live.length} remain. They are listed in the excluded table, never silently dropped.`,
    );
  }

  const stats = deps.linkChecker?.takeStats?.() ?? { requests: 0, fromCache: 0 };
  const livenessSummary: LivenessSummary =
    liveness.status === 'off'
      ? LIVENESS_OFF
      : {
          status: liveness.status,
          checked: livenessByUrl.size,
          alive: aliveCount,
          gone: removed,
          unverified: unverifiedCount,
          removed,
          requests: stats.requests,
          fromCache: stats.fromCache,
          ...(liveness.error === undefined ? {} : { error: liveness.error }),
        };

  // Newest first. The only narrowing left is the opt-in limit, which nothing in
  // the product path sets.
  const ordered = orderByRecency(live);
  const surfaced = input.limit === undefined ? ordered : ordered.slice(0, input.limit);

  const applicationIndex = indexApplicationsByJobId(deps.applications ?? []);

  return {
    generatedAt: now.toISOString(),
    candidate: input.candidateName ?? 'unknown',
    totalFetched: collected.length,
    totalUnique: unique.length,
    totalRelevant: relevant.length,
    totalJuniorEligible: eligible.length,
    duplicatesRemoved,
    sourceReports,
    excluded,
    liveness: livenessSummary,
    jobs: surfaced.map((entry, index) => ({
      rank: index + 1,
      id: entry.job.id,
      score: entry.score.total,
      cvVariant: entry.score.cvVariant,
      requirements: extractRequirements(entry.job, deps.scoringConfig),
      ...statusFieldsFor(entry.job.id, applicationIndex),
      title: entry.job.title,
      company: entry.job.company,
      location: entry.job.location,
      url: entry.job.url,
      postedAt: entry.job.postedAt.toISOString(),
      salaryMin: entry.job.salaryMin,
      salaryMax: entry.job.salaryMax,
      contractType: entry.job.contractType,
      sources: entry.job.sources,
      breakdown: entry.score.breakdown,
      liveness: livenessByUrl.get(entry.job.url) ?? null,
    })),
  };
}
