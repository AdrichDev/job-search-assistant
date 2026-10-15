import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonFileQueueReader } from '../../src/adapters/output/json-file-queue-reader.js';
import { createJsonFileQueueWriter } from '../../src/adapters/output/json-file-queue-writer.js';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { JobSourceQuery } from '../../src/ports/job-source.js';
import { REFERENCE_NOW, makeJob } from '../helpers/make-job.js';
import { silentLogger } from '../helpers/silent-logger.js';

let directory: string;
let filePath: string;

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'queue-read-'));
  filePath = join(directory, 'queue.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createJsonFileQueueReader', () => {
  it('returns null when no run has been persisted yet', async () => {
    expect(await createJsonFileQueueReader({ filePath }).read()).toBeNull();
  });

  it('round-trips a queue written by the writer', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY], candidateName: 'Alex Example' },
      {
        sources: [
          {
            id: 'stub',
            fetchJobs: async () => [
              makeJob({ title: 'Junior React Developer', description: 'React y TypeScript.' }),
            ],
          },
        ],
        scoringConfig: DEFAULT_SCORING_CONFIG,
        juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
        logger: silentLogger,
        now: () => REFERENCE_NOW,
      },
    );

    await createJsonFileQueueWriter({ filePath }).write(queue);
    const loaded = await createJsonFileQueueReader({ filePath }).read();

    expect(loaded?.candidate).toBe('Alex Example');
    expect(loaded?.jobs[0]?.title).toBe('Junior React Developer');
    expect(loaded?.jobs[0]?.applicationStatus).toBe('not_applied');
    expect(loaded?.jobs[0]?.requirements.matchedStack).toContain('react');
  });

  it('rejects a truncated file instead of returning half a queue', async () => {
    await writeFile(filePath, '{"generatedAt":');
    await expect(createJsonFileQueueReader({ filePath }).read()).rejects.toThrow(/valid JSON/i);
  });

  it('rejects a queue written by an older format', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        generatedAt: REFERENCE_NOW.toISOString(),
        candidate: 'Adrian',
        totalFetched: 1,
        totalUnique: 1,
        duplicatesRemoved: 0,
        sourceReports: [],
        // Pre-tracking entry: no exploration, requirements or applicationStatus.
        jobs: [{ rank: 1, id: 'a', score: 10, cvVariant: 'frontend', title: 't' }],
      }),
    );

    await expect(createJsonFileQueueReader({ filePath }).read()).rejects.toThrow(
      /older version|queue format/i,
    );
  });
});
