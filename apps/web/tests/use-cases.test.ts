import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJsonApplicationRepository,
  type ApplicationRepository,
  type JobQueue,
  type QueueEntry,
} from '@job-queue/core';
import { applyToJob, setOutcome, type WriteDeps } from '@/server/use-cases';

/**
 * The two paths worth testing at this layer: apply idempotency and outcome
 * validation. Presentational markup is deliberately not covered.
 *
 * Uses the REAL JSON repository against a temp directory, because the point of
 * the idempotency test is that a double click produces one record on disk.
 */

const NOW = new Date('2026-09-07T12:00:00.000Z');

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'acme::junior frontend::madrid',
    score: 87.6,
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
    company: 'ACME',
    location: 'Madrid',
    url: 'https://example.test/jobs/1',
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

const QUEUE: JobQueue = {
  generatedAt: NOW.toISOString(),
  candidate: 'Alex Example',
  totalFetched: 1,
  totalUnique: 1,
  totalRelevant: 1,
  totalJuniorEligible: 1,
  excluded: [],
  duplicatesRemoved: 0,
  sourceReports: [],
  jobs: [entry()],
};

let directory: string;
let logPath: string;
let repository: ApplicationRepository;
let deps: WriteDeps;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'web-usecases-'));
  logPath = join(directory, 'applications.json');
  repository = createJsonApplicationRepository({ filePath: logPath });
  deps = {
    applicationRepository: repository,
    loadQueue: async () => QUEUE,
    now: () => NOW,
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('applyToJob', () => {
  it('records an application and reports success', async () => {
    const result = await applyToJob(QUEUE.jobs[0]?.id, deps);

    expect(result).toEqual({ ok: true, message: 'Application recorded.' });
    expect(await repository.list()).toHaveLength(1);
  });

  it('writes the application to disk with the server-side score and CV variant', async () => {
    await applyToJob(QUEUE.jobs[0]?.id, deps);
    const stored: unknown = JSON.parse(await readFile(logPath, 'utf8'));

    expect(stored).toMatchObject({
      version: 1,
      applications: [
        {
          jobId: 'acme::junior frontend::madrid',
          cvVariant: 'frontend',
          scoreAtApply: 87.6,
          outcome: 'applied',
        },
      ],
    });
  });

  it('is idempotent: two clicks produce exactly one application', async () => {
    const first = await applyToJob(QUEUE.jobs[0]?.id, deps);
    const second = await applyToJob(QUEUE.jobs[0]?.id, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.message).toBe('Already recorded earlier.');
    expect(await repository.list()).toHaveLength(1);
  });

  it('is idempotent even when both clicks race', async () => {
    await Promise.all([
      applyToJob(QUEUE.jobs[0]?.id, deps),
      applyToJob(QUEUE.jobs[0]?.id, deps),
      applyToJob(QUEUE.jobs[0]?.id, deps),
    ]);

    expect(await repository.list()).toHaveLength(1);
  });

  it('refuses a job id that is not in the server-side queue', async () => {
    const result = await applyToJob('forged-job-id', deps);

    expect(result.ok).toBe(false);
    expect(await repository.list()).toEqual([]);
  });

  it('refuses a non-string job id from a malformed request', async () => {
    expect((await applyToJob(undefined, deps)).ok).toBe(false);
    expect((await applyToJob(42, deps)).ok).toBe(false);
  });

  it('reports a missing queue instead of writing a bogus record', async () => {
    const result = await applyToJob(QUEUE.jobs[0]?.id, {
      ...deps,
      loadQueue: async () => null,
    });

    expect(result.ok).toBe(false);
    expect(await repository.list()).toEqual([]);
  });
});

describe('setOutcome', () => {
  it('updates the outcome of an applied job', async () => {
    await applyToJob(QUEUE.jobs[0]?.id, deps);
    const result = await setOutcome(QUEUE.jobs[0]?.id, 'interview', undefined, deps);

    expect(result.ok).toBe(true);
    expect((await repository.findByJobId(QUEUE.jobs[0]?.id ?? ''))?.outcome).toBe('interview');
  });

  it('stores notes alongside the outcome', async () => {
    await applyToJob(QUEUE.jobs[0]?.id, deps);
    await setOutcome(QUEUE.jobs[0]?.id, 'screening', 'call on Friday', deps);

    expect((await repository.findByJobId(QUEUE.jobs[0]?.id ?? ''))?.notes).toBe('call on Friday');
  });

  it('rejects an outcome value the domain does not define', async () => {
    await applyToJob(QUEUE.jobs[0]?.id, deps);
    const result = await setOutcome(QUEUE.jobs[0]?.id, 'hired', undefined, deps);

    expect(result).toEqual({ ok: false, message: 'That is not a valid outcome.' });
    expect((await repository.findByJobId(QUEUE.jobs[0]?.id ?? ''))?.outcome).toBe('applied');
  });

  it('refuses to set an outcome on a job that was never applied to', async () => {
    const result = await setOutcome(QUEUE.jobs[0]?.id, 'offer', undefined, deps);
    expect(result.ok).toBe(false);
  });
});
