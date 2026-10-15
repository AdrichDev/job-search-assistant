import type { Application } from '../domain/application.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { DismissalRepository } from '../ports/dismissal-repository.js';
import type { JobQueue } from '../ports/queue-writer.js';

/**
 * "The human clicked Apply."
 *
 * Security-relevant design: the caller supplies ONLY a job id. The CV variant
 * and the score are looked up in the server-side queue, never taken from the
 * request. A browser must not be able to claim it applied to a job with a
 * score of its own choosing - that would poison the very dataset this layer
 * exists to produce.
 */

export interface RecordApplicationInput {
  readonly jobId: string;
}

export interface RecordApplicationDeps {
  readonly repository: ApplicationRepository;
  /** The queue currently being shown. Null when no run has been produced yet. */
  readonly loadQueue: () => Promise<JobQueue | null>;
  readonly now: () => Date;
  /**
   * The dismissal log, when the caller has one.
   *
   * OPTIONAL so the CLI - which has no dismissal store wired in - keeps working
   * untouched, and so a caller that forgets it degrades into today's behaviour
   * rather than into a crash.
   *
   * See the note on the restore below for why applying touches this at all.
   */
  readonly dismissals?: DismissalRepository;
}

export type RecordApplicationResult =
  | {
      readonly status: 'recorded';
      readonly application: Application;
      readonly created: boolean;
      /** True when this application un-dismissed an offer the human had rejected. */
      readonly restoredFromDismissal: boolean;
    }
  | { readonly status: 'unknown_job'; readonly jobId: string }
  | { readonly status: 'queue_unavailable' };

export async function recordApplication(
  input: RecordApplicationInput,
  deps: RecordApplicationDeps,
): Promise<RecordApplicationResult> {
  const jobId = input.jobId.trim();
  if (jobId.length === 0) {
    return { status: 'unknown_job', jobId };
  }

  const queue = await deps.loadQueue();
  if (queue === null) {
    return { status: 'queue_unavailable' };
  }

  const entry = queue.jobs.find((job) => job.id === jobId);
  if (entry === undefined) {
    return { status: 'unknown_job', jobId };
  }

  // Idempotency is delegated to the repository, which is the only layer that
  // can enforce it against two clicks racing each other.
  const { application, created } = await deps.repository.record({
    jobId: entry.id,
    appliedAt: deps.now(),
    cvVariant: entry.cvVariant,
    scoreAtApply: entry.score,
  });

  /*
   * APPLYING SUPERSEDES A DISMISSAL.
   *
   * The mirror image of the rule in `dismiss-job.ts`, and it resolves the other
   * way on purpose. Dismissing an APPLIED offer is refused, because it would
   * hide a commitment the human still has to follow up. Applying to a DISMISSED
   * offer is allowed and quietly un-dismisses it, because a click on Aplicar is
   * an unambiguous statement of interest that overrides an earlier "no" - and
   * because leaving the offer in both states would file it in the collapsed
   * section, out of reach of its own outcome form, while the stats panel went on
   * counting an application the human could no longer follow.
   *
   * A failing restore does not fail the application: the record on disk is the
   * thing that matters, and a stray dismissal costs one visible row in the
   * review list rather than a lost application.
   */
  const restoredFromDismissal =
    deps.dismissals === undefined
      ? false
      : await deps.dismissals.restore(entry.id).catch(() => false);

  return { status: 'recorded', application, created, restoredFromDismissal };
}
