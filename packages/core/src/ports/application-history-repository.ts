import type { ApplicationChange } from '../domain/application-history.js';

/**
 * Driven port for the append-only change history of applications.
 *
 * There is deliberately no update and no delete: a history that can be edited
 * is not a history. Undoing a change appends a new entry instead.
 */
export interface ApplicationHistoryRepository {
  /** Adds one entry. Refuses an id that already exists. */
  append(entry: ApplicationChange): Promise<void>;

  /** Entries of one application, newest first. */
  listFor(jobId: string): Promise<readonly ApplicationChange[]>;

  find(id: string): Promise<ApplicationChange | null>;
}
