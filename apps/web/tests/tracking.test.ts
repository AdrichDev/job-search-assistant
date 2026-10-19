import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  type Application,
  type ApplicationRepository,
  type JobQueue,
  type QueueReader,
} from '@job-queue/core';
import {
  filterTrackedRows,
  loadTracking,
  parseEstadoFilter,
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
