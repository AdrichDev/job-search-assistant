import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  type Application,
  type ApplicationOutcome,
  type ApplicationRepository,
  type JobQueue,
  type QueueReader,
} from '@job-queue/core';
import type { TrackedApplication } from '@job-queue/core';
import {
  filterTrackedRows,
  loadTracking,
  paginateRows,
  parseEstadoFilter,
  parsePagina,
  TRACKING_PAGE_SIZE,
  type TrackingDeps,
} from '@/server/tracking';
import { trackingSourceLabels, formatTrackingDate } from '@/components/tracking-format';
import { ES } from '@/copy/es';
import { createStubRepository } from './helpers/stub-repository';

/** Shaped like the real log: imported rows have a listing and no cvVariant/score. */
const IMPORTED = createApplication({
  jobId: 'import-1a2b',
  appliedAt: new Date('2026-02-03T00:00:00Z'),
  sourceIds: ['web-de-la-empresa'],
  outcome: 'screening',
  outcomeUpdatedAt: new Date('2026-02-10T00:00:00Z'),
  listing: { company: 'Información Ñandú', title: 'Desarrollador Júnior', url: 'https://x.test/o/1' },
});
const LEGACY = createApplication({
  jobId: 'beta sl::qa júnior::barcelona',
  appliedAt: new Date('2026-03-01T00:00:00Z'),
});
const IN_QUEUE = createApplication({
  jobId: 'acme::junior dev::madrid',
  appliedAt: new Date('2026-03-05T00:00:00Z'),
  cvVariant: 'frontend',
  scoreAtApply: 70,
});

const emptyQueueReader: QueueReader = { read: async () => null };

function queueWith(jobs: unknown[]): QueueReader {
  return { read: async () => ({ jobs }) as unknown as JobQueue };
}

const deps = (applications: readonly Application[], queueReader = emptyQueueReader): TrackingDeps => ({
  applicationRepository: createStubRepository(applications),
  queueReader,
});

describe('parseEstadoFilter', () => {
  it('accepts every outcome', () => {
    for (const outcome of APPLICATION_OUTCOMES) {
      expect(parseEstadoFilter(outcome)).toBe(outcome);
    }
  });

  it.each([undefined, '', 'all', 'todas', 'REJECTED', '__proto__', 'constructor', ['rejected', 'offer']])(
    'falls back to all for %j',
    (raw) => {
      expect(parseEstadoFilter(raw as string | string[] | undefined)).toBe('all');
    },
  );
});

describe('loadTracking', () => {
  it('lists imported, legacy and queue-made applications newest first', async () => {
    const data = await loadTracking(
      deps(
        [IMPORTED, LEGACY, IN_QUEUE],
        queueWith([
          {
            id: 'acme::junior dev::madrid',
            company: 'ACME',
            title: 'Junior Dev',
            location: 'Madrid',
            url: 'https://acme.test/1',
            sources: [{ sourceId: 'greenhouse' }],
          },
        ]),
      ),
    );

    expect(data.rows.map((r) => r.company)).toEqual(['ACME', 'beta sl', 'Información Ñandú']);
    expect(data.counts.screening).toBe(1);
    expect(data.counts.applied).toBe(2);
    expect(data.counts.offer).toBe(0);
    expect(data.warnings).toEqual([]);
  });

  it('degrades to a warning when the application log cannot be read', async () => {
    const failing: ApplicationRepository = {
      ...createStubRepository([]),
      list: async () => {
        throw new Error('corrupt log');
      },
    };
    const data = await loadTracking({ applicationRepository: failing, queueReader: emptyQueueReader });

    expect(data.rows).toEqual([]);
    expect(data.warnings).toEqual([{ kind: 'applications', detail: 'corrupt log' }]);
  });

  it('still shows applications when the queue cannot be read', async () => {
    const data = await loadTracking({
      applicationRepository: createStubRepository([LEGACY, IMPORTED]),
      queueReader: {
        read: async () => {
          throw new Error('bad queue');
        },
      },
    });

    expect(data.rows).toHaveLength(2);
    expect(data.warnings).toEqual([{ kind: 'queue', detail: 'bad queue' }]);
  });
});

describe('filterTrackedRows', () => {
  it('keeps one outcome, or everything for all', async () => {
    const { rows } = await loadTracking(deps([IMPORTED, LEGACY]));
    expect(filterTrackedRows(rows, 'all')).toHaveLength(2);
    expect(filterTrackedRows(rows, 'screening').map((r) => r.jobId)).toEqual(['import-1a2b']);
    expect(filterTrackedRows(rows, 'offer')).toEqual([]);
  });
});

describe('parsePagina', () => {
  it.each([
    [undefined, 1],
    [['2'], 1],
    ['', 1],
    ['   ', 1],
    ['abc', 1],
    ['0', 1],
    ['-3', 1],
    ['1.5', 1],
    // Beyond the double range Number yields Infinity, which is not an integer.
    ['1e999', 1],
    ['NaN', 1],
    ['Infinity', 1],
    ['1', 1],
    ['7', 7],
    ['  3  ', 3],
    // Finite though huge: kept, and clamped to the last page by paginateRows.
    ['1e21', 1e21],
  ] as readonly (readonly [string | string[] | undefined, number])[])('parses %j to %j', (raw, expected) => {
    expect(parsePagina(raw)).toBe(expected);
  });
});

function trackedRow(jobId: string, outcome: ApplicationOutcome = 'applied'): TrackedApplication {
  return {
    jobId,
    company: `Empresa ${jobId}`,
    title: `Puesto ${jobId}`,
    sourceIds: [],
    appliedAt: new Date(0),
    outcome,
    outcomeUpdatedAt: new Date(0),
    origin: 'imported',
  };
}

function rows(count: number): TrackedApplication[] {
  return Array.from({ length: count }, (_unused, index) => trackedRow(`r${String(index + 1).padStart(2, '0')}`));
}

describe('paginateRows', () => {
  it('pages 10 rows at a time', () => {
    expect(TRACKING_PAGE_SIZE).toBe(10);
  });

  it('stays on page 1 with zero rows, and still reports one page', () => {
    expect(paginateRows([], 1)).toEqual({
      rows: [],
      page: 1,
      totalPages: 1,
      total: 0,
      from: 0,
      to: 0,
    });
  });

  it('shows one row on one page', () => {
    const result = paginateRows(rows(1), 1);
    expect(result.rows).toHaveLength(1);
    expect(result.totalPages).toBe(1);
    expect(result.from).toBe(1);
    expect(result.to).toBe(1);
  });

  it('fits exactly 10 rows on the only page', () => {
    const result = paginateRows(rows(10), 1);
    expect(result.rows).toHaveLength(10);
    expect(result.totalPages).toBe(1);
    expect(result.from).toBe(1);
    expect(result.to).toBe(10);
  });

  it('splits 11 rows into two pages with one row on the second', () => {
    const all = rows(11);
    const first = paginateRows(all, 1);
    expect(first.rows).toHaveLength(10);
    expect(first.totalPages).toBe(2);
    expect(first.from).toBe(1);
    expect(first.to).toBe(10);

    const second = paginateRows(all, 2);
    expect(second.rows.map((r) => r.jobId)).toEqual(['r11']);
    expect(second.page).toBe(2);
    expect(second.from).toBe(11);
    expect(second.to).toBe(11);
  });

  it('splits 25 rows into three pages of 10, 10 and 5', () => {
    const all = rows(25);
    expect(paginateRows(all, 1).rows).toHaveLength(10);
    expect(paginateRows(all, 2).rows).toHaveLength(10);
    const last = paginateRows(all, 3);
    expect(last.rows).toHaveLength(5);
    expect(last.from).toBe(21);
    expect(last.to).toBe(25);
  });

  it('clamps an out-of-range page into [1, totalPages]', () => {
    expect(paginateRows(rows(25), 99).page).toBe(3);
    expect(paginateRows(rows(25), 99).rows).toHaveLength(5);
    expect(paginateRows(rows(25), 0).page).toBe(1);
    expect(paginateRows(rows(25), -7).page).toBe(1);
  });

  it('clamps an absurdly large but finite page to the last one', () => {
    expect(paginateRows(rows(25), 1e21).page).toBe(3);
  });
});

describe('filter before pagination', () => {
  it('paginates the filtered subset, not the whole log', () => {
    const mixed: TrackedApplication[] = [
      ...rows(11),
      trackedRow('r-rechazada', 'rejected'),
      trackedRow('r-oferta', 'offer'),
    ];
    const filtered = filterTrackedRows(mixed, 'rejected');

    const paginated = paginateRows(filtered, 1);
    expect(paginated.total).toBe(1);
    expect(paginated.totalPages).toBe(1);
    expect(paginated.rows.map((r) => r.jobId)).toEqual(['r-rechazada']);
  });
});

describe('tracking presentation helpers', () => {
  it('labels imported portal slugs in Spanish instead of "unknown source"', () => {
    for (const id of [
      'infojobs', 'web-de-la-empresa', 'linkedin', 'indeed', 'tecnoempleo',
      'michael-page', 'juniorjobs', 'adzuna', 'empleosit', 'wizbii',
    ]) {
      expect(trackingSourceLabels({ sourceIds: [id] }), id).not.toEqual([expect.stringContaining('desconocida')]);
    }
    expect(trackingSourceLabels({ sourceIds: ['web-de-la-empresa'] })).toEqual(['Web de la empresa']);
    expect(trackingSourceLabels({ sourceIds: ['greenhouse'] })).toEqual(['Greenhouse']);
  });

  it('uses the portal text the user wrote when the slug has no built-in label', () => {
    expect(trackingSourceLabels({ sourceIds: ['freehire'], portal: 'Freehire' })).toEqual(['Freehire']);
  });

  it('still shows the unknown-source message for an unknown id with no portal text', () => {
    expect(trackingSourceLabels({ sourceIds: ['mystery'] })[0]).toMatch(/desconocida/i);
  });

  it('falls back to the portal text, then to a visible "not recorded"', () => {
    expect(trackingSourceLabels({ sourceIds: [], portal: 'Portal X' })).toEqual(['Portal X']);
    expect(trackingSourceLabels({ sourceIds: [] })).toEqual([ES.source.noSources]);
    expect(trackingSourceLabels({ sourceIds: ['rarisimo'] })).toEqual(['Fuente desconocida (rarisimo)']);
  });

  it('formats dates in Spanish', () => {
    expect(formatTrackingDate(new Date('2026-02-03T12:00:00Z'))).toBe('3 feb 2026');
  });
});

describe('tracking copy', () => {
  it('agrees in number', () => {
    expect(ES.tracking.total(1)).toBe('1 postulación');
    expect(ES.tracking.total(258)).toBe('258 postulaciones');
    expect(ES.tracking.showingRange(11, 20, 260)).toBe('Mostrando 11–20 de 260 postulaciones');
  });

  it('has Spanish sentences for every warning kind and every column', () => {
    for (const text of [
      ES.tracking.heading, ES.tracking.caption, ES.tracking.openOffer, ES.tracking.emptyAllTitle,
      ES.tracking.warning.applications('x'), ES.tracking.warning.queue('x'),
      ...Object.values(ES.tracking.columns),
    ]) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
    expect(ES.tracking.nav.offers).toBe('Ofertas');
    expect(ES.tracking.nav.tracking).toBe('Seguimiento');
    expect(ES.tracking.filter.all).toBe('Todas');
  });
});
