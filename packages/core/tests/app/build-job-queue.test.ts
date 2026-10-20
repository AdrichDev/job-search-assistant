import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { createApplication, withOutcome } from '../../src/domain/application.js';
import { extractRequirements } from '../../src/domain/requirements.js';
import { suggestCvCategory } from '../../src/domain/cv-category.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import type { Job } from '../../src/domain/job.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';
import { createRecordingLogger, silentLogger } from '../helpers/silent-logger.js';

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

function failingSource(id: string, message: string): JobSource {
  return {
    id,
    fetchJobs: async () => {
      throw new Error(message);
    },
  };
}

const GOOD_JOB = makeJob({
  sourceId: 'alpha',
  externalId: 'g1',
  title: 'Desarrollador Junior Frontend',
  company: 'ACME',
  location: 'Madrid',
  description: 'React, TypeScript y Tailwind. Sin experiencia previa. Ingles B1.',
  postedAt: daysAgo(1),
});

/**
 * A BAD FIT for this candidate - other city, C1 English, a stack he does not
 * lead with - but a genuine software posting that states nothing disqualifying.
 *
 * It exists to prove what must NOT happen: a poor fit costs score, and score
 * costs nothing. Neither filter may touch it.
 *
 * It used to be a "Senior Software Architect" demanding 10 years. That is no
 * longer usable here, because Filter B now excludes exactly that posting by
 * design - see SENIOR_JOB below, which took over that role.
 */
const BAD_JOB = makeJob({
  sourceId: 'alpha',
  externalId: 'b1',
  title: 'Software Engineer',
  company: 'Globex',
  location: 'Madrid',
  description: 'Java y Spring. Fluent English required.',
  postedAt: daysAgo(25),
});

/** Explicitly disqualifying on both counts Filter B knows about. */
const SENIOR_JOB = makeJob({
  sourceId: 'alpha',
  externalId: 's1',
  title: 'Senior Software Architect',
  company: 'Initech',
  location: 'Madrid',
  description: 'Se requieren 10 anos de experiencia con Java y Spring.',
  postedAt: daysAgo(3),
});

/** No technical signal of any kind: the shape the relevance gate exists for. */
const NON_SOFTWARE_JOB = makeJob({
  sourceId: 'alpha',
  externalId: 'n1',
  title: 'Se Necesitan Odontólogos',
  company: 'Dentego',
  location: 'Madrid',
  description: 'Clinica dental en Madrid. Buscamos odontologo junior, primer empleo.',
  postedAt: daysAgo(0),
});

const deps = {
  scoringConfig: DEFAULT_SCORING_CONFIG,
  juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
  logger: silentLogger,
  now: () => REFERENCE_NOW,
};

describe('buildJobQueue', () => {
  it('fetches, dedupes, scores, filters and orders by recency', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [BAD_JOB, GOOD_JOB])] },
    );

    // GOOD_JOB is 1 day old, BAD_JOB is 25. Newest first.
    expect(queue.jobs.map((entry) => entry.company)).toEqual(['ACME', 'Globex']);
    expect(queue.jobs[0]?.rank).toBe(1);
    expect(queue.jobs[1]?.rank).toBe(2);
  });

  it('keeps every job: nothing is filtered out by stack', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [BAD_JOB, GOOD_JOB])] },
    );
    expect(queue.totalUnique).toBe(2);
  });

  it('dedupes the same vacancy returned by two queries', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY, { ...QUERY, what: 'react' }] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB])] },
    );

    expect(queue.totalFetched).toBe(2);
    expect(queue.totalUnique).toBe(1);
    expect(queue.duplicatesRemoved).toBe(1);
  });

  it('survives a failing source and still returns the healthy one', async () => {
    const logger = createRecordingLogger();
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        logger,
        sources: [failingSource('broken', 'a search provider returned 401'), stubSource('alpha', [GOOD_JOB])],
      },
    );

    expect(queue.jobs).toHaveLength(1);
    expect(queue.sourceReports.find((report) => report.sourceId === 'broken')?.status).toBe('failed');
    expect(queue.sourceReports.find((report) => report.sourceId === 'alpha')?.status).toBe('ok');
    expect(logger.messages.some((entry) => entry.message.includes('401'))).toBe(true);
  });

  it('returns an empty queue when every source fails', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [failingSource('a', 'boom'), failingSource('b', 'boom')] },
    );

    expect(queue.jobs).toEqual([]);
    expect(queue.sourceReports.every((report) => report.status === 'failed')).toBe(true);
  });

  it('applies the optional result limit without losing the count of unique jobs', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY], limit: 1 },
      { ...deps, sources: [stubSource('alpha', [BAD_JOB, GOOD_JOB])] },
    );

    expect(queue.jobs).toHaveLength(1);
    expect(queue.totalUnique).toBe(2);
    // Both survived the filters; the limit is the only thing hiding one.
    expect(queue.totalJuniorEligible).toBe(2);
  });

  it('surfaces everything when no limit is given', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [BAD_JOB, GOOD_JOB])] },
    );

    expect(queue.jobs).toHaveLength(2);
  });

  it('emits a serializable queue with a score breakdown per job', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB])] },
    );
    const entry = queue.jobs[0];

    expect(queue.generatedAt).toBe(REFERENCE_NOW.toISOString());
    expect(entry?.postedAt).toBe(GOOD_JOB.postedAt.toISOString());
    expect(entry?.cvVariant).toBe('frontend');
    expect(entry?.breakdown).toHaveLength(5);
    expect(() => JSON.stringify(queue)).not.toThrow();
  });

  it('carries structured requirement signals for the UI chips', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB])] },
    );
    const requirements = queue.jobs[0]?.requirements;

    expect(requirements?.matchedStack).toContain('react');
    expect(requirements?.englishRequired).toBe('basic');
    expect(requirements?.senioritySignals.some((signal) => signal.level === 'junior')).toBe(true);
  });

  it('adds a CV category suggestion built only from title and description', async () => {
    const neutral = makeJob({
      sourceId: 'alpha',
      externalId: 'neutral',
      title: 'Desarrollador Junior',
      company: 'Java Python Labs',
      location: 'React City, Madrid',
      description: 'Equipo agil en Madrid. Sin experiencia previa.',
      postedAt: daysAgo(2),
    });
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB, neutral])] },
    );
    const byCompany = (company: string) => queue.jobs.find((entry) => entry.company === company);

    expect(byCompany('ACME')?.cvCategorySuggestion).toEqual(
      suggestCvCategory({ title: GOOD_JOB.title, description: GOOD_JOB.description }),
    );
    expect(byCompany('ACME')?.cvCategorySuggestion?.category).toBe('frontend');
    expect(byCompany('Globex')?.cvCategorySuggestion?.category).toBe('java_spring_backend');
    // Company and location carry category words and must not count.
    expect(byCompany('Java Python Labs')?.cvCategorySuggestion).toEqual({
      category: 'general',
      matchedTerms: [],
      reason: 'no_evidence',
    });
    expect(() => JSON.stringify(queue)).not.toThrow();
  });

  it('leaves requirements, cvVariant and the rest of the entry exactly as before', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB])] },
    );

    for (const job of [GOOD_JOB, BAD_JOB]) {
      const entry = queue.jobs.find((candidate) => candidate.id === job.id);
      expect(entry?.requirements).toEqual(extractRequirements(job, DEFAULT_SCORING_CONFIG));
      expect(entry?.cvVariant).toBe(entry?.requirements.cvVariant);
    }
    expect(queue.jobs.find((entry) => entry.id === GOOD_JOB.id)?.cvVariant).toBe('frontend');
    expect(Object.keys(queue.jobs[0] ?? {}).sort()).toEqual(
      [
        'applicationStatus',
        'appliedAt',
        'breakdown',
        'company',
        'contractType',
        'cvCategorySuggestion',
        'cvVariant',
        'id',
        'liveness',
        'location',
        'notes',
        'outcomeUpdatedAt',
        'postedAt',
        'rank',
        'requirements',
        'salaryMax',
        'salaryMin',
        'score',
        'sources',
        'title',
        'url',
      ].sort(),
    );
  });

  it('marks every job as not applied when no application log is supplied', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB])] },
    );

    expect(queue.jobs.every((entry) => entry.applicationStatus === 'not_applied')).toBe(true);
    expect(queue.jobs.every((entry) => entry.appliedAt === null)).toBe(true);
  });

  it('marks an already-applied job instead of dropping it from the queue', async () => {
    const application = createApplication({
      jobId: GOOD_JOB.id,
      appliedAt: daysAgo(2),
      cvVariant: 'frontend',
      scoreAtApply: 90,
    });

    const queue = await buildJobQueue(
      { queries: [QUERY] },
      {
        ...deps,
        sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB])],
        applications: [withOutcome(application, 'interview', daysAgo(1))],
      },
    );

    const applied = queue.jobs.find((entry) => entry.id === GOOD_JOB.id);
    expect(queue.jobs).toHaveLength(2);
    expect(applied?.applicationStatus).toBe('interview');
    expect(applied?.appliedAt).toBe(daysAgo(2).toISOString());
  });

  it('produces a byte-stable list for the same input', async () => {
    const jobs = Array.from({ length: 40 }, (_, index) =>
      makeJob({ title: `Developer ${index}`, description: `React ${index}` }),
    );
    const run = () =>
      buildJobQueue({ queries: [QUERY] }, { ...deps, sources: [stubSource('alpha', jobs)] });

    const [first, second] = await Promise.all([run(), run()]);
    expect(second.jobs.map((entry) => entry.id)).toEqual(first.jobs.map((entry) => entry.id));
  });

  it('drops a non-software posting from the ranked queue', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, NON_SOFTWARE_JOB])] },
    );

    expect(queue.jobs.map((entry) => entry.id)).toEqual([GOOD_JOB.id]);
    expect(queue.totalUnique).toBe(2);
    expect(queue.totalRelevant).toBe(1);
  });

  it('never drops a posting silently: the excluded set is reported in full', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, NON_SOFTWARE_JOB])] },
    );

    expect(queue.excluded).toHaveLength(1);
    const excluded = queue.excluded[0];
    expect(excluded?.id).toBe(NON_SOFTWARE_JOB.id);
    expect(excluded?.title).toBe('Se Necesitan Odontólogos');
    expect(excluded?.url).toBe(NON_SOFTWARE_JOB.url);
    expect(excluded?.reason.length).toBeGreaterThan(0);
    expect(excluded?.scoreBeforeGate).toBeGreaterThan(0);
  });

  it('logs the exclusion count so a headless run still says what it dropped', async () => {
    const logger = createRecordingLogger();
    await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, logger, sources: [stubSource('alpha', [GOOD_JOB, NON_SOFTWARE_JOB])] },
    );

    expect(
      logger.messages.some((entry) => /1 .*not software/i.test(entry.message)),
    ).toBe(true);
  });

  it('excludes by domain relevance, never by stack preference', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB, NON_SOFTWARE_JOB])] },
    );

    // BAD_JOB is a bad FIT (C1, off-lane stack) but a real software
    // job that says nothing disqualifying. Neither filter may touch it.
    expect(queue.jobs.map((entry) => entry.id)).toContain(BAD_JOB.id);
    expect(queue.excluded.map((entry) => entry.id)).toEqual([NON_SOFTWARE_JOB.id]);
  });

  it('excludes an explicitly senior posting, and says which filter did it', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, SENIOR_JOB])] },
    );

    expect(queue.jobs.map((entry) => entry.id)).toEqual([GOOD_JOB.id]);
    expect(queue.excluded.map((entry) => entry.excludedBy)).toEqual(['seniority_excluded']);
    expect(queue.totalRelevant).toBe(2);
    expect(queue.totalJuniorEligible).toBe(1);
  });

  it('excludes an out-of-area posting with a location code, whatever the source', async () => {
    const barcelona = makeJob({
      sourceId: 'beta',
      externalId: 'bcn',
      title: 'Desarrollador Junior',
      company: 'Soho',
      location: 'Barcelona',
      description: 'React y TypeScript. Presencial.',
    });
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB]), stubSource('beta', [barcelona])] },
    );

    expect(queue.jobs.map((entry) => entry.id)).toEqual([GOOD_JOB.id]);
    expect(queue.excluded.map((entry) => [entry.id, entry.excludedBy])).toEqual([
      [barcelona.id, 'location_incompatible'],
    ]);
    expect(queue.excluded[0]?.reason).toMatch(/barcelona/);
  });

  it('excludes an over-limit experience posting with its own code and keeps unstated years', async () => {
    const experienced = makeJob({
      sourceId: 'alpha',
      externalId: 'exp',
      title: 'Desarrollador Backend',
      company: 'Wayne',
      location: 'Madrid',
      description: 'Java y Spring. Se requieren 4 anos de experiencia.',
    });
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, experienced])] },
    );

    expect(queue.jobs.map((entry) => entry.id)).toEqual([GOOD_JOB.id]);
    expect(queue.excluded.map((entry) => entry.excludedBy)).toEqual(['experience_over_limit']);
  });

  it('counts an excluded posting in totalUnique but not in the surfaced limit', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY], limit: 10 },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, NON_SOFTWARE_JOB])] },
    );

    expect(queue.totalFetched).toBe(2);
    expect(queue.totalUnique).toBe(2);
    expect(queue.jobs).toHaveLength(1);
  });

  it('reports what each source returned per query', async () => {
    const queue = await buildJobQueue(
      { queries: [QUERY] },
      { ...deps, sources: [stubSource('alpha', [GOOD_JOB, BAD_JOB])] },
    );
    const report = queue.sourceReports[0];
    expect(report?.sourceId).toBe('alpha');
    expect(report?.query).toBe(QUERY.what);
    expect(report?.fetched).toBe(2);
  });
});
