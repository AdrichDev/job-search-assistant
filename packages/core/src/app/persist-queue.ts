import type { Logger } from '../ports/logger.js';
import type { QueueReader } from '../ports/queue-reader.js';
import type { JobQueue, QueueWriter, SourceReport } from '../ports/queue-writer.js';

/**
 * The guard between "a run finished" and "the queue file is replaced".
 *
 * The application log already refuses to overwrite itself when it cannot prove
 * the file on disk is safe to replace (see `json-application-repository`): real
 * history is worth more than a clean-looking write. That asymmetry was never
 * applied to the queue, and it cost 25 real postings the first time every
 * Adzuna query answered HTTP 429 - the run collected nothing, reported the
 * degradation correctly, and then wrote the emptiness straight over the data.
 *
 * The rule, in one sentence:
 *
 *   An empty result may only replace a non-empty queue when EVERY source query
 *   succeeded.
 *
 * "Nothing came back" is a fact worth recording only when every source was
 * actually asked and every source actually answered. The moment one query
 * fails, an empty result stops being evidence about the job market and becomes
 * evidence about the network - and overwriting real postings with a statement
 * about the network is the trade this module exists to refuse.
 *
 * Policy lives here, in the app layer, not in the writer adapter: a writer that
 * silently declines to write would be lying about its own contract, and the CLI
 * needs to render the decision rather than discover it through an exception.
 */

/** How much of the run actually worked. */
export type RunHealth =
  /** Every attempted query succeeded. An empty result here is a real answer. */
  | 'healthy'
  /** Some queries failed, some succeeded. The result is incomplete by an unknown amount. */
  | 'degraded'
  /** Every attempted query failed. The run learned nothing at all. */
  | 'sources_failed';

/**
 * What is currently on disk, as three distinguishable facts.
 *
 * `unreadable` is deliberately NOT folded into `absent`. A file we cannot parse
 * is far more likely to hold data than to hold nothing, and the whole point of
 * this module is to stop guessing in the direction that destroys things.
 */
export type ExistingQueueState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly jobCount: number }
  | { readonly kind: 'unreadable'; readonly reason: string };

export interface QueueWriteContext {
  readonly sourceReports: readonly SourceReport[];
  readonly incomingJobCount: number;
  readonly existing: ExistingQueueState;
}

export type QueueWriteDecision =
  | {
      readonly action: 'write';
      readonly health: RunHealth;
      /** Never empty for a degraded run: the user must see what was lost. */
      readonly warnings: readonly string[];
    }
  | {
      readonly action: 'refuse';
      readonly health: RunHealth;
      readonly reason: string;
    };

export type PersistQueueResult =
  | {
      readonly status: 'written';
      readonly path: string;
      readonly health: RunHealth;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'refused';
      readonly health: RunHealth;
      readonly reason: string;
      /** How many postings the refusal kept alive. -1 when the file was unreadable. */
      readonly preservedJobCount: number;
    };

export interface PersistQueueDeps {
  readonly reader: QueueReader;
  readonly writer: QueueWriter;
  readonly logger: Logger;
}

/** Unreadable files have an unknown job count; -1 marks "we could not tell". */
const UNKNOWN_JOB_COUNT = -1;

export function classifyRunHealth(reports: readonly SourceReport[]): RunHealth {
  // No attempt is not a failure. A run with no sources configured has nothing
  // to be degraded about.
  if (reports.length === 0) {
    return 'healthy';
  }

  const failed = reports.filter((report) => report.status === 'failed').length;
  if (failed === 0) {
    return 'healthy';
  }
  return failed === reports.length ? 'sources_failed' : 'degraded';
}

/** True when replacing what is on disk would actually cost the user something. */
function holdsData(existing: ExistingQueueState): boolean {
  switch (existing.kind) {
    case 'absent':
      return false;
    case 'present':
      return existing.jobCount > 0;
    case 'unreadable':
      // Cannot prove it is empty, so assume it is not.
      return true;
  }
}

function describeExisting(existing: ExistingQueueState): string {
  switch (existing.kind) {
    case 'absent':
      return 'no previous queue';
    case 'present':
      return `${existing.jobCount} previously saved posting${existing.jobCount === 1 ? '' : 's'}`;
    case 'unreadable':
      return `an unreadable queue file (${existing.reason})`;
  }
}

/**
 * Counts only. The per-query errors are already printed by the run summary, and
 * repeating seven ENOENT paths inside the refusal turns the one line the user
 * actually needs to read into a wall they will skip.
 */
function failureSummary(reports: readonly SourceReport[]): string {
  const failed = reports.filter((report) => report.status === 'failed').length;
  return `${failed} of ${reports.length} source queries failed`;
}

/** How many boards to name before the note becomes a wall the user skips. */
const MAX_NAMED_BOARDS = 6;

/**
 * The note about individual company boards that did not answer.
 *
 * Kept strictly separate from the degraded-run warning above, because the two
 * facts have different weights and different audiences:
 *
 *   a failed SOURCE QUERY  -> the run is incomplete by an unknown amount, and
 *                             an empty result may not be trusted. Rare, loud,
 *                             and able to refuse a write.
 *   a failed COMPANY BOARD -> a handful of vacancies at ONE employer are
 *                             missing. With ~28 boards this happens most days.
 *
 * Folding the second into the first is what would destroy this module's value:
 * a "Degraded run" line printed every single morning is a line nobody reads on
 * the morning it finally means something.
 */
function boardOutageNote(reports: readonly SourceReport[]): string | null {
  const outages = reports.flatMap((report) =>
    (report.degradedTargets ?? []).map((entry) => `${report.sourceId}/${entry.target}`),
  );

  if (outages.length === 0) {
    return null;
  }

  const named = outages.slice(0, MAX_NAMED_BOARDS).join(', ');
  const rest = outages.length - Math.min(outages.length, MAX_NAMED_BOARDS);
  const tail = rest > 0 ? `, and ${rest} more` : '';

  return (
    `${outages.length} company board${outages.length === 1 ? '' : 's'} did not answer ` +
    `(${named}${tail}). Their openings are missing from this queue; every other source answered normally.`
  );
}

/**
 * Pure decision. No I/O, so every branch below is a unit test rather than a
 * filesystem fixture.
 */
export function decideQueueWrite(context: QueueWriteContext): QueueWriteDecision {
  const health = classifyRunHealth(context.sourceReports);
  const producedNothing = context.incomingJobCount === 0;
  const wouldDestroyData = holdsData(context.existing);

  /*
   * The single guarded case.
   *
   * Note what is NOT guarded, on purpose:
   *
   * - A degraded run that still produced postings is written. Refusing here
   *   would let one permanently flaky query freeze the queue forever, which
   *   trades a small, visible incompleteness for a large, invisible staleness.
   * - A smaller-than-before result is written. Any "refuse if the count dropped
   *   by more than N%" rule is a magic number that would fire on a quiet Monday
   *   and teach the user to ignore it.
   *
   * Both of those are reported as warnings instead. Visible, never silent.
   */
  if (health !== 'healthy' && producedNothing && wouldDestroyData) {
    return {
      action: 'refuse',
      health,
      reason:
        `${failureSummary(context.sourceReports)} and the run produced no postings, so this empty ` +
        `result says nothing about the job market. Kept ${describeExisting(context.existing)} intact.`,
    };
  }

  const warnings: string[] = [];

  if (health === 'degraded') {
    warnings.push(
      `Degraded run: ${failureSummary(context.sourceReports)}. ` +
        'The queue was still written but is incomplete by an unknown amount.',
    );
  }

  if (health === 'sources_failed') {
    warnings.push(
      `${failureSummary(context.sourceReports)}. Wrote an empty queue anyway because there was ` +
        `${describeExisting(context.existing)} to protect.`,
    );
  }

  // A real, trustworthy "the market had nothing today". Worth saying out loud,
  // because it looks identical to a broken run until you read the source reports.
  if (health === 'healthy' && producedNothing) {
    warnings.push(
      'Every source query succeeded and returned no postings. This is a real empty result, ' +
        'not a failure, so it replaced the previous queue.',
    );
  }

  const boardOutages = boardOutageNote(context.sourceReports);
  if (boardOutages !== null) {
    warnings.push(boardOutages);
  }

  return { action: 'write', health, warnings };
}

async function readExisting(deps: PersistQueueDeps): Promise<ExistingQueueState> {
  try {
    const existing = await deps.reader.read();
    return existing === null ? { kind: 'absent' } : { kind: 'present', jobCount: existing.jobs.length };
  } catch (cause: unknown) {
    return {
      kind: 'unreadable',
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Applies the policy and, when it allows it, persists the queue.
 *
 * Returns the decision rather than throwing it: a refusal is an expected,
 * reportable outcome of a bad day at the API, not an exceptional condition.
 */
export async function persistQueue(
  queue: JobQueue,
  deps: PersistQueueDeps,
): Promise<PersistQueueResult> {
  const existing = await readExisting(deps);

  const decision = decideQueueWrite({
    sourceReports: queue.sourceReports,
    incomingJobCount: queue.jobs.length,
    existing,
  });

  if (decision.action === 'refuse') {
    deps.logger.error(`Refusing to overwrite the queue: ${decision.reason}`);
    return {
      status: 'refused',
      health: decision.health,
      reason: decision.reason,
      preservedJobCount: existing.kind === 'present' ? existing.jobCount : UNKNOWN_JOB_COUNT,
    };
  }

  for (const warning of decision.warnings) {
    deps.logger.warn(warning);
  }

  const path = await deps.writer.write(queue);
  return { status: 'written', path, health: decision.health, warnings: decision.warnings };
}
