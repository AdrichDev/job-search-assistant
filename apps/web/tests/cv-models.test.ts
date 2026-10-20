import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCvLibrary,
  createJsonCvModelRepository,
  type CvModelDeps,
  type CvModelRepository,
} from '@job-queue/core';
import { CV_MODEL_NOTICE_CODES, isCvModelNoticeCode } from '@/copy/cv-model-notices';
import { ES } from '@/copy/es';
import {
  loadModelsPage,
  parseTagsInput,
  registerCvModelFromForm,
  removeCvModelFromForm,
  suggestModelName,
  suggestTags,
  updateCvModelFromForm,
} from '@/server/cv-models';
import { mkdirSync, writeFileSync } from 'node:fs';

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');

let library: string;
let data: string;
let deps: CvModelDeps;
const errors: string[] = [];

function put(relative: string, content: Buffer | string = PDF): void {
  const parts = relative.split('/');
  mkdirSync(join(library, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(library, ...parts), content);
}

function form(entries: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const VALID = {
  name: 'CV Java',
  kind: 'cv',
  language: 'es',
  tags: 'Java, Spring Boot',
  note: '',
  relativePath: 'java/cv.pdf',
};

beforeEach(async () => {
  library = await mkdtemp(join(tmpdir(), 'web-cv-lib-'));
  data = await mkdtemp(join(tmpdir(), 'web-cv-data-'));
  errors.length = 0;
  put('java/cv.pdf');
  put('CV Inglés/Carta Ñandú_.PDF');
  put('foto.jpg', 'x');
  deps = {
    repository: createJsonCvModelRepository({ filePath: join(data, 'cv-models.json') }),
    library: createCvLibrary({ root: library }),
    logger: { info: () => undefined, warn: () => undefined, error: (m) => void errors.push(m) },
  };
});

afterEach(async () => {
  await rm(library, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
});

describe('form helpers', () => {
  it('splits tags on commas and ignores blanks', () => {
    expect(parseTagsInput(' Java, ,spring boot,,')).toEqual(['Java', 'spring boot']);
    expect(parseTagsInput('')).toEqual([]);
  });

  it('suggests a name from the file name without extension', () => {
    expect(suggestModelName('CV Inglés/Carta Ñandú_.PDF')).toBe('Carta Ñandú_');
    expect(suggestModelName('a.pdf')).toBe('a');
    expect(suggestModelName(`${'x'.repeat(300)}.pdf`)).toHaveLength(120);
  });

  it('suggests tags from the folders, lowercased, without trailing noise', () => {
    expect(suggestTags('CV Inglés/Java_/x.pdf')).toEqual(['cv inglés', 'java']);
    expect(suggestTags('x.pdf')).toEqual([]);
  });
});

describe('registerCvModelFromForm', () => {
  it('registers a valid form', async () => {
    const result = await registerCvModelFromForm(form(VALID), deps);
    expect(result).toMatchObject({ ok: true, code: 'registered' });
    expect((await deps.repository.list())[0]).toMatchObject({ tags: ['java', 'spring boot'] });
  });

  it.each([
    [{ name: '' }, 'invalid_name'],
    [{ kind: 'resume' }, 'invalid_kind'],
    [{ language: 'fr' }, 'invalid_language'],
    [{ tags: Array.from({ length: 13 }, (_, i) => `t${i}`).join(',') }, 'too_many_tags'],
    [{ tags: 'x'.repeat(41) }, 'tag_too_long'],
    [{ tags: 'a'.repeat(5000) }, 'invalid_tags'],
    [{ name: 'n'.repeat(100_000) }, 'invalid_name'],
    [{ note: 'n'.repeat(100_000) }, 'invalid_note'],
    [{ relativePath: '../secret.pdf' }, 'invalid_path'],
    [{ relativePath: '..\\secret.pdf' }, 'invalid_path'],
    [{ relativePath: '/etc/passwd.pdf' }, 'invalid_path'],
    [{ relativePath: 'C:\\x.pdf' }, 'invalid_path'],
    [{ relativePath: 'foto.jpg' }, 'not_pdf'],
    [{ relativePath: 'nope.pdf' }, 'file_not_found'],
  ])('refuses %j as %s and registers nothing', async (override, code) => {
    const result = await registerCvModelFromForm(form({ ...VALID, ...override }), deps);
    expect(result).toEqual({ ok: false, code });
    expect(await deps.repository.list()).toEqual([]);
  });

  it('treats non-string fields (files) and missing fields as invalid, never throws', async () => {
    const file = new File(['abc'], 'x.pdf', { type: 'application/pdf' });
    expect(await registerCvModelFromForm(form({ ...VALID, name: file }), deps)).toEqual({
      ok: false,
      code: 'invalid_name',
    });
    expect(await registerCvModelFromForm(new FormData(), deps)).toEqual({
      ok: false,
      code: 'invalid_name',
    });
    for (const junk of [null, undefined, 'x', 5, {}, []]) {
      expect(await registerCvModelFromForm(junk, deps)).toEqual({ ok: false, code: 'invalid_input' });
    }
  });

  it('refuses a duplicate', async () => {
    await registerCvModelFromForm(form(VALID), deps);
    expect(await registerCvModelFromForm(form({ ...VALID, relativePath: 'JAVA/CV.pdf' }), deps)).toEqual({
      ok: false,
      code: 'already_registered',
    });
  });

  it('degrades a corrupt registry to a code, with the detail only in the log', async () => {
    await writeFile(join(data, 'cv-models.json'), '{nope', 'utf8');
    const result = await registerCvModelFromForm(form(VALID), deps);
    expect(result).toEqual({ ok: false, code: 'registry_unavailable' });
    expect(JSON.stringify(result)).not.toContain(data);
    expect(errors.join('\n')).toContain('cv-models.json');
  });
});

describe('updateCvModelFromForm', () => {
  it('updates and ignores a tampered path field', async () => {
    const registered = await registerCvModelFromForm(form(VALID), deps);
    expect(registered.ok).toBe(true);
    const [model] = await deps.repository.list();
    const result = await updateCvModelFromForm(
      form({ id: model?.id ?? '', name: 'Nuevo', kind: 'letter', language: 'en', tags: 'a, B', note: 'hola', relativePath: '../../evil.pdf' }),
      deps,
    );
    expect(result).toMatchObject({ ok: true, code: 'updated' });
    expect(await deps.repository.find(model?.id ?? '')).toMatchObject({
      name: 'Nuevo',
      kind: 'letter',
      language: 'en',
      tags: ['a', 'b'],
      note: 'hola',
      relativePath: 'java/cv.pdf',
    });
  });

  it('reports unknown ids and refusals with fixed codes', async () => {
    expect(await updateCvModelFromForm(form({ id: 'nope', name: 'x', kind: 'cv', language: 'es', tags: '', note: '' }), deps)).toEqual({
      ok: false,
      code: 'model_not_found',
    });
    expect(await updateCvModelFromForm(new FormData(), deps)).toEqual({ ok: false, code: 'model_not_found' });
    await registerCvModelFromForm(form(VALID), deps);
    const [model] = await deps.repository.list();
    expect(
      await updateCvModelFromForm(form({ id: model?.id ?? '', name: '', kind: 'cv', language: 'es', tags: '', note: '' }), deps),
    ).toEqual({ ok: false, code: 'invalid_name' });
  });
});

describe('removeCvModelFromForm', () => {
  it('removes the entry and leaves the file', async () => {
    await registerCvModelFromForm(form(VALID), deps);
    const [model] = await deps.repository.list();
    expect(await removeCvModelFromForm(form({ id: model?.id ?? '' }), deps)).toEqual({ ok: true, code: 'removed' });
    expect(await deps.repository.list()).toEqual([]);
    expect((await deps.library.resolveModelFile('java/cv.pdf')).status).toBe('ok');
  });

  it('reports unknown or missing ids', async () => {
    expect(await removeCvModelFromForm(form({ id: 'nope' }), deps)).toEqual({ ok: false, code: 'model_not_found' });
    expect(await removeCvModelFromForm(new FormData(), deps)).toEqual({ ok: false, code: 'model_not_found' });
  });
});

describe('loadModelsPage', () => {
  it('lists models with availability and the unregistered candidates', async () => {
    await registerCvModelFromForm(form(VALID), deps);
    const page = await loadModelsPage(deps);
    expect(page.warnings).toEqual([]);
    expect(page.models.map((entry) => [entry.model.name, entry.available])).toEqual([['CV Java', true]]);
    expect(page.candidates).toEqual(['CV Inglés/Carta Ñandú_.PDF']);
    expect(page.candidatesTruncated).toBe(false);
  });

  it('degrades a corrupt registry to a warning code, without raw text', async () => {
    await writeFile(join(data, 'cv-models.json'), '{nope', 'utf8');
    const page = await loadModelsPage(deps);
    expect(page.warnings).toContain('registry_unavailable');
    expect(page.models).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(data);
  });

  it('degrades a missing library to a warning but still lists the registry', async () => {
    await registerCvModelFromForm(form(VALID), deps);
    await rm(library, { recursive: true, force: true });
    const page = await loadModelsPage(deps);
    expect(page.warnings).toContain('library_unavailable');
    expect(page.models.map((entry) => entry.available)).toEqual([false]);
    expect(page.candidates).toEqual([]);
  });

  it('never throws when the repository throws outright', async () => {
    const broken: CvModelRepository = {
      list: async () => { throw new Error(`boom ${data}`); },
      find: async () => null,
      add: async () => { throw new Error('boom'); },
      update: async () => { throw new Error('boom'); },
      remove: async () => { throw new Error('boom'); },
    };
    const page = await loadModelsPage({ ...deps, repository: broken });
    expect(page.warnings).toContain('registry_unavailable');
    expect(JSON.stringify(page)).not.toContain(data);
  });
});

describe('Spanish copy for the model library', () => {
  it('has a Spanish sentence for every notice code', () => {
    for (const code of CV_MODEL_NOTICE_CODES) {
      const text = ES.models.notices[code];
      expect(text, code).toBeTruthy();
      expect(text, code).not.toContain('_');
      expect(text, code).not.toMatch(/[A-Za-z]:\\|\/Users\//);
    }
  });

  it('recognises only known codes from a query string', () => {
    expect(isCvModelNoticeCode('registered')).toBe(true);
    expect(isCvModelNoticeCode('<script>')).toBe(false);
    expect(isCvModelNoticeCode(undefined)).toBe(false);
    expect(isCvModelNoticeCode(['registered'])).toBe(false);
  });

  it('labels every kind and language', () => {
    expect(ES.models.kinds.cv).toBeTruthy();
    expect(ES.models.kinds.letter).toBeTruthy();
    expect(ES.models.languages.es).toBeTruthy();
    expect(ES.models.languages.en).toBeTruthy();
  });
});
