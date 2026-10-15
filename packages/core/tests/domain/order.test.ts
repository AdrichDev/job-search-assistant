import { describe, expect, it } from 'vitest';
import { orderByRecency, scoreJobs } from '../../src/domain/order.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';

/**
 * Replaces the old `rankJobs`, which scored AND ordered by score in one step.
 *
 * The two responsibilities are now separate because the product changed: the
 * score is still computed and persisted (the application-outcome analysis will
 * need it to correlate score against reply rate), but it no longer decides what
 * the candidate sees first. Recency does, and recency needs no defending.
 *
 * Keeping `scoreJobs` free of ordering is what makes that split honest - a
 * function that scores and sorts cannot be reused by a caller that wants only
 * one of the two.
 */

const config = DEFAULT_SCORING_CONFIG;

describe('scoreJobs', () => {
  it('scores every job and drops none', () => {
    const jobs = [
      makeJob({ company: 'A', title: 'Senior Lead' }),
      makeJob({ company: 'B', title: 'Junior Dev' }),
      makeJob({ company: 'C', title: 'Cocinero' }),
    ];
    expect(scoreJobs(jobs, config, REFERENCE_NOW)).toHaveLength(3);
  });

  it('preserves input order: scoring is not ordering', () => {
    const first = makeJob({ company: 'Globex', title: 'Senior Architect', location: 'Barcelona' });
    const second = makeJob({
      company: 'ACME',
      title: 'Desarrollador Junior Frontend',
      location: 'Madrid',
      description: 'React, TypeScript, sin experiencia previa.',
    });

    const scored = scoreJobs([first, second], config, REFERENCE_NOW);

    expect(scored.map((entry) => entry.job.company)).toEqual(['Globex', 'ACME']);
    // ...and the better-scoring one really is second, so this is a real check.
    expect(scored[1]?.score.total).toBeGreaterThan(scored[0]?.score.total ?? 0);
  });

  it('handles an empty list', () => {
    expect(scoreJobs([], config, REFERENCE_NOW)).toEqual([]);
  });
});

describe('orderByRecency', () => {
  it('puts the newest posting first', () => {
    const old = makeJob({ company: 'Old', postedAt: daysAgo(10) });
    const fresh = makeJob({ company: 'Fresh', postedAt: daysAgo(1) });
    const middle = makeJob({ company: 'Middle', postedAt: daysAgo(5) });

    const ordered = orderByRecency(scoreJobs([old, fresh, middle], config, REFERENCE_NOW));

    expect(ordered.map((entry) => entry.job.company)).toEqual(['Fresh', 'Middle', 'Old']);
  });

  it('ignores the score entirely', () => {
    const highScoreOld = makeJob({
      company: 'HighOld',
      title: 'Desarrollador Junior Frontend',
      location: 'Madrid',
      description: 'React, TypeScript, sin experiencia previa. Ingles B1.',
      postedAt: daysAgo(20),
    });
    const lowScoreNew = makeJob({
      company: 'LowNew',
      title: 'Software Engineer',
      location: 'Barcelona',
      description: 'Fluent English required. 2 anos de experiencia con Java.',
      postedAt: daysAgo(0),
    });

    const scored = scoreJobs([highScoreOld, lowScoreNew], config, REFERENCE_NOW);
    const ordered = orderByRecency(scored);

    const highest = [...scored].sort((a, b) => b.score.total - a.score.total)[0];
    expect(highest?.job.company).toBe('HighOld');
    expect(ordered[0]?.job.company).toBe('LowNew');
  });

  it('breaks ties deterministically, so the output stays byte-stable', () => {
    const sameInstant = daysAgo(3);
    const a = makeJob({ company: 'Alpha', postedAt: sameInstant });
    const b = makeJob({ company: 'Beta', postedAt: sameInstant });

    const first = orderByRecency(scoreJobs([a, b], config, REFERENCE_NOW)).map(
      (entry) => entry.job.id,
    );
    const second = orderByRecency(scoreJobs([b, a], config, REFERENCE_NOW)).map(
      (entry) => entry.job.id,
    );

    expect(first).toEqual(second);
  });

  it('does not mutate its input', () => {
    const jobs = [
      makeJob({ company: 'A', postedAt: daysAgo(1) }),
      makeJob({ company: 'B', postedAt: daysAgo(9) }),
      makeJob({ company: 'C', postedAt: daysAgo(5) }),
    ];
    const scored = scoreJobs(jobs, config, REFERENCE_NOW);
    const before = scored.map((entry) => entry.job.company);

    orderByRecency(scored);

    expect(scored.map((entry) => entry.job.company)).toEqual(before);
  });

  it('handles an empty list', () => {
    expect(orderByRecency([])).toEqual([]);
  });
});
