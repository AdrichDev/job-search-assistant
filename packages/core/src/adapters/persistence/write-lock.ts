import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Cross-process mutual exclusion for one data directory.
 *
 * ## Why a lock file and not a library
 *
 * The stores are plain JSON files with no native dependency by design (see
 * `README.md`). A lock built on `fs.open(path, 'wx')` - create-exclusive - gives
 * the same mutual exclusion across OS processes with nothing to install and no
 * behaviour that differs between POSIX and Windows: the loser of the race gets
 * `EEXIST`, which is the whole primitive.
 *
 * ## What the lock protects
 *
 * One directory, not one file. Every store that lives in a directory shares its
 * lock, which is what makes a read-modify-write cycle safe: the caller reads and
 * writes while holding it, so a second process cannot slip a write in between.
 *
 * ## Why it recovers instead of waiting forever
 *
 * A crashed process leaves the file behind, and a lock nobody can take is a hang
 * in an app the user is using. Two independent signals decide it is abandoned:
 * the recorded pid is gone, or the lock is older than {@link STALE_AFTER_MS}.
 * Recovery deletes the file and retries the create; it never writes through a
 * lock it did not take.
 */

/** Name of the lock file inside the protected directory. */
export const WRITE_LOCK_FILE_NAME = '.write.lock';

/**
 * How long a waiter keeps trying before it reports contention.
 *
 * Store operations are single-digit milliseconds of JSON work, so this is
 * already generous. It is bounded on purpose: a CLI run and the web app can
 * overlap, but neither may hang the other indefinitely.
 */
export const DEFAULT_WAIT_MS = 5_000;

/**
 * Age at which a lock is treated as abandoned even when its pid still exists.
 *
 * Pid reuse is real on Windows. A lock older than this cannot belong to a live
 * store operation, so waiting on it would only delay a failure the user has to
 * see anyway.
 */
export const STALE_AFTER_MS = 30_000;

/** Sleep between acquisition attempts. */
const RETRY_DELAY_MS = 25;

export interface WriteLockOptions {
  readonly waitMs?: number;
  readonly staleAfterMs?: number;
  readonly now?: () => number;
  /** Injected so abandonment can be tested without a real second process. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

/**
 * Directories the CURRENT async context holds. A per-directory counter is shared
 * by every caller, so two independent operations in one directory would both look
 * like a nested re-entry: they run without the lock between them, and the first
 * to finish drops it while the second still writes. Per context separates a real
 * nested call from an unrelated concurrent one, which must queue.
 */
const heldByContext = new AsyncLocalStorage<ReadonlySet<string>>();

/** Tail of the queue that serialises independent callers per directory. */
const directoryQueues = new Map<string, Promise<unknown>>();

/** Suffix of the marker that serialises reclaimers of one abandoned lock. */
const RECOVERY_SUFFIX = '.recovery';

interface LockRecord {
  readonly pid: number;
  readonly startedAt: number;
}

function ownerIsGone(record: LockRecord, options: Required<Pick<WriteLockOptions, 'isProcessAlive'>>): boolean {
  return !options.isProcessAlive(record.pid);
}

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    const code = (cause as { code?: unknown } | null)?.code;
    // ESRCH: no such process. Anything else (EPERM included) means it exists and
    // belongs to somebody else, which is not ours to reclaim.
    return code !== 'ESRCH';
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readRecord(lockPath: string): Promise<LockRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { pid, startedAt } = parsed as { pid?: unknown; startedAt?: unknown };
    if (typeof pid !== 'number' || typeof startedAt !== 'number') return null;
    return { pid, startedAt };
  } catch {
    // Missing between our failed create and this read, or not valid JSON yet.
    // Either way the caller decides from the file's own metadata next.
    return null;
  }
}

async function isAbandoned(
  lockPath: string,
  options: { readonly staleAfterMs: number; readonly now: () => number; readonly isProcessAlive: (pid: number) => boolean },
): Promise<boolean> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(lockPath)).mtimeMs;
  } catch {
    return false; // Gone already: the next create attempt will decide.
  }
  if (options.now() - mtimeMs > options.staleAfterMs) return true;

  const record = await readRecord(lockPath);
  if (record === null) return false; // Fresh but unreadable: give the writer a moment.
  return ownerIsGone(record, { isProcessAlive: options.isProcessAlive });
}

async function tryCreate(lockPath: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (cause: unknown) {
    if ((cause as { code?: unknown } | null)?.code === 'EEXIST') return false;
    throw cause;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Reclaim an abandoned lock, serialising the reclaimers themselves. Two processes
 * that judged the same corpse must not both delete it: the first takes a fresh
 * lock and the second would then delete that FRESH one on an earlier decision,
 * leaving two writers that both believe they own the directory.
 */
async function reclaimAbandoned(
  lockPath: string,
  context: {
    readonly staleAfterMs: number;
    readonly now: () => number;
    readonly isProcessAlive: (pid: number) => boolean;
  },
): Promise<boolean> {
  const recoveryPath = `${lockPath}${RECOVERY_SUFFIX}`;
  if (!(await tryCreate(recoveryPath))) {
    // Only a reclaimer that crashed may be cleared, on the same staleness rule.
    const age = await stat(recoveryPath).then(
      (info) => context.now() - info.mtimeMs,
      () => 0,
    );
    if (age > context.staleAfterMs) await unlink(recoveryPath).catch(() => undefined);
    return false;
  }

  try {
    if (!(await isAbandoned(lockPath, context))) return false;
    await unlink(lockPath).catch(() => undefined);
    return true;
  } finally {
    await unlink(recoveryPath).catch(() => undefined);
  }
}

async function acquire(directory: string, options: WriteLockOptions): Promise<string> {
  const lockPath = join(directory, WRITE_LOCK_FILE_NAME);
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const deadline = now() + waitMs;

  await mkdir(directory, { recursive: true });

  for (;;) {
    if (await tryCreate(lockPath)) return lockPath;

    if (await reclaimAbandoned(lockPath, { staleAfterMs, now, isProcessAlive })) continue;

    if (now() >= deadline) {
      const record = await readRecord(lockPath);
      const owner = record === null ? 'an unknown process' : `pid ${record.pid}`;
      throw new Error(
        `Another process (${owner}) is writing to ${directory}. ` +
          `Refusing to write without the lock at ${lockPath}. ` +
          'Wait for it to finish, or delete that file if no such process exists.',
      );
    }

    await sleep(RETRY_DELAY_MS);
  }
}

async function release(lockPath: string): Promise<void> {
  const record = await readRecord(lockPath);
  // Only remove our own lock: a stale-recovery in another process may have taken
  // it over while we were finishing.
  if (record !== null && record.pid !== process.pid) return;
  await unlink(lockPath).catch(() => undefined);
}

/**
 * Run `operation` while holding the write lock for `directory`.
 *
 * Independent callers queue per directory, so the lock is never dropped while a
 * second operation here is still writing. A call made from inside the holder's
 * own async context is a genuine re-entry and runs directly, which keeps nested
 * store use from deadlocking. Released on success and on failure.
 */
export async function withWriteLock<T>(
  directory: string,
  operation: () => Promise<T>,
  options: WriteLockOptions = {},
): Promise<T> {
  const key = resolve(directory);

  if (heldByContext.getStore()?.has(key) === true) return operation();

  const previous = directoryQueues.get(key) ?? Promise.resolve();
  const run = previous.then(
    () => lockAndRun(key, operation, options),
    () => lockAndRun(key, operation, options),
  );
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  directoryQueues.set(key, settled);
  try {
    return await run;
  } finally {
    // Only the current tail may delete the queue, so a later waiter is not lost.
    if (directoryQueues.get(key) === settled) directoryQueues.delete(key);
  }
}

async function lockAndRun<T>(
  key: string,
  operation: () => Promise<T>,
  options: WriteLockOptions,
): Promise<T> {
  const lockPath = await acquire(key, options);
  const held = heldByContext.getStore() ?? new Set<string>();
  try {
    return await heldByContext.run(new Set([...held, key]), operation);
  } finally {
    await release(lockPath);
  }
}
