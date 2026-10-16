import { describe, expect, it } from 'vitest';
import {
  renderExcludedTable,
  renderLinkAudit,
  renderLivenessReport,
  renderRankedTable,
  renderRunSummary,
  renderSampleDataNotice,
  renderScoreExplanations,
} from '../../src/cli/render-table.js';
import type { ExcludedEntry, JobQueue, QueueEntry } from '../../src/ports/queue-writer.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

/** A posting that came from a real provider, not the sample catalogue. */
function realSources(sourceId = 'greenhouse'): QueueEntry['sources'] {
  return [
    {
      sourceId,
      externalId: '4471203',
      url: 'https://job-boards.greenhouse.io/acme/jobs/4471203',
    },
  ];
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    rank: 1,
    id: 'acme::junior dev::madrid',
    score: 87.6,
    cvVariant: 'frontend',
    // Fields added by the application-tracking layer. The renderer ignores most
    // of them; they are here because `QueueEntry` now requires them.
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: ['react'],
      cvVariant: 'frontend',
      englishRequired: 'not_stated',
      workMode: 'onsite',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: 'Desarrollador Junior Frontend',
    company: 'ACME Software',
    location: 'Madrid',
    url: 'https://example.test/1',
    postedAt: new Date(REFERENCE_NOW.getTime() - 3 * 86_400_000).toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [{ sourceId: 'fixture', externalId: 'fx-1', url: 'https://example.test/1' }],
    breakdown: [
      {
        dimension: 'seniorityFit',
        value: 0.8,
        weight: 0.34,
        contribution: 27.2,
        reason: 'junior signal in title (junior)',
      },
    ],
    // Not checked by default. Tests that care about the liveness marker
    // override it explicitly, so no row here carries a claim it did not make.
    liveness: null,
    ...overrides,
  };
}

function excluded(overrides: Partial<ExcludedEntry> = {}): ExcludedEntry {
  return {
    id: 'dentego::se necesitan odontologos::madrid',
    title: 'Se Necesitan Odontólogos',
    company: 'Dentego',
    location: 'Madrid',
    url: 'https://example.test/dentist',
    postedAt: REFERENCE_NOW.toISOString(),
    excludedBy: 'software_relevance',
    scoreBeforeGate: 56.8,
    softwareRelevance: 0,
    reason: 'no software-engineering signal; non-software domain: odontologo',
    ...overrides,
  };
}

function queue(overrides: Partial<JobQueue> = {}): JobQueue {
  return {
    generatedAt: REFERENCE_NOW.toISOString(),
    candidate: 'Alex Example',
    totalFetched: 10,
    totalUnique: 4,
    totalRelevant: 4,
    totalJuniorEligible: 4,
    duplicatesRemoved: 6,
    sourceReports: [{ sourceId: 'fixture', query: 'junior developer', status: 'ok', fetched: 10 }],
    jobs: [entry()],
    excluded: [],
    ...overrides,
  };
}

describe('renderRankedTable', () => {
  it('prints a header and one row per job', () => {
    const lines = renderRankedTable(queue()).split('\n');
    expect(lines[0]).toContain('SCORE');
    expect(lines[0]).toContain('CV');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('ACME Software');
    expect(lines[2]).toContain('87.6');
  });

  it('renders the posting age relative to the run timestamp', () => {
    expect(renderRankedTable(queue())).toContain('3d');
  });

  it('labels a same-day posting as today', () => {
    const fresh = queue({ jobs: [entry({ postedAt: REFERENCE_NOW.toISOString() })] });
    expect(renderRankedTable(fresh)).toContain('today');
  });

  it('truncates long titles instead of breaking the columns', () => {
    const long = queue({
      jobs: [entry({ title: 'A'.repeat(120) })],
    });
    const rows = renderRankedTable(long).split('\n');
    expect(rows[1]?.length).toBe(rows[2]?.length);
  });

  it('says so when there is nothing to show', () => {
    expect(renderRankedTable(queue({ jobs: [] }))).toContain('(no jobs found)');
  });
});

describe('renderScoreExplanations', () => {
  it('explains each requested entry with its dimensions and link', () => {
    const output = renderScoreExplanations(queue(), 1);
    expect(output).toContain('seniorityFit');
    expect(output).toContain('junior signal in title');
    expect(output).toContain('27.2');
    expect(output).toContain('https://example.test/1');
  });

  it('returns nothing when the queue is empty', () => {
    expect(renderScoreExplanations(queue({ jobs: [] }), 3)).toBe('');
  });
});

describe('renderRunSummary', () => {
  it('reports intake, dedupe and visibility counts', () => {
    const output = renderRunSummary(queue());
    expect(output).toContain('Alex Example');
    expect(output).toContain('Fetched 10 postings, 4 unique (6 duplicates collapsed)');
    expect(output).toContain('Showing 1 of 4');
  });

  it('flags a degraded run and names the failing source', () => {
    const degraded = queue({
      sourceReports: [
        { sourceId: 'aggregator', query: 'junior developer', status: 'failed', fetched: 0, error: 'HTTP 401' },
      ],
    });
    const output = renderRunSummary(degraded);
    expect(output).toContain('Degraded run');
    expect(output).toContain('aggregator');
    expect(output).toContain('HTTP 401');
  });

  it('stays quiet about failures when everything worked', () => {
    expect(renderRunSummary(queue())).not.toContain('Degraded run');
  });

  it('states how many postings each filter removed', () => {
    const gated = queue({ totalRelevant: 3, totalJuniorEligible: 3, excluded: [excluded()] });
    const summary = renderRunSummary(gated);

    // The two filters mean very different things to the reader, so the summary
    // has to say which one fired rather than reporting a single total.
    expect(summary).toContain('Filtered out 1 of 4');
    expect(summary).toContain('1 not software');
    expect(summary).toContain('0 not junior-eligible');
  });

  it('reports the full offer count next to the shown count', () => {
    expect(renderRunSummary(queue({ totalJuniorEligible: 9 }))).toContain(
      'Showing 1 of 9 offers, newest first',
    );
  });

  it('says nothing about exclusions when the gate removed nothing', () => {
    expect(renderRunSummary(queue())).not.toContain('excluded');
  });
});

/**
 * SAMPLE DATA HAS TO ANNOUNCE ITSELF.
 *
 * `--source=all` no longer admits the catalogue, but `--source=fixture` still
 * does, the web app still falls back to it, and an old `output/queue.json` may
 * still contain it. Wherever a sample posting reaches a human it says so - and
 * it says so twice, in a banner and on the row, because a banner alone scrolls
 * off the top of a terminal the moment the list is longer than a screen.
 */
describe('renderSampleDataNotice', () => {
  it('says nothing when every posting came from a real source', () => {
    expect(renderSampleDataNotice(queue({ jobs: [entry({ sources: realSources() })] }))).toBeNull();
  });

  it('announces a queue made entirely of sample postings', () => {
    const notice = renderSampleDataNotice(queue());

    expect(notice).not.toBeNull();
    expect(notice).toContain('SAMPLE DATA');
    // The count, so it is checkable against the list below it.
    expect(notice).toContain('1 of 1');
    // And what to do about it, or the warning is just an apology.
    expect(notice).toContain('--source=');
  });

  it('announces a queue where only SOME postings are sample data', () => {
    // Unreachable through `--source` now, reachable through a stale or edited
    // queue file. The mixed case is the dangerous one, so it is the loud one.
    const mixed = queue({
      jobs: [entry({ id: 'a' }), entry({ id: 'b', sources: realSources() })],
      totalJuniorEligible: 2,
    });

    expect(renderSampleDataNotice(mixed)).toContain('1 of 2');
  });

  it('says nothing for an empty queue', () => {
    expect(renderSampleDataNotice(queue({ jobs: [] }))).toBeNull();
  });
});

describe('sample rows are marked in the table itself', () => {
  it('marks a sample posting on its own row', () => {
    expect(renderRankedTable(queue())).toContain('[SAMPLE]');
  });

  it('leaves a real posting unmarked', () => {
    expect(renderRankedTable(queue({ jobs: [entry({ sources: realSources() })] }))).not.toContain(
      '[SAMPLE]',
    );
  });

  it('marks the sample entry in the score breakdown, where the link is printed', () => {
    // The user's report showed the dead link precisely here:
    //   #1 Trainee Software Developer ... link: https://example-board.test/...
    expect(renderScoreExplanations(queue(), 1)).toContain('[SAMPLE]');
  });
});

/**
 * THE SELF-CHECK.
 *
 * The pipeline audits its own output on every run, using the same provenance
 * rules the integration test and the browser suite use. This is the difference
 * between the user learning about a dead apply button from a test suite months
 * later and learning about it from the run that produced it.
 */
describe('renderLinkAudit', () => {
  it('says nothing when every link is a usable posting address', () => {
    expect(renderLinkAudit(queue({ jobs: [entry({ sources: realSources() })] }))).toBeNull();
  });

  it('names every unusable link, the rule it broke and the posting it belongs to', () => {
    const bad = queue({
      jobs: [
        entry({
          title: 'Trainee Software Developer',
          url: 'https://example-board.test/offers/fx-010',
        }),
      ],
    });

    const audit = renderLinkAudit(bad);

    expect(audit).toContain('1 of 1');
    expect(audit).toContain('example-board.test');
    expect(audit).toContain('placeholder-host');
    expect(audit).toContain('Trainee Software Developer');
  });

  it('catches the fabricated-URL defect that shipped, not just placeholder hosts', () => {
    const fabricated = queue({
      jobs: [
        entry({
          title: 'Desarrollador Junior Frontend',
          url: `https://www.aggregator.es/details/${encodeURIComponent('Desarrollador Junior Frontend')}`,
          sources: realSources('aggregator'),
        }),
      ],
    });

    expect(renderLinkAudit(fabricated)).toContain('title-derived');
  });

  it('accepts an unresolved newsletter shortener, which redirects and is not a guess', () => {
    const shortened = queue({
      jobs: [
        entry({ url: 'https://juniorjobs.short.gy/2sxqtb', sources: realSources('newsletter') }),
      ],
    });

    expect(renderLinkAudit(shortened)).toBeNull();
  });
});

/**
 * A filter the candidate cannot see is a filter he cannot trust. The excluded
 * set gets its own printed section, with the score it would have had.
 */
describe('renderExcludedTable', () => {
  it('lists every excluded posting with the reason and the pre-gate score', () => {
    const output = renderExcludedTable(queue({ totalRelevant: 3, excluded: [excluded()] }));
    expect(output).toContain('Se Necesitan Odontólogos');
    expect(output).toContain('Dentego');
    expect(output).toContain('56.8');
    expect(output).toContain('odontologo');
  });

  it('returns nothing when the gate excluded nothing', () => {
    expect(renderExcludedTable(queue())).toBe('');
  });
});

/**
 * THE REMOVAL REPORT.
 *
 * This pipeline now deletes postings the candidate had already qualified for.
 * A deletion he is not told about is indistinguishable from a bug, so the count,
 * the reason and the rule all have to reach the terminal on the run that made
 * them - not a log file, not a JSON field nobody opens.
 */
describe('the liveness report', () => {
  const DEAD = excluded({
    id: 'amazon::systems developer engineer::madrid',
    title: 'Systems Developer Engineer, Security Integrations Group',
    company: 'Amazon',
    url: 'https://juniorjobs.short.gy/hh6WWK',
    excludedBy: 'dead_link',
    scoreBeforeGate: 61.2,
    softwareRelevance: 0.9,
    reason:
      'the posting answered HTTP 404 (gone), so the vacancy no longer exists at that address',
  });

  it('says nothing at all when the check was off', () => {
    // Silence is correct here: a line saying "0 removed" on every offline run
    // is a line that trains the reader to skip the section.
    expect(
      renderLivenessReport(
        queue({
          liveness: {
            status: 'off',
            checked: 0,
            alive: 0,
            gone: 0,
            unverified: 0,
            removed: 0,
            requests: 0,
            fromCache: 0,
          },
        }),
      ),
    ).toBeNull();
  });

  it('says nothing when the queue predates liveness checking entirely', () => {
    expect(renderLivenessReport(queue())).toBeNull();
  });

  it('reports what was checked and how much of it cost a request', () => {
    const report = renderLivenessReport(
      queue({
        liveness: {
          status: 'ran',
          checked: 131,
          alive: 118,
          gone: 4,
          unverified: 9,
          removed: 4,
          requests: 13,
          fromCache: 118,
        },
      }),
    );

    expect(report).toContain('131 checked');
    expect(report).toContain('118 from cache');
    expect(report).toContain('13 request');
  });

  it('reports HOW MANY were removed and WHY, naming each one', () => {
    const report = renderLivenessReport(
      queue({
        excluded: [DEAD],
        liveness: {
          status: 'ran',
          checked: 2,
          alive: 1,
          gone: 1,
          unverified: 0,
          removed: 1,
          requests: 2,
          fromCache: 0,
        },
      }),
    );

    expect(report).toContain('1 posting REMOVED');
    expect(report).toContain('Systems Developer Engineer');
    expect(report).toContain('Amazon');
    expect(report).toContain('HTTP 404');
  });

  it('states the rule beside the removals, so the reader can check the judgement', () => {
    const report = renderLivenessReport(
      queue({
        excluded: [DEAD],
        liveness: {
          status: 'ran',
          checked: 2,
          alive: 1,
          gone: 1,
          unverified: 0,
          removed: 1,
          requests: 2,
          fromCache: 0,
        },
      }),
    );

    expect(report).toMatch(/only HTTP 404 and 410 remove/i);
    expect(report).toMatch(/403/);
    expect(report).toMatch(/429/);
  });

  it('points at the file that holds the evidence', () => {
    const report = renderLivenessReport(
      queue({
        excluded: [DEAD],
        liveness: {
          status: 'ran',
          checked: 2,
          alive: 1,
          gone: 1,
          unverified: 0,
          removed: 1,
          requests: 2,
          fromCache: 0,
        },
      }),
    );

    expect(report).toContain('excluded');
  });

  it('says how many were kept unverified, without dressing it as a problem', () => {
    const report = renderLivenessReport(
      queue({
        liveness: {
          status: 'ran',
          checked: 10,
          alive: 8,
          gone: 0,
          unverified: 2,
          removed: 0,
          requests: 10,
          fromCache: 0,
        },
      }),
    );

    expect(report).toContain('2 could not be verified');
    // Capitalised in the output: "kept" is the reassuring half of the sentence
    // and the one a skimming reader needs to catch.
    expect(report).toMatch(/kept/i);
  });

  it('reports a wholesale failure as a failure, not as a clean run with nothing to remove', () => {
    /*
     * The distinction that matters. "Nothing was removed" reads identically
     * whether every posting is healthy or the checker never got off the ground,
     * and those deserve very different reactions.
     */
    const report = renderLivenessReport(
      queue({
        liveness: {
          status: 'failed',
          checked: 0,
          alive: 0,
          gone: 0,
          unverified: 0,
          removed: 0,
          requests: 0,
          fromCache: 0,
          error: 'getaddrinfo ENOTFOUND boards.greenhouse.io',
        },
      }),
    );

    expect(report).toMatch(/could not run/i);
    expect(report).toContain('getaddrinfo ENOTFOUND');
    expect(report).toMatch(/nothing was removed/i);
  });
});

describe('the excluded table with a dead link in it', () => {
  it('labels a removed posting distinctly from the two content filters', () => {
    const table = renderExcludedTable(
      queue({
        excluded: [
          excluded({ excludedBy: 'software_relevance' }),
          excluded({
            title: 'Systems Developer Engineer',
            excludedBy: 'dead_link',
            reason: 'the posting answered HTTP 404 (gone), so the vacancy no longer exists',
          }),
        ],
      }),
    );

    expect(table).toContain('not-tech');
    expect(table).toContain('dead-link');
  });
});
