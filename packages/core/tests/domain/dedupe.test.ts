import { describe, expect, it } from 'vitest';
import { dedupeJobs } from '../../src/domain/dedupe.js';
import { daysAgo, makeJob } from '../helpers/make-job.js';

describe('dedupeJobs', () => {
  it('keeps distinct vacancies untouched', () => {
    const result = dedupeJobs([
      makeJob({ title: 'Junior React Dev', company: 'ACME' }),
      makeJob({ title: 'Junior Power Apps Dev', company: 'Globex' }),
    ]);
    expect(result.jobs).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('collapses the same vacancy seen twice on different pages', () => {
    const result = dedupeJobs([
      makeJob({ sourceId: 'adzuna', externalId: '1', title: 'Junior Dev', company: 'ACME' }),
      makeJob({ sourceId: 'adzuna', externalId: '1', title: 'Junior Dev', company: 'ACME' }),
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('collapses the same vacancy arriving from two different sources', () => {
    const result = dedupeJobs([
      makeJob({
        sourceId: 'adzuna',
        externalId: 'a-1',
        title: 'Desarrollador Júnior',
        company: 'ACME S.L.',
        location: 'Madrid, Comunidad de Madrid, Spain',
        url: 'https://adzuna.example/1',
      }),
      makeJob({
        sourceId: 'fixture',
        externalId: 'f-9',
        title: 'desarrollador junior',
        company: 'acme s.l.',
        location: 'Madrid',
        url: 'https://fixture.example/9',
      }),
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('accumulates every source reference on the surviving job', () => {
    const [survivor] = dedupeJobs([
      makeJob({ sourceId: 'adzuna', externalId: 'a-1', url: 'https://a.example/1' }),
      makeJob({ sourceId: 'fixture', externalId: 'f-9', url: 'https://f.example/9' }),
    ]).jobs;

    expect(survivor?.sources.map((ref) => ref.sourceId).sort()).toEqual(['adzuna', 'fixture']);
  });

  it('does not duplicate an identical source reference', () => {
    const [survivor] = dedupeJobs([
      makeJob({ sourceId: 'adzuna', externalId: 'a-1' }),
      makeJob({ sourceId: 'adzuna', externalId: 'a-1' }),
    ]).jobs;
    expect(survivor?.sources).toHaveLength(1);
  });

  it('collapses jobs sharing a URL even when the title differs', () => {
    const result = dedupeJobs([
      makeJob({ title: 'Junior Dev', url: 'https://board.example/offer/42' }),
      makeJob({ title: 'Junior Developer (m/f)', url: 'https://board.example/offer/42' }),
    ]);
    expect(result.jobs).toHaveLength(1);
  });

  it('keeps the earliest posting date so reposts do not inflate recency', () => {
    const [survivor] = dedupeJobs([
      makeJob({ sourceId: 'a', externalId: '1', postedAt: daysAgo(2) }),
      makeJob({ sourceId: 'b', externalId: '2', postedAt: daysAgo(9) }),
    ]).jobs;
    expect(survivor?.postedAt.getTime()).toBe(daysAgo(9).getTime());
  });

  it('keeps the richest description', () => {
    const [survivor] = dedupeJobs([
      makeJob({ sourceId: 'a', externalId: '1', description: 'Short.' }),
      makeJob({ sourceId: 'b', externalId: '2', description: 'A much longer and richer description.' }),
    ]).jobs;
    expect(survivor?.description).toBe('A much longer and richer description.');
  });

  it('handles an empty input', () => {
    expect(dedupeJobs([])).toEqual({ jobs: [], duplicatesRemoved: 0 });
  });

  it('preserves first-seen order', () => {
    const result = dedupeJobs([
      makeJob({ company: 'Zeta' }),
      makeJob({ company: 'Alpha' }),
      makeJob({ company: 'Zeta' }),
    ]);
    expect(result.jobs.map((job) => job.company)).toEqual(['Zeta', 'Alpha']);
  });
});
