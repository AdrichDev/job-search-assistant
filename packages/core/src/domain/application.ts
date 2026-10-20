import { CV_VARIANTS, type CvVariant } from './job.js';

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
  /** When the outcome was last set. Defaults to `appliedAt`; imports pass the reply date. */
  readonly outcomeUpdatedAt?: Date;
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
    outcomeUpdatedAt: draft.outcomeUpdatedAt ?? draft.appliedAt,
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
 * Records what came back. Immutable update.
 *
 * (Editing by hand, `applyApplicationPatch` below, may move `appliedAt` too: the
 * human is the authority over their own history and a wrong date typed into a
 * spreadsheet must be fixable. The automatic paths never move it.)
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

/* Manual editing --------------------------------------------------------- */

/** Edits to the listing. Absent key = unchanged; blank text clears; `publishedAt: null` clears. */
export interface ListingPatch {
  readonly company?: string;
  readonly title?: string;
  readonly url?: string;
  readonly portal?: string;
  readonly city?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly contact?: string;
  readonly companyInfo?: string;
  readonly publishedAt?: Date | null;
}

/**
 * Every field a human may edit by hand. NOT here on purpose: `jobId` (the
 * identity) and `scoreAtApply` (a snapshot of what the ranking believed back
 * then). Absent key = unchanged; `cvVariant: null` clears the CV; blank notes
 * clear them.
 */
export interface ApplicationPatch {
  readonly appliedAt?: Date;
  readonly outcome?: ApplicationOutcome;
  readonly outcomeUpdatedAt?: Date;
  readonly cvVariant?: CvVariant | null;
  readonly notes?: string;
  readonly sourceIds?: readonly string[];
  readonly listing?: ListingPatch;
}

/** Fixed machine reasons. Never carry cell content, so they are safe to log and to show. */
export const PATCH_REFUSAL_REASONS = [
  'invalid_date',
  'invalid_outcome',
  'invalid_cv_variant',
  'blank_company',
  'blank_title',
  'invalid_url',
  'listing_incomplete',
  'too_long',
] as const;

export type PatchRefusalReason = (typeof PATCH_REFUSAL_REASONS)[number];

export type ApplyPatchResult =
  | { readonly ok: true; readonly application: Application; readonly changed: boolean }
  | { readonly ok: false; readonly reason: PatchRefusalReason };

/** Thrown by a repository when a patch breaks a domain rule; nothing was written. */
export class ApplicationPatchError extends Error {
  readonly reason: PatchRefusalReason;

  constructor(reason: PatchRefusalReason) {
    super(`The application edit was refused: ${reason}.`);
    this.name = 'ApplicationPatchError';
    this.reason = reason;
  }
}

/** Generous on purpose: a very long note must stay editable. */
export const MAX_NOTES_LENGTH = 20_000;
export const MAX_TEXT_LENGTH = 2_000;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  return a === undefined || b === undefined ? a === b : a.getTime() === b.getTime();
}

function sameListing(a: ApplicationListing | undefined, b: ApplicationListing | undefined): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    a.company === b.company &&
    a.title === b.title &&
    OPTIONAL_LISTING_TEXT.every((key) => a[key] === b[key]) &&
    sameDate(a.publishedAt, b.publishedAt)
  );
}

/** Value equality of two applications (dates by instant, absent = absent). */
export function applicationsEqual(a: Application, b: Application): boolean {
  return (
    a.jobId === b.jobId &&
    sameDate(a.appliedAt, b.appliedAt) &&
    a.cvVariant === b.cvVariant &&
    a.scoreAtApply === b.scoreAtApply &&
    a.sourceIds.length === b.sourceIds.length &&
    a.sourceIds.every((id, index) => id === b.sourceIds[index]) &&
    a.outcome === b.outcome &&
    sameDate(a.outcomeUpdatedAt, b.outcomeUpdatedAt) &&
    a.notes === b.notes &&
    sameListing(a.listing, b.listing)
  );
}

/**
 * Applies a manual edit and decides whether it is valid. Pure: persistence is
 * the repository's job, and a refusal means nothing may be written.
 *
 * Rules: absent key = unchanged; blank optional text clears the field; company
 * and title never blank; a queue-made application has no listing, so touching
 * any listing field creates one and then company AND title must both be in the
 * patch; changing the outcome without a date stamps `now` (a stale date is
 * never kept silently); every date must be valid; a non-blank url must be
 * http(s) or the edit is refused (editing is explicit: refuse, don't drop).
 */
export function applyApplicationPatch(
  application: Application,
  patch: ApplicationPatch,
  now: Date,
): ApplyPatchResult {
  const refuse = (reason: PatchRefusalReason): ApplyPatchResult => ({ ok: false, reason });

  if (patch.appliedAt !== undefined && !isValidDate(patch.appliedAt)) return refuse('invalid_date');
  if (patch.outcomeUpdatedAt !== undefined && !isValidDate(patch.outcomeUpdatedAt)) {
    return refuse('invalid_date');
  }
  if (patch.outcome !== undefined && !isApplicationOutcome(patch.outcome)) {
    return refuse('invalid_outcome');
  }
  if (
    patch.cvVariant !== undefined &&
    patch.cvVariant !== null &&
    !(CV_VARIANTS as readonly string[]).includes(patch.cvVariant)
  ) {
    return refuse('invalid_cv_variant');
  }

  let notes = application.notes;
  if (patch.notes !== undefined) {
    const trimmed = patch.notes.trim();
    if (trimmed.length > MAX_NOTES_LENGTH) return refuse('too_long');
    notes = trimmed.length === 0 ? undefined : trimmed;
  }

  let sourceIds = application.sourceIds;
  if (patch.sourceIds !== undefined) {
    sourceIds = [...new Set(patch.sourceIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (sourceIds.some((id) => id.length > MAX_TEXT_LENGTH)) return refuse('too_long');
  }

  let listing = application.listing;
  const listingPatch = patch.listing;
  const touched =
    listingPatch === undefined
      ? []
      : (Object.keys(listingPatch) as (keyof ListingPatch)[]).filter(
          (key) => listingPatch[key] !== undefined,
        );
  if (listingPatch !== undefined && touched.length > 0) {
    if (listing === undefined && (listingPatch.company === undefined || listingPatch.title === undefined)) {
      return refuse('listing_incomplete');
    }
    const company = (listingPatch.company ?? listing?.company ?? '').trim();
    const title = (listingPatch.title ?? listing?.title ?? '').trim();
    if (company.length === 0) return refuse('blank_company');
    if (title.length === 0) return refuse('blank_title');
    if (company.length > MAX_TEXT_LENGTH || title.length > MAX_TEXT_LENGTH) return refuse('too_long');

    const optional: Partial<Record<(typeof OPTIONAL_LISTING_TEXT)[number], string>> = {};
    for (const key of OPTIONAL_LISTING_TEXT) {
      const incoming = listingPatch[key];
      const value = (incoming ?? listing?.[key])?.trim();
      if (incoming !== undefined) {
        if (value !== undefined && value.length > MAX_TEXT_LENGTH) return refuse('too_long');
        if (key === 'url' && value !== undefined && value.length > 0 && !isHttpUrl(value)) {
          return refuse('invalid_url');
        }
      }
      if (value !== undefined && value.length > 0) {
        optional[key] = value;
      }
    }

    let publishedAt = listing?.publishedAt;
    if (listingPatch.publishedAt === null) {
      publishedAt = undefined;
    } else if (listingPatch.publishedAt !== undefined) {
      if (!isValidDate(listingPatch.publishedAt)) return refuse('invalid_date');
      publishedAt = listingPatch.publishedAt;
    }

    listing = { company, title, ...optional, ...(publishedAt === undefined ? {} : { publishedAt }) };
  }

  let cvVariant = application.cvVariant;
  if (patch.cvVariant === null) {
    cvVariant = undefined;
  } else if (patch.cvVariant !== undefined) {
    cvVariant = patch.cvVariant;
  }

  const outcome = patch.outcome ?? application.outcome;
  const outcomeUpdatedAt =
    patch.outcomeUpdatedAt ?? (outcome === application.outcome ? application.outcomeUpdatedAt : now);

  // Rebuilt key by key: `exactOptionalPropertyTypes` needs absent keys, and
  // `jobId` / `scoreAtApply` come from the current record, never from the patch.
  const next: Application = {
    jobId: application.jobId,
    appliedAt: patch.appliedAt ?? application.appliedAt,
    ...(cvVariant === undefined ? {} : { cvVariant }),
    ...(application.scoreAtApply === undefined ? {} : { scoreAtApply: application.scoreAtApply }),
    sourceIds,
    outcome,
    outcomeUpdatedAt,
    ...(notes === undefined ? {} : { notes }),
    ...(listing === undefined ? {} : { listing }),
  };

  return { ok: true, application: next, changed: !applicationsEqual(application, next) };
}
