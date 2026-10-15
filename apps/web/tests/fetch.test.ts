import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createJsonFileQueueReader,
  createJsonFileQueueWriter,
  createJsonRunStateStore,
  persistQueue,
  summarizeRun,
  type FetchRunSummary,
  type JobQueue,
  type Logger,
  type PipelineRunner,
  type RunStateStore,
} from '@job-queue/core';
import { readFetchState, startFetch, type FetchDeps } from '@/server/use-cases';

/**
 * The fetch write path.
 *
 * The two claims that matter are both about what a SECOND request sees:
 * single-flight (it must not start a second pipeline) and honest state (it must
 * be able to tell "still working" from "finished"). Everything else here exists
 * to make sure a bad run cannot take the previous queue down with it.
 */

const START = new Date('2026-03-10T09:00:00.000Z');

const SUMMARY: FetchRunSummary = {
  outcome: 'written',
  totalFetched: 137,
  totalUnique: 120,
  duplicatesRemoved: 17,
  excludedNotSoftware: 30,
  excludedNotJunior: 26,
  removedAsGone: 1,
  offersAvailable: 63,
  failedSources: [],
  warnings: [],
  refusalReason: null,
  preservedJobCount: null,
};

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function deferredRunner(): {
  readonly runner: PipelineRunner;
  readonly finish: (summary: FetchRunSummary) => void;
  readonly fail: (error: Error) => void;
  readonly calls: () => number;
} {
  let resolveRun: (summary: FetchRunSummary) => void = () => undefined;
  let rejectRun: (error: Error) => void = () => undefined;
  let calls = 0;

  return {
    runner: {
      run: async () => {
        calls += 1;
        return new Promise<FetchRunSummary>((resolve, reject) => {
          resolveRun = resolve;
          rejectRun = reject;
        });
      },
    },
    finish: (summary) => resolveRun(summary),
    fail: (error) => rejectRun(error),
    calls: () => calls,
  };
}

let directory: string;
let store: RunStateStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'web-fetch-'));
  store = createJsonRunStateStore({ filePath: join(directory, '.fetch-run.json') });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function deps(runner: PipelineRunner, overrides: Partial<FetchDeps> = {}): FetchDeps {
  let counter = 0;
  return {
    runStateStore: store,
    pipelineRunner: runner,
    now: () => START,
    newRunId: () => `run-${(counter += 1)}`,
    logger: silentLogger,
    ...overrides,
  };
}

describe('startFetch', () => {
  it('reports idle before anything has been run', async () => {
    expect(await readFetchState(deps(deferredRunner().runner))).toEqual({ status: 'idle' });
  });

  it('starts a run and returns WITHOUT waiting for the pipeline', async () => {
    const { runner, finish } = deferredRunner();

    const result = await startFetch(deps(runner));

    expect(result).toMatchObject({ ok: true, message: 'Fetch run started.' });
    // Back here while the pipeline is still going: this is the non-blocking claim.
    expect(await readFetchState(deps(runner))).toMatchObject({ status: 'running' });

    finish(SUMMARY);
    await result.completion;
  });

  /* SINGLE-FLIGHT, enforced in the server rather than by a disabled button. */
  it('a second overlapping request does NOT start a second run', async () => {
    const { runner, finish, calls } = deferredRunner();

    const first = await startFetch(deps(runner));
    const second = await startFetch(deps(runner));

    expect(second.ok).toBe(false);
    expect(second.message).toBe('A fetch run is already in progress.');
    expect(calls()).toBe(1);

    finish(SUMMARY);
    await first.completion;
  });

  it('eight simultaneous requests result in exactly ONE run', async () => {
    const { runner, finish, calls } = deferredRunner();

    const results = await Promise.all(Array.from({ length: 8 }, () => startFetch(deps(runner))));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(calls()).toBe(1);

    finish(SUMMARY);
    await Promise.all(results.map((result) => result.completion));
  });

  /**
   * A second TAB is a second React tree with its own state. It shares only the
   * server, which is exactly why the lock has to live there.
   */
  it('a second store over the same file - a second tab - is refused too', async () => {
    const { runner, finish, calls } = deferredRunner();
    const first = await startFetch(deps(runner));

    const otherTab = createJsonRunStateStore({ filePath: join(directory, '.fetch-run.json') });
    const second = await startFetch(deps(runner, { runStateStore: otherTab }));

    expect(second.ok).toBe(false);
    expect(calls()).toBe(1);

    finish(SUMMARY);
    await first.completion;
  });

  it('moves from running to finished and publishes the summary', async () => {
    const { runner, finish } = deferredRunner();
    const started = await startFetch(deps(runner));

    expect(await readFetchState(deps(runner))).toMatchObject({ status: 'running' });

    finish(SUMMARY);
    await started.completion;

    expect(await readFetchState(deps(runner))).toMatchObject({
      status: 'finished',
      summary: { totalFetched: 137, offersAvailable: 63 },
    });
  });

  it('moves to failed and frees the button when the pipeline throws', async () => {
    const { runner, fail } = deferredRunner();
    const started = await startFetch(deps(runner));

    fail(new Error('Adzuna key expired'));
    await started.completion;

    expect(await readFetchState(deps(runner))).toMatchObject({
      status: 'failed',
      error: 'Adzuna key expired',
    });

    const { runner: next, finish } = deferredRunner();
    const again = await startFetch(deps(next));
    expect(again.ok).toBe(true);

    finish(SUMMARY);
    await again.completion;
  });

  it('lets the human run again once the previous run finished', async () => {
    const { runner, finish, calls } = deferredRunner();

    const first = await startFetch(deps(runner));
    finish(SUMMARY);
    await first.completion;

    const second = await startFetch(deps(runner));
    expect(second.ok).toBe(true);
    expect(calls()).toBe(2);

    finish(SUMMARY);
    await second.completion;
  });

  /* STALE LOCK. A crash must not disable the feature until somebody finds a dotfile. */
  it('recovers a run whose process died, once it is older than the timeout', async () => {
    const { runner: abandoned } = deferredRunner();
    await startFetch(deps(abandoned));

    const { runner: fresh, finish } = deferredRunner();
    const later = new Date(START.getTime() + 16 * 60 * 1000);
    const taken = await startFetch(deps(fresh, { now: () => later }));

    expect(taken.ok).toBe(true);

    finish(SUMMARY);
    await taken.completion;
  });

  it('does not recover a run that is merely slow', async () => {
    const { runner: slow, finish } = deferredRunner();
    const first = await startFetch(deps(slow));

    const later = new Date(START.getTime() + 14 * 60 * 1000);
    expect((await startFetch(deps(slow, { now: () => later }))).ok).toBe(false);

    finish(SUMMARY);
    await first.completion;
  });

  it('degrades a corrupt state file to idle rather than bricking the button', async () => {
    await writeFile(join(directory, '.fetch-run.json'), '{ broken', 'utf8');
    const { runner, finish } = deferredRunner();

    expect(await readFetchState(deps(runner))).toEqual({ status: 'idle' });
    const started = await startFetch(deps(runner));
    expect(started.ok).toBe(true);

    finish(SUMMARY);
    await started.completion;
  });
});

/**
 * The degraded-write guard, reached through the web path.
 *
 * This is the promise that a failed run cannot cost the human their data. It is
 * asserted against real files rather than a mocked decision, because the claim
 * is about what is on disk after a bad run.
 */
describe('a failed run and the existing queue', () => {
  const GOOD_QUEUE: JobQueue = {
    generatedAt: START.toISOString(),
    candidate: 'Adrian',
    totalFetched: 3,
    totalUnique: 3,
    totalRelevant: 3,
    totalJuniorEligible: 3,
    duplicatesRemoved: 0,
    sourceReports: [{ sourceId: 'greenhouse', query: 'x', status: 'ok', fetched: 3 }],
    excluded: [],
    jobs: [
      {
        rank: 1,
        id: 'acme::junior frontend::madrid',
        score: 61.4,
        cvVariant: 'frontend',
        requirements: {
          yearsRequired: null,
          senioritySignals: [],
          matchedStack: [],
          cvVariant: 'frontend',
          englishRequired: 'not_stated',
          workMode: 'unknown',
        },
        applicationStatus: 'not_applied',
        appliedAt: null,
        outcomeUpdatedAt: null,
        notes: null,
        title: 'Junior Frontend Developer',
        company: 'ACME Digital',
        location: 'Madrid',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
        postedAt: START.toISOString(),
        salaryMin: null,
        salaryMax: null,
        contractType: null,
        sources: [],
        breakdown: [],
        liveness: null,
      },
    ],
  };

  it('leaves the previous queue byte-for-byte intact when every source fails', async () => {
    const queuePath = join(directory, 'queue.json');
    const reader = createJsonFileQueueReader({ filePath: queuePath });
    const writer = createJsonFileQueueWriter({ filePath: queuePath });

    await writer.write(GOOD_QUEUE);
    const before = await readFile(queuePath, 'utf8');

    // A run that learned nothing because its sources were down.
    const brokenRun: JobQueue = {
      ...GOOD_QUEUE,
      totalFetched: 0,
      totalUnique: 0,
      totalRelevant: 0,
      totalJuniorEligible: 0,
      jobs: [],
      sourceReports: [
        {
          sourceId: 'adzuna',
          query: 'junior developer',
          status: 'failed',
          fetched: 0,
          error: 'HTTP 429',
        },
      ],
    };

    const runner: PipelineRunner = {
      run: async () => {
        const persisted = await persistQueue(brokenRun, {
          reader,
          writer,
          logger: silentLogger,
        });
        return summarizeRun(brokenRun, persisted);
      },
    };

    const started = await startFetch(deps(runner));
    await started.completion;

    expect(await readFile(queuePath, 'utf8')).toBe(before);

    const state = await readFetchState(deps(runner));
    expect(state).toMatchObject({
      status: 'finished',
      summary: { outcome: 'refused', preservedJobCount: 1 },
    });
  });
});
