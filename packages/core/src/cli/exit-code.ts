import type { PersistQueueResult } from '../app/persist-queue.js';

/**
 * Process exit codes, kept pure so they can be asserted without spawning a shell.
 *
 * Three distinguishable outcomes, because they have three different remedies:
 * do nothing, retry later, and "your data is fine, the API is not".
 */

/** The run produced a queue and it was persisted. */
export const EXIT_OK = 0;

/** The run was persisted, but every source query failed. Nothing useful arrived. */
export const EXIT_RUN_FAILED = 1;

/**
 * The queue was NOT written, on purpose, to protect existing data.
 *
 * Distinct from `EXIT_RUN_FAILED` because the correct reaction differs: here the
 * previous queue is still intact and still worth reading.
 */
export const EXIT_WRITE_REFUSED = 2;

export function exitCodeFor(result: PersistQueueResult): number {
  if (result.status === 'refused') {
    return EXIT_WRITE_REFUSED;
  }

  // A degraded run that still produced a usable queue is a success for anything
  // reading the exit code; the incompleteness is reported in the run summary,
  // where a human will actually see it.
  return result.health === 'sources_failed' ? EXIT_RUN_FAILED : EXIT_OK;
}
