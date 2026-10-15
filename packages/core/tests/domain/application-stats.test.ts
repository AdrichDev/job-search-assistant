import { describe, expect, it } from 'vitest';
import { createApplication, withOutcome } from '../../src/domain/application.js';
import type { Application, ApplicationOutcome } from '../../src/domain/application.js';
import { computeApplicationStats } from '../../src/domain/application-stats.js';
import type { CvVariant } from '../../src/domain/job.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

let sequence = 0;

function application(
  cvVariant: CvVariant,
  outcome: ApplicationOutcome = 'applied',
  sourceIds: readonly string[] = [],
): Application {
  sequence += 1;
  const base = createApplication({
    jobId: `job-${sequence}`,
    appliedAt: REFERENCE_NOW,
    cvVariant,
    scoreAtApply: 70,
    sourceIds,
  });
  return outcome === 'applied' ? base : withOutcome(base, outcome, REFERENCE_NOW);
}

describe('computeApplicationStats', () => {
  it('returns a zeroed report for an empty log instead of NaN rates', () => {
    const stats = computeApplicationStats([]);
    expect(stats.totalApplied).toBe(0);
    expect(stats.responseRate).toBe(0);
    expect(stats.advanceRate).toBe(0);
    expect(stats.byVariant).toEqual([]);
  });

  it('attributes conversion to every source and keeps legacy applications auditable', () => {
    const stats = computeApplicationStats([
      application('frontend', 'interview', ['adzuna', 'manfred']),
      application('general', 'rejected', ['adzuna']),
      application('microsoft', 'no_reply'),
    ]);

    expect(stats.bySource).toEqual([
      {
        sourceId: 'adzuna',
        applied: 2,
        responses: 2,
        advances: 1,
        responseRate: 1,
        advanceRate: 0.5,
      },
      {
        sourceId: 'manfred',
        applied: 1,
        responses: 1,
        advances: 1,
        responseRate: 1,
        advanceRate: 1,
      },
      {
        sourceId: 'unknown',
        applied: 1,
        responses: 0,
        advances: 0,
        responseRate: 0,
        advanceRate: 0,
      },
    ]);
  });

  it('counts every logged application as applied, whatever its outcome', () => {
    const stats = computeApplicationStats([
      application('frontend'),
      application('frontend', 'no_reply'),
      application('microsoft', 'offer'),
    ]);
    expect(stats.totalApplied).toBe(3);
  });

  it('computes the overall response rate treating a rejection as a response', () => {
    const stats = computeApplicationStats([
      application('frontend', 'rejected'),
      application('frontend', 'no_reply'),
      application('frontend', 'no_reply'),
      application('frontend', 'interview'),
    ]);
    expect(stats.responses).toBe(2);
    expect(stats.responseRate).toBe(0.5);
  });

  it('tracks advances separately from responses', () => {
    const stats = computeApplicationStats([
      application('frontend', 'rejected'),
      application('frontend', 'interview'),
    ]);
    expect(stats.responses).toBe(2);
    expect(stats.advances).toBe(1);
    expect(stats.advanceRate).toBe(0.5);
  });

  it('reports applications still waiting for any answer', () => {
    const stats = computeApplicationStats([
      application('frontend'),
      application('frontend'),
      application('frontend', 'offer'),
    ]);
    expect(stats.pending).toBe(2);
  });

  it('breaks the response rate down per CV variant', () => {
    const stats = computeApplicationStats([
      application('microsoft', 'interview'),
      application('microsoft', 'screening'),
      application('frontend', 'no_reply'),
      application('frontend', 'no_reply'),
      application('frontend', 'rejected'),
    ]);

    const microsoft = stats.byVariant.find((row) => row.cvVariant === 'microsoft');
    const frontend = stats.byVariant.find((row) => row.cvVariant === 'frontend');

    expect(microsoft?.applied).toBe(2);
    expect(microsoft?.responseRate).toBe(1);
    expect(frontend?.applied).toBe(3);
    expect(frontend?.responseRate).toBeCloseTo(1 / 3, 10);
  });

  it('lists only variants that were actually used, most-used first', () => {
    const stats = computeApplicationStats([
      application('frontend'),
      application('frontend'),
      application('microsoft'),
    ]);
    expect(stats.byVariant.map((row) => row.cvVariant)).toEqual(['frontend', 'microsoft']);
  });

  it('tallies each outcome so the UI can show the funnel', () => {
    const stats = computeApplicationStats([
      application('frontend', 'offer'),
      application('frontend', 'no_reply'),
      application('frontend', 'no_reply'),
    ]);
    expect(stats.byOutcome.no_reply).toBe(2);
    expect(stats.byOutcome.offer).toBe(1);
    expect(stats.byOutcome.rejected).toBe(0);
  });
});
