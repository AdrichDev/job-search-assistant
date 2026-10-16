import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';
import type {
  ClaimResult,
  FetchRunState,
  RunClaim,
  RunStateStore,
} from '../../ports/run-state-store.js';

/**
 * Run state on disk, plus a real mutex.
 *
 * ## Two files, and why it is not one
 *
 *   `<path>`        the published `FetchRunState`. Written atomically
 *                   (temp file + rename), read by every poll.
 *   `<path>.lock`   the mutex. Created with `writeFile(..., { flag: 'wx' })`,
 *                   which is an EXCLUSIVE CREATE - `O_CREAT | O_EXCL` at the
 *                   syscall level. Deleted by `settle`.
 *
 * The lock has to be a separate file precisely because it must be created
 * atomically. A single file holding both would force `claim` into read-then-
 * write, which is the shape that loses races: two callers both read "finished",
 * both write "running", and two pipelines start on the same queue file. `wx`
 * cannot do that - the kernel hands the create to exactly one caller and every
 * other one gets EEXIST.
 *
 * ## What this does and does not guarantee
 *
 * GUARANTEED: two clicks, two tabs, or two OS processes cannot both take a free
 * lock. That covers every realistic way this feature gets double-invoked.
 *
 * NOT guaranteed: the stale-lock TAKEOVER is unlink-then-recreate, which is two
 * syscalls. Two processes that simultaneously judge the same lock stale can in
 * principle interleave so that one unlinks the other's fresh lock. Closing that
 * needs a lease renewed by a heartbeat, which is a lot of machinery for a
 * single-user local app whose realistic concurrency is "the same person clicked
 * twice". The in-process serialization below removes it entirely for the case
 * that actually happens - two tabs talking to one Next server.
 *
 * ## Corruption policy, opposite to the application log
 *
 * A corrupt state file degrades to `idle` instead of throwing. There is nothing
 * here worth protecting: this file is a status board, not history. Refusing to
 * run because the status board is unreadable would brick the button over
 * something the next run overwrites anyway.
 */

const runSummarySchema = z.object({
  outcome: z.enum(['written', 'refused']),
  totalFetched: z.number(),
  totalUnique: z.number(),
  duplicatesRemoved: z.number(),
  excludedNotSoftware: z.number(),
  excludedNotJunior: z.number(),
  // Defaulted: state files written before the unified hard filter lack these.
  excludedByLocation: z.number().default(0),
  excludedByExperience: z.number().default(0),
  excludedBySeniority: z.number().default(0),
  removedAsGone: z.number(),
  offersAvailable: z.number(),
  failedSources: z.array(
    z.object({ sourceId: z.string(), query: z.string(), error: z.string() }),
  ),
  warnings: z.array(z.string()),
  refusalReason: z.string().nullable(),
  preservedJobCount: z.number().nullable(),
});

const stateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({
    status: z.literal('running'),
    runId: z.string().min(1),
    startedAt: z.string(),
  }),
  z.object({
    status: z.literal('finished'),
    runId: z.string().min(1),
    startedAt: z.string(),
    finishedAt: z.string(),
    summary: runSummarySchema,
  }),
  z.object({
    status: z.literal('failed'),
    runId: z.string().min(1),
    startedAt: z.string(),
    finishedAt: z.string(),
    error: z.string(),
  }),
]);

const lockSchema = z.object({ runId: z.string().min(1), startedAt: z.string() });

const IDLE: FetchRunState = { status: 'idle' };

export interface JsonRunStateStoreOptions {
  readonly filePath: string;
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'EEXIST'
  );
}

export function createJsonRunStateStore(options: JsonRunStateStoreOptions): RunStateStore {
  const target = resolve(options.filePath);
  const lockPath = `${target}.lock`;

  /** Serializes claims within this process, which is where the races actually are. */
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readState(): Promise<FetchRunState> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch {
      return IDLE;
    }

    try {
      const parsed = stateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? (parsed.data as FetchRunState) : IDLE;
    } catch {
      return IDLE;
    }
  }

  /*
   * The retrying atomic write, and this is the store that needed it most: every
   * open tab polls this exact file every two seconds, so on Windows a `settle`
   * has a real chance of colliding with a reader's open handle. When it did, a
   * perfectly successful run was published as `failed`.
   */
  async function writeState(state: FetchRunState): Promise<void> {
    await writeFileAtomically(target, `${JSON.stringify(state, null, 2)}\n`, 'fetch-run');
  }

  /**
   * When the current lock holder started, in epoch milliseconds.
   *
   * Falls back to the file's mtime when the lock is empty or unparseable - the
   * shape a process killed between the open and the write leaves behind. That
   * fallback is what stops such a lock reading as free (which would start a
   * second pipeline) while still letting it age out.
   *
   * `null` means the lock is gone.
   */
  async function lockHeldSince(): Promise<number | null> {
    let raw: string;
    try {
      raw = await readFile(lockPath, 'utf8');
    } catch (cause: unknown) {
      if (isMissingFile(cause)) {
        return null;
      }
      throw cause;
    }

    try {
      const parsed = lockSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const started = new Date(parsed.data.startedAt).getTime();
        if (Number.isFinite(started)) {
          return started;
        }
      }
    } catch {
      // Falls through to the mtime below.
    }

    try {
      return (await stat(lockPath)).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Creates the lock, or reports that somebody already holds it. */
  async function takeLock(claim: RunClaim): Promise<boolean> {
    await mkdir(dirname(lockPath), { recursive: true });
    const payload = JSON.stringify({
      runId: claim.runId,
      startedAt: claim.startedAt.toISOString(),
    });

    try {
      await writeFile(lockPath, payload, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (cause: unknown) {
      if (isAlreadyExists(cause)) {
        return false;
      }
      throw cause;
    }
  }

  async function heldBy(): Promise<string | null> {
    try {
      const parsed = lockSchema.safeParse(JSON.parse(await readFile(lockPath, 'utf8')));
      return parsed.success ? parsed.data.runId : null;
    } catch {
      return null;
    }
  }

  return {
    read(): Promise<FetchRunState> {
      return exclusive(readState);
    },

    claim(claim: RunClaim, staleAfterMs: number): Promise<ClaimResult> {
      return exclusive(async (): Promise<ClaimResult> => {
        const running: FetchRunState = {
          status: 'running',
          runId: claim.runId,
          startedAt: claim.startedAt.toISOString(),
        };

        if (await takeLock(claim)) {
          await writeState(running);
          return { ok: true, tookOverStaleRun: false };
        }

        const heldSince = await lockHeldSince();
        if (heldSince === null) {
          // Released between the failed create and this read. One retry, then
          // give up rather than spin.
          if (await takeLock(claim)) {
            await writeState(running);
            return { ok: true, tookOverStaleRun: false };
          }
          return { ok: false, state: await readState() };
        }

        const age = claim.startedAt.getTime() - heldSince;
        if (age < staleAfterMs) {
          return { ok: false, state: await readState() };
        }

        // Stale. Drop it and re-create exclusively, so a second claimer that
        // reached the same conclusion still loses the create.
        await unlink(lockPath).catch(() => undefined);
        if (!(await takeLock(claim))) {
          return { ok: false, state: await readState() };
        }

        await writeState(running);
        return { ok: true, tookOverStaleRun: true };
      });
    },

    settle(runId: string, state: FetchRunState): Promise<boolean> {
      return exclusive(async () => {
        const holder = await heldBy();
        if (holder !== runId) {
          // A zombie whose lock was already taken over. Publishing its result
          // would overwrite the live run's state with a dead one's.
          return false;
        }

        await writeState(state);
        await unlink(lockPath).catch(() => undefined);
        return true;
      });
    },
  };
}
