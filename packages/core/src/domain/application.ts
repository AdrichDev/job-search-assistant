import type { CvVariant } from './job.js';

/**
 * What happened after the human clicked "Apply" and filled the form themselves.
 *
 * This is the labelled data the scoring weights will eventually be retuned
 * against: without it, the ranking can never be proven wrong.
 */

export const APPLICATION_OUTCOMES = [
  'applied',
  'no_reply',
  'rejected',
  'screening',
  'interview',
  'offer',
] as const;

export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

/**
 * What the application was FOR, when no queue vacancy exists to say so.
 *
 * Imported history (a spreadsheet kept by hand) has a company, a title and often
 * a link, but no matching job in the queue. Applications logged from the queue
 * leave this out: the vacancy already carries these facts.
 */
export interface ApplicationListing {
  readonly company: string;
  readonly title: string;
  readonly url?: string;
  readonly portal?: string;
  readonly city?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly contact?: string;
  readonly companyInfo?: string;
  readonly publishedAt?: Date;
}

const OPTIONAL_LISTING_TEXT = ['url', 'portal', 'city', 'address', 'phone', 'contact', 'companyInfo'] as const;

/** Trims every field, drops empty optionals, and refuses a listing with no company or title. */
export function normalizeListing(listing: ApplicationListing): ApplicationListing {
  const company = listing.company.trim();
  const title = listing.title.trim();
  if (company.length === 0 || title.length === 0) {
    throw new Error('An application listing needs a company and a title.');
  }
  const optional: Partial<Record<(typeof OPTIONAL_LISTING_TEXT)[number], string>> = {};
  for (const key of OPTIONAL_LISTING_TEXT) {
    const value = listing[key]?.trim();
    if (value !== undefined && value.length > 0) {
      optional[key] = value;
    }
  }
  return {
    company,
    title,
    ...optional,
    ...(listing.publishedAt === undefined ? {} : { publishedAt: listing.publishedAt }),
  };
}

export interface Application {
  /** Matches `Job.id`, the content fingerprint. One application per vacancy. */
  readonly jobId: string;
  readonly appliedAt: Date;
  /**
   * Which CV was sent. The whole point of the stats panel. Absent for imported
   * history, where nobody recorded it: such applications are left out of the
   * per-variant stats rather than credited to a CV that may not have been sent.
   */
  readonly cvVariant?: CvVariant;
  /**
   * The score at the moment of applying, frozen on purpose. Retuning the
   * weights later must not rewrite what the ranking believed back then.
   * Absent for imported history.
   */
  readonly scoreAtApply?: number;
  /**
   * Ids of the sources that carried the vacancy when it was applied to (a deduped
   * vacancy can have several). Empty for applications logged before this field
   * existed. Frozen like the score: it is what lets stats ask which source converts.
   */
  readonly sourceIds: readonly string[];
  readonly outcome: ApplicationOutcome;
  readonly outcomeUpdatedAt: Date;
  readonly notes?: string;
  /** Present only when there is no queue vacancy behind this application. */
  readonly listing?: ApplicationListing;
}

export interface ApplicationDraft {
  readonly jobId: string;
  readonly appliedAt: Date;
  readonly cvVariant?: CvVariant;
  readonly scoreAtApply?: number;
  /** Defaults to none. Trimmed and de-duplicated by `createApplication`. */
  readonly sourceIds?: readonly string[];
  /** Defaults to `applied`. Only set explicitly when importing existing history. */
  readonly outcome?: ApplicationOutcome;
  readonly notes?: string;
  readonly listing?: ApplicationListing;
}

/** Type guard for values crossing a boundary (JSON file, form post, URL param). */
export function isApplicationOutcome(value: unknown): value is ApplicationOutcome {
  return (
    typeof value === 'string' &&
    (APPLICATION_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * Did anyone actually reply?
 *
 * A rejection counts: a "no" is a response, and a channel that only ever
 * produces silence is a different problem from one that produces rejections.
 */
export function isResponse(outcome: ApplicationOutcome): boolean {
  return outcome !== 'applied' && outcome !== 'no_reply';
}

/** Did the application move forward? Rejections are responses but not advances. */
export function isAdvance(outcome: ApplicationOutcome): boolean {
  return outcome === 'screening' || outcome === 'interview' || outcome === 'offer';
}

/**
 * The only way to mint an `Application`.
 *
 * Validates here rather than at every call site: this entity is written from a
 * web form, so garbage must be stopped at the domain edge.
 */
export function createApplication(draft: ApplicationDraft): Application {
  const jobId = draft.jobId.trim();
  if (jobId.length === 0) {
    throw new Error('An application needs a job id.');
  }
  if (draft.scoreAtApply !== undefined && !Number.isFinite(draft.scoreAtApply)) {
    throw new Error(`An application needs a finite score, received ${String(draft.scoreAtApply)}.`);
  }

  const outcome = draft.outcome ?? 'applied';
  const notes = draft.notes?.trim();

  return {
    jobId,
    appliedAt: draft.appliedAt,
    ...(draft.cvVariant === undefined ? {} : { cvVariant: draft.cvVariant }),
    ...(draft.scoreAtApply === undefined ? {} : { scoreAtApply: draft.scoreAtApply }),
    sourceIds: [...new Set((draft.sourceIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0))],
    outcome,
    outcomeUpdatedAt: draft.appliedAt,
    // `exactOptionalPropertyTypes` forbids an explicit `undefined`, so an absent
    // note means an absent key.
    ...(notes === undefined || notes.length === 0 ? {} : { notes }),
    ...(draft.listing === undefined ? {} : { listing: normalizeListing(draft.listing) }),
  };
}

/**
 * Job id -> application lookup.
 *
 * Lives here because "one application per vacancy" is a domain invariant, and
 * every consumer (queue decoration, stats, UI) needs the same index.
 */
export function indexApplicationsByJobId(
  applications: readonly Application[],
): ReadonlyMap<string, Application> {
  return new Map(applications.map((application) => [application.jobId, application]));
}

/**
 * Records what came back. Immutable update: `appliedAt` is history and never moves.
 *
 * Omitting `notes` keeps whatever was there; the UI clears notes by sending an
 * empty string, not by omitting the field.
 */
export function withOutcome(
  application: Application,
  outcome: ApplicationOutcome,
  at: Date,
  notes?: string,
): Application {
  // `notes` is pulled out of the spread so that an explicit empty string can
  // actually clear it; spreading the whole entity would re-add the old value.
  const { notes: existingNotes, ...rest } = application;
  const nextNotes = notes === undefined ? existingNotes : notes.trim();

  return {
    ...rest,
    outcome,
    outcomeUpdatedAt: at,
    ...(nextNotes === undefined || nextNotes.length === 0 ? {} : { notes: nextNotes }),
  };
}
