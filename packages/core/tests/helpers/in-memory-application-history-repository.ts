import type { ApplicationChange } from '../../src/domain/application-history.js';
import type { ApplicationHistoryRepository } from '../../src/ports/application-history-repository.js';

/** In-memory `ApplicationHistoryRepository`. `failAppend` simulates a broken disk. */
export function createInMemoryApplicationHistoryRepository(
  options: { failAppend?: boolean } = {},
): ApplicationHistoryRepository & { readonly all: () => readonly ApplicationChange[] } {
  const entries: ApplicationChange[] = [];
  return {
    all: () => [...entries],
    async append(entry) {
      if (options.failAppend === true) {
        throw new Error('disk full');
      }
      entries.push(entry);
    },
    async listFor(jobId) {
      // Newest first; insertion order breaks ties between equal instants.
      return entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.jobId === jobId)
        .sort((a, b) => b.entry.at.getTime() - a.entry.at.getTime() || b.index - a.index)
        .map(({ entry }) => entry);
    },
    async find(id) {
      return entries.find((entry) => entry.id === id) ?? null;
    },
  };
}
