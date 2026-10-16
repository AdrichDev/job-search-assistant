import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../../src/app/summarize-run.js';
import type { PersistQueueResult } from '../../src/app/persist-queue.js';
import type { ExcludedEntry, JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';

/**
 * The run report, as NUMBERS rather than a paragraph.
 *
 * Every figure below is read off the queue the pipeline already produced and
 * the decision `persistQueue` already made. Nothing is recomputed and nothing
 * is invented: the CLI prints these same values through `render-table.ts`, and
 * a second summary that could disagree with the first is worse than no summary.
 *
 * Keeping it structured rather than a formatted string is what lets the Spanish
 * UI render it without the core knowing a word of Spanish.
 */

const NOW = '2026-03-10T09:00:00.000Z';

function excluded(
  id: string,
  excludedBy: ExcludedEntry['excludedBy'],
): ExcludedEntry {
  return {
    id,
    title: 't',
    company: 'c',
    location: 'l',
    url: 'https://example.test/1',
    postedAt: NOW,
    excludedBy,
    scoreBeforeGate: 10,
    softwareRelevance: 0.9,
    reason: 'because',
  };
}

function job(id: string): QueueEntry {
  return {
    rank: 1,
    id,
    score: 50,
    cvVariant: 'general',
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: [],
      cvVariant: 'general',
      englishRequired: 'not_stated',
      workMode: 'unknown',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: 't',
    company: 'c',
    location: 'l',
    url: 'https://example.test/1',
    postedAt: NOW,
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    liveness: null,
  };
}

const QUEUE: JobQueue = {
  generatedAt: NOW,
  candidate: 'Adrian',
  totalFetched: 137,
  totalUnique: 120,
  totalRelevant: 90,
  totalJuniorEligible: 64,
  duplicatesRemoved: 17,
  sourceReports: [
    { sourceId: 'greenhouse', query: '(all company boards)', status: 'ok', fetched: 40 },
    {
      sourceId: 'aggregator',
      query: 'junior developer',
      status: 'failed',
      fetched: 0,
      error: 'HTTP 429 Too Many Requests',
    },
  ],
  excluded: [
    excluded('x1', 'software_relevance'),
    excluded('x2', 'software_relevance'),
    excluded('x3', 'junior_eligibility'),
    excluded('x4', 'dead_link'),
    excluded('x5', 'location_incompatible'),
    excluded('x6', 'experience_over_limit'),
    excluded('x7', 'seniority_excluded'),
  ],
  jobs: [job('a'), job('b')],
};

const WRITTEN: PersistQueueResult = {
  status: 'written',
  path: 'output/queue.json',
  health: 'degraded',
  warnings: ['Degraded run: 1 of 2 source queries failed.'],
};

const REFUSED: PersistQueueResult = {
  status: 'refused',
  health: 'sources_failed',
  reason: '2 of 2 source queries failed and the run produced no postings.',
  preservedJobCount: 131,
};

describe('summarizeRun', () => {
  it('reports the counts the CLI already prints', () => {
    const summary = summarizeRun(QUEUE, WRITTEN);

    expect(summary).toMatchObject({
      outcome: 'written',
      totalFetched: 137,
      totalUnique: 120,
      duplicatesRemoved: 17,
      excludedNotSoftware: 2,
      excludedNotJunior: 3,
      excludedByLocation: 1,
      excludedByExperience: 1,
      excludedBySeniority: 1,
      removedAsGone: 1,
    });
  });

  /**
   * `totalJuniorEligible` is measured BEFORE dead postings are removed, so
   * reporting it raw would claim four offers exist that the user cannot see.
   * The CLI already subtracts them for exactly this reason.
   */
  it('reports available offers net of the dead-link removals', () => {
    expect(summarizeRun(QUEUE, WRITTEN).offersAvailable).toBe(63);
  });

  it('names every source query that failed, with its error', () => {
    expect(summarizeRun(QUEUE, WRITTEN).failedSources).toEqual([
      { sourceId: 'aggregator', query: 'junior developer', error: 'HTTP 429 Too Many Requests' },
    ]);
  });

  it('carries the write warnings through instead of restating them', () => {
    expect(summarizeRun(QUEUE, WRITTEN).warnings).toEqual(WRITTEN.warnings);
  });

  it('reports a healthy run with no failures and no warnings', () => {
    const summary = summarizeRun(
      { ...QUEUE, sourceReports: [QUEUE.sourceReports[0] as never] },
      { status: 'written', path: 'p', health: 'healthy', warnings: [] },
    );

    expect(summary.failedSources).toEqual([]);
    expect(summary.warnings).toEqual([]);
    expect(summary.refusalReason).toBeNull();
  });

  /**
   * The degraded-write guard, surfaced. A refused run must read as "your data
   * was protected", never as a silent success.
   */
  it('reports a refused write with the reason and what it preserved', () => {
    const summary = summarizeRun(QUEUE, REFUSED);

    expect(summary.outcome).toBe('refused');
    expect(summary.refusalReason).toContain('produced no postings');
    expect(summary.preservedJobCount).toBe(131);
  });

  it('reports an unknown preserved count when the old file was unreadable', () => {
    const summary = summarizeRun(QUEUE, { ...REFUSED, preservedJobCount: -1 });
    expect(summary.preservedJobCount).toBeNull();
  });

  it('reports the liveness pass being off as zero removals, not as unknown', () => {
    const summary = summarizeRun(
      { ...QUEUE, excluded: [excluded('x1', 'software_relevance')] },
      WRITTEN,
    );
    expect(summary.removedAsGone).toBe(0);
  });
});
