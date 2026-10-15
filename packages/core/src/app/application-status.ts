import {
  indexApplicationsByJobId,
  type Application,
} from '../domain/application.js';
import type { JobQueue, QueueApplicationStatus } from '../ports/queue-writer.js';

/**
 * Projects the application log onto the ranked queue.
 *
 * Product rule: an already-applied job is MARKED, never dropped. Hiding it
 * would destroy the audit trail the candidate needs ("did I already send this
 * one, and what happened?") and would silently shrink the list every morning.
 */

export interface ApplicationStatusFields {
  readonly applicationStatus: QueueApplicationStatus;
  readonly appliedAt: string | null;
  readonly outcomeUpdatedAt: string | null;
  readonly notes: string | null;
}

const NOT_APPLIED: ApplicationStatusFields = {
  applicationStatus: 'not_applied',
  appliedAt: null,
  outcomeUpdatedAt: null,
  notes: null,
};

export function statusFieldsFor(
  jobId: string,
  index: ReadonlyMap<string, Application>,
): ApplicationStatusFields {
  const application = index.get(jobId);
  if (application === undefined) {
    return NOT_APPLIED;
  }

  return {
    applicationStatus: application.outcome,
    appliedAt: application.appliedAt.toISOString(),
    outcomeUpdatedAt: application.outcomeUpdatedAt.toISOString(),
    notes: application.notes ?? null,
  };
}

/**
 * Re-stamps a queue with the CURRENT application log.
 *
 * The web app reads a queue file produced by an earlier CLI run, so whatever
 * status was baked into that file is stale by definition and is overwritten
 * here rather than trusted.
 */
export function withApplicationStatus(
  queue: JobQueue,
  applications: readonly Application[],
): JobQueue {
  const index = indexApplicationsByJobId(applications);

  return {
    ...queue,
    jobs: queue.jobs.map((entry) => ({ ...entry, ...statusFieldsFor(entry.id, index) })),
  };
}
