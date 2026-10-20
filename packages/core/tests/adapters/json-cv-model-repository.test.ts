import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonCvModelRepository } from '../../src/adapters/persistence/json-cv-model-repository.js';
import type { CvModelDraft } from '../../src/domain/cv-model.js';
import type { CvModelRepository } from '../../src/ports/cv-model-repository.js';
import { makeTempDir } from '../helpers/pdf-fixtures.js';

const NOW = new Date('2026-05-01T10:00:00.000Z');

let directory: string;
let filePath: string;
let repository: CvModelRepository;
let counter = 0;

function newRepository(): CvModelRepository {
  return createJsonCvModelRepository({
    filePath,
    newId: () => `id-${(counter += 1)}`,
    now: () => NOW,
  });
}

function draft(name: string, relativePath: string, extra: Partial<CvModelDraft> = {}): CvModelDraft {
  return { name, kind: 'cv', language: 'es', tags: [], relativePath, ...extra };
}

beforeEach(async () => {
  directory = await makeTempDir('cv-models-');
  filePath = join(directory, 'cv-models.json');
  counter = 0;
  repository = newRepository();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createJsonCvModelRepository', () => {
  it('treats a missing file as an empty registry and does not create it on read', async () => {
    expect(await repository.list()).toEqual([]);
    expect(await repository.find('nope')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('adds a model with a generated id and the registration date, and persists it', async () => {
    const result = await repository.add(draft('Java', 'java/cv.pdf', { tags: ['java'], note: 'n' }));

    expect(result.status).toBe('added');
    if (result.status !== 'added') return;
    expect(result.model).toMatchObject({ id: 'id-1', name: 'Java', registeredAt: NOW, note: 'n' });

    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as { version: number; models: unknown[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.models).toHaveLength(1);
    expect(await newRepository().find('id-1')).toEqual(result.model);
  });

  it('orders the list by name, accent- and case-insensitively', async () => {
    await repository.add(draft('Zeta', 'z.pdf'));
    await repository.add(draft('álvaro', 'a.pdf'));
    await repository.add(draft('Beta', 'b.pdf'));
    expect((await repository.list()).map((model) => model.name)).toEqual(['álvaro', 'Beta', 'Zeta']);
  });

  it('refuses the same path twice, ignoring case and separator style', async () => {
    await repository.add(draft('One', 'Java/CV.pdf'));
    const again = await repository.add(draft('Two', 'java\\cv.PDF'));
    expect(again).toMatchObject({ status: 'already_registered' });
    expect(await repository.list()).toHaveLength(1);
  });

  it('lets two models share a name', async () => {
    await repository.add(draft('Same', 'a.pdf'));
    await repository.add(draft('Same', 'b.pdf'));
    expect(await repository.list()).toHaveLength(2);
  });

  it('updates editable fields only and keeps path, id and registration date', async () => {
    await repository.add(draft('Old', 'a.pdf', { tags: ['x'], note: 'keep?' }));
    const result = await repository.update('id-1', { name: 'New', tags: ['y'], kind: 'letter', note: null });

    expect(result.status).toBe('updated');
    if (result.status !== 'updated') return;
    expect(result.model).toMatchObject({
      id: 'id-1',
      name: 'New',
      tags: ['y'],
      kind: 'letter',
      relativePath: 'a.pdf',
      registeredAt: NOW,
    });
    expect('note' in result.model).toBe(false);
    expect(await repository.update('missing', { name: 'x' })).toEqual({ status: 'not_found' });
  });

  it('removes only the registry entry', async () => {
    await repository.add(draft('A', 'a.pdf'));
    await repository.add(draft('B', 'b.pdf'));
    expect(await repository.remove('id-1')).toBe(true);
    expect(await repository.remove('id-1')).toBe(false);
    expect((await repository.list()).map((model) => model.name)).toEqual(['B']);
    // The path becomes registrable again.
    expect((await repository.add(draft('A again', 'a.pdf'))).status).toBe('added');
  });

  it('serialises concurrent adds without losing a row', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => repository.add(draft(`M${i}`, `dir/m${i}.pdf`))),
    );
    expect(results.every((result) => result.status === 'added')).toBe(true);
    expect(await repository.list()).toHaveLength(25);

    const same = await Promise.all(
      Array.from({ length: 5 }, () => repository.add(draft('Dup', 'dup.pdf'))),
    );
    expect(same.filter((result) => result.status === 'added')).toHaveLength(1);
  });

  it('stores long names, accents and many tags faithfully', async () => {
    const name = 'Ñ'.repeat(120);
    const tags = Array.from({ length: 12 }, (_, i) => `etiqueta-${i}-ñ`);
    await repository.add(draft(name, 'CV Inglés/Carta Ñandú_.PDF', { tags }));
    const [model] = await newRepository().list();
    expect(model).toMatchObject({ name, tags, relativePath: 'CV Inglés/Carta Ñandú_.PDF' });
  });

  it('refuses a corrupt file on every operation and leaves it untouched', async () => {
    const corrupt = '{ this is not json';
    await writeFile(filePath, corrupt, 'utf8');

    await expect(repository.list()).rejects.toThrow();
    await expect(repository.add(draft('A', 'a.pdf'))).rejects.toThrow();
    await expect(repository.update('x', { name: 'y' })).rejects.toThrow();
    await expect(repository.remove('x')).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(corrupt);
    expect(await readdir(directory)).toEqual(['cv-models.json']);
  });

  it('refuses a file that parses but breaks the schema and leaves it untouched', async () => {
    const wrong = JSON.stringify({ version: 1, models: [{ id: 'x', name: '', kind: 'cv' }] });
    await writeFile(filePath, wrong, 'utf8');
    await expect(repository.list()).rejects.toThrow();
    await expect(repository.add(draft('A', 'a.pdf'))).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(wrong);
  });

  it('refuses a stored path that is unsafe (tampered file)', async () => {
    const tampered = JSON.stringify({
      version: 1,
      models: [
        {
          id: 'x',
          name: 'n',
          kind: 'cv',
          language: 'es',
          tags: [],
          relativePath: '../../secret.pdf',
          registeredAt: NOW.toISOString(),
        },
      ],
    });
    await writeFile(filePath, tampered, 'utf8');
    await expect(repository.list()).rejects.toThrow();
  });

  it('keeps working after a failed operation', async () => {
    await writeFile(filePath, 'garbage', 'utf8');
    await expect(repository.list()).rejects.toThrow();
    await rm(filePath);
    expect((await repository.add(draft('A', 'a.pdf'))).status).toBe('added');
  });

  it('creates the parent directory on first write', async () => {
    const nested = createJsonCvModelRepository({ filePath: join(directory, 'deep', 'er', 'm.json') });
    expect((await nested.add(draft('A', 'a.pdf'))).status).toBe('added');
  });
});
