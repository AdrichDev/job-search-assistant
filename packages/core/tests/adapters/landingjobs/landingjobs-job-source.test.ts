import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import {
  createLandingJobsSource,
  LANDINGJOBS_SOURCE_ID,
} from '../../../src/adapters/landingjobs/landingjobs-job-source.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against a RECORDED real response, captured 2026-09-10 from
 * `https://landing.jobs/api/v1/jobs?limit=50` and trimmed. No network here.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/landingjobs-response.json', import.meta.url));

/** The fixture's newest posting is 2026-04-09, so the window has to be wide. */
const NOW = new Date('2026-09-10T00:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: '(all Landing.jobs postings)',
  where: 'Madrid',
  maxDaysOld: 3650,
  resultsPerPage: 50,
  maxPages: 1,
};

interface Recorded {
  readonly urls: string[];
}

async function fixtureFetch(recorded: Recorded, override?: unknown): Promise<BoardFetch> {
  const payload: unknown = JSON.parse(await readFile(FIXTURE, 'utf8'));
  return async (url) => {
    recorded.urls.push(url);
    // Every page after the first is empty, which is how the real API signals
    // the end: `offset=50` returned four rows and `offset=100` returns none.
    const body = url.includes('offset=0') || !url.includes('offset') ? (override ?? payload) : [];
    return { ok: true, status: 200, json: async () => body } as never;
  };
}

async function run(query: JobSourceQuery = QUERY, override?: unknown) {
  const recorded: Recorded = { urls: [] };
  const logger = createRecordingLogger();
  const source = createLandingJobsSource({
    logger,
    fetchImpl: await fixtureFetch(recorded, override),
    now: () => NOW,
  });
  return { jobs: await source.fetchJobs(query), logger, source, recorded };
}

describe('landing.jobs source', () => {
  it('is a per-run sweep with its own label', async () => {
    const { source } = await run();
    expect(source.id).toBe(LANDINGJOBS_SOURCE_ID);
    expect(source.queryMode).toBe('per-run');
    expect(source.sweepLabel).toBe('(all Landing.jobs postings)');
  });

  it('asks with the only paging parameter this API actually honours', async () => {
    const { recorded } = await run();

    // Measured 2026-09-10: `limit=200` still returns 50, `page=2` returns page
    // one again, and `country_code=ES` changes nothing. Only `offset` moves.
    expect(recorded.urls[0]).toBe('https://landing.jobs/api/v1/jobs?limit=50&offset=0');
  });

  it('stops after a short page instead of asking for one it knows is empty', async () => {
    const { recorded } = await run();
    // A page smaller than the limit is the last page. Requesting the next one
    // to be told so is a request nobody needed to make.
    expect(recorded.urls).toHaveLength(1);
  });

  it('pages by offset while pages come back full, and stops on the empty one', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    // A full page (50 identical rows) forces a second request; that one is
    // empty and ends the sweep.
    const full = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      title: `Role ${index}`,
      url: `https://landing.jobs/at/acme/role-${index}`,
      published_at: '2026-09-01T00:00:00.000Z',
      remote: true,
      locations: [{ country_code: 'ES' }],
    }));

    const source = createLandingJobsSource({
      logger,
      now: () => NOW,
      fetchImpl: async (url) => {
        recorded.urls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => (url.includes('offset=0') ? full : []),
        } as never;
      },
    });

    await source.fetchJobs(QUERY);
    expect(recorded.urls).toEqual([
      'https://landing.jobs/api/v1/jobs?limit=50&offset=0',
      'https://landing.jobs/api/v1/jobs?limit=50&offset=50',
    ]);
  });

  it('never exceeds its page bound', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    const full = Array.from({ length: 50 }, (_, index) => ({
      id: index,
      title: `Role ${index}`,
      url: `https://landing.jobs/at/acme/role-${index}`,
      published_at: '2026-09-01T00:00:00.000Z',
      remote: true,
      locations: [{ country_code: 'ES' }],
    }));

    const source = createLandingJobsSource({
      logger,
      now: () => NOW,
      maxPages: 3,
      // Always full, so only the bound can stop it. An API that never returns
      // an empty page is how a polite fetch becomes an unbounded crawl.
      fetchImpl: async (url) => {
        recorded.urls.push(url);
        return { ok: true, status: 200, json: async () => full } as never;
      },
    });

    await source.fetchJobs(QUERY);
    expect(recorded.urls).toHaveLength(3);
  });

  it('keeps remote postings and drops the ones tied to a place that is not Spain', async () => {
    const { jobs } = await run();
    const titles = jobs.map((job) => job.title);

    // `remote` is a field this API reports, and a remote European role is one a
    // Madrid-based candidate can genuinely take.
    expect(titles).toContain('Principal Cloud Security Engineer');
    expect(titles).toContain('Data Platform Engineer');
    // On-site in Lisbon. Not remote, not Spain, so not applyable from Madrid.
    expect(titles).not.toContain('Senior Java Software Developer');
  });

  it('takes the apply URL from the payload', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Data Platform Engineer');

    expect(job?.url).toBe('https://landing.jobs/at/damia-group-portugal/data-platform-engineer-in');
    expect(job?.sources).toEqual([
      {
        sourceId: 'landingjobs',
        externalId: '19576',
        url: 'https://landing.jobs/at/damia-group-portugal/data-platform-engineer-in',
      },
    ]);
  });

  it('reads the employer off the URL the payload gave, never off the title', async () => {
    // Landing.jobs publishes no company field. The employer IS in the payload -
    // it is the `/at/<employer>/` segment of the posting's own URL - so it is
    // read from there rather than left blank or guessed from the description.
    const { jobs } = await run();
    expect(jobs.every((job) => job.company === 'Damia Group Portugal')).toBe(true);
  });

  it('reports salary only when the payload carried one', async () => {
    const { jobs } = await run();

    const paid = jobs.find((entry) => entry.title === 'Principal Cloud Security Engineer');
    expect(paid?.salaryMin).toBe(70000);
    expect(paid?.salaryMax).toBe(78000);

    // `gross_salary_low`/`high` are simply absent here. Absent stays null; a
    // zero would read as an employer offering nothing.
    const unpaid = jobs.find((entry) => entry.title === 'Data Platform Engineer');
    expect(unpaid?.salaryMin).toBeNull();
    expect(unpaid?.salaryMax).toBeNull();
  });

  it('reports the location the payload gave, without inventing a city', async () => {
    const { jobs } = await run();
    // These carry a country and no city. "PT" is the whole truth about them,
    // and "Portugal (Remote)" or "Lisbon" would both be inventions.
    expect(jobs.every((job) => job.location === 'PT')).toBe(true);
  });

  it('turns the HTML description fields into scorable plain text', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Principal Cloud Security Engineer');

    expect(job?.description.length).toBeGreaterThan(50);
    expect(job?.description).not.toContain('<li>');
    expect(job?.description).not.toContain('&nbsp;');
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 7 });
    // The newest fixture posting is 2026-08-04, well outside seven days.
    expect(jobs).toEqual([]);
  });

  it('degrades gracefully on malformed, partial and empty payloads', async () => {
    for (const payload of [[], ['nope', 42, null], [{ id: 1 }], [{ title: 'No url', id: 2 }]]) {
      const { jobs } = await run(QUERY, payload);
      expect(jobs).toEqual([]);
    }
  });

  it('fails the source when the envelope is not a list at all', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    const source = createLandingJobsSource({
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, { error: 'nope' }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/landing/i);
  });

  it('applies no stack or seniority filtering of its own', async () => {
    // A "Principal" role comes through untouched and is judged by the junior
    // gate downstream, where the decision lands in the audit trail.
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).toContain('Principal Cloud Security Engineer');
  });
});
