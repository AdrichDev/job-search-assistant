import type { Application, ApplicationDraft, ApplicationOutcome } from '../domain/application.js';

/**
 * Driven port for the application log.
 *
 * Deliberately narrow so the current JSON-file adapter can be swapped for
 * SQLite later without a single caller changing. That is why idempotency is
 * part of the CONTRACT rather than a convention every caller has to remember:
 * a double-clicked Apply button must never produce two records, and only the
 * store can guarantee that.
 */

export interface RecordResult {
  readonly application: Application;
  /** False when an application for this job already existed. */
  readonly created: boolean;
}

export interface UpdateOutcomeInput {
  readonly jobId: string;
  readonly outcome: ApplicationOutcome;
  readonly at: Date;
  readonly notes?: string;
}

export interface ApplicationRepository {
  /** Every application, newest first. */
  list(): Promise<readonly Application[]>;

  findByJobId(jobId: string): Promise<Application | null>;

  /**
   * Idempotent create. Returns the EXISTING record untouched when the job was
   * already applied to, so a repeated click is a no-op rather than a duplicate.
   */
  record(draft: ApplicationDraft): Promise<RecordResult>;

  /** Returns null when there is nothing to update. */
  updateOutcome(input: UpdateOutcomeInput): Promise<Application | null>;
}
