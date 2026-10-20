import { describe, expect, it } from 'vitest';
import {
  computeApplicationStats,
  createApplication,
  type CvModel,
  type CvModelRepository,
  type QueueReader,
} from '@job-queue/core';
import { describeDocuments } from '@/components/documents-format';
import { describeChangeValue, historyFieldLabel } from '@/components/history-format';
import { buildModelStatsRows } from '@/components/model-stats-format';
import { ES } from '@/copy/es';
import { buildModelSelect, loadModelCatalog, resolveModel } from '@/server/model-catalog';
import { loadTracking } from '@/server/tracking';
import { createStubRepository } from './helpers/stub-repository';

function model(id: string, name: string, kind: 'cv' | 'letter', language: 'es' | 'en' = 'es'): CvModel {
  return { id, name, kind, language, tags: [], relativePath: `${id}.pdf`, registeredAt: new Date('2026-09-01T00:00:00Z') };
}

const CV = model('cv-1', 'CV Desarrollador Ñ', 'cv');
const CV_EN = model('cv-2', 'CV Software Developer', 'cv', 'en');
const LETTER = model('let-1', 'Carta Base', 'letter');

function registry(models: readonly CvModel[], counter?: { list: number; find: number }): CvModelRepository {
  return {
    list: async () => {
      if (counter) counter.list += 1;
      return models;
    },
    find: async (id) => {
      if (counter) counter.find += 1;
      return models.find((m) => m.id === id) ?? null;
    },
    add: async () => {
      throw new Error('read-only');
    },
    update: async () => {
      throw new Error('read-only');
    },
    remove: async () => {
      throw new Error('read-only');
    },
  };
}

const failing: CvModelRepository = {
  ...registry([]),
  list: async () => {
    throw new Error('EACCES D:\\secret\\cv-models.json');
  },
};

describe('model catalog', () => {
  it('loads the registry once and resolves names', async () => {
    const counter = { list: 0, find: 0 };
    const catalog = await loadModelCatalog(registry([CV, LETTER], counter));
    expect(counter).toEqual({ list: 1, find: 0 });
    expect(catalog.unavailable).toBe(false);
    expect(resolveModel(catalog, 'cv-1')).toEqual({ state: 'found', text: 'CV Desarrollador Ñ' });
  });

  it('marks a missing id as not registered anymore', async () => {
    const catalog = await loadModelCatalog(registry([CV]));
    expect(resolveModel(catalog, 'gone')).toEqual({ state: 'dangling', text: ES.models.notRegisteredAnymore });
  });

  it('degrades a failing registry to unavailable, without raw error text', async () => {
    const catalog = await loadModelCatalog(failing);
    expect(catalog.unavailable).toBe(true);
    const ref = resolveModel(catalog, 'cv-1');
    expect(ref.state).toBe('unavailable');
    expect(JSON.stringify(ref)).not.toMatch(/EACCES|secret/);
  });

  it('treats a missing repository as an empty, available registry', async () => {
    expect(await loadModelCatalog(undefined)).toEqual({ models: [], unavailable: false });
  });
});

describe('buildModelSelect', () => {
  it('offers only models of the kind, with name and language, and an empty first option', async () => {
    const catalog = await loadModelCatalog(registry([CV, CV_EN, LETTER]));
    const select = buildModelSelect(catalog, 'cv', '');
    expect(select.disabled).toBe(false);
    expect(select.options.map((o) => o.value)).toEqual(['', 'cv-1', 'cv-2']);
    expect(select.options[1]?.label).toBe(`CV Desarrollador Ñ (${ES.models.languages.es})`);
    expect(select.options[2]?.label).toContain(ES.models.languages.en);
    expect(buildModelSelect(catalog, 'letter', '').options.map((o) => o.value)).toEqual(['', 'let-1']);
  });

  it('is disabled when the registry has no model of that kind and nothing is stored', async () => {
    const catalog = await loadModelCatalog(registry([LETTER]));
    expect(buildModelSelect(catalog, 'cv', '')).toMatchObject({ disabled: true });
    expect((await loadModelCatalog(registry([]))).models).toEqual([]);
  });

  it('keeps a dangling stored id as a labelled extra option and stays usable', async () => {
    const catalog = await loadModelCatalog(registry([]));
    const select = buildModelSelect(catalog, 'cv', 'gone-id');
    expect(select.disabled).toBe(false);
    expect(select.options).toEqual([
      { value: '', label: ES.edit.fields.noModel },
      { value: 'gone-id', label: ES.edit.fields.danglingModel('gone-id') },
    ]);
    expect(ES.edit.fields.danglingModel('x')).toContain('Modelo ya no registrado');
  });

  it('keeps a stored id of the wrong kind selectable (shown as extra) so it survives', async () => {
    const catalog = await loadModelCatalog(registry([CV, LETTER]));
    const select = buildModelSelect(catalog, 'cv', 'let-1');
    expect(select.options.some((o) => o.value === 'let-1')).toBe(true);
  });

  it('when the registry is unreadable keeps the stored id and is flagged unavailable', async () => {
    const catalog = await loadModelCatalog(failing);
    const select = buildModelSelect(catalog, 'cv', 'cv-1');
    expect(select.unavailable).toBe(true);
    expect(select.options.map((o) => o.value)).toEqual(['', 'cv-1']);
  });
});

describe('describeDocuments (tracking column)', () => {
  it('shows resolved CV and letter names', async () => {
    const catalog = await loadModelCatalog(registry([CV, LETTER]));
    expect(describeDocuments({ cvModelId: 'cv-1', letterModelId: 'let-1' }, catalog)).toEqual([
      { label: ES.tracking.documents.cv, text: 'CV Desarrollador Ñ', tone: 'normal' },
      { label: ES.tracking.documents.letter, text: 'Carta Base', tone: 'normal' },
    ]);
  });

  it('shows the dangling label for an id that left the registry', async () => {
    const catalog = await loadModelCatalog(registry([]));
    expect(describeDocuments({ cvModelId: 'gone' }, catalog)).toEqual([
      { label: ES.tracking.documents.cv, text: 'Modelo ya no registrado', tone: 'warning' },
    ]);
  });

  it('falls back to the legacy variant when there is no model, else to nothing', async () => {
    const catalog = await loadModelCatalog(registry([]));
    const legacy = describeDocuments({ cvVariant: 'microsoft' }, catalog);
    expect(legacy).toHaveLength(1);
    expect(legacy[0]?.tone).toBe('legacy');
    expect(legacy[0]?.text).toContain(ES.cvVariant.microsoft);
    expect(describeDocuments({}, catalog)).toEqual([]);
    expect(describeDocuments(undefined, catalog)).toEqual([]);
  });

  it('prefers the model over the legacy variant', async () => {
    const catalog = await loadModelCatalog(registry([CV]));
    const lines = describeDocuments({ cvVariant: 'general', cvModelId: 'cv-1' }, catalog);
    expect(lines.map((l) => l.text)).toEqual(['CV Desarrollador Ñ']);
  });
});

describe('loadTracking with models', () => {
  const noQueue: QueueReader = { read: async () => null };
  const WITH = createApplication({
    jobId: 'import-1',
    appliedAt: new Date('2026-02-03T00:00:00Z'),
    cvModelId: 'cv-1',
    letterModelId: 'let-1',
    listing: { company: 'Información Ñandú', title: 'Dev' },
  });
  const LEGACY = createApplication({
    jobId: 'beta sl::qa::barcelona',
    appliedAt: new Date('2026-03-01T00:00:00Z'),
    cvVariant: 'frontend',
  });
  const OTHER = createApplication({
    jobId: 'import-2',
    appliedAt: new Date('2026-03-02T00:00:00Z'),
    cvModelId: 'gone',
    listing: { company: 'Otra', title: 'Dev' },
  });

  it('reads the registry once for the whole page and exposes the references per job', async () => {
    const counter = { list: 0, find: 0 };
    const data = await loadTracking({
      applicationRepository: createStubRepository([WITH, LEGACY, OTHER]),
      queueReader: noQueue,
      cvModelRepository: registry([CV, LETTER], counter),
    });
    expect(counter).toEqual({ list: 1, find: 0 });
    expect(data.documents.get('import-1')).toEqual({ cvModelId: 'cv-1', letterModelId: 'let-1' });
    expect(data.documents.get('beta sl::qa::barcelona')).toEqual({ cvVariant: 'frontend' });
    expect(resolveModel(data.catalog, 'gone').state).toBe('dangling');
  });

  it('warns (without raw text) when the registry cannot be read and still lists everything', async () => {
    const data = await loadTracking({
      applicationRepository: createStubRepository([WITH]),
      queueReader: noQueue,
      cvModelRepository: failing,
    });
    expect(data.rows).toHaveLength(1);
    expect(data.warnings.map((w) => w.kind)).toContain('models');
    expect(JSON.stringify(data.warnings)).not.toMatch(/EACCES|secret/);
  });

  it('adds no warning and no registry read when no application carries a model reference', async () => {
    const counter = { list: 0, find: 0 };
    const data = await loadTracking({
      applicationRepository: createStubRepository([LEGACY]),
      queueReader: noQueue,
      cvModelRepository: registry([CV], counter),
    });
    expect(data.warnings).toEqual([]);
    expect(counter.list).toBe(0);
  });
});

describe('history labels for the model fields', () => {
  it('has Spanish labels', () => {
    expect(historyFieldLabel('cvModelId')).toBe('Modelo de CV');
    expect(historyFieldLabel('letterModelId')).toBe('Modelo de carta');
  });

  it('shows names resolved at display time, dangling fallback, and empty for null', async () => {
    const catalog = await loadModelCatalog(registry([CV]));
    expect(describeChangeValue('cvModelId', 'cv-1', catalog)).toEqual({ text: 'CV Desarrollador Ñ', empty: false });
    expect(describeChangeValue('letterModelId', 'gone', catalog)).toEqual({
      text: 'Modelo ya no registrado',
      empty: false,
    });
    expect(describeChangeValue('cvModelId', null, catalog)).toEqual({ text: ES.history.emptyValue, empty: true });
  });

  it('never shows the raw id when the registry is unavailable', async () => {
    const catalog = await loadModelCatalog(failing);
    const shown = describeChangeValue('cvModelId', 'cv-1', catalog);
    expect(shown.text).toBe(ES.models.nameUnavailable);
  });
});

describe('model stats rows', () => {
  it('resolves names once, keeps dangling rows and the counts', async () => {
    const apps = [
      createApplication({ jobId: 'a', appliedAt: new Date('2026-01-01Z'), cvModelId: 'cv-1' }),
      createApplication({ jobId: 'b', appliedAt: new Date('2026-01-01Z'), cvModelId: 'cv-1' }),
      createApplication({ jobId: 'c', appliedAt: new Date('2026-01-01Z'), cvModelId: 'gone' }),
      createApplication({ jobId: 'd', appliedAt: new Date('2026-01-01Z') }),
    ];
    const stats = computeApplicationStats(apps);
    const catalog = await loadModelCatalog(registry([CV]));
    const rows = buildModelStatsRows(stats.byModel, catalog);
    expect(rows.map((r) => [r.key, r.label, r.applied])).toEqual([
      ['cv-1', 'CV Desarrollador Ñ', 2],
      ['gone', 'Modelo ya no registrado', 1],
    ]);
  });
});
