import { describe, expect, it } from 'vitest';
import {
  buildTrackedApplications,
  countByOutcome,
  type TrackableQueueJob,
} from '../../src/app/tracked-applications.js';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  type Application,
  type ApplicationDraft,
} from '../../src/domain/application.js';

/*
 * Fixtures are shaped like the real log: imported rows carry a listing and no
 * cvVariant/score; legacy queue-made rows have a 3-part fingerprint id and no
 * sourceIds; some jobs have left the queue.
 */

const app = (draft: Partial<ApplicationDraft> & { jobId: string }): Application =>
  createApplication({ appliedAt: new Date('2026-03-10T09:00:00Z'), ...draft });

const imported = (jobId: string, appliedAt: string, extra: Partial<ApplicationDraft> = {}): Application =>
  app({
    jobId,
    appliedAt: new Date(appliedAt),
    sourceIds: ['infojobs'],
    listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior', portal: 'InfoJobs' },
    ...extra,
  });

const job = (overrides: Partial<TrackableQueueJob> = {}): TrackableQueueJob => ({
  id: 'acme::junior dev::madrid',
  company: 'ACME',
  title: 'Junior Dev',
  location: 'Madrid',
  url: 'https://acme.test/jobs/1',
  sources: [{ sourceId: 'greenhouse' }],
  ...overrides,
});

describe('buildTrackedApplications resolution order', () => {
  it('prefers the application listing and marks it imported', () => {
    const [row] = buildTrackedApplications(
      [
        imported('import-abc', '2026-02-01T00:00:00Z', {
          listing: {
            company: 'Información Ñandú S.L.',
            title: 'Desarrollador Júnior',
            url: 'https://empleo.test/oferta/1',
            city: 'Alcobendas',
            portal: 'InfoJobs',
          },
        }),
      ],
      [job({ id: 'import-abc', company: 'Queue Co' })],
    );

    expect(row).toMatchObject({
      jobId: 'import-abc',
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior',
      url: 'https://empleo.test/oferta/1',
      city: 'Alcobendas',
      portal: 'InfoJobs',
      sourceIds: ['infojobs'],
      origin: 'imported',
    });
    expect(row).not.toHaveProperty('notes');
  });

  it('falls back to the queue entry with the same job id', () => {
    const [row] = buildTrackedApplications([app({ jobId: 'acme::junior dev::madrid' })], [job()]);

    expect(row).toMatchObject({
      company: 'ACME',
      title: 'Junior Dev',
      url: 'https://acme.test/jobs/1',
      city: 'Madrid',
      sourceIds: ['greenhouse'],
      origin: 'queue',
    });
  });

  it('keeps the application sourceIds when it has them, even if the queue differs', () => {
    const [row] = buildTrackedApplications(
      [app({ jobId: 'acme::junior dev::madrid', sourceIds: ['lever'] })],
      [job()],
    );
    expect(row?.sourceIds).toEqual(['lever']);
  });

  it('parses a legacy fingerprint when the job left the queue', () => {
    const [row] = buildTrackedApplications([app({ jobId: 'beta sl::qa júnior::barcelona' })], []);

    expect(row).toMatchObject({
      company: 'beta sl',
      title: 'qa júnior',
      city: 'barcelona',
      sourceIds: [],
      origin: 'queue',
    });
    expect(row).not.toHaveProperty('url');
  });

  it('omits the city when the third fingerprint part is empty', () => {
    const [row] = buildTrackedApplications([app({ jobId: 'beta sl::qa::' })], []);
    expect(row).toMatchObject({ company: 'beta sl', title: 'qa' });
    expect(row).not.toHaveProperty('city');
  });

  it('never throws on an odd job id', () => {
    const odd = ['nonsense', 'a::b', 'a::b::c::d', '::::', 'x'.repeat(500)];
    const rows = buildTrackedApplications(
      odd.map((jobId) => app({ jobId })),
      [],
    );

    expect(rows).toHaveLength(odd.length);
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(0);
      expect(typeof row.company).toBe('string');
    }
  });

  it('passes notes, outcome and dates through', () => {
    const [row] = buildTrackedApplications(
      [imported('import-1', '2026-01-05T00:00:00Z', {
        outcome: 'rejected',
        outcomeUpdatedAt: new Date('2026-01-20T00:00:00Z'),
        notes: 'Llamaron el viernes',
      })],
      [],
    );
    expect(row).toMatchObject({
      outcome: 'rejected',
      notes: 'Llamaron el viernes',
      appliedAt: new Date('2026-01-05T00:00:00Z'),
      outcomeUpdatedAt: new Date('2026-01-20T00:00:00Z'),
    });
  });
});

describe('url safety', () => {
  const withUrl = (url: string) =>
    buildTrackedApplications(
      [imported('import-u', '2026-01-01T00:00:00Z', { listing: { company: 'A', title: 'B', url } })],
      [],
    )[0];

  it('keeps http and https', () => {
    expect(withUrl('http://a.test/x')?.url).toBe('http://a.test/x');
    expect(withUrl('https://a.test/x?y=1')?.url).toBe('https://a.test/x?y=1');
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://a.test/x', 'file:///etc/passwd', 'no es una url', 'www.a.test/x'])(
    'drops %s',
    (url) => {
      expect(withUrl(url)).not.toHaveProperty('url');
    },
  );

  it('drops an unsafe queue url too', () => {
    const [row] = buildTrackedApplications(
      [app({ jobId: 'acme::junior dev::madrid' })],
      [job({ url: 'javascript:alert(1)' })],
    );
    expect(row).not.toHaveProperty('url');
  });
});

describe('sorting', () => {
  it('orders newest applied first, ties by job id', () => {
    const rows = buildTrackedApplications(
      [
        imported('import-b', '2026-02-01T00:00:00Z'),
        imported('import-a', '2026-02-01T00:00:00Z'),
        imported('import-z', '2026-03-01T00:00:00Z'),
        imported('import-old', '2025-12-31T00:00:00Z'),
      ],
      [],
    );
    expect(rows.map((r) => r.jobId)).toEqual(['import-z', 'import-a', 'import-b', 'import-old']);
  });

  it('does not mutate its inputs', () => {
    const input = [imported('import-b', '2026-01-01T00:00:00Z'), imported('import-a', '2026-02-01T00:00:00Z')];
    buildTrackedApplications(input, []);
    expect(input.map((a) => a.jobId)).toEqual(['import-b', 'import-a']);
  });

  it('returns an empty list for an empty log', () => {
    expect(buildTrackedApplications([], [job()])).toEqual([]);
  });
});

describe('countByOutcome', () => {
  it('reports every outcome, zeros included', () => {
    const counts = countByOutcome([]);
    expect(Object.keys(counts).sort()).toEqual([...APPLICATION_OUTCOMES].sort());
    for (const outcome of APPLICATION_OUTCOMES) {
      expect(counts[outcome]).toBe(0);
    }
  });

  it('counts rows per outcome', () => {
    const rows = buildTrackedApplications(
      [
        imported('import-1', '2026-01-01T00:00:00Z', { outcome: 'rejected' }),
        imported('import-2', '2026-01-02T00:00:00Z', { outcome: 'rejected' }),
        imported('import-3', '2026-01-03T00:00:00Z'),
      ],
      [],
    );
    expect(countByOutcome(rows)).toEqual({
      applied: 1,
      no_reply: 0,
      rejected: 2,
      screening: 0,
      interview: 0,
      offer: 0,
    });
  });
});
