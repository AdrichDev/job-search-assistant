import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createAdzunaJobSource,
  type HttpFetch,
  type HttpResponseLike,
} from '../../src/adapters/adzuna/adzuna-job-source.js';
import type { JobSourceQuery } from '../../src/ports/job-source.js';
import { silentLogger } from '../helpers/silent-logger.js';

const FIXTURE_URL = new URL('../fixtures/adzuna-response.json', import.meta.url);

async function loadFixture(): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(FIXTURE_URL), 'utf8')) as unknown;
}

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

function okResponse(body: unknown): HttpResponseLike {
  return { ok: true, status: 200, json: async () => body };
}

function recordingFetch(body: unknown): { fetch: HttpFetch; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      return okResponse(body);
    },
  };
}

describe('createAdzunaJobSource', () => {
  it('builds the documented Adzuna Spain URL with all required query params', async () => {
    const fixture = await loadFixture();
    const { fetch, urls } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'test-id',
      appKey: 'test-key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    await source.fetchJobs(QUERY);

    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] ?? '');
    expect(url.pathname).toBe('/v1/api/jobs/es/search/1');
    expect(url.searchParams.get('app_id')).toBe('test-id');
    expect(url.searchParams.get('app_key')).toBe('test-key');
    expect(url.searchParams.get('what')).toBe('junior developer');
    expect(url.searchParams.get('where')).toBe('Madrid');
    expect(url.searchParams.get('results_per_page')).toBe('50');
    expect(url.searchParams.get('max_days_old')).toBe('30');
  });

  it('forwards the documented category filter when the query declares one', async () => {
    const fixture = await loadFixture();
    const { fetch, urls } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    await source.fetchJobs({ ...QUERY, category: 'it-jobs' });

    expect(new URL(urls[0] ?? '').searchParams.get('category')).toBe('it-jobs');
  });

  it('omits the category parameter entirely when the query has none', async () => {
    const fixture = await loadFixture();
    const { fetch, urls } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    await source.fetchJobs(QUERY);

    expect(new URL(urls[0] ?? '').searchParams.has('category')).toBe(false);
  });

  it('normalizes valid results into domain jobs', async () => {
    const fixture = await loadFixture();
    const { fetch } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    const jobs = await source.fetchJobs(QUERY);
    const first = jobs[0];

    expect(first?.title).toBe('Desarrollador Junior Frontend (React)');
    expect(first?.company).toBe('ACME Software');
    expect(first?.location).toBe('Madrid, Comunidad de Madrid');
    expect(first?.url).toBe('https://www.adzuna.es/land/ad/4820001');
    expect(first?.postedAt.toISOString()).toBe('2026-09-05T09:00:00.000Z');
    expect(first?.salaryMin).toBe(21000);
    expect(first?.sources[0]?.sourceId).toBe('adzuna');
  });

  it('skips malformed records instead of crashing the run', async () => {
    const fixture = await loadFixture();
    const { fetch } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.company)).not.toContain('Nope');
  });

  it('does not filter by stack: it returns the senior Barcelona role too', async () => {
    const fixture = await loadFixture();
    const { fetch } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.company)).toContain('Globex');
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      logger: silentLogger,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/401/);
  });

  it('throws when the payload is not an Adzuna envelope', async () => {
    const { fetch } = recordingFetch({ unexpected: true });
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/payload/i);
  });

  it('stops paginating when a page is not full', async () => {
    const fixture = await loadFixture();
    const { fetch, urls } = recordingFetch(fixture);
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      fetchImpl: fetch,
      logger: silentLogger,
    });

    await source.fetchJobs({ ...QUERY, resultsPerPage: 50, maxPages: 3 });
    expect(urls).toHaveLength(1);
  });

  it('requests further pages while pages come back full', async () => {
    const fixture = (await loadFixture()) as { results: unknown[] };
    const fullPage = { count: 6, results: [fixture.results[0], fixture.results[1]] };
    const urls: string[] = [];
    const source = createAdzunaJobSource({
      appId: 'id',
      appKey: 'key',
      logger: silentLogger,
      fetchImpl: async (url) => {
        urls.push(url);
        return okResponse(fullPage);
      },
    });

    await source.fetchJobs({ ...QUERY, resultsPerPage: 2, maxPages: 3 });
    expect(urls).toHaveLength(3);
    expect(new URL(urls[2] ?? '').pathname).toBe('/v1/api/jobs/es/search/3');
  });
});
