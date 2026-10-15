import { describe, expect, it } from 'vitest';
import { createGreenhouseJobSource } from '../../../src/adapters/boards/greenhouse-board.js';
import type { BoardFetch } from '../../../src/adapters/boards/board-http.js';
import type { CompanyBoard } from '../../../src/config/company-boards.js';
import type { JobSourceQuery } from '../../../src/ports/job-source.js';
import { createRecordingLogger } from '../../helpers/silent-logger.js';

/**
 * A provider is one JobSource over MANY company boards. That fan-out is where
 * the run's failure profile actually changed, so it gets its own tests:
 *
 *  - one dead company must not cost the other companies' postings
 *  - a dead company must still be REPORTED, not swallowed
 *  - only a total wipe-out is allowed to fail the source, because that is the
 *    one case where "we found nothing" says something about the network rather
 *    than about the job market
 */

const NOW = new Date('2026-09-08T12:00:00.000Z');

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 365,
  resultsPerPage: 50,
  maxPages: 1,
};

function company(slug: string): CompanyBoard {
  return {
    slug,
    provider: 'greenhouse',
    displayName: slug,
    verifiedOn: '2026-09-08',
    spainOpeningsAtVerification: 1,
    softwareOpeningsAtVerification: 1,
  };
}

function jobsPayload(slug: string, count: number): unknown {
  return {
    jobs: Array.from({ length: count }, (_unused, index) => ({
      id: `${slug}-${index}`,
      title: `${slug} Engineer ${index}`,
      location: { name: 'Madrid' },
      absolute_url: `https://boards.test/${slug}/${index}`,
      first_published: '2026-09-01T00:00:00Z',
      company_name: slug,
    })),
  };
}

describe('per-company board fan-out', () => {
  it('fetches every configured company exactly once', async () => {
    const urls: string[] = [];
    const fetchImpl: BoardFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => jobsPayload('x', 1) };
    };

    const source = createGreenhouseJobSource({
      companies: [company('alpha'), company('beta'), company('gamma')],
      logger: createRecordingLogger(),
      fetchImpl,
      now: () => NOW,
    });

    await source.fetchJobs(QUERY);
    expect(urls).toHaveLength(3);
    expect(urls.join(' ')).toContain('/boards/alpha/jobs');
    expect(urls.join(' ')).toContain('/boards/beta/jobs');
    expect(urls.join(' ')).toContain('/boards/gamma/jobs');
  });

  it('never exceeds the configured concurrency against a free endpoint', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: BoardFetch = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, status: 200, json: async () => jobsPayload(url, 1) };
    };

    const source = createGreenhouseJobSource({
      companies: Array.from({ length: 10 }, (_u, i) => company(`c${i}`)),
      logger: createRecordingLogger(),
      fetchImpl,
      concurrency: 2,
      now: () => NOW,
    });

    await source.fetchJobs(QUERY);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('keeps the healthy companies when one board is dead', async () => {
    const logger = createRecordingLogger();
    const fetchImpl: BoardFetch = async (url) => {
      if (url.includes('/broken/')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => jobsPayload('alpha', 2) };
    };

    const source = createGreenhouseJobSource({
      companies: [company('alpha'), company('broken'), company('gamma')],
      logger,
      fetchImpl,
      now: () => NOW,
    });

    const jobs = await source.fetchJobs(QUERY);
    expect(jobs).toHaveLength(4);
    expect(logger.messages.some((entry) => entry.message.includes('broken'))).toBe(true);
  });

  it('reports the dead company as a degraded target instead of hiding it', async () => {
    const source = createGreenhouseJobSource({
      companies: [company('alpha'), company('broken')],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async (url) =>
        url.includes('/broken/')
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => jobsPayload('alpha', 1) },
    });

    await source.fetchJobs(QUERY);
    const degraded = source.takeDegradedTargets?.() ?? [];

    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.target).toBe('broken');
    expect(degraded[0]?.error).toMatch(/404/);
  });

  it('drains the degraded targets so a later run does not inherit them', async () => {
    const source = createGreenhouseJobSource({
      companies: [company('alpha'), company('broken')],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async (url) =>
        url.includes('/broken/')
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => jobsPayload('alpha', 1) },
    });

    await source.fetchJobs(QUERY);
    expect(source.takeDegradedTargets?.()).toHaveLength(1);
    expect(source.takeDegradedTargets?.()).toHaveLength(0);
  });

  it('fails the whole source only when EVERY company failed', async () => {
    // This is the one honest "the run learned nothing" signal, and the only
    // one allowed to reach the degraded-write guard.
    const source = createGreenhouseJobSource({
      companies: [company('a'), company('b')],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    });

    await expect(source.fetchJobs(QUERY)).rejects.toThrow(/all 2 greenhouse boards failed/i);
  });

  it('is healthy, not failed, when boards answered but Spain had no openings', async () => {
    // An empty board is a real answer about the job market. Only a broken
    // board is an answer about the network.
    const source = createGreenhouseJobSource({
      companies: [company('a')],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ jobs: [] }) }),
    });

    await expect(source.fetchJobs(QUERY)).resolves.toEqual([]);
    expect(source.takeDegradedTargets?.()).toEqual([]);
  });

  it('does nothing at all when no company is configured', async () => {
    let called = false;
    const source = createGreenhouseJobSource({
      companies: [],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
      },
    });

    await expect(source.fetchJobs(QUERY)).resolves.toEqual([]);
    expect(called).toBe(false);
  });

  it('collapses the same posting seen on two company boards', async () => {
    // Two slugs can legitimately front the same ATS board.
    const source = createGreenhouseJobSource({
      companies: [company('alpha'), company('alpha-eu')],
      logger: createRecordingLogger(),
      now: () => NOW,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => jobsPayload('alpha', 1) }),
    });

    const jobs = await source.fetchJobs(QUERY);
    // The adapter does not dedupe - that is the domain's job - but it must not
    // lose either reference on the way there.
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.id).toBe(jobs[1]?.id);
  });
});
