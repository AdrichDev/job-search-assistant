import { describe, expect, it } from 'vitest';
import { recordApplication } from '../../src/app/record-application.js';
import { updateApplicationOutcome } from '../../src/app/update-application-outcome.js';
import { createInMemoryApplicationRepository } from '../helpers/in-memory-application-repository.js';
import type { JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';
import { REFERENCE_NOW, daysAgo } from '../helpers/make-job.js';

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'job-1',
    score: 81.4,
    cvVariant: 'microsoft',
    title: 'Junior Power Platform Developer',
    company: 'ACME',
    location: 'Madrid',
    url: 'https://example.test/1',
    postedAt: REFERENCE_NOW.toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    // Not checked. Every fixture here predates liveness and makes no claim.
    liveness: null,
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: [],
      cvVariant: 'microsoft',
      englishRequired: 'not_stated',
      workMode: 'onsite',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    ...overrides,
  };
}

function queue(entries: readonly QueueEntry[] = [entry()]): JobQueue {
  return {
    generatedAt: REFERENCE_NOW.toISOString(),
    candidate: 'Alex Example',
    totalFetched: entries.length,
    totalUnique: entries.length,
    totalRelevant: 1,
    totalJuniorEligible: 1,
    excluded: [],
    duplicatesRemoved: 0,
    sourceReports: [],
    jobs: entries,
  };
}

function deps(overrides: Partial<Parameters<typeof recordApplication>[1]> = {}) {
  return {
    repository: createInMemoryApplicationRepository(),
    loadQueue: async (): Promise<JobQueue | null> => queue(),
    now: () => REFERENCE_NOW,
    ...overrides,
  };
}

describe('recordApplication', () => {
  it('records an application for a job present in the queue', async () => {
    const result = await recordApplication({ jobId: 'job-1' }, deps());

    expect(result.status).toBe('recorded');
    if (result.status === 'recorded') {
      expect(result.created).toBe(true);
      expect(result.application.jobId).toBe('job-1');
    }
  });

  it('derives the CV variant and score from the SERVER queue, never from the caller', async () => {
    const result = await recordApplication({ jobId: 'job-1' }, deps());

    expect(result.status).toBe('recorded');
    if (result.status === 'recorded') {
      expect(result.application.cvVariant).toBe('microsoft');
      expect(result.application.scoreAtApply).toBe(81.4);
    }
  });

  it('captures the source ids of the vacancy from the SERVER queue', async () => {
    const sources = [
      { sourceId: 'adzuna', externalId: '1', url: 'https://example.test/a' },
      { sourceId: 'manfred', externalId: '2', url: 'https://example.test/b' },
    ];
    const result = await recordApplication(
      { jobId: 'job-1' },
      deps({ loadQueue: async () => queue([entry({ sources })]) }),
    );

    expect(result.status).toBe('recorded');
    if (result.status === 'recorded') {
      expect(result.application.sourceIds).toEqual(['adzuna', 'manfred']);
    }
  });

  it('is idempotent: applying twice yields one application', async () => {
    const shared = deps();

    const first = await recordApplication({ jobId: 'job-1' }, shared);
    const second = await recordApplication({ jobId: 'job-1' }, shared);

    expect(first.status).toBe('recorded');
    expect(second.status).toBe('recorded');
    if (first.status === 'recorded' && second.status === 'recorded') {
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    }
    expect(await shared.repository.list()).toHaveLength(1);
  });

  it('stays idempotent when both clicks land at the same time', async () => {
    const shared = deps();
    const results = await Promise.all([
      recordApplication({ jobId: 'job-1' }, shared),
      recordApplication({ jobId: 'job-1' }, shared),
      recordApplication({ jobId: 'job-1' }, shared),
    ]);

    const created = results.filter(
      (result) => result.status === 'recorded' && result.created,
    );
    expect(created).toHaveLength(1);
    expect(await shared.repository.list()).toHaveLength(1);
  });

  it('refuses a job id that is not in the queue', async () => {
    const result = await recordApplication({ jobId: 'not-a-job' }, deps());
    expect(result.status).toBe('unknown_job');
  });

  it('refuses an empty job id without touching the repository', async () => {
    const shared = deps();
    const result = await recordApplication({ jobId: '   ' }, shared);

    expect(result.status).toBe('unknown_job');
    expect(await shared.repository.list()).toEqual([]);
  });

  it('reports an unavailable queue instead of inventing an application', async () => {
    const result = await recordApplication(
      { jobId: 'job-1' },
      deps({ loadQueue: async () => null }),
    );
    expect(result.status).toBe('queue_unavailable');
  });
});

describe('updateApplicationOutcome', () => {
  it('updates the outcome of an applied job', async () => {
    const shared = deps();
    await recordApplication({ jobId: 'job-1' }, shared);

    const result = await updateApplicationOutcome(
      { jobId: 'job-1', outcome: 'interview' },
      shared,
    );

    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.application.outcome).toBe('interview');
    }
  });

  it('rejects an outcome value that is not part of the domain', async () => {
    const shared = deps();
    await recordApplication({ jobId: 'job-1' }, shared);

    const result = await updateApplicationOutcome(
      { jobId: 'job-1', outcome: 'hired-immediately' },
      shared,
    );

    expect(result.status).toBe('invalid_outcome');
  });

  it('reports a job that was never applied to', async () => {
    const result = await updateApplicationOutcome(
      { jobId: 'job-1', outcome: 'offer' },
      deps(),
    );
    expect(result.status).toBe('not_applied');
  });

  it('stamps the update with the injected clock', async () => {
    const shared = deps({ now: () => daysAgo(-5) });
    await recordApplication({ jobId: 'job-1' }, shared);

    const result = await updateApplicationOutcome(
      { jobId: 'job-1', outcome: 'rejected' },
      shared,
    );

    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.application.outcomeUpdatedAt.getTime()).toBe(daysAgo(-5).getTime());
    }
  });

  it('carries notes through to the stored application', async () => {
    const shared = deps();
    await recordApplication({ jobId: 'job-1' }, shared);

    await updateApplicationOutcome(
      { jobId: 'job-1', outcome: 'screening', notes: 'call scheduled' },
      shared,
    );

    expect((await shared.repository.findByJobId('job-1'))?.notes).toBe('call scheduled');
  });
});
