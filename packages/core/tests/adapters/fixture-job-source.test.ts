import { describe, expect, it } from 'vitest';
import { createFixtureJobSource } from '../../src/adapters/fixture/fixture-job-source.js';
import { DEFAULT_FIXTURE_PATH } from '../../src/config/paths.js';
import type { JobSourceQuery } from '../../src/ports/job-source.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

// `data/` lives at the workspace root and is shared by the CLI and the web app,
// so the path is resolved through the same helper production code uses.
const SAMPLE_PATH = DEFAULT_FIXTURE_PATH;

const QUERY: JobSourceQuery = {
  what: 'anything',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

function source() {
  return createFixtureJobSource({ filePath: SAMPLE_PATH, now: () => REFERENCE_NOW });
}

describe('createFixtureJobSource', () => {
  it('identifies itself as the fixture source', () => {
    expect(source().id).toBe('fixture');
  });

  it('loads the committed sample data with no network and no API key', async () => {
    const jobs = await source().fetchJobs(QUERY);
    expect(jobs.length).toBeGreaterThan(10);
  });

  it('resolves relative ages against the injected clock', async () => {
    const jobs = await source().fetchJobs(QUERY);
    const trainee = jobs.find((job) => job.company === 'Kubo Labs');
    expect(trainee?.postedAt.getTime()).toBe(REFERENCE_NOW.getTime());
  });

  it('produces jobs already normalized by the domain factory', async () => {
    const [first] = await source().fetchJobs(QUERY);
    expect(first?.id).toBeTruthy();
    expect(first?.sources[0]?.sourceId).toBe('fixture');
  });

  it('honours maxDaysOld', async () => {
    const jobs = await source().fetchJobs({ ...QUERY, maxDaysOld: 5 });
    expect(jobs.every((job) => job.postedAt.getTime() >= REFERENCE_NOW.getTime() - 5 * 86_400_000)).toBe(true);
    expect(jobs.length).toBeLessThan(15);
  });

  it('honours the page size budget', async () => {
    const jobs = await source().fetchJobs({ ...QUERY, resultsPerPage: 3, maxPages: 1 });
    expect(jobs).toHaveLength(3);
  });

  it('does not filter by stack: senior and non-matching roles come through', async () => {
    const jobs = await source().fetchJobs(QUERY);
    expect(jobs.map((job) => job.company)).toContain('Globex');
    expect(jobs.map((job) => job.company)).toContain('Meridian Bank');
  });

  it('fails loudly when the sample file is missing', async () => {
    const broken = createFixtureJobSource({
      filePath: 'does-not-exist.json',
      now: () => REFERENCE_NOW,
    });
    await expect(broken.fetchJobs(QUERY)).rejects.toThrow();
  });
});
