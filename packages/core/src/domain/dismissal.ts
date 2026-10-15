/**
 * "Not interested in this one."
 *
 * The counterpart of `Application`, and deliberately built the same way: the
 * same `jobId` key, the same "minted only through a factory" rule, the same
 * trimming. The two stores MUST agree about what a vacancy is, because the
 * product asks questions that span both of them - "did I already act on this?"
 * - and two identity schemes would answer that question differently.
 *
 * `jobId` is `Job.id`, the content fingerprint from `jobFingerprint`
 * (`company::title::location`). Being a pure function of the posting's own
 * content is what makes a dismissal survive a re-run for free: tomorrow's
 * pipeline mints the same id for the same vacancy, and it stays hidden without
 * the pipeline ever knowing dismissals exist.
 *
 * ## Why a snapshot is stored alongside the id
 *
 * The review list has to work even when the posting has left the queue - the
 * source removed it, or a run was refused, or the human is looking at a
 * three-week-old dismissal. Without a snapshot the only thing left to render is
 * the raw fingerprint, which is not something a person recognises. An extra
 * title and company per row is cheap; an unreadable, un-restorable row is not.
 */

export const DISMISSAL_REASONS = [
  'role_mismatch',
  'seniority_mismatch',
  'stack_mismatch',
  'location',
  'compensation',
  'other',
] as const;

export type DismissalReason = (typeof DISMISSAL_REASONS)[number];

export function isDismissalReason(value: unknown): value is DismissalReason {
  return typeof value === 'string' && (DISMISSAL_REASONS as readonly string[]).includes(value);
}

export interface Dismissal {
  /** Matches `Job.id` and `Application.jobId`. One dismissal per vacancy. */
  readonly jobId: string;
  readonly dismissedAt: Date;
  /** What the posting was called when it was dismissed. */
  readonly title: string;
  /** Who it was with when it was dismissed. */
  readonly company: string;
  /** Optional because choosing a reason must never block the reversible action. */
  readonly reason?: DismissalReason;
}

export interface DismissalDraft {
  readonly jobId: string;
  readonly dismissedAt: Date;
  readonly title: string;
  readonly company: string;
  readonly reason?: DismissalReason;
}

/**
 * Shown when the snapshot is empty.
 *
 * Never thrown over: an empty title is a cosmetic gap, and refusing the
 * dismissal because of one would mean the human's decision is lost over a
 * missing string.
 */
const UNKNOWN_TITLE = '(untitled posting)';
const UNKNOWN_COMPANY = '(unknown employer)';

/**
 * The only way to mint a `Dismissal`.
 *
 * Validates the id at the domain edge, exactly like `createApplication`, since
 * this entity is written straight from a web form.
 */
export function createDismissal(draft: DismissalDraft): Dismissal {
  const jobId = draft.jobId.trim();
  if (jobId.length === 0) {
    throw new Error('A dismissal needs a job id.');
  }

  const title = draft.title.trim();
  const company = draft.company.trim();

  return {
    jobId,
    dismissedAt: draft.dismissedAt,
    title: title.length === 0 ? UNKNOWN_TITLE : title,
    company: company.length === 0 ? UNKNOWN_COMPANY : company,
    ...(draft.reason === undefined ? {} : { reason: draft.reason }),
  };
}

/**
 * Job id -> dismissal lookup.
 *
 * Lives here for the same reason `indexApplicationsByJobId` does: "one
 * dismissal per vacancy" is a domain invariant, and every consumer needs the
 * same index rather than its own `find` in a render loop.
 */
export function indexDismissalsByJobId(
  dismissals: readonly Dismissal[],
): ReadonlyMap<string, Dismissal> {
  return new Map(dismissals.map((dismissal) => [dismissal.jobId, dismissal]));
}
