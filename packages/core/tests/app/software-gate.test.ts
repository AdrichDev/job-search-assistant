import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { scoreJob } from '../../src/domain/scoring/score-job.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import type { JobSource, JobSourceQuery } from '../../src/ports/job-source.js';
import {
  REAL_AGGREGATOR_RUN,
  REAL_RUN_NOW,
  realPostingByTitle,
  scoringProbeJob,
  scoringProbeJobs,
} from '../fixtures/real-market-run.js';
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * Regression suite for FILTER A: 11 of the 25 postings a live generic aggregator run
 * returned were not software jobs, and a dentist scored 56.8/100.
 *
 * Scope note, because the product gained a second filter after this suite was
 * written: everything here is about SOFTWARE RELEVANCE only. A posting "kept"
 * by this suite means the gate judged it engineering work - not that it reaches
 * the candidate's list, which Filter B (junior eligibility) also gets a say in.
 * Two of these real postings are genuine software jobs AND explicitly senior;
 * conflating the two filters here would make this suite fail for a reason that
 * has nothing to do with the defect it guards.
 *
 * The fixture's URLs were lost, so these jobs carry a `.invalid` scoring probe
 * URL and are never written anywhere a human reads. See the fixture header.
 */

const QUERY: JobSourceQuery = {
  what: 'junior developer',
  where: 'Madrid',
  maxDaysOld: 30,
  resultsPerPage: 50,
  maxPages: 1,
};

async function runRealQueue() {
  const jobs = scoringProbeJobs();
  const source: JobSource = { id: 'aggregator', fetchJobs: async () => jobs };
  return buildJobQueue(
    { queries: [QUERY] },
    {
      sources: [source],
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: silentLogger,
      now: () => REAL_RUN_NOW,
    },
  );
}

function scoreOf(fragment: string) {
  return scoreJob(
    scoringProbeJob(realPostingByTitle(fragment)),
    DEFAULT_SCORING_CONFIG,
    REAL_RUN_NOW,
  );
}

/** Titles Filter A removed. Filter B's exclusions are a different question. */
async function gateExclusions(): Promise<readonly string[]> {
  const queue = await runRealQueue();
  return queue.excluded
    .filter((entry) => entry.excludedBy === 'software_relevance')
    .map((entry) => entry.title);
}

describe('the dentist regression', () => {
  it('scores "Se Necesitan Odontólogos" at zero instead of 56.8', () => {
    const { score } = scoreOf('Odontólogos');
    expect(score.softwareRelevance.isSoftware).toBe(false);
    expect(score.total).toBe(0);
  });

  it('never lets the dentist reach the queue', async () => {
    const queue = await runRealQueue();
    expect(queue.jobs.map((entry) => entry.title)).not.toContain('Se Necesitan Odontólogos');
    expect(await gateExclusions()).toContain('Se Necesitan Odontólogos');
  });
});

describe('every non-software posting from the real run', () => {
  const nonSoftware = REAL_AGGREGATOR_RUN.filter((posting) => !posting.software);

  it.each(nonSoftware.map((posting) => [posting.title] as const))(
    'excludes %s',
    async (title) => {
      const queue = await runRealQueue();
      expect(queue.jobs.map((entry) => entry.title)).not.toContain(title);
      expect(await gateExclusions()).toContain(title);
    },
  );
});

describe('every genuine software posting from the real run', () => {
  const software = REAL_AGGREGATOR_RUN.filter((posting) => posting.software);

  /*
   * "Passes the gate", not "reaches the list".
   *
   * Two of these - "Senior Full Stack Engineer (AI & GenAI)" and "Senior
   * Software Engineer" - are real software jobs that Filter B then removes for
   * being explicitly senior. That is Filter B working as specified, and
   * asserting on the final list here would report it as a Filter A regression.
   */
  it.each(software.map((posting) => [posting.title] as const))(
    'passes the software gate: %s',
    async (title) => {
      expect(await gateExclusions()).not.toContain(title);
    },
  );
});

describe('weak stack match is not the same as irrelevant', () => {
  it('keeps "Senior Software Engineer", which matched zero stack keywords', () => {
    const { score } = scoreOf('Senior Software Engineer');
    expect(score.breakdown.find((item) => item.dimension === 'stackMatch')?.value).toBe(0);
    expect(score.softwareRelevance.isSoftware).toBe(true);
    expect(score.total).toBeGreaterThan(0);
  });

  it('keeps "Qa Tester", whose only technical token was "automatizacion"', () => {
    expect(scoreOf('Qa Tester').score.softwareRelevance.isSoftware).toBe(true);
  });

  it('keeps "Desarrollador Full Stack", a bare title with almost no body', () => {
    expect(scoreOf('Desarrollador Full Stack').score.softwareRelevance.isSoftware).toBe(true);
  });
});

describe('exclusion is never silent', () => {
  it('reports how many postings the gate removed and why', async () => {
    const queue = await runRealQueue();
    const expected = REAL_AGGREGATOR_RUN.filter((posting) => !posting.software).length;
    const byGate = queue.excluded.filter((entry) => entry.excludedBy === 'software_relevance');

    expect(byGate).toHaveLength(expected);
    expect(queue.totalRelevant).toBe(REAL_AGGREGATOR_RUN.length - expected);
    for (const entry of byGate) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.url.length).toBeGreaterThan(0);
      expect(entry.scoreBeforeGate).toBeGreaterThan(0);
    }
  });

  it('separates the two filters in the audit trail', async () => {
    const queue = await runRealQueue();
    const byJunior = queue.excluded.filter(
      (entry) =>
        entry.excludedBy === 'seniority_excluded' || entry.excludedBy === 'experience_over_limit',
    );

    expect(byJunior.map((entry) => entry.title)).toEqual(
      expect.arrayContaining([
        'Senior Full Stack Engineer (AI & GenAI) | Python, React, AWS',
        'Senior Software Engineer',
      ]),
    );
    // A junior exclusion is a posting that PASSED the software gate.
    for (const entry of byJunior) {
      expect(entry.softwareRelevance).toBeGreaterThanOrEqual(
        DEFAULT_SCORING_CONFIG.softwareRelevance.gateThreshold,
      );
    }
  });

  it('keeps the excluded set inspectable, not just counted', async () => {
    const queue = await runRealQueue();
    const treasury = queue.excluded.find((entry) => entry.title === 'Treasury Administrator');
    expect(treasury).toBeDefined();
    expect(treasury?.softwareRelevance).toBeLessThan(
      DEFAULT_SCORING_CONFIG.softwareRelevance.gateThreshold,
    );
  });
});
