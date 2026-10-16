import { describe, expect, it } from 'vitest';
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
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * URL PROVENANCE.
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

/* Company boards: payload URLs must pass through unchanged. */

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
