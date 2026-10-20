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
  invalidDismissalReason: 'That is not a valid dismissal reason.',
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

  /* Manual edit of an application ---------------------------------- */
  invalidInput: 'The submitted form is not valid.',
  applicationEdited: 'Application updated.',
  applicationUnchanged: 'There were no changes to save.',
  applicationNotFound: 'That application does not exist.',
  invalidDate: 'One of the dates is not valid.',
  invalidCvVariant: 'That CV is not valid.',
  blankCompany: 'The company cannot be empty.',
  blankTitle: 'The job title cannot be empty.',
  invalidUrl: 'The link must start with http:// or https://.',
  listingIncomplete: 'To add offer details, company and title are both required.',
  tooLong: 'One of the fields is too long.',
  applicationEditedNotLogged: 'Application updated, but the change history entry could not be saved.',
  unknownCvModel: 'That CV model is not registered.',
  notACvModel: 'That model is not a CV.',
  unknownLetterModel: 'That cover letter model is not registered.',
  notALetterModel: 'That model is not a cover letter.',
  modelRegistryUnavailable: 'The model registry could not be read.',

  /* Change history and undo ----------------------------------------- */
  changeReverted: 'Change undone.',
  changeRevertedNotLogged: 'Change undone, but the undo could not be added to the change history.',
  changeNotFound: 'That change does not exist.',
  changeAlreadyReverted: 'That change was already undone.',
  changeNotLatest: 'Only the most recent change that is still in effect can be undone.',
  changeConflict:
    'The application was changed outside the history, so this change cannot be undone safely.',
  historyUnavailable: 'The change history is not available.',

  /* Fetch ------------------------------------------------------------ */
  fetchStarted: 'Fetch run started.',
  fetchAlreadyRunning: 'A fetch run is already in progress.',
} as const;

export type ActionMessage = (typeof ACTION_MESSAGES)[keyof typeof ACTION_MESSAGES];
