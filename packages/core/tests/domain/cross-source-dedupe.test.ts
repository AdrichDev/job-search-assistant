import { describe, expect, it } from 'vitest';
import { dedupeJobs } from '../../src/domain/dedupe.js';
import { canonicalCompany, canonicalTitle } from '../../src/domain/identity.js';
import { makeJob } from '../helpers/make-job.js';

/**
 * THE GOVERNING ASYMMETRY, restated because it decides every case below:
 *
 *   A false merge is worse than a missed duplicate.
 *
 * A missed duplicate costs the candidate ten seconds of scrolling. A false
 * merge makes a real, applyable vacancy INVISIBLE - it is deleted from the
 * queue and nothing in the output says it ever existed. So the extra
 * cross-source key added here is deliberately EXACT-after-canonicalization:
 * decorative noise is removed, and then the strings must be identical. No
 * fuzzy distance, no token-overlap ratio, no similarity threshold - those are
 * precisely the mechanisms that merge "Backend Engineer" into
 * "Backend Engineering Manager".
 */

describe('canonicalCompany', () => {
  it('ignores case, accents and punctuation', () => {
    expect(canonicalCompany('Cabify')).toBe(canonicalCompany('CABIFY'));
    expect(canonicalCompany('Job&Talent')).toBe(canonicalCompany('Job & Talent'));
  });

  it('strips legal-form suffixes, which boards and aggregators spell differently', () => {
    expect(canonicalCompany('ACME S.L.')).toBe(canonicalCompany('ACME'));
    expect(canonicalCompany('ACME SL')).toBe(canonicalCompany('ACME'));
    expect(canonicalCompany('ACME S.A.')).toBe(canonicalCompany('ACME'));
    expect(canonicalCompany('Globex Inc.')).toBe(canonicalCompany('Globex'));
    expect(canonicalCompany('Globex GmbH')).toBe(canonicalCompany('Globex'));
    expect(canonicalCompany('Globex Ltd')).toBe(canonicalCompany('Globex'));
  });

  it('does NOT strip a suffix that is the whole name', () => {
    // Otherwise a company literally called "SL" collapses into nothing and
    // starts matching every other nameless posting.
    expect(canonicalCompany('SL')).not.toBe('');
  });

  it('does not merge two genuinely different companies', () => {
    expect(canonicalCompany('Cabify')).not.toBe(canonicalCompany('Cabimed'));
    expect(canonicalCompany('ACME')).not.toBe(canonicalCompany('ACME Digital'));
  });

  it('returns an empty string for a blank company', () => {
    expect(canonicalCompany('   ')).toBe('');
  });
});

describe('canonicalTitle', () => {
  it('removes gender markers boards append', () => {
    expect(canonicalTitle('Frontend Engineer (m/f/d)')).toBe(canonicalTitle('Frontend Engineer'));
    expect(canonicalTitle('Frontend Engineer (M/W/D)')).toBe(canonicalTitle('Frontend Engineer'));
    expect(canonicalTitle('Desarrollador/a Junior')).toBe(canonicalTitle('Desarrollador Junior'));
  });

  it('removes a trailing location or requisition tail', () => {
    expect(canonicalTitle('Backend Developer - Madrid')).toBe(canonicalTitle('Backend Developer'));
    expect(canonicalTitle('Backend Developer | Remote')).toBe(canonicalTitle('Backend Developer'));
    expect(canonicalTitle('Backend Developer (Madrid)')).toBe(canonicalTitle('Backend Developer'));
  });

  it('KEEPS a level or seniority marker, because it is a different vacancy', () => {
    expect(canonicalTitle('Frontend Engineer II')).not.toBe(canonicalTitle('Frontend Engineer'));
    expect(canonicalTitle('Senior Backend Developer')).not.toBe(
      canonicalTitle('Backend Developer'),
    );
    expect(canonicalTitle('Backend Engineering Manager')).not.toBe(
      canonicalTitle('Backend Engineer'),
    );
  });

  it('KEEPS a stack qualifier, because it is a different vacancy', () => {
    expect(canonicalTitle('Developer (React)')).not.toBe(canonicalTitle('Developer (Java)'));
  });

  it('never collapses a title to nothing', () => {
    expect(canonicalTitle('(m/f/d)')).not.toBe('');
    expect(canonicalTitle('   ')).toBe('');
  });
});

describe('cross-source dedupe', () => {
  it('MERGES the same vacancy arriving from generic aggregator and from a company board', () => {
    const result = dedupeJobs([
      makeJob({
        sourceId: 'aggregator',
        externalId: 'ad-1',
        title: 'Frontend Engineer (m/f/d)',
        company: 'Cabify S.L.',
        location: 'Madrid, Comunidad de Madrid, Spain',
        url: 'https://www.aggregator.es/land/ad/1234',
      }),
      makeJob({
        sourceId: 'greenhouse',
        externalId: 'gh-9',
        title: 'Frontend Engineer',
        company: 'Cabify',
        location: 'Madrid',
        url: 'https://job-boards.greenhouse.io/cabify/jobs/9',
      }),
    ]);

    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.jobs[0]?.sources.map((ref) => ref.sourceId).sort()).toEqual([
      'aggregator',
      'greenhouse',
    ]);
  });

  it('MERGES across a trailing-location difference', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'aggregator', externalId: '1', title: 'Backend Developer - Madrid', company: 'ACME', location: 'Madrid' }),
      makeJob({ sourceId: 'lever', externalId: '2', title: 'Backend Developer', company: 'ACME', location: 'Madrid' }),
    ]);
    expect(result.jobs).toHaveLength(1);
  });

  it('does NOT merge two genuinely different vacancies at the same company', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'greenhouse', externalId: '1', title: 'Frontend Engineer', company: 'Cabify', location: 'Madrid' }),
      makeJob({ sourceId: 'greenhouse', externalId: '2', title: 'Backend Engineer', company: 'Cabify', location: 'Madrid' }),
    ]);
    expect(result.jobs).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('does NOT merge two seniority levels of the same role', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'ashby', externalId: '1', title: 'Software Engineer', company: 'n8n', location: 'Madrid' }),
      makeJob({ sourceId: 'ashby', externalId: '2', title: 'Senior Software Engineer', company: 'n8n', location: 'Madrid' }),
      makeJob({ sourceId: 'ashby', externalId: '3', title: 'Software Engineer II', company: 'n8n', location: 'Madrid' }),
    ]);
    expect(result.jobs).toHaveLength(3);
  });

  it('does NOT merge the same title at two different companies', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'greenhouse', externalId: '1', title: 'Frontend Engineer', company: 'Cabify', location: 'Madrid' }),
      makeJob({ sourceId: 'lever', externalId: '2', title: 'Frontend Engineer', company: 'Qonto', location: 'Madrid' }),
    ]);
    expect(result.jobs).toHaveLength(2);
  });

  it('does NOT merge the same title at the same company in two different cities', () => {
    // Two real openings. Merging them would hide the one the candidate can
    // actually reach.
    const result = dedupeJobs([
      makeJob({ sourceId: 'greenhouse', externalId: '1', title: 'Frontend Engineer', company: 'Cabify', location: 'Madrid' }),
      makeJob({ sourceId: 'greenhouse', externalId: '2', title: 'Frontend Engineer', company: 'Cabify', location: 'Barcelona' }),
    ]);
    expect(result.jobs).toHaveLength(2);
  });

  it('NEVER merges on title alone when the company is unknown', () => {
    // Without a company anchor, "Junior Developer" would swallow every other
    // anonymous "Junior Developer" in the queue. That is the exact false merge
    // this rule exists to refuse.
    const result = dedupeJobs([
      makeJob({ sourceId: 'a', externalId: '1', title: 'Junior Developer', company: '', location: 'Madrid', url: 'https://a.test/1' }),
      makeJob({ sourceId: 'b', externalId: '2', title: 'Junior Developer', company: '', location: 'Madrid', url: 'https://b.test/2' }),
    ]);
    expect(result.jobs).toHaveLength(2);
  });

  it('keeps the board URL when the aggregator arrived first', () => {
    // Whichever survives, the candidate must still be able to click through.
    const [survivor] = dedupeJobs([
      makeJob({ sourceId: 'aggregator', externalId: '1', title: 'Frontend Engineer (m/f/d)', company: 'Cabify', location: 'Madrid', url: 'https://aggregator.test/1' }),
      makeJob({ sourceId: 'greenhouse', externalId: '2', title: 'Frontend Engineer', company: 'Cabify', location: 'Madrid', url: 'https://job-boards.greenhouse.io/cabify/jobs/2' }),
    ]).jobs;

    expect(survivor?.sources.map((ref) => ref.url)).toContain(
      'https://job-boards.greenhouse.io/cabify/jobs/2',
    );
  });

  it('stays transitive: three spellings of one vacancy collapse to one entry', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'aggregator', externalId: '1', title: 'Frontend Engineer (m/f/d)', company: 'Cabify S.L.', location: 'Madrid, Spain' }),
      makeJob({ sourceId: 'greenhouse', externalId: '2', title: 'Frontend Engineer', company: 'Cabify', location: 'Madrid' }),
      makeJob({ sourceId: 'lever', externalId: '3', title: 'Frontend Engineer - Madrid', company: 'CABIFY', location: 'Madrid' }),
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sources).toHaveLength(3);
  });
});
