import { describe, expect, it } from 'vitest';
import { createDismissal } from '../../src/domain/dismissal.js';
import { partitionByDismissal } from '../../src/app/dismissal-view.js';
import type { JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';

/**
 * How a dismissal reaches the screen.
 *
 * The dismissal store is the source of truth and the queue file is left ALONE.
 * That is the load-bearing decision of this whole feature: the queue is the
 * record of what the pipeline found, and editing it to remove a row the human
 * rejected would be the hard delete this codebase refuses everywhere else.
 *
 * Because the queue is untouched, a dismissal survives a re-run for free - the
 * next queue file contains the same posting under the same fingerprint id, and
 * this projection hides it again without the pipeline knowing dismissals exist.
 * It is also why restore is instant: the posting never left.
 */

const NOW = '2026-03-10T09:00:00.000Z';

function entry(id: string, title: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
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
    title,
    company: 'ACME',
    location: 'Madrid',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    postedAt: NOW,
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    liveness: null,
    ...overrides,
  };
}

function queue(jobs: readonly QueueEntry[]): JobQueue {
  return {
    generatedAt: NOW,
    candidate: 'Adrian',
    totalFetched: jobs.length,
    totalUnique: jobs.length,
    totalRelevant: jobs.length,
    totalJuniorEligible: jobs.length,
    duplicatesRemoved: 0,
    sourceReports: [],
    excluded: [],
    jobs,
  };
}

const A = entry('a::b::c', 'Junior Frontend Developer');
const B = entry('d::e::f', 'Desarrollador Junior .NET');

describe('partitionByDismissal', () => {
  it('leaves every offer visible when nothing was dismissed', () => {
    const result = partitionByDismissal(queue([A, B]), []);

    expect(result.visible.map((row) => row.id)).toEqual(['a::b::c', 'd::e::f']);
    expect(result.dismissed).toEqual([]);
  });

  it('removes a dismissed offer from the visible queue', () => {
    const result = partitionByDismissal(queue([A, B]), [
      createDismissal({ jobId: 'a::b::c', dismissedAt: new Date(NOW), title: 'x', company: 'y' }),
    ]);

    expect(result.visible.map((row) => row.id)).toEqual(['d::e::f']);
  });

  it('lists the dismissed offer so it can be reviewed and restored', () => {
    const result = partitionByDismissal(queue([A, B]), [
      createDismissal({
        jobId: 'a::b::c',
        dismissedAt: new Date(NOW),
        title: 'Junior Frontend Developer',
        company: 'ACME',
      }),
    ]);

    expect(result.dismissed).toEqual([
      {
        jobId: 'a::b::c',
        title: 'Junior Frontend Developer',
        company: 'ACME',
        location: 'Madrid',
        url: 'https://boards.greenhouse.io/acme/jobs/1',
        dismissedAt: NOW,
        inQueue: true,
      },
    ]);
  });

  /**
   * The case that justifies storing a snapshot at dismissal time. Without it,
   * a dismissal whose posting has since left the queue would render as the raw
   * `company::title::city` fingerprint, which is not a thing a human recognises.
   */
  it('still lists a dismissal whose posting is no longer in the queue', () => {
    const result = partitionByDismissal(queue([B]), [
      createDismissal({
        jobId: 'a::b::c',
        dismissedAt: new Date(NOW),
        title: 'Junior Frontend Developer',
        company: 'ACME',
      }),
    ]);

    expect(result.dismissed).toEqual([
      {
        jobId: 'a::b::c',
        title: 'Junior Frontend Developer',
        company: 'ACME',
        location: null,
        url: null,
        dismissedAt: NOW,
        inQueue: false,
      },
    ]);
  });

  it('orders the review list newest dismissal first', () => {
    const result = partitionByDismissal(queue([A, B]), [
      createDismissal({
        jobId: 'a::b::c',
        dismissedAt: new Date('2026-03-01T09:00:00.000Z'),
        title: 't',
        company: 'c',
      }),
      createDismissal({
        jobId: 'd::e::f',
        dismissedAt: new Date('2026-03-09T09:00:00.000Z'),
        title: 't',
        company: 'c',
      }),
    ]);

    expect(result.dismissed.map((row) => row.jobId)).toEqual(['d::e::f', 'a::b::c']);
  });

  it('never mutates the queue it was given', () => {
    const original = queue([A, B]);
    partitionByDismissal(original, [
      createDismissal({ jobId: 'a::b::c', dismissedAt: new Date(NOW), title: 't', company: 'c' }),
    ]);

    expect(original.jobs).toHaveLength(2);
  });

  /**
   * SURVIVES A RE-RUN. The pipeline mints ids from `jobFingerprint`, which is a
   * pure function of company, title and location - so the same vacancy in a
   * queue written tomorrow carries the same id and is hidden again with no
   * pipeline involvement whatsoever.
   */
  it('hides the same posting again in a freshly generated queue', () => {
    const dismissal = createDismissal({
      jobId: 'a::b::c',
      dismissedAt: new Date(NOW),
      title: 't',
      company: 'c',
    });

    const rerun = queue([
      { ...A, rank: 1, postedAt: '2026-03-20T09:00:00.000Z' },
      { ...B, rank: 2 },
    ]);

    expect(partitionByDismissal(rerun, [dismissal]).visible.map((row) => row.id)).toEqual([
      'd::e::f',
    ]);
  });
});
