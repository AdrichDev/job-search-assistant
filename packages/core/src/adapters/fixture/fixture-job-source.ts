import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createJob, type Job } from '../../domain/job.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';

export const FIXTURE_SOURCE_ID = 'fixture';

const MILLIS_PER_DAY = 86_400_000;

const fixtureJobSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  company: z.string().default(''),
  location: z.string().default(''),
  description: z.string().default(''),
  // Absolute, not just non-empty. The catalogue feeds the same `createJob` and
  // the same apply button as a live source, so it owes the same URL guarantee.
  url: z.string().url(),
  /** Relative age, not an absolute date - see the note in data/sample-jobs.json. */
  postedDaysAgo: z.number().min(0),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  contractType: z.string().nullish(),
});

const fixtureFileSchema = z.object({
  version: z.literal(1),
  jobs: z.array(fixtureJobSchema),
});

export interface FixtureJobSourceOptions {
  readonly filePath: string;
  readonly now: () => Date;
}

/**
 * Offline source backed by committed sample data.
 *
 * Why it exists: the pipeline, its tests and the CLI demo must all run with no
 * API key and no network. It is also the contract fixture the Adzuna adapter is
 * measured against.
 *
 * Known simplification: `what` and `where` are ignored. Every query returns the
 * same catalogue, which conveniently exercises deduplication end to end when
 * the CLI runs the full multi-query search plan.
 */
export function createFixtureJobSource(options: FixtureJobSourceOptions): JobSource {
  return {
    id: FIXTURE_SOURCE_ID,

    async fetchJobs(query: JobSourceQuery): Promise<readonly Job[]> {
      const raw: unknown = JSON.parse(await readFile(options.filePath, 'utf8'));
      const parsed = fixtureFileSchema.safeParse(raw);

      if (!parsed.success) {
        throw new Error(
          `Fixture file ${options.filePath} is not a valid sample catalogue: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
        );
      }

      const now = options.now();
      const budget = Math.max(1, query.resultsPerPage * query.maxPages);

      return parsed.data.jobs
        .filter((entry) => entry.postedDaysAgo <= query.maxDaysOld)
        .slice(0, budget)
        .map((entry) =>
          createJob({
            sourceId: FIXTURE_SOURCE_ID,
            externalId: entry.externalId,
            title: entry.title,
            company: entry.company,
            location: entry.location,
            description: entry.description,
            url: entry.url,
            postedAt: new Date(now.getTime() - entry.postedDaysAgo * MILLIS_PER_DAY),
            salaryMin: entry.salaryMin ?? null,
            salaryMax: entry.salaryMax ?? null,
            contractType: entry.contractType ?? null,
          }),
        );
    },
  };
}
