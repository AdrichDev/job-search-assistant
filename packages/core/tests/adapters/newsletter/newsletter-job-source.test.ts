import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NEWSLETTER_SOURCE_ID,
  createNewsletterJobSource,
} from '../../../src/adapters/newsletter/newsletter-job-source.js';
import { createPassthroughLinkResolver } from '../../../src/adapters/newsletter/link-resolver.js';
import type {
  NewsletterParser,
  NewsletterPosting,
} from '../../../src/adapters/newsletter/newsletter-parser.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger, silentLogger } from '../../helpers/silent-logger.js';

/**
 * The adapter around the parsers: a folder of saved emails in, domain jobs out.
 *
 * Everything here is filesystem-only. The one network-capable collaborator, the
 * link resolver, is injected, and every test below injects one that cannot
 * reach anything.
 */

const NOW = new Date('2026-09-08T08:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

const DIGEST = [
  '🇪🇸 Empezamos España y resto de Europa:',
  '1. 🚨 *Factorial busca a un GTM Engineer: https://juniorjobs.short.gy/aaaaaa*',
  '2. 🚨🧑‍💻 *Idealista necesita a un Android Product Engineer, 100% en remoto: https://juniorjobs.short.gy/bbbbbb*',
  '3. 🚨🇩🇪 *N26 busca a un iOS Engineer: https://juniorjobs.short.gy/cccccc*',
].join('\n');

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'newsletter-source-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeDigest(name: string, body: string): Promise<void> {
  await writeFile(join(directory, name), body, 'utf8');
}

function source(overrides: Partial<Parameters<typeof createNewsletterJobSource>[0]> = {}) {
  return createNewsletterJobSource({
    directory,
    logger: silentLogger,
    now: () => NOW,
    linkResolver: createPassthroughLinkResolver(),
    ...overrides,
  });
}

describe('the newsletter source contract', () => {
  it('is asked once per run, not once per search term', () => {
    // A saved email answers no query. Running the seven-term plan against it
    // would be seven identical file reads and seven duplicate source reports.
    expect(source().queryMode).toBe('per-run');
  });

  it('identifies itself as "newsletter" in the source report', () => {
    expect(source().id).toBe(NEWSLETTER_SOURCE_ID);
  });
});

describe('reading a folder of saved newsletters', () => {
  it('turns every entry it understood into a job', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);

    const jobs = await source().fetchJobs(QUERY);

    expect(jobs.map((job) => job.company)).toEqual(['Factorial', 'Idealista', 'N26']);
    expect(jobs.map((job) => job.title)).toEqual([
      'GTM Engineer',
      'Android Product Engineer',
      'iOS Engineer',
    ]);
  });

  it('dates the postings from the digest the file name declares', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    const jobs = await source().fetchJobs(QUERY);

    for (const job of jobs) {
      expect(job.postedAt.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    }
  });

  it('drops a digest older than the query window instead of pretending it is fresh', async () => {
    await writeDigest('newsletter-2024-01-01.txt', DIGEST);
    expect(await source().fetchJobs(QUERY)).toEqual([]);
  });

  it('reads several saved emails in one run', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    await writeDigest(
      'newsletter-2026-09-07.txt',
      '1. 🚨 *Glovo busca a un Data Analyst Intern: https://juniorjobs.short.gy/dddddd*',
    );

    const jobs = await source().fetchJobs(QUERY);
    expect(jobs.map((job) => job.company).sort()).toEqual([
      'Factorial',
      'Glovo',
      'Idealista',
      'N26',
    ]);
  });

  it('ignores files that are not saved email text', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    await writeDigest('README.md', '# how to save a newsletter');
    await mkdir(join(directory, 'archive'));

    const jobs = await source().fetchJobs(QUERY);
    expect(jobs).toHaveLength(3);
  });

  it('records the country the digest flagged, and remote work when it said so', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    const jobs = await source().fetchJobs(QUERY);

    expect(jobs[0]?.location).toBe('Spain');
    expect(jobs[1]?.location).toBe('Spain (Remote)');
    expect(jobs[2]?.location).toBe('Germany');
  });
});

describe('URL provenance', () => {
  it('emits exactly the links the digest carried', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    const jobs = await source().fetchJobs(QUERY);

    expect(jobs.map((job) => job.url)).toEqual([
      'https://juniorjobs.short.gy/aaaaaa',
      'https://juniorjobs.short.gy/bbbbbb',
      'https://juniorjobs.short.gy/cccccc',
    ]);
  });

  it('never builds a URL out of the job title', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    const jobs = await source().fetchJobs(QUERY);

    for (const job of jobs) {
      expect(job.url).not.toContain(encodeURIComponent(job.title));
      expect(job.url.toLowerCase()).not.toContain(
        job.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      );
    }
  });

  it('drops an entry with no link and says so, instead of defaulting one', async () => {
    const logger = createRecordingLogger();
    await writeDigest(
      'newsletter-2026-09-06.txt',
      [
        '1. 🚨 *Factorial busca a un GTM Engineer: https://juniorjobs.short.gy/aaaaaa*',
        '2. Y Amazon busca a otro Data Center Operations Technician: Data Center Operations Technician',
      ].join('\n'),
    );

    const jobs = await source({ logger }).fetchJobs(QUERY);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.company).toBe('Factorial');
    expect(
      logger.messages.some(
        (message) => message.level === 'warn' && /no link|no usable/i.test(message.message),
      ),
    ).toBe(true);
  });

  it('drops an entry whose link is not an absolute http(s) address', async () => {
    const logger = createRecordingLogger();
    await writeDigest(
      'newsletter-2026-09-06.txt',
      [
        '1. 🚨 *Factorial busca a un GTM Engineer: https://juniorjobs.short.gy/aaaaaa*',
        '2. 🚨 *Acme busca a un Backend Engineer: ftp://files.example.test/job*',
      ].join('\n'),
    );

    const jobs = await source({ logger }).fetchJobs(QUERY);
    expect(jobs.map((job) => job.url)).toEqual(['https://juniorjobs.short.gy/aaaaaa']);
    expect(logger.messages.some((message) => message.level === 'warn')).toBe(true);
  });

  it('carries the resolved destination when a resolver produced one', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);

    const jobs = await source({
      linkResolver: {
        resolve: async (urls) =>
          new Map(
            urls.map((url) => [
              url,
              {
                originalUrl: url,
                finalUrl: `https://boards.example.test/jobs/${url.slice(-6)}`,
                resolved: true,
                status: 200,
                error: null,
              },
            ]),
          ),
      },
    }).fetchJobs(QUERY);

    expect(jobs.map((job) => job.url)).toEqual([
      'https://boards.example.test/jobs/aaaaaa',
      'https://boards.example.test/jobs/bbbbbb',
      'https://boards.example.test/jobs/cccccc',
    ]);
  });

  it('keeps the original link when resolution failed for that link', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);

    const jobs = await source({
      linkResolver: {
        resolve: async (urls) =>
          new Map(
            urls.map((url) => [
              url,
              {
                originalUrl: url,
                finalUrl: url,
                resolved: false,
                status: null,
                error: 'timeout',
              },
            ]),
          ),
      },
    }).fetchJobs(QUERY);

    expect(jobs.map((job) => job.url)).toEqual([
      'https://juniorjobs.short.gy/aaaaaa',
      'https://juniorjobs.short.gy/bbbbbb',
      'https://juniorjobs.short.gy/cccccc',
    ]);
  });

  it('exposes which link was original and which was resolved', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);

    const created = source({
      linkResolver: {
        resolve: async (urls) =>
          new Map(
            urls.map((url, index) => [
              url,
              {
                originalUrl: url,
                finalUrl: index === 0 ? 'https://boards.example.test/jobs/1' : url,
                resolved: index === 0,
                status: index === 0 ? 200 : null,
                error: index === 0 ? null : 'timeout',
              },
            ]),
          ),
      },
    });

    await created.fetchJobs(QUERY);
    const provenance = created.takeLinkProvenance();

    expect(provenance).toHaveLength(3);
    expect(provenance[0]).toMatchObject({
      originalUrl: 'https://juniorjobs.short.gy/aaaaaa',
      finalUrl: 'https://boards.example.test/jobs/1',
      resolved: true,
    });
    expect(provenance[1]).toMatchObject({
      originalUrl: 'https://juniorjobs.short.gy/bbbbbb',
      finalUrl: 'https://juniorjobs.short.gy/bbbbbb',
      resolved: false,
    });
  });

  it('drains the provenance so a later run cannot re-report an older one', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    const created = source();

    await created.fetchJobs(QUERY);
    expect(created.takeLinkProvenance().length).toBeGreaterThan(0);
    expect(created.takeLinkProvenance()).toEqual([]);
  });
});

describe('malformed input degrades instead of crashing the run', () => {
  it('returns nothing for an empty folder', async () => {
    expect(await source().fetchJobs(QUERY)).toEqual([]);
  });

  it('returns nothing for an empty file, and warns', async () => {
    const logger = createRecordingLogger();
    await writeDigest('newsletter-2026-09-06.txt', '');

    expect(await source({ logger }).fetchJobs(QUERY)).toEqual([]);
    expect(logger.messages.some((message) => message.level === 'warn')).toBe(true);
  });

  it('skips a file no registered parser recognises and reports it as a degraded target', async () => {
    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    await writeDigest('michael-page-alert.txt', 'Estimado Adrian, tenemos 4 ofertas para ti.');

    const created = source();
    const jobs = await created.fetchJobs(QUERY);

    expect(jobs).toHaveLength(3);
    expect(created.takeDegradedTargets?.()).toEqual([
      {
        target: 'michael-page-alert.txt',
        error: expect.stringContaining('no registered parser'),
      },
    ]);
  });

  it('keeps the other files when one parser throws', async () => {
    const exploding: NewsletterParser = {
      format: 'exploding',
      senderDescription: 'a parser that fails',
      detect: (text) => text.startsWith('BOOM'),
      parse: () => {
        throw new Error('unexpected shape');
      },
    };

    await writeDigest('newsletter-2026-09-06.txt', DIGEST);
    await writeDigest('broken.txt', 'BOOM');

    const created = source({ extraParsers: [exploding] });
    // The exploding parser claims only `broken.txt`; the digest keeps its own.
    const jobs = await created.fetchJobs(QUERY);

    expect(jobs).toHaveLength(3);
    expect(created.takeDegradedTargets?.()).toEqual([
      { target: 'broken.txt', error: 'unexpected shape' },
    ]);
  });

  it('reports a missing input folder as a failed source rather than a silent zero', async () => {
    const missing = resolve(directory, 'does-not-exist');
    await expect(source({ directory: missing }).fetchJobs(QUERY)).rejects.toThrow(
      /newsletter input folder/i,
    );
  });

  it('drains degraded targets so the next run starts clean', async () => {
    await writeDigest('unknown.txt', 'not a digest');
    const created = source();

    await created.fetchJobs(QUERY);
    expect(created.takeDegradedTargets?.()).toHaveLength(1);
    expect(created.takeDegradedTargets?.()).toEqual([]);
  });

  it('never lets a single unusable posting kill the file it came from', async () => {
    const halfBroken: NewsletterParser = {
      format: 'half-broken',
      senderDescription: 'test parser',
      detect: (text) => text.startsWith('HALF'),
      parse: (_text, ctx): readonly NewsletterPosting[] => [
        {
          externalId: 'https://boards.example.test/jobs/1',
          title: 'Junior Developer',
          company: 'Acme',
          location: 'Spain',
          description: 'ok',
          url: 'https://boards.example.test/jobs/1',
          postedAt: ctx.receivedAt,
        },
        {
          externalId: 'nope',
          title: 'Broken Developer',
          company: 'Acme',
          location: 'Spain',
          description: 'bad',
          url: 'nope',
          postedAt: ctx.receivedAt,
        },
      ],
    };

    await writeDigest('half.txt', 'HALF');
    const jobs = await source({ extraParsers: [halfBroken] }).fetchJobs(QUERY);

    expect(jobs.map((job) => job.title)).toEqual(['Junior Developer']);
  });
});
