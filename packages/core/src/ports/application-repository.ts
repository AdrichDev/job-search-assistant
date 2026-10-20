import type {
  Application,
  ApplicationDraft,
  ApplicationOutcome,
  ApplicationPatch,
} from '../domain/application.js';

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

export interface UpdateApplicationInput {
  readonly jobId: string;
  readonly patch: ApplicationPatch;
  /** Stamped on `outcomeUpdatedAt` when the outcome changes and the patch has no date. */
  readonly now: Date;
}

/** Both sides are required so a change history can record the edit without a refactor. */
export interface UpdateResult {
  readonly before: Application;
  readonly after: Application;
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

  /**
   * Manual edit of any editable field (see `ApplicationPatch`). Returns null for
   * an unknown job. A patch that breaks a domain rule throws
   * `ApplicationPatchError`; a refused or no-op edit never touches the stored file.
   */
  update(input: UpdateApplicationInput): Promise<UpdateResult | null>;
}
