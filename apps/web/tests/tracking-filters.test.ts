import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACKING_FILTERS,
  countUnderFilters,
  filterTrackedRows,
  parseTrackingFilters,
  portalOptions,
  trackingFiltersToQuery,
  type TrackableApplicationRow,
} from '@/lib/tracking-filters';

/** Minimal row shape; `TrackedApplication` satisfies it structurally. */
function row(overrides: Partial<TrackableApplicationRow>): TrackableApplicationRow {
  return {
    company: 'Empresa',
    title: 'Puesto',
    appliedAt: new Date('2026-03-01T00:00:00Z'),
    outcome: 'applied',
    ...overrides,
  };
}

const ROWS: readonly TrackableApplicationRow[] = [
  row({
    company: 'Información Ñandú S.L.',
    title: 'Desarrollador Frontend',
    city: 'Alcobendas',
    portal: 'InfoJobs',
    outcome: 'applied',
    appliedAt: new Date('2026-03-01T00:00:00Z'),
    publishedAt: new Date('2026-02-27T00:00:00Z'),
  }),
  row({
    company: 'Cañas y Tapas Tech',
    title: 'Programador Júnior',
    city: 'Madrid',
    portal: 'Web de la empresa',
    outcome: 'rejected',
    appliedAt: new Date('2026-02-20T00:00:00Z'),
  }),
  row({
    company: 'ACME',
    title: 'Junior Frontend Developer',
    // No city and no portal: a queue-made row whose job left the queue.
    outcome: 'offer',
    appliedAt: new Date('2026-03-05T00:00:00Z'),
  }),
];

describe('parseTrackingFilters', () => {
  it('returns the defaults for an empty URL', () => {
    expect(parseTrackingFilters({}, [])).toEqual(DEFAULT_TRACKING_FILTERS);
  });

  it('reads every filter it knows', () => {
    expect(
      parseTrackingFilters(
        {
          empresa: 'ñandú',
          puesto: 'frontend',
          ciudad: 'Alcobendas',
          portal: 'InfoJobs',
          estado: 'rejected',
          contestado: 'si',
          desde: '2026-01-01',
          hasta: '2026-03-31',
          'publicada-desde': '2026-01-01',
          'publicada-hasta': '2026-02-28',
        },
        ['InfoJobs'],
      ),
    ).toEqual({
      ...DEFAULT_TRACKING_FILTERS,
      empresa: 'ñandú',
      puesto: 'frontend',
      ciudad: 'Alcobendas',
      portal: 'InfoJobs',
      estado: 'rejected',
      contestado: 'si',
      desde: '2026-01-01',
      hasta: '2026-03-31',
      publicadaDesde: '2026-01-01',
      publicadaHasta: '2026-02-28',
    });
  });

  it('falls back to the default for values it does not know', () => {
    expect(
      parseTrackingFilters({ estado: 'hired', contestado: 'quizá', portal: 'milanuncios' }, ['InfoJobs']),
    ).toEqual(DEFAULT_TRACKING_FILTERS);
  });

  it('rejects a malformed date instead of passing it through', () => {
    expect(parseTrackingFilters({ desde: '31/02/2026' }, []).desde).toBe('');
    expect(parseTrackingFilters({ hasta: 'not-a-date' }, []).hasta).toBe('');
    expect(parseTrackingFilters({ 'publicada-hasta': '2026-13-01' }, []).publicadaHasta).toBe('');
  });

  it('accepts a real calendar day in ISO form', () => {
    expect(parseTrackingFilters({ desde: '2026-02-29' }, []).desde).toBe('2026-02-29');
  });

  it('takes the first value when the URL repeats a parameter', () => {
    expect(parseTrackingFilters({ empresa: ['acme', 'globex'] }, []).empresa).toBe('acme');
  });

  it('never lets an over-long text filter through', () => {
    expect(parseTrackingFilters({ empresa: 'a'.repeat(500) }, []).empresa).toHaveLength(120);
  });

  it('parses the page like the rest of the app: unusable means 1', () => {
    expect(parseTrackingFilters({ pagina: '2' }, []).pagina).toBe(2);
    expect(parseTrackingFilters({ pagina: 'abc' }, []).pagina).toBe(1);
    expect(parseTrackingFilters({ pagina: '0' }, []).pagina).toBe(1);
  });
});

describe('filterTrackedRows', () => {
  it('returns every row when nothing is active', () => {
    expect(filterTrackedRows(ROWS, DEFAULT_TRACKING_FILTERS)).toHaveLength(3);
  });

  it('matches text case-insensitively and by substring', () => {
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, empresa: 'ñandú' })).toHaveLength(1);
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, puesto: 'FRONTEND' })).toHaveLength(2);
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, ciudad: 'madrid' })).toHaveLength(1);
  });

  it('combines every active filter with AND', () => {
    const filters = { ...DEFAULT_TRACKING_FILTERS, empresa: 'ñandú', estado: 'applied' as const };
    expect(filterTrackedRows(ROWS, filters)).toHaveLength(1);
    const contradiction = { ...filters, estado: 'rejected' as const };
    expect(filterTrackedRows(ROWS, contradiction)).toHaveLength(0);
  });

  it('drops rows without the facet a text filter needs', () => {
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, ciudad: 'a' })).toHaveLength(2);
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, portal: 'InfoJobs' })).toHaveLength(1);
  });

  it('reads ¿han contestado? off the outcome, not off a stored field', () => {
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, contestado: 'si' })).toHaveLength(2);
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, contestado: 'no' })).toHaveLength(1);
  });

  it('filters by application date, inclusive on both ends', () => {
    expect(
      filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, desde: '2026-02-20', hasta: '2026-03-01' }),
    ).toHaveLength(2);
    expect(filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, desde: '2026-03-02' })).toHaveLength(1);
  });

  it('filters by publication date and drops rows that have none', () => {
    expect(
      filterTrackedRows(ROWS, { ...DEFAULT_TRACKING_FILTERS, publicadaHasta: '2026-02-28' }),
    ).toHaveLength(1);
  });
});

describe('countUnderFilters', () => {
  it('counts every estado under every filter EXCEPT the estado itself', () => {
    const counts = countUnderFilters(ROWS, {
      ...DEFAULT_TRACKING_FILTERS,
      empresa: 'a', // matches all three companies
      contestado: 'no',
    });
    expect(counts.applied).toBe(1);
    expect(counts.rejected).toBe(0);
    expect(counts.offer).toBe(0);
  });

  it('counts zeros too, so a filter link can always be shown', () => {
    const counts = countUnderFilters([], DEFAULT_TRACKING_FILTERS);
    expect(counts).toEqual({
      applied: 0,
      no_reply: 0,
      rejected: 0,
      screening: 0,
      interview: 0,
      offer: 0,
    });
  });
});

describe('trackingFiltersToQuery', () => {
  it('is empty when nothing differs from the default', () => {
    expect(trackingFiltersToQuery(DEFAULT_TRACKING_FILTERS)).toBe('');
  });

  it('writes only the values that differ, in a stable order', () => {
    expect(
      trackingFiltersToQuery({
        ...DEFAULT_TRACKING_FILTERS,
        empresa: 'acme',
        estado: 'rejected',
        desde: '2026-01-01',
      }),
    ).toBe('?empresa=acme&estado=rejected&desde=2026-01-01');
  });

  it('encodes accents and spaces so a link can carry them', () => {
    // URLSearchParams spells a space `+`; what matters is that the value survives.
    const query = trackingFiltersToQuery({ ...DEFAULT_TRACKING_FILTERS, empresa: 'Ñandú S.L.' });
    expect(query).toContain('%C3%91and%C3%BA');
    expect(
      parseTrackingFilters(Object.fromEntries(new URLSearchParams(query.slice(1))), []).empresa,
    ).toBe('Ñandú S.L.');
  });

  it('writes the page only when it is not the first', () => {
    expect(trackingFiltersToQuery({ ...DEFAULT_TRACKING_FILTERS, pagina: 3 })).toBe('?pagina=3');
  });

  it('round-trips through the parser', () => {
    const filters = {
      ...DEFAULT_TRACKING_FILTERS,
      empresa: 'Ñandú',
      puesto: 'frontend',
      ciudad: 'Alcobendas',
      portal: 'InfoJobs',
      estado: 'screening' as const,
      contestado: 'si' as const,
      desde: '2026-01-01',
      hasta: '2026-03-31',
      publicadaDesde: '2026-01-01',
      publicadaHasta: '2026-02-28',
      pagina: 2,
    };
    const query = trackingFiltersToQuery(filters);
    const parsed = parseTrackingFilters(
      Object.fromEntries(new URLSearchParams(query.slice(1))),
      ['InfoJobs'],
    );
    expect(parsed).toEqual(filters);
  });
});

describe('portalOptions', () => {
  it('lists each portal once with its count, sorted by count then name', () => {
    expect(portalOptions([...ROWS, row({ portal: 'InfoJobs' })])).toEqual([
      { value: 'InfoJobs', count: 2 },
      { value: 'Web de la empresa', count: 1 },
    ]);
  });

  it('skips rows without a portal', () => {
    expect(portalOptions([ROWS[2]!])).toEqual([]);
  });
});
