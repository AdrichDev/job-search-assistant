import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonRunStateStore } from '../../src/adapters/persistence/json-run-state-store.js';
import type { ClaimResult, RunStateStore } from '../../src/ports/run-state-store.js';

/**
 * The single-flight lock and the run state, on disk.
 *
 * On disk rather than in a module variable for two reasons that are both about
 * honesty: a second browser tab talks to the same server but a fresh React
 * tree, and a server restart must not leave the UI claiming a run is still
 * going. A file answers both.
 *
 * The lock itself is a `wx` (exclusive create) open, which is atomic at the OS
 * level - not a read-then-write, which is the shape that loses races.
 */

const START = new Date('2026-03-10T09:00:00.000Z');
const STALE_AFTER_MS = 15 * 60 * 1000;

/** Narrows a refused claim, so the test can read the state that refused it. */
function refused(result: ClaimResult): Extract<ClaimResult, { ok: false }> {
  if (result.ok) {
    throw new Error('expected the claim to be refused');
  }
  return result;
}

/** Narrows a granted claim, so the test can read `tookOverStaleRun`. */
function granted(result: ClaimResult): Extract<ClaimResult, { ok: true }> {
  if (!result.ok) {
    throw new Error('expected the claim to be granted');
  }
  return result;
}

let directory: string;
let statePath: string;
let lockPath: string;
let store: RunStateStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'runstate-'));
  statePath = join(directory, 'fetch-run.json');
  lockPath = `${statePath}.lock`;
  store = createJsonRunStateStore({ filePath: statePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createJsonRunStateStore', () => {
  it('reports idle before anything has ever run', async () => {
    expect(await store.read()).toEqual({ status: 'idle' });
  });

  it('claims a free lock and publishes the running state', async () => {
    const claim = await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);

    expect(claim.ok).toBe(true);
    expect(await store.read()).toEqual({
      status: 'running',
      runId: 'run-1',
      startedAt: START.toISOString(),
    });
  });

  it('REFUSES a second claim while a run is live', async () => {
    await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);

    const second = await store.claim(
      { runId: 'run-2', startedAt: new Date(START.getTime() + 1000) },
      STALE_AFTER_MS,
    );

    expect(refused(second).state).toMatchObject({ status: 'running', runId: 'run-1' });
  });

  it('refuses a whole burst of simultaneous claims except one', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        store.claim({ runId: `run-${index}`, startedAt: START }, STALE_AFTER_MS),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it('settles a run it holds and releases the lock', async () => {
    await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);

    const settled = await store.settle('run-1', {
      status: 'failed',
      runId: 'run-1',
      startedAt: START.toISOString(),
      finishedAt: new Date(START.getTime() + 5000).toISOString(),
      error: 'boom',
    });

    expect(settled).toBe(true);
    expect(await store.read()).toMatchObject({ status: 'failed', error: 'boom' });

    // Released: the next run may start immediately.
    const next = await store.claim({ runId: 'run-2', startedAt: START }, STALE_AFTER_MS);
    expect(next.ok).toBe(true);
  });

  it('refuses to settle a run it no longer holds', async () => {
    await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);
    await store.settle('run-1', {
      status: 'failed',
      runId: 'run-1',
      startedAt: START.toISOString(),
      finishedAt: START.toISOString(),
      error: 'first',
    });
    await store.claim({ runId: 'run-2', startedAt: START }, STALE_AFTER_MS);

    const late = await store.settle('run-1', {
      status: 'failed',
      runId: 'run-1',
      startedAt: START.toISOString(),
      finishedAt: START.toISOString(),
      error: 'late arrival from a dead run',
    });

    expect(late).toBe(false);
    // The live run's state was not clobbered by the zombie.
    expect(await store.read()).toMatchObject({ status: 'running', runId: 'run-2' });
  });

  /*
   * STALE LOCK RECOVERY.
   *
   * A killed process leaves the lock behind and nothing will ever settle it. A
   * feature that locks itself forever on one crash is worse than one with no
   * lock at all, so the claim takes over a lock older than the timeout - and
   * says so, rather than pretending the previous run ended cleanly.
   */
  it('takes over a lock older than the stale timeout', async () => {
    await store.claim({ runId: 'crashed', startedAt: START }, STALE_AFTER_MS);

    const later = new Date(START.getTime() + STALE_AFTER_MS + 1);
    const taken = await store.claim({ runId: 'run-2', startedAt: later }, STALE_AFTER_MS);

    expect(granted(taken).tookOverStaleRun).toBe(true);
    expect(await store.read()).toMatchObject({ status: 'running', runId: 'run-2' });
  });

  it('does NOT take over a lock that is merely slow', async () => {
    await store.claim({ runId: 'slow', startedAt: START }, STALE_AFTER_MS);

    const later = new Date(START.getTime() + STALE_AFTER_MS - 1);
    expect((await store.claim({ runId: 'run-2', startedAt: later }, STALE_AFTER_MS)).ok).toBe(
      false,
    );
  });

  /**
   * The lock is created and filled by ONE `writeFile(..., { flag: 'wx' })`, but
   * a process killed between the open and the write would leave an empty file.
   * That must read as "held", not as "free": guessing in the direction that
   * starts a second concurrent pipeline is the one guess this lock exists to
   * prevent. Its age is judged by mtime instead, so it still recovers.
   */
  it('treats an empty lock from a process killed mid-claim as still held', async () => {
    await writeFile(lockPath, '', 'utf8');

    const claim = await store.claim(
      { runId: 'run-2', startedAt: new Date(START.getTime() + 1000) },
      STALE_AFTER_MS,
    );

    expect(claim.ok).toBe(false);
  });

  it('recovers an unparseable lock once its mtime is older than the timeout', async () => {
    await writeFile(lockPath, 'garbage', 'utf8');
    const ancient = new Date(START.getTime() - 24 * 60 * 60 * 1000);
    await utimes(lockPath, ancient, ancient);

    const taken = await store.claim({ runId: 'run-2', startedAt: START }, STALE_AFTER_MS);

    expect(granted(taken).tookOverStaleRun).toBe(true);
  });

  it('survives a reopen: a second store sees the same finished run', async () => {
    await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);
    await store.settle('run-1', {
      status: 'failed',
      runId: 'run-1',
      startedAt: START.toISOString(),
      finishedAt: START.toISOString(),
      error: 'boom',
    });

    const reopened = createJsonRunStateStore({ filePath: statePath });
    expect(await reopened.read()).toMatchObject({ status: 'failed', error: 'boom' });
  });

  /**
   * A corrupt state file must not brick the button. There is nothing here worth
   * protecting - unlike the application log, this file is a status board - so
   * it degrades to `idle` and lets the human try again.
   */
  it('degrades a corrupt state file to idle instead of throwing', async () => {
    await writeFile(statePath, '{ not json', 'utf8');
    expect(await store.read()).toEqual({ status: 'idle' });
  });

  it('degrades a state file with an unknown status to idle', async () => {
    await writeFile(statePath, JSON.stringify({ status: 'quantum' }), 'utf8');
    expect(await store.read()).toEqual({ status: 'idle' });
  });

  it('writes the state atomically and leaves no temp files behind', async () => {
    await store.claim({ runId: 'run-1', startedAt: START }, STALE_AFTER_MS);
    await store.settle('run-1', {
      status: 'failed',
      runId: 'run-1',
      startedAt: START.toISOString(),
      finishedAt: START.toISOString(),
      error: 'boom',
    });

    expect(await readdir(directory)).toEqual(['fetch-run.json']);
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ status: 'failed' });
  });
});
