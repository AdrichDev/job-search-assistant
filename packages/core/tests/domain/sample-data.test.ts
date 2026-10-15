import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DATA_SOURCE_IDS,
  countSampleDataEntries,
  hasSampleDataSource,
  isSampleDataSourceId,
} from '../../src/domain/sample-data.js';
import type { JobSourceRef } from '../../src/domain/job.js';

/**
 * "Which of these postings are invented?" asked of the DATA, not of the flags
 * that produced it.
 *
 * The `--source` parser now refuses to mix the fixture into a real run, but
 * that only governs one entry point. A queue file the user kept from an older
 * build, a hand-edited `output/queue.json`, and the web app's own offline
 * fallback all still carry fixture postings - and every one of them ends up in
 * front of a human with an apply button next to it.
 *
 * So provenance is read off `sources[]`, which every path into the system fills
 * in through `createJob`. That is the only claim about origin the queue makes
 * that no caller can forget to pass along.
 */

function ref(sourceId: string): JobSourceRef {
  return { sourceId, externalId: 'x', url: 'https://example-board.test/offers/fx-010' };
}

describe('sample-data provenance', () => {
  it('names the fixture, and only the fixture, as sample data', () => {
    expect([...SAMPLE_DATA_SOURCE_IDS]).toEqual(['fixture']);

    expect(isSampleDataSourceId('fixture')).toBe(true);
    for (const real of ['adzuna', 'greenhouse', 'lever', 'ashby', 'newsletter']) {
      expect(isSampleDataSourceId(real)).toBe(false);
    }
  });

  it('flags a posting whose only source is the fixture', () => {
    expect(hasSampleDataSource({ sources: [ref('fixture')] })).toBe(true);
  });

  it('does not flag a posting that came from a real source', () => {
    expect(hasSampleDataSource({ sources: [ref('greenhouse')] })).toBe(false);
  });

  it('flags a DEDUPED posting that a real source and the fixture both claim', () => {
    // Cross-source dedupe collapses a vacancy into one entry carrying several
    // refs. If one of them is the catalogue, the row is partly invented, and
    // "partly invented" is not a state that gets to render as clean.
    expect(hasSampleDataSource({ sources: [ref('greenhouse'), ref('fixture')] })).toBe(true);
  });

  it('treats a posting with no recorded source as real rather than crying wolf', () => {
    // A missing provenance record is a different problem with a different fix.
    // Reporting it as sample data would teach the reader to ignore the banner.
    expect(hasSampleDataSource({ sources: [] })).toBe(false);
  });

  it('counts how many entries are sample data, which is what the banners print', () => {
    expect(
      countSampleDataEntries([
        { sources: [ref('fixture')] },
        { sources: [ref('greenhouse')] },
        { sources: [ref('lever'), ref('fixture')] },
        { sources: [] },
      ]),
    ).toBe(2);

    expect(countSampleDataEntries([])).toBe(0);
  });
});
