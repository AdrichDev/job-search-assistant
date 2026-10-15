import 'server-only';

import {
  dismissJob,
  recordApplication,
  restoreJob,
  startFetchRun,
  updateApplicationOutcome,
  type ApplicationRepository,
  type DismissalRepository,
  type FetchRunState,
  type JobQueue,
  type Logger,
  type PipelineRunner,
  type RunStateStore,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';

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
