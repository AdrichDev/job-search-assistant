import { describe, expect, it } from 'vitest';
import {
  applicationsEqual,
  applyApplicationPatch,
  createApplication,
  type Application,
  type ApplicationPatch,
} from '../../src/domain/application.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');

/** Imported history: listing present, NO cvVariant, NO scoreAtApply. */
const IMPORTED: Application = createApplication({
  jobId: 'import-aaaa1111',
  appliedAt: new Date('2026-03-01T00:00:00.000Z'),
  sourceIds: ['infojobs'],
  notes: 'Respondieron por correo',
  listing: {
    company: 'Información Ñandú S.L.',
    title: 'Desarrollador Júnior Frontend',
    url: 'https://empleo.example.test/oferta/1',
    portal: 'InfoJobs',
    city: 'Alcobendas',
    contact: 'Marta Peña',
    publishedAt: new Date('2026-02-27T00:00:00.000Z'),
  },
});

/** Legacy queue-made application: no listing, 3-part fingerprint id, no sources. */
const LEGACY: Application = createApplication({
  jobId: 'beta soluciones::qa júnior::barcelona',
  appliedAt: new Date('2026-02-10T00:00:00.000Z'),
  cvVariant: 'general',
  scoreAtApply: 61,
  outcome: 'screening',
  outcomeUpdatedAt: new Date('2026-02-15T00:00:00.000Z'),
});

function apply(application: Application, patch: ApplicationPatch) {
  return applyApplicationPatch(application, patch, NOW);
}

function ok(application: Application, patch: ApplicationPatch): Application {
  const result = apply(application, patch);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.reason}`);
  }
  return result.application;
}

describe('applyApplicationPatch - editing', () => {
  it('keeps every field when the patch is empty and reports no change', () => {
    const result = apply(IMPORTED, {});
    expect(result.ok && result.changed).toBe(false);
  });

  it('edits a listing field and trims it', () => {
    const next = ok(IMPORTED, { listing: { city: '  Móstoles ' } });
    expect(next.listing?.city).toBe('Móstoles');
    expect(next.listing?.company).toBe('Información Ñandú S.L.');
  });

  it('edits company and title', () => {
    const next = ok(IMPORTED, { listing: { company: 'Cañas y Tapas Tech', title: 'Programador' } });
    expect(next.listing).toMatchObject({ company: 'Cañas y Tapas Tech', title: 'Programador' });
  });

  it('edits appliedAt', () => {
    const next = ok(IMPORTED, { appliedAt: new Date('2026-03-03T00:00:00.000Z') });
    expect(next.appliedAt.toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('edits sourceIds, trimming and de-duplicating', () => {
    const next = ok(IMPORTED, { sourceIds: [' linkedin', 'linkedin', '', 'infojobs '] });
    expect(next.sourceIds).toEqual(['linkedin', 'infojobs']);
  });

  it('can empty sourceIds', () => {
    expect(ok(IMPORTED, { sourceIds: [] }).sourceIds).toEqual([]);
  });

  it('sets the cv variant on an application that had none', () => {
    expect(ok(IMPORTED, { cvVariant: 'microsoft' }).cvVariant).toBe('microsoft');
  });

  it('keeps a very long note intact', () => {
    const long = 'Ñ'.repeat(4000);
    expect(ok(IMPORTED, { notes: long }).notes).toBe(long);
  });
});

describe('applyApplicationPatch - clearing', () => {
  it('clears notes with an empty or blank string', () => {
    expect('notes' in ok(IMPORTED, { notes: '' })).toBe(false);
    expect('notes' in ok(IMPORTED, { notes: '   ' })).toBe(false);
  });

  it('clears cvVariant with null', () => {
    expect('cvVariant' in ok(LEGACY, { cvVariant: null })).toBe(false);
  });

  it.each(['url', 'portal', 'city', 'contact'] as const)('clears listing.%s with a blank string', (field) => {
    const next = ok(IMPORTED, { listing: { [field]: '  ' } });
    expect(next.listing !== undefined && field in next.listing).toBe(false);
  });

  it('clears publishedAt with null', () => {
    const next = ok(IMPORTED, { listing: { publishedAt: null } });
    expect(next.listing !== undefined && 'publishedAt' in next.listing).toBe(false);
  });

  it('never leaves an undefined value behind', () => {
    const next = ok(IMPORTED, { notes: '', listing: { city: '' } });
    expect(Object.values(next).includes(undefined)).toBe(false);
    expect(Object.values(next.listing ?? {}).includes(undefined)).toBe(false);
  });
});

describe('applyApplicationPatch - refusals', () => {
  it.each([
    [{ listing: { company: '' } }, 'blank_company'],
    [{ listing: { company: '   ' } }, 'blank_company'],
    [{ listing: { title: ' ' } }, 'blank_title'],
    [{ listing: { url: 'javascript:alert(1)' } }, 'invalid_url'],
    [{ listing: { url: 'ftp://files.example.test/x' } }, 'invalid_url'],
    [{ listing: { url: 'not a url' } }, 'invalid_url'],
    [{ appliedAt: new Date('nope') }, 'invalid_date'],
    [{ outcomeUpdatedAt: new Date(Number.NaN) }, 'invalid_date'],
    [{ listing: { publishedAt: new Date('x') } }, 'invalid_date'],
    [{ outcome: 'ghosted' }, 'invalid_outcome'],
    [{ cvVariant: 'wizard' }, 'invalid_cv_variant'],
    [{ notes: 'x'.repeat(20_001) }, 'too_long'],
    [{ listing: { city: 'x'.repeat(2_001) } }, 'too_long'],
  ] as const)('refuses %j as %s', (patch, reason) => {
    const result = apply(IMPORTED, patch as unknown as ApplicationPatch);
    expect(result).toEqual({ ok: false, reason });
  });

  it('does not echo cell content in the refusal', () => {
    const result = apply(IMPORTED, { listing: { url: 'javascript:secret-cell' } });
    expect(JSON.stringify(result)).not.toContain('secret-cell');
  });

  it('accepts an https url and keeps it', () => {
    expect(ok(IMPORTED, { listing: { url: ' https://x.example.test/a ' } }).listing?.url).toBe(
      'https://x.example.test/a',
    );
  });
});

describe('applyApplicationPatch - listing on a queue-made application', () => {
  it('creates a listing when company and title are both present', () => {
    const next = ok(LEGACY, { listing: { company: 'Beta Soluciones', title: 'QA Júnior', city: 'Barcelona' } });
    expect(next.listing).toEqual({ company: 'Beta Soluciones', title: 'QA Júnior', city: 'Barcelona' });
    expect(next.jobId).toBe(LEGACY.jobId);
  });

  it.each([
    [{ listing: { city: 'Madrid' } }],
    [{ listing: { company: 'Beta' } }],
    [{ listing: { title: 'QA' } }],
  ])('refuses %j as listing_incomplete', (patch) => {
    expect(apply(LEGACY, patch)).toEqual({ ok: false, reason: 'listing_incomplete' });
  });

  it('refuses blank company when creating a listing', () => {
    expect(apply(LEGACY, { listing: { company: '', title: 'QA' } })).toEqual({
      ok: false,
      reason: 'blank_company',
    });
  });

  it('does not create a listing for an empty listing patch', () => {
    const result = apply(LEGACY, { listing: {} });
    expect(result.ok && result.changed).toBe(false);
  });

  it('can edit non-listing fields without a listing', () => {
    const next = ok(LEGACY, { notes: 'llamar el lunes' });
    expect(next.listing).toBeUndefined();
    expect(next.notes).toBe('llamar el lunes');
  });
});

describe('applyApplicationPatch - outcome date', () => {
  it('stamps now when the outcome changes without a date', () => {
    const next = ok(IMPORTED, { outcome: 'rejected' });
    expect(next.outcome).toBe('rejected');
    expect(next.outcomeUpdatedAt.getTime()).toBe(NOW.getTime());
  });

  it('keeps the explicit date when the patch carries one', () => {
    const date = new Date('2026-03-20T00:00:00.000Z');
    const next = ok(IMPORTED, { outcome: 'rejected', outcomeUpdatedAt: date });
    expect(next.outcomeUpdatedAt.getTime()).toBe(date.getTime());
  });

  it('keeps the date when the outcome is re-sent unchanged', () => {
    const next = ok(LEGACY, { outcome: 'screening', notes: 'x' });
    expect(next.outcomeUpdatedAt.getTime()).toBe(LEGACY.outcomeUpdatedAt.getTime());
  });

  it('allows editing only the outcome date', () => {
    const date = new Date('2026-02-20T00:00:00.000Z');
    const next = ok(LEGACY, { outcomeUpdatedAt: date });
    expect(next.outcome).toBe('screening');
    expect(next.outcomeUpdatedAt.getTime()).toBe(date.getTime());
  });
});

describe('applyApplicationPatch - no-op and identity', () => {
  it('reports unchanged when every value equals the current one', () => {
    const result = apply(IMPORTED, {
      appliedAt: new Date(IMPORTED.appliedAt),
      outcome: IMPORTED.outcome,
      notes: 'Respondieron por correo',
      sourceIds: ['infojobs'],
      listing: {
        company: 'Información Ñandú S.L.',
        city: ' Alcobendas ',
        publishedAt: new Date('2026-02-27T00:00:00.000Z'),
      },
    });
    expect(result.ok && result.changed).toBe(false);
  });

  it('reports changed when one value differs', () => {
    const result = apply(IMPORTED, { notes: 'otra' });
    expect(result.ok && result.changed).toBe(true);
  });

  it('never moves jobId or scoreAtApply, even if a crafted patch carries them', () => {
    const crafted = { jobId: 'hacked', scoreAtApply: 999, notes: 'x' } as unknown as ApplicationPatch;
    const next = ok(LEGACY, crafted);
    expect(next.jobId).toBe(LEGACY.jobId);
    expect(next.scoreAtApply).toBe(61);
  });

  it('does not mutate the input', () => {
    const before = structuredClone(IMPORTED);
    ok(IMPORTED, { notes: '', listing: { city: '' }, sourceIds: [] });
    expect(applicationsEqual(IMPORTED, before)).toBe(true);
  });
});
