import { describe, expect, it } from 'vitest';
import { createAdzunaJobSource } from '../../src/adapters/adzuna/adzuna-job-source.js';
import { createAshbyJobSource } from '../../src/adapters/boards/ashby-board.js';
import { createGreenhouseJobSource } from '../../src/adapters/boards/greenhouse-board.js';
import { createLeverJobSource } from '../../src/adapters/boards/lever-board.js';
import type { BoardFetch } from '../../src/adapters/boards/board-http.js';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { CompanyBoard } from '../../src/config/company-boards.js';
import type { JobQueue } from '../../src/ports/queue-writer.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import { createRecordingLogger, silentLogger } from '../helpers/silent-logger.js';

/**
 * URL PROVENANCE.
 *
 * The defect this file exists for: `output/queue.json` shipped 13 postings
 * whose `url` was `https://www.adzuna.es/details/<URL-encoded job title>`.
 * Every one of them answered HTTP 403. The real URL that the live API had
 * returned - `https://www.adzuna.es/details/5874810786?utm_medium=api...` -
 * had been thrown away and then "reconstructed" from a field that has nothing
 * to do with a URL.
 *
 * The rule this suite enforces, end to end and per adapter:
 *
 *   A job's URL is the source payload's own URL field, byte for byte, or the
 *   job does not exist.
 *
 * Nothing may derive it, default it, template it or repair it. The check is
 * deliberately set-based rather than "looks like a URL": a fabricated URL is
 * usually perfectly well-formed, which is exactly why it survived to
 * production.
 */

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 3650,
  resultsPerPage: 50,
  maxPages: 1,
};

const NOW = new Date('2026-09-08T08:00:00.000Z');

const deps = {
  scoringConfig: DEFAULT_SCORING_CONFIG,
  juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
  logger: silentLogger,
  now: () => NOW,
};

/** Every URL the queue exposes to a human, from every field that carries one. */
function surfacedUrls(queue: JobQueue): readonly string[] {
  return [
    ...queue.jobs.map((entry) => entry.url),
    ...queue.jobs.flatMap((entry) => entry.sources.map((source) => source.url)),
    ...queue.excluded.map((entry) => entry.url),
  ];
}

async function queueFrom(source: JobSource): Promise<JobQueue> {
  return buildJobQueue({ queries: [QUERY] }, { ...deps, sources: [source] });
}

/* -------------------------------------------------------------------- */
/* Adzuna: the source the defect actually shipped from.                  */
/* -------------------------------------------------------------------- */

/** Titles chosen to be ugly: if anything templates them, the escaping shows. */
const ADZUNA_RESULTS = [
  {
    id: '5874810786',
    title: 'Optima Solutions Junior Power Platform Developer',
    description: 'Power Apps, Power Automate.',
    created: '2026-09-08T00:29:32Z',
    redirect_url: 'https://www.adzuna.es/details/5874810786?utm_medium=api&utm_source=5327d1be',
    company: { display_name: 'PPG' },
    location: { display_name: 'Madrid' },
  },
  {
    id: '5874810999',
    title: 'Programador/A Junior, Num: 132026007029',
    description: 'ERP, SQL, Jira.',
    created: '2026-09-06T00:27:17Z',
    redirect_url: 'https://www.adzuna.es/details/5874810999?utm_medium=api&utm_source=5327d1be',
    company: { display_name: 'Jobbydoo' },
    location: { display_name: 'Madrid' },
  },
  {
    // Excluded by the software gate; its URL must be just as real.
    id: '5874811777',
    title: 'Se Necesitan Odontólogos',
    description: 'Clinica dental en Madrid.',
    created: '2026-09-08T00:28:25Z',
    redirect_url: 'https://www.adzuna.es/details/5874811777?utm_medium=api&utm_source=5327d1be',
    company: { display_name: 'Dentego' },
    location: { display_name: 'Madrid' },
  },
];

function adzunaSource(results: readonly unknown[], logger = silentLogger): JobSource {
  return createAdzunaJobSource({
    appId: 'id',
    appKey: 'key',
    logger,
    baseUrl: 'https://api.example.test/search',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results, count: results.length }),
    }),
  });
}

describe('every URL in a built queue comes from the source payload', () => {
  it('emits exactly the redirect_url values Adzuna returned', async () => {
    const queue = await queueFrom(adzunaSource(ADZUNA_RESULTS));
    const payloadUrls = new Set(ADZUNA_RESULTS.map((result) => result.redirect_url));

    expect(surfacedUrls(queue).length).toBeGreaterThan(0);
    for (const url of surfacedUrls(queue)) {
      expect(payloadUrls.has(url), `fabricated URL: ${url}`).toBe(true);
    }
  });

  it('never derives a URL from the job title', async () => {
    const queue = await queueFrom(adzunaSource(ADZUNA_RESULTS));

    for (const url of surfacedUrls(queue)) {
      for (const result of ADZUNA_RESULTS) {
        // The exact shape of the shipped defect: the title, URL-encoded, glued
        // onto a details path.
        expect(url).not.toContain(encodeURIComponent(result.title));
        expect(url.toLowerCase()).not.toContain(
          encodeURIComponent(result.title.slice(0, 12)).toLowerCase(),
        );
      }
    }
  });

  it('keeps the query string, because the source URL is not ours to tidy up', async () => {
    const queue = await queueFrom(adzunaSource(ADZUNA_RESULTS));
    expect(queue.jobs.every((entry) => entry.url.includes('utm_medium=api'))).toBe(true);
  });

  it('skips a result with no URL instead of inventing one', async () => {
    const logger = createRecordingLogger();
    const withoutUrl = [
      { ...ADZUNA_RESULTS[0], redirect_url: undefined },
      ADZUNA_RESULTS[1],
    ];

    const queue = await queueFrom(adzunaSource(withoutUrl, logger));

    expect(surfacedUrls(queue)).not.toContain(undefined);
    expect(queue.totalUnique).toBe(1);
    expect(queue.jobs.map((entry) => entry.url)).toEqual([ADZUNA_RESULTS[1]?.redirect_url]);
    expect(logger.messages.some((entry) => entry.level === 'warn')).toBe(true);
  });

  it('skips a result whose URL is empty rather than falling back to a details path', async () => {
    const queue = await queueFrom(
      adzunaSource([{ ...ADZUNA_RESULTS[0], redirect_url: '' }, ADZUNA_RESULTS[1]]),
    );
    expect(queue.jobs.map((entry) => entry.url)).toEqual([ADZUNA_RESULTS[1]?.redirect_url]);
  });
});

/* -------------------------------------------------------------------- */
/* Company boards: same rule, three different payload shapes.            */
/* -------------------------------------------------------------------- */

const COMPANY: CompanyBoard = {
  slug: 'acme',
  provider: 'greenhouse',
  displayName: 'ACME',
  verifiedOn: '2026-09-08',
  spainOpeningsAtVerification: 1,
  softwareOpeningsAtVerification: 1,
};

function boardFetch(payload: unknown): BoardFetch {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

const boardOptions = { logger: silentLogger, concurrency: 1, now: () => NOW };

describe('company boards carry their own URLs through untouched', () => {
  it('greenhouse uses absolute_url verbatim', async () => {
    const url = 'https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=abc';
    const source = createGreenhouseJobSource({
      ...boardOptions,
      companies: [COMPANY],
      fetchImpl: boardFetch({
        jobs: [
          {
            id: 4012345,
            title: 'Junior Software Engineer',
            absolute_url: url,
            location: { name: 'Madrid, Spain' },
            content: 'React and TypeScript.',
            first_published: '2026-09-01T10:00:00Z',
          },
        ],
      }),
    });

    const queue = await queueFrom(source);
    expect(surfacedUrls(queue)).toEqual([url, url]);
  });

  it('lever uses hostedUrl verbatim', async () => {
    const url = 'https://jobs.lever.co/acme/8f2c1d90-1111-2222-3333-444455556666';
    const source = createLeverJobSource({
      ...boardOptions,
      companies: [{ ...COMPANY, provider: 'lever' }],
      fetchImpl: boardFetch([
        {
          id: '8f2c1d90-1111-2222-3333-444455556666',
          text: 'Junior Backend Developer',
          hostedUrl: url,
          applyUrl: 'https://jobs.lever.co/acme/8f2c1d90/apply',
          createdAt: new Date('2026-09-01T10:00:00Z').getTime(),
          categories: { location: 'Madrid' },
          descriptionPlain: 'Node.js and PostgreSQL.',
        },
      ]),
    });

    const queue = await queueFrom(source);
    expect(surfacedUrls(queue)).toEqual([url, url]);
  });

  it('ashby uses jobUrl verbatim', async () => {
    const url = 'https://jobs.ashbyhq.com/acme/1a2b3c4d-5555-6666-7777-888899990000';
    const source = createAshbyJobSource({
      ...boardOptions,
      companies: [{ ...COMPANY, provider: 'ashby' }],
      fetchImpl: boardFetch({
        jobs: [
          {
            id: '1a2b3c4d-5555-6666-7777-888899990000',
            title: 'Junior Frontend Developer',
            jobUrl: url,
            location: 'Madrid',
            secondaryLocations: [],
            publishedAt: '2026-09-01T10:00:00Z',
            isListed: true,
            descriptionPlain: 'React and Tailwind.',
          },
        ],
      }),
    });

    const queue = await queueFrom(source);
    expect(surfacedUrls(queue)).toEqual([url, url]);
  });
});
