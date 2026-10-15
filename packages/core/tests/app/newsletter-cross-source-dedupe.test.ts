import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNewsletterJobSource } from '../../src/adapters/newsletter/newsletter-job-source.js';
import { createPassthroughLinkResolver } from '../../src/adapters/newsletter/link-resolver.js';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { createJob, type Job } from '../../src/domain/job.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * CROSS-SOURCE DEDUPE, with a newsletter in the mix.
 *
 * This is the case a newsletter adapter makes routine rather than rare: the
 * same Factorial vacancy arrives in the weekly digest AND from Adzuna AND from
 * the company's own board, three times in one morning.
 *
 * The governing asymmetry from `domain/identity.ts` is unchanged and is the
 * reason nothing new was invented here: a FALSE MERGE deletes a real vacancy,
 * a MISSED duplicate costs ten seconds of scrolling. So the newsletter reuses
 * the existing conservative identity logic exactly as the boards do, and these
 * tests pin both directions of it.
 */

const NOW = new Date('2026-09-08T08:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

const deps = {
  scoringConfig: DEFAULT_SCORING_CONFIG,
  juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
  logger: silentLogger,
  now: () => NOW,
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'newsletter-dedupe-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function newsletterSource(body: string): Promise<JobSource> {
  await writeFile(join(directory, 'newsletter-2026-09-06.txt'), body, 'utf8');
  return createNewsletterJobSource({
    directory,
    logger: silentLogger,
    now: () => NOW,
    linkResolver: createPassthroughLinkResolver(),
  });
}

/** Stands in for Adzuna or a company board: a second sighting of the same market. */
function otherSource(jobs: readonly Job[]): JobSource {
  return {
    id: 'greenhouse',
    queryMode: 'per-run',
    fetchJobs: async () => jobs,
  };
}

function boardJob(overrides: Partial<Parameters<typeof createJob>[0]>): Job {
  return createJob({
    sourceId: 'greenhouse',
    externalId: '4012345',
    title: 'Junior Backend Engineer',
    company: 'Factorial',
    location: 'Spain',
    description: 'Ruby on Rails and PostgreSQL.',
    url: 'https://job-boards.greenhouse.io/factorial/jobs/4012345',
    postedAt: new Date('2026-09-05T10:00:00.000Z'),
    ...overrides,
  });
}

describe('a newsletter posting and the same posting from another source', () => {
  it('collapse into one entry carrying both sources', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨 *Factorial busca a un Junior Backend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({})])] },
    );

    expect(queue.totalFetched).toBe(2);
    expect(queue.totalUnique).toBe(1);
    expect(queue.duplicatesRemoved).toBe(1);

    const survivor = queue.jobs[0] ?? queue.excluded[0];
    expect(survivor).toBeDefined();
  });

  it('keeps both provenance trails on the surviving entry', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨 *Factorial busca a un Junior Backend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({})])] },
    );

    const entry = queue.jobs[0];
    expect(entry).toBeDefined();
    expect(entry?.sources.map((source) => source.sourceId).sort()).toEqual([
      'greenhouse',
      'newsletter',
    ]);
    // Both original addresses survive on the refs, so the merge is auditable.
    expect(entry?.sources.map((source) => source.url).sort()).toEqual([
      'https://job-boards.greenhouse.io/factorial/jobs/4012345',
      'https://juniorjobs.short.gy/aaaaaa',
    ]);
  });

  it('merges on the URL alone once the shortener has been resolved to the board link', async () => {
    await writeFile(
      join(directory, 'newsletter-2026-09-06.txt'),
      // Different wording, same destination: only the resolved URL can link them.
      '1. 🚨 *Sigue Factorial con un Backend Developer: https://juniorjobs.short.gy/aaaaaa*',
      'utf8',
    );

    const newsletter = createNewsletterJobSource({
      directory,
      logger: silentLogger,
      now: () => NOW,
      linkResolver: {
        resolve: async (urls) =>
          new Map(
            urls.map((url) => [
              url,
              {
                originalUrl: url,
                finalUrl: 'https://job-boards.greenhouse.io/factorial/jobs/4012345',
                resolved: true,
                status: 200,
                error: null,
              },
            ]),
          ),
      },
    });

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({})])] },
    );

    expect(queue.totalFetched).toBe(2);
    expect(queue.totalUnique).toBe(1);
  });
});

describe('two genuinely different postings', () => {
  it('stay two entries when only the employer matches', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨 *Factorial busca a un Junior Frontend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({})])] },
    );

    expect(queue.totalUnique).toBe(2);
    expect(queue.duplicatesRemoved).toBe(0);
  });

  it('stay two entries when only the title matches', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨 *Glovo busca a un Junior Backend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({})])] },
    );

    expect(queue.totalUnique).toBe(2);
  });

  it('stay two entries when the countries differ', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨🇩🇪 *Factorial busca a un Junior Backend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [newsletter, otherSource([boardJob({ location: 'Madrid' })])] },
    );

    expect(queue.totalUnique).toBe(2);
  });

  it('collapse the same digest link appearing on several lines', async () => {
    // The real digest repeats one link across three lines for three countries.
    const newsletter = await newsletterSource(
      [
        '1. 🚨🇩🇪 *N26 busca a un iOS Engineer: https://juniorjobs.short.gy/dddddd*',
        '2. 🚨 *N26 quiere incorporar a un iOS Engineer: https://juniorjobs.short.gy/dddddd*',
        '3. 🚨🇦🇹 *N26 quiere incorporar a un iOS Engineer: https://juniorjobs.short.gy/dddddd*',
      ].join('\n'),
    );

    const queue = await buildJobQueue({ queries: [QUERY] }, { ...deps, sources: [newsletter] });

    expect(queue.totalFetched).toBe(3);
    expect(queue.totalUnique).toBe(1);
  });
});

describe('the newsletter inside the whole pipeline', () => {
  it('contributes a source report the Contributed line can add up', async () => {
    const newsletter = await newsletterSource(
      '1. 🚨 *Factorial busca a un Junior Backend Engineer: https://juniorjobs.short.gy/aaaaaa*',
    );

    const queue = await buildJobQueue({ queries: [QUERY] }, { ...deps, sources: [newsletter] });

    /*
     * The label says what was actually done. A per-run source used to be
     * reported as "(all company boards)" whatever it was, so a failed
     * newsletter read printed
     *
     *   - newsletter "(all company boards)": the newsletter input folder ...
     *
     * which names a thing that was never touched. The run summary is the one
     * place the user finds out what broke; it does not get to be approximately
     * true.
     */
    expect(queue.sourceReports).toEqual([
      { sourceId: 'newsletter', query: '(all saved newsletters)', status: 'ok', fetched: 1 },
    ]);
  });

  it('reports a failed read without aborting the rest of the run', async () => {
    const broken = createNewsletterJobSource({
      directory: join(directory, 'nope'),
      logger: silentLogger,
      now: () => NOW,
      linkResolver: createPassthroughLinkResolver(),
    });

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [broken, otherSource([boardJob({})])] },
    );

    expect(queue.sourceReports.find((report) => report.sourceId === 'newsletter')?.status).toBe(
      'failed',
    );
    expect(queue.totalUnique).toBe(1);
  });
});
