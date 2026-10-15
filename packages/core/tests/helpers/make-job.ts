import { createJob, type Job, type JobDraft } from '../../src/domain/job.js';

export interface JobOverrides {
  sourceId?: string;
  externalId?: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  postedAt?: Date;
  salaryMin?: number | null;
  salaryMax?: number | null;
  contractType?: string | null;
}

export const REFERENCE_NOW = new Date('2026-09-07T12:00:00.000Z');

export function daysAgo(days: number, from: Date = REFERENCE_NOW): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

/**
 * Defaults must be UNIQUE per call. A shared default URL or external id would
 * make `dedupeJobs` collapse jobs that are genuinely different, which is
 * correct behaviour but a useless test fixture.
 */
let sequence = 0;

export function makeJob(overrides: JobOverrides = {}): Job {
  sequence += 1;
  const draft: JobDraft = {
    sourceId: overrides.sourceId ?? 'test',
    externalId: overrides.externalId ?? `ext-${sequence}`,
    title: overrides.title ?? 'Developer',
    company: overrides.company ?? 'ACME',
    location: overrides.location ?? 'Madrid',
    description: overrides.description ?? 'Buscamos una persona para nuestro equipo.',
    url: overrides.url ?? `https://example.com/jobs/${sequence}`,
    postedAt: overrides.postedAt ?? daysAgo(1),
    salaryMin: overrides.salaryMin ?? null,
    salaryMax: overrides.salaryMax ?? null,
    contractType: overrides.contractType ?? null,
  };
  return createJob(draft);
}
