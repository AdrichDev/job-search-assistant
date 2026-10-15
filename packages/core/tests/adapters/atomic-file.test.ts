import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RENAME_RETRY_DELAYS_MS,
  writeFileAtomically,
} from '../../src/adapters/persistence/atomic-file.js';

/**
 * Atomic file replacement that survives a concurrent reader ON WINDOWS.
 *
 * ## The defect this exists for
 *
 * Temp-file-plus-rename is the right way to replace a file: `rename` is atomic
 * on POSIX and Node maps it to `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on
 * Windows, so a crash mid-write leaves the old file or the new one, never a
 * truncated one.
 *
 * What that description leaves out is that Windows will refuse the replacement
 * outright - `EPERM`, sometimes `EBUSY` or `EACCES` - while ANOTHER PROCESS OR
 * HANDLE has the destination open for reading. POSIX does not do this. It is not
 * a corruption; it is a transient "not right now".
 *
 * It was found in a live browser session, not in a unit test: the fetch run's
 * status board is polled every two seconds by every open tab, and a poll that
 * overlapped the run's own `settle` produced
 *
 *   EPERM: operation not permitted, rename '...fetch-run.<pid>.tmp' -> 'fetch-run.json'
 *
 * which `startFetchRun` then reported as a FAILED run - for a pipeline that had
 * completed perfectly and had already written the queue. A successful run
 * reported as a failure is exactly the kind of lie this codebase spends its
 * effort refusing.
 *
 * ## The fix, and what it does not weaken
 *
 * Retry the rename a few times over a few hundred milliseconds, and only for the
 * three "the file is busy" codes. Atomicity is untouched - the mechanism is
 * still one `rename`, it is simply attempted again when the OS says the moment
 * was wrong. Any other error is rethrown immediately, because a full disk or a
 * bad path is not going to fix itself in 20ms.
 */

let directory: string;
let target: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atomic-'));
  target = join(directory, 'thing.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** A rename that fails with `code` the first `failures` times, then works. */
function flakyRename(code: string, failures: number) {
  let attempts = 0;
  return {
    attempts: () => attempts,
    rename: async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts <= failures) {
        const error: NodeJS.ErrnoException = new Error(
          `${code}: operation not permitted, rename '${from}' -> '${to}'`,
        );
        error.code = code;
        throw error;
      }
      const { rename } = await import('node:fs/promises');
      await rename(from, to);
    },
  };
}

describe('writeFileAtomically', () => {
  it('writes the payload', async () => {
    await writeFileAtomically(target, 'hello\n', 'thing');

    expect(await readFile(target, 'utf8')).toBe('hello\n');
  });

  it('replaces existing content', async () => {
    await writeFileAtomically(target, 'first\n', 'thing');
    await writeFileAtomically(target, 'second\n', 'thing');

    expect(await readFile(target, 'utf8')).toBe('second\n');
  });

  it('creates the directory when it does not exist yet', async () => {
    const nested = join(directory, 'a', 'b', 'thing.json');
    await writeFileAtomically(nested, 'x\n', 'thing');

    expect(await readFile(nested, 'utf8')).toBe('x\n');
  });

  it('leaves no temp file behind on success', async () => {
    await writeFileAtomically(target, 'x\n', 'thing');

    expect(await readdir(directory)).toEqual(['thing.json']);
  });

  /* The defect, reproduced. */
  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'retries a rename the OS refused with %s while a reader held the file',
    async (code) => {
      const flaky = flakyRename(code, 2);

      await writeFileAtomically(target, 'survived\n', 'thing', { rename: flaky.rename });

      expect(flaky.attempts()).toBe(3);
      expect(await readFile(target, 'utf8')).toBe('survived\n');
    },
  );

  it('gives up after the configured attempts rather than retrying forever', async () => {
    const flaky = flakyRename('EPERM', Number.MAX_SAFE_INTEGER);

    await expect(
      writeFileAtomically(target, 'x\n', 'thing', { rename: flaky.rename }),
    ).rejects.toThrow(/EPERM/);

    // One initial attempt plus one per configured delay.
    expect(flaky.attempts()).toBe(RENAME_RETRY_DELAYS_MS.length + 1);
  });

  it('cleans up the temp file when every retry failed', async () => {
    const flaky = flakyRename('EPERM', Number.MAX_SAFE_INTEGER);

    await writeFileAtomically(target, 'x\n', 'thing', { rename: flaky.rename }).catch(
      () => undefined,
    );

    expect(await readdir(directory)).toEqual([]);
  });

  /**
   * A full disk, a read-only volume or a bad path will not resolve itself in
   * twenty milliseconds. Retrying those would turn a clear immediate failure
   * into a slow one, and nothing else.
   */
  it('does NOT retry an error that is not about the file being busy', async () => {
    const flaky = flakyRename('ENOSPC', Number.MAX_SAFE_INTEGER);

    await expect(
      writeFileAtomically(target, 'x\n', 'thing', { rename: flaky.rename }),
    ).rejects.toThrow(/ENOSPC/);

    expect(flaky.attempts()).toBe(1);
  });

  it('names the temp file after the target so a stray one is identifiable', async () => {
    const flaky = flakyRename('EPERM', 1);
    let seen = '';

    await writeFileAtomically(target, 'x\n', 'runstate', {
      rename: async (from, to) => {
        seen = from;
        return flaky.rename(from, to);
      },
    });

    expect(seen).toContain('runstate');
    expect(seen).toMatch(/\.tmp$/);
  });
});
