import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import { createSmartRecruitersJobSource } from '../../../src/adapters/boards/smartrecruiters-board.js';
import type { CompanyBoard } from '../../../src/config/company-boards.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against RECORDED real responses, captured 2026-09-10 from
 *
 *   https://api.smartrecruiters.com/v1/companies/devoteam/postings?country=es
 *   https://api.smartrecruiters.com/v1/companies/devoteam/postings/{id}
 *
 * and trimmed. No test here touches the network.
 */

const LIST = fileURLToPath(new URL('../../fixtures/smartrecruiters-postings.json', import.meta.url));
const DETAIL = fileURLToPath(
  new URL('../../fixtures/smartrecruiters-posting-detail.json', import.meta.url),
);

/**
 * Midnight, so a one-day window falls cleanly between the fixture's two
 * 2026-09-09 postings and its single 2026-09-08 one.
 */
const NOW = new Date('2026-09-10T00:00:00.000Z');

const DEVOTEAM: CompanyBoard = {
  slug: 'devoteam',
  provider: 'smartrecruiters',
  displayName: 'Devoteam',
  verifiedOn: '2026-09-10',
  spainOpeningsAtVerification: 65,
  softwareOpeningsAtVerification: 1,
};

const QUERY: JobSourceQuery = {
  what: '(all company boards)',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

interface Recorded {
  readonly urls: string[];
}

async function fixtureFetch(
  recorded: Recorded,
  overrides: Record<string, unknown> = {},
): Promise<BoardFetch> {
  const list: unknown = JSON.parse(await readFile(LIST, 'utf8'));
  const detail: unknown = JSON.parse(await readFile(DETAIL, 'utf8'));

  return async (url) => {
    recorded.urls.push(url);
    const override = overrides[url];
    if (override !== undefined) {
      return override as never;
    }
    if (/\/postings\/\d+/.test(url)) {
      return { ok: true, status: 200, json: async () => detail } as never;
    }
    return { ok: true, status: 200, json: async () => list } as never;
  };
}

async function run(query: JobSourceQuery = QUERY, overrides: Record<string, unknown> = {}) {
  const recorded: Recorded = { urls: [] };
  const logger = createRecordingLogger();
  const source = createSmartRecruitersJobSource({
    companies: [DEVOTEAM],
    logger,
    fetchImpl: await fixtureFetch(recorded, overrides),
    now: () => NOW,
  });
  const jobs = await source.fetchJobs(query);
  return { jobs, logger, source, recorded };
}

describe('smartrecruiters board source', () => {
  it('is a per-run company board like the other three', async () => {
    const { source } = await run();
    expect(source.id).toBe('smartrecruiters');
    expect(source.queryMode).toBe('per-run');
  });

  it('asks the API to do the Spain filtering, in the case the API accepts', async () => {
    const { recorded } = await run();

    // Not cosmetic. Bosch publishes 4824 postings worldwide and 66 in Spain;
    // filtering client-side would mean 49 paged requests per run against a free
    // endpoint to end up at the same 66. `country=ES` in upper case silently
    // returns zero results, which is why the case is asserted here.
    expect(recorded.urls[0]).toBe(
      'https://api.smartrecruiters.com/v1/companies/devoteam/postings?country=es&limit=100',
    );
  });

  it('takes the apply URL from the detail payload, never from the id', async () => {
    const { jobs, recorded } = await run();

    // The LIST payload has no public address at all - its `ref` field is an API
    // endpoint. `jobs.smartrecruiters.com/{company}/{id}` happens to answer 200,
    // which is exactly the sort of coincidence that ships a fabricated link.
    // The detail payload states the address, so the detail payload is asked.
    expect(recorded.urls).toContain(
      'https://api.smartrecruiters.com/v1/companies/devoteam/postings/744000148470573',
    );

    const job = jobs.find((entry) => entry.title === 'Big Data Administrator (100% Remoto)');
    expect(job?.url).toBe(
      'https://jobs.smartrecruiters.com/Devoteam/744000148470573-big-data-administrator-100-remoto-',
    );
    expect(job?.sources[0]?.externalId).toBe('744000148470573');
  });

  it('normalizes a posting into the domain shape', async () => {
    const { jobs } = await run();
    const job = jobs.find((entry) => entry.title === 'Big Data Administrator (100% Remoto)');

    expect(job?.company).toBe('Devoteam');
    expect(job?.location).toBe('Madrid');
    expect(job?.postedAt.toISOString()).toBe('2026-09-09T11:06:50.115Z');
    // SmartRecruiters' postings API exposes no compensation field.
    expect(job?.salaryMin).toBeNull();
    expect(job?.salaryMax).toBeNull();
  });

  it('turns the detail job ad into scorable plain text', async () => {
    const { jobs } = await run();
    const job = jobs[0];

    expect(job?.description.length).toBeGreaterThan(200);
    expect(job?.description).not.toContain('<p>');
    expect(job?.description).not.toContain('<strong>');
    expect(job?.description).toContain('Devoteam');
  });

  it('applies no stack filtering of its own', async () => {
    // The finance internship in the fixture must survive the adapter and be
    // judged by the software gate downstream, in the audit trail.
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).toContain('Becari@s Administración y Finanzas');
  });

  it('drops only the posting whose detail lookup failed, never the board', async () => {
    const { jobs, logger } = await run(QUERY, {
      'https://api.smartrecruiters.com/v1/companies/devoteam/postings/744000148470573': {
        ok: false,
        status: 500,
        json: async () => ({}),
      },
    });

    // No detail means no address, and a posting with no address is not a
    // posting. Its two siblings are unaffected.
    expect(jobs.map((job) => job.title)).not.toContain('Big Data Administrator (100% Remoto)');
    expect(jobs).toHaveLength(2);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('spends no detail request on a posting the age filter already rejected', async () => {
    const { recorded } = await run({ ...QUERY, maxDaysOld: 1 });

    // Filtering before enriching is the whole politeness argument: only the
    // postings that could actually be shown cost a second request.
    const detailCalls = recorded.urls.filter((url) => /\/postings\/\d+$/.test(url));
    expect(detailCalls).toHaveLength(2);
  });

  it('honours maxDaysOld', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 1 });
    expect(jobs.map((job) => job.title)).not.toContain('Becari@s Administración y Finanzas');
  });

  it('degrades gracefully on malformed, partial and empty payloads', async () => {
    const logger = createRecordingLogger();
    const recorded: Recorded = { urls: [] };

    const source = createSmartRecruitersJobSource({
      companies: [DEVOTEAM],
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, {
        'https://api.smartrecruiters.com/v1/companies/devoteam/postings?country=es&limit=100': {
          ok: true,
          status: 200,
          json: async () => ({
            totalFound: 4,
            content: [
              {
                id: '744000148470573',
                name: 'Ok Posting',
                releasedDate: '2026-09-09T11:06:50.115Z',
                location: { city: 'Madrid', country: 'es' },
                company: { name: 'Devoteam' },
              },
              { id: '1', name: 'No date', location: { city: 'Madrid' } },
              { name: 'No id', releasedDate: '2026-09-09T00:00:00Z' },
              'not an object',
            ],
          }),
        },
      }),
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs.map((job) => job.title)).toEqual(['Ok Posting']);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('rejects an envelope with no content array', async () => {
    const logger = createRecordingLogger();
    const recorded: Recorded = { urls: [] };
    const source = createSmartRecruitersJobSource({
      companies: [DEVOTEAM],
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, {
        'https://api.smartrecruiters.com/v1/companies/devoteam/postings?country=es&limit=100': {
          ok: true,
          status: 200,
          json: async () => ({ error: 'nope' }),
        },
      }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/smartrecruiters/i);
  });

  it('returns nothing, and no failure, for a company with no Spanish openings', async () => {
    // An unknown or Spain-less company answers HTTP 200 with `totalFound: 0`.
    // That is a fact about the company, not a broken board, so it must not be
    // reported as a degraded target.
    const logger = createRecordingLogger();
    const recorded: Recorded = { urls: [] };
    const source = createSmartRecruitersJobSource({
      companies: [DEVOTEAM],
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, {
        'https://api.smartrecruiters.com/v1/companies/devoteam/postings?country=es&limit=100': {
          ok: true,
          status: 200,
          json: async () => ({ totalFound: 0, content: [] }),
        },
      }),
    });

    expect(await source.fetchJobs(QUERY)).toEqual([]);
    expect(source.takeDegradedTargets?.() ?? []).toEqual([]);
  });
});
