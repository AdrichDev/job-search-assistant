import { ES } from '@/copy/es';

/**
 * Pure provenance helpers for the UI.
 *
 * A label is only ever derived from a `sourceId` that an adapter actually
 * stamped on the vacancy. Unknown ids are shown as unknown, never mapped to a
 * portal name, so the UI cannot claim InfoJobs/Indeed support it does not have.
 */

export interface SourcedEntry {
  readonly sources: readonly { readonly sourceId: string }[];
}

export interface SourceOption {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export function sourceLabel(sourceId: string): string {
  return ES.source.labels[sourceId] ?? ES.source.unknown(sourceId);
}

/** Distinct source ids of one entry, in first-seen order. */
export function entrySourceIds(entry: SourcedEntry): string[] {
  return [...new Set(entry.sources.map((ref) => ref.sourceId))];
}

export function entrySourceLabels(entry: SourcedEntry): string[] {
  return entrySourceIds(entry).map(sourceLabel);
}

/** One option per source; a multi-source entry counts once under each of its sources. */
export function sourceOptions(entries: readonly SourcedEntry[]): SourceOption[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const id of entrySourceIds(entry)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: sourceLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

export function matchesSource(entry: SourcedEntry, selected: string): boolean {
  return selected === 'all' || entrySourceIds(entry).includes(selected);
}
