import { describe, expect, it } from 'vitest';
import { createJob, jobFingerprint, jobSearchText } from '../../src/domain/job.js';
import { makeJob, daysAgo } from '../helpers/make-job.js';

describe('createJob', () => {
  it('trims fields and records the originating source', () => {
    const job = createJob({
      sourceId: 'adzuna',
      externalId: '999',
      title: '  Junior Frontend Developer  ',
      company: '  ACME  ',
      location: ' Madrid ',
      description: '  React and TypeScript  ',
      url: ' https://example.com/1 ',
      postedAt: daysAgo(2),
    });

    expect(job.title).toBe('Junior Frontend Developer');
    expect(job.company).toBe('ACME');
    expect(job.url).toBe('https://example.com/1');
    expect(job.sources).toEqual([
      { sourceId: 'adzuna', externalId: '999', url: 'https://example.com/1' },
    ]);
  });

  it('defaults optional commercial fields to null', () => {
    const job = makeJob();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.contractType).toBeNull();
  });
});

describe('jobFingerprint', () => {
  it('is stable across casing, accents and verbose locations', () => {
    const a = jobFingerprint({
      title: 'Desarrollador Júnior',
      company: 'ACME S.L.',
      location: 'Madrid, Comunidad de Madrid, Spain',
    });
    const b = jobFingerprint({
      title: 'desarrollador junior',
      company: 'acme s.l.',
      location: 'Madrid',
    });
    expect(a).toBe(b);
  });

  it('separates different companies with the same title', () => {
    const a = jobFingerprint({ title: 'Dev', company: 'ACME', location: 'Madrid' });
    const b = jobFingerprint({ title: 'Dev', company: 'Globex', location: 'Madrid' });
    expect(a).not.toBe(b);
  });
});

describe('jobSearchText', () => {
  it('merges title, company, location and description into one normalized haystack', () => {
    const text = jobSearchText(
      makeJob({ title: 'React Dev', company: 'Globex', location: 'Madrid', description: 'Tailwind' }),
    );
    expect(text).toContain('react dev');
    expect(text).toContain('globex');
    expect(text).toContain('madrid');
    expect(text).toContain('tailwind');
  });
});
