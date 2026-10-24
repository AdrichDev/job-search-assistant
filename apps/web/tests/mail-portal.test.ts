import { describe, expect, it } from 'vitest';
import { mailPortalByJob, withMailPortalFallback } from '@/lib/mail-portal';
import type { TrackedApplication } from '@job-queue/core';

const row = (overrides: Partial<TrackedApplication> = {}): TrackedApplication => ({
  jobId: 'nubesol::dev::madrid',
  company: 'Nubesol',
  title: 'Desarrollador',
  sourceIds: [],
  appliedAt: new Date('2026-03-01T00:00:00Z'),
  outcome: 'applied',
  outcomeUpdatedAt: new Date('2026-03-01T00:00:00Z'),
  origin: 'queue',
  ...overrides,
});

describe('mailPortalByJob', () => {
  it('collects the portal of the proposals that carry one, newest first wins', () => {
    const portals = mailPortalByJob([
      { jobId: 'a', portal: 'infojobs' },
      { jobId: 'a', portal: 'linkedin' },
      { jobId: 'b', portal: 'tecnoempleo' },
      { jobId: 'c' },
    ]);
    expect(portals.get('a')).toBe('infojobs');
    expect(portals.get('b')).toBe('tecnoempleo');
    expect(portals.has('c')).toBe(false);
  });

  it('answers an empty map for proposals without a portal', () => {
    expect(mailPortalByJob([{ jobId: 'a' }, { jobId: 'b' }]).size).toBe(0);
    expect(mailPortalByJob([]).size).toBe(0);
  });
});

describe('withMailPortalFallback', () => {
  it('fills the portal the alert revealed into a row without one', () => {
    const portals = mailPortalByJob([{ jobId: 'a', portal: 'infojobs' }]);
    const rows = withMailPortalFallback([row({ jobId: 'a' })], portals);
    expect(rows[0]?.portal).toBe('infojobs');
    // Everything else about the row stays untouched.
    expect(rows[0]).toEqual({ ...row({ jobId: 'a' }), portal: 'infojobs' });
  });

  it('never overwrites an imported portal', () => {
    const portals = mailPortalByJob([{ jobId: 'a', portal: 'infojobs' }]);
    const imported = row({ jobId: 'a', portal: 'Web de la empresa', origin: 'imported' });
    expect(withMailPortalFallback([imported], portals)[0]).toBe(imported);
  });

  it('never invents a portal when no proposal names one', () => {
    const rows = [row({ jobId: 'a' }), row({ jobId: 'b', portal: 'Indeed' })];
    expect(withMailPortalFallback(rows, mailPortalByJob([]))).toEqual(rows);
  });

  it('keeps rows without a matching proposal untouched', () => {
    const portals = mailPortalByJob([{ jobId: 'other', portal: 'infojobs' }]);
    const original = row({ jobId: 'a' });
    expect(withMailPortalFallback([original], portals)[0]).toBe(original);
  });
});
