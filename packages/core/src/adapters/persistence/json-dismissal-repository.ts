import { z } from 'zod';
import { createJsonLogStore } from './json-log-store.js';
import {
  DISMISSAL_REASONS,
  createDismissal,
  type Dismissal,
  type DismissalDraft,
} from '../../domain/dismissal.js';
import type { DismissResult, DismissalRepository } from '../../ports/dismissal-repository.js';

/**
 * JSON-file dismissal log. Plumbing (atomic writes, serialised cycles, refusal to
 * overwrite an unreadable file) lives in `json-log-store.ts`; this file keeps the
 * schema and the dismissal rules.
 *
 * Refusing to overwrite matters more here than it looks: this file is the record
 * of decisions the human made by hand, and silently resetting it would resurrect
 * every offer they already said no to.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const dismissalSchema = z.object({
  jobId: z.string().min(1),
  dismissedAt: isoDate,
  title: z.string(),
  company: z.string(),
  reason: z.enum(DISMISSAL_REASONS).optional(),
});

export interface JsonDismissalRepositoryOptions {
  readonly filePath: string;
}

function serialize(dismissal: Dismissal) {
  return {
    jobId: dismissal.jobId,
    dismissedAt: dismissal.dismissedAt.toISOString(),
    title: dismissal.title,
    company: dismissal.company,
    ...(dismissal.reason === undefined ? {} : { reason: dismissal.reason }),
  };
}

/** Newest dismissal first: the most recent decision is the one being reviewed. */
function byNewestFirst(a: Dismissal, b: Dismissal): number {
  const byDate = b.dismissedAt.getTime() - a.dismissedAt.getTime();
  return byDate !== 0 ? byDate : a.jobId.localeCompare(b.jobId);
}

export function createJsonDismissalRepository(
  options: JsonDismissalRepositoryOptions,
): DismissalRepository {
  const store = createJsonLogStore({
    filePath: options.filePath,
    label: 'dismissal',
    entriesKey: 'dismissals',
    entrySchema: dismissalSchema,
    revive: ({ reason, ...entry }) =>
      createDismissal({ ...entry, ...(reason === undefined ? {} : { reason }) }),
    serialize,
  });

  return {
    async list(): Promise<readonly Dismissal[]> {
      const dismissals = await store.exclusive(store.readAll);
      return [...dismissals].sort(byNewestFirst);
    },

    async findByJobId(jobId: string): Promise<Dismissal | null> {
      const dismissals = await store.exclusive(store.readAll);
      return dismissals.find((entry) => entry.jobId === jobId.trim()) ?? null;
    },

    async dismiss(draft: DismissalDraft): Promise<DismissResult> {
      return store.exclusive(async () => {
        const dismissals = await store.readAll();
        const jobId = draft.jobId.trim();
        const existing = dismissals.find((entry) => entry.jobId === jobId);

        // Idempotency lives here, in the store, where it can actually be
        // guaranteed against a double click.
        if (existing !== undefined) {
          return { dismissal: existing, created: false };
        }

        const dismissal = createDismissal(draft);
        await store.writeAll([...dismissals, dismissal]);
        return { dismissal, created: true };
      });
    },

    async restore(jobId: string): Promise<boolean> {
      return store.exclusive(async () => {
        const dismissals = await store.readAll();
        const wanted = jobId.trim();
        const next = dismissals.filter((entry) => entry.jobId !== wanted);

        if (next.length === dismissals.length) {
          return false;
        }

        await store.writeAll(next);
        return true;
      });
    },
  };
}
