import type { JobQueue } from '../ports/queue-writer.js';
import type { FetchRunSummary } from '../ports/run-state-store.js';
import type { PersistQueueResult } from './persist-queue.js';

/**
 * What a run found, as numbers.
 *
 * Every figure is read off the queue the pipeline already produced and the
 * decision `persistQueue` already made. Nothing is recomputed from the raw
 * postings and nothing is invented - the CLI prints these same values through
 * `render-table.ts`, and a second summary that could disagree with the first
 * would be worse than no summary at all.
 *
 * Structured rather than a formatted sentence, so the Spanish UI can render it
 * without this package knowing a word of Spanish.
 */

/** `persistQueue` uses -1 to mean "the old file was unreadable, count unknown". */
const UNKNOWN_JOB_COUNT = -1;

export function summarizeRun(
  queue: JobQueue,
  persisted: PersistQueueResult,
): FetchRunSummary {
  const excludedNotSoftware = queue.excluded.filter(
    (entry) => entry.excludedBy === 'software_relevance',
  ).length;
  const excludedNotJunior = queue.excluded.filter(
    (entry) => entry.excludedBy === 'junior_eligibility',
  ).length;
  const removedAsGone = queue.excluded.filter((entry) => entry.excludedBy === 'dead_link').length;

  /*
   * `totalJuniorEligible` is measured BEFORE the dead-link pass, so reporting
   * it raw would claim offers exist that the human cannot see. The CLI's run
   * summary subtracts them for exactly this reason; doing anything different
   * here is how the two reports start disagreeing.
   */
  const offersAvailable = queue.totalJuniorEligible - removedAsGone;

  const failedSources = queue.sourceReports
    .filter((report) => report.status === 'failed')
    .map((report) => ({
      sourceId: report.sourceId,
      query: report.query,
      error: report.error ?? 'unknown error',
    }));

  const base = {
    totalFetched: queue.totalFetched,
    totalUnique: queue.totalUnique,
    duplicatesRemoved: queue.duplicatesRemoved,
    excludedNotSoftware,
    excludedNotJunior,
    removedAsGone,
    offersAvailable,
    failedSources,
  };

  if (persisted.status === 'refused') {
    return {
      ...base,
      outcome: 'refused',
      // The refusal is not a warning; it gets its own field so the UI cannot
      // render "your queue was protected" as one bullet among several.
      warnings: [],
      refusalReason: persisted.reason,
      preservedJobCount:
        persisted.preservedJobCount === UNKNOWN_JOB_COUNT ? null : persisted.preservedJobCount,
    };
  }

  return {
    ...base,
    outcome: 'written',
    warnings: persisted.warnings,
    refusalReason: null,
    preservedJobCount: null,
  };
}
