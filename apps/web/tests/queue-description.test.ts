import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildJobQueue, createJob, createJsonFileQueueReader } from '@job-queue/core';
import { DEFAULT_JUNIOR_FILTER_CONFIG, DEFAULT_SCORING_CONFIG } from '@job-queue/core';

/**
 * The offer description is the one `Job` fact the `Abrir` dialog must show in
 * full, and the only one the pipeline used to drop on the way to
 * `output/queue.json`. These tests pin the two ends of that round trip: the
 * builder must carry the description into the persisted entry, and the reader
 * must accept a queue file that has one (and one that predates the field).
 */

const DESCRIPTION = 'React y TypeScript. Equipo de seis personas. Sin experiencia previa requerida.';

function stubSource(jobs: readonly ReturnType<typeof createJob>[]): Parameters<typeof buildJobQueue>[1]['sources'] {
  return [{ id: 'alpha', fetchJobs: async () => jobs }];
}

describe('the description reaches the persisted queue', () => {
  it('buildJobQueue keeps the description the adapter read', async () => {
    const job = createJob({
      sourceId: 'alpha',
      externalId: 'd1',
      title: 'Desarrollador Junior Frontend',
      company: 'ACME',
      location: 'Madrid',
      description: DESCRIPTION,
      url: 'https://boards.example.test/jobs/d1',
      postedAt: new Date(0),
    });

    const queue = await buildJobQueue(
      { queries: [{ what: 'junior developer', where: 'Madrid', maxDaysOld: 30, resultsPerPage: 50, maxPages: 1 }], candidateName: 'Test' },
      {
        sources: stubSource([job]),
        scoringConfig: DEFAULT_SCORING_CONFIG,
        juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        now: () => new Date(0),
      },
    );

    expect(queue.jobs[0]?.description).toBe(DESCRIPTION);
  });

  it('the reader accepts a queue file that carries a description', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'queue-description-'));
    const filePath = join(dir, 'queue.json');
    await writeFile(
      filePath,
      JSON.stringify({
        generatedAt: '2026-03-10T09:00:00.000Z',
        candidate: 'Test',
        totalFetched: 1,
        totalUnique: 1,
        duplicatesRemoved: 0,
        sourceReports: [{ sourceId: 'alpha', query: 'junior developer', status: 'ok', fetched: 1 }],
        excluded: [],
        jobs: [
          {
            rank: 1,
            id: 'acme::junior frontend::madrid',
            score: 50,
            cvVariant: 'frontend',
            requirements: {
              yearsRequired: null,
              senioritySignals: [],
              matchedStack: [],
              cvVariant: 'frontend',
              englishRequired: 'not_stated',
              workMode: 'hybrid',
            },
            applicationStatus: 'not_applied',
            appliedAt: null,
            outcomeUpdatedAt: null,
            notes: null,
            title: 'Junior Frontend',
            company: 'ACME',
            location: 'Madrid',
            description: DESCRIPTION,
            url: 'https://boards.example.test/jobs/d1',
            postedAt: '2026-03-09T09:00:00.000Z',
            salaryMin: null,
            salaryMax: null,
            contractType: null,
            sources: [{ sourceId: 'alpha', externalId: 'd1', url: 'https://boards.example.test/jobs/d1' }],
            breakdown: [],
            liveness: null,
          },
        ],
      }),
      'utf8',
    );

    const queue = await createJsonFileQueueReader({ filePath }).read();
    expect(queue?.jobs[0]?.description).toBe(DESCRIPTION);
  });

  it('a legacy queue file without descriptions still reads, with the field absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'queue-description-'));
    const filePath = join(dir, 'legacy.json');
    await writeFile(
      filePath,
      JSON.stringify({
        generatedAt: '2026-03-10T09:00:00.000Z',
        candidate: 'Test',
        totalFetched: 1,
        totalUnique: 1,
        duplicatesRemoved: 0,
        sourceReports: [],
        excluded: [],
        jobs: [],
      }),
      'utf8',
    );

    const queue = await createJsonFileQueueReader({ filePath }).read();
    expect(queue?.jobs).toEqual([]);
  });
});
