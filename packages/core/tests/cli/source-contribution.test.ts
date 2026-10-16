import { describe, expect, it } from 'vitest';
import { renderRunSummary } from '../../src/cli/render-table.js';
import type { JobQueue, SourceReport } from '../../src/ports/queue-writer.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

/**
 * With one source, "who brought what" was obvious. With five it is the first
 * question to ask when the queue looks thin - and the answer already exists in
 * `sourceReports`, it just was not being shown unless something broke.
 *
 * A provider silently contributing zero for a month is exactly the failure this
 * line exists to make visible.
 */
function queue(sourceReports: readonly SourceReport[]): JobQueue {
  return {
    generatedAt: REFERENCE_NOW.toISOString(),
    candidate: 'Alex Example',
    totalFetched: 104,
    totalUnique: 102,
    totalRelevant: 51,
    totalJuniorEligible: 51,
    duplicatesRemoved: 2,
    sourceReports,
    jobs: [],
    excluded: [],
  };
}

const OK = (sourceId: string, fetched: number): SourceReport => ({
  sourceId,
  query: '(all company boards)',
  status: 'ok',
  fetched,
});

describe('per-source contribution in the run summary', () => {
  it('reports what every provider contributed', () => {
    const output = renderRunSummary(
      queue([OK('greenhouse', 62), OK('lever', 12), OK('ashby', 30)]),
    );

    expect(output).toContain('greenhouse 62');
    expect(output).toContain('lever 12');
    expect(output).toContain('ashby 30');
  });

  it('sums the attempts of a source asked once per query', () => {
    const output = renderRunSummary(
      queue([
        { sourceId: 'aggregator', query: 'junior developer', status: 'ok', fetched: 20 },
        { sourceId: 'aggregator', query: 'react', status: 'ok', fetched: 5 },
      ]),
    );
    expect(output).toContain('aggregator 25');
  });

  it('calls out a provider that contributed nothing', () => {
    // Zero is not the same as broken, and both are worth knowing about.
    const output = renderRunSummary(queue([OK('greenhouse', 62), OK('lever', 0)]));
    expect(output).toContain('lever 0');
  });

  it('marks a failed provider rather than reporting a silent zero', () => {
    const output = renderRunSummary(
      queue([
        OK('greenhouse', 62),
        { sourceId: 'aggregator', query: 'junior developer', status: 'failed', fetched: 0, error: 'HTTP 429' },
      ]),
    );
    expect(output).toMatch(/aggregator .*failed/i);
  });

  it('names unreachable company boards without calling the run degraded', () => {
    const output = renderRunSummary(
      queue([
        {
          ...OK('greenhouse', 62),
          degradedTargets: [
            { target: 'stripe', error: 'HTTP 404' },
            { target: 'gitlab', error: 'request timed out after 15000ms' },
          ],
        },
      ]),
    );

    expect(output).toContain('stripe');
    expect(output).toContain('gitlab');
    expect(output).not.toContain('Degraded run');
  });

  it('says nothing extra when there are no sources at all', () => {
    expect(renderRunSummary(queue([]))).not.toContain('Contributed');
  });
});
