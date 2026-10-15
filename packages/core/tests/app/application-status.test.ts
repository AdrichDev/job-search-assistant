import { describe, expect, it } from 'vitest';
import { statusFieldsFor, withApplicationStatus } from '../../src/app/application-status.js';
import { createApplication, withOutcome } from '../../src/domain/application.js';
import { indexApplicationsByJobId } from '../../src/domain/application.js';
import type { JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';
import { REFERENCE_NOW, daysAgo } from '../helpers/make-job.js';

const APPLIED = createApplication({
  jobId: 'job-1',
  appliedAt: daysAgo(3),
  cvVariant: 'frontend',
  scoreAtApply: 81,
});

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'job-1',
    score: 81,
    cvVariant: 'frontend',
    title: 'Junior Frontend Developer',
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
      cvVariant: 'frontend',
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

function queue(entries: readonly QueueEntry[]): JobQueue {
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

describe('statusFieldsFor', () => {
  it('reports a job that was never applied to', () => {
    const fields = statusFieldsFor('job-9', indexApplicationsByJobId([APPLIED]));
    expect(fields.applicationStatus).toBe('not_applied');
    expect(fields.appliedAt).toBeNull();
  });

  it('reports the current outcome of an applied job', () => {
    const updated = withOutcome(APPLIED, 'interview', daysAgo(1));
    const fields = statusFieldsFor('job-1', indexApplicationsByJobId([updated]));

    expect(fields.applicationStatus).toBe('interview');
    expect(fields.appliedAt).toBe(daysAgo(3).toISOString());
    expect(fields.outcomeUpdatedAt).toBe(daysAgo(1).toISOString());
  });

  it('serializes notes as null rather than dropping the key', () => {
    const fields = statusFieldsFor('job-1', indexApplicationsByJobId([APPLIED]));
    expect(fields.notes).toBeNull();
  });
});

describe('withApplicationStatus', () => {
  it('marks an already-applied job instead of dropping it from the queue', () => {
    const decorated = withApplicationStatus(queue([entry()]), [APPLIED]);

    expect(decorated.jobs).toHaveLength(1);
    expect(decorated.jobs[0]?.applicationStatus).toBe('applied');
  });

  it('leaves untouched jobs as not applied', () => {
    const decorated = withApplicationStatus(queue([entry({ id: 'other' })]), [APPLIED]);
    expect(decorated.jobs[0]?.applicationStatus).toBe('not_applied');
  });

  it('overwrites stale status baked into a persisted queue file', () => {
    const stale = entry({ applicationStatus: 'offer', appliedAt: REFERENCE_NOW.toISOString() });
    const decorated = withApplicationStatus(queue([stale]), []);

    expect(decorated.jobs[0]?.applicationStatus).toBe('not_applied');
    expect(decorated.jobs[0]?.appliedAt).toBeNull();
  });

  it('preserves every other field of the queue', () => {
    const decorated = withApplicationStatus(queue([entry()]), [APPLIED]);
    expect(decorated.generatedAt).toBe(REFERENCE_NOW.toISOString());
    expect(decorated.jobs[0]?.title).toBe('Junior Frontend Developer');
  });
});
