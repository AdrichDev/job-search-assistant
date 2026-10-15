/**
 * Stable identifiers for every outcome a server action can report.
 *
 * These are English sentences rather than opaque codes for one reason: they are
 * also the value already carried by `ActionOutcome.message`, which the server
 * use cases return and their tests assert. Extracting them here lets the copy
 * module translate by lookup instead of by string-matching a literal duplicated
 * in two files, without changing the shape of anything the server returns.
 *
 * This module must stay free of `server-only` and of any `@job-queue/core`
 * runtime import: `copy/es.ts` reads it, and `copy/es.ts` is loaded by client
 * components.
 */
export const ACTION_MESSAGES = {
  missingJobId: 'Missing job id.',
  recorded: 'Application recorded.',
  alreadyRecorded: 'Already recorded earlier.',
  unknownJob: 'That job is not in the current queue.',
  queueUnavailable: 'No queue available. Run the pipeline first.',
  missingOutcome: 'Missing job id or outcome.',
  outcomeUpdated: 'Outcome updated.',
  notApplied: 'Apply to this job before setting an outcome.',
  invalidOutcome: 'That is not a valid outcome.',

  /* Dismissal -------------------------------------------------------- */
  dismissed: 'Offer dismissed.',
  alreadyDismissed: 'Already dismissed earlier.',
  /**
   * The applied-and-dismissed conflict, as the human reads it.
   *
   * It names the move that DOES work. A refusal that only says no teaches
   * people the button is broken; this one says the offer is already part of
   * their history and points at the outcome form, which records "this went
   * nowhere" truthfully instead of erasing it.
   */
  cannotDismissApplied:
    'You already applied to this offer. Set its outcome instead of dismissing it.',
  /** The application log could not be read, so the conflict cannot be ruled out. */
  dismissConflictUnknown:
    'Could not read the application log, so nothing was dismissed. Try again.',
  restored: 'Offer restored.',
  notDismissed: 'That offer was not dismissed.',

  /* Fetch ------------------------------------------------------------ */
  fetchStarted: 'Fetch run started.',
  fetchAlreadyRunning: 'A fetch run is already in progress.',
} as const;

export type ActionMessage = (typeof ACTION_MESSAGES)[keyof typeof ACTION_MESSAGES];
