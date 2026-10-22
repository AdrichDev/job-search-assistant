import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUEUE_FILTERS,
  parseQueueFilters,
  queueFiltersToQuery,
} from '@/lib/queue-filters';

const SOURCES = ['infojobs', 'indeed'];

describe('parseQueueFilters', () => {
  it('returns the defaults for an empty URL', () => {
    expect(parseQueueFilters({}, SOURCES)).toEqual(DEFAULT_QUEUE_FILTERS);
  });

  it('reads every filter it knows', () => {
    expect(
      parseQueueFilters({ cv: 'frontend', fuente: 'indeed', estado: 'applied', q: 'react' }, SOURCES),
    ).toEqual({ cv: 'frontend', fuente: 'indeed', estado: 'applied', q: 'react' });
  });

  it('ignores a value it does not know instead of passing it through', () => {
    expect(
      parseQueueFilters({ cv: 'senior', fuente: 'milanuncios', estado: 'hired' }, SOURCES),
    ).toEqual(DEFAULT_QUEUE_FILTERS);
  });

  it('takes the first value when the URL repeats a parameter', () => {
    expect(parseQueueFilters({ cv: ['general', 'frontend'] }, SOURCES).cv).toBe('general');
  });

  it('never lets an over-long search string through', () => {
    expect(parseQueueFilters({ q: 'a'.repeat(500) }, SOURCES).q).toHaveLength(120);
  });
});

describe('queueFiltersToQuery', () => {
  it('is empty when nothing differs from the default', () => {
    expect(queueFiltersToQuery(DEFAULT_QUEUE_FILTERS)).toBe('');
  });

  it('keeps a stable order and only the values that differ', () => {
    expect(
      queueFiltersToQuery({ cv: 'general', fuente: 'all', estado: 'not_applied', q: 'java' }),
    ).toBe('?cv=general&estado=not_applied&q=java');
  });

  it('drops a search that is only spaces', () => {
    expect(queueFiltersToQuery({ ...DEFAULT_QUEUE_FILTERS, q: '   ' })).toBe('');
  });

  it('round-trips through the parser', () => {
    const filters = { cv: 'microsoft', fuente: 'indeed', estado: 'applied' as const, q: 'power bi' };
    const query = queueFiltersToQuery(filters);
    const parsed = parseQueueFilters(
      Object.fromEntries(new URLSearchParams(query.slice(1))),
      SOURCES,
    );
    expect(parsed).toEqual(filters);
  });
});
