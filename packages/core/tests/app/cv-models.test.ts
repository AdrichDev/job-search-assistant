import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCvLibrary } from '../../src/adapters/library/cv-library.js';
import { createJsonCvModelRepository } from '../../src/adapters/persistence/json-cv-model-repository.js';
import {
  listCvModels,
  listRegistrableCandidates,
  registerCvModel,
  removeCvModel,
  updateCvModel,
  type CvModelDeps,
} from '../../src/app/cv-models.js';
import type { CvModelRepository } from '../../src/ports/cv-model-repository.js';
import { createRecordingLogger } from '../helpers/silent-logger.js';
import { makeTempDir, putFile, snapshotTree } from '../helpers/pdf-fixtures.js';

let library: string;
let data: string;
let deps: CvModelDeps;
let logger: ReturnType<typeof createRecordingLogger>;

const INPUT = {
  name: 'CV Java',
  kind: 'cv',
  language: 'es',
  tags: ['Java'],
  relativePath: 'java/cv.pdf',
};

beforeEach(async () => {
  library = await makeTempDir('cv-uc-lib-');
  data = await makeTempDir('cv-uc-data-');
  await putFile(library, 'java/cv.pdf');
  await putFile(library, 'CV Inglés/Letter.PDF');
  await putFile(library, 'foto.jpg', 'x');
  logger = createRecordingLogger();
  deps = {
    repository: createJsonCvModelRepository({ filePath: join(data, 'cv-models.json') }),
    library: createCvLibrary({ root: library }),
    logger,
  };
});

afterEach(async () => {
  await rm(library, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
});

describe('registerCvModel', () => {
  it('registers a safe PDF and returns the model', async () => {
    const result = await registerCvModel(INPUT, deps);
    expect(result.status).toBe('registered');
    if (result.status === 'registered') {
      expect(result.model).toMatchObject({ name: 'CV Java', tags: ['java'], relativePath: 'java/cv.pdf' });
      expect(result.model.id).toMatch(/\S/);
    }
  });

  it('refuses invalid input with the validation reason and registers nothing', async () => {
    expect(await registerCvModel({ ...INPUT, name: '' }, deps)).toEqual({ status: 'refused', reason: 'invalid_name' });
    expect(await registerCvModel(null, deps)).toEqual({ status: 'refused', reason: 'invalid_input' });
    expect(await deps.repository.list()).toEqual([]);
  });

  it('refuses a tampered path, an absolute path and a non-PDF', async () => {
    for (const [relativePath, reason] of [
      ['../secret.pdf', 'invalid_path'],
      ['/etc/x.pdf', 'invalid_path'],
      ['foto.jpg', 'not_pdf'],
      ['missing.pdf', 'not_found'],
    ] as const) {
      expect(await registerCvModel({ ...INPUT, relativePath }, deps)).toEqual({ status: 'refused', reason });
    }
    expect(await deps.repository.list()).toEqual([]);
  });

  it('refuses the same file twice as already_registered', async () => {
    await registerCvModel(INPUT, deps);
    expect(await registerCvModel({ ...INPUT, name: 'Other', relativePath: 'JAVA\\CV.PDF' }, deps)).toEqual({
      status: 'refused',
      reason: 'already_registered',
    });
  });

  it('reports an unreadable registry as registry_unavailable, logs the cause, never throws', async () => {
    const failing: CvModelRepository = {
      list: async () => { throw new Error('boom C:\\secret\\path'); },
      find: async () => { throw new Error('boom'); },
      add: async () => { throw new Error('boom C:\\secret\\path'); },
      update: async () => { throw new Error('boom'); },
      remove: async () => { throw new Error('boom'); },
    };
    const result = await registerCvModel(INPUT, { ...deps, repository: failing });
    expect(result).toEqual({ status: 'registry_unavailable' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(logger.messages.some((entry) => entry.level === 'error')).toBe(true);
  });

  it('never modifies the library', async () => {
    const before = await snapshotTree(library);
    await registerCvModel(INPUT, deps);
    await registerCvModel({ ...INPUT, relativePath: '../x.pdf' }, deps);
    expect(await snapshotTree(library)).toEqual(before);
  });
});

describe('updateCvModel', () => {
  it('updates the editable fields', async () => {
    const registered = await registerCvModel(INPUT, deps);
    if (registered.status !== 'registered') throw new Error('setup');
    const result = await updateCvModel(registered.model.id, { name: 'Nuevo', tags: ['A', 'a', 'b'] }, deps);
    expect(result.status).toBe('updated');
    if (result.status === 'updated') {
      expect(result.model).toMatchObject({ name: 'Nuevo', tags: ['a', 'b'], relativePath: 'java/cv.pdf' });
    }
  });

  it('cannot change the path even when the input tries to', async () => {
    const registered = await registerCvModel(INPUT, deps);
    if (registered.status !== 'registered') throw new Error('setup');
    const result = await updateCvModel(registered.model.id, { name: 'X', relativePath: '../../evil.pdf' }, deps);
    expect(result.status === 'updated' && result.model.relativePath).toBe('java/cv.pdf');
  });

  it('reports refusals, unknown ids and bad ids', async () => {
    const registered = await registerCvModel(INPUT, deps);
    if (registered.status !== 'registered') throw new Error('setup');
    expect(await updateCvModel(registered.model.id, { kind: 'x' }, deps)).toEqual({ status: 'refused', reason: 'invalid_kind' });
    expect(await updateCvModel('nope', { name: 'x' }, deps)).toEqual({ status: 'not_found' });
    expect(await updateCvModel(42, { name: 'x' }, deps)).toEqual({ status: 'not_found' });
    expect(await updateCvModel('', { name: 'x' }, deps)).toEqual({ status: 'not_found' });
  });

  it('an empty patch is refused rather than silently succeeding', async () => {
    const registered = await registerCvModel(INPUT, deps);
    if (registered.status !== 'registered') throw new Error('setup');
    expect(await updateCvModel(registered.model.id, {}, deps)).toEqual({ status: 'refused', reason: 'invalid_input' });
  });
});

describe('removeCvModel', () => {
  it('removes the registry entry and leaves the file on disk', async () => {
    const registered = await registerCvModel(INPUT, deps);
    if (registered.status !== 'registered') throw new Error('setup');
    const before = await snapshotTree(library);

    expect(await removeCvModel(registered.model.id, deps)).toEqual({ status: 'removed' });
    expect(await deps.repository.list()).toEqual([]);
    expect(await snapshotTree(library)).toEqual(before);
    expect((await deps.library.resolveModelFile('java/cv.pdf')).status).toBe('ok');
  });

  it('reports not_found for unknown or non-string ids', async () => {
    expect(await removeCvModel('nope', deps)).toEqual({ status: 'not_found' });
    expect(await removeCvModel(undefined, deps)).toEqual({ status: 'not_found' });
  });
});

describe('listCvModels', () => {
  it('annotates availability and shows a missing file as unavailable instead of crashing', async () => {
    await registerCvModel(INPUT, deps);
    await registerCvModel({ ...INPUT, name: 'Letter', kind: 'letter', relativePath: 'CV Inglés/Letter.PDF' }, deps);

    let listing = await listCvModels(deps);
    expect(listing.status === 'ok' && listing.models.map((entry) => entry.available)).toEqual([true, true]);

    await rm(join(library, 'java', 'cv.pdf'));
    listing = await listCvModels(deps);
    expect(listing.status).toBe('ok');
    if (listing.status === 'ok') {
      expect(listing.models.map((entry) => [entry.model.name, entry.available])).toEqual([
        ['CV Java', false],
        ['Letter', true],
      ]);
    }
  });

  it('marks everything unavailable when the library root is gone', async () => {
    await registerCvModel(INPUT, deps);
    await rm(library, { recursive: true, force: true });
    const listing = await listCvModels(deps);
    expect(listing.status === 'ok' && listing.models[0]?.available).toBe(false);
  });

  it('reports a corrupt registry as registry_unavailable', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(data, 'cv-models.json'), '{nope', 'utf8');
    expect(await listCvModels(deps)).toEqual({ status: 'registry_unavailable' });
  });
});

describe('listRegistrableCandidates', () => {
  it('lists PDFs that are not registered yet', async () => {
    await registerCvModel(INPUT, deps);
    const result = await listRegistrableCandidates(deps);
    expect(result).toEqual({ status: 'ok', candidates: ['CV Inglés/Letter.PDF'], truncated: false });
  });

  it('reports an unusable library', async () => {
    await rm(library, { recursive: true, force: true });
    expect(await listRegistrableCandidates(deps)).toEqual({ status: 'library_unavailable' });
  });

  it('reports an unreadable registry', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(data, 'cv-models.json'), '{nope', 'utf8');
    expect(await listRegistrableCandidates(deps)).toEqual({ status: 'registry_unavailable' });
  });
});
