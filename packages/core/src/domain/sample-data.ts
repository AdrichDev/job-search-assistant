import type { JobSourceRef } from './job.js';

/**
 * WHICH POSTINGS ARE INVENTED.
 *
 * The committed catalogue in `data/sample-jobs.json` exists so the pipeline,
 * its tests and a first-launch demo can run with no API key and no network.
 * Every one of its URLs is on `example-board.test`, a reserved TLD that
 * resolves nowhere. That is the right design for a demo and a disaster the
 * moment one of those rows reaches a real queue with an apply button next to
 * it - which is exactly what `--source=all` did.
 *
 * `cli/source-selection.ts` now refuses to mix the catalogue into a real run.
 * But that guards ONE entry point, and sample postings can still legitimately
 * reach a human:
 *
 *   - `--source=fixture`, asked for deliberately;
 *   - the web app's offline fallback, before the first pipeline run;
 *   - an `output/queue.json` left over from an older build or edited by hand.
 *
 * So "is this row real?" is answered from the DATA rather than from the flags
 * that produced it. `sources[]` is filled in by `createJob`, which every path
 * into the system goes through, so it is the one origin claim no caller can
 * forget to pass along.
 *
 * Pure: no I/O, no node builtins, no third-party imports.
 */

/**
 * Source ids whose postings are demo data.
 *
 * A set rather than a single constant because the question this answers is
 * "which sources are not real", and one day the answer might include a second
 * catalogue. It must never include a source that reports live vacancies.
 */
export const SAMPLE_DATA_SOURCE_IDS: ReadonlySet<string> = new Set(['fixture']);

export function isSampleDataSourceId(sourceId: string): boolean {
  return SAMPLE_DATA_SOURCE_IDS.has(sourceId);
}

/** Anything carrying the provenance refs `createJob` mints: a `Job` or a `QueueEntry`. */
export interface SourceAttributed {
  readonly sources: readonly JobSourceRef[];
}

/**
 * True when ANY of the entry's sources is a sample catalogue.
 *
 * `any`, not `every`, and the distinction is load-bearing: cross-source dedupe
 * collapses a vacancy into one row carrying several refs. A row half-claimed by
 * the catalogue is partly invented, and partly invented does not get to render
 * as clean.
 *
 * An entry with NO recorded source reads as real. A missing provenance record
 * is a different defect with a different fix, and reporting it here would train
 * the reader to ignore the banner that matters.
 */
export function hasSampleDataSource(entry: SourceAttributed): boolean {
  return entry.sources.some((ref) => isSampleDataSourceId(ref.sourceId));
}

/** How many entries are sample data. The number both banners print. */
export function countSampleDataEntries(entries: readonly SourceAttributed[]): number {
  return entries.filter(hasSampleDataSource).length;
}
