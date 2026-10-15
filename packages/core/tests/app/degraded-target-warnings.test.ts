import { describe, expect, it } from 'vitest';
import { decideQueueWrite } from '../../src/app/persist-queue.js';
import type { SourceReport } from '../../src/ports/queue-writer.js';

/**
 * Five sources over ~20 company boards means SOMETHING is always slightly
 * broken. The degraded-write guard was designed when a failure was rare and
 * alarming; if every run now prints "Degraded run", the warning trains the
 * candidate to ignore the one time it actually mattered.
 *
 * So the two facts are kept separate:
 *
 *  - a failed SOURCE QUERY  -> run health, can refuse a write   (loud, rare)
 *  - a failed COMPANY BOARD -> a note on an otherwise ok source (quiet, common)
 */

function ok(sourceId: string, degradedTargets?: readonly { target: string; error: string }[]): SourceReport {
  return {
    sourceId,
    query: '(all company boards)',
    status: 'ok',
    fetched: 10,
    ...(degradedTargets === undefined ? {} : { degradedTargets }),
  };
}

function failed(sourceId: string): SourceReport {
  return { sourceId, query: 'junior developer', status: 'failed', fetched: 0, error: 'HTTP 429' };
}

describe('write decision with per-board degradation', () => {
  it('stays silent when every source answered cleanly', () => {
    const decision = decideQueueWrite({
      sourceReports: [ok('greenhouse'), ok('lever')],
      incomingJobCount: 25,
      existing: { kind: 'present', jobCount: 20 },
    });

    expect(decision.action).toBe('write');
    expect(decision.action === 'write' && decision.warnings).toEqual([]);
  });

  it('notes unreachable company boards without calling the run degraded', () => {
    const decision = decideQueueWrite({
      sourceReports: [ok('greenhouse', [{ target: 'stripe', error: 'HTTP 404' }]), ok('lever')],
      incomingJobCount: 25,
      existing: { kind: 'present', jobCount: 20 },
    });

    expect(decision.action).toBe('write');
    expect(decision.health).toBe('healthy');
    const warnings = decision.action === 'write' ? decision.warnings : [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('stripe');
    expect(warnings[0]).not.toMatch(/degraded run/i);
  });

  it('names every unreachable board across providers', () => {
    const decision = decideQueueWrite({
      sourceReports: [
        ok('greenhouse', [{ target: 'stripe', error: 'HTTP 404' }]),
        ok('ashby', [{ target: 'cohere', error: 'HTTP 500' }]),
      ],
      incomingJobCount: 25,
      existing: { kind: 'absent' },
    });

    const warnings = decision.action === 'write' ? decision.warnings : [];
    expect(warnings[0]).toContain('greenhouse/stripe');
    expect(warnings[0]).toContain('ashby/cohere');
  });

  it('keeps the degraded-run warning for an actually failed source query', () => {
    const decision = decideQueueWrite({
      sourceReports: [ok('greenhouse'), failed('adzuna')],
      incomingJobCount: 25,
      existing: { kind: 'present', jobCount: 20 },
    });

    const warnings = decision.action === 'write' ? decision.warnings : [];
    expect(warnings.some((warning) => /degraded run/i.test(warning))).toBe(true);
  });

  it('still refuses to overwrite real postings when everything failed and nothing came back', () => {
    // The original data-loss guard, unchanged by any of this.
    const decision = decideQueueWrite({
      sourceReports: [failed('adzuna'), failed('greenhouse')],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('refuse');
  });

  it('does not refuse when unreachable boards are the ONLY problem', () => {
    // Every source answered. An empty result here is a real, if disappointing,
    // statement about the job market.
    const decision = decideQueueWrite({
      sourceReports: [ok('greenhouse', [{ target: 'stripe', error: 'HTTP 404' }])],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('write');
  });

  it('caps the board list so one bad day does not print forty lines', () => {
    const targets = Array.from({ length: 40 }, (_u, i) => ({
      target: `company-${i}`,
      error: 'HTTP 404',
    }));
    const decision = decideQueueWrite({
      sourceReports: [ok('greenhouse', targets)],
      incomingJobCount: 5,
      existing: { kind: 'absent' },
    });

    const warnings = decision.action === 'write' ? decision.warnings : [];
    expect(warnings[0]).toMatch(/40 company board/);
    expect(warnings[0]?.length).toBeLessThan(400);
  });
});
