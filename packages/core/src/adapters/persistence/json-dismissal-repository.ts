import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';
import { createDismissal, type Dismissal } from '../../domain/dismissal.js';
import type {
  DismissResult,
  DismissalRepository,
} from '../../ports/dismissal-repository.js';
import type { DismissalDraft } from '../../domain/dismissal.js';

/**
 * JSON-file dismissal log with atomic writes.
 *
 * A near-twin of `json-application-repository.ts`, and intentionally so rather
 * than shared through a generic: the two files have different schemas, different
 * migration futures and different failure meanings, and a "JsonEntityStore<T>"
 * abstraction would buy about forty saved lines at the cost of making both of
 * them harder to read and to change independently. The duplication is small,
 * visible and stable.
 *
 * Same durability strategy: uniquely-named temp file in the SAME directory, then
 * `rename` over the target. Atomic on POSIX, and Node maps it to
 * `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on Windows - a crash mid-write
 * leaves either the old complete file or the new complete file, never a
 * truncated one. No native dependency, because this machine blocks npm install
 * scripts and anything with a postinstall build cannot be installed at all.
 *
 * Same concurrency posture: every operation goes through an in-process promise
 * queue, so a burst of server actions cannot interleave read-modify-write cycles
 * and lose a record. It does NOT protect against a second OS process writing the
 * same file - an accepted limitation for a single-user local app.
 *
 * Same refusal to overwrite what it cannot parse. That matters more here than it
 * looks: this file is the record of decisions the human made by hand, and
 * silently resetting it would resurrect every offer they already said no to.
 */

const CURRENT_VERSION = 1;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const dismissalSchema = z.object({
  jobId: z.string().min(1),
  dismissedAt: isoDate,
  title: z.string(),
  company: z.string(),
});

const logFileSchema = z.object({
  version: z.literal(CURRENT_VERSION),
  dismissals: z.array(dismissalSchema),
});

export interface JsonDismissalRepositoryOptions {
  readonly filePath: string;
}

interface SerializedDismissal {
  readonly jobId: string;
  readonly dismissedAt: string;
  readonly title: string;
  readonly company: string;
}

function serialize(dismissal: Dismissal): SerializedDismissal {
  return {
    jobId: dismissal.jobId,
    dismissedAt: dismissal.dismissedAt.toISOString(),
    title: dismissal.title,
    company: dismissal.company,
  };
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

/** Newest dismissal first: the most recent decision is the one being reviewed. */
function byNewestFirst(a: Dismissal, b: Dismissal): number {
  const byDate = b.dismissedAt.getTime() - a.dismissedAt.getTime();
  return byDate !== 0 ? byDate : a.jobId.localeCompare(b.jobId);
}

export function createJsonDismissalRepository(
  options: JsonDismissalRepositoryOptions,
): DismissalRepository {
  const target = resolve(options.filePath);

  /** Serializes every read-modify-write cycle in this process. */
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    // The queue must survive a rejected operation, otherwise one failed write
    // would poison every later one.
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readAll(): Promise<Dismissal[]> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (cause: unknown) {
      if (isMissingFile(cause)) {
        return [];
      }
      throw cause;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `The dismissal log at ${target} is not valid JSON. Refusing to overwrite it - ` +
          'move the file aside if you want to start over.',
      );
    }

    const parsed = logFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `The dismissal log at ${target} does not match the expected schema: ` +
          `${parsed.error.issues[0]?.message ?? 'unknown error'}. Refusing to overwrite it.`,
      );
    }

    // Re-minted through the domain factory so invariants hold for data that came
    // off disk exactly as they do for data created in memory.
    return parsed.data.dismissals.map((entry) => createDismissal(entry));
  }

  async function writeAll(dismissals: readonly Dismissal[]): Promise<void> {
    const payload = `${JSON.stringify(
      { version: CURRENT_VERSION, dismissals: dismissals.map(serialize) },
      null,
      2,
    )}\n`;

    await writeFileAtomically(target, payload, 'dismissals');
  }

  return {
    async list(): Promise<readonly Dismissal[]> {
      const dismissals = await exclusive(readAll);
      return [...dismissals].sort(byNewestFirst);
    },

    async findByJobId(jobId: string): Promise<Dismissal | null> {
      const dismissals = await exclusive(readAll);
      return dismissals.find((entry) => entry.jobId === jobId.trim()) ?? null;
    },

    async dismiss(draft: DismissalDraft): Promise<DismissResult> {
      return exclusive(async () => {
        const dismissals = await readAll();
        const jobId = draft.jobId.trim();
        const existing = dismissals.find((entry) => entry.jobId === jobId);

        // Idempotency lives here, in the store, where it can actually be
        // guaranteed against a double click.
        if (existing !== undefined) {
          return { dismissal: existing, created: false };
        }

        const dismissal = createDismissal(draft);
        await writeAll([...dismissals, dismissal]);
        return { dismissal, created: true };
      });
    },

    async restore(jobId: string): Promise<boolean> {
      return exclusive(async () => {
        const dismissals = await readAll();
        const wanted = jobId.trim();
        const next = dismissals.filter((entry) => entry.jobId !== wanted);

        if (next.length === dismissals.length) {
          return false;
        }

        await writeAll(next);
        return true;
      });
    },
  };
}
