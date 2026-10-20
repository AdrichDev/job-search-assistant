/**
 * What the daily mail check remembers between runs.
 *
 * Fully serializable: every date is an ISO string or null. `lastError` is a
 * short machine code (for example `auth_expired`), never a raw error message,
 * which could carry English text, a local path or part of a response body.
 *
 * Deliberately NOT the fetch `RunStateStore`: the two features run on different
 * schedules and have different failure meanings.
 *
 * Single-flight locking (`claim`) is not part of this port; it belongs to U2,
 * where the run that needs it is built.
 */
export interface MailRunState {
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastError: string | null;
  /** When the current refresh token was issued (drives the 7-day alert). */
  readonly tokenIssuedAt: string | null;
  /** When Google last refused the token (`invalid_grant`). */
  readonly authFailedAt: string | null;
}

export const EMPTY_MAIL_RUN_STATE: MailRunState = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  tokenIssuedAt: null,
  authFailedAt: null,
};

export interface MailRunStateStore {
  /** A missing file is the empty state. A corrupt file throws and is never overwritten. */
  read(): Promise<MailRunState>;
  /** Replaces the whole state. */
  write(state: MailRunState): Promise<void>;
  /**
   * Read-modify-write as one serialised step inside this process, so two
   * concurrent partial updates cannot lose each other's fields.
   */
  update(change: (current: MailRunState) => MailRunState): Promise<MailRunState>;
}
