import { describe, expect, it } from 'vitest';
import { applyApplicationPatch, applicationsEqual, createApplication } from '../../src/domain/application.js';
import {
  analyzeHistory,
  diffApplications,
  fieldValue,
  patchRestoring,
  type ApplicationChange,
} from '../../src/domain/application-history.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');

const IMPORTED = createApplication({
  jobId: 'import-aaaa1111',
  appliedAt: new Date('2026-03-01T00:00:00.000Z'),
  sourceIds: ['infojobs'],
  notes: 'Ñ'.repeat(20_000),
  listing: {
    company: 'Información Ñandú S.L.',
    title: 'Desarrollador Júnior',
    city: 'Alcobendas',
    publishedAt: new Date('2026-02-27T00:00:00.000Z'),
  },
});
const LEGACY = createApplication({
  jobId: 'beta soluciones::qa júnior::barcelona',
  appliedAt: new Date('2026-02-10T00:00:00.000Z'),
  cvVariant: 'general',
  scoreAtApply: 61,
});

function apply(application: typeof IMPORTED, patch: Parameters<typeof applyApplicationPatch>[1]) {
  const result = applyApplicationPatch(application, patch, NOW);
  if (!result.ok) throw new Error(result.reason);
  return result.application;
}

describe('diffApplications', () => {
  it('is empty for equal applications', () => {
    expect(diffApplications(IMPORTED, { ...IMPORTED })).toEqual([]);
  });

  it('reports a changed outcome and its date as ISO strings', () => {
    const after = apply(IMPORTED, { outcome: 'rejected' });
    expect(diffApplications(IMPORTED, after)).toEqual([
      { field: 'outcome', before: 'applied', after: 'rejected' },
      {
        field: 'outcomeUpdatedAt',
        before: '2026-03-01T00:00:00.000Z',
        after: NOW.toISOString(),
      },
    ]);
  });

  it('treats absent and null alike and reports the transition to a value', () => {
    const after = apply(IMPORTED, { cvVariant: 'frontend' });
    expect(diffApplications(IMPORTED, after)).toEqual([
      { field: 'cvVariant', before: null, after: 'frontend' },
    ]);
    expect(fieldValue(IMPORTED, 'cvVariant')).toBeNull();
    expect(fieldValue(LEGACY, 'listing.city')).toBeNull();
    expect(fieldValue(IMPORTED, 'listing.publishedAt')).toBe('2026-02-27T00:00:00.000Z');
  });

  it('compares arrays by content, not identity', () => {
    const same = { ...IMPORTED, sourceIds: ['infojobs'] };
    expect(diffApplications(IMPORTED, same)).toEqual([]);
    const other = apply(IMPORTED, { sourceIds: ['infojobs', 'linkedin'] });
    expect(diffApplications(IMPORTED, other)).toEqual([
      { field: 'sourceIds', before: ['infojobs'], after: ['infojobs', 'linkedin'] },
    ]);
  });

  it('records the creation of a listing on a legacy row as null -> value per field', () => {
    const after = apply(LEGACY, { listing: { company: 'Ñ S.A.', title: 'QA', city: 'Girona' } });
    expect(diffApplications(LEGACY, after)).toEqual([
      { field: 'listing.company', before: null, after: 'Ñ S.A.' },
      { field: 'listing.title', before: null, after: 'QA' },
      { field: 'listing.city', before: null, after: 'Girona' },
    ]);
  });

  it('keeps very long notes whole', () => {
    const after = apply(IMPORTED, { notes: '' });
    const [change] = diffApplications(IMPORTED, after);
    expect(change).toEqual({ field: 'notes', before: 'Ñ'.repeat(20_000), after: null });
  });
});

describe('patchRestoring', () => {
  it('restores every clearing case with the T2b patch semantics', () => {
    const patch = patchRestoring([
      { field: 'cvVariant', before: null, after: 'frontend' },
      { field: 'notes', before: null, after: 'x' },
      { field: 'listing.city', before: null, after: 'Girona' },
      { field: 'listing.publishedAt', before: null, after: '2026-02-27T00:00:00.000Z' },
    ]);
    expect(patch).toEqual({
      cvVariant: null,
      notes: '',
      listing: { city: '', publishedAt: null },
    });
  });

  it('restores values, dates and arrays', () => {
    const patch = patchRestoring([
      { field: 'outcome', before: 'applied', after: 'rejected' },
      { field: 'outcomeUpdatedAt', before: '2026-03-01T00:00:00.000Z', after: NOW.toISOString() },
      { field: 'appliedAt', before: '2026-03-01T00:00:00.000Z', after: '2026-03-02T00:00:00.000Z' },
      { field: 'sourceIds', before: ['infojobs'], after: [] },
      { field: 'listing.company', before: 'A', after: 'B' },
    ]);
    expect(patch).toEqual({
      outcome: 'applied',
      outcomeUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
      appliedAt: new Date('2026-03-01T00:00:00.000Z'),
      sourceIds: ['infojobs'],
      listing: { company: 'A' },
    });
  });

  it('cannot clear company or title, so they are left out (known limitation)', () => {
    expect(
      patchRestoring([
        { field: 'listing.company', before: null, after: 'X' },
        { field: 'listing.title', before: null, after: 'Y' },
      ]),
    ).toEqual({});
  });

  it('round-trips: applying the restoring patch returns a byte-equal application', () => {
    const edited = apply(IMPORTED, {
      outcome: 'screening',
      notes: 'nuevo',
      cvVariant: 'general',
      sourceIds: ['a', 'b'],
      listing: { city: '', url: 'https://empleo.example.test/x', publishedAt: null },
    });
    const undone = apply(edited, patchRestoring(diffApplications(IMPORTED, edited)));
    expect(applicationsEqual(undone, IMPORTED)).toBe(true);
    expect(JSON.stringify(undone)).toBe(JSON.stringify(IMPORTED));
  });
});

function entry(id: string, at: string, extra: Partial<ApplicationChange> = {}): ApplicationChange {
  return {
    id,
    jobId: 'j',
    at: new Date(at),
    source: 'manual',
    changes: [{ field: 'notes', before: null, after: id }],
    ...extra,
  };
}

describe('analyzeHistory', () => {
  it('offers only the newest entry when nothing was reverted', () => {
    const view = analyzeHistory([entry('e2', '2026-04-02T00:00:00Z'), entry('e1', '2026-04-01T00:00:00Z')]);
    expect(view.undoable).toEqual(['e2']);
    expect([...view.reverted]).toEqual([]);
  });

  it('marks a reverted entry, offers the revert (undo the undo) and the next live entry', () => {
    const view = analyzeHistory([
      entry('r1', '2026-04-03T00:00:00Z', { source: 'revert', revertsId: 'e2' }),
      entry('e2', '2026-04-02T00:00:00Z'),
      entry('e1', '2026-04-01T00:00:00Z'),
    ]);
    expect([...view.reverted]).toEqual(['e2']);
    expect(view.undoable).toEqual(['r1', 'e1']);
  });

  it('undoing the undo makes the original live again and marks the revert as reverted', () => {
    const view = analyzeHistory([
      entry('r2', '2026-04-04T00:00:00Z', { source: 'revert', revertsId: 'r1' }),
      entry('r1', '2026-04-03T00:00:00Z', { source: 'revert', revertsId: 'e2' }),
      entry('e2', '2026-04-02T00:00:00Z'),
      entry('e1', '2026-04-01T00:00:00Z'),
    ]);
    expect([...view.reverted]).toEqual(['r1']);
    expect(view.undoable).toEqual(['r2', 'e2']);
  });

  it('an older revert is no longer undoable once something newer exists', () => {
    const view = analyzeHistory([
      entry('e3', '2026-04-04T00:00:00Z'),
      entry('r1', '2026-04-03T00:00:00Z', { source: 'revert', revertsId: 'e2' }),
      entry('e2', '2026-04-02T00:00:00Z'),
    ]);
    expect(view.undoable).toEqual(['e3']);
  });

  it('is empty for an empty history', () => {
    expect(analyzeHistory([]).undoable).toEqual([]);
  });
});
