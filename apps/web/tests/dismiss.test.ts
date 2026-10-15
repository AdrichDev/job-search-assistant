import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJsonApplicationRepository,
  createJsonDismissalRepository,
  partitionByDismissal,
  type ApplicationRepository,
  type DismissalRepository,
  type JobQueue,
  type QueueEntry,
} from '@job-queue/core';
import { applyToJob, dismissOffer, restoreOffer, type WriteDeps } from '@/server/use-cases';

/**
 * The dismiss write path, against the REAL JSON stores in a temp directory.
 *
 * Real stores rather than fakes, because every claim worth making here is about
 * what ends up on disk: that a double click leaves one row, that a restore
 * leaves none, and that a dismissal is still there after the pipeline runs
 * again. A stub would prove the use case calls a method.
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

const SECOND = entry({
  id: 'kubo labs::desarrollador junior net::alcobendas',
  title: 'Desarrollador Junior .NET',
  company: 'Kubo Labs',
  location: 'Alcobendas',
  rank: 2,
});

function queue(jobs: readonly QueueEntry[]): JobQueue {
  return {
    generatedAt: NOW.toISOString(),
    candidate: 'Adrian',
    totalFetched: jobs.length,
    totalUnique: jobs.length,
    totalRelevant: jobs.length,
    totalJuniorEligible: jobs.length,
    duplicatesRemoved: 0,
    sourceReports: [],
    excluded: [],
    jobs,
  };
}

const QUEUE = queue([entry(), SECOND]);
const JOB_ID = 'acme::junior frontend::madrid';

let directory: string;
let dismissalPath: string;
let dismissals: DismissalRepository;
let applications: ApplicationRepository;
let deps: WriteDeps;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'web-dismiss-'));
  dismissalPath = join(directory, 'dismissals.json');
  dismissals = createJsonDismissalRepository({ filePath: dismissalPath });
  applications = createJsonApplicationRepository({
    filePath: join(directory, 'applications.json'),
  });
  deps = {
    applicationRepository: applications,
    dismissalRepository: dismissals,
    loadQueue: async () => QUEUE,
    now: () => NOW,
  };
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('dismissOffer', () => {
  it('records the dismissal and reports success', async () => {
    const result = await dismissOffer(JOB_ID, deps);

    expect(result).toEqual({ ok: true, message: 'Offer dismissed.' });
    expect(await dismissals.list()).toHaveLength(1);
  });

  it('writes the dismissal to disk with the server-side snapshot', async () => {
    await dismissOffer(JOB_ID, deps);
    const stored: unknown = JSON.parse(await readFile(dismissalPath, 'utf8'));

    expect(stored).toMatchObject({
      version: 1,
      dismissals: [
        {
          jobId: JOB_ID,
          title: 'Junior Frontend Developer',
          company: 'ACME Digital',
          dismissedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it('hides the offer from the visible queue immediately', async () => {
    await dismissOffer(JOB_ID, deps);

    const { visible, dismissed } = partitionByDismissal(QUEUE, await dismissals.list());

    expect(visible.map((row) => row.id)).toEqual([SECOND.id]);
    expect(dismissed.map((row) => row.jobId)).toEqual([JOB_ID]);
  });

  it('is idempotent: two clicks produce exactly ONE dismissal', async () => {
    const first = await dismissOffer(JOB_ID, deps);
    const second = await dismissOffer(JOB_ID, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.message).toBe('Already dismissed earlier.');
    expect(await dismissals.list()).toHaveLength(1);
  });

  it('is idempotent even when three clicks race', async () => {
    await Promise.all([
      dismissOffer(JOB_ID, deps),
      dismissOffer(JOB_ID, deps),
      dismissOffer(JOB_ID, deps),
    ]);

    expect(await dismissals.list()).toHaveLength(1);
  });

  it('refuses a job id that is not in the server-side queue', async () => {
    const result = await dismissOffer('forged::job::id', deps);

    expect(result.ok).toBe(false);
    expect(await dismissals.list()).toEqual([]);
  });

  it('refuses a non-string job id from a malformed request', async () => {
    expect((await dismissOffer(undefined, deps)).ok).toBe(false);
    expect((await dismissOffer(42, deps)).ok).toBe(false);
  });

  it('reports a missing queue instead of writing an unverifiable row', async () => {
    const result = await dismissOffer(JOB_ID, { ...deps, loadQueue: async () => null });

    expect(result.ok).toBe(false);
    expect(await dismissals.list()).toEqual([]);
  });

  /*
   * THE CONFLICT. Decided in `dismiss-job.ts`; asserted here as the message the
   * human actually reads, which must point at the move that does work.
   */
  it('refuses to dismiss an offer that was already applied to', async () => {
    await applyToJob(JOB_ID, deps);

    const result = await dismissOffer(JOB_ID, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      'You already applied to this offer. Set its outcome instead of dismissing it.',
    );
    expect(await dismissals.list()).toEqual([]);
  });

  /**
   * SURVIVES A RE-RUN. The pipeline writes a brand-new queue; the dismissal
   * lives in its own store and keys on the same content fingerprint, so the same
   * vacancy is hidden again with no pipeline involvement.
   */
  it('keeps the offer hidden in a queue produced by a later pipeline run', async () => {
    await dismissOffer(JOB_ID, deps);

    const rerun = queue([
      { ...entry(), postedAt: '2026-03-20T09:00:00.000Z' },
      { ...SECOND, postedAt: '2026-03-20T09:00:00.000Z' },
      entry({ id: 'nubeo::becario::remoto', title: 'Becario', company: 'Nubeo', rank: 3 }),
    ]);

    const { visible } = partitionByDismissal(rerun, await dismissals.list());
    expect(visible.map((row) => row.id)).toEqual([SECOND.id, 'nubeo::becario::remoto']);
  });

  it('survives a fresh repository over the same file, as a server restart would', async () => {
    await dismissOffer(JOB_ID, deps);

    const reopened = createJsonDismissalRepository({ filePath: dismissalPath });
    expect((await reopened.list()).map((row) => row.jobId)).toEqual([JOB_ID]);
  });
});

describe('restoreOffer', () => {
  it('brings the offer back into the visible queue', async () => {
    await dismissOffer(JOB_ID, deps);

    const result = await restoreOffer(JOB_ID, deps);

    expect(result).toEqual({ ok: true, message: 'Offer restored.' });
    expect(partitionByDismissal(QUEUE, await dismissals.list()).visible).toHaveLength(2);
  });

  it('reports restoring something that was never dismissed', async () => {
    const result = await restoreOffer(JOB_ID, deps);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('That offer was not dismissed.');
  });

  it('refuses a non-string job id', async () => {
    expect((await restoreOffer(undefined, deps)).ok).toBe(false);
  });

  it('restores only the requested offer', async () => {
    await dismissOffer(JOB_ID, deps);
    await dismissOffer(SECOND.id, deps);

    await restoreOffer(JOB_ID, deps);

    expect((await dismissals.list()).map((row) => row.jobId)).toEqual([SECOND.id]);
  });
});

describe('applying to an offer that was dismissed', () => {
  it('restores it, because applying supersedes an earlier no', async () => {
    await dismissOffer(JOB_ID, deps);

    const result = await applyToJob(JOB_ID, deps);

    expect(result.ok).toBe(true);
    expect(await dismissals.list()).toEqual([]);
    // And it is visible again, where its outcome form can be reached.
    expect(partitionByDismissal(QUEUE, await dismissals.list()).visible).toHaveLength(2);
  });
});
