import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
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
 * ## Why it never reclaims a lock it did not create
 *
 * A crashed process leaves the file behind, and reclaiming it automatically is the
 * tempting answer. It does not survive review: deciding "this lock is dead" and
 * deleting the path are two separate steps, and no portable compare-and-delete
 * closes the gap. Two reclaimers can observe the same corpse and the second one
 * deletes the REPLACEMENT the first just created, putting two writers on the
 * directory again. So a lock is never deleted by a process that did not create it: a
 * provably gone owner is reported at once with the manual step spelled out, and a
 * live owner is waited for up to {@link DEFAULT_WAIT_MS}.
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

/** Sleep between acquisition attempts. */
const RETRY_DELAY_MS = 25;

export interface WriteLockOptions {
  readonly waitMs?: number;
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

interface LockRecord {
  readonly pid: number;
  readonly startedAt: number;
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

function contention(lockPath: string, directory: string, record: LockRecord | null, ownerGone: boolean): Error {
  const owner = record === null ? 'an unknown process' : `pid ${record.pid}`;
  const state = ownerGone ? 'and that process is no longer running' : 'and did not finish in time';
  return new Error(
    `Another process (${owner}) is writing to ${directory} ${state}. ` +
      `Refusing to write without the lock at ${lockPath}. ` +
      'If no such process is running, delete that file and retry.',
  );
}

async function acquire(directory: string, options: WriteLockOptions): Promise<string> {
  const lockPath = join(directory, WRITE_LOCK_FILE_NAME);
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const deadline = now() + waitMs;

  await mkdir(directory, { recursive: true });

  for (;;) {
    if (await tryCreate(lockPath)) return lockPath;

    // Never deleted here: the check and the delete cannot be one atomic step, so a
    // "dead lock" cleanup is a lost write waiting for a second reclaimer.
    const record = await readRecord(lockPath);
    const ownerGone = record !== null && !isProcessAlive(record.pid);
    if (ownerGone || now() >= deadline) throw contention(lockPath, directory, record, ownerGone);

    await sleep(RETRY_DELAY_MS);
  }
}

async function release(lockPath: string): Promise<void> {
  const record = await readRecord(lockPath);
  // Only remove our own lock. It cannot have been reclaimed by another process -
  // nothing reclaims - but the guard keeps this true if that ever changes.
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
