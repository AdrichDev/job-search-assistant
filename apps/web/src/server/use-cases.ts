import 'server-only';

import {
  buildTrackedApplications,
  dismissJob,
  editApplication as editApplicationUseCase,
  isApplicationOutcome,
  recordApplication,
  restoreJob,
  startFetchRun,
  updateApplicationOutcome,
  type ApplicationPatch,
  type ApplicationRepository,
  type CvVariant,
  type ListingPatch,
  type PatchRefusalReason,
  type DismissalRepository,
  type FetchRunState,
  type JobQueue,
  type Logger,
  type PipelineRunner,
  type RunStateStore,
  type TrackableQueueJob,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { buildEditFormValues, madridDay, parseFormDay } from '@/server/edit-form';

/**
 * The write paths of the UI, kept free of Next.js imports so they stay
 * unit-testable without a running server.
 *
 * `actions.ts` is the thin `'use server'` wrapper that supplies the real
 * container and revalidates the page.
 *
 * Every function here is a translation layer and nothing more: the decisions -
 * idempotency, the applied/dismissed conflict, single-flight, the write guard -
 * all live in `@job-queue/core` behind ports, where they can be tested without
 * React and reused by the CLI.
 */

export interface WriteDeps {
  readonly applicationRepository: ApplicationRepository;
  readonly loadQueue: () => Promise<JobQueue | null>;
  readonly now: () => Date;
  /**
   * OPTIONAL so the two original write paths keep working untouched when no
   * dismissal store is configured, and so their existing tests keep describing
   * the behaviour they were written for.
   */
  readonly dismissalRepository?: DismissalRepository;
}

export interface ActionOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Records that the human opened a posting to apply to it.
 *
 * Only the job id crosses the wire. The score and CV variant are read from the
 * server-side queue, so a crafted request cannot write false training data.
 *
 * Idempotent by contract of `ApplicationRepository.record`: the second click of
 * a double click reports success without creating a second application.
 */
export async function applyToJob(jobId: unknown, deps: WriteDeps): Promise<ActionOutcome> {
  if (typeof jobId !== 'string') {
    return { ok: false, message: ACTION_MESSAGES.missingJobId };
  }

  const result = await recordApplication(
    { jobId },
    {
      repository: deps.applicationRepository,
      loadQueue: deps.loadQueue,
      now: deps.now,
      // Applying supersedes an earlier dismissal - see `record-application.ts`.
      ...(deps.dismissalRepository === undefined
        ? {}
        : { dismissals: deps.dismissalRepository }),
    },
  );

  switch (result.status) {
    case 'recorded':
      return {
        ok: true,
        message: result.created ? ACTION_MESSAGES.recorded : ACTION_MESSAGES.alreadyRecorded,
      };
    case 'unknown_job':
      return { ok: false, message: ACTION_MESSAGES.unknownJob };
    case 'queue_unavailable':
      return { ok: false, message: ACTION_MESSAGES.queueUnavailable };
  }
}

/** Sets what came back from an application already in the log. */
export async function setOutcome(
  jobId: unknown,
  outcome: unknown,
  notes: unknown,
  deps: WriteDeps,
): Promise<ActionOutcome> {
  if (typeof jobId !== 'string' || typeof outcome !== 'string') {
    return { ok: false, message: ACTION_MESSAGES.missingOutcome };
  }

  const result = await updateApplicationOutcome(
    {
      jobId,
      outcome,
      ...(typeof notes === 'string' ? { notes } : {}),
    },
    { repository: deps.applicationRepository, now: deps.now },
  );

  switch (result.status) {
    case 'updated':
      return { ok: true, message: ACTION_MESSAGES.outcomeUpdated };
    case 'not_applied':
      return { ok: false, message: ACTION_MESSAGES.notApplied };
    case 'invalid_outcome':
      return { ok: false, message: ACTION_MESSAGES.invalidOutcome };
  }
}

const REFUSAL_MESSAGE: Record<PatchRefusalReason, string> = {
  invalid_date: ACTION_MESSAGES.invalidDate,
  invalid_outcome: ACTION_MESSAGES.invalidOutcome,
  invalid_cv_variant: ACTION_MESSAGES.invalidCvVariant,
  blank_company: ACTION_MESSAGES.blankCompany,
  blank_title: ACTION_MESSAGES.blankTitle,
  invalid_url: ACTION_MESSAGES.invalidUrl,
  listing_incomplete: ACTION_MESSAGES.listingIncomplete,
  too_long: ACTION_MESSAGES.tooLong,
};

const LISTING_TEXT_FIELDS = [
  'company',
  'title',
  'url',
  'portal',
  'city',
  'address',
  'phone',
  'contact',
  'companyInfo',
] as const;

/**
 * Edits any field of an application by hand (CU7).
 *
 * `input` is the raw form post and is treated as untrusted: it must be a
 * FormData whose values are all text. Absent key = unchanged; an empty string
 * clears an optional field; dates arrive as `YYYY-MM-DD` and are stored as that
 * day at 00:00 UTC.
 *
 * A date whose calendar day equals the stored one is left out of the patch: the
 * form pre-fills the day, so re-sending it must not flatten the stored time, and
 * a re-sent old reply date must not stop the domain from stamping "now" when the
 * outcome changes.
 *
 * The same holds for every other field: a value equal to what the form pre-filled
 * is not a change and is left out. Without this, saving an untouched form on a
 * queue-made application would write a listing built from the pre-filled facts
 * (the lowercase id fingerprint) and report "saved". A listing is created only
 * when a listing field really changed, and then takes company and title from the
 * pre-filled values so the domain can accept it.
 */
export async function editApplication(input: unknown, deps: WriteDeps): Promise<ActionOutcome> {
  if (!(input instanceof FormData)) {
    return { ok: false, message: ACTION_MESSAGES.invalidInput };
  }

  const read = (key: string): string | null | undefined => {
    const value = input.get(key);
    if (value === null) {
      return null;
    }
    return typeof value === 'string' ? value : undefined;
  };
  const keys = ['jobId', 'appliedAt', 'outcome', 'outcomeUpdatedAt', 'cvVariant', 'notes', 'sourceIds', 'publishedAt', ...LISTING_TEXT_FIELDS];
  if (keys.some((key) => read(key) === undefined)) {
    return { ok: false, message: ACTION_MESSAGES.invalidInput };
  }

  const jobId = read('jobId');
  if (jobId === null || jobId === undefined || jobId.trim().length === 0) {
    return { ok: false, message: ACTION_MESSAGES.missingJobId };
  }

  const current = await deps.applicationRepository.findByJobId(jobId);
  if (current === null) {
    return { ok: false, message: ACTION_MESSAGES.applicationNotFound };
  }

  let queueJobs: readonly TrackableQueueJob[] = [];
  try {
    queueJobs = (await deps.loadQueue())?.jobs ?? [];
  } catch {
    // A broken queue only costs the pre-filled facts of a queue-made application.
  }
  const baseline = buildEditFormValues(current, buildTrackedApplications([current], queueJobs)[0]);

  const invalidDate = { ok: false, message: ACTION_MESSAGES.invalidDate } as const;
  const patch: {
    -readonly [K in keyof ApplicationPatch]: ApplicationPatch[K];
  } = {};
  const listing: { -readonly [K in keyof ListingPatch]: ListingPatch[K] } = {};

  const appliedAt = read('appliedAt');
  if (appliedAt !== null && appliedAt !== undefined) {
    const day = parseFormDay(appliedAt);
    if (day === null) {
      return invalidDate;
    }
    if (madridDay(current.appliedAt) !== appliedAt) {
      patch.appliedAt = day;
    }
  }

  const outcome = read('outcome');
  if (outcome !== null && outcome !== undefined) {
    if (!isApplicationOutcome(outcome)) {
      return { ok: false, message: ACTION_MESSAGES.invalidOutcome };
    }
    if (outcome !== current.outcome) {
      patch.outcome = outcome;
    }
  }

  const outcomeUpdatedAt = read('outcomeUpdatedAt');
  if (outcomeUpdatedAt !== null && outcomeUpdatedAt !== undefined && outcomeUpdatedAt !== '') {
    const day = parseFormDay(outcomeUpdatedAt);
    if (day === null) {
      return invalidDate;
    }
    if (madridDay(current.outcomeUpdatedAt) !== outcomeUpdatedAt) {
      patch.outcomeUpdatedAt = day;
    }
  }

  const cvVariant = read('cvVariant');
  if (cvVariant !== null && cvVariant !== undefined) {
    // Unknown values are refused by the domain, which owns the list of variants.
    if (cvVariant !== baseline.cvVariant) {
      patch.cvVariant = cvVariant === '' ? null : (cvVariant as CvVariant);
    }
  }

  const notes = read('notes');
  if (notes !== null && notes !== undefined && notes !== baseline.notes) {
    patch.notes = notes;
  }

  const sourceIds = read('sourceIds');
  if (sourceIds !== null && sourceIds !== undefined) {
    const entered = sourceIds
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (entered.join(', ') !== baseline.sourceIds) {
      patch.sourceIds = sourceIds.split(',');
    }
  }

  for (const key of LISTING_TEXT_FIELDS) {
    const value = read(key);
    if (value !== null && value !== undefined && value !== baseline[key]) {
      listing[key] = value;
    }
  }

  const publishedAt = read('publishedAt');
  if (publishedAt !== null && publishedAt !== undefined) {
    if (publishedAt === '') {
      if (baseline.publishedAt !== '') {
        listing.publishedAt = null;
      }
    } else {
      const day = parseFormDay(publishedAt);
      if (day === null) {
        return invalidDate;
      }
      const stored = current.listing?.publishedAt;
      if (stored === undefined || madridDay(stored) !== publishedAt) {
        listing.publishedAt = day;
      }
    }
  }

  if (Object.keys(listing).length > 0) {
    if (current.listing === undefined) {
      // The domain needs both to create a listing. The real form always posts them
      // (unchanged, hence left out above), so they come from what it showed; a
      // hand-made post that omits them stays refused as incomplete.
      if (read('company') !== null) {
        listing.company ??= baseline.company;
      }
      if (read('title') !== null) {
        listing.title ??= baseline.title;
      }
    }
    patch.listing = listing;
  }

  const result = await editApplicationUseCase({ jobId, patch }, {
    repository: deps.applicationRepository,
    now: deps.now,
  });

  switch (result.status) {
    case 'updated':
      return { ok: true, message: ACTION_MESSAGES.applicationEdited };
    case 'unchanged':
      return { ok: true, message: ACTION_MESSAGES.applicationUnchanged };
    case 'not_found':
      return { ok: false, message: ACTION_MESSAGES.applicationNotFound };
    case 'invalid':
      return { ok: false, message: REFUSAL_MESSAGE[result.reason] };
  }
}

/** Guard for the paths that genuinely need the dismissal store. */
function requireDismissals(deps: WriteDeps): DismissalRepository {
  if (deps.dismissalRepository === undefined) {
    throw new Error('No dismissal store is configured for this app.');
  }
  return deps.dismissalRepository;
}

/**
 * Records that the human is not interested in a posting.
 *
 * NOT a delete. The queue file is untouched and the offer can be brought back
 * at any time - see `dismissal-view.ts` for why that is the shape of the whole
 * feature rather than a nicety.
 */
export async function dismissOffer(
  jobId: unknown,
  deps: WriteDeps,
  reason?: unknown,
): Promise<ActionOutcome> {
  if (typeof jobId !== 'string') {
    return { ok: false, message: ACTION_MESSAGES.missingJobId };
  }

  const result = await dismissJob(
    { jobId, ...(reason === undefined ? {} : { reason }) },
    {
      dismissals: requireDismissals(deps),
      applications: deps.applicationRepository,
      loadQueue: deps.loadQueue,
      now: deps.now,
    },
  );

  switch (result.status) {
    case 'dismissed':
      return {
        ok: true,
        message: result.created ? ACTION_MESSAGES.dismissed : ACTION_MESSAGES.alreadyDismissed,
      };
    case 'already_applied':
      return { ok: false, message: ACTION_MESSAGES.cannotDismissApplied };
    case 'conflict_unknown':
      return { ok: false, message: ACTION_MESSAGES.dismissConflictUnknown };
    case 'invalid_reason':
      return { ok: false, message: ACTION_MESSAGES.invalidDismissalReason };
    case 'unknown_job':
      return { ok: false, message: ACTION_MESSAGES.unknownJob };
    case 'queue_unavailable':
      return { ok: false, message: ACTION_MESSAGES.queueUnavailable };
  }
}

/** Puts a dismissed offer back on the list. */
export async function restoreOffer(jobId: unknown, deps: WriteDeps): Promise<ActionOutcome> {
  if (typeof jobId !== 'string') {
    return { ok: false, message: ACTION_MESSAGES.missingJobId };
  }

  const result = await restoreJob({ jobId }, { dismissals: requireDismissals(deps) });

  return result.status === 'restored'
    ? { ok: true, message: ACTION_MESSAGES.restored }
    : { ok: false, message: ACTION_MESSAGES.notDismissed };
}

export interface FetchDeps {
  readonly runStateStore: RunStateStore;
  readonly pipelineRunner: PipelineRunner;
  readonly now: () => Date;
  readonly newRunId: () => string;
  readonly logger: Logger;
  readonly staleAfterMs?: number;
}

export interface FetchStartOutcome extends ActionOutcome {
  /**
   * Resolves when the background run has finished and published its state.
   *
   * The server action ignores it - that is what makes the request return in
   * milliseconds instead of minutes. Tests await it so they are asserting on a
   * finished run rather than on a sleep.
   */
  readonly completion: Promise<void>;
}

/**
 * Starts one ingestion run, or reports that one is already going.
 *
 * The refusal is not cosmetic and it is not the button being disabled: two
 * tabs, or a click on a stale page, reach this function with no shared client
 * state at all, and the only thing standing between them and two pipelines
 * writing the same queue file is the lock inside `startFetchRun`.
 */
export async function startFetch(deps: FetchDeps): Promise<FetchStartOutcome> {
  const result = await startFetchRun({
    store: deps.runStateStore,
    runner: deps.pipelineRunner,
    now: deps.now,
    newRunId: deps.newRunId,
    logger: deps.logger,
    ...(deps.staleAfterMs === undefined ? {} : { staleAfterMs: deps.staleAfterMs }),
  });

  if (result.status === 'already_running') {
    return {
      ok: false,
      message: ACTION_MESSAGES.fetchAlreadyRunning,
      completion: Promise.resolve(),
    };
  }

  return {
    ok: true,
    message: ACTION_MESSAGES.fetchStarted,
    completion: result.completion,
  };
}

/** What the run is doing right now. Polled by the browser. */
export function readFetchState(deps: FetchDeps): Promise<FetchRunState> {
  return deps.runStateStore.read();
}
