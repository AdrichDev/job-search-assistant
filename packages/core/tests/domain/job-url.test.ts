import { describe, expect, it } from 'vitest';
import { createJob, type JobDraft } from '../../src/domain/job.js';

/**
 * The URL is the only field of a posting that the candidate ACTS on.
 *
 * A wrong title wastes a second of reading. A wrong URL sends a human to a 403
 * and teaches them the tool lies. So the domain refuses to mint a `Job` that
 * cannot be opened, instead of accepting a placeholder and letting the defect
 * travel all the way to a button.
 *
 * These tests exist because the queue shipped 13 postings whose URLs were built
 * out of their own titles. Every one of them was a dead link.
 */

function draft(overrides: Partial<JobDraft> = {}): JobDraft {
  return {
    sourceId: 'adzuna',
    externalId: '5874810786',
    title: 'Desarrollador Junior',
    company: 'ACME',
    location: 'Madrid',
    description: 'React y TypeScript.',
    url: 'https://www.adzuna.es/details/5874810786',
    postedAt: new Date('2026-09-08T00:00:00.000Z'),
    ...overrides,
  };
}

describe('createJob URL validation', () => {
  it('accepts an absolute https URL from the source', () => {
    expect(createJob(draft()).url).toBe('https://www.adzuna.es/details/5874810786');
  });

  it('accepts an absolute http URL', () => {
    expect(createJob(draft({ url: 'http://boards.example.com/jobs/1' })).url).toBe(
      'http://boards.example.com/jobs/1',
    );
  });

  it('rejects an empty URL instead of defaulting one', () => {
    expect(() => createJob(draft({ url: '' }))).toThrow(/url/i);
  });

  it('rejects a whitespace-only URL', () => {
    expect(() => createJob(draft({ url: '   ' }))).toThrow(/url/i);
  });

  it('rejects a relative path, which no browser could resolve from the queue file', () => {
    expect(() => createJob(draft({ url: '/details/5874810786' }))).toThrow(/url/i);
  });

  it('rejects a non-http scheme', () => {
    expect(() => createJob(draft({ url: 'javascript:alert(1)' }))).toThrow(/http/i);
  });

  it('names the source and the title, so the failure is diagnosable', () => {
    expect(() => createJob(draft({ url: '' }))).toThrow(/adzuna/);
    expect(() => createJob(draft({ url: '' }))).toThrow(/Desarrollador Junior/);
  });

  it('carries the same URL into the source ref, never a second derivation', () => {
    const job = createJob(draft({ url: 'https://jobs.example.com/abc?utm_source=x' }));
    expect(job.sources).toHaveLength(1);
    expect(job.sources[0]?.url).toBe('https://jobs.example.com/abc?utm_source=x');
    expect(job.sources[0]?.url).toBe(job.url);
  });
});
