/**
 * IS THIS POSTING STILL THERE? - the rule for deleting somebody's opportunity.
 *
 * ## The asymmetry, which is the entire design
 *
 * This module is allowed to remove a vacancy from the candidate's list. That
 * makes it the most destructive rule in the pipeline, and it is written around
 * one measured fact about the cost of being wrong in each direction:
 *
 *   a dead link that survives  -> the candidate clicks it, sees a 404, and
 *                                 loses five seconds.
 *   a live vacancy deleted     -> the candidate never learns it existed. There
 *                                 is no 404 to notice, no row to be suspicious
 *                                 of, and no way back.
 *
 * The second is unbounded and invisible. So the rule is not "is this link
 * healthy?" - it is "has this posting PROVED it is gone?", and the burden of
 * proof sits entirely on the deletion.
 *
 * This is the same asymmetry `junior-eligibility.ts` already encodes for the
 * junior filter (silence means include) and that `persist-queue.ts` encodes for
 * the degraded write (an unproven emptiness may not overwrite real data). It is
 * the house rule of this codebase, applied to a third place.
 *
 * ## The rule
 *
 *   404 and 410 remove the posting. NOTHING ELSE DOES.
 *
 * Everything else is kept, and the reasons are worth naming because each one
 * was a real temptation:
 *
 *   403 / 401  bot protection or a login wall. A statement about US, not about
 *              the vacancy. Career sites do this constantly.
 *   429        we asked too often. Our fault. Deleting a job because we were
 *              impolite to its server would be absurd.
 *   3xx        a redirect is a WORKING link. Two live CaixaBank Tech junior
 *              roles sat behind one while this module was being written.
 *   5xx        the employer's server is broken today. Vacancies outlive outages.
 *   timeout, connection reset, DNS failure, TLS error, any network error
 *              facts about a bad minute on somebody's network. `caixabanktech.es`
 *              answers Node's fetch with ECONNRESET while serving browsers fine.
 *   unchecked  the absence of evidence. The most obviously wrong thing to
 *              delete on, and the easiest to do by accident with a
 *              `!== 'alive'` test.
 *
 * ## What this module is not
 *
 * Pure. No I/O, no requests, no clock. It judges a result somebody else
 * obtained, so every branch above is a unit test rather than a network fixture,
 * and the rule can be read in one screen without a mock in sight. Enforced by
 * `tests/architecture/purity.test.ts`.
 */

/**
 * Where a posting stands, as three states the UI and the CLI can both act on.
 *
 * `unverified` is deliberately ONE state covering "the server was rude", "the
 * network failed" and "we got an answer we cannot interpret". Splitting it
 * would invite a caller to treat some of its members as closer to dead, and
 * there is no such thing as closer to dead: either a posting proved it is gone
 * or it did not.
 */
export type LivenessVerdict =
  /** Answered a 2xx. The address serves something. */
  | 'alive'
  /** Answered 404 or 410. The ONLY state that may delete a posting. */
  | 'gone'
  /** Anything else at all, including never having been checked. Always kept. */
  | 'unverified';

/** The raw outcome of one check, before it is judged. */
export interface LinkCheckResult {
  /** The HTTP status, or `null` when no response was obtained. */
  readonly status: number | null;
  /** A network/transport failure message, or `null` when the request completed. */
  readonly error: string | null;
}

/** A judged check, as it travels on a `QueueEntry` and into the written queue. */
export interface LivenessRecord extends LinkCheckResult {
  readonly verdict: LivenessVerdict;
  /** ISO timestamp of when the check was made - which may be a cached earlier run. */
  readonly checkedAt: string;
}

/**
 * The whole deletion authority of this pipeline, as a two-element set.
 *
 * A set rather than an `||` chain so the test can pin its exact contents: this
 * is the one list in the codebase where an accidentally added member costs the
 * user real opportunities.
 *
 * 404 - the address serves nothing. 410 - the server went out of its way to say
 * the resource is permanently gone, which is as explicit as HTTP gets.
 */
export const GONE_STATUS_CODES: ReadonlySet<number> = new Set([404, 410]);

/**
 * Judges one check.
 *
 * Note the ORDER. `error` is examined before `status`, so a request that both
 * produced a status and then failed is `unverified` rather than trusted. A
 * checker should not report both, but if one ever does, the tie has to break
 * towards keeping the posting - that is the only direction whose worst case is
 * a wasted click.
 */
export function judgeLiveness(check: LinkCheckResult): LivenessVerdict {
  if (check.error !== null) {
    return 'unverified';
  }
  if (check.status === null) {
    return 'unverified';
  }
  if (GONE_STATUS_CODES.has(check.status)) {
    return 'gone';
  }
  if (check.status >= 200 && check.status < 300) {
    return 'alive';
  }
  /*
   * 3xx, 401, 403, 429, 5xx and every unknown code land here.
   *
   * Note what this branch is NOT: `status >= 400 ? 'gone' : 'alive'`. That one
   * line, which is what "check if the link works" usually means, would have
   * deleted both live CaixaBank Tech roles the day it shipped.
   */
  return 'unverified';
}

/**
 * The only question a caller may ask before deleting something.
 *
 * Takes the record rather than the verdict, and accepts `null`/`undefined`
 * explicitly, so "we never checked this" cannot be accidentally spelled as a
 * falsy verdict at a call site. `!isAlive(x)` is the shape of the bug this
 * function exists to make unwritable.
 */
export function isProvablyGone(record: LivenessRecord | null | undefined): boolean {
  return record !== null && record !== undefined && record.verdict === 'gone';
}

/**
 * The sentence written into the excluded table beside a removed posting.
 *
 * Throws when handed a record the rule would not remove. A caller that has
 * decided to delete something this module never condemned has a bug, and the
 * cheapest place to find it is here rather than in the audit trail the
 * candidate reads.
 */
export function describeLivenessRemoval(record: LivenessRecord): string {
  if (!isProvablyGone(record)) {
    throw new Error(
      `cannot describe a liveness removal for verdict "${record.verdict}" ` +
        `(status ${String(record.status)}): only 404 and 410 remove a posting`,
    );
  }

  return (
    `the posting answered HTTP ${String(record.status)} (gone), ` +
    'so the vacancy no longer exists at that address'
  );
}
