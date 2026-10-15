import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  withOutcome,
  type Application,
  type ApplicationDraft,
} from '../../domain/application.js';
import type {
  ApplicationRepository,
  RecordResult,
  UpdateOutcomeInput,
} from '../../ports/application-repository.js';

/**
 * JSON-file application log with atomic writes.
 *
 * No native dependency on purpose: this machine blocks npm install scripts, so
 * anything needing a postinstall build (better-sqlite3 and friends) cannot be
 * installed at all. The `ApplicationRepository` port is the seam - swapping in
 * SQLite later touches this file and nothing else.
 *
 * Durability strategy: write a uniquely-named temp file in the SAME directory,
 * then `rename` it over the target. `rename` within one filesystem is atomic on
 * POSIX, and Node maps it to `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` on
 * Windows, so a crash mid-write leaves either the old complete file or the new
 * complete file - never a truncated one.
 *
 * Concurrency: every operation goes through an in-process promise queue, so a
 * burst of server actions cannot interleave read-modify-write cycles and lose
 * a record. This does NOT protect against a second OS process writing the same
 * file, which is an accepted limitation for a single-user local app.
 */

const CURRENT_VERSION = 1;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const applicationSchema = z.object({
  jobId: z.string().min(1),
  appliedAt: isoDate,
  cvVariant: z.enum(['frontend', 'microsoft', 'general']),
  scoreAtApply: z.number().finite(),
  outcome: z.enum(APPLICATION_OUTCOMES),
  outcomeUpdatedAt: isoDate,
  notes: z.string().optional(),
});

const logFileSchema = z.object({
  version: z.literal(CURRENT_VERSION),
  applications: z.array(applicationSchema),
});

export interface JsonApplicationRepositoryOptions {
  readonly filePath: string;
}

interface SerializedApplication {
  readonly jobId: string;
  readonly appliedAt: string;
  readonly cvVariant: Application['cvVariant'];
  readonly scoreAtApply: number;
  readonly outcome: Application['outcome'];
  readonly outcomeUpdatedAt: string;
  readonly notes?: string;
}

function serialize(application: Application): SerializedApplication {
  return {
    jobId: application.jobId,
    appliedAt: application.appliedAt.toISOString(),
    cvVariant: application.cvVariant,
    scoreAtApply: application.scoreAtApply,
    outcome: application.outcome,
    outcomeUpdatedAt: application.outcomeUpdatedAt.toISOString(),
    ...(application.notes === undefined ? {} : { notes: application.notes }),
  };
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

/** Newest application first: what the candidate did most recently is what matters. */
function byNewestFirst(a: Application, b: Application): number {
  const byDate = b.appliedAt.getTime() - a.appliedAt.getTime();
  return byDate !== 0 ? byDate : a.jobId.localeCompare(b.jobId);
}

export function createJsonApplicationRepository(
  options: JsonApplicationRepositoryOptions,
): ApplicationRepository {
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

  async function readAll(): Promise<Application[]> {
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
        `The application log at ${target} is not valid JSON. Refusing to overwrite it - ` +
          'move the file aside if you want to start over.',
      );
    }

    const parsed = logFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new Error(
        `The application log at ${target} does not match the expected schema: ` +
          `${parsed.error.issues[0]?.message ?? 'unknown error'}. Refusing to overwrite it.`,
      );
    }

    return parsed.data.applications.map((entry) =>
      // Re-minted through the domain factory so invariants hold for data that
      // came off disk exactly as they do for data created in memory.
      withOutcome(
        createApplication({
          jobId: entry.jobId,
          appliedAt: entry.appliedAt,
          cvVariant: entry.cvVariant,
          scoreAtApply: entry.scoreAtApply,
          outcome: entry.outcome,
          ...(entry.notes === undefined ? {} : { notes: entry.notes }),
        }),
        entry.outcome,
        entry.outcomeUpdatedAt,
      ),
    );
  }

  /*
   * Moved onto the shared retrying atomic write.
   *
   * The strategy is unchanged - temp file in the same directory, then `rename`
   * over the target - and the only difference is that a Windows `EPERM` caused
   * by a concurrent reader is now retried instead of thrown. That hazard was
   * proved on the run-state store, which is polled every two seconds; this file
   * is written far less often, so it was never observed here. But the failure
   * mode is identical and the consequence is worse: the thing that would be
   * lost is a real job application, and "it has not happened yet" is not a
   * reason to leave a known data-loss path in the one file that holds the
   * user's history.
   */
  async function writeAll(applications: readonly Application[]): Promise<void> {
    const payload = `${JSON.stringify(
      { version: CURRENT_VERSION, applications: applications.map(serialize) },
      null,
      2,
    )}\n`;

    await writeFileAtomically(target, payload, 'applications');
  }

  return {
    async list(): Promise<readonly Application[]> {
      const applications = await exclusive(readAll);
      return [...applications].sort(byNewestFirst);
    },

    async findByJobId(jobId: string): Promise<Application | null> {
      const applications = await exclusive(readAll);
      return applications.find((entry) => entry.jobId === jobId.trim()) ?? null;
    },

    async record(draft: ApplicationDraft): Promise<RecordResult> {
      return exclusive(async () => {
        const applications = await readAll();
        const jobId = draft.jobId.trim();
        const existing = applications.find((entry) => entry.jobId === jobId);

        // Idempotency lives here, in the store, where it can actually be
        // guaranteed against a double click.
        if (existing !== undefined) {
          return { application: existing, created: false };
        }

        const application = createApplication(draft);
        await writeAll([...applications, application]);
        return { application, created: true };
      });
    },

    async updateOutcome(input: UpdateOutcomeInput): Promise<Application | null> {
      return exclusive(async () => {
        const applications = await readAll();
        const jobId = input.jobId.trim();
        const index = applications.findIndex((entry) => entry.jobId === jobId);

        const current = index === -1 ? undefined : applications[index];
        if (current === undefined) {
          return null;
        }

        const updated = withOutcome(
          current,
          input.outcome,
          input.at,
          ...(input.notes === undefined ? [] : ([input.notes] as const)),
        );

        const next = [...applications];
        next[index] = updated;
        await writeAll(next);
        return updated;
      });
    },
  };
}
