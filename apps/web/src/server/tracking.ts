import 'server-only';

import {
  buildTrackedApplications,
  countByOutcome,
  isApplicationOutcome,
  type ApplicationOutcome,
  type ApplicationRepository,
  type QueueReader,
  type TrackedApplication,
  type TrackableQueueJob,
} from '@job-queue/core';

/**
 * Read model of the tracking view (`/seguimiento`). Read-only on purpose: it
 * never writes the application log, the queue or the dismissals.
 */

export type EstadoFilter = ApplicationOutcome | 'all';

/** A non-fatal read problem. Structured so the UI words it in Spanish. */
export interface TrackingWarning {
  readonly kind: 'applications' | 'queue';
  readonly detail: string;
}

export interface TrackingData {
  /** Every application, newest first. Filtering is a separate, pure step. */
  readonly rows: readonly TrackedApplication[];
  readonly counts: Readonly<Record<ApplicationOutcome, number>>;
  readonly warnings: readonly TrackingWarning[];
}

export interface TrackingDeps {
  readonly applicationRepository: ApplicationRepository;
  readonly queueReader: QueueReader;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `?estado=` is user-controlled: anything that is not an outcome means "all". */
export function parseEstadoFilter(raw: string | readonly string[] | undefined): EstadoFilter {
  return typeof raw === 'string' && isApplicationOutcome(raw) ? raw : 'all';
}

export function filterTrackedRows(
  rows: readonly TrackedApplication[],
  filter: EstadoFilter,
): readonly TrackedApplication[] {
  return filter === 'all' ? rows : rows.filter((row) => row.outcome === filter);
}

export async function loadTracking(deps: TrackingDeps): Promise<TrackingData> {
  const warnings: TrackingWarning[] = [];

  // A broken queue only costs the title/link of applications whose job is still
  // queued; the log itself carries enough to list everything else.
  let jobs: readonly TrackableQueueJob[] = [];
  try {
    jobs = (await deps.queueReader.read())?.jobs ?? [];
  } catch (cause: unknown) {
    warnings.push({ kind: 'queue', detail: describe(cause) });
  }

  let rows: readonly TrackedApplication[] = [];
  try {
    rows = buildTrackedApplications(await deps.applicationRepository.list(), jobs);
  } catch (cause: unknown) {
    warnings.push({ kind: 'applications', detail: describe(cause) });
  }

  return { rows, counts: countByOutcome(rows), warnings };
}
