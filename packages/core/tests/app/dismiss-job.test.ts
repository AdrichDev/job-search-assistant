import { beforeEach, describe, expect, it } from 'vitest';
import { createApplication, type Application } from '../../src/domain/application.js';
import { createDismissal, type Dismissal } from '../../src/domain/dismissal.js';
import { dismissJob, restoreJob } from '../../src/app/dismiss-job.js';
import { recordApplication } from '../../src/app/record-application.js';
import type { ApplicationRepository } from '../../src/ports/application-repository.js';
import type { DismissalRepository } from '../../src/ports/dismissal-repository.js';
import type { JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';

/**
 * "The human said he is not interested."
 *
 * Same security posture as `recordApplication`: only a job id crosses the wire
 * and everything else is read from the server-side queue, so a crafted request
 * cannot dismiss a posting that is not on the list or forge its snapshot.
 */

const NOW = new Date('2026-03-10T09:00:00.000Z');

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'acme::junior frontend::madrid',
    score: 61.4,
    cvVariant: 'frontend',
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: ['react'],
      cvVariant: 'frontend',
      englishRequired: 'not_stated',
      workMode: 'onsite',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: 'Junior Frontend Developer',
    company: 'ACME Digital',
    location: 'Madrid',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    postedAt: NOW.toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    liveness: null,
    ...overrides,
  };
}

const QUEUE: JobQueue = {
  generatedAt: NOW.toISOString(),
  candidate: 'Adrian',
  totalFetched: 1,
  totalUnique: 1,
  totalRelevant: 1,
  totalJuniorEligible: 1,
  duplicatesRemoved: 0,
  sourceReports: [],
  excluded: [],
  jobs: [entry()],
};

/** In-memory dismissal store with the port's idempotency contract. */
function fakeDismissals(seed: readonly Dismissal[] = []): DismissalRepository {
  let rows = [...seed];
  return {
    list: async () => rows,
    findByJobId: async (jobId) => rows.find((row) => row.jobId === jobId.trim()) ?? null,
    dismiss: async (draft) => {
      const existing = rows.find((row) => row.jobId === draft.jobId.trim());
      if (existing !== undefined) {
        return { dismissal: existing, created: false };
      }
      const dismissal = createDismissal(draft);
      rows = [...rows, dismissal];
      return { dismissal, created: true };
    },
    restore: async (jobId) => {
      const before = rows.length;
      rows = rows.filter((row) => row.jobId !== jobId.trim());
      return rows.length !== before;
    },
  };
}

/** In-memory application store, enough for the conflict rule. */
function fakeApplications(seed: readonly Application[] = []): ApplicationRepository {
  let rows = [...seed];
  return {
    list: async () => rows,
    findByJobId: async (jobId) => rows.find((row) => row.jobId === jobId.trim()) ?? null,
    record: async (draft) => {
      const existing = rows.find((row) => row.jobId === draft.jobId.trim());
      if (existing !== undefined) {
        return { application: existing, created: false };
      }
      const application = createApplication(draft);
      rows = [...rows, application];
      return { application, created: true };
    },
    updateOutcome: async () => null,
  };
}

let dismissals: DismissalRepository;
let applications: ApplicationRepository;

beforeEach(() => {
  dismissals = fakeDismissals();
  applications = fakeApplications();
});

function deps() {
  return {
    dismissals,
    applications,
    loadQueue: async () => QUEUE as JobQueue | null,
    now: () => NOW,
  };
}

describe('dismissJob', () => {
  it('records the dismissal with a snapshot read from the SERVER-side queue', async () => {
    const result = await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    expect(result.status).toBe('dismissed');
    const stored = await dismissals.findByJobId('acme::junior frontend::madrid');
    expect(stored?.title).toBe('Junior Frontend Developer');
    expect(stored?.company).toBe('ACME Digital');
    expect(stored?.dismissedAt).toEqual(NOW);
  });

  it('is idempotent: dismissing twice records ONE dismissal', async () => {
    const first = await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());
    const second = await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    expect(first).toMatchObject({ status: 'dismissed', created: true });
    expect(second).toMatchObject({ status: 'dismissed', created: false });
    expect(await dismissals.list()).toHaveLength(1);
  });

  it('refuses a job id that is not in the server-side queue', async () => {
    const result = await dismissJob({ jobId: 'forged::job::id' }, deps());

    expect(result.status).toBe('unknown_job');
    expect(await dismissals.list()).toEqual([]);
  });

  it('refuses a blank job id', async () => {
    expect((await dismissJob({ jobId: '   ' }, deps())).status).toBe('unknown_job');
  });

  it('reports a missing queue instead of writing an unverifiable row', async () => {
    const result = await dismissJob(
      { jobId: 'acme::junior frontend::madrid' },
      { ...deps(), loadQueue: async () => null },
    );

    expect(result.status).toBe('queue_unavailable');
    expect(await dismissals.list()).toEqual([]);
  });

  /*
   * THE CONFLICT, decided deliberately.
   *
   * An applied offer is not "a vacancy I am not interested in" - it is a
   * commitment with a pending outcome, and the whole outcome form and stats
   * panel exist to follow it up. `application-status.ts` already states the
   * rule for this codebase: "an already-applied job is MARKED, never dropped."
   * Dismissing one is precisely dropping it, so this refuses rather than
   * inventing a second, contradictory policy.
   */
  it('REFUSES to dismiss an offer the human already applied to', async () => {
    applications = fakeApplications([
      createApplication({
        jobId: 'acme::junior frontend::madrid',
        appliedAt: NOW,
        cvVariant: 'frontend',
        scoreAtApply: 61.4,
      }),
    ]);

    const result = await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    expect(result.status).toBe('already_applied');
    expect(await dismissals.list()).toEqual([]);
  });

  it('still refuses when the application has moved on to an outcome', async () => {
    applications = fakeApplications([
      createApplication({
        jobId: 'acme::junior frontend::madrid',
        appliedAt: NOW,
        cvVariant: 'frontend',
        scoreAtApply: 61.4,
        outcome: 'rejected',
      }),
    ]);

    expect((await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps())).status).toBe(
      'already_applied',
    );
  });

  it('a broken application log refuses the dismissal rather than guessing', async () => {
    applications = {
      ...fakeApplications(),
      findByJobId: async () => {
        throw new Error('log unreadable');
      },
    };

    const result = await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    expect(result.status).toBe('conflict_unknown');
    expect(await dismissals.list()).toEqual([]);
  });
});

describe('restoreJob', () => {
  it('removes the dismissal so the offer comes back', async () => {
    await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    const result = await restoreJob({ jobId: 'acme::junior frontend::madrid' }, { dismissals });

    expect(result.status).toBe('restored');
    expect(await dismissals.list()).toEqual([]);
  });

  /**
   * Restore does NOT consult the queue on purpose. A posting that has left the
   * queue is exactly the one a human is most likely to want back, and refusing
   * would leave an un-restorable row in the review list forever.
   */
  it('restores a dismissal whose posting is no longer in any queue', async () => {
    dismissals = fakeDismissals([
      createDismissal({ jobId: 'gone::from::queue', dismissedAt: NOW, title: 't', company: 'c' }),
    ]);

    expect((await restoreJob({ jobId: 'gone::from::queue' }, { dismissals })).status).toBe(
      'restored',
    );
  });

  it('reports restoring something that was never dismissed', async () => {
    expect((await restoreJob({ jobId: 'nope' }, { dismissals })).status).toBe('not_dismissed');
  });
});

describe('applying to a dismissed offer', () => {
  /*
   * The conflict in the other direction, and it resolves the opposite way.
   *
   * Applying is an unambiguous statement of interest that supersedes an earlier
   * "not interested". Leaving the offer both applied and dismissed would file it
   * in the hidden section, where its outcome form is unreachable and the stats
   * panel would count an application the human can no longer follow up - the
   * exact broken state the dismissal refusal above exists to prevent.
   */
  it('restores it automatically, because applying supersedes a dismissal', async () => {
    await dismissJob({ jobId: 'acme::junior frontend::madrid' }, deps());

    const result = await recordApplication(
      { jobId: 'acme::junior frontend::madrid' },
      {
        repository: applications,
        loadQueue: async () => QUEUE,
        now: () => NOW,
        dismissals,
      },
    );

    expect(result).toMatchObject({ status: 'recorded', restoredFromDismissal: true });
    expect(await dismissals.list()).toEqual([]);
  });

  it('reports no restoration when the offer was never dismissed', async () => {
    const result = await recordApplication(
      { jobId: 'acme::junior frontend::madrid' },
      { repository: applications, loadQueue: async () => QUEUE, now: () => NOW, dismissals },
    );

    expect(result).toMatchObject({ status: 'recorded', restoredFromDismissal: false });
  });

  it('still works with no dismissal store wired in at all (the CLI path)', async () => {
    const result = await recordApplication(
      { jobId: 'acme::junior frontend::madrid' },
      { repository: applications, loadQueue: async () => QUEUE, now: () => NOW },
    );

    expect(result).toMatchObject({ status: 'recorded', restoredFromDismissal: false });
  });
});
