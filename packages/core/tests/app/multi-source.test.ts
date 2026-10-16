import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { BOARD_SWEEP_LABEL } from '../../src/app/build-job-queue.js';
import { classifyRunHealth } from '../../src/app/persist-queue.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { Job } from '../../src/domain/job.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';
import { createRecordingLogger, silentLogger } from '../helpers/silent-logger.js';

/**
 * Going from two sources to five changes the FAILURE PROFILE of a run, not just
 * its volume. These tests pin the two properties that stop that from quietly
 * degrading the pipeline:
 *
 *  1. isolation - N sources, and any subset of them may die independently
 *  2. honest reporting - `sourceReports` must still say exactly who brought what
 */

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

const deps = {
  scoringConfig: DEFAULT_SCORING_CONFIG,
  juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
  logger: silentLogger,
  now: () => REFERENCE_NOW,
};

function job(sourceId: string, title: string): Job {
  return makeJob({
    sourceId,
    externalId: `${sourceId}-${title}`,
    title,
    company: `${sourceId}-co`,
    location: 'Madrid',
    description: 'React, TypeScript, Node. Junior. Ingles B1.',
    postedAt: daysAgo(1),
  });
}

function perQuerySource(id: string, jobs: readonly Job[]): JobSource {
  return { id, fetchJobs: async () => jobs };
}

function boardSource(
  id: string,
  jobs: readonly Job[],
  degraded: readonly { target: string; error: string }[] = [],
): JobSource {
  let calls = 0;
  let drained = false;
  return {
    id,
    queryMode: 'per-run',
    fetchJobs: async () => {
      calls += 1;
      return jobs;
    },
    takeDegradedTargets: () => {
      if (drained) {
        return [];
      }
      drained = true;
      return degraded;
    },
    // exposed for assertions only
    get callCount(): number {
      return calls;
    },
  } as JobSource & { readonly callCount: number };
}

function failing(id: string, message: string, queryMode?: 'per-run'): JobSource {
  return {
    id,
    ...(queryMode === undefined ? {} : { queryMode }),
    fetchJobs: async () => {
      throw new Error(message);
    },
  };
}

describe('multi-source isolation', () => {
  it('keeps every healthy source when several others fail', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [
          failing('aggregator', 'HTTP 429'),
          perQuerySource('fixture', [job('fixture', 'Junior React Developer')]),
          failing('lever', 'HTTP 500'),
          boardSource('greenhouse', [job('greenhouse', 'Junior Backend Developer')]),
          boardSource('ashby', [job('ashby', 'Junior Fullstack Developer')]),
        ],
      },
    );

    expect(queue.jobs).toHaveLength(3);
    const byId = new Map(queue.sourceReports.map((report) => [report.sourceId, report]));
    expect(byId.get('aggregator')?.status).toBe('failed');
    expect(byId.get('lever')?.status).toBe('failed');
    expect(byId.get('fixture')?.status).toBe('ok');
    expect(byId.get('greenhouse')?.status).toBe('ok');
    expect(byId.get('ashby')?.status).toBe('ok');
  });

  it('reports how many postings each provider contributed', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [
          perQuerySource('fixture', [job('fixture', 'A'), job('fixture', 'B')]),
          boardSource('greenhouse', [job('greenhouse', 'C')]),
        ],
      },
    );

    const fetchedBySource = Object.fromEntries(
      queue.sourceReports.map((report) => [report.sourceId, report.fetched]),
    );
    expect(fetchedBySource).toEqual({ fixture: 2, greenhouse: 1 });
  });

  it('records the error message of every failed source separately', async () => {
    const logger = createRecordingLogger();
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, logger, sources: [failing('a', 'boom-a'), failing('b', 'boom-b')] },
    );

    expect(queue.sourceReports.map((report) => report.error).sort()).toEqual(['boom-a', 'boom-b']);
    expect(logger.messages.filter((entry) => entry.level === 'error')).toHaveLength(2);
  });
});

describe('per-run sources', () => {
  it('asks a per-run source ONCE even with a seven-query search plan', async () => {
    let calls = 0;
    const source: JobSource = {
      id: 'greenhouse',
      queryMode: 'per-run',
      fetchJobs: async () => {
        calls += 1;
        return [job('greenhouse', 'Junior Dev')];
      },
    };

    const queries = Array.from({ length: 7 }, (_u, i) => ({ ...QUERY, what: `term ${i}` }));
    const queue = await buildJobQueue({ queries }, { ...deps, sources: [source] });

    expect(calls).toBe(1);
    expect(queue.sourceReports).toHaveLength(1);
  });

  it('still asks a per-query source once per query', async () => {
    let calls = 0;
    const source: JobSource = {
      id: 'aggregator',
      fetchJobs: async () => {
        calls += 1;
        return [];
      },
    };

    const queries = [QUERY, { ...QUERY, what: 'react' }, { ...QUERY, what: 'node' }];
    const queue = await buildJobQueue({ queries }, { ...deps, sources: [source] });

    expect(calls).toBe(3);
    expect(queue.sourceReports).toHaveLength(3);
  });

  it('labels the board sweep instead of pretending it ran a search term', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY, { ...QUERY, what: 'react' }] },
      { ...deps, sources: [boardSource('greenhouse', [])] },
    );

    expect(queue.sourceReports[0]?.query).toBe(BOARD_SWEEP_LABEL);
  });

  it('gives the sweep the widest maxDaysOld in the plan, so no query is under-served', async () => {
    let seen: JobSourceQuery | undefined;
    const source: JobSource = {
      id: 'greenhouse',
      queryMode: 'per-run',
      fetchJobs: async (query) => {
        seen = query;
        return [];
      },
    };

    await buildJobQueue(
      {
        queries: [
          { ...QUERY, maxDaysOld: 7 },
          { ...QUERY, maxDaysOld: 45 },
          { ...QUERY, maxDaysOld: 30 },
        ],
      },
      { ...deps, sources: [source] },
    );

    expect(seen?.maxDaysOld).toBe(45);
    expect(seen?.where).toBe('Madrid');
  });

  it('does not attempt a per-run source when the plan has no queries', async () => {
    let calls = 0;
    const source: JobSource = {
      id: 'greenhouse',
      queryMode: 'per-run',
      fetchJobs: async () => {
        calls += 1;
        return [];
      },
    };

    const queue = await buildJobQueue({ queries: [] }, { ...deps, sources: [source] });
    expect(calls).toBe(0);
    expect(queue.sourceReports).toEqual([]);
  });

  it('a failing per-run source is reported once, not once per query', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY, { ...QUERY, what: 'react' }, { ...QUERY, what: 'node' }] },
      { ...deps, sources: [failing('greenhouse', 'all boards down', 'per-run')] },
    );

    const failures = queue.sourceReports.filter((report) => report.status === 'failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error).toBe('all boards down');
  });
});

describe('degraded targets', () => {
  it('carries per-company failures onto the source report without failing the source', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [
          boardSource('greenhouse', [job('greenhouse', 'Junior Dev')], [
            { target: 'stripe', error: 'HTTP 404' },
          ]),
        ],
      },
    );

    const report = queue.sourceReports[0];
    expect(report?.status).toBe('ok');
    expect(report?.degradedTargets).toEqual([{ target: 'stripe', error: 'HTTP 404' }]);
  });

  it('omits the field entirely when nothing was degraded, so the JSON stays clean', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [boardSource('greenhouse', [job('greenhouse', 'X')])] },
    );
    expect(queue.sourceReports[0]?.degradedTargets).toBeUndefined();
  });

  it('a degraded target does NOT make the run degraded for the write guard', async () => {
    // One 404 among fifteen company boards is normal operating noise. If it
    // counted as a failed source query, "Degraded run" would print on every
    // single run and the warning would stop meaning anything.
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [
          boardSource('greenhouse', [job('greenhouse', 'X')], [
            { target: 'a', error: 'HTTP 404' },
            { target: 'b', error: 'HTTP 500' },
          ]),
        ],
      },
    );

    expect(classifyRunHealth(queue.sourceReports)).toBe('healthy');
  });

  it('a source that lost EVERY company is still a real failure', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [failing('greenhouse', 'all 3 greenhouse boards failed', 'per-run')] },
    );
    expect(classifyRunHealth(queue.sourceReports)).toBe('sources_failed');
  });
});

describe('the pipeline stays whole across sources', () => {
  it('applies the software-relevance gate to board postings too', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [
          boardSource('greenhouse', [
            makeJob({
              sourceId: 'greenhouse',
              externalId: 'g1',
              title: 'Accounting Analyst',
              company: 'Cabify',
              location: 'Madrid',
              description: 'Contabilidad, facturacion y cierre mensual. Excel avanzado.',
              postedAt: daysAgo(1),
            }),
            job('greenhouse', 'Junior React Developer'),
          ]),
        ],
      },
    );

    expect(queue.excluded.map((entry) => entry.title)).toContain('Accounting Analyst');
    expect(queue.jobs.map((entry) => entry.title)).toContain('Junior React Developer');
  });

  it('surfaces every posting from every provider, with no default cap', async () => {
    const jobs = Array.from({ length: 12 }, (_u, i) => job('greenhouse', `Junior Developer ${i}`));
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [boardSource('greenhouse', jobs.slice(0, 6)), boardSource('ashby', jobs.slice(6))],
      },
    );

    expect(queue.jobs).toHaveLength(12);
    expect(queue.totalJuniorEligible).toBe(12);
  });

  it('dedupes across a per-query source and a per-run source', async () => {
    const shared = makeJob({
      sourceId: 'aggregator',
      externalId: 'ad-1',
      title: 'Frontend Engineer (m/f/d)',
      company: 'Cabify S.L.',
      location: 'Madrid, Comunidad de Madrid, Spain',
      description: 'React y TypeScript.',
      postedAt: daysAgo(2),
    });
    const board = makeJob({
      sourceId: 'greenhouse',
      externalId: 'gh-1',
      title: 'Frontend Engineer',
      company: 'Cabify',
      location: 'Madrid',
      description: 'React y TypeScript. Junior.',
      postedAt: daysAgo(2),
    });

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [perQuerySource('aggregator', [shared]), boardSource('greenhouse', [board])] },
    );

    expect(queue.totalFetched).toBe(2);
    expect(queue.totalUnique).toBe(1);
    expect(queue.duplicatesRemoved).toBe(1);
  });
});
