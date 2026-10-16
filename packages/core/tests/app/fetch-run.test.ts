import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFetchRun, type StartFetchRunResult } from '../../src/app/fetch-run.js';
import { createJsonRunStateStore } from '../../src/adapters/persistence/json-run-state-store.js';
import type { Logger } from '../../src/ports/logger.js';
import type { PipelineRunner } from '../../src/ports/pipeline-runner.js';
import type { FetchRunSummary, RunStateStore } from '../../src/ports/run-state-store.js';

/**
 * "The human pressed Buscar ofertas."
 *
 * Two properties are worth more than everything else in this file:
 *
 *   SINGLE-FLIGHT. Two clicks, or two tabs, must never put two pipelines on the
 *   same queue file. Enforced in the SERVER, through an exclusive-create lock -
 *   a disabled button is a suggestion, not a guarantee, and it is not present
 *   at all in the second tab.
 *
 *   NON-BLOCKING. `startFetchRun` returns as soon as the lock is taken. The run
 *   itself is handed back as `completion` so a caller that cares (this test) can
 *   await it and a caller that does not (the server action) can let it finish
 *   in the background.
 */

const START = new Date('2026-03-10T09:00:00.000Z');

const SUMMARY: FetchRunSummary = {
  outcome: 'written',
  totalFetched: 137,
  totalUnique: 120,
  duplicatesRemoved: 17,
  excludedNotSoftware: 30,
  excludedNotJunior: 26,
  excludedByLocation: 9,
  excludedByExperience: 11,
  excludedBySeniority: 15,
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

/** A runner whose completion this test controls. */
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

/**
 * Narrows a start result to the branch under test.
 *
 * `strict` is on and `StartFetchRunResult` is a discriminated union, so a test
 * that reaches for `.completion` has to prove the run actually started. Throwing
 * here makes "it did not start" a clear test failure rather than a type error.
 */
function started(result: StartFetchRunResult): Extract<StartFetchRunResult, { status: 'started' }> {
  if (result.status !== 'started') {
    throw new Error(`expected the run to start, got "${result.status}"`);
  }
  return result;
}

let directory: string;
let store: RunStateStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fetchrun-'));
  store = createJsonRunStateStore({ filePath: join(directory, 'fetch-run.json') });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function deps(runner: PipelineRunner, overrides: Partial<Parameters<typeof startFetchRun>[0]> = {}) {
  let counter = 0;
  return {
    store,
    runner,
    now: () => START,
    newRunId: () => `run-${(counter += 1)}`,
    logger: silentLogger,
    ...overrides,
  };
}

describe('startFetchRun', () => {
  it('starts a run and reports it as running without waiting for it', async () => {
    const { runner, finish, calls } = deferredRunner();

    const result = await startFetchRun(deps(runner));

    expect(result.status).toBe('started');
    expect(calls()).toBe(1);
    // The key claim: we are back here while the pipeline is still going.
    expect(await store.read()).toMatchObject({ status: 'running' });

    finish(SUMMARY);
    await started(result).completion;
  });

  it('publishes the finished state with the run summary', async () => {
    const { runner, finish } = deferredRunner();
    const result = await startFetchRun(deps(runner));

    finish(SUMMARY);
    await started(result).completion;

    const state = await store.read();
    expect(state).toMatchObject({ status: 'finished', summary: SUMMARY });
  });

  /* SINGLE-FLIGHT, the whole point. */
  it('a second request while a run is live does NOT start a second run', async () => {
    const { runner, finish, calls } = deferredRunner();

    const first = await startFetchRun(deps(runner));
    const second = await startFetchRun(deps(runner));

    expect(first.status).toBe('started');
    expect(second.status).toBe('already_running');
    expect(calls()).toBe(1);

    finish(SUMMARY);
    await started(first).completion;
  });

  it('eight simultaneous requests result in exactly ONE run', async () => {
    const { runner, finish, calls } = deferredRunner();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => startFetchRun(deps(runner))),
    );

    expect(results.filter((result) => result.status === 'started')).toHaveLength(1);
    expect(calls()).toBe(1);

    finish(SUMMARY);
    await Promise.all(
      results.map((result) => (result.status === 'started' ? result.completion : Promise.resolve())),
    );
  });

  it('reports when the live run started, so the UI can say how long it has been going', async () => {
    const { runner, finish } = deferredRunner();
    const first = await startFetchRun(deps(runner));
    const second = await startFetchRun(deps(runner));

    expect(second).toMatchObject({ status: 'already_running', startedAt: START.toISOString() });

    finish(SUMMARY);
    await started(first).completion;
  });

  it('lets a new run start once the previous one finished', async () => {
    const { runner, finish, calls } = deferredRunner();

    const first = await startFetchRun(deps(runner));
    finish(SUMMARY);
    await started(first).completion;

    const second = await startFetchRun(deps(runner));
    expect(second.status).toBe('started');
    expect(calls()).toBe(2);

    finish(SUMMARY);
    await started(second).completion;
  });

  /* FAILURE. A crashed pipeline must release the lock and say what happened. */
  it('publishes a failed state and releases the lock when the pipeline throws', async () => {
    const { runner, fail } = deferredRunner();
    const result = await startFetchRun(deps(runner));

    fail(new Error('a search provider key expired'));
    await started(result).completion;

    expect(await store.read()).toMatchObject({
      status: 'failed',
      error: 'a search provider key expired',
    });

    // Not locked out by the failure.
    const { runner: second } = deferredRunner();
    expect((await startFetchRun(deps(second))).status).toBe('started');
  });

  it('never rejects the completion promise, so a background run cannot crash the server', async () => {
    const { runner, fail } = deferredRunner();
    const result = await startFetchRun(deps(runner));

    fail(new Error('boom'));
    await expect(started(result).completion).resolves.toBeUndefined();
  });

  /* STALE LOCK. */
  it('takes over a run whose process died, once it is older than the timeout', async () => {
    const { runner: abandoned } = deferredRunner();
    await startFetchRun(deps(abandoned));

    const { runner: fresh, finish } = deferredRunner();
    const later = new Date(START.getTime() + 16 * 60 * 1000);
    const taken = await startFetchRun(deps(fresh, { now: () => later }));

    expect(taken.status).toBe('started');
    expect(taken).toMatchObject({ tookOverStaleRun: true });

    finish(SUMMARY);
    await started(taken).completion;
  });

  it('honours a custom stale timeout', async () => {
    const { runner: abandoned } = deferredRunner();
    await startFetchRun(deps(abandoned, { staleAfterMs: 1000 }));

    const { runner: fresh, finish } = deferredRunner();
    const later = new Date(START.getTime() + 1001);
    const taken = await startFetchRun(deps(fresh, { now: () => later, staleAfterMs: 1000 }));

    expect(taken.status).toBe('started');
    finish(SUMMARY);
    await started(taken).completion;
  });

  /**
   * The degraded-write guard reaching the UI. A refused write is a SUCCESSFUL
   * run with a protective outcome, not a failure - the distinction is the whole
   * value of `persist-queue.ts` and it must not be flattened here.
   */
  it('reports a refused write as a finished run carrying the refusal', async () => {
    const { runner, finish } = deferredRunner();
    const result = await startFetchRun(deps(runner));

    finish({
      ...SUMMARY,
      outcome: 'refused',
      refusalReason: 'every source failed and the run produced no postings',
      preservedJobCount: 131,
    });
    await started(result).completion;

    const state = await store.read();
    expect(state).toMatchObject({
      status: 'finished',
      summary: { outcome: 'refused', preservedJobCount: 131 },
    });
  });
});
