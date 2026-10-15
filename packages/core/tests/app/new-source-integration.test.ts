import { describe, expect, it } from 'vitest';
import { buildJobQueue } from '../../src/app/build-job-queue.js';
import { renderRunSummary } from '../../src/cli/render-table.js';
import { REAL_SOURCE_IDS, parseSourceSelection } from '../../src/cli/source-selection.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../src/config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../src/config/scoring-config.js';
import { DEFAULT_SEARCH_PLAN } from '../../src/config/search-plan.js';
import { createJob, type Job } from '../../src/domain/job.js';
import type { JobSource } from '../../src/ports/job-source.js';
import type { JobQueue } from '../../src/ports/queue-writer.js';
import { silentLogger } from '../helpers/silent-logger.js';

/**
 * The four new sources, seen from the app layer rather than one adapter at a
 * time.
 *
 * Two questions are asked here that a per-adapter contract test structurally
 * cannot answer:
 *
 *   1. Does one dead API sink a run that now has nine sources in it?
 *   2. Now that the SAME vacancy can arrive from Manfred, a SmartRecruiters
 *      board and the newsletter with three different spellings, does the
 *      conservative identity logic still behave the way it was designed to?
 *
 * The second one matters more than it looks. Adding sources makes overlap
 * likelier, and the rule this codebase committed to is asymmetric: a false
 * merge DELETES a real vacancy and leaves no trace, a missed duplicate costs
 * ten seconds of scrolling. So the assertions below deliberately pin the
 * MISSES as well as the merges - the misses are the safe half of the trade and
 * somebody "fixing" them with a similarity threshold would be a regression.
 */

const NOW = new Date('2026-09-10T09:00:00.000Z');

interface Posting {
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly url: string;
  readonly externalId?: string;
}

function sourceOf(id: string, postings: readonly Posting[]): JobSource {
  return {
    id,
    queryMode: 'per-run',
    sweepLabel: `(all ${id})`,
    async fetchJobs(): Promise<readonly Job[]> {
      return postings.map((posting, index) =>
        createJob({
          sourceId: id,
          externalId: posting.externalId ?? `${id}-${index}`,
          title: posting.title,
          company: posting.company,
          location: posting.location,
          description:
            'Desarrollo de software con JavaScript, TypeScript y React. Se valora perfil junior.',
          url: posting.url,
          postedAt: NOW,
        }),
      );
    },
  };
}

function deadSource(id: string, message: string): JobSource {
  return {
    id,
    queryMode: 'per-run',
    sweepLabel: `(all ${id})`,
    async fetchJobs(): Promise<readonly Job[]> {
      throw new Error(message);
    },
  };
}

async function run(sources: readonly JobSource[]): Promise<JobQueue> {
  return buildJobQueue(
    { queries: DEFAULT_SEARCH_PLAN, candidateName: 'Alex Example' },
    {
      sources,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: silentLogger,
      now: () => NOW,
    },
  );
}

describe('per-source isolation with the full nine-source selection', () => {
  it('lists every new source in --source=all, and never the fixture', () => {
    const selected = parseSourceSelection('all');

    expect(selected).toContain('manfred');
    expect(selected).toContain('smartrecruiters');
    expect(selected).toContain('landingjobs');
    expect(selected).toContain('arbeitnow');
    expect(selected).not.toContain('fixture');
    expect(selected).toEqual([...REAL_SOURCE_IDS]);
  });

  it('keeps every healthy source when the new ones fail in different ways', async () => {
    const queue = await run([
      // Manfred's own failure mode: the sitemap that carries its addresses is
      // unreachable, so it refuses to produce anything rather than guess.
      deadSource('manfred', "manfred's offer sitemap could not be read (HTTP 503)"),
      deadSource('landingjobs', 'request timed out after 15000ms'),
      deadSource('arbeitnow', 'HTTP 429'),
      sourceOf('smartrecruiters', [
        {
          title: 'Big Data Administrator',
          company: 'Devoteam',
          location: 'Madrid',
          url: 'https://jobs.smartrecruiters.com/Devoteam/744000148470573-big-data-administrator',
        },
      ]),
      sourceOf('greenhouse', [
        {
          title: 'Junior Frontend Developer',
          company: 'Cabify',
          location: 'Madrid',
          url: 'https://job-boards.greenhouse.io/cabify/jobs/8642423002',
        },
      ]),
    ]);

    // Three sources down, and the run still delivers what the other two found.
    expect(queue.jobs).toHaveLength(2);

    const failed = queue.sourceReports.filter((report) => report.status === 'failed');
    expect(failed.map((report) => report.sourceId).sort()).toEqual([
      'arbeitnow',
      'landingjobs',
      'manfred',
    ]);
    // Each failure keeps its own message; they are not collapsed into one.
    expect(failed.find((report) => report.sourceId === 'manfred')?.error).toContain('sitemap');
    expect(failed.find((report) => report.sourceId === 'arbeitnow')?.error).toContain('429');
  });

  it('reports what each new source contributed on the Contributed line', async () => {
    const queue = await run([
      sourceOf('manfred', [
        {
          title: 'Full-stack Engineer',
          company: 'Telness Tech',
          location: 'Madrid, España',
          url: 'https://www.getmanfred.com/ofertas-empleo/8311/telnesstech-full-stack-engineer-mar26',
        },
      ]),
      sourceOf('smartrecruiters', [
        {
          title: 'Big Data Administrator',
          company: 'Devoteam',
          location: 'Madrid',
          url: 'https://jobs.smartrecruiters.com/Devoteam/744000148470573-big-data-administrator',
        },
      ]),
      sourceOf('landingjobs', [
        {
          title: 'Data Platform Engineer',
          company: 'Damia Group Portugal',
          location: 'PT',
          url: 'https://landing.jobs/at/damia-group-portugal/data-platform-engineer-in',
        },
      ]),
      deadSource('arbeitnow', 'HTTP 500'),
    ]);

    const summary = renderRunSummary(queue);

    expect(summary).toContain('Contributed:');
    expect(summary).toContain('manfred 1');
    expect(summary).toContain('smartrecruiters 1');
    expect(summary).toContain('landingjobs 1');
    // A failure is named as a failure, never printed as a silent zero.
    expect(summary).toContain('arbeitnow 0 (failed)');
  });
});

describe('cross-source identity now that the sources genuinely overlap', () => {
  it('MERGES the same vacancy when both sources agree on employer and title', async () => {
    // The case the cross-source key was built for: one company, one role, two
    // boards, two different URLs and two different external ids.
    const queue = await run([
      sourceOf('manfred', [
        {
          title: 'Full-stack Engineer',
          company: 'Telness Tech',
          location: 'Madrid, España',
          url: 'https://www.getmanfred.com/ofertas-empleo/8311/telnesstech-full-stack-engineer-mar26',
        },
      ]),
      sourceOf('smartrecruiters', [
        {
          title: 'Full-stack Engineer (m/f/d) - Madrid',
          company: 'Telness Tech S.L.',
          location: 'Madrid',
          url: 'https://jobs.smartrecruiters.com/TelnessTech/744000148470999-full-stack-engineer',
        },
      ]),
    ]);

    expect(queue.jobs).toHaveLength(1);
    expect(queue.duplicatesRemoved).toBe(1);
    // The survivor keeps BOTH provenance refs, so the audit trail still shows
    // every place the vacancy was seen.
    expect(queue.jobs[0]?.sources.map((ref) => ref.sourceId).sort()).toEqual([
      'manfred',
      'smartrecruiters',
    ]);
  });

  it('REFUSES to merge two different seniorities at the same employer', async () => {
    // The false merge worth being paranoid about. `Senior` and `Junior` differ
    // by one word, and any similarity threshold that collapses board decoration
    // also collapses this - which would delete the only role he can apply for.
    const queue = await run([
      sourceOf('manfred', [
        {
          title: 'Senior Software Engineer',
          company: 'Joko',
          location: 'Barcelona, España',
          url: 'https://www.getmanfred.com/ofertas-empleo/8379/joko-senior-software-engineer-jun26',
        },
      ]),
      sourceOf('smartrecruiters', [
        {
          title: 'Junior Software Engineer',
          company: 'Joko',
          location: 'Barcelona',
          url: 'https://jobs.smartrecruiters.com/Joko/744000148470111-junior-software-engineer',
        },
      ]),
    ]);

    /*
     * Asserted on the DEDUPE counters, not on `jobs`: the junior gate removes
     * the Senior role a moment later, so a `jobs.length` assertion here would
     * pass for the wrong reason and keep passing if dedupe started merging.
     */
    expect(queue.totalUnique).toBe(2);
    expect(queue.duplicatesRemoved).toBe(0);
    // And the one he can actually apply for is the one that survives.
    expect(queue.jobs.map((job) => job.title)).toEqual(['Junior Software Engineer']);
  });

  it('MISSES a duplicate when the employers are spelled differently, and that is the safe half of the trade', async () => {
    /*
     * Manfred publishes the HIRING BRAND, which is routinely not the legal
     * entity a company board publishes: offer 8457's employer is `CENTRALIA`
     * while its `web` field points at grupogof.com.
     *
     * No anchor lines up, so nothing merges, so the candidate sees the vacancy
     * twice. That is the outcome this codebase chose on purpose. The
     * alternative - matching on title and city alone - merges two unrelated
     * anonymous "Junior Developer, Madrid" postings and deletes one of them,
     * with nothing anywhere saying it existed.
     */
    const queue = await run([
      sourceOf('manfred', [
        {
          title: '.NET Developer',
          company: 'CENTRALIA',
          location: 'Santander, España',
          url: 'https://www.getmanfred.com/ofertas-empleo/8457/grupo-gof-net-developer-ago26',
        },
      ]),
      sourceOf('arbeitnow', [
        {
          title: '.NET Developer',
          company: 'Grupo GOF',
          location: 'Santander, Spain',
          url: 'https://www.arbeitnow.com/jobs/companies/grupo-gof/net-developer-santander-11111',
        },
      ]),
    ]);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.duplicatesRemoved).toBe(0);
  });

  it('REFUSES to merge two anonymous postings even when everything else matches', async () => {
    // Landing.jobs has no company field, so a URL that does not carry `/at/x/`
    // yields an empty employer. With no anchor, `crossSourceKey` returns null
    // and `dedupe` falls back to URL and source ref only.
    const queue = await run([
      sourceOf('landingjobs', [
        {
          title: 'Junior Developer',
          company: '',
          location: 'Madrid',
          url: 'https://landing.jobs/jobs/11111',
        },
      ]),
      sourceOf('arbeitnow', [
        {
          title: 'Junior Developer',
          company: '',
          location: 'Madrid',
          url: 'https://www.arbeitnow.com/jobs/companies/anon/junior-developer-madrid-22222',
        },
      ]),
    ]);

    expect(queue.jobs).toHaveLength(2);
    expect(queue.duplicatesRemoved).toBe(0);
  });

  it('still collapses the same posting reported twice by the same source', async () => {
    // Paging overlap, which every paginated source here can produce.
    const queue = await run([
      sourceOf('arbeitnow', [
        {
          title: 'DATEV Techniker',
          company: 'Jessyworks',
          location: 'Munich',
          url: 'https://www.arbeitnow.com/jobs/companies/jessyworks/datev-18836',
          externalId: 'datev-18836',
        },
        {
          title: 'DATEV Techniker',
          company: 'Jessyworks',
          location: 'Munich',
          url: 'https://www.arbeitnow.com/jobs/companies/jessyworks/datev-18836',
          externalId: 'datev-18836',
        },
      ]),
    ]);

    expect(queue.jobs).toHaveLength(1);
    expect(queue.duplicatesRemoved).toBe(1);
  });
});
