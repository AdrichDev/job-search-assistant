import { describe, expect, it } from 'vitest';
import {
  auditPostingLinks,
  describeLinkProblems,
  inspectPostingLink,
  isTitleDerived,
} from '../../src/domain/link-provenance.js';

/**
 * The provenance rules, now PRODUCTION code.
 *
 * They were written in `e2e/support/link-integrity.ts` and they were correct.
 * The problem was where they lived: a module only the browser suite could
 * reach, applied only to queues the suite seeded itself. Rules that cannot be
 * run against the pipeline's own output cannot catch the pipeline's own output
 * being wrong - which is precisely what happened when `--source=all` shipped
 * `example-board.test` links to positions #1 and #3.
 *
 * Living in the domain, the same rules are now available to the CLI on every
 * real run, to an integration test over a pipeline-built queue, and (via the
 * core barrel) to the browser suite, so there is exactly one definition of
 * "this address was not reported by a source".
 */

describe('placeholder hosts', () => {
  it('rejects the reserved demo domain that reached the user queue', () => {
    const problems = inspectPostingLink({
      url: 'https://example-board.test/offers/fx-010',
      title: 'Trainee Software Developer',
    });

    expect(problems.map((problem) => problem.rule)).toContain('placeholder-host');
  });

  it('rejects the other addresses that mean "we had nothing"', () => {
    for (const url of [
      'https://example.com/jobs/1',
      'http://localhost:3000/jobs/1',
      'http://127.0.0.1/jobs/1',
    ]) {
      expect(inspectPostingLink({ url, title: 'Junior Backend Engineer' })).not.toHaveLength(0);
    }
  });
});

describe('structural rules', () => {
  it('rejects a placeholder href', () => {
    expect(inspectPostingLink({ url: '#', title: 'Junior Backend Engineer' })[0]?.rule).toBe(
      'placeholder',
    );
    expect(inspectPostingLink({ url: '', title: 'Junior Backend Engineer' })[0]?.rule).toBe(
      'placeholder',
    );
  });

  it('rejects a relative address, which silently resolves against our own app', () => {
    expect(inspectPostingLink({ url: '/jobs/1', title: 'Junior Backend Engineer' })[0]?.rule).toBe(
      'not-absolute',
    );
  });

  it('rejects a scheme no browser can open a posting with', () => {
    expect(
      inspectPostingLink({ url: 'myapp://job/1', title: 'Junior Backend Engineer' }).map(
        (problem) => problem.rule,
      ),
    ).toContain('bad-protocol');
  });

  it('rejects an address pointing back at this application when an origin is supplied', () => {
    const problems = inspectPostingLink(
      { url: 'http://127.0.0.1:3178/jobs/1', title: 'Junior Backend Engineer' },
      { appOrigin: 'http://127.0.0.1:3178' },
    );

    expect(problems.map((problem) => problem.rule)).toContain('self-referential');
  });
});

describe('the title-derived rule - the original defect', () => {
  it('rejects an address that IS the job title', () => {
    // The thirteen buttons that shipped: valid, absolute, https, real host,
    // and entirely synthesised from a field the pipeline happened to have.
    const url = `https://www.aggregator.es/details/${encodeURIComponent('Junior Frontend Developer')}`;

    expect(isTitleDerived(new URL(url), 'Junior Frontend Developer')).toBe(true);
    expect(
      inspectPostingLink({ url, title: 'Junior Frontend Developer' }).map((problem) => problem.rule),
    ).toContain('title-derived');
  });

  it('accepts a real board URL that happens to carry a title slug for SEO', () => {
    const url = 'https://boards.greenhouse.io/acme/jobs/4471203-junior-frontend-developer';

    expect(isTitleDerived(new URL(url), 'Junior Frontend Developer')).toBe(false);
    expect(inspectPostingLink({ url, title: 'Junior Frontend Developer' })).toHaveLength(0);
  });

  it('refuses to accuse a title too short to distinguish from an ordinary path word', () => {
    expect(isTitleDerived(new URL('https://jobs.example.org/dev'), 'Dev')).toBe(false);
  });
});

describe('links that are fine', () => {
  it('accepts the real employer addresses the newsletter resolver produces', () => {
    for (const url of [
      'https://careers.idealista.com/jobs/8103848-android-product-engineer?utm_source=juniorjobs',
      'https://jobs.smartrecruiters.com/RedPoints1/744000147215471-osint-investigator',
      'https://job-boards.greenhouse.io/factorial/jobs/6633404003',
    ]) {
      expect(inspectPostingLink({ url, title: 'Android Product Engineer' })).toHaveLength(0);
    }
  });

  it('accepts an unresolved shortener: it redirects, which is more than a guess does', () => {
    // Second best, and honest. Resolution is on by default now, but a link the
    // resolver could not follow keeps the sender's address - and that address
    // opens the posting in a browser.
    expect(
      inspectPostingLink({
        url: 'https://juniorjobs.short.gy/2sxqtb',
        title: 'GTM Engineer Factorial IT',
      }),
    ).toHaveLength(0);
  });
});

describe('auditing a whole queue', () => {
  const CLEAN = [
    { url: 'https://job-boards.greenhouse.io/factorial/jobs/6633404003', title: 'GTM Engineer' },
    { url: 'https://juniorjobs.short.gy/2sxqtb', title: 'Android Product Engineer' },
  ];

  const DIRTY = [
    ...CLEAN,
    { url: 'https://example-board.test/offers/fx-010', title: 'Trainee Software Developer' },
    { url: 'https://example-board.test/offers/fx-002', title: 'Becario de Desarrollo Web' },
  ];

  it('reports nothing for a queue of real postings', () => {
    expect(auditPostingLinks(CLEAN)).toHaveLength(0);
  });

  it('reports EVERY bad link, not just the first', () => {
    // "one link is broken" and "every link is broken" call for different
    // reactions, so the audit collects rather than throws.
    const problems = auditPostingLinks(DIRTY);

    expect(problems).toHaveLength(2);
    expect(problems.every((problem) => problem.rule === 'placeholder-host')).toBe(true);
    expect(problems.map((problem) => problem.title).sort()).toEqual([
      'Becario de Desarrollo Web',
      'Trainee Software Developer',
    ]);
  });

  it('describes the problems in a form a human can act on', () => {
    const described = describeLinkProblems(auditPostingLinks(DIRTY));

    expect(described).toContain('example-board.test');
    expect(described).toContain('Trainee Software Developer');
    expect(described).toContain('placeholder-host');
  });
});
