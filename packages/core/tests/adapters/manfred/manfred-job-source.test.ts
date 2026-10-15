import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import {
  createManfredJobSource,
  MANFRED_SOURCE_ID,
} from '../../../src/adapters/manfred/manfred-job-source.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * Contract test against RECORDED real responses.
 *
 * Every fixture here was captured from the live endpoints on 2026-09-10 and
 * trimmed - never hand-written. A hand-written fixture only proves the adapter
 * agrees with my imagination of the API, and this source is the one where that
 * mistake is expensive: it is the only source whose apply URL does not appear
 * in the job payload at all.
 *
 * No test in this file touches the network.
 */

const OFFERS = fileURLToPath(new URL('../../fixtures/manfred-offers.json', import.meta.url));
const DETAIL = fileURLToPath(new URL('../../fixtures/manfred-offer-detail.json', import.meta.url));
const SITEMAP = fileURLToPath(new URL('../../fixtures/manfred-sitemap.xml', import.meta.url));

/** The fixture's newest offer is 2026-09-04, so this keeps everything in range. */
const NOW = new Date('2026-09-10T12:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: '(all Manfred offers)',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

interface Recorded {
  readonly urls: string[];
}

async function fixtureFetch(recorded: Recorded, overrides: Record<string, unknown> = {}): Promise<BoardFetch> {
  const offers: unknown = JSON.parse(await readFile(OFFERS, 'utf8'));
  const detail: unknown = JSON.parse(await readFile(DETAIL, 'utf8'));
  const sitemap = await readFile(SITEMAP, 'utf8');

  return async (url) => {
    recorded.urls.push(url);

    const override = overrides[url];
    if (override !== undefined) {
      return override as never;
    }

    if (url.includes('sitemap-offers.xml')) {
      return { ok: true, status: 200, json: async () => sitemap, text: async () => sitemap } as never;
    }
    if (/\/offers\/\d+/.test(url)) {
      return { ok: true, status: 200, json: async () => detail } as never;
    }
    return { ok: true, status: 200, json: async () => offers } as never;
  };
}

async function run(query: JobSourceQuery = QUERY, overrides: Record<string, unknown> = {}) {
  const recorded: Recorded = { urls: [] };
  const logger = createRecordingLogger();
  const source = createManfredJobSource({
    logger,
    fetchImpl: await fixtureFetch(recorded, overrides),
    now: () => NOW,
  });
  const jobs = await source.fetchJobs(query);
  return { jobs, logger, source, recorded };
}

describe('manfred job source', () => {
  it('is a per-run sweep with its own label, not a search engine', async () => {
    const { source } = await run();
    expect(source.id).toBe(MANFRED_SOURCE_ID);
    expect(source.id).toBe('manfred');
    // The public offers endpoint takes no search term - it returns the whole
    // catalogue. Asking it once per plan query would be seven identical
    // requests and seven duplicate rows in the source report.
    expect(source.queryMode).toBe('per-run');
    expect(source.sweepLabel).toBe('(all Manfred offers)');
  });

  it('asks the documented endpoint with the parameter that actually works', async () => {
    const { recorded } = await run();
    // `lang` is REQUIRED: the same path without it answers HTTP 400, which is
    // also why `?onlyActive=true` fails - unknown params are rejected outright.
    expect(recorded.urls[0]).toBe('https://www.getmanfred.com/api/v2/public/offers?lang=ES');
  });

  it('keeps only ACTIVE offers', async () => {
    // 1627 of the 1645 offers on the live endpoint are CLOSED. Surfacing them
    // would bury 18 real vacancies under an archive and fire 1627 pointless
    // liveness requests at somebody else's server.
    const { jobs } = await run();
    // The fixture's fourth row is a CLOSED "Sr.Product Designer".
    expect(jobs.every((job) => job.title !== 'Sr.Product Designer')).toBe(true);
    expect(jobs).toHaveLength(3);
  });

  it('takes every apply URL from the published sitemap, never from the id', async () => {
    const { jobs, recorded } = await run();

    expect(recorded.urls).toContain('https://www.getmanfred.com/sitemap-offers.xml');

    const job = jobs.find((entry) => entry.title === 'Senior Software Engineer (US Eastern Time)');
    expect(job?.url).toBe(
      'https://www.getmanfred.com/ofertas-empleo/8464/telnesstech-senior-software-engineer-us-eastern-time-ago26',
    );
    expect(job?.sources).toEqual([
      {
        sourceId: 'manfred',
        externalId: '8464',
        url: 'https://www.getmanfred.com/ofertas-empleo/8464/telnesstech-senior-software-engineer-us-eastern-time-ago26',
      },
    ]);
  });

  it('drops an offer the sitemap does not list rather than inventing its address', async () => {
    const { jobs, logger } = await run(QUERY, {
      'https://www.getmanfred.com/sitemap-offers.xml': {
        ok: true,
        status: 200,
        text: async () =>
          '<?xml version="1.0"?><urlset><url><loc>https://www.getmanfred.com/ofertas-empleo/8464/telnesstech-senior-software-engineer-us-eastern-time-ago26</loc></url></urlset>',
      },
    });

    expect(jobs.map((job) => job.title)).toEqual(['Senior Software Engineer (US Eastern Time)']);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('fails the whole source when the URL authority is unreachable', async () => {
    // No sitemap means no URLs, and a source with no URLs must not fall back to
    // a construction. Failing loudly lets the degraded-write guard protect the
    // previous queue instead of silently shipping guessed links.
    const logger = createRecordingLogger();
    const recorded: Recorded = { urls: [] };
    const source = createManfredJobSource({
      logger,
      now: () => NOW,
      fetchImpl: await fixtureFetch(recorded, {
        'https://www.getmanfred.com/sitemap-offers.xml': { ok: false, status: 503, json: async () => ({}) },
      }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/sitemap/i);
  });

  it('reports a real salary range and refuses to report a fake one', async () => {
    const { jobs } = await run();

    const withSalary = jobs.find((job) => job.title === 'Senior Software Engineer (US Eastern Time)');
    expect(withSalary?.salaryMin).toBe(55000);
    expect(withSalary?.salaryMax).toBe(75000);

    // `salaryFrom: 0` is Manfred's "not disclosed", NOT a zero-euro salary.
    // Passing the 0 through would report a lower bound the employer never gave.
    const undisclosedFloor = jobs.find((job) => job.title === '.NET Developer');
    expect(undisclosedFloor?.salaryMin).toBeNull();
    expect(undisclosedFloor?.salaryMax).toBe(35000);
  });

  it('reports the location the payload gave, and nothing when it gave none', async () => {
    const { jobs } = await run();

    expect(jobs.find((job) => job.title === '.NET Developer')?.location).toBe('Santander, España');
    // 940 of 1645 offers carry an empty `locations` array. An empty string is
    // the honest answer; defaulting it to "Madrid" or "España" would invent the
    // single field the candidate filters on hardest.
    expect(jobs.find((job) => job.title === 'Senior Python Engineer')?.location).toBe('');
  });

  it('enriches the description from the per-offer detail endpoint', async () => {
    const { jobs, recorded } = await run();

    // The list endpoint carries no prose at all - only `highlights`. Scoring is
    // almost entirely description-driven, so a list-only adapter would make
    // every Manfred posting read as "no signal found".
    expect(recorded.urls).toContain('https://www.getmanfred.com/api/v2/public/offers/8464?lang=ES');
    const job = jobs[0];
    expect(job?.description.length).toBeGreaterThan(200);
    expect(job?.description).not.toContain('**');
  });

  it('keeps an offer whose detail fetch failed, with the list-level description', async () => {
    const { jobs, logger } = await run(QUERY, {
      'https://www.getmanfred.com/api/v2/public/offers/8464?lang=ES': {
        ok: false,
        status: 500,
        json: async () => ({}),
      },
    });

    const job = jobs.find((entry) => entry.title === 'Senior Software Engineer (US Eastern Time)');
    // Degraded, not deleted: a failed enrichment request is a fact about the
    // network, and this codebase never deletes a vacancy on one of those.
    expect(job).toBeDefined();
    expect(job?.description.length).toBeGreaterThan(0);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('carries the remote percentage into the scorable text', async () => {
    const { jobs } = await run();
    const remote = jobs.find((job) => job.title === 'Senior Python Engineer');
    expect(remote?.description).toContain('100%');
  });

  it('honours maxDaysOld against the offer timestamp', async () => {
    const { jobs } = await run({ ...QUERY, maxDaysOld: 3 });
    // Of the three ACTIVE fixtures only 8451 (2026-09-10) is inside three days
    // of 2026-09-10; 8457 is six days old and 8464 is fifteen.
    expect(jobs.map((job) => job.title)).toEqual(['Senior Python Engineer']);
  });

  it('applies no stack or seniority filtering of its own', async () => {
    // Senior roles come through and are judged by the junior gate downstream,
    // exactly like every other source. An adapter that pre-filtered would hide
    // the decision from the audit trail the candidate reads.
    const { jobs } = await run();
    expect(jobs.map((job) => job.title)).toContain('Senior Software Engineer (US Eastern Time)');
  });

  it('degrades gracefully on a malformed, partial or empty payload', async () => {
    const cases: readonly [string, unknown][] = [
      ['empty array', []],
      ['not an array', { offers: [] }],
      ['rows of the wrong shape', ['nope', 42, null]],
      [
        'a row missing its id',
        [{ position: 'X', slug: 's', status: 'ACTIVE', updatedAt: '2026-09-09T00:00:00Z', company: { name: 'C' } }],
      ],
    ];

    for (const [label, payload] of cases) {
      const logger = createRecordingLogger();
      const recorded: Recorded = { urls: [] };
      const source = createManfredJobSource({
        logger,
        now: () => NOW,
        fetchImpl: await fixtureFetch(recorded, {
          'https://www.getmanfred.com/api/v2/public/offers?lang=ES': {
            ok: true,
            status: 200,
            json: async () => payload,
          },
        }),
      });

      if (label === 'not an array') {
        await expect(source.fetchJobs(QUERY), label).rejects.toThrow(/manfred/i);
      } else {
        await expect(source.fetchJobs(QUERY), label).resolves.toEqual([]);
      }
    }
  });

  it('ignores a salary quoted in a currency the queue cannot display', async () => {
    // `Job` has no currency field, so a MXN$ range rendered beside euro ranges
    // would read as a euro range. Reporting nothing is the honest option.
    const { jobs } = await run(QUERY, {
      'https://www.getmanfred.com/api/v2/public/offers?lang=ES': {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 8464,
            position: 'Senior Software Engineer (US Eastern Time)',
            slug: 'telnesstech-senior-software-engineer-us-eastern-time-ago26',
            status: 'ACTIVE',
            salaryFrom: 55000,
            salaryTo: 75000,
            currency: 'MXN$',
            remotePercentage: 100,
            locations: ['Madrid, España'],
            updatedAt: '2026-09-07T00:00:00.000Z',
            company: { name: 'Telness Tech' },
            isFreelance: false,
            highlights: [],
          },
        ],
      },
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.salaryMin).toBeNull();
    expect(jobs[0]?.salaryMax).toBeNull();
  });

  it('never fires more detail requests than its own bound', async () => {
    const recorded: Recorded = { urls: [] };
    const logger = createRecordingLogger();
    const source = createManfredJobSource({
      logger,
      now: () => NOW,
      maxDetailFetches: 1,
      fetchImpl: await fixtureFetch(recorded),
    });

    const jobs = await source.fetchJobs(QUERY);
    const detailCalls = recorded.urls.filter((url) => /\/offers\/\d+\?/.test(url));

    expect(detailCalls).toHaveLength(1);
    // Bounded enrichment, never bounded intake: the other offers still ship.
    expect(jobs).toHaveLength(3);
  });
});
