import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { Job } from '../../src/domain/job.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import { REFERENCE_NOW, daysAgo, makeJob } from '../helpers/make-job.js';
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * THE PRODUCT MODEL, as the candidate stated it:
 *
 *   "forget the ratings. I want the offers, I'll decide myself if they interest
 *    me. Don't filter by number - but they must be tech offers and for juniors."
 *
 * Two hard filters, no score-based exclusion, newest first. The score survives
 * because the outcome analysis will need it later; it just stopped being the
 * product.
 *
 * These tests are the contract for that sentence. If a future change reinstates
 * score-ordering or score-thresholding, this file is what should go red.
 */

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
  now: () => REFERENCE_NOW,
};

function stubSource(jobs: readonly Job[]): JobSource {
  return { id: 'alpha', fetchJobs: async () => jobs };
}

async function run(jobs: readonly Job[], limit?: number) {
  return buildJobQueue(
    { queries: [QUERY], ...(limit === undefined ? {} : { limit }) },
    { ...deps, sources: [stubSource(jobs)] },
  );
}

/* Filter A material -------------------------------------------------- */

const DENTIST = makeJob({
  title: 'Se Necesitan Odontólogos',
  company: 'Dentego',
  description: 'Clinica dental en Madrid. Buscamos odontologo junior, primer empleo.',
  postedAt: daysAgo(0),
});

const ACCOUNTING = makeJob({
  title: 'Administrativo/A Contabilidad',
  company: 'Mutual Médica',
  description: 'Contabilidad, facturacion y tesoreria. Excel avanzado.',
  postedAt: daysAgo(0),
});

const HR = makeJob({
  title: 'Junior HR para multinacional',
  company: 'Temps',
  description: 'Recursos humanos, seleccion de personal y nominas.',
  postedAt: daysAgo(0),
});

/* Filter B material -------------------------------------------------- */

const SENIOR_TECH = makeJob({
  title: 'Senior Frontend Engineer',
  company: 'Globex',
  description: 'React y TypeScript.',
  postedAt: daysAgo(0),
});

const JUNIOR_TECH = makeJob({
  title: 'Desarrollador Junior',
  company: 'ACME',
  description: 'React y TypeScript.',
  postedAt: daysAgo(2),
});

const UNSTATED_TECH = makeJob({
  title: 'Desarrollador Full Stack',
  company: 'Initech',
  description: 'Node.js y PostgreSQL.',
  postedAt: daysAgo(1),
});

const THREE_YEARS_TECH = makeJob({
  title: 'Desarrollador Backend',
  company: 'Umbrella',
  description: 'Java y Spring. Se requieren 3 años de experiencia.',
  postedAt: daysAgo(0),
});

const ONE_YEAR_TECH = makeJob({
  title: 'Desarrollador Web',
  company: 'Hooli',
  description: 'PHP y MySQL. Se valora 1 año de experiencia.',
  postedAt: daysAgo(3),
});

describe('Filter A - tech only', () => {
  it('keeps software postings and drops the known non-software regressions', async () => {
    const queue = await run([JUNIOR_TECH, DENTIST, ACCOUNTING, HR]);

    expect(queue.jobs.map((entry) => entry.company)).toEqual(['ACME']);
    expect(queue.excluded.map((entry) => entry.title)).toEqual(
      expect.arrayContaining([DENTIST.title, ACCOUNTING.title, HR.title]),
    );
  });

  it('records the filter that removed each posting', async () => {
    const queue = await run([JUNIOR_TECH, DENTIST]);
    const dentist = queue.excluded.find((entry) => entry.id === DENTIST.id);

    expect(dentist?.excludedBy).toBe('software_relevance');
    expect(dentist?.reason.length).toBeGreaterThan(0);
  });
});

describe('Filter B - junior eligible, biased toward inclusion', () => {
  it('drops an explicitly senior tech posting', async () => {
    const queue = await run([JUNIOR_TECH, SENIOR_TECH]);
    expect(queue.jobs.map((entry) => entry.id)).not.toContain(SENIOR_TECH.id);
  });

  it('keeps a posting whose seniority is never stated', async () => {
    const queue = await run([UNSTATED_TECH]);
    expect(queue.jobs.map((entry) => entry.company)).toEqual(['Initech']);
  });

  it('drops a posting demanding 3 years and keeps one asking for 1', async () => {
    const queue = await run([THREE_YEARS_TECH, ONE_YEAR_TECH]);

    expect(queue.jobs.map((entry) => entry.company)).toEqual(['Hooli']);
    expect(queue.excluded.map((entry) => entry.id)).toContain(THREE_YEARS_TECH.id);
  });

  it('reports a junior exclusion separately from a relevance exclusion', async () => {
    const queue = await run([SENIOR_TECH, DENTIST]);

    const senior = queue.excluded.find((entry) => entry.id === SENIOR_TECH.id);
    const dentist = queue.excluded.find((entry) => entry.id === DENTIST.id);

    expect(senior?.excludedBy).toBe('seniority_excluded');
    expect(dentist?.excludedBy).toBe('software_relevance');
  });

  it('counts what survived each stage', async () => {
    const queue = await run([JUNIOR_TECH, UNSTATED_TECH, SENIOR_TECH, DENTIST]);

    expect(queue.totalUnique).toBe(4);
    expect(queue.totalRelevant).toBe(3);
    expect(queue.totalJuniorEligible).toBe(2);
    expect(queue.jobs).toHaveLength(2);
  });
});

describe('no score-based exclusion or limiting', () => {
  it('surfaces every posting that passed both filters', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      makeJob({
        title: `Desarrollador Web ${index}`,
        company: `Co${index}`,
        description: 'JavaScript y CSS.',
        postedAt: daysAgo(index % 20),
      }),
    );

    const queue = await run(many);

    expect(queue.jobs).toHaveLength(60);
    expect(queue.jobs).toHaveLength(queue.totalJuniorEligible);
  });

  it('keeps a low-scoring posting that both filters accepted', async () => {
    // Bad fit for this candidate: advanced English, foreign language ad. All of that costs SCORE, and none of it may cost a slot.
    const poorFit = makeJob({
      title: 'Software Engineer',
      company: 'Faraway',
      location: 'Madrid',
      description: 'Fluent English required. We are looking for you to join our team with Java.',
      postedAt: daysAgo(1),
    });

    const queue = await run([JUNIOR_TECH, poorFit]);
    const surfaced = queue.jobs.find((entry) => entry.id === poorFit.id);

    expect(surfaced).toBeDefined();
    expect(surfaced?.score).toBeLessThan(
      queue.jobs.find((entry) => entry.id === JUNIOR_TECH.id)?.score ?? 0,
    );
  });

  it('truncates only when a limit is explicitly asked for', async () => {
    const jobs = [JUNIOR_TECH, UNSTATED_TECH, ONE_YEAR_TECH];

    expect((await run(jobs)).jobs).toHaveLength(3);
    expect((await run(jobs, 2)).jobs).toHaveLength(2);
  });

  it('keeps totalJuniorEligible honest when a limit truncates the list', async () => {
    const queue = await run([JUNIOR_TECH, UNSTATED_TECH, ONE_YEAR_TECH], 1);

    expect(queue.jobs).toHaveLength(1);
    expect(queue.totalJuniorEligible).toBe(3);
  });
});

describe('ordering is recency, not merit', () => {
  it('lists the newest posting first', async () => {
    const queue = await run([ONE_YEAR_TECH, JUNIOR_TECH, UNSTATED_TECH]);

    expect(queue.jobs.map((entry) => entry.company)).toEqual(['Initech', 'ACME', 'Hooli']);
  });

  it('numbers positions in the order shown', async () => {
    const queue = await run([ONE_YEAR_TECH, JUNIOR_TECH, UNSTATED_TECH]);
    expect(queue.jobs.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  it('does not order by score', async () => {
    const queue = await run([ONE_YEAR_TECH, JUNIOR_TECH, UNSTATED_TECH]);
    const scores = queue.jobs.map((entry) => entry.score);
    const descending = [...scores].sort((a, b) => b - a);

    expect(scores).not.toEqual(descending);
  });
});

describe('the score survives as inspectable detail', () => {
  it('still computes and persists a score and its full breakdown', async () => {
    const queue = await run([JUNIOR_TECH]);
    const entry = queue.jobs[0];

    expect(entry?.score).toBeGreaterThan(0);
    expect(entry?.breakdown).toHaveLength(5);
  });
});
