import { z } from 'zod';
import { createJsonLogStore } from './json-log-store.js';
import {
  CHANGE_SOURCES,
  HISTORY_FIELDS,
  type ApplicationChange,
  type FieldChange,
} from '../../domain/application-history.js';
import type { ApplicationHistoryRepository } from '../../ports/application-history-repository.js';

/**
 * JSON-file change history. Same plumbing as the other logs (atomic writes,
 * serialised cycles, an unreadable file is refused and never overwritten);
 * a missing file is an empty history.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const changeValue = z.union([z.string(), z.array(z.string()), z.null()]);

const entrySchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  at: isoDate,
  source: z.enum(CHANGE_SOURCES),
  changes: z.array(
    z.object({
      field: z.enum(HISTORY_FIELDS),
      before: changeValue,
      after: changeValue,
    }),
  ),
  revertsId: z.string().min(1).optional(),
});

export interface JsonApplicationHistoryRepositoryOptions {
  readonly filePath: string;
}

function serialize(entry: ApplicationChange) {
  return {
    id: entry.id,
    jobId: entry.jobId,
    at: entry.at.toISOString(),
    source: entry.source,
    changes: entry.changes.map((change) => ({
      field: change.field,
      before: change.before === null || typeof change.before === 'string' ? change.before : [...change.before],
      after: change.after === null || typeof change.after === 'string' ? change.after : [...change.after],
    })),
    ...(entry.revertsId === undefined ? {} : { revertsId: entry.revertsId }),
  };
}

export function createJsonApplicationHistoryRepository(
  options: JsonApplicationHistoryRepositoryOptions,
): ApplicationHistoryRepository {
  const store = createJsonLogStore({
    filePath: options.filePath,
    label: 'application history',
    entriesKey: 'changes',
    entrySchema,
    revive: (raw): ApplicationChange => ({
      id: raw.id,
      jobId: raw.jobId,
      at: raw.at,
      source: raw.source,
      changes: raw.changes as FieldChange[],
      ...(raw.revertsId === undefined ? {} : { revertsId: raw.revertsId }),
    }),
    serialize,
  });

  return {
    async append(entry) {
      await store.exclusive(async () => {
        const entries = await store.readAll();
        if (entries.some((existing) => existing.id === entry.id)) {
          throw new Error(`A history entry with id ${entry.id} already exists.`);
        }
        await store.writeAll([...entries, entry]);
      });
    },

    async listFor(jobId) {
      const entries = await store.exclusive(store.readAll);
      // Newest first; for equal instants the later append wins (stable file order).
      return entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.jobId === jobId)
        .sort((a, b) => b.entry.at.getTime() - a.entry.at.getTime() || b.index - a.index)
        .map(({ entry }) => entry);
    },

    async find(id) {
      const entries = await store.exclusive(store.readAll);
      return entries.find((entry) => entry.id === id) ?? null;
    },
  };
}
