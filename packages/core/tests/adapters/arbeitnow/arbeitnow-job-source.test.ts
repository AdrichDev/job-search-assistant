import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import {
  ARBEITNOW_SOURCE_ID,
  createArbeitnowJobSource,
} from '../../../src/adapters/arbeitnow/arbeitnow-job-source.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against a RECORDED real response, captured 2026-09-10 from
 * `https://www.arbeitnow.com/api/job-board-api` and trimmed to the two Spanish
 * postings plus two German ones. No network here.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/arbeitnow-response.json', import.meta.url));

/**
 * After the newest fixture timestamp (2026-09-10T10:00:30Z), so every posting
 * is genuinely in the past and a zero-day window really does exclude them all.
 */
const NOW = new Date('2026-09-11T00:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: '(all Arbeitnow pages)',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

interface Recorded {
  readonly urls: string[];
}

async function fixtureFetch(recorded: Recorded, override?: unknown): Promise<BoardFetch> {
  const payload = JSON.parse(await readFile(FIXTURE, 'utf8')) as { data: unknown[] };
  return async (url) => {
    recorded.urls.push(url);
    const body = url.includes('page=1') ? (override ?? payload) : { data: [] };
    return { ok: true, status: 200, json: async () => body } as never;
  };
}

async function run(query: JobSourceQuery = QUERY, override?: unknown) {
  const recorded: Recorded = { urls: [] };
  const logger = createRecordingLogger();
  const source = createArbeitnowJobSource({
    logger,
    fetchImpl: await fixtureFetch(recorded, override),
    now: () => NOW,
  });
  return { jobs: await source.fetchJobs(query), logger, source, recorded };
}

describe('arbeitnow source', () => {
  it('is a per-run sweep with its own label', async () => {
    const { source } = await run();
    expect(source.id).toBe(ARBEITNOW_SOURCE_ID);
    expect(source.queryMode).toBe('per-run');
    expect(source.sweepLabel).toBe('(all Arbeitnow pages)');
  });

  it('pages from page=1 and stops on the first empty page', async () => {
    const { recorded } = await run();
    expect(recorded.urls[0]).toBe('https://www.arbeitnow.com/api/job-board-api?page=1');
    expect(recorded.urls[1]).toBe('https://www.arbeitnow.com/api/job-board-api?page=2');
    expect(recorded.urls).toHaveLength(2);
  });

  it('never exceeds its page bound', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    const payload = JSON.parse(await readFile(FIXTURE, 'utf8')) as { data: unknown[] };
    const source = createArbeitnowJobSource({
      logger,
      now: () => NOW,
      maxPages: 3,
      // Never empty, so only the bound can stop it. A board that always answers
      // is exactly how a polite fetch turns into an unbounded crawl.
      fetchImpl: async (url) => {
        recorded.urls.push(url);
        return { ok: true, status: 200, json: async () => payload } as never;
      },
    });

    await source.fetchJobs(QUERY);
    expect(recorded.urls).toHaveLength(3);
  });

  it('keeps postings located in Spain and postings that are explicitly remote', async () => {
    const { jobs } = await run();
    const titles = jobs.map((job) => job.title);

    // Spain in a multi-city location string.
    expect(titles).toContain('Senior Revenue Ops');
    // "Remote • Germany, Canada, Spain or the UK".
    expect(titles).toContain('Product Manager');
    // Remote, but German-language and Munich-based: kept because `remote` is
    // true and the candidate judges relevance himself, per the brief.
    expect(titles).toContain('DATEV Techniker & Operations Manager (m/w/d) Remote, Vollzeit/Teilzeit');
    // On-site Munich, not remote, no Spain anywhere. Dropped.
    expect(titles.some((title) => title.startsWith('Reparatur'))).toBe(false);
  });

  it('takes the apply URL from the payload, host and all', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Senior Revenue Ops');

    // Note the host: Arbeitnow serves some postings from `arbeitnow.fr`. An
    // adapter that "normalised" that to the `.com` it was fetched from would be
    // rewriting an address the source reported, which is the same class of
    // mistake as inventing one.
    expect(job?.url).toBe(
      'https://www.arbeitnow.fr/jobs/companies/alan/senior-revenue-ops-paris-france-bordeaux-france-lyon-france-marseille-france-biarritz-france-nantes-france-annecy-france-madrid-spain-67214',
    );
    expect(job?.sources[0]?.sourceId).toBe('arbeitnow');
  });

  it('reads the unix timestamp the payload uses', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Senior Revenue Ops');
    // `created_at` is seconds since the epoch, not an ISO string. Feeding it to
    // `new Date()` unmultiplied dates every posting to January 1970 and hands
    // the recency dimension a uniform zero.
    expect(job?.postedAt.getUTCFullYear()).toBeGreaterThan(2020);
  });

  it('reports the company the payload gave and no salary at all', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Senior Revenue Ops');

    expect(job?.company).toBe('Alan');
    // Arbeitnow's board API exposes no compensation field.
    expect(job?.salaryMin).toBeNull();
    expect(job?.salaryMax).toBeNull();
  });

  it('turns the HTML description into scorable plain text', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Senior Revenue Ops');

    expect(job?.description.length).toBeGreaterThan(50);
    expect(job?.description).not.toContain('<p>');
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 0 });
    expect(jobs).toEqual([]);
  });

  it('degrades gracefully on malformed, partial and empty payloads', async () => {
    for (const payload of [
      { data: [] },
      { data: ['nope', 42, null] },
      { data: [{ title: 'No url', location: 'Madrid' }] },
    ]) {
      const { jobs } = await run(QUERY, payload);
      expect(jobs).toEqual([]);
    }
  });

  it('fails the source when the envelope has no data array', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    const source = createArbeitnowJobSource({
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, { error: 'nope' }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/arbeitnow/i);
  });
});
