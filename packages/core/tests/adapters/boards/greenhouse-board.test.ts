import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGreenhouseJobSource } from '../../../src/adapters/boards/greenhouse-board.js';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import type { CompanyBoard } from '../../../src/config/company-boards.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against a RECORDED real response.
 *
 * The fixture in `tests/fixtures/greenhouse-response.json` was captured from
 * `https://boards-api.greenhouse.io/v1/boards/cabify/jobs?content=true` and
 * trimmed, not hand-written: a hand-written fixture only proves the adapter
 * agrees with my imagination of the API. No test here touches the network.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/greenhouse-response.json', import.meta.url));

const NOW = new Date('2026-09-08T12:00:00.000Z');

const CABIFY: CompanyBoard = {
  slug: 'cabify',
  provider: 'greenhouse',
  displayName: 'Cabify',
  verifiedOn: '2026-09-08',
  spainOpeningsAtVerification: 26,
  softwareOpeningsAtVerification: 1,
};

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

async function fixturePayload(): Promise<unknown> {
  return JSON.parse(await readFile(FIXTURE, 'utf8'));
}

async function fixtureFetch(record?: string[]): Promise<BoardFetch> {
  const payload = await fixturePayload();
  return async (url) => {
    record?.push(url);
    return { ok: true, status: 200, json: async () => payload };
  };
}

async function run(query: JobSourceQuery = QUERY, urls?: string[]) {
  const logger = createRecordingLogger();
  const source = createGreenhouseJobSource({
    companies: [CABIFY],
    logger,
    fetchImpl: await fixtureFetch(urls),
    now: () => NOW,
  });
  return { jobs: await source.fetchJobs(query), logger, source };
}

describe('greenhouse board source', () => {
  it('asks for the documented per-company endpoint with content=true', async () => {
    const urls: string[] = [];
    await run(QUERY, urls);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://boards-api.greenhouse.io/v1/boards/cabify/jobs?content=true');
  });

  it('is identified as the greenhouse source and sweeps once per run', async () => {
    const { source } = await run();
    expect(source.id).toBe('greenhouse');
    // Per-company boards are not search engines: asking them once per search
    // term would be N identical requests against a free endpoint.
    expect(source.queryMode).toBe('per-run');
  });

  it('keeps only the postings located in Spain', async () => {
    const { jobs } = await run();
    // The fixture holds two Madrid postings and one in Lima.
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => /madrid/i.test(job.location))).toBe(true);
    expect(jobs.some((job) => /lima/i.test(job.location))).toBe(false);
  });

  it('normalizes a posting into the domain shape', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Accounting Analyst');

    expect(job).toBeDefined();
    expect(job?.company).toBe('Cabify');
    expect(job?.location).toBe('Madrid');
    expect(job?.url).toBe('https://job-boards.greenhouse.io/cabify/jobs/8642423002');
    expect(job?.sources).toEqual([
      {
        sourceId: 'greenhouse',
        externalId: '8642423002',
        url: 'https://job-boards.greenhouse.io/cabify/jobs/8642423002',
      },
    ]);
  });

  it('dates a posting by first publication, not by its last edit', async () => {
    // `updated_at` is a board-wide touch timestamp: using it would make every
    // stale vacancy look like it was posted this morning and hijack the
    // recency dimension.
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Accounting Analyst');
    expect(job?.postedAt.toISOString()).toBe(new Date('2026-07-21T06:52:46-04:00').toISOString());
  });

  it('converts the escaped-HTML description into scorable plain text', async () => {
    const { jobs } = await run();
    const job = jobs[0];

    expect(job?.description.length).toBeGreaterThan(50);
    expect(job?.description).not.toContain('&lt;');
    expect(job?.description).not.toContain('<p');
    expect(job?.description).not.toContain('&quot;');
    expect(job?.description).toContain('Cabify');
  });

  it('reports no salary rather than inventing one', async () => {
    // Greenhouse's board API exposes no compensation field at all.
    const { jobs } = await run();
    expect(jobs.every((job) => job.salaryMin === null && job.salaryMax === null)).toBe(true);
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 55 });
    // Only the 2026-07-21 posting is inside 55 days of 2026-09-08.
    expect(jobs.map((job) => job.title)).toEqual(['Accounting Analyst']);
  });

  it('applies no stack filtering: a non-developer posting still comes through', async () => {
    // The ranker and the software-relevance gate decide that, not the adapter.
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).toContain('Accounting Analyst');
  });

  it('skips a malformed posting instead of crashing the run', async () => {
    const logger = createRecordingLogger();
    const source = createGreenhouseJobSource({
      companies: [CABIFY],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { id: 1, title: 'Ok Job', location: { name: 'Madrid' }, absolute_url: 'https://x.test/1', first_published: '2026-09-01T00:00:00Z', company_name: 'Cabify' },
            { id: 2, location: { name: 'Madrid' } },
            { title: 'No url', location: { name: 'Madrid' }, first_published: '2026-09-01T00:00:00Z' },
            'not an object',
          ],
        }),
      }),
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.title)).toEqual(['Ok Job']);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('skips a posting whose date cannot be parsed', async () => {
    const logger = createRecordingLogger();
    const source = createGreenhouseJobSource({
      companies: [CABIFY],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { id: 7, title: 'Broken date', location: { name: 'Madrid' }, absolute_url: 'https://x.test/7', first_published: 'not-a-date', company_name: 'Cabify' },
          ],
        }),
      }),
    });
    expect(await source.fetchJobs(QUERY)).toEqual([]);
  });

  it('rejects an envelope with no jobs array', async () => {
    const logger = createRecordingLogger();
    const source = createGreenhouseJobSource({
      companies: [CABIFY],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: 'nope' }) }),
    });

    // A single company failing is absorbed, but nothing usable came back.
    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/greenhouse/i);
  });

  it('falls back to the configured display name when the payload omits one', async () => {
    const logger = createRecordingLogger();
    const source = createGreenhouseJobSource({
      companies: [CABIFY],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { id: 9, title: 'Anon', location: { name: 'Madrid' }, absolute_url: 'https://x.test/9', first_published: '2026-09-01T00:00:00Z' },
          ],
        }),
      }),
    });
    const jobs = await source.fetchJobs(QUERY);
    expect(jobs[0]?.company).toBe('Cabify');
  });
});
