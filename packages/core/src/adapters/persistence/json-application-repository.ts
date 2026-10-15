import { z } from 'zod';
import { createJsonLogStore } from './json-log-store.js';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  withOutcome,
  type Application,
  type ApplicationDraft,
} from '../../domain/application.js';
import { CV_VARIANTS } from '../../domain/job.js';
import type {
  ApplicationRepository,
  RecordResult,
  UpdateOutcomeInput,
} from '../../ports/application-repository.js';

/**
 * JSON-file application log. Plumbing (atomic writes with the Windows EPERM
 * retry, serialised cycles, refusal to overwrite an unreadable file) lives in
 * `json-log-store.ts`; this file keeps the schema and the application rules.
 *
 * No native dependency on purpose: this machine blocks npm install scripts, so
 * anything needing a postinstall build (better-sqlite3 and friends) cannot be
 * installed at all. The `ApplicationRepository` port is the seam - swapping in
 * SQLite later touches this file and nothing else.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const applicationSchema = z.object({
  jobId: z.string().min(1),
  appliedAt: isoDate,
  cvVariant: z.enum(CV_VARIANTS),
  scoreAtApply: z.number().finite(),
  // Absent in logs written before source tracking.
  sourceIds: z.array(z.string()).default([]),
  outcome: z.enum(APPLICATION_OUTCOMES),
  outcomeUpdatedAt: isoDate,
  notes: z.string().optional(),
});

export interface JsonApplicationRepositoryOptions {
  readonly filePath: string;
}

function serialize(application: Application) {
  return {
    jobId: application.jobId,
    appliedAt: application.appliedAt.toISOString(),
    cvVariant: application.cvVariant,
    scoreAtApply: application.scoreAtApply,
    sourceIds: application.sourceIds,
    outcome: application.outcome,
    outcomeUpdatedAt: application.outcomeUpdatedAt.toISOString(),
    ...(application.notes === undefined ? {} : { notes: application.notes }),
  };
}

/** Newest application first: what the candidate did most recently is what matters. */
function byNewestFirst(a: Application, b: Application): number {
  const byDate = b.appliedAt.getTime() - a.appliedAt.getTime();
  return byDate !== 0 ? byDate : a.jobId.localeCompare(b.jobId);
}

export function createJsonApplicationRepository(
  options: JsonApplicationRepositoryOptions,
): ApplicationRepository {
  const store = createJsonLogStore({
    filePath: options.filePath,
    label: 'application',
    entriesKey: 'applications',
    entrySchema: applicationSchema,
    // Re-minted through the domain factory so invariants hold for data that
    // came off disk exactly as they do for data created in memory.
    revive: (entry) =>
      withOutcome(
        createApplication({
          jobId: entry.jobId,
          appliedAt: entry.appliedAt,
          cvVariant: entry.cvVariant,
          scoreAtApply: entry.scoreAtApply,
          sourceIds: entry.sourceIds,
          outcome: entry.outcome,
          ...(entry.notes === undefined ? {} : { notes: entry.notes }),
        }),
        entry.outcome,
        entry.outcomeUpdatedAt,
      ),
    serialize,
  });

  return {
    async list(): Promise<readonly Application[]> {
      const applications = await store.exclusive(store.readAll);
      return [...applications].sort(byNewestFirst);
    },

    async findByJobId(jobId: string): Promise<Application | null> {
      const applications = await store.exclusive(store.readAll);
      return applications.find((entry) => entry.jobId === jobId.trim()) ?? null;
    },

    async record(draft: ApplicationDraft): Promise<RecordResult> {
      return store.exclusive(async () => {
        const applications = await store.readAll();
        const jobId = draft.jobId.trim();
        const existing = applications.find((entry) => entry.jobId === jobId);

        // Idempotency lives here, in the store, where it can actually be
        // guaranteed against a double click.
        if (existing !== undefined) {
          return { application: existing, created: false };
        }

        const application = createApplication(draft);
        await store.writeAll([...applications, application]);
        return { application, created: true };
      });
    },

    async updateOutcome(input: UpdateOutcomeInput): Promise<Application | null> {
      return store.exclusive(async () => {
        const applications = await store.readAll();
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
        await store.writeAll(next);
        return updated;
      });
    },
  };
}
