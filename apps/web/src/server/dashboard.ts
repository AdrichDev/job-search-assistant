import 'server-only';

import {
  computeApplicationStats,
  countSampleDataEntries,
  partitionByDismissal,
  withApplicationStatus,
  type ApplicationRepository,
  type ApplicationStats,
  type Dismissal,
  type DismissalRepository,
  type DismissedRow,
  type JobQueue,
  type QueueReader,
} from '@job-queue/core';

/**
 * Everything a page render needs, assembled once on the server.
 *
 * Two independent sources are combined here: the persisted queue (what the
 * pipeline found) and the application log (what the human did). The log always
 * wins - a queue file is a snapshot and its baked-in status is stale by the
 * time anybody looks at it.
 */

export type QueueOrigin = 'persisted-run' | 'offline-fallback';

export interface DashboardData {
  readonly queue: JobQueue;
  readonly stats: ApplicationStats;
  readonly origin: QueueOrigin;
  /**
   * How many of the surfaced offers are INVENTED.
   *
   * Separate from `origin` on purpose, because the two answer different
   * questions and conflating them is what let dead apply buttons render as
   * ordinary offers. `origin` says where the queue came from; a persisted run
   * is a real run and reads as trustworthy. This says whether the rows inside
   * it are real, which the origin cannot know - a queue written by an older
   * build, or by `--source=fixture`, is a genuine persisted run full of
   * postings whose links resolve nowhere.
   *
   * Computed from `sources[]`, which every posting carries because every path
   * into the system mints its jobs through `createJob`.
   */
  readonly sampleDataCount: number;
  /**
   * Offers the human said no to, newest decision first.
   *
   * Present in the render model rather than filtered away silently, because a
   * dismissal is reversible and an interface that hides it offers no way back.
   * `queue.jobs` above already excludes these.
   */
  readonly dismissed: readonly DismissedRow[];
  /** Non-fatal problems worth telling the user about, never thrown. */
  readonly warnings: readonly string[];
}

export interface DashboardDeps {
  readonly queueReader: QueueReader;
  readonly applicationRepository: ApplicationRepository;
  readonly dismissalRepository: DismissalRepository;
  readonly buildFallbackQueue: (now: Date) => Promise<JobQueue>;
  readonly now: () => Date;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function loadDashboard(deps: DashboardDeps): Promise<DashboardData> {
  const now = deps.now();
  const warnings: string[] = [];

  // A corrupt or outdated queue file degrades the page to the offline
  // catalogue. It must never blank the screen.
  let persisted: JobQueue | null = null;
  try {
    persisted = await deps.queueReader.read();
  } catch (cause: unknown) {
    warnings.push(`Could not read the saved queue, showing offline sample data. ${describe(cause)}`);
  }

  const origin: QueueOrigin = persisted === null ? 'offline-fallback' : 'persisted-run';
  const queue = persisted ?? (await deps.buildFallbackQueue(now));

  // A broken application log must not hide today's jobs either; it only costs
  // the tracking overlay.
  let applications: Awaited<ReturnType<ApplicationRepository['list']>> = [];
  try {
    applications = await deps.applicationRepository.list();
  } catch (cause: unknown) {
    warnings.push(`Could not read the application log. ${describe(cause)}`);
  }

  // Neither must an unreadable dismissal log. Same asymmetry: it costs the
  // hide/restore overlay, never the list of today's jobs.
  let dismissals: readonly Dismissal[] = [];
  try {
    dismissals = await deps.dismissalRepository.list();
  } catch (cause: unknown) {
    warnings.push(`Could not read the dismissal log. ${describe(cause)}`);
  }

  const { visible, dismissed } = partitionByDismissal(queue, dismissals);

  /*
   * The headline count is recomputed from what is actually shown.
   *
   * `totalJuniorEligible` is what the PIPELINE found; after a dismissal the two
   * numbers diverge, and printing the pipeline's figure over a shorter list
   * would tell the human there are offers they cannot find - the same class of
   * lie the dead-link subtraction already fixed in the CLI's run summary.
   */
  const shown: JobQueue = { ...queue, jobs: visible, totalJuniorEligible: visible.length };

  // A vacancy can exist in all three collections. Count its stable id once so
  // the top of the funnel never inflates after applying or dismissing it.
  const surfaced = new Set([
    ...queue.jobs.map((entry) => entry.id),
    ...applications.map((application) => application.jobId),
    ...dismissals.map((dismissal) => dismissal.jobId),
  ]).size;

  return {
    queue: withApplicationStatus(shown, applications),
    stats: computeApplicationStats(applications, { surfaced }),
    origin,
    // Asked of the VISIBLE postings, so a dismissed sample offer stops raising
    // a banner about a card that is no longer on the page.
    sampleDataCount: countSampleDataEntries(visible),
    dismissed,
    warnings,
  };
}
