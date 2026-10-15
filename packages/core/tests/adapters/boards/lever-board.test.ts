import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLeverJobSource } from '../../../src/adapters/boards/lever-board.js';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import type { CompanyBoard } from '../../../src/config/company-boards.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against a RECORDED real response from
 * `https://api.lever.co/v0/postings/jobandtalent?mode=json`.
 *
 * Note on the probe the task mentioned: `netflix` returns 404 because Netflix
 * does not use Lever, not because the endpoint is broken. Every slug in
 * `company-boards.ts` was confirmed to answer HTTP 200 before being committed.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/lever-response.json', import.meta.url));
const NOW = new Date('2026-09-08T12:00:00.000Z');

const JOBANDTALENT: CompanyBoard = {
  slug: 'jobandtalent',
  provider: 'lever',
  displayName: 'Job&Talent',
  verifiedOn: '2026-09-08',
  spainOpeningsAtVerification: 12,
  softwareOpeningsAtVerification: 1,
};

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

async function fixtureFetch(record?: string[]): Promise<BoardFetch> {
  const payload: unknown = JSON.parse(await readFile(FIXTURE, 'utf8'));
  return async (url) => {
    record?.push(url);
    return { ok: true, status: 200, json: async () => payload };
  };
}

async function run(query: JobSourceQuery = QUERY, urls?: string[]) {
  const logger = createRecordingLogger();
  const source = createLeverJobSource({
    companies: [JOBANDTALENT],
    logger,
    fetchImpl: await fixtureFetch(urls),
    now: () => NOW,
  });
  return { jobs: await source.fetchJobs(query), logger, source };
}

describe('lever board source', () => {
  it('asks for the documented JSON endpoint', async () => {
    const urls: string[] = [];
    await run(QUERY, urls);
    expect(urls).toEqual(['https://api.lever.co/v0/postings/jobandtalent?mode=json']);
  });

  it('is identified as the lever source and sweeps once per run', async () => {
    const { source } = await run();
    expect(source.id).toBe('lever');
    expect(source.queryMode).toBe('per-run');
  });

  it('parses the top-level ARRAY envelope Lever returns', async () => {
    // Unlike Greenhouse and Ashby, Lever's body is a bare array, not an object.
    const { jobs } = await run();
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('keeps only the postings located in Spain', async () => {
    const { jobs } = await run();
    // Madrid HQ, ES + Valencia, ES are kept; Bogota, CO is not.
    expect(jobs).toHaveLength(2);
    expect(jobs.some((job) => /bogota/i.test(job.location))).toBe(false);
  });

  it('normalizes a posting into the domain shape', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'DE - Senior Accountant (German Market)');

    expect(job).toBeDefined();
    // Lever's payload carries no company name, so it comes from the config.
    expect(job?.company).toBe('Job&Talent');
    expect(job?.location).toBe('Madrid HQ, ES');
    expect(job?.url).toBe(
      'https://jobs.lever.co/jobandtalent/268aa722-9857-4994-b26b-677c60b63664',
    );
    expect(job?.contractType).toBe('Permanent');
    expect(job?.sources[0]?.externalId).toBe('268aa722-9857-4994-b26b-677c60b63664');
  });

  it('reads the epoch-millisecond createdAt as the posting date', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'DE - Senior Accountant (German Market)');
    expect(job?.postedAt.toISOString()).toBe('2026-07-14T15:54:07.599Z');
  });

  it('uses the plain-text description Lever already provides', async () => {
    const { jobs } = await run();
    const job = jobs[0];
    expect(job?.description.length).toBeGreaterThan(50);
    expect(job?.description).not.toContain('<div');
    expect(job?.description).not.toContain('&lt;');
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 30 });
    expect(jobs.map((job) => job.title)).toEqual(['ES - Junior People Analytics (Valencia)']);
  });

  it('skips a malformed posting instead of crashing the run', async () => {
    const logger = createRecordingLogger();
    const source = createLeverJobSource({
      companies: [JOBANDTALENT],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'a',
            text: 'Ok Job',
            categories: { location: 'Madrid, ES' },
            createdAt: 1_788_353_860_039,
            hostedUrl: 'https://jobs.lever.co/x/a',
          },
          { id: 'b' },
          { text: 'no id', categories: { location: 'Madrid' } },
          42,
        ],
      }),
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.title)).toEqual(['Ok Job']);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('rejects a payload that is not an array', async () => {
    const logger = createRecordingLogger();
    const source = createLeverJobSource({
      companies: [JOBANDTALENT],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: [] }) }),
    });
    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/lever/i);
  });

  it('falls back to allLocations when the primary location is missing', async () => {
    const logger = createRecordingLogger();
    const source = createLeverJobSource({
      companies: [JOBANDTALENT],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'c',
            text: 'Multi city',
            categories: { allLocations: ['Paris', 'Barcelona, ES'] },
            createdAt: 1_788_353_860_039,
            hostedUrl: 'https://jobs.lever.co/x/c',
          },
        ],
      }),
    });
    const jobs = await source.fetchJobs(QUERY);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.location).toContain('Barcelona');
  });
});
