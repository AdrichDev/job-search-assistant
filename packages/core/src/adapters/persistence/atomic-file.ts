import { mkdir, rename as fsRename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Replace a file atomically, and survive a concurrent reader on Windows.
 *
 * ## Why this is not just `writeFile`
 *
 * Write a uniquely-named temp file in the SAME directory, then `rename` it over
 * the target. `rename` within one filesystem is atomic on POSIX, and Node maps
 * it to `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on Windows - so a crash
 * mid-write leaves either the old complete file or the new complete file, never
 * a truncated one. Same directory, so the rename never crosses a filesystem.
 *
 * ## Why it retries
 *
 * Windows refuses the replacement while another handle has the DESTINATION open
 * for reading. It reports `EPERM`, and sometimes `EBUSY` or `EACCES`. POSIX has
 * no such behaviour, which is why the hazard is invisible until somebody runs
 * the app on Windows with something polling the file.
 *
 * That is exactly what the fetch feature does: every open tab polls the run's
 * status board every two seconds, and a poll that overlapped the run's own
 * `settle` produced
 *
 *   EPERM: operation not permitted, rename '...fetch-run.<pid>.tmp' -> 'fetch-run.json'
 *
 * which surfaced to the user as a FAILED run - for a pipeline that had finished
 * perfectly and had already written the queue. It was found in a live browser
 * session; no unit test on this machine had two readers.
 *
 * Retrying costs nothing when it is not needed and does not weaken the
 * guarantee: the mechanism is still one `rename`, simply attempted again when
 * the OS says the moment was wrong. Everything else is rethrown at once,
 * because a full disk or a read-only volume is not going to resolve itself in
 * twenty milliseconds - retrying it would only make a clear failure slow.
 */

/**
 * Backoff between rename attempts, in milliseconds.
 *
 * Short and finite. The contention it is designed for is one `readFile` of a
 * few kilobytes, which holds the handle for well under a millisecond; if it is
 * still refused after roughly a third of a second, something other than a
 * passing read is holding the file and pretending otherwise would just hide it.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 25, 50, 100, 150];

/** The codes Windows uses for "somebody has this open right now". */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function isBusy(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' && BUSY_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AtomicWriteDeps {
  /** Injected so the retry rule is testable without a real Windows collision. */
  readonly rename?: (from: string, to: string) => Promise<void>;
}

let counter = 0;

export async function writeFileAtomically(
  target: string,
  payload: string,
  /** Goes into the temp file name, so a stray one names the store that left it. */
  label: string,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const rename = deps.rename ?? fsRename;
  const directory = dirname(target);
  await mkdir(directory, { recursive: true });

  counter += 1;
  const temporary = join(directory, `.${label}.${process.pid}.${counter}.${Date.now()}.tmp`);

  try {
    await writeFile(temporary, payload, 'utf8');

    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, target);
        return;
      } catch (cause: unknown) {
        const delay = RENAME_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isBusy(cause)) {
          throw cause;
        }
        await sleep(delay);
      }
    }
  } catch (cause: unknown) {
    // A failed write must not litter the data directory with partial files.
    await unlink(temporary).catch(() => undefined);
    throw cause;
  }
}
