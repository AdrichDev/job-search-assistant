import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { LivenessRecord } from '../../src/domain/link-liveness.js';
import type { Job } from '../../src/domain/job.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import type { LinkChecker } from '../../src/ports/link-checker.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';
import { createRecordingLogger, silentLogger } from '../helpers/silent-logger.js';

/**
 * REMOVAL, END TO END - the pipeline actually deleting somebody's opportunity.
 *
 * `tests/domain/link-liveness.test.ts` pins the RULE. This file pins that the
 * pipeline obeys it: that 404 and 410 really do leave the list, that everything
 * else really does survive, that what left is still inspectable, and - the one
 * that matters most - that a checker which cannot reach the network removes
 * nothing at all.
 *
 * No network. The `LinkChecker` port is handed a scripted answer per URL, which
 * is exactly why that port exists.
 */

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

function stubSource(id: string, jobs: readonly Job[]): JobSource {
  return { id, fetchJobs: async () => jobs };
}

/** A checker that answers from a table, and counts what it was asked. */
function scriptedChecker(
  table: Record<string, { status: number | null; error?: string }>,
): LinkChecker & { readonly asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    async check(urls) {
      asked.push([...urls]);
      const records = new Map<string, LivenessRecord>();
      for (const url of new Set(urls)) {
        const hit = table[url];
        if (hit === undefined) {
          continue;
        }
        const error = hit.error ?? null;
        const verdict =
          error !== null || hit.status === null
            ? 'unverified'
            : hit.status === 404 || hit.status === 410
              ? 'gone'
              : hit.status >= 200 && hit.status < 300
                ? 'alive'
                : 'unverified';
        records.set(url, {
          verdict,
          status: error === null ? hit.status : null,
          checkedAt: REFERENCE_NOW.toISOString(),
          error,
        });
      }
      return records;
    },
    takeStats: () => ({ requests: 0, fromCache: 0 }),
  };
}

function softwareJob(overrides: { externalId: string; title: string; company: string; url: string }): Job {
  return makeJob({
    sourceId: 'greenhouse',
    description:
      'Desarrollo de software con React, TypeScript y Node. Perfil junior, sin experiencia previa requerida.',
    postedAt: daysAgo(1),
    ...overrides,
  });
}

async function runPipeline(jobs: readonly Job[], checker?: LinkChecker) {
  return buildJobQueue(
    { queries: [QUERY], candidateName: 'Adrian' },
    {
      sources: [stubSource('greenhouse', jobs)],
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: silentLogger,
      now: () => REFERENCE_NOW,
      ...(checker === undefined ? {} : { linkChecker: checker }),
    },
  );
}

const DEAD = softwareJob({
  externalId: 'dead-1',
  title: 'Systems Developer Engineer',
  company: 'Amazon',
  url: 'https://jobs.example.test/hh6WWK',
});

const LIVE = softwareJob({
  externalId: 'live-1',
  title: 'Junior Frontend Developer',
  company: 'ACME',
  url: 'https://boards.greenhouse.io/acme/jobs/4471203',
});

describe('what removal does to the list', () => {
  it('removes a posting that answered 404', async () => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({
        [DEAD.url]: { status: 404 },
        [LIVE.url]: { status: 200 },
      }),
    );

    expect(queue.jobs.map((entry) => entry.url)).toEqual([LIVE.url]);
  });

  it('removes a posting that answered 410', async () => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status: 410 }, [LIVE.url]: { status: 200 } }),
    );

    expect(queue.jobs.map((entry) => entry.url)).toEqual([LIVE.url]);
  });

  it.each([
    [403, 'bot protection'],
    [401, 'a login wall'],
    [429, 'rate limiting'],
    [302, 'a redirect'],
    [500, 'a broken server'],
  ])('KEEPS a posting that answered %i (%s)', async (status) => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status }, [LIVE.url]: { status: 200 } }),
    );

    expect(queue.jobs).toHaveLength(2);
    expect(queue.excluded.filter((entry) => entry.excludedBy === 'dead_link')).toEqual([]);
  });

  it.each([
    ['request timed out after 10000ms'],
    ['read ECONNRESET'],
    ['getaddrinfo ENOTFOUND careers.example.org'],
  ])('KEEPS a posting whose check failed with "%s"', async (error) => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status: null, error }, [LIVE.url]: { status: 200 } }),
    );

    expect(queue.jobs).toHaveLength(2);
  });

  it('KEEPS a posting the checker said nothing about', async () => {
    // Absent from the returned map. The most common shape of "we do not know",
    // and it must read as keep rather than as a falsy verdict.
    const queue = await runPipeline([DEAD, LIVE], scriptedChecker({ [LIVE.url]: { status: 200 } }));

    expect(queue.jobs).toHaveLength(2);
  });

  it('removes nothing at all when no checker is wired in', async () => {
    const queue = await runPipeline([DEAD, LIVE]);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs.every((entry) => entry.liveness === null)).toBe(true);
  });

  it('reports the pass as OFF, not as a clean run that found nothing', async () => {
    /*
     * The regression this pins is one I shipped and caught on a real run.
     *
     * `--no-check-links` used to wire a passthrough checker - an object that
     * answers "no records" - and `buildJobQueue` cannot tell that apart from a
     * real checker whose every request came back empty. So the summary said
     * `ran`, and the CLI printed "Link liveness: 0 checked, 0 reachable" on a
     * run that had deliberately checked nothing.
     *
     * The cause was having TWO ways to say "off" that behaved differently.
     * There is one now: no checker. Absence is the only representation.
     */
    const queue = await runPipeline([DEAD, LIVE]);

    expect(queue.liveness).toMatchObject({ status: 'off', checked: 0, removed: 0, requests: 0 });
  });
});

/**
 * THE NAMED REGRESSION, at pipeline level.
 *
 * Both postings are real, open junior roles at CaixaBank Tech measured on
 * 2026-09-10. The shortener answers 302; following it, `caixabanktech.com`
 * answers Node's fetch with `read ECONNRESET` because of bot protection.
 *
 * If this test ever fails, the pipeline is deleting live vacancies the
 * candidate is qualified for, and nobody will find out from the product.
 */
describe('the CaixaBank Tech regression', () => {
  const FULL_STACK = softwareJob({
    externalId: 'caixa-fs',
    title: 'Software Engineer Full Stack (Junior)',
    company: 'CaixaBank Tech',
    url: 'https://jobs.example.test/2LZYe1',
  });
  const JAVA_PYTHON = softwareJob({
    externalId: 'caixa-jp',
    title: 'Software Engineer Java + Python (Junior)',
    company: 'CaixaBank Tech',
    url: 'https://jobs.example.test/P0VA3R',
  });

  it('keeps both roles when the destination resets the connection', async () => {
    const queue = await runPipeline(
      [DEAD, FULL_STACK, JAVA_PYTHON],
      scriptedChecker({
        [DEAD.url]: { status: 404 },
        [FULL_STACK.url]: { status: null, error: 'read ECONNRESET' },
        [JAVA_PYTHON.url]: { status: null, error: 'read ECONNRESET' },
      }),
    );

    const titles = queue.jobs.map((entry) => entry.title);
    expect(titles).toContain('Software Engineer Full Stack (Junior)');
    expect(titles).toContain('Software Engineer Java + Python (Junior)');
    // And the genuinely dead one did go.
    expect(titles).not.toContain('Systems Developer Engineer');
  });

  it('keeps both roles when only the 302 from the shortener is observed', async () => {
    const queue = await runPipeline(
      [FULL_STACK, JAVA_PYTHON],
      scriptedChecker({
        [FULL_STACK.url]: { status: 302 },
        [JAVA_PYTHON.url]: { status: 302 },
      }),
    );

    expect(queue.jobs).toHaveLength(2);
  });

  it('marks both roles as unverified so the UI can say so honestly', async () => {
    const queue = await runPipeline(
      [FULL_STACK, JAVA_PYTHON],
      scriptedChecker({
        [FULL_STACK.url]: { status: null, error: 'read ECONNRESET' },
        [JAVA_PYTHON.url]: { status: null, error: 'read ECONNRESET' },
      }),
    );

    expect(queue.jobs.map((entry) => entry.liveness?.verdict)).toEqual([
      'unverified',
      'unverified',
    ]);
  });
});

describe('removal is visible, never silent', () => {
  it('keeps the removed posting inspectable in the excluded list', async () => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status: 404 }, [LIVE.url]: { status: 200 } }),
    );

    const removed = queue.excluded.filter((entry) => entry.excludedBy === 'dead_link');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      title: 'Systems Developer Engineer',
      company: 'Amazon',
      url: DEAD.url,
      excludedBy: 'dead_link',
      reason:
        'the posting answered HTTP 404 (gone), so the vacancy no longer exists at that address',
    });
  });

  it('carries the score the removed posting would have had, like every other exclusion', async () => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status: 404 }, [LIVE.url]: { status: 200 } }),
    );

    const removed = queue.excluded.find((entry) => entry.excludedBy === 'dead_link');
    expect(removed?.scoreBeforeGate).toBeGreaterThan(0);
    expect(removed?.softwareRelevance).toBeGreaterThan(0);
  });

  it('reports the counts the CLI prints', async () => {
    const queue = await runPipeline(
      [DEAD, LIVE],
      scriptedChecker({ [DEAD.url]: { status: 404 }, [LIVE.url]: { status: 403 } }),
    );

    expect(queue.liveness).toMatchObject({
      status: 'ran',
      checked: 2,
      gone: 1,
      unverified: 1,
      alive: 0,
      removed: 1,
    });
  });

  it('says out loud, in the log, that postings were deleted', async () => {
    const logger = createRecordingLogger();
    await buildJobQueue(
      { queries: [QUERY], candidateName: 'Adrian' },
      {
        sources: [stubSource('greenhouse', [DEAD, LIVE])],
        scoringConfig: DEFAULT_SCORING_CONFIG,
        juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
        logger,
        now: () => REFERENCE_NOW,
        linkChecker: scriptedChecker({ [DEAD.url]: { status: 404 }, [LIVE.url]: { status: 200 } }),
      },
    );

    expect(logger.messages.map((entry) => entry.message).join('\n')).toMatch(
      /1 posting\(s\) removed as provably gone/i,
    );
  });
});

describe('threading the verdict onto the queue entry', () => {
  it('puts the status and the check time on every surviving posting', async () => {
    const queue = await runPipeline(
      [LIVE],
      scriptedChecker({ [LIVE.url]: { status: 200 } }),
    );

    expect(queue.jobs[0]?.liveness).toEqual({
      verdict: 'alive',
      status: 200,
      checkedAt: REFERENCE_NOW.toISOString(),
      error: null,
    });
  });

  it('leaves `liveness` null on a posting the checker never answered for', async () => {
    const queue = await runPipeline([DEAD, LIVE], scriptedChecker({ [LIVE.url]: { status: 200 } }));

    const dead = queue.jobs.find((entry) => entry.url === DEAD.url);
    expect(dead?.liveness).toBeNull();
  });
});

describe('checking only what will actually be shown', () => {
  it('never asks about a posting the filters already removed', async () => {
    /*
     * Politeness AND correctness. A posting excluded as not-software is never
     * going to be clicked, so spending a request on somebody's server to ask
     * about it is pure waste.
     */
    const dentist = makeJob({
      sourceId: 'greenhouse',
      externalId: 'dentist',
      title: 'Higienista dental',
      company: 'Clinica',
      description: 'Clinica dental busca higienista con titulacion sanitaria.',
      url: 'https://example.com/jobs/dentist',
      postedAt: daysAgo(1),
    });

    const checker = scriptedChecker({ [LIVE.url]: { status: 200 } });
    const queue = await runPipeline([LIVE, dentist], checker);

    expect(queue.excluded.some((entry) => entry.excludedBy === 'software_relevance')).toBe(true);
    expect(checker.asked).toEqual([[LIVE.url]]);
  });
});

/**
 * THE DEGRADED CASE.
 *
 * An unreachable checker is not evidence that jobs are dead. This is the same
 * refusal `persist-queue.ts` already makes about empty results, applied to
 * removal: absence of proof is not proof of absence, and the pipeline must
 * behave identically on a train and in an office.
 */
describe('when the liveness check fails wholesale', () => {
  it('removes nothing when every check fails at the transport layer', async () => {
    const jobs = [DEAD, LIVE];
    const queue = await runPipeline(
      jobs,
      scriptedChecker({
        [DEAD.url]: { status: null, error: 'fetch failed' },
        [LIVE.url]: { status: null, error: 'fetch failed' },
      }),
    );

    expect(queue.jobs).toHaveLength(2);
    expect(queue.excluded.filter((entry) => entry.excludedBy === 'dead_link')).toEqual([]);
  });

  it('removes nothing when the checker itself throws', async () => {
    const exploding: LinkChecker = {
      async check() {
        throw new Error('getaddrinfo ENOTFOUND boards.greenhouse.io');
      },
    };

    const queue = await runPipeline([DEAD, LIVE], exploding);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs.every((entry) => entry.liveness === null)).toBe(true);
  });

  it('reports the wholesale failure instead of pretending the check ran', async () => {
    const exploding: LinkChecker = {
      async check() {
        throw new Error('getaddrinfo ENOTFOUND boards.greenhouse.io');
      },
    };

    const queue = await runPipeline([DEAD, LIVE], exploding);

    expect(queue.liveness).toMatchObject({
      status: 'failed',
      removed: 0,
      error: 'getaddrinfo ENOTFOUND boards.greenhouse.io',
    });
  });

  it('degrades the run rather than aborting it', async () => {
    const logger = createRecordingLogger();
    const exploding: LinkChecker = {
      async check() {
        throw new Error('no network');
      },
    };

    await buildJobQueue(
      { queries: [QUERY], candidateName: 'Adrian' },
      {
        sources: [stubSource('greenhouse', [DEAD, LIVE])],
        scoringConfig: DEFAULT_SCORING_CONFIG,
        juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
        logger,
        now: () => REFERENCE_NOW,
        linkChecker: exploding,
      },
    );

    const warnings = logger.messages.filter((entry) => entry.level === 'warn');
    expect(warnings.map((entry) => entry.message).join('\n')).toMatch(
      /nothing was removed/i,
    );
  });
});
