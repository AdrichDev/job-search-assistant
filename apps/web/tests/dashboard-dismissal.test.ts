import { describe, expect, it } from 'vitest';
import {
  createDismissal,
  type Dismissal,
  type DismissalRepository,
  type JobQueue,
  type QueueEntry,
  type QueueReader,
} from '@job-queue/core';
import { loadDashboard, type DashboardDeps } from '@/server/dashboard';
import { createStubRepository } from './helpers/stub-repository';


/**
 * What a page render sees once dismissals exist.
 *
 * The rule under test is that a dismissed offer is GONE FROM THE LIST and
 * PRESENT IN THE REVIEW SECTION - never gone from both, which would be the
 * silent loss this whole design refuses.
 */

const NOW = new Date('2026-03-10T09:00:00.000Z');

function entry(id: string, title: string): QueueEntry {
  return {
    rank: 1,
    id,
    score: 50,
    cvVariant: 'general',
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: [],
      cvVariant: 'general',
      englishRequired: 'not_stated',
      workMode: 'unknown',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title,
    company: 'ACME',
    location: 'Madrid',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    postedAt: NOW.toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    liveness: null,
  };
}

const QUEUE: JobQueue = {
  generatedAt: NOW.toISOString(),
  candidate: 'Adrian',
  totalFetched: 2,
  totalUnique: 2,
  totalRelevant: 2,
  totalJuniorEligible: 2,
  duplicatesRemoved: 0,
  sourceReports: [],
  excluded: [],
  jobs: [entry('a::b::c', 'Junior Frontend Developer'), entry('d::e::f', 'Junior Backend')],
};

function reader(queue: JobQueue | null): QueueReader {
  return { read: async () => queue };
}

function dismissalStore(rows: readonly Dismissal[]): DismissalRepository {
  return {
    list: async () => rows,
    findByJobId: async (jobId) => rows.find((row) => row.jobId === jobId) ?? null,
    dismiss: async () => {
      throw new Error('The dashboard read model must not write dismissals.');
    },
    restore: async () => {
      throw new Error('The dashboard read model must not write dismissals.');
    },
  };
}

function deps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return {
    queueReader: reader(QUEUE),
    applicationRepository: createStubRepository([]),
    dismissalRepository: dismissalStore([]),
    buildFallbackQueue: async () => QUEUE,
    now: () => NOW,
    ...overrides,
  };
}

const DISMISSED_A = createDismissal({
  jobId: 'a::b::c',
  dismissedAt: NOW,
  title: 'Junior Frontend Developer',
  company: 'ACME',
});

describe('loadDashboard with dismissals', () => {
  it('shows every offer when nothing was dismissed', async () => {
    const data = await loadDashboard(deps());

    expect(data.queue.jobs).toHaveLength(2);
    expect(data.dismissed).toEqual([]);
  });

  it('removes a dismissed offer from the rendered queue', async () => {
    const data = await loadDashboard(deps({ dismissalRepository: dismissalStore([DISMISSED_A]) }));

    expect(data.queue.jobs.map((job) => job.id)).toEqual(['d::e::f']);
  });

  it('lists the dismissed offer so it can be reviewed and restored', async () => {
    const data = await loadDashboard(deps({ dismissalRepository: dismissalStore([DISMISSED_A]) }));

    expect(data.dismissed).toHaveLength(1);
    expect(data.dismissed[0]).toMatchObject({
      jobId: 'a::b::c',
      title: 'Junior Frontend Developer',
      inQueue: true,
    });
  });

  /**
   * The headline count has to agree with the list under it. Reporting the
   * pre-dismissal total would tell the human there are offers they cannot find.
   */
  it('reports the offer total NET of dismissals', async () => {
    const data = await loadDashboard(deps({ dismissalRepository: dismissalStore([DISMISSED_A]) }));

    expect(data.queue.totalJuniorEligible).toBe(1);
  });

  /**
   * Same posture as the application log: a broken side store costs the overlay,
   * never the job list. Blanking the screen because a preferences file is
   * unreadable would be a far worse failure than showing an offer twice.
   */
  it('still renders every offer when the dismissal log cannot be read', async () => {
    const broken: DismissalRepository = {
      ...dismissalStore([]),
      list: async () => {
        throw new Error('dismissal log unreadable');
      },
    };

    const data = await loadDashboard(deps({ dismissalRepository: broken }));

    expect(data.queue.jobs).toHaveLength(2);
    expect(data.dismissed).toEqual([]);
    expect(data.warnings.join(' ')).toMatch(/dismissal/i);
  });

  it('applies dismissals to the offline fallback queue too', async () => {
    const data = await loadDashboard(
      deps({
        queueReader: reader(null),
        dismissalRepository: dismissalStore([DISMISSED_A]),
      }),
    );

    expect(data.origin).toBe('offline-fallback');
    expect(data.queue.jobs.map((job) => job.id)).toEqual(['d::e::f']);
  });
});
