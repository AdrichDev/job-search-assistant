import {
  isDismissalReason,
  type Dismissal,
  type DismissalReason,
} from '../domain/dismissal.js';
import type { ApplicationRepository } from '../ports/application-repository.js';
import type { DismissalRepository } from '../ports/dismissal-repository.js';
import type { JobQueue } from '../ports/queue-writer.js';

/**
 * "The human is not interested in this one."
 *
 * Same security-relevant design as `recordApplication`: the caller supplies ONLY
 * a job id. The title and employer snapshot are read from the server-side queue,
 * never taken from the request, so a crafted call cannot file a dismissal
 * against a posting that is not on the list or label it with text of its own
 * choosing.
 *
 * ## The applied-and-dismissed conflict, decided deliberately
 *
 * Dismissing an offer the human already applied to is REFUSED.
 *
 * An applied offer is not "a vacancy I am not interested in"; it is a commitment
 * with a pending outcome. The outcome form and the whole stats panel exist to
 * follow it up, and `application-status.ts` already states the rule this
 * codebase settled on: "an already-applied job is MARKED, never dropped. Hiding
 * it would destroy the audit trail the candidate needs." Dismissing one is
 * precisely dropping it - the row would move into a collapsed section where its
 * outcome form is out of reach, while `computeApplicationStats` kept counting an
 * application the human could no longer follow up. So this refuses rather than
 * inventing a second policy that contradicts the first.
 *
 * The human is not left without a move: "this one went nowhere" is already
 * expressible, and more truthfully, as the `rejected` or `no_reply` outcome.
 *
 * The conflict resolves the OTHER way round when the order is reversed - see
 * `recordApplication`, where applying restores a dismissal, because applying is
 * an unambiguous statement of interest that supersedes an earlier "no".
 */

export interface DismissJobInput {
  readonly jobId: string;
  /** Unknown at the boundary; validated here before anything is written. */
  readonly reason?: unknown;
}

export interface DismissJobDeps {
  readonly dismissals: DismissalRepository;
  /** Consulted only to detect the conflict above. Never written here. */
  readonly applications: ApplicationRepository;
  /** The queue currently being shown. Null when no run has been produced yet. */
  readonly loadQueue: () => Promise<JobQueue | null>;
  readonly now: () => Date;
}

export type DismissJobResult =
  | { readonly status: 'dismissed'; readonly dismissal: Dismissal; readonly created: boolean }
  | { readonly status: 'already_applied'; readonly jobId: string }
  | { readonly status: 'unknown_job'; readonly jobId: string }
  | { readonly status: 'queue_unavailable' }
  | { readonly status: 'invalid_reason' }
  /**
   * The application log could not be read, so the conflict above cannot be
   * ruled out.
   *
   * Refusing here rather than dismissing anyway is the same asymmetry the rest
   * of this codebase applies: hiding a posting the human may have applied to is
   * a silent, hard-to-notice loss, while a refusal is one visible message and a
   * retry.
   */
  | { readonly status: 'conflict_unknown'; readonly reason: string };

export async function dismissJob(
  input: DismissJobInput,
  deps: DismissJobDeps,
): Promise<DismissJobResult> {
  const jobId = input.jobId.trim();
  if (jobId.length === 0) {
    return { status: 'unknown_job', jobId };
  }

  let reason: DismissalReason | undefined;
  if (input.reason !== undefined && input.reason !== '') {
    if (!isDismissalReason(input.reason)) {
      return { status: 'invalid_reason' };
    }
    reason = input.reason;
  }

  const queue = await deps.loadQueue();
  if (queue === null) {
    return { status: 'queue_unavailable' };
  }

  const entry = queue.jobs.find((job) => job.id === jobId);
  if (entry === undefined) {
    return { status: 'unknown_job', jobId };
  }

  let applied: boolean;
  try {
    applied = (await deps.applications.findByJobId(jobId)) !== null;
  } catch (cause: unknown) {
    return {
      status: 'conflict_unknown',
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (applied) {
    return { status: 'already_applied', jobId };
  }

  // Idempotency is delegated to the repository, which is the only layer that can
  // enforce it against two clicks racing each other.
  const { dismissal, created } = await deps.dismissals.dismiss({
    jobId: entry.id,
    dismissedAt: deps.now(),
    title: entry.title,
    company: entry.company,
    ...(reason === undefined ? {} : { reason }),
  });

  return { status: 'dismissed', dismissal, created };
}

export interface RestoreJobInput {
  readonly jobId: string;
}

export interface RestoreJobDeps {
  readonly dismissals: DismissalRepository;
}

export type RestoreJobResult =
  | { readonly status: 'restored' }
  | { readonly status: 'not_dismissed'; readonly jobId: string };

/**
 * Puts a dismissed offer back on the list.
 *
 * Consults NO queue, on purpose. See the note on `DismissalRepository.restore`:
 * a posting that has left the queue is the one a human is most likely to want
 * back, and refusing it would leave an un-restorable row in the review list.
 */
export async function restoreJob(
  input: RestoreJobInput,
  deps: RestoreJobDeps,
): Promise<RestoreJobResult> {
  const jobId = input.jobId.trim();
  if (jobId.length === 0) {
    return { status: 'not_dismissed', jobId };
  }

  const removed = await deps.dismissals.restore(jobId);
  return removed ? { status: 'restored' } : { status: 'not_dismissed', jobId };
}
