import { describe, expect, it } from 'vitest';
import {
  createApplication,
  withOutcome,
  type Application,
  type JobQueue,
  type QueueEntry,
} from '@job-queue/core';
import { loadDashboard, type DashboardDeps } from '@/server/dashboard';
import { createStubDismissals, createStubRepository } from './helpers/stub-repository';

const NOW = new Date('2026-09-07T12:00:00.000Z');

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'job-1',
    score: 80,
    cvVariant: 'frontend',
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: [],
      cvVariant: 'frontend',
      englishRequired: 'not_stated',
      workMode: 'onsite',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: 'Junior Frontend Developer',
    company: 'ACME',
    location: 'Madrid',
    url: 'https://example.test/1',
    postedAt: NOW.toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    // Not checked: these fixtures make no claim about link liveness.
    liveness: null,
    ...overrides,
  };
}

function queue(entries: readonly QueueEntry[] = [entry()]): JobQueue {
  return {
    generatedAt: NOW.toISOString(),
    candidate: 'Alex Example',
    totalFetched: entries.length,
    totalUnique: entries.length,
    totalRelevant: 1,
    totalJuniorEligible: entries.length,
    excluded: [],
    duplicatesRemoved: 0,
    sourceReports: [],
    jobs: entries,
  };
}

const FALLBACK = queue([entry({ id: 'fallback-job', title: 'Offline sample job' })]);

function deps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return {
    queueReader: { read: async () => queue() },
    applicationRepository: createStubRepository([]),
    // Dismissals are a required dependency of the read model on purpose: a
    // composition that forgot one would silently resurface every offer the
    // human already rejected, and silence is the failure mode this codebase
    // spends the most effort refusing.
    dismissalRepository: createStubDismissals([]),
    buildFallbackQueue: async () => FALLBACK,
    now: () => NOW,
    ...overrides,
  };
}

const APPLIED: Application = withOutcome(
  createApplication({
    jobId: 'job-1',
    appliedAt: NOW,
    cvVariant: 'frontend',
    scoreAtApply: 80,
  }),
  'interview',
  NOW,
);

describe('loadDashboard', () => {
  it('renders the persisted run when one exists', async () => {
    const dashboard = await loadDashboard(deps());
    expect(dashboard.origin).toBe('persisted-run');
    expect(dashboard.queue.jobs[0]?.id).toBe('job-1');
  });

  it('falls back to the offline catalogue when no run was persisted', async () => {
    const dashboard = await loadDashboard(deps({ queueReader: { read: async () => null } }));

    expect(dashboard.origin).toBe('offline-fallback');
    expect(dashboard.queue.jobs[0]?.title).toBe('Offline sample job');
  });

  it('degrades instead of crashing when the queue file is corrupt', async () => {
    const dashboard = await loadDashboard(
      deps({
        queueReader: {
          read: async () => {
            throw new Error('not valid JSON');
          },
        },
      }),
    );

    expect(dashboard.origin).toBe('offline-fallback');
    expect(dashboard.warnings.some((warning) => warning.includes('not valid JSON'))).toBe(true);
    expect(dashboard.queue.jobs).toHaveLength(1);
  });

  it('degrades instead of crashing when the application log is unreadable', async () => {
    const dashboard = await loadDashboard(
      deps({
        applicationRepository: {
          ...createStubRepository([]),
          list: async () => {
            throw new Error('log is corrupt');
          },
        },
      }),
    );

    expect(dashboard.warnings.some((warning) => warning.includes('log is corrupt'))).toBe(true);
    expect(dashboard.queue.jobs[0]?.applicationStatus).toBe('not_applied');
    expect(dashboard.stats.totalApplied).toBe(0);
  });

  it('overlays the live application status onto the persisted queue', async () => {
    const dashboard = await loadDashboard(
      deps({ applicationRepository: createStubRepository([APPLIED]) }),
    );

    expect(dashboard.queue.jobs[0]?.applicationStatus).toBe('interview');
    expect(dashboard.stats.totalApplied).toBe(1);
    expect(dashboard.stats.responseRate).toBe(1);
  });

  it('marks an already-applied job rather than removing it from the list', async () => {
    const dashboard = await loadDashboard(
      deps({ applicationRepository: createStubRepository([APPLIED]) }),
    );
    expect(dashboard.queue.jobs).toHaveLength(1);
  });

  it('ignores stale status baked into the persisted queue file', async () => {
    const stale = queue([entry({ applicationStatus: 'offer', appliedAt: NOW.toISOString() })]);
    const dashboard = await loadDashboard(deps({ queueReader: { read: async () => stale } }));

    expect(dashboard.queue.jobs[0]?.applicationStatus).toBe('not_applied');
  });
});

/**
 * SAMPLE DATA IN THE SCREEN THE USER READS.
 *
 * The page already had an amber "these are not real offers" banner, but it was
 * wired to `origin === 'offline-fallback'` - the app being honest about the one
 * case it happened to know about. It was blind to the case that actually
 * shipped: a PERSISTED queue containing invented postings, which is exactly
 * what `npm start -- --source=all` wrote before the fix, and what any queue
 * file from an older build still holds.
 *
 * So the answer is computed from the DATA rather than from where the data came
 * from, and it is computed here on the server so a component cannot forget to.
 */
describe('sample-data detection', () => {
  const SAMPLE_REF = {
    sourceId: 'fixture',
    externalId: 'fx-010',
    url: 'https://example-board.test/offers/fx-010',
  };
  const REAL_REF = {
    sourceId: 'greenhouse',
    externalId: '4471203',
    url: 'https://job-boards.greenhouse.io/acme/jobs/4471203',
  };

  it('reports zero for a persisted queue of real postings', async () => {
    const real = queue([entry({ sources: [REAL_REF] })]);
    const dashboard = await loadDashboard(deps({ queueReader: { read: async () => real } }));

    expect(dashboard.origin).toBe('persisted-run');
    expect(dashboard.sampleDataCount).toBe(0);
  });

  it('COUNTS sample postings inside a persisted run, which the origin flag cannot see', async () => {
    const leaked = queue([entry({ id: 'fx', sources: [SAMPLE_REF] }), entry({ id: 'gh', sources: [REAL_REF] })]);
    const dashboard = await loadDashboard(deps({ queueReader: { read: async () => leaked } }));

    // The old signal says "this is a real run", and it is right - the run WAS
    // real. One of its rows is still invented.
    expect(dashboard.origin).toBe('persisted-run');
    expect(dashboard.sampleDataCount).toBe(1);
  });

  it('counts them in the offline fallback too', async () => {
    const dashboard = await loadDashboard(
      deps({
        queueReader: { read: async () => null },
        buildFallbackQueue: async () => queue([entry({ sources: [SAMPLE_REF] })]),
      }),
    );

    expect(dashboard.origin).toBe('offline-fallback');
    expect(dashboard.sampleDataCount).toBe(1);
  });

  it('treats a posting with no recorded source as real rather than crying wolf', async () => {
    const dashboard = await loadDashboard(deps());
    expect(dashboard.sampleDataCount).toBe(0);
  });
});
