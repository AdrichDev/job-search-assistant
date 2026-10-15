import type { Dismissal, DismissalDraft } from '../domain/dismissal.js';

/**
 * Driven port for the dismissal log.
 *
 * Shaped after `ApplicationRepository` on purpose, down to idempotency being
 * part of the CONTRACT rather than a convention callers remember: a
 * double-clicked dismiss button must never produce two rows, and only the store
 * can guarantee that against a race.
 *
 * `restore` is the reason a dismissal is not a delete. Nothing in this codebase
 * hard-deletes a vacancy the pipeline found - a silently lost posting is an
 * invisible, unrecoverable failure, while an extra row costs a scroll.
 */

export interface DismissResult {
  readonly dismissal: Dismissal;
  /** False when this job was already dismissed. */
  readonly created: boolean;
}

export interface DismissalRepository {
  /** Every dismissal, newest first. */
  list(): Promise<readonly Dismissal[]>;

  findByJobId(jobId: string): Promise<Dismissal | null>;

  /**
   * Idempotent create. Returns the EXISTING record untouched when the job was
   * already dismissed, so the original timestamp survives - when the human
   * decided is history and a repeated click must not rewrite it.
   */
  dismiss(draft: DismissalDraft): Promise<DismissResult>;

  /**
   * Un-dismisses a job. True when a dismissal existed and was removed.
   *
   * Deliberately keyed on the id ALONE, with no queue lookup: a posting that
   * has left the queue is exactly the one a human is most likely to want back,
   * and a restore that refused it would leave an un-restorable row forever.
   */
  restore(jobId: string): Promise<boolean>;
}
