import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAshbyJobSource } from '../../../src/adapters/boards/ashby-board.js';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import type { CompanyBoard } from '../../../src/config/company-boards.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against a RECORDED real response from
 * `https://api.ashbyhq.com/posting-api/job-board/{company}`.
 *
 * The fixture mixes the two shapes that matter: a posting whose PRIMARY
 * location is Madrid, and one whose Spanish presence only appears in
 * `secondaryLocations` - which is how most pan-European remote roles are
 * published and the case a naive `location` check would silently drop.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/ashby-response.json', import.meta.url));
const NOW = new Date('2026-09-08T12:00:00.000Z');

const N8N: CompanyBoard = {
  slug: 'n8n',
  provider: 'ashby',
  displayName: 'n8n',
  verifiedOn: '2026-09-08',
  spainOpeningsAtVerification: 21,
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
  const source = createAshbyJobSource({
    companies: [N8N],
    logger,
    fetchImpl: await fixtureFetch(urls),
    now: () => NOW,
  });
  return { jobs: await source.fetchJobs(query), logger, source };
}

describe('ashby board source', () => {
  it('asks for the documented posting-api endpoint', async () => {
    const urls: string[] = [];
    await run(QUERY, urls);
    expect(urls).toEqual(['https://api.ashbyhq.com/posting-api/job-board/n8n']);
  });

  it('is identified as the ashby source and sweeps once per run', async () => {
    const { source } = await run();
    expect(source.id).toBe('ashby');
    expect(source.queryMode).toBe('per-run');
  });

  it('keeps a posting whose Spanish presence is only a SECONDARY location', async () => {
    const { jobs } = await run();
    const remote = jobs.find((job) => job.title === 'Sales Enablement Manager (Remote)');
    expect(remote).toBeDefined();
    // The location shown keeps every place the board listed, so the location
    // scorer can see "Spain" and rank it as remote-within-Spain.
    expect(remote?.location).toContain('Berlin Office');
    expect(remote?.location).toContain('Spain');
  });

  it('keeps a posting whose primary location is Madrid', async () => {
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).toContain('Engagement Manager - Madrid');
  });

  it('drops a posting with no Spanish presence anywhere', async () => {
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).not.toContain(
      'Sales Development Representative DACH (German speaker)',
    );
    expect(jobs).toHaveLength(2);
  });

  it('normalizes a posting into the domain shape', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Engagement Manager - Madrid');

    expect(job?.company).toBe('n8n');
    expect(job?.url).toBe(
      'https://jobs.ashbyhq.com/legora/e0704f15-06e3-4b85-afda-414ecb22330d',
    );
    expect(job?.postedAt.toISOString()).toBe('2026-06-09T21:07:46.837Z');
    expect(job?.contractType).toBe('FullTime');
    expect(job?.sources[0]?.externalId).toBe('e0704f15-06e3-4b85-afda-414ecb22330d');
  });

  it('uses the plain-text description Ashby already provides', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Sales Enablement Manager (Remote)');
    expect(job?.description.length).toBeGreaterThan(50);
    expect(job?.description).not.toContain('<p ');
    expect(job?.description).not.toContain('&lt;');
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 30 });
    expect(jobs.map((job) => job.title)).toEqual(['Sales Enablement Manager (Remote)']);
  });

  it('ignores an unlisted posting', async () => {
    const logger = createRecordingLogger();
    const source = createAshbyJobSource({
      companies: [N8N],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { id: 'a', title: 'Listed', location: 'Madrid', publishedAt: '2026-09-01T00:00:00Z', jobUrl: 'https://x.test/a', isListed: true },
            { id: 'b', title: 'Hidden', location: 'Madrid', publishedAt: '2026-09-01T00:00:00Z', jobUrl: 'https://x.test/b', isListed: false },
          ],
        }),
      }),
    });
    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.title)).toEqual(['Listed']);
  });

  it('skips a malformed posting instead of crashing the run', async () => {
    const logger = createRecordingLogger();
    const source = createAshbyJobSource({
      companies: [N8N],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { id: 'a', title: 'Ok Job', location: 'Madrid', publishedAt: '2026-09-01T00:00:00Z', jobUrl: 'https://x.test/a' },
            { id: 'b', location: 'Madrid' },
            { title: 'no id', location: 'Madrid', publishedAt: '2026-09-01T00:00:00Z' },
            null,
          ],
        }),
      }),
    });
    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.title)).toEqual(['Ok Job']);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('rejects an envelope with no jobs array', async () => {
    const logger = createRecordingLogger();
    const source = createAshbyJobSource({
      companies: [N8N],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ apiVersion: '1' }) }),
    });
    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/ashby/i);
  });

  it('tolerates a secondaryLocations entry with no location string', async () => {
    const logger = createRecordingLogger();
    const source = createAshbyJobSource({
      companies: [N8N],
      logger,
      now: () => NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            {
              id: 'a',
              title: 'Odd shape',
              location: 'Madrid',
              secondaryLocations: [{}, { location: null }],
              publishedAt: '2026-09-01T00:00:00Z',
              jobUrl: 'https://x.test/a',
            },
          ],
        }),
      }),
    });
    const jobs = await source.fetchJobs(QUERY);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.location).toBe('Madrid');
  });
});
