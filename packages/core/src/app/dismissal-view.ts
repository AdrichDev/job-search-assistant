import { indexDismissalsByJobId, type Dismissal } from '../domain/dismissal.js';
import type { JobQueue, QueueEntry } from '../ports/queue-writer.js';

/**
 * Projects the dismissal log onto the queue, at READ time.
 *
 * ## The load-bearing decision of this feature
 *
 * The dismissal store is the source of truth and the queue file is left ALONE.
 * The pipeline neither knows nor cares that dismissals exist; it keeps writing
 * everything it found, and this projection decides what a human sees.
 *
 * Three things fall out of that, and all three are the reason for it:
 *
 * 1. NOTHING IS DESTROYED. Filtering dismissed postings out of the queue at
 *    write time would be a hard delete of a real vacancy - the exact failure
 *    this codebase refuses everywhere else it comes up (see `persist-queue.ts`,
 *    `link-liveness.ts`, `application-status.ts`). An extra row in a JSON file
 *    costs nothing; a vacancy that quietly stops existing is unrecoverable.
 *
 * 2. DISMISSALS SURVIVE A RE-RUN FOR FREE. Ids come from `jobFingerprint`,
 *    which is a pure function of company, title and location, so tomorrow's
 *    queue carries the same id for the same vacancy and it is hidden again -
 *    with no pipeline change, no migration and no coupling.
 *
 * 3. RESTORE IS INSTANT. The posting never left, so putting it back is one
 *    store write and a re-render. Had the pipeline filtered instead, restoring
 *    would require a fresh run to fetch the posting again - minutes of waiting,
 *    and a real chance the source has dropped it in the meantime.
 *
 * The same shape as `application-status.ts`, for the same reason: the log always
 * wins over whatever a queue file snapshot says.
 */

/**
 * One row of the "dismissed" review list.
 *
 * A view model rather than the `QueueEntry` itself, because the list must be
 * able to show a dismissal whose posting is no longer in the queue at all - in
 * which case there is no entry to hand over and only the snapshot survives.
 */
export interface DismissedRow {
  readonly jobId: string;
  readonly title: string;
  readonly company: string;
  /** Null when the posting is no longer in the current queue. */
  readonly location: string | null;
  /** Null when the posting is no longer in the current queue. */
  readonly url: string | null;
  readonly dismissedAt: string;
  /** False when this dismissal outlived the posting it refers to. */
  readonly inQueue: boolean;
}

export interface DismissalPartition {
  /** What the human should see. */
  readonly visible: readonly QueueEntry[];
  /** What they said no to, newest decision first. */
  readonly dismissed: readonly DismissedRow[];
}

/** Newest decision first: the most recent "no" is the one most likely regretted. */
function byNewestDismissalFirst(a: DismissedRow, b: DismissedRow): number {
  const byDate = new Date(b.dismissedAt).getTime() - new Date(a.dismissedAt).getTime();
  return byDate !== 0 ? byDate : a.jobId.localeCompare(b.jobId);
}

export function partitionByDismissal(
  queue: JobQueue,
  dismissals: readonly Dismissal[],
): DismissalPartition {
  const index = indexDismissalsByJobId(dismissals);

  const visible = queue.jobs.filter((entry) => !index.has(entry.id));

  // Built from the DISMISSALS rather than from the queue, so a dismissal whose
  // posting has vanished still gets a row. The queue is consulted only to
  // enrich it.
  const byJobId = new Map(queue.jobs.map((entry) => [entry.id, entry]));

  const dismissed = dismissals.map((dismissal): DismissedRow => {
    const entry = byJobId.get(dismissal.jobId);
    return {
      jobId: dismissal.jobId,
      // The live posting wins when it is present: the snapshot is a fallback,
      // not a second copy of the truth.
      title: entry?.title ?? dismissal.title,
      company: entry?.company ?? dismissal.company,
      location: entry?.location ?? null,
      url: entry?.url ?? null,
      dismissedAt: dismissal.dismissedAt.toISOString(),
      inQueue: entry !== undefined,
    };
  });

  return { visible, dismissed: [...dismissed].sort(byNewestDismissalFirst) };
}
