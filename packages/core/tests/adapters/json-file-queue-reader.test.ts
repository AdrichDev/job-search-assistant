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

  async function buildOne(...jobs: readonly ReturnType<typeof makeJob>[]) {
    return buildJobQueue(
      { queries: [QUERY], candidateName: 'Alex Example' },
      {
        sources: [{ id: 'stub', fetchJobs: async () => jobs }],
        scoringConfig: DEFAULT_SCORING_CONFIG,
        juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
        logger: silentLogger,
        now: () => REFERENCE_NOW,
      },
    );
  }

  it('round-trips the CV category suggestion, including tie and no-evidence shapes', async () => {
    const queue = await buildOne(
      makeJob({ externalId: 'a', title: 'Junior Java Developer', description: 'Spring Boot.' }),
      makeJob({ externalId: 'b', title: 'Junior Software Developer', description: 'Java y React.' }),
      makeJob({ externalId: 'c', title: 'Junior Software Engineer', description: 'Equipo agil.' }),
    );

    await createJsonFileQueueWriter({ filePath }).write(queue);
    const loaded = await createJsonFileQueueReader({ filePath }).read();

    expect(loaded?.jobs.map((entry) => entry.cvCategorySuggestion)).toEqual(
      queue.jobs.map((entry) => entry.cvCategorySuggestion),
    );
    const reasons = loaded?.jobs.map((entry) => entry.cvCategorySuggestion?.reason).sort();
    expect(reasons).toEqual(['evidence', 'no_evidence', 'tie']);
    const tie = loaded?.jobs.find((entry) => entry.cvCategorySuggestion?.reason === 'tie');
    expect(tie?.cvCategorySuggestion?.tiedCategories).toEqual(['java_spring_backend', 'frontend']);
  });

  it('keeps reading a legacy entry that has no suggestion, without inventing one', async () => {
    const queue = await buildOne(makeJob({ title: 'Junior React Developer' }));
    const legacyJobs = queue.jobs.map(({ cvCategorySuggestion: _omitted, ...rest }) => rest);
    await writeFile(filePath, JSON.stringify({ ...queue, jobs: legacyJobs }));

    const loaded = await createJsonFileQueueReader({ filePath }).read();

    expect(loaded?.jobs).toHaveLength(1);
    expect(loaded?.jobs[0]?.title).toBe(queue.jobs[0]?.title);
    expect(loaded?.jobs[0]).not.toHaveProperty('cvCategorySuggestion');
  });

  it.each([
    ['an unknown category', { category: 'cobol', matchedTerms: [], reason: 'no_evidence' }],
    ['an unknown reason', { category: 'general', matchedTerms: [], reason: 'because' }],
    ['matched terms that are not strings', { category: 'frontend', matchedTerms: [1], reason: 'evidence' }],
    ['a missing reason', { category: 'frontend', matchedTerms: ['react'] }],
    ['tied categories that are unknown', { category: 'general', matchedTerms: [], reason: 'tie', tiedCategories: ['cobol'] }],
  ])('rejects a malformed suggestion: %s', async (_label, suggestion) => {
    const queue = await buildOne(makeJob({ title: 'Junior React Developer' }));
    await writeFile(
      filePath,
      JSON.stringify({
        ...queue,
        jobs: queue.jobs.map((entry) => ({ ...entry, cvCategorySuggestion: suggestion })),
      }),
    );

    await expect(createJsonFileQueueReader({ filePath }).read()).rejects.toThrow(/queue format/i);
  });

  it('does not let a model id or path ride along inside a persisted suggestion', async () => {
    const queue = await buildOne(makeJob({ title: 'Junior React Developer' }));
    const tainted = {
      category: 'frontend',
      matchedTerms: ['react'],
      reason: 'evidence',
      modelId: 'x',
      path: 'a.pdf',
    };
    await writeFile(
      filePath,
      JSON.stringify({
        ...queue,
        jobs: queue.jobs.map((entry) => ({ ...entry, cvCategorySuggestion: tainted })),
      }),
    );

    const loaded = await createJsonFileQueueReader({ filePath }).read();

    expect(loaded?.jobs[0]?.cvCategorySuggestion).toEqual({
      category: 'frontend',
      matchedTerms: ['react'],
      reason: 'evidence',
    });
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
